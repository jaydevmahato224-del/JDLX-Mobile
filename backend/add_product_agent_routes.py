"""
Add-Product Agent routes (listing agents).

A THIRD kind of warehouse worker, separate from billing staff:
  - Manager registers the agent once (name + email + phone + passport photo)
    and receives a permanent unique agent code (AP-XXXXXX).
  - NO passwords. Every working day the warehouse manager generates a 6-digit
    OTP in the warehouse panel, choosing how long the session may last
    (flexible 60–480 minutes, manager's choice, hard-capped at 8 hours).
  - The agent logs in with email-or-phone + that OTP. The OTP is single-use.
  - While logged in the agent can ONLY create product drafts with the
    discovery fields: images, category, title, description, tags, return
    policy. Brand stays locked to 'None' and pricing/stock fields are
    structurally ignored — the agent can never set a price.
  - The warehouse manager completes the draft (price, stock, SKU, brand...)
    via /api/warehouse/add-agent-drafts/<id>/complete, which pushes it into
    the EXISTING approval pipeline (approval_status 'pending' → admin
    approves → storefront). No existing flow is bypassed or changed.
  - Breaks: 15 minutes of break allowance per rolling 60-minute window.
    The agent may take it all at once or in pieces (2 min here, 2 min
    there). While a break runs the session countdown is paused (the break
    minutes are added back to the session end time when the break ends).
  - Every product carries the agent's code so the manager always knows who
    created the listing.

Blueprint: add_agent_bp (registered in app.py alongside warehouse_bp).
"""

import datetime
import hashlib
import hmac
import json
import jwt
import os
import secrets
from functools import wraps

from flask import Blueprint, jsonify, request, current_app

from database import get_db
from jwt_config import get_jwt_secret
from utils.response_utils import success_response, error_response

# Reuse the existing warehouse guards + helpers — no auth logic is duplicated
# or weakened; manager endpoints sit behind the SAME require_warehouse_auth
# (owner-only) decorator the rest of the partner panel uses.
from warehouse_routes import (
    require_warehouse_auth,
    _save_uploaded_asset,
    _autofill_discovery_meta,
)

add_agent_bp = Blueprint("add_product_agent", __name__)

# ── Session / break policy constants ─────────────────────────────────────────
MIN_SESSION_MINUTES = 60        # manager cannot issue a shorter shift
MAX_SESSION_MINUTES = 480       # hard cap: 8 hours (user requirement)
OTP_ATTEMPTS = 5                # wrong-OTP tries before the session dies

BREAK_WINDOW_MINUTES = 60       # rolling window
BREAK_ALLOWANCE_MINUTES = 15    # per window, splittable
STALE_BREAK_AUTOCLOSE_MIN = 20  # abandoned open break auto-closes after this

_DT_FMT = "%Y-%m-%d %H:%M:%S"


def _now():
    return datetime.datetime.utcnow()


def _parse_dt(value):
    """Parses a DB timestamp string into a naive-UTC datetime (None-safe)."""
    if not value:
        return None
    if isinstance(value, datetime.datetime):
        return value
    text = str(value).strip().replace("T", " ")
    for fmt in (_DT_FMT, "%Y-%m-%d %H:%M:%S.%f"):
        try:
            return datetime.datetime.strptime(text[: 26 if fmt == _DT_FMT else 32], fmt)
        except (ValueError, TypeError):
            continue
    return None


def _hash_otp(otp, salt):
    return hashlib.sha256(f"{salt}:{otp}".encode()).hexdigest()


def _otp_salt(sess):
    """otp_hash stores '<salt>:<sha256(salt:otp)>' — this extracts the salt.
    The salt itself is pure hex, so the ':' separator is unambiguous."""
    raw = sess["otp_hash"] or ""
    return raw.split(":", 1)[0] if ":" in raw else ""


def _agent_jwt(agent, session_row, ends_at):
    """JWT for an add-product agent. exp carries a 1h slack past the session
    end so a break extension stays usable; the AUTHORITATIVE gate is the DB
    session row checked in require_agent_session, never the JWT alone."""
    remaining = max(60, int((ends_at - _now()).total_seconds()) + 3600)
    payload = {
        "type": "add_product_agent",
        "agent_id": agent["id"],
        "agent_code": agent["agent_code"],
        "warehouse_id": agent["warehouse_id"],
        "sid": session_row["id"],
        "exp": _now() + datetime.timedelta(seconds=remaining),
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm="HS256")


# ── Work / payout stats ──────────────────────────────────────────────────

def _agent_stats(cur, agent_id, per_entry_rate):
    """Lifetime work + payout snapshot for an agent:
      - entries:        product drafts the agent has created
      - approved:       of those, the ones the admin approved (accepted work)
      - minutes_worked: session clock minus breaks (break time is NOT work)
      - break_minutes:  total break time taken
      - total_earning:  entries × per-entry rate (manager-set ₹/entry)
    Pure read — no business logic is affected; the manager still completes
    drafts and admin still approves them exactly as before."""
    def _one(sql, params=()):
        row = cur.execute(sql, params).fetchone()
        return row[0] if row else 0

    entries = _one("SELECT COUNT(*) FROM products WHERE added_by_agent_id = ?", (agent_id,))
    approved = _one(
        "SELECT COUNT(*) FROM products WHERE added_by_agent_id = ? AND approval_status = 'approved'",
        (agent_id,),
    )
    sess_secs = _one(
        "SELECT COALESCE(SUM(CASE WHEN session_ends_at IS NOT NULL "
        "THEN CAST(julianday(session_ends_at) - julianday(session_started_at) AS REAL) ELSE 0 END) * 86400, 0) "
        "FROM add_agent_otp_sessions WHERE agent_id = ? AND session_started_at IS NOT NULL",
        (agent_id,),
    )
    break_secs = _one(
        "SELECT COALESCE(SUM(duration_minutes), 0) * 60 FROM add_agent_breaks WHERE agent_id = ?",
        (agent_id,),
    )
    # Guard against float jitter; break can never exceed session time.
    worked = max(0.0, float(sess_secs) - float(break_secs))
    try:
        rate = float(per_entry_rate or 0)
    except (TypeError, ValueError):
        rate = 0.0
    return {
        "entries": int(entries),
        "approved_entries": int(approved),
        "minutes_worked": round(worked / 60.0, 1),
        "break_minutes": round(float(break_secs) / 60.0, 1),
        "per_entry_rate": rate,
        "total_earning": round(entries * rate, 2),
    }


# ── Break bookkeeping ────────────────────────────────────────────────────

def _close_stale_break(cur, session_id):
    """Auto-closes an abandoned open break (client crashed mid-break) so it
    can't block future breaks forever. Counted at most 15 minutes."""
    row = cur.execute(
        "SELECT id, started_at FROM add_agent_breaks WHERE session_id = ? AND duration_minutes IS NULL "
        "ORDER BY id DESC LIMIT 1",
        (session_id,),
    ).fetchone()
    if not row:
        return
    started = _parse_dt(row["started_at"])
    elapsed = (_now() - started).total_seconds() / 60.0 if started else STALE_BREAK_AUTOCLOSE_MIN
    if elapsed >= STALE_BREAK_AUTOCLOSE_MIN:
        cur.execute(
            "UPDATE add_agent_breaks SET duration_minutes = ? WHERE id = ?",
            (min(elapsed, BREAK_ALLOWANCE_MINUTES), row["id"]),
        )


def _break_state(cur, session_row):
    """Returns (used_minutes_in_window, remaining_allowance, open_break dict|None).

    Allowance is per ROLLING 60-minute window, so a fully-used hour frees up
    15 fresh minutes as soon as the window slides past the older breaks.
    """
    sid = session_row["id"]
    _close_stale_break(cur, sid)
    cutoff = (_now() - datetime.timedelta(minutes=BREAK_WINDOW_MINUTES)).strftime(_DT_FMT)
    rows = cur.execute(
        "SELECT id, duration_minutes, started_at FROM add_agent_breaks "
        "WHERE session_id = ? AND started_at >= ? ORDER BY id ASC",
        (sid, cutoff),
    ).fetchall()

    used = 0.0
    open_break = None
    for r in rows:
        if r["duration_minutes"] is None:
            started = _parse_dt(r["started_at"])
            elapsed = (_now() - started).total_seconds() / 60.0 if started else 0.0
            open_break = {
                "id": r["id"],
                "started_at": r["started_at"],
                "elapsed_minutes": round(min(elapsed, BREAK_ALLOWANCE_MINUTES), 1),
            }
            used += min(elapsed, BREAK_ALLOWANCE_MINUTES)
        else:
            used += float(r["duration_minutes"] or 0)

    remaining = max(0.0, BREAK_ALLOWANCE_MINUTES - used)
    return round(used, 1), round(remaining, 1), open_break


def _session_snapshot(cur, agent, session_row):
    """Full session state for the agent UI (countdown + break allowance)."""
    ends_at = _parse_dt(session_row["session_ends_at"])
    remaining_minutes = max(0, int((ends_at - _now()).total_seconds() / 60)) if ends_at else 0
    used, remaining_allowance, open_break = _break_state(cur, session_row)
    return {
        "session_id": session_row["id"],
        "duration_minutes": session_row["duration_minutes"],
        "ends_at": session_row["session_ends_at"],
        "remaining_minutes": remaining_minutes,
        "break": {
            "window_minutes": BREAK_WINDOW_MINUTES,
            "allowance_minutes": BREAK_ALLOWANCE_MINUTES,
            "used_minutes": used,
            "remaining_minutes": remaining_allowance,
            "active": open_break,
        },
    }


# ── Agent-session guard ──────────────────────────────────────────────────────

def require_agent_session(f):
    """Decorator for agent endpoints. Validates the JWT AND the live DB
    session (status active, inside its time window) AND the agent being
    active. Revoking the session row instantly kills access even though the
    JWT is stateless."""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return error_response("Missing agent token", 401)
        try:
            payload = jwt.decode(auth.split(" ", 1)[1], get_jwt_secret(), algorithms=["HS256"])
        except jwt.ExpiredSignatureError:
            return error_response("Agent session expired — ask the manager for a new OTP", 401)
        except Exception:
            return error_response("Invalid agent token", 401)
        if payload.get("type") != "add_product_agent":
            return error_response("Invalid agent token", 403)

        conn = get_db()
        try:
            sess = conn.execute(
                "SELECT * FROM add_agent_otp_sessions WHERE id = ? AND status = 'active'",
                (payload.get("sid"),),
            ).fetchone()
            if not sess or sess["agent_id"] != payload.get("agent_id"):
                return error_response("Agent session invalid — manager ne revoke kiya ya naya OTP bana liya", 403)

            ends_at = _parse_dt(sess["session_ends_at"])
            if not ends_at or _now() > ends_at:
                # Break semantics: an OPEN break has PAUSED the countdown, so
                # the shift must not die mid-break — let the agent through;
                # ending the break will extend session_ends_at. An abandoned
                # break (agent vanished) auto-closes after the stale window,
                # after which expiry applies normally.
                open_break = conn.execute(
                    "SELECT id, started_at FROM add_agent_breaks WHERE session_id = ? AND duration_minutes IS NULL "
                    "ORDER BY id DESC LIMIT 1",
                    (sess["id"],),
                ).fetchone()
                keep_alive = False
                if open_break:
                    started = _parse_dt(open_break["started_at"])
                    elapsed = (_now() - started).total_seconds() / 60.0 if started else 0.0
                    if elapsed < STALE_BREAK_AUTOCLOSE_MIN:
                        keep_alive = True
                    else:
                        conn.execute(
                            "UPDATE add_agent_breaks SET duration_minutes = ? WHERE id = ?",
                            (min(elapsed, BREAK_ALLOWANCE_MINUTES), open_break["id"]),
                        )
                if not keep_alive:
                    conn.execute(
                        "UPDATE add_agent_otp_sessions SET status = 'expired' WHERE id = ?", (sess["id"],)
                    )
                    conn.commit()
                    return error_response("Session time khatam — manager se naya OTP lein", 401)

            agent = conn.execute(
                "SELECT * FROM add_product_agents WHERE id = ? AND status = 'active'",
                (sess["agent_id"],),
            ).fetchone()
            if not agent:
                return error_response("Agent account is inactive", 403)

            request.agent_payload = payload
            request.agent_row = agent
            request.agent_session = sess
            return f(*args, **kwargs)
        finally:
            conn.close()
    return decorated


# ══════════════════════════════════════════════════════════════════════════════
#  AGENT ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@add_agent_bp.route("/api/agent/login", methods=["POST"])
def agent_login():
    """Email-or-phone + 6-digit OTP login (manager-generated daily shift OTP).
    The OTP is generated by the warehouse manager with a chosen duration
    (60–480 min) and is single-use."""
    data = request.get_json(silent=True) or {}
    identifier = (data.get("identifier") or "").strip().lower()
    otp = (data.get("otp") or "").strip()

    if not identifier or not otp:
        return error_response("Both email/phone and OTP are required", 400)
    if not (len(otp) == 6 and otp.isdigit()):
        return error_response("OTP 6 digits ka hona chahiye", 400)

    conn = get_db()
    try:
        cur = conn.cursor()
        # The same email/phone may legitimately exist under TWO warehouses
        # (uniqueness is per-warehouse), so identifier alone cannot pick the
        # agent. The OTP itself disambiguates: we try every candidate's latest
        # unused session and the one whose stored hash matches wins. A wrong
        # OTP burns one attempt on EVERY candidate session sharing this
        # identifier, so the ambiguity can't be used to brute-force.
        candidates = cur.execute(
            "SELECT * FROM add_product_agents WHERE (LOWER(email) = ? OR phone = ?) AND status = 'active'",
            (identifier, identifier),
        ).fetchall()
        if not candidates:
            return error_response("Agent not found or inactive — ask the manager to register you", 404)

        computed = None  # computed lazily per session (salt differs)
        matched = None   # (agent_row, session_row)
        candidate_sessions = []
        for cand in candidates:
            sess = cur.execute(
                "SELECT * FROM add_agent_otp_sessions WHERE agent_id = ? AND status = 'active' "
                "AND session_started_at IS NULL ORDER BY id DESC LIMIT 1",
                (cand["id"],),
            ).fetchone()
            if sess:
                candidate_sessions.append((cand, sess))

        if not candidate_sessions:
            return error_response("Koi active OTP nahi mila — manager se naya OTP generate karwayen", 401)

        # Exhausted sessions die here; wrong OTP decrements every candidate.
        live = []
        for cand, sess in candidate_sessions:
            if (sess["attempts_left"] or 0) <= 0:
                cur.execute("UPDATE add_agent_otp_sessions SET status = 'expired' WHERE id = ?", (sess["id"],))
            else:
                live.append((cand, sess))
        conn.commit()
        if not live:
            return error_response("Too many wrong OTP attempts — ask the manager for a new OTP", 401)

        matched = None
        for cand, sess in live:
            # Constant-time comparison so login timing can't leak OTP digits.
            # otp_hash stores '<salt>:<sha256(salt:otp)>' — compare against the
            # HASH part only (comparing against the full string can never match).
            stored_hash = (sess["otp_hash"] or "").split(":", 1)[1] if ":" in (sess["otp_hash"] or "") else ""
            computed = _hash_otp(otp, _otp_salt(sess))
            if hmac.compare_digest(computed, stored_hash):
                matched = (cand, sess)
                break

        if not matched:
            for _, sess in live:
                cur.execute(
                    "UPDATE add_agent_otp_sessions SET attempts_left = attempts_left - 1 WHERE id = ?",
                    (sess["id"],),
                )
            conn.commit()
            left = min(sess["attempts_left"] for _, sess in live) - 1
            return error_response(f"Wrong OTP ({max(0, left)} attempts left)", 401)

        agent, sess = matched

        # Correct OTP — start the shift NOW (countdown begins at first login).
        started_at = _now().strftime(_DT_FMT)
        ends_at = _now() + datetime.timedelta(minutes=int(sess["duration_minutes"]))
        cur.execute(
            "UPDATE add_agent_otp_sessions SET session_started_at = ?, session_ends_at = ? WHERE id = ?",
            (started_at, ends_at.strftime(_DT_FMT), sess["id"]),
        )
        conn.commit()

        fresh = cur.execute("SELECT * FROM add_agent_otp_sessions WHERE id = ?", (sess["id"],)).fetchone()
        token = _agent_jwt(agent, fresh, ends_at)
        return success_response({
            "token": token,
            "agent": {
                "id": agent["id"],
                "agent_code": agent["agent_code"],
                "name": agent["name"],
                "email": agent["email"],
                "phone": agent["phone"],
                "photo_url": agent["photo_url"],
                "warehouse_id": agent["warehouse_id"],
                "per_entry_rate": agent["per_entry_rate"],
            },
            "session": _session_snapshot(cur, agent, fresh),
        }, "Login successful — session started", 200)
    finally:
        conn.close()


@add_agent_bp.route("/api/agent/login-self", methods=["POST"])
def agent_login_self():
    """PASSWORDLESS, OTP-FREE login for REGISTERED agents: email-or-phone only.
    Lands the agent directly on their profile (stats + draft form) without a
    daily OTP. A shift (session) still starts ONLY via the manager's OTP —
    that flow is untouched — so an OTP login later simply adopts the manager's
    duration. No passwords exist anywhere; identity = registered email/phone."""
    data = request.get_json(silent=True) or {}
    identifier = (data.get("identifier") or "").strip().lower()
    if not identifier:
        return error_response("Email ya mobile number enter karen", 400)

    conn = get_db()
    try:
        cur = conn.cursor()
        agent = cur.execute(
            "SELECT * FROM add_product_agents WHERE (LOWER(email) = ? OR phone = ?) AND status = 'active'",
            (identifier, identifier),
        ).fetchone()
        if not agent:
            return error_response("Agent not found or inactive — ask the manager to register you", 404)

        # Profile-facing JWT (agent identity only). It carries NO sid — every
        # shift endpoint still validates the live DB session row, so this
        # token alone can never start a shift, take a break or save a draft.
        payload = {
            "type": "add_product_agent",
            "agent_id": agent["id"],
            "agent_code": agent["agent_code"],
            "warehouse_id": agent["warehouse_id"],
            "profile_only": True,
            "exp": _now() + datetime.timedelta(hours=12),
        }
        token = jwt.encode(payload, get_jwt_secret(), algorithm="HS256")
        stats = _agent_stats(cur, agent["id"], agent["per_entry_rate"])
        return success_response({
            "token": token,
            "profile_only": True,
            "agent": {
                "id": agent["id"],
                "agent_code": agent["agent_code"],
                "name": agent["name"],
                "email": agent["email"],
                "phone": agent["phone"],
                "photo_url": agent["photo_url"],
                "warehouse_id": agent["warehouse_id"],
                "per_entry_rate": agent["per_entry_rate"],
            },
            "stats": stats,
        }, "Welcome back", 200)
    finally:
        conn.close()


@add_agent_bp.route("/api/agent/profile", methods=["GET"])
def agent_profile():
    """Agent profile page data: identity + lifetime stats (entries, minutes
    worked, break minutes, per-entry rate, total earning) + the current live
    session (null when the agent has not started a shift via OTP). Accepts a
    profile-only OR a shift token. Public-route guarded by the agent JWT."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return error_response("Missing agent token", 401)
    try:
        payload = jwt.decode(auth.split(" ", 1)[1], get_jwt_secret(), algorithms=["HS256"])
    except Exception:
        return error_response("Invalid or expired agent token — login again", 401)
    if payload.get("type") != "add_product_agent":
        return error_response("Invalid agent token", 403)

    conn = get_db()
    try:
        cur = conn.cursor()
        agent = cur.execute(
            "SELECT * FROM add_product_agents WHERE id = ? AND status = 'active'",
            (payload.get("agent_id"),),
        ).fetchone()
        if not agent:
            return error_response("Agent account is inactive", 403)

        live = cur.execute(
            "SELECT * FROM add_agent_otp_sessions WHERE agent_id = ? AND status = 'active' "
            "AND session_started_at IS NOT NULL AND session_ends_at > ? ORDER BY id DESC LIMIT 1",
            (agent["id"], _now().strftime(_DT_FMT)),
        ).fetchone()
        # Open-break pause semantics: an expired-ends_at session with an open
        # break is still alive (break end will extend it) — same rule the
        # shift guard uses.
        if not live:
            maybe = cur.execute(
                "SELECT * FROM add_agent_otp_sessions WHERE agent_id = ? AND status = 'active' "
                "AND session_started_at IS NOT NULL ORDER BY id DESC LIMIT 1",
                (agent["id"],),
            ).fetchone()
            if maybe:
                open_break = cur.execute(
                    "SELECT id FROM add_agent_breaks WHERE session_id = ? AND duration_minutes IS NULL",
                    (maybe["id"],),
                ).fetchone()
                if open_break:
                    live = maybe
        return success_response({
            "agent": {
                "id": agent["id"],
                "agent_code": agent["agent_code"],
                "name": agent["name"],
                "email": agent["email"],
                "phone": agent["phone"],
                "photo_url": agent["photo_url"],
                "warehouse_id": agent["warehouse_id"],
                "per_entry_rate": agent["per_entry_rate"],
            },
            "stats": _agent_stats(cur, agent["id"], agent["per_entry_rate"]),
            "session": _session_snapshot(cur, agent, live) if live else None,
        }, "Profile", 200)
    finally:
        conn.close()


@add_agent_bp.route("/api/agent/session/resume", methods=["POST"])
def agent_session_resume():
    """Exchanges a valid profile-only token for a full SHIFT token when the
    agent actually has a live manager-issued session running. This is the
    counterpart of login-self — profile (read-only) vs shift (drafts/breaks)
    stay two distinct capabilities, and the live DB session row remains the
    only thing that can ever grant shift powers."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return error_response("Missing agent token", 401)
    try:
        payload = jwt.decode(auth.split(" ", 1)[1], get_jwt_secret(), algorithms=["HS256"])
    except Exception:
        return error_response("Invalid or expired agent token — login again", 401)
    if payload.get("type") != "add_product_agent":
        return error_response("Invalid agent token", 403)

    conn = get_db()
    try:
        cur = conn.cursor()
        agent = cur.execute(
            "SELECT * FROM add_product_agents WHERE id = ? AND status = 'active'",
            (payload.get("agent_id"),),
        ).fetchone()
        if not agent:
            return error_response("Agent account is inactive", 403)

        sess = cur.execute(
            "SELECT * FROM add_agent_otp_sessions WHERE agent_id = ? AND status = 'active' "
            "AND session_started_at IS NOT NULL AND session_ends_at > ? ORDER BY id DESC LIMIT 1",
            (agent["id"], _now().strftime(_DT_FMT)),
        ).fetchone()
        # Same open-break pause rule as everywhere else: a session whose clock
        # ran out mid-break is still alive until the break ends.
        if not sess:
            maybe = cur.execute(
                "SELECT * FROM add_agent_otp_sessions WHERE agent_id = ? AND status = 'active' "
                "AND session_started_at IS NOT NULL ORDER BY id DESC LIMIT 1",
                (agent["id"],),
            ).fetchone()
            if maybe:
                open_break = cur.execute(
                    "SELECT id FROM add_agent_breaks WHERE session_id = ? AND duration_minutes IS NULL",
                    (maybe["id"],),
                ).fetchone()
                if open_break:
                    sess = maybe
        if not sess:
            return error_response("No active shift — start one with the manager's OTP", 409)

        token = _agent_jwt(agent, sess, _parse_dt(sess["session_ends_at"]) or _now())
        return success_response({
            "token": token,
            "session": _session_snapshot(cur, agent, sess),
        }, "Shift resumed", 200)
    finally:
        conn.close()


@add_agent_bp.route("/api/agent/session", methods=["GET"])
@require_agent_session
def agent_session():
    """Session heartbeat: remaining minutes + break allowance. Also lets the
    UI re-sync after refresh (token survives, countdown comes from DB)."""
    conn = get_db()
    try:
        cur = conn.cursor()
        agent = request.agent_row
        sess = request.agent_session
        snap = _session_snapshot(cur, agent, sess)
        snap["agent"] = {
            "id": agent["id"],
            "agent_code": agent["agent_code"],
            "name": agent["name"],
            "email": agent["email"],
            "phone": agent["phone"],
            "photo_url": agent["photo_url"],
        }
        return success_response(snap, "Session active", 200)
    finally:
        conn.close()


@add_agent_bp.route("/api/agent/logout", methods=["POST"])
@require_agent_session
def agent_logout():
    """Ends the session immediately (manager ka diya time baaki ho tab bhi)."""
    conn = get_db()
    try:
        cur = conn.cursor()
        _close_stale_break(cur, request.agent_session["id"])
        cur.execute(
            "UPDATE add_agent_otp_sessions SET status = 'expired' WHERE id = ?",
            (request.agent_session["id"],),
        )
        conn.commit()
        return success_response({}, "Logged out", 200)
    finally:
        conn.close()


@add_agent_bp.route("/api/agent/break/start", methods=["POST"])
@require_agent_session
def agent_break_start():
    """Start a break of ANY length the agent wants, as long as it fits in the
    rolling-window allowance (15 min per 60 min) and the remaining session
    time. 2 min abhi + 2 min baad me — sab chalta hai."""
    conn = get_db()
    try:
        cur = conn.cursor()
        sess = request.agent_session
        used, remaining_allowance, open_break = _break_state(cur, sess)

        if open_break:
            return error_response("A break is already running — end it first", 409)
        if remaining_allowance <= 0:
            return error_response(
                f"Is hour ka {BREAK_ALLOWANCE_MINUTES}-minute break allowance already use ho gaya — "
                "aghe window me fir se milega", 409
            )

        ends_at = _parse_dt(sess["session_ends_at"])
        session_remaining = max(0.0, (ends_at - _now()).total_seconds() / 60.0) if ends_at else 0.0
        if session_remaining <= 0:
            return error_response("Session time khatam", 401)

        cur.execute(
            "INSERT INTO add_agent_breaks (session_id, agent_id, started_at) VALUES (?, ?, ?)",
            (sess["id"], request.agent_row["id"], _now().strftime(_DT_FMT)),
        )
        conn.commit()
        _, remaining_after, open_break = _break_state(cur, sess)
        return success_response({
            "max_break_minutes": round(min(remaining_allowance, session_remaining), 1),
            "break": open_break,
        }, "Break started — countdown paused", 200)
    finally:
        conn.close()


@add_agent_bp.route("/api/agent/break/end", methods=["POST"])
@require_agent_session
def agent_break_end():
    """Ends the open break; the minutes consumed are ADDED BACK to the
    session end time, so break time never eats into the shift countdown."""
    conn = get_db()
    try:
        cur = conn.cursor()
        sess = request.agent_session
        _, _, open_break = _break_state(cur, sess)
        if not open_break:
            return error_response("No break is active right now", 409)

        started = _parse_dt(open_break["started_at"])
        elapsed = (_now() - started).total_seconds() / 60.0 if started else 0.0
        recorded = round(min(max(elapsed, 0.1), BREAK_ALLOWANCE_MINUTES), 2)

        cur.execute(
            "UPDATE add_agent_breaks SET duration_minutes = ? WHERE id = ?",
            (recorded, open_break["id"]),
        )
        # Pause semantics: extend the shift by the break length.
        ends_at = _parse_dt(sess["session_ends_at"]) or _now()
        new_ends = ends_at + datetime.timedelta(minutes=recorded)
        cur.execute(
            "UPDATE add_agent_otp_sessions SET session_ends_at = ? WHERE id = ?",
            (new_ends.strftime(_DT_FMT), sess["id"]),
        )
        conn.commit()
        fresh = cur.execute("SELECT * FROM add_agent_otp_sessions WHERE id = ?", (sess["id"],)).fetchone()
        return success_response(
            {**_session_snapshot(cur, request.agent_row, fresh), "break_taken_minutes": recorded},
            f"Break over ({recorded} min) — session extended by {recorded} min", 200,
        )
    finally:
        conn.close()


@add_agent_bp.route("/api/agent/categories", methods=["GET"])
@require_agent_session
def agent_categories():
    """Storefront categories the agent may pick from (read-only)."""
    conn = get_db()
    try:
        rows = conn.execute("SELECT id, name, icon FROM categories ORDER BY name ASC").fetchall()
        return success_response([dict(r) for r in rows], "Categories", 200)
    finally:
        conn.close()


@add_agent_bp.route("/api/agent/upload", methods=["POST"])
@require_agent_session
def agent_upload_image():
    """Product-image upload for agents — same cloud-first + DB-backup +
    local-static fallback pipeline as the partner panel's /api/warehouse/upload.
    Agents get their own endpoint so their scoped JWT never needs to be
    accepted by partner routes."""
    if "file" not in request.files:
        return error_response("No file part", 400)
    file = request.files["file"]
    if not file or not file.filename:
        return error_response("No selected file", 400)

    from werkzeug.utils import secure_filename
    ALLOWED = {".jpg", ".jpeg", ".png", ".webp"}
    filename = secure_filename(file.filename)
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED:
        return error_response("File type not allowed. Use JPG, PNG or WEBP.", 400)

    try:
        file_data = file.read()
        file.seek(0)
        try:
            from utils.image_optimizer import optimize_image_bytes
            optimized_data = optimize_image_bytes(file_data, filename)
        except Exception:
            optimized_data = file_data

        mime_type = "image/png" if ext == ".png" else ("image/webp" if ext == ".webp" else "image/jpeg")

        try:
            from services.cloud_image_service import upload_image_to_cloud, save_media_to_db
            cloud_url = upload_image_to_cloud(optimized_data, filename)
            if cloud_url:
                try:
                    save_media_to_db(cloud_url.rsplit("/", 1)[-1], mime_type, optimized_data)
                except Exception:
                    pass
                return success_response({"url": cloud_url}, "Image uploaded successfully", 201)
        except Exception as cloud_error:
            current_app.logger.warning(f"Agent image cloud upload failed, falling back to local: {cloud_error}")

        # Local static fallback (same directory as the partner-panel uploads).
        stamp = _now().strftime("%Y%m%d%H%M%S")
        final_name = f"agent_product_{stamp}_{secrets.token_hex(5)}{ext}"
        target_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "uploads", "product_images")
        os.makedirs(target_dir, exist_ok=True)
        target_path = os.path.join(target_dir, final_name)
        try:
            from utils.image_optimizer import optimize_and_save
            optimize_and_save(file, target_path)
        except Exception:
            file.seek(0)
            with open(target_path, "wb") as fh:
                fh.write(file.read())
        try:
            from services.cloud_image_service import save_media_to_db
            with open(target_path, "rb") as fh:
                save_media_to_db(final_name, mime_type, fh.read())
        except Exception:
            pass
        return success_response({"url": f"/static/uploads/product_images/{final_name}"}, "Image uploaded successfully", 201)
    except Exception as e:
        current_app.logger.error(f"Agent image upload failed: {str(e)}")
        return error_response("Image upload failed — please try again", 500)


@add_agent_bp.route("/api/agent/products", methods=["POST"])
@require_agent_session
def agent_create_product():
    """THE core endpoint. Creates a product DRAFT with only the discovery
    fields. Price/stock/SKU fields are structurally ignored (never read from
    the payload) — an agent physically cannot set pricing. The draft gets
    approval_status='agent_draft' (invisible to storefront AND to the admin
    pending queue) until the warehouse manager completes it, at which point
    it enters the regular 'pending' → admin-approval pipeline unchanged."""
    agent = request.agent_row
    sess = request.agent_session
    data = request.get_json(silent=True) or {}

    name = (data.get("name") or "").strip()
    description = (data.get("description") or "").strip()
    category_id = data.get("category_id")
    images = data.get("images") or []
    tags = data.get("tags") or []
    return_policy = (data.get("return_policy") or "").strip()

    if not name or len(name) < 3:
        return error_response("Product title kam se kam 3 letters ka hona chahiye", 400)
    if not description:
        return error_response("Description is required", 400)
    if not category_id:
        return error_response("Please select a category", 400)

    # NOTE: data.get('price') / 'mrp' / 'stock' / 'sku' are deliberately NOT
    # read anywhere in this function — pricing stays manager-only.

    conn = get_db()
    try:
        cur = conn.cursor()
        cat = cur.execute("SELECT id, name FROM categories WHERE id = ?", (category_id,)).fetchone()
        if not cat:
            return error_response("Category is not valid", 400)

        # Sanitize image URLs (only uploads from our own pipeline or http(s)).
        clean_images = []
        for img in images[:8]:
            if not isinstance(img, str):
                continue
            img = img.strip()
            if img.startswith(("http://", "https://", "/static/")):
                clean_images.append(img)
        if not clean_images:
            return error_response("Upload at least 1 product image", 400)

        clean_tags = [str(t).strip()[:60] for t in tags if str(t).strip()][:20]

        # Brand is LOCKED to 'None' for agent drafts (user requirement).
        brand = "None"

        from utils.product_url_utils import generate_share_token
        cur.execute(
            """
            INSERT INTO products (
                name, description, price, mrp, stock, category_id, category,
                images, brand, return_policy, share_token,
                lifecycle_state, has_variants, is_parent,
                approval_status, approval_source,
                added_by_agent_id, added_by_agent_code, agent_submitted_at
            ) VALUES (?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, 'live', 0, 0,
                      'agent_draft', 'agent', ?, ?, CURRENT_TIMESTAMP)
            """,
            (
                name, description, cat["id"], cat["name"],
                json.dumps(clean_images), brand,
                (return_policy or None), generate_share_token(),
                agent["id"], agent["agent_code"],
            ),
        )
        product_id = cur.lastrowid
        cur.execute("UPDATE products SET variant_group_id = ? WHERE id = ?", (product_id, product_id))

        # Discovery row: tags + SEO meta auto-derived from title/description
        # (same autofill helper the manager flow uses).
        disco = _autofill_discovery_meta(
            {"search_keywords": [], "product_tags": clean_tags, "search_synonyms": [], "meta_title": "", "meta_description": ""},
            name, description,
        )
        cur.execute(
            """INSERT INTO product_discovery (
                product_id, meta_title, meta_description, search_keywords, product_tags, search_synonyms
            ) VALUES (?, ?, ?, ?, ?, ?)""",
            (
                product_id, disco.get("meta_title"), disco.get("meta_description"),
                json.dumps(disco.get("search_keywords", [])),
                json.dumps(disco.get("product_tags", [])),
                json.dumps(disco.get("search_synonyms", [])),
            ),
        )
        conn.commit()

        return success_response({
            "product_id": product_id,
            "agent_code": agent["agent_code"],
            "approval_status": "agent_draft",
            "message": "Draft saved — the manager will complete the remaining fields and send it for admin approval",
        }, "Product draft saved", 201)
    except Exception as e:
        current_app.logger.error(f"agent_create_product failed: {e}", exc_info=True)
        return error_response("Product could not be saved — please try again", 500)
    finally:
        conn.close()


@add_agent_bp.route("/api/agent/products", methods=["GET"])
@require_agent_session
def agent_my_products():
    """The agent's own drafts with their current pipeline status."""
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT p.id, p.name, p.category, p.images, p.approval_status, p.agent_submitted_at
               FROM products p WHERE p.added_by_agent_id = ? ORDER BY p.id DESC LIMIT 60""",
            (request.agent_row["id"],),
        ).fetchall()
        items = []
        for r in rows:
            item = dict(r)
            try:
                item["images"] = json.loads(r["images"]) if r["images"] else []
            except Exception:
                item["images"] = []
            items.append(item)
        return success_response(items, "Drafts", 200)
    finally:
        conn.close()


# ══════════════════════════════════════════════════════════════════════════════
#  MANAGER ENDPOINTS (owner-only, same guard as the rest of the panel)
# ══════════════════════════════════════════════════════════════════════════════

@add_agent_bp.route("/api/warehouse/add-agents", methods=["GET"])
@require_warehouse_auth
def list_add_agents():
    wh_id = request.warehouse_payload.get("warehouse_id")
    conn = get_db()
    try:
        cur = conn.cursor()
        rows = cur.execute(
            "SELECT id, agent_code, name, email, phone, photo_url, per_entry_rate, status, created_at "
            "FROM add_product_agents WHERE warehouse_id = ? ORDER BY id DESC",
            (wh_id,),
        ).fetchall()
        agents = []
        for r in rows:
            agent = dict(r)
            live = cur.execute(
                """SELECT s.id, s.duration_minutes, s.session_ends_at, a.name AS agent_name
                   FROM add_agent_otp_sessions s JOIN add_product_agents a ON a.id = s.agent_id
                   WHERE s.agent_id = ? AND s.status = 'active' AND s.session_started_at IS NOT NULL
                     AND s.session_ends_at > CURRENT_TIMESTAMP
                   ORDER BY s.id DESC LIMIT 1""",
                (r["id"],),
            ).fetchone()
            agent["active_session"] = dict(live) if live else None
            # Lifetime work + payout snapshot for the manager dashboard:
            # entries made, minutes actually worked (session clock minus
            # breaks) and total break minutes, plus the ₹ amount at the
            # agent's per-entry rate.
            agent["stats"] = _agent_stats(cur, r["id"], r["per_entry_rate"])
            agents.append(agent)
        return success_response(agents, "Agents", 200)
    finally:
        conn.close()


@add_agent_bp.route("/api/warehouse/add-agents/<int:agent_id>/rate", methods=["PATCH"])
@require_warehouse_auth
def update_agent_rate(agent_id):
    """Manager revises the per-entry payout rate (₹ per product entry) any
    time. Only changes future earnings display — nothing else."""
    wh_id = request.warehouse_payload.get("warehouse_id")
    data = request.get_json(silent=True) or {}
    try:
        rate = float(data.get("per_entry_rate"))
    except (TypeError, ValueError):
        return error_response("per_entry_rate ek valid number hona chahiye", 400)
    if rate < 0:
        return error_response("Rate negative nahi ho sakta", 400)
    conn = get_db()
    try:
        cur = conn.cursor()
        row = cur.execute(
            "SELECT id FROM add_product_agents WHERE id = ? AND warehouse_id = ?", (agent_id, wh_id)
        ).fetchone()
        if not row:
            return error_response("Agent not found", 404)
        cur.execute(
            "UPDATE add_product_agents SET per_entry_rate = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (round(rate, 2), agent_id),
        )
        conn.commit()
        return success_response({"id": agent_id, "per_entry_rate": round(rate, 2)}, "Per-entry rate updated", 200)
    finally:
        conn.close()


@add_agent_bp.route("/api/warehouse/add-agents", methods=["POST"])
@require_warehouse_auth
def register_add_agent():
    """Register an agent: name + email + phone (+ optional passport photo).
    Returns the permanent unique agent code (AP-XXXXXX). The manager also
    fixes the per-entry payout rate (₹ per accepted product entry) here — it
    drives the earnings display on the agent's profile page (editable later
    via PATCH /api/warehouse/add-agents/<id>/rate)."""
    wh_id = request.warehouse_payload.get("warehouse_id")
    # FormData (with passport photo) or JSON — accept both.
    if request.is_json:
        body = request.get_json(silent=True) or {}
        name = (body.get("name") or "").strip()
        email = (body.get("email") or "").strip().lower()
        phone = (body.get("phone") or "").strip()
        photo_url = (body.get("photo_url") or "").strip() or None
    else:
        name = (request.form.get("name") or "").strip()
        email = (request.form.get("email") or "").strip().lower()
        phone = (request.form.get("phone") or "").strip()
        photo_url = None
        photo = request.files.get("photo")
        if photo:
            try:
                photo_url = _save_uploaded_asset(photo, "agent_photo")
            except ValueError as ve:
                return error_response(str(ve), 400)

    if not name or not email or not phone:
        return error_response("Name, email and phone are all required", 400)
    if not ("@" in email and "." in email):
        return error_response("Please enter a valid email", 400)
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) < 10:
        return error_response("Please enter a valid 10-digit mobile number", 400)

    # Per-entry payout rate (₹ per product entry) — manager's decision.
    try:
        per_entry_rate = float(request.form.get("per_entry_rate") if not request.is_json else body.get("per_entry_rate"))
    except (TypeError, ValueError):
        per_entry_rate = 0.0
    per_entry_rate = max(0.0, round(per_entry_rate, 2))

    conn = get_db()
    try:
        cur = conn.cursor()
        dup = cur.execute(
            "SELECT id FROM add_product_agents WHERE warehouse_id = ? AND (LOWER(email) = ? OR phone = ?)",
            (wh_id, email, phone),
        ).fetchone()
        if dup:
            return error_response("An agent is already registered with this email/phone", 409)

        # Permanent unique agent code — stamped on every product the agent creates.
        while True:
            agent_code = f"AP-{secrets.randbelow(900000) + 100000}"
            if not cur.execute("SELECT id FROM add_product_agents WHERE agent_code = ?", (agent_code,)).fetchone():
                break

        cur.execute(
            "INSERT INTO add_product_agents (warehouse_id, agent_code, name, email, phone, photo_url, per_entry_rate, status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'active')",
            (wh_id, agent_code, name, email, phone, photo_url, per_entry_rate),
        )
        agent_id = cur.lastrowid
        conn.commit()
        return success_response({
            "id": agent_id, "agent_code": agent_code, "name": name,
            "email": email, "phone": phone, "photo_url": photo_url,
            "per_entry_rate": per_entry_rate,
        }, f"Agent registered — ID: {agent_code}", 201)
    finally:
        conn.close()


@add_agent_bp.route("/api/warehouse/add-agents/<int:agent_id>", methods=["PATCH"])
@require_warehouse_auth
def toggle_add_agent(agent_id):
    wh_id = request.warehouse_payload.get("warehouse_id")
    data = request.get_json(silent=True) or {}
    status = (data.get("status") or "").strip()
    if status not in ("active", "inactive"):
        return error_response("Status 'active' ya 'inactive' hona chahiye", 400)
    conn = get_db()
    try:
        cur = conn.cursor()
        row = cur.execute(
            "SELECT id FROM add_product_agents WHERE id = ? AND warehouse_id = ?", (agent_id, wh_id)
        ).fetchone()
        if not row:
            return error_response("Agent nahi mila", 404)
        cur.execute("UPDATE add_product_agents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (status, agent_id))
        if status == "inactive":
            # Killing access also kills any live session.
            cur.execute(
                "UPDATE add_agent_otp_sessions SET status = 'revoked' WHERE agent_id = ? AND status = 'active'",
                (agent_id,),
            )
        conn.commit()
        return success_response({"id": agent_id, "status": status}, f"Agent {status}", 200)
    finally:
        conn.close()


@add_agent_bp.route("/api/warehouse/add-agents/<int:agent_id>", methods=["DELETE"])
@require_warehouse_auth
def delete_add_agent(agent_id):
    wh_id = request.warehouse_payload.get("warehouse_id")
    conn = get_db()
    try:
        cur = conn.cursor()
        row = cur.execute(
            "SELECT id FROM add_product_agents WHERE id = ? AND warehouse_id = ?", (agent_id, wh_id)
        ).fetchone()
        if not row:
            return error_response("Agent nahi mila", 404)
        cur.execute("DELETE FROM add_product_agents WHERE id = ?", (agent_id,))
        conn.commit()
        return success_response({"id": agent_id}, "Agent deleted", 200)
    finally:
        conn.close()


@add_agent_bp.route("/api/warehouse/add-agents/<int:agent_id>/otp", methods=["POST"])
@require_warehouse_auth
def generate_agent_otp(agent_id):
    """Manager picks a duration from the dropdown (60–480 min, flexible) and
    generates a 6-digit OTP. The OTP is returned ONCE so the manager can
    share it with the agent by phone/WhatsApp — there is no agent password."""
    wh_id = request.warehouse_payload.get("warehouse_id")
    data = request.get_json(silent=True) or {}
    try:
        duration = int(data.get("duration_minutes") or 0)
    except (TypeError, ValueError):
        duration = 0
    if duration < MIN_SESSION_MINUTES or duration > MAX_SESSION_MINUTES:
        return error_response(
            f"Duration {MIN_SESSION_MINUTES}–{MAX_SESSION_MINUTES} minutes ke beech chunnen (flexible dropdown)", 400
        )

    conn = get_db()
    try:
        cur = conn.cursor()
        agent = cur.execute(
            "SELECT * FROM add_product_agents WHERE id = ? AND warehouse_id = ? AND status = 'active'",
            (agent_id, wh_id),
        ).fetchone()
        if not agent:
            return error_response("Agent not found or inactive", 404)

        # One live session per agent: supersede older active OTPs/sessions.
        cur.execute(
            "UPDATE add_agent_otp_sessions SET status = 'expired' WHERE agent_id = ? AND status = 'active'",
            (agent_id,),
        )

        otp = f"{secrets.randbelow(1000000):06d}"
        salt = secrets.token_hex(16)
        cur.execute(
            """INSERT INTO add_agent_otp_sessions
               (warehouse_id, agent_id, otp_hash, duration_minutes, max_duration_minutes, status, attempts_left)
               VALUES (?, ?, ?, ?, ?, 'active', ?)""",
            (wh_id, agent_id, f"{salt}:{_hash_otp(otp, salt)}", duration, MAX_SESSION_MINUTES, OTP_ATTEMPTS),
        )
        conn.commit()
        return success_response({
            "otp": otp,
            "duration_minutes": duration,
            "agent_code": agent["agent_code"],
            "agent_name": agent["name"],
            "note": "Share the OTP with the agent securely — it will not be shown again",
        }, "OTP generated", 201)
    finally:
        conn.close()


@add_agent_bp.route("/api/warehouse/add-agent-drafts", methods=["GET"])
@require_warehouse_auth
def list_agent_drafts():
    """Agent-created drafts awaiting manager completion (agent_draft status)
    plus recently completed ones for visibility."""
    wh_id = request.warehouse_payload.get("warehouse_id")
    conn = get_db()
    try:
        # All agent-stamped products of this warehouse's agents, newest first,
        # split by status in the UI (drafts vs pending vs decided).
        rows = conn.execute(
            """SELECT p.id, p.name, p.description, p.category_id, p.category, p.images,
                      p.return_policy, p.approval_status, p.agent_submitted_at,
                      p.added_by_agent_id, p.added_by_agent_code,
                      a.name AS agent_name, a.warehouse_id AS agent_warehouse_id,
                      d.product_tags, d.search_keywords, d.search_synonyms
               FROM products p
               LEFT JOIN add_product_agents a ON a.id = p.added_by_agent_id
               LEFT JOIN product_discovery d ON d.product_id = p.id
               WHERE p.added_by_agent_id IS NOT NULL AND a.warehouse_id = ?
               ORDER BY p.id DESC LIMIT 100""",
            (wh_id,),
        ).fetchall()
        items = []
        for r in rows:
            item = dict(r)
            try:
                item["images"] = json.loads(r["images"]) if r["images"] else []
            except Exception:
                item["images"] = []
            for json_field in ("product_tags", "search_keywords", "search_synonyms"):
                try:
                    item[json_field] = json.loads(r[json_field]) if r[json_field] else []
                except Exception:
                    item[json_field] = []
            # Content (compatibility/box/warranty — incl. the case-category
            # auto-default) + fulfillment (return window) rows written at
            # completion, so the panel shows what will go live.
            content = conn.execute(
                "SELECT compatibility, box_contents, warranty_info FROM product_content WHERE product_id = ?",
                (item["id"],),
            ).fetchone()
            item["content"] = dict(content) if content else None
            ful = conn.execute(
                "SELECT return_window FROM product_fulfillment WHERE product_id = ?",
                (item["id"],),
            ).fetchone()
            item["return_window"] = ful["return_window"] if ful else None
            items.append(item)
        return success_response(items, "Agent drafts", 200)
    finally:
        conn.close()


@add_agent_bp.route("/api/warehouse/add-agent-drafts/<int:product_id>/complete", methods=["POST"])
@require_warehouse_auth
def complete_agent_draft(product_id):
    """The manager fills everything the agent was NOT allowed to touch —
    price, MRP, stock, SKU, brand, unit — and pushes the product into the
    EXISTING approval pipeline: approval_status 'pending' + inventory row.
    From here the regular admin approve/reject flow takes over unchanged."""
    wh_id = request.warehouse_payload.get("warehouse_id")
    data = request.get_json(silent=True) or {}

    price = data.get("price")
    try:
        price = float(price)
    except (TypeError, ValueError):
        price = None
    if price is None or price <= 0:
        return error_response("Price must be greater than 0 — that is the manager's job", 400)

    mrp = data.get("mrp")
    try:
        mrp = float(mrp) if mrp not in (None, "") else price
    except (TypeError, ValueError):
        mrp = price
    if mrp < price:
        mrp = price

    try:
        stock = max(0, int(float(data.get("stock") or 0)))
    except (TypeError, ValueError):
        stock = 0

    brand = (data.get("brand") or "").strip() or "None"
    name = (data.get("name") or "").strip()          # optional title fix
    description = (data.get("description") or "").strip()  # optional desc fix

    conn = get_db()
    try:
        cur = conn.cursor()
        product = cur.execute(
            "SELECT * FROM products WHERE id = ? AND added_by_agent_id IS NOT NULL",
            (product_id,),
        ).fetchone()

        # Retire quick-delivery-era ETA strings on agent drafts too: the
        # boot-time cleanse only covers rows that existed before the flag,
        # but a draft completed EARLIER could carry '30-120 mins' (legacy
        # column default) and re-introduce it on approval.
        legacy_eta = ("10-30 mins", "10-20 mins", "12-25 mins", "30-120 mins")
        if (product["delivery_time"] or "") in legacy_eta:
            cur.execute("UPDATE products SET delivery_time = '' WHERE id = ?", (product_id,))
        if not product:
            return error_response("Agent draft not found", 404)
        # Only a raw draft can be completed — once the manager has pushed it
        # into the pending/approval pipeline, re-completing would wipe the
        # admin's decision state.
        if product["approval_status"] != "agent_draft":                return error_response("This draft is already complete (now in the admin flow)", 409)

        # SKU: manager-provided (strictly unique) or auto-generated.
        final_sku = (data.get("sku") or data.get("global_sku_code") or "").strip()
        if final_sku:
            owner = cur.execute(
                "SELECT id FROM products WHERE global_sku_code = ? LIMIT 1", (final_sku,)
            ).fetchone()
            if owner and owner["id"] != product_id:
                return error_response(f"SKU '{final_sku}' already belongs to product #{owner['id']} — choose a different SKU", 409)
        if not final_sku:
            final_sku = f"AP-{secrets.randbelow(900000) + 100000}"
            while cur.execute(
                "SELECT 1 FROM products WHERE global_sku_code = ? OR id IN "
                "(SELECT product_id FROM warehouse_inventory WHERE sku = ?)",
                (final_sku, final_sku),
            ).fetchone():
                final_sku = f"AP-{secrets.randbelow(900000) + 100000}"
        collision = cur.execute(
            "SELECT id FROM warehouse_inventory WHERE warehouse_id = ? AND sku = ? AND product_id != ?",
            (wh_id, final_sku, product_id),
        ).fetchone()
        if collision:
            return error_response(f"SKU '{final_sku}' is already used in your inventory", 409)

        try:
            selling_price = float(data.get("selling_price")) if data.get("selling_price") not in (None, "") else price
        except (TypeError, ValueError):
            selling_price = price
        try:
            cost_price = float(data.get("cost_price")) if data.get("cost_price") not in (None, "") else 0.0
        except (TypeError, ValueError):
            cost_price = 0.0
        try:
            gst_pct = float(data.get("gst_pct")) if data.get("gst_pct") not in (None, "") else None
        except (TypeError, ValueError):
            gst_pct = None
        unit = (data.get("unit") or "pcs").strip() or "pcs"
        delivery_time = (data.get("delivery_time") or "").strip() or None

        # ── Extended fields (parity with warehouse_create_product) ─────────
        # Discount: client bhej ya sirf MRP/price — amt/pct dono taraf se
        # consistent recompute hote hain (same math as the inventory panel).
        try:
            mrp_eff = float(mrp)
        except (TypeError, ValueError):
            mrp_eff = price
        try:
            discount_amt = float(data.get("discount_amt")) if data.get("discount_amt") not in (None, "") else None
        except (TypeError, ValueError):
            discount_amt = None
        try:
            discount_pct = float(data.get("discount_pct")) if data.get("discount_pct") not in (None, "") else None
        except (TypeError, ValueError):
            discount_pct = None
        if discount_amt is not None and discount_amt > 0:
            discount_pct = round((discount_amt / mrp_eff) * 100, 2) if mrp_eff > 0 else 0.0
        elif discount_pct is not None and discount_pct > 0:
            discount_amt = round(mrp_eff * (discount_pct / 100), 2)
        else:
            discount_amt = 0.0
            discount_pct = 0.0
        if discount_amt >= mrp_eff and mrp_eff > 0:
            discount_amt = 0.0
            discount_pct = 0.0

        units_per_pack = str(data.get("units_per_pack") or "").strip()[:20] or None
        material_type = str(data.get("material_type") or "").strip()[:120] or None
        # Offline (POS) price: empty/invalid → NULL (POS falls back to online price).
        offline_price = None
        if data.get("offline_price") not in (None, ""):
            try:
                off_val = float(data.get("offline_price"))
                offline_price = off_val if off_val > 0 else None
            except (TypeError, ValueError):
                offline_price = None
        # Active status maps to products.status exactly like the panel toggle
        # ('available' / 'unavailable' — products has no is_active column).
        is_active = data.get("is_active")
        active_status = "available" if (is_active is None or is_active) else "unavailable"

        # Content defaults (compatibility / box / warranty) — manager can
        # override; mobile-case categories get the standard no-warranty text.
        CASE_CATS = ("case", "cover", "back cover", "skin", "pouch", "sleeve")
        cat_name = str(product["category"] or "").lower()
        is_case_like = any(k in cat_name for k in CASE_CATS)
        DEFAULT_WARRANTY_TEXT = "No warranty available in mobile cases"
        compatibility = str(data.get("compatibility") or "").strip()[:300] or None
        box_contents = str(data.get("box_contents") or "").strip()[:300] or None
        warranty_info = str(data.get("warranty_info") or "").strip()[:300] or (
            DEFAULT_WARRANTY_TEXT if is_case_like else None
        )

        # Return window: reuse the same allowed-set as the regular flow.
        from warehouse_routes import _sanitize_return_window
        try:
            return_window = _sanitize_return_window(data.get("return_window"))
        except Exception:
            return_window = 0

        # Update the product row (title/desc fixes optional) and enter the
        # standard pending-approval state EXACTLY like warehouse_create_product does.
        cur.execute(
            """UPDATE products SET
                   name = ?, description = ?, price = ?, mrp = ?, stock = ?,
                   brand = ?, delivery_time = COALESCE(?, delivery_time),
                   global_sku_code = ?,
                   units_per_pack = COALESCE(?, units_per_pack),
                   material_type = COALESCE(?, material_type),
                   offline_price = ?,
                   status = ?,
                   approval_status = 'pending', approval_source = 'warehouse',
                   approval_warehouse_id = ?, approval_requested_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (
                (name or product["name"]), (description or product["description"]),
                price, mrp, stock, brand, delivery_time, final_sku,
                units_per_pack, material_type,
                offline_price,
                active_status,
                wh_id, product_id,
            ),
        )

        # Inventory row — required so the product shows up in the manager's
        # own inventory panel and can hold stock like any other listing.
        cur.execute(
            """INSERT INTO warehouse_inventory
               (warehouse_id, product_id, product_name, sku, stock_quantity, available_stock,
                low_stock_threshold, cost_price, selling_price, mrp, discount_pct, discount_amt,
                gst_pct, brand, unit)
               VALUES (?, ?, ?, ?, ?, ?, 2, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                wh_id, product_id, (name or product["name"]), final_sku, stock, stock,
                cost_price, selling_price, mrp, discount_pct, discount_amt,
                gst_pct, brand, unit,
            ),
        )

        # Product content (compatibility / box / warranty) — same table the
        # regular create-flow writes, so the storefront tabs render unchanged.
        if compatibility or box_contents or warranty_info:
            cur.execute(
                """INSERT INTO product_content
                   (product_id, compatibility, box_contents, warranty_info)
                   VALUES (?, ?, ?, ?)""",
                (product_id, compatibility, box_contents, warranty_info),
            )

        # Fulfillment row — only return_window comes from the manager here;
        # the rest keep the same platform defaults the regular flow uses.
        cur.execute(
            """INSERT INTO product_fulfillment
               (product_id, package_weight, length, width, height, shipping_tier,
                dispatch_sla, is_cod_eligible, is_fragile, is_express_eligible, return_window)
               VALUES (?, 0, 0, 0, 0, 'standard', 24, 1, 0, 1, ?)""",
            (product_id, return_window),
        )

        # Parity with warehouse_create_product: the recommendation engine
        # fills related-product mappings the agent could never provide.
        # Non-fatal — a failure here must not block the manager.
        try:
            from utils.recommendation_engine import autofill_recommendations
            autofill_recommendations(conn, product_id)
        except Exception:
            current_app.logger.warning(
                "Recommendation auto-fill failed for completed agent draft %s", product_id, exc_info=True
            )

        conn.commit()
        return success_response({
            "product_id": product_id,
            "sku": final_sku,
            "approval_status": "pending",
            "agent_code": product["added_by_agent_code"],
        }, "Product completed — now pending admin approval", 200)
    except Exception as e:
        current_app.logger.error(f"complete_agent_draft failed: {e}", exc_info=True)
        return error_response("Completion failed — please try again", 500)
    finally:
        conn.close()

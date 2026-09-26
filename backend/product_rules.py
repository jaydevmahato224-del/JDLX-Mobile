"""
Product Return/Exchange Rules Engine
====================================
Single source of truth for what customers may ask for after delivery.

Design goals
------------
1. NO hard-coded business numbers. Every limit/window/allowance is a
   ``system_settings`` row (admin-editable) with a safe built-in default —
   the default is a *fallback*, never a hard rule, because admins can
   override every single value at runtime.
2. Per-product flexibility with clean fallback chain:
        product rule (product_return_rules)  →
        category rule (categories.return_policy JSON)  →
        global rule  (system_settings 'return_rules')
   so one product can be "no returns", another "7d return + exchange",
   another "48h exchange only", all live without a deploy.
3. Every read returns the resolved snapshot it acted on, so callers can
   persist it (complaints.return_window_end) and audit later.

Rule shape (stored as JSON in system_settings 'return_rules' or
categories.return_policy, or as a row in product_return_rules):
    {
      "return_enabled": true,        // customer may ask money back
      "exchange_enabled": true,      // customer may ask a replacement
      "window_days": 7,              // decimal days OK (0.5 = 12h); 0 = no window
      "max_requests_per_order": 1    // open complaints allowed per order
    }
Partial objects are fine: missing keys fall through to the next level and
finally to GLOBAL_DEFAULTS, so a category that only sets
``{"return_enabled": false}`` inherits everything else from global settings.
"""

import json
import datetime

from database import get_db, ist_now_str

# ---------------------------------------------------------------------------
# Built-in fallbacks — used ONLY when a settings key is absent. Every value
# here can be overridden at runtime by admins via system_settings.
# ---------------------------------------------------------------------------
GLOBAL_DEFAULTS = {
    "return_enabled": True,
    "exchange_enabled": True,
    "window_days": 7,
    "max_requests_per_order": 1,
}

# system_settings keys (all editable by admins at runtime)
SETTINGS_KEY = "return_rules"            # JSON rule object, global level
PER_ORDER_LIMIT_KEY = "return_max_requests_per_order"  # legacy flat override

_RULE_BOOL_KEYS = ("return_enabled", "exchange_enabled")
_RULE_INT_KEYS = ("window_days", "max_requests_per_order")


def _parse_rule(raw):
    """Parse a stored rule blob (JSON string or dict) into a plain dict.

    Returns {} for anything unusable (legacy text like '7 Days Return Policy',
    empty strings, None) — never raises, so a corrupt row can't break reads.
    """
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        s = raw.strip()
        if not s.startswith("{"):
            return {}  # legacy free-text policy label — not a rule object
        try:
            parsed = json.loads(s)
            return parsed if isinstance(parsed, dict) else {}
        except (ValueError, TypeError):
            return {}
    return {}


def _num(v):
    """Tolerant numeric coercion (ints, floats, numeric strings) → float | None."""
    try:
        if v is None or v == "":
            return None
        f = float(v)
        return f
    except (TypeError, ValueError):
        return None


def _bool(v):
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes", "on")
    return None


def get_effective_rules(product_id=None):
    """Resolve the effective rule object for a product.

    Chain: product_return_rules → categories.return_policy →
    system_settings 'return_rules' → GLOBAL_DEFAULTS. Missing keys at a
    deeper level inherit from the level above (partial overrides are fine).
    """
    conn = get_db()
    try:
        effective = dict(GLOBAL_DEFAULTS)

        # 1. Global settings (system_settings 'return_rules')
        row = conn.execute(
            "SELECT value FROM system_settings WHERE key = ?", (SETTINGS_KEY,)
        ).fetchone()
        g = _parse_rule(row["value"] if row else None)
        # Legacy flat override for the per-order cap
        legacy_cap = conn.execute(
            "SELECT value FROM system_settings WHERE key = ?", (PER_ORDER_LIMIT_KEY,)
        ).fetchone()
        if legacy_cap:
            n = _num(legacy_cap["value"])
            if n is not None:
                g.setdefault("max_requests_per_order", int(n))

        for k in list(GLOBAL_DEFAULTS.keys()):
            if k in g:
                effective[k] = g[k]

        category_policy_raw = None

        # 2. Category level (categories.return_policy JSON)
        if product_id is not None:
            cat_row = conn.execute(
                """SELECT c.return_policy AS return_policy
                   FROM products p LEFT JOIN categories c ON c.id = p.category_id
                   WHERE p.id = ?""",
                (product_id,),
            ).fetchone()
            if cat_row:
                category_policy_raw = cat_row["return_policy"]

        c = _parse_rule(category_policy_raw)
        for k in GLOBAL_DEFAULTS.keys():
            if k in c:
                effective[k] = c[k]

        # 3. Product level (product_return_rules — strongest)
        if product_id is not None:
            p_row = conn.execute(
                "SELECT * FROM product_return_rules WHERE product_id = ?",
                (product_id,),
            ).fetchone()
            if p_row:
                p = {k: p_row[k] for k in p_row.keys() if k != "id"}
                for k in GLOBAL_DEFAULTS.keys():
                    if p.get(k) is not None:
                        effective[k] = p[k]

        # Type-normalize
        for k in _RULE_BOOL_KEYS:
            b = _bool(effective.get(k))
            effective[k] = True if b is None else b
        for k in _RULE_INT_KEYS:
            n = _num(effective.get(k))
            effective[k] = int(n) if n is not None else GLOBAL_DEFAULTS[k]

        # window_days may be fractional (0.5 = 12h) — keep float precision but
        # present ints cleanly (7.0 → 7)
        wd = effective.get("window_days")
        if isinstance(wd, float) and wd.is_integer():
            effective["window_days"] = int(wd)

        return effective
    finally:
        conn.close()


def get_rules_snapshot(product_ids):
    """Batch-resolve rules for many products (complaint submission path).

    Returns {product_id: rules_dict}. Products with no custom rules get the
    global snapshot. One DB round-trip per level instead of per-product N+1.
    """
    ids = [int(p) for p in (product_ids or []) if p is not None]
    global_rules = get_effective_rules(None)

    if not ids:
        return {}

    conn = get_db()
    try:
        result = {}
        placeholders = ",".join("?" * len(ids))

        # category policies per product
        cat_by_product = {}
        for r in conn.execute(
            f"""SELECT p.id AS pid, c.return_policy AS rp
                FROM products p LEFT JOIN categories c ON c.id = p.category_id
                WHERE p.id IN ({placeholders})""",
            ids,
        ).fetchall():
            cat_by_product[r["pid"]] = r["rp"]

        # product overrides
        prod_by_product = {}
        for r in conn.execute(
            f"SELECT * FROM product_return_rules WHERE product_id IN ({placeholders})",
            ids,
        ).fetchall():
            d = {k: r[k] for k in r.keys() if k != "id"}
            prod_by_product[r["product_id"]] = d

        for pid in ids:
            rules = dict(global_rules)
            c = _parse_rule(cat_by_product.get(pid))
            for k in GLOBAL_DEFAULTS.keys():
                if k in c:
                    rules[k] = c[k]
            p = prod_by_product.get(pid) or {}
            for k in GLOBAL_DEFAULTS.keys():
                if p.get(k) is not None:
                    rules[k] = p[k]
            # normalize
            for k in _RULE_BOOL_KEYS:
                b = _bool(rules.get(k))
                rules[k] = True if b is None else b
            for k in _RULE_INT_KEYS:
                n = _num(rules.get(k))
                rules[k] = int(n) if n is not None else GLOBAL_DEFAULTS[k]
            wd = rules.get("window_days")
            if isinstance(wd, float) and wd.is_integer():
                rules["window_days"] = int(wd)
            result[pid] = rules
        return result
    finally:
        conn.close()


def compute_return_window_end(rules, delivered_at=None):
    """Returns the IST deadline string for a complaint filed now.

    ``delivered_at`` lets callers anchor the window to the actual delivery
    time; default is now (already validated as within-window by the caller).
    """
    window = rules.get("window_days") or 0
    if window <= 0:
        return None  # no time limit
    try:
        wd = float(window)
    except (TypeError, ValueError):
        return None
    base = delivered_at or ist_now_str()
    try:
        dt = datetime.datetime.fromisoformat(str(base))
    except (ValueError, TypeError):
        dt = datetime.datetime.now()
    end = dt + datetime.timedelta(days=wd)
    return end.strftime("%Y-%m-%d %H:%M:%S")


def check_complaint_allowed(order, product_ids, requested_action, existing_open_count):
    """Full eligibility check for a new complaint on an order.

    Args:
        order: row with status_delivered_at / created_at / order_status
        product_ids: list of product ids in the order
        requested_action: 'return' or 'exchange' (None = plain complaint)
        existing_open_count: open complaints already on this order

    Returns (allowed: bool, error: str|None, snapshot: dict)
        snapshot = {rules: resolved, return_window_end: iso|None}
    """
    rules = get_rules_snapshot(product_ids or [None]).get(
        # All products in an order share the *strictest* interpretation via
        # get_rules_snapshot; for single-product orders this is exact, and
        # multi-product orders resolve per-product in the route. When called
        # with the merged rule set this is a no-op passthrough.
        (product_ids or [None])[0],
        get_effective_rules(None),
    )
    # For multi-product orders, merge: a return is allowed only if EVERY
    # product allows it (strictest wins), window = tightest window.
    if product_ids and len(product_ids) > 1:
        per = get_rules_snapshot(product_ids)
        merged = dict(per[product_ids[0]])
        for r in per.values():
            merged["return_enabled"] = bool(merged.get("return_enabled")) and bool(r.get("return_enabled"))
            merged["exchange_enabled"] = bool(merged.get("exchange_enabled")) and bool(r.get("exchange_enabled"))
            try:
                if float(r.get("window_days") or 0) < float(merged.get("window_days") or 0):
                    merged["window_days"] = r["window_days"]
            except (TypeError, ValueError):
                pass
        rules = merged

    now = ist_now_str()

    # 1. Order must be delivered
    status = (order["order_status"] or "").upper() if order["order_status"] else ""
    if status not in ("DELIVERED", "COMPLETED"):
        return False, "Complaints/returns can only be raised after the order is delivered", {
            "rules": rules, "return_window_end": None}

    # 2. Action must be enabled by rules
    if requested_action == "return" and not rules.get("return_enabled"):
        return False, "This product's policy does not allow returns. Exchange may still be available.", {
            "rules": rules, "return_window_end": None}
    if requested_action == "exchange" and not rules.get("exchange_enabled"):
        return False, "This product's policy does not allow exchanges. Return may still be available.", {
            "rules": rules, "return_window_end": None}

    # 3. Time window
    window_end = None
    window_days = rules.get("window_days") or 0
    if window_days > 0:
        try:
            wd = float(window_days)
        except (TypeError, ValueError):
            wd = 0
        if wd > 0:
            anchor = order["status_delivered_at"] or order["created_at"]
            try:
                dt = datetime.datetime.fromisoformat(str(anchor))
            except (ValueError, TypeError):
                dt = datetime.datetime.now()
            window_end = (dt + datetime.timedelta(days=wd)).strftime("%Y-%m-%d %H:%M:%S")
            now_dt = datetime.datetime.fromisoformat(now)
            if now_dt > datetime.datetime.fromisoformat(window_end):
                return False, (
                    f"The return window for this product ({_fmt_window(wd)}) has expired. "
                    f"It ended on {window_end[:16]}."
                ), {"rules": rules, "return_window_end": window_end}

    # 4. Per-order open complaint cap
    cap = rules.get("max_requests_per_order")
    try:
        cap = int(cap)
    except (TypeError, ValueError):
        cap = 1
    if cap > 0 and existing_open_count >= cap:
        return False, (
            f"This order already has {existing_open_count} open request(s). "
            f"Policy allows at most {cap} at a time. Please wait for a resolution first."
        ), {"rules": rules, "return_window_end": window_end}

    return True, None, {"rules": rules, "return_window_end": window_end}


def _fmt_window(days):
    """Human label for a fractional-day window (0.5 → '12 hours', 7 → '7 days')."""
    try:
        d = float(days)
    except (TypeError, ValueError):
        return f"{days} days"
    if d == 0:
        return "no window"
    if d < 1:
        hours = max(1, round(d * 24))
        return f"{hours} hour{'s' if hours != 1 else ''}"
    label = f"{d:g} day{'s' if d != 1 else ''}"
    return label

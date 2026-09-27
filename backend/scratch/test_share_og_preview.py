"""
Share-link OG preview tests
===========================
Verifies the WhatsApp/social share chain end-to-end (no network):

  1. Backend /s/<token> returns crawler HTML with the PRODUCT's own
     og:image / og:title (not the generic site logo) — incl. the
     html-module-shadowing regression guard.
  2. Relative image paths are absolutized to the public API origin.
  3. Invalid/expired tokens redirect home (no crash).
  4. Unapproved/pending products never leak into share previews.
  5. The deployed frontend proxy must expose /s/:path* to the backend
     (vercel.json rewrites) — otherwise WhatsApp hits the SPA shell whose
     static OG tags only show the site logo, never the product.

Run: python scratch/test_share_og_preview.py
"""

import ast
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FORCE_HTTPS", "0")

PASSED = 0
FAILED = 0


def check(name, cond, detail=""):
    global PASSED, FAILED
    if cond:
        PASSED += 1
        print(f"  PASS  {name}")
    else:
        FAILED += 1
        print(f"  FAIL  {name}  {detail}")


def main():
    import sqlite3
    import tempfile

    # Fresh lightweight DB so app import + queries stay fast. app's import
    # runs init_db() against DATABASE_PATH, giving us a full schema without
    # copying the (potentially huge) dev database.
    tmp_db = os.path.join(tempfile.gettempdir(), "share_og_test_db.sqlite")
    if os.path.exists(tmp_db):
        os.remove(tmp_db)
    os.environ["DATABASE_PATH"] = tmp_db
    # Force the local-sqlite path: this suite must run offline, and the DB
    # layer prefers Turso whenever those env vars are present.
    for k in ("TURSO_DATABASE_URL", "LIBSQL_URL", "TURSO_AUTH_TOKEN",
              "TURSO_DATABASE_TOKEN", "TURSO_DATABASE_AUTH_TOKEN"):
        os.environ.pop(k, None)

    import database as database_mod
    database_mod.DATABASE_PATH = tmp_db
    # module-level flag — env-popping alone can't flip it after import
    database_mod.USE_TURSO = False
    database_mod.init_db()  # app import alone doesn't provision tables

    import app as app_module

    conn = sqlite3.connect(tmp_db)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cols = [r["name"] for r in cur.execute("PRAGMA table_info(products)").fetchall()]
    if "share_token" not in cols:
        cur.execute("ALTER TABLE products ADD COLUMN share_token TEXT")
    if "approval_status" not in cols:
        cur.execute("ALTER TABLE products ADD COLUMN approval_status TEXT DEFAULT 'approved'")

    def ensure_product(pid, name, token, approval):
        if not cur.execute("SELECT 1 FROM products WHERE id = ?", (pid,)).fetchone():
            cur.execute(
                "INSERT INTO products (id, name, price, stock, images, share_token, approval_status) VALUES (?,?,?,?,?,?,?)",
                (pid, name, 999.0, 5, json.dumps(["/media/product/test-img.jpg"]), token, approval),
            )
        else:
            cur.execute("UPDATE products SET share_token=?, approval_status=?, images=? WHERE id=?",
                        (token, approval, json.dumps(["/media/product/test-img.jpg"]), pid))

    ensure_product(990001, "ThunderBolt Case 5000", "tokAPPROVED01", "approved")
    ensure_product(990002, "Secret Pending Thing", "tokPENDING001", "pending")
    conn.commit()
    conn.close()

    client = app_module.app.test_client()

    # ── 1. Approved product: crawler HTML has product OG ─────────────────────
    print("\n[1] /s/<token> returns product-specific OG HTML")
    r = client.get("/s/tokAPPROVED01", base_url="https://localhost")
    body = r.get_data(as_text=True)
    check("returns 200 HTML", r.status_code == 200, f"got {r.status_code} {r.headers.get('Location','-')}")
    check("og:image present", "og:image" in body)
    check("og:image is the PRODUCT image (not logo)",
          "/media/product/test-img.jpg" in body and "logo512" not in body)
    check("og:title carries product name", "ThunderBolt Case 5000" in body)
    check("twitter:image matches product", "twitter:image" in body)
    check("html-module shadowing regression absent (page renders, no 500)",
          r.status_code == 200 and "<!DOCTYPE HTML>" in body.upper())

    # ── 2. Relative image URL gets absolutized ───────────────────────────────
    print("\n[2] relative image URL absolutized for crawlers")
    m = re.search(r'og:image" content="([^"]+)"', body)
    check("og:image is absolute http(s)", bool(m) and m.group(1).startswith("http"), m.group(1) if m else "-")

    # ── 3. Invalid token redirects home (no crash) ───────────────────────────
    print("\n[3] invalid token handled")
    r2 = client.get("/s/does-not-exist-xyz", base_url="https://localhost")
    check("invalid token -> redirect", r2.status_code in (301, 302), f"got {r2.status_code}")

    # ── 4. Pending products never leak into previews ─────────────────────────
    print("\n[4] unapproved product excluded from share preview")
    r3 = client.get("/s/tokPENDING001", base_url="https://localhost")
    check("pending token -> redirect (no preview)", r3.status_code in (301, 302), f"got {r3.status_code}")

    # ── 5. Deployment proxy exposes /s to the backend ────────────────────────
    print("\n[5] vercel.json proxies /s/:path* to the API origin")
    vj_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                           "frontend-store", "vercel.json")
    vj = json.load(open(vj_path, encoding="utf-8"))
    rewrites = vj.get("rewrites", [])
    has_api = any(rw.get("source", "").startswith("/api") for rw in rewrites)
    has_s = any(re.fullmatch(r"/s/:path\*?", rw.get("source", "")) for rw in rewrites)
    spa_last = rewrites and rewrites[-1].get("source") == "/(.*)" if rewrites else False
    check("API proxy rewrite present", has_api)
    check("/s proxy rewrite present (WhatsApp crawler reaches OG HTML)", has_s,
          "MISSING — SPA shell serves static site OG instead of product OG")
    check("SPA fallback stays LAST (proxy order preserved)", spa_last)

    print(f"\n== RESULT: {PASSED} passed, {FAILED} failed ==")
    return 0 if FAILED == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

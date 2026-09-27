"""
Delivery Login Service Block — verification tests
=================================================
The delivery partner service is temporarily unavailable. The partner-portal
"Delivery Login" button must NOT start the Google OAuth round-trip:

  1. GET /partner/login/google?flow=delivery_login  -> 302 to warehouse login
     with error=delivery_unavailable (NO Google redirect, NO session write).
  2. Same early-block on the legacy /login/google entry point.
  3. flow=warehouse_login on /partner/login/google is UNTOUCHED — it must
     still initiate the Google OAuth redirect (business logic preserved).
  4. Frontend contract: warehouse login page maps delivery_unavailable to a
     friendly banner message.

Run: python scratch/test_delivery_login_block.py
"""

import os
import sys
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

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


def make_app():
    """Minimal Flask app exposing only the partner OAuth entry routes with
    the app-level config those routes need (no full app.py import — that
    boots caches, schedulers and DB migrations we don't need here)."""
    from flask import Flask
    import warehouse_routes

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.config["OAUTH_CLIENT"] = MagicMock()
    app.config["PARTNER_OAUTH_CLIENT"] = MagicMock()
    app.register_blueprint(warehouse_bp := warehouse_routes.warehouse_bp)
    return app, warehouse_bp


def main():
    os.environ.setdefault("WAREHOUSE_FRONTEND_URL", "http://localhost:5175")

    import app as app_module

    # ── Section 1: blueprint entry point blocks delivery flow ────────────────
    print("\n[1] /partner/login/google blocks delivery_login early")
    app, _ = make_app()
    client = app.test_client()

    resp = client.get("/partner/login/google?flow=delivery_login")
    check("returns 302 redirect", resp.status_code == 302, f"got {resp.status_code}")
    loc = resp.headers.get("Location", "")
    check("redirects to warehouse login", "/warehouse/login" in loc, loc)
    check("error=delivery_unavailable in redirect", "error=delivery_unavailable" in loc, loc)
    check("NO google oauth redirect", "accounts.google.com" not in loc, loc)

    # ── Section 2: legacy app.py entry point blocks too ──────────────────────
    print("\n[2] /login/google (app.py) blocks delivery flows")
    with patch.object(app_module, "oauth", MagicMock()), \
         patch.dict(os.environ, {"WAREHOUSE_FRONTEND_URL": "http://localhost:5175"}):
        c2 = app_module.app.test_client()
        # app enforces HTTPS (301) before routing — follow redirects to the
        # actual handler response.
        resp2 = c2.get("/login/google?flow=delivery_login", follow_redirects=False,
                       base_url="https://localhost")
        check("returns 302 redirect", resp2.status_code == 302, f"got {resp2.status_code}")
        loc2 = resp2.headers.get("Location", "")
        check("error=delivery_unavailable in redirect", "delivery_unavailable" in loc2, loc2)

        # flow=delivery alias blocked as well
        resp3 = c2.get("/login/google?flow=delivery", base_url="https://localhost")
        check("flow=delivery alias blocked", "delivery_unavailable" in resp3.headers.get("Location", ""), "")

    # ── Section 3: warehouse login flow untouched ────────────────────────────
    print("\n[3] warehouse_login OAuth flow preserved (business logic intact)")
    import warehouse_routes as wr_mod
    with patch.object(wr_mod, "url_for", return_value="http://localhost:5000/partner/auth/google/callback"):
        # authorize_redirect would be called on the mock oauth client
        mock_oauth = MagicMock()
        app.config["PARTNER_OAUTH_CLIENT"] = mock_oauth
        app.config["OAUTH_CLIENT"] = mock_oauth
        resp4 = client.get("/partner/login/google?flow=warehouse_login")
        check("warehouse flow NOT blocked (no delivery_unavailable redirect)",
              "delivery_unavailable" not in resp4.headers.get("Location", ""),
              resp4.headers.get("Location", ""))
        check("google authorize_redirect initiated for warehouse flow",
              mock_oauth.google_partner.authorize_redirect.called is True)

    # ── Section 4: callback-side branch kept for relaunch compatibility ──────
    print("\n[4] callback delivery_login branch still exists (nothing removed)")
    src = open("warehouse_routes.py", encoding="utf-8").read()
    check('callback branch error=delivery_under_construction preserved',
          'delivery_under_construction' in src)
    check('callback flow == "delivery_login" branch preserved', 'flow == "delivery_login"' in src)

    # ── Section 5: frontend contract ─────────────────────────────────────────
    print("\n[5] frontend banner contract")
    fe = open("../frontend-warehouse/src/pages/warehouse/WarehouseLogin.jsx", encoding="utf-8").read()
    check("UI maps delivery_unavailable to a message", "delivery_unavailable" in fe)
    check("UI keeps delivery_under_construction compatibility", "delivery_under_construction" in fe)
    check("popup 'not available' notice present", "This service is currently not available" in fe)
    check("gate flag present for relaunch", "DELIVERY_SERVICE_AVAILABLE" in fe)
    check("original delivery OAuth call retained (relaunch-ready)", "handleGoogleLogin('delivery_login')" in fe)

    print(f"\n== RESULT: {PASSED} passed, {FAILED} failed ==")
    return 0 if FAILED == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

"""Empirical test: what makes Flask session cookie get Secure flag with Talisman?

Mirrors backend/app.py ordering: Talisman(...) first, then app.config.update(
SESSION_COOKIE_SECURE=False). If the cookie still comes out Secure, Talisman's
session_cookie_secure default (True) is the culprit.
"""
import sys

sys.path.insert(0, 'venv_linux/lib/python3.12/site-packages')

from flask import Flask, make_response, session  # noqa: E402
from flask_talisman import Talisman  # noqa: E402


def build(name, with_talisman, talisman_kwargs):
    app = Flask(name)
    app.secret_key = 'test-secret'

    if with_talisman:
        Talisman(app, **talisman_kwargs)

    # Mirror app.py: config update AFTER Talisman init
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE='Lax',
        SESSION_COOKIE_SECURE=False,
    )

    @app.route('/t')
    def t():
        session['k'] = 'v'
        resp = make_response('ok')
        resp.set_cookie('token', 'jwt-value', httponly=True, secure=False, samesite='Lax')
        return resp

    return app


def probe(app, label):
    with app.test_client() as c:
        r = c.get('/t', base_url='http://localhost:5000')
        sc = r.headers.get('Set-Cookie', '')
        print(f'--- {label} ---')
        print('Set-Cookie:', sc)
        print('secure flags present:', 'Secure' in sc)
        print()


# A) Exact mirror of app.py: default Talisman, then config False
app_a = build('a', True, {'force_https': False})
probe(app_a, 'A: Talisman default (force_https=False) + config False AFTER')

# B) Talisman with explicit session_cookie_secure=False
app_b = build('b', True, {'force_https': False, 'session_cookie_secure': False})
probe(app_b, 'B: Talisman session_cookie_secure=False + config False AFTER')

# C) No Talisman at all
app_c = build('c', False, {})
probe(app_c, 'C: No Talisman, config False')

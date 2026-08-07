"""Central JWT secret loader.

Fail-closed: no hardcoded or empty fallback. JWT_SECRET must be defined
in the environment (or backend/.env via load_dotenv in app.py).
"""
import os


def get_jwt_secret() -> str:
    secret = os.environ.get("JWT_SECRET")
    if not secret or not secret.strip():
        raise RuntimeError(
            "JWT_SECRET environment variable is not set. "
            "Add JWT_SECRET=<a long random string> to backend/.env (see .env.example)."
        )
    return secret


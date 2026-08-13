"""Central JWT secret loader.

Resolution order (first non-empty wins):
1. JWT_SECRET environment variable (explicit deploy-time configuration).
2. Persisted secret file (backend/.jwt_secret) — auto-generated once and reused
   on every process start, so storefront user sessions survive backend restarts
   even when the env var is not configured.

Never silently rotate: a fresh random secret on every restart invalidates every
user's token at once (mass auto-logout on all devices), so the final fallback
persists the generated secret to disk instead of rotating per process.
"""
import logging
import os
import secrets
from pathlib import Path

logger = logging.getLogger(__name__)

_SECRET_FILE = Path(__file__).resolve().parent / ".jwt_secret"


def get_jwt_secret() -> str:
    # 1. Explicit env var wins (most predictable, deploy-time controlled).
    secret = os.environ.get("JWT_SECRET")
    if secret and secret.strip():
        return secret

    # 2. Persisted secret file — stable across restarts.
    try:
        if _SECRET_FILE.exists():
            stored = _SECRET_FILE.read_text().strip()
            if stored:
                logger.warning(
                    "JWT_SECRET env var not set; using persisted secret file %s "
                    "(set JWT_SECRET in the environment for the most stable setup).",
                    _SECRET_FILE,
                )
                return stored
    except OSError:
        pass

    # 3. Generate once and persist so future restarts reuse it.
    generated = secrets.token_hex(32)
    try:
        _SECRET_FILE.write_text(generated)
        try:
            _SECRET_FILE.chmod(0o600)
        except OSError:
            pass
        logger.warning(
            "JWT_SECRET env var not set; generated and persisted a secret to %s "
            "so user sessions survive restarts (set JWT_SECRET in the environment "
            "for the most stable setup).",
            _SECRET_FILE,
        )
        return generated
    except OSError:
        # Cannot persist (read-only filesystem). Fail loudly rather than rotate
        # the secret on every restart, which would log out every user.
        raise RuntimeError(
            "JWT_SECRET environment variable is not set and a persistent "
            "secret file could not be written. Set JWT_SECRET=<a long random "
            "string> in the environment (or backend/.env) to keep user "
            "sessions stable across restarts."
        )

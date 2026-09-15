import logging

from flask import jsonify

_logger = logging.getLogger("jdlx.api_responses")

# Substrings that betray backend internals (DB schema, filesystem paths, stack
# frames, driver names) when an exception's raw text reaches the client.
# Only applied to 5xx responses — 4xx messages are crafted validation text.
_INTERNAL_LEAK_PATTERNS = (
    "no such column", "no such table", "no such function", "no such index",
    "unique constraint failed", "foreign key mismatch", "not null constraint failed",
    "check constraint failed", "sqlite", "operationalerror", "integrityerror",
    "programmingerror", "traceback (most recent", "[errno", "errno 2",
    "permission denied:", "/home/", "/root/", "/usr/local", "c:\\users",
    '.py", line', "libsql", "turso", "connection refused", "connection reset",
)


def _sanitize_error_message(message, code):
    """Blocks raw exception internals from reaching API clients.

    Crafted operator/customer-facing messages ("Shiprocket: Please recharge
    your wallet", "No courier available for this route", validation errors)
    pass through untouched. If a 5xx message carries internal detail — schema
    names, file paths, driver errors — it is replaced with a generic safe
    message and the full detail is logged server-side so debugging still works.
    """
    if code < 500 or not message:
        return message
    text = str(message)
    lowered = text.lower()
    if any(pattern in lowered for pattern in _INTERNAL_LEAK_PATTERNS):
        _logger.error("Sanitized internal error detail from client response: %s", text)
        return "Something went wrong on our side. Please try again in a moment."
    return text

def success_response(data=None, message="Success", code=200):
    """Returns a standardized success response."""
    return jsonify({
        "success": True,
        "data": data,
        "message": message
    }), code

def error_response(message="Operation failed", code=400, data=None):
    """Returns a standardized error response.

    Messages are sanitized for 5xx codes: anything that looks like a leaked
    exception (DB errors, paths, stack frames) is swapped for a generic,
    user-safe message; the original is logged server-side.
    """
    safe_message = _sanitize_error_message(message, code)
    return jsonify({
        "success": False,
        "data": data,
        "message": safe_message,
        "error": safe_message
    }), code


def safe_float(value, default=0.0):
    """Parses a numeric value safely — never raises on empty/garbage input.

    Admin-editable numeric settings (COD advance, fees, thresholds) can be saved
    as an empty string or other non-numeric text; a bare float() would crash the
    checkout/availability endpoints with a 500. Falls back to `default` instead.
    """
    try:
        return float(value)
    except (TypeError, ValueError):
        return default

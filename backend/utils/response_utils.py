from flask import jsonify

def success_response(data=None, message="Success", code=200):
    """Returns a standardized success response."""
    return jsonify({
        "success": True,
        "data": data,
        "message": message
    }), code

def error_response(message="Operation failed", code=400, data=None):
    """Returns a standardized error response."""
    return jsonify({
        "success": False,
        "data": data,
        "message": message,
        "error": message
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

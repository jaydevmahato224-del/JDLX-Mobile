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
        "message": message
    }), code

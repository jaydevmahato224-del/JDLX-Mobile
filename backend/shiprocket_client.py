import os
import requests
import time

SHIPROCKET_API = "https://apiv2.shiprocket.in/v1/external"

_token = None
_token_expiry = 0

def get_token():
    global _token, _token_expiry
    if _token and time.time() < _token_expiry:
        return _token
    
    email = os.environ.get("SHIPROCKET_EMAIL")
    password = os.environ.get("SHIPROCKET_PASSWORD")
    
    if not email or not password:
        print("Error: SHIPROCKET_EMAIL or SHIPROCKET_PASSWORD not set in environment.")
        return None

    try:
        res = requests.post(f"{SHIPROCKET_API}/auth/login", json={
            "email": email,
            "password": password
        })
        data = res.json()
        _token = data.get("token")
        if _token:
            _token_expiry = time.time() + 23 * 3600  # refresh before 24h
        return _token
    except Exception as e:
        print(f"Shiprocket Auth Error: {str(e)}")
        return None

def sr_headers():
    token = get_token()
    if not token:
        return {}
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

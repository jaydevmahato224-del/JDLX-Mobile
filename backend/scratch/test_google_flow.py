import os
import sys
import json

# Add backend directory to sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

import app as flask_app

client = flask_app.app.test_client()

print("--- Testing /login/google ---")
res = client.get('/login/google?flow=user&frontend_url=http://localhost:5173')
print("Status:", res.status_code)
print("Location:", res.headers.get('Location'))

print("\n--- Testing process_google_user_login directly ---")
with flask_app.app.app_context():
    user_data, token = flask_app.process_google_user_login(
        google_id="test_google_12345",
        email="testgoogleuser@example.com",
        name="Test Google User",
        picture="https://example.com/pic.jpg",
        ip_address="127.0.0.1"
    )
    print("User Data:", user_data)
    print("JWT Token generated:", token[:30] + "...")

    # Now test verify-token using cookie
    client.set_cookie('token', token)
    res_verify = client.get('/api/auth/verify-token')
    print("\n--- Testing /api/auth/verify-token with cookie ---")
    print("Verify Status:", res_verify.status_code)
    print("Verify Response:", res_verify.get_json())

    # Now test /api/user/profile with cookie
    res_profile = client.get('/api/user/profile')
    print("\n--- Testing /api/user/profile with cookie ---")
    print("Profile Status:", res_profile.status_code)
    print("Profile Response:", res_profile.get_json())

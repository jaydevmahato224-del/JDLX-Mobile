import jwt
import datetime
import requests

import os
SECRET_KEY = os.environ.get("SECRET_KEY", "jdlx_secret_keys_123")
payload = {
    "warehouse_id": 1,
    "email": "test@example.com",
    "role": "owner",
    "exp": datetime.datetime.utcnow() + datetime.timedelta(days=1)
}
token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")
headers = {"Authorization": f"Bearer {token}"}

try:
    r = requests.get("http://localhost:5000/api/warehouse/dashboard", headers=headers)
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text}")
except Exception as e:
    print(f"Error: {str(e)}")

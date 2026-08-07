import jwt
import datetime
import requests

import os
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
from jwt_config import get_jwt_secret

SECRET_KEY = get_jwt_secret()
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


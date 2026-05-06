import jwt
import datetime
import requests
import json

SECRET_KEY = 'jdlx_secret_keys_123'
BASE_URL = 'http://127.0.0.1:5000/api'

def generate_token(user_id, role='super_admin'):
    payload = {
        'id': user_id,
        'role': role,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm='HS256')

def verify_analytics():
    # User ID 5 is the super_admin we found
    token = generate_token(5)
    headers = {'Authorization': f'Bearer {token}'}
    
    try:
        response = requests.get(f'{BASE_URL}/admin/warehouse-analytics', headers=headers)
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print("API Response Structure Verified:")
            if 'store_stats' in data and len(data['store_stats']) > 0:
                store = data['store_stats'][0]
                print(f"Sample Store: {store.get('name')}")
                # Check for new fields
                fields = ['daily_sales', 'active_orders', 'assigned_riders', 'total_orders', 'total_revenue']
                for field in fields:
                    val = store.get(field)
                    print(f"  - {field}: {val} (Type: {type(val).__name__})")
                    if val is None:
                        print(f"FAILED: Field {field} is missing")
            else:
                print("No store stats found in response")
        else:
            print(f"FAILED: {response.text}")
            
    except Exception as e:
        print(f"Error connecting to server: {e}")

if __name__ == "__main__":
    verify_analytics()

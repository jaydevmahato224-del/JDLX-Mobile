import jwt
import datetime
import requests
import json
import sqlite3
import os

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
from jwt_config import get_jwt_secret

SECRET = get_jwt_secret()
WH_ID = 1
EMAIL = "jaydevmahato224@gmail.com"

def get_token():
    payload = {
        "warehouse_id": WH_ID,
        "email": EMAIL,
        "role": "owner",
        "type": "warehouse",
        "exp": datetime.datetime.utcnow() + datetime.timedelta(days=7),
    }
    return jwt.encode(payload, SECRET, algorithm="HS256")

def test_api():
    token = get_token()
    base_url = "http://localhost:5000/api/warehouse/inventory"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    print("--- Testing GET /api/warehouse/inventory ---")
    res = requests.get(base_url, headers=headers)
    print(f"Status: {res.status_code}")
    print(f"Data: {json.dumps(res.json(), indent=2)}")

    # Find a product to add
    conn = sqlite3.connect('jdlx.db')
    cursor = conn.cursor()
    cursor.execute("SELECT id, name FROM products LIMIT 5")
    products = cursor.fetchall()
    conn.close()

    if not products:
        print("No products in DB to test POST")
        return

    # Try to add the first product that isn't already in inventory
    inventory = res.json()
    existing_ids = [item['product_id'] for item in inventory if 'product_id' in item]
    
    product_to_add = None
    for p in products:
        if p[0] not in existing_ids:
            product_to_add = p
            break
    
    if product_to_add:
        print(f"\n--- Testing POST /api/warehouse/inventory (Adding {product_to_add[1]}) ---")
        payload = {
            "product_id": product_to_add[0],
            "sku": f"TEST-SKU-{product_to_add[0]}",
            "stock_quantity": 100,
            "low_stock_threshold": 10,
            "bin_location": "B-1-1",
            "unit": "box",
            "cost_price": 50.0,
            "selling_price": 99.99,
            "brand": "TestBrand",
            "status": "active"
        }
        res = requests.post(base_url, headers=headers, json=payload)
        print(f"Status: {res.status_code}")
        print(f"Response: {res.text}")

        if res.status_code == 201:
            # Test PATCH
            print("\n--- Testing PATCH /api/warehouse/inventory ---")
            # Get the new item id
            res = requests.get(base_url, headers=headers)
            new_item = res.json()[0] # Assuming DESC order
            item_id = new_item['id']
            
            res = requests.patch(f"{base_url}/{item_id}", headers=headers, json={"stock_quantity": 150, "unit": "set"})
            print(f"Status: {res.status_code}")
            print(f"Response: {res.text}")

            # Test DELETE
            print("\n--- Testing DELETE /api/warehouse/inventory ---")
            res = requests.delete(f"{base_url}/{item_id}", headers=headers)
            print(f"Status: {res.status_code}")
            print(f"Response: {res.text}")
    else:
        print("\nSkipping POST test: All sample products are already in inventory.")

if __name__ == "__main__":
    test_api()


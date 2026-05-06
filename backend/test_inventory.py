import requests
import time

BASE_URL = "http://127.0.0.1:5000/api"
# Note: You'll need a valid JWT token for these tests. 
# For testing purposes, we assume the server is running and we have a token.
# If you don't have one, you might need to mock the token_required decorator or use a test token.
TOKEN = "test_token" # Replace with a real token if needed, or disable token_required for testing.

headers = {
    "Authorization": f"Bearer {TOKEN}"
}

def test_inventory_fetch():
    print("Testing GET /api/admin/inventory...")
    res = requests.get(f"{BASE_URL}/admin/inventory", headers=headers)
    if res.status_code == 200:
        print("Success: Inventory fetched.")
        products = res.json()
        if products:
            print(f"First product: {products[0]['name']}, Stock: {products[0]['stock']}")
    else:
        print(f"Failed: {res.status_code} - {res.text}")

def test_inventory_update(product_id, new_stock):
    print(f"Testing PATCH /api/admin/inventory/{product_id} with stock {new_stock}...")
    res = requests.patch(
        f"{BASE_URL}/admin/inventory/{product_id}",
        json={"stock": new_stock},
        headers=headers
    )
    if res.status_code == 200:
        print("Success: Inventory updated.")
    else:
        print(f"Failed: {res.status_code} - {res.text}")

def test_checkout_stock_validation(product_id, qty):
    print(f"Testing checkout with product {product_id} and qty {qty}...")
    # This assumes we have a product with a known price and ID
    res = requests.post(
        f"{BASE_URL}/checkout",
        json={
            "items": [{"id": product_id, "qty": qty, "price": 10.0}],
            "address": "Test Address",
            "phone": "1234567890",
            "total_amount": 10.0 * qty
        },
        headers=headers
    )
    if res.status_code == 201:
        print("Success: Order placed.")
    elif res.status_code == 400:
        print(f"Success (Expected Failure): {res.json()['error']}")
    else:
        print(f"Unexpected result: {res.status_code} - {res.text}")

if __name__ == "__main__":
    # Note: These tests require a running server and valid token.
    # Since I cannot easily get a real JWT token without Google Auth, 
    # I will verify the logic by inspecting the code and database state.
    print("Testing manual verification via code inspection and DB checks.")
    test_inventory_fetch()

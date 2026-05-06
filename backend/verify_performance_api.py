import requests
import json

BASE_URL = "http://127.0.0.1:5000"
TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NSwicm9sZSI6InN1cGVyX2FkbWluIiwiZXhwIjoxNzc2OTE1NTgxfQ.68XiRo6RrwLs795fEiQQZ4Hydkz82J236wHDwRWkaBo"

def test_performance_api():
    # Test for store_id 1 (or whatever app_id mapped to it)
    # We'll use app_id 1 since we know it exists from the screenshots
    app_id = 1
    url = f"{BASE_URL}/api/admin/warehouse-performance/{app_id}"
    
    headers = {
        "Authorization": f"Bearer {TOKEN}"
    }
    
    try:
        print(f"Testing GET {url}...")
        response = requests.get(url, headers=headers)
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print("Response Schema Check:")
            print(f"- History length: {len(data.get('history', []))}")
            print(f"- Is Demo: {data.get('is_demo')}")
            print(f"- Stats available: {'stats' in data}")
            if 'stats' in data:
                print(f"  - Sales Avg: {data['stats']['sales']['avg']}")
                print(f"  - Orders Avg: {data['stats']['orders']['avg']}")
            
            # Save sample to file for visual check
            with open("perf_sample.json", "w") as f:
                json.dump(data, f, indent=2)
            print("Sample saved to perf_sample.json")
        else:
            print(f"Error Response: {response.text}")
            
    except Exception as e:
        print(f"Request failed: {e}")

if __name__ == "__main__":
    test_performance_api()

import urllib.request
import json

url = "http://localhost:5000/api/products"
try:
    response = urllib.request.urlopen(url)
    data = json.loads(response.read())
    
    for p in data['data']:
        if 'Realme 5' in p['name']:
            print(f"ID: {p['id']}, Name: {p['name']}, Stock: {p.get('stock')}")
except Exception as e:
    print("Error:", e)

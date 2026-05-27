import requests
import json
import logging
from datetime import datetime

class ShiprocketService:
    def __init__(self, email, password, pickup_location="Primary"):
        self.email = email
        self.password = password
        self.pickup_location = pickup_location
        self.base_url = "https://apiv2.shiprocket.in/v1/external"
        self.token = None

    def authenticate(self):
        """Get authentication token from Shiprocket."""
        url = f"{self.base_url}/auth/login"
        payload = {
            "email": self.email,
            "password": self.password
        }
        try:
            response = requests.post(url, json=payload)
            if response.status_code == 200:
                self.token = response.json().get('token')
                return True
            return False
        except Exception as e:
            logging.error(f"Shiprocket Auth Error: {str(e)}")
            return False

    def create_order(self, order_data):
        """Create a new order in Shiprocket."""
        if not self.token and not self.authenticate():
            return {"error": "Authentication failed"}

        url = f"{self.base_url}/orders/create/adhoc"
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.token}'
        }

        # Transform JDLX order to Shiprocket format
        payload = {
            "order_id": order_data['order_number'],
            "order_date": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "pickup_location": self.pickup_location,
            "billing_customer_name": order_data.get('customer_name', 'Customer'),
            "billing_last_name": "",
            "billing_address": order_data['delivery_address'],
            "billing_city": order_data.get('city', 'New Delhi'),
            "billing_pincode": order_data.get('pincode', '110001'),
            "billing_state": order_data.get('state', 'Delhi'),
            "billing_country": "India",
            "billing_email": order_data.get('customer_email', 'no-email@jdlx.com'),
            "billing_phone": order_data['customer_phone'],
            "shipping_is_billing": True,
            "order_items": [
                {
                    "name": item['name'],
                    "sku": item.get('sku', f"SKU-{item['id']}"),
                    "units": item['qty'],
                    "selling_price": item['price']
                } for item in order_data['items']
            ],
            "payment_method": "Prepaid" if str(order_data.get('payment_status', '')).upper() == 'PAID' else "COD",
            "sub_total": order_data['total_amount'],
            "length": 10,
            "breadth": 10,
            "height": 10,
            "weight": 0.5
        }

        try:
            response = requests.post(url, headers=headers, json=payload)
            return response.json()
        except Exception as e:
            logging.error(f"Shiprocket Order Creation Error: {str(e)}")
            return {"error": str(e)}

    def track_order(self, shipment_id):
        """Track order status."""
        if not self.token and not self.authenticate():
            return {"error": "Authentication failed"}

        url = f"{self.base_url}/courier/track/shipment/{shipment_id}"
        headers = {'Authorization': f'Bearer {self.token}'}
        
        try:
            response = requests.get(url, headers=headers)
            return response.json()
        except Exception as e:
            return {"error": str(e)}

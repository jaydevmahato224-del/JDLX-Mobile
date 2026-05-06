import hmac
import hashlib
import time

# Mocking Razorpay SDK behavior for initial implementation
# In a real environment: import razorpay

class PaymentService:
    def __init__(self, key_id="rzp_test_mock", key_secret="mock_secret"):
        self.key_id = key_id
        self.key_secret = key_secret
        # self.client = razorpay.Client(auth=(key_id, key_secret))

    def create_payment_order(self, amount, order_id):
        """
        Create a Razorpay order.
        Amount should be in paise (e.g., 500 for ₹5).
        """
        # Mocking the client.order.create() call
        mock_razorpay_order = {
            "id": f"order_{int(time.time())}_{order_id}",
            "entity": "order",
            "amount": int(amount * 100),
            "currency": "INR",
            "receipt": f"receipt_{order_id}",
            "status": "created"
        }
        return mock_razorpay_order

    def verify_payment_signature(self, razorpay_order_id, razorpay_payment_id, razorpay_signature):
        """
        Verify the authenticity of the payment signature.
        Formula: HMAC-SHA256(order_id + "|" + payment_id, secret)
        """
        msg = f"{razorpay_order_id}|{razorpay_payment_id}"
        generated_signature = hmac.new(
            self.key_secret.encode(),
            msg.encode(),
            hashlib.sha256
        ).hexdigest()
        
        if generated_signature == razorpay_signature:
            return True
        return False

    def handle_payment_failure(self, order_id, error_details):
        """
        Log payment failure details.
        """
        print(f"Payment failed for Order {order_id}: {error_details}")
        return True

payment_service = PaymentService()

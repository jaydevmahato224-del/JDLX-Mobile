import secrets
import string

def generate_share_token(length=10):
    """
    Generates a crypto-secure random string for product sharing.
    Uses alphanumeric characters (excluding confusing ones like l, 1, O, 0).
    """
    alphabet = string.ascii_letters + string.digits
    # Remove potentially confusing characters
    confusing = 'l1O0'
    alphabet = ''.join(c for c in alphabet if c not in confusing)
    
    return ''.join(secrets.choice(alphabet) for _ in range(length))

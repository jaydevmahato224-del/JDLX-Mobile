import os
import sys
from datetime import datetime

# Add parent directory to path to import database
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import get_db

def get_wallet_balance(user_id):
    """Returns the current wallet balance for a user."""
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT balance FROM wallet WHERE user_id = ?", (user_id,))
        row = cursor.fetchone()
        if row:
            return float(row['balance']) if hasattr(row, '__getitem__') and 'balance' in row.keys() else float(row[0])
        else:
            # Initialize wallet if it doesn't exist
            cursor.execute("INSERT INTO wallet (user_id, balance) VALUES (?, 0.0)", (user_id,))
            conn.commit()
            return 0.0
    except Exception as e:
        print(f"Error getting wallet balance: {e}")
        return 0.0
    finally:
        conn.close()

def add_wallet_credit(user_id, amount, reason, reference_id=None):
    """Credits the user's wallet and records a transaction."""
    if amount <= 0:
        return False
    
    conn = get_db()
    cursor = conn.cursor()
    try:
        # Check if wallet exists
        cursor.execute("SELECT balance FROM wallet WHERE user_id = ?", (user_id,))
        row = cursor.fetchone()
        
        if row:
            cursor.execute("UPDATE wallet SET balance = balance + ? WHERE user_id = ?", (amount, user_id))
        else:
            cursor.execute("INSERT INTO wallet (user_id, balance) VALUES (?, ?)", (user_id, amount))
        
        # Record transaction
        cursor.execute('''
            INSERT INTO wallet_transactions (user_id, amount, type, reason, reference_id)
            VALUES (?, ?, 'credit', ?, ?)
        ''', (user_id, amount, reason, reference_id))
        
        conn.commit()
        return True
    except Exception as e:
        print(f"Error adding wallet credit: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()

def deduct_wallet_balance(user_id, amount, reason, reference_id=None):
    """Deducts from the user's wallet balance if sufficient funds exist."""
    if amount <= 0:
        return False
        
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT balance FROM wallet WHERE user_id = ?", (user_id,))
        row = cursor.fetchone()
        balance = 0
        if row:
            balance = float(row['balance']) if hasattr(row, '__getitem__') and 'balance' in row.keys() else float(row[0])
        
        if balance < amount:
            return False
            
        cursor.execute("UPDATE wallet SET balance = balance - ? WHERE user_id = ?", (amount, user_id))
        
        # Record transaction
        cursor.execute('''
            INSERT INTO wallet_transactions (user_id, amount, type, reason, reference_id)
            VALUES (?, ?, 'debit', ?, ?)
        ''', (user_id, amount, reason, reference_id))
        
        conn.commit()
        return True
    except Exception as e:
        print(f"Error deducting wallet balance: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()

def get_wallet_transactions(user_id, limit=20):
    """Returns the most recent wallet transactions for a user."""
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("PRAGMA table_info(wallet_transactions)")
        columns = {row['name'] if hasattr(row, 'keys') else row[1] for row in cursor.fetchall()}
        reason_expr = "COALESCE(reason, reference)" if 'reason' in columns and 'reference' in columns else ("reason" if 'reason' in columns else "reference")
        reference_expr = "COALESCE(reference_id, reference)" if 'reference_id' in columns and 'reference' in columns else ("reference_id" if 'reference_id' in columns else "reference")

        cursor.execute(f'''
            SELECT amount, type, {reason_expr} AS reason, {reference_expr} AS reference_id, created_at
            FROM wallet_transactions
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
        ''', (user_id, limit))
        rows = cursor.fetchall()
        
        transactions = []
        for row in rows:
            if hasattr(row, 'keys'):
                transactions.append(dict(row))
            else:
                transactions.append({
                    'amount': row[0],
                    'type': row[1],
                    'reason': row[2],
                    'reference_id': row[3],
                    'created_at': row[4]
                })
        return transactions
    except Exception as e:
        print(f"Error getting wallet transactions: {e}")
        return []
    finally:
        conn.close()

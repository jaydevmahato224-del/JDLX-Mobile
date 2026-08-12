"""Functional smoke test for the referral instant-bonus flow.

Run:  cd backend && FORCE_LOCAL_DB=1 DATABASE_PATH=/tmp/jdlx_ref_test.db python3 scratch/test_referral_instant_bonus.py
"""
import os
import sys
import sqlite3

os.environ["FORCE_LOCAL_DB"] = "1"
os.environ["DATABASE_PATH"] = "/tmp/jdlx_ref_test.db"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if os.path.exists("/tmp/jdlx_ref_test.db"):
    os.remove("/tmp/jdlx_ref_test.db")

from database import init_db, get_db
from utils.wallet import get_wallet_balance, add_wallet_credit
from utils.referral import apply_referral_code, process_referral_reward, get_or_create_referral_code

PASS = 0
FAIL = 0
def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS: {name}")
    else:
        FAIL += 1
        print(f"  FAIL: {name} {extra}")

init_db()

# ---- Seed users ----
conn = get_db()
cur = conn.cursor()
cur.execute("INSERT INTO users (google_id, name, email) VALUES ('g1','Referrer','r@t.com')")
referrer_id = cur.lastrowid
cur.execute("INSERT INTO users (google_id, name, email) VALUES ('g2','Referred','d@t.com')")
referred_id = cur.lastrowid
cur.execute("INSERT INTO users (google_id, name, email) VALUES ('g3','Referred2','d2@t.com')")
referred2_id = cur.lastrowid
cur.execute("INSERT INTO users (google_id, name, email) VALUES ('g4','Referred3','d3@t.com')")
referred3_id = cur.lastrowid
conn.commit()
conn.close()

code = get_or_create_referral_code(referrer_id)
print(f"Referral code: {code}")

# ---- 1) New flow: apply → instant ₹10 both ----
print("\n== New apply flow ==")
ok, msg = apply_referral_code(referred_id, code)
check("apply succeeds", ok, msg)
check("instant bonus both credited", get_wallet_balance(referrer_id) == 10.0 and get_wallet_balance(referred_id) == 10.0,
      f"(referrer={get_wallet_balance(referrer_id)}, referred={get_wallet_balance(referred_id)})")

conn = get_db(); cur = conn.cursor()
cur.execute("SELECT instant_bonus_given, status FROM referrals WHERE referred_id = ?", (referred_id,))
row = cur.fetchone()
check("instant_bonus_given=1 + status pending", row[0] == 1 and row[1] == 'pending', f"(got {tuple(row)})")
conn.close()

# ---- 2) Double apply must NOT double credit ----
ok2, _ = apply_referral_code(referred_id, code)
check("second apply rejected", ok2 is False)
check("no double credit", get_wallet_balance(referred_id) == 10.0)

# ---- 3) First order ₹199+ → remainder paid ----
conn = get_db(); cur = conn.cursor()
cur.execute("INSERT INTO orders (user_id, total_amount) VALUES (?, 499)", (referred_id,))
order_id = cur.lastrowid
conn.commit(); conn.close()

processed = process_referral_reward(order_id, referred_id, 499)
check("order reward processed", processed)
check("referrer got +40 (total 50)", get_wallet_balance(referrer_id) == 50.0, f"(got {get_wallet_balance(referrer_id)})")
check("referred got +20 (total 30)", get_wallet_balance(referred_id) == 30.0, f"(got {get_wallet_balance(referred_id)})")

conn = get_db(); cur = conn.cursor()
cur.execute("SELECT status, qualifying_order_id FROM referrals WHERE referred_id = ?", (referred_id,))
row = cur.fetchone()
check("referral completed with qualifying order", row[0] == 'completed' and row[1] == order_id)
conn.close()

# ---- 4) Legacy pending referral (no instant) → full ₹50/₹30 ----
conn = get_db(); cur = conn.cursor()
cur.execute("INSERT INTO referrals (referrer_id, referred_id, referral_code, status, instant_bonus_given) VALUES (?, ?, ?, 'pending', 0)", (referrer_id, referred2_id, code))
legacy_ref_id = cur.lastrowid
cur.execute("INSERT INTO orders (user_id, total_amount) VALUES (?, 299)", (referred2_id,))
legacy_order_id = cur.lastrowid
conn.commit(); conn.close()

before_legacy = get_wallet_balance(referrer_id)  # 50
processed = process_referral_reward(legacy_order_id, referred2_id, 299)
check("legacy reward processed", processed)
check("legacy referrer got full ₹50 (not ₹40)", get_wallet_balance(referrer_id) == before_legacy + 50.0,
      f"(got {get_wallet_balance(referrer_id)})")
check("legacy referred got full ₹30 (not ₹20)", get_wallet_balance(referred2_id) == 30.0,
      f"(got {get_wallet_balance(referred2_id)})")

# ---- 5) Backfill: only pending & unpaid get ₹10 ----
conn = get_db(); cur = conn.cursor()
cur.execute("INSERT INTO referrals (referrer_id, referred_id, referral_code, status, instant_bonus_given) VALUES (?, ?, ?, 'pending', 0)", (referrer_id, referred3_id, code))
backfill_ref_id = cur.lastrowid
conn.commit(); conn.close()

# Import & run the backfill function directly
from migrate_referral_instant_bonus import migrate
migrate()

# referrer balance: 10 (instant) + 40 (order) + 50 (legacy order) + 10 (backfill) = 110
check("backfilled pending got ₹10 each", get_wallet_balance(referrer_id) == 110.0 and get_wallet_balance(referred3_id) == 10.0,
      f"(referrer={get_wallet_balance(referrer_id)}, referred3={get_wallet_balance(referred3_id)})")

conn = get_db(); cur = conn.cursor()
cur.execute("SELECT instant_bonus_given FROM referrals WHERE id = ?", (backfill_ref_id,))
check("backfilled row flagged", cur.fetchone()[0] == 1)
# Re-run backfill → idempotent
conn.close()
migrate()
check("backfill idempotent (no double credit)", get_wallet_balance(referred3_id) == 10.0,
      f"(got {get_wallet_balance(referred3_id)})")

print(f"\n== RESULT: {PASS} passed, {FAIL} failed ==")
sys.exit(1 if FAIL else 0)

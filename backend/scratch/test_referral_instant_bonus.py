"""Functional smoke test for the referral instant-bonus + deferred reward flow.

Run:  cd backend && FORCE_LOCAL_DB=1 DATABASE_PATH=/tmp/jdlx_ref_test.db python3 scratch/test_referral_instant_bonus.py
"""
import os
import sys
import sqlite3
from datetime import datetime, timedelta

os.environ["FORCE_LOCAL_DB"] = "1"
os.environ["DATABASE_PATH"] = "/tmp/jdlx_ref_test.db"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if os.path.exists("/tmp/jdlx_ref_test.db"):
    os.remove("/tmp/jdlx_ref_test.db")

from database import init_db, get_db
from utils.wallet import get_wallet_balance, add_wallet_credit
from utils.referral import apply_referral_code, process_referral_reward, process_due_referral_rewards, get_or_create_referral_code

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

def expire_window(referred_user_id):
    """Backdate the reward_due_at so the window is treated as passed."""
    conn = get_db(); cur = conn.cursor()
    cur.execute("UPDATE referrals SET reward_due_at = ? WHERE referred_id = ?",
                (datetime.now() - timedelta(minutes=5), referred_user_id))
    conn.commit(); conn.close()

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

# ---- 3) First order ₹199+ → ARMED on delivery, PAID only after window ----
print("\n== Deferred reward: arm on delivery, pay after window ==")
conn = get_db(); cur = conn.cursor()
cur.execute("INSERT INTO orders (user_id, total_amount, order_status) VALUES (?, 499, 'DELIVERED')", (referred_id,))
order_id = cur.lastrowid
conn.commit(); conn.close()

processed = process_referral_reward(order_id, referred_id, 499)
check("order reward armed", processed)
check("NOT paid before window passes", get_wallet_balance(referrer_id) == 10.0 and get_wallet_balance(referred_id) == 10.0,
      f"(referrer={get_wallet_balance(referrer_id)}, referred={get_wallet_balance(referred_id)})")

conn = get_db(); cur = conn.cursor()
cur.execute("SELECT status, qualifying_order_id, reward_armed, reward_paid, reward_due_at FROM referrals WHERE referred_id = ?", (referred_id,))
row = cur.fetchone()
check("armed: status pending, qual_order set, reward_armed=1, reward_paid=0",
      row[0] == 'pending' and row[1] == order_id and row[2] == 1 and row[3] == 0, f"(got {tuple(row)})")
check("reward_due_at set", bool(row[4]), f"(got {row[4]})")
conn.close()

# Window expires → sweep pays the remainder
expire_window(referred_id)
paid = process_due_referral_rewards()
check("sweep pays after window", paid >= 1, f"(paid {paid})")
check("referrer got +40 (total 50)", get_wallet_balance(referrer_id) == 50.0, f"(got {get_wallet_balance(referrer_id)})")
check("referred got +20 (total 30)", get_wallet_balance(referred_id) == 30.0, f"(got {get_wallet_balance(referred_id)})")

conn = get_db(); cur = conn.cursor()
cur.execute("SELECT status, reward_paid FROM referrals WHERE referred_id = ?", (referred_id,))
row = cur.fetchone()
check("referral completed + reward_paid=1", row[0] == 'completed' and row[1] == 1, f"(got {tuple(row)})")
conn.close()

# Re-run sweep → idempotent, no double pay
paid = process_due_referral_rewards()
check("sweep idempotent (no double pay)", paid == 0 and get_wallet_balance(referrer_id) == 50.0)

# ---- 3b) Lowercase code + earlier CANCELLED order must NOT block reward ----
print("\n== Lowercase code + cancelled earlier order ==")
conn = get_db(); cur = conn.cursor()
cur.execute("INSERT INTO users (google_id, name, email) VALUES ('g5','Referrer2','r2@t.com')")
ref2_id = cur.lastrowid
cur.execute("INSERT INTO users (google_id, name, email) VALUES ('g6','Referred4','d4@t.com')")
refd4_id = cur.lastrowid
conn.commit(); conn.close()

code2 = get_or_create_referral_code(ref2_id)
ok, msg = apply_referral_code(refd4_id, code2.lower())  # lowercase must normalize
check("lowercase code applies", ok, msg)
check("instant bonus credited for lowercase flow", get_wallet_balance(ref2_id) == 10.0 and get_wallet_balance(refd4_id) == 10.0)

conn = get_db(); cur = conn.cursor()
cur.execute("INSERT INTO orders (user_id, total_amount, order_status) VALUES (?, 50, 'CANCELLED')", (refd4_id,))
cur.execute("INSERT INTO orders (user_id, total_amount, order_status) VALUES (?, 499, 'DELIVERED')", (refd4_id,))
qual_order_id = cur.lastrowid
conn.commit(); conn.close()

processed = process_referral_reward(qual_order_id, refd4_id, 499)
check("reward armed despite earlier cancelled order", processed)
check("not paid before window", get_wallet_balance(ref2_id) == 10.0 and get_wallet_balance(refd4_id) == 10.0)

expire_window(refd4_id)
paid = process_due_referral_rewards(user_id=refd4_id)
check("sweep pays despite earlier cancelled order", paid >= 1, f"(paid {paid})")
check("referrer2 got +40 (total 50)", get_wallet_balance(ref2_id) == 50.0, f"(got {get_wallet_balance(ref2_id)})")
check("referred4 got +20 (total 30)", get_wallet_balance(refd4_id) == 30.0, f"(got {get_wallet_balance(refd4_id)})")

# ---- 4) Legacy pending referral (no instant) → full ₹50/₹30 after window ----
print("\n== Legacy pending referral (no instant) ==")
conn = get_db(); cur = conn.cursor()
cur.execute("INSERT INTO referrals (referrer_id, referred_id, referral_code, status, instant_bonus_given) VALUES (?, ?, ?, 'pending', 0)", (referrer_id, referred2_id, code))
legacy_ref_id = cur.lastrowid
cur.execute("INSERT INTO orders (user_id, total_amount, order_status) VALUES (?, 299, 'DELIVERED')", (referred2_id,))
legacy_order_id = cur.lastrowid
conn.commit(); conn.close()

before_legacy = get_wallet_balance(referrer_id)  # 50
processed = process_referral_reward(legacy_order_id, referred2_id, 299)
check("legacy reward armed", processed)

expire_window(referred2_id)
paid = process_due_referral_rewards()
check("legacy reward paid after window", paid >= 1)
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

# ---- 6) Refund-hold: pending refund blocks payout; rejection pays immediately ----
print("\n== Refund hold + settle_now ==")
conn = get_db(); cur = conn.cursor()
cur.execute("INSERT INTO users (google_id, name, email) VALUES ('g7','Referrer3','r3@t.com')")
ref3_id = cur.lastrowid
cur.execute("INSERT INTO users (google_id, name, email) VALUES ('g8','Referred5','d5@t.com')")
refd5_id = cur.lastrowid
conn.commit(); conn.close()

code3 = get_or_create_referral_code(ref3_id)
ok, msg = apply_referral_code(refd5_id, code3)
check("apply for refund-hold test", ok, msg)

conn = get_db(); cur = conn.cursor()
cur.execute("INSERT INTO orders (user_id, total_amount, order_status) VALUES (?, 499, 'DELIVERED')", (refd5_id,))
refund_order_id = cur.lastrowid
conn.commit(); conn.close()

processed = process_referral_reward(refund_order_id, refd5_id, 499)
check("armed for refund-hold test", processed)

# Pending refund request → sweep must NOT pay
# (Columns match the base refund_requests schema created by init_db.)
conn = get_db(); cur = conn.cursor()
cur.execute("UPDATE referrals SET reward_due_at = ? WHERE referred_id = ?",
            (datetime.now() - timedelta(minutes=5), refd5_id))
cur.execute("INSERT INTO refund_requests (order_id, user_id, amount, reason, status) VALUES (?, ?, 499, 'Changed my mind', 'Pending')",
            (refund_order_id, refd5_id))
conn.commit(); conn.close()

paid = process_due_referral_rewards(user_id=refd5_id)
check("sweep holds payout while refund pending", paid == 0, f"(paid {paid})")
check("no money paid while refund pending", get_wallet_balance(refd5_id) == 10.0)

# Refund REJECTED → settle_now pays immediately
processed = process_referral_reward(refund_order_id, refd5_id, 499, settle_now=True)
check("settle_now pays after refund rejected", processed)
check("referrer3 got +40 (total 50)", get_wallet_balance(ref3_id) == 50.0, f"(got {get_wallet_balance(ref3_id)})")
check("referred5 got +20 (total 30)", get_wallet_balance(refd5_id) == 30.0, f"(got {get_wallet_balance(refd5_id)})")

print(f"\n== RESULT: {PASS} passed, {FAIL} failed ==")
sys.exit(1 if FAIL else 0)

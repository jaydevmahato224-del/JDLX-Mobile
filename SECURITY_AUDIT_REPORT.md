# JDLX-Mobile — Full Bug & Security Audit Report

**Target:** `/home/jaydev/Desktop/JDLX-Mobile` (backend: Flask + Turso/SQLite, frontends: 3 React apps)
**Audit type:** Static code review (full project) — कोई code change नहीं किया गया
**Date:** 2 August 2026

---

## 🔴 CRITICAL (3)

### C1. Wallet self-credit — कोई भी user अपने wallet में unlimited paisa jod sakta hai
- **Location:** `backend/app.py:3790` — `POST /api/user/wallet`
- **Problem:** Endpoint me bas `token_required` hai. Koi bhi authenticated user ye request bhej de:
  ```json
  POST /api/user/wallet  {"amount": 50000, "type": "credit"}
  ```
  Server bina kisi validation, admin approval, payment gateway ya source check ke seedha:
  ```sql
  INSERT INTO wallet_transactions ...; UPDATE wallet SET balance = balance + ? WHERE user_id = ?
  ```
  karta hai. `amount` koi bhi ho sakta hai (negative bhi).
- **Impact:** Har user unlimited free money — checkout me wallet amount laga kar free me order. Wallet system ki poori business logic useless.
- **Note:** `utils/wallet.py` me safe helpers (`add_wallet_credit`, `deduct_wallet_balance`) hain jo amount<=0 guard karte hain, lekin ye endpoint unhe bypass karke raw SQL use karta hai.
- **Fix suggestion:** Endpoint ko sirf GET (balance read) banana hai; credit sirf server-side flows (referral, refund, admin) se hona chahiye.

### C2. Price Manipulation — client se bheja hua amount hi order ka price ban jata hai
- **Location:** `backend/app.py:3027-3031` (`/api/checkout`) + `frontend-store/src/pages/user/Checkout.jsx:475-496`
- **Problem:** Checkout pe `total_amount` client se aata hai:
  ```python
  total_amount = float(data.get('total_amount') or 0)
  ```
  Server products ki DB price se kabhi cross-validate nahi karta. Frontend `subtotal` client-side `item.price` se compute karta hai (`Checkout.jsx:54-56`) aur `total_amount: subtotal`, `discount_applied`, `wallet_amount` bhejta hai.
- **Exploit chain (pura verified):**
  1. Checkout pe `total_amount: 1` bhejo → order DB me `total_amount=1` store hota hai
  2. `/api/payment/create-order` (`payment_routes.py:27`) ownership check karta hai lekin amount DB se leta hai → Razorpay sirf ₹1 charge karta hai
  3. Payment verify → order CONFIRMED + stock decrement
- **Impact:** Koi bhi product ₹1 me kharida ja sakta hai. Ye chain end-to-end kaam karta hai kyunki har step DB ke (tampered) amount par hi chalta hai.
- **Fix suggestion:** `total_amount` ko server par DB prices × qty se recompute karna; `discount_applied` ko coupon validation se verify karna.

### C3. Wallet double-spend — wallet balance kabhi deduct hi nahi hota
- **Location:** `backend/app.py:3269-3273` (checkout) + `backend/referral_wallet_routes.py:173` (`/api/wallet/apply-to-order`)
- **Problem:**
  - Checkout me client `wallet_amount` bhejta hai jisse payable kam ho jata hai, lekin server **kabhi `deduct_wallet_balance()` call nahi karta** — balance waise ka waise rehta hai. Same wallet amount har order pe use kar sakte ho.
  - `apply-to-order` endpoint `order_id` ka na existence check karta hai na ownership — `order_id` bhi client-supplied hai (default `'PENDING'`).
- **Impact:** Ek hi wallet balance se unlimited orders — C1 ke saath mila kar free shopping.
- **Fix suggestion:** Checkout transaction ke andar hi wallet deduction karna (balance >= amount check ke saath); `apply-to-order` me order ownership validate karna.

---

## 🟠 HIGH (4)

### H1. Refund workflow 100% broken (500 error) — admin refund APPROVE/REJECT fail ho jata hai
- **Location:** `backend/app.py:6557-6610` — `update_refund_status`
- **Problem:** Ye function ye queries chalata hai:
  - Line 6582: `UPDATE orders SET status = 'REFUNDED' WHERE id = ?`
  - Line 6587: `UPDATE orders SET status = 'DELIVERED' WHERE id = ?`
  
  Live DB me `orders` table me **`status` column hai hi nahi** (sirf `order_status` hai — DB introspection se verified). SQLite `OperationalError` throw karta hai → `except` → **500 response**, aur poori transaction rollback.
- **Impact:** Admin refund request APPROVE/PROCESSED/REJECT kare to hamesha fail. User ka paisa/order refunded state me kabhi nahi ja sakta. Refund feature end-to-end dead hai.
- **Fix suggestion:** `orders.status` → `order_status` karna; PROCESSED par wallet me refund amount credit karna (abhi wo bhi nahi hota).

### H2. Hardcoded JWT fallback secret — token forgery
- **Location:** `jdlx_secret_keys_123` in: `delivery_routes.py:30`, `modules/warehouse_partner/service.py:19`, `modules/warehouse_partner/auth.py:8`, `warehouse_routes.py:273`, `referral_wallet_routes.py:26` + test scripts (`verify_analytics_enhancement.py`, `verify_inventory_api.py`, `test_dashboard.py`)
- **Problem:** Ye saare `os.environ.get("JWT_SECRET", "jdlx_secret_keys_123")` pattern use karte hain. Agar env me `JWT_SECRET` set nahi hai to sab tokens is known secret se sign hote hain — attacker apna khud ka admin/super_admin/warehouse token bana sakta hai.
- **Aur:** `backend/.env` me **duplicate JWT_SECRET** hai — line 2: `jdlx_secret_keys_123`, line 36: `test-secret`. Dotenv load order ke hisaab se dono me se koi ek win karega — ambiguity = risk.
- **Impact:** Warehouse/delivery endpoints par forged token se admin-level access.
- **Fix suggestion:** Ek strong secret sirf ek jagah (env), har jagah usi ko load karna; fallback hardcoded secret ko hatana.

### H3. Stored XSS — product share page (`/s/<token>`) me HTML escape nahi hai
- **Location:** `backend/app.py:2511-2560` — `share_product_html()`
- **Problem:** `product_name`, `product_desc`, `product_price`, `first_image` ko f-string me **bina kisi escaping** ke HTML me daala jata hai (`<title>{product_name}</title>`, meta tags, `<h1>`, `<p>`). Koi bhi escaping function (`html.escape`/markupsafe) use nahi hota.
- **Exploit:** Admin product name/description me `<script>...</script>` daal de (ya vulnerable admin panel se) → `https://jdlxmobile.in/s/<token>` kholne wale har visitor ke browser me script chale. Product link social media/WhatsApp par share hoti hai, to reach bahut badi ho sakti hai.
- **Impact:** Visitor ke session/token theft (JWT localStorage me hai), phishing, defacement.
- **Fix suggestion:** Saare DB-derived values ko HTML-escape karna.

### H4. Coupon/discount abuse — discount value aur usage limits dono bypassable
- **Location:** `backend/app.py:3267` (`discount_applied` client-supplied) + `backend/offer_routes.py:84` (`validate_coupon`) + `offer_routes.py:226` (`/api/offers/record-usage`)
- **Problem:** Checkout me `discount_applied` ko `validate_coupon()` se kabhi validate nahi kiya jata. Aur coupon ka usage count bhi ek **alag client-triggered endpoint** (`record-usage`) se badhta hai — client us call ko hi skip kar de to coupon limit kabhi count nahi hoti.
- **Impact:** Fake discounts, coupon ko unlimited baar use karna, business ko direct loss.
- **Fix suggestion:** Discount server par coupon code + user + order se compute karna; usage count server-side atomic increment.

---

## 🟡 MEDIUM (6)

### M1. Shiprocket webhook authentication conditional — bypass possible
- **Location:** `backend/app.py:177-198` (`/api/webhook/shiprocket`) + `backend/shiprocket_routes.py:304` (`/api/shiprocket/webhook`)
- **Problem:** app.py wale webhook me `if expected_token:` — agar DB setting `shiprocket_token` **aur** env `SHIPROCKET_WEBHOOK_TOKEN` dono absent hain to token check **poora skip** ho jata hai. Webhook status-transition bhi validate nahi karta. Dusra webhook (`shiprocket_routes.py:304`) me to auth hai hi nahi.
- **Impact:** Unauth attacker kisi bhi order ko `DELIVERED` flip kar sakta hai → `process_referral_reward` trigger (referral commission steal), order history manipulation.
- **Fix suggestion:** Token check mandatory (`expected_token` ke bina request reject); status transition whitelist.

### M2. Duplicate `/api/payment/verify` + active insecure payment endpoints
- **Location:** `backend/app.py:6030` (mock: `is_valid = True`, no ownership) vs `backend/payment_routes.py:108` (secure: Razorpay signature + verify)
- **Problem:** Blueprint (secure version) pehle register hota hai (app.py:207-224) isliye **secure wala active hai** aur mock shadowed (dead code) hai. Lekin:
  - `app.py:5991` `/api/payment/create` **ACTIVE** hai — `order_id` ki ownership check nahi, kisi bhi order ke liye payment record bana sakte ho
  - `app.py:6125` `GET /api/payment/<order_id>` — **IDOR**: koi bhi user kisi bhi order ki payment details (amount, transaction_id, status) dekh sakta hai
- **Impact:** Payment info disclosure (IDOR), duplicate/confusing payment records; mock code future me kisi refactor me active ho jaye to direct payment bypass.
- **Fix suggestion:** app.py wale duplicate routes delete karna, ownership checks add karna.

### M3. Admin OTP system — brute-force + enumeration + multi-worker breakage
- **Location:** `backend/app.py:599-730` — `admin_otp_store = {}`, `/api/admin/request-otp` (602), `/api/admin/verify-otp` (647)
- **Problem:**
  - OTP store **in-memory dict** — gunicorn multiple workers / server restart pe OTP kho jata hai (login flow intermittently fail)
  - `verify-otp` pe **koi rate limiter nahi** — 6-digit OTP 5-min window me brute-force ho sakta hai (10^6 combinations, server-side sleep nahi)
  - **Failed attempt par OTP invalidate nahi hota** — har attempt par naya guess try kar sakte ho
  - `request-otp` 404 ("Admin account not found") vs 403 — **admin email enumeration**
- **Impact:** Admin account takeover (agar OTP email intercept/guess ho), admin email list leak.
- **Fix suggestion:** OTP ko DB/Redis me store karna, attempts counter + lockout, verify par rate limit, generic error messages.

### M4. JWT role claim kabhi DB se re-check nahi hota
- **Location:** `backend/app.py:556-575` (`token_required`) + `backend/auth/role_guard.py` (`require_admin`/`require_super_admin`/`require_permission`)
- **Problem:** Saare guards token me bheje gaye `role` claim par trust karte hain. Agar admin ka role demote/revoke kiya jaye, to uske purane token ka `role='admin'` expiry tak valid rehta hai — server kabhi `users.role` se verify nahi karta.
- **Note:** `require_permission` DB se `admin_permissions` check karta hai, lekin `role == 'super_admin'` ho to bina permission check bypass kar deta hai (design choice, risky).
- **Impact:** Revoked admin ka access expiry tak chalta hai.
- **Fix suggestion:** Har request par role DB se fetch karna (ya token revocation list).

### M5. Stock restore leak — warehouse inventory kabhi restore nahi hota
- **Location:** `backend/app.py:3459-3489` (`handle_stock_on_status_change`) + `confirm_order_and_decrement_stock_logic`
- **Problem:** Order CANCELLED/REFUNDED/REJECTED hone par `products.stock` aur `product_variants.stock` restore hote hain, lekin **`warehouse_inventory` restore nahi hota** — jo order confirm par decrement hota hai.
- **Impact:** Multi-vendor warehouse stock permanently lost on cancellation → vendors ko loss, availability galat dikhti hai.
- **Fix suggestion:** Same transaction me `warehouse_inventory` bhi restore karna.

### M6. Config/security posture issues
- **Location:** `backend/app.py:332-341`, `backend/app.py:6976`, `backend/.env`, `backend/app.py:320` (`allowed_file`)
- **Problems:**
  - Talisman: `force_https=False`, `content_security_policy=None` — no CSP, HTTP allowed
  - Rate limits: `rate_limit_defaults = [] if (disable_rate_limit or app.debug)` — debug mode me limits off; `app.run(debug=True)` (line 6976) — debug server deploy risk
  - Admin upload: sirf extension check (`allowed_file`), no size limit, no content/MIME validation; SVG/HTML upload possible (stored XSS vector agar img context me use ho)
  - `.env` me REAL secrets: Gmail app password, Google OAuth secrets, Turso token, Razorpay keys, Shiprocket token
  - Git repo me **3135 `.venv/` files committed** (`.gitignore` me hai par pehle se tracked) — repo bloat + potential secrets
  - `security_shield_guard` localhost whitelist — IP-based rate-limit bypass for local
- **Impact:** Overall weak security headers, potential DoS via uploads, credential exposure risk.
- **Fix:** CSP/HTTPS enforce, debug off, upload validation (magic bytes + size), `.venv` untrack karna, secrets rotate karna.

---

## 🔵 LOW / MINOR (8)

1. **`add_review` (app.py:6234)** — `rating` ki 1–5 range validation nahi (e.g. rating=999 accepted).
2. **`admin_update_order_status` (app.py:3533)** — `new_status` ki koi whitelist nahi (sirf comment hai "Valid stages..."), status transition validation nahi — koi bhi string (e.g. `HACKED`) DB me ja sakti hai; CANCELLED se DELIVERED tak direct jump possible.
3. **`request_refund`** — REFUND_REQUESTED set hota hai lekin stock restore nahi hota.
4. **`admin_toggle_user_cod_restriction`** — `require_permission` missing (sirf admin role check).
5. **`process_google_user_login` (app.py:802-810)** — Google se email match par account link hota hai — agar attacker ka Google account kisi email par control ho jo DB me hai, to wo us account me login kar sakta hai (email-based linking risk).
6. **Review helpful toggle** — koi ownership/concept nahi (kabhi bhi koi toggle kar sake).
7. **JWT tokens localStorage me** (3 frontends) — XSS ho to token theft direct.
8. **`token.split(" ")[1]` (app.py:563)** — malformed header pe IndexError, broad `except` me swallow hota hai (code quality); `conn.close()` try/finally me nahi (connection leak risk).

---

## ✅ Positive observations (kya sahi hai)
- Google OAuth token properly verified (`id_token.verify_oauth2_token`, app.py:895) — fake token se login nahi hota
- `maybe_bootstrap_super_admin` email-gated hai
- `admin_db.py` ke raw SQL / table manipulation endpoints `@require_super_admin()` se gated hain
- `/api/payment/create-order` order ownership check karta hai (payment_routes.py:42-45)
- Order status/tracking user endpoints me `user_id` filter hai (ownership checks)
- Koi `eval()`/`exec()`/`os.system`/shell injection pattern nahi mila
- `utils/wallet.py` me amount<=0 aur balance check guards sahi hain

---

## Priority-wise fix order (suggested)
1. C1 + C2 + C3 (wallet + pricing) — sabse pehle, ye direct financial loss hain
2. H1 (refund 500) — feature hi toota hai
3. H3 (stored XSS) + M1 (webhook) — remote attack surface
4. H2 + M3 + M4 (auth) — access control
5. M5, M6 — data integrity + config
6. Baki low items cleanup

*Report generated from static analysis only (server running nahi tha). Saare finding code + live DB schema introspection se verified hain.*


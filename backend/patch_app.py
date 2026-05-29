import sys

def patch():
    with open('app.py', 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    # We need to find `def run_admin_anomaly_check`
    start_idx = -1
    for i, l in enumerate(lines):
        if l.startswith('def run_admin_anomaly_check(admin_id, action_type):'):
            start_idx = i
            break
            
    # And we need to find `@app.route('/api/auth/google', methods=['POST'])`
    end_idx = -1
    for i, l in enumerate(lines):
        if l.startswith("@app.route('/api/auth/google', methods=['POST'])"):
            end_idx = i
            break
            
    if start_idx == -1 or end_idx == -1:
        print(f"Could not find boundaries: start={start_idx}, end={end_idx}")
        return
        
    correct_chunk = """def run_admin_anomaly_check(admin_id, action_type):
    try:
        detect_admin_activity_anomaly(admin_id, action_type, get_client_ip())
    except Exception:
        # Security checks should not break business flow.
        pass


def ensure_default_admin_permissions(cursor, admin_id, role="admin"):
    permissions = DEFAULT_ADMIN_PERMISSIONS
    if role == "super_admin":
        permissions = AVAILABLE_ADMIN_PERMISSIONS
    elif role == "manager":
        permissions = ["manage_orders", "manage_admins", "view_analytics"]
    elif role == "inventory_admin":
        permissions = ["manage_products", "manage_inventory", "manage_restocking"]
    elif role == "delivery_admin":
        permissions = ["manage_delivery"]
    elif role == "support_admin":
        permissions = ["manage_refunds"]
        
    for permission in permissions:
        cursor.execute(
            '''
            INSERT OR IGNORE INTO admin_permissions (admin_id, permission)
            VALUES (?, ?)
            ''',
            (admin_id, permission),
        )


def upsert_admin_record(cursor, user_id, role, name, email):
    # Standardizing on the Phase 5 standalone admins table
    cursor.execute(
        '''
        INSERT INTO admins (id, name, email, role, status)
        VALUES (?, ?, ?, ?, 'active')
        ON CONFLICT(id) DO UPDATE SET role = excluded.role, name = excluded.name, email = excluded.email
        ''',
        (str(user_id), name, email, role),
    )


def remove_admin_record(cursor, user_id):
    cursor.execute("DELETE FROM admins WHERE id = ?", (str(user_id),))


def maybe_bootstrap_super_admin(cursor, user_id, email):
    if not INITIAL_SUPER_ADMIN_EMAIL or email.lower() != INITIAL_SUPER_ADMIN_EMAIL:
        return

    cursor.execute(
        "SELECT COUNT(*) as count FROM users WHERE role IN ('admin', 'super_admin')"
    )
    admin_count = cursor.fetchone()["count"]
    if admin_count == 0:
        cursor.execute("UPDATE users SET role = 'super_admin' WHERE id = ?", (user_id,))
        cursor.execute("SELECT name, email FROM users WHERE id = ?", (user_id,))
        u = cursor.fetchone()
        upsert_admin_record(cursor, user_id, 'super_admin', u['name'], u['email'])
        ensure_default_admin_permissions(cursor, user_id, role="super_admin")


# --- Authentication Middleware ---
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        if not token:
            return jsonify({'message': 'Token is missing!'}), 401
        try:
            token = token.split(" ")[1] # Bearer <token>
            data = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
            data['role'] = normalize_role(data.get('role'))
            request.user = data
        except Exception as e:
            logger.error(f"Token validation failed: {str(e)}")
            return jsonify({'message': 'Token is invalid!', 'error': str(e)}), 401
        return f(*args, **kwargs)
    return decorated


# --- Routes ---

def process_google_user_login(google_id, email, name, picture, ip_address):
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM users WHERE google_id = ?", (google_id,))
    user = cursor.fetchone()

    if not user and email:
        cursor.execute("SELECT * FROM users WHERE LOWER(email) = ?", (email.lower(),))
        user = cursor.fetchone()
        if user:
            cursor.execute(
                "UPDATE users SET google_id = ?, profile_image = COALESCE(?, profile_image), name = COALESCE(?, name) WHERE id = ?",
                (google_id, picture or None, name or None, user['id'])
            )
            conn.commit()
            cursor.execute("SELECT * FROM users WHERE id = ?", (user['id'],))
            user = cursor.fetchone()

    if not user:
        cursor.execute(
            "INSERT INTO users (google_id, name, email, profile_image) VALUES (?, ?, ?, ?)",
            (google_id, name, email, picture)
        )
        conn.commit()
        cursor.execute("SELECT * FROM users WHERE google_id = ?", (google_id,))
        user = cursor.fetchone()

        # Referral code apply (additive)
        try:
            ref_code = request.args.get('ref') or (request.json.get('referral_code') if request.is_json else None)
            if ref_code:
                from utils.referral import apply_referral_code
                apply_referral_code(user['id'], ref_code)
        except Exception:
            pass  # never break signup flow

    maybe_bootstrap_super_admin(cursor, user['id'], user['email'])
    conn.commit()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user['id'],))
    user = cursor.fetchone()
    user_dict = dict(user)
    user_role = normalize_role(user_dict.get('role'))
    admin_roles = {'admin', 'super_admin', 'manager', 'inventory_admin', 'delivery_admin', 'support_admin'}
    if user_role in admin_roles:
        ensure_default_admin_permissions(cursor, user['id'], role=user_role)
        upsert_admin_record(cursor, user['id'], user_role, user_dict.get('name'), user_dict.get('email'))
    else:
        remove_admin_record(cursor, user['id'])
    conn.commit()

    record_login_attempt(email, ip_address, "success")
    if user_role in admin_roles:
        log_admin_event(
            user_dict['id'],
            "admin_login",
            "auth",
            user_dict['id'],
            "Admin login successful",
        )
        run_admin_anomaly_check(user_dict['id'], "admin_login")

    payload = {
        'user_id': user_dict['id'],
        'email': user_dict['email'],
        'role': user_role,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(days=7)
    }
    jwt_token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")
    user_data = {
        "id": user_dict.get('id'),
        "name": user_dict.get('name'),
        "email": user_dict.get('email'),
        "profile_image": user_dict.get('profile_image'),
        "phone": user_dict.get('phone'),
        "gender": user_dict.get('gender'),
        "date_of_birth": user_dict.get('date_of_birth'),
        "email_verified": user_dict.get('email_verified'),
        "phone_verified": user_dict.get('phone_verified'),
        "role": user_role
    }
    return user_data, jwt_token

"""
    
    new_lines = lines[:start_idx] + [correct_chunk + '\n'] + lines[end_idx:]
    with open('app.py', 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print("PATCH APPLIED SUCCESSFULLY")

if __name__ == '__main__':
    patch()

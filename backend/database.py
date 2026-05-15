import sqlite3
import os

DATABASE_PATH = os.environ.get("DATABASE_PATH") or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'jdlx.db')
VALID_ROLES = ('user', 'admin', 'super_admin')

TURSO_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

class LibsqlRow:
    def __init__(self, cursor, tuple_row):
        self._tuple = tuple_row
        self._keys = [col[0] for col in cursor.description]
    def keys(self): return self._keys
    def __getitem__(self, key):
        if isinstance(key, int): return self._tuple[key]
        try: return self._tuple[self._keys.index(key)]
        except ValueError: raise KeyError(key)
    def __len__(self): return len(self._tuple)
    def __iter__(self):
        return iter(zip(self._keys, self._tuple))

class LibsqlCursorWrapper:
    def __init__(self, cursor, row_factory=None):
        self._cursor = cursor
        self.row_factory = row_factory
    def _wrap_row(self, row):
        if row is None: return None
        return self.row_factory(self._cursor, row) if self.row_factory else row
    def fetchone(self): return self._wrap_row(self._cursor.fetchone())
    def fetchall(self):
        rows = self._cursor.fetchall()
        return [self.row_factory(self._cursor, row) for row in rows] if self.row_factory else rows
    def execute(self, sql, parameters=()):
        if isinstance(parameters, list): parameters = tuple(parameters)
        self._cursor.execute(sql, parameters)
        return self
    def executemany(self, sql, seq_of_parameters):
        seq_of_parameters = [tuple(p) if isinstance(p, list) else p for p in seq_of_parameters]
        self._cursor.executemany(sql, seq_of_parameters)
        return self
    def __getattr__(self, name): return getattr(self._cursor, name)
    def __iter__(self):
        for row in self._cursor: yield self._wrap_row(row)

class LibsqlConnectionWrapper:
    def __init__(self, conn):
        self._conn = conn
        self.row_factory = None
    def cursor(self): return LibsqlCursorWrapper(self._conn.cursor(), self.row_factory)
    def execute(self, sql, parameters=()):
        cursor = self.cursor()
        cursor.execute(sql, parameters)
        return cursor
    def commit(self): self._conn.commit()
    def rollback(self): self._conn.rollback()
    def close(self): self._conn.close()
    def sync(self):
        if hasattr(self._conn, 'sync'): self._conn.sync()

if TURSO_URL and TURSO_TOKEN:
    try:
        import libsql_experimental as libsql
        USE_TURSO = True
    except ImportError:
        USE_TURSO = False
else:
    USE_TURSO = False

def get_db():
    if USE_TURSO:
        raw_conn = libsql.connect(TURSO_URL, auth_token=TURSO_TOKEN)
        conn = LibsqlConnectionWrapper(raw_conn)
        conn.row_factory = LibsqlRow
    else:
        conn = sqlite3.connect(DATABASE_PATH)
        conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()

    def safe_execute_ddl(sql: str) -> None:
        try: cursor.execute(sql)
        except Exception as e:
            if "duplicate column name" not in str(e).lower() and "already exists" not in str(e).lower():
                print(f"Ignored DDL error: {e}")

    def ensure_columns(table_name, columns):
        cursor.execute(f"PRAGMA table_info({table_name})")
        existing_cols = [row[1] for row in cursor.fetchall()]
        for col, definition in columns:
            if col not in existing_cols:
                safe_execute_ddl(f"ALTER TABLE {table_name} ADD COLUMN {col} {definition}")

    if not USE_TURSO:
        try: cursor.execute('PRAGMA journal_mode=WAL;')
        except Exception: pass

    # --- Core Tables ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, google_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, profile_image TEXT, role TEXT NOT NULL DEFAULT 'user', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    ensure_columns('users', [('phone', 'TEXT'), ('gender', 'TEXT'), ('date_of_birth', 'TEXT'), ('about', 'TEXT'), ('terms_accepted_version', 'INTEGER DEFAULT 0'), ('terms_accepted_at', 'TIMESTAMP'), ('email_verified', 'INTEGER DEFAULT 0'), ('phone_verified', 'INTEGER DEFAULT 0'), ('account_status', "TEXT DEFAULT 'active'"), ('cod_restricted', 'INTEGER DEFAULT 0')])

    cursor.execute('''CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, icon TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    ensure_columns('categories', [('important_note', 'TEXT'), ('return_policy', "TEXT DEFAULT '7 Days Return Policy'"), ('device_customization_enabled', 'INTEGER DEFAULT 0')])

    cursor.execute('''CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL NOT NULL, stock INTEGER NOT NULL DEFAULT 0, category_id INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(category_id) REFERENCES categories(id))''')
    ensure_columns('products', [('barcode', 'TEXT'), ('global_sku_code', 'TEXT'), ('description', 'TEXT'), ('sub_category', 'TEXT'), ('brand', 'TEXT'), ('units_per_pack', 'TEXT'), ('material_type', 'TEXT'), ('weight', 'TEXT'), ('dimensions', 'TEXT'), ('is_fragile', 'BOOLEAN DEFAULT 0'), ('is_temp_sensitive', 'BOOLEAN DEFAULT 0'), ('is_perishable', 'BOOLEAN DEFAULT 0'), ('is_featured', 'BOOLEAN DEFAULT 0'), ('expiry_date', 'TEXT'), ('return_policy', 'TEXT'), ('prepaid_only', 'INTEGER DEFAULT 0'), ('low_stock_threshold', 'INTEGER DEFAULT 5'), ('delivery_time', "TEXT DEFAULT '12-25 mins'"), ('status', "TEXT DEFAULT 'available'"), ('images', 'TEXT')])
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)")

    # Legacy Stock Sync
    cursor.execute("PRAGMA table_info(products)")
    if 'stock_quantity' in [r[1] for r in cursor.fetchall()]:
        cursor.execute("UPDATE products SET stock = CASE WHEN (stock IS NULL OR stock = 0) AND stock_quantity > 0 THEN stock_quantity ELSE stock END")

    # --- Commerce & Fulfillment ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, total_amount REAL NOT NULL, order_status TEXT DEFAULT 'PLACED', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))''')
    ensure_columns('orders', [
        ('delivery_address', 'TEXT'), 
        ('phone', 'TEXT'), 
        ('platform_fee', 'REAL DEFAULT 0'), 
        ('delivery_fee', 'REAL DEFAULT 0'), 
        ('shiprocket_order_id', 'TEXT'), 
        ('payment_type', "TEXT DEFAULT 'PREPAID'"), 
        ('cod_advance_paid', 'REAL DEFAULT 0'), 
        ('cod_remaining_amount', 'REAL DEFAULT 0'), 
        ('free_delivery_applied', 'INTEGER DEFAULT 0'), 
        ('fitting_charge', 'REAL DEFAULT 0'), 
        ('packed_at', 'TIMESTAMP'), 
        ('shipped_at', 'TIMESTAMP'), 
        ('delivered_at', 'TIMESTAMP'), 
        ('estimated_delivery', "TEXT DEFAULT '15-25 mins'"), 
        ('delivery_partner_id', 'INTEGER'), 
        ('store_id', 'INTEGER')
    ])

    cursor.execute('''CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL, price REAL NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(order_id) REFERENCES orders(id), FOREIGN KEY(product_id) REFERENCES products(id))''')
    ensure_columns('order_items', [('device_model', 'TEXT')])

    cursor.execute('''CREATE TABLE IF NOT EXISTS cart (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, session_id TEXT, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(product_id) REFERENCES products(id))''')

    # --- Logistics & Stores ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS dark_stores (id INTEGER PRIMARY KEY AUTOINCREMENT, store_code TEXT UNIQUE, name TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    ensure_columns('dark_stores', [('latitude', 'REAL'), ('longitude', 'REAL'), ('address', 'TEXT'), ('pincode', 'TEXT'), ('active', 'BOOLEAN DEFAULT 1'), ('manager_name', 'TEXT'), ('phone', 'TEXT')])

    cursor.execute('''CREATE TABLE IF NOT EXISTS warehouses (id INTEGER PRIMARY KEY AUTOINCREMENT, warehouse_name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    ensure_columns('warehouses', [('partner_id', 'TEXT'), ('application_id', 'INTEGER'), ('owner_name', 'TEXT'), ('phone', 'TEXT'), ('address', 'TEXT'), ('pincode', 'TEXT'), ('warehouse_capacity', 'INTEGER'), ('warehouse_type', "TEXT DEFAULT 'micro_fulfillment'"), ('warehouse_role', "TEXT DEFAULT 'owner'"), ('operations_status', "TEXT DEFAULT 'open'"), ('weather_status', "TEXT DEFAULT 'clear'"), ('account_status', "TEXT DEFAULT 'active'"), ('profile_kyc_status', "TEXT DEFAULT 'verified'"), ('kyc_notice_sent', 'INTEGER DEFAULT 0'), ('kyc_notice_sent_at', 'TIMESTAMP'), ('service_radius_km', 'REAL DEFAULT 4'), ('quick_mode_enabled', 'INTEGER DEFAULT 0')])

    cursor.execute('''CREATE TABLE IF NOT EXISTS warehouse_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warehouse_partner_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        product_name TEXT,
        sku TEXT,
        stock_quantity INTEGER DEFAULT 0,
        reserved_stock INTEGER DEFAULT 0,
        low_stock_threshold INTEGER DEFAULT 10,
        bin_location TEXT,
        brand TEXT,
        unit TEXT DEFAULT 'pcs',
        cost_price REAL DEFAULT 0,
        selling_price REAL DEFAULT 0,
        mrp REAL DEFAULT 0,
        discount_pct REAL DEFAULT 0,
        discount_amt REAL DEFAULT 0,
        gst_pct REAL DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(warehouse_partner_id) REFERENCES warehouses(id),
        FOREIGN KEY(product_id) REFERENCES products(id)
    )''')
    ensure_columns('warehouse_inventory', [
        ('warehouse_id', 'INTEGER'),
        ('available_stock', 'INTEGER DEFAULT 0')
    ])
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_wh_inv_wh ON warehouse_inventory(warehouse_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_wh_inv_prod ON warehouse_inventory(product_id)")

    cursor.execute('''CREATE TABLE IF NOT EXISTS warehouse_order_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        warehouse_id INTEGER NOT NULL,
        assignment_status TEXT DEFAULT 'assigned',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(order_id) REFERENCES orders(id),
        FOREIGN KEY(warehouse_id) REFERENCES warehouses(id)
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS user_addresses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        flat_no TEXT,
        area TEXT,
        landmark TEXT,
        pincode TEXT NOT NULL,
        city TEXT NOT NULL,
        state TEXT NOT NULL,
        type TEXT DEFAULT 'HOME',
        is_default INTEGER DEFAULT 0,
        latitude REAL,
        longitude REAL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS saved_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        method_type TEXT NOT NULL,
        last4 TEXT,
        provider_data TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        payment_status TEXT DEFAULT 'pending',
        amount REAL NOT NULL,
        payment_method TEXT,
        transaction_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(order_id) REFERENCES orders(id)
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS refund_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        reason TEXT,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(order_id) REFERENCES orders(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS review_helpful_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        review_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(review_id, user_id),
        FOREIGN KEY(review_id) REFERENCES product_reviews(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS store_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        stock_quantity INTEGER DEFAULT 0,
        FOREIGN KEY(store_id) REFERENCES dark_stores(id),
        FOREIGN KEY(product_id) REFERENCES products(id)
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS device_models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand TEXT NOT NULL,
        model_name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS mail_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_email TEXT NOT NULL,
        subject TEXT,
        body TEXT,
        status TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS restock_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(product_id) REFERENCES products(id)
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS system_recovery_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        details TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS delivery_partners (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    ensure_columns('delivery_partners', [('partner_id', 'TEXT'), ('application_id', 'INTEGER'), ('phone', 'TEXT'), ('status', "TEXT DEFAULT 'OFFLINE'"), ('latitude', 'REAL DEFAULT 0'), ('longitude', 'REAL DEFAULT 0'), ('active_order_id', 'INTEGER')])

    # --- Wallet & Loyalty ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS wallet (user_id INTEGER PRIMARY KEY, balance REAL DEFAULT 0, FOREIGN KEY(user_id) REFERENCES users(id))''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS wallet_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount REAL NOT NULL, type TEXT NOT NULL, reference TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))''')

    # --- Admin & Support ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL UNIQUE, role TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS admin_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER NOT NULL, permission TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(admin_id) REFERENCES users(id))''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER NOT NULL, action TEXT NOT NULL, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(admin_id) REFERENCES users(id))''')
    ensure_columns('activity_logs', [('entity_type', 'TEXT'), ('entity_id', 'INTEGER')])
    
    cursor.execute('''CREATE TABLE IF NOT EXISTS admin_audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER NOT NULL, action_type TEXT NOT NULL, target_entity TEXT NOT NULL, target_id INTEGER, description TEXT, ip_address TEXT, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(admin_id) REFERENCES users(id))''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS support_tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL, status TEXT DEFAULT 'OPEN', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))''')
    ensure_columns('support_tickets', [
        ('admin_reply', 'TEXT'),
        ('ticket_number', 'TEXT'),
        ('updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP')
    ])

    cursor.execute('''CREATE TABLE IF NOT EXISTS ticket_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        sender TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(ticket_id) REFERENCES support_tickets(id)
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS complaints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        order_id INTEGER NOT NULL,
        issue_type TEXT NOT NULL,
        description TEXT NOT NULL,
        photo_path TEXT,
        status TEXT DEFAULT 'Pending',
        admin_reply TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(order_id) REFERENCES orders(id)
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS order_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        order_id INTEGER NOT NULL,
        report_type TEXT NOT NULL,
        description TEXT NOT NULL,
        photo_path TEXT,
        status TEXT DEFAULT 'Submitted',
        resolution TEXT,
        admin_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(order_id) REFERENCES orders(id)
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS refund_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        order_id INTEGER NOT NULL,
        reason TEXT NOT NULL,
        request_type TEXT NOT NULL,
        description TEXT NOT NULL,
        photo_path TEXT,
        status TEXT DEFAULT 'Pending',
        refund_amount REAL,
        admin_notes TEXT,
        resolution TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(order_id) REFERENCES orders(id)
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS bug_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        page_location TEXT NOT NULL,
        severity TEXT NOT NULL,
        description TEXT NOT NULL,
        steps_to_reproduce TEXT,
        screenshot_path TEXT,
        browser TEXT,
        os TEXT,
        screen_resolution TEXT,
        page_url TEXT,
        user_agent TEXT,
        status TEXT DEFAULT 'New',
        developer_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )''')

    # --- Security ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, ip_address TEXT, status TEXT NOT NULL, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS security_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, alert_type TEXT NOT NULL, message TEXT NOT NULL, severity TEXT DEFAULT 'medium', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')

    # --- Settings & Marketing ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS system_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE NOT NULL, value TEXT NOT NULL)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS banners (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    ensure_columns('banners', [('subtitle', 'TEXT'), ('cta_text', 'TEXT'), ('image_url', 'TEXT'), ('badge_text', 'TEXT'), ('gradient', 'TEXT'), ('link_url', 'TEXT'), ('is_active', 'INTEGER DEFAULT 1'), ('overlay_opacity', 'REAL DEFAULT 0.5')])

    # --- User Interactions ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS user_interactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, session_id TEXT, interaction_type TEXT NOT NULL, target_id TEXT, category TEXT, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS wishlist (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, product_id INTEGER NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, product_id), FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(product_id) REFERENCES products(id))''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS product_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, user_id INTEGER NOT NULL, rating INTEGER NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(product_id, user_id), FOREIGN KEY(product_id) REFERENCES products(id), FOREIGN KEY(user_id) REFERENCES users(id))''')
    ensure_columns('product_reviews', [('review_text', 'TEXT'), ('review_images', 'TEXT'), ('is_verified', 'INTEGER DEFAULT 0'), ('helpful_count', 'INTEGER DEFAULT 0'), ('store_id', 'INTEGER')])

    cursor.execute('''CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT DEFAULT 'INFO',
        is_read INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS user_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )''')

    # --- Onboarding Applications ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS warehouse_applications (id INTEGER PRIMARY KEY AUTOINCREMENT, warehouse_name TEXT NOT NULL, owner_name TEXT NOT NULL, email TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    ensure_columns('warehouse_applications', [('partner_id', 'TEXT'), ('phone', 'TEXT'), ('address', 'TEXT'), ('pincode', 'TEXT'), ('verification_status', 'TEXT'), ('warehouse_photos', 'TEXT'), ('document_upload', 'TEXT'), ('owner_image', 'TEXT'), ('kyc_details', 'TEXT'), ('request_mail_message', 'TEXT'), ('approved_by_id', 'INTEGER'), ('approved_by_name', 'TEXT')])

    cursor.execute('''CREATE TABLE IF NOT EXISTS delivery_applications (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    ensure_columns('delivery_applications', [('partner_id', 'TEXT'), ('warehouse_id', 'INTEGER'), ('phone', 'TEXT'), ('verification_status', 'TEXT'), ('pan_card_image', 'TEXT'), ('aadhaar_front_image', 'TEXT'), ('aadhaar_back_image', 'TEXT'), ('face_verification_image', 'TEXT'), ('face_verification_status', 'TEXT'), ('aadhaar_extracted_address', 'TEXT'), ('aadhaar_qr_payload', 'TEXT')])

    # --- Seeding & Defaults ---
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('platform_fee', '7')")
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('free_delivery_threshold', '499')")
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('cod_enabled', 'true')")
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('ticker_text', 'Free delivery on orders above ₹499')")

    conn.commit()
    conn.close()
    print("Database initialized successfully.")

if __name__ == "__main__":
    init_db()

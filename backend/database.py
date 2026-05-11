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
    cursor.execute('''CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, total_amount REAL NOT NULL, status TEXT DEFAULT 'PLACED', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))''')
    ensure_columns('orders', [('delivery_address', 'TEXT'), ('phone', 'TEXT'), ('platform_fee', 'REAL DEFAULT 0'), ('delivery_fee', 'REAL DEFAULT 0'), ('shiprocket_order_id', 'TEXT'), ('payment_type', "TEXT DEFAULT 'PREPAID'"), ('cod_advance_paid', 'REAL DEFAULT 0'), ('cod_remaining_amount', 'REAL DEFAULT 0'), ('free_delivery_applied', 'INTEGER DEFAULT 0'), ('fitting_charge', 'REAL DEFAULT 0'), ('status_packing_at', 'TIMESTAMP'), ('status_out_at', 'TIMESTAMP'), ('status_delivered_at', 'TIMESTAMP'), ('estimated_delivery', "TEXT DEFAULT '15-25 mins'"), ('delivery_partner_id', 'INTEGER'), ('store_id', 'INTEGER')])

    cursor.execute('''CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL, price REAL NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(order_id) REFERENCES orders(id), FOREIGN KEY(product_id) REFERENCES products(id))''')
    ensure_columns('order_items', [('device_model', 'TEXT')])

    cursor.execute('''CREATE TABLE IF NOT EXISTS cart (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, session_id TEXT, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(product_id) REFERENCES products(id))''')

    # --- Logistics & Stores ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS dark_stores (id INTEGER PRIMARY KEY AUTOINCREMENT, store_code TEXT UNIQUE, name TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    ensure_columns('dark_stores', [('latitude', 'REAL'), ('longitude', 'REAL'), ('address', 'TEXT'), ('pincode', 'TEXT'), ('active', 'BOOLEAN DEFAULT 1'), ('manager_name', 'TEXT'), ('phone', 'TEXT')])

    cursor.execute('''CREATE TABLE IF NOT EXISTS warehouses (id INTEGER PRIMARY KEY AUTOINCREMENT, warehouse_name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    ensure_columns('warehouses', [('partner_id', 'TEXT'), ('application_id', 'INTEGER'), ('owner_name', 'TEXT'), ('phone', 'TEXT'), ('address', 'TEXT'), ('pincode', 'TEXT'), ('warehouse_capacity', 'INTEGER'), ('warehouse_type', "TEXT DEFAULT 'micro_fulfillment'"), ('warehouse_role', "TEXT DEFAULT 'owner'"), ('operations_status', "TEXT DEFAULT 'open'"), ('weather_status', "TEXT DEFAULT 'clear'"), ('account_status', "TEXT DEFAULT 'active'"), ('profile_kyc_status', "TEXT DEFAULT 'verified'"), ('kyc_notice_sent', 'INTEGER DEFAULT 0'), ('kyc_notice_sent_at', 'TIMESTAMP'), ('service_radius_km', 'REAL DEFAULT 4')])

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

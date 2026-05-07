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

    def keys(self):
        return self._keys

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._tuple[key]
        try:
            return self._tuple[self._keys.index(key)]
        except ValueError:
            raise KeyError(key)

    def __len__(self):
        return len(self._tuple)

    def __iter__(self):
        return iter(self._tuple)

class LibsqlCursorWrapper:
    def __init__(self, cursor, row_factory=None):
        self._cursor = cursor
        self.row_factory = row_factory

    def _wrap_row(self, row):
        if row is None:
            return None
        if self.row_factory:
            return self.row_factory(self._cursor, row)
        return row

    def fetchone(self):
        return self._wrap_row(self._cursor.fetchone())

    def fetchall(self):
        rows = self._cursor.fetchall()
        if self.row_factory:
            return [self.row_factory(self._cursor, row) for row in rows]
        return rows

    def execute(self, sql, parameters=()):
        self._cursor.execute(sql, parameters)
        return self

    def executemany(self, sql, seq_of_parameters):
        self._cursor.executemany(sql, seq_of_parameters)
        return self

    def __getattr__(self, name):
        return getattr(self._cursor, name)

    def __iter__(self):
        for row in self._cursor:
            yield self._wrap_row(row)

class LibsqlConnectionWrapper:
    def __init__(self, conn):
        self._conn = conn
        self.row_factory = None

    def cursor(self):
        return LibsqlCursorWrapper(self._conn.cursor(), self.row_factory)

    def execute(self, sql, parameters=()):
        cursor = self.cursor()
        cursor.execute(sql, parameters)
        return cursor

    def commit(self):
        self._conn.commit()
        
    def rollback(self):
        self._conn.rollback()
        
    def close(self):
        self._conn.close()
        
    def sync(self):
        if hasattr(self._conn, 'sync'):
            self._conn.sync()

if TURSO_URL and TURSO_TOKEN:
    try:
        import libsql_experimental as libsql
        USE_TURSO = True
    except ImportError:
        print("WARNING: libsql-experimental not installed. Falling back to local sqlite3.")
        USE_TURSO = False
else:
    USE_TURSO = False

def get_db():
    if USE_TURSO:
        # Use embedded replica for maximum performance and compatibility
        replica_path = os.path.join(os.path.dirname(DATABASE_PATH), 'turso_replica.db')
        raw_conn = libsql.connect(replica_path, sync_url=TURSO_URL, auth_token=TURSO_TOKEN)
        try:
            raw_conn.sync()
        except Exception as e:
            print(f"WARNING: Turso sync failed: {e}")
            
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
        try:
            cursor.execute(sql)
        except sqlite3.OperationalError as e:
            msg = str(e).lower()
            if "duplicate column name" in msg or "already exists" in msg:
                return
            raise
    
    # Enable Write-Ahead Logging for better concurrency
    cursor.execute('PRAGMA journal_mode=WAL;')

    # Users Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            google_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            profile_image TEXT,
            phone TEXT,
            gender TEXT,
            date_of_birth TEXT,
            about TEXT,
            terms_accepted_version INTEGER DEFAULT 0,
            terms_accepted_at TIMESTAMP,
            email_verified INTEGER DEFAULT 0,
            phone_verified INTEGER DEFAULT 0,
            role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin', 'super_admin')),
            account_status TEXT DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    # ensure columns added for existing databases
    cursor.execute("PRAGMA table_info(users)")
    existing_cols = [row[1] for row in cursor.fetchall()]
    extra_cols = [
        ('phone', 'TEXT'),
        ('gender', 'TEXT'),
        ('date_of_birth', 'TEXT'),
        ('about', 'TEXT'),
        ('terms_accepted_version', 'INTEGER DEFAULT 0'),
        ('terms_accepted_at', 'TIMESTAMP'),
        ('email_verified', 'INTEGER DEFAULT 0'),
        ('phone_verified', 'INTEGER DEFAULT 0'),
        ('account_status', "TEXT DEFAULT 'active'")
    ]
    for col, definition in extra_cols:
        if col not in existing_cols:
            safe_execute_ddl(f"ALTER TABLE users ADD COLUMN {col} {definition}")


    # Backfill role for older DBs created before RBAC migration.
    cursor.execute("PRAGMA table_info(users)")
    user_columns = [row[1] for row in cursor.fetchall()]
    if 'role' not in user_columns:
        cursor.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
        cursor.execute("UPDATE users SET role = 'user' WHERE role IS NULL OR TRIM(role) = ''")
    
    # Products Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL,
            stock INTEGER NOT NULL DEFAULT 0,
            low_stock_threshold INTEGER DEFAULT 5,
            barcode TEXT UNIQUE,
            global_sku_code TEXT,
            category TEXT,
            category_id INTEGER,
            delivery_time TEXT DEFAULT '12-25 mins',
            status TEXT DEFAULT 'available',
            images TEXT,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            return_policy TEXT,
            FOREIGN KEY(category_id) REFERENCES categories(id)
        )
    ''')
    
    # Migration: Ensure legacy product stock_quantity is synced into stock and removed where possible
    cursor.execute("PRAGMA table_info(products)")
    product_columns = [row[1] for row in cursor.fetchall()]
    if 'stock_quantity' in product_columns:
        cursor.execute(
            "UPDATE products SET stock = CASE WHEN (stock IS NULL OR stock = 0) AND stock_quantity > 0 THEN stock_quantity ELSE stock END"
        )
        if sqlite3.sqlite_version_info >= (3, 35, 0):
            try:
                cursor.execute("ALTER TABLE products DROP COLUMN stock_quantity")
            except Exception:
                pass
        else:
            try:
                cursor.execute('''
                    CREATE TABLE products_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        price REAL NOT NULL,
                        stock INTEGER NOT NULL DEFAULT 0,
                        low_stock_threshold INTEGER DEFAULT 5,
                        barcode TEXT UNIQUE,
                        global_sku_code TEXT,
                        category TEXT,
                        category_id INTEGER,
                        delivery_time TEXT DEFAULT '30-120 mins',
                        status TEXT DEFAULT 'available',
                        images TEXT,
                        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(category_id) REFERENCES categories(id)
                    )
                ''')
                cursor.execute('''
                    INSERT INTO products_new (id, name, price, stock, low_stock_threshold, barcode, global_sku_code, category, category_id, delivery_time, status, images, last_updated, created_at)
                    SELECT id, name, price, stock, low_stock_threshold, NULL, NULL, category, category_id, delivery_time, status, images, last_updated, created_at
                    FROM products
                ''')
                cursor.execute('DROP TABLE products')
                cursor.execute('ALTER TABLE products_new RENAME TO products')
            except Exception:
                pass

    # Ensure barcode and global_sku_code columns exist for all products table versions
    cursor.execute("PRAGMA table_info(products)")
    existing_product_cols = [row[1] for row in cursor.fetchall()]
    if 'barcode' not in existing_product_cols:
        safe_execute_ddl("ALTER TABLE products ADD COLUMN barcode TEXT")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)")
    if 'global_sku_code' not in existing_product_cols:
        safe_execute_ddl("ALTER TABLE products ADD COLUMN global_sku_code TEXT")
    if 'description' not in existing_product_cols:
        safe_execute_ddl("ALTER TABLE products ADD COLUMN description TEXT")
    if 'sub_category' not in existing_product_cols:
        safe_execute_ddl("ALTER TABLE products ADD COLUMN sub_category TEXT")
    if 'brand' not in existing_product_cols:
        safe_execute_ddl("ALTER TABLE products ADD COLUMN brand TEXT")
    if 'units_per_pack' not in existing_product_cols:
        safe_execute_ddl("ALTER TABLE products ADD COLUMN units_per_pack TEXT")
    if 'material_type' not in existing_product_cols:
        safe_execute_ddl("ALTER TABLE products ADD COLUMN material_type TEXT")
    if 'weight' not in existing_product_cols:
        safe_execute_ddl("ALTER TABLE products ADD COLUMN weight TEXT")
    if 'dimensions' not in existing_product_cols:
        safe_execute_ddl("ALTER TABLE products ADD COLUMN dimensions TEXT")
    if 'is_fragile' not in existing_product_cols:
        safe_execute_ddl("ALTER TABLE products ADD COLUMN is_fragile BOOLEAN DEFAULT 0")
    if 'is_temp_sensitive' not in existing_product_cols:
        safe_execute_ddl("ALTER TABLE products ADD COLUMN is_temp_sensitive BOOLEAN DEFAULT 0")
    if 'is_perishable' not in existing_product_cols:
        safe_execute_ddl("ALTER TABLE products ADD COLUMN is_perishable BOOLEAN DEFAULT 0")
    if 'is_featured' not in existing_product_cols:
        safe_execute_ddl("ALTER TABLE products ADD COLUMN is_featured BOOLEAN DEFAULT 0")
    if 'expiry_date' not in existing_product_cols:
        safe_execute_ddl("ALTER TABLE products ADD COLUMN expiry_date TEXT")
    
    # (Old delivery_partners definition removed, moved to bottom with more fields)
    
    # Ensure return_policy exists in products
    if 'return_policy' not in product_columns:
        safe_execute_ddl("ALTER TABLE products ADD COLUMN return_policy TEXT")

    # Categories Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            icon TEXT,
            important_note TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            return_policy TEXT DEFAULT '7 Days Return Policy',
            device_customization_enabled INTEGER DEFAULT 0
        )
    ''')
    # ensure columns added for existing databases
    cursor.execute("PRAGMA table_info(categories)")
    existing_cat_cols = [row[1] for row in cursor.fetchall()]
    if 'important_note' not in existing_cat_cols:
        safe_execute_ddl("ALTER TABLE categories ADD COLUMN important_note TEXT")
    if 'return_policy' not in existing_cat_cols:
        safe_execute_ddl("ALTER TABLE categories ADD COLUMN return_policy TEXT DEFAULT '7 Days Return Policy'")
    if 'device_customization_enabled' not in existing_cat_cols:
        safe_execute_ddl("ALTER TABLE categories ADD COLUMN device_customization_enabled INTEGER DEFAULT 0")

    # Brands Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS brands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            logo_url TEXT,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Dark Stores Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS dark_stores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            store_code TEXT UNIQUE,
            name TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            address TEXT NOT NULL,
            pincode TEXT,
            active BOOLEAN DEFAULT 1,
            manager_name TEXT,
            phone TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    # ensure columns added for existing databases
    cursor.execute("PRAGMA table_info(dark_stores)")
    existing_store_cols = [row[1] for row in cursor.fetchall()]
    if 'manager_name' not in existing_store_cols:
        cursor.execute("ALTER TABLE dark_stores ADD COLUMN manager_name TEXT")
    if 'phone' not in existing_store_cols:
        cursor.execute("ALTER TABLE dark_stores ADD COLUMN phone TEXT")
    if 'store_code' not in existing_store_cols:
        cursor.execute("ALTER TABLE dark_stores ADD COLUMN store_code TEXT")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_dark_stores_store_code ON dark_stores(store_code)")
    if 'pincode' not in existing_store_cols:
        cursor.execute("ALTER TABLE dark_stores ADD COLUMN pincode TEXT")
    
    # Store Inventory Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS store_inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            store_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            stock_quantity INTEGER DEFAULT 0,
            FOREIGN KEY(store_id) REFERENCES dark_stores(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        )
    ''')

    # Orders Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            total_amount REAL NOT NULL,
            status TEXT DEFAULT 'PLACED',
            delivery_address TEXT NOT NULL,
            phone TEXT NOT NULL,
            status_packing_at TIMESTAMP,
            status_out_at TIMESTAMP,
            status_delivered_at TIMESTAMP,
            estimated_delivery TEXT DEFAULT '15-25 mins',
            delivery_partner_id INTEGER,
            store_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            platform_fee REAL DEFAULT 0,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(delivery_partner_id) REFERENCES delivery_partners(id),
            FOREIGN KEY(store_id) REFERENCES dark_stores(id)
        )
    ''')
    
    # ensure columns added for existing databases
    cursor.execute("PRAGMA table_info(orders)")
    existing_order_cols = [row[1] for row in cursor.fetchall()]
    if 'platform_fee' not in existing_order_cols:
        cursor.execute("ALTER TABLE orders ADD COLUMN platform_fee REAL DEFAULT 0")
    if 'delivery_fee' not in existing_order_cols:
        cursor.execute("ALTER TABLE orders ADD COLUMN delivery_fee REAL DEFAULT 0")
    if 'shiprocket_order_id' not in existing_order_cols:
        cursor.execute("ALTER TABLE orders ADD COLUMN shiprocket_order_id TEXT")
    
    # Order Items Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            price REAL NOT NULL,
            device_model TEXT,
            FOREIGN KEY(order_id) REFERENCES orders(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        )
    ''')
    cursor.execute("PRAGMA table_info(order_items)")
    existing_order_item_cols = [row[1] for row in cursor.fetchall()]
    if 'device_model' not in existing_order_item_cols:
        cursor.execute("ALTER TABLE order_items ADD COLUMN device_model TEXT")

    # Device Models Table for sticker customization
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS device_models (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            brand TEXT,
            type TEXT,
            status TEXT DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # System Settings Table (Global Config)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS system_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            value TEXT NOT NULL
        )
    ''')
    # Seed default platform fee if not exists
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('platform_fee', '7')")
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('free_delivery_threshold', '199')")
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('delivery_fee', '49')")
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('about_us_content', '')")
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('terms_and_conditions_content', '')")
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('terms_and_conditions_version', '1')")

    # Banners Table for Frontend Store
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS banners (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            subtitle TEXT,
            cta_text TEXT DEFAULT 'Explore Now',
            image_url TEXT,
            badge_text TEXT,
            gradient TEXT DEFAULT 'bg-slate-900',
            link_url TEXT,
            is_active INTEGER DEFAULT 1,
            overlay_opacity REAL DEFAULT 0.5,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute("PRAGMA table_info(banners)")
    existing_banner_cols = [row[1] for row in cursor.fetchall()]
    if 'overlay_opacity' not in existing_banner_cols:
        safe_execute_ddl("ALTER TABLE banners ADD COLUMN overlay_opacity REAL DEFAULT 0.5")

    # Multi-admin Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            role TEXT NOT NULL CHECK(role IN ('admin', 'super_admin')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_admins_role
        ON admins(role)
    ''')
    # Keep backward compatibility with existing role-based users data.
    cursor.execute('''
        INSERT OR IGNORE INTO admins (user_id, role)
        SELECT id, role
        FROM users
        WHERE role IN ('admin', 'super_admin')
    ''')

    # Admin Permissions Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS admin_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER NOT NULL,
            permission TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(admin_id) REFERENCES users(id)
        )
    ''')
    cursor.execute('''
        CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_permissions_admin_permission
        ON admin_permissions(admin_id, permission)
    ''')

    # Admin Activity Logs
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id INTEGER,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(admin_id) REFERENCES users(id)
        )
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_activity_logs_admin_id
        ON activity_logs(admin_id)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_activity_logs_action
        ON activity_logs(action)
    ''')

    # Admin Audit Logs
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER NOT NULL,
            action_type TEXT NOT NULL,
            target_entity TEXT NOT NULL,
            target_id INTEGER,
            description TEXT,
            ip_address TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(admin_id) REFERENCES users(id)
        )
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_id
        ON admin_audit_logs(admin_id)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action_type
        ON admin_audit_logs(action_type)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_timestamp
        ON admin_audit_logs(timestamp)
    ''')

    # Login Attempts (for account lock and threat analysis)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS login_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            ip_address TEXT,
            status TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_login_attempts_email_timestamp
        ON login_attempts(email, timestamp)
    ''')

    # Security Alerts (for admin security panel)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS security_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            alert_type TEXT NOT NULL,
            message TEXT NOT NULL,
            severity TEXT DEFAULT 'medium',
            admin_id INTEGER,
            ip_address TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(admin_id) REFERENCES users(id)
        )
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_security_alerts_created_at
        ON security_alerts(created_at)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_security_alerts_type
        ON security_alerts(alert_type)
    ''')
    

    # --- New profile related tables ---
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_addresses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            full_name TEXT NOT NULL,
            phone TEXT NOT NULL,
            house TEXT,
            city TEXT,
            state TEXT,
            pincode TEXT,
            landmark TEXT,
            is_default INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS wishlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cart (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            session_id TEXT,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        )
    ''')
    # Migration: add session_id if missing
    cursor.execute("PRAGMA table_info(cart)")
    cart_cols = [row[1] for row in cursor.fetchall()]
    if 'session_id' not in cart_cols:
        cursor.execute("ALTER TABLE cart ADD COLUMN session_id TEXT")
    if 'user_id' in cart_cols:
        # ensure user_id is nullable (sqlite doesn't easily support ALTER COLUMN NULL, 
        # but we can just use it as is if it was already nullable or not)
        pass
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS wallet (
            user_id INTEGER PRIMARY KEY,
            balance REAL DEFAULT 0,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS wallet_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            type TEXT NOT NULL,
            reference TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            type TEXT DEFAULT 'SYSTEM',
            is_read INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')
    cursor.execute("PRAGMA table_info(notifications)")
    existing_note_cols = [row[1] for row in cursor.fetchall()]
    if 'type' not in existing_note_cols:
        cursor.execute("ALTER TABLE notifications ADD COLUMN type TEXT DEFAULT 'SYSTEM'")
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS support_tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            subject TEXT NOT NULL,
            message TEXT NOT NULL,
            status TEXT DEFAULT 'OPEN',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS login_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            ip_address TEXT,
            device TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS saved_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            method_type TEXT NOT NULL,
            token TEXT NOT NULL,
            last4 TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')

    # User Interactions Table (for Recommendations)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_interactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            session_id TEXT,
            interaction_type TEXT NOT NULL, -- 'search', 'view', 'add_to_cart'
            target_id TEXT, -- search_query or product_id
            category TEXT, -- category of the product viewed
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_user_interactions_user ON user_interactions(user_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_user_interactions_session ON user_interactions(session_id)')

    # ── Warehouse Applications (onboarding requests) ────────────────────────
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS warehouse_applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            partner_id TEXT UNIQUE,
            warehouse_name TEXT NOT NULL,
            owner_name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT,
            address TEXT NOT NULL,
            pincode TEXT,
            warehouse_capacity INTEGER,
            warehouse_type TEXT DEFAULT 'micro_fulfillment',
            verification_status TEXT DEFAULT 'pending'
                CHECK(verification_status IN ('pending','approved','rejected')),
            admin_notes TEXT,
            warehouse_photos TEXT,
            document_upload TEXT,
            owner_image TEXT,
            kyc_details TEXT,
            request_mail_message TEXT,
            approved_by_id INTEGER,
            approved_by_name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # ensure columns added for existing databases
    cursor.execute("PRAGMA table_info(warehouse_applications)")
    existing_wh_app_cols = [row[1] for row in cursor.fetchall()]
    wh_app_extra_cols = [
        ('partner_id', 'TEXT'),
        ('warehouse_photos', 'TEXT'),
        ('document_upload', 'TEXT'),
        ('owner_image', 'TEXT'),
        ('kyc_details', 'TEXT'),
        ('request_mail_message', 'TEXT'),
        ('approved_by_id', 'INTEGER'),
        ('approved_by_name', 'TEXT')
    ]
    for col, definition in wh_app_extra_cols:
        if col not in existing_wh_app_cols:
            cursor.execute(f"ALTER TABLE warehouse_applications ADD COLUMN {col} {definition}")
            if col == 'partner_id':
                cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_wh_apps_partner_id ON warehouse_applications(partner_id)")
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_warehouse_applications_email
        ON warehouse_applications(email)
    ''')

    # ── Warehouses (approved partner records) ───────────────────────────────
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS warehouses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            partner_id TEXT UNIQUE,
            application_id INTEGER UNIQUE,
            warehouse_name TEXT NOT NULL,
            owner_name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT,
            address TEXT,
            pincode TEXT,
            warehouse_capacity INTEGER,
            warehouse_type TEXT DEFAULT 'micro_fulfillment',
            warehouse_role TEXT DEFAULT 'owner',
            operations_status TEXT DEFAULT 'open'
                CHECK(operations_status IN ('open','closed')),
            weather_status TEXT DEFAULT 'clear'
                CHECK(weather_status IN ('clear','bad_weather')),
            account_status TEXT DEFAULT 'active'
                CHECK(account_status IN ('active','suspended','banned')),
            profile_kyc_status TEXT DEFAULT 'verified'
                CHECK(profile_kyc_status IN ('verified','pending')),
            kyc_notice_sent INTEGER DEFAULT 0,
            kyc_notice_sent_at TIMESTAMP,
            service_radius_km REAL DEFAULT 4,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(application_id) REFERENCES warehouse_applications(id)
        )
    ''')
    cursor.execute("PRAGMA table_info(warehouses)")
    existing_wh_cols = [row[1] for row in cursor.fetchall()]
    if 'account_status' not in existing_wh_cols:
        cursor.execute("ALTER TABLE warehouses ADD COLUMN account_status TEXT DEFAULT 'active'")
    if 'partner_id' not in existing_wh_cols:
        cursor.execute("ALTER TABLE warehouses ADD COLUMN partner_id TEXT")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_partner_id ON warehouses(partner_id)")
    if 'profile_kyc_status' not in existing_wh_cols:
        cursor.execute("ALTER TABLE warehouses ADD COLUMN profile_kyc_status TEXT DEFAULT 'verified'")
    if 'kyc_notice_sent' not in existing_wh_cols:
        cursor.execute("ALTER TABLE warehouses ADD COLUMN kyc_notice_sent INTEGER DEFAULT 0")
    if 'kyc_notice_sent_at' not in existing_wh_cols:
        cursor.execute("ALTER TABLE warehouses ADD COLUMN kyc_notice_sent_at TIMESTAMP")

    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_warehouses_email
        ON warehouses(email)
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS warehouse_notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            warehouse_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            type TEXT DEFAULT 'SYSTEM',
            is_read INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(warehouse_id) REFERENCES warehouses(id)
        )
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_warehouse_notifications_warehouse
        ON warehouse_notifications(warehouse_id, created_at DESC)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_warehouse_notifications_read
        ON warehouse_notifications(warehouse_id, is_read)
    ''')

    # ── Delivery Applications (onboarding requests) ────────────────────────
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS delivery_applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            partner_id TEXT UNIQUE,
            warehouse_id INTEGER,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT,
            address TEXT,
            pincode TEXT,
            vehicle_type TEXT DEFAULT 'bike',
            verification_status TEXT DEFAULT 'pending_store'
                CHECK(verification_status IN ('pending_store', 'pending_admin', 'approved', 'rejected')),
            admin_notes TEXT,
            id_proof_photo TEXT,
            vehicle_details_photo TEXT,
            pan_card_image TEXT,
            aadhaar_front_image TEXT,
            aadhaar_back_image TEXT,
            face_verification_image TEXT,
            face_verification_status TEXT DEFAULT 'not_verified',
            aadhaar_extracted_address TEXT,
            aadhaar_qr_payload TEXT,
            approved_by_id INTEGER,
            approved_by_name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(warehouse_id) REFERENCES dark_stores(id)
        )
    ''')
    cursor.execute("PRAGMA table_info(delivery_applications)")
    existing_del_app_cols = [row[1] for row in cursor.fetchall()]
    if 'warehouse_id' not in existing_del_app_cols:
        cursor.execute("ALTER TABLE delivery_applications ADD COLUMN warehouse_id INTEGER")
    delivery_app_extra_cols = [
        ('pan_card_image', 'TEXT'),
        ('aadhaar_front_image', 'TEXT'),
        ('aadhaar_back_image', 'TEXT'),
        ('face_verification_image', 'TEXT'),
        ("face_verification_status", "TEXT DEFAULT 'not_verified'"),
        ('aadhaar_extracted_address', 'TEXT'),
        ('aadhaar_qr_payload', 'TEXT'),
    ]
    for col, definition in delivery_app_extra_cols:
        if col not in existing_del_app_cols:
            cursor.execute(f"ALTER TABLE delivery_applications ADD COLUMN {col} {definition}")
    
    # We need to drop and recreate the CHECK constraint for older SQLite, or just handle it in app logic.
    # For simplicity in this dev environment, we assume a fresh start or simple column addition.
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_delivery_apps_email ON delivery_applications(email)")

    # ── Delivery Partners (approved records) ─────────────────────────────────
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS delivery_partners (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            partner_id TEXT UNIQUE,
            application_id INTEGER UNIQUE,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT,
            status TEXT DEFAULT 'OFFLINE'
                CHECK(status IN ('AVAILABLE', 'BUSY', 'OFFLINE')),
            location TEXT,
            active_order_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(application_id) REFERENCES delivery_applications(id)
        )
    ''')
    # Migration for delivery_partners (if table existed with old schema)
    cursor.execute("PRAGMA table_info(delivery_partners)")
    existing_dp_cols = [row[1] for row in cursor.fetchall()]
    if 'email' not in existing_dp_cols:
        cursor.execute("ALTER TABLE delivery_partners ADD COLUMN email TEXT")
    if 'partner_id' not in existing_dp_cols:
        cursor.execute("ALTER TABLE delivery_partners ADD COLUMN partner_id TEXT")
    if 'application_id' not in existing_dp_cols:
        cursor.execute("ALTER TABLE delivery_partners ADD COLUMN application_id INTEGER")
    if 'latitude' not in existing_dp_cols:
        cursor.execute("ALTER TABLE delivery_partners ADD COLUMN latitude REAL DEFAULT 0")
    if 'longitude' not in existing_dp_cols:
        cursor.execute("ALTER TABLE delivery_partners ADD COLUMN longitude REAL DEFAULT 0")

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_delivery_partners_email ON delivery_partners(email)")

    # ── Warehouse Inventory ──────────────────────────────────────────────────
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS warehouse_inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            warehouse_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            product_name TEXT NOT NULL,
            sku TEXT,
            stock_quantity INTEGER DEFAULT 0,
            reserved_stock INTEGER DEFAULT 0,
            available_stock INTEGER DEFAULT 0,
            low_stock_threshold INTEGER DEFAULT 5,
            bin_location TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            brand TEXT,
            unit TEXT DEFAULT 'pcs',
            cost_price REAL DEFAULT 0.0,
            selling_price REAL DEFAULT 0.0,
            mrp REAL DEFAULT 0.0,
            discount_pct REAL DEFAULT 0.0,
            gst_pct REAL DEFAULT 18.0,
            status TEXT DEFAULT 'active',
            FOREIGN KEY(warehouse_id) REFERENCES warehouses(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        )
    ''')
    # ensure columns added for existing databases
    cursor.execute("PRAGMA table_info(warehouse_inventory)")
    existing_wi_cols = [row[1] for row in cursor.fetchall()]
    wi_extra_cols = [
        ('brand', 'TEXT'),
        ('unit', "TEXT DEFAULT 'pcs'"),
        ('cost_price', 'REAL DEFAULT 0.0'),
        ('selling_price', 'REAL DEFAULT 0.0'),
        ('mrp', 'REAL DEFAULT 0.0'),
        ('discount_pct', 'REAL DEFAULT 0.0'),
        ('discount_amt', 'REAL DEFAULT 0.0'),
        ('gst_pct', 'REAL DEFAULT 18.0'),
        ('status', "TEXT DEFAULT 'active'")
    ]
    for col, definition in wi_extra_cols:
        if col not in existing_wi_cols:
            cursor.execute(f"ALTER TABLE warehouse_inventory ADD COLUMN {col} {definition}")

    # ── Warehouse Order Assignments ──────────────────────────────────────────
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS warehouse_order_assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            warehouse_id INTEGER NOT NULL,
            order_id INTEGER NOT NULL,
            assignment_status TEXT DEFAULT 'assigned'
                CHECK(assignment_status IN ('assigned','accepted','packing','packed','dispatched','rejected')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(warehouse_id) REFERENCES warehouses(id),
            FOREIGN KEY(order_id) REFERENCES orders(id)
        )
    ''')

    # ── Mail History ────────────────────────────────────────────────────────
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS mail_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER NOT NULL,
            recipient_type TEXT NOT NULL CHECK(recipient_type IN ('individual', 'bulk')),
            recipient_email TEXT, -- NULL for bulk
            recipient_count INTEGER, -- Number of users for bulk
            subject TEXT NOT NULL,
            message TEXT NOT NULL,
            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(admin_id) REFERENCES users(id)
        )
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_mail_history_sent_at 
        ON mail_history(sent_at)
    ''')

    # ── Notification Templates ─────────────────────────────────────────────
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS notification_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_key TEXT UNIQUE NOT NULL,
            title TEXT,
            subject TEXT,
            message TEXT NOT NULL,
            type TEXT DEFAULT 'app', -- 'app' or 'email'
            is_active INTEGER DEFAULT 1,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # ── Wishlist ───────────────────────────────────────────────────────────
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS wishlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, product_id),
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS product_reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
            review_text TEXT,
            review_images TEXT, -- JSON array of image URLs
            is_verified INTEGER DEFAULT 0, -- 1 if user actually bought it
            helpful_count INTEGER DEFAULT 0,
            store_id INTEGER, -- The store that fulfilled the order being reviewed
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(product_id, user_id),
            FOREIGN KEY(product_id) REFERENCES products(id),
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(store_id) REFERENCES dark_stores(id)
        )
    ''')
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_reviews_product ON product_reviews(product_id)")

    # ── Review Helpful Votes ──────────────────────────────────────────────
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS review_helpful_votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            review_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(review_id, user_id),
            FOREIGN KEY(review_id) REFERENCES product_reviews(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_review_helpful_user ON review_helpful_votes(user_id)")

    # Seed Default Templates
    templates = [
        # Low Stock Email
        ('low_stock_email', 'Almost Sold Out!', "Don't let it slip away! 🏃‍♂️ {product_name} is almost gone!", 
         "Hello {user_name}, we noticed you have {product_name} in your cart. It's flying off the shelves and only {stock_left} left! Secure yours now.", 'email'),
        
        # Low Stock App
        ('low_stock_app', '🔥 Hot Item Alert!', None, 
         "The {product_name} in your cart is almost sold out. Only {stock_left} left! Grab it before it's gone. 🛒", 'app'),
        
        # Order Placed App
        ('order_placed_app', 'Order Placed', None, 
         "Your order #{order_id} has been placed successfully!", 'app'),
        
        # Order Packing App
        ('order_packing_app', 'Packing Order', None, 
         "We are packing your items for order #{order_id}.", 'app'),
        
        # Order Out for Delivery App
        ('order_out_delivery_app', 'Out for Delivery', None, 
         "Order #{order_id} is out for delivery! Track it live.", 'app'),
        
        # Order Delivered App
        ('order_delivered_app', 'Delivered', None, 
         "Order #{order_id} has been delivered. Enjoy!", 'app'),
        
        # Review Thank You Email
        ('review_thank_you_email', 'Review Thank You', 'Thank you for your review! - JDLX Mobile', 
         "Hello {user_name}, we've received your review for {product_name}. Your reviews help other customers make better choices. Thank you for your feedback!", 'email')
    ]

    for key, title, subject, message, t_type in templates:
        cursor.execute('''
            INSERT OR IGNORE INTO notification_templates (template_key, title, subject, message, type)
            VALUES (?, ?, ?, ?, ?)
        ''', (key, title, subject, message, t_type))

    # Default System Settings
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)", ('scheduled_delivery_time', 'Tomorrow by 11:00 AM'))
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)", ('quick_delivery_max_distance', '5'))
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)", ('scheduled_delivery_note', 'Reliable fulfillment from our central warehouse.'))
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)", ('quick_delivery_note', 'Hyperlocal dispatch from the active dark store.'))
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)", ('ticker_text', 'Free delivery on orders above ₹499 • Better experience with fast delivery'))

    # Product Notifications Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS product_notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            email TEXT NOT NULL,
            product_id INTEGER NOT NULL,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'notified')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        )
    ''')

    conn.commit()
    conn.close()
    print("Database initialized successfully.")

if __name__ == "__main__":
    init_db()

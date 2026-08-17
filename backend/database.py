import sqlite3
import os
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"), override=True)

# Local-testing escape hatch: set FORCE_LOCAL_DB=1 in the environment to run
# against the local SQLite file even when Turso credentials are present in .env.
# This only controls which DB connection is used — no business logic is changed.
FORCE_LOCAL_DB = os.environ.get("FORCE_LOCAL_DB", "").strip().lower() in ("1", "true", "yes")

DATABASE_PATH = os.environ.get("DATABASE_PATH") or os.path.join(BASE_DIR, 'jdlx.db')
VALID_ROLES = ('user', 'admin', 'super_admin')

def _clean_env_value(value):
    if not value:
        return None
    value = value.strip().strip('"').strip("'")
    if value.lower().startswith("bearer "):
        value = value[7:].strip()
    return value or None

def _get_first_env(*names):
    for name in names:
        value = _clean_env_value(os.environ.get(name))
        if value:
            return value
    return None

def _is_turso_auth_error(error):
    message = str(error).lower()
    return (
        "status=401" in message
        or "unauthorized" in message
        or "invalid jwt token" in message
    )

def _raise_turso_config_error(error):
    if _is_turso_auth_error(error):
        raise RuntimeError(
            "Turso authentication failed. Update the Render environment variable "
            "TURSO_AUTH_TOKEN with a fresh database token for TURSO_DATABASE_URL. "
            "Do not include quotes or a 'Bearer ' prefix."
        ) from error
    raise error

TURSO_URL = _get_first_env("TURSO_DATABASE_URL", "LIBSQL_URL")
TURSO_TOKEN = _get_first_env(
    "TURSO_AUTH_TOKEN",
    "TURSO_DATABASE_TOKEN",
    "TURSO_DATABASE_AUTH_TOKEN",
    "LIBSQL_AUTH_TOKEN",
)

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
        try:
            self._cursor.execute(sql, parameters)
        except Exception as e:
            _raise_turso_config_error(e)
        return self
    def executemany(self, sql, seq_of_parameters):
        seq_of_parameters = [tuple(p) if isinstance(p, list) else p for p in seq_of_parameters]
        try:
            self._cursor.executemany(sql, seq_of_parameters)
        except Exception as e:
            _raise_turso_config_error(e)
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

if not FORCE_LOCAL_DB and TURSO_URL and TURSO_TOKEN:
    try:
        import libsql_experimental as libsql
        USE_TURSO = True
    except ImportError:
        USE_TURSO = False
else:
    USE_TURSO = False

def _open_connection():
    """Opens a brand-new DB connection (Turso in production, local SQLite in dev)."""
    if USE_TURSO:
        try:
            raw_conn = libsql.connect(TURSO_URL, auth_token=TURSO_TOKEN)
        except Exception as e:
            _raise_turso_config_error(e)
        conn = LibsqlConnectionWrapper(raw_conn)
        conn.row_factory = LibsqlRow
    else:
        conn = sqlite3.connect(DATABASE_PATH, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout = 10000")  # 10s retry on lock
    return conn


def _has_flask_app_context():
    try:
        import flask
        return flask.has_app_context()
    except Exception:
        return False


class _RequestScopedConnection:
    """Wraps a DB connection so ``close()`` is deferred to request teardown.

    Routes open a connection and close it in a ``finally`` block. Most
    authenticated requests actually call ``get_db()`` twice (auth check + route
    handler); sharing ONE connection per request instead of opening two saves a
    full connect round-trip on every request (a remote handshake on Turso).
    ``close()`` becomes a no-op and ``_hard_close()`` is invoked by
    ``teardown_appcontext`` in app.py.

    Outside a Flask app context (scripts, migrations, scheduler jobs, background
    threads) ``get_db`` keeps its original behavior: a fresh connection that
    closes normally.
    """
    def __init__(self, conn):
        object.__setattr__(self, '_conn', conn)

    def __getattr__(self, name):
        return getattr(object.__getattribute__(self, '_conn'), name)

    def __setattr__(self, name, value):
        if name == '_conn':
            object.__setattr__(self, name, value)
        else:
            setattr(object.__getattribute__(self, '_conn'), name, value)

    def close(self):
        """Deferred — the connection is released at request teardown."""
        pass

    def _hard_close(self):
        object.__getattribute__(self, '_conn').close()


def get_db():
    conn = _open_connection()
    if not _has_flask_app_context():
        return conn
    import flask
    g = flask.g
    if not hasattr(g, "_jdlx_request_db"):
        g._jdlx_request_db = _RequestScopedConnection(conn)
    else:
        # Second get_db() in the same request: discard the extra connection and
        # reuse the request-scoped one.
        conn.close()
        return g._jdlx_request_db
    return g._jdlx_request_db

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
    ensure_columns('users', [('phone', 'TEXT'), ('gender', 'TEXT'), ('date_of_birth', 'TEXT'), ('about', 'TEXT'), ('terms_accepted_version', 'INTEGER DEFAULT 0'), ('terms_accepted_at', 'TIMESTAMP'), ('email_verified', 'INTEGER DEFAULT 0'), ('phone_verified', 'INTEGER DEFAULT 0'), ('account_status', "TEXT DEFAULT 'active'"), ('cod_restricted', 'INTEGER DEFAULT 0'), ('min_token_iat', 'INTEGER DEFAULT 0'), ('last_login', 'TIMESTAMP')])

    cursor.execute('''CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, icon TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    ensure_columns('categories', [('important_note', 'TEXT'), ('return_policy', "TEXT DEFAULT '7 Days Return Policy'"), ('device_customization_enabled', 'INTEGER DEFAULT 0')])

    cursor.execute('''CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL NOT NULL, stock INTEGER NOT NULL DEFAULT 0, category_id INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(category_id) REFERENCES categories(id))''')
    ensure_columns('products', [
        ('barcode', 'TEXT'), 
        ('global_sku_code', 'TEXT'), 
        ('description', 'TEXT'), 
        ('sub_category', 'TEXT'), 
        ('brand', 'TEXT'), 
        ('units_per_pack', 'TEXT'), 
        ('material_type', 'TEXT'), 
        ('weight', 'TEXT'), 
        ('dimensions', 'TEXT'), 
        ('is_fragile', 'BOOLEAN DEFAULT 0'), 
        ('is_temp_sensitive', 'BOOLEAN DEFAULT 0'), 
        ('is_perishable', 'BOOLEAN DEFAULT 0'), 
        ('is_featured', 'BOOLEAN DEFAULT 0'), 
        ('expiry_date', 'TEXT'), 
        ('return_policy', 'TEXT'), 
        ('prepaid_only', 'INTEGER DEFAULT 0'), 
        ('low_stock_threshold', 'INTEGER DEFAULT 5'), 
        ('delivery_time', "TEXT DEFAULT '12-25 mins'"), 
        ('status', "TEXT DEFAULT 'available'"), 
        ('images', 'TEXT'), 
        ('offline_price', 'REAL'), 
        ('has_variants', 'BOOLEAN DEFAULT 0'), 
        ('is_parent', 'BOOLEAN DEFAULT 0'), 
        ('recommendation_priority', 'INTEGER DEFAULT 0'), 
        ('recommendation_weight', 'REAL DEFAULT 1.0'), 
        ('lifecycle_state', "TEXT DEFAULT 'live'"), 
        ('share_token', 'TEXT'), 
        ('seo_slug', 'TEXT')
    ])
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)")
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_products_share_token ON products(share_token)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_products_seo_slug ON products(seo_slug)")

    cursor.execute('''CREATE TABLE IF NOT EXISTS product_recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        recommended_product_id INTEGER NOT NULL,
        recommendation_type TEXT NOT NULL, -- 'related', 'upsell', 'cross_sell', 'frequent'
        priority INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, recommended_product_id, recommendation_type),
        FOREIGN KEY(product_id) REFERENCES products(id),
        FOREIGN KEY(recommended_product_id) REFERENCES products(id)
    )''')
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_recommendations_product ON product_recommendations(product_id)")

    cursor.execute('''CREATE TABLE IF NOT EXISTS product_content (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL UNIQUE,
        overview TEXT,
        highlights TEXT, -- JSON array of strings
        specifications TEXT, -- JSON object
        compatibility TEXT,
        box_contents TEXT,
        warranty_info TEXT,
        usage_instructions TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(product_id) REFERENCES products(id)
    )''')
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_content_product ON product_content(product_id)")

    cursor.execute('''CREATE TABLE IF NOT EXISTS product_badges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        badge_type TEXT NOT NULL, -- 'best_seller', 'trending', 'new_arrival', 'premium', 'limited_deal', 'staff_choice', 'verified'
        priority INTEGER DEFAULT 0,
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        is_active BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(product_id) REFERENCES products(id)
    )''')
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_badges_product ON product_badges(product_id)")

    cursor.execute('''CREATE TABLE IF NOT EXISTS product_fulfillment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL UNIQUE,
        package_weight REAL DEFAULT 0,
        length REAL DEFAULT 0,
        width REAL DEFAULT 0,
        height REAL DEFAULT 0,
        shipping_tier TEXT DEFAULT 'standard', -- 'standard', 'express', 'heavy', 'fragile'
        dispatch_sla INTEGER DEFAULT 24, -- in hours
        is_cod_eligible BOOLEAN DEFAULT 1,
        is_fragile BOOLEAN DEFAULT 0,
        is_express_eligible BOOLEAN DEFAULT 1,
        return_window INTEGER DEFAULT 7, -- in days
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(product_id) REFERENCES products(id)
    )''')
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_fulfillment_product ON product_fulfillment(product_id)")

    cursor.execute('''CREATE TABLE IF NOT EXISTS product_discovery (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL UNIQUE,
        meta_title TEXT,
        meta_description TEXT,
        search_keywords TEXT, -- JSON array
        product_tags TEXT, -- JSON array
        search_synonyms TEXT, -- JSON array
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(product_id) REFERENCES products(id)
    )''')
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_discovery_product ON product_discovery(product_id)")

    cursor.execute('''CREATE TABLE IF NOT EXISTS product_analytics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL UNIQUE,
        view_count INTEGER DEFAULT 0,
        cart_add_count INTEGER DEFAULT 0,
        purchase_count INTEGER DEFAULT 0,
        wishlist_count INTEGER DEFAULT 0,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(product_id) REFERENCES products(id)
    )''')
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_analytics_product ON product_analytics(product_id)")

    cursor.execute('''CREATE TABLE IF NOT EXISTS product_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        sku TEXT UNIQUE,
        price REAL,
        stock INTEGER DEFAULT 0,
        barcode TEXT UNIQUE,
        model_name TEXT,
        color TEXT,
        pack_size TEXT,
        material_type TEXT,
        images TEXT,
        weight TEXT,
        dimensions TEXT,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(product_id) REFERENCES products(id)
    )''')
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id)")

    # Legacy Stock Sync
    cursor.execute("PRAGMA table_info(products)")
    if 'stock_quantity' in [r[1] for r in cursor.fetchall()]:
        cursor.execute("UPDATE products SET stock = CASE WHEN (stock IS NULL OR stock = 0) AND stock_quantity > 0 THEN stock_quantity ELSE stock END")

    # --- Commerce & Fulfillment ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        user_id INTEGER NOT NULL, 
        total_amount REAL NOT NULL, 
        order_status TEXT DEFAULT 'PLACED', 
        source TEXT DEFAULT 'ONLINE',
        agent_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
        FOREIGN KEY(user_id) REFERENCES users(id)
    )''')
    ensure_columns('orders', [
        ('source', "TEXT DEFAULT 'ONLINE'"),
        ('agent_id', 'INTEGER'),
        ('vendor_id', 'INTEGER'),
        ('billing_status', "TEXT DEFAULT 'active'"),
        ('subtotal_amount', 'REAL DEFAULT 0'),
        ('tax_amount', 'REAL DEFAULT 0'),
        ('gst_rate', 'REAL DEFAULT 0'),
        ('discount_amount', 'REAL DEFAULT 0'),
        ('order_number', 'TEXT'),
        ('customer_name', 'TEXT'),
        ('customer_phone', 'TEXT'),
        ('delivery_address', 'TEXT'),
        ('phone', 'TEXT'),
        ('platform_fee', 'REAL DEFAULT 0'),
        ('delivery_fee', 'REAL DEFAULT 0'),
        ('shiprocket_order_id', 'TEXT'),
        ('payment_type', "TEXT DEFAULT 'PREPAID'"),
        ('payment_status', "TEXT DEFAULT 'pending'"),
        ('cod_advance_paid', 'REAL DEFAULT 0'),
        ('cod_remaining_amount', 'REAL DEFAULT 0'),
        ('free_delivery_applied', 'INTEGER DEFAULT 0'),
        ('fitting_charge', 'REAL DEFAULT 0'),
        ('packed_at', 'TIMESTAMP'),
        ('shipped_at', 'TIMESTAMP'),
        ('delivered_at', 'TIMESTAMP'),
        ('estimated_delivery', "TEXT DEFAULT '15-25 mins'"),
        ('delivery_latitude', 'REAL'),
        ('delivery_longitude', 'REAL'),
        # delivery_type default is legacy (quick delivery is retired system-wide;
        # checkout always writes 'scheduled'). Kept for existing-row compatibility.
        ('delivery_type', "TEXT DEFAULT 'quick'"),
        ('delivery_partner_id', 'INTEGER'),
        ('store_id', 'INTEGER'),
        ('dark_store_id', 'INTEGER'),
        ('cancellation_reason', 'TEXT')
    ])

    cursor.execute('''CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        order_id INTEGER NOT NULL, 
        product_id INTEGER NOT NULL, 
        quantity INTEGER NOT NULL, 
        price REAL NOT NULL, 
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
        FOREIGN KEY(order_id) REFERENCES orders(id), 
        FOREIGN KEY(product_id) REFERENCES products(id)
    )''')
    ensure_columns('order_items', [
        ('product_name', 'TEXT'),
        ('variant_id', 'INTEGER REFERENCES product_variants(id)'),
        ('subtotal', 'REAL'),
        ('device_model', 'TEXT'),
        ('fitting_charge', 'REAL DEFAULT 0'),
        ('returned_qty', 'INTEGER DEFAULT 0')
    ])
    # Hot-path indexes: order history (get_user_orders / get_admin_orders filter by
    # user + sort by created_at) and every order_items lookup by order_id (order
    # details, returns/exchange, billing history). Idempotent — no data changes.
    # Composite (user_id, created_at) serves both the user filter and the
    # created_at DESC sort in a single index scan (SQLite scans it backwards).
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id)")

    cursor.execute('''CREATE TABLE IF NOT EXISTS cart (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, session_id TEXT, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(product_id) REFERENCES products(id))''')
    ensure_columns('cart', [('updated_at', 'TIMESTAMP'), ('variant_id', 'INTEGER REFERENCES product_variants(id)')])
    # Guest cart fetches always look up by session_id — index it.
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_cart_session ON cart(session_id)")

    # --- Logistics & Stores ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS dark_stores (id INTEGER PRIMARY KEY AUTOINCREMENT, store_code TEXT UNIQUE, name TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    ensure_columns('dark_stores', [('latitude', 'REAL'), ('longitude', 'REAL'), ('address', 'TEXT'), ('pincode', 'TEXT'), ('active', 'BOOLEAN DEFAULT 1'), ('manager_name', 'TEXT'), ('phone', 'TEXT')])

    cursor.execute('''CREATE TABLE IF NOT EXISTS warehouses (id INTEGER PRIMARY KEY AUTOINCREMENT, warehouse_name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    ensure_columns('warehouses', [('partner_id', 'TEXT'), ('application_id', 'INTEGER'), ('owner_name', 'TEXT'), ('phone', 'TEXT'), ('address', 'TEXT'), ('pincode', 'TEXT'), ('warehouse_capacity', 'INTEGER'), ('warehouse_type', "TEXT DEFAULT 'micro_fulfillment'"), ('warehouse_role', "TEXT DEFAULT 'owner'"), ('operations_status', "TEXT DEFAULT 'open'"), ('weather_status', "TEXT DEFAULT 'clear'"), ('account_status', "TEXT DEFAULT 'active'"), ('profile_kyc_status', "TEXT DEFAULT 'verified'"), ('kyc_notice_sent', 'INTEGER DEFAULT 0'), ('kyc_notice_sent_at', 'TIMESTAMP'), ('service_radius_km', 'REAL DEFAULT 4'), ('quick_mode_enabled', 'INTEGER DEFAULT 0')])

    # --- Vendor Staff Roles & Billing Agents ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS roles (
        role_id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor_id INTEGER NOT NULL,
        role_name TEXT NOT NULL,
        permissions TEXT NOT NULL DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(vendor_id) REFERENCES warehouses(id),
        UNIQUE(vendor_id, role_name)
    )''')
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_roles_vendor ON roles(vendor_id)")

    cursor.execute('''CREATE TABLE IF NOT EXISTS warehouse_staff (
        staff_id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor_id INTEGER NOT NULL,
        role_id INTEGER,
        name TEXT NOT NULL,
        login_email TEXT,
        username TEXT,
        password_hash TEXT,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
        setup_token TEXT,
        setup_token_expires TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(vendor_id) REFERENCES warehouses(id),
        FOREIGN KEY(role_id) REFERENCES roles(role_id),
        UNIQUE(vendor_id, login_email),
        UNIQUE(vendor_id, username)
    )''')
    # Legacy partner-module table may exist with a different PK name (id instead of staff_id).
    # Detect and, if needed, rebuild it to the billing schema so the staff routes work.
    try:
        cursor.execute("PRAGMA table_info(warehouse_staff)")
        wh_staff_cols = [r[1] for r in cursor.fetchall()]
        if "staff_id" not in wh_staff_cols:
            cursor.execute("ALTER TABLE warehouse_staff RENAME TO warehouse_staff_legacy")
            cursor.execute('''CREATE TABLE warehouse_staff (
                staff_id INTEGER PRIMARY KEY AUTOINCREMENT,
                vendor_id INTEGER NOT NULL,
                role_id INTEGER,
                name TEXT NOT NULL,
                login_email TEXT,
                username TEXT,
                password_hash TEXT,
                status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
                setup_token TEXT,
                setup_token_expires TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )''')
            legacy_cols = [r[1] for r in cursor.execute("PRAGMA table_info(warehouse_staff_legacy)").fetchall()]
            legacy_cols_lower = {c.lower(): c for c in legacy_cols}
            src_id = legacy_cols_lower.get("id") or legacy_cols_lower.get("staff_id")
            src_name = legacy_cols_lower.get("name")
            src_email = legacy_cols_lower.get("email") or legacy_cols_lower.get("login_email")
            src_status = legacy_cols_lower.get("status")
            src_vendor = legacy_cols_lower.get("vendor_id") or legacy_cols_lower.get("warehouse_partner_id")
            src_created = legacy_cols_lower.get("created_at")
            src_updated = legacy_cols_lower.get("updated_at")
            if src_id and src_name:
                status_expr = src_status if src_status else "'active'"
                created_expr = src_created if src_created else "CURRENT_TIMESTAMP"
                updated_expr = src_updated if src_updated else "CURRENT_TIMESTAMP"
                insert_sql = (
                    "INSERT INTO warehouse_staff (staff_id, vendor_id, name, login_email, status, created_at, updated_at) "
                    "SELECT " + ", ".join([
                        str(src_id),
                        str(src_vendor) if src_vendor else "NULL",
                        str(src_name),
                        str(src_email) if src_email else "NULL",
                        status_expr,
                        created_expr,
                        updated_expr,
                    ]) +
                    " FROM warehouse_staff_legacy"
                )
                cursor.execute(insert_sql)
            cursor.execute("DROP TABLE warehouse_staff_legacy")
    except Exception as e:
        print(f"Ignored warehouse_staff schema rebuild error: {e}")

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_warehouse_staff_vendor ON warehouse_staff(vendor_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_warehouse_staff_role ON warehouse_staff(role_id)")

    cursor.execute('''CREATE TABLE IF NOT EXISTS warehouse_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warehouse_id INTEGER NOT NULL,
        warehouse_partner_id INTEGER,
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
        FOREIGN KEY(warehouse_id) REFERENCES warehouses(id),
        FOREIGN KEY(product_id) REFERENCES products(id)
    )''')
    ensure_columns('warehouse_inventory', [
        ('warehouse_id', 'INTEGER'),
        ('warehouse_partner_id', 'INTEGER'),
        ('available_stock', 'INTEGER DEFAULT 0'),
        ('variant_id', 'INTEGER REFERENCES product_variants(id)')
    ])
    # Backfill warehouse_partner_id/warehouse_id so both naming conventions stay in sync.
    # Older DBs (created before the warehouse_id -> warehouse_partner_id rename) only have
    # warehouse_id; newer code reads COALESCE(warehouse_id, warehouse_partner_id). Keeping
    # both columns populated prevents "no such column" errors during checkout.
    try:
        cursor.execute("UPDATE warehouse_inventory SET warehouse_partner_id = warehouse_id WHERE warehouse_partner_id IS NULL AND warehouse_id IS NOT NULL")
        cursor.execute("UPDATE warehouse_inventory SET warehouse_id = warehouse_partner_id WHERE warehouse_id IS NULL AND warehouse_partner_id IS NOT NULL")
    except Exception as e:
        print(f"Ignored warehouse_inventory backfill error: {e}")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_wh_inv_wh ON warehouse_inventory(warehouse_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_wh_inv_partner ON warehouse_inventory(warehouse_partner_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_wh_inv_prod ON warehouse_inventory(product_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_wh_inv_variant ON warehouse_inventory(variant_id)")


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

    # --- Razorpay Payments ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      razorpay_order_id TEXT UNIQUE NOT NULL,
      razorpay_payment_id TEXT,
      razorpay_signature TEXT,
      amount INTEGER NOT NULL,
      currency TEXT DEFAULT 'INR',
      status TEXT DEFAULT 'created',
      payment_method TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(order_id) REFERENCES orders(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )''')
    ensure_columns('payments', [
        ('user_id', 'INTEGER'),
        ('amount', 'INTEGER'),
        ('currency', "TEXT DEFAULT 'INR'"),
        ('payment_method', 'TEXT'),
        ('razorpay_order_id', 'TEXT'),
        ('razorpay_payment_id', 'TEXT'),
        ('razorpay_signature', 'TEXT'),
        ('status', "TEXT DEFAULT 'created'"),
        ('updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP')
    ])

    cursor.execute('''CREATE TABLE IF NOT EXISTS payment_webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      razorpay_order_id TEXT,
      razorpay_payment_id TEXT,
      payload TEXT NOT NULL,
      processed INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    # --- Shiprocket Shipments ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS shipments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      shiprocket_order_id TEXT,
      shiprocket_shipment_id TEXT,
      awb_code TEXT,
      courier_name TEXT,
      courier_id INTEGER,
      status TEXT DEFAULT 'pending',
      estimated_delivery TEXT,
      pickup_scheduled_date TEXT,
      tracking_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(order_id) REFERENCES orders(id)
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS shipment_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shipment_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      location TEXT,
      description TEXT,
      timestamp TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(shipment_id) REFERENCES shipments(id)
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

    cursor.execute('''CREATE TABLE IF NOT EXISTS app_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        rating INTEGER,
        review_text TEXT,
        source TEXT DEFAULT 'in_app',
        prompt_shown_at TIMESTAMP,
        submitted_at TIMESTAMP,
        went_to_google INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
    ensure_columns('wallet_transactions', [('reason', 'TEXT'), ('reference_id', 'TEXT')])

    # --- Referral System ---
    ensure_columns('users', [('referral_code', 'TEXT')])
    cursor.execute('''CREATE TABLE IF NOT EXISTS referrals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_id INTEGER NOT NULL,
        referred_id INTEGER NOT NULL,
        referral_code TEXT,
        status TEXT DEFAULT 'pending',
        qualifying_order_id INTEGER,
        reward_given_at TIMESTAMP,
        instant_bonus_given INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(referrer_id) REFERENCES users(id),
        FOREIGN KEY(referred_id) REFERENCES users(id)
    )''')
    # instant_bonus_given tracks whether the ₹10 instant signup bonus was
    # already credited to BOTH users for this referral (old rows won't have it
    # until the backfill migration credits them).
    ensure_columns('referrals', [('instant_bonus_given', 'INTEGER DEFAULT 0')])
    # reward lifecycle: the order-triggered payout is NOT paid on delivery
    # anymore. On DELIVERED the referral is ARMEND (reward_armed=1) with a
    # reward_due_at = delivery time + return/cancellation/exchange window, and
    # the remainder is paid only once that window has passed AND the order is
    # still valid (no pending/approved refund). reward_paid prevents double pay.
    ensure_columns('referrals', [
        ('reward_armed', 'INTEGER DEFAULT 0'),
        ('reward_due_at', 'TIMESTAMP'),
        ('reward_paid', 'INTEGER DEFAULT 0'),
    ])
    # Guard against duplicate referral records (one per referred user) so the
    # instant bonus can never be credited twice.
    try:
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_id)")
    except Exception as e:
        print(f"Ignored referrals unique index error (pre-existing duplicates?): {e}")
    cursor.execute('''CREATE TABLE IF NOT EXISTS referral_attempts (
        user_id INTEGER UNIQUE,
        attempts INTEGER DEFAULT 0,
        blocked_at TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )''')

    # --- Admin & Support ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL UNIQUE, role TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))''')
    ensure_columns('admins', [('status', "TEXT DEFAULT 'active'")])
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

    cursor.execute('''CREATE TABLE IF NOT EXISTS issue_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        error_type TEXT NOT NULL,
        page TEXT NOT NULL,
        description TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    # --- Security ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, ip_address TEXT, status TEXT NOT NULL, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address)")
    cursor.execute('''CREATE TABLE IF NOT EXISTS security_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, alert_type TEXT NOT NULL, message TEXT NOT NULL, severity TEXT DEFAULT 'medium', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    ensure_columns('security_alerts', [('admin_id', 'INTEGER'), ('ip_address', 'TEXT'), ('resolved', 'INTEGER DEFAULT 0'), ('resolved_at', 'TIMESTAMP'), ('resolved_by', 'INTEGER')])
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_security_alerts_type ON security_alerts(alert_type)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_security_alerts_severity ON security_alerts(severity)")

    # --- Admin OTP Re-authentication (DB-backed so it survives gunicorn worker
    # restarts / multi-worker setups; OTP stored hashed, never in plaintext).
    # attempts increments on wrong guesses; the row is deleted once exhausted
    # (one-time use) — see app.py admin_request_otp / admin_verify_otp.
    cursor.execute('''CREATE TABLE IF NOT EXISTS admin_otps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT,
        name TEXT,
        otp_hash TEXT NOT NULL,
        otp_salt TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        attempts INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_admin_otps_email ON admin_otps(email)")

    # --- Settings & Marketing ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS system_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE NOT NULL, value TEXT NOT NULL)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS banners (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    ensure_columns('banners', [('subtitle', 'TEXT'), ('cta_text', 'TEXT'), ('image_url', 'TEXT'), ('badge_text', 'TEXT'), ('gradient', 'TEXT'), ('link_url', 'TEXT'), ('is_active', 'INTEGER DEFAULT 1'), ('overlay_opacity', 'REAL DEFAULT 0.5')])

    # --- Pincode Rules ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS pincode_rules (
        pincode TEXT PRIMARY KEY,
        cod_allowed INTEGER DEFAULT 1,
        prepaid_only INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

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
    # Older databases created before the is_read rename only had read_status;
    # ensure the columns the notification panel + mark-read route rely on.
    ensure_columns('notifications', [
        ('is_read', 'INTEGER DEFAULT 0'),
        ('metadata', 'TEXT'),
    ])

    cursor.execute('''CREATE TABLE IF NOT EXISTS user_push_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        fcm_token TEXT UNIQUE NOT NULL,
        device_type TEXT, -- 'ios', 'android', 'web'
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )''')
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON user_push_tokens(user_id)")

    # --- Web Push (VAPID) Subscriptions ---
    # Pure Web Push (no Firebase): each browser subscription is identified by
    # its unique endpoint URL; the p256dh/auth keys are needed to encrypt the
    # payload when the backend sends the notification (pywebpush).
    cursor.execute('''CREATE TABLE IF NOT EXISTS web_push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        endpoint TEXT UNIQUE NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )''')
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_web_push_user ON web_push_subscriptions(user_id)")

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
    ensure_columns('warehouse_applications', [('partner_id', 'TEXT'), ('phone', 'TEXT'), ('address', 'TEXT'), ('pincode', 'TEXT'), ('verification_status', 'TEXT'), ('warehouse_photos', 'TEXT'), ('document_upload', 'TEXT'), ('owner_image', 'TEXT'), ('kyc_details', 'TEXT'), ('request_mail_message', 'TEXT'), ('approved_by_id', 'INTEGER'), ('approved_by_name', 'TEXT'), ('warehouse_capacity', 'INTEGER'), ('warehouse_type', 'TEXT'), ('admin_notes', 'TEXT'), ('updated_at', 'TIMESTAMP'), ('approved_at', 'TIMESTAMP'), ('rejected_at', 'TIMESTAMP')])

    cursor.execute('''CREATE TABLE IF NOT EXISTS delivery_applications (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    ensure_columns('delivery_applications', [('partner_id', 'TEXT'), ('warehouse_id', 'INTEGER'), ('phone', 'TEXT'), ('verification_status', 'TEXT'), ('pan_card_image', 'TEXT'), ('aadhaar_front_image', 'TEXT'), ('aadhaar_back_image', 'TEXT'), ('face_verification_image', 'TEXT'), ('face_verification_status', 'TEXT'), ('aadhaar_extracted_address', 'TEXT'), ('aadhaar_qr_payload', 'TEXT')])

    # --- Offers & Discounts ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS offers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        offer_type TEXT NOT NULL, -- 'coupon', 'automatic', 'seasonal', 'daily'
        discount_type TEXT NOT NULL, -- 'percentage', 'flat'
        discount_value REAL NOT NULL,
        min_order_amount REAL DEFAULT 0,
        max_discount_amount REAL,
        target_type TEXT DEFAULT 'all', -- 'all', 'new_user', 'specific_user'
        applicable_on TEXT DEFAULT 'all', -- 'all', 'category', 'product'
        applicable_ids TEXT, -- JSON array
        coupon_code TEXT UNIQUE,
        usage_limit INTEGER,
        usage_count INTEGER DEFAULT 0,
        per_user_limit INTEGER DEFAULT 1,
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        is_active BOOLEAN DEFAULT 1,
        banner_image TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    # warehouse_id: NULL = platform-wide offer (admin-created); set = offer
    # created by that warehouse partner (multi-vendor). Discount evaluation
    # only applies warehouse offers to carts containing that warehouse's stock.
    ensure_columns('offers', [('warehouse_id', 'INTEGER')])

    cursor.execute('''CREATE TABLE IF NOT EXISTS offer_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        offer_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        order_id INTEGER NOT NULL,
        discount_applied REAL NOT NULL,
        used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(offer_id) REFERENCES offers(id),
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(order_id) REFERENCES orders(id)
    )''')

    # --- Analytics ---
    cursor.execute('''CREATE TABLE IF NOT EXISTS page_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      user_id INTEGER,
      page_path TEXT NOT NULL,
      page_title TEXT,
      referrer TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      device_type TEXT,
      browser TEXT,
      os TEXT,
      screen_resolution TEXT,
      country TEXT,
      duration_seconds INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      user_id INTEGER,
      event_type TEXT NOT NULL,
      event_category TEXT NOT NULL,
      event_label TEXT,
      event_value TEXT,
      page_path TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS analytics_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT UNIQUE NOT NULL,
      user_id INTEGER,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      page_count INTEGER DEFAULT 1,
      is_bounce INTEGER DEFAULT 1,
      device_type TEXT,
      browser TEXT,
      os TEXT,
      referrer TEXT,
      utm_source TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS search_queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      user_id INTEGER,
      query TEXT NOT NULL,
      results_count INTEGER DEFAULT 0,
      clicked_product_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )''')

    # --- Seeding & Defaults ---
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('platform_fee', '7')")
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('free_delivery_threshold', '499')")
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('cod_enabled', 'true')")
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('ticker_text', 'Free delivery on orders above ₹499')")
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('construction_mode', 'false')")
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('construction_mode_message', 'Our website is currently undergoing scheduled maintenance and upgrades. JDLX Mobile will be back online with exciting new premium products soon. Thank you for your patience!')")
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('auto_cod_protection', 'true')")
    # Session duration (hours) for regular store users before auto-logout.
    # Default 8760h = 365 days -> users stay logged in. Admin can change this.
    cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('user_session_duration_hours', '8760')")

    conn.commit()
    conn.close()
    print("Database initialized successfully.")

if __name__ == "__main__":
    init_db()

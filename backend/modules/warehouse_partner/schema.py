def _ensure_column(cursor, table_name, column_name, definition):
    cursor.execute(f"PRAGMA table_info({table_name})")
    columns = [row[1] for row in cursor.fetchall()]
    if column_name not in columns:
        cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")


def ensure_warehouse_partner_schema(cursor):
    cursor.execute(
        '''
        CREATE TABLE IF NOT EXISTS warehouse_partners (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_user_id INTEGER,
            warehouse_name TEXT NOT NULL,
            owner_name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            address TEXT NOT NULL,
            pincode TEXT NOT NULL,
            latitude REAL,
            longitude REAL,
            warehouse_capacity INTEGER DEFAULT 0,
            warehouse_type TEXT NOT NULL,
            document_upload TEXT,
            warehouse_photos TEXT,
            verification_status TEXT DEFAULT 'pending' CHECK(verification_status IN ('pending', 'approved', 'rejected')),
            onboarding_status TEXT DEFAULT 'application_submitted',
            active INTEGER DEFAULT 0,
            operations_status TEXT DEFAULT 'open',
            weather_status TEXT DEFAULT 'clear',
            service_radius_km REAL DEFAULT 4,
            admin_notes TEXT,
            approved_by INTEGER,
            approved_at TIMESTAMP,
            rejected_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(owner_user_id) REFERENCES users(id),
            FOREIGN KEY(approved_by) REFERENCES users(id)
        )
        '''
    )

    cursor.execute(
        '''
        CREATE TABLE IF NOT EXISTS warehouse_inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            warehouse_partner_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            stock_quantity INTEGER DEFAULT 0,
            reserved_stock INTEGER DEFAULT 0,
            low_stock_threshold INTEGER DEFAULT 5,
            bin_location TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(warehouse_partner_id) REFERENCES warehouse_partners(id) ON DELETE CASCADE,
            FOREIGN KEY(product_id) REFERENCES products(id),
            UNIQUE(warehouse_partner_id, product_id)
        )
        '''
    )

    cursor.execute(
        '''
        CREATE TABLE IF NOT EXISTS warehouse_staff (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            warehouse_partner_id INTEGER NOT NULL,
            user_id INTEGER,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT,
            role TEXT NOT NULL,
            status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
            invited_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(warehouse_partner_id) REFERENCES warehouse_partners(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(invited_by) REFERENCES users(id),
            UNIQUE(warehouse_partner_id, email)
        )
        '''
    )

    cursor.execute(
        '''
        CREATE TABLE IF NOT EXISTS warehouse_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL UNIQUE,
            warehouse_partner_id INTEGER NOT NULL,
            assignment_status TEXT DEFAULT 'assigned' CHECK(assignment_status IN (
                'assigned',
                'accepted',
                'packing',
                'packed',
                'ready_for_pickup',
                'courier_pickup_requested',
                'dispatched',
                'cancelled'
            )),
            assignment_source TEXT DEFAULT 'auto',
            assigned_distance_km REAL,
            shipping_label_url TEXT,
            courier_name TEXT,
            courier_tracking_number TEXT,
            dispatch_notes TEXT,
            accepted_at TIMESTAMP,
            packing_started_at TIMESTAMP,
            packed_at TIMESTAMP,
            ready_for_pickup_at TIMESTAMP,
            courier_pickup_requested_at TIMESTAMP,
            dispatched_at TIMESTAMP,
            cancelled_at TIMESTAMP,
            delivered_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(order_id) REFERENCES orders(id),
            FOREIGN KEY(warehouse_partner_id) REFERENCES warehouse_partners(id) ON DELETE CASCADE
        )
        '''
    )

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_warehouse_partners_status ON warehouse_partners(verification_status, active)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_warehouse_inventory_partner ON warehouse_inventory(warehouse_partner_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_warehouse_staff_partner ON warehouse_staff(warehouse_partner_id, status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_warehouse_orders_partner ON warehouse_orders(warehouse_partner_id, assignment_status)")

    _ensure_column(cursor, "notifications", "type", "TEXT DEFAULT 'SYSTEM'")
    _ensure_column(cursor, "notifications", "metadata", "TEXT")
    _ensure_column(cursor, "warehouse_partners", "operations_status", "TEXT DEFAULT 'open'")
    _ensure_column(cursor, "warehouse_partners", "weather_status", "TEXT DEFAULT 'clear'")
    _ensure_column(cursor, "warehouse_partners", "service_radius_km", "REAL DEFAULT 4")

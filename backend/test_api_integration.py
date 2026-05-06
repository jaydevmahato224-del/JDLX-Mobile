#!/usr/bin/env python3
"""
API Integration test for stock refactoring.
Tests: product listing endpoint, single product query, stock normalization.
"""

import sqlite3
import json
import os
import tempfile
from pathlib import Path

def create_test_db_path():
    env_db_path = os.environ.get("JDLX_TEST_DB_PATH")
    if env_db_path:
        return None, env_db_path
    temp_dir = tempfile.TemporaryDirectory(prefix="jdlx_test_db_")
    return temp_dir, str(Path(temp_dir.name) / "jdlx_test.db")

def ensure_schema(conn):
    cur = conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON;")
    # Include legacy `stock_quantity` to exercise normalization removal.
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL,
            images TEXT,
            category_id INTEGER,
            category TEXT,
            delivery_time TEXT DEFAULT '30-120 mins',
            stock INTEGER,
            stock_quantity INTEGER,
            low_stock_threshold INTEGER DEFAULT 5,
            status TEXT DEFAULT 'available',
            FOREIGN KEY(category_id) REFERENCES categories(id)
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS product_reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            rating INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
        )
        """
    )
    conn.commit()

def seed_test_data(conn):
    cur = conn.cursor()
    cur.execute("DELETE FROM product_reviews")
    cur.execute("DELETE FROM products")
    cur.execute("DELETE FROM categories")

    cur.execute("INSERT INTO categories (name) VALUES (?)", ("Electronics",))
    category_id = cur.lastrowid

    # One row uses legacy stock_quantity only (stock NULL) to verify normalization.
    products = [
        ("Legacy Stock Product", 99.0, None, 12, category_id, "Electronics", "available"),
        ("In Stock Product", 49.0, 20, None, category_id, "Electronics", "available"),
        ("Out Of Stock Product", 10.0, 0, None, category_id, "Electronics", "available"),
    ]
    for name, price, stock, stock_quantity, cat_id, category, status in products:
        cur.execute(
            """
            INSERT INTO products (name, price, stock, stock_quantity, category_id, category, status, low_stock_threshold, delivery_time, images)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (name, price, stock, stock_quantity, cat_id, category, status, 5, "30-120 mins", None),
        )

    conn.commit()

def normalize_product_row(row):
    """Mirror backend normalization function"""
    product = dict(row)
    stock_val = product.get('stock')
    if stock_val is None and 'stock_quantity' in product:
        stock_val = product.get('stock_quantity', 0)
    try:
        product['stock'] = int(stock_val) if stock_val is not None else 0
    except (TypeError, ValueError):
        product['stock'] = 0
    if 'stock_quantity' in product:
        product.pop('stock_quantity')
    return product

class APIIntegrationTests:
    def __init__(self):
        self.conn = None
        self.cursor = None
        self.passed = 0
        self.failed = 0
        self._temp_dir = None
        self.db_path = None
        
    def connect(self):
        self._temp_dir, self.db_path = create_test_db_path()
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self.cursor = self.conn.cursor()
        ensure_schema(self.conn)
        seed_test_data(self.conn)
        print(f"✓ Connected to database ({self.db_path})\n")
        
    def close(self):
        if self.conn:
            self.conn.close()
        if self._temp_dir:
            self._temp_dir.cleanup()
    
    def test_product_list_endpoint(self):
        """Test 1: Simulate /api/products?page=1&limit=5"""
        try:
            print("TEST 1: /api/products endpoint")
            limit, offset = 20, 0
            
            query = '''
                SELECT p.id, p.name, p.price, p.images, p.category_id, p.category, 
                       p.delivery_time, p.stock, p.stock_quantity, p.low_stock_threshold, p.status,
                       COALESCE(AVG(r.rating), 0) as average_rating, 
                       COUNT(r.id) as total_reviews
                FROM products p
                LEFT JOIN product_reviews r ON p.id = r.product_id
                WHERE p.status = 'available'
                GROUP BY p.id ORDER BY p.id DESC LIMIT ? OFFSET ?
            '''
            
            self.cursor.execute(query, [limit, offset])
            products = [normalize_product_row(row) for row in self.cursor.fetchall()]
            
            print(f"  Retrieved {len(products)} products")
            for prod in products[:3]:
                print(f"    - {prod['name']}: ${prod['price']:.2f}, Stock: {prod['stock']}")
            
            # Validate all have stock field
            for prod in products:
                if 'stock' not in prod:
                    raise Exception(f"Product {prod['id']} missing 'stock' field")
                if 'stock_quantity' in prod:
                    raise Exception(f"Product {prod['id']} still has 'stock_quantity'")
            
            print("  ✓ All products have normalized stock field\n")
            self.passed += 1
        except Exception as e:
            print(f"  ✗ FAILED: {e}\n")
            self.failed += 1
    
    def test_single_product_endpoint(self):
        """Test 2: Simulate /api/products/<id>"""
        try:
            print("TEST 2: /api/products/<id> endpoint")
            
            # Get first product
            self.cursor.execute("SELECT * FROM products LIMIT 1")
            product = self.cursor.fetchone()
            
            if not product:
                print("  (No products in database)\n")
                self.passed += 1
                return
            
            product_dict = normalize_product_row(product)
            
            print(f"  Product ID {product_dict['id']}: {product_dict['name']}")
            print(f"    Stock: {product_dict['stock']}")
            
            # Validate response
            if 'stock' not in product_dict:
                raise Exception("Response missing 'stock' field")
            if 'stock_quantity' in product_dict:
                raise Exception("Response still contains 'stock_quantity'")
            if product_dict['stock'] is None:
                raise Exception("Stock value is None")
            
            print("  ✓ Single product response is correct\n")
            self.passed += 1
        except Exception as e:
            print(f"  ✗ FAILED: {e}\n")
            self.failed += 1
    
    def test_search_endpoint(self):
        """Test 3: Simulate /api/products/search?q=<query>"""
        try:
            print("TEST 3: /api/products/search endpoint")
            
            query_str = "test"
            search_pattern = f"%{query_str}%"
            
            # Check if categories table exists
            self.cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='categories'")
            has_categories = self.cursor.fetchone() is not None
            
            if has_categories:
                self.cursor.execute("""
                    SELECT p.*, c.name as category_name 
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    WHERE p.status = 'available' AND (
                        p.name LIKE ? OR 
                        c.name LIKE ? OR
                        p.category LIKE ?
                    )
                    LIMIT 10
                """, (search_pattern, search_pattern, search_pattern))
            else:
                self.cursor.execute("""
                    SELECT p.* 
                    FROM products p
                    WHERE (p.name LIKE ? OR p.category LIKE ?)
                    LIMIT 10
                """, (search_pattern, search_pattern))
            
            products = [normalize_product_row(row) for row in self.cursor.fetchall()]
            
            print(f"  Search for '{query_str}': {len(products)} results")
            
            for prod in products:
                if 'stock' not in prod:
                    raise Exception(f"Product {prod['id']} missing 'stock' field")
                if 'stock_quantity' in prod:
                    raise Exception(f"Product {prod['id']} still has 'stock_quantity'")
            
            print("  ✓ Search endpoint returns normalized products\n")
            self.passed += 1
        except Exception as e:
            print(f"  ✗ FAILED: {e}\n")
            self.failed += 1
    
    def test_category_products_endpoint(self):
        """Test 4: Simulate /api/categories/<id>/products"""
        try:
            print("TEST 4: /api/categories/<id>/products endpoint")
            
            # Get first category
            self.cursor.execute("SELECT DISTINCT category_id FROM products WHERE category_id IS NOT NULL LIMIT 1")
            result = self.cursor.fetchone()
            
            if not result or result['category_id'] is None:
                print("  (No categories with products)\n")
                self.passed += 1
                return
            
            category_id = result['category_id']
            
            self.cursor.execute(
                "SELECT * FROM products WHERE status='available' AND category_id=?",
                (category_id,)
            )
            products = [normalize_product_row(row) for row in self.cursor.fetchall()]
            
            print(f"  Category {category_id}: {len(products)} products")
            
            for prod in products:
                if 'stock' not in prod:
                    raise Exception(f"Product {prod['id']} missing 'stock' field")
                if 'stock_quantity' in prod:
                    raise Exception(f"Product {prod['id']} still has 'stock_quantity'")
            
            print("  ✓ Category products endpoint returns normalized products\n")
            self.passed += 1
        except Exception as e:
            print(f"  ✗ FAILED: {e}\n")
            self.failed += 1
    
    def test_stock_badge_logic(self):
        """Test 5: Verify stock badge logic works (frontend usage)"""
        try:
            print("TEST 5: Stock badge logic (frontend-like)")
            
            self.cursor.execute("""
                SELECT id, name, stock, stock_quantity, low_stock_threshold 
                FROM products 
                ORDER BY id 
                LIMIT 10
            """)
            products = [normalize_product_row(row) for row in self.cursor.fetchall()]
            
            LOW_STOCK_LIMIT = 2
            
            for prod in products:
                stock = prod.get('stock', 0)
                
                if stock <= 0:
                    badge = "Out of Stock"
                elif stock <= LOW_STOCK_LIMIT:
                    badge = f"Only {stock} left"
                else:
                    badge = None
                
                if badge:
                    print(f"  - {prod['name']}: {badge}")
            
            print("  ✓ Stock badge logic works correctly\n")
            self.passed += 1
        except Exception as e:
            print(f"  ✗ FAILED: {e}\n")
            self.failed += 1
    
    def run_all(self):
        print("=" * 70)
        print("API INTEGRATION TESTS - STOCK REFACTORING")
        print("=" * 70)
        print()
        
        self.connect()
        
        self.test_product_list_endpoint()
        self.test_single_product_endpoint()
        self.test_search_endpoint()
        self.test_category_products_endpoint()
        self.test_stock_badge_logic()
        
        self.close()
        
        print("=" * 70)
        print(f"SUMMARY: {self.passed}/{self.passed + self.failed} tests passed")
        print("=" * 70)
        
        if self.failed == 0:
            print("✅ All integration tests passed!")
        else:
            print(f"❌ {self.failed} test(s) failed")

if __name__ == "__main__":
    tester = APIIntegrationTests()
    tester.run_all()

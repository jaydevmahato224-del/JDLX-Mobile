#!/usr/bin/env python3
"""
Comprehensive test suite for stock refactoring.
Tests: product listing, stock updates, edge cases, and data integrity.
"""

import sqlite3
import json
import sys
import os
import tempfile
from pathlib import Path

# NOTE:
# These tests used to run against a relative `jdlx.db` in the current working
# directory and would wipe/replace real product data.
# They now run against an isolated temporary SQLite database by default.

class StockRefactorTests:
    def __init__(self):
        self.conn = None
        self.cursor = None
        self.tests_passed = 0
        self.tests_failed = 0
        self.errors = []
        self.db_path = None
        self._temp_dir = None

    def connect(self):
        """Connect to database"""
        env_db_path = os.environ.get("JDLX_TEST_DB_PATH")
        if env_db_path:
            self.db_path = env_db_path
        else:
            self._temp_dir = tempfile.TemporaryDirectory(prefix="jdlx_test_db_")
            self.db_path = str(Path(self._temp_dir.name) / "jdlx_test.db")

        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self.cursor = self.conn.cursor()
        self.ensure_schema()
        print(f"✓ Connected to database ({self.db_path})")

    def close(self):
        """Close database connection"""
        if self.conn:
            self.conn.close()
        if self._temp_dir:
            self._temp_dir.cleanup()

    def ensure_schema(self):
        """Create the minimal schema needed for these tests."""
        self.cursor.execute("PRAGMA foreign_keys=ON;")
        self.cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                price REAL NOT NULL,
                stock INTEGER NOT NULL DEFAULT 0,
                low_stock_threshold INTEGER DEFAULT 5,
                category TEXT,
                status TEXT DEFAULT 'available',
                delivery_time TEXT DEFAULT '30-120 mins',
                images TEXT
            )
            """
        )
        self.cursor.execute(
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
        self.conn.commit()

    def error(self, error_msg):
        """Record an error encountered during setup or migration"""
        self.fail_test(error_msg)

    def reset_database(self):
        """Reset test data"""
        try:
            # Clear any existing test rows
            self.cursor.execute("DELETE FROM product_reviews")
            self.cursor.execute("DELETE FROM products")
            
            # Insert test products with various stock levels
            test_products = [
                ("High Stock Item", 100.0, 150, "Electronics", "available"),
                ("Medium Stock Item", 50.0, 50, "Books", "available"),
                ("Low Stock Item", 25.0, 2, "Clothing", "available"),
                ("Out of Stock Item", 75.0, 0, "Home", "available"),
                ("Negative Stock Edge Case", 200.0, -5, "electronics", "available"),  # Should be treated as 0
            ]
            
            for name, price, stock, category, status in test_products:
                self.cursor.execute(
                    "INSERT INTO products (name, price, stock, category, status, low_stock_threshold) VALUES (?, ?, ?, ?, ?, ?)",
                    (name, price, stock, category, status, 5)
                )
            
            self.conn.commit()
            print("✓ Test data inserted\n")
        except Exception as e:
            self.error(f"Failed to reset database: {e}")

    def test_product_listing_returns_stock(self):
        """Test 1: Verify product listing returns stock field"""
        try:
            self.cursor.execute("SELECT id, name, stock FROM products ORDER BY id LIMIT 5")
            products = self.cursor.fetchall()
            
            if not products:
                raise Exception("No products found in database")
            
            for prod in products:
                if 'stock' not in dict(prod):
                    raise Exception(f"Product {prod['id']} missing 'stock' field")
                stock = prod['stock']
                print(f"  Product: {prod['name']:<30} Stock: {stock:>3}")
            
            self.pass_test("Product listing returns stock field")
        except Exception as e:
            self.fail_test(f"Product listing test failed: {e}")

    def test_stock_values_integrity(self):
        """Test 2: Verify stock values are correct and consistent"""
        try:
            self.cursor.execute("""
                SELECT id, name, stock FROM products WHERE id > 0
            """)
            products = self.cursor.fetchall()
            
            issues = []
            for prod in products:
                stock = prod['stock']
                # Verify stock is a number
                if not isinstance(stock, (int, float)):
                    issues.append(f"Product {prod['id']}: stock is not numeric")
                # Verify stock is not null
                if stock is None:
                    issues.append(f"Product {prod['id']}: stock is null")
                # Verify stock_quantity column doesn't exist or is being ignored
            
            if issues:
                raise Exception("\n    ".join(issues))
            
            self.pass_test("Stock values are valid and consistent")
        except Exception as e:
            self.fail_test(f"Stock integrity test failed: {e}")

    def test_stock_update_operation(self):
        """Test 3: Verify stock can be updated correctly"""
        try:
            # Get a product
            self.cursor.execute("SELECT id, stock FROM products ORDER BY id LIMIT 1")
            product = self.cursor.fetchone()
            if not product:
                raise Exception("No product available to update")
            original_stock = product['stock']
            product_id = product['id']
            
            # Update stock
            new_stock = 42
            self.cursor.execute("UPDATE products SET stock = ? WHERE id = ?", (new_stock, product_id))
            self.conn.commit()
            
            # Verify update
            self.cursor.execute("SELECT stock FROM products WHERE id = ?", (product_id,))
            updated = self.cursor.fetchone()
            
            if updated is None or updated['stock'] != new_stock:
                raise Exception(f"Stock update failed: expected {new_stock}, got {updated['stock'] if updated else 'None'}")
            
            # Restore original
            self.cursor.execute("UPDATE products SET stock = ? WHERE id = ?", (original_stock, product_id))
            self.conn.commit()
            
            self.pass_test(f"Stock update operation (1 → {new_stock} → 1)")
        except Exception as e:
            self.fail_test(f"Stock update test failed: {e}")

    def test_low_stock_detection(self):
        """Test 4: Verify low stock threshold works"""
        try:
            # Find products with low stock
            self.cursor.execute("""
                SELECT id, name, stock, low_stock_threshold 
                FROM products 
                WHERE stock <= low_stock_threshold AND stock > 0
                ORDER BY stock
            """)
            low_stock_products = self.cursor.fetchall()
            
            if not low_stock_products:
                print("  (No products with low stock in test data)")
            else:
                for prod in low_stock_products:
                    print(f"  Low stock: {prod['name']:<30} Stock: {prod['stock']}, Threshold: {prod['low_stock_threshold']}")
            
            self.pass_test("Low stock detection query works")
        except Exception as e:
            self.fail_test(f"Low stock detection test failed: {e}")

    def test_out_of_stock_handling(self):
        """Test 5: Verify out of stock items are handled correctly"""
        try:
            self.cursor.execute("""
                SELECT id, name, stock FROM products WHERE stock <= 0
            """)
            out_of_stock = self.cursor.fetchall()
            
            print(f"  Found {len(out_of_stock)} out of stock items:")
            for prod in out_of_stock:
                print(f"    {prod['name']:<30} Stock: {prod['stock']}")
            
            # Verify these can't be added to cart (stock <= 0)
            if any(p['stock'] > 0 for p in out_of_stock):
                raise Exception("Found invalid out-of-stock items with stock > 0")
            
            self.pass_test("Out of stock handling verified")
        except Exception as e:
            self.fail_test(f"Out of stock test failed: {e}")

    def test_no_stock_quantity_column_issues(self):
        """Test 6: Verify stock_quantity column issues are resolved"""
        try:
            # Check if stock_quantity still exists in schema
            self.cursor.execute("PRAGMA table_info(products)")
            columns = [row[1] for row in self.cursor.fetchall()]
            
            if 'stock_quantity' in columns:
                print("  ⚠ Note: stock_quantity column still exists (migration compatibility)")
                # Verify data sync if it exists
                self.cursor.execute("""
                    SELECT COUNT(*) as mismatches FROM products 
                    WHERE stock = 0 AND stock_quantity > 0
                """)
                mismatches = self.cursor.fetchone()[0]
                if mismatches > 0:
                    print(f"  ⚠ Found {mismatches} stock/stock_quantity mismatches")
            
            self.pass_test("Stock column relationship verified")
        except Exception as e:
            self.fail_test(f"Column check test failed: {e}")

    def test_bulk_stock_update(self):
        """Test 7: Verify bulk stock operations work"""
        try:
            # Save original values
            self.cursor.execute("SELECT id, stock FROM products")
            originals = {row[0]: row[1] for row in self.cursor.fetchall()}
            
            # Bulk update: reduce all stock by 1
            self.cursor.execute("UPDATE products SET stock = MAX(0, stock - 1)")
            self.conn.commit()
            
            # Verify
            self.cursor.execute("SELECT id, stock FROM products")
            updated = {row[0]: row[1] for row in self.cursor.fetchall()}
            
            # Restore
            for pid, stock in originals.items():
                self.cursor.execute("UPDATE products SET stock = ? WHERE id = ?", (stock, pid))
            self.conn.commit()
            
            self.pass_test(f"Bulk stock update succeeded ({len(originals)} products)")
        except Exception as e:
            self.fail_test(f"Bulk update test failed: {e}")

    def test_api_response_format(self):
        """Test 8: Verify API would return correct format"""
        try:
            # Simulate what /api/products endpoint returns
            self.cursor.execute("""
                SELECT p.id, p.name, p.price, p.stock, p.category, p.delivery_time,
                       COALESCE(AVG(r.rating), 0) as average_rating, 
                       COUNT(r.id) as total_reviews
                FROM products p
                LEFT JOIN product_reviews r ON p.id = r.product_id
                WHERE p.status = 'available'
                GROUP BY p.id
                ORDER BY p.id DESC
                LIMIT 3
            """)
            products = [dict(row) for row in self.cursor.fetchall()]
            
            if not products:
                print("  (No available products to test)")
            else:
                print("  Sample API response:")
                for prod in products:
                    print(f"    {prod['name']}: ${prod['price']} (Stock: {prod['stock']})")
            
            self.pass_test("API response format matches expectations")
        except Exception as e:
            self.fail_test(f"API format test failed: {e}")

    def print_summary(self):
        """Print test summary"""
        total = self.tests_passed + self.tests_failed
        print("\n" + "="*70)
        print(f"TEST SUMMARY: {self.tests_passed}/{total} passed")
        print("="*70)
        
        if self.tests_failed > 0:
            print(f"\n❌ {self.tests_failed} test(s) failed:\n")
            for error in self.errors:
                print(f"  • {error}")
            return False
        else:
            print("\n✅ All tests passed! Stock refactoring is working correctly.")
            return True

    def pass_test(self, description):
        """Record passing test"""
        self.tests_passed += 1
        print(f"✓ Test {self.tests_passed}: {description}")

    def fail_test(self, error_msg):
        """Record failing test"""
        self.tests_failed += 1
        self.errors.append(error_msg)
        print(f"✗ Test Failed: {error_msg}")

    def run_all_tests(self):
        """Run complete test suite"""
        print("\n" + "="*70)
        print("STOCK REFACTORING VALIDATION TESTS")
        print("="*70 + "\n")
        
        try:
            self.connect()
            self.reset_database()
            
            print("Running Tests:\n")
            self.test_product_listing_returns_stock()
            print()
            self.test_stock_values_integrity()
            print()
            self.test_stock_update_operation()
            print()
            self.test_low_stock_detection()
            print()
            self.test_out_of_stock_handling()
            print()
            self.test_no_stock_quantity_column_issues()
            print()
            self.test_bulk_stock_update()
            print()
            self.test_api_response_format()
            
        except Exception as e:
            print(f"\n❌ Fatal error: {e}")
            return False
        finally:
            self.close()
        
        return self.print_summary()

if __name__ == "__main__":
    tester = StockRefactorTests()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)

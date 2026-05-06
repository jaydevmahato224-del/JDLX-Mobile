#!/usr/bin/env python3
"""
User Profile Migration Script
Ensures all profile-related database tables and columns exist.
Run this after updating database.py to create new profile tables.
"""

import sqlite3
from database import get_db, init_db

def migrate_profile_tables():
    """Create new profile-related tables if they don't exist"""
    try:
        # Re-initialize database to ensure all tables exist
        init_db()
        print("✓ Profile migration completed successfully!")
        return True
    except Exception as e:
        print(f"✗ Migration failed: {str(e)}")
        return False

if __name__ == "__main__":
    success = migrate_profile_tables()
    exit(0 if success else 1)

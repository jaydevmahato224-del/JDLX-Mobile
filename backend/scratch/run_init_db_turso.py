"""Run init_db() against Turso to ensure all ensure_columns migrations are applied."""
import os
import sys
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env'))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from database import init_db, USE_TURSO

print(f"USE_TURSO: {USE_TURSO}")
init_db()

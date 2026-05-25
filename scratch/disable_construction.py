import sqlite3
import os

db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../backend/jdlx.db')
conn = sqlite3.connect(db_path)
conn.execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('construction_mode', 'false')")
conn.commit()
conn.close()
print("Success: set construction_mode to false")

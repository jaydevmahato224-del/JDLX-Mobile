import sqlite3
c = sqlite3.connect('jdlx.db')
print(c.execute("SELECT sql FROM sqlite_master WHERE name='dark_stores'").fetchone()[0])
print(c.execute("SELECT sql FROM sqlite_master WHERE name='warehouses'").fetchone()[0])

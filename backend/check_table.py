import sqlite3
conn = sqlite3.connect('jdlx.db')
cursor = conn.cursor()
cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='product_reviews';")
print(cursor.fetchone())
conn.close()

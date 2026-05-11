import sqlite3

settings = [
    ('cod_enabled', 'true'),
    ('prepaid_delivery_charge', '49'),
    ('cod_delivery_charge', '99'),
    ('cod_advance_amount', '49'),
    ('free_delivery_enabled', 'true'),
    ('free_delivery_threshold', '499'),
    ('cod_alert_text', 'Save more with prepaid orders! FREE delivery on orders above ₹499.'),
    ('prepaid_recommendation_enabled', 'true'),
    ('priority_dispatch_enabled', 'true'),
    ('min_order_cod', '0')
]

conn = sqlite3.connect('jdlx.db')
cursor = conn.cursor()

for key, value in settings:
    cursor.execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)", (key, value))

conn.commit()
conn.close()
print("Settings seeded successfully.")

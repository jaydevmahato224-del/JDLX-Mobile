import sqlite3

def seed():
    conn = sqlite3.connect('jdlx.db')
    cursor = conn.cursor()

    # Create table if not exists (just in case)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS device_models (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            brand TEXT NOT NULL,
            type TEXT DEFAULT 'smartphone',
            status TEXT DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    models = [
        # Apple
        ("iPhone 15 Pro Max", "Apple"), ("iPhone 15 Pro", "Apple"), ("iPhone 15 Plus", "Apple"), ("iPhone 15", "Apple"),
        ("iPhone 14 Pro Max", "Apple"), ("iPhone 14 Pro", "Apple"), ("iPhone 14 Plus", "Apple"), ("iPhone 14", "Apple"),
        ("iPhone 13 Pro Max", "Apple"), ("iPhone 13 Pro", "Apple"), ("iPhone 13", "Apple"), ("iPhone 13 mini", "Apple"),
        ("iPhone 12 Pro Max", "Apple"), ("iPhone 12 Pro", "Apple"), ("iPhone 12", "Apple"), ("iPhone 12 mini", "Apple"),
        ("iPhone 11 Pro Max", "Apple"), ("iPhone 11 Pro", "Apple"), ("iPhone 11", "Apple"),
        ("iPhone SE (2022)", "Apple"), ("iPhone SE (2020)", "Apple"), ("iPhone XR", "Apple"), ("iPhone XS Max", "Apple"),
        
        # Samsung
        ("Galaxy S24 Ultra", "Samsung"), ("Galaxy S24+", "Samsung"), ("Galaxy S24", "Samsung"),
        ("Galaxy S23 Ultra", "Samsung"), ("Galaxy S23+", "Samsung"), ("Galaxy S23", "Samsung"),
        ("Galaxy S23 FE", "Samsung"), ("Galaxy S22 Ultra", "Samsung"), ("Galaxy S21 FE", "Samsung"),
        ("Galaxy S20 FE 5G", "Samsung"), ("Galaxy A55 5G", "Samsung"), ("Galaxy A35 5G", "Samsung"),
        ("Galaxy A54 5G", "Samsung"), ("Galaxy A34 5G", "Samsung"), ("Galaxy A15 5G", "Samsung"), ("Galaxy A14 5G", "Samsung"),
        ("Galaxy M55 5G", "Samsung"), ("Galaxy M34 5G", "Samsung"), ("Galaxy M15 5G", "Samsung"), ("Galaxy M14 5G", "Samsung"),
        ("Galaxy F54 5G", "Samsung"), ("Galaxy F34 5G", "Samsung"), ("Galaxy F15 5G", "Samsung"),
        ("Galaxy Z Fold 5", "Samsung"), ("Galaxy Z Flip 5", "Samsung"),
        
        # OnePlus
        ("OnePlus 12", "OnePlus"), ("OnePlus 12R", "OnePlus"), ("OnePlus 11", "OnePlus"), ("OnePlus 11R", "OnePlus"),
        ("OnePlus 10 Pro", "OnePlus"), ("OnePlus 10T", "OnePlus"), ("OnePlus 10R", "OnePlus"), ("OnePlus 9 Pro", "OnePlus"),
        ("OnePlus Nord 3 5G", "OnePlus"), ("OnePlus Nord CE 3 5G", "OnePlus"), ("OnePlus Nord CE 3 Lite 5G", "OnePlus"),
        ("OnePlus Nord 2T 5G", "OnePlus"), ("OnePlus Nord CE 2 Lite 5G", "OnePlus"),
        
        # Xiaomi / Redmi / Poco
        ("Xiaomi 14 Ultra", "Xiaomi"), ("Xiaomi 14", "Xiaomi"), ("Xiaomi 13 Pro", "Xiaomi"),
        ("Redmi Note 13 Pro+", "Xiaomi"), ("Redmi Note 13 Pro", "Xiaomi"), ("Redmi Note 13", "Xiaomi"),
        ("Redmi Note 12 Pro+", "Xiaomi"), ("Redmi Note 12 Pro", "Xiaomi"), ("Redmi Note 12", "Xiaomi"),
        ("Redmi 13C 5G", "Xiaomi"), ("Redmi 12 5G", "Xiaomi"), ("Redmi A3", "Xiaomi"), ("Redmi A2", "Xiaomi"),
        ("Poco X6 Pro", "Poco"), ("Poco X6", "Poco"), ("Poco M6 Pro", "Poco"), ("Poco F5", "Poco"), ("Poco C65", "Poco"),
        
        # Vivo
        ("Vivo X100 Pro", "Vivo"), ("Vivo X100", "Vivo"), ("Vivo V30 Pro", "Vivo"), ("Vivo V30", "Vivo"),
        ("Vivo V29 Pro", "Vivo"), ("Vivo V29", "Vivo"), ("Vivo V27 Pro", "Vivo"), ("Vivo V27", "Vivo"),
        ("Vivo T2 Pro 5G", "Vivo"), ("Vivo T2x 5G", "Vivo"), ("Vivo Y200 5G", "Vivo"), ("Vivo Y28 5G", "Vivo"),
        ("Vivo Y56 5G", "Vivo"), ("Vivo Y16", "Vivo"),
        
        # iQOO
        ("iQOO 12", "iQOO"), ("iQOO Neo 9 Pro", "iQOO"), ("iQOO Neo 7 Pro", "iQOO"),
        ("iQOO Z9 5G", "iQOO"), ("iQOO Z7 Pro 5G", "iQOO"), ("iQOO Z7s 5G", "iQOO"),
        
        # Oppo
        ("Oppo Reno 11 Pro", "Oppo"), ("Oppo Reno 11", "Oppo"), ("Oppo Reno 10 Pro+", "Oppo"),
        ("Oppo F25 Pro 5G", "Oppo"), ("Oppo F21s Pro", "Oppo"), ("Oppo A79 5G", "Oppo"), ("Oppo A59 5G", "Oppo"),
        
        # Realme
        ("Realme P1 Pro 5G", "Realme"), ("Realme P1 5G", "Realme"), ("Realme 12 Pro+", "Realme"), ("Realme 12 Pro", "Realme"),
        ("Realme 12+ 5G", "Realme"), ("Realme 12 5G", "Realme"), ("Realme 11 Pro+", "Realme"), ("Realme 11 Pro", "Realme"),
        ("Realme Narzo 70 Pro 5G", "Realme"), ("Realme Narzo 60 Pro", "Realme"), ("Realme Narzo N53", "Realme"),
        ("Realme GT 2 Pro", "Realme"), ("Realme C67 5G", "Realme"), ("Realme C55", "Realme"), ("Realme C53", "Realme"),
        
        # Motorola
        ("Moto Edge 50 Pro", "Motorola"), ("Moto Edge 40 Pro", "Motorola"), ("Moto Edge 40", "Motorola"), ("Moto Edge 40 Neo", "Motorola"),
        ("Moto G84 5G", "Motorola"), ("Moto G54 5G", "Motorola"), ("Moto G34 5G", "Motorola"), ("Moto Razr 40 Ultra", "Motorola"),
        
        # Nothing
        ("Nothing Phone (2)", "Nothing"), ("Nothing Phone (1)", "Nothing"), ("Nothing Phone (2a)", "Nothing"),
        
        # Google
        ("Pixel 8 Pro", "Google"), ("Pixel 8", "Google"), ("Pixel 7 Pro", "Google"), ("Pixel 7", "Google"), ("Pixel 7a", "Google"),

        # Infinix
        ("Infinix Note 40 Pro", "Infinix"), ("Infinix Zero 30 5G", "Infinix"), ("Infinix Smart 8", "Infinix"), ("Infinix Hot 40 Pro", "Infinix"),
        
        # Tecno
        ("Tecno Phantom V Flip", "Tecno"), ("Tecno Pova 6 Pro", "Tecno"), ("Tecno Camon 20 Pro", "Tecno"), ("Tecno Spark 20", "Tecno"),
        
        # Lava (Indian Brand)
        ("Lava Agni 2 5G", "Lava"), ("Lava Blaze Curve 5G", "Lava"), ("Lava Yuva 3 Pro", "Lava"), ("Lava O2", "Lava"),
    ]

    # Clear existing to avoid duplicates if re-run (or use INSERT OR IGNORE)
    cursor.execute("DELETE FROM device_models")
    
    cursor.executemany(
        "INSERT INTO device_models (name, brand, type, status) VALUES (?, ?, 'smartphone', 'active')",
        models
    )

    conn.commit()
    print(f"Successfully seeded {len(models)} device models.")
    conn.close()

if __name__ == "__main__":
    seed()

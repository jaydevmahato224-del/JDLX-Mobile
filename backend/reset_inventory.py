import sqlite3

DATABASE_PATH = 'jdlx.db'

def reset_and_seed():
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    # Clear existing data
    cursor.execute("DELETE FROM products")
    cursor.execute("DELETE FROM categories")
    
    # Seed Categories
    categories = [
        (1, "Chargers", "🔌"),
        (2, "Cables", "🧵"),
        (3, "Earphones", "🎧"),
        (4, "Power Banks", "🔋"),
        (5, "Cases", "📱"),
        (6, "Accessories", "⚙️")
    ]
    cursor.executemany(
        "INSERT INTO categories (id, name, icon) VALUES (?, ?, ?)",
        categories
    )
    
    # Seed Products for Mobile Accessories
    products = [
        ("20W Fast PD Charger", 499.0, 50, "Chargers", 1, "10 mins", "available", "https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=500&q=80"),
        ("65W GaN Multi-Port Charger", 1299.0, 30, "Chargers", 1, "15 mins", "available", "https://images.unsplash.com/photo-1628126235206-5260b9ea6441?w=500&q=80"),
        ("Braided USB-C to USB-C Cable (1m)", 299.0, 100, "Cables", 2, "10 mins", "available", "https://placehold.co/400x400/0D1B2A/FFFFFF?text=USB-C+Cable"),
        ("Lightning to USB-A Cable", 249.0, 150, "Cables", 2, "10 mins", "available", "https://placehold.co/400x400/0D1B2A/FFFFFF?text=Lightning+Cable"),
        ("True Wireless ANC Earbuds", 1999.0, 25, "Earphones", 3, "20 mins", "available", "https://images.unsplash.com/photo-1606220588913-b3eea41bce8b?w=500&q=80"),
        ("Wired In-Ear Headphones with Mic", 399.0, 40, "Earphones", 3, "15 mins", "available", "https://images.unsplash.com/photo-1599815025752-9d37537bc2c0?w=500&q=80"),
        ("10000mAh Slim Power Bank", 999.0, 45, "Power Banks", 4, "20 mins", "available", "https://placehold.co/400x400/0D1B2A/FFFFFF?text=10000mAh+Bank"),
        ("20000mAh High-Capacity Power Bank", 1599.0, 20, "Power Banks", 4, "30 mins", "available", "https://placehold.co/400x400/0D1B2A/FFFFFF?text=20000mAh+Bank"),
        ("Clear Silicon Case for iPhone 15", 499.0, 60, "Cases", 5, "15 mins", "available", "https://images.unsplash.com/photo-1603539126388-c70ea92543e4?w=500&q=80"),
        ("Rugged Armor Case for Galaxy S24", 599.0, 50, "Cases", 5, "15 mins", "available", "https://images.unsplash.com/photo-1627916629949-06757afb9ff8?w=500&q=80"),
        ("Magnetic Wireless Charger Pad", 899.0, 35, "Chargers", 1, "15 mins", "available", "https://placehold.co/400x400/0D1B2A/FFFFFF?text=MagSafe+Pad"),
        ("Adjustable Phone Stand", 199.0, 80, "Accessories", 6, "10 mins", "available", "https://placehold.co/400x400/0D1B2A/FFFFFF?text=Phone+Stand"),
        ("USB-C to 3.5mm Audio Adapter", 149.0, 120, "Accessories", 6, "10 mins", "available", "https://placehold.co/400x400/0D1B2A/FFFFFF?text=Audio+Adapter"),
        ("Car Vent Mount Phone Holder", 349.0, 40, "Accessories", 6, "15 mins", "available", "https://placehold.co/400x400/0D1B2A/FFFFFF?text=Car+Mount"),
        ("Screen Protector Tempered Glass", 199.0, 200, "Accessories", 6, "10 mins", "available", "https://placehold.co/400x400/0D1B2A/FFFFFF?text=Temp+Glass"),
        ("Type-C OTG Flash Drive 64GB", 799.0, 30, "Accessories", 6, "20 mins", "available", "https://placehold.co/400x400/0D1B2A/FFFFFF?text=OTG+Drive"),
    ]
    
    cursor.executemany(
        """
        INSERT INTO products 
        (name, price, stock, category, category_id, delivery_time, status, images) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]) for p in products]
    )
    
    conn.commit()
    conn.close()
    print("Database successfully reset with Mobile Accessories inventory.")

if __name__ == "__main__":
    reset_and_seed()

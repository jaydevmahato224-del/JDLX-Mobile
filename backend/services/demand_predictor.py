import datetime
import sqlite3
import os
from database import get_db_connection

def calculate_demand_predictions(store_id=None):
    """
    Analyzes `product_sales` across 1, 7, and 30 day windows.
    Returns a unified array forecasting the required 7-day restock quantities.
    If `store_id` is provided, limits analytics to that specific Dark Store.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    predictions = []
    try:
        store_filter = ""
        params = []
        if store_id:
            store_filter = "AND s.store_id = ?"
            params.append(store_id)
            
        # 1. Fetch the overall sales telemetry for the last 30 days grouped by product
        # Using SQLite datetime natively for cross-platform compatibility
        query = f'''
            SELECT 
                s.product_id,
                p.name as product_name,
                p.category,
                COALESCE(SUM(CASE WHEN s.timestamp >= datetime('now', '-1 day') THEN s.quantity_sold ELSE 0 END), 0) as sales_24h,
                COALESCE(SUM(CASE WHEN s.timestamp >= datetime('now', '-7 days') THEN s.quantity_sold ELSE 0 END), 0) as sales_7d,
                COALESCE(SUM(CASE WHEN s.timestamp >= datetime('now', '-30 days') THEN s.quantity_sold ELSE 0 END), 0) as sales_30d,
                p.stock as current_global_stock
            FROM product_sales s
            JOIN products p ON s.product_id = p.id
            WHERE s.timestamp >= datetime('now', '-30 days') {store_filter}
            GROUP BY s.product_id
            ORDER BY sales_7d DESC
        '''
        
        cursor.execute(query, params)
        sales_matrix = cursor.fetchall()
        
        for row in sales_matrix:
            sales_7d = row['sales_7d']
            daily_avg = sales_7d / 7.0 if sales_7d > 0 else 0
            
            # Predict demand for the next exactly 7 days
            next_week_demand = int(round(daily_avg * 7))
            
            # Local Store Context Calculation vs Global Stock
            current_local_stock = 0
            if store_id:
                cursor.execute("SELECT stock_quantity FROM store_inventory WHERE store_id = ? AND product_id = ?", (store_id, row['product_id']))
                inv = cursor.fetchone()
                current_local_stock = inv['stock_quantity'] if inv else 0
            else:
                current_local_stock = row['current_global_stock']
                
            # Smart AI Rec: Only restock if we don't have enough buffer for next week + 20% safety margin.
            safety_demand = int(round(next_week_demand * 1.2))
            restock_need = max(0, safety_demand - current_local_stock)
            
            # Risk Analysis Heuristic
            risk_level = "Safe"
            if current_local_stock <= 0 and next_week_demand > 0:
                risk_level = "Critical"
            elif restock_need > 0:
                risk_level = "Warning"
                
            predictions.append({
                "product_id": row['product_id'],
                "product_name": row['product_name'],
                "category": row['category'],
                "sales_24h": row['sales_24h'],
                "sales_7d": sales_7d,
                "sales_30d": row['sales_30d'],
                "daily_avg_velocity": round(daily_avg, 2),
                "current_stock": current_local_stock,
                "predicted_7d_demand": next_week_demand,
                "recommended_restock": restock_need,
                "risk_level": risk_level
            })
            
    except Exception as e:
        print(f"[Demand Predictor] Engine Crash: {e}")
    finally:
        conn.close()
        
    return predictions

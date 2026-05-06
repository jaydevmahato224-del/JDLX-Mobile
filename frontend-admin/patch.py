import os

filepath = 'c:/Users/Jaydev Mahato/OneDrive/Desktop/JDLX_MOBILE/frontend/src/pages/AdminDashboard.jsx'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("localStorage.getItem('token')", "localStorage.getItem('adminToken') || localStorage.getItem('token')")
content = content.replace(".then(data => setStats(data))", ".then(data => { if (!data.error) setStats(prev => ({...prev, ...data})) })")
content = content.replace(".then(data => setWarehouseStats(data))", ".then(data => { if (!data.error) setWarehouseStats(data) })")
content = content.replace(".then(data => setSystemStats(data))", ".then(data => { if (!data.error) setSystemStats(data) })")
content = content.replace(".then(data => setSecurityAlerts(data))", ".then(data => { if (!data.error) setSecurityAlerts(data) })")

content = content.replace("warehouseStats.store_stats.length", "(warehouseStats.store_stats || []).length")
content = content.replace("warehouseStats.store_stats.map", "(warehouseStats.store_stats || []).map")
content = content.replace("warehouseStats.low_stock_alerts.length", "(warehouseStats.low_stock_alerts || []).length")
content = content.replace("warehouseStats.low_stock_alerts.map", "(warehouseStats.low_stock_alerts || []).map")

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Patch applied successfully")

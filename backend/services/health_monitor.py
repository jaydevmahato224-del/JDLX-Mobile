import sqlite3
import psutil
import time
import os

DATABASE_PATH = "jdlx.db"

def check_database_connection():
    try:
        start_time = time.time()
        conn = sqlite3.connect(DATABASE_PATH, timeout=5.0)
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        conn.close()
        ms_latency = round((time.time() - start_time) * 1000, 2)
        return {"status": "healthy", "latency_ms": ms_latency}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e), "latency_ms": -1}

def get_system_health_metrics():
    """
    Collects real-time hardware and infrastructure health metrics.
    """
    # CPU
    cpu_percent = psutil.cpu_percent(interval=0.1)
    cpu_cores = psutil.cpu_count(logical=True)
    
    # Memory
    mem = psutil.virtual_memory()
    memory_used_mb = round(mem.used / (1024 * 1024), 2)
    memory_total_mb = round(mem.total / (1024 * 1024), 2)
    memory_percent = mem.percent
    
    # Disk (using cwd to check current partition)
    disk = psutil.disk_usage(os.getcwd())
    disk_used_gb = round(disk.used / (1024**3), 2)
    disk_total_gb = round(disk.total / (1024**3), 2)
    disk_percent = disk.percent

    # Database
    db_health = check_database_connection()
    
    # Auth Service simulation (since OAuth relies on external Google)
    auth_status = "operational"

    return {
        "timestamp": time.time(),
        "cpu": {
            "usage_percent": cpu_percent,
            "cores": cpu_cores
        },
        "memory": {
            "used_mb": memory_used_mb,
            "total_mb": memory_total_mb,
            "usage_percent": memory_percent
        },
        "disk": {
            "used_gb": disk_used_gb,
            "total_gb": disk_total_gb,
            "usage_percent": disk_percent
        },
        "database": db_health,
        "auth_service": {
            "status": auth_status
        },
        "status": "healthy" if db_health["status"] == "healthy" and cpu_percent < 90 else "degraded"
    }

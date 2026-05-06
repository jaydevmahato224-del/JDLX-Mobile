import os
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from zipfile import BadZipFile, ZipFile


ROOT_DIR = Path(__file__).resolve().parents[2]
BACKUPS_DIR = ROOT_DIR / "backups"
DB_BACKUPS_DIR = BACKUPS_DIR / "database"
FILES_BACKUPS_DIR = BACKUPS_DIR / "files"
SNAPSHOT_DIR = BACKUPS_DIR / "snapshots"


def _now_stamp() -> str:
    return datetime.utcnow().strftime("%Y%m%d_%H%M%S")


def _resolve_database_path() -> Path:
    backend_db = ROOT_DIR / "backend" / "jdlx.db"
    if backend_db.exists():
        return backend_db
    return ROOT_DIR / "jdlx.db"


def _resolve_backup_path(relative_path: str) -> Path:
    normalized = os.path.normpath((relative_path or "").strip()).replace("\\", "/")
    if not normalized or normalized.startswith("/") or normalized.startswith("../") or ".." in normalized.split("/"):
        raise ValueError("Invalid backup path.")

    target = (ROOT_DIR / normalized).resolve()
    allowed = BACKUPS_DIR.resolve()
    if not str(target).startswith(str(allowed)):
        raise ValueError("Backup path is not allowed.")
    if not target.exists() or not target.is_file():
        raise FileNotFoundError("Backup file not found.")
    return target


def _safe_extract_zip(zip_path: Path, destination: Path) -> int:
    extracted = 0
    with ZipFile(zip_path, "r") as archive:
        for member in archive.infolist():
            filename = member.filename.replace("\\", "/")
            if filename.startswith("/") or ".." in Path(filename).parts:
                continue
            target_path = (destination / filename).resolve()
            if not str(target_path).startswith(str(destination.resolve())):
                continue
            archive.extract(member, destination)
            extracted += 1
    return extracted


def _create_recovery_snapshot() -> dict:
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = _now_stamp()
    snapshot_db = SNAPSHOT_DIR / f"snapshot_db_{stamp}.db"
    snapshot_files = SNAPSHOT_DIR / f"snapshot_files_{stamp}.zip"

    db_path = _resolve_database_path()
    if db_path.exists():
        shutil.copy2(db_path, snapshot_db)

    with ZipFile(snapshot_files, "w") as archive:
        candidates = [
            ROOT_DIR / "uploads",
            ROOT_DIR / "backend" / "static" / "uploads",
            ROOT_DIR / "logs",
            ROOT_DIR / "backend" / "logs",
            ROOT_DIR / "backend" / "backend" / "logs",
            ROOT_DIR / ".env",
            ROOT_DIR / "backend" / ".env",
            ROOT_DIR / "backend" / ".env.example",
        ]
        for path in candidates:
            if not path.exists():
                continue
            if path.is_file():
                archive.write(path, arcname=str(path.relative_to(ROOT_DIR)))
                continue
            for item in path.rglob("*"):
                if item.is_file():
                    archive.write(item, arcname=str(item.relative_to(ROOT_DIR)))

    return {
        "database_snapshot": str(snapshot_db) if snapshot_db.exists() else None,
        "files_snapshot": str(snapshot_files),
    }


def verify_backup_integrity(relative_backup_path: str) -> dict:
    backup_path = _resolve_backup_path(relative_backup_path)

    if backup_path.suffix.lower() == ".db":
        try:
            with sqlite3.connect(backup_path) as conn:
                cursor = conn.cursor()
                cursor.execute("PRAGMA integrity_check")
                result = cursor.fetchone()
            ok = bool(result and str(result[0]).lower() == "ok")
            return {
                "file": str(backup_path.relative_to(ROOT_DIR)),
                "valid": ok,
                "type": "database",
                "details": str(result[0]) if result else "No integrity output",
            }
        except Exception as exc:
            return {
                "file": str(backup_path.relative_to(ROOT_DIR)),
                "valid": False,
                "type": "database",
                "details": str(exc),
            }

    if backup_path.suffix.lower() == ".zip":
        try:
            with ZipFile(backup_path, "r") as archive:
                bad_file = archive.testzip()
            return {
                "file": str(backup_path.relative_to(ROOT_DIR)),
                "valid": bad_file is None,
                "type": "files",
                "details": "OK" if bad_file is None else f"Corrupted entry: {bad_file}",
            }
        except BadZipFile as exc:
            return {
                "file": str(backup_path.relative_to(ROOT_DIR)),
                "valid": False,
                "type": "files",
                "details": str(exc),
            }
        except Exception as exc:
            return {
                "file": str(backup_path.relative_to(ROOT_DIR)),
                "valid": False,
                "type": "files",
                "details": str(exc),
            }

    return {
        "file": str(backup_path.relative_to(ROOT_DIR)),
        "valid": backup_path.stat().st_size > 0,
        "type": "unknown",
        "details": "Basic size check",
    }


def restore_database(relative_backup_path: str) -> dict:
    backup_path = _resolve_backup_path(relative_backup_path)
    if backup_path.suffix.lower() != ".db":
        raise ValueError("Selected backup is not a database backup.")

    integrity = verify_backup_integrity(relative_backup_path)
    if not integrity["valid"]:
        raise ValueError(f"Backup integrity failed: {integrity['details']}")

    snapshot = _create_recovery_snapshot()
    destination = _resolve_database_path()
    temp_target = destination.with_suffix(".restore_tmp")
    shutil.copy2(backup_path, temp_target)
    os.replace(temp_target, destination)

    return {
        "restored_backup": str(backup_path.relative_to(ROOT_DIR)),
        "database_path": str(destination),
        "snapshot": snapshot,
    }


def restore_files(relative_backup_path: str) -> dict:
    backup_path = _resolve_backup_path(relative_backup_path)
    if backup_path.suffix.lower() != ".zip":
        raise ValueError("Selected backup is not a file backup zip.")

    integrity = verify_backup_integrity(relative_backup_path)
    if not integrity["valid"]:
        raise ValueError(f"Backup integrity failed: {integrity['details']}")

    snapshot = _create_recovery_snapshot()
    extracted_count = _safe_extract_zip(backup_path, ROOT_DIR)
    return {
        "restored_backup": str(backup_path.relative_to(ROOT_DIR)),
        "extracted_entries": extracted_count,
        "snapshot": snapshot,
    }


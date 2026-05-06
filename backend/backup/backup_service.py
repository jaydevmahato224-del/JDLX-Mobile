import os
import sqlite3
from datetime import datetime
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT_DIR = Path(__file__).resolve().parents[2]
BACKUP_DIR = ROOT_DIR / "backups"
DB_BACKUP_DIR = BACKUP_DIR / "database"
FILES_BACKUP_DIR = BACKUP_DIR / "files"


def _resolve_database_path() -> Path:
    backend_db = ROOT_DIR / "backend" / "jdlx.db"
    if backend_db.exists():
        return backend_db
    return ROOT_DIR / "jdlx.db"


def _ensure_backup_dirs() -> None:
    DB_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    FILES_BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def _now_stamp() -> str:
    return datetime.utcnow().strftime("%Y%m%d_%H%M")


def backup_database() -> str:
    _ensure_backup_dirs()
    source_db = _resolve_database_path()
    stamp = _now_stamp()
    destination = DB_BACKUP_DIR / f"database_{stamp}.db"

    with sqlite3.connect(source_db) as source:
        with sqlite3.connect(destination) as target:
            source.backup(target)
    return str(destination)


def _zip_target(source_path: Path, output_zip: Path) -> str | None:
    if not source_path.exists():
        return None

    with ZipFile(output_zip, "w", compression=ZIP_DEFLATED) as archive:
        if source_path.is_file():
            archive.write(source_path, arcname=source_path.name)
            return str(output_zip)

        for item in source_path.rglob("*"):
            if item.is_file():
                archive.write(item, arcname=str(item.relative_to(ROOT_DIR)))
    return str(output_zip)


def backup_uploaded_images() -> str | None:
    _ensure_backup_dirs()
    stamp = _now_stamp()
    destination = FILES_BACKUP_DIR / f"uploaded_images_{stamp}.zip"
    for candidate in (ROOT_DIR / "uploads", ROOT_DIR / "backend" / "static" / "uploads"):
        zipped = _zip_target(candidate, destination)
        if zipped:
            return zipped
    return None


def backup_logs() -> str | None:
    _ensure_backup_dirs()
    stamp = _now_stamp()
    destination = FILES_BACKUP_DIR / f"system_logs_{stamp}.zip"
    for candidate in (ROOT_DIR / "logs", ROOT_DIR / "backend" / "logs", ROOT_DIR / "backend" / "backend" / "logs"):
        zipped = _zip_target(candidate, destination)
        if zipped:
            return zipped
    return None


def backup_configuration_files() -> str:
    _ensure_backup_dirs()
    stamp = _now_stamp()
    destination = FILES_BACKUP_DIR / f"configuration_{stamp}.zip"
    with ZipFile(destination, "w", compression=ZIP_DEFLATED) as archive:
        config_files = [
            ROOT_DIR / ".env",
            ROOT_DIR / "backend" / ".env",
            ROOT_DIR / "backend" / ".env.example",
        ]
        for path in config_files:
            if path.exists() and path.is_file():
                archive.write(path, arcname=str(path.relative_to(ROOT_DIR)))
    return str(destination)


def create_full_backup() -> dict:
    return {
        "database_backup": backup_database(),
        "uploaded_images_backup": backup_uploaded_images(),
        "logs_backup": backup_logs(),
        "configuration_backup": backup_configuration_files(),
    }


def list_backups() -> list[dict]:
    _ensure_backup_dirs()
    items = []
    for directory in (DB_BACKUP_DIR, FILES_BACKUP_DIR):
        category = "database" if directory == DB_BACKUP_DIR else "files"
        for file_path in sorted(directory.glob("*"), key=lambda p: p.stat().st_mtime, reverse=True):
            if not file_path.is_file():
                continue
            items.append(
                {
                    "name": file_path.name,
                    "category": category,
                    "size": file_path.stat().st_size,
                    "modified_at": datetime.utcfromtimestamp(file_path.stat().st_mtime).isoformat() + "Z",
                    "relative_path": str(file_path.relative_to(ROOT_DIR)),
                }
            )
    return items


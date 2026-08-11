#!/usr/bin/env python3
"""
Migration: Re-upload locally-stored product images to cloud storage and update DB.

Root cause
----------
The warehouse image upload endpoint (/api/warehouse/upload) originally saved
files to the server's local disk (backend/static/uploads/product_images/) and
stored relative URLs like `/static/uploads/product_images/<name>` in the
`products.images` JSON column. On Render the filesystem is ephemeral — those
files are wiped on every redeploy, so the stored URLs 404 and the storefront
shows only the BlurImage text fallback instead of the actual image.

This script:
1. Scans all products (and product_variants) whose `images` JSON contains a
   `/static/uploads/product_images/...` reference.
2. For each referenced file found in `backend/static/uploads/product_images/`,
   uploads it to persistent cloud storage (ImgBB -> Catbox -> Telegra.ph,
   via the same cloud_image_service the admin upload uses).
3. Rewrites the JSON `images` arrays to replace local paths with permanent
   cloud URLs, in the database (local SQLite or Turso via get_db()).

Usage
-----
    # Preview only (default, no uploads, no writes)
    python migrate_product_images_to_cloud.py

    # Apply to the default database (Turso if creds present, else local)
    python migrate_product_images_to_cloud.py --apply

    # Force local SQLite DB (jdlx.db)
    python migrate_product_images_to_cloud.py --apply --local

    # Force Turso (production) even if default would be local
    python migrate_product_images_to_cloud.py --apply --turso

Notes
-----
- Safe to re-run: already-cloud URLs are left untouched, and only local
  `/static/uploads/product_images/` paths are rewritten. Uploaded files are
  cached in-memory per run, so files referenced by multiple rows upload once.
- Dry run performs NO network uploads and NO DB writes.
- If a referenced file is missing locally, it is skipped and reported.
- Uploading ~37 files takes a couple of minutes (Catbox ~3s per file).
- If the process is killed mid-upload (before commit), the DB is untouched but
  files already uploaded remain on the cloud host; a re-run re-uploads them,
  creating duplicate cloud URLs. This is acceptable for a one-off migration.
"""
import argparse
import json
import os
import re
import sys


def _has_turso():
    """True if Turso credentials are present in the environment/.env."""
    try:
        from database import TURSO_URL, TURSO_TOKEN
        return bool(TURSO_URL and TURSO_TOKEN)
    except Exception:
        return False


def _run(apply, force_local):
    # Database connection mode must be decided BEFORE importing database.py
    # (it reads FORCE_LOCAL_DB at import time).
    if force_local:
        os.environ["FORCE_LOCAL_DB"] = "1"
    elif "FORCE_LOCAL_DB" in os.environ:
        del os.environ["FORCE_LOCAL_DB"]

    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, BASE_DIR)

    from database import get_db, USE_TURSO, DATABASE_PATH, TURSO_URL  # noqa: E402

    LOCAL_UPLOAD_DIR = os.path.join(BASE_DIR, "static", "uploads", "product_images")
    LOCAL_PREFIX = "/static/uploads/product_images/"
    PATH_RE = re.compile(re.escape(LOCAL_PREFIX) + r"([A-Za-z0-9_.\-]+)")

    def load_images(value):
        """Parse the `images` column (JSON array string) into a list of URL strings."""
        if value is None:
            return []
        if isinstance(value, list):
            return list(value)
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return parsed
            except (ValueError, TypeError):
                pass
            return [value] if value.strip() else []
        return []

    def dump_images(images):
        return json.dumps(images, ensure_ascii=False)

    def upload_local_file(filename):
        """Upload a local file to cloud storage and return the permanent URL."""
        from services.cloud_image_service import upload_image_to_cloud  # noqa: E402
        file_path = os.path.join(LOCAL_UPLOAD_DIR, filename)
        if not os.path.isfile(file_path):
            return None
        with open(file_path, "rb") as fh:
            data = fh.read()
        return upload_image_to_cloud(data, filename)

    if USE_TURSO:
        print(f"[MIGRATION] Targeting TURSO database: {TURSO_URL}")
    else:
        print(f"[MIGRATION] Targeting LOCAL SQLite database: {DATABASE_PATH}")

    conn = get_db()
    try:
        cursor = conn.cursor()

        # 1. Collect all local-path references across products + variants.
        #    products is mandatory — fail loudly if it can't be queried.
        #    product_variants is optional (may not exist) — tolerate errors.
        rows = []
        for table, optional in (("products", False), ("product_variants", True)):
            try:
                fetched = cursor.execute(
                    f"SELECT id, images FROM {table} WHERE images LIKE ?",
                    (f"%{LOCAL_PREFIX}%",),
                ).fetchall()
                for row in fetched:
                    images_raw = row["images"] if hasattr(row, "keys") else row[1]
                    rows.append((table, row[0], images_raw))
            except Exception as e:
                if optional:
                    print(f"[MIGRATION] Skipping optional table {table}: {e}")
                else:
                    raise

        referenced_files = {}
        for table, row_id, images_raw in rows:
            for url in load_images(images_raw):
                m = PATH_RE.search(str(url or ""))
                if m:
                    referenced_files.setdefault(m.group(1), []).append((table, row_id))

        if not referenced_files:
            print("[MIGRATION] No local /static/uploads/product_images/ references found. Nothing to do.")
            return

        # Which referenced files actually exist locally?
        existing = {name for name in referenced_files if os.path.isfile(os.path.join(LOCAL_UPLOAD_DIR, name))}
        missing = sorted(set(referenced_files) - existing)

        print(f"[MIGRATION] Found {len(referenced_files)} unique local image file(s) referenced "
              f"across {len(rows)} row(s).")
        print(f"            {len(existing)} file(s) exist locally, {len(missing)} missing.")

        if missing:
            print(f"\n[MIGRATION] Missing locally (will be skipped even in apply mode):")
            for name in missing:
                print(f"  - {name}")

        if not existing:
            print("[MIGRATION] No local files to migrate. Aborting.")
            return

        if not apply:
            # Dry run: show what would change, but don't upload or write.
            affected_rows = 0
            for table, row_id, images_raw in rows:
                local_count = sum(1 for u in load_images(images_raw) if PATH_RE.search(u or ""))
                if local_count:
                    affected_rows += 1
                    print(f"  [DRY] {table} id={row_id}: {local_count} local URL(s) would be migrated to cloud")
            print(f"\n[MIGRATION] DRY RUN — {len(existing)} file(s) would be uploaded, "
                  f"{affected_rows} row(s) would be updated. Re-run with --apply to execute.")
            return

        # 2. Apply: upload each unique file once, build old->new mapping
        print("\n[MIGRATION] Uploading images to cloud storage (this takes a few minutes)...")
        url_map = {}
        for i, filename in enumerate(sorted(existing), 1):
            local_url = LOCAL_PREFIX + filename
            cloud_url = upload_local_file(filename)
            if cloud_url:
                url_map[local_url] = cloud_url
                print(f"  [{i}/{len(existing)}] {filename} -> {cloud_url[:80]}")
            else:
                print(f"  [{i}/{len(existing)}] {filename} -> FAILED (skipping)")

        if not url_map:
            print("[MIGRATION] No files could be uploaded. Aborting (no writes).")
            return

        # 3. Rewrite images columns
        updated_rows = 0
        for table, row_id, images_raw in rows:
            images = load_images(images_raw)
            new_images = []
            changed = False
            for url in images:
                if url in url_map:
                    new_images.append(url_map[url])
                    changed = True
                else:
                    new_images.append(url)
            if changed:
                cursor.execute(
                    f"UPDATE {table} SET images = ? WHERE id = ?",
                    (dump_images(new_images), row_id),
                )
                updated_rows += 1
                print(f"  [APPLY] {table} id={row_id}: "
                      f"{sum(1 for u in images if u in url_map)} local URL(s) -> cloud")

        conn.commit()
        print(f"\n[MIGRATION] Committed. Uploaded {len(url_map)} file(s), updated {updated_rows} row(s).")

        # Post-commit verification: no local paths should remain in any row.
        remaining = 0
        for table in ("products", "product_variants"):
            try:
                for row in cursor.execute(
                    f"SELECT id, images FROM {table} WHERE images LIKE ?",
                    (f"%{LOCAL_PREFIX}%",),
                ).fetchall():
                    remaining += 1
                    print(f"  [VERIFY] {table} id={row[0]} still has local URL(s)")
            except Exception:
                pass  # optional table
        if remaining:
            print(f"[MIGRATION] WARNING: {remaining} row(s) still contain local URLs (missing files skipped).")
        else:
            print("[MIGRATION] Verified: no /static/uploads/product_images/ references remain.")
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Migrate local product images to cloud storage.")
    parser.add_argument("--apply", action="store_true", help="Upload to cloud + write changes (default: dry run).")
    parser.add_argument("--local", action="store_true", help="Force local SQLite DB (jdlx.db).")
    parser.add_argument("--turso", action="store_true", help="Force Turso (production) DB.")
    args = parser.parse_args()

    if args.local and args.turso:
        parser.error("--local and --turso are mutually exclusive")

    # Default (neither flag): Turso if creds present, else local SQLite.
    # --local forces SQLite; --turso requires Turso creds to be configured.
    if args.turso and not _has_turso():
        parser.error("--turso requested but TURSO_* credentials are not configured")

    force_local = args.local
    _run(apply=args.apply, force_local=force_local)


if __name__ == "__main__":
    main()

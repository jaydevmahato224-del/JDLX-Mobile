#!/usr/bin/env python3
"""
Backfill: cache existing cloud-hosted product images into uploaded_media DB.

Why
---
Product images are uploaded to keyless public cloud hosts (Catbox/Telegraph)
and the DB stores those URLs. Those hosts are intermittently blocked (ISPs /
browser safe-browsing) or go down entirely, which makes images vanish from the
warehouse panel and the storefront even though the stored URLs are still
"valid". Every NEW upload already writes a byte-level backup of the image into
the persistent `uploaded_media` table (and the backend now serves a DB-backed
media proxy), but images uploaded BEFORE that backup existed have no row.

This script:
1. Scans products (and product_variants) `images` JSON for http(s) URLs.
2. Downloads each image (skipping ones already present in uploaded_media).
3. INSERT OR REPLACEs the bytes into uploaded_media keyed by the URL basename —
   exactly what the upload endpoint does, so the media proxy can serve them.

Usage
-----
    python backfill_cloud_images_to_db.py --dry-run   (default, no writes)
    python backfill_cloud_images_to_db.py --apply     (uses Turso if creds present)
    python backfill_cloud_images_to_db.py --apply --local   (force local SQLite)
"""
import argparse
import json
import os
import sys


def _has_turso():
    try:
        from database import TURSO_URL, TURSO_TOKEN
        return bool(TURSO_URL and TURSO_TOKEN)
    except Exception:
        return False


ALLOWED_EXTS = {"png", "jpg", "jpeg", "webp", "gif"}
MIME_MAP = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
}


def _run(apply, force_local):
    if force_local:
        os.environ["FORCE_LOCAL_DB"] = "1"
    elif "FORCE_LOCAL_DB" in os.environ:
        del os.environ["FORCE_LOCAL_DB"]

    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, BASE_DIR)

    import requests  # noqa: E402
    from database import get_db, USE_TURSO, TURSO_URL, DATABASE_PATH  # noqa: E402

    if USE_TURSO:
        print(f"[BACKFILL] Targeting TURSO database: {TURSO_URL}")
    else:
        print(f"[BACKFILL] Targeting LOCAL SQLite database: {DATABASE_PATH}")

    def load_images(value):
        if not value:
            return []
        if isinstance(value, list):
            return [str(u) for u in value if u]
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return [str(u) for u in parsed if u]
            except (ValueError, TypeError):
                pass
            return [value.strip()] if value.strip().startswith("http") else []
        return []

    conn = get_db()
    try:
        cursor = conn.cursor()

        # 1. Collect every cloud URL referenced by any product/variant.
        urls = {}
        for table, optional in (("products", False), ("product_variants", True)):
            try:
                rows = cursor.execute(
                    f"SELECT id, images FROM {table} WHERE images LIKE '%http%'"
                ).fetchall()
            except Exception as e:
                if optional:
                    print(f"[BACKFILL] Skipping optional table {table}: {e}")
                    continue
                raise
            for row in rows:
                images_raw = row["images"] if hasattr(row, "keys") else row[1]
                for url in load_images(images_raw):
                    if not url.lower().startswith(("http://", "https://")):
                        continue
                    name = url.rsplit("/", 1)[-1].split("?")[0].strip()
                    if "." not in name:
                        continue
                    ext = name.rsplit(".", 1)[1].lower()
                    if ext in ALLOWED_EXTS:
                        urls.setdefault(name, url)

        if not urls:
            print("[BACKFILL] No cloud image URLs found. Nothing to do.")
            return

        # 2. Skip names that already have a DB row (with actual bytes).
        already = 0
        to_fetch = {}
        for name, url in urls.items():
            row = cursor.execute(
                "SELECT LENGTH(data) FROM uploaded_media WHERE filename = ?", (name,)
            ).fetchone()
            if row and (row[0] or 0) > 0:
                already += 1
            else:
                to_fetch[name] = url

        print(f"[BACKFILL] {len(urls)} unique cloud image(s) referenced; "
              f"{already} already backed up in DB, {len(to_fetch)} to download.")

        if not to_fetch:
            print("[BACKFILL] Everything is already backed up. Nothing to do.")
            return

        if not apply:
            for name, url in sorted(to_fetch.items()):
                print(f"  [DRY] {name} <- {url[:80]}")
            print(f"\n[BACKFILL] DRY RUN — {len(to_fetch)} image(s) would be downloaded and stored. "
                  "Re-run with --apply to execute.")
            return

        # 3. Download + store.
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "image/*,*/*;q=0.8",
        }
        ok = failed = 0
        total_bytes = 0
        for i, (name, url) in enumerate(sorted(to_fetch.items()), 1):
            try:
                resp = requests.get(url, headers=headers, timeout=25)
                if resp.status_code == 200 and resp.content:
                    ctype = resp.headers.get("Content-Type", "")
                    ext = name.rsplit(".", 1)[1].lower()
                    # Guard against HTML error pages posing as images.
                    if "text/html" in ctype.lower():
                        raise ValueError(f"got HTML instead of image ({len(resp.content)} bytes)")
                    mime = MIME_MAP.get(ext, ctype.split(";")[0] if ctype else "image/jpeg")
                    cursor.execute(
                        "INSERT OR REPLACE INTO uploaded_media (filename, mime_type, data) VALUES (?, ?, ?)",
                        (name, mime, resp.content),
                    )
                    conn.commit()
                    ok += 1
                    total_bytes += len(resp.content)
                    print(f"  [{i}/{len(to_fetch)}] {name} ({len(resp.content)} bytes) OK")
                else:
                    failed += 1
                    print(f"  [{i}/{len(to_fetch)}] {name} FAILED (HTTP {resp.status_code})")
            except Exception as e:
                failed += 1
                print(f"  [{i}/{len(to_fetch)}] {name} FAILED ({e})")

        print(f"\n[BACKFILL] Done. Stored {ok} image(s) ({total_bytes} bytes), {failed} failed.")
        if failed:
            print("[BACKFILL] Note: failed images stay un-proxied; the frontend keeps the "
                  "direct cloud URL as first attempt and the placeholder as last resort.")
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Backfill cloud product images into uploaded_media DB.")
    parser.add_argument("--apply", action="store_true", help="Download + write to DB (default: dry run).")
    parser.add_argument("--local", action="store_true", help="Force local SQLite DB (jdlx.db).")
    parser.add_argument("--turso", action="store_true", help="Require Turso creds (default when present).")
    args = parser.parse_args()

    if args.turso and not _has_turso():
        parser.error("--turso requested but TURSO_* credentials are not configured")

    _run(apply=args.apply, force_local=args.local)


if __name__ == "__main__":
    main()

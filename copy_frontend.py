import shutil
import os
import sys

source = r"c:\Users\Jaydev Mahato\OneDrive\Desktop\JDLX_MOBILE\frontend"
destination = r"c:\Users\Jaydev Mahato\OneDrive\Desktop\JDLX_MOBILE\frontend-admin"

# ─── Safety Checks ───────────────────────────────────────────────────────────
REQUIRED_FILES = ["package.json", "vite.config.js", "index.html"]

def abort(reason):
    print(f"\n❌ ABORTED — {reason}")
    print("   No files were modified.")
    sys.exit(1)

print(f"🔍 Validating source: {source}")

# 1. Source must exist
if not os.path.isdir(source):
    abort(f"Source folder does not exist: {source}")

# 2. Source must contain all required files (not just src/)
missing = [f for f in REQUIRED_FILES if not os.path.isfile(os.path.join(source, f))]
if missing:
    abort(
        f"Source folder is INCOMPLETE. Missing required files: {missing}\n"
        "   This script will NOT overwrite frontend-admin with an incomplete source."
    )

# 3. Warn if destination (frontend-admin) looks like a valid project
if os.path.isdir(destination):
    existing_files = os.listdir(destination)
    if any(f in existing_files for f in REQUIRED_FILES):
        print(f"\n⚠️  WARNING: '{destination}' already looks like a full project.")
        confirm = input("   Are you SURE you want to overwrite it? (yes/no): ").strip().lower()
        if confirm != "yes":
            abort("User cancelled the operation.")

# ─── Perform Copy ────────────────────────────────────────────────────────────
def ignore_node_modules(dir, files):
    if 'node_modules' in files:
        return ['node_modules']
    return []

print(f"\n✅ Source validated. Copying to: {destination}")

if os.path.exists(destination):
    shutil.rmtree(destination)

shutil.copytree(source, destination, ignore=ignore_node_modules)
print(f"✅ Successfully copied '{source}' → '{destination}' (node_modules excluded).")

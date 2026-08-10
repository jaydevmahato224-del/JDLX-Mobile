"""Find API endpoints the frontend-admin calls that have no backend route.

Only analyzes `${API_BASE_URL}/...` template-literal fetch calls. Handles:
- query strings (?page=2)
- ${id} template segments
- /api prefix (frontend uses /admin/x, backend uses /api/admin/x)

Usage: python3 scratch/audit_frontend_api_calls.py
"""
import re
import os

BACKEND_DIR = '.'
FRONTEND_DIR = '../frontend-admin/src'

# 1. Collect all backend routes
backend_routes = set()
for fname in os.listdir(BACKEND_DIR):
    if not fname.endswith('.py'):
        continue
    try:
        src = open(os.path.join(BACKEND_DIR, fname)).read()
    except Exception:
        continue
    for m in re.finditer(r"@app\.route\(\s*(?:'|\")([^'\"?]+)(?:'|\")", src):
        backend_routes.add(m.group(1))
    for m in re.finditer(r"@\w+_bp\.route\(\s*(?:'|\")([^'\"?]+)(?:'|\")", src):
        backend_routes.add(m.group(1))

print(f'Backend routes collected: {len(backend_routes)}')

# 2. Collect ${API_BASE_URL} fetch calls
frontend_calls = {}
for root, dirs, files in os.walk(FRONTEND_DIR):
    for fname in files:
        if not fname.endswith(('.jsx', '.js')):
            continue
        path = os.path.join(root, fname)
        try:
            src = open(path, encoding='utf-8', errors='ignore').read()
        except Exception:
            continue
        for m in re.finditer(r"`([^`]*?\$\{API_BASE_URL\}[^`]*?)`", src):
            call = m.group(1)
            rest = call.split('${API_BASE_URL}')[-1]
            path_part = rest.split('`')[0].strip().rstrip('/')
            # strip query string
            path_part = path_part.split('?')[0]
            if not path_part.startswith('/'):
                continue
            # replace ${...} template segments with <p>
            path_part = re.sub(r'\$\{[^}]+\}', '<p>', path_part)
            # strip any trailing /<p> that is an empty suffix
            path_part = path_part.rstrip('/')
            frontend_calls.setdefault(path_part, set()).add(os.path.relpath(path, FRONTEND_DIR))

# 3. Diff
def route_matches(call, routes):
    candidates = {call}
    if not call.startswith('/api/'):
        candidates.add('/api' + call)
    for c in candidates:
        if c in routes:
            return True
        c_parts = c.split('/')
        for r in routes:
            r_parts = r.split('/')
            if len(r_parts) != len(c_parts):
                continue
            ok = True
            for rp, cp in zip(r_parts, c_parts):
                if rp.startswith('<') and rp.endswith('>'):
                    continue
                if rp != cp:
                    ok = False
                    break
            if ok:
                return True
    return False

missing = {}
for call in sorted(frontend_calls):
    if not route_matches(call, backend_routes):
        missing[call] = sorted(frontend_calls[call])

print(f'\n===== FRONTEND API CALLS WITH NO BACKEND ROUTE ({len(missing)}) =====')
for call in sorted(missing):
    print(f'  {call}')
    for f in missing[call]:
        print(f'      <- {f}')

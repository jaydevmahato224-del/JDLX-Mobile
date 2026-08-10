"""Audit: /api/admin/* routes defined via blueprints (@<name>_bp.route) that
lack auth decorators (token_required / require_admin / require_super_admin /
require_permission / role guards).

The earlier audit only scanned @app.route — blueprint routes were missed.

Usage: python3 scratch/audit_blueprint_admin_routes.py
"""
import re
import os

AUTH_DECORATORS = ('token_required', 'role_required', 'permission_required',
                   'require_permission', 'admin_required', 'super_admin_required',
                   'require_admin', 'require_super_admin', 'require_role',
                   'roles_required', 'require_warehouse_auth')

# In-function guard calls that also count as auth (e.g. _require_admin_token()
# called as the first statement inside the view function).
IN_BODY_GUARDS = ('_require_admin_token', '_require_warehouse_auth', '_require_auth',
                  'require_admin', 'require_super_admin', 'require_permission',
                  'require_warehouse_auth', 'token_required', 'verify_admin')


def _body_has_auth(lines, start):
    """Scan the view body from `start` until the next route/decorator/def.
    Returns True if any guard call appears as a bare statement."""
    for k in range(start, len(lines)):
        s = lines[k].lstrip()
        if s.startswith('@') or s.startswith('def ') or s.startswith('class '):
            break
        if any(g in s for g in IN_BODY_GUARDS) and '(' in s:
            return True
    return False


for fname in sorted(os.listdir('.')):
    if not fname.endswith('.py') or fname.startswith('scratch'):
        continue
    try:
        src = open(fname).read()
    except Exception:
        continue
    lines = src.split('\n')
    findings = []
    for i, line in enumerate(lines):
        m = re.match(r"\s*@\w+_bp\.route\(\s*['\"](/api/admin[^'\"?]*)", line)
        if not m:
            continue
        route = m.group(1)
        # collect decorators below until def
        j = i + 1
        decs = []
        body_start = None
        while j < len(lines) and not lines[j].lstrip().startswith('def '):
            if '@' in lines[j]:
                decs.append(lines[j].strip())
            j += 1
        if j < len(lines):
            body_start = j + 1
        has_auth = any(any(a in d for a in AUTH_DECORATORS) for d in decs)
        if not has_auth and body_start is not None:
            has_auth = _body_has_auth(lines, body_start)
        if not has_auth:
            findings.append((route, decs))
    if findings:
        print(f'===== {fname}: {len(findings)} UNPROTECTED blueprint admin routes =====')
        for route, decs in findings:
            print(f'  {route}')
            for d in decs:
                print(f'      {d}')
    else:
        print(f'===== {fname}: blueprint admin routes all protected =====')

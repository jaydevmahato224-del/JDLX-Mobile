"""Audit: admin routes protected ONLY by token_required (any logged-in user can call).

Usage: python3 scratch/audit_admin_routes.py
"""
import re

files = ['app.py', 'warehouse_routes.py', 'payment_routes.py', 'refund_routes.py',
         'report_routes.py', 'bug_routes.py', 'support_routes.py', 'offer_routes.py',
         'app_review_routes.py', 'shiprocket_routes.py', 'complaint_routes.py',
         'delivery_routes.py', 'analytics_routes.py', 'issue_routes.py']

STRONG = ('role_required', 'permission_required', 'require_permission',
          'admin_required', 'super_admin_required', 'require_role', 'roles_required',
          'require_admin', 'require_super_admin')

for fname in files:
    try:
        src = open(fname).read()
    except FileNotFoundError:
        continue
    lines = src.split('\n')
    i = 0
    weak = []
    while i < len(lines):
        m = re.match(r"\s*@app\.route\('(/api/admin[^']*)'", lines[i])
        if not m:
            i += 1
            continue
        route = m.group(1)
        j = i + 1
        decs = []
        while j < len(lines) and not lines[j].lstrip().startswith('def '):
            if '@' in lines[j]:
                decs.append(lines[j].strip())
            j += 1
        decs_joined = ' | '.join(decs)
        has_token = 'token_required' in decs_joined
        has_strong = any(s in decs_joined for s in STRONG)
        if has_token and not has_strong:
            weak.append((route, decs))
        i = j
    if weak:
        print(f'===== {fname}: {len(weak)} admin routes = token_required ONLY (weak) =====')
        for route, decs in weak:
            print(f'  {route}')
            for d in decs:
                print(f'      {d}')
    else:
        print(f'===== {fname}: no weak admin routes =====')

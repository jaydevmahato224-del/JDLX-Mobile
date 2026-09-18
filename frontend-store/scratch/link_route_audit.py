"""Static internal-link vs route audit for frontend-store.

Extracts every navigation target (to=, navigate(), template links) and every
defined <Route path>. Cross-checks: used paths that match no route and no
dynamic-route prefix are reported as potential broken links.
"""
import os
import re

SRC = '/home/jaydev/Desktop/JDLX-Mobile/frontend-store/src'

used = set()
defined = set()

for root, dirs, files in os.walk(SRC):
    for f in files:
        if not f.endswith(('.jsx', '.js')):
            continue
        p = os.path.join(root, f)
        try:
            text = open(p, encoding='utf-8').read()
        except Exception:
            continue
        for m in re.findall(r'to=["\']([^"\']+)["\']', text):
            used.add(m)
        for m in re.findall(r'navigate\(\s*["\']([^"\']+)["\']', text):
            used.add(m)
        for m in re.findall(r'to=\{`([^`]+)`\}', text):
            used.add(m)
        for m in re.findall(r'navigate\(\s*`([^`]+)`', text):
            used.add(m)
        for m in re.findall(r'path="([^"]+)"', text):
            defined.add(m)

# Only app-internal paths
used = {u for u in used if u.startswith('/')}
# Drop dynamic params for prefix matching
def route_prefixes(d):
    prefixes = set()
    for r in d:
        # '/p/:token' -> '/p/', '/profile/orders' -> '/profile/orders'
        parts = r.split(':')
        prefixes.add(parts[0].rstrip('*').rstrip('/'))
    return prefixes

prefixes = route_prefixes(defined)

print("=== DEFINED ROUTES (%d) ===" % len(defined))
for r in sorted(defined):
    print("  ", r)

print("\n=== USED INTERNAL PATHS (%d) ===" % len(used))
broken = []
for u in sorted(used):
    base = re.sub(r'\$\{[^}]*\}', ':param', u)  # template links -> param
    segs = base.split(':')[0].rstrip('/')
    matched = segs in {d.rstrip('/*') for d in defined} or any(
        segs.startswith(px) and px for px in prefixes if px
    )
    if not matched:
        broken.append(u)
    print("  ", u, '<- OK' if matched else '<- NO ROUTE MATCH')

print("\n=== POTENTIALLY BROKEN LINKS ===")
if broken:
    for b in broken:
        print("  ??", b)
else:
    print("  (none — every used internal path matches a defined route)")

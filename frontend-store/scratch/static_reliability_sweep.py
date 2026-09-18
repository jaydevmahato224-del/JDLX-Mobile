"""Static reliability sweep for frontend-store.

Finds:
1. setInterval with no matching clearInterval (leak -> battery/memory drain)
2. addEventListener with no matching removeEventListener (leak)
3. localStorage.setItem/getItem key cross-reference (silent data mismatches)
4. Suspicious empty catch blocks (completely silent failures)
"""
import os
import re

SRC = '/home/jaydev/Desktop/JDLX-Mobile/frontend-store/src'
files = []
for root, dirs, fs in os.walk(SRC):
    for f in fs:
        if f.endswith(('.jsx', '.js')):
            files.append(os.path.join(root, f))

# ---- 1 & 2: interval/listener leaks per file ----
print('=== INTERVAL / LISTENER LEAKS ===')
leak_found = False
for p in files:
    text = open(p, encoding='utf-8', errors='ignore').read()
    set_i = len(re.findall(r'setInterval\(', text))
    clear_i = len(re.findall(r'clearInterval\(', text))
    set_l = len(re.findall(r'addEventListener\(', text))
    rem_l = len(re.findall(r'removeEventListener\(', text))
    if set_i > clear_i or set_l > rem_l:
        leak_found = True
        print(f'  {os.path.relpath(p, SRC)}: setInterval={set_i} clearInterval={clear_i} addL={set_l} remL={rem_l}')
if not leak_found:
    print('  (none)')

# ---- 3: localStorage keys ----
print('\n=== LOCALSTORAGE KEY CROSS-REFERENCE ===')
sets, gets, removes = {}, {}, {}
for p in files:
    text = open(p, encoding='utf-8', errors='ignore').read()
    rel = os.path.relpath(p, SRC)
    for m in re.findall(r'localStorage\.setItem\(\s*["\']([^"\']+)["\']', text):
        sets.setdefault(m, []).append(rel)
    for m in re.findall(r'localStorage\.getItem\(\s*["\']([^"\']+)["\']', text):
        gets.setdefault(m, []).append(rel)
    for m in re.findall(r'localStorage\.removeItem\(\s*["\']([^"\']+)["\']', text):
        removes.setdefault(m, []).append(rel)

print('  Keys GET but never SET (may come from other apps/origin conventions):')
for k in sorted(set(gets) - set(sets)):
    print(f'    GET-only: {k}  <- {", ".join(gets[k][:3])}')
print('  Keys SET but never GET (dead data):')
for k in sorted(set(sets) - set(gets) - set(removes)):
    print(f'    SET-only: {k}  <- {", ".join(sets[k][:3])}')

# ---- 4: empty catch blocks ----
print('\n=== EMPTY/SUSPICIOUS CATCH BLOCKS ===')
found_empty = False
for p in files:
    text = open(p, encoding='utf-8', errors='ignore').read()
    for m in re.finditer(r'catch\s*(\([^)]*\))?\s*\{\s*\}', text):
        found_empty = True
        line = text[:m.start()].count('\n') + 1
        print(f'  {os.path.relpath(p, SRC)}:{line} empty catch')
if not found_empty:
    print('  (none)')

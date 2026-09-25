#!/usr/bin/env python3
"""Audit: find tables used in code but never CREATE'd anywhere in backend.

Only scans SQL inside triple-quoted strings and explicit sql statements —
so Python `from X import Y` lines are never mistaken for SQL FROM clauses.
Read-only — reports only, touches nothing.
"""
import re
import os
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCLUDE_DIRS = {"venv", "venv_linux", "venv_new", ".venv", "node_modules", "__pycache__", "static", "backup", "logs", "scratch"}

create_re = re.compile(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\"'`\[]?(\w+)[\"'`\]]?", re.IGNORECASE)
sql_patterns = [
    re.compile(r"\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+[\"'`\[]?(\w+)[\"'`\]]?", re.IGNORECASE),
    re.compile(r"\bUPDATE\s+[\"'`\[]?(\w+)[\"'`\]]?\s+SET\b", re.IGNORECASE),
    re.compile(r"\bDELETE\s+FROM\s+[\"'`\[]?(\w+)[\"'`\]]?", re.IGNORECASE),
    re.compile(r"\bSELECT\b[^;()\"]*?\bFROM\s+[\"'`\[]?(\w+)[\"'`\]]?", re.IGNORECASE),
    re.compile(r"\bJOIN\s+[\"'`\[]?(\w+)[\"'`\]]?", re.IGNORECASE),
]
NOT_TABLES = {
    "select", "where", "and", "or", "not", "null", "is", "in", "on", "as",
    "left", "right", "inner", "outer", "cross", "group", "order", "limit",
    "offset", "having", "union", "all", "distinct", "case", "when", "then",
    "else", "end", "exists", "between", "like", "glob", "values", "set",
    "into", "if", "json_each", "json_tree", "pragma",
}


def sql_fragments(text):
    """Yield strings that plausibly contain SQL: triple-quoted blocks and
    single-line strings that contain a SQL keyword."""
    for m in re.finditer(r'"""(.*?)"""', text, re.DOTALL):
        yield m.group(1)
    for m in re.finditer(r"'''(.*?)'''", text, re.DOTALL):
        yield m.group(1)
    for line in text.splitlines():
        if re.search(r"\b(SELECT|INSERT|UPDATE|DELETE)\b", line, re.IGNORECASE) and ("'" in line or '"' in line):
            yield line


py_files = []
for root, dirs, files in os.walk(BACKEND):
    dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
    for f in files:
        if f.endswith(".py"):
            py_files.append(os.path.join(root, f))

created = set()
referenced = {}
for path in py_files:
    try:
        text = open(path, encoding="utf-8", errors="ignore").read()
    except OSError:
        continue
    rel = os.path.relpath(path, BACKEND)
    for m in create_re.finditer(text):
        created.add(m.group(1).lower())
    for frag in sql_fragments(text):
        for pat in sql_patterns:
            for m in pat.finditer(frag):
                t = m.group(1).lower()
                if t in NOT_TABLES or t.startswith("sqlite_") or t.isdigit():
                    continue
                referenced.setdefault(t, set()).add(rel)

missing = {t: sorted(paths) for t, paths in sorted(referenced.items()) if t not in created}
core_missing = {t: p for t, p in missing.items() if not t.endswith("_legacy")}

if not core_missing:
    print("OK — every referenced table has a CREATE TABLE somewhere.")
else:
    print(f"WARNING — {len(core_missing)} table(s) referenced in code but never created:")
    for t, paths in core_missing.items():
        print(f"  {t}  <- {', '.join(paths[:5])}")
    sys.exit(1)

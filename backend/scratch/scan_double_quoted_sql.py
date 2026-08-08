"""
Scans backend .py files for double-quoted string literals embedded inside SQL
strings passed to cursor.execute()/conn.execute().

SQLite/Turso treats "word" as a column identifier, not a string literal, so
`= "open"` inside SQL fails with: no such column: "open".
Only Python-level comparisons (e.g. status == "open") are fine and are NOT matched.
"""
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SKIP_DIRS = {"venv", ".venv", "__pycache__", "scratch", "node_modules", "dev-dist", "static"}

# A double-quoted word that appears right after SQL-ish operators, i.e. it is a
# literal used inside SQL rather than a Python string.
# Match: = "word", IN ("a","b"), LIKE "x%", > "word" etc. where the quotes are
# inside a SQL statement string (not a Python comparison).
DOUBLE_QUOTED_LITERAL = re.compile(
    r'(?<![A-Za-z0-9_.])(=|<>|!=|>|<|>=|<=|LIKE|IN|NOT IN)\s*"\s*([A-Za-z_][A-Za-z0-9_]*)'
)

def scan_file(path):
    findings = []
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
    except Exception:
        return findings

    # Only consider lines that are inside a Python string that is being executed
    # as SQL. Heuristic: the whole file, find all execute("""...""") or execute("...")
    # blocks and scan only the SQL text within them.
    for m in re.finditer(r'(?:\.execute|\.executescript|executescript)\(\s*(?:f|r|b)?(["\']{3}|["\'])', content):
        quote = m.group(1)
        start = m.end()
        if quote.startswith('"""') or quote.startswith("'''"):
            end = content.find(quote[:3], start)
        else:
            end = content.find(quote[0], start)
        if end == -1:
            continue
        sql_text = content[start:end]
        line_offset = content[:m.start()].count("\n") + 1
        for dm in DOUBLE_QUOTED_LITERAL.finditer(sql_text):
            line_in_block = sql_text[:dm.start()].count("\n")
            findings.append((path, line_offset + line_in_block, dm.group(0).strip()))
    return findings

all_findings = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for fn in filenames:
        if fn.endswith(".py"):
            all_findings.extend(scan_file(os.path.join(dirpath, fn)))

if not all_findings:
    print("CLEAN: no double-quoted string literals found inside SQL execute() calls.")
else:
    for path, line, snippet in all_findings:
        rel = os.path.relpath(path, ROOT)
        print(f"{rel}:{line}: {snippet}")
    print(f"\nTotal: {len(all_findings)}")

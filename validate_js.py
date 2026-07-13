"""Validate JS before deploy."""
import re, sys

path = sys.argv[1]
with open(path) as f:
    lines = f.readlines()

text = "".join(lines)
errors = []

# Brace/paren balance
if text.count("{") != text.count("}"):
    errors.append(f"Brace imbalance: {text.count('{')} open, {text.count('}')} close")
if text.count("(") != text.count(")"):
    errors.append(f"Paren imbalance: {text.count('(')} open, {text.count(')')} close")

# Dangling string fragments
for i, line in enumerate(lines, 1):
    s = line.strip()
    if s in ("html += '", 'html += "', "html += `"):
        errors.append(f"Line {i}: dangling string fragment")

# '' without escaping in onclick for function call args
for i, line in enumerate(lines, 1):
    if "onclick=" in line:
        # Find all ('' ... '') patterns that should be (\\' ... \\')
        for m in re.finditer(r"''\s*\+\s*(userId|svc|s)\s*\+\s*''", line):
            errors.append(f"Line {i}: broken '' quoting (should use \\' or double-quote fragment)")

if errors:
    print("VALIDATION FAILED:")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
else:
    print("OK")

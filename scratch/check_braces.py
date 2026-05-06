
with open('/home/jaydev/Desktop/JDLX-Mobile/frontend-admin/src/pages/admin/AdminDarkStores.jsx', 'r') as f:
    content = f.read()

opens_curly = content.count('{')
closes_curly = content.count('}')
opens_paren = content.count('(')
closes_paren = content.count(')')

print(f"Curlys: {opens_curly} / {closes_curly}")
print(f"Parens: {opens_paren} / {closes_paren}")

# Check if it compiles with basic parser
try:
    # This is JS, not Python, so we can't use compile()
    # But we can check for basic balance
    stack = []
    for i, char in enumerate(content):
        if char == '{': stack.append(('{', i))
        elif char == '}':
            if not stack or stack[-1][0] != '{':
                print(f"Mismatch at index {i}: found }} but stack is {stack[-1] if stack else 'empty'}")
                break
            stack.pop()
    if stack:
        print(f"Unclosed: {stack}")
except Exception as e:
    print(f"Error: {e}")

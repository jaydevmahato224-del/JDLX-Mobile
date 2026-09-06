// Heuristic static check: find JSX component usages that are not imported or
// defined anywhere in the same file (would throw ReferenceError at runtime).
// Usage: node scratch/check_undefined_components.mjs <srcDir>
import fs from 'node:fs'
import path from 'node:path'

const srcDir = process.argv[2]
if (!srcDir) { console.error('usage: node check_undefined_components.mjs <srcDir>'); process.exit(1) }

const files = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      walk(p)
    } else if (/\.(jsx|js)$/.test(entry.name)) {
      files.push(p)
    }
  }
}
walk(srcDir)

let totalIssues = 0
for (const file of files.sort()) {
  const code = fs.readFileSync(file, 'utf8')
  const lines = code.split('\n')
  // Strip comments naively (line comments) to reduce false positives
  const codeNoComments = lines.map(l => l.replace(/^\s*\/\//, '')).join('\n')

  const defined = new Set()
  // default imports
  for (const m of codeNoComments.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]/g)) defined.add(m[1])
  // named imports (incl. aliases)
  for (const m of codeNoComments.matchAll(/import\s*\{([^}]*)\}\s*from\s+['"]/g)) {
    for (const part of m[1].split(',')) {
      const mm = part.match(/([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/)
      if (mm) defined.add((mm[2] || mm[1]).trim())
    }
  }
  // namespace imports
  for (const m of codeNoComments.matchAll(/import\s*\*\s+as\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1])
  // local declarations (function/class/const/let/var with capitalized name)
  for (const m of codeNoComments.matchAll(/\b(?:function|class|const|let|var)\s+([A-Z][A-Za-z0-9_$]*)\b/g)) defined.add(m[1])
  for (const m of codeNoComments.matchAll(/\bexport\s+(?:default\s+)?(?:function|class)\s+([A-Z][A-Za-z0-9_$]*)\b/g)) defined.add(m[1])
  // destructured consts (e.g. const { Foo, Bar: Baz } = useStore(...))
  for (const m of codeNoComments.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const mm = part.match(/([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?/)
      if (mm && mm[1] && /^[A-Z]/.test(mm[1])) defined.add((mm[2] || mm[1]).trim())
    }
  }
  // function-param destructuring: function Foo({ icon: Icon }) / const Foo = ({ Icon }) => ...
  for (const m of codeNoComments.matchAll(/function\s+[\w$]*\s*\([^)]*\{([^}]*)\}[^)]*\)/g)) {
    for (const part of m[1].split(',')) {
      const mm = part.match(/([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)/)
      if (mm && /^[A-Z]/.test(mm[2])) defined.add(mm[2].trim())
    }
  }
  for (const m of codeNoComments.matchAll(/\([^)]*\{([^}]*)\}[^)]*\)\s*=>/g)) {
    for (const part of m[1].split(',')) {
      const mm = part.match(/([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)/)
      if (mm && /^[A-Z]/.test(mm[2])) defined.add(mm[2].trim())
    }
  }

  const used = new Set()
  for (const m of codeNoComments.matchAll(/<([A-Z][A-Za-z0-9_$]*)(?![A-Za-z0-9_$])/g)) used.add(m[1])
  // member-style usages <NS.Component> - NS must be defined, member is irrelevant
  for (const m of codeNoComments.matchAll(/<([A-Z][A-Za-z0-9_$]*)\./g)) used.add(m[1])

  const missing = [...used].filter(u => !defined.has(u) && !['A', 'B', 'C'].includes(u)).sort()
  if (missing.length) {
    totalIssues += missing.length
    console.log(`\n❌ ${path.relative(process.cwd(), file)}`)
    for (const u of missing) {
      const lineNo = lines.findIndex(l => l.includes('<' + u)) + 1
      console.log(`   undefined: <${u}> (first seen line ${lineNo})`)
    }
  }
}
console.log(`\n=== ${totalIssues} undefined component reference(s) across ${files.length} files ===`)
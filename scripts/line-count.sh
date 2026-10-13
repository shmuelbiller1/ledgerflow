#!/usr/bin/env bash
# Counts tracked lines by kind and appends one dated row to docs/LINE_COUNT.md (one row per day).
set -euo pipefail
count() { { git ls-files -z -- "$@" | xargs -0 cat 2>/dev/null || true; } | wc -l | tr -d ' '; }
app=$(count 'src/*.ts' 'src/*.tsx' ':!src/tests/*' ':!*.test.ts' ':!*.test.tsx')
tests=$(count 'src/tests/*' '*.test.ts' '*.test.tsx' 'e2e/*.ts')
sql=$(count '*.sql')
docs=$(count 'docs/*.md' '*.md')
total=$((app + tests + sql + docs))
# open to-do items: the tracker (Claude's list) and each AI's queue in docs/COORDINATION.md
todo=$(grep -c '^[[:space:]]*- \[ \]' docs/TRACKER.md || true)
done_=$(grep -c '^[[:space:]]*- \[x\]' docs/TRACKER.md || true)
queues=$(awk '/^## /{h=$0} /^- \[ \]/{ if (match(h,/AI #[0-9]+/)) c[substr(h,RSTART+4,RLENGTH-4)]++ } END{for(k in c) printf "#%s:%d ", k, c[k]}' docs/COORDINATION.md | tr ' ' '\n' | sort -t'#' -k2 -n | tr '\n' ' ' | sed 's/ *$//')
day=$(date -u +%Y-%m-%d)
f=docs/LINE_COUNT.md
if [ ! -f "$f" ]; then
  printf '# Lines of code, one row per day\n\nApp = src without tests; Tests = unit + browser tests; To-do = items in docs/TRACKER.md (Claude's list); AI queues = open tasks per AI in docs/COORDINATION.md. Written by scripts/line-count.sh (daily by GitHub Actions).\n\n| Date | App | Tests | SQL | Docs | Total | To-do open | To-do done | AI queues (open) |\n|---|---:|---:|---:|---:|---:|---:|---:|---|\n' > "$f"
fi
grep -v "^| $day |" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
printf '| %s | %s | %s | %s | %s | %s | %s | %s | %s |\n' "$day" "$app" "$tests" "$sql" "$docs" "$total" "$todo" "$done_" "$queues" >> "$f"
tail -1 "$f"

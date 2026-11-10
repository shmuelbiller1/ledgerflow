#!/usr/bin/env python3
"""Agent #6 (2026-11-10): which collections have a JSONB field allowlist in lf_rules, at the pin.

Run from the repository root:   python3 audit/agent6-2026-11-10/probes/lf-rules-coverage.py
Reads every supabase/migrations/*.sql; no database needed. Output is the count quoted in
audit/agent6-2026-11-10/02-findings.md F-03.
"""
import re, glob
init = open('supabase/migrations/20260924190000_init.sql').read()
allt = set(re.findall(r"'([A-Za-z_]+)'", re.search(r"all_tables text\[\] := array\[(.*?)\];", init, re.S).group(1)))
for f in glob.glob('supabase/migrations/*.sql'):
    if f.endswith('init.sql'):
        continue
    allt |= set(re.findall(r"create table (?:if not exists )?public\.\"?([A-Za-z_]+)\"?", open(f).read()))
noallow = set()
for f in glob.glob('supabase/migrations/*.sql'):
    s = open(f).read()
    for m in re.finditer(r"insert into public\.lf_rules\s*\(([^)]*)\)\s*values(.*?);", s, re.S):
        if 'allowed_keys' in [c.strip() for c in m.group(1).split(',')]:
            continue
        noallow |= set(re.findall(r"\(\s*'([A-Za-z_]+)'", m.group(2)))
    for m in re.finditer(r"insert into public\.lf_rules\s*\(([^)]*)\)\s*select t from unnest\(array\[(.*?)\]", s, re.S):
        if 'allowed_keys' in [c.strip() for c in m.group(1).split(',')]:
            continue
        noallow |= set(re.findall(r"'([A-Za-z_]+)'", m.group(2)))
later = set()
for f in glob.glob('supabase/migrations/*.sql'):
    s = open(f).read()
    for m in re.finditer(r"update public\.lf_rules.{0,600}?table_name = '([A-Za-z_]+)'", s, re.S):
        if 'allowed_keys' in m.group(0):
            later.add(m.group(1))
still = sorted(n for n in (noallow - later) if n in allt)
print(f"collections: {len(allt)}; without a field allowlist: {len(still)}")
print(', '.join(still))

#!/usr/bin/env bash
# usage: run-gate.sh <logname> <command...>   (runs in /home/user/ledgerflow; logs timing + exit code)
name="$1"; shift
log="/home/user/agent7-evidence/${name}.log"
cd /home/user/ledgerflow || exit 99
{
  echo "### GATE: $name"
  echo "### CMD: $*"
  echo "### HEAD: $(git rev-parse HEAD)  (upstream/main $(git rev-parse upstream/main))"
  echo "### NODE: $(node --version)  START: $(date -u +%FT%TZ)"
} > "$log"
start=$(date +%s)
"$@" >> "$log" 2>&1
code=$?
end=$(date +%s)
{
  echo "### END: $(date -u +%FT%TZ)  ELAPSED_SECONDS: $((end-start))"
  echo "### EXIT=$code"
} >> "$log"

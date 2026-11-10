#!/usr/bin/env bash
# Sequential gate chain at the pinned tree (logs in /home/user/agent7-evidence)
export LF_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/lf_test
export DATABASE_URL=$LF_TEST_DATABASE_URL
/home/user/agent7-tools/run-gate.sh 02-eslint npm run lint:eslint
for i in 1 2 3 4; do
  /home/user/agent7-tools/run-gate.sh 04-unit-shard-$i env NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx tsx --test --test-concurrency=2 --test-shard=$i/4 src/tests/*.test.ts src/tests/*.test.tsx src/lib/*.test.ts src/server/utils/*.test.ts
done
/home/user/agent7-tools/run-gate.sh 05-build npm run build
echo "CHAIN DONE $(date -u +%FT%TZ)" > /home/user/agent7-evidence/CHAIN_DONE

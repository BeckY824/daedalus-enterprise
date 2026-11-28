#!/usr/bin/env bash
# 刷新单测耗时表（一条命令）：bash scripts/ci/refresh-unit-timing.sh [run id]
# 拉 main 上一轮全套 CI 的 8 个 vitest-timing-N 产物，合并成 文件 → 秒，写回 scripts/ci/unit-timing.json。
# 不填 run id 就取 main 最近一轮成功的 CI。需要 gh、jq。刷新后跑 node scripts/ci/shard-unit.mjs --check 8 再提交。
set -euo pipefail
cd "$(dirname "$0")/../.."
run="${1:-$(gh run list --branch main --workflow ci.yml --status success --limit 1 --json databaseId -q '.[0].databaseId')}"
[ -n "$run" ] || { echo "找不到 main 上成功的 CI"; exit 1; }
d=$(mktemp -d); trap 'rm -rf "$d"' EXIT
gh run download "$run" --pattern 'vitest-timing-*' --dir "$d"
n=$(find "$d" -name 'vitest-timing-*.json' | wc -l | tr -d ' ')
[ "$n" -eq 8 ] || { echo "只拿到 $n 份耗时产物（要 8 份），可能是 PR 牵连模式的轮次"; exit 1; }
find "$d" -name 'vitest-timing-*.json' -print0 | xargs -0 cat | jq -s '
  [.[].testResults[] | {key: (.name | sub("^.*/tests/"; "tests/")), value: (((.endTime - .startTime) / 1000 * 10 | round) / 10)}]
  | from_entries' > scripts/ci/unit-timing.json
echo "已刷新 run $run：$(jq 'length' scripts/ci/unit-timing.json) 个文件"

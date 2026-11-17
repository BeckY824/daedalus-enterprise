#!/usr/bin/env sh
# post-merge / post-checkout 共用：<从> 到 <到> 之间两份 schema 有变就重跑两条 prisma generate。
# 用法：sh hooks/prisma-regen.sh <从> <到> <说明>；在仓库根目录跑
from=$1; to=$2; what=${3:-更新}
changed=$(git diff --name-only "$from" "$to" -- prisma/schema.prisma prisma/control.prisma 2>/dev/null) || exit 0
[ -n "$changed" ] || exit 0
echo "▶ $what 改到了 $(echo $changed | tr "\n" " " | sed "s/ *$//")：重跑 prisma generate"
if [ ! -x node_modules/.bin/prisma ]; then
  echo "  ! 还没装依赖（node_modules/.bin/prisma 不在），先 npm ci，再跑 npx prisma generate && npx prisma generate --schema=prisma/control.prisma"
  exit 0
fi
ok=1
npx prisma generate > /dev/null 2>&1 || ok=
npx prisma generate --schema=prisma/control.prisma > /dev/null 2>&1 || ok=
if [ -n "$ok" ]; then
  echo "  ✓ 两条 prisma generate 跑完"
else
  echo "  ✗ prisma generate 没跑成，手动跑：npx prisma generate && npx prisma generate --schema=prisma/control.prisma"
fi
exit 0

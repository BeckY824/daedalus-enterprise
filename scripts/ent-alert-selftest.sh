#!/usr/bin/env bash
# 报错告警本地实测（E-417 阶段 2）：不连任何真实机器人地址。
# 起一个本机 HTTP 收件桩（node 自带 http，记下每个请求），我方 / 客户群两个地址都指向它的 /ours、/even；
# 往临时数据目录的 telemetry/ 塞伪造记录，真跑 scripts/ent-alert.mjs（走命令行，和 timer 一样），数每步收到几条、发给谁。
# 最后试一遍安装脚本（只写临时目录、不碰 systemd）。跑完删临时目录、按 pid 停桩进程。
#   bash scripts/ent-alert-selftest.sh
set -uo pipefail
cd "$(dirname "$0")/.."
NODE=$(command -v node)
T=$(mktemp -d "${TMPDIR:-/tmp}/ent-alert-selftest.XXXXXX")
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && { kill "$p"; wait "$p"; } 2>/dev/null; done; rm -rf "$T"; }
trap cleanup EXIT
FAIL=0
ok() { echo "  ✓ $1"; }
bad() { echo "  ✗ $1"; FAIL=1; }

# 收件桩：每个请求记一行 {"p":路径,"text":正文}；端口写到 $T/stub.port
cat > "$T/stub.mjs" <<'JS'
import http from "node:http";
import fs from "node:fs";
const [log, portFile] = process.argv.slice(2);
http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    let text = "";
    try { text = JSON.parse(b).content.text; } catch {}
    fs.appendFileSync(log, JSON.stringify({ p: req.url, text }) + "\n");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ code: 0 }));
  });
}).listen(0, "127.0.0.1", function () { fs.writeFileSync(portFile, String(this.address().port)); });
JS
# 假业务进程：只回 200 的 /api/health
cat > "$T/health.mjs" <<'JS'
import http from "node:http";
import fs from "node:fs";
const portFile = process.argv[2];
const want = Number(process.argv[3] || 0);
http.createServer((_q, r) => r.end("{\"ok\":true}")).listen(want, "127.0.0.1", function () { fs.writeFileSync(portFile, String(this.address().port)); });
JS
LOG=$T/stub.jsonl; : > "$LOG"
"$NODE" "$T/stub.mjs" "$LOG" "$T/stub.port" & PIDS+=($!)
for _ in $(seq 100); do [ -s "$T/stub.port" ] && break; sleep 0.1; done
[ -s "$T/stub.port" ] || { echo "收件桩没起来"; exit 1; }
SP=$(cat "$T/stub.port")
echo "收件桩 127.0.0.1:$SP（/ours = 我方群，/even = 客户群）"

# 用法：newdir <名字> [额外的 .alert-env 行]
newdir() {
  D=$T/$1; mkdir -p "$D/telemetry"
  printf 'ALERT_WEBHOOK_OURS=http://127.0.0.1:%s/ours\nALERT_SECRET_OURS=so\nALERT_WEBHOOK_EVEN=http://127.0.0.1:%s/even\nALERT_SECRET_EVEN=se\nALERT_INSTANCE=selftest\n%s\n' "$SP" "$SP" "${2:-}" > "$D/.alert-env"
  : > "$LOG"
}
# 用法：rec <条数> <几分钟前（相对 BASE）> <用户（逗号分隔，轮着用；空=无）> <name> <code> <route；含 %i 则每条换一个>
BASE=2026-11-19T23:00:00Z   # 北京 07:00，离 09:00 心跳还早
rec() {
  "$NODE" -e '
    const [n, ago, us, name, code, route] = process.argv.slice(1);
    const base = Date.parse(process.argv[7]); const u = us ? us.split(",") : [];
    const out = [];
    for (let i = 0; i < +n; i++) {
      const x = { t: new Date(base - ago * 60000 + i * 1000).toISOString(), k: "err", src: "server", type: "服务端出错", name, route: route.replace("%i", i), kind: "render", role: "sales", digest: "9988" };
      if (code) x.code = code;
      if (u.length) x.u = u[i % u.length];
      out.push(JSON.stringify(x));
    }
    require("node:fs").appendFileSync(process.argv[8] + "/telemetry/tel-2026-11-19.p1.jsonl", out.join("\n") + "\n");
  ' "$1" "$2" "$3" "$4" "$5" "$6" "$BASE" "$D"
}
run() { # run <ISO 时刻> → 退出码放 $RC
  "$NODE" scripts/ent-alert.mjs --dir "$D" --now "$1" >/dev/null 2>"$T/err.txt"; RC=$?
}
cnt() { grep -c "\"p\":\"/$1\"" "$LOG" || true; }
expect() { # expect <说明> <我方期望> <客户期望>
  local o e; o=$(cnt ours); e=$(cnt even)
  printf '    收件桩：我方群 %s 条，客户群 %s 条\n' "$o" "$e"
  if [ "$o" = "$2" ] && [ "$e" = "$3" ]; then ok "$1"; else bad "$1（期望 我方 $2 / 客户 $3）"; fi
}

echo "[1] 数据库类 3 次（P2024，不同路由、同 1 人）→ 我方 + 客户群各 1"
newdir s1; rec 3 3 u1 PrismaClientKnownRequestError P2024 "/r%i"; run $BASE
expect "数据库类 ≥3" 1 1

echo "[2] 同类 5 次、只 1 人 → 只我方"
newdir s2; rec 5 3 u1 TypeError "" "/customers/[id]"; run $BASE
expect "单员工个案" 1 0

echo "[3] 同类 5 次、2 人 → 双发"
newdir s3; rec 5 3 u1,u2 TypeError "" "/customers/[id]"; run $BASE
expect "同类不止 1 人" 1 1

echo "[4] 停一个假端口 → 服务挂了只我方；恢复 → 恢复消息只我方"
node "$T/health.mjs" "$T/h.port" 0 & HP=$!; PIDS+=($HP)
for _ in $(seq 100); do [ -s "$T/h.port" ] && break; sleep 0.1; done
H=$(cat "$T/h.port")
newdir s4 "ALERT_HEALTH_URLS=http://127.0.0.1:$H/api/health"
run $BASE; run 2026-11-19T23:02:00Z
echo "    端口正常时两轮：" ; expect "探活正常不发" 0 0
kill $HP; wait $HP 2>/dev/null
run 2026-11-19T23:04:00Z; run 2026-11-19T23:06:00Z
echo "    停端口后连续 2 次不通："; expect "服务挂了只我方" 1 0
grep -q "服务挂了" "$LOG" && ok "内容是「服务挂了」" || bad "没有「服务挂了」"
: > "$LOG"
node "$T/health.mjs" "$T/h2.port" "$H" & PIDS+=($!)
for _ in $(seq 100); do [ -s "$T/h2.port" ] && break; sleep 0.1; done
run 2026-11-19T23:08:00Z
echo "    端口恢复后："; expect "恢复只我方" 1 0
grep -q "已恢复" "$LOG" && ok "内容是「已恢复」" || bad "没有「已恢复」"

echo "[5] 地址写错不影响退出码"
newdir s5; printf 'ALERT_WEBHOOK_OURS=http://127.0.0.1:9/nope\nALERT_WEBHOOK_EVEN=http://127.0.0.1:9/nope\n' > "$D/.alert-env"
rec 5 3 u1,u2 TypeError "" "/x"; run $BASE
[ "$RC" = 0 ] && ok "退出码 0（stderr：$(head -c 120 "$T/err.txt" | tr '\n' ' ')）" || bad "退出码 $RC"

echo "[6] --now 北京 09:00 → 心跳只我方"
newdir s6; run 2026-11-20T01:00:00Z
expect "心跳只我方" 1 0
grep -q "心跳" "$LOG" && ok "内容是「心跳」" || bad "没有「心跳」"

echo "[7] 安装脚本（只写临时目录，不碰 systemd）"
I=$T/inst; mkdir -p "$I/data" "$I/units"
IA=(--service crm-test --dir "$I" --port 3000 --workers 4 --node "$NODE" --unit-dir "$I/units" --no-systemctl --src scripts)
bash deploy/enterprise/tools/install-alert.sh "${IA[@]}" >"$T/i1.txt" 2>&1 && ok "首次安装退出 0" || { bad "首次安装失败"; cat "$T/i1.txt"; }
M=$(stat -c %a "$I/data/.alert-env" 2>/dev/null || stat -f %Lp "$I/data/.alert-env")
[ "$M" = 600 ] && ok ".alert-env 权限 600" || bad ".alert-env 权限 $M"
grep -q 'http://127.0.0.1:3003/api/health' "$I/data/.alert-env" && ok "模板里探活地址推到 3000..3003" || bad "探活地址不对"
grep -q '^ExecStart=.* --dir '"$I"'/data$' "$I/units/crm-test-alert.service" && grep -q 'Type=oneshot' "$I/units/crm-test-alert.service" && ok "service：oneshot + --dir 数据目录" || bad "service 内容不对"
grep -q 'OnBootSec=2min' "$I/units/crm-test-alert.timer" && grep -q 'OnUnitActiveSec=2min' "$I/units/crm-test-alert.timer" && ok "timer：2min / 2min" || bad "timer 内容不对"
echo "ALERT_INSTANCE=keepme" >> "$I/data/.alert-env"
bash deploy/enterprise/tools/install-alert.sh "${IA[@]}" >"$T/i2.txt" 2>&1 && grep -q keepme "$I/data/.alert-env" && ! grep -q '已写：' "$T/i2.txt" && ok "重跑幂等：不覆盖 .alert-env、单元没变不重写" || { bad "重跑不幂等"; cat "$T/i2.txt"; }
bash deploy/enterprise/tools/install-alert.sh --uninstall --service crm-test --dir "$I" --unit-dir "$I/units" --no-systemctl >/dev/null 2>&1
[ ! -e "$I/units/crm-test-alert.service" ] && [ ! -e "$I/units/crm-test-alert.timer" ] && [ ! -d "$I/alert" ] && [ -f "$I/data/.alert-env" ] && ok "--uninstall：单元和脚本删了，.alert-env 留着" || bad "--uninstall 不对"

echo
if [ "$FAIL" = 0 ]; then echo "全部通过"; else echo "有失败项"; fi
exit $FAIL

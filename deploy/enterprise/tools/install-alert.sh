#!/usr/bin/env bash
# 装 / 卸企业版报错告警（E-417 阶段 2）：在客户服务器上以 root 跑。写法照备份（ent-backup.sh）：
#   <服务名>-alert.service（Type=oneshot）+ <服务名>-alert.timer（开机 2 分钟后、之后每 2 分钟一次）。
#
# 用法（把本文件和 scripts/ent-alert.mjs、scripts/telemetry-daily.mjs 放同一个目录，或在仓库里直接跑）：
#   bash install-alert.sh [--service crm-enterprise] [--dir /opt/crm-enterprise] [--port 3000] [--workers 4]
#                         [--node <node 路径>] [--src <两份 mjs 所在目录>] [--user <运行告警的系统用户>]
#   bash install-alert.sh --uninstall [--service …] [--dir …]     停 timer、删单元和 <目录>/alert/；.alert-env、alert-state.json 留着
#   --unit-dir <目录> --no-systemctl   只把单元写到别的目录、不碰 systemd（本机试装、ent-alert-selftest.sh 用）
# 参数默认值 = instances/<实例>.env 里的 SERVICE / DIR / PORT / WORKERS（c2：crm-enterprise、/opt/crm-enterprise、3000、4），
#   node 默认 <目录>/node/bin/node（和 run.sh 同一个）。多进程的进程 i 听 PORT+i-1（ent-render.sh），探活地址按这个推：PORT..PORT+WORKERS-1 各一个 http://127.0.0.1:<端口>/api/health。
# 装完：
#   <目录>/alert/ent-alert.mjs、telemetry-daily.mjs   同一目录（前者 import 后者；用软链也行，入口按真实路径判断）
#   运行身份：默认取 <目录>/data 的属主（c2 主服务的系统用户），非 root 就在单元里写 User= / Group=，不以 root 在数据目录写文件
#     （避免跟随软链）；取不到或属主是 root 就不加（仍是 root）；--user 可显式指定。.alert-env 也 chown 给该用户、600。
#   <目录>/data/.alert-env                             没有就按模板建（600，键留空）；已有不覆盖（只把权限收到 600）
#   运行记录读 <目录>/data/telemetry/（run.sh 里 DATABASE_URL=file:<目录>/data/crm.db → store.ts 写在库文件旁边的 telemetry/）
# 幂等：重跑只补差异；单元 / 脚本内容没变就不重启 timer。
# 注意：ent-alert.mjs 非 --dry 运行带排他锁（<目录>/data/alert-state.lock，拿不到就退出 0，超 10 分钟算陈旧）；手动看看用 --dry，手动真跑用 systemctl start <服务名>-alert.service。
# 不用 PrivateTmp：ent-alert.mjs「状态写不了」时的限频小文件放系统临时目录，私有 tmp 每次运行都清空，限频就失效了。
set -euo pipefail

SERVICE=crm-enterprise
DIR=/opt/crm-enterprise
PORT=3000
WORKERS=4
RUN_USER=""
NODE=""
SRC=""
UNIT_DIR=/etc/systemd/system
NO_SYSTEMCTL=0
UNINSTALL=0

die() { echo "install-alert：$*" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case $1 in
    --service) [ $# -ge 2 ] || die "--service 缺值"; SERVICE=$2; shift 2 ;;
    --dir) [ $# -ge 2 ] || die "--dir 缺值"; DIR=$2; shift 2 ;;
    --port) [ $# -ge 2 ] || die "--port 缺值"; PORT=$2; shift 2 ;;
    --workers) [ $# -ge 2 ] || die "--workers 缺值"; WORKERS=$2; shift 2 ;;
    --node) [ $# -ge 2 ] || die "--node 缺值"; NODE=$2; shift 2 ;;
    --src) [ $# -ge 2 ] || die "--src 缺值"; SRC=$2; shift 2 ;;
    --user) [ $# -ge 2 ] || die "--user 缺值"; RUN_USER=$2; shift 2 ;;
    --unit-dir) [ $# -ge 2 ] || die "--unit-dir 缺值"; UNIT_DIR=$2; shift 2 ;;
    --no-systemctl) NO_SYSTEMCTL=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h | --help) sed -n 1,20p "$0"; exit 0 ;;
    *) die "不认识的参数 $1（--service --dir --port --workers --node --src --user --unit-dir --no-systemctl --uninstall）" ;;
  esac
done
[[ $SERVICE =~ ^[a-z0-9][a-z0-9._-]*$ ]] || die "服务名只许小写字母、数字、. _ -：$SERVICE"
[[ $DIR == /* ]] || die "--dir 要绝对路径：$DIR"
[[ $UNIT_DIR == /* ]] || die "--unit-dir 要绝对路径：$UNIT_DIR"
[[ $PORT =~ ^[0-9]{2,5}$ ]] || die "--port 要数字：$PORT"
[[ $WORKERS =~ ^[1-9][0-9]?$ ]] || die "--workers 要 1..99：$WORKERS"
[ -n "$NODE" ] || NODE=$DIR/node/bin/node
[[ $NODE == /* ]] || die "--node 要绝对路径：$NODE"
case "$DIR$NODE" in *[[:space:]\"\']*) die "路径里不许有空格和引号" ;; esac
case "$DIR$NODE" in *%* | *\|*) die "路径里不许有 % 和 |（systemd 单元里 % 是占位符、脚本里 | 当分隔）" ;; esac

A=$DIR/alert
DATA=$DIR/data
ENVF=$DATA/.alert-env
SVC=$UNIT_DIR/$SERVICE-alert.service
TMR=$UNIT_DIR/$SERVICE-alert.timer
ctl() { [ "$NO_SYSTEMCTL" = 1 ] || systemctl "$@"; }

if [ "$UNINSTALL" = 1 ]; then
  ctl disable --now "$SERVICE-alert.timer" >/dev/null 2>&1 || true
  ctl stop "$SERVICE-alert.service" >/dev/null 2>&1 || true
  rm -f "$SVC" "$TMR"
  rm -rf "$A"
  ctl daemon-reload
  ctl reset-failed "$SERVICE-alert.service" >/dev/null 2>&1 || true
  echo "已卸：$SERVICE-alert.timer / .service、${A}。留着没动：${ENVF}、$DATA/alert-state.json（要彻底删手动 rm）"
  exit 0
fi

# ---- 装 ----
if [ -z "$SRC" ]; then
  H=$(cd "$(dirname "$0")" && pwd)
  if [ -f "$H/ent-alert.mjs" ]; then SRC=$H; elif [ -f "$H/../../../scripts/ent-alert.mjs" ]; then SRC=$(cd "$H/../../../scripts" && pwd); fi
fi
[ -n "$SRC" ] || die "找不到 ent-alert.mjs：用 --src 指到放两份 mjs 的目录"
for f in ent-alert.mjs telemetry-daily.mjs; do [ -f "$SRC/$f" ] || die "$SRC 里没有 ${f}（两份要一起放）"; done
[ -x "$NODE" ] || die "找不到可执行的 node：${NODE}（--node 指定）"
[ -d "$DATA" ] || die "数据目录不存在：${DATA}（--dir 指到企业版装的目录；这个脚本不建库目录）"
[ -d "$UNIT_DIR" ] || die "单元目录不存在：$UNIT_DIR"

# 运行身份：--user > 数据目录属主（Linux stat -c %U，macOS stat -f %Su；取不到就不加）；root 等于不加
if [ -z "$RUN_USER" ]; then RUN_USER=$(stat -c %U "$DATA" 2>/dev/null || stat -f %Su "$DATA" 2>/dev/null || true); fi
[ "$RUN_USER" != root ] || RUN_USER=""
RUN_GROUP=""
if [ -n "$RUN_USER" ]; then
  [[ $RUN_USER =~ ^[a-z_][a-z0-9_-]*$ ]] || die "运行用户名不合法：${RUN_USER}（取不到或不认识的属主请用 --user 指定）"
  RUN_GROUP=$(id -gn "$RUN_USER" 2>/dev/null || true)
  [ -n "$RUN_GROUP" ] || die "系统里没有用户 ${RUN_USER}（--user 指定一个存在的用户）"
fi
chown_run() { # 只有 root 才改属主（本机试装不是 root，跳过）
  if [ -n "$RUN_USER" ] && [ "$(id -u)" = 0 ]; then chown -h "$RUN_USER:$RUN_GROUP" "$@"; fi
}
no_link() { # data/ 归服务用户，它可以把这两个文件换成指向系统文件的软链；root 不跟着软链改属主 / 权限
  [ ! -L "$1" ] || die "$1 是软链接，拒绝继续（root 会跟着改到目标文件）；确认来历后删掉这个软链再重跑"
}

CHANGED=0
no_link "$A"             # alert/ 本身也可能被换成软链（install -d / chmod 会跟着改到目标）；增量审查 9977e7cc 可改
install -d -m 755 "$A"   # 不跟 root 的 umask：加固机上 027/077 会让服务用户进不了 alert/
chmod 755 "$A"
for f in ent-alert.mjs telemetry-daily.mjs; do
  if ! cmp -s "$SRC/$f" "$A/$f"; then install -m 644 "$SRC/$f" "$A/$f"; CHANGED=1; echo "已放：$A/$f"; fi
  chmod 644 "$A/$f"
done

# 探活地址：每个进程一个 /api/health（进程 i = PORT+i-1）
URLS=""
for i in $(seq 1 "$WORKERS"); do URLS="${URLS:+$URLS,}http://127.0.0.1:$((PORT + i - 1))/api/health"; done

no_link "$ENVF"
no_link "$DATA/alert-state.json"
if [ ! -f "$ENVF" ]; then
  (
    umask 077
    cat > "$ENVF" <<EOF
# 企业版报错告警配置（只在这台服务器上，600 权限；ent-alert.mjs 每次运行现读，改完不用重启）
# 格式 KEY=VALUE，# 开头是注释，值两端的引号会去掉。键留空 = 那一项不启用。

# 我方技术群的飞书自定义机器人：收全部（报警、恢复、每天北京 09:00 起的心跳）。地址留空 = 什么都不发
ALERT_WEBHOOK_OURS=
# 我方群机器人的签名密钥；机器人没开「签名校验」就留空
ALERT_SECRET_OURS=

# 客户群的机器人：只收 3 类（同类错误不止 1 人撞上、>=3 位员工同时撞上、数据库类错误）及其恢复。留空 = 不发客户群
ALERT_WEBHOOK_EVEN=
# 客户群机器人的签名密钥；没开签名校验就留空
ALERT_SECRET_EVEN=

# 探活地址，逗号分隔，每个进程一个（连续 2 次不通发「服务挂了」，只发我方）。留空 = 不探活
# 这台按 --port $PORT --workers $WORKERS 推出来的是：
#   $URLS
ALERT_HEALTH_URLS=

# 消息里写的实例名，留空 = 「企业版」
ALERT_INSTANCE=
EOF
  )
  chown_run "$ENVF"
  echo "已建：${ENVF}（600，键都是空的，填好才会发；探活地址见文件里的注释）"
else
  MODE=$(stat -c %a "$ENVF" 2>/dev/null || stat -f %Lp "$ENVF")
  if [ "$MODE" != 600 ]; then chmod 600 "$ENVF"; echo "已把 $ENVF 的权限从 $MODE 收到 600"; fi
  chown_run "$ENVF"
  echo "已有：${ENVF}（不覆盖）"
fi

# 数据目录里已有 root 属主的状态文件（以前用 root 手动跑过）：运行用户写不了会让去重 / 限频全失效，一并改属主
[ ! -f "$DATA/alert-state.json" ] || chown_run "$DATA/alert-state.json"

want_svc="[Unit]
Description=CRM enterprise $SERVICE error alert (telemetry + health probe)
[Service]
Type=oneshot
${RUN_USER:+User=$RUN_USER
Group=$RUN_GROUP
}ExecStart=$NODE $A/ent-alert.mjs --dir $DATA
Nice=10
IOSchedulingClass=idle
TimeoutStartSec=300
"
want_tmr="[Unit]
Description=CRM enterprise $SERVICE error alert, every 2 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
AccuracySec=10s
[Install]
WantedBy=timers.target
"
for pair in "$SVC|$want_svc" "$TMR|$want_tmr"; do
  p=${pair%%|*}; body=${pair#*|}
  if [ ! -f "$p" ] || [ "$(cat "$p")" != "${body%$'\n'}" ]; then printf '%s' "$body" > "$p"; CHANGED=1; echo "已写：$p"; fi
done
ctl daemon-reload
if ! ctl enable --now "$SERVICE-alert.timer" >/dev/null; then
  echo "install-alert：启用 $SERVICE-alert.timer 失败（systemctl enable --now 报错，原因见上面 systemctl 输出；可再跑 systemctl status $SERVICE-alert.timer --no-pager 查看）" >&2
  exit 1
fi
[ "$CHANGED" = 0 ] || ctl restart "$SERVICE-alert.timer"
echo "告警定时：每 2 分钟（$SERVICE-alert.timer），脚本在 ${A}，读 $DATA/telemetry/，配置 $ENVF"
if [ "$NO_SYSTEMCTL" = 0 ]; then systemctl list-timers "$SERVICE-alert.timer" --no-pager | sed -n 2p; fi
# 空跑一次：只打印将发什么，不发、不写状态；顺带验证 node 和两份脚本能跑
echo "空跑（--dry）："
# 有运行用户且当前是 root：按真实运行身份跑（验证它进得了 alert/、读得了 .alert-env 和 telemetry/）；本机 / 非 root 直接跑
if [ -n "$RUN_USER" ] && [ "$(id -u)" = 0 ]; then
  if command -v runuser >/dev/null 2>&1; then
    { runuser -u "$RUN_USER" -- "$NODE" "$A/ent-alert.mjs" --dir "$DATA" --dry | head -n 20; } || true
  else
    { su -s /bin/sh "$RUN_USER" -c "\"$NODE\" \"$A/ent-alert.mjs\" --dir \"$DATA\" --dry" | head -n 20; } || true
  fi
else
  { "$NODE" "$A/ent-alert.mjs" --dir "$DATA" --dry | head -n 20; } || true
fi
echo "（空跑完。填好 $ENVF 里的地址后，看日志：journalctl -u $SERVICE-alert.service -n 20 --no-pager）"

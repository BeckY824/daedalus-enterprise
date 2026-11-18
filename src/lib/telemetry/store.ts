/**
 * 运行记录落盘（批次 28-⑤，字段见 lib/telemetry/fields.ts）：服务器本地文件，一天一份，留 14 天。
 *
 * 为什么不进数据库：一行几百字节、一天几千行，进库要加表、加迁移、要清理任务，还和业务写抢 SQLite 那一把写锁（10-29 压测撞过）；
 * 文件追加不碰库，摘要脚本（scripts/telemetry-daily.mjs）用服务器自带的 node 直接读，备份也不用带它。
 *
 * 放哪：CRM_TELEMETRY_DIR；没设放库文件旁边的 telemetry/（同 lib/proc-lock.ts 锁目录的找法，私有部署就是数据目录，跟着数据卷走）。
 * 文件名 tel-YYYY-MM-DD.p<进程号>.jsonl（UTC 日期）：多进程部署各写各的，不抢同一个文件。目录 700、文件 600。
 * 保留：每进程每天第一次写时删掉 14 天前的文件。单个文件一天最多 20MB，满了当天不再写（防刷爆磁盘）。
 * 开关：只在企业版开（CRM_ENTERPRISE=1）；CRM_TELEMETRY=0 关掉。写不出去一律吞掉，绝不拖垮请求。
 */
import fs from "node:fs";
import path from "node:path";
import { 实例号 } from "../proc-lock";
import type { 一行 } from "./fields";

export const 保留天数 = 14;
export const 单文件上限字节 = 20 * 1024 * 1024;
export const 文件名式 = /^tel-(\d{4}-\d{2}-\d{2})\.p\d+\.jsonl$/;

type 环境 = Record<string, string | undefined>;

export function 遥测开着(env: 环境 = process.env): boolean {
  return env.CRM_ENTERPRISE === "1" && env.CRM_TELEMETRY !== "0";
}

export function 遥测目录(env: 环境 = process.env): string {
  const 指定 = env.CRM_TELEMETRY_DIR?.trim();
  if (指定) return 指定;
  const url = env.DATABASE_URL ?? "";
  const 库 = url.startsWith("file:") ? url.slice(5).split("?")[0] : "";
  if (!库) return path.join(process.cwd(), ".crm-telemetry");
  return path.join(path.dirname(path.resolve(库)), "telemetry");
}

const 日期 = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** 删掉 保留天数 天以前的文件（今天算第 1 天）。只认 tel-*.jsonl，别的文件不碰 */
export function 清旧文件(目录: string, 现在 = Date.now()): number {
  const 界 = 日期(现在 - (保留天数 - 1) * 86_400_000);
  let 删 = 0;
  let 名们: string[] = [];
  try {
    名们 = fs.readdirSync(目录);
  } catch {
    return 0;
  }
  for (const 名 of 名们) {
    const m = 名.match(文件名式);
    if (!m || m[1] >= 界) continue;
    try {
      fs.unlinkSync(path.join(目录, 名));
      删++;
    } catch {
      /* 删不掉下次再删 */
    }
  }
  return 删;
}

type 状态 = { 天: string; 字节: number };
const g = globalThis as unknown as { __crmTelemetry?: Map<string, 状态> };
/** 目录 → 这个进程今天写到哪了。放 globalThis：instrumentation 和路由不一定是同一份模块 */
const 各目录 = (g.__crmTelemetry ??= new Map());

/** 追加一行。回 true = 写进去了；关着、满了、写不出去回 false */
export function 写一条(行: 一行, opts: { 目录?: string; 现在?: number; env?: 环境 } = {}): boolean {
  try {
    const env = opts.env ?? process.env;
    const 目录 = opts.目录 ?? 遥测目录(env);
    const 现在 = opts.现在 ?? Date.now();
    const 天 = 日期(现在);
    const 文件 = path.join(目录, `tel-${天}.p${实例号(env)}.jsonl`);
    let 态 = 各目录.get(目录);
    if (!态 || 态.天 !== 天) {
      fs.mkdirSync(目录, { recursive: true, mode: 0o700 });
      清旧文件(目录, 现在);
      let 已有 = 0;
      try {
        已有 = fs.statSync(文件).size;
      } catch {
        /* 今天还没有 */
      }
      态 = { 天, 字节: 已有 };
      各目录.set(目录, 态);
    }
    const 串 = JSON.stringify(行) + "\n";
    const 长 = Buffer.byteLength(串);
    if (态.字节 + 长 > 单文件上限字节) return false;
    fs.appendFileSync(文件, 串, { mode: 0o600 });
    态.字节 += 长;
    return true;
  } catch {
    return false;
  }
}

/** 测试用：忘掉各目录今天写到哪了 */
export function 重置写状态() {
  各目录.clear();
}

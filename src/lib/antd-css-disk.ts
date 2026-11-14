/**
 * antd 样式外链的落盘兜底（11-15，lib/antd-css-store.ts）：重启、部署之后，旧进程发出去的页面引用的号，
 * 在新进程渲染同一页之前进程里没有——从盘上读。
 *
 * 放哪：部署是把整个应用目录换掉，所以不放 .next 和应用目录里；默认放系统临时目录下的固定子目录
 * （os.tmpdir()/crm-antd-css），CRM_ANTD_CSS_DIR 可以另指。文件名就是号（只认 号的样子，杜绝路径穿越），
 * 先写临时文件再 rename（并发、半截写都不会读到坏的）。总量有上限：最多 上限个数 个、超过 最久天数 没写过的清掉。
 * 落盘、读盘失败都不抛：页面照样从进程里拿；只是重启后旧页面取不到（和没这层一样）。
 * 只在服务端用（node:fs），浏览器包不进来：页面那头经 instrumentation.ts 装到 globalThis（装样式落盘）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { 号的样子, 装落盘 } from "@/lib/antd-css-store";

export const 上限个数 = 400;
export const 最久天数 = 60;

export function 样式目录(): string {
  return process.env.CRM_ANTD_CSS_DIR?.trim() || path.join(os.tmpdir(), "crm-antd-css");
}

function 文件(号: string): string | null {
  return 号的样子.test(号) ? path.join(样式目录(), `${号}.css`) : null;
}

/** 落一份；已有就只把时间刷新（清理按最近写过的留） */
export function 落盘(号: string, 正文: string): void {
  const f = 文件(号);
  if (!f) return;
  try {
    const 现在 = new Date();
    if (fs.existsSync(f)) {
      fs.utimesSync(f, 现在, 现在);
      return;
    }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const 临时 = `${f}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(临时, 正文);
    fs.renameSync(临时, f);
    清理(path.dirname(f));
  } catch (e) {
    console.error("[antd 样式落盘] 没写成，重启后旧页面的样式会取不到", e instanceof Error ? e.message : e);
  }
}

/** 读一份；号不合法、没有、读不了 = undefined */
export function 读盘(号: string): string | undefined {
  const f = 文件(号);
  if (!f) return undefined;
  try {
    return fs.readFileSync(f, "utf8");
  } catch {
    return undefined;
  }
}

/** 超过 最久天数 的、超过 上限个数 的（按时间从旧删）、一小时前没收尾的临时文件 都删掉 */
export function 清理(目录: string = 样式目录(), 现在 = Date.now()): void {
  try {
    const 们 = fs.readdirSync(目录).flatMap((n) => {
      try {
        return [{ n, t: fs.statSync(path.join(目录, n)).mtimeMs }];
      } catch {
        return [];
      }
    });
    const 删 = (n: string) => { try { fs.unlinkSync(path.join(目录, n)); } catch { /* 别的进程先删了 */ } };
    for (const x of 们) if (x.n.endsWith(".tmp") && 现在 - x.t > 3600_000) 删(x.n);
    const 样式 = 们.filter((x) => x.n.endsWith(".css")).sort((a, b) => b.t - a.t);
    样式.forEach((x, i) => { if (i >= 上限个数 || 现在 - x.t > 最久天数 * 86400_000) 删(x.n); });
  } catch {
    // 目录还没有
  }
}

/** 服务启动时装上（instrumentation.ts）：页面登记样式时顺手落盘 */
export function 装样式落盘(): void {
  装落盘({ 写: 落盘 });
}

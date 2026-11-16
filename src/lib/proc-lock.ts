/**
 * 跨进程锁（11-16，企业版多进程）：数据目录里一个独占创建的锁文件，同一台机器上的几个服务进程都认。
 *
 * 用在：后台任务占位（lib/jobs.ts，只许一个进程跑钟）、飞书 / 钉钉同步和通讯录同步的「正在同步」。
 *
 * 怎么占：先把内容（pid、主机、实例号、开始时间、随机号、附带信息）写进临时文件，再 link 成锁文件。
 * link 遇到已有就失败（EEXIST），所以「建出来」和「有内容」是一步，别的进程不会读到写了一半的锁。
 *
 * 不留死锁：
 *   - 占着的进程每 心跳毫秒 摸一下锁文件（改 mtime）；过期毫秒 没摸过就算死锁，谁都能抢
 *   - 同一台机器上，记的 pid 已经不在了 → 马上算死锁（进程崩了、被 kill -9 了，不用等过期）
 *   - 记的 pid 就是自己、但本进程没占过这把（上一辈子留下的，容器里 pid 常是 1）→ 死锁
 * 抢死锁要先占一个「抢锁」小文件（.steal），占到后再看一遍还是不是那把死锁才删，两个进程同时抢不会都以为抢到。
 *
 * 目录：CRM_LOCK_DIR，没设就是库文件旁边的 .crm-locks/<库文件名>/（DATABASE_URL=file:/data/crm.db → /data/.crm-locks/crm.db），
 * 再没有就是当前目录下的 .crm-locks/。同一套部署的几个进程连同一个库，所以自然落在同一个目录。
 *
 * 目录写不进去（权限、只读盘）这类意外：不挡业务，回「降级」的锁（当占到了），打一行日志；
 * 调用方自己的进程内标记照样防本进程叠跑。
 *
 * 都是同步 IO（几个小文件），占锁和看锁一步做完，中间不让出事件循环。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export type 锁信息 = {
  pid: number;
  主机: string;
  /** CRM_INSTANCE，没设是 1 */
  实例: number;
  /** ISO 时间 */
  开始: string;
  号: string;
  附?: Record<string, unknown>;
};

export type 锁 = {
  信息: 锁信息;
  /** 目录写不进去时给的空锁：当占到了，但别的进程看不到 */
  降级: boolean;
  /** 放掉：停心跳、锁文件还是自己的才删。重复调没事 */
  放: () => void;
};

export type 占锁结果 = { ok: true; 锁: 锁 } | { ok: false; 占着的: 锁信息 | null };

export type 锁选项 = {
  /** 多久没心跳算死锁，默认 2 分钟 */
  过期毫秒?: number;
  /** 多久摸一次，默认 20 秒；0 = 不起心跳（测试用） */
  心跳毫秒?: number;
  附?: Record<string, unknown>;
  目录?: string;
  /** 测试用：当前时间 */
  现在?: () => number;
};

export const 默认过期毫秒 = 2 * 60_000;
export const 默认心跳毫秒 = 20_000;
const 抢锁过期毫秒 = 10_000;

/** 本进程占着的锁：路径 → 号。放 globalThis：instrumentation 和页面 server action 不一定是同一份模块 */
const 占着 = ((globalThis as unknown as { __crmProcLocks?: Map<string, string> }).__crmProcLocks ??= new Map());

export function 实例号(env: Record<string, string | undefined> = process.env): number {
  const v = (env.CRM_INSTANCE ?? "").trim();
  if (!/^\d{1,4}$/.test(v)) return 1;
  const n = Number(v);
  return n >= 1 ? n : 1;
}

export function 锁目录(env: Record<string, string | undefined> = process.env): string {
  const 指定 = env.CRM_LOCK_DIR?.trim();
  if (指定) return 指定;
  const url = env.DATABASE_URL ?? "";
  const 库 = url.startsWith("file:") ? url.slice(5).split("?")[0] : "";
  if (!库) return path.join(process.cwd(), ".crm-locks");
  // 按库分子目录：同一目录下的几个库（开发 dev.db、E2E e2e.db）各占各的，不互相挡
  const 绝对 = path.resolve(库);
  return path.join(path.dirname(绝对), ".crm-locks", path.basename(绝对));
}

/** 锁名只认字母数字和 - _，杜绝路径穿越 */
function 锁文件(名: string, 目录: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(名)) throw new Error(`锁名不对：${名}`);
  return path.join(目录, `${名}.lock`);
}

function 进程还在(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = 在，只是不是我们的
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

type 读到 = { 信息: 锁信息 | null; mtime: number };

function 读(p: string): 读到 | null {
  try {
    const st = fs.statSync(p);
    let 信息: 锁信息 | null = null;
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      if (j && typeof j.pid === "number" && typeof j.号 === "string") 信息 = j as 锁信息;
    } catch {
      信息 = null;
    }
    return { 信息, mtime: st.mtimeMs };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** 这把锁已经没人真占着了（过期 / 进程没了 / 本进程上一辈子留下的） */
export function 是死锁(读: 读到, p: string, 过期毫秒: number, 现在: number): boolean {
  if (现在 - 读.mtime > 过期毫秒) return true;
  const 信息 = 读.信息;
  if (!信息) return false; // 内容不认得：只按过期算
  if (信息.主机 !== os.hostname()) return false;
  if (信息.pid === process.pid) return 占着.get(p) !== 信息.号;
  return !进程还在(信息.pid);
}

/** 抢死锁：占到 .steal 后再确认一遍还是那把死锁才删。回 true = 删掉了（或已经没了），可以再 link */
function 抢(p: string, 判过的号: string | null, 过期毫秒: number, 现在: () => number): boolean {
  const m = `${p}.steal`;
  try {
    fs.writeFileSync(m, String(process.pid), { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    // 别人在抢；抢到一半崩了留下的 .steal 过 10 秒清掉，下回再来
    try {
      if (现在() - fs.statSync(m).mtimeMs > 抢锁过期毫秒) fs.unlinkSync(m);
    } catch {
      /* 没了就算了 */
    }
    return false;
  }
  try {
    const 再读 = 读(p);
    if (!再读) return true;
    if ((再读.信息?.号 ?? null) !== 判过的号 || !是死锁(再读, p, 过期毫秒, 现在())) return false;
    fs.unlinkSync(p);
    return true;
  } finally {
    try {
      fs.unlinkSync(m);
    } catch {
      /* 已经没了 */
    }
  }
}

let 降级说过 = false;

function 降级锁(信息: 锁信息, e: unknown): 锁 {
  if (!降级说过) {
    降级说过 = true;
    console.error(`[跨进程锁] 锁目录用不了，只防本进程叠跑：${e instanceof Error ? e.message : String(e)}`);
  }
  return { 信息, 降级: true, 放: () => {} };
}

/**
 * 占一把锁。占到回 { ok: true, 锁 }，用完一定要 锁.放()；别人占着回 { ok: false, 占着的 }。
 * 本进程已经占着同名的也算「别人占着」（不可重入）。
 */
export function 占锁(名: string, opts: 锁选项 = {}): 占锁结果 {
  const 过期毫秒 = opts.过期毫秒 ?? 默认过期毫秒;
  const 心跳毫秒 = opts.心跳毫秒 ?? 默认心跳毫秒;
  const 现在 = opts.现在 ?? Date.now;
  const 目录 = opts.目录 ?? 锁目录();
  const p = 锁文件(名, 目录);
  const 信息: 锁信息 = {
    pid: process.pid,
    主机: os.hostname(),
    实例: 实例号(),
    开始: new Date(现在()).toISOString(),
    号: crypto.randomBytes(8).toString("hex"),
    ...(opts.附 ? { 附: opts.附 } : {}),
  };
  const tmp = `${p}.${process.pid}.${信息.号}.tmp`;
  try {
    fs.mkdirSync(目录, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(信息));
  } catch (e) {
    return { ok: true, 锁: 降级锁(信息, e) };
  }
  try {
    let 最后看到: 锁信息 | null = null;
    for (let 次 = 0; 次 < 4; 次++) {
      try {
        fs.linkSync(tmp, p);
        return { ok: true, 锁: 占上(p, 信息, 心跳毫秒) };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") return { ok: true, 锁: 降级锁(信息, e) };
      }
      const 有 = 读(p);
      if (!有) continue; // 刚放掉，再 link 一次
      最后看到 = 有.信息;
      if (!是死锁(有, p, 过期毫秒, 现在())) return { ok: false, 占着的: 有.信息 };
      if (!抢(p, 有.信息?.号 ?? null, 过期毫秒, 现在)) {
        const 再 = 读(p);
        if (再 && !是死锁(再, p, 过期毫秒, 现在())) return { ok: false, 占着的: 再.信息 };
      }
    }
    // 几轮都没抢到（别的进程正好也在抢）：当别人占着，下回再来
    return { ok: false, 占着的: 最后看到 };
  } catch (e) {
    return { ok: true, 锁: 降级锁(信息, e) };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* 没了就算了 */
    }
  }
}

function 占上(p: string, 信息: 锁信息, 心跳毫秒: number): 锁 {
  占着.set(p, 信息.号);
  const 还是我的 = () => {
    try {
      return (JSON.parse(fs.readFileSync(p, "utf8")) as 锁信息).号 === 信息.号;
    } catch {
      return false;
    }
  };
  let 心跳: ReturnType<typeof setInterval> | null = null;
  if (心跳毫秒 > 0) {
    心跳 = setInterval(() => {
      if (!还是我的()) {
        // 被当成死锁抢走了（事件循环卡过头）：不再摸别人的锁
        console.error(`[跨进程锁] ${path.basename(p)} 已经不是本进程的了`);
        if (心跳) clearInterval(心跳);
        心跳 = null;
        return;
      }
      try {
        const t = new Date();
        fs.utimesSync(p, t, t);
      } catch {
        /* 下次再摸 */
      }
    }, 心跳毫秒);
    心跳.unref?.();
  }
  let 放过 = false;
  return {
    信息,
    降级: false,
    放: () => {
      if (放过) return;
      放过 = true;
      if (心跳) clearInterval(心跳);
      if (占着.get(p) === 信息.号) 占着.delete(p);
      try {
        if (还是我的()) fs.unlinkSync(p);
      } catch {
        /* 没了就算了 */
      }
    },
  };
}

/** 现在谁占着这把锁（死锁当没人）。界面「正在同步」用 */
export function 看锁(名: string, opts: Pick<锁选项, "过期毫秒" | "目录" | "现在"> = {}): 锁信息 | null {
  try {
    const p = 锁文件(名, opts.目录 ?? 锁目录());
    const 有 = 读(p);
    if (!有) return null;
    return 是死锁(有, p, opts.过期毫秒 ?? 默认过期毫秒, (opts.现在 ?? Date.now)()) ? null : 有.信息;
  } catch {
    return null;
  }
}

// 正常退出（next start 收到 SIGTERM 会走 process.exit）时把本进程占着的锁删掉；崩了的靠 pid 判死锁
const gx = globalThis as unknown as { __crmProcLockExit?: boolean };
if (!gx.__crmProcLockExit) {
  gx.__crmProcLockExit = true;
  process.once("exit", () => {
    for (const [p, 号] of 占着) {
      try {
        if ((JSON.parse(fs.readFileSync(p, "utf8")) as 锁信息).号 === 号) fs.unlinkSync(p);
      } catch {
        /* 尽力 */
      }
    }
  });
}

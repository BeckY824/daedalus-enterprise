/**
 * 多进程（11-16）：跨进程锁（lib/proc-lock.ts）和后台任务开关 / 占位（lib/jobs.ts）。
 *   - CRM_INSTANCE / CRM_JOBS 的读法和默认值（不设 = 实例 1、跑后台任务，单进程照旧）
 *   - 占锁：占到、本进程再占算占着、放了能再占；锁目录跟着库文件走
 *   - 死锁不挡人：过期没心跳、pid 不在了（kill -9）、本进程上一辈子留下的，都能抢；活着的进程占着的抢不了
 *   - 真起另一个 node 进程占锁：本进程占不到、看得到是谁；它崩了马上接手
 *   - 后台任务：CRM_JOBS=0 不跑；另一个进程占着 jobs 不跑、它停了接手
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { 占锁, 看锁, 实例号, 锁目录, type 锁信息 } from "@/lib/proc-lock";
import { 后台任务开关, 起后台任务, 本进程跑后台任务, 重置后台任务状态 } from "@/lib/jobs";
import { 开子进程占锁, type 子进程 } from "./proc-lock-child";

let 目录: string;
const 子们: 子进程[] = [];

beforeEach(() => {
  目录 = fs.mkdtempSync(path.join(os.tmpdir(), "crm-proc-lock-"));
  重置后台任务状态();
});

afterEach(async () => {
  for (const c of 子们.splice(0)) await c.杀().catch(() => null);
  重置后台任务状态();
  fs.rmSync(目录, { recursive: true, force: true });
});

afterAll(() => 重置后台任务状态());

/** 手写一个锁文件（模拟别的进程留下的），mtime 可往前拨 */
function 写锁(名: string, 信息: Partial<锁信息>, 几秒前 = 0) {
  const p = path.join(目录, `${名}.lock`);
  const 全: 锁信息 = { pid: 1, 主机: os.hostname(), 实例: 2, 开始: new Date().toISOString(), 号: "别人的号", ...信息 };
  fs.writeFileSync(p, JSON.stringify(全));
  const t = new Date(Date.now() - 几秒前 * 1000);
  fs.utimesSync(p, t, t);
  return p;
}

/** 起一个马上退出的进程，拿它的 pid（退了 = 这个 pid 不在了） */
async function 死了的pid(): Promise<number> {
  const c = spawn(process.execPath, ["-e", "0"]);
  await new Promise((ok) => c.once("exit", ok));
  return c.pid!;
}

describe("环境变量", () => {
  it("CRM_INSTANCE：不设 / 空 / 写错 = 1；正整数照读", () => {
    expect(实例号({})).toBe(1);
    expect(实例号({ CRM_INSTANCE: "" })).toBe(1);
    expect(实例号({ CRM_INSTANCE: "abc" })).toBe(1);
    expect(实例号({ CRM_INSTANCE: "0" })).toBe(1);
    expect(实例号({ CRM_INSTANCE: "-2" })).toBe(1);
    expect(实例号({ CRM_INSTANCE: "2.5" })).toBe(1);
    expect(实例号({ CRM_INSTANCE: "3" })).toBe(3);
    expect(实例号({ CRM_INSTANCE: " 4 " })).toBe(4);
  });

  it("CRM_JOBS：不设 = 跑（单进程照旧），0 = 不跑，1 = 跑", () => {
    expect(后台任务开关({})).toBe(true);
    expect(后台任务开关({ CRM_JOBS: "" })).toBe(true);
    expect(后台任务开关({ CRM_JOBS: "1" })).toBe(true);
    expect(后台任务开关({ CRM_JOBS: "0" })).toBe(false);
    expect(后台任务开关({ CRM_JOBS: " 0 " })).toBe(false);
  });

  it("锁目录：CRM_LOCK_DIR 优先，其次库文件旁边的 .crm-locks/<库文件名>", () => {
    expect(锁目录({ CRM_LOCK_DIR: "/x/locks", DATABASE_URL: "file:/data/crm.db" })).toBe("/x/locks");
    expect(锁目录({ DATABASE_URL: "file:/data/crm.db?connection_limit=1" })).toBe(path.join("/data", ".crm-locks", "crm.db"));
    // 同目录的两个库各占各的
    expect(锁目录({ DATABASE_URL: "file:/data/e2e.db" })).toBe(path.join("/data", ".crm-locks", "e2e.db"));
    expect(锁目录({})).toBe(path.join(process.cwd(), ".crm-locks"));
  });
});

describe("占锁", () => {
  it("占到 → 本进程再占算占着、看得到是谁 → 放了文件没了、能再占", () => {
    const r = 占锁("t1", { 目录, 心跳毫秒: 0, 附: { 谁: "甲" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.锁.降级).toBe(false);
    const 再 = 占锁("t1", { 目录, 心跳毫秒: 0 });
    expect(再.ok).toBe(false);
    if (!再.ok) expect(再.占着的).toMatchObject({ pid: process.pid, 附: { 谁: "甲" } });
    expect(看锁("t1", { 目录 })).toMatchObject({ 附: { 谁: "甲" } });
    r.锁.放();
    r.锁.放(); // 重复放没事
    expect(fs.existsSync(path.join(目录, "t1.lock"))).toBe(false);
    expect(看锁("t1", { 目录 })).toBeNull();
    const 三 = 占锁("t1", { 目录, 心跳毫秒: 0 });
    expect(三.ok).toBe(true);
    if (三.ok) 三.锁.放();
    // 临时文件不留
    expect(fs.readdirSync(目录)).toEqual([]);
  });

  it("锁名只认字母数字 - _", () => {
    expect(() => 占锁("../x", { 目录 })).toThrow(/锁名不对/);
  });

  it("活着的别的进程占着、心跳没过期：抢不了", () => {
    写锁("t2", { pid: process.ppid });
    const r = 占锁("t2", { 目录, 心跳毫秒: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.占着的).toMatchObject({ pid: process.ppid, 实例: 2 });
    expect(看锁("t2", { 目录 })).not.toBeNull();
  });

  it("过期没心跳（进程在也算）：抢得到，看锁当没人", () => {
    写锁("t3", { pid: process.ppid }, 200);
    expect(看锁("t3", { 目录 })).toBeNull();
    const r = 占锁("t3", { 目录, 心跳毫秒: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(看锁("t3", { 目录 })?.pid).toBe(process.pid);
      r.锁.放();
    }
  });

  it("pid 已经不在了（崩了 / kill -9）：不等过期，马上抢得到", async () => {
    写锁("t4", { pid: await 死了的pid() });
    expect(看锁("t4", { 目录 })).toBeNull();
    const r = 占锁("t4", { 目录, 心跳毫秒: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) r.锁.放();
  });

  it("记的 pid 就是本进程、但本进程没占过（上一辈子留下的，容器里 pid 常是 1）：抢得到", () => {
    写锁("t5", { pid: process.pid, 号: "上辈子" });
    const r = 占锁("t5", { 目录, 心跳毫秒: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) r.锁.放();
  });

  it("别的机器上的进程：不看 pid，只按过期算", () => {
    写锁("t6", { pid: 999_999, 主机: "别的机器" });
    expect(占锁("t6", { 目录, 心跳毫秒: 0 }).ok).toBe(false);
    写锁("t6", { pid: 999_999, 主机: "别的机器" }, 200);
    const r = 占锁("t6", { 目录, 心跳毫秒: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) r.锁.放();
  });

  it("心跳会续 mtime；被当死锁抢走后放锁不删别人的", async () => {
    const r = 占锁("t7", { 目录, 心跳毫秒: 20 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = path.join(目录, "t7.lock");
    const 老 = new Date(Date.now() - 300_000);
    fs.utimesSync(p, 老, 老);
    await vi.waitFor(() => expect(Date.now() - fs.statSync(p).mtimeMs).toBeLessThan(10_000));
    // 别人当它死了抢走（换了号）：本进程放锁时不删
    写锁("t7", { pid: process.ppid, 号: "抢走的" });
    r.锁.放();
    expect(看锁("t7", { 目录 })?.号).toBe("抢走的");
  });

  it("锁目录用不了：降级（当占到了），不挡业务", () => {
    const 文件 = path.join(目录, "不是目录");
    fs.writeFileSync(文件, "");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = 占锁("t8", { 目录: path.join(文件, "sub") });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.锁.降级).toBe(true);
      r.锁.放();
    }
    err.mockRestore();
  });
});

describe("两个真进程", () => {
  it("另一个进程占着：本进程占不到、看得到是它；它正常放了，本进程占得到", async () => {
    const c = await 开子进程占锁(目录, "x1", "子进程");
    子们.push(c);
    expect(c.结果).toBe("OK");
    const r = 占锁("x1", { 目录, 心跳毫秒: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.占着的).toMatchObject({ pid: c.pid, 附: { 谁: "子进程" } });
    expect(看锁("x1", { 目录 })?.pid).toBe(c.pid);
    await c.放();
    expect(看锁("x1", { 目录 })).toBeNull();
    const 再 = 占锁("x1", { 目录, 心跳毫秒: 0 });
    expect(再.ok).toBe(true);
    if (再.ok) 再.锁.放();
  });

  it("本进程占着：另一个进程占不到；另一个进程占着时 kill -9，本进程马上接手", async () => {
    const r = 占锁("x2", { 目录, 心跳毫秒: 0 });
    expect(r.ok).toBe(true);
    const c1 = await 开子进程占锁(目录, "x2", "子1");
    子们.push(c1);
    expect(c1.结果).toBe("HELD");
    if (r.ok) r.锁.放();

    const c2 = await 开子进程占锁(目录, "x2", "子2");
    子们.push(c2);
    expect(c2.结果).toBe("OK");
    expect(占锁("x2", { 目录, 心跳毫秒: 0 }).ok).toBe(false);
    await c2.杀();
    expect(fs.existsSync(path.join(目录, "x2.lock"))).toBe(true); // 崩了的留下了锁文件
    const 接 = 占锁("x2", { 目录, 心跳毫秒: 0 });
    expect(接.ok).toBe(true);
    if (接.ok) 接.锁.放();
  });
});

describe("后台任务占位", () => {
  const 静音 = () => vi.spyOn(console, "log").mockImplementation(() => {});

  it("CRM_JOBS=0：不跑、不占锁", async () => {
    const log = 静音();
    const 跑 = vi.fn();
    expect(await 起后台任务(跑, { env: { CRM_JOBS: "0", CRM_INSTANCE: "2" }, 目录 })).toBe(false);
    expect(跑).not.toHaveBeenCalled();
    expect(fs.readdirSync(目录)).toEqual([]);
    expect(log.mock.calls.flat().join(" ")).toMatch(/实例 2：CRM_JOBS=0/);
    log.mockRestore();
  });

  it("不设 CRM_JOBS（单进程）：占到锁、跑一次，等 跑() 做完才回；再调照旧再跑（和原来重复 register 一样）", async () => {
    const log = 静音();
    let 做完 = false;
    const 跑 = vi.fn(async () => {
      await new Promise((ok) => setTimeout(ok, 20));
      做完 = true;
    });
    expect(await 起后台任务(跑, { env: {}, 目录, 心跳毫秒: 0 })).toBe(true);
    expect(做完).toBe(true);
    expect(本进程跑后台任务({})).toBe(true);
    expect(await 起后台任务(跑, { env: {}, 目录, 心跳毫秒: 0 })).toBe(true);
    expect(跑).toHaveBeenCalledTimes(2);
    expect(看锁("jobs", { 目录 })?.pid).toBe(process.pid);
    log.mockRestore();
  });

  it("跑() 出错只记日志，不往外抛", async () => {
    const log = 静音();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await 起后台任务(() => Promise.reject(new Error("坏了")), { env: {}, 目录, 心跳毫秒: 0 })).toBe(true);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
    log.mockRestore();
  });

  it("两个进程都设了 CRM_JOBS=1：另一个占着 jobs，本进程不跑（附件清孤儿也跳过）；它崩了本进程接手", async () => {
    const log = 静音();
    const c = await 开子进程占锁(目录, "jobs", "1 号进程");
    子们.push(c);
    expect(c.结果).toBe("OK");
    const 跑 = vi.fn();
    expect(await 起后台任务(跑, { env: { CRM_JOBS: "1", CRM_INSTANCE: "2" }, 目录, 重试毫秒: 30, 心跳毫秒: 0 })).toBe(false);
    expect(跑).not.toHaveBeenCalled();
    expect(本进程跑后台任务({ CRM_JOBS: "1" })).toBe(false);
    expect(log.mock.calls.flat().join(" ")).toMatch(new RegExp(`实例 2：CRM_JOBS 开着但实例 1（pid ${c.pid}`));
    const 说了几行 = log.mock.calls.length;
    await new Promise((ok) => setTimeout(ok, 120));
    expect(跑).not.toHaveBeenCalled();
    expect(log.mock.calls.length).toBe(说了几行); // 没占到只说一次，重试不刷日志

    await c.杀();
    await vi.waitFor(() => expect(跑).toHaveBeenCalledTimes(1));
    expect(本进程跑后台任务({ CRM_JOBS: "1" })).toBe(true);
    expect(看锁("jobs", { 目录 })?.pid).toBe(process.pid);
    log.mockRestore();
  });
});

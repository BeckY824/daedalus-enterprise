/**
 * 企业版范围的跨进程纪元（11-16 用满 4 核，src/lib/enterprise/scope-epoch.ts + visibility.ts）：
 * 纪元 = 库文件旁边 `.scope-epoch` 的大小。忘掉企业版范围() 追加一个字节；
 * 别的进程（这里真起一个 node 子进程去追加）加过之后，本进程的范围缓存整个作废、现算，不给旧的。
 * 范围用假 db 算（认不出人 → 只看公海），只数算了几次。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { PrismaClient } from "@/generated/prisma";
import { 纪元文件, 读纪元, 加纪元 } from "@/lib/enterprise/scope-epoch";
import { 企业版范围, 忘掉企业版范围, 以谁的身份 } from "@/lib/enterprise/visibility";

let dir = "";
let 文件 = "";
const 原连接串 = process.env.DATABASE_URL;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-scope-epoch-"));
  文件 = path.join(dir, ".scope-epoch");
  process.env.DATABASE_URL = `file:${path.join(dir, "crm.db")}?connection_limit=1`;
});
afterAll(() => {
  process.env.DATABASE_URL = 原连接串;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** 另一个进程加一次纪元：真起一个 node 进程，和本进程不共享任何内存 */
function 别的进程加纪元() {
  const r = spawnSync(process.execPath, ["-e", `require("node:fs").appendFileSync(${JSON.stringify(文件)}, ".")`]);
  expect(r.status).toBe(0);
}

/** 假 db：算范围用到的几句都回空；用户那句可以卡住，看调用方是不是在等现算 */
function 假库() {
  const 计 = { 算了: 0, 卡住: null as null | Promise<void> };
  const db = {
    user: { findMany: async () => { 计.算了++; if (计.卡住) await 计.卡住; return []; } },
    entMember: { findMany: async () => [] },
    entDept: { findMany: async () => [] },
    setting: { findUnique: async () => null },
  } as unknown as PrismaClient;
  return { db, 计 };
}

const 未决 = Symbol("未决");
async function 到没到<T>(p: Promise<T>): Promise<T | typeof 未决> {
  return Promise.race([p, new Promise<typeof 未决>((r) => setTimeout(() => r(未决), 30))]);
}

describe("纪元文件", () => {
  it("放在库文件旁边；认不出目录（相对路径、不是 file:）回 null，纪元恒为 -1，加了也不写", () => {
    expect(纪元文件("file:/srv/crm/data/crm.db?connection_limit=1")).toBe(path.join("/srv/crm/data", ".scope-epoch"));
    expect(纪元文件("file:./dev.db")).toBeNull();
    expect(纪元文件("postgresql://x")).toBeNull();
    expect(读纪元(null)).toBe(-1);
    expect(() => 加纪元(null)).not.toThrow();
  });

  it("没有文件 = 0；每加一次大 1；只增不减", () => {
    const f = path.join(dir, "单独.epoch");
    expect(读纪元(f)).toBe(0);
    加纪元(f);
    加纪元(f);
    expect(读纪元(f)).toBe(2);
  });
});

describe("范围缓存认纪元", () => {
  beforeEach(() => 忘掉企业版范围());

  it("忘掉企业版范围() 会加纪元（别的进程看得到）", () => {
    const 前 = 读纪元();
    忘掉企业版范围();
    expect(读纪元()).toBe(前 + 1);
    expect(fs.existsSync(文件)).toBe(true);
  });

  it("别的进程加了纪元：本进程的缓存整个作废，下一次现算、等算完才给（不给旧的）", async () => {
    const { db, 计 } = 假库();
    const 取 = () => 以谁的身份("u1", () => 企业版范围(db));
    await 取();
    await 取();
    expect(计.算了).toBe(1); // 10 秒内走缓存

    别的进程加纪元();
    let 放 = () => {};
    计.卡住 = new Promise<void>((r) => (放 = r));
    const p = 取();
    expect(await 到没到(p)).toBe(未决); // 在等现算，没给旧的
    放();
    await p;
    expect(计.算了).toBe(2);
    计.卡住 = null;
    await 取();
    expect(计.算了).toBe(2); // 新纪元下又走缓存
  });

  it("纪元没变：缓存过期照旧先给旧的、后台再算", async () => {
    const { db, 计 } = 假库();
    const 取 = () => 以谁的身份("u2", () => 企业版范围(db));
    await 取();
    const 真 = Date.now;
    Date.now = () => 真() + 11_000;
    try {
      let 放 = () => {};
      计.卡住 = new Promise<void>((r) => (放 = r));
      expect(await 到没到(取())).not.toBe(未决); // 旧的马上给
      放();
    } finally {
      Date.now = 真;
    }
    expect(计.算了).toBe(2);
  });

  it("算到一半纪元变了：算出来的不进缓存，下一次重算", async () => {
    const { db, 计 } = 假库();
    const 取 = () => 以谁的身份("u3", () => 企业版范围(db));
    let 放 = () => {};
    计.卡住 = new Promise<void>((r) => (放 = r));
    const p = 取();
    await new Promise((r) => setTimeout(r, 5));
    别的进程加纪元();
    计.卡住 = null;
    await 取(); // 发现纪元变了：清掉、现算
    放();
    await p;
    const 前 = 计.算了;
    await 取();
    expect(计.算了).toBe(前); // 缓存里是新纪元下算的那份，不是被丢掉的旧那份
  });
});

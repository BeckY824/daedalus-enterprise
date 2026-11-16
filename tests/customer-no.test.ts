/**
 * 客户编号（11-17 客户抬头 PR-1，lib/customer-no.ts + 迁移 146 / 147 + scripts/customer-no-backfill.mjs）。
 * 钉的是：写法（NO. + 5 位）；新建客户经计数表取号、多进程同时取不撞；彻底删了最新那位、下一位不复用；
 * 计数表还没建（存量库没回填）新建照样成、编号先空、页面显示短号；撤销导入再恢复带回原号；
 * src 里每一处 customer.create 都过 带客户编号；回填脚本按建档时间从 1 起、分段、幂等、补完计数接得上。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "甲", email: "a@x", role: "ADMIN", title: "管理员", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { saveCustomer } from "@/app/(app)/customers/actions";
import { 客户编号文字, 客户编号显示, 看成客户编号, 取客户编号, 带客户编号, 取号SQL } from "@/lib/customer-no";
import { 试跑 } from "@/lib/enterprise-import/report";
import { 写一批 } from "@/lib/enterprise-import/apply";
import { 撤回一批, 恢复一批 } from "@/lib/enterprise-import/revert";
import type { 读出的表 } from "@/lib/enterprise-import/excel";
import { 回填客户编号, 编号计划 } from "../scripts/customer-no-backfill.mjs";

const 库文件 = process.env.DATABASE_URL!.replace(/^file:/, "");
let 甲 = "";
let 序 = 0;

const 新建 = (name: string) => {
  序++;
  return saveCustomer({
    name, phone: `1390000${String(序).padStart(4, "0")}`, school: null, grade: null, major: null,
    followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null,
    remark: null, salesOwnerId: 甲, channelId: null, referrerCustomerId: null,
  });
};
const 号of = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id }, select: { customerNo: true } })).customerNo;
const 计数 = async () => (await prisma.customerNoSeq.findUnique({ where: { id: 1 } }))?.n ?? null;
/** 不经 带客户编号 直接插一位（模拟上线前的存量客户：编号空着） */
const 存量 = (id: string, createdAt: Date, extra: { deletedAt?: Date } = {}) =>
  prisma.customer.create({ data: { id, name: `存量${id}`, phone: "", salesOwnerId: 甲, createdAt, ...extra } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  甲 = (await prisma.user.create({ data: { email: "jia@x", name: "甲", title: "管理员", role: "ADMIN", password: "x" } })).id;
  mocks.user = { ...mocks.user, id: 甲 };
});
afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe("写法", () => {
  it("NO. + 5 位，不足补 0；过了 99999 照写全；空的给 null、页面显示短号", () => {
    expect(客户编号文字(1)).toBe("NO.00001");
    expect(客户编号文字(1237)).toBe("NO.01237");
    expect(客户编号文字(123456)).toBe("NO.123456");
    for (const n of [null, undefined, 0, -1, 1.5]) expect(客户编号文字(n)).toBeNull();
    expect(客户编号显示({ id: "cmabcdef123456", customerNo: 12 })).toBe("NO.00012");
    expect(客户编号显示({ id: "cmabcdef123456", customerNo: null })).toBe("#123456");
    expect(客户编号显示({ id: "", customerNo: null })).toBe("—");
    // 写出来的再认回去
    expect(看成客户编号(客户编号文字(42)!)).toBe(42);
  });
});

describe("取号", () => {
  it("全新的库：第一位客户自己建计数行、从 1 起；之后一位一个号", async () => {
    expect(await 计数()).toBeNull();
    const a = await 新建("第一位");
    const b = await 新建("第二位");
    if (!a.ok || !b.ok) throw new Error(JSON.stringify([a, b]));
    expect([await 号of(a.id), await 号of(b.id)]).toEqual([1, 2]);
    expect(await 计数()).toBe(2);
  });

  it("同时建 12 位：号全不一样、连着", async () => {
    const r = await Promise.all(Array.from({ length: 12 }, (_, i) => 新建(`同时${i}`)));
    const 号们 = await Promise.all(r.map((x) => { if (!x.ok) throw new Error(JSON.stringify(x)); return 号of(x.id); }));
    expect([...号们].sort((a, b) => a! - b!)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("多进程同时取号（4 个进程 × 25 次，各开各的连接）：100 个号不重不漏", async () => {
    expect(await 取客户编号(prisma)).toBe(1); // 建计数行
    const 一个进程 = () => new Promise<number[]>((resolve, reject) => {
      const code = `const { DatabaseSync } = require("node:sqlite");
        const db = new DatabaseSync(process.env.DB); db.exec("PRAGMA busy_timeout = 15000");
        const out = []; for (let i = 0; i < 25; i++) out.push(Number(db.prepare(process.env.SQL).get().n));
        db.close(); process.stdout.write(JSON.stringify(out));`;
      const p = spawn(process.execPath, ["--no-warnings", "-e", code], { env: { ...process.env, DB: 库文件, SQL: 取号SQL } });
      let out = "", err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("close", (c) => (c === 0 ? resolve(JSON.parse(out)) : reject(new Error(err))));
    });
    const 全 = (await Promise.all([一个进程(), 一个进程(), 一个进程(), 一个进程()])).flat();
    expect(new Set(全).size).toBe(100);
    expect([...全].sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, i) => i + 2));
    expect(await 计数()).toBe(101);
  });

  it("最新那位彻底删了（回收站过期）：下一位不复用它的号", async () => {
    const a = await 新建("会被删"), b = await 新建("最新");
    if (!a.ok || !b.ok) throw new Error();
    expect(await 号of(b.id)).toBe(2);
    await prisma.$executeRawUnsafe(`DELETE FROM "Customer" WHERE "id" = ?`, b.id);
    const c = await 新建("删了之后");
    if (!c.ok) throw new Error(JSON.stringify(c));
    expect(await 号of(c.id)).toBe(3);
  });

  it("编辑客户不动编号", async () => {
    const a = await 新建("改名前");
    if (!a.ok) throw new Error();
    const r = await prisma.customer.findUniqueOrThrow({ where: { id: a.id } });
    const base = { name: r.name, phone: r.phone, school: r.school, grade: r.grade, major: r.major, followStatus: r.followStatus, decisionStatus: r.decisionStatus, expectedSignAt: null, remark: r.remark, salesOwnerId: r.salesOwnerId, channelId: r.channelId, referrerCustomerId: r.referrerCustomerId };
    const s = await saveCustomer({ id: a.id, updatedAt: r.updatedAt.toISOString(), base, ...base, name: "改名后" } as Parameters<typeof saveCustomer>[0]);
    expect(s.ok).toBe(true);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: a.id }, select: { name: true, customerNo: true } })).toEqual({ name: "改名后", customerNo: 1 });
  });

  it("存量库还没回填（有客户、没计数行）：新建照样成，编号先空着、显示短号；不自己建计数行", async () => {
    await 存量("old-1", new Date("2024-01-01"));
    const a = await 新建("回填前新建");
    if (!a.ok) throw new Error(JSON.stringify(a));
    expect(await 号of(a.id)).toBeNull();
    expect(await 计数()).toBeNull();
    expect(客户编号显示({ id: a.id, customerNo: null })).toMatch(/^#[0-9A-Z]{6}$/);
    // 带客户编号：拿不到号就不带这一格（不写 customerNo: null 进 data）
    expect(await 带客户编号(prisma, { name: "x" })).toEqual({ name: "x" });
  });
});

describe("撤销导入再恢复：带回原号", () => {
  const 表 = (行: string[][]): 读出的表 => ({
    名: "客户.xlsx", 实体: "customer", 表头: ["记录ID", "客户名称", "手机号码", "客户负责人", "客户等级", "备注"],
    行, 行号: 行.map((_, i) => i + 2), 提醒: [],
  });
  const 我 = { id: "", name: "甲" };
  const 导 = async (行: string[][]) => {
    const { 批次Id } = await 试跑({ 来源: "excel", 用户Id: 我.id, 表: [表(行)], 建议器: null });
    expect((await 写一批(批次Id, 我)).完了).toBe(true);
    return 批次Id;
  };

  it("导入的客户有号；撤回后别人新建拿新号；恢复照原号建回；再导入接着往后", async () => {
    我.id = 甲;
    const 批 = await 导([
      ["C1", "杭州云帆科技有限公司", "13800000001", "甲", "A", ""],
      ["C2", "宁波海川贸易", "13800000002", "甲", "B", ""],
    ]);
    const 号表 = async () => Object.fromEntries((await prisma.customer.findMany({ select: { name: true, customerNo: true } })).map((c) => [c.name, c.customerNo]));
    expect(await 号表()).toEqual({ 杭州云帆科技有限公司: 1, 宁波海川贸易: 2 });
    expect((await 撤回一批(批, 我)).完了).toBe(true);
    expect(await prisma.customer.count()).toBe(0);
    const a = await 新建("撤回后新建");
    if (!a.ok) throw new Error(JSON.stringify(a));
    expect(await 号of(a.id)).toBe(3);
    expect((await 恢复一批(批, 我)).完了).toBe(true);
    expect(await 号表()).toEqual({ 杭州云帆科技有限公司: 1, 宁波海川贸易: 2, 撤回后新建: 3 });
    await 导([["C9", "温州新客户", "13800000009", "甲", "C", ""]]);
    expect((await 号表()).温州新客户).toBe(4);
  });
});

describe("建客户的入口都过 带客户编号（按源码钉）", () => {
  const 源码 = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "generated" ? [] : 源码(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
  const 全部 = 源码(path.resolve(__dirname, "../src")).map((f) => ({ f: path.relative(path.resolve(__dirname, ".."), f), s: fs.readFileSync(f, "utf8") }));

  it("每一处 customer.create 的 data 都是 await 带客户编号(…)；7 处，多了少了都要来这里看一眼", () => {
    const 处 = 全部.flatMap(({ f, s }) => [...s.matchAll(/\.customer\.create\(/g)].map((m) => ({ f, 后: s.slice(m.index, m.index + 120) })));
    for (const x of 处) expect({ f: x.f, 过: /^\.customer\.create\(\s*\{\s*data:\s*await 带客户编号\(/.test(x.后) }).toEqual({ f: x.f, 过: true });
    expect(处.map((x) => x.f).sort()).toEqual([
      "src/app/(app)/customers/actions.ts",
      "src/app/(app)/customers/import-actions.ts",
      "src/app/(app)/leads/actions.ts",
      "src/lib/enterprise-import/apply.ts",
      "src/lib/enterprise-import/revert.ts",
      "src/lib/enterprise/lead-to-project.ts",
      "src/lib/shared-ws/dataset.ts",
    ]);
  });

  it("没有绕开取号的批量建、upsert、裸 SQL 插客户", () => {
    for (const { f, s } of 全部) {
      expect({ f, 批量: /\.customer\.(createMany|createManyAndReturn|upsert)\(/.test(s) }).toEqual({ f, 批量: false });
      expect({ f, 裸插: /INSERT\s+(OR\s+\w+\s+)?INTO\s+"?Customer"?\s*\(/i.test(s) }).toEqual({ f, 裸插: false });
    }
  });
});

describe("回填脚本（scripts/customer-no-backfill.mjs）", () => {
  /*
    脚本跑在另一个进程里：同一个进程里 Prisma 和 node:sqlite 是两份 SQLite，POSIX 文件锁按进程算、互相看不见，
    node:sqlite 关库时以为只剩自己、把 WAL 收掉，Prisma 之后写的就丢进没人看得见的 WAL（试过：下一条用例读到的是旧数据）。
    线上也是这样：脚本单独起一个 node 进程跑，不进服务端进程。
  */
  const 脚本 = path.resolve(__dirname, "../scripts/customer-no-backfill.mjs");
  const 子进程 = (args: string[], env: Record<string, string> = {}) => new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
    const p = spawn(process.execPath, ["--no-warnings", ...args], { env: { ...process.env, ...env } });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
  });
  /** 在子进程里调 回填客户编号(db, 选项)，回结果 */
  const 回填 = async (选项: { 写: boolean; 每段?: number }) => {
    const code = `import { 回填客户编号 } from ${JSON.stringify(pathToFileURL(脚本).href)};
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(process.env.DB);
      try { process.stdout.write(JSON.stringify(回填客户编号(db, JSON.parse(process.env.OPT)))); } finally { db.close(); }`;
    const r = await 子进程(["--input-type=module", "-e", code], { DB: 库文件, OPT: JSON.stringify(选项) });
    if (r.code !== 0) throw new Error(r.err);
    return JSON.parse(r.out);
  };

  it("编号计划：从起号往后一位一个", () => {
    expect(编号计划([{ id: "a" }, { id: "b" }], 7)).toEqual([{ id: "a", no: 7 }, { id: "b", no: 8 }]);
    expect(编号计划([], 1)).toEqual([]);
  });

  it("按建档时间从 1 起（回收站里的也补）；分段写；演练不动库；重跑没有要补的；补完新建接着计数取号", async () => {
    // 建档时间和 id 顺序故意错开
    await 存量("z-old", new Date("2023-01-01"));
    await 存量("a-new", new Date("2025-06-01"));
    await 存量("m-mid", new Date("2024-03-01"), { deletedAt: new Date("2025-07-01") });
    await 存量("b-same", new Date("2024-03-01"));
    await 存量("c-new2", new Date("2025-06-02"));

    const 演练 = await 回填({ 写: false });
    expect({ 将补: 演练.将补, 首: 演练.首, 尾: 演练.尾, 前: 演练.前 }).toEqual({
      将补: 5, 首: { id: "z-old", no: 1 }, 尾: { id: "c-new2", no: 5 },
      前: { 最大号: 0, 有号: 0, 待补: 5, 待补里在回收站: 1, 计数: null },
    });
    expect(await prisma.customer.count({ where: { customerNo: { not: null } } })).toBe(0);
    expect(await 计数()).toBeNull();

    const 真写 = await 回填({ 写: true, 每段: 2 });
    expect(真写.补了).toBe(5);
    expect(真写.后).toEqual({ 最大号: 5, 有号: 5, 待补: 0, 待补里在回收站: 0, 计数: 5 });
    const 顺序 = (await prisma.$queryRawUnsafe<{ id: string; customerNo: number | bigint }[]>(`SELECT "id", "customerNo" FROM "Customer" ORDER BY "customerNo"`)).map((r) => [r.id, Number(r.customerNo)]);
    // 同一建档时间按 id：b-same 在 m-mid 前
    expect(顺序).toEqual([["z-old", 1], ["b-same", 2], ["m-mid", 3], ["a-new", 4], ["c-new2", 5]]);

    const 再跑 = await 回填({ 写: true, 每段: 2 });
    expect({ 补了: 再跑.补了, 后: 再跑.后 }).toEqual({ 补了: 0, 后: 真写.后 });

    const a = await 新建("回填后新建");
    if (!a.ok) throw new Error(JSON.stringify(a));
    expect(await 号of(a.id)).toBe(6);
  });

  it("计数比最大号高（发过号的被彻底删了）：从计数往后补，号不复用；回填前建的客户（编号空）也一并补上", async () => {
    await 存量("old-1", new Date("2023-01-01"));
    await 回填({ 写: true });
    const b = await 新建("拿 2 号的");
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(await 号of(b.id)).toBe(2);
    await prisma.$executeRawUnsafe(`DELETE FROM "Customer" WHERE "id" = ?`, b.id);
    await 存量("后来插的", new Date("2026-01-01"));
    const r = await 回填({ 写: true });
    expect({ 补了: r.补了, 首: r.首, 计数: r.后.计数 }).toEqual({ 补了: 1, 首: { id: "后来插的", no: 3 }, 计数: 3 });
  });

  it("命令行：演练只打印不动库；--apply 先在库旁边整库备份一份再写", async () => {
    await 存量("cli-1", new Date("2024-01-01"));
    await 存量("cli-2", new Date("2024-02-01"));
    const 目录 = path.dirname(库文件);
    const 备份们 = () => fs.readdirSync(目录).filter((f) => f.startsWith(`${path.basename(库文件, ".db")}.before-customer-no-`));
    const 原有备份 = new Set(备份们());
    try {
      const 演练 = await 子进程([脚本, 库文件]);
      expect(演练.code).toBe(0);
      expect(演练.out).toContain("演练（库没动");
      expect(演练.out).toContain("NO.00001");
      expect(await prisma.customer.count({ where: { customerNo: { not: null } } })).toBe(0);
      const 真写 = await 子进程([脚本, 库文件, "--apply"]);
      expect({ code: 真写.code, err: 真写.err }).toEqual({ code: 0, err: "" });
      expect(真写.out).toContain("已补 2 位：NO.00001 到 NO.00002");
      expect(备份们().filter((f) => !原有备份.has(f))).toHaveLength(1);
      const 再跑 = await 子进程([脚本, 库文件, "--apply", "--no-backup"]);
      expect(再跑.out).toContain("没有要补的");
      expect(备份们().filter((f) => !原有备份.has(f))).toHaveLength(1);
      const 没库 = await 子进程([脚本, path.join(目录, "没有这个库.db")]);
      expect(没库.code).toBe(2);
    } finally {
      for (const f of 备份们()) if (!原有备份.has(f)) fs.rmSync(path.join(目录, f), { force: true });
    }
  });

  it("库里还没有编号列 / 计数表（没上迁移 146、147）：报错退出，库不动", () => {
    // 单独一个临时库文件、Prisma 不碰它：同进程里开 node:sqlite 没关系
    const 临时 = path.join(path.dirname(库文件), `no-col-${process.pid}.db`);
    const db = new DatabaseSync(临时);
    try {
      db.exec(`CREATE TABLE "Customer" ("id" TEXT PRIMARY KEY, "createdAt" INTEGER)`);
      expect(() => 回填客户编号(db, { 写: true })).toThrow(/迁移 146、147/);
    } finally {
      db.close();
      fs.rmSync(临时, { force: true });
    }
  });
});

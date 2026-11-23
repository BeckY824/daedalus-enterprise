/**
 * 录音点评 PR6（11-22）：清理一轮（lib/enterprise/coach-rec-housekeep.ts）+ 停用、进公海、进回收站、删主题连带 + 容量闸。
 * 钉的是：
 *   - 开关关着什么都不动
 *   - 没发出的草稿：满 6 天提醒一次（remindedAt 记上、不顶 updatedAt、再跑不重发），满 7 天自动删（放弃、删文件、记 audioPurgedAt、通知录的人、留痕记「系统」）
 *     上传中按最后一次动（updatedAt）算，别的按进这个状态的时刻（endedAt）算
 *   - 没发出的：项目在公海里 / 进了回收站 / 不在了 → 自动删 + 通知；录的人停用 → 自动删、不通知；已发出的不动
 *   - 进公海（进公海关主题）、进回收站（放弃没发出的录音）事务里当场放弃；停用成员（停用成员录音）当场删文件；删主题连带删录音文件
 *   - 音频 180 天到期删文件、转写和要点留着
 *   - 兜底：转写成了的只留规整件；拼好的录音剩下的片目录删；没主的目录满 1 天删、刚建的不删、_asrtest 不动
 *   - 这个月转写超过 200 小时：系统管理员铃铛提醒一次
 *   - 容量闸：磁盘剩 <3GB 开始录音、接着录 409「请联系系统管理员」；剩 <1GB 片也不收；设置概况带存储
 *   - 「整理好了」通知写「7 天后自动删除」；草稿给界面带到期于
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-ent-coach-rec-hk-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir };
});
const 登录 = vi.hoisted(() => ({ user: null as Record<string, unknown> | null }));
const 盘 = vi.hoisted(() => ({ 剩: null as number | null, 用: null as number | null }));
const 假头 = vi.hoisted(() => () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("next/headers", 假头);
vi.mock("next/headers.js", 假头);
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => 登录.user, getCurrentUser: async () => 登录.user }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
  return { prisma: 加上限定(raw), defaultClient: raw };
});
vi.mock("@/lib/enterprise/feishu-push", () => ({ 推通知们: async () => {} }));
vi.mock("@/lib/enterprise/coach-rec-store", async (原) => {
  const 真 = await 原<typeof import("@/lib/enterprise/coach-rec-store")>();
  return { ...真, 磁盘剩字节: async () => 盘.剩, 目录字节: async (d: string) => 盘.用 ?? 真.目录字节(d) };
});

import { defaultClient as raw } from "@/lib/prisma";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { invalidateSettingsCache } from "@/lib/settings";
import { 录音点评开关键, 停用成员录音, 删主题的录音文件, 忘掉存储情况, 我的录音草稿, 没发出的录音数 } from "@/lib/enterprise/coach-rec-db";
import { 清理一轮 } from "@/lib/enterprise/coach-rec-housekeep";
import { 录音根, 录音目录 } from "@/lib/enterprise/coach-rec-store";
import { 放弃没发出的录音, 进公海关主题 } from "@/lib/project/pool-owner";
import { 录音整理好了通知 } from "@/lib/enterprise/notice-sources";
import { 读转写设置 } from "@/lib/enterprise/coach-rec-asr-settings";
import { POST as 开始 } from "@/app/api/coach-rec/start/route";
import { PUT as 传片 } from "@/app/api/coach-rec/[id]/chunk/[seg]/[seq]/route";
import { POST as 接着录 } from "@/app/api/coach-rec/[id]/resume/route";

const 人 = { 老板: "hk_boss", 甲: "hk_a", 教练: "hk_coach" } as const;
const 天 = 24 * 60 * 60 * 1000;
let 项目: string;
let 客户: string;

/**
 * 清库：CI 分片里 prisma/test.db 可能已经被同片别的用例写过（渠道、商机、合同……挂着人和客户），本机单跑是干净的（#426 CI 外键错）。
 * 引用了 User / Customer 的表（按库里的外键现查，不靠手写名单）先清掉；清的时候关外键检查（单连接，PRAGMA 在这条连接上生效），清完再开
 */
async function 清库() {
  await raw.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  try {
    const 表们 = (await raw.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' AND sql NOT LIKE 'CREATE VIRTUAL%'`)).map((x) => x.name);
    const 挂着的 = new Set<string>();
    for (const t of 表们) {
      const 键们 = await raw.$queryRawUnsafe<{ table: string }[]>(`SELECT "table" FROM pragma_foreign_key_list('${t.replace(/'/g, "''")}')`);
      if (键们.some((k) => k.table === "User" || k.table === "Customer")) 挂着的.add(t);
    }
    for (const t of ["EntCoachRecording", "EntCoachReply", "EntCoachTopic", "EntNotice", "AuditLog", "ProjectMember", "Project", "Setting", "EntMember", "EntDept", "FollowUpProject", ...挂着的, "Customer", "User"]) {
      if (表们.includes(t)) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
    }
  } finally {
    await raw.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  }
}

async function 建() {
  await 清库();
  for (const [名, id] of Object.entries(人)) await raw.user.create({ data: { id, email: `${id}@x.com`, name: 名, password: "x", role: 名 === "教练" ? "ADMIN" : "SALES", active: true } });
  await raw.entMember.createMany({ data: [{ userId: 人.老板, bizRole: "director" }, { userId: 人.甲, bizRole: "sales" }, { userId: 人.教练, bizRole: "coach" }] });
  客户 = (await raw.customer.create({ data: { name: "甲的客户", phone: "13800001111", salesOwnerId: 人.甲 } })).id;
  项目 = (await raw.project.create({ data: { name: "甲的项目", customerId: 客户, ownerId: 人.甲, creatorId: 人.甲, phase: "线索", node: "线索验证" } })).id;
  await raw.setting.create({ data: { key: 规则.按组织看客户.key, value: "true" } });
  fs.rmSync(录音根(), { recursive: true, force: true });
  盘.剩 = null;
  盘.用 = null;
  忘掉存储情况();
  invalidateSettingsCache();
  忘掉企业版范围();
}
async function 开关(开: boolean) {
  await raw.setting.upsert({ where: { key: 录音点评开关键 }, update: { value: JSON.stringify(开) }, create: { key: 录音点评开关键, value: JSON.stringify(开) } });
  invalidateSettingsCache();
}
const 当 = (id: string) => { 登录.user = { id, name: id, email: `${id}@x.com`, role: id === 人.教练 ? "ADMIN" : "SALES", title: "", avatar: null }; 忘掉企业版范围(); };

/** 直接建一条录音行 + 目录里放文件（文件名 → 内容） */
async function 一条(x: { status: string; projectId?: string; authorId?: string; endedAt?: Date | null; updatedAt?: Date; createdAt?: Date; transcript?: string | null; audioPath?: string | null; topicId?: string | null; 文件?: Record<string, string> }) {
  const r = await raw.entCoachRecording.create({
    data: {
      projectId: x.projectId ?? 项目, authorId: x.authorId ?? 人.教练, status: x.status, sourceKind: "网页录", format: "m4a", segCount: 1,
      endedAt: x.endedAt ?? null, transcript: x.transcript ?? null, topicId: x.topicId ?? null, ...(x.createdAt ? { createdAt: x.createdAt, startedAt: x.createdAt } : {}),
    },
  });
  const dir = 录音目录(r);
  fs.mkdirSync(dir, { recursive: true });
  for (const [名, 内容] of Object.entries(x.文件 ?? { "seg-01.m4a": "原始" })) {
    if (名.endsWith("/")) fs.mkdirSync(path.join(dir, 名), { recursive: true });
    else fs.writeFileSync(path.join(dir, 名), 内容);
  }
  const audioPath = x.audioPath === undefined ? path.relative(录音根(), path.join(dir, "seg-01.m4a")) : x.audioPath && path.relative(录音根(), path.join(dir, x.audioPath));
  // updatedAt 是 @updatedAt：改它要走裸 SQL
  await raw.entCoachRecording.update({ where: { id: r.id }, data: { audioPath } });
  if (x.updatedAt) await raw.$executeRawUnsafe(`UPDATE "EntCoachRecording" SET "updatedAt" = ? WHERE "id" = ?`, x.updatedAt.getTime(), r.id);
  return { id: r.id, dir };
}
const 行 = (id: string) => raw.entCoachRecording.findUniqueOrThrow({ where: { id } });
const 通知们 = (userId?: string) => raw.entNotice.findMany({ where: userId ? { userId } : {}, orderBy: { createdAt: "asc" } });

beforeAll(() => {
  process.env.CRM_ENTERPRISE = "1";
  process.env.CRM_DATA_DIR = 临时.dir;
  delete process.env.DESKTOP_LOCAL;
});
beforeEach(async () => { await 建(); });
afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  delete process.env.CRM_DATA_DIR;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

describe("清理一轮", () => {
  it("开关关着：什么都不动", async () => {
    const 现在 = Date.now();
    const { id, dir } = await 一条({ status: "待确认", endedAt: new Date(现在 - 10 * 天) });
    expect(await 清理一轮({ 现在 })).toMatchObject({ 到期: 0, 提醒: 0 });
    expect((await 行(id)).status).toBe("待确认");
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("草稿：满 6 天提醒一次（不顶 updatedAt、不重发），满 7 天自动删、删文件、通知、留痕记「系统」；上传中按最后一次动算", async () => {
    await 开关(true);
    const 现在 = Date.now();
    const 提 = await 一条({ status: "待确认", endedAt: new Date(现在 - 6 * 天 - 60_000) });
    const 删 = await 一条({ status: "待提交", endedAt: new Date(现在 - 7 * 天 - 60_000) });
    const 新 = await 一条({ status: "整理失败", endedAt: new Date(现在 - 2 * 天) });
    const 传 = await 一条({ status: "上传中", updatedAt: new Date(现在 - 8 * 天), 文件: { "seg-01/": "", "seg-01/0000.part": "片" } });
    const 前 = (await 行(提.id)).updatedAt.getTime();
    const 果 = await 清理一轮({ 现在 });
    expect(果).toMatchObject({ 提醒: 1, 到期: 2, 删文件: 2 });
    const 提行 = await 行(提.id);
    expect(提行.status).toBe("待确认");
    expect(提行.remindedAt?.getTime()).toBe(现在);
    expect(提行.updatedAt.getTime()).toBe(前);
    for (const x of [删, 传]) {
      const r = await 行(x.id);
      expect(r).toMatchObject({ status: "已放弃" });
      expect(r.deletedAt).not.toBeNull();
      expect(r.audioPurgedAt).not.toBeNull();
      expect(fs.existsSync(x.dir)).toBe(false);
    }
    expect((await 行(新.id)).status).toBe("整理失败");
    const 们 = await 通知们(人.教练);
    expect(们.map((n) => n.title)).toEqual([
      "你在项目「甲的项目」的录音点评草稿明天到期",
      "你在项目「甲的项目」的录音点评已自动删除",
      "你在项目「甲的项目」的录音点评已自动删除",
    ]);
    expect(们[0].body).toContain("放满 7 天自动删除");
    expect(们[0].link).toBe(`/projects/${项目}?crec=${提.id}`);
    expect(们[1].body).toContain("没发出的草稿放满 7 天，已自动删除");
    const 痕 = await raw.auditLog.findMany({ where: { entity: "EntCoachRecording", action: "delete" } });
    expect(痕.map((a) => a.userName)).toEqual(["系统", "系统"]);
    // 再跑一轮：不重复提醒、不重复通知
    expect(await 清理一轮({ 现在: 现在 + 60_000 })).toMatchObject({ 提醒: 0, 到期: 0, 删文件: 0 });
    expect(await 通知们(人.教练)).toHaveLength(3);
  });

  it("没发出的：项目在公海 / 进了回收站 → 自动删 + 通知；录的人停用 → 删、不通知；已发出不动", async () => {
    await 开关(true);
    const 公海项目 = (await raw.project.create({ data: { name: "公海项目", customerId: 客户, ownerId: 人.甲, creatorId: 人.甲, phase: "线索", node: "线索验证", pooledAt: new Date() } })).id;
    const 回收项目 = (await raw.project.create({ data: { name: "回收项目", customerId: 客户, ownerId: 人.甲, creatorId: 人.甲, phase: "线索", node: "线索验证", deletedAt: new Date() } })).id;
    const a = await 一条({ status: "转写中", projectId: 公海项目 });
    const b = await 一条({ status: "待确认", projectId: 回收项目, endedAt: new Date() });
    const c = await 一条({ status: "已发出", projectId: 公海项目, transcript: "x" });
    const d = await 一条({ status: "待提交", authorId: 人.甲, endedAt: new Date() });
    await raw.user.update({ where: { id: 人.甲 }, data: { active: false } });
    expect(await 清理一轮()).toMatchObject({ 项目没了: 2, 停用: 1, 删文件: 3 });
    for (const x of [a, b, d]) expect((await 行(x.id)).status).toBe("已放弃");
    expect((await 行(c.id)).status).toBe("已发出");
    expect(fs.existsSync(c.dir)).toBe(true);
    const 们 = await 通知们();
    expect(们.map((n) => [n.userId, n.title])).toEqual([
      [人.教练, "你在项目「公海项目」的录音点评已自动删除"],
      [人.教练, "你在项目「回收项目」的录音点评已自动删除"],
    ]);
    expect(们[0].body).toContain("项目进了公海或被删除");
  });

  it("音频 180 天到期：删文件、记 audioPurgedAt，转写和要点留着", async () => {
    await 开关(true);
    const 现在 = Date.now();
    const 老 = await 一条({ status: "已发出", transcript: "转写", createdAt: new Date(现在 - 181 * 天), audioPath: "asr.m4a", 文件: { "asr.m4a": "规整" } });
    const 新 = await 一条({ status: "已发出", transcript: "转写", createdAt: new Date(现在 - 100 * 天), audioPath: "asr.m4a", 文件: { "asr.m4a": "规整" } });
    expect(await 清理一轮({ 现在 })).toMatchObject({ 音频到期: 1 });
    const r = await 行(老.id);
    expect(r.audioPurgedAt).not.toBeNull();
    expect(r.transcript).toBe("转写");
    expect(r.status).toBe("已发出");
    expect(fs.existsSync(老.dir)).toBe(false);
    expect(fs.existsSync(新.dir)).toBe(true);
  });

  it("兜底：转写成了的只留规整件；拼好的剩下的片目录（1 小时前的）删、刚写的不动；没主的目录满 1 天删、刚建的不删、_asrtest 不动", async () => {
    await 开关(true);
    const 成 = await 一条({ status: "待确认", endedAt: new Date(), transcript: "转写", audioPath: "asr.m4a", 文件: { "asr.m4a": "规整", "seg-01.m4a": "原", "seg-02.m4a": "原", "seg-03/": "", "seg-03/0000.part": "片", "asr-concat.txt": "x" } });
    const 规整件不在 = await 一条({ status: "待确认", endedAt: new Date(), transcript: "转写", audioPath: "asr.m4a", 文件: { "seg-01.m4a": "原" } });
    const 拼好 = await 一条({ status: "待提交", endedAt: new Date(), 文件: { "seg-01.m4a": "原", "seg-02/": "", "seg-02/0000.part": "片", "seg-03/": "", "seg-03/0000.part": "片" } });
    const 两小时前 = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(path.join(拼好.dir, "seg-02"), 两小时前, 两小时前); // seg-03 刚写：可能是用户正在补的一段，不动
    const 老主 = path.join(录音根(), "202601", "zzzzzzzzzzzzzzzzzzzzzz01");
    const 新主 = path.join(录音根(), "202601", "zzzzzzzzzzzzzzzzzzzzzz02");
    const 样例 = path.join(录音根(), "_asrtest");
    for (const d of [老主, 新主, 样例]) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "a.m4a"), "x"); }
    const 两天前 = new Date(Date.now() - 2 * 天);
    fs.utimesSync(老主, 两天前, 两天前);
    const 果 = await 清理一轮();
    expect(果.没主目录).toBe(1);
    expect(fs.readdirSync(成.dir).sort()).toEqual(["asr.m4a"]);
    expect(fs.readdirSync(规整件不在.dir).sort()).toEqual(["seg-01.m4a"]); // 规整件不在：原始段不能删
    expect(fs.readdirSync(拼好.dir).sort()).toEqual(["seg-01.m4a", "seg-03"]);
    expect(fs.existsSync(老主)).toBe(false);
    expect(fs.existsSync(新主)).toBe(true);
    expect(fs.existsSync(样例)).toBe(true);
  });

  it("这个月转写超过 200 小时：系统管理员铃铛提醒一次", async () => {
    await 开关(true);
    for (const 秒 of [100 * 3600, 90 * 3600]) await raw.auditLog.create({ data: { userId: 人.教练, userName: "教练", action: "ai_use", entity: "Ai", entityId: "asr", summary: "录音转写", detail: JSON.stringify({ 秒 }) } });
    expect((await 清理一轮()).超量提醒).toBe(false);
    await raw.auditLog.create({ data: { userId: 人.教练, userName: "教练", action: "ai_use", entity: "Ai", entityId: "asr", summary: "录音转写", detail: JSON.stringify({ 秒: 11 * 3600 }) } });
    expect((await 清理一轮()).超量提醒).toBe(true);
    await 清理一轮();
    const 们 = await 通知们();
    expect(们.map((n) => [n.userId, n.title])).toEqual([[人.老板, "这个月录音转写已经 201 小时，超过 200 小时"]]);
  });
});

describe("当场连带", () => {
  it("进公海、进回收站：事务里没发出的录音当场放弃（已发出的不动）；清理一轮接着删文件、通知", async () => {
    await 开关(true);
    const a = await 一条({ status: "待确认", endedAt: new Date() });
    const b = await 一条({ status: "已发出", transcript: "x" });
    await raw.$transaction((tx) => 进公海关主题(tx, [项目], 人.甲));
    expect((await 行(a.id)).status).toBe("已放弃");
    expect((await 行(a.id)).error).toBe("【自动删除】项目进了公海或被删除，没发出的录音已自动删除");
    expect((await 行(b.id)).status).toBe("已发出");
    const c = await 一条({ status: "整理中" });
    await raw.$transaction((tx) => 放弃没发出的录音(tx, [项目]));
    expect((await 行(c.id)).status).toBe("已放弃");
    expect(await 清理一轮()).toMatchObject({ 删文件: 2 });
    expect(fs.existsSync(a.dir)).toBe(false);
    expect((await 通知们(人.教练)).length).toBe(2);
  });

  it("停用成员：TA 没发出的录音当场放弃、删文件（开关关着也删）；删主题：录音文件连带删、行留着", async () => {
    const a = await 一条({ status: "待提交", endedAt: new Date() });
    const b = await 一条({ status: "已发出", transcript: "x", topicId: "t1" });
    // 停用确认框先数（跟进 11-22：有才提一句），口径和真删的同一份
    expect(await 没发出的录音数(人.教练)).toBe(1);
    expect(await 停用成员录音(人.教练)).toBe(1);
    expect(await 没发出的录音数(人.教练)).toBe(0);
    expect((await 行(a.id)).status).toBe("已放弃");
    // 当场删了、audioPurgedAt 记上（清理一轮不会再看到它）：这里自己留一条「系统」的痕
    expect(await raw.auditLog.findMany({ where: { entity: "EntCoachRecording", entityId: a.id }, select: { userName: true, action: true, summary: true } })).toEqual([{ userName: "系统", action: "delete", summary: "录音成员停用，没发出的录音已自动删除" }]);
    expect((await 行(a.id)).audioPurgedAt).not.toBeNull();
    expect(fs.existsSync(a.dir)).toBe(false);
    expect(fs.existsSync(b.dir)).toBe(true);
    expect(await 删主题的录音文件("t1")).toBe(1);
    expect(fs.existsSync(b.dir)).toBe(false);
    const r = await 行(b.id);
    expect(r.audioPurgedAt).not.toBeNull();
    expect(r.transcript).toBe("x");
  });
});

describe("容量闸、通知、到期于", () => {
  const 请 = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init);
  const 参 = <T extends object>(x: T) => ({ params: Promise.resolve(x) });

  it("磁盘剩不到 3GB：开始录音、接着录 409「请联系系统管理员」；剩不到 1GB 片也不收；设置概况带存储、标满了", async () => {
    await 开关(true);
    当(人.教练);
    const 开 = async () => 开始(请("/api/coach-rec/start", { method: "POST", body: JSON.stringify({ projectId: 项目, sourceKind: "网页录" }) }));
    const 正常 = await 开();
    expect(正常.status).toBe(200);
    const id = ((await 正常.json()) as { 录音: { id: string } }).录音.id;
    盘.剩 = 2 * 1024 ** 3;
    忘掉存储情况();
    const 满 = await 开();
    expect(满.status).toBe(409);
    expect(((await 满.json()) as { error: string }).error).toContain("请联系系统管理员");
    // 2GB 时片照收
    const 头 = new Uint8Array(64);
    头.set([0, 0, 0, 0x20, ...Buffer.from("ftypM4A ")], 0);
    expect((await 传片(请(`/api/coach-rec/${id}/chunk/1/0`, { method: "PUT", body: 头 as unknown as BodyInit }), 参({ id, seg: "1", seq: "0" }))).status).toBe(200);
    盘.剩 = 500 * 1024 ** 2;
    忘掉存储情况();
    const 片 = await 传片(请(`/api/coach-rec/${id}/chunk/1/1`, { method: "PUT", body: 头 as unknown as BodyInit }), 参({ id, seg: "1", seq: "1" }));
    expect(片.status).toBe(409);
    expect(((await 片.json()) as { error: string }).error).toContain("磁盘快满了");
    // 接着录也拦
    const 待 = await 一条({ status: "待提交", endedAt: new Date() });
    expect((await 接着录(请(`/api/coach-rec/${待.id}/resume`, { method: "POST" }), 参({ id: 待.id }))).status).toBe(409);
    当(人.老板);
    const 概况 = await 读转写设置({ id: 人.老板, name: "老板", role: "SALES" });
    expect(概况 && "存储" in 概况 ? 概况.存储 : null).toMatchObject({ 剩: 500 * 1024 ** 2, 满了: true });
  });

  it("录音目录超过 5GB（磁盘还宽裕）：开始录音 409；设置概况标满了；降回去以后能开始", async () => {
    await 开关(true);
    当(人.教练);
    const 开 = async () => 开始(请("/api/coach-rec/start", { method: "POST", body: JSON.stringify({ projectId: 项目, sourceKind: "网页录" }) }));
    盘.剩 = 100 * 1024 ** 3;
    盘.用 = 5 * 1024 ** 3 + 1;
    忘掉存储情况();
    const 满 = await 开();
    expect(满.status).toBe(409);
    expect(((await 满.json()) as { error: string }).error).toContain("请联系系统管理员");
    当(人.老板);
    const 概况 = await 读转写设置({ id: 人.老板, name: "老板", role: "SALES" });
    expect(概况 && "存储" in 概况 ? 概况.存储 : null).toMatchObject({ 用了: 5 * 1024 ** 3 + 1, 满了: true });
    当(人.教练);
    盘.用 = 5 * 1024 ** 3;
    忘掉存储情况();
    expect((await 开()).status).toBe(200);
  });

  it("「整理好了」通知写 7 天后自动删除；草稿给界面带到期于（待提交、待确认、整理失败）", async () => {
    await 开关(true);
    const 起 = new Date("2026-11-22T10:00:00Z");
    const a = await 一条({ status: "待确认", endedAt: 起 });
    await 一条({ status: "转写中" });
    await 录音整理好了通知(人.教练, { id: a.id, projectId: 项目 });
    expect((await 通知们(人.教练))[0].body).toContain("没发出的草稿 7 天后自动删除");
    const 们 = await 我的录音草稿({ id: 人.教练 }, 项目);
    expect(们.find((x) => x.id === a.id)?.到期于).toBe("2026-11-29T10:00:00.000Z");
    expect(们.find((x) => x.status === "转写中")?.到期于).toBeUndefined();
  });
});

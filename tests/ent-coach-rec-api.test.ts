/**
 * 录音点评 PR2（11-22）：录音存储与上传的接口（app/api/coach-rec/**）+ 读写（lib/enterprise/coach-rec-db.ts）。
 * 钉的是：
 *   - 开关关着（默认）：每个接口都 404，页面数据里没有 录音 这一格（页面和原来一样）
 *   - 谁能开始 / 传：照 能发主题（P-教练-11/12/13）——教练、系统管理员、条线总管理、实线上级、虚线上级能；
 *     负责人本人、同级销售、只读管理员、组员、没关系的市场管理不能；公海里的项目谁都不能
 *   - 越权：别人的录音传片、看进度、传完、放弃一律 404（不露编号在不在）；听原声只给录的人（发出后另给负责人）
 *   - 每片重判：开始以后丢了上下级关系、项目进了公海，下一片就拒
 *   - 大小：开始报 >200MB 拒；一片 >5MB 拒；传的比报的多拒；没传齐不能传完
 *   - 格式：每段第 0 片按文件头认，认不出的拒收、当场删；一片都没收就被拒的整条放弃（不留空的上传中）
 *   - 传完同时只许一个（审查必修 1）：两个传完并发 / 晚 20–60ms，文件逐字节对、库里待提交、只记一条留痕；
 *     别的进程占着位（endedAt 未过期）时回 409 且不收新片，占位过期了能接手；传完以后再传完回现状
 *   - 收一片 60 秒没来字节就停（片读超时）、不留临时文件；每人同时最多 2 片
 *   - 路径：编号、段号、片号不像样的直接拒，文件只落在数据目录 coach-rec/<年月>/<编号>/ 下
 *   - 每人同时最多 5 条没传完的
 *   - 切换视图：开始、传片、传完、放弃、看进度、听原声都拒（403）；页面数据里不给对方的草稿和待提交卡
 *   - 腾讯云取文件：只认签名（过期、改过、换编号都 404），还要状态 = 转写中、开关开着
 *   - 号码打码：销售教练看到的文件名里号码打码（安卓通话录音那几种号码连日期的写法也打），别人原样；留痕里一律打码
 *   - PR3 补段 / 丢段 / 打断：待提交的录音「接着录」回上传中、下一段从 段数 + 1 起（已拼好的段不能再传）；丢段：一段没有整条放弃、
 *     有段的退回待提交并删这回的片；打断只收白名单原因、记第几段；传的文件不能补；别人的 404；交了的 409；分段回放 ?seg=N；
 *     有 ffmpeg 时传完把各段时长加起来
 * 用拷出来的一份库、显式单连接，数据目录用临时目录，不碰共用的测试库。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-ent-coach-rec-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir };
});
const 登录 = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null } as Record<string, unknown> | null }));
const 罐 = vi.hoisted(() => ({ 票: new Map<string, string>() }));
const 假头 = vi.hoisted(() => () => ({
  cookies: async () => ({
    get: (n: string) => (罐.票.has(n) ? { name: n, value: 罐.票.get(n)! } : undefined),
    set: (n: string, v: string) => void 罐.票.set(n, v),
    delete: (n: string) => void 罐.票.delete(n),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/headers", 假头);
vi.mock("next/headers.js", 假头);
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => 登录.user, getCurrentUser: async () => 登录.user }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient<import("@/generated/prisma").Prisma.PrismaClientOptions>({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
  return { prisma: 加上限定(raw), defaultClient: raw };
});
vi.mock("@/lib/enterprise/feishu-push", () => ({ 推通知们: async () => {} }));

import { SignJWT } from "jose";
import { prisma as db, defaultClient as raw } from "@/lib/prisma";
import { readSecret } from "@/lib/secret";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { invalidateSettingsCache } from "@/lib/settings";
import { 视图票, 签视图票 } from "@/lib/enterprise/view-as";
import { 录音点评开关键 } from "@/lib/enterprise/coach-rec-db";
import { 读项目主题 } from "@/lib/enterprise/coach-topic-db";
import { 录音根, 写片, 片读超时 } from "@/lib/enterprise/coach-rec-store";
import { 占片位, 还片位 } from "@/app/api/coach-rec/common";
import { 签取文件地址 } from "@/lib/enterprise/coach-rec-sign";
import { 片上限字节, 文件上限字节 } from "@/lib/enterprise/coach-rec";
import { POST as 开始 } from "@/app/api/coach-rec/start/route";
import { PUT as 传片 } from "@/app/api/coach-rec/[id]/chunk/[seg]/[seq]/route";
import { POST as 传完 } from "@/app/api/coach-rec/[id]/finish/route";
import { POST as 放弃 } from "@/app/api/coach-rec/[id]/abandon/route";
import { GET as 进度 } from "@/app/api/coach-rec/[id]/status/route";
import { GET as 原声 } from "@/app/api/coach-rec/[id]/audio/route";
import { GET as 取文件 } from "@/app/api/coach-rec/fetch/[id]/route";
import { POST as 接着录 } from "@/app/api/coach-rec/[id]/resume/route";
import { POST as 丢段 } from "@/app/api/coach-rec/[id]/drop/route";

const 人 = {
  老板: "cr_boss", // director：系统管理员
  线总: "cr_line", // director + 外贸：条线总管理
  组长: "cr_mgr", // sales_mgr，甲的直属上级
  别组长: "cr_mgr2", // sales_mgr，跟甲没关系
  虚管: "cr_dot", // sales_mgr，甲的虚线上级
  甲: "cr_a", // sales，外贸，项目负责人
  乙: "cr_b", // sales，内贸，同级
  市场2: "cr_mkt2", // marketing_mgr，跟谁都没有上下级关系
  管理员: "cr_adm", // admin：只读
  教练: "cr_coach", // coach，账号 ADMIN
  组员: "cr_ops", // project_ops，进了甲的项目组
} as const;
type 谁 = keyof typeof 人;
const 当 = (r: 谁) => { 登录.user = { id: 人[r], name: r, email: `${人[r]}@x.com`, role: r === "教练" ? "ADMIN" : "SALES", title: "", avatar: null }; 罐.票.clear(); 忘掉企业版范围(); };

let 项目: string;
let 乙项目: string;

const M4A头 = () => { const b = new Uint8Array(64); b.set([0, 0, 0, 0x20, ...Buffer.from("ftypM4A ")], 0); return b; };
const 字节 = (n: number, 头: Uint8Array = M4A头()) => { const b = new Uint8Array(n); b.set(头.subarray(0, Math.min(n, 头.length))); return b; };

async function 建() {
  for (const t of ["EntCoachRecording", "EntCoachReply", "EntCoachTopic", "EntNotice", "AuditLog", "ProjectMember", "Project", "Setting", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`).catch(() => {});
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["FollowUpProject", "FollowUp", "Contact", "Lead", "CustomerPool", "CustomerClaim", "CustomerCreator", "Task", "FollowPlan"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`).catch(() => {});
  await raw.$executeRawUnsafe('DELETE FROM "Customer"');
  await raw.$executeRawUnsafe('DELETE FROM "Channel"');
  await raw.$executeRawUnsafe('DELETE FROM "User"');
  for (const [名, id] of Object.entries(人)) await raw.user.create({ data: { id, email: `${id}@x.com`, name: 名, password: "x", role: 名 === "教练" ? "ADMIN" : "SALES", active: true } });
  await raw.entMember.createMany({
    data: [
      { userId: 人.老板, bizRole: "director" },
      { userId: 人.线总, bizRole: "director", line: "外贸" },
      { userId: 人.组长, bizRole: "sales_mgr" },
      { userId: 人.别组长, bizRole: "sales_mgr" },
      { userId: 人.虚管, bizRole: "sales_mgr" },
      { userId: 人.甲, bizRole: "sales", line: "外贸", managerId: 人.组长, dottedManagerId: 人.虚管 },
      { userId: 人.乙, bizRole: "sales", line: "内贸" },
      { userId: 人.市场2, bizRole: "marketing_mgr" },
      { userId: 人.管理员, bizRole: "admin" },
      { userId: 人.教练, bizRole: "coach" },
      { userId: 人.组员, bizRole: "project_ops" },
    ],
  });
  const 客户 = (await raw.customer.create({ data: { name: "甲的客户", phone: "13800001111", salesOwnerId: 人.甲, bizLine: "外贸" } })).id;
  项目 = (await raw.project.create({ data: { name: "甲的项目", customerId: 客户, ownerId: 人.甲, creatorId: 人.甲, bizLine: "外贸", phase: "线索", node: "线索验证" } })).id;
  await raw.projectMember.create({ data: { projectId: 项目, userId: 人.组员, inviteStatus: "JOINED" } });
  const 乙客户 = (await raw.customer.create({ data: { name: "乙的客户", phone: "13800002222", salesOwnerId: 人.乙, bizLine: "内贸" } })).id;
  乙项目 = (await raw.project.create({ data: { name: "乙的项目", customerId: 乙客户, ownerId: 人.乙, creatorId: 人.乙, bizLine: "内贸", phase: "线索", node: "线索验证" } })).id;
  await raw.setting.create({ data: { key: 规则.按组织看客户.key, value: "true" } });
  fs.rmSync(录音根(), { recursive: true, force: true });
  invalidateSettingsCache();
  忘掉企业版范围();
}
async function 开关(开: boolean) {
  await raw.setting.upsert({ where: { key: 录音点评开关键 }, update: { value: JSON.stringify(开) }, create: { key: 录音点评开关键, value: JSON.stringify(开) } });
  invalidateSettingsCache();
}

const 请 = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init);
const 参 = <T extends object>(x: T) => ({ params: Promise.resolve(x) });
const 读 = async (r: Response) => ({ status: r.status, 体: (await r.json().catch(() => ({}))) as Record<string, unknown> });
const 开一条 = async (projectId = 项目, x: Record<string, unknown> = {}) =>
  读(await 开始(请("/api/coach-rec/start", { method: "POST", body: JSON.stringify({ projectId, sourceKind: "上传", fileName: "面谈.m4a", bytes: 100, mime: "audio/mp4", ...x }) })));
const 片 = async (id: string, seq: number, 体: Uint8Array, seg = "1", 头?: Record<string, string>) =>
  读(await 传片(请(`/api/coach-rec/${id}/chunk/${seg}/${seq}`, { method: "PUT", body: 体 as unknown as BodyInit, headers: 头 }), 参({ id, seg, seq: String(seq) })));
const 完 = async (id: string) => 读(await 传完(请(`/api/coach-rec/${id}/finish`, { method: "POST" }), 参({ id })));
const 弃 = async (id: string) => 读(await 放弃(请(`/api/coach-rec/${id}/abandon`, { method: "POST" }), 参({ id })));
const 看 = async (id: string) => 读(await 进度(请(`/api/coach-rec/${id}/status`), 参({ id })));
const 听 = async (id: string, 头?: Record<string, string>) => 原声(请(`/api/coach-rec/${id}/audio`, { headers: 头 }), 参({ id }));
/** 教练从头传完一条 100 字节的 m4a，回编号 */
async function 传好一条(r: 谁 = "教练"): Promise<string> {
  当(r);
  const s = await 开一条();
  expect(s.status).toBe(200);
  const id = (s.体.录音 as { id: string }).id;
  expect((await 片(id, 0, 字节(100))).status).toBe(200);
  expect((await 完(id)).status).toBe(200);
  return id;
}

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  process.env.CRM_DATA_DIR = 临时.dir;
  delete process.env.DESKTOP_LOCAL;
}, 60_000);
beforeEach(async () => { await 建(); });
afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  delete process.env.CRM_DATA_DIR;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

describe("开关关着（默认）", () => {
  it("每个接口都 404，页面数据没有 录音 这一格", async () => {
    当("教练");
    expect((await 开一条()).status).toBe(404);
    const 假 = "c".padEnd(25, "a");
    expect((await 片(假, 0, 字节(10))).status).toBe(404);
    expect((await 完(假)).status).toBe(404);
    expect((await 弃(假)).status).toBe(404);
    expect((await 看(假)).status).toBe(404);
    expect((await 听(假)).status).toBe(404);
    const 数据 = await 读项目主题({ id: 人.教练, role: "ADMIN" }, 项目);
    expect(数据?.能发).toBe(true);
    expect(数据 && "录音" in 数据).toBe(false);
    expect(await raw.entCoachRecording.count()).toBe(0);
  });

  it("开着时才有 录音 这一格（能发的人才有）", async () => {
    await 开关(true);
    // PR4：没配转写密钥（测试环境没有）= 可录 false（不出「传录音文件」，草稿照给）
    expect((await 读项目主题({ id: 人.教练, role: "ADMIN" }, 项目))?.录音).toEqual({ 草稿们: [], 可录: false });
    expect((await 读项目主题({ id: 人.管理员, role: "SALES" }, 项目))?.录音).toBeUndefined();
    expect((await 读项目主题({ id: 人.甲, role: "SALES" }, 项目))?.录音).toBeUndefined();
  });
});

describe("开关开着：谁能开始", () => {
  beforeEach(() => 开关(true));
  for (const r of ["教练", "老板", "线总", "组长", "虚管"] as 谁[]) {
    it(`${r} 能对甲的项目开始传录音`, async () => {
      当(r);
      const s = await 开一条();
      expect(s.status).toBe(200);
      const 行 = await raw.entCoachRecording.findFirstOrThrow();
      expect(行).toMatchObject({ authorId: 人[r], projectId: 项目, status: "上传中", sourceKind: "上传", bytes: 100 });
    });
  }
  for (const r of ["甲", "乙", "管理员", "组员", "市场2", "别组长"] as 谁[]) {
    it(`${r} 不能（403），库里不多一行`, async () => {
      当(r);
      expect((await 开一条()).status).toBe(403);
      expect(await raw.entCoachRecording.count()).toBe(0);
    });
  }
  it("公海里的项目谁都不能（教练、系统管理员也不行）", async () => {
    await raw.project.update({ where: { id: 乙项目 }, data: { pooledAt: new Date() } });
    for (const r of ["教练", "老板"] as 谁[]) {
      当(r);
      expect((await 开一条(乙项目)).status).toBe(403);
    }
  });
  it("不收 authorId：填写人锁定当前登录的人", async () => {
    当("教练");
    await 开一条(项目, { authorId: 人.组长 });
    expect((await raw.entCoachRecording.findFirstOrThrow()).authorId).toBe(人.教练);
  });
  it("参数不对：来源不认、大小不对、超过 200MB、没文件名、项目不在", async () => {
    当("教练");
    expect((await 开一条(项目, { sourceKind: "别的" })).status).toBe(400);
    expect((await 开一条(项目, { bytes: 0 })).status).toBe(400);
    expect((await 开一条(项目, { bytes: "100" })).status).toBe(400);
    const 大 = await 开一条(项目, { bytes: 文件上限字节 + 1 });
    expect(大.status).toBe(400);
    expect(大.体.error).toContain("200MB");
    expect((await 开一条(项目, { fileName: "" })).status).toBe(400);
    expect((await 开一条("没有这个项目")).status).toBe(404);
    expect((await 开一条("../../etc")).status).toBe(404);
  });
  it("每人同时最多 5 条没传完的，第 6 条 429", async () => {
    当("教练");
    for (let i = 0; i < 5; i++) expect((await 开一条()).status).toBe(200);
    expect((await 开一条()).status).toBe(429);
  });
});

describe("开关开着：传、传完、续传、放弃", () => {
  beforeEach(() => 开关(true));

  it("教练传两片、断点续传、传完 → 待提交；文件落在 coach-rec/<年月>/<编号>/，片删掉", async () => {
    当("教练");
    const 总 = 片上限字节 + 1000;
    const id = ((await 开一条(项目, { bytes: 总 })).体.录音 as { id: string }).id;
    const 整 = 字节(总);
    expect((await 片(id, 0, 整.subarray(0, 片上限字节))).status).toBe(200);
    // 断了：回来问进度
    const v = await 看(id);
    expect(v.status).toBe(200);
    expect((v.体.录音 as { 已收片: unknown[]; 已收字节: number }).已收字节).toBe(片上限字节);
    expect((v.体.录音 as { 已收片: unknown[] }).已收片).toEqual([{ 段: 1, 片: 0, 字节: 片上限字节 }]);
    // 没传齐不能传完
    expect((await 完(id)).status).toBe(409);
    // 同一片重复传按片号覆盖
    expect((await 片(id, 0, 整.subarray(0, 片上限字节))).status).toBe(200);
    expect((await 片(id, 1, 整.subarray(片上限字节))).status).toBe(200);
    const f = await 完(id);
    expect(f.status).toBe(200);
    const 行 = await raw.entCoachRecording.findUniqueOrThrow({ where: { id } });
    expect(行).toMatchObject({ status: "待提交", chunks: 2, segCount: 1, bytes: 总, format: "m4a" });
    expect(行.endedAt).toBeTruthy();
    const 文件 = path.join(录音根(), 行.audioPath!);
    expect(文件.startsWith(path.join(临时.dir, "coach-rec") + path.sep)).toBe(true);
    expect(fs.readFileSync(文件).equals(Buffer.from(整))).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(文件), "seg-01"))).toBe(false);
    // 传完后再传片拒；再传完回现状（待提交，当成功），不再拼一遍
    expect((await 片(id, 0, 字节(10))).status).toBe(409);
    const 再 = await 完(id);
    expect(再.status).toBe(200);
    expect((再.体.录音 as { status: string }).status).toBe("待提交");
    expect(fs.readFileSync(文件).equals(Buffer.from(整))).toBe(true);
  });

  /** 开一条 n 片（最后一片 尾 字节）的传文件、传齐，回编号和整份内容（每片内容不同，拼错位一比就知道） */
  async function 传齐(n: number, 尾 = 1000): Promise<{ id: string; 整: Uint8Array }> {
    当("教练");
    const 总 = 片上限字节 * (n - 1) + 尾;
    const 整 = new Uint8Array(总);
    for (let i = 0; i < 总; i++) 整[i] = (i * 31 + (i >> 12)) & 0xff;
    整.set(M4A头().subarray(0, 12));
    const id = ((await 开一条(项目, { bytes: 总 })).体.录音 as { id: string }).id;
    for (let i = 0; i < n; i++) expect((await 片(id, i, 整.subarray(i * 片上限字节, Math.min(总, (i + 1) * 片上限字节)))).status).toBe(200);
    return { id, 整 };
  }
  async function 核拼好(id: string, 整: Uint8Array) {
    const 行 = await raw.entCoachRecording.findUniqueOrThrow({ where: { id } });
    expect(行).toMatchObject({ status: "待提交", bytes: 整.length, chunks: Math.ceil(整.length / 片上限字节) });
    const 文件 = path.join(录音根(), 行.audioPath!);
    const 读到 = fs.readFileSync(文件);
    expect(读到.length).toBe(整.length);
    expect(读到.equals(Buffer.from(整))).toBe(true);
    // 目录里只剩拼好的那一个文件：没有片、没有临时文件
    expect(fs.readdirSync(path.dirname(文件))).toEqual([path.basename(文件)]);
    expect((await raw.auditLog.findMany({ where: { entity: "EntCoachRecording", entityId: id, action: "update" } })).length).toBe(1);
  }

  it("并发传完（审查必修 1）：两个同时到、文件逐字节对、待提交、只记一条留痕", async () => {
    const { id, 整 } = await 传齐(6);
    const [a, b] = await Promise.all([完(id), 完(id)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    for (const x of [a, b]) expect((x.体.录音 as { status: string }).status).toBe("待提交");
    await 核拼好(id, 整);
  });

  for (const 晚 of [20, 60]) {
    it(`并发传完：第二个晚 ${晚}ms 到，照样不拼第二遍、文件不坏`, async () => {
      const { id, 整 } = await 传齐(6);
      const a = 完(id);
      await new Promise((r) => setTimeout(r, 晚));
      const [x, y] = await Promise.all([a, 完(id)]);
      expect([x.status, y.status]).toEqual([200, 200]);
      await 核拼好(id, 整);
    });
  }

  it("别的进程占着位（endedAt 没过期）：传完回 409「正在合成」、不收新片；占位过期了能接手拼完", async () => {
    const { id, 整 } = await 传齐(2);
    await raw.entCoachRecording.update({ where: { id }, data: { endedAt: new Date() } });
    const f = await 完(id);
    expect(f.status).toBe(409);
    expect(f.体.error).toContain("正在合成");
    expect((await 片(id, 1, 整.subarray(片上限字节))).status).toBe(409);
    expect((await raw.entCoachRecording.findUniqueOrThrow({ where: { id } })).status).toBe("上传中");
    // 占位的进程死了（10 分钟前占的）：接手
    await raw.entCoachRecording.update({ where: { id }, data: { endedAt: new Date(Date.now() - 11 * 60 * 1000) } });
    expect((await 完(id)).status).toBe(200);
    await 核拼好(id, 整);
  });

  it("片没传齐就点传完：占位还回去，接着传完再传完照常", async () => {
    当("教练");
    const 总 = 片上限字节 + 1000;
    const 整 = 字节(总);
    const id = ((await 开一条(项目, { bytes: 总 })).体.录音 as { id: string }).id;
    expect((await 片(id, 0, 整.subarray(0, 片上限字节))).status).toBe(200);
    expect((await 完(id)).status).toBe(409);
    expect((await raw.entCoachRecording.findUniqueOrThrow({ where: { id } })).endedAt).toBeNull();
    expect((await 片(id, 1, 整.subarray(片上限字节))).status).toBe(200);
    expect((await 完(id)).status).toBe(200);
  });

  it("收一片：60 秒（这里 50ms）没来新字节就停、抛 片读超时，不留临时文件、不留片", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-crec-timeout-"));
    const 挂着 = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(10)); } });
    await expect(写片(dir, 1, 0, 挂着, 片上限字节, 50)).rejects.toBeInstanceOf(片读超时);
    expect(fs.readdirSync(path.join(dir, "seg-01"))).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("同一片两个请求同时写：各写各的临时文件，最后是完整的一片", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-crec-same-"));
    const 内容 = 字节(200_000);
    const 流 = () => new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < 内容.length; i += 10_000) c.enqueue(内容.slice(i, i + 10_000)); c.close(); } });
    await Promise.all([写片(dir, 1, 0, 流()), 写片(dir, 1, 0, 流())]);
    expect(fs.readdirSync(path.join(dir, "seg-01"))).toEqual(["0000.part"]);
    expect(fs.readFileSync(path.join(dir, "seg-01", "0000.part")).equals(Buffer.from(内容))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("每人同时最多收 2 片，别人不受影响；还了位又能收", () => {
    expect(占片位("u1")).toBe(true);
    expect(占片位("u1")).toBe(true);
    expect(占片位("u1")).toBe(false);
    expect(占片位("u2")).toBe(true);
    还片位("u1");
    expect(占片位("u1")).toBe(true);
    for (const u of ["u1", "u1", "u2"]) 还片位(u);
  });

  it("草稿条：页面数据带我的草稿，别人看不到", async () => {
    const id = await 传好一条("教练");
    const 我的 = await 读项目主题({ id: 人.教练, role: "ADMIN" }, 项目);
    expect(我的?.录音?.草稿们.map((d) => [d.id, d.status, d.能听])).toEqual([[id, "待提交", true]]);
    expect((await 读项目主题({ id: 人.组长, role: "SALES" }, 项目))?.录音?.草稿们).toEqual([]);
  });

  it("第一片认不出格式 → 415，当场删；一片都没收，这一条直接放弃（不留空的上传中占名额）", async () => {
    当("教练");
    const id = ((await 开一条()).体.录音 as { id: string }).id;
    const r = await 片(id, 0, 字节(100, new Uint8Array(Buffer.from("<html><script>alert(1)</script>"))));
    expect(r.status).toBe(415);
    const 行 = await raw.entCoachRecording.findUniqueOrThrow({ where: { id } });
    expect(行).toMatchObject({ status: "已放弃", format: null });
    expect(行.deletedAt).toBeTruthy();
    expect(fs.existsSync(path.join(录音根(), 行.createdAt.toISOString().slice(0, 7).replace("-", ""), id))).toBe(false);
    expect((await 看(id)).status).toBe(404);
    expect(await raw.entCoachRecording.count({ where: { authorId: 人.教练, status: "上传中" } })).toBe(0);
  });

  it("录音多段：每段第 0 片都核文件头；第 2 段认不出 / 格式和第 1 段不一样都拒，已收的不动", async () => {
    当("教练");
    const id = ((await 开一条(项目, { sourceKind: "网页录" })).体.录音 as { id: string }).id;
    expect((await 片(id, 0, 字节(100))).status).toBe(200);
    const 认不出 = await 片(id, 0, 字节(100, new Uint8Array(Buffer.from("<html>"))), "2");
    expect(认不出.status).toBe(415);
    // 网页录说录音的话，不说「文件」（跟进 11-22）
    expect(认不出.体.error).toBe("这一段录音的格式认不出来");
    const 不一样 = await 片(id, 0, 字节(100, new Uint8Array(Buffer.from("OggS"))), "2");
    expect(不一样.status).toBe(415);
    expect(不一样.体.error).toContain("格式不一样");
    expect((await 片(id, 0, 字节(100), "2")).status).toBe(200);
    expect((await 看(id)).体.录音).toMatchObject({ status: "上传中", 格式: "m4a", 已收片: [{ 段: 1, 片: 0, 字节: 100 }, { 段: 2, 片: 0, 字节: 100 }] });
  });

  it("认得出的几种：mp3（ID3）、wav、amr、ogg、flac、webm、3gp 都收", async () => {
    当("老板");
    const 头们: Record<string, number[] | string> = { mp3: "ID3", wav: "RIFF\0\0\0\0WAVE", amr: "#!AMR", ogg: "OggS", flac: "fLaC", "3gp": "\0\0\0\x18ftyp3gp4" };
    for (const [格式, 头] of Object.entries(头们)) {
      await raw.entCoachRecording.deleteMany();
      const id = ((await 开一条()).体.录音 as { id: string }).id;
      const b = typeof 头 === "string" ? new Uint8Array(Buffer.from(头, "binary")) : new Uint8Array(头);
      expect((await 片(id, 0, 字节(100, b))).status, 格式).toBe(200);
      expect((await raw.entCoachRecording.findUniqueOrThrow({ where: { id } })).format).toBe(格式);
    }
    await raw.entCoachRecording.deleteMany();
    const id = ((await 开一条()).体.录音 as { id: string }).id;
    expect((await 片(id, 0, 字节(100, new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])))).status).toBe(200);
  });

  it("大小：声明一片 >5MB 直接 413；实际超了 413；比开始报的多 413；传文件只收第 1 段", async () => {
    当("教练");
    const id = ((await 开一条(项目, { bytes: 100 })).体.录音 as { id: string }).id;
    expect((await 片(id, 0, 字节(10), "1", { "content-length": String(片上限字节 + 1) })).status).toBe(413);
    expect((await 片(id, 0, 字节(101))).status).toBe(413);
    expect((await 片(id, 0, 字节(60))).status).toBe(200);
    expect((await 片(id, 1, 字节(41))).status).toBe(413);
    expect((await 片(id, 0, 字节(10), "2")).status).toBe(400);
    // 空片不收
    expect((await 片(id, 1, new Uint8Array(0))).status).toBe(400);
  });

  it("段号、片号、编号不像样的直接拒（不拼路径）", async () => {
    当("教练");
    const id = ((await 开一条()).体.录音 as { id: string }).id;
    for (const [seg, seq] of [["0", "0"], ["..", "0"], ["1", "-1"], ["1", "../x"], ["21", "0"], ["1", "600"], ["1", "1e3"]]) {
      const r = await 读(await 传片(请(`/api/coach-rec/${id}/chunk/${seg}/${seq}`, { method: "PUT", body: 字节(10) as unknown as BodyInit }), 参({ id, seg, seq })));
      expect(r.status, `${seg}/${seq}`).toBe(400);
    }
    for (const 坏 of ["../../etc/passwd", "a", "C".repeat(25), `${id}/../x`]) {
      expect((await 片(坏, 0, 字节(10))).status, 坏).toBe(404);
      expect((await 看(坏)).status).toBe(404);
    }
    // 一片都没收：数据目录下连 coach-rec 都没建出来，更没有别处的文件
    expect(fs.existsSync(录音根())).toBe(false);
    expect(fs.readdirSync(临时.dir).sort()).toEqual(["A.db", "A.db-shm", "A.db-wal"].filter((f) => fs.existsSync(path.join(临时.dir, f))));
  });

  it("越权：别人的录音传片、传完、看进度、放弃都 404，文件和状态不动", async () => {
    当("教练");
    const id = ((await 开一条()).体.录音 as { id: string }).id;
    await 片(id, 0, 字节(100));
    for (const r of ["组长", "老板", "乙", "甲"] as 谁[]) {
      当(r);
      expect((await 片(id, 0, 字节(100))).status, r).toBe(404);
      expect((await 完(id)).status, r).toBe(404);
      expect((await 看(id)).status, r).toBe(404);
      expect((await 弃(id)).status, r).toBe(404);
    }
    expect((await raw.entCoachRecording.findUniqueOrThrow({ where: { id } })).status).toBe("上传中");
  });

  it("每片重判：开始以后甲换了上级，组长的下一片 403；项目进公海，教练的下一片 403", async () => {
    当("组长");
    const a = ((await 开一条()).体.录音 as { id: string }).id;
    await raw.entMember.update({ where: { userId: 人.甲 }, data: { managerId: 人.别组长 } });
    忘掉企业版范围();
    expect((await 片(a, 0, 字节(100))).status).toBe(403);
    当("教练");
    const b = ((await 开一条()).体.录音 as { id: string }).id;
    await raw.project.update({ where: { id: 项目 }, data: { pooledAt: new Date() } });
    expect((await 片(b, 0, 字节(100))).status).toBe(403);
    expect((await 完(b)).status).toBe(403);
  });

  it("放弃：文件当场删，行打记号；再放弃一次当成功；放弃后不能再传", async () => {
    当("教练");
    const id = ((await 开一条()).体.录音 as { id: string }).id;
    await 片(id, 0, 字节(100));
    const 行 = await raw.entCoachRecording.findUniqueOrThrow({ where: { id } });
    const 目录 = path.join(录音根(), 行.createdAt.toISOString().slice(0, 7).replace("-", ""), id);
    expect(fs.existsSync(目录)).toBe(true);
    expect((await 弃(id)).status).toBe(200);
    expect(fs.existsSync(目录)).toBe(false);
    expect(await raw.entCoachRecording.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "已放弃" });
    expect((await raw.entCoachRecording.findUniqueOrThrow({ where: { id } })).deletedAt).toBeTruthy();
    expect((await 弃(id)).status).toBe(200);
    expect((await 片(id, 0, 字节(100))).status).toBe(409);
    expect((await 看(id)).status).toBe(404);
  });

  it("待提交的也能删；已发出、转写中的不能删", async () => {
    const id = await 传好一条("教练");
    expect((await 弃(id)).status).toBe(200);
    const id2 = await 传好一条("教练");
    await raw.entCoachRecording.update({ where: { id: id2 }, data: { status: "转写中" } });
    expect((await 弃(id2)).status).toBe(409);
    await raw.entCoachRecording.update({ where: { id: id2 }, data: { status: "已发出" } });
    expect((await 弃(id2)).status).toBe(409);
  });
});

describe("听原声", () => {
  beforeEach(() => 开关(true));

  it("录的人能听（Range 206、类型按认出的格式、sandbox + nosniff）；负责人在发出前不能听；别的人都不能", async () => {
    const id = await 传好一条("教练");
    当("教练");
    const r = await 听(id);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("audio/mp4");
    expect(r.headers.get("content-security-policy")).toBe("sandbox");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await r.arrayBuffer()).length).toBe(100);
    const 段 = await 听(id, { range: "bytes=10-19" });
    expect(段.status).toBe(206);
    expect(段.headers.get("content-range")).toBe("bytes 10-19/100");
    for (const x of ["甲", "组长", "老板", "管理员", "组员", "乙"] as 谁[]) {
      当(x);
      expect((await 听(id)).status, x).toBe(403);
    }
  });

  it("发出以后项目负责人能听；只读管理员、上级照样不能；音频到期删了谁都不能", async () => {
    const id = await 传好一条("教练");
    await raw.entCoachRecording.update({ where: { id }, data: { status: "已发出" } });
    当("甲");
    expect((await 听(id)).status).toBe(200);
    for (const x of ["管理员", "组长"] as 谁[]) {
      当(x);
      expect((await 听(id)).status, x).toBe(403);
    }
    await raw.entCoachRecording.update({ where: { id }, data: { audioPurgedAt: new Date() } });
    当("教练");
    expect((await 听(id)).status).toBe(403);
  });
});

describe("切换视图", () => {
  beforeEach(() => 开关(true));
  const 签会话 = (sub: string) =>
    new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(readSecret()));

  it("系统管理员切到教练的视角：开始、传片、听原声都 403，库和文件不动", async () => {
    const id = await 传好一条("教练");
    const 个 = await raw.entCoachRecording.count();
    当("教练"); // getCurrentUser 回被看的人
    罐.票.set("crm_session", await 签会话(人.老板));
    罐.票.set(视图票, await 签视图票(人.老板, 人.教练));
    忘掉企业版范围();
    expect((await 开一条()).status).toBe(403);
    expect((await 片(id, 0, 字节(100))).status).toBe(403);
    expect((await 听(id)).status).toBe(403);
    expect((await 弃(id)).status).toBe(403);
    expect(await raw.entCoachRecording.count()).toBe(个);
  });

  it("切到教练的视角：没传完的那条 传完 / 放弃 / 看进度 都 403、状态和片不动；页面数据里不给对方的草稿和待提交卡", async () => {
    const 好 = await 传好一条("教练");
    当("教练");
    const 半 = ((await 开一条(项目, { bytes: 200 })).体.录音 as { id: string }).id;
    expect((await 片(半, 0, 字节(100))).status).toBe(200);
    expect((await 读项目主题({ id: 人.教练, role: "ADMIN" }, 项目))?.录音?.草稿们.map((d) => d.id).sort()).toEqual([好, 半].sort());
    罐.票.set("crm_session", await 签会话(人.老板));
    罐.票.set(视图票, await 签视图票(人.老板, 人.教练));
    忘掉企业版范围();
    for (const 一条 of [半, 好]) {
      expect((await 完(一条)).status).toBe(403);
      expect((await 弃(一条)).status).toBe(403);
      expect((await 看(一条)).status).toBe(403);
    }
    expect(await raw.entCoachRecording.findUniqueOrThrow({ where: { id: 半 } })).toMatchObject({ status: "上传中", chunks: 1 });
    expect(await raw.entCoachRecording.findUniqueOrThrow({ where: { id: 好 } })).toMatchObject({ status: "待提交" });
    expect((await 读项目主题({ id: 人.教练, role: "ADMIN" }, 项目))?.录音?.草稿们).toEqual([]);
  });
});

describe("腾讯云取文件（签名地址）", () => {
  beforeEach(() => 开关(true));
  const 取 = async (url: string) => 取文件(请(url), 参({ id: url.split("/")[4].split("?")[0] }));

  it("只认签名 + 状态 = 转写中：没在转写 404；转写中 200；改过、过期、换编号 404；开关关了 404", async () => {
    const id = await 传好一条("教练");
    const url = 签取文件地址(id);
    expect((await 取(url)).status).toBe(404);
    await raw.entCoachRecording.update({ where: { id }, data: { status: "转写中" } });
    const r = await 取(url);
    expect(r.status).toBe(200);
    expect(Buffer.from(await r.arrayBuffer()).length).toBe(100);
    expect((await 取(url.replace(/sig=(.)/, (_m, c: string) => `sig=${c === "A" ? "B" : "A"}`))).status).toBe(404); // 首字符一定换成别的（原写法签名本就 A 开头时等于没改，约 1/64 偶发 200）
    expect((await 取(url.replace(/exp=\d+/, (m) => `exp=${Number(m.slice(4)) + 1}`))).status).toBe(404);
    expect((await 取(签取文件地址(id, new Date(Date.now() - 31 * 60 * 1000)))).status).toBe(404);
    const 别的 = await 传好一条("老板");
    await raw.entCoachRecording.update({ where: { id: 别的 }, data: { status: "转写中" } });
    expect((await 取(url.replace(id, 别的))).status).toBe(404);
    expect((await 取(`/api/coach-rec/fetch/${id}`)).status).toBe(404);
    await 开关(false);
    expect((await 取(url)).status).toBe(404);
  });
});

describe("号码打码", () => {
  beforeEach(() => 开关(true));
  it("教练看到的文件名里号码打码（自己传的也打）；组长原样；留痕里一律打码", async () => {
    当("教练");
    const a = await 开一条(项目, { fileName: "通话录音 13812345678_20261122.m4a" });
    expect((a.体.录音 as { 文件名: string }).文件名).not.toContain("13812345678");
    当("组长");
    const b = await 开一条(项目, { fileName: "通话录音 13812345678_20261122.m4a" });
    expect((b.体.录音 as { 文件名: string }).文件名).toContain("13812345678");
    const 留痕 = await raw.auditLog.findMany({ where: { entity: "EntCoachRecording" } });
    expect(留痕.length).toBe(2);
    for (const l of 留痕) expect(l.summary).not.toContain("13812345678");
  });

  it.each([
    "通话录音-13812345678-20261122.m4a",
    "通话录音 13812345678 20261122093012.m4a",
    "record-13812345678.m4a",
    "通话录音 1381234567820261122093012.m4a",
  ])("安卓通话录音文件名 %s：教练看到的、开始 / 传完 / 删掉三条留痕里都不带号码", async (名) => {
    当("教练");
    const id = ((await 开一条(项目, { fileName: 名 })).体.录音 as { id: string; 文件名: string }).id;
    expect((await 看(id)).体.录音).toMatchObject({ 文件名: expect.not.stringContaining("13812345678") });
    expect((await 片(id, 0, 字节(100))).status).toBe(200);
    expect((await 完(id)).status).toBe(200);
    expect((await 弃(id)).status).toBe(200);
    const 留痕 = await raw.auditLog.findMany({ where: { entity: "EntCoachRecording", entityId: id } });
    expect(留痕.map((l) => l.action).sort()).toEqual(["create", "delete", "update"]);
    for (const l of 留痕) {
      expect(l.summary).not.toContain("13812345678");
      expect(l.summary).not.toMatch(/\d{7,}/);
    }
  });
});

describe("写只走 主题写", () => {
  beforeEach(() => 开关(true));
  it("教练（只读角色）不经过判定直接写录音表被拒", async () => {
    当("教练");
    await expect(以谁的身份(人.教练, () => db.entCoachRecording.create({ data: { projectId: 项目, authorId: 人.教练, sourceKind: "上传" } }))).rejects.toThrow();
    expect(await raw.entCoachRecording.count()).toBe(0);
  });
});

const 完带 = async (id: string, 体: unknown) => 读(await 传完(请(`/api/coach-rec/${id}/finish`, { method: "POST", body: JSON.stringify(体) }), 参({ id })));
const 续录 = async (id: string) => 读(await 接着录(请(`/api/coach-rec/${id}/resume`, { method: "POST" }), 参({ id })));
const 丢 = async (id: string) => 读(await 丢段(请(`/api/coach-rec/${id}/drop`, { method: "POST" }), 参({ id })));
const 有ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

describe("录音 PR3：补段、丢段、打断", () => {
  beforeEach(() => 开关(true));
  const 录一段 = async () => {
    当("教练");
    const s = await 开一条(项目, { sourceKind: "网页录", fileName: undefined, bytes: undefined, mime: undefined });
    expect(s.status).toBe(200);
    const id = (s.体.录音 as { id: string }).id;
    expect((await 片(id, 0, 字节(100))).status).toBe(200);
    expect((await 片(id, 1, 字节(50, new Uint8Array(0)))).status).toBe(200);
    return id;
  };

  it("被打断：传完带 打断 记下第几段、在第几秒、什么原因；能补；接着录回上传中，已拼好的段不能再传，下一段拼在后面", async () => {
    const id = await 录一段();
    const 一 = await 完带(id, { 打断: { 秒: 42.3, 原因: "来电或话筒被占用" } });
    expect(一.status).toBe(200);
    expect(一.体.录音).toMatchObject({ status: "待提交", 段数: 1, 打断们: [{ 段: 1, 秒: 42, 原因: "来电或话筒被占用" }], 能补: true, 总字节: 150 });
    const 二 = await 续录(id);
    expect(二.status).toBe(200);
    expect(二.体.录音).toMatchObject({ status: "上传中", 段数: 1 });
    // 再点一次（两个窗口、连点）当成功
    expect((await 续录(id)).status).toBe(200);
    const 旧段 = await 片(id, 0, 字节(100), "1");
    expect(旧段.status).toBe(409);
    expect(旧段.体.error).toBe("这一段已经传完了");
    // 跳段：第 3 段的片收了也拼不成
    expect((await 片(id, 0, 字节(100), "3")).status).toBe(200);
    expect((await 完(id)).status).toBe(409);
    expect((await 丢(id)).status).toBe(200);
    expect((await 续录(id)).status).toBe(200);
    expect((await 片(id, 0, 字节(80), "2")).status).toBe(200);
    const 三 = await 完带(id, { 打断: { 秒: 90, 原因: "锁屏或切到后台" } });
    expect(三.体.录音).toMatchObject({ status: "待提交", 段数: 2, 总字节: 230, 打断们: [{ 段: 1, 秒: 42 }, { 段: 2, 秒: 90, 原因: "锁屏或切到后台" }] });
    const 行 = await raw.entCoachRecording.findUniqueOrThrow({ where: { id } });
    expect(行).toMatchObject({ segCount: 2, chunks: 3, bytes: 230 });
    expect(行.audioPath).toMatch(/seg-01\.m4a$/);
    // 分段回放：不带 seg 给第 1 段；?seg=2 给第 2 段；没有的段不认（给第 1 段）
    const 听段 = async (seg?: string) => (await 原声(请(`/api/coach-rec/${id}/audio${seg ? `?seg=${seg}` : ""}`), 参({ id }))).arrayBuffer().then((b) => b.byteLength);
    expect(await 听段()).toBe(150);
    expect(await 听段("2")).toBe(80);
    expect(await 听段("9")).toBe(150);
    expect(await 听段("../x")).toBe(150);
    // 交了以后不能补
    await raw.entCoachRecording.update({ where: { id }, data: { status: "转写中" } });
    expect((await 续录(id)).status).toBe(409);
  });

  it("打断原因不在白名单、秒数不像样：不记；没带打断照常传完", async () => {
    const id = await 录一段();
    expect((await 完带(id, { 打断: { 秒: 3, 原因: "<script>" } })).体.录音).toMatchObject({ status: "待提交", 打断们: [] });
    const id2 = await 录一段();
    expect((await 完带(id2, { 打断: { 秒: -5, 原因: "录音出错" } })).体.录音).toMatchObject({ 打断们: [] });
    expect((await raw.entCoachRecording.findUniqueOrThrow({ where: { id: id2 } })).interrupts ?? null).toBeNull();
  });

  it("丢段：一段都没有的整条放弃、片当场删；补段时丢 = 退回待提交、这回的片删掉，前面的段不动", async () => {
    const id = await 录一段();
    const 行 = await raw.entCoachRecording.findUniqueOrThrow({ where: { id } });
    const 目录 = path.join(录音根(), 行.createdAt.toISOString().slice(0, 7).replace("-", ""), id);
    const 一 = await 丢(id);
    expect(一.status).toBe(200);
    expect(一.体.录音).toBeNull();
    expect(await raw.entCoachRecording.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "已放弃" });
    expect(fs.existsSync(目录)).toBe(false);
    // 再丢一次当成功
    expect((await 丢(id)).status).toBe(200);

    const id2 = await 录一段();
    expect((await 完(id2)).status).toBe(200);
    expect((await 续录(id2)).status).toBe(200);
    expect((await 片(id2, 0, 字节(70), "2")).status).toBe(200);
    const 二 = await 丢(id2);
    expect(二.体.录音).toMatchObject({ status: "待提交", 段数: 1, 总字节: 150 });
    const 行2 = await raw.entCoachRecording.findUniqueOrThrow({ where: { id: id2 } });
    const 目录2 = path.join(录音根(), 行2.createdAt.toISOString().slice(0, 7).replace("-", ""), id2);
    expect(fs.existsSync(path.join(目录2, "seg-02"))).toBe(false);
    expect(fs.existsSync(path.join(目录2, "seg-01.m4a"))).toBe(true);
    // 待提交的丢段：不动、回现状
    expect((await 丢(id2)).体.录音).toMatchObject({ status: "待提交" });
  });

  it("传的文件不能补；别人的录音接着录、丢段都 404，状态不动；开关关了 404", async () => {
    const 传的 = await 传好一条("教练");
    const r = await 续录(传的);
    expect(r.status).toBe(409);
    expect(r.体.error).toBe("传的文件不能补录");
    const id = await 录一段();
    expect((await 完(id)).status).toBe(200);
    当("组长");
    expect((await 续录(id)).status).toBe(404);
    expect((await 丢(id)).status).toBe(404);
    expect(await raw.entCoachRecording.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "待提交" });
    当("教练");
    await 开关(false);
    expect((await 续录(id)).status).toBe(404);
    expect((await 丢(id)).status).toBe(404);
  });

  it("补段时丢了权限（项目进公海）：接着录 403", async () => {
    const id = await 录一段();
    expect((await 完(id)).status).toBe(200);
    await raw.project.update({ where: { id: 项目 }, data: { pooledAt: new Date() } });
    expect((await 续录(id)).status).toBe(403);
    expect(await raw.entCoachRecording.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "待提交" });
  });

  it("PR3 审查：飞书原生录第一段（wav），再切网页录补一段（webm）→ 只拒这一片 415，前一段不丢、整条不放弃", async () => {
    当("教练");
    const 头wav = new Uint8Array(Buffer.from("RIFF\0\0\0\0WAVE", "binary"));
    const id = ((await 开一条(项目, { sourceKind: "飞书原生录", fileName: undefined, bytes: undefined, mime: undefined })).体.录音 as { id: string }).id;
    expect((await 片(id, 0, 字节(120, 头wav))).status).toBe(200);
    expect((await 完(id)).体.录音).toMatchObject({ status: "待提交", 段数: 1, 格式: "wav" });
    expect((await 续录(id)).status).toBe(200);
    const 网页段 = await 片(id, 0, 字节(100, new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])), "2");
    expect(网页段.status).toBe(415);
    expect(网页段.体.error).toContain("格式不一样");
    const 行 = await raw.entCoachRecording.findUniqueOrThrow({ where: { id } });
    expect(行).toMatchObject({ status: "上传中", segCount: 1, deletedAt: null, bytes: 120 });
    const 目录 = path.join(录音根(), 行.createdAt.toISOString().slice(0, 7).replace("-", ""), id);
    expect(fs.existsSync(path.join(目录, "seg-01.wav"))).toBe(true);
    // 11-23：被拒的这段一片都没收，片目录 seg-02 一起删，不留空目录
    expect(fs.existsSync(path.join(目录, "seg-02"))).toBe(false);
    // 丢掉这段 → 回到待提交，第 1 段还能听、能交
    expect((await 丢(id)).体.录音).toMatchObject({ status: "待提交", 段数: 1, 总字节: 120 });
    expect(fs.existsSync(path.join(目录, "seg-01.wav"))).toBe(true);
  });

  it("PR3 审查：补段时 200MB 总量连前面拼好的段一起算", async () => {
    const id = await 录一段();
    expect((await 完(id)).status).toBe(200);
    expect((await 续录(id)).status).toBe(200);
    await raw.entCoachRecording.update({ where: { id }, data: { bytes: 文件上限字节 - 50 } });
    const 超 = await 片(id, 0, 字节(100), "2");
    expect(超.status).toBe(413);
    expect(超.体.error).toContain("录音超过");
    expect((await 片(id, 0, 字节(40), "2")).status).toBe(200);
    expect(await raw.entCoachRecording.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "上传中", segCount: 1, deletedAt: null });
  });

  it.skipIf(!有ffmpeg)("有 ffmpeg：传完把各段时长加起来（2 秒 + 3 秒 ≈ 5 秒）", async () => {
    const 生成 = (秒: number) => {
      const f = path.join(临时.dir, `t${秒}.m4a`);
      expect(spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=16000:duration=${秒}`, "-ac", "1", "-c:a", "aac", "-b:a", "32k", "-f", "mp4", f]).status).toBe(0);
      return new Uint8Array(fs.readFileSync(f));
    };
    当("教练");
    const id = ((await 开一条(项目, { sourceKind: "网页录", fileName: undefined, bytes: undefined, mime: undefined })).体.录音 as { id: string }).id;
    expect((await 片(id, 0, 生成(2))).status).toBe(200);
    const 一 = await 完(id);
    expect(Math.abs((一.体.录音 as { 时长毫秒: number }).时长毫秒 - 2000)).toBeLessThan(200);
    expect((await 续录(id)).status).toBe(200);
    expect((await 片(id, 0, 生成(3), "2")).status).toBe(200);
    const 二 = await 完(id);
    expect(Math.abs((二.体.录音 as { 时长毫秒: number }).时长毫秒 - 5000)).toBeLessThan(300);
  });
});

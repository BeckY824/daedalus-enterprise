/**
 * 录音点评 PR4（11-22）：转写队列（lib/enterprise/coach-rec-jobs.ts）、提交整理 / 重试整理接口、设置「语音转文字」、PR2 审查遗留的后端修。
 * 钉的是：
 *   - 开关关着：转写钟什么都不做；提交整理 404
 *   - 没配好（没密钥 / 没 ffmpeg）：客户页 可录 = false、提交整理 409；配好了（假通道）可录 = true
 *   - 全链路（假通道）：提交整理 → 转写中 → 规整（asr.m4a、服务端时长）→ 交（≤ 请求体上限走请求体）→ 10 秒后查 → 整理中（全文带说话人、分段、人数），
 *     记 ai_use（asr，带秒数，设置页按秒合计）；草稿条上留着「整理中」
 *   - 大文件：签名地址（ENT_PUBLIC_URL + 签名，取文件路由给的是规整后的文件）；设成切段 / 没配地址 → 切成每段 ≤ 请求体上限、起点按时间接
 *   - 交不上：可重试的按 30 秒 / 2 分钟 / 10 分钟各再试一次，第 4 次还不行 → 整理失败 + 给录的人一条通知；不可重试的（密钥不对）当场失败
 *   - 轮询：交后 2 分钟内 10 秒一次、之后 30 秒一次；超 3 小时判失败；腾讯云回失败判失败；查的时候网断了下一轮再查
 *   - 重启：交上了的接着查、不重交；排队的接着交
 *   - 重试整理：只有录的人、只认整理失败、占 AI 限频（满了 429）
 *   - 设置：系统管理员能开关（要密钥在、ffmpeg 过）、改大文件交法、测试连接（两条路，样例音频测完删）；管理员 admin 只读、销售教练和销售看不到；都进审计；样例音频开关关着也能被取、过期不给
 *   - 密钥不进库、留痕、通知（明文密钥设成记号串，失败后全库搜不到）
 *   - PR2 遗留：传完占位被接手后原请求不删目录；放弃 / 认不出格式删文件后记 audioPurgedAt；收一片总时长到点就停
 * 用拷出来的一份库、显式单连接，数据目录用临时目录。要 ffmpeg 的几组本机没装就跳过。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-ent-coach-asr-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir };
});
const 登录 = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null } as Record<string, unknown> | null }));
const 钩 = vi.hoisted(() => ({ 拼段前: null as null | (() => Promise<void>), 切段坏: false }));
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
  const m = await 原<typeof import("@/lib/enterprise/coach-rec-store")>();
  return { ...m, 拼段: async (...a: Parameters<typeof m.拼段>) => { if (钩.拼段前) await 钩.拼段前(); return m.拼段(...a); } };
});
// 切段中途坏掉：先切出一段半截再抛（核「残留的 asr-part-* 删掉」）
vi.mock("@/lib/enterprise/asr/ffmpeg", async (原) => {
  const m = await 原<typeof import("@/lib/enterprise/asr/ffmpeg")>();
  return {
    ...m,
    切段: async (...a: Parameters<typeof m.切段>) => {
      if (!钩.切段坏) return m.切段(...a);
      fs.writeFileSync(path.join(a[2], "asr-part-000.wav"), "半截");
      throw new Error("测试：切段中途坏了");
    },
  };
});

import { defaultClient as raw } from "@/lib/prisma";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 看全部 } from "@/lib/team-scope";
import { 规则 } from "@/lib/enterprise/rules";
import { invalidateSettingsCache } from "@/lib/settings";
import { resetAiQuota, consumeAiQuota, AI_LIMIT } from "@/lib/ai-quota";
import { aiUsageThisMonth } from "@/lib/ai-usage";
import { 录音点评开关键, 取给转写, 样例编号头, 样例目录 } from "@/lib/enterprise/coach-rec-db";
import { 读项目主题 } from "@/lib/enterprise/coach-topic-db";
import { 录音根, 写片, 片读超时 } from "@/lib/enterprise/coach-rec-store";
import { 转写一轮, 清转写内存, 大文件交法键, 读任务们, 拼全文 } from "@/lib/enterprise/coach-rec-jobs";
import { 读转写设置, 设录音点评开关, 设大文件交法, 测转写连接, 上次测试键 } from "@/lib/enterprise/coach-rec-asr-settings";
import { 通道错, 请求体上限字节, type 转写通道, type 提交输入, type 查询结果 } from "@/lib/enterprise/asr/channel";
import { 腾讯云通道 } from "@/lib/enterprise/asr/tencent";
import { 清自检缓存 } from "@/lib/enterprise/asr/ffmpeg";
import { 签取文件地址 } from "@/lib/enterprise/coach-rec-sign";
import { POST as 开始 } from "@/app/api/coach-rec/start/route";
import { PUT as 传片 } from "@/app/api/coach-rec/[id]/chunk/[seg]/[seq]/route";
import { POST as 传完 } from "@/app/api/coach-rec/[id]/finish/route";
import { POST as 放弃 } from "@/app/api/coach-rec/[id]/abandon/route";
import { POST as 提交 } from "@/app/api/coach-rec/[id]/submit/route";
import { POST as 重试 } from "@/app/api/coach-rec/[id]/retry/route";
import { GET as 取文件 } from "@/app/api/coach-rec/fetch/[id]/route";

const 有ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const 人 = { 老板: "cra_boss", 甲: "cra_a", 管理员: "cra_adm", 教练: "cra_coach" } as const;
type 谁 = keyof typeof 人;
const 当 = (r: 谁) => { 登录.user = { id: 人[r], name: r, email: `${人[r]}@x.com`, role: r === "教练" ? "ADMIN" : "SALES", title: "", avatar: null }; 忘掉企业版范围(); };
const 我 = (r: 谁) => ({ id: 人[r], name: r, role: r === "教练" ? "ADMIN" : "SALES" });
let 项目: string;
const 音: { 短?: Buffer; 长?: Buffer } = {};

async function 建() {
  for (const t of ["EntCoachRecording", "EntCoachReply", "EntCoachTopic", "EntNotice", "AuditLog", "ProjectMember", "Project", "Setting", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`).catch(() => {});
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["FollowUpProject", "FollowUp", "Contact", "Lead", "CustomerPool", "CustomerClaim", "CustomerCreator", "Task", "FollowPlan"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`).catch(() => {});
  await raw.$executeRawUnsafe('DELETE FROM "Customer"');
  await raw.$executeRawUnsafe('DELETE FROM "Channel"');
  await raw.$executeRawUnsafe('DELETE FROM "User"');
  for (const [名, id] of Object.entries(人)) await raw.user.create({ data: { id, email: `${id}@x.com`, name: 名, password: "x", role: 名 === "教练" ? "ADMIN" : "SALES", active: true } });
  await raw.entMember.createMany({ data: [{ userId: 人.老板, bizRole: "director" }, { userId: 人.甲, bizRole: "sales", line: "外贸" }, { userId: 人.管理员, bizRole: "admin" }, { userId: 人.教练, bizRole: "coach" }] });
  const 客户 = (await raw.customer.create({ data: { name: "甲的客户", phone: "13800001111", salesOwnerId: 人.甲, bizLine: "外贸" } })).id;
  项目 = (await raw.project.create({ data: { name: "甲的项目", customerId: 客户, ownerId: 人.甲, creatorId: 人.甲, bizLine: "外贸", phase: "线索", node: "线索验证" } })).id;
  await raw.setting.create({ data: { key: 规则.按组织看客户.key, value: "true" } });
  fs.rmSync(录音根(), { recursive: true, force: true });
  invalidateSettingsCache();
  忘掉企业版范围();
  清转写内存();
  resetAiQuota();
  钩.拼段前 = null;
  钩.切段坏 = false;
  delete process.env.ENT_PUBLIC_URL;
  process.env.ENT_ASR_FAKE = "1";
}
async function 设(key: string, v: unknown) {
  await raw.setting.upsert({ where: { key }, update: { value: JSON.stringify(v) }, create: { key, value: JSON.stringify(v) } });
  invalidateSettingsCache();
}
const 开关 = (开: boolean) => 设(录音点评开关键, 开);

const 请 = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init);
const 参 = <T extends object>(x: T) => ({ params: Promise.resolve(x) });
const 读 = async (r: Response) => ({ status: r.status, 体: (await r.json().catch(() => ({}))) as Record<string, unknown> });
const 交 = async (id: string) => 读(await 提交(请(`/api/coach-rec/${id}/submit`, { method: "POST" }), 参({ id })));
const 重交 = async (id: string) => 读(await 重试(请(`/api/coach-rec/${id}/retry`, { method: "POST" }), 参({ id })));
const 行 = (id: string) => raw.entCoachRecording.findUniqueOrThrow({ where: { id } });

/** 教练传好一条真录音（经接口：开始、一片、传完），回编号 */
async function 传好(数据: Buffer, 名 = "面谈.m4a"): Promise<string> {
  当("教练");
  const s = await 读(await 开始(请("/api/coach-rec/start", { method: "POST", body: JSON.stringify({ projectId: 项目, sourceKind: "上传", fileName: 名, bytes: 数据.length, mime: "audio/mp4" }) })));
  expect(s.status).toBe(200);
  const id = (s.体.录音 as { id: string }).id;
  expect((await 读(await 传片(请(`/api/coach-rec/${id}/chunk/1/0`, { method: "PUT", body: 数据 as unknown as BodyInit }), 参({ id, seg: "1", seq: "0" })))).status).toBe(200);
  expect((await 读(await 传完(请(`/api/coach-rec/${id}/finish`, { method: "POST" }), 参({ id })))).status).toBe(200);
  return id;
}
/** 直接在库里放一条（不要文件的那几组用） */
async function 放一条(x: Record<string, unknown>): Promise<string> {
  return (await raw.entCoachRecording.create({ data: { projectId: 项目, authorId: 人.教练, sourceKind: "上传", status: "待提交", ...x } })).id;
}

/** 记下交了什么、查了什么的通道；默认交上回 t1、t2…，查回两句成功 */
function 记通道(x: { 提交?: (i: 提交输入, 第: number) => Promise<string>; 查?: (号: string) => Promise<查询结果> } = {}) {
  const 交们: 提交输入[] = [];
  const 查们: string[] = [];
  const 通: 转写通道 = {
    名: "测", 引擎: (档) => `e_${档}`,
    提交: async (i) => { 交们.push(i); return x.提交 ? x.提交(i, 交们.length) : `t${交们.length}`; },
    查: async (号) => { 查们.push(号); return x.查 ? x.查(号) : { 状态: "成功", 时长毫秒: 2000, 句们: [{ 起: 0, 止: 1000, 说话人: 0, 文字: "甲说" }, { 起: 1000, 止: 2000, 说话人: 1, 文字: "乙说" }] }; },
  };
  return { 通, 交们, 查们 };
}

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  process.env.CRM_DATA_DIR = 临时.dir;
  delete process.env.DESKTOP_LOCAL;
  if (有ffmpeg) {
    const 生成 = (参: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...参], { maxBuffer: 64 * 1024 * 1024 });
    const 短 = path.join(临时.dir, "短.m4a");
    生成(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000:duration=3", "-ac", "1", "-c:a", "aac", "-b:a", "32k", "-f", "mp4", 短]);
    // 16k 单声道 wav 约 32KB/秒：130 秒约 4.2MB，规整后还是 wav、超过请求体上限，又在一片 5MB 以内
    const 长 = path.join(临时.dir, "长.wav");
    生成(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000:duration=130", "-ac", "1", "-c:a", "pcm_s16le", 长]);
    音.短 = fs.readFileSync(短);
    音.长 = fs.readFileSync(长);
    expect(音.长.length).toBeGreaterThan(请求体上限字节);
  }
}, 60_000);
beforeEach(async () => { await 建(); });
afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  delete process.env.CRM_DATA_DIR;
  delete process.env.ENT_ASR_FAKE;
  delete process.env.ENT_PUBLIC_URL;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

describe("开关、能不能用", () => {
  it("开关关着：转写钟什么都不做；提交整理 404", async () => {
    const id = await 放一条({ status: "转写中", asrTaskId: JSON.stringify([{ t: "t1", 起: 0 }]), asrSubmittedAt: new Date(Date.now() - 60_000) });
    const c = 记通道();
    expect(await 转写一轮({ 通道: c.通 })).toEqual({ 交: 0, 查: 0 });
    expect(c.查们).toEqual([]);
    expect((await 行(id)).status).toBe("转写中");
    当("教练");
    expect((await 交(id)).status).toBe(404);
  });

  it("没配密钥：客户页 可录 = false、提交整理 409（没配好）；草稿照样给", async () => {
    delete process.env.ENT_ASR_FAKE;
    await 开关(true);
    const id = await 放一条({ status: "待提交" });
    const 数据 = await 读项目主题({ id: 人.教练, role: "ADMIN" }, 项目);
    expect(数据?.录音?.可录).toBe(false);
    expect(数据?.录音?.草稿们.map((x) => x.id)).toEqual([id]);
    当("教练");
    const r = await 交(id);
    expect(r.status).toBe(409);
    expect(r.体.error).toContain("没配好");
    expect((await 行(id)).status).toBe("待提交");
  });

  it.skipIf(!有ffmpeg)("配好了（假通道 + ffmpeg）：可录 = true；别人的录音 404；上传中的 409", async () => {
    await 开关(true);
    清自检缓存();
    expect((await 读项目主题({ id: 人.教练, role: "ADMIN" }, 项目))?.录音?.可录).toBe(true);
    const id = await 放一条({ status: "待提交" });
    当("老板");
    expect((await 交(id)).status).toBe(404);
    const 没完 = await 放一条({ status: "上传中" });
    当("教练");
    expect((await 交(没完)).status).toBe(409);
  });
});

describe.skipIf(!有ffmpeg)("全链路（假通道）", () => {
  beforeEach(() => 开关(true));
  it("提交整理 → 规整、交（请求体）→ 10 秒后查 → 整理中；记用量（按秒）；草稿条上留着", async () => {
    const id = await 传好(音.短!);
    expect((await 行(id)).status).toBe("待提交");
    const r = await 交(id);
    expect(r.status).toBe(200);
    expect((r.体.录音 as { status: string }).status).toBe("转写中");
    expect((await 交(id)).status).toBe(200); // 连点：当成功
    const t0 = Date.now();
    expect(await 转写一轮({ 现在: t0 })).toEqual({ 交: 1, 查: 0 });
    let x = await 行(id);
    expect(x.status).toBe("转写中");
    expect(x.audioPath).toMatch(/asr\.m4a$/);
    expect(x.format).toBe("m4a");
    expect(Math.abs((x.durationMs ?? 0) - 3000)).toBeLessThan(200);
    expect(x.sampleRate).toBe(16000);
    expect(x.engine).toBe("假通道·fake_16k");
    expect(读任务们(x.asrTaskId)).toEqual([{ t: expect.stringMatching(/^fake-\d+-body$/), 起: 0 }]);
    expect(await 转写一轮({ 现在: t0 + 5_000 })).toEqual({ 交: 0, 查: 1 });
    expect((await 行(id)).status).toBe("转写中"); // 还没到 10 秒，没真查
    await 转写一轮({ 现在: t0 + 10_000 }); // 假通道第一次查回「转写中」
    expect((await 行(id)).status).toBe("转写中");
    await 转写一轮({ 现在: t0 + 20_000 });
    x = await 行(id);
    expect(x.status).toBe("整理中");
    expect(x.transcript).toBe("(00:00) 说话人 1：（假通道）这次拜访客户主要聊了报价。\n(00:03) 说话人 2：（假通道）报价单下周一前发过去，先确认数量。");
    expect(x.speakers).toBe(2);
    expect(JSON.parse(x.segments!)).toHaveLength(2);
    const 用 = await raw.auditLog.findMany({ where: { action: "ai_use", entityId: "asr" } });
    expect(用).toHaveLength(1);
    expect(JSON.parse(用[0].detail!)).toEqual({ 对象: id, 秒: 3 });
    // 本月用量（操作日志按人限定是原有口径，这里只核按秒合计）
    expect((await 看全部(() => aiUsageThisMonth())).find((u) => u.feature === "asr")).toMatchObject({ label: "录音转写", count: 1, 秒: 3 });
    expect((await 读项目主题({ id: 人.教练, role: "ADMIN" }, 项目))?.录音?.草稿们.map((d) => d.status)).toEqual(["整理中"]);
    // 原始段还在（规整失败可以从头再来）
    expect(fs.readdirSync(path.dirname(path.join(录音根(), x.audioPath!))).sort()).toEqual(["asr.m4a", expect.stringMatching(/^seg-01\.(m4a|mp4)$/)]);
  });

  it("大文件：签名地址（取文件路由给规整后的文件）；设成切段 → 每段 ≤ 上限、起点按时间接；没配地址的签名地址也退到切段", async () => {
    process.env.ENT_PUBLIC_URL = "https://crm.example.test/";
    const a = await 传好(音.长!, "长.wav");
    当("教练");
    await 交(a);
    const c1 = 记通道();
    await 转写一轮({ 通道: c1.通 });
    expect(c1.交们).toHaveLength(1);
    const 址 = c1.交们[0].音频;
    expect(址.方式).toBe("地址");
    const url = 址.方式 === "地址" ? 址.url : "";
    expect(url.startsWith(`https://crm.example.test/api/coach-rec/fetch/${a}?exp=`)).toBe(true);
    const 回 = await 取文件(请(url.replace("https://crm.example.test", "")), 参({ id: a }));
    expect(回.status).toBe(200);
    expect(回.headers.get("content-type")).toBe("audio/wav");
    expect(Number(回.headers.get("content-length"))).toBe(fs.statSync(path.join(录音根(), (await 行(a)).audioPath!)).size);

    await 设(大文件交法键, "切段");
    const b = await 传好(音.长!, "长2.wav");
    当("教练");
    await 交(b);
    const c2 = 记通道({ 查: async (号) => ({ 状态: "成功", 时长毫秒: 1000, 句们: [{ 起: 0, 止: 1000, 说话人: 0, 文字: `段${号}` }] }) });
    const t0 = Date.now();
    await 转写一轮({ 通道: c2.通, 现在: t0 });
    expect(c2.交们.length).toBeGreaterThanOrEqual(2);
    for (const i of c2.交们) {
      expect(i.音频.方式).toBe("请求体");
      expect(i.音频.方式 === "请求体" && i.音频.数据.length).toBeLessThanOrEqual(请求体上限字节);
    }
    const 任们 = 读任务们((await 行(b)).asrTaskId);
    expect(任们[0].起).toBe(0);
    for (let i = 1; i < 任们.length; i++) expect(任们[i].起).toBeGreaterThan(任们[i - 1].起);
    expect(fs.readdirSync(path.dirname(path.join(录音根(), (await 行(b)).audioPath!))).filter((f) => f.startsWith("asr-part-"))).toEqual([]);
    await 转写一轮({ 通道: c2.通, 现在: t0 + 10_000 });
    const 段 = JSON.parse((await 行(b)).segments!) as { 起: number }[];
    expect(段.map((s) => s.起)).toEqual(任们.map((t) => t.起));

    delete process.env.ENT_PUBLIC_URL;
    await 设(大文件交法键, "签名地址");
    const c = await 传好(音.长!, "长3.wav");
    当("教练");
    await 交(c);
    const c3 = 记通道();
    await 转写一轮({ 通道: c3.通 });
    expect(c3.交们.length).toBeGreaterThanOrEqual(2);
    expect(c3.交们.every((i) => i.音频.方式 === "请求体")).toBe(true);
  });
});

describe.skipIf(!有ffmpeg)("交不上、重试", () => {
  beforeEach(() => 开关(true));
  it("可重试的：30 秒 / 2 分钟 / 10 分钟各再试一次，第 4 次还不行 → 整理失败 + 通知录的人；不可重试的当场失败", async () => {
    const id = await 传好(音.短!);
    await 交(id);
    const c = 记通道({ 提交: async () => { throw new 通道错("连不上腾讯云（网络断了或超时），稍后会自动再试", true, "网络"); } });
    const t0 = Date.now();
    await 转写一轮({ 通道: c.通, 现在: t0 });
    expect(c.交们).toHaveLength(1);
    await 转写一轮({ 通道: c.通, 现在: t0 + 29_000 });
    expect(c.交们).toHaveLength(1);
    await 转写一轮({ 通道: c.通, 现在: t0 + 30_000 });
    expect(c.交们).toHaveLength(2);
    await 转写一轮({ 通道: c.通, 现在: t0 + 30_000 + 119_000 });
    expect(c.交们).toHaveLength(2);
    await 转写一轮({ 通道: c.通, 现在: t0 + 150_000 });
    expect(c.交们).toHaveLength(3);
    await 转写一轮({ 通道: c.通, 现在: t0 + 750_000 });
    expect(c.交们).toHaveLength(4);
    const x = await 行(id);
    expect(x.status).toBe("整理失败");
    expect(x.error).toBe("连不上腾讯云（网络断了或超时）（自动重试了 3 次都没成）");
    const 通知 = await raw.entNotice.findMany({ where: { kind: "录音" } });
    expect(通知).toHaveLength(1);
    expect(通知[0].userId).toBe(人.教练);
    expect(通知[0].title).toContain("甲的项目");
    expect(通知[0].body).toContain("自动重试了 3 次");
    expect(通知[0].body).not.toContain("面谈");
    await 转写一轮({ 通道: c.通, 现在: t0 + 2_000_000 });
    expect(c.交们).toHaveLength(4);
    // 草稿条上写原因
    const 草 = (await 读项目主题({ id: 人.教练, role: "ADMIN" }, 项目))?.录音?.草稿们[0];
    expect(草).toMatchObject({ status: "整理失败", 错: x.error });

    const id2 = await 传好(音.短!, "二.m4a");
    await 交(id2);
    const d = 记通道({ 提交: async () => { throw new 通道错("腾讯云密钥不对", false, "AuthFailure"); } });
    await 转写一轮({ 通道: d.通 });
    expect(d.交们).toHaveLength(1);
    expect(await 行(id2)).toMatchObject({ status: "整理失败", error: "腾讯云密钥不对" });
  });

  it("切段交到一半交不上：交上的段先落任务号，重试、重启后只补交没交上的段（不重复计费）", async () => {
    await 设(大文件交法键, "切段");
    const id = await 传好(音.长!, "长.wav");
    当("教练");
    await 交(id);
    // 第 2 段起网络断：第 1 段的任务号已经落库，asrSubmittedAt 还空着（没交齐、不查）
    let 断 = true;
    const c = 记通道({ 提交: async (_i, 第) => { if (断 && 第 >= 2) throw new 通道错("连不上腾讯云（网络断了或超时），稍后会自动再试", true, "网络"); return `t${第}`; } });
    const t0 = Date.now();
    await 转写一轮({ 通道: c.通, 现在: t0 });
    expect(c.交们).toHaveLength(2);
    let x = await 行(id);
    expect(x.asrSubmittedAt).toBeNull();
    expect(读任务们(x.asrTaskId)).toEqual([{ t: "t1", 起: 0 }]);
    // 进程重启（内存清掉）后接着交：第 1 段不再交，后面各段交齐
    清转写内存();
    断 = false;
    await 转写一轮({ 通道: c.通, 现在: t0 + 1_000 });
    x = await 行(id);
    expect(x.asrSubmittedAt).not.toBeNull();
    const 任们 = 读任务们(x.asrTaskId);
    expect(任们.length).toBeGreaterThanOrEqual(2);
    expect(任们[0]).toEqual({ t: "t1", 起: 0 });
    expect(c.交们).toHaveLength(2 + 任们.length - 1); // 第一轮 2 次（1 成 1 断）+ 补交其余各段
    expect(c.交们.slice(2).every((i) => i.音频.方式 === "请求体")).toBe(true);
    for (let i = 1; i < 任们.length; i++) expect(任们[i].起).toBeGreaterThan(任们[i - 1].起);
    expect(fs.readdirSync(path.dirname(path.join(录音根(), x.audioPath!))).filter((f) => f.startsWith("asr-part-"))).toEqual([]);
  });

  it("临时文件：切段中途抛错 → 半截的 asr-part-* 删掉；重试时规整格式变了 → 旧的 asr.* 删掉", async () => {
    await 设(大文件交法键, "切段");
    const id = await 传好(音.长!, "长.wav");
    当("教练");
    await 交(id);
    钩.切段坏 = true;
    await 转写一轮({ 通道: 记通道().通 });
    const x = await 行(id);
    expect(x.status).toBe("整理失败");
    const 目录 = path.dirname(path.join(录音根(), x.audioPath!));
    expect(fs.readdirSync(目录).filter((f) => f.startsWith("asr-part-"))).toEqual([]);
    // 上次规整留下另一种格式（比如 copy 成 ogg）：这次规整成 wav 以后旧的删掉，只留一份
    钩.切段坏 = false;
    fs.writeFileSync(path.join(目录, "asr.ogg"), "旧的");
    当("教练");
    expect((await 重交(id)).status).toBe(200);
    await 转写一轮({ 通道: 记通道().通 });
    expect((await 行(id)).asrSubmittedAt).not.toBeNull();
    expect(fs.readdirSync(目录).filter((f) => f.startsWith("asr")).sort()).toEqual(["asr.wav"]);
  });

  it("重试整理：只认整理失败、只有录的人；回转写中、清掉任务号；占 AI 限频，满了 429", async () => {
    const id = await 放一条({ status: "整理失败", error: "x", asrTaskId: "[]", asrSubmittedAt: new Date() });
    当("老板");
    expect((await 重交(id)).status).toBe(404);
    当("教练");
    const r = await 重交(id);
    expect(r.status).toBe(200);
    expect(await 行(id)).toMatchObject({ status: "转写中", error: null, asrTaskId: null, asrSubmittedAt: null });
    expect(await raw.auditLog.count({ where: { entityId: id, summary: { contains: "重试整理" } } })).toBe(1);
    const 待 = await 放一条({ status: "待提交" });
    expect((await 重交(待)).status).toBe(409);
    const 又 = await 放一条({ status: "整理失败" });
    for (let i = 0; i < AI_LIMIT; i++) consumeAiQuota(人.教练);
    expect((await 重交(又)).status).toBe(429);
    expect((await 行(又)).status).toBe("整理失败");
  });
});

describe("轮询、重启（不要文件）", () => {
  beforeEach(() => 开关(true));
  it("重启后交上了的接着查、不重交；超 3 小时判失败；腾讯云回失败判失败；网断了下一轮再查", async () => {
    const 现在 = Date.now();
    const 任 = (t: string) => JSON.stringify([{ t, 起: 0 }]);
    const 好 = await 放一条({ status: "转写中", asrTaskId: 任("ok"), asrSubmittedAt: new Date(现在 - 60_000), durationMs: 2000 });
    const 老 = await 放一条({ status: "转写中", asrTaskId: 任("old"), asrSubmittedAt: new Date(现在 - 3 * 3600_000 - 1000) });
    const 败 = await 放一条({ status: "转写中", asrTaskId: 任("bad"), asrSubmittedAt: new Date(现在 - 60_000) });
    const 断 = await 放一条({ status: "转写中", asrTaskId: 任("down"), asrSubmittedAt: new Date(现在 - 60_000) });
    清转写内存();
    const c = 记通道({
      查: async (号) => {
        if (号 === "bad") return { 状态: "失败", 话: "腾讯云读不了这个录音（格式或内容有问题）" };
        if (号 === "down") throw new 通道错("连不上", true);
        return { 状态: "成功", 时长毫秒: 2000, 句们: [{ 起: 61_000, 止: 62_000, 说话人: null, 文字: "一句" }] };
      },
    });
    await 转写一轮({ 通道: c.通, 现在 });
    expect(c.交们).toEqual([]);
    expect(c.查们.sort()).toEqual(["bad", "down", "ok"]);
    expect(await 行(好)).toMatchObject({ status: "整理中", transcript: "(01:01) 一句", speakers: null });
    expect(await 行(老)).toMatchObject({ status: "整理失败", error: "转写超过 3 小时没出结果，可以点「重试整理」再交一次" });
    expect(await 行(败)).toMatchObject({ status: "整理失败", error: "腾讯云读不了这个录音（格式或内容有问题）" });
    expect((await 行(断)).status).toBe("转写中");
    expect(await raw.entNotice.count({ where: { kind: "录音", userId: 人.教练 } })).toBe(2);
  });

  it("轮询节奏：交后 2 分钟内 10 秒一次，之后 30 秒一次", async () => {
    const t0 = Date.now();
    await 放一条({ status: "转写中", asrTaskId: JSON.stringify([{ t: "x", 起: 0 }]), asrSubmittedAt: new Date(t0) });
    const c = 记通道({ 查: async () => ({ 状态: "转写中" }) });
    const 查到 = async (秒: number) => { const n = c.查们.length; await 转写一轮({ 通道: c.通, 现在: t0 + 秒 * 1000 }); return c.查们.length > n; };
    expect(await 查到(5)).toBe(false);
    expect(await 查到(10)).toBe(true);
    expect(await 查到(15)).toBe(false);
    expect(await 查到(20)).toBe(true);
    expect(await 查到(130)).toBe(true);
    expect(await 查到(150)).toBe(false);
    expect(await 查到(160)).toBe(true);
  });

  it("全文：分钟、小时；没分出说话人的不写", () => {
    expect(拼全文([{ 起: 3_725_000, 止: 0, 说话人: 2, 文字: "a" }, { 起: 5_000, 止: 0, 说话人: null, 文字: "b" }])).toBe("(1:02:05) 说话人 3：a\n(00:05) b");
  });
});

describe("设置「语音转文字」", () => {
  it("系统管理员能开关、改交法（进审计）；管理员 admin 读不了（403）；没配密钥开不了", async () => {
    const 概 = await 读转写设置(我("老板"));
    expect(概).toMatchObject({ 开: false, 能改: true, 密钥: "假通道", 交法: "签名地址", 配了地址: false, 上次测试: null });
    // 本月没转过：用量里不列「录音转写」（开关关着时设置页和现在一样）
    expect((await 看全部(() => aiUsageThisMonth())).some((u) => u.feature === "asr")).toBe(false);
    // 管理员 admin：前端进不了 AI 接入页签，服务端也只放系统管理员，回 403
    expect(await 读转写设置(我("管理员"))).toMatchObject({ ok: false, status: 403 });
    // 销售教练（也是只读角色）、销售：拿不到，回 403（PR4 审查）
    expect(await 读转写设置(我("教练"))).toMatchObject({ ok: false, status: 403 });
    expect(await 读转写设置(我("甲"))).toMatchObject({ ok: false, status: 403 });
    expect(await 设录音点评开关(我("管理员"), true)).toMatchObject({ ok: false });
    delete process.env.ENT_ASR_FAKE;
    const 没 = await 设录音点评开关(我("老板"), true);
    expect(没.ok === false && 没.error).toContain("没配腾讯云密钥");
    process.env.ENT_ASR_FAKE = "1";
    expect(await 设大文件交法(我("老板"), "乱写")).toMatchObject({ ok: false });
    expect(await 设大文件交法(我("老板"), "切段")).toMatchObject({ ok: true, 概况: { 交法: "切段" } });
    expect(await raw.auditLog.count({ where: { entityId: 大文件交法键 } })).toBe(1);
    if (!有ffmpeg) return;
    清自检缓存();
    expect(await 设录音点评开关(我("老板"), true)).toMatchObject({ ok: true, 概况: { 开: true } });
    expect(await raw.auditLog.findFirst({ where: { entityId: 录音点评开关键 } })).toMatchObject({ summary: "打开录音点评（语音转文字）" });
    expect(await 设录音点评开关(我("老板"), false)).toMatchObject({ ok: true, 概况: { 开: false } });
  });

  it.skipIf(!有ffmpeg)("测试连接：两条路都测（假通道）；没配地址的签名地址那条写为什么；样例测完删；结果存起来", async () => {
    process.env.ENT_PUBLIC_URL = "https://crm.example.test";
    清自检缓存();
    const r = await 测转写连接(我("老板"), { 间隔: 5 });
    expect(r.ok && r.结果.请求体.ok && r.结果.签名地址.ok).toBe(true);
    expect(fs.readdirSync(样例目录())).toEqual([]);
    delete process.env.ENT_PUBLIC_URL;
    const r2 = await 测转写连接(我("老板"), { 间隔: 5 });
    expect(r2.ok && r2.结果.签名地址).toEqual({ ok: false, 话: "服务器没配 ENT_PUBLIC_URL，签名地址这条测不了（大文件会自动切段提交）" });
    const 老 = await 读转写设置(我("老板"));
    expect(老 && "密钥" in 老 && 老.上次测试?.签名地址.ok).toBe(false);
    expect(await raw.setting.count({ where: { key: 上次测试键 } })).toBe(1);
    expect(await 测转写连接(我("管理员"))).toMatchObject({ ok: false });
  });

  it("样例音频：开关关着也能被取（先测通再开），30 分钟后不给；不是样例的编号开关关着不给", async () => {
    fs.mkdirSync(样例目录(), { recursive: true });
    const 号 = `${样例编号头}abcdefghij0123456`;
    const f = path.join(样例目录(), `${号}.m4a`);
    fs.writeFileSync(f, "x");
    expect(await 取给转写(号)).toMatchObject({ 文件: f, 类型: "audio/mp4", 大小: 1 });
    const 回 = await 取文件(请(签取文件地址(号)), 参({ id: 号 }));
    expect(回.status).toBe(200);
    const 早 = new Date(Date.now() - 31 * 60 * 1000);
    fs.utimesSync(f, 早, 早);
    expect(await 取给转写(号)).toBeNull();
    const 别的 = await 放一条({ status: "转写中" });
    expect(await 取给转写(别的)).toBeNull();
  });
});

describe.skipIf(!有ffmpeg)("密钥不进库、留痕、通知", () => {
  it("腾讯云回密钥不对：失败原因、留痕、通知里都搜不到密钥", async () => {
    await 开关(true);
    const 记号ID = "fake-leak-marker-id-zz";
    const 记号KEY = "fake-leak-marker-key-zz";
    const id = await 传好(音.短!);
    await 交(id);
    const 取 = (async () => new Response(JSON.stringify({ Response: { Error: { Code: "AuthFailure.SignatureFailure", Message: `signature mismatch for ${记号ID}` } } }), { status: 200 })) as unknown as typeof fetch;
    await 转写一轮({ 通道: 腾讯云通道({ id: 记号ID, key: 记号KEY }, {}, 取) });
    expect((await 行(id)).status).toBe("整理失败");
    const 全 = JSON.stringify([await raw.entCoachRecording.findMany(), await raw.auditLog.findMany(), await raw.entNotice.findMany(), await raw.setting.findMany()]);
    expect(全).not.toContain(记号ID);
    expect(全).not.toContain(记号KEY);
  });
});

describe("PR2 审查遗留的后端修", () => {
  beforeEach(() => 开关(true));
  it("传完占位被接手（别的进程已经拼完进了待提交）：原来那个请求不删目录、回现状", async () => {
    当("教练");
    const s = await 读(await 开始(请("/api/coach-rec/start", { method: "POST", body: JSON.stringify({ projectId: 项目, sourceKind: "上传", fileName: "a.m4a", bytes: 100, mime: "audio/mp4" }) })));
    const id = (s.体.录音 as { id: string }).id;
    const 头 = new Uint8Array(100);
    头.set([0, 0, 0, 0x20, ...Buffer.from("ftypM4A ")], 0);
    await 传片(请(`/api/coach-rec/${id}/chunk/1/0`, { method: "PUT", body: 头 as unknown as BodyInit }), 参({ id, seg: "1", seq: "0" }));
    钩.拼段前 = async () => {
      // 拼的时候占位过期、被「别的进程」接手拼完：库里已经是待提交、endedAt 换了
      await raw.entCoachRecording.update({ where: { id }, data: { status: "待提交", endedAt: new Date(Date.now() + 1000) } });
    };
    const r = await 读(await 传完(请(`/api/coach-rec/${id}/finish`, { method: "POST" }), 参({ id })));
    expect(r.status).toBe(200);
    expect((r.体.录音 as { status: string }).status).toBe("待提交");
    const x = await 行(id);
    expect(x.audioPurgedAt).toBeNull();
    expect(fs.existsSync(path.join(录音根(), x.createdAt.toISOString().slice(0, 7).replace("-", ""), id, "seg-01.m4a"))).toBe(true);
  });

  it("拼的时候被放弃了：照样删文件，记 audioPurgedAt；放弃也记 audioPurgedAt", async () => {
    当("教练");
    const 开一条 = async () => ((await 读(await 开始(请("/api/coach-rec/start", { method: "POST", body: JSON.stringify({ projectId: 项目, sourceKind: "上传", fileName: "a.m4a", bytes: 100, mime: "audio/mp4" }) })))).体.录音 as { id: string }).id;
    const 头 = new Uint8Array(100);
    头.set([0, 0, 0, 0x20, ...Buffer.from("ftypM4A ")], 0);
    const id = await 开一条();
    await 传片(请(`/api/coach-rec/${id}/chunk/1/0`, { method: "PUT", body: 头 as unknown as BodyInit }), 参({ id, seg: "1", seq: "0" }));
    钩.拼段前 = async () => { await raw.entCoachRecording.update({ where: { id }, data: { status: "已放弃", deletedAt: new Date() } }); };
    expect((await 读(await 传完(请(`/api/coach-rec/${id}/finish`, { method: "POST" }), 参({ id })))).status).toBe(409);
    const x = await 行(id);
    expect(x.audioPurgedAt).not.toBeNull();
    expect(fs.existsSync(path.join(录音根(), x.createdAt.toISOString().slice(0, 7).replace("-", ""), id))).toBe(false);
    钩.拼段前 = null;
    const id2 = await 开一条();
    await 传片(请(`/api/coach-rec/${id2}/chunk/1/0`, { method: "PUT", body: 头 as unknown as BodyInit }), 参({ id: id2, seg: "1", seq: "0" }));
    expect((await 读(await 放弃(请(`/api/coach-rec/${id2}/abandon`, { method: "POST" }), 参({ id: id2 })))).status).toBe(200);
    expect((await 行(id2)).audioPurgedAt).not.toBeNull();
  });

  it("收一片总时长到点就停：每 10 毫秒滴一个字节也不能一直占着（不留临时文件）", async () => {
    const dir = path.join(录音根(), "总时长");
    let n = 0;
    const 体 = new ReadableStream<Uint8Array>({
      async pull(c) {
        await new Promise((r) => setTimeout(r, 10));
        n += 1;
        c.enqueue(new Uint8Array([1]));
      },
    });
    await expect(写片(dir, 1, 0, 体, 1024 * 1024, 1000, 120)).rejects.toBeInstanceOf(片读超时);
    expect(n).toBeGreaterThan(3);
    expect(fs.readdirSync(path.join(dir, "seg-01"))).toEqual([]);
  });
});

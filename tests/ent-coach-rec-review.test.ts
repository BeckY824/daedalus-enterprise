/**
 * 录音点评 PR5（11-22）：AI 整理（coach-rec-summary.ts、coach-rec-jobs.ts 整理一轮）、确认发出 / 稍后再发 / 重新整理、沟通卡上的录音点评。
 *   - 整理：整理中 → 待确认（主题、要点）+「整理好了」通知（链接带 crec）+ 用量 coachSum；不到 50 字不调模型、提示没听清；模型出错 → 整理失败、转写留着
 *   - 三段 / 四段：多人且整段交的才要「对方的回应」，切段的不要
 *   - 重试整理：转写在的只再整理（不再转写）；待确认也能按转写重新整理；没转写的照旧从头转写
 *   - 稍后再发存草稿；发出 = 发主题同一套（节点、通知负责人），录音 → 已发出 + topicId；别人的、发过的、空主题都不行
 *   - 沟通卡：录音点评带时长、负责人能听原声、别人不能；转写、正文给销售教练时号码打码（录的人自己是教练也照打），负责人看原文；开关关了不给
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-ent-coach-review-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir };
});
const 登录 = vi.hoisted(() => ({ user: null as Record<string, unknown> | null }));
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
const 模型回 = vi.hoisted(() => ({ 值: null as unknown, 抛: null as Error | null }));
vi.mock("@/lib/llm", async (原) => ({ ...(await 原<object>()), chatJSON: async () => { if (模型回.抛) throw 模型回.抛; return 模型回.值; } }));

import { defaultClient as raw, prisma } from "@/lib/prisma";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { invalidateSettingsCache } from "@/lib/settings";
import { resetAiQuota } from "@/lib/ai-quota";
import { 录音点评开关键 } from "@/lib/enterprise/coach-rec-db";
import { 读项目主题, 复盘主题of } from "@/lib/enterprise/coach-topic-db";
import { 录音根 } from "@/lib/enterprise/coach-rec-store";
import { 整理一轮, 清转写内存, 整理写失败等毫秒 } from "@/lib/enterprise/coach-rec-jobs";
import { 正文字数, 认整理结果, 整理提示词, 要第四段, 没听清话, AI整理, 回的不对话, 回的不对错 } from "@/lib/enterprise/coach-rec-summary";
import { 打码还原 } from "@/lib/enterprise/notice-mask";
import { 清自检缓存 } from "@/lib/enterprise/asr/ffmpeg";
import { POST as 重试 } from "@/app/api/coach-rec/[id]/retry/route";
import { POST as 发 } from "@/app/api/coach-rec/[id]/send/route";
import { POST as 存稿 } from "@/app/api/coach-rec/[id]/draft/route";

const 有ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const 人 = { 老板: "crr_boss", 甲: "crr_a", 管理员: "crr_adm", 教练: "crr_coach" } as const;
type 谁 = keyof typeof 人;
const 角色 = (r: 谁) => (r === "教练" ? "ADMIN" : "SALES");
const 当 = (r: 谁) => { 登录.user = { id: 人[r], name: r, email: `${人[r]}@x.com`, role: 角色(r), title: "", avatar: null }; 忘掉企业版范围(); };
const 我 = (r: 谁) => ({ id: 人[r], role: 角色(r) });
let 项目: string;

const 号码转写 = "(00:00) 说话人 1：这个客户的电话是 13812345678，下周二前回访一次，报价单 2026-11-30 前发过去，先确认数量和交期，再约面谈。\n(00:12) 说话人 2：好的，我周一先打电话确认数量，周二把报价单发出去，有问题再找你。";

async function 建() {
  for (const t of ["EntCoachRecording", "EntCoachReply", "EntCoachTopic", "EntNotice", "AuditLog", "ProjectMember", "Project", "Setting", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`).catch(() => {});
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["FollowUpProject", "FollowUp", "Contact", "Lead", "CustomerPool", "CustomerClaim", "CustomerCreator", "Task", "FollowPlan"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`).catch(() => {});
  await raw.$executeRawUnsafe('DELETE FROM "Customer"');
  await raw.$executeRawUnsafe('DELETE FROM "Channel"');
  await raw.$executeRawUnsafe('DELETE FROM "User"');
  for (const [名, id] of Object.entries(人)) await raw.user.create({ data: { id, email: `${id}@x.com`, name: 名, password: "x", role: 角色(名 as 谁), active: true } });
  await raw.entMember.createMany({ data: [{ userId: 人.老板, bizRole: "director" }, { userId: 人.甲, bizRole: "sales", line: "外贸" }, { userId: 人.管理员, bizRole: "admin" }, { userId: 人.教练, bizRole: "coach" }] });
  const 客户 = (await raw.customer.create({ data: { name: "甲的客户", phone: "13800001111", salesOwnerId: 人.甲, bizLine: "外贸" } })).id;
  项目 = (await raw.project.create({ data: { name: "甲的项目", customerId: 客户, ownerId: 人.甲, creatorId: 人.甲, bizLine: "外贸", phase: "线索", node: "线索验证" } })).id;
  await raw.setting.create({ data: { key: 规则.按组织看客户.key, value: "true" } });
  fs.rmSync(录音根(), { recursive: true, force: true });
  invalidateSettingsCache();
  忘掉企业版范围();
  清转写内存();
  清自检缓存();
  resetAiQuota();
  process.env.ENT_ASR_FAKE = "1";
}
async function 开关(开: boolean) {
  await raw.setting.upsert({ where: { key: 录音点评开关键 }, update: { value: JSON.stringify(开) }, create: { key: 录音点评开关键, value: JSON.stringify(开) } });
  invalidateSettingsCache();
}
const 请 = (url: string, body?: unknown) => new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
const 参 = (id: string) => ({ params: Promise.resolve({ id }) });
const 读 = async (r: Response) => ({ status: r.status, 体: (await r.json().catch(() => ({}))) as Record<string, unknown> });
const 行 = (id: string) => raw.entCoachRecording.findUniqueOrThrow({ where: { id } });
async function 放一条(x: Record<string, unknown> = {}): Promise<string> {
  return (await raw.entCoachRecording.create({ data: { projectId: 项目, authorId: 人.教练, sourceKind: "上传", status: "整理中", transcript: 号码转写, speakers: 2, durationMs: 22_000, format: "m4a", audioPath: "x/asr.m4a", ...x } })).id;
}
const 假整理 = (x: { 主题?: string; 要点?: string; 抛?: Error } = {}) => vi.fn(async () => {
  if (x.抛) throw x.抛;
  return { 可总结: true as const, 主题: x.主题 ?? "报价单下周二前发出", 要点: x.要点 ?? "【下一步建议】\n· 周一电话确认数量，周二发报价单", 调了: true };
});

beforeAll(() => {
  process.env.CRM_ENTERPRISE = "1";
  process.env.CRM_DATA_DIR = 临时.dir;
  delete process.env.DESKTOP_LOCAL;
});
beforeEach(async () => { await 建(); });
afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  delete process.env.CRM_DATA_DIR;
  delete process.env.ENT_ASR_FAKE;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

describe("整理的提示词和结果", () => {
  it("正文字数去掉时间和说话人；不到 50 字不调模型、回不可总结", async () => {
    expect(正文字数("(00:01) 说话人 1：你好。\n(1:02:03) 说话人 2：嗯")).toBe(3);
    expect(await AI整理("(00:01) 说话人 1：嗯嗯，好的。", 1, false)).toEqual({ 可总结: false, 调了: false });
  });
  it("模型回了但认不出（不是 JSON、缺主题要点）抛 回的不对错（算调过模型）；超时这类照原样抛（PR5 审查）", async () => {
    const { JSON格式不对 } = await import("@/lib/llm");
    const 长 = `(00:01) 说话人 1：${"这次拜访客户主要聊了报价和交期，".repeat(6)}`;
    模型回.抛 = null;
    模型回.值 = { 主题: "缺要点" };
    await expect(AI整理(长, 1, false)).rejects.toBeInstanceOf(回的不对错);
    模型回.抛 = new Error(JSON格式不对);
    await expect(AI整理(长, 1, false)).rejects.toBeInstanceOf(回的不对错);
    模型回.抛 = new Error("AI 响应超时，请稍后重试");
    const e = await AI整理(长, 1, false).catch((x) => x);
    expect(e).not.toBeInstanceOf(回的不对错);
    expect(e.message).toBe("AI 响应超时，请稍后重试");
    模型回.抛 = null;
  });
  it("四段只在多人、整段交时要；结果按段拼、空段不写、主题截 40 字", () => {
    expect(要第四段(2, false)).toBe(true);
    expect(要第四段(2, true)).toBe(false);
    expect(要第四段(1, false)).toBe(false);
    expect(整理提示词("x", true)).toContain("另写「对方的回应」");
    expect(整理提示词("x", false)).toContain("不写「对方的回应」");
    const r = 认整理结果({ 可总结: true, 主题: "很".repeat(60), 做得好的: ["开场清楚"], 要改进的: [], 下一步建议: ["周二发报价"], 对方的回应: ["答应周一确认"] }, false);
    expect(r).toEqual({ 可总结: true, 主题: "很".repeat(40), 要点: "【做得好的】\n· 开场清楚\n【下一步建议】\n· 周二发报价" });
    const 四 = 认整理结果({ 可总结: true, 主题: "a", 做得好的: ["x"], 对方的回应: ["答应周一确认", 3] }, true);
    expect(四.可总结 && 四.要点).toBe("【做得好的】\n· x\n【对方的回应 / 达成的共识】\n· 答应周一确认");
    expect(认整理结果({ 可总结: false }, false)).toEqual({ 可总结: false });
    // 只有模型明说 可总结: false 才算没听清；认不出的（缺要点、不是对象）= 整理失败（PR5 审查）
    expect(() => 认整理结果({ 可总结: true, 主题: "a" }, false)).toThrow(回的不对话);
    expect(() => 认整理结果("坏", false)).toThrow(回的不对话);
    expect(() => 认整理结果(null, false)).toThrow(回的不对话);
    expect(() => 认整理结果([1], false)).toThrow(回的不对话);
  });
});

describe("整理一轮", () => {
  beforeEach(() => 开关(true));
  it("整理中 → 待确认（主题、要点）+「整理好了」通知（带 crec）+ 用量；开关关着不动", async () => {
    const id = await 放一条();
    await 开关(false);
    const f = 假整理();
    expect(await 整理一轮({ 整理: f })).toBe(0);
    expect(f).not.toHaveBeenCalled();
    await 开关(true);
    expect(await 整理一轮({ 整理: f })).toBe(1);
    expect(f).toHaveBeenCalledWith(号码转写, 2, false);
    expect(await 行(id)).toMatchObject({ status: "待确认", draftTitle: "报价单下周二前发出", draftBody: "【下一步建议】\n· 周一电话确认数量，周二发报价单", error: null });
    const 通知 = await raw.entNotice.findMany({ where: { kind: "录音" } });
    expect(通知).toHaveLength(1);
    expect(通知[0]).toMatchObject({ userId: 人.教练, link: `/projects/${项目}?crec=${id}` });
    expect(通知[0].title).toContain("整理好了");
    expect(`${通知[0].title}${通知[0].body}`).not.toContain("13812345678");
    expect(await raw.auditLog.count({ where: { action: "ai_use", entityId: "coachSum", userId: 人.教练 } })).toBe(1);
    expect(await 整理一轮({ 整理: f })).toBe(0);
  });

  it("切段交的（任务号多于一个）不要第四段；不到 50 字的不调模型：待确认、草稿空、提示没听清、不记用量", async () => {
    const id = await 放一条({ asrTaskId: JSON.stringify([{ t: "a", 起: 0 }, { t: "b", 起: 60_000 }]) });
    const f = 假整理();
    await 整理一轮({ 整理: f });
    expect(f).toHaveBeenCalledWith(号码转写, 2, true);
    expect((await 行(id)).status).toBe("待确认");
    const 短 = await 放一条({ transcript: "(00:00) 说话人 1：嗯，好。" });
    await 整理一轮();
    expect(await 行(短)).toMatchObject({ status: "待确认", draftTitle: null, draftBody: null, error: 没听清话 });
    expect(await raw.auditLog.count({ where: { action: "ai_use", entityId: "coachSum" } })).toBe(1);
  });

  it("模型出错 → 整理失败（转写留着、写白话、通知）", async () => {
    const id = await 放一条();
    await 整理一轮({ 整理: 假整理({ 抛: new Error("AI 响应超时，请稍后重试") }) });
    const x = await 行(id);
    expect(x.status).toBe("整理失败");
    expect(x.transcript).toBe(号码转写);
    expect(x.error).toContain("AI 没整理成（AI 响应超时）");
    expect(x.error).toContain("自己写主题和要点");
    expect(await raw.entNotice.count({ where: { kind: "录音", userId: 人.教练 } })).toBe(1);
    // 模型原话不是中文的不照搬
    const id2 = await 放一条();
    await 整理一轮({ 整理: 假整理({ 抛: new Error("socket hang up") }) });
    expect((await 行(id2)).error).toContain("AI 没整理成（AI 没回话）");
    // 模型回的认不出：整理失败，不说没听清；调过模型，照记用量（PR5 审查）；超时这类没回话的不记
    expect(await raw.auditLog.count({ where: { action: "ai_use", entityId: "coachSum" } })).toBe(0);
    const id3 = await 放一条();
    await 整理一轮({ 整理: 假整理({ 抛: new 回的不对错() }) });
    expect(await 行(id3)).toMatchObject({ status: "整理失败", draftTitle: null });
    expect((await 行(id3)).error).toContain("AI 回的内容格式不对");
    expect((await 行(id3)).error).not.toBe(没听清话);
    expect(await raw.auditLog.findMany({ where: { action: "ai_use", entityId: "coachSum" }, select: { detail: true } })).toEqual([{ detail: JSON.stringify({ 对象: id3 }) }]);
  });

  it("写结果出错：算一次失败（整理失败），不留在整理中每 5 秒再调模型；连失败也写不进的 10 分钟内不再拿出来", async () => {
    const id = await 放一条();
    const 模型 = 假整理();
    const 探 = vi.spyOn(prisma.entCoachRecording, "updateMany").mockRejectedValueOnce(new Error("database is locked"));
    await 整理一轮({ 整理: 模型 });
    探.mockRestore();
    expect(模型).toHaveBeenCalledTimes(1);
    expect(await 行(id)).toMatchObject({ status: "整理失败" });
    expect((await 行(id)).error).toContain("存的时候出错了");
    await 整理一轮({ 整理: 模型 });
    expect(模型).toHaveBeenCalledTimes(1);
    // 整理失败写进了：不进 10 分钟别碰名单，用户马上「重试整理」（回到整理中）下一轮就接着整理（PR5 审查）
    await raw.entCoachRecording.update({ where: { id }, data: { status: "整理中" } });
    await 整理一轮({ 整理: 模型 });
    expect(模型).toHaveBeenCalledTimes(2);
    expect((await 行(id)).status).toBe("待确认");
    // 连 整理失败 也写不进：留在整理中，10 分钟内不再调模型，过了再试
    const id2 = await 放一条();
    const 现在 = Date.now();
    const 探2 = vi.spyOn(prisma.entCoachRecording, "updateMany").mockRejectedValue(new Error("database is locked"));
    await 整理一轮({ 整理: 模型, 现在 });
    探2.mockRestore();
    expect(模型).toHaveBeenCalledTimes(3);
    expect((await 行(id2)).status).toBe("整理中");
    expect(await 整理一轮({ 整理: 模型, 现在: 现在 + 60_000 })).toBe(0);
    expect(模型).toHaveBeenCalledTimes(3);
    await 整理一轮({ 整理: 模型, 现在: 现在 + 整理写失败等毫秒 + 1 });
    expect(模型).toHaveBeenCalledTimes(4);
    expect((await 行(id2)).status).toBe("待确认");
  });
});

describe.skipIf(!有ffmpeg)("重试整理、按转写重新整理", () => {
  beforeEach(() => 开关(true));
  it("整理失败但转写在 → 整理中（不再转写）；待确认 → 整理中；没转写的整理失败 → 转写中", async () => {
    const a = await 放一条({ status: "整理失败", error: "AI 没整理成" });
    当("教练");
    expect((await 读(await 重试(请(`/api/coach-rec/${a}/retry`), 参(a)))).status).toBe(200);
    expect(await 行(a)).toMatchObject({ status: "整理中", transcript: 号码转写, error: null });
    const b = await 放一条({ status: "待确认", draftTitle: "旧", draftBody: "旧" });
    expect((await 读(await 重试(请(`/api/coach-rec/${b}/retry`), 参(b)))).status).toBe(200);
    expect((await 行(b)).status).toBe("整理中");
    const c = await 放一条({ status: "整理失败", transcript: null, error: "转写失败" });
    expect((await 读(await 重试(请(`/api/coach-rec/${c}/retry`), 参(c)))).status).toBe(200);
    expect(await 行(c)).toMatchObject({ status: "转写中", asrTaskId: null });
    // 别人的不行
    const d = await 放一条({ status: "待确认" });
    当("老板");
    expect((await 读(await 重试(请(`/api/coach-rec/${d}/retry`), 参(d)))).status).toBe(404);
  });
});

describe("稍后再发、发出", () => {
  beforeEach(() => 开关(true));
  it("稍后再发存草稿（空也行、超长 400）；发出 = 主题（节点、通知负责人）+ 录音已发出 + topicId；再发 409", async () => {
    const id = await 放一条({ status: "待确认", draftTitle: "AI 起草", draftBody: "AI 要点" });
    当("教练");
    expect((await 读(await 存稿(请(`/api/coach-rec/${id}/draft`, { title: "改过的主题", body: "" }), 参(id)))).status).toBe(200);
    expect(await 行(id)).toMatchObject({ draftTitle: "改过的主题", draftBody: null, status: "待确认" });
    expect((await 读(await 存稿(请(`/api/coach-rec/${id}/draft`, { title: "长".repeat(41) }), 参(id)))).status).toBe(400);
    expect((await 读(await 发(请(`/api/coach-rec/${id}/send`, { title: "改过的主题", body: "" }), 参(id)))).status).toBe(400);
    const r = await 读(await 发(请(`/api/coach-rec/${id}/send`, { title: "改过的主题", body: "【下一步建议】\n· 周二发报价单" }), 参(id)));
    expect(r.status).toBe(200);
    const t = await raw.entCoachTopic.findUniqueOrThrow({ where: { id: r.体.id as string } });
    expect(t).toMatchObject({ projectId: 项目, node: "线索验证", title: "改过的主题", authorId: 人.教练, status: "待回复" });
    expect(await 行(id)).toMatchObject({ status: "已发出", topicId: t.id, draftTitle: "改过的主题" });
    const 通知 = await raw.entNotice.findMany({ where: { userId: 人.甲 } });
    expect(通知).toHaveLength(1);
    expect(通知[0].body).not.toContain("周二发报价单");
    expect((await raw.auditLog.findFirst({ where: { entity: "EntCoachTopic", entityId: t.id } }))?.summary).toContain("录音点评");
    expect((await 读(await 发(请(`/api/coach-rec/${id}/send`, { title: "再来", body: "再来" }), 参(id)))).status).toBe(409);
    expect(await raw.entCoachTopic.count()).toBe(1);
  });

  it("别人的录音 404；整理中的 409；整理失败（没转写）也能自己写了发出；开关关着 404", async () => {
    const 别人 = await 放一条({ status: "待确认" });
    当("老板");
    expect((await 读(await 发(请(`/api/coach-rec/${别人}/send`, { title: "a", body: "b" }), 参(别人)))).status).toBe(404);
    当("教练");
    const 中 = await 放一条();
    expect((await 读(await 发(请(`/api/coach-rec/${中}/send`, { title: "a", body: "b" }), 参(中)))).status).toBe(409);
    const 败 = await 放一条({ status: "整理失败", transcript: null, error: "转写失败" });
    expect((await 读(await 发(请(`/api/coach-rec/${败}/send`, { title: "自己写的", body: "自己写的要点" }), 参(败)))).status).toBe(200);
    expect((await 行(败)).status).toBe("已发出");
    await 开关(false);
    expect((await 读(await 发(请(`/api/coach-rec/${别人}/send`, { title: "a", body: "b" }), 参(别人)))).status).toBe(404);
  });

  it("库里存原文（PR5 审查）：教练看到打码的草稿，没改号码就存回原号码；改过的照他写的存；负责人看到原号码", async () => {
    const id = await 放一条({ status: "待确认", draftTitle: "回访 13812345678", draftBody: "· 打 13812345678 确认数量" });
    当("教练");
    const 教 = (await 读项目主题(我("教练"), 项目))!.录音!.草稿们.find((d) => d.id === id)!;
    expect(教.确认?.主题).toBe("回访 138****5678");
    // 稍后再发：只改了别的字，号码段没动 → 库里还是原号码
    const 存 = await 读(await 存稿(请(`/api/coach-rec/${id}/draft`, { title: `${教.确认!.主题}（周二）`, body: `${教.确认!.要点}\n· 另一个号 13900001111` }), 参(id)));
    expect(存.status).toBe(200);
    expect(await 行(id)).toMatchObject({ draftTitle: "回访 13812345678（周二）", draftBody: "· 打 13812345678 确认数量\n· 另一个号 13900001111" });
    // 再打开还是打码的；发出：抄了转写里的号码（打码样子）也换回原号码
    const 再 = (await 读项目主题(我("教练"), 项目))!.录音!.草稿们.find((d) => d.id === id)!;
    expect(再.确认?.主题).toBe("回访 138****5678（周二）");
    const r = await 读(await 发(请(`/api/coach-rec/${id}/send`, { title: 再.确认!.主题, body: "· 打 138****5678 确认；改成 138****0000", 版本: 再.更新于 }), 参(id)));
    expect(r.status).toBe(200);
    const t = await raw.entCoachTopic.findUniqueOrThrow({ where: { id: r.体.id as string } });
    expect(t.title).toBe("回访 13812345678（周二）");
    expect(t.body).toBe("· 打 13812345678 确认；改成 138****0000");
    expect((await 行(id)).draftBody).toBe(t.body);
    const 负责人看 = (await 读项目主题(我("甲"), 项目))!.们[0];
    expect(负责人看.title).toBe("回访 13812345678（周二）");
    expect(负责人看.body).toContain("13812345678");
  });

  it("还原后变长超了上限（带分隔的号码）：存草稿、发出都回 400 和清楚的话，库不动（PR5 审查）", async () => {
    // 主题上限 40：带分隔的号码打码后短 2 个字，教练看到的正好 40，还原后 42
    const 原题 = `回访 139-1234-5678 ${"字".repeat(23)}`;
    const id = await 放一条({ status: "待确认", draftTitle: 原题, draftBody: "· 要点" });
    当("教练");
    const 教 = (await 读项目主题(我("教练"), 项目))!.录音!.草稿们.find((d) => d.id === id)!;
    expect(教.确认!.主题.length).toBeLessThanOrEqual(40);
    const 加 = `${教.确认!.主题}${"多".repeat(40 - 教.确认!.主题.length)}`;
    expect(加.length).toBe(40);
    const 存 = await 读(await 存稿(请(`/api/coach-rec/${id}/draft`, { title: 加, body: "· 要点" }), 参(id)));
    expect(存.status).toBe(400);
    expect(存.体.error).toMatch(/^主题里的号码换回原号码后有 4\d 字，超过 40 字，请删几个字再发$/);
    const 发出 = await 读(await 发(请(`/api/coach-rec/${id}/send`, { title: 加, body: "· 要点" }), 参(id)));
    expect(发出.status).toBe(400);
    expect(发出.体.error).toContain("换回原号码后");
    expect(await 行(id)).toMatchObject({ status: "待确认", draftTitle: 原题 });
    expect(await raw.entCoachTopic.count()).toBe(0);
  });

  it("确认框开着时这条在别处重新整理过、原号码没了：存草稿、发出都回 412「内容已在别处更新」，打码样子不落库；没变过的照存（3703 实操跟进）", async () => {
    const 转写没号 = "(00:00) 说话人 1：报价单下周二前发过去，数量周一电话确认。\n(00:05) 说话人 2：好的。";
    const id = await 放一条({ status: "待确认", transcript: 转写没号, draftTitle: "回访 13912345678", draftBody: "· 打 13912345678 确认数量" });
    当("教练");
    const 教 = (await 读项目主题(我("教练"), 项目))!.录音!.草稿们.find((d) => d.id === id)!;
    expect(教.确认?.主题).toBe("回访 139****5678");
    // 别处「按转写重新整理」：草稿换了、原号码没了（更新于跟着变）
    await new Promise((r) => setTimeout(r, 5));
    await raw.entCoachRecording.update({ where: { id }, data: { draftTitle: "报价单下周二前发出", draftBody: "· 周一电话确认数量" } });
    const 存 = await 读(await 存稿(请(`/api/coach-rec/${id}/draft`, { title: `${教.确认!.主题}（周二）`, body: 教.确认!.要点, 版本: 教.更新于 }), 参(id)));
    expect(存).toMatchObject({ status: 412, 体: { error: "内容已在别处更新，请重新打开" } });
    // 老页面没带版本也一样拦
    expect((await 读(await 存稿(请(`/api/coach-rec/${id}/draft`, { title: 教.确认!.主题, body: "· 改了" }), 参(id)))).status).toBe(412);
    const 发出 = await 读(await 发(请(`/api/coach-rec/${id}/send`, { title: 教.确认!.主题, body: 教.确认!.要点, 版本: 教.更新于 }), 参(id)));
    expect(发出.status).toBe(412);
    expect(await 行(id)).toMatchObject({ status: "待确认", draftTitle: "报价单下周二前发出", draftBody: "· 周一电话确认数量" });
    expect(await raw.entCoachTopic.count()).toBe(0);
    expect(JSON.stringify(await raw.entCoachRecording.findMany())).not.toContain("****");
    // 重新打开（新版本）：没有打码段的照常存
    const 新 = (await 读项目主题(我("教练"), 项目))!.录音!.草稿们.find((d) => d.id === id)!;
    const 再存 = await 读(await 存稿(请(`/api/coach-rec/${id}/draft`, { title: "新主题", body: 新.确认!.要点, 版本: 新.更新于 }), 参(id)));
    expect(再存.status).toBe(200);
    expect((await 行(id)).draftTitle).toBe("新主题");
  });

  it("打码还原：同一个打码样子对应几个原号码按顺序轮；对不上的不动；没有号码的原文不动", () => {
    expect(打码还原("a 138****5678 b 138****5678", ["13812345678 和 13811115678"])).toBe("a 13812345678 b 13811115678");
    expect(打码还原("139****0000", ["13812345678"])).toBe("139****0000");
    expect(打码还原("没号码", ["13812345678"])).toBe("没号码");
    expect(打码还原("138****5678", [null, "没号码"])).toBe("138****5678");
  });
});

describe("给人看的：确认框数据、沟通卡", () => {
  beforeEach(() => 开关(true));
  it("确认框的转写、草稿：销售教练（录的人自己）看到号码打码；总管理录的看原文", async () => {
    const id = await 放一条({ status: "待确认", draftTitle: "回访 13812345678", draftBody: "· 打 13812345678 确认" });
    const 教 = (await 读项目主题(我("教练"), 项目))?.录音?.草稿们.find((d) => d.id === id);
    expect(教?.确认?.转写).not.toContain("13812345678");
    expect(教?.确认?.转写).toContain("138****5678");
    expect(教?.确认?.转写).toContain("2026-11-30");
    expect(教?.确认?.主题).toBe("回访 138****5678");
    const 老 = await 放一条({ authorId: 人.老板, status: "待确认", draftTitle: "回访 13812345678" });
    const 老看 = (await 读项目主题(我("老板"), 项目))?.录音?.草稿们.find((d) => d.id === 老);
    expect(老看?.确认).toMatchObject({ 主题: "回访 13812345678", 转写: 号码转写 });
  });

  it("沟通卡：录音点评带时长；负责人能听、看原文；教练看打码；管理员 admin 听不了；开关关了不给", async () => {
    const id = await 放一条({ status: "待确认" });
    当("教练");
    const r = await 读(await 发(请(`/api/coach-rec/${id}/send`, { title: "回访客户", body: "· 打 13812345678 确认数量" }), 参(id)));
    expect(r.status).toBe(200);
    const 负责人看 = (await 读项目主题(我("甲"), 项目))!.们[0];
    expect(负责人看.录音).toEqual({ id, 时长毫秒: 22_000, 能听: true, 转写: 号码转写, 音频没了: false });
    expect(负责人看.body).toContain("13812345678");
    const 教练看 = (await 读项目主题(我("教练"), 项目))!.们[0];
    expect(教练看.录音?.能听).toBe(true);
    expect(教练看.录音?.转写).toContain("138****5678");
    expect(教练看.body).toBe("· 打 138****5678 确认数量");
    const 管理员看 = (await 读项目主题(我("管理员"), 项目))!.们[0];
    expect(管理员看.录音?.能听).toBe(false);
    expect(管理员看.录音?.转写).toBe(号码转写);
    await raw.entCoachRecording.update({ where: { id }, data: { audioPurgedAt: new Date() } });
    expect((await 读项目主题(我("甲"), 项目))!.们[0].录音).toMatchObject({ 能听: false, 音频没了: true });
    await 开关(false);
    const 关了 = (await 读项目主题(我("甲"), 项目))!.们[0];
    expect(关了.录音).toBeUndefined();
    expect(关了.title).toBe("回访客户");
  });

  it("录音主题的标题：教练看到号码打码（沟通卡、复盘列表）；负责人原样；写点评发的主题不动", async () => {
    const id = await 放一条({ status: "待确认" });
    当("教练");
    expect((await 读(await 发(请(`/api/coach-rec/${id}/send`, { title: "回访 13812345678", body: "· 确认数量" }), 参(id)))).status).toBe(200);
    await raw.entCoachTopic.create({ data: { projectId: 项目, node: "线索验证", title: "写点评 13900001111", body: "x", authorId: 人.教练 } });
    const 教 = (await 读项目主题(我("教练"), 项目))!.们;
    expect(教.map((t) => t.title).sort()).toEqual(["写点评 13900001111", "回访 138****5678"]);
    const 负 = (await 读项目主题(我("甲"), 项目))!.们;
    expect(负.map((t) => t.title).sort()).toEqual(["写点评 13900001111", "回访 13812345678"]);
    const 复盘教 = await 复盘主题of(我("教练"), undefined, { 范围: "mine" });
    expect(复盘教.行.map((x) => x.标题).sort()).toEqual(["写点评 13900001111", "回访 138****5678"]);
    const 复盘负 = await 复盘主题of(我("甲"), undefined, { 范围: "wait" });
    expect(复盘负.行.map((x) => x.标题).sort()).toEqual(["写点评 13900001111", "回访 13812345678"]);
  });
});

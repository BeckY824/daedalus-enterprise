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

import { defaultClient as raw } from "@/lib/prisma";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { invalidateSettingsCache } from "@/lib/settings";
import { resetAiQuota } from "@/lib/ai-quota";
import { 录音点评开关键 } from "@/lib/enterprise/coach-rec-db";
import { 读项目主题 } from "@/lib/enterprise/coach-topic-db";
import { 录音根 } from "@/lib/enterprise/coach-rec-store";
import { 整理一轮, 清转写内存 } from "@/lib/enterprise/coach-rec-jobs";
import { 正文字数, 认整理结果, 整理提示词, 要第四段, 没听清话, AI整理 } from "@/lib/enterprise/coach-rec-summary";
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
    expect(认整理结果({ 可总结: true, 主题: "a" }, false)).toEqual({ 可总结: false });
    expect(认整理结果("坏", false)).toEqual({ 可总结: false });
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
});

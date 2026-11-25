/**
 * 超时未跟进计时中的线索上记了一条无效沟通（E-259，reply-overdue.ts 超时短沟通提示 / 最近无效沟通of）：
 *   - 保存后那句提示不看三态开关：三态关着、负责人本人在计时中的线索上记了太短 / 占位 / 只有链接的沟通，保存动作回「超时短沟通」，
 *     前端那句（短沟通话of）说计时不会停；有效沟通、不在链上的（自留不计时、链已停、别人记的、超时转关着）不提示
 *   - 超时提醒（1 小时那条）、自动收回给原负责人那条的正文：负责人本人计时以后记过、但判无效的最近一条，补一句它为什么不算
 *     （引用先打码再截断；只有链接的不引原文）
 *   - 回收预警「记一条沟通」只出超时那句（超时短沟通话of），不出三态那句：旁边的回收倒计时看客户最近跟进时间，短沟通照样更新它
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "乙", email: "yi", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 自动分配不参与key } from "@/lib/enterprise/lead-assign";
import { 规则 } from "@/lib/enterprise/rules";
import { 等通知推完 } from "@/lib/enterprise/notify";
import {
  超时转扫一遍, 超时转生效key, 超时通知种类, 收回话, 超时短沟通提示, 最近无效沟通of, 无效沟通话, 无效沟通引用字数,
} from "@/lib/enterprise/reply-overdue";
import { 短沟通话of, 超时短沟通话of, 超时短沟通话, 短沟通话 } from "@/lib/enterprise/tri-state-quota";
import { 默认组织规则, 默认三态规则 } from "@/lib/project/org-rules";
import { saveFollowUp } from "@/app/(app)/customers/[id]/actions";
import { 记项目沟通Action } from "@/app/(app)/projects/actions";

const 京 = (s: string) => new Date(`${s.replace(" ", "T")}:00+08:00`);
type 人 = { id: string; name: string };
let 老板: 人, 甲: 人, 乙: 人, 丙: 人;
const 造人 = async (email: string, name: string): Promise<人> => {
  const u = await prisma.user.create({ data: { email, name, title: "", role: "SALES", password: "x" } });
  return { id: u.id, name: u.name };
};
let 序 = 0;
/** 老板建、分给 owner 的线索（按分配：分配记录那一刻起算）；owner = 建的人时不记分配（自留） */
async function 分来(owner: 人, 分于: Date, 建的人: 人 = 老板) {
  序++;
  const c = await prisma.customer.create({ data: { name: `虚构客户${序}`, phone: `1390000${String(序).padStart(4, "0")}`, salesOwnerId: owner.id } });
  const p = await prisma.project.create({ data: { name: `线索${序}`, customerId: c.id, ownerId: owner.id, creatorId: 建的人.id, phase: "线索", node: "潜客培育", bizLine: "内贸", createdAt: 分于 } });
  if (建的人.id !== owner.id) {
    await prisma.entLeadAssign.create({ data: { projectId: p.id, toUserId: owner.id, fromUserId: 建的人.id, byUserId: 建的人.id, month: "2026-11", counted: false, createdAt: 分于 } });
  }
  return { id: p.id, customerId: c.id };
}
/** 谁在这条项目上记一条沟通（直接写库，时刻可控） */
async function 记(projectId: string, ownerId: string, content: string, at: Date, type = "WECHAT") {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const f = await prisma.followUp.create({ data: { type, content, occurredAt: at, createdAt: at, title: "", status: "已完成", customerId: p.customerId, ownerId } });
  await prisma.followUpProject.create({ data: { followUpId: f.id, projectId, node: p.node } });
  return f.id;
}
const 超时通知 = (userId: string) => prisma.entNotice.findMany({ where: { userId, kind: 超时通知种类 }, orderBy: { createdAt: "asc" } });
const 分钟前 = (n: number) => new Date(Date.now() - n * 60_000);

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板");
  甲 = await 造人("jia", "销售甲");
  乙 = await 造人("yi", "销售乙");
  丙 = await 造人("bing", "销售丙");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 甲.id, bizRole: "sales", line: "内贸" },
      { userId: 乙.id, bizRole: "sales", line: "内贸" },
      { userId: 丙.id, bizRole: "sales", line: "内贸" },
    ],
  });
  await setSetting("business", { projectMode: true });
  await setSetting(规则.线索分配.key, true);
  await setSetting(自动分配不参与key, { [老板.id]: "禁止" });
  await setSetting(超时转生效key, 京("2026-01-01 00:00").toISOString());
  // 这一份测的是「照存 + 轻提示」：无意义沟通不能保存（F-052，默认开）关着。开着拦下的见 ent-f052-meaningless.test.ts
  await setSetting(规则.无意义沟通拦.key, false);
  invalidateSettingsCache();
  mocks.user = { ...mocks.user, id: 甲.id, name: 甲.name };
});
afterEach(async () => { await 等通知推完(); vi.unstubAllEnvs(); 忘掉企业版范围(); invalidateSettingsCache(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("E-259 保存后提示（不看三态开关）", () => {
  it("说法：四类原因各一句；超时那句和三态那句同时有时只出超时那句", () => {
    expect(超时短沟通话("太短")).toBe("已保存。这条不足 4 个字，不算有效沟通，超时未跟进的计时不会停；请补一条写清沟通内容的记录");
    expect(超时短沟通话("占位词")).toContain("只有「跟进」「已联系」这类占位词");
    expect(超时短沟通话("只有链接")).toContain("只有链接、没有文字");
    expect(超时短沟通话("空")).toContain("这条没有文字");
    expect(短沟通话of({ ok: true, 超时短沟通: "太短", 短沟通: "太短" })).toBe(超时短沟通话("太短"));
    expect(短沟通话of({ ok: true, 短沟通: "太短" })).toBe(短沟通话.太短);
    expect(短沟通话of({ ok: true, 超时短沟通: "别的" })).toBeNull();
    // 回收预警只取超时那句：只有三态那句时不出
    expect(超时短沟通话of({ ok: true, 超时短沟通: "太短", 短沟通: "太短" })).toBe(超时短沟通话("太短"));
    expect(超时短沟通话of({ ok: true, 短沟通: "太短" })).toBeNull();
    expect(超时短沟通话of({ ok: true, 超时短沟通: "别的" })).toBeNull();
    expect(超时短沟通话of(null)).toBeNull();
  });

  it("三态关着：分来 30 分钟、负责人本人在客户页记「加微信」→ 回超时短沟通（太短），提示说计时不会停；占位词、只有链接同样；有效沟通不提示", async () => {
    const a = await 分来(甲, 分钟前(30));
    const r = await saveFollowUp({ customerId: a.customerId, projectId: a.id, type: "WECHAT", title: "", content: "加微信", status: "已完成", occurredAt: new Date().toISOString() });
    expect(r).toMatchObject({ ok: true, 超时短沟通: "太短" });
    expect(r).not.toHaveProperty("短沟通");
    expect(短沟通话of(r)).toBe(超时短沟通话("太短"));
    const b = await 分来(甲, 分钟前(30));
    expect(await saveFollowUp({ customerId: b.customerId, projectId: b.id, type: "PHONE", title: "", content: "已联系", status: "已完成", occurredAt: new Date().toISOString() }))
      .toMatchObject({ ok: true, 超时短沟通: "占位词" });
    const c = await 分来(甲, 分钟前(30));
    expect(await saveFollowUp({ customerId: c.customerId, projectId: c.id, type: "OTHER", title: "", content: "https://pan.example.com/s/abc", status: "已完成", occurredAt: new Date().toISOString() }))
      .toMatchObject({ ok: true, 超时短沟通: "只有链接" });
    const d = await 分来(甲, 分钟前(30));
    const 好 = await saveFollowUp({ customerId: d.customerId, projectId: d.id, type: "PHONE", title: "", content: "电话聊了预算，下周报价", status: "已完成", occurredAt: new Date().toISOString() });
    expect(好.ok).toBe(true);
    expect(短沟通话of(好)).toBeNull();
  });

  it("项目页记沟通（记项目沟通Action，项目页 / 客户页选了项目 / 回收预警 / 首页 AI 项目卡都走它）同样回超时短沟通", async () => {
    const a = await 分来(甲, 分钟前(20));
    const r = await 记项目沟通Action(a.id, { type: "WECHAT", content: "加微信", occurredAt: new Date().toISOString(), 阶段: "线索", 下一步: "明天再打一次", 下一步时间: null });
    expect(r).toMatchObject({ ok: true, 超时短沟通: "太短" });
    expect(短沟通话of(r)).toBe(超时短沟通话("太短"));
  });

  it("已发提醒（overdueAt 有值）后：本人再记短沟通仍提示（计时没停、等着转走）；别人记的不提示", async () => {
    const 分于 = 分钟前(70);
    const a = await 分来(甲, 分于);
    await prisma.entReplyOverdue.create({ data: { projectId: a.id, anchorAt: 分于, holderId: 甲.id, since: 分于, overdueAt: 分钟前(10) } });
    expect(await 超时短沟通提示(await 记(a.id, 甲.id, "加微信", new Date()))).toBe("太短");
    expect(await 超时短沟通提示(await 记(a.id, 丙.id, "加微信", new Date()))).toBeNull();
  });

  it("待分配、公海里的（项目进公海 / 客户进公海）不提示", async () => {
    const 待 = await 分来(甲, 分钟前(30));
    await prisma.project.update({ where: { id: 待.id }, data: { awaitAssignAt: 分钟前(5) } });
    expect(await 超时短沟通提示(await 记(待.id, 甲.id, "加微信", new Date()))).toBeNull();
    const 项目公海 = await 分来(甲, 分钟前(30));
    await prisma.project.update({ where: { id: 项目公海.id }, data: { pooledAt: 分钟前(5) } });
    expect(await 超时短沟通提示(await 记(项目公海.id, 甲.id, "加微信", new Date()))).toBeNull();
    const 客户公海 = await 分来(甲, 分钟前(30));
    await prisma.customerPool.create({ data: { customerId: 客户公海.customerId } });
    expect(await 超时短沟通提示(await 记(客户公海.id, 甲.id, "加微信", new Date()))).toBeNull();
    // 对照：同样的线索不在待分配、公海 = 提示
    const 对照 = await 分来(甲, 分钟前(30));
    expect(await 超时短沟通提示(await 记(对照.id, 甲.id, "加微信", new Date()))).toBe("太短");
  });

  it("三态开着：链上的经 action 只回超时短沟通（不带三态那句）；不在链上的回三态那句，回收预警那行不出", async () => {
    await setSetting("orgRules", { ...默认组织规则, 三态: { ...默认三态规则, 开: true } });
    invalidateSettingsCache();
    const 钟 = (customerId: string) => prisma.entCustomerClock.create({ data: { customerId, state: "活跃", enteredDay: "2026-11-24" } });
    const 链上 = await 分来(甲, 分钟前(30));
    await 钟(链上.customerId);
    const r = await 记项目沟通Action(链上.id, { type: "WECHAT", content: "加微信", occurredAt: new Date().toISOString(), 阶段: "线索", 下一步: "明天再打一次", 下一步时间: null });
    expect(r).toMatchObject({ ok: true, 超时短沟通: "太短" });
    expect(r).not.toHaveProperty("短沟通");
    expect(超时短沟通话of(r)).toBe(超时短沟通话("太短"));
    const 链上2 = await 分来(甲, 分钟前(30));
    await 钟(链上2.customerId);
    const r2 = await saveFollowUp({ customerId: 链上2.customerId, projectId: 链上2.id, type: "WECHAT", title: "", content: "加微信", status: "已完成", occurredAt: new Date().toISOString() });
    expect(r2).toMatchObject({ ok: true, 超时短沟通: "太短" });
    expect(r2).not.toHaveProperty("短沟通");
    // 不在链上（链已停）：三态那句照旧，回收预警只取超时那句 = 不出
    const 停于 = 分钟前(40);
    const 停 = await 分来(甲, 停于);
    await 钟(停.customerId);
    await prisma.entReplyOverdue.create({ data: { projectId: 停.id, anchorAt: 停于, holderId: 甲.id, since: 停于, stoppedAt: 分钟前(10) } });
    const r3 = await 记项目沟通Action(停.id, { type: "WECHAT", content: "加微信", occurredAt: new Date().toISOString(), 阶段: "线索", 下一步: "明天再打一次", 下一步时间: null });
    expect(r3).toMatchObject({ ok: true, 短沟通: "太短" });
    expect(r3).not.toHaveProperty("超时短沟通");
    expect(短沟通话of(r3)).toBe(短沟通话.太短);
    expect(超时短沟通话of(r3)).toBeNull();
  });

  it("不在链上不提示：自留不计时的（非销售自建自留）、链已停的、负责人以前在这位客户上记过有效沟通的、别人记的、跟进任务、超时转关着", async () => {
    // 自留：老板（总管理）自己建给自己，不计时
    const 自 = await 分来(老板, 分钟前(30), 老板);
    expect(await 超时短沟通提示(await 记(自.id, 老板.id, "加微信", new Date()))).toBeNull();
    // 链已停（记过有效沟通停下、基准没变）
    const 停于 = 分钟前(40);
    const 停 = await 分来(甲, 停于);
    await prisma.entReplyOverdue.create({ data: { projectId: 停.id, anchorAt: 停于, holderId: 甲.id, since: 停于, stoppedAt: 分钟前(10) } });
    expect(await 超时短沟通提示(await 记(停.id, 甲.id, "加微信", new Date()))).toBeNull();
    // 负责人以前在这位客户上记过有效沟通（之前的跟进也算）：链下一遍就停，不吓人
    const 跟过 = await 分来(甲, 分钟前(30));
    await 记(跟过.id, 甲.id, "之前在展会上聊过需求", 分钟前(20));
    expect(await 超时短沟通提示(await 记(跟过.id, 甲.id, "加微信", new Date()))).toBeNull();
    // 别人（同事）在甲的线索上记的
    const 别 = await 分来(甲, 分钟前(30));
    expect(await 超时短沟通提示(await 记(别.id, 丙.id, "加微信", new Date()))).toBeNull();
    // 跟进任务 / 提醒不是沟通
    const 任务 = await 分来(甲, 分钟前(30));
    expect(await 超时短沟通提示(await 记(任务.id, 甲.id, "回电", new Date(), "TASK"))).toBeNull();
    // 对照：同样的线索、负责人本人记 = 提示
    const 对照 = await 分来(甲, 分钟前(30));
    expect(await 超时短沟通提示(await 记(对照.id, 甲.id, "加微信", new Date()))).toBe("太短");
    // 超时转关着：不提示
    await setSetting(规则.超时自动转.key, false);
    invalidateSettingsCache();
    const 关 = await 分来(甲, 分钟前(30));
    expect(await 超时短沟通提示(await 记(关.id, 甲.id, "加微信", new Date()))).toBeNull();
    // 坏参数、没有这条：null，不抛
    expect(await 超时短沟通提示("没有这条")).toBeNull();
    expect(await 超时短沟通提示({ bad: 1 } as unknown as string)).toBeNull();
  });
});

describe("E-259 超时提醒 / 收回通知正文带原因", () => {
  it("10:07 分来、10:36 本人记「加微信」→ 11:07 超时提醒补一句为什么不算；11:37 自动收回给原负责人那条同样补；接手人那条不带", async () => {
    const { id } = await 分来(甲, 京("2026-11-24 10:07"));
    await 记(id, 丙.id, "帮忙", 京("2026-11-24 10:20")); // 别人记的不引
    await 记(id, 甲.id, "加微信", 京("2026-11-24 10:36"));
    expect(await 超时转扫一遍(京("2026-11-24 11:07"))).toMatchObject({ 提醒: 1 });
    const 句 = "你 11-24 10:36 记的「加微信」不足 4 个字，不算有效沟通。";
    const 提 = await 超时通知(甲.id);
    expect(提).toHaveLength(1);
    expect(提[0].body).toContain(`还没记有效沟通。${句}需负责人本人记录有效沟通（写清沟通内容，中文至少 4 个字；「跟进」「已联系」这类不算）`);
    expect(await 超时转扫一遍(京("2026-11-24 11:37"))).toMatchObject({ 转出: 1 });
    const 收 = (await 超时通知(甲.id)).at(-1)!;
    expect(收.title).toContain(收回话);
    expect(收.body).toContain(`。${句.replace(/。$/u, "")}`);
    // 接手人从 11:37 起算：甲记的那条不是他的，他的提醒不引
    const 新 = (await prisma.project.findUniqueOrThrow({ where: { id } })).ownerId;
    expect(await 超时转扫一遍(京("2026-11-24 12:37"))).toMatchObject({ 提醒: 1 });
    expect((await 超时通知(新)).at(-1)!.body).not.toContain("不算有效沟通");
  });

  it("没记过无效沟通的照旧；取最近一条；占位词、只有链接、没有文字各自的说法；超长截断到 20 字", async () => {
    const 没 = await 分来(甲, 京("2026-11-24 10:00"));
    const 多 = await 分来(乙, 京("2026-11-24 10:00"));
    await 记(多.id, 乙.id, "加微信", 京("2026-11-24 10:10"));
    await 记(多.id, 乙.id, "已联系已联系已联系已联系已联系已联系已联系已联系", 京("2026-11-24 10:30"));
    expect(await 超时转扫一遍(京("2026-11-24 11:00"))).toMatchObject({ 提醒: 2 });
    expect((await 超时通知(甲.id))[0].body).not.toContain("不算有效沟通");
    const 乙的 = (await 超时通知(乙.id))[0].body;
    expect(乙的).toContain(`你 11-24 10:30 记的「${"已联系已联系已联系已联系已联系已联系已联系已联系".slice(0, 无效沟通引用字数 - 1)}…」只有「跟进」「已联系」这类占位词，不算有效沟通。`);
    expect(乙的).not.toContain("10:10");
    const 现 = 京("2026-11-24 12:00");
    // 只有链接的不引链接原文
    expect(无效沟通话({ 记于: 京("2026-11-24 10:36"), 内容: "https://x.cn/a?u=13812345678", 原因: "只有链接" }, 现)).toBe("你 11-24 10:36 记的那条只有链接，不算有效沟通。");
    // 引用里的号码先打码再截断：号码跨过截断处也不会留下半截原号
    const 跨 = 无效沟通话({ 记于: 京("2026-11-24 10:36"), 内容: "已联系已联系已联系已联系已联系13812345678", 原因: "占位词" }, 现);
    expect(跨).toBe("你 11-24 10:36 记的「已联系已联系已联系已联系已联系138*…」只有「跟进」「已联系」这类占位词，不算有效沟通。");
    expect(无效沟通话({ 记于: 京("2026-11-24 10:36"), 内容: "回13812345678", 原因: "太短" }, 现)).toBe("你 11-24 10:36 记的「回138****5678」不足 4 个字，不算有效沟通。");
    expect(无效沟通话({ 记于: 京("2026-11-24 10:36"), 内容: "", 原因: "空" }, 现)).toBe("你 11-24 10:36 记的那条沟通没有文字，不算有效沟通。");
    // 计时起点以前记的不引；按时的从提醒时刻（指定回复时间前 30 分钟）起算
    const 按时 = await 分来(丙, 京("2026-11-24 09:00"));
    await prisma.project.update({ where: { id: 按时.id }, data: { replyEndAt: 京("2026-11-24 13:00") } });
    await 记(按时.id, 丙.id, "加微信", 京("2026-11-24 12:40"));
    await 记(按时.id, 丙.id, "OK", 京("2026-11-24 12:20"));
    const p = await prisma.project.findUniqueOrThrow({ where: { id: 按时.id } });
    expect((await 最近无效沟通of({ ...p, 按分配: false }, 京("2026-11-24 13:00")))?.内容).toBe("加微信");
    expect(await 最近无效沟通of({ ...p, 按分配: true }, 京("2026-11-24 13:00"))).toBeNull();
  });
});

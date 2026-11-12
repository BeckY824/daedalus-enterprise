/**
 * 客户三态 · 第二轮审查修复 + 客户 11-12 答复 T1–T12 落地的用例。日子都是改出来的。
 *   - A：转让事务里算归零只用 tx 读规则；夜扫一批写之前在事务里重收事实
 *   - T1–T12 各一组，见各 describe
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const 坏人 = vi.hoisted(() => new Set<string>());
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
// 模拟发到一半断掉：坏人里的人那条没记上
vi.mock("@/lib/enterprise/notify", async (原) => {
  const m = await 原<typeof import("@/lib/enterprise/notify")>();
  return { ...m, notify: (ids: readonly (string | null | undefined)[], n: Parameters<typeof m.notify>[1]) => m.notify(ids.filter((u) => !u || !坏人.has(u)), n) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 三态夜扫, 收三态客户, 写一批, 公海状态, 被挡理由, 暂缓解除理由, 待交接理由 } from "@/lib/enterprise/tri-state-db";
import { 工作日数, 交接挂起超了 } from "@/lib/enterprise/tri-state";
import { 读公海页 } from "@/lib/enterprise/unified-pool-db";
import { 钟上三态提醒 } from "@/lib/enterprise/tri-state-notice";
import { 继续持有, 暂缓回收动作 } from "@/lib/enterprise/tri-state-hold";
import { 读组织 } from "@/lib/enterprise/org";
import { 默认组织规则, 默认三态规则, type 组织规则, type 三态规则 } from "@/lib/project/org-rules";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 加天 } from "@/lib/enterprise/tri-state";
import { 删被撤的换负责人记录, 记换负责人 } from "@/lib/owner-log-db";
import { 查完再写 } from "@/lib/check-then-write";
import { 有内容的沟通, 拨钟的沟通, 默认占位词, 英文单词数 } from "@/lib/enterprise/tri-state-quota";
import { 读占位词, 存占位词 } from "@/lib/enterprise/tri-state-db";
import { 等通知推完 } from "@/lib/enterprise/notify";

const 起 = "2026-11-01";
const 日 = (n: number) => 加天(起, n);
const 早 = (n: number) => new Date(`${日(n)}T00:10:00+08:00`);
const 八点 = (n: number) => new Date(`${日(n)}T08:10:00+08:00`);
const 白天 = (n: number) => new Date(`${日(n)}T10:00:00+08:00`);
const 开三态 = (改: Partial<三态规则> = {}): 组织规则 => ({ ...默认组织规则, 三态: { ...默认三态规则, 开: true, ...改 } });
async function 过(n: number) {
  await 三态夜扫(早(n));
  await 钟上三态提醒(八点(n));
}

const 人 = {} as Record<"乙" | "丙" | "甲" | "总内" | "总外" | "系", { id: string; name: string }>;
let 客户: string;
const 钟 = () => prisma.entCustomerClock.findUnique({ where: { customerId: 客户 } });
const 痕 = () => prisma.entCustomerStateLog.findMany({ where: { customerId: 客户 }, orderBy: [{ at: "asc" }, { id: "asc" }], select: { fromState: true, toState: true, via: true, reason: true } });
const 三态通知 = async (u: string) => prisma.entNotice.findMany({ where: { userId: u, dedupeKey: { startsWith: "tri-daily:" } }, select: { title: true, body: true } });
async function 转给(到: string, n: number) {
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: 客户 } });
  await prisma.customerOwnerLog.create({ data: { customerId: 客户, userId: 人.系.id, fromOwnerId: c.salesOwnerId, toOwnerId: 到, kind: "assign", at: 白天(n) } });
  await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 到 } });
}
/** 被同事项目挡住：第 210 天该进公海进不去 */
async function 到期被挡() {
  await prisma.project.create({ data: { name: "同事的项目", customerId: 客户, ownerId: 人.丙.id, creatorId: 人.丙.id, createdAt: new Date("2026-10-20T10:00:00+08:00") } });
  await 三态夜扫(早(180));
  await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 3, lastNoticeDay: 日(200) } });
  await 三态夜扫(早(210));
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  坏人.clear();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  for (const k of ["乙", "丙", "甲", "总内", "总外", "系"] as const) {
    const u = await prisma.user.create({ data: { email: k, name: k, title: "", role: "SALES", password: "x" } });
    人[k] = { id: u.id, name: u.name };
  }
  await prisma.entMember.createMany({
    data: [
      { userId: 人.乙.id, bizRole: "sales", line: "内贸", managerId: 人.甲.id },
      { userId: 人.丙.id, bizRole: "sales", line: "内贸", managerId: 人.甲.id },
      { userId: 人.甲.id, bizRole: "sales_mgr", line: "内贸" },
      { userId: 人.总内.id, bizRole: "director", line: "内贸" },
      { userId: 人.总外.id, bizRole: "director", line: "外贸" },
      { userId: 人.系.id, bizRole: "director" },
    ],
  });
  客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 人.乙.id, createdAt: new Date("2026-10-01T10:00:00+08:00") } })).id;
  await setSetting("business", { projectMode: true });
  await setSetting("orgRules", 开三态());
});
afterEach(async () => {
  await 等通知推完();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("A · 转让事务里算归零", () => {
  it("在事务里调 记换负责人：设置缓存刚失效也不走外面的连接读规则，归零照存", async () => {
    invalidateSettingsCache();
    const 外面读设置 = vi.spyOn(prisma.setting, "findMany");
    await 查完再写(async (tx) => {
      await tx.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 人.丙.id } });
      await 记换负责人(tx, [{ customerId: 客户, from: 人.乙.id, to: 人.丙.id }], 人.系.id, "assign");
    });
    expect(外面读设置).not.toHaveBeenCalled();
    expect((await prisma.customerOwnerLog.findMany({ select: { clockReset: true } })).map((x) => x.clockReset)).toEqual([true]);
  });

  it("三态关着 / 不是企业版：转让照写、归零留空", async () => {
    await setSetting("orgRules", { ...默认组织规则 });
    await 查完再写((tx) => 记换负责人(tx, [{ customerId: 客户, from: 人.乙.id, to: 人.丙.id }], 人.系.id, "assign"));
    vi.stubEnv("CRM_ENTERPRISE", "");
    await setSetting("orgRules", 开三态());
    await 查完再写((tx) => 记换负责人(tx, [{ customerId: 客户, from: 人.丙.id, to: 人.乙.id }], 人.系.id, "assign"));
    expect((await prisma.customerOwnerLog.findMany({ select: { clockReset: true } })).map((x) => x.clockReset)).toEqual([null, null]);
  });
});

describe("A · 夜扫一批写之前在事务里重收事实", () => {
  it("事务外读完以后有人转让了（钟没动）：按转让后的事实写，不写过时的状态留痕", async () => {
    await 三态夜扫(早(95));
    expect((await 钟())!.state).toBe("沉睡");
    const 规则 = 开三态();
    const org = await 读组织();
    const 旧的 = await 收三态客户(prisma, [客户], 规则, org, 早(96));
    await 转给(人.丙.id, 95);
    await 写一批(规则, org, 旧的, 早(96), 日(96));
    expect(await 钟()).toMatchObject({ state: "活跃", enteredDay: 日(95) });
    expect((await 痕()).at(-1)).toMatchObject({ fromState: "沉睡", toState: "活跃" });
  });

  it("事务外读完以后记了一条有内容的沟通：按新沟通归零", async () => {
    await 三态夜扫(早(95));
    const 规则 = 开三态();
    const org = await 读组织();
    const 旧的 = await 收三态客户(prisma, [客户], 规则, org, 早(96));
    await prisma.followUp.create({ data: { type: "PHONE", title: "电话", content: "聊了下季度采购计划", customerId: 客户, ownerId: 人.乙.id, occurredAt: 白天(95) } });
    await 写一批(规则, org, 旧的, 早(96), 日(96));
    expect(await 钟()).toMatchObject({ state: "活跃", enteredDay: 日(95) });
  });
});

describe("T1 / T2 · 有效沟通判定（纯函数）", () => {
  it("去空白、标点、表情、链接后不足 4 字算空", () => {
    for (const x of ["", "   ", "好的。", "OK!!", "👍👍👍👍", "电 话 了", "https://pan.example.com/s/abc123 ", "www.example.com/a/b"]) expect(有内容的沟通(x), x).toBe(false);
    for (const x of ["约了下周见面", "客户要报价单", "这周五去拜访张总"]) expect(有内容的沟通(x), x).toBe(true);
  });
  it("整条只由占位词拼成算空（连写、重复都算）；夹了别的字不算占位", () => {
    for (const x of ["跟进", "已联系，跟进。", "已沟通 已沟通 已沟通", "1111", "拜访/回访"]) expect(有内容的沟通(x), x).toBe(false);
    expect(有内容的沟通("已联系，下周报价")).toBe(true);
    expect(有内容的沟通("回访：设备运行正常")).toBe(true);
  });
  it("AI 起草成功的以生成结果判：有字就算；空的照样不算", () => {
    expect(有内容的沟通("已联系", { AI生成: true })).toBe(true);
    expect(有内容的沟通("  。 ", { AI生成: true })).toBe(false);
  });
  it("拨钟和回满额度同源", () => {
    for (const x of ["", "跟进", "约了下周见面"]) expect(拨钟的沟通(x)).toBe(有内容的沟通(x));
  });
  it("词表可换：自定义词表只认表里的词", () => {
    expect(有内容的沟通("电话沟通过了", { 占位词: ["电话沟通过了"] })).toBe(false);
    expect(有内容的沟通("已联系已联系", { 占位词: [] })).toBe(true);
  });
});

describe("T1 / T2 · 读库：无效沟通不拨钟、不回满", () => {
  const 记 = (n: number, content: string, 时 = "10:00") => prisma.followUp.create({ data: { type: "PHONE", title: "", content, customerId: 客户, ownerId: 人.乙.id, occurredAt: new Date(`${日(n)}T${时}:00+08:00`) } });

  it("沉睡里记了空 / 占位 / 只贴链接的沟通：不回活跃；有效的才回；同一天几条算一次", async () => {
    await 三态夜扫(早(95));
    await 记(96, "跟进");
    await 记(96, "https://pan.example.com/s/录音", "11:00");
    await 三态夜扫(早(97));
    expect(await 钟()).toMatchObject({ state: "沉睡", quotaResetDay: null });
    await 记(97, "约了下周见面", "09:00");
    await 记(97, "已联系", "15:00"); // 同一天后面那条无效：往前找到上午那条
    await 三态夜扫(早(98));
    expect(await 钟()).toMatchObject({ state: "活跃", enteredDay: 日(97), quotaResetDay: 日(97) });
  });

  it("AI 起草成功的短沟通照样拨钟", async () => {
    await 三态夜扫(早(95));
    const f = await 记(96, "已联系");
    await prisma.followUpSource.create({ data: { followUpId: f.id, text: "客户说下周来看样品" } });
    await 三态夜扫(早(97));
    expect(await 钟()).toMatchObject({ state: "活跃", enteredDay: 日(96) });
  });

  it("占位词表存 Setting、后台可改：默认词表；改了以后按新表判", async () => {
    expect(await 读占位词()).toEqual(默认占位词);
    expect(await 存占位词(["  电话沟通过了。", "电话沟通过了", "", 1 as unknown as string])).toEqual(["电话沟通过了"]);
    invalidateSettingsCache();
    expect(await 读占位词()).toEqual(["电话沟通过了"]);
    await 三态夜扫(早(95));
    await 记(96, "电话沟通过了！");
    await 三态夜扫(早(97));
    expect((await 钟())!.state).toBe("沉睡");
  });
});

describe("T3 · 项目退回公海前的推进算到退回那天", () => {
  it("项目第 80 天推进、第 100 天退回项目公海：钟停在第 80 天，不往前跳回起算日；退回本身不算动静", async () => {
    const p = await prisma.project.create({ data: { name: "退回的", customerId: 客户, ownerId: 人.乙.id, creatorId: 人.乙.id, createdAt: 白天(10) } });
    await prisma.projectNodeLog.create({ data: { projectId: p.id, userId: 人.乙.id, at: 白天(80), toPhase: "线索", toNode: "潜客培育", kind: "node" } });
    await prisma.project.update({ where: { id: p.id }, data: { pooledAt: 白天(100) } });
    await prisma.projectNodeLog.create({ data: { projectId: p.id, userId: 人.乙.id, at: 白天(100), toPhase: "线索", toNode: "潜客培育", kind: "pool-release" } });
    await 三态夜扫(早(101));
    expect(await 钟()).toMatchObject({ state: "活跃", enteredDay: 日(80) });
    await 三态夜扫(早(171));
    expect(await 钟()).toMatchObject({ state: "沉睡", enteredDay: 日(170) });
  });

  it("退回的项目只算推进日，不挡自动进公海、不定用哪套天数", async () => {
    await prisma.customer.update({ where: { id: 客户 }, data: { bizLine: "内贸" } });
    await prisma.project.create({ data: { name: "同事的、已退回", customerId: 客户, ownerId: 人.丙.id, creatorId: 人.丙.id, createdAt: new Date("2026-10-20T10:00:00+08:00"), pooledAt: new Date("2026-10-25T10:00:00+08:00") } });
    await 三态夜扫(早(180));
    await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 3, lastNoticeDay: 日(200) } });
    await 三态夜扫(早(210));
    expect(await prisma.customerPool.findUnique({ where: { customerId: 客户 } })).not.toBeNull();
  });
});

describe("T4 · 公海领走 / 分走：当天起算新一轮，额度回满，不占转让 2 次", () => {
  async function 进公海再领(到: string, n: number, kind: "claim" | "pool-assign") {
    await prisma.customerPool.create({ data: { customerId: 客户, userId: 人.系.id, reason: "手动", at: 白天(n - 1) } });
    await 三态夜扫(早(n));
    expect((await 钟())!.state).toBe(公海状态);
    await prisma.customerPool.delete({ where: { customerId: 客户 } });
    await prisma.customerOwnerLog.create({ data: { customerId: 客户, userId: 到, fromOwnerId: 人.乙.id, toOwnerId: 到, kind, at: 白天(n) } });
    await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 到 } });
  }

  it("前手用了 1 次继续持有，领走的人额度回满 3 次 / 90 天，钟从领取当天起", async () => {
    expect(await 继续持有(人.乙, 客户, null, 白天(90))).toMatchObject({ ok: true, 剩次数: 2 });
    await 进公海再领(人.丙.id, 130, "claim");
    await 三态夜扫(早(131));
    expect(await 钟()).toMatchObject({ state: "活跃", enteredDay: 日(130), holdCount: 0, holdDays: 0, quotaResetDay: 日(130) });
    expect(await 继续持有(人.丙, 客户, null, 白天(220))).toMatchObject({ ok: true, 剩次数: 2, 剩天数: 60 });
  });

  it("公海指派同样回满；转让（同事之间）不回满", async () => {
    expect(await 继续持有(人.乙, 客户, null, 白天(90))).toMatchObject({ ok: true, 剩次数: 2 });
    await 转给(人.丙.id, 100);
    await 三态夜扫(早(101));
    expect(await 钟()).toMatchObject({ holdCount: 1 });
    await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 人.乙.id } });
    await 进公海再领(人.丙.id, 130, "pool-assign");
    await 三态夜扫(早(131));
    expect(await 钟()).toMatchObject({ holdCount: 0, quotaResetDay: 日(130) });
  });

  it("两次转让之间夹一次公海领取：领取不占「12 个月 2 次」，两次转让都归零", async () => {
    await 三态夜扫(早(5));
    await 转给(人.丙.id, 10);
    await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 人.乙.id } });
    await 进公海再领(人.丙.id, 30, "claim");
    await 转给(人.乙.id, 40);
    await 三态夜扫(早(41));
    expect((await prisma.customerOwnerLog.findMany({ where: { kind: "assign" }, orderBy: { at: "asc" }, select: { clockReset: true } })).map((x) => x.clockReset)).toEqual([true, true]);
  });
});

describe("T8 · 建项目算动静，建完转给同事的照算在客户上", () => {
  it("第 60 天建项目、当天转给同事负责：客户的钟从第 60 天起", async () => {
    await 三态夜扫(早(5));
    const p = await prisma.project.create({ data: { name: "新项目", customerId: 客户, ownerId: 人.乙.id, creatorId: 人.乙.id, createdAt: 白天(60) } });
    await prisma.project.update({ where: { id: p.id }, data: { ownerId: 人.丙.id } });
    await 三态夜扫(早(61));
    expect(await 钟()).toMatchObject({ state: "活跃", enteredDay: 日(60) });
  });
});

describe("T9 · 市场成员认人：有市场角色、没销售角色才算；兼任按销售", () => {
  it("市场 + 销售兼任：照常计时建钟", async () => {
    await prisma.entMember.update({ where: { userId: 人.乙.id }, data: { bizRole: "marketing_mgr,sales" } });
    await 三态夜扫(早(100));
    expect(await 钟()).toMatchObject({ state: "沉睡" });
  });
  it("只有市场角色：不计时", async () => {
    await prisma.entMember.update({ where: { userId: 人.乙.id }, data: { bizRole: "marketing_mgr" } });
    await 三态夜扫(早(100));
    expect(await 钟()).toBeNull();
  });
});

describe("T5 · 暂缓回收（被同事项目挡住）：期间提醒不算 3 次；解除后提醒 1 次，满 10 天没人处理才收", () => {
  const 在公海 = async () => !!(await prisma.customerPool.findUnique({ where: { customerId: 客户 } }));
  const 同事项目 = () => prisma.project.findFirstOrThrow({ where: { customerId: 客户, ownerId: 人.丙.id } });

  it("对用户的说法改叫「暂缓回收」", () => {
    expect(被挡理由).toContain("暂缓回收");
    expect(被挡理由).not.toContain("挡");
  });

  it("暂缓期间每月提醒总管理，不动待回收提醒次数；解除当天并进汇总提醒 1 次，第 10 天收", async () => {
    await 到期被挡();
    await 钟上三态提醒(八点(210));
    expect(await 钟()).toMatchObject({ state: "待回收", blocked: true, noticeCount: 3, lastNoticeDay: 日(200) });
    await 过(240);
    expect(await 钟()).toMatchObject({ noticeCount: 3, lastNoticeDay: 日(200) });
    await prisma.project.update({ where: { id: (await 同事项目()).id }, data: { result: "丢单" } });
    await 过(250);
    expect(await 在公海()).toBe(false);
    expect(await 钟()).toMatchObject({ state: "待回收", blocked: false, noticeCount: 3, lastNoticeDay: 日(250) });
    expect((await 痕()).filter((x) => x.reason === 暂缓解除理由)).toHaveLength(1);
    expect((await 三态通知(人.总内.id)).map((x) => x.title)).toContain("客户三态提醒：1 家暂缓回收已解除（10 天内没人处理就回公海）");
    expect((await 三态通知(人.乙.id)).length).toBeGreaterThan(0);
    await 过(251);
    await 过(259);
    expect(await 在公海()).toBe(false);
    await 三态夜扫(早(260));
    expect(await 在公海()).toBe(true);
  });

  it("解除后 10 天内有人记了有效沟通：不收，钟归零", async () => {
    await 到期被挡();
    await prisma.project.update({ where: { id: (await 同事项目()).id }, data: { result: "丢单" } });
    await 过(215);
    await prisma.followUp.create({ data: { type: "PHONE", title: "", content: "约了下周见面谈续约", customerId: 客户, ownerId: 人.乙.id, occurredAt: 白天(220) } });
    await 三态夜扫(早(226));
    expect(await 在公海()).toBe(false);
    expect(await 钟()).toMatchObject({ state: "活跃", enteredDay: 日(220) });
  });

  it("解除后又被挡住：按新挡住算，不拿旧的解除日收", async () => {
    await 到期被挡();
    const p = await 同事项目();
    await prisma.project.update({ where: { id: p.id }, data: { result: "丢单" } });
    await 过(215);
    await prisma.project.create({ data: { name: "同事的新项目", customerId: 客户, ownerId: 人.丙.id, creatorId: 人.丙.id, createdAt: new Date("2026-10-20T10:00:00+08:00") } });
    await 过(216);
    // 再次挡住当晚就亮「暂缓回收」，不等原定进公海日；第二天照样亮着
    expect(await 钟()).toMatchObject({ state: "待回收", blocked: true });
    expect((await 痕()).filter((x) => x.reason === 被挡理由)).toHaveLength(2);
    await 过(217);
    expect(await 钟()).toMatchObject({ blocked: true });
    await 过(240);
    expect(await 在公海()).toBe(false);
  });
});

describe("T11 · 暂缓回收两次至少隔 30 天、累计最多 2 次；第 3 次起走继续持有、占额度", () => {
  it("第 210、240 天两次暂缓；第 270 天第三次被拒；改走写理由继续持有，扣 1 次、退回待回收", async () => {
    await 到期被挡();
    expect(await 暂缓回收动作(人.总内, 客户, null, 白天(210))).toEqual({ ok: true });
    expect(await 暂缓回收动作(人.总内, 客户, null, 白天(225))).toMatchObject({ ok: false, error: `${日(210)} 已经暂缓回收过，30 天内不用再裁决` });
    expect(await 暂缓回收动作(人.总内, 客户, null, 白天(240))).toEqual({ ok: true });
    expect(await 暂缓回收动作(人.总内, 客户, null, 白天(270))).toMatchObject({ ok: false, error: "暂缓回收已用满 2 次（60 天），要继续留着请写理由继续持有（占继续持有的次数和天数）" });
    expect(await 继续持有(人.总内, 客户, "", 白天(270))).toMatchObject({ ok: false, error: "待回收时要写理由才能继续持有" });
    expect(await 继续持有(人.总内, 客户, "同事项目下月结束", 白天(270))).toEqual({ ok: true, 剩次数: 2, 剩天数: 60 });
    expect(await 钟()).toMatchObject({ state: "待回收", blocked: false, holdCount: 1 });
    expect((await 痕()).at(-1)).toMatchObject({ via: "总管理代选", reason: "由 总内 代选：同事项目下月结束" });
  });

  it("暂缓次数跟额度一起重置：中间记了有效沟通，再到期挡住又能暂缓 2 次", async () => {
    await 到期被挡();
    expect(await 暂缓回收动作(人.总内, 客户, null, 白天(210))).toEqual({ ok: true });
    expect(await 暂缓回收动作(人.总内, 客户, null, 白天(240))).toEqual({ ok: true });
    await prisma.followUp.create({ data: { type: "PHONE", title: "", content: "约了下周见面谈续约", customerId: 客户, ownerId: 人.乙.id, occurredAt: 白天(241) } });
    await 三态夜扫(早(242));
    await 三态夜扫(早(241 + 180));
    await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 3, lastNoticeDay: 日(241 + 200) } });
    await 三态夜扫(早(241 + 210));
    expect(await 暂缓回收动作(人.总内, 客户, null, 白天(241 + 210))).toEqual({ ok: true });
  });
});

describe("T7 · 撤销转让即未发生；同一对负责人 7 天内转—撤—转第二次起，撤销不还原次数（钟仍还原）", () => {
  async function 撤(n: number, 从: string, 到: string) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(白天(n));
    await 删被撤的换负责人记录(prisma, 客户, 从, 到, 人.甲.id);
    vi.useRealTimers();
    await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 从 } });
  }
  const 撤销痕 = () => prisma.entCustomerStateLog.findMany({ where: { customerId: 客户, via: { startsWith: "撤销转让" } }, orderBy: { at: "asc" }, select: { via: true, fromOwnerId: true, toOwnerId: true, userId: true } });
  const 归零们 = async () => (await prisma.customerOwnerLog.findMany({ where: { kind: "assign" }, orderBy: { at: "asc" }, select: { clockReset: true } })).map((x) => x.clockReset);

  it("第一次撤销：次数、钟都还原，留一行撤销痕", async () => {
    await 三态夜扫(早(5));
    await 转给(人.丙.id, 50);
    await 撤(50, 人.乙.id, 人.丙.id);
    // userId 记撤销人（甲），不是原转让人（系）
    expect(await 撤销痕()).toEqual([{ via: "撤销转让", fromOwnerId: 人.乙.id, toOwnerId: 人.丙.id, userId: 人.甲.id }]);
    await 三态夜扫(早(51));
    expect((await 钟())!.enteredDay).toBe("2026-11-01");
    // 不占次数：之后两次转让都归零
    await 转给(人.丙.id, 60);
    await 转给(人.乙.id, 70);
    await 三态夜扫(早(71));
    expect(await 归零们()).toEqual([true, true]);
  });

  it("7 天内同一对第二次撤销：照算 1 次转让（钟不归零到那天）；之后第 2 次真转让归零、第 3 次不归零", async () => {
    await 三态夜扫(早(5));
    await 转给(人.丙.id, 10);
    await 撤(10, 人.乙.id, 人.丙.id);
    await 转给(人.丙.id, 12);
    await 撤(12, 人.乙.id, 人.丙.id);
    expect((await 撤销痕()).map((x) => x.via)).toEqual(["撤销转让", "撤销转让·计次"]);
    await 三态夜扫(早(13));
    expect((await 钟())!.enteredDay).toBe("2026-11-01");
    await 转给(人.丙.id, 20);
    await 转给(人.乙.id, 30);
    await 三态夜扫(早(31));
    expect(await 归零们()).toEqual([true, false]);
    expect((await 钟())!.enteredDay).toBe(日(20));
  });

  it("同一对不分方向：A→B 撤了，7 天内 B→A 再撤，第二次起不还原次数", async () => {
    await 三态夜扫(早(5));
    await 转给(人.丙.id, 10);
    await 撤(10, 人.乙.id, 人.丙.id);
    await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 人.丙.id } });
    await 转给(人.乙.id, 12);
    await 撤(12, 人.丙.id, 人.乙.id);
    expect((await 撤销痕()).map((x) => x.via)).toEqual(["撤销转让", "撤销转让·计次"]);
  });

  it("隔了 7 天以上、或换了一对负责人：照常还原", async () => {
    await 三态夜扫(早(5));
    await 转给(人.丙.id, 10);
    await 撤(10, 人.乙.id, 人.丙.id);
    await 转给(人.丙.id, 18);
    await 撤(18, 人.乙.id, 人.丙.id);
    await 转给(人.甲.id, 19);
    await 撤(19, 人.乙.id, 人.甲.id);
    expect((await 撤销痕()).map((x) => x.via)).toEqual(["撤销转让", "撤销转让", "撤销转让"]);
  });

  it("转让当下算归零也认撤销计次（记换负责人 在事务里）", async () => {
    await setSetting("orgRules", 开三态({ 转让归零: { 次数: 1, 窗口月数: 12 } }));
    await 三态夜扫(早(5));
    await 转给(人.丙.id, 10);
    await 撤(10, 人.乙.id, 人.丙.id);
    await 转给(人.丙.id, 12);
    await 撤(12, 人.乙.id, 人.丙.id);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(白天(20));
    await 查完再写((tx) => 记换负责人(tx, [{ customerId: 客户, from: 人.乙.id, to: 人.丙.id }], 人.系.id, "assign"));
    vi.useRealTimers();
    expect(await 归零们()).toEqual([false]);
  });

  it("三态关着：撤销照删、不留三态痕", async () => {
    await setSetting("orgRules", { ...默认组织规则 });
    await 转给(人.丙.id, 10);
    await 撤(10, 人.乙.id, 人.丙.id);
    expect(await prisma.customerOwnerLog.count()).toBe(0);
    expect(await prisma.entCustomerStateLog.count()).toBe(0);
  });
});

describe("工作日（T6 / T12 的 15 个工作日）", () => {
  it("周一到周五算，不含起那天；不扣节假日", () => {
    expect(工作日数("2026-11-13", "2026-11-16")).toBe(1); // 周五 → 周一
    expect(工作日数("2026-11-13", "2026-11-20")).toBe(5);
    expect(工作日数("2026-11-13", "2026-11-13")).toBe(0);
    expect(工作日数("2026-09-30", "2026-10-08")).toBe(6); // 国庆照算工作日（没有节假日表）
  });
});

describe("T6 · 离职交接等确认：不收、不推提醒；确认按新负责人起算，作废恢复原钟；挂起超 15 个工作日推系统管理员", () => {
  const 在公海 = async () => !!(await prisma.customerPool.findUnique({ where: { customerId: 客户 } }));
  const 兜底通知 = (u: string) => prisma.entNotice.findMany({ where: { userId: u, dedupeKey: { startsWith: "tri-handover-stuck:" } } });
  async function 发起离职(n: number) {
    await prisma.user.update({ where: { id: 人.乙.id }, data: { active: false } });
    return prisma.entHandover.create({ data: { kind: "离职", fromUserId: 人.乙.id, toUserId: 人.丙.id, byUserId: 人.系.id, customerIds: JSON.stringify([客户]), status: "待确认", createdAt: 白天(n) } });
  }

  it("挂起期间到了待回收也不推提醒、不收；作废后恢复原钟、照常提醒", async () => {
    const h = await 发起离职(100);
    await 过(180);
    await 过(190);
    expect(await 三态通知(人.甲.id)).toHaveLength(0);
    expect(await 三态通知(人.系.id)).toHaveLength(0);
    expect(await 钟()).toMatchObject({ state: "待回收", noticeCount: 0 });
    await 过(240);
    expect(await 在公海()).toBe(false);
    await prisma.entHandover.update({ where: { id: h.id }, data: { status: "已撤回", doneAt: 白天(240) } });
    await 过(241);
    expect(await 钟()).toMatchObject({ state: "待回收", noticeCount: 1, enteredDay: 日(180) });
    // 负责人停用了：条线总管理按他的线找不到 → 系统管理员；直属上级按他停用前的上级
    expect((await 三态通知(人.系.id)).length).toBe(1);
    expect((await 三态通知(人.甲.id)).length).toBe(1);
  });

  it("确认了：按新负责人从确认那天起算", async () => {
    const h = await 发起离职(100);
    await 过(180);
    await 查完再写(async (tx) => {
      await tx.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 人.丙.id } });
      await 记换负责人(tx, [{ customerId: 客户, from: 人.乙.id, to: 人.丙.id }], 人.丙.id, "deactivate");
      await tx.entHandover.update({ where: { id: h.id }, data: { status: "已确认", doneAt: new Date() } });
    });
    const 确认那天 = (await prisma.customerOwnerLog.findFirstOrThrow({ where: { kind: "deactivate" } })).at;
    await prisma.customerOwnerLog.updateMany({ where: { kind: "deactivate" }, data: { at: 白天(185) } });
    expect(确认那天).toBeInstanceOf(Date);
    await 过(186);
    expect(await 钟()).toMatchObject({ state: "活跃", enteredDay: 日(185) });
  });

  it("挂起超过 15 个工作日：推系统管理员一次（第 100 天周二发起，第 121 天满 15 个，第 122 天推）", async () => {
    await 发起离职(100);
    await 过(121);
    expect(await 兜底通知(人.系.id)).toHaveLength(0);
    await 过(122);
    await 过(123);
    const 推了 = await 兜底通知(人.系.id);
    expect(推了).toHaveLength(1);
    expect(推了[0].title).toBe("离职交接挂起超过 15 个工作日（或 30 天）没人确认");
    expect(await 兜底通知(人.总内.id)).toHaveLength(0);
  });
});

describe("T12 · 停用账号名下的客户：提醒走停用前上级，标待交接进队列，超 15 个工作日推系统管理员", () => {
  const 待交接通知 = (u: string) => prisma.entNotice.findMany({ where: { userId: u, dedupeKey: { startsWith: "tri-offboard-stuck:" } } });

  it("停用后夜扫标一次待交接（只一次）；沉睡提醒不发停用人、发他停用前的上级", async () => {
    await prisma.user.update({ where: { id: 人.乙.id }, data: { active: false } });
    await 过(90);
    await 过(91);
    expect((await 痕()).filter((x) => x.reason === 待交接理由)).toHaveLength(1);
    expect(await 三态通知(人.乙.id)).toHaveLength(0);
    expect((await 三态通知(人.甲.id)).length).toBeGreaterThan(0);
  });

  it("挂在停用人名下超过 15 个工作日推系统管理员一次；交出去了不再标、不再推", async () => {
    await prisma.user.update({ where: { id: 人.乙.id }, data: { active: false } });
    await 过(100);
    await 过(121);
    expect(await 待交接通知(人.系.id)).toHaveLength(0);
    await 过(122);
    await 过(123);
    const 推了 = await 待交接通知(人.系.id);
    expect(推了.map((x) => x.title)).toEqual(["停用账号名下 1 位客户待交接超过 15 个工作日（或 30 天）"]);
  });

  it("离职交接已经在等确认的不另标（T6 那条兜底管）", async () => {
    await prisma.user.update({ where: { id: 人.乙.id }, data: { active: false } });
    await prisma.entHandover.create({ data: { kind: "离职", fromUserId: 人.乙.id, toUserId: 人.丙.id, byUserId: 人.系.id, customerIds: "[]", status: "待确认", createdAt: 白天(99) } });
    await 过(100);
    expect((await 痕()).filter((x) => x.reason === 待交接理由)).toHaveLength(0);
  });
});

describe("T10 · 到期自动进公海不查号码；收回时号码不全打标，公海列表能筛", () => {
  async function 到期收回() {
    await 三态夜扫(早(180));
    await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 3, lastNoticeDay: 日(200) } });
    await 三态夜扫(早(210));
    return prisma.customerPool.findUnique({ where: { customerId: 客户 } });
  }

  it("客户电话空、没联系人：照收，打号码不全", async () => {
    await prisma.customer.update({ where: { id: 客户 }, data: { phone: "" } });
    expect(await 到期收回()).toMatchObject({ phoneIncomplete: true, userId: null });
  });

  it("号码齐全：照收，不打标", async () => {
    expect(await 到期收回()).toMatchObject({ phoneIncomplete: false });
  });

  it("公海列表按 号码不全=1 只列打了标的", async () => {
    await prisma.customer.update({ where: { id: 客户 }, data: { phone: "" } });
    await 到期收回();
    const 另一位 = await prisma.customer.create({ data: { name: "客户乙", phone: "13800000002", salesOwnerId: 人.乙.id } });
    await prisma.customerPool.create({ data: { customerId: 另一位.id, userId: 人.系.id, reason: "手动" } });
    const 全部 = await 读公海页({ ...人.系, role: "ADMIN" }, {}, 1, 20);
    expect(全部.行.map((r) => r.客户名).sort()).toEqual(["客户乙", "客户甲"]);
    const 只看 = await 读公海页({ ...人.系, role: "ADMIN" }, { 号码不全: "1" }, 1, 20);
    expect(只看.行.map((r) => [r.客户名, r.号码不全])).toEqual([["客户甲", true]]);
  });
});

describe("第三轮审查", () => {
  it("公海筛号码不全按客户认：打了标的客户下的项目子行一起留着", async () => {
    const { 筛排 } = await import("@/lib/enterprise/unified-pool");
    const 行 = (id: string, 种: "客户" | "项目", customerId: string, 号码不全?: boolean) => ({
      id, 种, customerId, projectId: 种 === "项目" ? id : null, 客户名: customerId, 项目名: null, 进程: null, 进程明细: null, 属性: "线索池" as const,
      最后跟进: null, 入池时间: "2026-11-10T00:00:00.000Z", 创建时间: "2026-11-01T00:00:00.000Z", 类: "超时回收" as const, 累计: 0, 入池原因: "", 快捷: null, 原负责人是我: false,
      ...(号码不全 ? { 号码不全 } : {}),
    });
    const 全部 = [行("c:甲", "客户", "甲", true), 行("p:1", "项目", "甲"), 行("p:2", "项目", "甲"), 行("p:3", "项目", "乙")];
    const r = 筛排(全部 as never, { 号码不全: "1" });
    expect(r.行.flatMap((x) => (x.子 ? x.子.map((y) => y.id) : [x.id])).sort()).toEqual(["c:甲", "p:1", "p:2"]);
  });

  it("已回公海：原负责人停用了改发他停用前的上级", async () => {
    await prisma.user.update({ where: { id: 人.乙.id }, data: { active: false } });
    await 三态夜扫(早(180));
    await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 3, lastNoticeDay: 日(200) } });
    await 三态夜扫(早(210));
    expect(await prisma.customerPool.findUnique({ where: { customerId: 客户 } })).not.toBeNull();
    const 回 = (u: string) => prisma.entNotice.findMany({ where: { userId: u, dedupeKey: { startsWith: "tri-pooled:" } }, select: { title: true } });
    expect(await 回(人.乙.id)).toHaveLength(0);
    expect((await 回(人.甲.id)).map((x) => x.title)).toEqual(["停用账号名下的客户「客户甲」待回收期满没人处理，已回客户公海"]);
  });

  it("到期暂缓回收、暂缓没用满 2 次：继续持有标志就是不能，和服务端拒的话一样；用满后能", async () => {
    await 到期被挡();
    const { 读一位三态 } = await import("@/lib/enterprise/tri-state-hold");
    const 话 = "到期暂缓回收的客户先由条线总管理裁决暂缓回收（最多 2 次），用满以后才能继续持有";
    expect((await 读一位三态(客户, 白天(210)))!.继续持有).toMatchObject({ 能推: false, 不能原因: 话 });
    expect(await 继续持有(人.乙, 客户, "还在跟", 白天(210))).toMatchObject({ ok: false, error: 话 });
    await 暂缓回收动作(人.总内, 客户, null, 白天(210));
    await 暂缓回收动作(人.总内, 客户, null, 白天(240));
    expect((await 读一位三态(客户, 白天(270)))!.继续持有).toMatchObject({ 能推: true });
  });
});

describe("第二轮答复 S1–S8", () => {
  /** 第 n 天换了负责人（钟归零）之后再走到期、被同事项目挡住 */
  async function 再到期(n: number) {
    await 三态夜扫(早(n + 180));
    await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 3, lastNoticeDay: 日(n + 200) } });
    await 三态夜扫(早(n + 210));
    expect(await 钟()).toMatchObject({ blocked: true });
  }

  it("S1：15 个工作日或 30 个自然日，先到者（不扣节假日时工作日那条总是先到）", () => {
    expect(交接挂起超了("2026-11-10", "2026-12-01")).toBe(false); // 15 个工作日
    expect(交接挂起超了("2026-11-10", "2026-12-02")).toBe(true); // 第 16 个工作日
    expect(工作日数("2026-11-10", "2026-12-10") > 15).toBe(true);
  });

  it("S2：暂缓 2 次用满后同事之间转让不重新数；公海领走才重新数", async () => {
    await 到期被挡();
    expect(await 暂缓回收动作(人.总内, 客户, null, 白天(210))).toEqual({ ok: true });
    expect(await 暂缓回收动作(人.总内, 客户, null, 白天(240))).toEqual({ ok: true });
    await 转给(人.甲.id, 250);
    await 再到期(250);
    expect(await 暂缓回收动作(人.总内, 客户, null, 白天(250 + 210))).toMatchObject({ ok: false, error: expect.stringContaining("暂缓回收已用满 2 次") });
  });

  it("S2：离职交接也不重新数", async () => {
    await 到期被挡();
    await 暂缓回收动作(人.总内, 客户, null, 白天(210));
    await 暂缓回收动作(人.总内, 客户, null, 白天(240));
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: 客户 } });
    await prisma.customerOwnerLog.create({ data: { customerId: 客户, userId: 人.系.id, fromOwnerId: c.salesOwnerId, toOwnerId: 人.甲.id, kind: "deactivate", at: 白天(250) } });
    await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 人.甲.id } });
    await 再到期(250);
    expect(await 暂缓回收动作(人.总内, 客户, null, 白天(250 + 210))).toMatchObject({ ok: false, error: expect.stringContaining("暂缓回收已用满 2 次") });
  });

  it("S3：7 天按 7×24 小时滚动：差 1 分钟满 7×24 小时算计次，过了就不算", async () => {
    await 三态夜扫(早(5));
    const 撤于 = async (at: string) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(at));
      await 删被撤的换负责人记录(prisma, 客户, 人.乙.id, 人.丙.id, 人.乙.id);
      vi.useRealTimers();
      await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 人.乙.id } });
    };
    await 转给(人.丙.id, 10);
    await 撤于(`${日(10)}T10:00:00+08:00`);
    await 转给(人.丙.id, 17);
    await 撤于(`${日(17)}T09:59:00+08:00`);
    await 转给(人.丙.id, 25);
    await 撤于(`${日(25)}T10:00:00+08:00`); // 离上一次撤销 8 天
    expect((await prisma.entCustomerStateLog.findMany({ where: { via: { startsWith: "撤销转让" } }, orderBy: { at: "asc" }, select: { via: true } })).map((x) => x.via))
      .toEqual(["撤销转让", "撤销转让·计次", "撤销转让"]);
  });

  it("S5：英文按单词数，中英分别判、任一满足；数字、符号、表情不算字", () => {
    const 判 = (x: string) => 有内容的沟通(x);
    expect([判("Met"), 判("Call"), 判("Called back"), 判("已发报价 ok"), 判("ok 好的"), 判("12345678"), 判("👍🎉🔥😀"), 判("报价 3 万")])
      .toEqual([false, false, true, true, false, false, false, false]);
    expect(判("已联系 called back")).toBe(true);
    expect(判("!!! ??? ...")).toBe(false);
  });

  it("S5（客户确认）：单个英文词一律算空，两个词起有效；按空白和标点切开数", () => {
    const 判 = (x: string) => 有内容的沟通(x);
    expect(["Call", "Met", "Called", "Ok", "Visit"].map(判)).toEqual([false, false, false, false, false]);
    expect(["Call back", "Met client", "Called twice", "No answer left vm"].map(判)).toEqual([true, true, true, true]);
    expect(英文单词数("e-mail")).toBe(2);
    expect(判("e-mail")).toBe(true);
    expect(判("Call 123")).toBe(false);
    expect(判("Call 已发报价")).toBe(true); // 中文 4 字那边满足
  });

  it("S5：俄文、阿拉伯文等按单词书写的文字和英文同一口径；日文、韩文照中文按字数", () => {
    const 判 = (x: string) => 有内容的沟通(x);
    expect([判("Звонил"), 判("Звонил клиенту"), 判("اتصلت"), 判("اتصلت بالعميل"), 判("Τηλεφώνησα"), 判("Τηλεφώνησα πελάτη"), 判("התקשרתי"), 判("התקשרתי ללקוח")])
      .toEqual([false, true, false, true, false, true, false, true]);
    expect(英文单词数("اتَّصَلْتُ")).toBe(1); // 带变音符号也是一个词
    expect([判("電話した"), 判("電話"), 判("통화했음"), 判("통화")]).toEqual([true, false, true, false]);
  });

  it("S7：建了项目拨过的钟，项目删了（软删）或作废了也不回退", async () => {
    await 三态夜扫(早(5));
    const p = await prisma.project.create({ data: { name: "建了又删", customerId: 客户, ownerId: 人.乙.id, creatorId: 人.乙.id, createdAt: 白天(60) } });
    await 三态夜扫(早(61));
    expect(await 钟()).toMatchObject({ state: "活跃", enteredDay: 日(60), progressDay: 日(60) });
    await prisma.project.update({ where: { id: p.id }, data: { deletedAt: 白天(62) } });
    await 三态夜扫(早(63));
    expect(await 钟()).toMatchObject({ state: "活跃", enteredDay: 日(60) });
    await 三态夜扫(早(151));
    expect(await 钟()).toMatchObject({ state: "沉睡", enteredDay: 日(150) });
  });

  it("S8：市场成员判定变了给系统管理员发一条、记操作日志；同一次变化只发一次；第一次只记快照", async () => {
    const 变化通知 = () => prisma.entNotice.findMany({ where: { userId: 人.系.id, dedupeKey: { startsWith: "tri-market-change:" } }, orderBy: { createdAt: "asc" }, select: { title: true, body: true } });
    await 三态夜扫(早(5));
    expect(await 变化通知()).toHaveLength(0);
    await prisma.entMember.update({ where: { userId: 人.乙.id }, data: { bizRole: "marketing_mgr" } });
    invalidateSettingsCache();
    await 三态夜扫(早(6));
    await 三态夜扫(早(7));
    const 一 = await 变化通知();
    expect(一).toEqual([{ title: "1 位成员的「市场成员」判定变了，影响 1 家客户的三态计时", body: `乙 从销售变成市场成员：名下 1 家客户从 ${日(6)} 起不再计三态（市场成员另列）` }]);
    expect(await prisma.auditLog.count({ where: { entityId: 人.乙.id, summary: { startsWith: "客户三态：" } } })).toBe(1);
    await prisma.entMember.update({ where: { userId: 人.乙.id }, data: { bizRole: "sales" } });
    await 三态夜扫(早(8));
    expect((await 变化通知()).at(-1)!.body).toBe(`乙 从市场成员变成销售：名下 1 家客户从 ${日(8)} 起进入三态计时`);
  });

  it("S8：市场成员停用 → 名下客户起计三态，也列进清单；重新启用同理；新来名下 0 家不算", async () => {
    const 变化通知 = () => prisma.entNotice.findMany({ where: { userId: 人.系.id, dedupeKey: { startsWith: "tri-market-change:" } }, orderBy: { createdAt: "asc" }, select: { body: true } });
    await prisma.entMember.update({ where: { userId: 人.乙.id }, data: { bizRole: "marketing_mgr" } });
    await 三态夜扫(早(5));
    expect(await 变化通知()).toHaveLength(0);
    await prisma.user.update({ where: { id: 人.乙.id }, data: { active: false } });
    await 三态夜扫(早(6));
    expect((await 变化通知()).map((x) => x.body)).toEqual([`乙 停用：1 家起计三态（原是市场成员，名下客户从 ${日(6)} 起进入三态计时）`]);
    expect(await prisma.auditLog.count({ where: { entityId: 人.乙.id, summary: { startsWith: "客户三态：乙 停用" } } })).toBe(1);
    await 三态夜扫(早(7));
    expect(await 变化通知()).toHaveLength(1);
    await prisma.user.update({ where: { id: 人.乙.id }, data: { active: true } });
    await 三态夜扫(早(8));
    expect((await 变化通知()).at(-1)!.body).toBe(`乙 重新启用：1 家不再计三态（是市场成员，名下客户从 ${日(8)} 起市场成员另列）`);
    // 新入职的市场成员名下 0 家；停用的销售（名下 0 家、本来就计三态）：都不报
    const 新 = await prisma.user.create({ data: { email: "新", name: "新", title: "", role: "SALES", password: "x" } });
    await prisma.entMember.create({ data: { userId: 新.id, bizRole: "marketing_mgr" } });
    await prisma.user.update({ where: { id: 人.丙.id }, data: { active: false } });
    await 三态夜扫(早(9));
    expect(await 变化通知()).toHaveLength(2);
    const 快照 = JSON.parse((await prisma.setting.findUniqueOrThrow({ where: { key: "entTriMarketSnapshot" } })).value);
    expect(快照).toMatchObject({ [新.id]: true, [人.丙.id]: "停用", [人.乙.id]: true });
  });

  it("S8：在职销售停用不报（名下客户本来就计三态）", async () => {
    await 三态夜扫(早(5));
    await prisma.user.update({ where: { id: 人.乙.id }, data: { active: false } });
    await 三态夜扫(早(6));
    expect(await prisma.entNotice.count({ where: { dedupeKey: { startsWith: "tri-market-change:" } } })).toBe(0);
  });

  it("S8：三态关着不跑", async () => {
    await setSetting("orgRules", { ...默认组织规则 });
    await 三态夜扫(早(5));
    expect(await prisma.setting.findUnique({ where: { key: "entTriMarketSnapshot" } })).toBeNull();
  });

  it("交接看板：待交接的客户带待交接日和挂起天数；原负责人、原直属上级本来就有", async () => {
    await prisma.user.update({ where: { id: 人.乙.id }, data: { active: false } });
    const 五天前 = new Date(Date.now() - 5 * 86_400_000);
    await prisma.entCustomerStateLog.create({ data: { customerId: 客户, toState: "活跃", reason: 待交接理由, fromOwnerId: 人.乙.id, at: 五天前 } });
    const { 读离职交接 } = await import("@/lib/enterprise/offboard-handover");
    const 看板 = await 读离职交接({ id: 人.系.id, role: "ADMIN" } as never);
    const 乙那组 = 看板.find((x) => x.id === 人.乙.id)!;
    expect(乙那组).toMatchObject({ name: "乙", 上级: "甲" });
    expect(乙那组.客户[0]).toMatchObject({ id: 客户, 挂起天数: 5 });
    expect(乙那组.客户[0].待交接日).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 三态界面 B 组（M-公海-52）：挂起工作日和超期一起给，看板标红按它
    const { 工作日数 } = await import("@/lib/enterprise/tri-state");
    expect(乙那组.客户[0]).toMatchObject({ 挂起工作日: 工作日数(乙那组.客户[0].待交接日!, 加天(乙那组.客户[0].待交接日!, 5)), 超期: false });
  });

  it("交接看板：挂起超过 15 个工作日或 30 个自然日（先到者）标超期", async () => {
    await prisma.user.update({ where: { id: 人.乙.id }, data: { active: false } });
    // 25 个自然日（不到 30）：里面最多 8 个周末日，工作日至少 17 个 → 超了 15 个工作日那条
    await prisma.entCustomerStateLog.create({ data: { customerId: 客户, toState: "活跃", reason: 待交接理由, fromOwnerId: 人.乙.id, at: new Date(Date.now() - 25 * 86_400_000) } });
    const { 读离职交接 } = await import("@/lib/enterprise/offboard-handover");
    const 一位 = (await 读离职交接({ id: 人.系.id, role: "ADMIN" } as never)).find((x) => x.id === 人.乙.id)!.客户[0];
    expect(一位.挂起天数).toBe(25);
    expect(一位.挂起工作日).toBeGreaterThan(15);
    expect(一位.超期).toBe(true);
  });
});

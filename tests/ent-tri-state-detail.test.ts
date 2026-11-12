/**
 * 客户详情的三态几样（P-界面-19，构想页 C10–C13；lib/enterprise/tri-state-detail.ts）：
 *   - 状态条：活跃 / 三态关着 / 市场成员名下不出；沉睡、待回收、暂缓回收中各按身份给按钮（服务端算好），和按钮动作同一套判定
 *   - 冷项目：线索 / 商机项目没动静满标冷天数才标，换节点、挂项目的沟通清掉
 *   - 状态留痕的说法、短沟通提示的原因
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 三态夜扫 } from "@/lib/enterprise/tri-state-db";
import { 加天 } from "@/lib/enterprise/tri-state";
import { 继续持有, 暂缓回收动作, 让同事结束项目动作 } from "@/lib/enterprise/tri-state-hold";
import { 读三态条, 读客户三态, 读冷项目, 留痕说法, 短沟通提示, 冷项目看沟通条数, 能看理由 } from "@/lib/enterprise/tri-state-detail";
import { 读组织 } from "@/lib/enterprise/org";
import { 无效沟通原因of, 短沟通话of } from "@/lib/enterprise/tri-state-quota";
import { 默认组织规则, 默认三态规则, type 组织规则 } from "@/lib/project/org-rules";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 等通知推完 } from "@/lib/enterprise/notify";

/** 用设置里的起算日（默认组织规则），不写死日子 */
const 起 = 默认组织规则.超时回收.起算日!;
const 日 = (n: number) => 加天(起, n);
const 早 = (n: number) => new Date(`${日(n)}T00:10:00+08:00`);
const 白天 = (n: number) => new Date(`${日(n)}T10:00:00+08:00`);
const 开三态 = (): 组织规则 => ({ ...默认组织规则, 三态: { ...默认三态规则, 开: true } });

const 人 = {} as Record<"乙" | "丙" | "甲" | "总内" | "总外" | "系", { id: string; name: string }>;
let 客户: string;
const 条 = (k: keyof typeof 人, n: number) => 读三态条(人[k], 客户, 白天(n));
const 按钮 = async (k: keyof typeof 人, n: number) => ((await 条(k, n))?.按钮们 ?? []).map((b) => b.字);
/** 照客户详情页那样：客户行连钟读一次递进去 */
const 页面三态 = async (k: keyof typeof 人, n: number) => {
  const c = (await prisma.customer.findUnique({ where: { id: 客户 }, select: { id: true, name: true, salesOwnerId: true, bizLine: true, poolInvalidAt: true, pool: { select: { customerId: true } }, entClock: true } }))!;
  return 读客户三态(人[k], c, new Map(Object.values(人).map((u) => [u.id, u.name])), 白天(n));
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
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
  vi.unstubAllEnvs();
});

describe("C10 状态条", () => {
  it("三态关着、活跃：都不出条；关着时连客户钟都不查", async () => {
    await 三态夜扫(早(5));
    expect(await 条("乙", 5)).toBeNull();
    await setSetting("orgRules", { ...默认组织规则 });
    await 三态夜扫(早(95));
    const 查 = vi.spyOn(prisma.entCustomerClock, "findUnique");
    expect(await 条("乙", 95)).toBeNull();
    expect(查).not.toHaveBeenCalled();
  });

  it("沉睡：本人「我还在跟」（悬停写额度）；上级第 30 天前只有说明、之后能代选；别人只有说明", async () => {
    await 三态夜扫(早(95));
    const 本人 = (await 条("乙", 95))!;
    expect(本人).toMatchObject({ 状态: "沉睡", 文字: "已 95 天没有动静 · 再 85 天进入待回收", 悬停: "已 95 天没有动静 · 再 85 天进入待回收（动静指有效沟通或项目推进）" });
    expect(本人.按钮们).toMatchObject([{ 动作: "继续持有", 字: "我还在跟", 要理由: false, 主: true }]);
    expect(本人.按钮们[0].说明).toBe("「我还在跟」和「写理由继续持有」共用一个额度：每次顺延 30 天、钟不归零；沉睡轮、待回收轮各限一次；累计最多 3 次、合计 90 天；已用 0 次");
    expect(本人.旁注).toContain("客户转让");
    expect(await 条("甲", 95)).toMatchObject({ 按钮们: [], 旁注: "沉睡满 30 天（第 120 天）起你也能代选「我还在跟」" });
    expect(await 条("丙", 95)).toMatchObject({ 按钮们: [], 旁注: "沉睡阶段由负责人和直属上级处理" });
    expect(await 条("总内", 95)).toMatchObject({ 按钮们: [] });
    await 三态夜扫(早(121));
    expect(await 按钮("甲", 121)).toEqual(["我还在跟"]);
  });

  it("沉睡：本轮点过了不再给按钮，说一句为什么；额度用完换成「额度已用完」那句", async () => {
    await 三态夜扫(早(95));
    expect(await 继续持有(人.乙, 客户, null, 白天(95))).toMatchObject({ ok: true });
    // 推后 30 天，第 125 天还在沉睡
    await 三态夜扫(早(125));
    const 再 = (await 条("乙", 125))!;
    expect(再.状态).toBe("沉睡");
    expect(再.按钮们).toEqual([]);
    expect(再.旁注).toBeTruthy();
    await prisma.entCustomerStateLog.createMany({
      data: [130, 131].map((n) => ({ customerId: 客户, fromState: "沉睡", toState: "沉睡", via: "本人", userId: 人.乙.id, reason: "我还在跟", holdDays: 30, at: 白天(n) })),
    });
    await 三态夜扫(早(200));
    expect((await 条("乙", 200))?.旁注).toBe("额度已用完，可以转让、退回公海，或记一条有效沟通");
  });

  it("待回收：本人、直属上级、本线总管理、系统管理员都给「写理由继续持有」（要理由）；别线总管理、无关的人只有说明", async () => {
    await 三态夜扫(早(185));
    const 总 = (await 条("总内", 185))!;
    expect(总.状态).toBe("待回收");
    expect(总.文字).toMatch(/^\d+ 天后自动进公海 · 已提醒 0\/3 次$/);
    expect(总.按钮们).toMatchObject([{ 动作: "继续持有", 字: "写理由继续持有", 要理由: true }]);
    for (const k of ["乙", "甲", "系"] as const) expect(await 条(k, 185)).toMatchObject({ 按钮们: [{ 动作: "继续持有", 字: "写理由继续持有", 要理由: true }] });
    expect(await 条("乙", 185)).toMatchObject({ 旁注: "已推给条线总管理裁决" });
    expect(await 按钮("总外", 185)).toEqual([]);
    expect(await 按钮("丙", 185)).toEqual([]);
  });

  it("暂缓回收中：线总、系统管理员看到客户转让 / 让同事结束项目 / 暂缓回收；30 天内换掉暂缓；其余人只有说明", async () => {
    await 被挡到期();
    const 总 = (await 条("总内", 210))!;
    expect(总).toMatchObject({ 状态: "暂缓回收中", 文字: "到期该进公海，但名下有 1 位同事在推的项目，收不了" });
    expect(总.按钮们.map((b) => b.字)).toEqual(["客户转让", "让同事结束项目", "暂缓回收"]);
    expect(await 按钮("系", 210)).toEqual(总.按钮们.map((b) => b.字));
    expect(await 暂缓回收动作(人.总内, 客户, null, 白天(210))).toEqual({ ok: true });
    const 后 = (await 条("总内", 215))!;
    expect(后.按钮们.map((b) => b.字)).toEqual(["客户转让", "让同事结束项目"]);
    expect(后.旁注).toContain("天内不用再裁决");
  });
  it("负责人是市场成员：不计时，不出条", async () => {
    await 三态夜扫(早(95));
    await prisma.entMember.update({ where: { userId: 人.乙.id }, data: { bizRole: "marketing_mgr" } });
    expect(await 条("乙", 95)).toBeNull();
  });
});

/** 第 210 天：到期该进公海、被同事丙在推的项目挡住 */
async function 被挡到期() {
  await prisma.project.create({ data: { name: "同事的项目", customerId: 客户, ownerId: 人.丙.id, creatorId: 人.丙.id, createdAt: new Date("2026-10-20T10:00:00+08:00") } });
  await 三态夜扫(早(180));
  await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 3, lastNoticeDay: 日(200) } });
  await 三态夜扫(早(210));
}

/** 逐身份：界面给的按钮都能调成，没给的服务端都拒（丙是同线同事、和这位客户无关） */
const 身份们 = [["本人", "乙"], ["直属上级", "甲"], ["本线总管理", "总内"], ["别线总管理", "总外"], ["系统管理员", "系"], ["无关的人", "丙"]] as const;
describe("C10 逐身份：按钮和服务端判定一致", () => {
  it.each(身份们)("待回收 · %s：有「写理由继续持有」⇔ 写理由继续持有能成", async (_, k) => {
    await 三态夜扫(早(185));
    const 给 = (await 条(k, 185))!.按钮们.some((b) => b.动作 === "继续持有");
    expect((await 继续持有(人[k], 客户, "还在谈合同", 白天(185))).ok).toBe(给);
    expect(给).toBe(k !== "总外" && k !== "丙");
  });

  for (const 动作 of ["继续持有", "暂缓回收", "让同事结束项目"] as const) {
    it.each(身份们)(`暂缓回收中 · %s：「${动作}」给 ⇔ 能调`, async (_, k) => {
      await 被挡到期();
      const 给 = (await 条(k, 210))!.按钮们.some((b) => b.动作 === 动作);
      const 调 = 动作 === "继续持有" ? 继续持有(人[k], 客户, "还在谈合同", 白天(210))
        : 动作 === "暂缓回收" ? 暂缓回收动作(人[k], 客户, null, 白天(210)) : 让同事结束项目动作(人[k], 客户, 白天(210));
      expect((await 调).ok).toBe(给);
      if (动作 !== "继续持有") expect(给).toBe(k === "总内" || k === "系");
    });
  }
});

describe("C11 冷项目", () => {
  it("线索 / 商机没动静满 90 天标冷（从起算日数）；换节点、挂项目的沟通清掉；订单、结束了、关着都不标", async () => {
    const 建 = (name: string, x: object = {}) => prisma.project.create({ data: { name, customerId: 客户, ownerId: 人.乙.id, creatorId: 人.乙.id, createdAt: new Date("2026-10-01T10:00:00+08:00"), ...x } }).then((p) => p.id);
    const 线索 = await 建("线索的"), 换过 = await 建("换过节点"), 沟通过 = await 建("记过沟通"), 订单 = await 建("订单的", { phase: "订单", node: "签约" }), 丢了 = await 建("丢单的", { result: "丢单" });
    await prisma.projectNodeLog.create({ data: { projectId: 换过, userId: 人.乙.id, toPhase: "线索", toNode: "初步接触", at: 白天(30) } });
    await prisma.followUp.create({ data: { customerId: 客户, ownerId: 人.乙.id, type: "PHONE", title: "", content: "电话聊了预算", status: "已完成", occurredAt: 白天(40), createdAt: 白天(40), projectNode: { create: { projectId: 沟通过, node: "初步接触" } } } });
    const ids = [线索, 换过, 沟通过, 订单, 丢了];
    expect(await 读冷项目(ids, 白天(89))).toEqual({});
    expect(await 读冷项目(ids, 白天(90))).toEqual({ [线索]: 90 });
    expect(await 读冷项目(ids, 白天(130))).toEqual({ [线索]: 130, [换过]: 100, [沟通过]: 90 });
    await setSetting("orgRules", { ...默认组织规则 });
    const 查 = vi.spyOn(prisma, "$queryRawUnsafe");
    expect(await 读冷项目(ids, 白天(130))).toEqual({});
    expect(查).not.toHaveBeenCalled();
  });

  const 挂沟通 = (项目: string, content: string, 日期: number, 写入: number) => prisma.followUp.create({
    data: { customerId: 客户, ownerId: 人.乙.id, type: "PHONE", title: "", content, status: "已完成", occurredAt: 白天(日期), createdAt: 白天(写入), projectNode: { create: { projectId: 项目, node: "初步接触" } } },
  });
  const 冷的线索 = async () => (await prisma.project.create({ data: { name: "线索", customerId: 客户, ownerId: 人.乙.id, creatorId: 人.乙.id, createdAt: new Date("2026-10-01T10:00:00+08:00") } })).id;

  it("无效沟通不算动静、也不兜底：最近 50 多条都无效时往前翻到第一条有效的；一条有效的都没有只看建档和换节点", async () => {
    const p = await 冷的线索();
    await prisma.followUp.createMany({ data: Array.from({ length: 冷项目看沟通条数 + 5 }, (_, i) => ({ customerId: 客户, ownerId: 人.乙.id, type: "PHONE", title: "", content: "OK", status: "已完成", occurredAt: 白天(100 + (i % 10)), createdAt: 白天(100 + (i % 10)) })) });
    const 无效们 = await prisma.followUp.findMany({ where: { content: "OK" }, select: { id: true } });
    await prisma.followUpProject.createMany({ data: 无效们.map((f) => ({ followUpId: f.id, projectId: p, node: "初步接触" })) });
    // 一条有效的都没有：从起算日数（不拿无效的兜底）
    expect(await 读冷项目([p], 白天(120))).toEqual({ [p]: 120 });
    // 第 30 天那条有效的排在 55 条无效的后面：翻到它
    await 挂沟通(p, "电话聊了预算和交付时间", 30, 30);
    expect(await 读冷项目([p], 白天(120))).toEqual({ [p]: 90 });
  });

  it("B3：挂项目的无效短沟通、只有素材没文字（空内容 / 只有纪要链接）不清冷标；一条有效沟通清掉", async () => {
    const p = await 冷的线索();
    await 挂沟通(p, "OK", 100, 100);
    await 挂沟通(p, "", 100, 100);
    await 挂沟通(p, "https://x.cn/minutes/1", 100, 100);
    await 挂沟通(p, "跟进", 100, 100);
    expect(await 读冷项目([p], 白天(100))).toEqual({ [p]: 100 });
    await 挂沟通(p, "电话聊了预算和交付时间", 100, 100);
    expect(await 读冷项目([p], 白天(100))).toEqual({});
  });

  it("M-公海-54 沟通生效日：今天补录沟通日期 100 天前的有效沟通，冷标不变；今天写、日期今天的清掉；写成未来日期的按写入时间", async () => {
    const p = await 冷的线索();
    expect(await 读冷项目([p], 白天(120))).toEqual({ [p]: 120 });
    // 补录：沟通日期第 20 天（100 天前），今天写进来——按沟通日期算动静，还冷着（天数从第 20 天数）
    await 挂沟通(p, "电话聊了预算和交付时间", 20, 120);
    expect(await 读冷项目([p], 白天(120))).toEqual({ [p]: 100 });
    // 今天写、日期填成第 200 天：按写入时间（今天）算，正好清掉——换一个项目单看
    const q = await 冷的线索();
    await 挂沟通(q, "电话聊了预算和交付时间", 200, 20);
    expect(await 读冷项目([q], 白天(120))).toEqual({ [q]: 100 });
    await 挂沟通(p, "电话聊了预算和交付时间", 120, 120);
    expect(await 读冷项目([p], 白天(120))).toEqual({});
  });

  it("冷标只在客户活跃时出：沉睡的客户页面不读冷项目（客户三态.活跃 = false）", async () => {
    await 三态夜扫(早(5));
    expect((await 页面三态("乙", 5))!.活跃).toBe(true);
    await 三态夜扫(早(95));
    expect((await 页面三态("乙", 95))!.活跃).toBe(false);
  });
});

describe("C13 状态留痕 / C12 短沟通", () => {
  it("留痕说法：状态变化、继续持有、裁决、撤销转让各一句；三态关着不读", async () => {
    expect(留痕说法({ fromState: "活跃", toState: "沉睡", via: "自动", reason: "满 90 天没有有效沟通", holdDays: null })).toBe("活跃 → 沉睡（满 90 天没有有效沟通）");
    expect(留痕说法({ fromState: "沉睡", toState: "沉睡", via: "上级代选", reason: "由 甲 代选：我还在跟", holdDays: 30 })).toBe("继续持有，顺延 30 天：由 甲 代选：我还在跟");
    expect(留痕说法({ fromState: "待回收", toState: "待回收", via: "总管理裁决", reason: "暂缓回收", holdDays: null })).toBe("暂缓回收");
    expect(留痕说法({ fromState: null, toState: "活跃", via: "撤销转让·计次", reason: null, holdDays: null })).toBe("撤销转让（计入 7 天内撤销次数）");
    await 三态夜扫(早(95));
    await 继续持有(人.乙, 客户, null, 白天(95));
    const 行们 = (await 页面三态("乙", 95))!.留痕;
    expect(行们.slice(0, 2)).toEqual(expect.arrayContaining([
      expect.objectContaining({ 谁: "乙", 事: "继续持有，顺延 30 天：我还在跟" }),
      expect.objectContaining({ 谁: "系统", 事: "沉睡 → 活跃（继续持有顺延 30 天，三个节点一起往后挪）" }),
    ]));
    expect(行们.at(-1)!.谁).toBe("系统");
    await setSetting("orgRules", { ...默认组织规则 });
    expect(await 页面三态("乙", 95)).toBeNull();
  });

  it("B1：理由原文只有本人、上级链、本线总管理、系统管理员看得到；别线总管理、同事只看做了什么", async () => {
    await 三态夜扫(早(185));
    expect(await 继续持有(人.总内, 客户, "下周签合同", 白天(185))).toMatchObject({ ok: true });
    const 那条 = async (k: keyof typeof 人) => (await 页面三态(k, 186))!.留痕.find((x) => x.事.startsWith("继续持有"))!.事;
    for (const k of ["乙", "甲", "总内", "系"] as const) expect(await 那条(k)).toBe("继续持有，顺延 30 天：由 总内 代选：下周签合同");
    for (const k of ["总外", "丙"] as const) expect(await 那条(k)).toBe("继续持有，顺延 30 天");
    expect(留痕说法({ fromState: "待回收", toState: "待回收", via: "总管理裁决", reason: "暂缓回收：月底前结项", holdDays: null }, false)).toBe("暂缓回收");
    expect(留痕说法({ fromState: "活跃", toState: "沉睡", via: "自动", reason: "满 90 天没有有效沟通", holdDays: null }, false)).toBe("活跃 → 沉睡（满 90 天没有有效沟通）");
  });

  it("B1 理由可见：上级链穿过停用的中间一级往上数；负责人停用、客户没填业务线时本线总管理按主干兜底（落到系统管理员）", async () => {
    const 建 = async (k: string, active = true) => (await prisma.user.create({ data: { email: k, name: k, title: "", role: "SALES", password: "x", active } })).id;
    const 上 = await 建("上"), 中 = await 建("中", false);
    await prisma.entMember.createMany({ data: [{ userId: 上, bizRole: "sales_mgr", line: "内贸" }, { userId: 中, bizRole: "sales_mgr", line: "内贸", managerId: 上 }] });
    await prisma.entMember.update({ where: { userId: 人.乙.id }, data: { managerId: 中 } });
    const 看 = async (id: string, c: { salesOwnerId: string; bizLine: string | null }) => 能看理由({ id }, await 读组织(), c);
    const 客 = { salesOwnerId: 人.乙.id, bizLine: null };
    expect(await 看(上, 客)).toBe(true);
    expect(await 看(中, 客)).toBe(false);
    expect(await 看(人.甲.id, 客)).toBe(false);
    expect(await 看(人.总内.id, 客)).toBe(true); // 客户线没填按负责人的线
    expect(await 看(人.总外.id, 客)).toBe(false);
    // 负责人停用、客户没填线：找条线总管理 落到系统管理员；停用前的上级链照样往上
    await prisma.user.update({ where: { id: 人.乙.id }, data: { active: false } });
    expect(await 看(人.总内.id, 客)).toBe(false);
    expect(await 看(人.系.id, 客)).toBe(true);
    expect(await 看(上, 客)).toBe(true);
    // 客户填了线：本线总管理照看得到
    expect(await 看(人.总内.id, { ...客, bizLine: "内贸" })).toBe(true);
  });

  it("短沟通：原因按同一个判定；客户在计时才提示，AI 起草的、三态关着的不提示", async () => {
    expect([无效沟通原因of("Call"), 无效沟通原因of("跟进"), 无效沟通原因of("https://x.cn/a"), 无效沟通原因of("电话聊了预算"), 无效沟通原因of("跟进跟进已联系")])
      .toEqual(["太短", "占位词", "只有链接", null, "占位词"]);
    expect(短沟通话of({ ok: true, 短沟通: "太短" })).toBe("已保存。这条太短，不计入有效沟通，不会重置回收倒计时");
    expect(短沟通话of({ ok: true })).toBeNull();
    const 记 = (content: string) => prisma.followUp.create({ data: { customerId: 客户, ownerId: 人.乙.id, type: "PHONE", title: "", content, status: "已完成" } }).then((f) => f.id);
    const 短 = await 记("OK");
    expect(await 短沟通提示(短)).toBeNull(); // 还没有钟（夜扫没跑过）
    await 三态夜扫(早(5));
    expect(await 短沟通提示(短)).toBe("太短");
    expect(await 短沟通提示(await 记("电话聊了预算"))).toBeNull();
    // 按库里存下的内容判：库里改成了有效内容就不提示
    await prisma.followUp.update({ where: { id: 短 }, data: { content: "电话聊了预算和交付时间" } });
    expect(await 短沟通提示(短)).toBeNull();
    const ai = await 记("OK");
    await prisma.followUpSource.create({ data: { followUpId: ai, text: "速记原文" } });
    expect(await 短沟通提示(ai)).toBeNull();
    expect(await 短沟通提示("没有这条")).toBeNull();
    // 判的时候出错当没有，不抛（传个坏 id 让查库报错）
    await expect(短沟通提示({ bad: 1 } as unknown as string)).resolves.toBeNull();
    const 又短 = await 记("OK");
    expect(await 短沟通提示(又短)).toBe("太短");
    await setSetting("orgRules", { ...默认组织规则 });
    expect(await 短沟通提示(短)).toBeNull();
  });
});

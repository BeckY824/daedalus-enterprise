/**
 * 首页卡「即将逾期」、复盘「将回公海」在库里先筛得更紧（11-10，代码体检 P3）：
 * 粗筛只卡建项目那天，开了超时回收后几乎每个在推项目都过得去；紧筛再卡最近留痕、客户最近跟进、起算日。
 * 两种筛都只是必要条件，取回来照旧逐个算回收日——这里把各种起点、下一步、节点天数、起算日排列出来，
 * 两种筛数出来的项目逐个一样，紧筛取回来的行不多于粗筛。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss@local", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 即将逾期, 即将逾期粗筛, 即将逾期紧筛 } from "@/lib/project/home-cards";
import { 即将逾期的项目 } from "@/lib/project/home-cards-db";
import { 将回公海of } from "@/lib/project/review-extras-db";
import { 项目回收日, 算超时要的, 超时成员线 } from "@/lib/project/db";
import { 默认组织规则, type 组织规则 } from "@/lib/project/org-rules";
import { 存组织规则 } from "@/lib/project/org-rules-store";
import { 字典of } from "@/lib/project/stage-dict";
import { dayjs } from "@/lib/utils";

let 老板 = "";
const 此刻 = new Date();
const 今天 = dayjs(此刻).startOf("day");
/** 几天前（负数 = 几天后）的哪一刻：中午、零点、零点前 1 毫秒——筛的线都卡在零点上 */
const 刻 = (几天前: number, 哪: "午" | "零" | "前" = "午") => {
  const d = 今天.subtract(几天前, "day");
  return (哪 === "午" ? d.add(12, "hour") : 哪 === "零" ? d : d.subtract(1, "millisecond")).toDate();
};

const 建于们 = [刻(0), 刻(3), 刻(4), 刻(5), 刻(6), 刻(8), 刻(30), 刻(4, "零"), 刻(4, "前"), 刻(3, "零"), 刻(3, "前")];
const 留痕们 = [null, 刻(1), 刻(4, "零"), 刻(4, "前"), 刻(5), 刻(9)];
const 跟进们 = [null, 刻(2), 刻(4, "零"), 刻(4, "前"), 刻(10)];
const 下一步们 = [null, 刻(10), 刻(1), 刻(-1), 刻(-2, "零"), 刻(-3, "前"), 刻(-3, "零"), 刻(-5)];
// [阶段, 节点, 业务线]
// 明确需求是痛点挖掘的旧名（库里两种都有）；方案敲定下面的规则里没单设（按默认 7 天）；乱写的节点也按默认
const 位置们: [string, string, string | null][] = [
  ["线索", "潜客培育", null], ["线索", "线索验证", "内贸"], ["商机", "明确需求", null], ["线索", "潜客培育", "外贸"],
  ["商机", "痛点挖掘", "外贸"], ["商机", "方案敲定", null], ["线索", "线索验证", "外贸"], ["商机", "不认识的节点", null], ["商机", "痛点挖掘", null],
];

/** 规则几种：只有默认天数、两套节点天数、各种起算日（没设、正好卡在线上、挡掉按天数到的、还没到、存坏了） */
const 规则of = (超时: Partial<组织规则["超时回收"]>): 组织规则 => ({ ...默认组织规则, 超时回收: { 开: true, 起算日: null, 节点天数: {}, 外贸节点天数: {}, ...超时 } });
const 日 = (几天前: number) => 今天.subtract(几天前, "day").format("YYYY-MM-DD");
const 两套 = { 节点天数: { 潜客培育: 5, 线索验证: 10 }, 外贸节点天数: { 潜客培育: 3 } };
// 天数差得远的：线索验证 60 天（外贸 4 天）、痛点挖掘按旧名 key 设 6 天（外贸按新名设 2 天）、潜客培育 60 天
const 长短 = { 节点天数: { 潜客培育: 60, 线索验证: 60, 明确需求: 6 }, 外贸节点天数: { 线索验证: 4, 痛点挖掘: 2 } };
const 全六十 = { 节点天数: Object.fromEntries(["潜客培育", "线索验证", "痛点挖掘", "方案敲定"].map((n) => [n, 60])), 外贸节点天数: {} };
const 规则们: [string, 组织规则][] = [
  ["只有默认 7 天", 规则of({})],
  ["两套节点天数", 规则of(两套)],
  ["默认 7 天 + 起算日 4 天前（正好还到得了）", 规则of({ 起算日: 日(4) })],
  ["默认 7 天 + 起算日 3 天前（按天数一个都到不了）", 规则of({ 起算日: 日(3) })],
  ["两套 + 起算日 2 天前", 规则of({ ...两套, 起算日: 日(2) })],
  ["两套 + 起算日昨天", 规则of({ ...两套, 起算日: 日(1) })],
  ["起算日在明天", 规则of({ 起算日: 日(-1) })],
  ["起算日很早", 规则of({ ...两套, 起算日: 日(400) })],
  ["起算日存坏了", 规则of({ ...两套, 起算日: "不是日子" })],
  ["天数长短不一", 规则of(长短)],
  ["天数长短不一 + 起算日 2 天前", 规则of({ ...长短, 起算日: 日(2) })],
  ["天数长短不一 + 起算日 5 天前", 规则of({ ...长短, 起算日: 日(5) })],
  ["设了的节点全是 60 天", 规则of(全六十)],
  ["设了的节点全是 60 天 + 起算日 9 天前", 规则of({ ...全六十, 起算日: 日(9) })],
  ["只按新名设了 3 天（库里存旧名的项目也按 3 天）", 规则of({ 节点天数: { 痛点挖掘: 3 } })],
  ["有个天数存成了负数", 规则of({ 节点天数: { 潜客培育: -2, 线索验证: 10 } })],
];
const 今们 = [此刻, 今天.add(2, "day").add(9, "hour").toDate(), 今天.subtract(1, "day").toDate()];

/** 改前的数法：粗筛取回来，逐个算回收日 */
async function 按粗筛(规则: 组织规则, 今: Date, 带成员线 = true): Promise<{ ids: string[]; 取回: number }> {
  const 粗 = 即将逾期粗筛(规则, 字典of(true), 今);
  if (!粗) return { ids: [], 取回: 0 };
  const [们, 成员] = await Promise.all([prisma.project.findMany({ where: 粗, select: 算超时要的 }), 带成员线 ? 超时成员线(规则) : null]);
  return { ids: 们.filter((p) => 即将逾期(项目回收日(规则, p, 成员), 今)).map((p) => p.id).sort(), 取回: 们.length };
}
const 我 = <T,>(fn: () => Promise<T>) => 以谁的身份(老板, fn);

beforeAll(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  老板 = (await raw.user.create({ data: { email: "boss", name: "老板", title: "", role: "ADMIN", password: "x" } })).id;
  await raw.entMember.create({ data: { userId: 老板, bizRole: "director" } });
  // 没填业务线的老项目按负责人的线：一位外贸的负责人
  const 外贸人 = (await raw.user.create({ data: { email: "fx", name: "外贸", title: "", role: "SALES", password: "x" } })).id;
  await raw.entMember.create({ data: { userId: 外贸人, bizRole: "sales", line: "外贸" } });
  mocks.user = { ...mocks.user, id: 老板 };
  忘掉企业版范围();
  // 客户最近跟进挂在客户上：每种跟进时间一位客户，外加一位在客户公海里的
  await raw.customer.createMany({ data: 跟进们.map((t, i) => ({ id: `c${i}`, name: `客户${i}`, phone: `1390000000${i}`, salesOwnerId: 老板, lastFollowAt: t })) });
  await raw.customer.create({ data: { id: "c-pool", name: "公海客户", phone: "13900000099", salesOwnerId: 老板, lastFollowAt: 刻(30), pool: { create: { reason: "手动" } } } });
  const 项目: Record<string, unknown>[] = [];
  const 留痕: Record<string, unknown>[] = [];
  let n = 0;
  for (const [a, 建于] of 建于们.entries()) for (const [b, 痕] of 留痕们.entries()) for (const [c] of 跟进们.entries()) for (const [d, 下一步] of 下一步们.entries()) {
    const [phase, node, bizLine] = 位置们[n % 位置们.length];
    const id = `p-${a}-${b}-${c}-${d}`;
    项目.push({ id, name: id, customerId: `c${c}`, ownerId: n % 7 === 0 ? 外贸人 : 老板, creatorId: 老板, phase, node, bizLine, createdAt: 建于, nextStepAt: 下一步 });
    if (痕) {
      // 更早还有一条：认的是最近那条
      留痕.push({ projectId: id, kind: "node", userId: 老板, toPhase: phase, toNode: node, at: 刻(40) });
      留痕.push({ projectId: id, kind: n % 2 ? "transfer" : "node", userId: 老板, toPhase: phase, toNode: node, at: 痕 });
    }
    n++;
  }
  // 不该算的几种：有结局的、在项目公海的、订单阶段的、客户在客户公海的、验证中的
  const 快到 = { customerId: "c0", ownerId: 老板, creatorId: 老板, phase: "线索", node: "潜客培育", createdAt: 刻(6) };
  项目.push({ ...快到, id: "x-结局", name: "x1", result: "线索流失" }, { ...快到, id: "x-公海", name: "x2", pooledAt: 刻(1) }, { ...快到, id: "x-订单", name: "x3", phase: "订单", node: "签订合同" });
  项目.push({ ...快到, id: "x-客户公海", name: "x4", customerId: "c-pool" }, { ...快到, id: "x-验证中", name: "x5" }, { ...快到, id: "x-算", name: "x6" });
  for (let i = 0; i < 项目.length; i += 500) await raw.project.createMany({ data: 项目.slice(i, i + 500) as never });
  for (let i = 0; i < 留痕.length; i += 500) await raw.projectNodeLog.createMany({ data: 留痕.slice(i, i + 500) as never });
  await raw.entLeadVerify.create({ data: { projectId: "x-验证中", verdict: "初验无效", pending: "市场复核" } });
}, 120_000);
afterAll(async () => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
  await prisma.$disconnect();
});

describe("即将逾期：紧筛和粗筛数出来的一样", () => {
  it("超时回收没开、一个天数都没有：两种筛都没有", () => {
    expect(即将逾期紧筛(默认组织规则, 字典of(true))).toBeNull();
    expect(即将逾期紧筛(规则of({}), 字典of(false))).toBeNull();
    expect(即将逾期粗筛(规则of({}), 字典of(false))).toBeNull();
  });

  for (const [名, 规则] of 规则们) {
    it(`${名}：每个「今天」数出来的项目逐个一样，取回来的不多于粗筛`, async () => {
      for (const 今 of 今们) {
        const 旧 = await 我(() => 按粗筛(规则, 今));
        const 新 = (await 我(() => 即将逾期的项目(规则, 今))).sort();
        expect(新, `${名} ${今.toISOString()}`).toEqual(旧.ids);
        const 紧取回 = await 我(() => prisma.project.count({ where: 即将逾期紧筛(规则, 字典of(true), 今)! }));
        expect(紧取回).toBeLessThanOrEqual(旧.取回);
        expect(紧取回).toBeGreaterThanOrEqual(新.length);
      }
    }, 60_000);
  }

  it("不是两边都空着对上的：有数得出来的、有被筛掉的，不该算的几种都不在里面", async () => {
    // 默认 7 天：三样起点都得早于 3 天前才可能按天数到
    const 规则 = 规则of({});
    const 旧 = await 我(() => 按粗筛(规则, 此刻));
    expect(旧.ids.length).toBeGreaterThan(100);
    expect(旧.ids).toContain("x-算");
    for (const id of ["x-结局", "x-公海", "x-订单", "x-客户公海", "x-验证中"]) expect(旧.ids).not.toContain(id);
    const 紧取回 = await 我(() => prisma.project.count({ where: 即将逾期紧筛(规则, 字典of(true), 此刻)! }));
    expect(紧取回).toBeLessThan(旧.取回);
    expect(旧.取回 - 紧取回).toBeGreaterThan(100);
    // 起算日挡掉按天数到的：只剩按下一步到的，取回来的少得多
    const 挡 = 规则of({ 起算日: 日(3) });
    const 挡旧 = await 我(() => 按粗筛(挡, 此刻));
    expect(挡旧.ids.length).toBeGreaterThan(0);
    expect(await 我(() => prisma.project.count({ where: 即将逾期紧筛(挡, 字典of(true), 此刻)! }))).toBeLessThan(挡旧.取回 * 0.6);
    // 设了的节点全是 60 天：粗筛按最短的默认 7 天卡，几乎全取回来；紧筛按各节点自己的天数卡
    const 长 = 规则of(全六十);
    const 长旧 = await 我(() => 按粗筛(长, 此刻));
    expect(长旧.ids.length).toBeGreaterThan(0);
    expect(await 我(() => prisma.project.count({ where: 即将逾期紧筛(长, 字典of(true), 此刻)! }))).toBeLessThan(长旧.取回 - 300);
  });

  it("复盘「将回公海」：存下规则后数出来的和粗筛一样（那边不看成员业务线）", async () => {
    for (const 规则 of [规则of(两套), 规则of({ 起算日: 日(4) })]) {
      await 存组织规则(规则);
      const 旧 = await 我(() => 按粗筛(规则, 此刻, false));
      const r = await 我(() => 将回公海of(undefined, 此刻));
      expect(r.提醒.总数).toBe(旧.ids.length);
      expect(r.预警.length).toBeGreaterThan(0);
      for (const x of r.预警) expect(旧.ids).toContain(x.id);
    }
  }, 60_000);
});

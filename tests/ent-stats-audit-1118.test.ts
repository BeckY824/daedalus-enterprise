/**
 * 审核 11-18 统计数字 P1-1 / P1-2 / P1-3 的修复：
 *   P1-1 首页「暂未跟进」、数据页「缺沟通」只认现负责人在项目上记的沟通：建档的人（市场）记的首条、原负责人记的不算；删了的不算
 *   P1-2 AI query_metric 在企业版只用项目时：新增线索 / 线索转化率按项目（线索起步）数，签约单数 / 金额按「商机 → 订单」节点变更数；
 *        老表 Lead、Contract 没数据也答得出；补建、历史分析回填的不算
 *   P1-3 渠道页：关联线索 = 眼下还在线索阶段（没结局），线索流失的不算；有效线索 = 线索验证判了有效的，和看板「有效线索」同一个数；
 *        点关联线索进项目列表带 open=1，条数对得上
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss@local", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/feishu-push", () => ({ 推通知们: async () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 数首页卡 } from "@/lib/project/home-cards-db";
import { 读项目列表 } from "@/lib/project/list";
import { 缺沟通of } from "@/lib/project/review-extras-db";
import { runQuery } from "@/lib/report-run";
import { getBusiness } from "@/lib/business";
import { 补建创建人, 历史分析来源 } from "@/lib/project/system-created";
import { 算分期统计, 算看板底数, type 看板项目 } from "@/lib/enterprise/channel-dash";
import { 名单链接, 公海名单链接, type 统计用项目 } from "@/lib/enterprise/channel-stats";
import { 字典of } from "@/lib/project/stage-dict";

let 老板 = "";
let 市场 = "";
let 销售 = "";
let 客户 = "";

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("business", { projectMode: true } as never);
  const 人 = async (email: string, name: string, bizRole: string, role = "SALES") => {
    const id = (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole } });
    return id;
  };
  老板 = await 人("boss", "老板", "director", "ADMIN");
  市场 = await 人("mkt", "市场", "channel_ops");
  销售 = await 人("sales", "销售", "sales");
  mocks.user = { ...mocks.user, id: 老板, role: "ADMIN" };
  客户 = (await prisma.customer.create({ data: { name: "编的客户", phone: "13900000001", salesOwnerId: 销售 } })).id;
});
afterEach(() => vi.unstubAllEnvs());

const 沟通 = async (项目: string, 谁: string, 额外: { deletedAt?: Date } = {}) => {
  const f = await prisma.followUp.create({ data: { type: "PHONE", title: "电话", content: "聊了需求", customerId: 客户, ownerId: 谁, ...额外 } });
  await prisma.followUpProject.create({ data: { followUpId: f.id, projectId: 项目, node: "潜客培育" } });
};

describe("P1-1 暂未跟进只认现负责人记的沟通", () => {
  it("市场建、首条沟通是市场记的、分给销售：算暂未跟进；销售自己记一条才不算；删了的不算", async () => {
    const 分来的 = (await prisma.project.create({ data: { name: "分来的", customerId: 客户, ownerId: 销售, creatorId: 市场 } })).id;
    await 沟通(分来的, 市场);
    const 自己建的 = (await prisma.project.create({ data: { name: "自己建的", customerId: 客户, ownerId: 市场, creatorId: 市场 } })).id;
    await 沟通(自己建的, 市场);

    const 卡 = async (id: string, role: string) => (await 数首页卡({ id, role }, new Date(), ["no-follow"]))["no-follow"];
    const 列 = async (u: { id: string; role: string }) => (await 读项目列表({ id: u.id, name: "x", role: u.role }, { f: "no-follow" })).行.map((r) => r.name);
    expect(await 卡(老板, "ADMIN")).toBe(1);
    expect(await 列({ id: 老板, role: "ADMIN" })).toEqual(["分来的"]);
    expect(await 卡(销售, "SALES")).toBe(1);
    const 缺 = await 缺沟通of(undefined);
    expect(缺.总数).toBe(1);
    expect(缺.行.map((r) => r.名)).toEqual(["分来的"]);
    expect((await 缺沟通of(销售)).总数).toBe(1);
    expect((await 缺沟通of(市场)).总数).toBe(0);

    // 销售记了一条但删了：还是没跟进
    await 沟通(分来的, 销售, { deletedAt: new Date() });
    expect(await 卡(老板, "ADMIN")).toBe(1);
    // 销售自己记一条：不算了
    await 沟通(分来的, 销售);
    expect(await 卡(老板, "ADMIN")).toBe(0);
    expect(await 列({ id: 老板, role: "ADMIN" })).toEqual([]);
    expect((await 缺沟通of(undefined)).总数).toBe(0);
  });

  it("换了负责人：原负责人记的沟通不算新负责人跟进过", async () => {
    const p = (await prisma.project.create({ data: { name: "转来的", customerId: 客户, ownerId: 老板, creatorId: 老板 } })).id;
    await 沟通(p, 老板);
    expect((await 数首页卡({ id: 老板, role: "ADMIN" }, new Date(), ["no-follow"]))["no-follow"]).toBe(0);
    await prisma.project.update({ where: { id: p }, data: { ownerId: 销售 } });
    expect((await 数首页卡({ id: 老板, role: "ADMIN" }, new Date(), ["no-follow"]))["no-follow"]).toBe(1);
  });
});

describe("P1-2 AI query_metric 企业版按项目数", () => {
  const 本月 = () => {
    const d = new Date();
    const 月 = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { from: `${月}-01`, to: null };
  };
  it("新增线索 / 转化率：线索起步的新项目，补建、历史分析、商机起步的不算；老 Lead 表是空的也有数", async () => {
    const 建 = async (name: string, data: Record<string, unknown> = {}, 起步 = "线索") => {
      const p = await prisma.project.create({ data: { name, customerId: 客户, ownerId: 销售, creatorId: 销售, ...data } });
      await prisma.projectNodeLog.create({ data: { projectId: p.id, userId: 销售, kind: "node", fromPhase: null, toPhase: 起步, toNode: "x" } });
      return p.id;
    };
    await 建("线索一");
    await 建("线索二已转商机", { phase: "商机", node: "明确需求" });
    await 建("线索三流失", { result: "线索流失" });
    await 建("直接商机", { phase: "商机", node: "明确需求" }, "商机");
    await 建("补建的", { creatorId: 补建创建人 });
    await 建("历史分析的", { source: 历史分析来源 });
    expect(await prisma.lead.count()).toBe(0);
    const b = await getBusiness();
    const 数 = await runQuery({ metric: "leads_count", groupBy: null, ...本月() }, b);
    expect(数).toEqual([expect.objectContaining({ value: 3 })]);
    const 按人 = await runQuery({ metric: "leads_count", groupBy: "sales", ...本月() }, b);
    expect(按人).toEqual([expect.objectContaining({ label: "销售", value: 3 })]);
    const 率 = await runQuery({ metric: "lead_conversion", groupBy: null, ...本月() }, b);
    expect(率[0].value).toBeCloseTo((1 / 3) * 100, 0);
  });

  it("签约单数 / 金额：这一段里从商机进订单的项目，一个项目只数一次；历史分析的、老合同表都不碰", async () => {
    const 建 = async (name: string, amount: number, currency = "CNY", data: Record<string, unknown> = {}) =>
      (await prisma.project.create({ data: { name, customerId: 客户, ownerId: 销售, creatorId: 销售, phase: "订单", node: "交付验收", amount, currency, ...data } })).id;
    const 进订单 = (projectId: string, at = new Date(), userId = 销售) =>
      prisma.projectNodeLog.create({ data: { projectId, userId, kind: "node", fromPhase: "商机", toPhase: "订单", toNode: "x", at } });
    const a = await 建("甲单", 1000);
    await 进订单(a);
    await 进订单(a); // 来回改：只算一次
    const b2 = await 建("乙单", 200, "USD");
    await 进订单(b2);
    const 老的 = await 建("上上月的", 5000);
    await 进订单(老的, new Date(Date.now() - 70 * 86_400_000));
    const 回填 = await 建("回填的", 9000, "CNY", { source: 历史分析来源 });
    await 进订单(回填);
    expect(await prisma.contract.count()).toBe(0);
    const b = await getBusiness();
    expect(await runQuery({ metric: "contract_count", groupBy: null, ...本月() }, b)).toEqual([expect.objectContaining({ value: 2 })]);
    const 金额 = await runQuery({ metric: "contract_amount", groupBy: "sales", ...本月() }, b);
    expect(金额).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "销售（CNY）", value: 1000, currency: "CNY" }),
      expect.objectContaining({ label: "销售（USD）", value: 200, currency: "USD" }),
    ]));
    expect(金额).toHaveLength(2);
  });
});

describe("P1-3 渠道页关联线索 / 有效线索", () => {
  const 京 = (s: string) => new Date(`${s}+08:00`);
  const 今 = 京("2026-11-18T10:00:00");
  const 本月某天 = 京("2026-11-05T10:00:00");

  it("同一渠道同一档：列表有效线索 = 看板有效（S-01）；关联线索不含线索流失", () => {
    process.env.CRM_ENTERPRISE = "1";
    const 列表项目: 统计用项目[] = [
      { channelId: "c", phase: "线索", result: "线索流失", amount: 0, currency: "CNY", createdAt: 本月某天, 起步阶段: "线索", 到过阶段们: ["线索"], 节点们: [], 判定: "无效线索" },
      { channelId: "c", phase: "线索", result: null, amount: 0, currency: "CNY", createdAt: 本月某天, 起步阶段: "线索", 到过阶段们: ["线索"], 节点们: [], 判定: "有效线索" },
      { channelId: "c", phase: "线索", result: null, amount: 0, currency: "CNY", createdAt: 本月某天, 起步阶段: "线索", 到过阶段们: ["线索"], 节点们: [], 判定: null },
      { channelId: "c", phase: "商机", result: null, amount: 0, currency: "CNY", createdAt: 本月某天, 起步阶段: "线索", 到过阶段们: ["线索", "商机"], 节点们: [], 判定: "有效线索" },
    ];
    const 看板项目们: 看板项目[] = 列表项目.map((p) => ({ channelId: p.channelId, phase: p.phase, result: p.result, amount: 0, currency: "CNY", createdAt: p.createdAt!, 判定: p.判定 ?? null, 起步: "线索", 节点们: [] }));
    const 列表 = 算分期统计([{ id: "c", createdAt: new Date("2026-01-01"), endDate: null }], 列表项目, [], 今, 字典of(true));
    const 看板 = 算看板底数(["c"], 看板项目们, [], 今);
    for (const 期 of ["本月", "全部"] as const) {
      expect(列表[期].c.有效线索).toBe(看板[期].c.有效);
      expect(列表[期].c.有效线索).toBe(2);
      expect(列表[期].c.关联线索).toBe(2);
    }
  });

  it("点关联线索带 open=1：项目列表只列没结局的，条数和渠道页一致", async () => {
    expect(名单链接("c1", "关联线索")).toBe("/projects?channelId=c1&phase=%E7%BA%BF%E7%B4%A2&open=1");
    expect(公海名单链接("c1", "关联线索")).toBe("/pool?projChannel=c1&phase=%E7%BA%BF%E7%B4%A2&open=1");
    const ch = (await prisma.channel.create({ data: { name: "展会", channelOwnerId: 市场 } })).id;
    await prisma.project.create({ data: { name: "还在", customerId: 客户, ownerId: 销售, creatorId: 销售, channelId: ch } });
    await prisma.project.create({ data: { name: "流失了", customerId: 客户, ownerId: 销售, creatorId: 销售, channelId: ch, result: "线索流失" } });
    const 列 = async (sp: Record<string, string>) => (await 读项目列表({ id: 老板, name: "老板", role: "ADMIN" }, sp)).行.map((r) => r.name).sort();
    expect(await 列({ channelId: ch, phase: "线索" })).toEqual(["流失了", "还在"]);
    expect(await 列({ channelId: ch, phase: "线索", open: "1" })).toEqual(["还在"]);
  });
});

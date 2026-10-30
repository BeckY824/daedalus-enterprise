/**
 * 企业版渠道 10-30 这一批：
 * - B1 谁能管渠道：新建、编辑、停用、删除只有老板、总管理员、市场管理；销售管理、渠道运营、销售直调动作也挡，库里不动。团队版照旧不挡。
 * - B2 渠道统计的范围：和客户列表同一套「按组织看客户」——老板、总管理员数全部，别人只数自己看得见的项目。
 * - B5 两个转化率：线索→商机、商机→订单，按「到过的最远阶段」算；导入时直接落在后面阶段的不进前一步的分母；分母 0 是 null。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "a@x", role: "ADMIN", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { saveChannel, toggleChannel, deleteChannel } from "@/app/(app)/channels/actions";
import { 读渠道统计 } from "@/lib/enterprise/channel-stats-db";
import { 算转化, 算渠道统计, 不能管渠道, type 统计用项目 } from "@/lib/enterprise/channel-stats";
import { 转化率字 } from "../src/app/(app)/overview/funnel";

let 老板: string, 总管: string, 市场经理: string, 销售经理: string, 负责人: string, 销售: string, 销售乙: string;
let 渠道: string;

const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role }; };
const 角色 = (id: string) => (id === 老板 ? "ADMIN" : "SALES");

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  const 建人 = async (email: string, name: string, role: string, bizRole?: string) => {
    const id = (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
    if (bizRole) await prisma.entMember.create({ data: { userId: id, bizRole } });
    return id;
  };
  老板 = await 建人("boss", "老板", "ADMIN");
  总管 = await 建人("dir", "总管", "SALES", "director");
  市场经理 = await 建人("mm", "市场经理", "SALES", "marketing_mgr");
  销售经理 = await 建人("sm", "销售经理", "SALES", "sales_mgr");
  负责人 = await 建人("own", "渠道运营", "SALES", "channel_ops");
  销售 = await 建人("s1", "销售甲", "SALES", "sales");
  销售乙 = await 建人("s2", "销售乙", "SALES", "sales");
  渠道 = (await prisma.channel.create({ data: { name: "抖音|官方号", attr: "公域引流", platform: "抖音", channelOwnerId: 负责人 } })).id;
  当(老板, "ADMIN");
});
afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("B1 谁能新建、编辑、停用、删除渠道", () => {
  const 新建 = (source: string) =>
    saveChannel({ name: "", phone: null, remark: null, channelOwnerId: 负责人, attr: "公域引流", platform: "小红书", source });

  it("老板、总管理员、市场管理：新建、编辑、停用、删除都行", async () => {
    for (const [i, id] of [老板, 总管, 市场经理].entries()) {
      当(id, 角色(id));
      const r = await 新建(`店铺${i}`);
      expect(r.ok).toBe(true);
      const 新id = (r as { id: string }).id;
      expect(await saveChannel({ id: 新id, name: "", phone: null, remark: "改过", channelOwnerId: 负责人, attr: "公域引流", platform: "小红书", source: `店铺${i}` })).toMatchObject({ ok: true });
      expect(await toggleChannel(新id, false)).toEqual({ ok: true });
      expect(await deleteChannel(新id)).toEqual({ ok: true });
    }
    expect(await prisma.channel.count()).toBe(1);
  });

  it("销售管理、渠道运营、销售：四样都挡，库里不动；先挡权限、不先报表单哪里没填", async () => {
    for (const id of [销售经理, 负责人, 销售]) {
      当(id);
      expect(await 新建("店铺")).toEqual({ ok: false, error: 不能管渠道 });
      expect(await saveChannel({ name: "", phone: null, remark: null, attr: "" })).toEqual({ ok: false, error: 不能管渠道 });
      expect(await saveChannel({ id: 渠道, name: "", phone: null, remark: "偷改", channelOwnerId: 负责人, attr: "公域引流", platform: "抖音", source: "官方号" })).toEqual({ ok: false, error: 不能管渠道 });
      expect(await toggleChannel(渠道, false)).toEqual({ ok: false, error: 不能管渠道 });
      expect(await deleteChannel(渠道)).toEqual({ ok: false, error: 不能管渠道 });
    }
    expect(不能管渠道).toMatch(/只有.{0,24}(能|可以|才|有权)/);
    expect(await prisma.channel.findMany({ select: { id: true, remark: true, active: true } })).toEqual([{ id: 渠道, remark: null, active: true }]);
    expect(await prisma.auditLog.count({ where: { entity: "Channel" } })).toBe(0);
  });

  it("团队版不挡：销售照旧能停用", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    当(销售);
    expect(await toggleChannel(渠道, false)).toEqual({ ok: true });
  });

  it("开了按组织看客户：市场管理删渠道也数全部客户，别人名下挂着客户的照样删不了", async () => {
    await setSetting(规则.按组织看客户.key, true);
    invalidateSettingsCache();
    忘掉企业版范围();
    await prisma.customer.create({ data: { name: "客户一", phone: "13800000021", salesOwnerId: 销售, channelId: 渠道 } });
    当(市场经理);
    // 市场管理不是总管理员，按组织看客户只看得见自己的——不数全部的话这里会当成空渠道删掉
    expect(await 以谁的身份(市场经理, () => prisma.customer.count({ where: { channelId: 渠道 } }))).toBe(0);
    const r = await 以谁的身份(市场经理, () => deleteChannel(渠道));
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/已有 1 名/) });
    expect(await prisma.channel.count({ where: { id: 渠道 } })).toBe(1);
  });
});

describe("B2 渠道统计跟着按组织看客户的范围", () => {
  beforeEach(async () => {
    await setSetting("business", { projectMode: true });
    await setSetting(规则.按组织看客户.key, true);
    invalidateSettingsCache();
    忘掉企业版范围();
    // 各挂各的客户：甲 线索 1、订单 1；乙 商机 1
    const 甲客户 = (await prisma.customer.create({ data: { name: "客户一", phone: "13800000031", salesOwnerId: 销售, channelId: 渠道 } })).id;
    const 乙客户 = (await prisma.customer.create({ data: { name: "客户二", phone: "13800000032", salesOwnerId: 销售乙, channelId: 渠道 } })).id;
    const 建 = (ownerId: string, customerId: string, phase: string, amount = 0) =>
      prisma.project.create({ data: { name: `p-${phase}`, customerId, ownerId, creatorId: ownerId, phase, amount, currency: "CNY" } });
    await 建(销售, 甲客户, "线索");
    await 建(销售, 甲客户, "订单", 300);
    await 建(销售乙, 乙客户, "商机");
  });

  const 统 = async (id: string) =>
    (await 以谁的身份(id, () => 读渠道统计([{ id: 渠道, createdAt: new Date("2026-10-01T00:00:00"), endDate: null }], new Date("2026-10-30T12:00:00"))))[渠道];

  it("老板、总管理员数全部 3 个项目", async () => {
    for (const id of [老板, 总管]) expect(await 统(id)).toMatchObject({ 关联线索: 1, 关联商机: 1, 关联订单: 1, 关联项目: 3, 累计成交: [{ 币种: "CNY", 合计: 300 }] });
  });

  it("销售只数自己的；和客户列表看得见的是同一批", async () => {
    expect(await 统(销售)).toMatchObject({ 关联线索: 1, 关联商机: 0, 关联订单: 1, 关联项目: 2, 累计成交: [{ 币种: "CNY", 合计: 300 }] });
    expect(await 统(销售乙)).toMatchObject({ 关联线索: 0, 关联商机: 1, 关联订单: 0, 关联项目: 1, 累计成交: [] });
    expect(await 以谁的身份(销售乙, () => prisma.customer.count({ where: { channelId: 渠道 } }))).toBe(1);
    // 渠道运营名下没有客户：一个都不数
    expect(await 统(负责人)).toMatchObject({ 关联项目: 0 });
  });
});

describe("B5 两个转化率", () => {
  const 项 = (phase: string, 起步阶段?: string, 到过阶段们?: string[]): 统计用项目 => ({ channelId: "a", phase, result: null, amount: 0, currency: "CNY", 起步阶段, 到过阶段们 });

  it("按到过的最远阶段算：退回去的也算到过；导入直接落在商机、订单的不进前一步的分母", () => {
    const z = 算转化([
      项("商机", "线索", ["线索", "商机"]), // 线索→商机
      项("线索", "线索", ["线索", "商机", "线索"]), // 到过商机又退回线索：算到过
      项("线索", "线索", ["线索"]), // 还在线索
      项("订单", "订单", ["订单"]), // 导入直接进订单：两个分母都不进
      项("订单", "商机", ["商机", "订单"]), // 导入落在商机、后来进订单：只进商机→订单
      项("订单"), // 没日志的老数据：当从线索起，走到了订单
    ]);
    expect(z.线索转商机).toEqual({ 分子: 3, 分母: 4, 比例: 0.75 });
    expect(z.商机转订单).toEqual({ 分子: 2, 分母: 4, 比例: 0.5 });
  });

  it("丢单、线索流失不挪阶段：丢单的算到过商机、没到订单", () => {
    const z = 算转化([{ ...项("商机", "线索", ["线索", "商机"]), result: "丢单" }, { ...项("线索", "线索", ["线索"]), result: "线索流失" }]);
    expect(z.线索转商机).toEqual({ 分子: 1, 分母: 2, 比例: 0.5 });
    expect(z.商机转订单).toEqual({ 分子: 0, 分母: 1, 比例: 0 });
    expect(转化率字(z.商机转订单.比例)).toBe("0%");
  });

  it("分母 0：比例 null，显示「—」", () => {
    const 空 = 算转化([]);
    expect(空).toEqual({ 线索转商机: { 分子: 0, 分母: 0, 比例: null }, 商机转订单: { 分子: 0, 分母: 0, 比例: null } });
    expect(转化率字(空.线索转商机.比例)).toBe("—");
    // 全是导入直接进订单的：两个分母都是 0
    const 全订单 = 算转化([项("订单", "订单", ["订单"])]);
    expect(全订单.线索转商机.比例).toBeNull();
    expect(全订单.商机转订单.比例).toBeNull();
    // 只有线索：线索→商机 0%，商机→订单 没有分母
    const 只线索 = 算转化([项("线索")]);
    expect(只线索).toEqual({ 线索转商机: { 分子: 0, 分母: 1, 比例: 0 }, 商机转订单: { 分子: 0, 分母: 0, 比例: null } });
  });

  it("算渠道统计带上两个转化率；没给起步、到过的照眼下阶段算", () => {
    const s = 算渠道统计(
      [{ id: "a", createdAt: new Date("2026-10-01T00:00:00"), endDate: null }, { id: "b", createdAt: new Date("2026-10-01T00:00:00"), endDate: null }],
      [项("线索"), 项("商机"), 项("订单"), 项("订单")],
      [],
      new Date("2026-10-30T12:00:00"),
    );
    expect(s.a.线索转商机).toEqual({ 分子: 3, 分母: 4, 比例: 0.75 });
    expect(s.a.商机转订单).toEqual({ 分子: 2, 分母: 3, 比例: 2 / 3 });
    expect(s.b.线索转商机.比例).toBeNull();
    expect(s.b.商机转订单.比例).toBeNull();
  });

  it("读库：起步、到过从节点日志取，转让这类不挪阶段的日志不算", async () => {
    const 客户 = (await prisma.customer.create({ data: { name: "客户一", phone: "13800000041", salesOwnerId: 销售, channelId: 渠道 } })).id;
    const 建 = async (phase: string, 日志: [string | null, string, string?][]) => {
      const p = await prisma.project.create({ data: { name: `p-${phase}`, customerId: 客户, ownerId: 销售, creatorId: 销售, phase } });
      let t = Date.parse("2026-10-01T00:00:00");
      for (const [from, to, kind] of 日志) {
        await prisma.projectNodeLog.create({ data: { projectId: p.id, userId: 销售, at: new Date((t += 60_000)), fromPhase: from, toPhase: to, toNode: "x", kind: kind ?? "node" } });
      }
    };
    await 建("商机", [[null, "线索"], ["线索", "商机"]]);
    await 建("线索", [[null, "线索"], ["线索", "商机"], ["商机", "线索"]]); // 导入覆盖退回线索
    await 建("线索", [[null, "线索"], ["线索", "线索", "transfer"]]);
    await 建("订单", [[null, "订单"]]); // 导入直接进订单
    await 建("订单", [[null, "商机"], ["商机", "订单"]]); // 导入落在商机
    await 建("订单", []); // 没日志的老数据
    const 统 = (await 读渠道统计([{ id: 渠道, createdAt: new Date("2026-10-01T00:00:00"), endDate: null }], new Date("2026-10-30T12:00:00")))[渠道];
    expect(统.线索转商机).toEqual({ 分子: 3, 分母: 4, 比例: 0.75 });
    expect(统.商机转订单).toEqual({ 分子: 2, 分母: 4, 比例: 0.5 });
  });

  it("读库：项目过千不崩（Prisma 嵌套 orderBy 的坑），日志乱序写入也按时间算", async () => {
    const 客户 = (await prisma.customer.create({ data: { name: "客户一", phone: "13800000042", salesOwnerId: 销售, channelId: 渠道 } })).id;
    const 项目们 = await prisma.project.createManyAndReturn({
      data: Array.from({ length: 1200 }, (_, i) => ({ name: `p${i}`, customerId: 客户, ownerId: 销售, creatorId: 销售, phase: "线索" })),
      select: { id: true },
    });
    const t0 = Date.parse("2026-10-01T00:00:00");
    // 先写后一步、再写建项目那条，库里顺序和时间顺序反着
    await prisma.projectNodeLog.createMany({
      data: 项目们.flatMap(({ id }, i) => [
        ...(i < 300 ? [{ projectId: id, userId: 销售, at: new Date(t0 + 120_000), fromPhase: "线索", toPhase: "商机", toNode: "x", kind: "node" }] : []),
        { projectId: id, userId: 销售, at: new Date(t0 + 60_000), fromPhase: null, toPhase: "线索", toNode: "x", kind: "node" },
      ]),
    });
    const 统 = (await 读渠道统计([{ id: 渠道, createdAt: new Date("2026-10-01T00:00:00"), endDate: null }], new Date("2026-10-30T12:00:00")))[渠道];
    expect(统.线索转商机).toEqual({ 分子: 300, 分母: 1200, 比例: 0.25 });
  });
});

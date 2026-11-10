/**
 * 上线前全面测试 · 超时回收（11-02）：按 c1 现在的配置（9 个线索 / 商机节点内贸、外贸都 60 天，起算日 2026-11-01）
 *   - 纯算：11-01 建的 12-31 收；老数据（9 月建的）从 11-01 起算；下一步时间提前收；订单阶段不收
 *   - 真库扫：第 59 天不收、第 60 天收（上海时区零点前后）；外贸一样；有结局 / 已在公海 / 订单阶段不收
 *   - 收了：负责人清空（C-01）、留痕记系统、原负责人一条待办 + 一条「回收」铃铛；同一天扫两遍不重复
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 公海超时收回, 超时预览 } from "@/lib/project/db";
import { 超时回收日, 已超时, 超时理由, 即将回收 } from "@/lib/project/timeout";
import { 规整组织规则, type 组织规则 } from "@/lib/project/org-rules";
import { 企业版字典 } from "@/lib/project/stage-dict";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";

const 九个 = ["潜客培育", "线索验证", "线索推进", "明确需求", "共识方案", "成交推进", "签约审批", "签订合同", "首款支付"];
const 六十 = Object.fromEntries(九个.map((n) => [n, 60]));
/** c1 上 orgRules 的超时块原样（key 是团队版老名） */
const c1原样 = { 超时回收: { 开: true, 节点天数: 六十, 外贸节点天数: { ...六十 }, 起算日: "2026-11-01" }, 阶段: { 推进权限: "负责人可推", 出口叫法: {}, 前两节点要沟通: true } };
const 规则: 组织规则 = 规整组织规则(c1原样, 企业版字典);
/** 上海时间 */
const 沪 = (s: string) => new Date(`${s}+08:00`);

describe("c1 60 天：回收日纯算", () => {
  const 线索 = { phase: "线索", node: "潜客培育" };

  it("11-01 上午建的：12-31 收；12-30 不算超时、12-31 算", () => {
    const 日 = 超时回收日(规则, 线索, 沪("2026-11-01T10:00:00"), 企业版字典, "内贸");
    expect(日).toBe("2026-12-31");
    expect(已超时(日, 沪("2026-12-30T23:59:00"))).toBe(false);
    expect(已超时(日, 沪("2026-12-31T00:01:00"))).toBe(true);
    expect(即将回收(日, 沪("2026-12-30T09:00:00"))).toBe(true);
    expect(即将回收(日, 沪("2026-12-29T09:00:00"))).toBe(false);
  });

  it("11-01 凌晨 0:30（上海）建的也是同一天起算", () => {
    expect(超时回收日(规则, 线索, 沪("2026-11-01T00:30:00"), 企业版字典, "内贸")).toBe("2026-12-31");
  });

  it("老数据（9 月建的）从起算日 11-01 算，也是 12-31", () => {
    expect(超时回收日(规则, 线索, 沪("2026-09-01T10:00:00"), 企业版字典, "内贸")).toBe("2026-12-31");
  });

  it("11-05 建的 → 2027-01-04（跨年）", () => {
    expect(超时回收日(规则, 线索, 沪("2026-11-05T15:00:00"), 企业版字典, "外贸")).toBe("2027-01-04");
  });

  it("下一步时间 11-10：那天过完就收（11-11），比 60 天早", () => {
    expect(超时回收日(规则, { ...线索, nextStepAt: 沪("2026-11-10T09:00:00") }, 沪("2026-11-01T10:00:00"), 企业版字典, "内贸")).toBe("2026-11-11");
  });

  it("下一步时间在 60 天之后：不延长，还是 12-31", () => {
    expect(超时回收日(规则, { ...线索, nextStepAt: 沪("2027-02-01T09:00:00") }, 沪("2026-11-01T10:00:00"), 企业版字典, "内贸")).toBe("2026-12-31");
  });

  it("商机节点（新名旧名）同样 60 天；订单阶段、有结局、已在公海不收", () => {
    expect(超时回收日(规则, { phase: "商机", node: "痛点挖掘" }, 沪("2026-11-01T10:00:00"), 企业版字典, "内贸")).toBe("2026-12-31");
    expect(超时回收日(规则, { phase: "商机", node: "明确需求" }, 沪("2026-11-01T10:00:00"), 企业版字典, "外贸")).toBe("2026-12-31");
    expect(超时回收日(规则, { phase: "商机", node: "首款到账" }, 沪("2026-11-01T10:00:00"), 企业版字典, "外贸")).toBe("2026-12-31");
    expect(超时回收日(规则, { phase: "订单", node: "生产备货" }, 沪("2026-11-01T10:00:00"), 企业版字典, "内贸")).toBeNull();
    expect(超时回收日(规则, { ...线索, result: "线索流失" }, 沪("2026-11-01T10:00:00"), 企业版字典, "内贸")).toBeNull();
    expect(超时回收日(规则, { ...线索, pooledAt: 沪("2026-11-02T10:00:00") }, 沪("2026-11-01T10:00:00"), 企业版字典, "内贸")).toBeNull();
  });
});

describe("c1 60 天：真库扫", () => {
  let 老板: { id: string; name: string };
  let 销售甲: { id: string; name: string };
  let 外贸销售: { id: string; name: string };

  async function 人(email: string, name: string, role: string) {
    const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
    return { id: u.id, name: u.name };
  }
  /** 一个项目一个客户（单项目客户会跟着进客户公海，别让项目之间互相影响） */
  async function 项目(ownerId: string, 名: string, 补: Record<string, unknown> = {}) {
    const c = await prisma.customer.create({ data: { name: `${名}的客户`, phone: "", salesOwnerId: ownerId || 老板.id } });
    return prisma.project.create({ data: { name: 名, customerId: c.id, ownerId, creatorId: ownerId, createdAt: 沪("2026-11-01T10:00:00"), ...补 } });
  }
  /** 换一天扫之前清缓存（同一份规则一天只扫一次，按日期 + 规则记号） */
  const 扫 = (今: Date) => { invalidateSettingsCache(); return 公海超时收回(老板, 今); };

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    老板 = await 人("boss@x", "老板", "ADMIN");
    销售甲 = await 人("a@x", "销售甲", "SALES");
    外贸销售 = await 人("b@x", "外贸销售", "SALES");
    await prisma.entMember.createMany({
      data: [
        { userId: 老板.id, bizRole: "director" },
        { userId: 销售甲.id, bizRole: "sales", line: "内贸" },
        { userId: 外贸销售.id, bizRole: "sales", line: "外贸" },
      ],
    });
    await setSetting("orgRules", c1原样);
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("第 59 天（12-30 23:59）不收，第 60 天（12-31 00:01）收；外贸项目一样", async () => {
    const 内 = await 项目(销售甲.id, "内贸项目", { bizLine: "内贸" });
    const 外 = await 项目(外贸销售.id, "外贸项目", { bizLine: "外贸" });
    expect(await 超时预览(规则, 沪("2026-12-30T23:59:00"))).toBe(0);
    expect(await 扫(沪("2026-12-30T23:59:00"))).toBe(0);
    expect(await 超时预览(规则, 沪("2026-12-31T00:01:00"))).toBe(2);
    expect(await 扫(沪("2026-12-31T00:01:00"))).toBe(2);
    for (const id of [内.id, 外.id]) {
      const p = await prisma.project.findUniqueOrThrow({ where: { id } });
      expect(p.pooledAt).not.toBeNull();
      expect(p.ownerId).toBe("");
      expect(p.nextStepAt).toBeNull();
      expect(p.nextStepText).toBeNull();
    }
  });

  it("老数据（9 月建、没动过）：11-02 不收（从 11-01 起算）、12-31 收", async () => {
    const p = await 项目(销售甲.id, "老项目", { createdAt: 沪("2026-09-01T10:00:00") });
    expect(await 扫(沪("2026-11-02T09:00:00"))).toBe(0);
    expect(await 扫(沪("2026-12-30T09:00:00"))).toBe(0);
    expect(await 扫(沪("2026-12-31T09:00:00"))).toBe(1);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).pooledAt).not.toBeNull();
  });

  it("收了：留痕记系统 + 超时理由、原负责人一条待办 + 一条「回收」铃铛；同一天再扫一遍不重复", async () => {
    const p = await 项目(销售甲.id, "一号项目", { nextStepText: "约演示", nextStepAt: 沪("2026-11-10T09:00:00") });
    expect(await 扫(沪("2026-11-10T20:00:00"))).toBe(0); // 下一步那天还没过完
    expect(await 扫(沪("2026-11-11T08:00:00"))).toBe(1);
    expect(await 扫(沪("2026-11-11T18:00:00"))).toBe(0);
    const 痕 = await prisma.projectNodeLog.findMany({ where: { projectId: p.id, kind: "pool-release" } });
    expect(痕).toHaveLength(1);
    expect(痕[0]).toMatchObject({ fromOwnerId: 销售甲.id, toOwnerId: null, reason: 超时理由, userId: "system" });
    // 前一天（11-10）扫的时候先发了一条「明天会收」的提醒；收的那天再一条「已收回」
    const 待办 = await prisma.task.findMany({ where: { ownerId: 销售甲.id }, orderBy: { createdAt: "asc" } });
    expect(待办.map((t) => t.title)).toEqual([
      expect.stringContaining("2026-11-11 会自动回到线索公海"),
      expect.stringContaining("「一号项目」在「潜客培育」超过处理时长"),
    ]);
    const 铃 = await prisma.entNotice.findMany({ where: { userId: 销售甲.id, kind: "回收" } });
    expect(铃).toHaveLength(1);
    expect(铃[0].title).toContain("一号项目");
    // 老板没收到（只发原负责人）
    expect(await prisma.entNotice.count({ where: { userId: 老板.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "pool", entity: "Project" } })).toBe(1);
  });

  it("有结局、已在公海、订单阶段的：到了 60 天也不动", async () => {
    const 结局 = await 项目(销售甲.id, "结局项目", { result: "线索流失" });
    const 公海 = await 项目("", "公海项目", { pooledAt: 沪("2026-11-02T10:00:00") });
    const 订单 = await 项目(销售甲.id, "订单项目", { phase: "订单", node: "生产备货" });
    expect(await 扫(沪("2027-03-01T09:00:00"))).toBe(0);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 结局.id } })).ownerId).toBe(销售甲.id);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 公海.id } })).pooledAt?.toISOString()).toBe(沪("2026-11-02T10:00:00").toISOString());
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 订单.id } })).pooledAt).toBeNull();
  });

  it("商机节点存旧名（明确需求）的老项目：一样 60 天收、待办写新名「痛点挖掘」", async () => {
    await 项目(销售甲.id, "商机项目", { phase: "商机", node: "明确需求" });
    expect(await 扫(沪("2026-12-30T09:00:00"))).toBe(0);
    expect(await 扫(沪("2026-12-31T09:00:00"))).toBe(1);
    const 待办 = await prisma.task.findFirstOrThrow({ where: { ownerId: 销售甲.id } });
    expect(待办.title).toContain("「痛点挖掘」");
  });

  it("客户上记了跟进（12-01）：起点往后挪到 12-01，12-31 不收、2027-01-30 收", async () => {
    const p = await 项目(销售甲.id, "跟进过的项目");
    await prisma.customer.update({ where: { id: p.customerId }, data: { lastFollowAt: 沪("2026-12-01T10:00:00") } });
    expect(await 扫(沪("2026-12-31T09:00:00"))).toBe(0);
    expect(await 扫(沪("2027-01-29T09:00:00"))).toBe(0);
    expect(await 扫(沪("2027-01-30T09:00:00"))).toBe(1);
  });
  it("X-78 验证中（等复核 / 等销售）的线索不参与超时回收、也不发「明天收回」；验证走完（没在等）照常收", async () => {
    const 等复核 = await 项目(销售甲.id, "等复核的线索", { node: "线索验证" });
    const 等销售 = await 项目(销售甲.id, "等销售的线索", { node: "线索验证" });
    const 走完 = await 项目(销售甲.id, "验证走完的线索", { node: "线索验证" });
    await prisma.entLeadVerify.createMany({
      data: [
        { projectId: 等复核.id, verdict: "初验无效", pending: "市场复核" },
        { projectId: 等销售.id, verdict: "初验无效", pending: "销售终验" },
        { projectId: 走完.id, verdict: "有效线索", pending: null },
      ],
    });
    expect(await 扫(沪("2026-12-30T09:00:00"))).toBe(0);
    const 提醒 = await prisma.task.findMany({ where: { ownerId: 销售甲.id } });
    expect(提醒.map((t) => t.title).join("|")).not.toMatch(/等复核|等销售/);
    expect(await 超时预览(规则, 沪("2026-12-31T09:00:00"))).toBe(1);
    expect(await 扫(沪("2026-12-31T09:00:00"))).toBe(1);
    for (const p of [等复核, 等销售]) expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).pooledAt).toBeNull();
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 走完.id } })).pooledAt).not.toBeNull();
  });
});

/**
 * 合并客户第二批 2b · 跨负责人合并申请数据层（lib/enterprise/merge-request.ts；客户 E-280 / E-331 一.1）：
 *   - 要谁同意按人去重：一人多个项目只出一次，列出他涉及的项目；发起人自己不算
 *   - 发起人：留下那家的负责人是销售才由他发；不是销售（渠运）时由直属上级或能接分配的销售发
 *   - 5 个工作日到期失效（跨周末）；到期那一刻点同意也失效；扫过期
 *   - 执行前只比四项：负责人、阶段、回款或提成、被判无效各自触发；节点、客户状态、名字变了不重判
 *   - 全同意后照第一批执行合并，申请经过和合并前快照进合并单、两家操作日志
 *   - 动作层（customers/merge-actions.ts）：发起 / 同意拒绝 / 撤回 / 作废 / 两张列表按登录的人判；每分钟的钟扫过期
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
const 登录 = vi.hoisted(() => ({ 人: null as null | { id: string; name: string; role: string } }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<object>()), requireUser: async () => ({ email: "", title: "", ...登录.人! }) }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 撤回合并 } from "@/lib/enterprise/customer-merge";
import {
  算同意人, 发起人问题, 到期时刻, 比四项, 发起合并申请, 处理合并申请, 撤回合并申请, 扫过期合并申请, 到期话, 申请状态,
  钟上扫过期合并申请, 等待工作日, 直接并话, type 快照,
} from "@/lib/enterprise/merge-request";
import {
  发起客户合并申请, 处理客户合并申请, 撤回客户合并申请, 作废客户合并申请, 等我同意的合并申请, 我发起的合并申请, 预览合并申请,
} from "@/app/(app)/customers/merge-actions";
import { 等待工作日 as 界面等待工作日 } from "@/app/(app)/customers/merge-request-words";
import type { 组织 } from "@/lib/enterprise/org";

type 人 = { id: string; name: string; role: string };
let 老板: 人, 乙: 人, 丙: 人, 丁: 人, 渠运: 人, 销管: 人, 外贸销售: 人;
let 序 = 0;

async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await raw.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name, role };
}
async function 客户(ownerId: string, 补: Record<string, unknown> = {}) {
  序++;
  return (await raw.customer.create({
    data: { name: `测试客户${序}`, phone: "", salesOwnerId: ownerId, contacts: { create: { name: `联系人${序}`, phone: `1390001${String(序).padStart(4, "0")}`, isPrimary: true } }, ...补 },
  })).id;
}
async function 项目(ownerId: string, customerId: string, 补: Record<string, unknown> = {}) {
  return (await raw.project.create({ data: { name: `项目${++序}`, customerId, ownerId, creatorId: ownerId || 老板.id, ...补 } })).id;
}
const 申请 = (id: string) => raw.entMergeRequest.findUniqueOrThrow({ where: { id }, include: { approvers: true } });
/** 2026-11-27 是周五；北京 15:00 = UTC 07:00 */
const 周五下午 = new Date("2026-11-27T07:00:00Z");

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "ADMIN");
  乙 = await 造人("yi", "乙", "SALES");
  丙 = await 造人("bing", "丙", "SALES");
  丁 = await 造人("ding", "丁", "SALES");
  渠运 = await 造人("qy", "渠运甲", "SALES");
  销管 = await 造人("xg", "销管甲", "SALES");
  外贸销售 = await 造人("wm", "外贸甲", "SALES");
  await raw.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" }, { userId: 乙.id, bizRole: "sales" }, { userId: 丙.id, bizRole: "sales" }, { userId: 丁.id, bizRole: "sales" },
      { userId: 渠运.id, bizRole: "channel_ops", managerId: null }, { userId: 销管.id, bizRole: "sales_mgr" }, { userId: 外贸销售.id, bizRole: "sales", line: "外贸" },
    ],
  });
  await setSetting("business", { projectMode: true });
});
afterEach(async () => {
  await 等通知推完();
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("要谁同意：按人去重", () => {
  it("纯函数：同一人是被并负责人又负责三个项目，只出一行、列三个项目；发起人和负责人空的不算", () => {
    const A = { id: "A", salesOwnerId: "我" }, B = { id: "B", salesOwnerId: "丙" };
    const 们 = 算同意人("我", A, B, [
      { id: "p1", name: "一", customerId: "B", ownerId: "丙" },
      { id: "p2", name: "二", customerId: "B", ownerId: "丙" },
      { id: "p3", name: "三", customerId: "A", ownerId: "丙" },
      { id: "p4", name: "四", customerId: "A", ownerId: "我" },
      { id: "p5", name: "五", customerId: "A", ownerId: "" },
      { id: "p6", name: "六", customerId: "B", ownerId: "丁" },
    ]);
    expect(们).toEqual([
      { userId: "丙", 凭: ["被并客户负责人", "项目负责人"], 项目: [{ id: "p1", name: "一", customerId: "B" }, { id: "p2", name: "二", customerId: "B" }, { id: "p3", name: "三", customerId: "A" }] },
      { userId: "丁", 凭: ["项目负责人"], 项目: [{ id: "p6", name: "六", customerId: "B" }] },
    ]);
  });

  it("发起后库里一人一行：结束了的、项目公海里的项目不算", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id);
    await 项目(丙.id, b);
    await 项目(丙.id, b);
    await 项目(丙.id, a);
    await 项目(丁.id, b, { result: "丢单" });
    await 项目(丁.id, a, { pooledAt: new Date() });
    const r = await 发起合并申请(prisma, a, b, 乙, { 现在: 周五下午 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const 单 = await 申请(r.requestId);
    expect(单.approvers.map((x) => x.userId)).toEqual([丙.id]);
    expect(JSON.parse(单.approvers[0].projects)).toHaveLength(3);
    expect(JSON.parse(单.approvers[0].why)).toEqual(["被并客户负责人", "项目负责人"]);
  });

  it("两家和名下项目都是自己的：不用申请；同一家已有一张待同意的：再发拦住", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    expect(await 发起合并申请(prisma, a, b, 乙)).toMatchObject({ ok: false, error: expect.stringMatching(/直接合并即可/) });
    const c = await 客户(丙.id);
    expect((await 发起合并申请(prisma, a, c, 乙)).ok).toBe(true);
    expect(await 发起合并申请(prisma, b, c, 乙)).toMatchObject({ ok: false, error: expect.stringMatching(/已有一张合并申请在等同意/) });
  });
});

describe("谁发起", () => {
  it("纯函数：渠运负责人的直属上级不是销售（市场管理）也能发；别的市场管理不能", () => {
    const 员 = (userId: string, 角色: string, managerId: string | null = null) =>
      [userId, { userId, deptId: null, bizRole: 角色, 角色们: [角色], line: null, managerId, dottedManagerId: null, 不管设置: false }] as const;
    const org = { 成员: new Map([员("渠", "channel_ops", "市上"), 员("市上", "marketing_mgr"), 员("市别", "marketing_mgr"), 员("售", "sales")]), 部门: new Map() } as unknown as 组织;
    expect(发起人问题(org, { id: "市上" }, "渠", null)).toBeNull();
    expect(发起人问题(org, { id: "售" }, "渠", null)).toBeNull();
    expect(发起人问题(org, { id: "市别" }, "渠", null)).toMatch(/直属上级或能接分配的销售/);
    expect(发起人问题(org, { id: "渠" }, "渠", null)).toMatch(/不是销售/);
  });

  describe("同业务线（E-336 三，写死）", () => {
    const 员 = (userId: string, 角色: string, line: "内贸" | "外贸" | null, managerId: string | null = null) =>
      [userId, { userId, deptId: null, bizRole: 角色, 角色们: [角色], line, managerId, dottedManagerId: null, 不管设置: false }] as const;
    /**
     * 渠运「渠」（内贸）的直属上级是「上」，「上」的上级是「总上」；「渠外」没设线、直属上级「上外」是外贸；「渠空」没设线、上级「上空」也没设线；
     * 「渠内」（内贸）的直属上级「管空」是销售管理、没设线；「渠空2」没设线、直属上级是「上」；被并那家的负责人「渠B」直属上级是「市B」
     */
    const org = {
      成员: new Map([
        员("渠", "channel_ops", "内贸", "上"), 员("上", "marketing_mgr", "内贸", "总上"), 员("总上", "marketing_mgr", "内贸"),
        员("渠内", "channel_ops", "内贸", "管空"), 员("管空", "sales_mgr", null),
        员("渠空2", "channel_ops", null, "上"),
        员("渠B", "channel_ops", "内贸", "市B"), 员("市B", "marketing_mgr", "内贸"),
        员("渠2", "channel_ops", "内贸", "上外"), 员("上外", "sales_mgr", "外贸"),
        员("渠外", "channel_ops", null, "上外"),
        员("渠空", "channel_ops", null, "上空"), 员("上空", "marketing_mgr", null),
        员("渠x", "channel_ops", "外贸", "上空"),
        员("内售", "sales", "内贸"), 员("外售", "sales", "外贸"), 员("外管", "sales_mgr", "外贸"), 员("无线售", "sales", null),
      ]),
      部门: new Map(),
    } as unknown as 组织;

    it("直属上级：同业务线能发，跨业务线拦", () => {
      expect(发起人问题(org, { id: "上" }, "渠", "内贸")).toBeNull();
      expect(发起人问题(org, { id: "上外" }, "渠2", "内贸")).toBe("你和留下那家业务线不同（外贸 / 内贸），不能发合并申请");
      expect(发起人问题(org, { id: "上外" }, "渠2", "外贸")).toBeNull();
    });

    it("直属上级自己没设线：按他管的那位负责人的线比", () => {
      expect(发起人问题(org, { id: "上空" }, "渠x", "外贸")).toBeNull();
      expect(发起人问题(org, { id: "上空" }, "渠x", "内贸")).toBe("你和留下那家业务线不同（外贸 / 内贸，你没设业务线，按你管的这位负责人的线算），不能发合并申请");
      // 上级、负责人都没线：不限（同现状）
      expect(发起人问题(org, { id: "上空" }, "渠空", "外贸")).toBeNull();
    });

    it("直属上级本人是销售管理、没设线：只按上级规则（借负责人的线），不走「没设线的销售不限」放行", () => {
      expect(发起人问题(org, { id: "管空" }, "渠内", "外贸")).toBe("你和留下那家业务线不同（内贸 / 外贸，你没设业务线，按你管的这位负责人的线算），不能发合并申请");
      expect(发起人问题(org, { id: "管空" }, "渠内", "内贸")).toBeNull();
    });

    it("负责人（销售）本人发起：自己的线和客户不同也不拦", () => {
      expect(发起人问题(org, { id: "内售" }, "内售", "外贸")).toBeNull();
    });

    it("被并那家负责人的直属上级（不是销售）代发：拦", () => {
      expect(发起人问题(org, { id: "市B" }, "渠", "内贸")).toBe("留下那家的负责人不是销售，合并申请要由他的直属上级或能接分配的销售发起");
    });

    it("不是直属的更上级（不是销售）代发：拦", () => {
      expect(发起人问题(org, { id: "总上" }, "渠", "内贸")).toBe("留下那家的负责人不是销售，合并申请要由他的直属上级或能接分配的销售发起");
    });

    it("客户业务线是导入的脏值：当没填，按留下那家负责人的线判", () => {
      for (const 脏 of ["国内", "内贸 ", "外 贸"]) {
        expect(发起人问题(org, { id: "外售" }, "渠", 脏)).toBe("你和留下那家业务线不同（外贸 / 内贸，留下那家没填业务线，按它负责人的业务线算），不能发合并申请");
        expect(发起人问题(org, { id: "内售" }, "渠", 脏)).toBeNull();
      }
    });

    it("客户没填、负责人没设线、直属上级设了线：不限", () => {
      for (const 空 of [null, undefined, ""]) {
        expect(发起人问题(org, { id: "上" }, "渠空2", 空)).toBeNull();
        expect(发起人问题(org, { id: "外售" }, "渠空2", 空)).toBeNull();
      }
    });

    it("客户没填业务线：按留下那家负责人的业务线比（同 → 能，不同 → 拦）", () => {
      for (const 空 of [null, undefined, ""]) {
        expect(发起人问题(org, { id: "上" }, "渠", 空)).toBeNull();
        expect(发起人问题(org, { id: "内售" }, "渠", 空)).toBeNull();
        expect(发起人问题(org, { id: "外售" }, "渠", 空)).toBe("你和留下那家业务线不同（外贸 / 内贸，留下那家没填业务线，按它负责人的业务线算），不能发合并申请");
        expect(发起人问题(org, { id: "上外" }, "渠2", 空)).toMatch(/^你和留下那家业务线不同（外贸 \/ 内贸，留下那家没填业务线/);
      }
      // 负责人也没线：不限；「暂不分配」算填了、不限线（同现状）
      expect(发起人问题(org, { id: "外售" }, "渠外", null)).toBeNull();
      expect(发起人问题(org, { id: "外售" }, "渠", "暂不分配")).toBeNull();
    });

    it("销售、销售管理跨业务线仍拦；没设线的销售不限（同 接手问题）", () => {
      expect(发起人问题(org, { id: "外售" }, "渠", "内贸")).toBe("你和留下那家业务线不同（外贸 / 内贸），不能发合并申请");
      expect(发起人问题(org, { id: "外管" }, "渠", "内贸")).toBe("你和留下那家业务线不同（外贸 / 内贸），不能发合并申请");
      expect(发起人问题(org, { id: "内售" }, "渠", "内贸")).toBeNull();
      expect(发起人问题(org, { id: "外管" }, "渠", "外贸")).toBeNull();
      expect(发起人问题(org, { id: "无线售" }, "渠", "内贸")).toBeNull();
    });
  });

  it("客户没填业务线：发申请时按留下那家负责人的业务线比（走库）", async () => {
    await raw.entMember.update({ where: { userId: 渠运.id }, data: { managerId: 销管.id, line: "内贸" } });
    const a = await 客户(渠运.id);
    const b = await 客户(丙.id);
    expect(await 发起合并申请(prisma, a, b, 外贸销售)).toMatchObject({ ok: false, error: expect.stringMatching(/按它负责人的业务线算/) });
    expect((await 发起合并申请(prisma, a, b, 丁)).ok).toBe(true);
  });

  it("留下那家负责人是销售：只有他本人能发，别的销售不能", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id);
    expect(await 发起合并申请(prisma, a, b, 丁)).toMatchObject({ ok: false, error: expect.stringMatching(/只有留下那家的客户负责人/) });
    expect((await 发起合并申请(prisma, a, b, 乙)).ok).toBe(true);
  });

  it("留下那家负责人是渠运：他本人不能发；他的直属上级、能接分配的销售能发，他本人要同意", async () => {
    await raw.entMember.update({ where: { userId: 渠运.id }, data: { managerId: 销管.id } });
    const a = await 客户(渠运.id, { bizLine: "内贸" });
    const b = await 客户(丙.id, { bizLine: "内贸" });
    expect(await 发起合并申请(prisma, a, b, 渠运)).toMatchObject({ ok: false, error: expect.stringMatching(/不是销售/) });
    // 业务线对不上的销售不能发（E-336 三，写死）
    expect(await 发起合并申请(prisma, a, b, 外贸销售)).toMatchObject({ ok: false, error: "你和留下那家业务线不同（外贸 / 内贸），不能发合并申请" });
    const r = await 发起合并申请(prisma, a, b, 销管);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.同意人.map((x) => [x.userId, x.凭])).toEqual([[渠运.id, ["留下客户负责人"]], [丙.id, ["被并客户负责人"]]]);
    await 撤回合并申请(prisma, r.requestId, 销管);
    expect((await 发起合并申请(prisma, a, b, 丁)).ok).toBe(true);
  });

  it("系统管理员不用申请；只有发起人能撤回申请", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id);
    expect(await 发起合并申请(prisma, a, b, 老板)).toMatchObject({ ok: false, error: expect.stringMatching(/系统管理员不用发申请/) });
    const r = await 发起合并申请(prisma, a, b, 乙);
    if (!r.ok) throw new Error(r.error);
    expect(await 撤回合并申请(prisma, r.requestId, 丙)).toMatchObject({ ok: false });
    expect(await 撤回合并申请(prisma, r.requestId, 乙)).toEqual({ ok: true });
    expect((await 申请(r.requestId)).status).toBe(申请状态.已撤回);
  });
});

describe("5 个工作日到期", () => {
  it("纯函数：周五下午 → 下周五同一时刻；周六 → 下周五；北京周六凌晨（UTC 还是周五）按周六算", () => {
    expect(到期时刻(周五下午).toISOString()).toBe("2026-12-04T07:00:00.000Z");
    expect(到期时刻(new Date("2026-11-28T02:00:00Z")).toISOString()).toBe("2026-12-04T02:00:00.000Z");
    expect(到期时刻(new Date("2026-11-26T02:00:00Z")).toISOString()).toBe("2026-12-03T02:00:00.000Z");
    expect(到期时刻(new Date("2026-11-27T17:00:00Z")).toISOString()).toBe("2026-12-03T17:00:00.000Z");
  });

  it("跨周末：到期前一分钟能同意，到期那一刻同意就失效；扫过期也记失效", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id);
    await 项目(丁.id, b);
    const r = await 发起合并申请(prisma, a, b, 乙, { 现在: 周五下午 });
    if (!r.ok) throw new Error(r.error);
    expect(r.expiresAt.toISOString()).toBe("2026-12-04T07:00:00.000Z");
    expect(await 处理合并申请(prisma, r.requestId, 丙, "同意", { 现在: new Date("2026-12-04T06:59:00Z") })).toMatchObject({ ok: true, 状态: 申请状态.待同意 });
    expect(await 处理合并申请(prisma, r.requestId, 丁, "同意", { 现在: new Date("2026-12-04T07:00:00Z") })).toEqual({ ok: false, error: 到期话 });
    expect(await 申请(r.requestId)).toMatchObject({ status: 申请状态.已失效, reason: 到期话 });
    expect((await raw.customer.findUniqueOrThrow({ where: { id: b } })).deletedAt).toBeNull();

    const c = await 客户(丙.id);
    const r2 = await 发起合并申请(prisma, a, c, 乙, { 现在: 周五下午 });
    if (!r2.ok) throw new Error(r2.error);
    expect(await 扫过期合并申请(prisma, new Date("2026-12-04T06:00:00Z"))).toBe(0);
    expect(await 扫过期合并申请(prisma, new Date("2026-12-04T07:00:00Z"))).toBe(1);
    expect((await 申请(r2.requestId)).status).toBe(申请状态.已失效);
  });
});

describe("执行前只比四项", () => {
  const 底: 快照 = {
    客户: { A: { 名: "甲", 负责人: "我", 无效: false, 状态: "活跃" }, B: { 名: "乙", 负责人: "丙", 无效: false, 状态: "活跃" } },
    项目: { p: { 客户: "B", 名: "一", 负责人: "丙", 阶段: "线索", 节点: "潜客培育", 结局: null, 回款: "无", 回款键: "", 提成: "无", 提成键: "", 无效: false } },
  };
  const 改 = (f: (s: 快照) => void): 快照 => { const s = structuredClone(底); f(s); return s; };

  it("纯函数：四项各自触发", () => {
    expect(比四项(底, 改((s) => { s.客户.B.负责人 = "丁"; }))).toEqual(["负责人"]);
    expect(比四项(底, 改((s) => { s.项目.p.负责人 = "丁"; }))).toEqual(["负责人"]);
    expect(比四项(底, 底, true)).toEqual(["负责人"]);
    expect(比四项(底, 改((s) => { s.项目.p.阶段 = "商机"; }))).toEqual(["阶段"]);
    expect(比四项(底, 改((s) => { s.项目.p.结局 = "丢单"; }))).toEqual(["阶段"]);
    expect(比四项(底, 改((s) => { s.项目.p.回款键 = "x"; }))).toEqual(["回款或提成"]);
    expect(比四项(底, 改((s) => { s.项目.p.提成键 = "x"; }))).toEqual(["回款或提成"]);
    expect(比四项(底, 改((s) => { s.客户.A.无效 = true; }))).toEqual(["被判无效"]);
    expect(比四项(底, 改((s) => { s.项目.p.无效 = true; }))).toEqual(["被判无效"]);
  });

  it("纯函数：节点、客户状态、名字变了，新建了项目，都不重判", () => {
    expect(比四项(底, 改((s) => {
      s.项目.p.节点 = "需求确认"; s.项目.p.名 = "改名"; s.客户.A.状态 = "沉睡"; s.客户.B.名 = "改名";
      s.项目.q = { ...s.项目.p, 负责人: "我" };
    }))).toEqual([]);
  });

  async function 开一张() {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id);
    const p = await 项目(丙.id, b);
    const r = await 发起合并申请(prisma, a, b, 乙);
    if (!r.ok) throw new Error(r.error);
    return { a, b, p, id: r.requestId };
  }

  it("记了一笔回款：同意时失效，写明是回款或提成变了", async () => {
    const { p, id } = await 开一张();
    await raw.entProjectPayment.create({ data: { projectId: p, paidAt: new Date(), currency: "CNY", amount: 100 } });
    expect(await 处理合并申请(prisma, id, 丙, "同意")).toMatchObject({ ok: false, error: expect.stringMatching(/回款或提成有变/) });
    expect((await 申请(id)).status).toBe(申请状态.已失效);
  });

  it("项目判了无效 / 转了商机 / 换了负责人：各自失效", async () => {
    const 一 = await 开一张();
    await raw.entLeadVerify.create({ data: { projectId: 一.p, verdict: "无效线索", finalResult: "无效线索" } });
    expect(await 处理合并申请(prisma, 一.id, 丙, "同意")).toMatchObject({ ok: false, error: expect.stringMatching(/被判无效有变/) });
    const 二 = await 开一张();
    await raw.project.update({ where: { id: 二.p }, data: { phase: "商机" } });
    expect(await 处理合并申请(prisma, 二.id, 丙, "同意")).toMatchObject({ ok: false, error: expect.stringMatching(/阶段有变/) });
    const 三 = await 开一张();
    await raw.project.update({ where: { id: 三.p }, data: { ownerId: 丁.id } });
    expect(await 处理合并申请(prisma, 三.id, 丙, "同意")).toMatchObject({ ok: false, error: expect.stringMatching(/负责人有变/) });
  });

  it("只改了节点和备注：照常同意并执行", async () => {
    const { a, b, p, id } = await 开一张();
    await raw.project.update({ where: { id: p }, data: { node: "需求确认", remark: "改了备注" } });
    await raw.customer.update({ where: { id: a }, data: { remark: "改了备注" } });
    expect(await 处理合并申请(prisma, id, 丙, "同意")).toMatchObject({ ok: true, 状态: 申请状态.已合并 });
    expect((await raw.customer.findUniqueOrThrow({ where: { id: b } })).deletedAt).not.toBeNull();
  });
});

describe("全同意后执行、留痕", () => {
  it("两位都同意才执行：项目负责人不变；合并单、两家操作日志写明发起人、同意人、时间和合并前回款 / 提成；照第一批能撤回", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id);
    const 丙的 = await 项目(丙.id, b);
    const 丁的 = await 项目(丁.id, a);
    await raw.entProjectPayment.create({ data: { projectId: 丙的, paidAt: new Date("2026-11-20T00:00:00Z"), currency: "CNY", amount: 500 } });
    await raw.entCommission.create({ data: { projectId: 丙的, basePrice: 300 } });
    const r = await 发起合并申请(prisma, a, b, 乙, { 现在: new Date("2026-11-26T02:00:00Z") });
    if (!r.ok) throw new Error(r.error);
    expect(await 处理合并申请(prisma, r.requestId, 乙, "同意")).toMatchObject({ ok: false, error: /不是这张合并申请要同意的人/ });
    expect(await 处理合并申请(prisma, r.requestId, 丙, "同意", { 现在: new Date("2026-11-26T03:00:00Z") })).toMatchObject({ ok: true, 状态: 申请状态.待同意 });
    expect(await 处理合并申请(prisma, r.requestId, 丙, "同意")).toMatchObject({ ok: false, error: /已经同意过了/ });
    expect((await raw.customer.findUniqueOrThrow({ where: { id: b } })).deletedAt).toBeNull();
    const 完 = await 处理合并申请(prisma, r.requestId, 丁, "同意", { 现在: new Date("2026-11-27T01:30:00Z") });
    expect(完).toMatchObject({ ok: true, 状态: 申请状态.已合并 });
    if (!完.ok) return;

    const 单 = await 申请(r.requestId);
    expect(单).toMatchObject({ status: 申请状态.已合并, mergeId: 完.mergeId });
    expect(await raw.project.findUniqueOrThrow({ where: { id: 丙的 } })).toMatchObject({ customerId: a, ownerId: 丙.id });
    expect(await raw.project.findUniqueOrThrow({ where: { id: 丁的 } })).toMatchObject({ customerId: a, ownerId: 丁.id });
    const 合并单 = await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: 完.mergeId! } });
    expect(合并单.byUserId).toBe(乙.id);
    const 经过 = JSON.parse(合并单.approvals!);
    expect(经过).toMatchObject({ requestId: r.requestId, 发起: { userId: 乙.id } });
    expect(经过.同意人.map((x: { userId: string; at: string }) => [x.userId, x.at])).toEqual([[丙.id, "2026-11-26T03:00:00.000Z"], [丁.id, "2026-11-27T01:30:00.000Z"]]);
    expect(经过.合并前.项目[丙的]).toMatchObject({ 回款: "1 笔 CNY 500", 提成: "底价 300，未固定", 阶段: "线索" });

    for (const id of [a, b]) {
      const 记 = await raw.auditLog.findMany({ where: { entity: "Customer", entityId: id, action: { startsWith: "merge-" } }, orderBy: { at: "asc" } });
      expect(记.map((x) => x.action)).toEqual(["merge-request", "merge-approve", "merge-approve", "merge-request-done"]);
      expect(记[3].summary).toMatch(/乙 2026-11-26 10:00 发起；丙 2026-11-26 11:00 同意，丁 2026-11-27 09:30 同意/);
      expect(记[3].summary).toMatch(/回款 1 笔 CNY 500，提成 底价 300，未固定/);
    }
    // 撤回照第一批：合并人（发起人）能撤
    expect((await 撤回合并(prisma, 完.mergeId!, 乙)).ok).toBe(true);
    expect((await raw.customer.findUniqueOrThrow({ where: { id: b } })).deletedAt).toBeNull();
  });

  it("一位拒绝：整张已拒绝，不执行，写明谁拒绝、为什么", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id);
    const r = await 发起合并申请(prisma, a, b, 乙);
    if (!r.ok) throw new Error(r.error);
    expect(await 处理合并申请(prisma, r.requestId, 丙, "拒绝", { 原因: "不是同一家" })).toMatchObject({ ok: true, 状态: 申请状态.已拒绝 });
    expect(await 申请(r.requestId)).toMatchObject({ status: 申请状态.已拒绝, reason: "丙拒绝：不是同一家" });
    expect((await raw.customer.findUniqueOrThrow({ where: { id: b } })).deletedAt).toBeNull();
  });

  it("等同意期间被并那家标了无效客户：最后一位同意时判出来，申请失效、不执行", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id);
    const r = await 发起合并申请(prisma, a, b, 乙);
    if (!r.ok) throw new Error(r.error);
    await raw.customer.update({ where: { id: b }, data: { poolInvalidAt: new Date() } });
    expect(await 处理合并申请(prisma, r.requestId, 丙, "同意")).toMatchObject({ ok: false, error: expect.stringMatching(/标了无效客户.*申请已失效/) });
    expect((await 申请(r.requestId)).status).toBe(申请状态.已失效);
  });
});

describe("动作层（customers/merge-actions.ts）", () => {
  const 以 = (u: 人) => { 登录.人 = u; };
  async function 一张() {
    const a = await 客户(乙.id), b = await 客户(丙.id);
    以(乙);
    const r = await 发起客户合并申请(a, b);
    if (!r.ok) throw new Error(r.error);
    return { a, b, id: r.requestId };
  }

  it("申请预览（2b-3 合并客户框）：判法同发起；能发时给要同意的人和身份，同事那家联系人不给号码、并排不给地址；不写库", async () => {
    const a = await 客户(乙.id), b = await 客户(丙.id);
    const p = await 项目(丁.id, a);
    以(乙);
    const r = await 预览合并申请(a, b);
    if (!r.ok) throw new Error(r.error);
    expect(r.预览).toMatchObject({ 能发: true, 原因: [], 等待工作日: 5 });
    expect(r.预览.同意人).toEqual([
      { userId: 丙.id, 名: "丙", 凭: ["被并客户负责人"], 项目: [] },
      { userId: 丁.id, 名: "丁", 凭: ["项目负责人"], 项目: [{ id: p, name: expect.any(String), customerId: a }] },
    ]);
    expect(r.预览.预览!.联系人们.并掉.length).toBe(1);
    expect(r.预览.预览!.联系人们.并掉.every((c) => c.号.length === 0)).toBe(true);
    expect(r.预览.预览!.并排.map((x) => x.格)).not.toContain("客户地址");
    expect(await raw.entMergeRequest.count()).toBe(0);
    // 别的销售：发不了，摆原因；两家都是自己的、没有同事项目：说直接并
    以(丁);
    expect(await 预览合并申请(a, b)).toMatchObject({ ok: true, 预览: { 能发: false, 原因: ["只有留下那家的客户负责人能发合并申请"], 预览: null } });
    const c = await 客户(乙.id), d = await 客户(乙.id);
    以(乙);
    expect(await 预览合并申请(c, d)).toMatchObject({ ok: true, 预览: { 能发: false, 原因: [直接并话] } });
    // 同一家已挂着一张：预览就说
    expect((await 发起客户合并申请(a, b)).ok).toBe(true);
    expect(await 预览合并申请(a, b)).toMatchObject({ ok: true, 预览: { 能发: false, 原因: [expect.stringContaining("已有一张合并申请在等同意")] } });
    expect(await 预览合并申请(a, "x".repeat(65))).toMatchObject({ ok: false, error: "参数不对，刷新再试" });
    // 界面那份等多久和数据层一致
    expect(界面等待工作日).toBe(等待工作日);
  });

  it("发起：留下那家的负责人能发；别的销售发被拒；同一家传两次是坏参数", async () => {
    const a = await 客户(乙.id), b = await 客户(丙.id);
    以(丁);
    expect(await 发起客户合并申请(a, b)).toMatchObject({ ok: false, error: expect.stringMatching(/./) });
    expect(await raw.entMergeRequest.count()).toBe(0);
    以(乙);
    expect(await 发起客户合并申请(a, a)).toMatchObject({ ok: false, error: "参数不对，刷新再试" });
    const r = await 发起客户合并申请(a, b);
    expect(r).toMatchObject({ ok: true, 同意人: [{ userId: 丙.id }] });
  });

  it("同意 / 拒绝：不是同意人的被拒；同意人同意后执行合并", async () => {
    const { b, id } = await 一张();
    以(丁);
    expect(await 处理客户合并申请(id, "同意")).toEqual({ ok: false, error: "你不是这张合并申请要同意的人" });
    以(丙);
    expect(await 处理客户合并申请(id, "随便" as "同意")).toMatchObject({ ok: false, error: "参数不对，刷新再试" });
    expect(await 处理客户合并申请(id, "同意")).toMatchObject({ ok: true, 状态: 申请状态.已合并 });
    expect((await raw.customer.findUniqueOrThrow({ where: { id: b } })).deletedAt).not.toBeNull();
  });

  it("拒绝带一句原因：整张已拒绝", async () => {
    const { id } = await 一张();
    以(丙);
    expect(await 处理客户合并申请(id, "拒绝", "不是同一家")).toMatchObject({ ok: true, 状态: 申请状态.已拒绝 });
    expect(await 申请(id)).toMatchObject({ status: 申请状态.已拒绝, reason: "丙拒绝：不是同一家" });
  });

  it("撤回：同意人撤不了，发起人能撤", async () => {
    const { id } = await 一张();
    以(丙);
    expect(await 撤回客户合并申请(id)).toEqual({ ok: false, error: "只有发起人能撤回合并申请" });
    以(乙);
    expect(await 撤回客户合并申请(id)).toEqual({ ok: true });
    expect((await 申请(id)).status).toBe(申请状态.已撤回);
  });

  it("作废：销售（发起人也不行）被拒，系统管理员能作废，记已失效、写明谁作废的", async () => {
    const { id } = await 一张();
    expect(await 作废客户合并申请(id)).toEqual({ ok: false, error: "只有系统管理员能作废合并申请" });
    以(老板);
    expect(await 作废客户合并申请(id)).toEqual({ ok: true });
    expect(await 申请(id)).toMatchObject({ status: 申请状态.已失效, reason: "系统管理员老板作废了申请", endedById: 老板.id });
    expect(await 作废客户合并申请(id)).toMatchObject({ ok: false, error: expect.stringMatching(/已失效，不能作废/) });
  });

  it("两张列表：等我同意的只给同意人、处理过就不在；我发起的只给发起人；客户名取快照", async () => {
    const { a, b, id } = await 一张();
    以(丙);
    const 等 = await 等我同意的合并申请();
    expect(等).toHaveLength(1);
    expect(等[0]).toMatchObject({ id, 发起人: "乙", 状态: 申请状态.待同意, 留下: { id: a, 名: expect.stringMatching(/^测试客户/) }, 并掉: { id: b }, 同意人: [{ userId: 丙.id, 名: "丙", 凭: ["被并客户负责人"], 状态: "待同意" }] });
    expect(await 我发起的合并申请()).toEqual([]);
    以(丁);
    expect(await 等我同意的合并申请()).toEqual([]);
    以(乙);
    expect((await 我发起的合并申请()).map((x) => x.id)).toEqual([id]);
    以(丙);
    await 处理客户合并申请(id, "拒绝");
    expect(await 等我同意的合并申请()).toEqual([]);
    以(乙);
    expect(await 我发起的合并申请()).toMatchObject([{ id, 状态: 申请状态.已拒绝 }]);
  });

  it("每分钟的钟：钟上扫过期合并申请 把过了到期时刻的改已失效，没到的不动", async () => {
    const a = await 客户(乙.id), b = await 客户(丙.id), c = await 客户(丁.id);
    const r1 = await 发起合并申请(prisma, a, b, 乙, { 现在: 周五下午 });
    const r2 = await 发起合并申请(prisma, c, await 客户(丙.id), 丁, { 现在: new Date("2026-12-01T07:00:00Z") });
    if (!r1.ok || !r2.ok) throw new Error("发起失败");
    expect(await 钟上扫过期合并申请(new Date("2026-12-04T07:00:00Z"))).toBe(1);
    expect(await 申请(r1.requestId)).toMatchObject({ status: 申请状态.已失效, reason: 到期话 });
    expect((await 申请(r2.requestId)).status).toBe(申请状态.待同意);
    expect(await raw.auditLog.count({ where: { action: "merge-request-void", entityId: { in: [a, b] } } })).toBe(2);
  });
});


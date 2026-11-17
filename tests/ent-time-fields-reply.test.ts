/**
 * 企业版「指定回复时间」字段 + 表单（11-17，两字段方案 PR1）：
 * 北京墙钟 ↔ 时刻、两格规整（选填、结束不早于开始）、显示「—」；建档向导 / 客户页新增项目三处同一份规整；
 * 项目资料卡就地改（编辑项目），待分配期间录入人也能改。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 改项目 } from "@/lib/project/db";
import { 规整向导 } from "@/lib/project/wizard";
import { 北京墙钟转时刻, 时刻转北京墙钟, 规整指定回复, 指定回复文字, 回复晚于回收 } from "@/lib/project/time-fields";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";

describe("北京墙钟（待客户方确认：问题 3，按北京时间）", () => {
  it("YYYY-MM-DD HH:mm 按 UTC+8 认成时刻，来回不变；T 写法、带秒也认", () => {
    const t = 北京墙钟转时刻("2026-11-20 15:00")!;
    expect(t.toISOString()).toBe("2026-11-20T07:00:00.000Z");
    expect(时刻转北京墙钟(t)).toBe("2026-11-20 15:00");
    expect(北京墙钟转时刻("2026-11-20T15:00:30")?.toISOString()).toBe("2026-11-20T07:00:00.000Z");
    // 北京凌晨 = UTC 前一天
    expect(北京墙钟转时刻("2026-11-21 02:30")?.toISOString()).toBe("2026-11-20T18:30:00.000Z");
  });
  it("认不出的、不存在的日子、只有日期 = null", () => {
    for (const s of ["", "2026-02-30 10:00", "2026-11-20", "2026-13-01 10:00", "2026-11-20 24:00", "明天下午", 123]) expect(北京墙钟转时刻(s)).toBeNull();
  });
});

describe("两格规整", () => {
  it("都空 = 没填；只填一格也行", () => {
    expect(规整指定回复(null, "")).toEqual({ ok: true, 值: { replyStartAt: null, replyEndAt: null } });
    const 只始 = 规整指定回复("2026-11-20 15:00", null);
    expect(只始.ok && 只始.值.replyStartAt?.toISOString()).toBe("2026-11-20T07:00:00.000Z");
    const 只终 = 规整指定回复(undefined, "2026-11-20 17:00");
    expect(只终.ok && 只终.值.replyEndAt?.toISOString()).toBe("2026-11-20T09:00:00.000Z");
  });
  it("结束早于开始、格式不对拦下；相等放行", () => {
    expect(规整指定回复("2026-11-20 17:00", "2026-11-20 15:00")).toEqual({ ok: false, error: "指定回复时间的结束不能早于开始" });
    expect(规整指定回复("下午", null).ok).toBe(false);
    expect(规整指定回复("2026-11-20 15:00", "2026-11-20 15:00").ok).toBe(true);
  });
  it("显示：没填「—」；时间段同天只写一次日期；只填开始「前后」、只填结束「前」；别的年份写全", () => {
    const 今 = new Date("2026-11-17T01:00:00Z");
    const 时 = (s: string) => 北京墙钟转时刻(s);
    expect(指定回复文字(null, null, 今)).toBe("—");
    expect(指定回复文字(时("2026-11-20 15:00"), 时("2026-11-20 17:00"), 今)).toBe("11-20 15:00 – 17:00");
    expect(指定回复文字(时("2026-11-20 15:00"), 时("2026-11-21 09:00"), 今)).toBe("11-20 15:00 – 11-21 09:00");
    expect(指定回复文字(时("2026-11-20 15:00"), null, 今)).toBe("11-20 15:00 前后");
    expect(指定回复文字(null, 时("2026-11-20 17:00"), 今)).toBe("11-20 17:00 前");
    expect(指定回复文字(时("2027-01-05 10:00"), null, 今)).toBe("2027-01-05 10:00 前后");
  });
});

describe("指定回复时间晚于预计回收日：黄条提示（不顺延回收）", () => {
  const 时 = (x: string) => 北京墙钟转时刻(x);
  it("开始（没填用结束）在回收日当天或以后才提示；没回收日 / 没填不提示", () => {
    expect(回复晚于回收(时("2026-11-20 15:00"), null, "2026-11-20")).toContain("2026-11-20 先回收");
    expect(回复晚于回收(null, 时("2026-11-25 09:00"), "2026-11-20")).toContain("记得在那之前跟进一次");
    expect(回复晚于回收(时("2026-11-19 23:59"), 时("2026-11-25 09:00"), "2026-11-20")).toBeNull();
    expect(回复晚于回收(时("2026-11-20 15:00"), null, null)).toBeNull();
    expect(回复晚于回收(null, null, "2026-11-20")).toBeNull();
  });
});

describe("建档向导规整（三处新建共用）", () => {
  const 底 = {
    联系人: { name: "联系人甲", phone: "13800000001" },
    项目: { name: "项目甲", ownerId: "u1", 业务线: "内贸" },
    跟进: { type: "PHONE", content: "聊了", occurredAt: "2026-11-17T01:00:00.000Z", 节点: "潜客培育" },
  };
  it("企业版：两格进 企业.指定回复；没填都是 null；结束早于开始整笔拦", () => {
    const 好 = 规整向导({ id: "u1" }, { ...底, 项目: { ...底.项目, 指定回复开始: "2026-11-20 15:00", 指定回复结束: "2026-11-20 17:00" } }, new Date("2026-11-17T02:00:00Z"), false, true);
    expect("error" in 好).toBe(false);
    if ("error" in 好) return;
    expect(好.企业?.指定回复?.replyStartAt?.toISOString()).toBe("2026-11-20T07:00:00.000Z");
    expect(好.企业?.指定回复?.replyEndAt?.toISOString()).toBe("2026-11-20T09:00:00.000Z");
    const 空 = 规整向导({ id: "u1" }, 底, new Date("2026-11-17T02:00:00Z"), false, true);
    expect("error" in 空 ? null : 空.企业?.指定回复).toEqual({ replyStartAt: null, replyEndAt: null });
    const 坏 = 规整向导({ id: "u1" }, { ...底, 项目: { ...底.项目, 指定回复开始: "2026-11-20 17:00", 指定回复结束: "2026-11-20 15:00" } }, new Date("2026-11-17T02:00:00Z"), false, true);
    expect(坏).toEqual({ error: "指定回复时间的结束不能早于开始" });
  });
  it("团队版不认（不进 企业）", () => {
    const 好 = 规整向导({ id: "u1" }, { ...底, 项目: { ...底.项目, 指定回复开始: "2026-11-20 15:00" } }, new Date("2026-11-17T02:00:00Z"), false, false);
    expect("error" in 好 ? null : 好.企业).toBeUndefined();
  });
});

describe("项目资料卡就地改（编辑项目）", () => {
  type 人 = { id: string; role: string };
  let 销售: 人, 市场管: 人, 别人: 人;
  const 当 = (p: 人) => { mocks.user = { ...mocks.user, id: p.id, role: p.role, name: p.id }; };
  const 建 = async (email: string, role = "SALES"): Promise<人> => ({ id: (await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } })).id, role });
  const 项目 = async (ownerId: string, 补: Record<string, unknown> = {}) => {
    const c = await prisma.customer.create({ data: { name: `客户${Math.random()}`, phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, salesOwnerId: ownerId } });
    return (await prisma.project.create({ data: { name: "项目", customerId: c.id, ownerId, creatorId: ownerId, phase: "线索", node: "潜客培育", ...补 } })).id;
  };
  const 项 = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    忘掉企业版范围();
    销售 = await 建("sales");
    市场管 = await 建("mkt");
    别人 = await 建("other");
    await prisma.entMember.createMany({ data: [{ userId: 销售.id, bizRole: "sales" }, { userId: 市场管.id, bizRole: "marketing_mgr" }, { userId: 别人.id, bizRole: "sales" }] });
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await setSetting("business", { projectMode: true, poolDays: 30 });
    invalidateSettingsCache();
  });
  afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); 忘掉企业版范围(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("负责人改一格只动那一格、留痕叫法；清空 = null；结束早于开始拦下不动", async () => {
    const id = await 项目(销售.id);
    当(销售);
    const r = await 改项目(mocks.user, id, { 指定回复开始: "2026-11-20 15:00" });
    expect(r).toMatchObject({ ok: true, 变了: ["replyStartAt"] });
    expect((await 项(id)).replyStartAt?.toISOString()).toBe("2026-11-20T07:00:00.000Z");
    expect((await 项(id)).replyEndAt).toBeNull();
    // 只交结束：开始照库里的一起校验
    expect(await 改项目(mocks.user, id, { 指定回复结束: "2026-11-20 14:00" })).toEqual({ ok: false, error: "指定回复时间的结束不能早于开始" });
    expect((await 项(id)).replyEndAt).toBeNull();
    expect(await 改项目(mocks.user, id, { 指定回复开始: null, 指定回复结束: null })).toMatchObject({ ok: true, 变了: ["replyStartAt"] });
    expect((await 项(id)).replyStartAt).toBeNull();
    // 没变 = 不留痕
    expect(await 改项目(mocks.user, id, { 指定回复开始: null })).toMatchObject({ ok: true, 变了: [] });
  });

  it("别人（不能管这个项目）改不了", async () => {
    const id = await 项目(销售.id);
    当(别人);
    const r = await 改项目(mocks.user, id, { 指定回复开始: "2026-11-20 15:00" });
    expect(r.ok).toBe(false);
    expect((await 项(id)).replyStartAt).toBeNull();
  });

  it("待分配期间录入人也能改指定回复时间（市场管理当负责人别的格照旧不能改，P-判定-02）", async () => {
    const id = await 项目(市场管.id, { awaitAssignAt: new Date() });
    当(市场管);
    expect(await 改项目(mocks.user, id, { 指定回复结束: "2026-11-20 17:00" })).toMatchObject({ ok: true });
    expect((await 项(id)).replyEndAt?.toISOString()).toBe("2026-11-20T09:00:00.000Z");
    // 分出去以后（不在待分配）就照现行编辑权限
    await prisma.project.update({ where: { id }, data: { awaitAssignAt: null } });
    expect((await 改项目(mocks.user, id, { 指定回复结束: "2026-11-21 17:00" })).ok).toBe(false);
    expect((await 项(id)).replyEndAt?.toISOString()).toBe("2026-11-20T09:00:00.000Z");
    // 待分配期间也只放开这两格：别的格照旧拦
    await prisma.project.update({ where: { id }, data: { awaitAssignAt: new Date() } });
    expect((await 改项目(mocks.user, id, { remark: "改备注" })).ok).toBe(false);
  });
});

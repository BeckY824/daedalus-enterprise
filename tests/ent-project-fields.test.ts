/**
 * 企业版项目的痛点标注、合同状态、项目方案（迁移 101，10-31）。
 *
 * 钉的是：
 *   - 合同状态七项、顺序固定；默认「起草中」；库里空的（老项目）、认不出的显示成「起草中」
 *   - 项目新字段改成：没传 = 原样；痛点标注去首尾空白、空 = 清掉、超长 / 不是文字报错；
 *     合同状态空 = 回到起草中、认不出报错、和现在显示的一样 = 原样（老项目空着交回「起草中」不算改）
 *   - 新建项目：企业版写「起草中」，别的版本不写（线索建项目真库走一遍）
 *   - 节点必填三项：痛点标注 / 项目方案（至少一个附件）/ 合同已生效，满足和不满足都钉
 *   - 读必填数据（真库）：项目方案数只数 tag「方案」的附件；合同状态原样带出
 *   - 改项目（真库）：两格存得进读得出、再交一遍不算变；坏值拦下库里不动；不是企业版不动；
 *     字段权限「看」改不了；节点必填配了「痛点标注」，填上那一下就推
 *   - 字段权限表：两列各挂自己那一行、能藏
 * 项目方案附件的传、列、删、权限在 ent-project-attachments.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 合同状态们, 默认合同状态, 合同状态显示, 是合同状态, 新项目默认值, 项目新字段改成, 痛点标注上限, type 项目新字段 } from "@/lib/project/proj-fields";
import { 还差, 必填项名们, 建议必填, type 必填数据 } from "@/lib/project/required";
import { 默认组织规则, type 组织规则 } from "@/lib/project/org-rules";
import { 改项目, 读必填数据 } from "@/lib/project/db";
import { 线索建项目 } from "@/lib/project/from-lead";
import { 字段, 项目列字段, 字段权限key } from "@/lib/enterprise/field-perm";
import { 规则 } from "@/lib/enterprise/rules";

const 空: 项目新字段 = { painPoints: null, contractStatus: null };

describe("合同状态：选项和默认", () => {
  it("七项、顺序固定，默认起草中", () => {
    expect([...合同状态们]).toEqual(["起草中", "待对方确认", "待我方确认", "对方修改中", "我方修改中", "已生效", "已终止"]);
    expect(默认合同状态).toBe("起草中");
    expect(是合同状态("已生效")).toBe(true);
    expect(是合同状态("生效")).toBe(false);
  });

  it("库里空的（老项目）、认不出的都显示「起草中」；认得出的原样", () => {
    expect(合同状态显示(null)).toBe("起草中");
    expect(合同状态显示(undefined)).toBe("起草中");
    expect(合同状态显示("")).toBe("起草中");
    expect(合同状态显示("乱写的")).toBe("起草中");
    expect(合同状态显示("我方修改中")).toBe("我方修改中");
  });

  it("新建项目默认值：企业版写起草中，别的版本不写", () => {
    expect(新项目默认值(true)).toEqual({ contractStatus: "起草中" });
    expect(新项目默认值(false)).toEqual({});
  });
});

describe("项目新字段改成", () => {
  const 原: 项目新字段 = { painPoints: "交期总拖", contractStatus: "待对方确认" };

  it("没传 = 原样", () => {
    expect(项目新字段改成({}, 原)).toEqual({ ok: true, 值: 原 });
  });

  it("痛点标注：去首尾空白、中间换行留着；空 = 清掉", () => {
    expect(项目新字段改成({ painPoints: "  一、交期\n二、售后  " }, 空)).toEqual({ ok: true, 值: { ...空, painPoints: "一、交期\n二、售后" } });
    expect(项目新字段改成({ painPoints: "   " }, 原)).toEqual({ ok: true, 值: { ...原, painPoints: null } });
    expect(项目新字段改成({ painPoints: null }, 原)).toEqual({ ok: true, 值: { ...原, painPoints: null } });
  });

  it("痛点标注：超长、不是文字报错", () => {
    expect(项目新字段改成({ painPoints: "字".repeat(痛点标注上限) }, 空)).toMatchObject({ ok: true });
    expect(项目新字段改成({ painPoints: "字".repeat(痛点标注上限 + 1) }, 空)).toMatchObject({ ok: false, error: expect.stringContaining("痛点标注") });
    expect(项目新字段改成({ painPoints: 3 }, 空)).toMatchObject({ ok: false, error: expect.stringContaining("痛点标注") });
  });

  it("合同状态：七项里的照存；空 = 回到起草中；认不出报错", () => {
    expect(项目新字段改成({ contractStatus: "已生效" }, 原)).toEqual({ ok: true, 值: { ...原, contractStatus: "已生效" } });
    expect(项目新字段改成({ contractStatus: "" }, 原)).toEqual({ ok: true, 值: { ...原, contractStatus: "起草中" } });
    expect(项目新字段改成({ contractStatus: null }, 原)).toEqual({ ok: true, 值: { ...原, contractStatus: "起草中" } });
    expect(项目新字段改成({ contractStatus: "生效了" }, 原)).toMatchObject({ ok: false, error: expect.stringContaining("合同状态") });
    expect(项目新字段改成({ contractStatus: 1 }, 原)).toMatchObject({ ok: false });
  });

  it("老项目合同状态空着：界面交回「起草中」不算改（库里留空）；改成别的才写", () => {
    expect(项目新字段改成({ contractStatus: "起草中" }, 空)).toEqual({ ok: true, 值: 空 });
    expect(项目新字段改成({ contractStatus: "已终止" }, 空)).toEqual({ ok: true, 值: { ...空, contractStatus: "已终止" } });
  });
});

describe("节点必填：痛点标注 / 项目方案 / 合同已生效", () => {
  const 规则配 = (必填: string[]): 组织规则 => ({ ...默认组织规则, 节点推进: { 开: true, 必填: { 潜客培育: 必填 } } });
  const 数据 = (x: Partial<必填数据> = {}): 必填数据 => ({
    项目: { node: "潜客培育", contactId: null, nextStepAt: null, expectedDealAt: null, amount: 0, remark: null, acceptancePassed: false },
    客户: { phone: null, extra: null },
    联系人们: [],
    沟通节点们: [],
    ...x,
  });
  const 三项 = ["痛点标注", "项目方案", "合同已生效"];

  it("三项都在目录里；建议清单配了痛点标注、项目方案，合同已生效配在签约审批（10-31 定：已生效才算过）", () => {
    for (const k of 三项) expect(必填项名们).toContain(k);
    const 配了 = Object.values(建议必填).flat();
    expect(配了).toContain("痛点标注");
    expect(配了).toContain("项目方案");
    expect(建议必填.签约审批).toContain("合同已生效");
  });

  it("都没填（老项目：合同状态空、没读到方案数）：三项都差", () => {
    expect(还差(规则配(三项), 数据())).toEqual(三项);
  });

  it("痛点标注：空白不算，写了字算", () => {
    const r = 规则配(["痛点标注"]);
    expect(还差(r, 数据({ 痛点标注: "  " }))).toEqual(["痛点标注"]);
    expect(还差(r, 数据({ 痛点标注: null }))).toEqual(["痛点标注"]);
    expect(还差(r, 数据({ 痛点标注: "交期总拖" }))).toEqual([]);
  });

  it("项目方案：0 个不算，至少一个算", () => {
    const r = 规则配(["项目方案"]);
    expect(还差(r, 数据({ 项目方案数: 0 }))).toEqual(["项目方案"]);
    expect(还差(r, 数据({ 项目方案数: 1 }))).toEqual([]);
    expect(还差(r, 数据({ 项目方案数: 3 }))).toEqual([]);
  });

  it("合同已生效：只有「已生效」算；起草中、已终止、空都不算", () => {
    const r = 规则配(["合同已生效"]);
    for (const s of ["起草中", "待对方确认", "待我方确认", "对方修改中", "我方修改中", "已终止", null]) {
      expect(还差(r, 数据({ 合同状态: s }))).toEqual(["合同已生效"]);
    }
    expect(还差(r, 数据({ 合同状态: "已生效" }))).toEqual([]);
  });
});

describe("字段权限表", () => {
  it("两列各挂自己那一行，都能藏", () => {
    expect(项目列字段.painPoints).toBe("痛点标注");
    expect(项目列字段.contractStatus).toBe("合同状态");
    expect(字段.痛点标注).toMatchObject({ 名: "痛点标注", 用在: "项目", 能藏: true });
    expect(字段.合同状态).toMatchObject({ 名: "合同状态", 用在: "项目", 能藏: true });
  });
});

describe("真库：改项目 / 读必填数据 / 新建项目", () => {
  let 乙: { id: string; role: string };
  let 客户id: string;
  let 项目id: string;
  const 读 = () => prisma.project.findUniqueOrThrow({ where: { id: 项目id }, select: { painPoints: true, contractStatus: true } });
  const 基 = { name: "QA-新字段项目", amount: 0 };

  beforeEach(async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await resetDb();
    invalidateSettingsCache();
    乙 = { id: (await prisma.user.create({ data: { email: "p101-yi", name: "p101-yi", title: "", role: "SALES", password: "x" } })).id, role: "SALES" };
    客户id = (await prisma.customer.create({ data: { name: "QA-新字段客户", phone: "13800001101", salesOwnerId: 乙.id } })).id;
    // 直接建 = 老项目的样子：两格都空
    项目id = (await prisma.project.create({ data: { name: 基.name, customerId: 客户id, ownerId: 乙.id, creatorId: 乙.id } })).id;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("存得进读得出；再交一遍一样的不算变；只改名字两格不动", async () => {
    const r = await 改项目(乙, 项目id, { ...基, painPoints: " 交期总拖\n售后慢 ", contractStatus: "待我方确认" });
    expect(r).toMatchObject({ ok: true });
    expect(new Set(r.ok ? r.变了 : [])).toEqual(new Set(["painPoints", "contractStatus"]));
    expect(await 读()).toEqual({ painPoints: "交期总拖\n售后慢", contractStatus: "待我方确认" });
    expect(await 改项目(乙, 项目id, { ...基, painPoints: "交期总拖\n售后慢", contractStatus: "待我方确认" })).toEqual({ ok: true, 变了: [] });
    expect(await 改项目(乙, 项目id, { ...基, name: "QA-改名" })).toMatchObject({ ok: true, 变了: ["name"] });
    expect(await 读()).toEqual({ painPoints: "交期总拖\n售后慢", contractStatus: "待我方确认" });
  });

  it("老项目合同状态空着：交回「起草中」不算改、库里还是空；清掉痛点标注存成空", async () => {
    expect(await 改项目(乙, 项目id, { ...基, contractStatus: "起草中" })).toEqual({ ok: true, 变了: [] });
    expect(await 读()).toEqual(空);
    await 改项目(乙, 项目id, { ...基, painPoints: "x" });
    expect(await 改项目(乙, 项目id, { ...基, painPoints: "" })).toMatchObject({ ok: true, 变了: ["painPoints"] });
    expect(await 读()).toEqual(空);
  });

  it("坏值拦下，库里不动", async () => {
    await 改项目(乙, 项目id, { ...基, contractStatus: "已生效" });
    expect(await 改项目(乙, 项目id, { ...基, contractStatus: "生效了" })).toMatchObject({ ok: false });
    expect(await 改项目(乙, 项目id, { ...基, painPoints: "字".repeat(痛点标注上限 + 1) })).toMatchObject({ ok: false });
    expect(await 读()).toEqual({ painPoints: null, contractStatus: "已生效" });
  });

  it("不是企业版：传了也不动", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 改项目(乙, 项目id, { ...基, painPoints: "x", contractStatus: "已生效" })).toEqual({ ok: true, 变了: [] });
    expect(await 读()).toEqual(空);
  });

  it("字段权限：痛点标注只能看 → 改不了；合同状态照改", async () => {
    await prisma.entMember.create({ data: { userId: 乙.id, bizRole: "sales" } });
    await setSetting(规则.字段权限.key, true);
    await setSetting(字段权限key, { 痛点标注: { sales: "看" } });
    expect(await 改项目(乙, 项目id, { ...基, painPoints: "x" })).toMatchObject({ ok: false, error: expect.stringContaining("痛点标注") });
    expect(await 改项目(乙, 项目id, { ...基, contractStatus: "已生效" })).toMatchObject({ ok: true, 变了: ["contractStatus"] });
    expect(await 读()).toEqual({ painPoints: null, contractStatus: "已生效" });
  });

  it("读必填数据：项目方案数只数 tag「方案」；痛点标注、合同状态原样带出", async () => {
    const 附 = (tag: string | null, i: number) =>
      prisma.attachment.create({ data: { projectId: 项目id, tag, name: `f${i}.pdf`, mime: "application/pdf", size: 1, sha256: `p101-${i}`, userId: 乙.id } });
    await 附("合同", 1);
    await 附(null, 2);
    await 附("其它", 3);
    const 读数据 = async () => 读必填数据(prisma, await prisma.project.findUniqueOrThrow({ where: { id: 项目id } }));
    expect(await 读数据()).toMatchObject({ 项目方案数: 0, 合同附件数: 1, 痛点标注: null, 合同状态: null });
    await 附("方案", 4);
    await 附("方案", 5);
    await prisma.project.update({ where: { id: 项目id }, data: { painPoints: "交期", contractStatus: "已生效" } });
    expect(await 读数据()).toMatchObject({ 项目方案数: 2, 痛点标注: "交期", 合同状态: "已生效" });
  });

  it("节点必填配了「痛点标注」：编辑项目填上那一下就推", async () => {
    const 起 = (await prisma.project.findUniqueOrThrow({ where: { id: 项目id } })).node;
    await setSetting("orgRules", { ...默认组织规则, 节点推进: { 开: true, 必填: { [起]: ["痛点标注"] } } });
    invalidateSettingsCache();
    expect(await 改项目(乙, 项目id, { ...基, contractStatus: "已生效" })).not.toHaveProperty("自动推到");
    const r = await 改项目(乙, 项目id, { ...基, painPoints: "交期总拖" });
    expect(r).toMatchObject({ ok: true, 自动推到: expect.arrayContaining([expect.any(String)]) });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 项目id } })).node).not.toBe(起);
  });

  it("线索建项目：企业版写「起草中」，不是企业版留空", async () => {
    const 建 = (名: string) => 线索建项目(prisma, { 线索名: 名, leadId: `lead-${名}`, customerId: 客户id, ownerId: 乙.id, creatorId: 乙.id, 联系人Id: null });
    const 企业 = await 建("QA-企业新项目");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 企业 } })).contractStatus).toBe("起草中");
    vi.stubEnv("CRM_ENTERPRISE", "");
    const 团队 = await 建("QA-团队新项目");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 团队 } })).contractStatus).toBeNull();
  });
});

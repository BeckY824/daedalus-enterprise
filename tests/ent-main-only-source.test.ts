/**
 * 只有主渠道（一个子渠道都没有）的来源也选得到（11-10，P-渠道-01「没有子渠道时只有一个子渠道名留空的入口」）。
 * 原来来源下拉只列子渠道，没有子渠道的主渠道新建客户 / 项目 / 线索、导入时选不到。
 *
 * - 清单：在售、启用、底下一条渠道都没有的主渠道各摆一行占位（id =「main:主渠道 id」）；历史渠道组、停用的、已有渠道的不摆
 * - 存的时候才落成渠道：在主渠道下建子渠道名留空的那条（全称 = 主渠道名），负责人、属性带主渠道的；客户 / 项目照老样子挂这条
 * - 同一个主渠道只建一条（两个人同时选也是）；主渠道没定负责人的报错，不拿录入的人顶
 * - 几条入口：建档向导（客户来源、项目来源）、编辑客户补来源、编辑项目补来源、首页 AI 录入、客户导入
 * - 来源选择器的属性沿用：子渠道自己没填属性的，清单里带主渠道的
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "a@x", role: "ADMIN", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: unknown) => f }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user, currentUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 主渠道入口们, 落到渠道 } from "@/lib/enterprise/channel-main";
import { 主渠道入口前缀, 是主渠道入口, 历史渠道分类 } from "@/lib/enterprise/channel-main-core";
import { 可选渠道们 } from "@/lib/enterprise/channel-options";
import { 可选渠道 } from "@/lib/options";
import { 两级渠道树 } from "@/components/ChannelPicker";
import { 建档向导, type 建档向导输入 } from "@/app/(app)/projects/actions";
import { 改项目 } from "@/lib/project/db";
import { saveCustomer } from "@/app/(app)/customers/actions";
import { applyProposal } from "@/app/(app)/dashboard/apply";
import { 预览导入, 执行导入, type 导入方案 } from "@/app/(app)/customers/import-actions";
import { 字段表, 猜列 } from "@/lib/import/fields";
import { getBusiness } from "@/lib/business";
import { 清空暂存 } from "@/lib/import/staging";

let 老板: string;
let 运营: string;
let 销售: string;
/** 只有主渠道、定了负责人和属性 */
let 展会: string;
/** 只有主渠道、没定负责人 */
let 没人管: string;
/** 有子渠道的主渠道 */
let 抖音: string;
let 抖音号: string;

const 占位 = (mainId: string) => 主渠道入口前缀 + mainId;

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  清空暂存();
  invalidateSettingsCache();
  忘掉企业版范围();
  await setSetting("business", { projectMode: true } as never);
  老板 = (await prisma.user.create({ data: { email: "boss", name: "老板", title: "", role: "ADMIN", password: "x" } })).id;
  运营 = (await prisma.user.create({ data: { email: "ops", name: "运营甲", title: "", role: "SALES", password: "x" } })).id;
  销售 = (await prisma.user.create({ data: { email: "s", name: "销售乙", title: "", role: "SALES", password: "x" } })).id;
  await prisma.entMember.createMany({ data: [{ userId: 老板, bizRole: "director" }, { userId: 运营, bizRole: "channel_ops" }, { userId: 销售, bizRole: "sales" }] });
  mocks.user = { ...mocks.user, id: 老板, name: "老板", role: "ADMIN" };
  展会 = (await prisma.entChannelMain.create({ data: { name: "某展会", ownerId: 运营, attr: "公域引流", sort: 1 } })).id;
  没人管 = (await prisma.entChannelMain.create({ data: { name: "没人管的", sort: 2 } })).id;
  抖音 = (await prisma.entChannelMain.create({ data: { name: "抖音", ownerId: 运营, attr: "主动自拓", sort: 3 } })).id;
  抖音号 = (await prisma.channel.create({ data: { name: "抖音|官方号", platform: "抖音", mainId: 抖音, channelOwnerId: 运营 } })).id;
});
afterEach(() => vi.unstubAllEnvs());

const 入口 = (主名: string) => prisma.channel.findUnique({ where: { name: 主名 } });

describe("来源清单：只有主渠道的也摆出来", () => {
  it("在售、启用、一条渠道都没有的主渠道各一行占位；有子渠道的、历史渠道、停用的不摆", async () => {
    await prisma.entChannelMain.create({ data: { name: "老B2B", category: 历史渠道分类 } });
    await prisma.entChannelMain.create({ data: { name: "停了的主渠道", active: false } });
    // 底下那条渠道停用了的：也算有渠道，不再冒占位
    const 停子 = await prisma.entChannelMain.create({ data: { name: "子停了" } });
    await prisma.channel.create({ data: { name: "子停了", platform: "子停了", mainId: 停子.id, channelOwnerId: 运营, active: false } });
    // 还没补挂主渠道的老渠道，名字正好是主渠道名
    await prisma.entChannelMain.create({ data: { name: "老渠道同名" } });
    await prisma.channel.create({ data: { name: "老渠道同名", channelOwnerId: 运营 } });

    const 们 = await 主渠道入口们();
    expect(们).toEqual([
      { id: 占位(展会), name: "某展会", attr: "公域引流", platform: "某展会", active: true },
      { id: 占位(没人管), name: "没人管的", attr: null, platform: "没人管的", active: true },
    ]);
    expect(们.every((m) => 是主渠道入口(m.id))).toBe(true);
  });

  it("新建项目 / 项目补来源、客户表单拿到的清单都带占位；两级选择里它落在第一列、不用点第二级", async () => {
    const 项 = await 可选渠道们();
    expect(项.map((c) => c.id)).toEqual([抖音号, 占位(展会), 占位(没人管)]);
    const 客 = await 可选渠道();
    expect(客.map((c) => c.name)).toEqual(["抖音|官方号", "某展会", "没人管的"].sort((a, b) => (a < b ? -1 : 1)));
    const 树 = 两级渠道树(项);
    expect(树.find((n) => n.label === "某展会")).toMatchObject({ value: 占位(展会), 全称: "某展会" });
    expect(树.find((n) => n.label === "某展会")?.children).toBeUndefined();
    expect(树.find((n) => n.label === "抖音")?.children).toHaveLength(1);
  });

  it("不是企业版：客户表单的渠道清单不带占位", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect((await 可选渠道()).map((c) => c.id)).toEqual([抖音号]);
  });
});

describe("落到渠道：存的时候才建子渠道名留空的那条", () => {
  const 我 = () => ({ id: 销售, name: "销售乙" });

  it("普通渠道 id、空值原样回，不建东西", async () => {
    expect(await 落到渠道(抖音号, 我())).toEqual({ ok: true, id: 抖音号 });
    expect(await 落到渠道(null, 我())).toEqual({ ok: true, id: null });
    expect(await prisma.channel.count()).toBe(1);
  });

  it("占位：建一条全称 = 主渠道名的渠道，负责人、属性带主渠道的，创建人记选的人；再选还是这条", async () => {
    const r = await 落到渠道(占位(展会), 我());
    expect(r.ok).toBe(true);
    const c = await 入口("某展会");
    expect(c).toMatchObject({ id: r.ok ? r.id : "", name: "某展会", platform: "某展会", mainId: 展会, channelOwnerId: 运营, attr: "公域引流", active: true, createdById: 销售 });
    expect(await 落到渠道(占位(展会), 我())).toEqual({ ok: true, id: c!.id });
    expect(await prisma.channel.count({ where: { mainId: 展会 } })).toBe(1);
    // 落成之后清单里是真的渠道，占位不再出现
    expect((await 可选渠道们()).filter((x) => x.name === "某展会").map((x) => x.id)).toEqual([c!.id]);
    expect(await prisma.auditLog.count({ where: { entity: "Channel", entityId: c!.id, action: "create" } })).toBe(1);
  });

  it("几个人同时选同一个主渠道：只建一条，大家拿到同一个 id", async () => {
    const 们 = await Promise.all(Array.from({ length: 6 }, () => 落到渠道(占位(展会), 我())));
    const ids = new Set(们.map((r) => (r.ok ? r.id : `错：${r.error}`)));
    expect(ids.size).toBe(1);
    expect(await prisma.channel.count({ where: { mainId: 展会 } })).toBe(1);
  });

  it("主渠道没定负责人：报错让渠道管理员先指定，不拿录入的人顶；负责人已停用的一样", async () => {
    const r = await 落到渠道(占位(没人管), 我());
    expect(r).toEqual({ ok: false, error: "主渠道「没人管的」还没指定负责人（或负责人已停用），请渠道管理员先在渠道页给它指定负责人" });
    await prisma.user.update({ where: { id: 运营 }, data: { active: false } });
    expect(await 落到渠道(占位(展会), 我())).toMatchObject({ ok: false });
    expect(await prisma.channel.count()).toBe(1);
  });

  it("主渠道停用了、成了历史渠道、期间加了子渠道、入口被停用：都不收", async () => {
    await prisma.entChannelMain.update({ where: { id: 展会 }, data: { active: false } });
    expect(await 落到渠道(占位(展会), 我())).toEqual({ ok: false, error: "这个渠道不存在或已停用，换一个" });
    await prisma.entChannelMain.update({ where: { id: 展会 }, data: { active: true, category: 历史渠道分类 } });
    expect(await 落到渠道(占位(展会), 我())).toEqual({ ok: false, error: "「某展会」是历史渠道，只承载历史客户，新数据不能选" });
    expect(await 落到渠道(占位(抖音), 我())).toEqual({ ok: false, error: "主渠道「抖音」下已经有子渠道了，请刷新后选具体的子渠道" });
    expect(await 落到渠道(占位("没有这个"), 我())).toEqual({ ok: false, error: "这个渠道不存在或已停用，换一个" });
    await prisma.entChannelMain.update({ where: { id: 展会 }, data: { category: null } });
    const ok = await 落到渠道(占位(展会), 我());
    await prisma.channel.update({ where: { id: ok.ok ? ok.id! : "" }, data: { active: false } });
    expect(await 落到渠道(占位(展会), 我())).toEqual({ ok: false, error: "这个渠道不存在或已停用，换一个" });
  });
});

describe("几条入口", () => {
  function 输入(客户渠道: string | null, 项目渠道?: string | null, phone = "13900000001"): 建档向导输入 {
    return {
      客户: {
        name: `向导客户${phone}`, phone, school: null, grade: null, major: null,
        followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
        salesOwnerId: 销售, channelId: 客户渠道, referrerCustomerId: null,
      },
      联系人: { name: "王经理", position: "采购", phone },
      项目: { name: "一期", amount: 0, currency: "CNY", ownerId: 销售, 业务线: "内贸", ...(项目渠道 !== undefined ? { channelId: 项目渠道 } : {}) },
      跟进: { type: "PHONE", content: "电话聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false },
    } as 建档向导输入;
  }
  const 当销售 = () => { mocks.user = { ...mocks.user, id: 销售, name: "销售乙", role: "SALES" }; };

  it("建档向导：客户来源选只有主渠道的 → 客户、项目都挂上自动建的那条，渠道负责人 = 主渠道负责人", async () => {
    当销售();
    const r = await 建档向导(输入(占位(展会)));
    expect(r).toMatchObject({ ok: true });
    const c = await 入口("某展会");
    expect(c).toMatchObject({ mainId: 展会, channelOwnerId: 运营 });
    const p = await prisma.project.findFirstOrThrow({ include: { customer: true } });
    expect(p.channelId).toBe(c!.id);
    expect(p.customer).toMatchObject({ channelId: c!.id, channelOwnerId: 运营 });
    // 第二位客户再选同一个主渠道（页面没刷新，交来的还是占位）：挂同一条
    expect(await 建档向导(输入(占位(展会), undefined, "13900000002"))).toMatchObject({ ok: true });
    expect(await prisma.channel.count({ where: { mainId: 展会 } })).toBe(1);
    expect(await prisma.customer.count({ where: { channelId: c!.id } })).toBe(2);
  });

  it("建档向导：项目来源另选只有主渠道的；主渠道没定负责人的整笔不建", async () => {
    当销售();
    const r = await 建档向导(输入(抖音号, 占位(展会)));
    expect(r).toMatchObject({ ok: true });
    const p = await prisma.project.findFirstOrThrow({ include: { customer: true } });
    expect(p.channelId).toBe((await 入口("某展会"))!.id);
    expect(p.customer.channelId).toBe(抖音号);
    const 不行 = await 建档向导(输入(占位(没人管), undefined, "13900000003"));
    expect(不行).toMatchObject({ ok: false, error: expect.stringContaining("还没指定负责人") });
    expect(await prisma.customer.count()).toBe(1);
  });

  it("编辑项目补来源（空着可补一次）：补只有主渠道的；已有来源的照旧锁着、不建东西", async () => {
    当销售();
    const 客 = await prisma.customer.create({ data: { name: "老客户", phone: "13800000001", salesOwnerId: 销售 } });
    const p = await prisma.project.create({ data: { name: "一号", customerId: 客.id, ownerId: 销售, creatorId: 销售 } });
    expect(await 改项目({ id: 销售, role: "SALES" }, p.id, { channelId: 占位(展会) })).toMatchObject({ ok: true });
    const c = await 入口("某展会");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).channelId).toBe(c!.id);
    const 再 = await prisma.entChannelMain.create({ data: { name: "另一个展", ownerId: 运营 } });
    expect(await 改项目({ id: 销售, role: "SALES" }, p.id, { channelId: 占位(再.id) })).toMatchObject({ ok: false });
    expect(await 入口("另一个展")).toBeNull();
  });

  it("编辑客户补来源：原来没来源的客户补只有主渠道的", async () => {
    const 客 = await prisma.customer.create({ data: { name: "没来源的客户", phone: "13800000009", salesOwnerId: 老板 } });
    const r = await saveCustomer({
      id: 客.id, updatedAt: 客.updatedAt.toISOString(), name: 客.name, phone: 客.phone, school: null, grade: null, major: null, followStatus: 客.followStatus, decisionStatus: 客.decisionStatus,
      expectedSignAt: null, remark: null, salesOwnerId: 老板, channelId: 占位(展会), referrerCustomerId: null,
    });
    expect(r).toEqual(expect.objectContaining({ ok: true }));
    const c = await 入口("某展会");
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: 客.id } })).toMatchObject({ channelId: c!.id, channelOwnerId: 运营 });
  });

  it("首页 AI 录入：卡上的来源写的是只有主渠道的主渠道名 → 认得出，建好挂上那条", async () => {
    当销售();
    const r = await applyProposal({
      id: "p1", kind: "add_lead", customerId: "", customerName: "", reason: "测试",
      name: "星河电子", contact: "周经理", phone: "13700001234", source: "某展会", status: "待跟进", remark: "要样品",
      分配方式: 4, 业务线: "内贸", 节点: "潜客培育", 明确回复: false,
    } as never);
    expect(r).toMatchObject({ ok: true });
    const c = await 入口("某展会");
    expect((await prisma.customer.findFirstOrThrow({ where: { name: "星河电子" } })).channelId).toBe(c!.id);
  });

  it("客户导入：来源渠道写主渠道名 → 预览认得、落库时建一条挂上；没定负责人的主渠道照对不上留空", async () => {
    const 表头 = ["客户名称", "手机号", "来源渠道"];
    const 数据 = [["导入甲", "13600000001", "某展会"], ["导入乙", "13600000002", "某展会"], ["导入丙", "13600000003", "没人管的"]];
    const 方案: 导入方案 = { 表头, 数据, 映射: 猜列(表头, 字段表(await getBusiness())), 重复行: "跳过" };
    expect(方案.映射).toContain("channelName");
    const 预 = await 预览导入(方案);
    expect(预.ok).toBe(true);
    // 预览不建东西
    expect(await 入口("某展会")).toBeNull();
    const r = await 执行导入(方案, "a.xlsx");
    expect(r).toMatchObject({ ok: true });
    const c = await 入口("某展会");
    expect(c).toMatchObject({ mainId: 展会, channelOwnerId: 运营 });
    expect(await prisma.customer.count({ where: { channelId: c!.id } })).toBe(2);
    const 丙 = await prisma.customer.findFirstOrThrow({ where: { name: "导入丙" } });
    expect(丙.channelId).toBeNull();
    expect(丙.remark ?? "").toContain("没人管的");
    expect(await 入口("没人管的")).toBeNull();
  });
});

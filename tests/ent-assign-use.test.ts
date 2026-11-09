/**
 * 分配方式「谁能用」（10-27 批注，lib/enterprise/assign-use.ts + dict.ts 挡分配方式 / 改分配谁能用）。
 * 钉的是：默认表（指定 / 自动 / 暂不分配 = 市场 + 销售 + 其他（11-01 会议 §1 / §3 按角色给默认值），公海捞取 = 市场 + 其他，个人自持 = 销售）；
 * 老板、总管理、管理员每样都能用；后加的项默认所有人；存坏了当没存；
 * 改了以后 分配线索 / 自动分配线索 照着拦；「公海捞取」= 谁能把线索放去公海分，不管领：从公海领照旧非原负责人都能领（10-26）；
 * 谁能改同字典一行、只认字典里有的项；不是企业版一条都不管。
 * 新建线索向导（10-27 A7）：五种都生效——只能选自己能用、还启用着的；自动分配建好分给销售、公海捞取建好进项目公海、暂不分配 / 个人自持记在自己名下；
 * 没传分配方式（老草稿）照负责人推。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "a@x", role: "ADMIN", title: "", avatar: null },
  企业版: true,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => mocks.企业版 }));
vi.mock("@/lib/shared-ws/current", () => ({ 当前是共享区: async () => false }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { getSetting, setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 读组织 } from "@/lib/enterprise/org";
import {
  分配默认谁能用, 分配方式id, 分配谁能用key, 规整分配谁能用, 谁能用, 能用分配方式, 谁能用的话,
  挡分配方式, 改分配谁能用, 读分配谁能用, 我能用的分配方式,
} from "@/lib/enterprise/dict";
import { 分配线索, 自动分配线索 } from "@/app/(app)/leads/assign-actions";
import { 领取项目, 建档向导, type 建档向导输入 } from "@/app/(app)/projects/actions";
import { 存分配谁能用 } from "@/app/(app)/settings/ent-dict-actions";
import { 公海规则, 公海客户先领取话 } from "@/lib/enterprise/pool-rules";
import { 自动分配不参与key } from "@/lib/enterprise/lead-assign";
import { 新建分配方式数据 } from "@/lib/project/after-create-assign";
import { 没业务角色不能新建话, 只读角色话 } from "@/lib/enterprise/permissions";
import { saveCustomer } from "@/app/(app)/customers/actions";
import { 给客户建项目 } from "@/app/(app)/customers/[id]/project-actions";
import { convertLead } from "@/app/(app)/leads/actions";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 市场成员key } from "@/lib/enterprise/market";

let 老板: string, 总管: string, 市场: string, 销售经理: string, 销售: string, 另一销售: string, 渠道: string, 项运: string;
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role }; };
const 建线索 = async (name: string, ownerId: string | null = 市场) => (await prisma.lead.create({ data: { name, ownerId } })).id;
let 序 = 0;
async function 公海项目(phase: string, 原负责人: string) {
  序++;
  const c = (await prisma.customer.create({ data: { name: `客户${序}`, phone: `1380000${String(序).padStart(4, "0")}`, salesOwnerId: 原负责人 } })).id;
  return (await prisma.project.create({ data: { name: `项目${序}`, customerId: c, ownerId: 原负责人, creatorId: 原负责人, phase, pooledAt: new Date() } })).id;
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  mocks.企业版 = true;
  const 人 = async (email: string, name: string, role = "SALES") => (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
  老板 = await 人("boss", "老板", "ADMIN");
  总管 = await 人("dir", "总管");
  市场 = await 人("mkt", "市场小李");
  销售经理 = await 人("smgr", "销售经理");
  销售 = await 人("s1", "小王");
  另一销售 = await 人("s2", "小张");
  渠道 = await 人("cs", "渠道");
  项运 = await 人("po", "项运");
  await prisma.entMember.createMany({
    data: [
      // 11-01：权限只认业务角色，老板也要设成总管理
      { userId: 老板, bizRole: "director" },
      { userId: 总管, bizRole: "director" },
      { userId: 市场, bizRole: "marketing_mgr" },
      { userId: 销售经理, bizRole: "sales_mgr" },
      { userId: 销售, bizRole: "sales", managerId: 销售经理 },
      { userId: 另一销售, bizRole: "sales", managerId: 销售经理 },
      { userId: 渠道, bizRole: "channel_ops" },
      { userId: 项运, bizRole: "project_ops" },
    ],
  });
  await setSetting(规则.线索分配.key, true);
  当(老板, "ADMIN");
});

describe("纯函数", () => {
  it("默认表：市场除自持外都有；销售 = 指定、自动、暂不分配、自持；其他角色 = 指定、自动、公海捞取、暂不分配（11-01）", () => {
    expect(分配默认谁能用[分配方式id.指定]).toEqual(["marketing_mgr", "sales_mgr", "sales", "channel_ops", "project_ops"]);
    expect(分配默认谁能用[分配方式id.自动]).toEqual(["marketing_mgr", "sales_mgr", "sales", "channel_ops", "project_ops"]);
    expect(分配默认谁能用[分配方式id.公海捞取]).toEqual(["marketing_mgr", "channel_ops", "project_ops"]);
    expect(分配默认谁能用[分配方式id.暂不分配]).toEqual(["marketing_mgr", "sales_mgr", "sales", "channel_ops", "project_ops"]);
    expect(分配默认谁能用[分配方式id.个人自持]).toEqual(["sales_mgr", "sales"]);
    // 按角色看：其他角色（渠道运营、项目组员）默认 = 指定、自动、公海捞取、暂不分配（默认值是暂不分配，所以得能用）；销售没有公海捞取
    const 有的 = (r: string) => Object.entries(分配默认谁能用).filter(([, v]) => v.includes(r as never)).map(([id]) => id);
    for (const r of ["channel_ops", "project_ops"]) expect(有的(r)).toEqual([分配方式id.指定, 分配方式id.自动, 分配方式id.公海捞取, 分配方式id.暂不分配]);
    for (const r of ["sales", "sales_mgr"]) expect(有的(r)).toEqual([分配方式id.指定, 分配方式id.自动, 分配方式id.暂不分配, 分配方式id.个人自持]);
    expect(谁能用("dict-assign-9", {})).toBe("所有人");
    expect(谁能用(分配方式id.自动, { [分配方式id.自动]: [] })).toEqual([]);
  });

  it("存坏了当没存，不认识的角色丢掉；director、admin 不在可选里", () => {
    expect(规整分配谁能用(null)).toEqual({});
    expect(规整分配谁能用([1])).toEqual({});
    expect(规整分配谁能用({ a: ["sales", "director", "x", "sales"], b: "sales" })).toEqual({ a: ["sales"] });
  });

  it("老板、总管理、管理员全能用；别人按表；不在组织里（停用）不能用", async () => {
    await prisma.entMember.create({ data: { userId: (await prisma.user.create({ data: { email: "ad", name: "管理员", title: "", role: "SALES", password: "x" } })).id, bizRole: "admin" } });
    const org = await 读组织();
    const 管理员 = [...org.成员.entries()].find(([, m]) => m.bizRole === "admin")![0];
    const 能 = (id: string, who: string, role = "SALES", 配置 = {}) => 能用分配方式(org, { id: who, role }, id, 配置);
    expect(能(分配方式id.暂不分配, 老板, "ADMIN")).toBe(true);
    expect(能(分配方式id.暂不分配, 总管)).toBe(true);
    expect(能(分配方式id.暂不分配, 管理员)).toBe(true);
    expect(能(分配方式id.暂不分配, 市场)).toBe(true);
    expect(能(分配方式id.暂不分配, 销售)).toBe(true);
    expect(能(分配方式id.自动, 销售)).toBe(true);
    expect(能(分配方式id.公海捞取, 销售)).toBe(false);
    expect(能(分配方式id.公海捞取, 渠道)).toBe(true);
    expect(能(分配方式id.公海捞取, 市场)).toBe(true);
    expect(能(分配方式id.个人自持, 市场)).toBe(false);
    expect(能(分配方式id.个人自持, 销售)).toBe(true);
    expect(能(分配方式id.个人自持, 项运)).toBe(false);
    expect(能(分配方式id.指定, 渠道)).toBe(true);
    expect(能(分配方式id.自动, 渠道)).toBe(true);
    expect(能(分配方式id.暂不分配, 项运)).toBe(true);
    expect(能(分配方式id.个人自持, 渠道)).toBe(false);
    expect(能("dict-assign-9", 销售)).toBe(true);
    expect(能(分配方式id.公海捞取, 销售, "SALES", { [分配方式id.公海捞取]: ["sales"] })).toBe(true);
    expect(能(分配方式id.指定, "没这个人")).toBe(false);
    expect(谁能用的话(分配方式id.公海捞取, "公海捞取", {})).toBe("「公海捞取」只有总管理、管理员和市场管理、渠道运营、项目组员能用");
    expect(谁能用的话(分配方式id.自动, "自动分配", { [分配方式id.自动]: [] })).toBe("「自动分配」只有总管理、管理员能用");
  });
});

describe("动作照着拦", () => {
  it("把市场管理从「指定分配」去掉：市场分不了线索，报现在的叫法；总管理照旧能分", async () => {
    当(市场);
    expect(await 分配线索({ leadId: await 建线索("A"), toUserId: 销售 })).toEqual({ ok: true });
    当(老板, "ADMIN");
    expect(await 存分配谁能用({ [分配方式id.指定]: ["sales_mgr"] })).toEqual({ ok: true });
    当(市场);
    const L = await 建线索("B");
    expect(await 分配线索({ leadId: L, toUserId: 销售 })).toEqual({ ok: false, error: "「指定分配」只有总管理、管理员和销售管理能用" });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: L } })).ownerId).toBe(市场);
    当(总管);
    expect(await 分配线索({ leadId: L, toUserId: 销售 })).toEqual({ ok: true });
  });

  it("把市场管理从「自动分配」去掉：自动分配拦下、不改负责人", async () => {
    await prisma.entLeadQuota.create({ data: { userId: 销售, quota: 5, setById: 老板 } });
    // 没设配额 = 不限额也能分（11-01）：另两位设成不参与，只剩小王可分
    await setSetting(自动分配不参与key, { [销售经理]: "禁止", [另一销售]: "禁止" });
    当(老板, "ADMIN");
    expect(await 存分配谁能用({ [分配方式id.自动]: [] })).toEqual({ ok: true });
    当(市场);
    const L = await 建线索("C");
    expect(await 自动分配线索(L)).toMatchObject({ ok: false, error: "「自动分配」只有总管理、管理员能用" });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: L } })).ownerId).toBe(市场);
    当(老板, "ADMIN");
    expect(await 自动分配线索(L)).toMatchObject({ ok: true, toUserId: 销售 });
  });

  it("公海捞取不管领：默认表里没有销售，销售照旧能从公海领线索阶段的项目（项目能单独领开着时；10-31 起默认只随客户领）", async () => {
    const p = await 公海项目("线索", 另一销售);
    当(销售);
    公海规则.项目能单独领 = true;
    try {
      expect(await 领取项目(p)).toMatchObject({ ok: true });
    } finally {
      公海规则.项目能单独领 = false;
    }
  });
});

describe("谁能改、存什么", () => {
  it("同字典一行：销售改不了；只存字典里有的项、和存过的合并", async () => {
    当(销售);
    expect(await 改分配谁能用({ id: 销售, role: "SALES" }, { [分配方式id.公海捞取]: ["sales"] })).toMatchObject({ ok: false });
    expect(await getSetting(分配谁能用key)).toBeFalsy();
    当(老板, "ADMIN");
    expect(await 存分配谁能用({ [分配方式id.公海捞取]: ["sales"], "dict-assign-99": ["sales"] })).toEqual({ ok: true });
    expect(await 存分配谁能用({ [分配方式id.暂不分配]: ["sales_mgr", "director"] })).toEqual({ ok: true });
    expect(await 读分配谁能用()).toEqual({ [分配方式id.公海捞取]: ["sales"], [分配方式id.暂不分配]: ["sales_mgr"] });
  });
});

describe("不是企业版", () => {
  it("一条都不管：挡分配方式 null、读出来空、存被拦、手动分照旧", async () => {
    mocks.企业版 = false;
    expect(await 挡分配方式({ id: 销售, role: "SALES" }, 0)).toBeNull();
    expect(await 读分配谁能用()).toEqual({});
    expect(await 改分配谁能用({ id: 老板, role: "ADMIN" }, {})).toEqual({ ok: false, error: "企业版才有这项设置" });
    await setSetting(分配谁能用key, { [分配方式id.指定]: [] });
    当(市场);
    const r = await 分配线索({ leadId: await 建线索("D"), toUserId: 销售 });
    expect(r.ok ? "" : r.error).not.toMatch("只有老板");
  });
});

describe("新建线索向导：五种分配方式都生效（10-27 A7）", () => {
  let 号 = 0;
  const 向导 = async ({ 地址, ...项目 }: Partial<建档向导输入["项目"]> & { 地址?: { addrCountry: string; addrProvince: string; addrCity: string; addrDistrict: string } }) => {
    号++;
    const 渠 = (await prisma.channel.findFirst()) ?? (await prisma.channel.create({ data: { name: "小红", channelOwnerId: 老板 } }));
    return 建档向导({
      客户: {
        name: `向导客户${号}`, phone: `1391111${String(号).padStart(4, "0")}`, school: null, grade: null, major: null,
        followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
        salesOwnerId: 项目.ownerId ?? mocks.user.id, channelId: 渠.id, referrerCustomerId: null,
        ...(地址 ? { 企业资料: 地址 } : {}),
      },
      联系人: { name: "王经理", position: "采购", phone: "" },
      // 业务线企业版新建必填（11-01 A1）：没给按内贸
      项目: { name: `向导项目${号}`, amount: 0, currency: "CNY", ownerId: mocks.user.id, 业务线: "内贸", ...项目 },
      跟进: { type: "PHONE", content: "聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false },
    });
  };
  const 项目of = (id: string) => prisma.project.findUniqueOrThrow({ where: { id }, include: { customer: { select: { salesOwnerId: true } } } });

  it("下拉只给能用、还启用着的：市场 = 指定 / 自动 / 公海捞取 / 暂不分配，销售 = 指定 / 自动 / 暂不分配 / 个人自持；停用的不出", async () => {
    expect((await 我能用的分配方式({ id: 市场, role: "SALES" })).map((x) => x.i)).toEqual([0, 1, 2, 3]);
    expect((await 我能用的分配方式({ id: 销售, role: "SALES" })).map((x) => x.i)).toEqual([0, 1, 3, 4]);
    expect((await 我能用的分配方式({ id: 老板, role: "ADMIN" })).map((x) => x.i)).toEqual([0, 1, 2, 3, 4]);
    await prisma.entDictItem.update({ where: { id: 分配方式id.暂不分配 }, data: { active: false } });
    expect((await 我能用的分配方式({ id: 市场, role: "SALES" })).map((x) => x.i)).toEqual([0, 1, 2]);
    当(市场);
    expect(await 向导({ 分配方式: 3 })).toMatchObject({ ok: false, error: "这种分配方式已停用，换一种" });
  });

  it("没设业务角色（11-03 D3-6）：挡住的话直说没设角色；向导数据标出没角色，好在入口就提示", async () => {
    const 没角色 = (await prisma.user.create({ data: { email: "none", name: "没角色", title: "", role: "SALES", password: "x" } })).id;
    expect(await 挡分配方式({ id: 没角色, role: "SALES" }, 0)).toBe(没业务角色不能新建话);
    const 人 = (id: string) => ({ id, role: "SALES", name: "", email: "", title: "" });
    expect(await 新建分配方式数据(人(没角色))).toMatchObject({ 分配方式们: [], 没角色: true });
    expect(await 新建分配方式数据(人(销售))).toMatchObject({ 没角色: false });
    当(没角色);
    expect(await 向导({ 分配方式: 0, ownerId: 销售 })).toMatchObject({ ok: false, error: 没业务角色不能新建话 });
    expect(await prisma.project.count()).toBe(0);
  });

  it("只读管理员（11-03 D3-7 ④）：新线索向导、新建客户都拦，一行不写", async () => {
    const 管 = (await prisma.user.create({ data: { email: "ad", name: "管理员", title: "", role: "ADMIN", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: 管, bizRole: "admin" } });
    当(管, "ADMIN");
    expect(await 向导({ 分配方式: 0, ownerId: 销售 })).toMatchObject({ ok: false, error: 只读角色话 });
    expect(await saveCustomer({ name: "新客户甲", phone: "13900000001", salesOwnerId: 销售 } as never)).toMatchObject({ ok: false, error: 只读角色话 });
    expect([await prisma.project.count(), await prisma.customer.count()]).toEqual([0, 0]);
  });

  it("用不了的拦下、一行不写：销售选公海捞取、市场选个人自持", async () => {
    当(销售);
    expect(await 向导({ 分配方式: 2 })).toMatchObject({ ok: false });
    当(市场);
    expect(await 向导({ 分配方式: 4 })).toMatchObject({ ok: false });
    expect(await 向导({ 分配方式: 9 })).toMatchObject({ ok: false, error: "没有这种分配方式，刷新后再选" });
    expect(await prisma.project.count()).toBe(0);
  });

  it("指定分配：记在选的负责人名下", async () => {
    当(市场);
    const r = await 向导({ 分配方式: 0, ownerId: 销售 });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const p = await 项目of(r.projectId);
    expect([p.ownerId, p.customer.salesOwnerId, p.pooledAt]).toEqual([销售, 销售, null]);
    // 不在我名下了：回线索列表，不跳看不到的详情页（11-03 A2-1）
    expect(r).toMatchObject({ 转走: true, 提示: expect.stringContaining("已指派给") });
  });

  it("指定分配给别人：按真身份（带限定）建档也成、最后跟进时间记上（11-05 bug：改最后跟进时间被当成改别人的只读客户，整单回滚）", async () => {
    // 生产上「按组织看客户」开着、建档的人是市场成员：限定层按真身份算
    await setSetting("enterprise.rule.org_scope", true);
    await setSetting(市场成员key, [市场]);
    忘掉企业版范围();
    for (const [我, 给] of [[市场, 销售], [销售, 另一销售], [销售经理, 销售]] as const) {
      当(我);
      const r = await 以谁的身份(我, () => 向导({ 分配方式: 0, ownerId: 给 }));
      expect(r).toMatchObject({ ok: true, 转走: true });
      if (!r.ok) return;
      const p = await 项目of(r.projectId);
      expect([我, p.ownerId, p.customer.salesOwnerId]).toEqual([我, 给, 给]);
      const c = await prisma.customer.findUniqueOrThrow({ where: { id: p.customerId } });
      expect(c.lastFollowAt).not.toBeNull();
      expect(await prisma.followUp.count({ where: { customerId: p.customerId } })).toBe(1);
    }
  });

  it("客户页给自己的客户新建项目、指定给别人：按真身份（带限定）也成，首条沟通和最近跟进记上（11-05 同类排查）", async () => {
    await setSetting("enterprise.rule.org_scope", true);
    await setSetting(市场成员key, [市场]);
    忘掉企业版范围();
    for (const [我, 给] of [[市场, 销售], [销售, 另一销售], [销售经理, 销售]] as const) {
      当(我);
      号++;
      const cid = (await prisma.customer.create({ data: { name: `页客户${号}`, phone: `1392222${String(号).padStart(4, "0")}`, salesOwnerId: 我 } })).id;
      const r = await 以谁的身份(我, () => 给客户建项目({
        customerId: cid,
        项目: { name: `页项目${号}`, amount: 0, currency: "CNY", ownerId: 给, 分配方式: 0, 业务线: "内贸" },
        跟进: { type: "PHONE", content: "聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false },
      }));
      expect([我, r]).toMatchObject([我, { ok: true }]);
      if (!r.ok) return;
      const p = await 项目of(r.projectId);
      expect(p.ownerId).toBe(给);
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: cid } })).lastFollowAt).not.toBeNull();
      expect(await prisma.followUpProject.count({ where: { projectId: r.projectId } })).toBe(1);
    }
  });

  it("客户页给公海里的客户新建项目：谁都不给建，说先领取，项目和沟通一条不落（11-05）", async () => {
    for (const 我 of [老板, 销售, 销售经理]) {
      当(我, 我 === 老板 ? "ADMIN" : "SALES");
      号++;
      const cid = (await prisma.customer.create({ data: { name: `公海页客户${号}`, phone: `1394444${String(号).padStart(4, "0")}`, salesOwnerId: 另一销售 } })).id;
      await prisma.customerPool.create({ data: { customerId: cid, reason: "手动" } });
      const r = await 以谁的身份(我, () => 给客户建项目({
        customerId: cid,
        项目: { name: `公海页项目${号}`, amount: 0, currency: "CNY", ownerId: 我, 分配方式: 0, 业务线: "内贸" },
        跟进: { type: "PHONE", content: "聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false },
      }));
      expect([我, r]).toEqual([我, { ok: false, error: 公海客户先领取话 }]);
      expect(await prisma.project.count({ where: { customerId: cid } })).toBe(0);
      expect(await prisma.followUp.count({ where: { customerId: cid } })).toBe(0);
    }
  });

  it("线索负责人不是转换人：按真身份（带限定）转客户也成，首条沟通和最近跟进记上（11-05 同类排查）", async () => {
    await setSetting("enterprise.rule.org_scope", true);
    await setSetting(市场成员key, [市场]);
    忘掉企业版范围();
    for (const [我, 线索主] of [[销售经理, 销售], [老板, 市场], [老板, 销售]] as const) {
      当(我, 我 === 老板 ? "ADMIN" : "SALES"); 号++;
      const lid = (await prisma.lead.create({ data: { name: `转线索${号}`, phone: `1393333${String(号).padStart(4, "0")}`, ownerId: 线索主 } })).id;
      const r = await 以谁的身份(我, () => convertLead(lid, { type: "PHONE", content: "聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false }));
      expect([我, 线索主, r]).toMatchObject([我, 线索主, { ok: true }]);
      if (!r.ok) return;
      const c = await prisma.customer.findUniqueOrThrow({ where: { id: r.customerId } });
      expect(c.salesOwnerId).toBe(线索主);
      expect(c.lastFollowAt).not.toBeNull();
      expect(r.projectId).toBeTruthy();
      expect(await prisma.followUpProject.count({ where: { projectId: r.projectId! } })).toBe(1);
    }
  });

  it("指定分配只能给销售 / 销售管理（11-03 A2-1）：指给渠道运营、市场管理拦下、一行不写", async () => {
    当(市场);
    for (const 谁 of [渠道, 项运, 总管]) expect(await 向导({ 分配方式: 0, ownerId: 谁 })).toMatchObject({ ok: false, error: "线索只能分给销售或销售管理" });
    当(销售);
    expect(await 向导({ 分配方式: 0, ownerId: 市场 })).toMatchObject({ ok: false, error: "线索只能分给销售或销售管理" });
    expect(await prisma.project.count()).toBe(0);
    expect(await 向导({ 分配方式: 0, ownerId: 销售经理 })).toMatchObject({ ok: true, 转走: true });
  });

  it("暂不分配 / 个人自持：选了别人也记在自己名下；暂不分配留在新线索待分配、不发提醒，个人自持不待分配；分配方式记在项目上", async () => {
    当(市场);
    const a = await 向导({ 分配方式: 3, ownerId: 销售 });
    当(销售);
    const b = await 向导({ 分配方式: 4, ownerId: 另一销售 });
    for (const [r, 谁] of [[a, 市场], [b, 销售]] as const) {
      expect(r).toMatchObject({ ok: true });
      if (r.ok) expect((await 项目of(r.projectId)).ownerId).toBe(谁);
    }
    if (!a.ok || !b.ok) return;
    expect(a).toMatchObject({ 转走: false, 提示: "已留在新线索待分配，等市场管理、销售管理、总管理员分" });
    expect("提示" in b).toBe(false);
    const [pa, pb] = [await 项目of(a.projectId), await 项目of(b.projectId)];
    expect([pa.assignMode, pa.awaitAssignAt === null]).toEqual(["暂不分配", false]);
    expect([pb.assignMode, pb.awaitAssignAt]).toEqual(["个人自持", null]);
    expect(await prisma.setting.count({ where: { key: { startsWith: "entLeadFullNotice:" } } })).toBe(0);
  });

  it("公海捞取：建好放进线索公海", async () => {
    当(市场);
    const r = await 向导({ 分配方式: 2 });
    expect(r).toMatchObject({ ok: true, 转走: true, 提示: "已放进线索公海，等人捞取" });
    if (r.ok) expect((await 项目of(r.projectId)).pooledAt).not.toBeNull();
  });

  it("业务线必填（A1）：没选不让建、乱填不让建，一行不写；选了记在项目上", async () => {
    当(市场);
    expect(await 向导({ 分配方式: 3, 业务线: null })).toMatchObject({ ok: false, error: expect.stringContaining("业务线必填") });
    expect(await 向导({ 分配方式: 3, 业务线: "国内" })).toMatchObject({ ok: false, error: expect.stringContaining("业务线只能选") });
    expect(await prisma.project.count()).toBe(0);
    const r = await 向导({ 分配方式: 3, 业务线: "外贸" });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect((await 项目of(r.projectId)).bizLine).toBe("外贸");
  });

  it("自动分配：按选的业务线（内贸）分给一位内贸销售，客户跟着走、项目不待分配；地址不参与", async () => {
    await prisma.entMember.updateMany({ where: { userId: { in: [销售, 另一销售] } }, data: { line: "内贸" } });
    await setSetting(自动分配不参与key, { [销售经理]: "禁止" });
    当(市场);
    // 地址填的是外国，也照选的业务线（内贸）分
    const r = await 向导({ 分配方式: 1, 业务线: "内贸", 地址: { addrCountry: "美国", addrProvince: "", addrCity: "", addrDistrict: "" } });
    expect(r).toMatchObject({ ok: true, 转走: true });
    if (!r.ok) return;
    const p = await 项目of(r.projectId);
    expect([销售, 另一销售]).toContain(p.ownerId);
    expect(p.customer.salesOwnerId).toBe(p.ownerId);
    expect([p.assignMode, p.awaitAssignAt, p.bizLine, p.creatorId]).toEqual(["自动分配", null, "内贸", 市场]);
    // A8：建的人留着，「我分出去的线索」查得到
    expect(await prisma.entLeadAssign.count({ where: { projectId: r.projectId, toUserId: p.ownerId, byUserId: 市场 } })).toBe(1);
  });

  it("自动分配 + 业务线「暂不分配」：不自动分，留在新线索待分配，不发提醒（A7）", async () => {
    await prisma.entMember.updateMany({ where: { userId: { in: [销售, 另一销售] } }, data: { line: "内贸" } });
    当(市场);
    const r = await 向导({ 分配方式: 1, 业务线: "暂不分配" });
    expect(r).toMatchObject({ ok: true, 转走: false });
    if (!r.ok) return;
    expect(r.提示).toMatch("业务线是「暂不分配」，不自动分");
    const p = await 项目of(r.projectId);
    expect([p.ownerId, p.assignMode, p.bizLine, p.awaitAssignAt === null]).toEqual([市场, "自动分配", "暂不分配", false]);
    expect(await prisma.entLeadAssign.count()).toBe(0);
    expect(await prisma.setting.count({ where: { key: { startsWith: "entLeadFullNotice:" } } })).toBe(0);
  });

  it("自动分配没人可分（这条线没人）：留在新线索待分配，提醒市场管理、销售管理、总管理员；之后手动分出去清掉待分配", async () => {
    // 两个销售都只做内贸、销售经理禁止自动分配：外贸这条线没人
    await prisma.entMember.updateMany({ where: { userId: { in: [销售, 另一销售] } }, data: { line: "内贸" } });
    await setSetting(自动分配不参与key, { [销售经理]: "禁止" });
    当(市场);
    const r = await 向导({ 分配方式: 1, 业务线: "外贸" });
    expect(r).toMatchObject({ ok: true, 转走: false });
    if (!r.ok) return;
    expect(r.提示).toMatch("已提醒市场管理、销售管理、总管理员");
    expect((await 项目of(r.projectId)).awaitAssignAt).not.toBeNull();
    expect(await prisma.setting.count({ where: { key: `entLeadFullNotice:${总管}` } })).toBe(1);
    // 外贸项目只能指派给外贸线的人：先把销售改回两边都做
    await prisma.entMember.update({ where: { userId: 销售 }, data: { line: null } });
    expect(await 分配线索({ projectId: r.projectId, toUserId: 销售 })).toMatchObject({ ok: true });
    const p = await 项目of(r.projectId);
    expect([p.ownerId, p.awaitAssignAt]).toEqual([销售, null]);
  });

  it("其他角色（渠道运营、项目组员）能新建线索：下拉 = 指定 / 自动 / 公海捞取 / 暂不分配；建给自己、指定别人、放公海都成，选个人自持被拦（11-01）", async () => {
    for (const 谁 of [渠道, 项运]) expect((await 我能用的分配方式({ id: 谁, role: "SALES" })).map((x) => x.i)).toEqual([0, 1, 2, 3]);
    当(渠道);
    const a = await 向导({});
    const b = await 向导({ 分配方式: 0, ownerId: 销售 });
    当(项运);
    const c = await 向导({ 分配方式: 2 });
    // 放公海的进了公海就没负责人（11-01 C-01），建的人记在留痕里
    for (const [r, 谁] of [[a, 渠道], [b, 销售], [c, ""]] as const) {
      expect(r).toMatchObject({ ok: true });
      if (r.ok) expect((await 项目of(r.projectId)).ownerId).toBe(谁);
    }
    if (c.ok) expect((await 项目of(c.projectId)).pooledAt).not.toBeNull();
    if (c.ok) expect(await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: c.projectId, kind: "pool-release" } })).toMatchObject({ fromOwnerId: 项运 });
    expect(await 向导({ 分配方式: 4 })).toMatchObject({ ok: false });
  });

  it("没传分配方式（老草稿）：选了别人 = 指定，建给自己 = 个人自持，用不了个人自持的 = 暂不分配", async () => {
    当(销售);
    const a = await 向导({ ownerId: 另一销售 });
    const b = await 向导({});
    当(市场);
    const c = await 向导({});
    for (const [r, 谁] of [[a, 另一销售], [b, 销售], [c, 市场]] as const) {
      expect(r).toMatchObject({ ok: true });
      if (r.ok) expect((await 项目of(r.projectId)).ownerId).toBe(谁);
    }
    const 审计 = await prisma.auditLog.findMany({ where: { entity: "Project", action: "create" }, select: { summary: true }, orderBy: { at: "asc" } });
    expect(审计.map((x) => x.summary.match(/分配方式「(.+?)」/)?.[1])).toEqual(["指定分配", "个人自持", "暂不分配"]);
  });

  it("不是企业版：不看分配方式，照负责人建", async () => {
    mocks.企业版 = false;
    当(销售);
    expect(await 我能用的分配方式({ id: 销售, role: "SALES" })).toEqual([]);
  });
});

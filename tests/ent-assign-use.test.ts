/**
 * 分配方式「谁能用」（10-27 批注，lib/enterprise/assign-use.ts + dict.ts 挡分配方式 / 改分配谁能用）。
 * 钉的是：默认表（指定 = 市场 + 销售 + 其他，自动 / 公海捞取 = 市场 + 其他，暂不分配 = 市场，自拓自持 = 销售 + 其他）；
 * 老板、总管理、管理员每样都能用；后加的项默认所有人；存坏了当没存；
 * 改了以后 分配线索 / 自动分配线索 照着拦；「公海捞取」= 谁能把线索放去公海分，不管领：从公海领照旧非原负责人都能领（10-26）；
 * 谁能改同字典一行、只认字典里有的项；不是企业版一条都不管。
 * 新建线索向导（10-27 A7）：五种都生效——只能选自己能用、还启用着的；自动分配建好分给销售、公海捞取建好进项目公海、暂不分配 / 自拓自持记在自己名下；
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
  it("默认表：销售只有指定、自持；市场除自持外都有；其他角色只有指定、公海捞取（10-28）", () => {
    expect(分配默认谁能用[分配方式id.指定]).toEqual(["marketing_mgr", "sales_mgr", "sales", "channel_ops", "project_ops"]);
    expect(分配默认谁能用[分配方式id.自动]).toEqual(["marketing_mgr"]);
    expect(分配默认谁能用[分配方式id.公海捞取]).toEqual(["marketing_mgr", "channel_ops", "project_ops"]);
    expect(分配默认谁能用[分配方式id.暂不分配]).toEqual(["marketing_mgr"]);
    expect(分配默认谁能用[分配方式id.自拓自持]).toEqual(["sales_mgr", "sales"]);
    // 按角色看：其他角色（渠道运营、项目运营）默认只有指定、公海捞取
    for (const r of ["channel_ops", "project_ops"] as const) expect(Object.entries(分配默认谁能用).filter(([, v]) => v.includes(r)).map(([id]) => id)).toEqual([分配方式id.指定, 分配方式id.公海捞取]);
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
    expect(能(分配方式id.暂不分配, 销售)).toBe(false);
    expect(能(分配方式id.公海捞取, 销售)).toBe(false);
    expect(能(分配方式id.公海捞取, 渠道)).toBe(true);
    expect(能(分配方式id.公海捞取, 市场)).toBe(true);
    expect(能(分配方式id.自拓自持, 市场)).toBe(false);
    expect(能(分配方式id.自拓自持, 销售)).toBe(true);
    expect(能(分配方式id.自拓自持, 项运)).toBe(false);
    expect(能(分配方式id.指定, 渠道)).toBe(true);
    expect(能(分配方式id.自动, 渠道)).toBe(false);
    expect(能(分配方式id.暂不分配, 项运)).toBe(false);
    expect(能("dict-assign-9", 销售)).toBe(true);
    expect(能(分配方式id.公海捞取, 销售, "SALES", { [分配方式id.公海捞取]: ["sales"] })).toBe(true);
    expect(能(分配方式id.指定, "没这个人")).toBe(false);
    expect(谁能用的话(分配方式id.暂不分配, "暂不分配", {})).toBe("「暂不分配」只有老板、总管理、管理员和市场管理能用");
    expect(谁能用的话(分配方式id.自动, "自动分配", { [分配方式id.自动]: [] })).toBe("「自动分配」只有老板、总管理、管理员能用");
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
    expect(await 分配线索({ leadId: L, toUserId: 销售 })).toEqual({ ok: false, error: "「指定分配」只有老板、总管理、管理员和销售管理能用" });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: L } })).ownerId).toBe(市场);
    当(总管);
    expect(await 分配线索({ leadId: L, toUserId: 销售 })).toEqual({ ok: true });
  });

  it("把市场管理从「自动分配」去掉：自动分配拦下、不改负责人", async () => {
    await prisma.entLeadQuota.create({ data: { userId: 销售, quota: 5, setById: 老板 } });
    当(老板, "ADMIN");
    expect(await 存分配谁能用({ [分配方式id.自动]: [] })).toEqual({ ok: true });
    当(市场);
    const L = await 建线索("C");
    expect(await 自动分配线索(L)).toMatchObject({ ok: false, error: "「自动分配」只有老板、总管理、管理员能用" });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: L } })).ownerId).toBe(市场);
    当(老板, "ADMIN");
    expect(await 自动分配线索(L)).toMatchObject({ ok: true, toUserId: 销售 });
  });

  it("公海捞取不管领：默认表里没有销售，销售照旧能从公海领线索阶段的项目", async () => {
    const p = await 公海项目("线索", 另一销售);
    当(销售);
    expect(await 领取项目(p)).toMatchObject({ ok: true });
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
  const 向导 = async (项目: Partial<建档向导输入["项目"]>) => {
    号++;
    const 渠 = (await prisma.channel.findFirst()) ?? (await prisma.channel.create({ data: { name: "小红", channelOwnerId: 老板 } }));
    return 建档向导({
      客户: {
        name: `向导客户${号}`, phone: `1391111${String(号).padStart(4, "0")}`, school: null, grade: null, major: null,
        followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
        salesOwnerId: 项目.ownerId ?? mocks.user.id, channelId: 渠.id, referrerCustomerId: null,
      },
      联系人: { name: "王经理", position: "采购", phone: "" },
      项目: { name: `向导项目${号}`, amount: 0, currency: "CNY", ownerId: mocks.user.id, ...项目 },
      跟进: { type: "PHONE", content: "聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false },
    });
  };
  const 项目of = (id: string) => prisma.project.findUniqueOrThrow({ where: { id }, include: { customer: { select: { salesOwnerId: true } } } });

  it("下拉只给能用、还启用着的：市场 = 指定 / 自动 / 公海捞取 / 暂不分配，销售 = 指定 / 自拓自持；停用的不出", async () => {
    expect((await 我能用的分配方式({ id: 市场, role: "SALES" })).map((x) => x.i)).toEqual([0, 1, 2, 3]);
    expect((await 我能用的分配方式({ id: 销售, role: "SALES" })).map((x) => x.i)).toEqual([0, 4]);
    expect((await 我能用的分配方式({ id: 老板, role: "ADMIN" })).map((x) => x.i)).toEqual([0, 1, 2, 3, 4]);
    await prisma.entDictItem.update({ where: { id: 分配方式id.暂不分配 }, data: { active: false } });
    expect((await 我能用的分配方式({ id: 市场, role: "SALES" })).map((x) => x.i)).toEqual([0, 1, 2]);
    当(市场);
    expect(await 向导({ 分配方式: 3 })).toMatchObject({ ok: false, error: "这种分配方式已停用，换一种" });
  });

  it("用不了的拦下、一行不写：销售选暂不分配、市场选自拓自持", async () => {
    当(销售);
    expect(await 向导({ 分配方式: 3 })).toMatchObject({ ok: false });
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
    expect("转走" in r).toBe(false);
  });

  it("暂不分配 / 自拓自持：选了别人也记在自己名下", async () => {
    当(市场);
    const a = await 向导({ 分配方式: 3, ownerId: 销售 });
    当(销售);
    const b = await 向导({ 分配方式: 4, ownerId: 另一销售 });
    for (const [r, 谁] of [[a, 市场], [b, 销售]] as const) {
      expect(r).toMatchObject({ ok: true });
      if (r.ok) expect((await 项目of(r.projectId)).ownerId).toBe(谁);
    }
  });

  it("公海捞取：建好放进项目公海", async () => {
    当(市场);
    const r = await 向导({ 分配方式: 2 });
    expect(r).toMatchObject({ ok: true, 转走: true, 提示: "已放进项目公海，等人捞取" });
    if (r.ok) expect((await 项目of(r.projectId)).pooledAt).not.toBeNull();
  });

  it("自动分配：建好按规则分给一位销售，客户跟着走", async () => {
    当(市场);
    const r = await 向导({ 分配方式: 1 });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const p = await 项目of(r.projectId);
    if (r.转走) {
      expect([销售, 另一销售, 销售经理]).toContain(p.ownerId);
      expect(p.customer.salesOwnerId).toBe(p.ownerId);
    } else {
      // 没人可分：项目留在市场名下，回一句为什么
      expect(p.ownerId).toBe(市场);
      expect(r.提示).toMatch("没成");
    }
  });

  it("其他角色（渠道运营、项目运营）能新建线索：下拉 = 指定 / 公海捞取；建给自己、指定别人、放公海都成，选自动被拦（10-28）", async () => {
    for (const 谁 of [渠道, 项运]) expect((await 我能用的分配方式({ id: 谁, role: "SALES" })).map((x) => x.i)).toEqual([0, 2]);
    当(渠道);
    const a = await 向导({});
    const b = await 向导({ 分配方式: 0, ownerId: 销售 });
    当(项运);
    const c = await 向导({ 分配方式: 2 });
    for (const [r, 谁] of [[a, 渠道], [b, 销售], [c, 项运]] as const) {
      expect(r).toMatchObject({ ok: true });
      if (r.ok) expect((await 项目of(r.projectId)).ownerId).toBe(谁);
    }
    if (c.ok) expect((await 项目of(c.projectId)).pooledAt).not.toBeNull();
    expect(await 向导({ 分配方式: 1 })).toMatchObject({ ok: false });
  });

  it("没传分配方式（老草稿）：选了别人 = 指定，建给自己 = 自拓自持，用不了自拓自持的 = 暂不分配", async () => {
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
    expect(审计.map((x) => x.summary.match(/分配方式「(.+?)」/)?.[1])).toEqual(["指定分配", "自拓自持", "暂不分配"]);
  });

  it("不是企业版：不看分配方式，照负责人建", async () => {
    mocks.企业版 = false;
    当(销售);
    expect(await 我能用的分配方式({ id: 销售, role: "SALES" })).toEqual([]);
  });
});

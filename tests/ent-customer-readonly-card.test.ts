/**
 * E① 客户只读卡（机制总表 P-看-10 / P-看-13 / X-15）：矩阵那 6 条之外，把这几件钉住——
 *   - 卡上不带负责人、级别、状态、备注、客户本人手机号，也不带能接别的接口的编号；
 *   - 联系方式只给卡负责人自己项目上的联系人，上级看到的和下属同一张卡；
 *   - 只有项目负责人和他的实线直属上级能开；公海项目、公海客户、软删的都不开；
 *   - 开过卡之后列表、搜索、导出、批量拉、AI 查询、待办一条都不多；
 *   - 项目详情页到卡的入口：只负责项目的人是「只读卡」，虚线上级这种看得到项目、进不去客户的是纯文字，不再链到报「没有找到」的客户详情。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});
vi.mock("@/app/(app)/projects/[id]/ProjectDetail", () => ({ default: () => null }));
vi.mock("@/app/(app)/projects/[id]/SameNumberBanner", () => ({ default: () => null }));

import type { ReactElement } from "react";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 字段权限key } from "@/lib/enterprise/field-perm";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 读客户只读卡 } from "@/lib/enterprise/customer-readonly-card";
import { 打开客户只读卡Action } from "@/app/(app)/projects/[id]/readonly-card-actions";
import ProjectPage from "@/app/(app)/projects/[id]/page";
import { 项目关联们 } from "@/lib/project/relate";
import { 无负责人占位Id } from "@/lib/no-owner-db";
import { 读项目列表 } from "@/lib/project/list";
import { 复盘待办of } from "@/lib/project/board-todos-db";
import { TOOL_MAP, type ToolContext } from "@/lib/agent/tools";
import { 全局搜索 } from "@/app/(app)/global-search";
import { 导出客户 } from "@/app/(app)/customers/export-action";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 总管: 人, 大区: 人, 销售管理: 人, 虚线管理: 人, 市场: 人, 甲: 人, 乙: 人, 丙: 人;

const 造人 = async (key: string, name: string, role: string, bizRole: string, 上级?: { 实线?: string; 虚线?: string }): Promise<人> => {
  const email = `${key}@x`;
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  await prisma.entMember.create({
    data: { userId: u.id, bizRole, managerId: 上级?.实线, dottedManagerId: 上级?.虚线, ...(bizRole === "sales" ? { line: "内贸" } : {}) },
  });
  return { id: u.id, name, email, role, title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { mocks.user = { ...u }; return 以谁的身份(u.id, fn); };
const 读卡 = (u: 人, p: string) => 以(u, () => 读客户只读卡(u, p));

let 序号 = 0;
const 号 = () => { 序号 += 1; return String(序号).padStart(8, "0"); };
const 客户 = async (ownerId: string, extra: Record<string, unknown> = {}) =>
  (await prisma.customer.create({ data: { name: `卡片客户${号()}`, phone: `139${号()}`, salesOwnerId: ownerId, ...extra } })).id;
const 项目 = async (customerId: string, ownerId: string, extra: Record<string, unknown> = {}) =>
  (await prisma.project.create({ data: { name: "卡片项目", customerId, ownerId, creatorId: ownerId, ...extra } })).id;
const 联系人 = async (customerId: string, name: string, position = "采购", extra: Record<string, unknown> = {}) => {
  const n = 号();
  return (await prisma.contact.create({ data: { name, position, customerId, phone: `137${n}`, email: `lx${n}@example.com`, wechat: `wxtest${n}`, ...extra } })).id;
};
const 挂项目 = (projectId: string, contactId: string) => prisma.projectContact.create({ data: { projectId, contactId } });

/** 客户归甲（丙的同事），项目归乙；王在乙的项目上，李只在客户上 */
const 搭 = async () => {
  const c = await 客户(甲.id);
  const p = await 项目(c, 乙.id);
  const 王 = await 联系人(c, "王联系", "总经理");
  const 李 = await 联系人(c, "李联系", "财务");
  await 挂项目(p, 王);
  忘掉企业版范围();
  return { c, p, 王, 李, 客户名: (await prisma.customer.findUniqueOrThrow({ where: { id: c } })).name };
};
const 那位 = <T extends { name: string }>(卡: { 联系人: T[] } | null, 名: string): T => {
  const x = 卡?.联系人.find((y) => y.name === 名);
  if (!x) throw new Error(`卡上没有 ${名}`);
  return x;
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  总管 = await 造人("dir", "总管理", "ADMIN", "director");
  大区 = await 造人("area", "大区管理员", "MANAGER", "sales_mgr");
  销售管理 = await 造人("smgr", "销售管理员", "MANAGER", "sales_mgr", { 实线: 大区.id });
  虚线管理 = await 造人("dmgr", "虚线管理员", "MANAGER", "sales_mgr");
  市场 = await 造人("mkt", "市场同事", "SALES", "marketing_mgr");
  甲 = await 造人("jia", "销售甲某", "SALES", "sales", { 实线: 销售管理.id });
  乙 = await 造人("yi", "销售乙某", "SALES", "sales", { 实线: 销售管理.id, 虚线: 虚线管理.id });
  丙 = await 造人("bing", "销售丙某", "SALES", "sales", { 实线: 销售管理.id });
  await setSetting(规则.按组织看客户.key, true);
  invalidateSettingsCache();
  忘掉企业版范围();
});

describe("卡上有什么", () => {
  it("给客户资料白名单；不给负责人、级别、状态、备注、客户手机号，也不给编号", async () => {
    const c = await 客户(甲.id, {
      shortName: "卡片简称", school: "卡片公司", customerType: "卡片类型", customerAttr: "卡片属性", addrDetail: "卡片路 1 号",
      remark: "特征备注", custStatus: "特征状态", phone: "13900001111",
    });
    await prisma.customerExtra.create({ data: { customerId: c, level: "特征级别", website: "https://card.example.com" } });
    const p = await 项目(c, 乙.id);
    const 王 = await 联系人(c, "王联系");
    await 挂项目(p, 王);
    忘掉企业版范围();
    const 卡 = await 读卡(乙, p);
    expect(卡?.客户).toMatchObject({
      shortName: "卡片简称", school: "卡片公司", customerType: "卡片类型", customerAttr: "卡片属性", addrDetail: "卡片路 1 号", website: "https://card.example.com",
    });
    const 文 = JSON.stringify(卡);
    for (const 不该有 of [甲.id, 甲.name, "特征备注", "特征状态", "特征级别", "13900001111", c, 王, "salesOwnerId", "custStatus", "level", "remark"]) {
      expect(文).not.toContain(不该有);
    }
  });

  it("联系方式只给卡负责人自己项目上的：主联系人、关联联系人、同客户另一个自己项目的都给；同事项目的不给", async () => {
    const c = await 客户(甲.id);
    const 主 = await 联系人(c, "主联系");
    const 关联 = await 联系人(c, "关联联系");
    const 另项目 = await 联系人(c, "另项目联系");
    const 同事的 = await 联系人(c, "同事联系");
    const p = await 项目(c, 乙.id, { contactId: 主 });
    await 挂项目(p, 关联);
    await 项目(c, 乙.id, { contactId: 另项目, result: "已结束" });
    await 挂项目(await 项目(c, 丙.id), 同事的);
    忘掉企业版范围();
    const 卡 = await 读卡(乙, p);
    for (const 名 of ["主联系", "关联联系", "另项目联系"]) {
      expect(那位(卡, 名)).toMatchObject({ 给联系方式: true });
      expect(那位(卡, 名).phone).toBeTruthy();
    }
    expect(那位(卡, "同事联系")).toEqual({ name: "同事联系", position: "采购", 给联系方式: false, phone: null, email: null, wechat: null, 号码们: [] });
  });

  it("挂靠到这家的联系人列出来；只属于别家的不列", async () => {
    const c = await 客户(甲.id);
    const 别家 = await 客户(甲.id);
    const 挂来 = await 联系人(别家, "挂来联系");
    await 联系人(别家, "别家联系");
    await prisma.contactCustomer.create({ data: { contactId: 挂来, customerId: c } });
    const p = await 项目(c, 乙.id);
    忘掉企业版范围();
    expect((await 读卡(乙, p))?.联系人.map((x) => x.name)).toEqual(["挂来联系"]);
  });

  it("软删的联系人不进卡，软删项目上的联系人不算自己项目的", async () => {
    const c = await 客户(甲.id);
    await 联系人(c, "已删联系", "采购", { deletedAt: new Date() });
    const 留着 = await 联系人(c, "旧项目联系");
    const p = await 项目(c, 乙.id);
    await 挂项目(await 项目(c, 乙.id, { deletedAt: new Date() }), 留着);
    忘掉企业版范围();
    const 卡 = await 读卡(乙, p);
    expect(卡?.联系人.map((x) => x.name)).toEqual(["旧项目联系"]);
    expect(那位(卡, "旧项目联系").给联系方式).toBe(false);
  });

  it("字段权限电话 = 藏：手机打码，邮箱、微信照旧（同客户详情页的口径）", async () => {
    const { p } = await 搭();
    await setSetting(规则.字段权限.key, true);
    await setSetting(字段权限key, { 电话: { sales: "藏" } });
    invalidateSettingsCache();
    const 王 = await prisma.contact.findFirstOrThrow({ where: { name: "王联系" } });
    const 卡上 = 那位(await 读卡(乙, p), "王联系");
    expect(卡上.phone).toBeTruthy();
    expect(卡上.phone).not.toBe(王.phone);
    expect(卡上.email).toBe(王.email);
    expect(卡上.wechat).toBe(王.wechat);
    expect(JSON.stringify(卡上)).not.toContain(王.phone!);
  });
});

describe("谁能开", () => {
  it("负责人和实线直属上级能开，上级看到的和下属同一张卡", async () => {
    const { p } = await 搭();
    const 下属看 = await 读卡(乙, p);
    expect(下属看).not.toBeNull();
    expect(await 读卡(销售管理, p)).toEqual(下属看);
  });

  it("虚线上级、隔级上级、总管理、同事、创建人、组员、市场都开不了", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 乙.id, { creatorId: 丙.id });
    await prisma.projectMember.create({ data: { projectId: p, userId: 甲.id, inviteStatus: "JOINED" } });
    忘掉企业版范围();
    for (const 谁 of [虚线管理, 大区, 总管, 丙, 甲, 市场]) expect(await 读卡(谁, p), 谁.name).toBeNull();
  });

  it("公海项目、公海客户都不开，负责人和上级也一样", async () => {
    const { c, p } = await 搭();
    await prisma.customerPool.create({ data: { customerId: c } });
    忘掉企业版范围();
    expect(await 读卡(乙, p)).toBeNull();
    expect(await 读卡(销售管理, p)).toBeNull();
    await prisma.customerPool.delete({ where: { customerId: c } });
    await prisma.project.update({ where: { id: p }, data: { pooledAt: new Date() } });
    忘掉企业版范围();
    expect(await 读卡(乙, p)).toBeNull();
    expect(await 读卡(销售管理, p)).toBeNull();
  });

  it("客户或项目软删了不开；没有这个项目不开；非企业版不开", async () => {
    const { c, p } = await 搭();
    expect(await 读卡(乙, "没有这个项目")).toBeNull();
    vi.stubEnv("CRM_ENTERPRISE", "0");
    expect(await 读卡(乙, p)).toBeNull();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await prisma.customer.update({ where: { id: c }, data: { deletedAt: new Date() } });
    忘掉企业版范围();
    expect(await 读卡(乙, p)).toBeNull();
  });

  it("入口 Action：能开给卡，不能开只回一句话，不带内容", async () => {
    const { p, 客户名 } = await 搭();
    const 能 = await 以(乙, () => 打开客户只读卡Action(p));
    expect(能.ok && 能.卡.客户.name).toBe(客户名);
    const 不能 = await 以(丙, () => 打开客户只读卡Action(p));
    expect(不能.ok).toBe(false);
    expect(JSON.stringify(不能)).not.toContain(客户名);
  });
});

describe("开过卡，别的范围不变", () => {
  const ctx = (u: 人): ToolContext => ({
    userId: u.id, userName: u.name, b: { customer: "客户", brief: "", statusLabels: {}, 术语: {} } as never, recordOffset: 0, proposals: [],
  });

  it("客户、联系人的列表和批量拉、全局搜索、导出都没有这家", async () => {
    const { c, p, 王, 李, 客户名 } = await 搭();
    expect(await 读卡(乙, p)).not.toBeNull();
    expect((await 以(乙, () => prisma.customer.findMany({ select: { id: true } }))).map((x) => x.id)).not.toContain(c);
    const 拉到 = (await 以(乙, () => prisma.contact.findMany({ select: { id: true } }))).map((x) => x.id);
    expect(拉到).not.toContain(王);
    expect(拉到).not.toContain(李);
    expect((await 以(乙, () => 全局搜索(客户名))).客户.map((x) => x.id)).not.toContain(c);
    expect((await 以(乙, () => 全局搜索("王联系"))).联系人.map((x) => x.id)).not.toContain(王);
    expect(JSON.stringify(await 以(乙, () => 导出客户({} as never)))).not.toContain(客户名);
  });

  it("AI 查询查不到这家和它的联系人；对照：客户负责人查得到", async () => {
    const { p, 客户名 } = await 搭();
    expect(await 读卡(乙, p)).not.toBeNull();
    const 查 = (u: 人, 表: string) => 以(u, () => TOOL_MAP.get("query_records")!.run({ 表 }, ctx(u)));
    expect(JSON.stringify(await 查(乙, "客户"))).not.toContain(客户名);
    expect(JSON.stringify(await 查(乙, "联系人"))).not.toContain("王联系");
    expect(JSON.stringify(await 查(甲, "客户"))).toContain(客户名);
  });

  it("待办范围不扩大：客户负责人在这家的待办，开过卡的项目负责人看不到", async () => {
    const { c, p } = await 搭();
    await prisma.task.create({ data: { title: "甲的客户待办", dueAt: null, customerId: c, ownerId: 甲.id } });
    忘掉企业版范围();
    expect(await 读卡(乙, p)).not.toBeNull();
    const 内容 = async (u: 人) => (await 以(u, () => 复盘待办of(u.id))).行.map((x) => x.内容);
    expect(await 内容(乙)).not.toContain("甲的客户待办");
    expect(await 内容(甲)).toContain("甲的客户待办");
  });
});

describe("项目详情到卡的入口", () => {
  type 页数据 = { customer: { id: string } | null; contact: unknown; 客户入口?: string; 客户卡名?: { name: string } | null };
  const 找详情 = (x: unknown): 页数据 | null => {
    if (Array.isArray(x)) { for (const y of x) { const r = 找详情(y); if (r) return r; } return null; }
    const el = x as ReactElement<{ p?: 页数据; children?: unknown }> | null;
    if (!el || typeof el !== "object" || !("props" in el)) return null;
    return el.props.p ?? 找详情(el.props.children);
  };
  const 打开 = async (u: 人, id: string) => {
    const r = 找详情(await 以(u, () => ProjectPage({ params: Promise.resolve({ id }) } as never)));
    if (!r) throw new Error("页面没给 ProjectDetail");
    return r;
  };

  it("只负责项目的人 = 只读卡；客户负责人 = 客户详情；页面数据里没有联系方式", async () => {
    const { p, 客户名 } = await 搭();
    const 乙看 = await 打开(乙, p);
    expect(乙看.客户入口).toBe("只读卡");
    expect(乙看.客户卡名?.name).toBe(客户名);
    const 王 = await prisma.contact.findFirstOrThrow({ where: { name: "王联系" } });
    expect(JSON.stringify(乙看)).not.toContain(王.wechat!);
    const 甲看 = await 打开(甲, await 项目((await prisma.project.findUniqueOrThrow({ where: { id: p } })).customerId, 甲.id));
    expect(甲看.客户入口).toBe("详情");
    expect(甲看.客户卡名).toBeNull();
  });

  it("实线上级看不到客户时也走只读卡，名字单给，customer 还是空", async () => {
    const 外人 = await 造人("out", "外组销售", "SALES", "sales");
    const c = await 客户(外人.id);
    const p = await 项目(c, 乙.id);
    忘掉企业版范围();
    const 看 = await 打开(销售管理, p);
    expect(看.客户入口).toBe("只读卡");
    expect(看.customer).toBeNull();
    expect(看.客户卡名?.name).toBeTruthy();
  });

  it("客户在公海：看得到公海的走原来的客户详情，不给卡", async () => {
    const { c, p } = await 搭();
    await prisma.customerPool.create({ data: { customerId: c } });
    忘掉企业版范围();
    const 看 = await 打开(乙, p);
    expect(看.客户入口).toBe("详情");
    expect(看.客户卡名).toBeNull();
  });

  it("公海客户要回避的（他放进公海的）：项目详情直接打不开，也拿不到卡", async () => {
    const { c, p } = await 搭();
    const 占位 = await 无负责人占位Id(prisma);
    await prisma.customer.update({ where: { id: c }, data: { salesOwnerId: 占位 } });
    await prisma.customerPool.create({ data: { customerId: c } });
    await prisma.customerOwnerLog.create({ data: { customerId: c, userId: 乙.id, fromOwnerId: 乙.id, toOwnerId: 占位, kind: "pool-release" } });
    忘掉企业版范围();
    expect(await 以(乙, () => prisma.customer.findUnique({ where: { id: c }, select: { id: true } }))).toBeNull();
    await expect(打开(乙, p)).rejects.toThrow("NOT_FOUND");
    expect(await 读卡(乙, p)).toBeNull();
  });

  it("虚线上级看得到项目、看不到客户：纯文字，不链详情也不给卡", async () => {
    const { p } = await 搭();
    const 看 = await 打开(虚线管理, p);
    expect(看.客户入口).toBe("文字");
    expect(看.customer).toBeNull();
    expect(看.客户卡名).toBeNull();
    expect(await 读卡(虚线管理, p)).toBeNull();
  });

  it("组员、隔级上级、总管理本来就看得到客户：走客户详情，不给卡", async () => {
    const { p } = await 搭();
    await prisma.projectMember.create({ data: { projectId: p, userId: 丙.id, inviteStatus: "JOINED" } });
    for (const 谁 of [丙, 大区, 总管]) {
      忘掉企业版范围();
      const 看 = await 打开(谁, p);
      expect(看.客户入口).toBe("详情");
      expect(看.客户卡名).toBeNull();
    }
  });

  it("非企业版一律客户详情，老行为不变", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(c, 乙.id);
    vi.stubEnv("CRM_ENTERPRISE", "0");
    忘掉企业版范围();
    expect((await 打开(乙, p)).客户入口).toBe("详情");
  });

  it("关联卡：只负责项目的人主客户、联系人都不链客户详情；客户负责人照常", async () => {
    const { c, p, 王 } = await 搭();
    const 乙的 = (await 以(乙, () => 项目关联们(乙, p)))!;
    expect(乙的.客户们[0]).toMatchObject({ customerId: c, 主: true, 看得到: true, 能进详情: false });
    expect(乙的.联系人们.find((x) => x.contactId === 王)?.customerId).toBeNull();
    const 甲项目 = await 项目(c, 甲.id);
    await 挂项目(甲项目, 王);
    忘掉企业版范围();
    const 甲的 = (await 以(甲, () => 项目关联们(甲, 甲项目)))!;
    expect(甲的.客户们[0]).toMatchObject({ customerId: c, 能进详情: true });
    expect(甲的.联系人们.find((x) => x.contactId === 王)?.customerId).toBe(c);
  });

  it("项目列表：只负责项目的人名字照显示、标进不了详情；客户负责人不标", async () => {
    const { c, p, 客户名 } = await 搭();
    const 甲项目 = await 项目(c, 甲.id);
    忘掉企业版范围();
    const 乙行 = (await 以(乙, () => 读项目列表(乙 as never, {} as never))).行.find((r: { id: string }) => r.id === p);
    expect(乙行).toMatchObject({ customerName: 客户名, 进不了客户详情: true });
    const 甲行 = (await 以(甲, () => 读项目列表(甲 as never, {} as never))).行.find((r: { id: string }) => r.id === 甲项目);
    expect(甲行?.customerName).toBe(客户名);
    expect(甲行?.进不了客户详情).toBeUndefined();
  });
});

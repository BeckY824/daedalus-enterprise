/**
 * 只负责项目的人看客户（用户 11-12 定）：「乙」= 项目负责人是本人、项目不在公海，客户他按现有规则看不到。
 * 这位客户进乙的看板，点进 /customers/<id> 是受限详情：左栏只读卡、右边只有乙自己的项目；客户本身照旧改不了。
 * 限定层不扩大：导出、全局搜索、页签计数、批量、/contacts 都不带这类客户。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
  projectMode: true,
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
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: mocks.projectMode }) };
});
vi.mock("@/app/(app)/projects/[id]/ProjectDetail", () => ({ default: () => null }));
vi.mock("@/app/(app)/projects/[id]/SameNumberBanner", () => ({ default: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 仅项目客户们, 仅项目可见, 仅项目安全条件, 仅项目筛选口径 } from "@/lib/enterprise/project-only-customers";
import { 无负责人占位Id } from "@/lib/no-owner-db";
import { saveContact } from "@/app/(app)/customers/[id]/actions";
import { 客户页看板条件 } from "@/app/(app)/customers/board-query";
import { 再看一列 } from "@/app/(app)/customers/board-actions";
import { 读项目列表 } from "@/lib/project/list";
import type { ReactElement } from "react";
import { 新增仅项目联系人Action, 改仅项目联系人Action } from "@/app/(app)/customers/[id]/project-only-contact-actions";
import { deleteContact, detachContact } from "@/app/(app)/customers/[id]/actions";
import { 挂到客户, 换主客户 } from "@/app/(app)/customers/[id]/contact-link-actions";
import { patchCustomer, assignSalesOwner, deleteCustomers } from "@/app/(app)/customers/actions";
import { 放进公海 } from "@/app/(app)/customers/pool-actions";
import { 三态暂缓回收, 三态继续持有 } from "@/app/(app)/customers/tri-state-actions";
import { 全局搜索 } from "@/app/(app)/global-search";
import { 导出客户 } from "@/app/(app)/customers/export-action";
import { 客户页签数 } from "@/lib/pool-db";
import { 项目页去向 } from "@/app/(app)/projects/[id]/load";
import { 项目链接们 } from "@/lib/project/customer-detail-direct";
import ProjectPage from "@/app/(app)/projects/[id]/page";
import CustomerDetailPage from "@/app/(app)/customers/[id]/page";
import type { 受限客户详情 } from "@/app/(app)/customers/[id]/restricted";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 总管: 人, 销售管理: 人, 虚线管理: 人, 甲: 人, 乙: 人, 丙: 人;

const 造人 = async (key: string, name: string, role: string, bizRole: string, 上级?: { 实线?: string; 虚线?: string }): Promise<人> => {
  const email = `${key}@x`;
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  await prisma.entMember.create({
    data: { userId: u.id, bizRole, managerId: 上级?.实线, dottedManagerId: 上级?.虚线, ...(bizRole === "sales" ? { line: "内贸" } : {}) },
  });
  return { id: u.id, name, email, role, title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { mocks.user = { ...u }; return 以谁的身份(u.id, fn); };

let 序号 = 0;
const 号 = () => { 序号 += 1; return String(序号).padStart(8, "0"); };
const 客户 = async (ownerId: string, extra: Record<string, unknown> = {}) =>
  (await prisma.customer.create({ data: { name: `仅项目客户${号()}`, phone: `139${号()}`, salesOwnerId: ownerId, ...extra } })).id;
const 项目 = async (customerId: string, ownerId: string, extra: Record<string, unknown> = {}) =>
  (await prisma.project.create({ data: { name: `仅项目项目${号()}`, customerId, ownerId, creatorId: ownerId, ...extra } })).id;
const 联系人 = async (customerId: string, name: string, extra: Record<string, unknown> = {}) => {
  const n = 号();
  return (await prisma.contact.create({ data: { name, position: "采购", customerId, phone: `137${n}`, email: `lx${n}@example.com`, wechat: `wxtest${n}`, ...extra } })).id;
};
const 挂项目 = (projectId: string, contactId: string) => prisma.projectContact.create({ data: { projectId, contactId } });
const 集合 = (u: 人) => 以(u, () => 仅项目客户们(u));

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  mocks.projectMode = true;
  总管 = await 造人("dir", "总管理", "ADMIN", "director");
  const 大区 = await 造人("area", "大区管理员", "MANAGER", "sales_mgr");
  销售管理 = await 造人("smgr", "销售管理员", "MANAGER", "sales_mgr", { 实线: 大区.id });
  虚线管理 = await 造人("dmgr", "虚线管理员", "MANAGER", "sales_mgr");
  甲 = await 造人("jia", "销售甲某", "SALES", "sales", { 实线: 销售管理.id });
  乙 = await 造人("yi", "销售乙某", "SALES", "sales", { 实线: 销售管理.id, 虚线: 虚线管理.id });
  丙 = await 造人("bing", "销售丙某", "SALES", "sales", { 实线: 销售管理.id });
  await setSetting(规则.按组织看客户.key, true);
  invalidateSettingsCache();
  忘掉企业版范围();
});

describe("仅项目集合", () => {
  it("乙负责项目、看不到客户：进集合，带自己的项目；客户负责人、实线上级、总管理、组员集合都空", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 乙.id);
    await 项目(c, 丙.id);
    await prisma.projectMember.create({ data: { projectId: p, userId: 丙.id, inviteStatus: "JOINED" } });
    忘掉企业版范围();
    expect([...(await 集合(乙)).entries()]).toEqual([[c, [p]]]);
    expect(await 以(乙, () => 仅项目可见(乙, c))).toEqual([p]);
    for (const 谁 of [甲, 销售管理, 总管, 丙, 虚线管理]) expect((await 集合(谁)).size, 谁.name).toBe(0);
  });

  it("自己的客户、公海项目、公海客户、软删项目 / 客户、等分配占位的都不进", async () => {
    const 自己的 = await 客户(乙.id);
    await 项目(自己的, 乙.id);
    await 项目(await 客户(甲.id), 乙.id, { pooledAt: new Date() });
    const 公海客户 = await 客户(甲.id);
    await 项目(公海客户, 乙.id);
    await prisma.customerPool.create({ data: { customerId: 公海客户 } });
    await 项目(await 客户(甲.id), 乙.id, { deletedAt: new Date() });
    await 项目(await 客户(甲.id, { deletedAt: new Date() }), 乙.id);
    await 项目(await 客户(甲.id), 乙.id, { awaitAssignAt: new Date() });
    忘掉企业版范围();
    expect((await 集合(乙)).size).toBe(0);
  });

  it("项目模式没开、非企业版、按组织看客户关着：空", async () => {
    await 项目(await 客户(甲.id), 乙.id);
    忘掉企业版范围();
    expect((await 集合(乙)).size).toBe(1);
    mocks.projectMode = false;
    expect((await 集合(乙)).size).toBe(0);
    mocks.projectMode = true;
    vi.stubEnv("CRM_ENTERPRISE", "0");
    expect((await 集合(乙)).size).toBe(0);
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await setSetting(规则.按组织看客户.key, false);
    invalidateSettingsCache();
    忘掉企业版范围();
    expect((await 集合(乙)).size).toBe(0);
  });

  it("公海客户原负责人回避的不进（客户看不到也不因项目露出）", async () => {
    const c = await 客户(甲.id);
    await 项目(c, 乙.id);
    const 占位 = await 无负责人占位Id(prisma);
    await prisma.customer.update({ where: { id: c }, data: { salesOwnerId: 占位 } });
    await prisma.customerPool.create({ data: { customerId: c } });
    忘掉企业版范围();
    expect((await 集合(乙)).size).toBe(0);
  });
});

describe("仅项目安全条件", () => {
  it("登记的键和客户条件对得上（客户条件新加键要在这里和 仅项目筛选口径 两边登记）", () => {
    expect(Object.keys(仅项目筛选口径).sort()).toEqual([
      "archiveTier", "batch", "channelId", "channelOwnerId", "country", "createdFrom", "createdTo", "createdWithin", "custStatus", "customerType",
      "decisionStatus", "dept", "directOf", "followStatus", "grade", "keyword", "level", "node", "phase", "phone", "pool", "salesOwnerId", "source", "triState",
    ].sort());
    expect(Object.entries(仅项目筛选口径).filter(([, v]) => v === "认").map(([k]) => k).sort()).toEqual(["customerType", "keyword", "pool"]);
  });

  it("没筛 = {}；关键词只比名字、简称、公司；客户类型照认", () => {
    expect(仅项目安全条件({})).toEqual({});
    expect(仅项目安全条件({ keyword: "  ", pool: "" })).toEqual({});
    expect(仅项目安全条件({ keyword: "星辰" })).toEqual({ AND: [{ OR: [{ name: { contains: "星辰" } }, { shortName: { contains: "星辰" } }, { school: { contains: "星辰" } }] }] });
    expect(仅项目安全条件({ customerType: "企业" })).toEqual({ AND: [{ customerType: "企业" }] });
  });

  it("任何挡的键有值、公海页签、按金额 / 级别 / 创建时间排、没登记的键有值：null", () => {
    for (const [k, v] of Object.entries(仅项目筛选口径)) {
      if (v === "挡") expect(仅项目安全条件({ [k]: "x" }), k).toBeNull();
    }
    expect(仅项目安全条件({ pool: "1" })).toBeNull();
    for (const sort of ["amount-asc", "level-desc", "created-asc"]) expect(仅项目安全条件({ sort })).toBeNull();
    expect(仅项目安全条件({ 不认识: "x" } as never)).toBeNull();
    expect(仅项目安全条件({ keyword: ["a"] } as never)).toBeNull();
  });
});

describe("saveContact 守卫（提交 2）", () => {
  const 新建 = (u: 人, customerId: string, name = "新来联系") => 以(u, () => saveContact({ customerId, name, isPrimary: false, phone: `136${号()}` }));
  const 有人叫 = async (name: string) => (await prisma.contact.count({ where: { name } })) > 0;

  it("看不到的客户下面新建联系人：拒（只负责项目的人也一样，走专门的动作）", async () => {
    const c = await 客户(甲.id);
    await 项目(c, 乙.id);
    const 外 = await 客户(甲.id);
    忘掉企业版范围();
    for (const [谁, id] of [[丙, 外], [乙, c]] as const) {
      const r = await 新建(谁, id, `越界${谁.name}`);
      expect(r.ok, 谁.name).toBe(false);
      expect(await 有人叫(`越界${谁.name}`)).toBe(false);
    }
  });

  it("只读看得到的客户（组员、虚线上级）：新建、编辑都拒", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(c, 乙.id);
    await prisma.projectMember.create({ data: { projectId: p, userId: 丙.id, inviteStatus: "JOINED" } });
    const 老 = await 联系人(c, "老联系");
    const 版本 = (await prisma.contact.findUniqueOrThrow({ where: { id: 老 } })).updatedAt.toISOString();
    忘掉企业版范围();
    for (const 谁 of [丙, 虚线管理]) {
      expect(await 以(谁, () => prisma.customer.findUnique({ where: { id: c }, select: { id: true } })), `${谁.name} 看得到`).not.toBeNull();
      const 建 = await 新建(谁, c, `只读新建${谁.name}`);
      expect(建.ok, `${谁.name} 新建`).toBe(false);
      expect(await 有人叫(`只读新建${谁.name}`)).toBe(false);
      const 改 = await 以(谁, () => saveContact({ id: 老, 版本, customerId: c, name: `改名${谁.name}`, isPrimary: false }));
      expect(改.ok, `${谁.name} 编辑`).toBe(false);
      expect(await 有人叫(`改名${谁.name}`)).toBe(false);
    }
  });

  it("客户负责人照常新建，记下是谁建的", async () => {
    const c = await 客户(甲.id);
    忘掉企业版范围();
    const r = await 新建(甲, c, "负责人新建");
    expect(r.ok).toBe(true);
    expect((await prisma.contact.findFirstOrThrow({ where: { name: "负责人新建" } })).createdById).toBe(甲.id);
  });
});

describe("客户页看板（提交 3）", () => {
  const 看板 = async (u: 人, q: Record<string, string> = {}) => {
    const { 项目: 项, 客户: 客 } = await 以(u, () => 客户页看板条件(q));
    const d = await 以(u, () => 读项目列表(u, { ...项, 客户: 客 }, undefined, { 每列: true, 要列表页: false }));
    return { ids: [...d.行, ...Object.values(d.每列 ?? {}).flat()].map((r) => r.id), 列: Object.entries(d.每列 ?? {}).find(([, v]) => v.length)?.[0] ?? null };
  };
  const 搭 = async () => {
    const c = await 客户(甲.id, { remark: "特征备注甲客户", custStatus: "特征状态", shortName: "看板简称", school: "看板公司", customerType: "看板类型" });
    await prisma.customerExtra.create({ data: { customerId: c, level: "A" } });
    const p = await 项目(c, 乙.id);
    const 王 = await 联系人(c, "王联系", { phone: "13711112222" });
    await 挂项目(p, 王);
    忘掉企业版范围();
    const 行 = await prisma.customer.findUniqueOrThrow({ where: { id: c } });
    return { c, p, 名: 行.name, 手机: 行.phone! };
  };

  it("不筛有卡；按客户名、简称、公司、客户类型筛卡还在", async () => {
    const { p, 名 } = await 搭();
    expect((await 看板(乙)).ids).toContain(p);
    for (const q of [{ keyword: 名 }, { keyword: "看板简称" }, { keyword: "看板公司" }, { customerType: "看板类型" }] as Record<string, string>[]) {
      expect((await 看板(乙, q)).ids, JSON.stringify(q)).toContain(p);
    }
  });

  it("按客户手机、联系人号码、备注、级别、状态、负责人筛：卡消失（拿筛选试不出看不到的客户）；「再看」同一份", async () => {
    const { p, 手机 } = await 搭();
    for (const q of [{ keyword: 手机 }, { keyword: "13711112222" }, { keyword: "特征备注" }, { level: "A" }, { custStatus: "特征状态" }, { salesOwnerId: 甲.id }, { phone: 手机 }] as Record<string, string>[]) {
      expect((await 看板(乙, q)).ids, JSON.stringify(q)).not.toContain(p);
    }
    const 列 = (await 看板(乙)).列!;
    const 再 = async (q: string) => { const r = await 以(乙, () => 再看一列(q, 列, 0)); return r.ok ? r.行.map((x) => x.id) : []; };
    expect(await 再(`keyword=${encodeURIComponent(手机)}`)).not.toContain(p);
    expect(await 再("keyword=%E7%9C%8B%E6%9D%BF%E7%AE%80%E7%A7%B0")).toContain(p);
  });

  it("客户负责人照常按号码筛得到（看得到的那一支不变）", async () => {
    const { c, 手机 } = await 搭();
    const 甲项目 = await 项目(c, 甲.id);
    忘掉企业版范围();
    expect((await 看板(甲, { keyword: 手机 })).ids).toContain(甲项目);
  });
});

describe("受限客户详情（提交 4）", () => {
  /** 打开 /customers/<id>：受限详情回 数据；原详情回 "原详情"；404 抛 NOT_FOUND */
  const 打开客户 = async (u: 人, id: string, project?: string): Promise<受限客户详情 | "原详情"> => {
    const el = (await 以(u, () => CustomerDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(project ? { project } : {}) } as never))) as ReactElement<{ 数据?: 受限客户详情; customer?: unknown }>;
    if (el.props.数据) return el.props.数据;
    expect(el.props.customer).toBeTruthy();
    return "原详情";
  };
  const 受限 = async (u: 人, id: string, project?: string) => {
    const r = await 打开客户(u, id, project);
    if (r === "原详情") throw new Error("进的是原详情");
    return r;
  };
  /** 客户归甲；乙一个项目（王在上面）、乙一个已结束的项目；丙一个在推项目（李、同事沟通、合同金额）；客户级老跟进、甲的待办 */
  const 搭 = async () => {
    const c = await 客户(甲.id, { remark: "特征备注", custStatus: "特征状态", phone: "13900009999", lastFollowAt: new Date("2026-01-02T03:04:05Z") });
    await prisma.customerExtra.create({ data: { customerId: c, level: "S" } });
    const 王 = await 联系人(c, "王联系", { phone: "13711110001" });
    const 李 = await 联系人(c, "李联系", { phone: "13711110002", wechat: "wx同事李" });
    const p = await 项目(c, 乙.id, { contactId: 王, amount: 111 });
    const p2 = await 项目(c, 乙.id, { result: "已结束" });
    const q = await 项目(c, 丙.id, { contactId: 李, amount: 987654, contractAmount: 876543, remark: "同事项目备注" });
    await 挂项目(q, 李);
    const 记 = async (pid: string | null, ownerId: string, content: string) => {
      const f = await prisma.followUp.create({ data: { customerId: c, ownerId, type: "PHONE", title: content, content } });
      if (pid) await prisma.followUpProject.create({ data: { followUpId: f.id, projectId: pid, node: "初步接触" } });
    };
    await 记(p, 乙.id, "乙的沟通");
    const 前任 = await 造人("prev", "前任销售某", "SALES", "sales");
    await 记(p, 前任.id, "前任记在乙项目上的沟通");
    await 记(q, 丙.id, "同事丙的沟通");
    await 记(null, 甲.id, "客户级老跟进");
    await prisma.task.create({ data: { title: "甲的客户待办", customerId: c, ownerId: 甲.id } });
    await prisma.task.create({ data: { title: "乙的待办", customerId: c, ownerId: 乙.id } });
    await prisma.contract.create({ data: { customerId: c, amount: 765432, signedAt: new Date() } }).catch(() => null);
    忘掉企业版范围();
    return { c, p, p2, q, 王, 李 };
  };

  it("乙进受限详情：只有自己的项目、锁数 0、自己项目上的沟通（含前任记的）、自己的待办", async () => {
    const { c, p, p2 } = await 搭();
    const d = await 受限(乙, c);
    expect(d.项目区.页签们.map((t) => t.id).sort()).toEqual([p, p2].sort());
    expect(d.项目区.锁数).toBe(0);
    expect(d.项目区.当前?.p.id).toBeTruthy();
    expect(d.沟通.map((f) => f.content).sort()).toEqual(["乙的沟通", "前任记在乙项目上的沟通"].sort());
    expect(d.待办.任务.map((t) => t.title)).toEqual(["乙的待办"]);
    expect(d.卡.联系人.find((x) => x.name === "王联系")?.给联系方式).toBe(true);
    expect(d.卡.联系人.find((x) => x.name === "李联系")).toMatchObject({ 给联系方式: false, phone: null, 号码们: [] });
  });

  it("泄露哨兵：客户手机、同事联系人号、合同 / 同事项目金额、负责人、级别、状态、最近跟进、备注、同事项目和沟通都不在页面数据里", async () => {
    const { c, q, 李 } = await 搭();
    const d = await 受限(乙, c);
    // 负责人候选 / 在职是全员名单（项目转让、组员要选人），和这位客户无关，单独看
    const 当前 = d.项目区.当前!;
    const { 候选, 在职, ...其余 } = 当前;
    expect([...候选, ...在职].every((u) => Object.keys(u).every((k) => ["id", "name", "email", "role", "title", "avatar", "active"].includes(k)))).toBe(true);
    const 文 = JSON.stringify({ ...d, 项目区: { ...d.项目区, 当前: 其余 } });
    const 李行 = await prisma.contact.findUniqueOrThrow({ where: { id: 李 } });
    for (const 不该有 of ["13900009999", 李行.phone!, "wx同事李", "987654", "876543", "765432", "salesOwnerId", 甲.name, 甲.id, "特征状态", "custStatus", "lastFollowAt", "2026-01-02", "特征备注", "同事项目备注", "同事丙的沟通", "客户级老跟进", "甲的客户待办", q]) {
      expect(文, 不该有).not.toContain(不该有);
    }
    // 客户级别（S）：卡上没有这一格；页面里的 level 只有项目自己的级别（没填 = null）
    expect(Object.keys(d.卡.客户)).not.toContain("level");
    expect((当前.p as { level?: unknown }).level ?? null).toBeNull();
  });

  it("?project= 指到同事项目：读不到，换成自己的", async () => {
    const { c, q } = await 搭();
    const d = await 受限(乙, c, q);
    expect(d.项目区.当前?.p.id).not.toBe(q);
    expect(JSON.stringify(d)).not.toContain(q);
  });

  it("客户负责人、实线上级、总管理、组员进原详情；虚线上级原详情（本来看得到）；同事、外人 404", async () => {
    const { c, q } = await 搭();
    await prisma.projectMember.create({ data: { projectId: q, userId: 虚线管理.id, inviteStatus: "JOINED" } });
    const 外人 = await 造人("out", "外组销售", "SALES", "sales");
    const 外项目 = await 项目(await 客户(外人.id), 乙.id);
    const 外客户 = (await prisma.project.findUniqueOrThrow({ where: { id: 外项目 } })).customerId;
    忘掉企业版范围();
    for (const 谁 of [甲, 销售管理, 总管, 虚线管理]) expect(await 打开客户(谁, c), 谁.name).toBe("原详情");
    // 丙自己也只负责项目：进的是他自己的受限详情，看不到乙的项目
    const 丙看 = await 受限(丙, c);
    expect(丙看.项目区.页签们.map((t) => t.id)).toEqual([q]);
    expect(丙看.沟通.map((f) => f.content)).toEqual(["同事丙的沟通"]);
    await expect(打开客户(外人, c)).rejects.toThrow("NOT_FOUND");
    // 外人客户：乙的实线上级（销售管理）照旧只给只读卡，不进受限详情
    await expect(打开客户(销售管理, 外客户)).rejects.toThrow("NOT_FOUND");
    expect((await 受限(乙, 外客户)).项目区.页签们.map((t) => t.id)).toEqual([外项目]);
  });

  it("项目模式没开：乙照旧 404；非企业版不走受限详情（那边本来不按组织限定，行为不变）", async () => {
    const { c } = await 搭();
    mocks.projectMode = false;
    忘掉企业版范围();
    await expect(打开客户(乙, c)).rejects.toThrow("NOT_FOUND");
    mocks.projectMode = true;
    vi.stubEnv("CRM_ENTERPRISE", "0");
    忘掉企业版范围();
    expect(await 打开客户(乙, c)).toBe("原详情");
  });
});

describe("仅项目联系人（提交 5）", () => {
  const 搭 = async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 乙.id);
    const q = await 项目(c, 丙.id);
    const 老 = await 联系人(c, "客户原有联系");
    await 挂项目(p, 老);
    忘掉企业版范围();
    return { c, p, q, 老 };
  };
  const 新增 = (u: 人, c: string, p: string, name = "乙新加的", 号码 = `135${号()}`) =>
    以(u, () => 新增仅项目联系人Action(c, p, { name, position: "工程师", isPrimary: true, 企业: { 号码们: [{ kind: "phone", value: 号码 }] } }));

  it("乙新增：挂到自己项目上、不是主要联系人、记下建的人；受限详情里给联系方式、能改", async () => {
    const { c, p } = await 搭();
    const r = await 新增(乙, c, p);
    expect(r.ok).toBe(true);
    const 行 = await prisma.contact.findFirstOrThrow({ where: { name: "乙新加的" } });
    expect(行).toMatchObject({ customerId: c, isPrimary: false, createdById: 乙.id });
    expect(await prisma.projectContact.count({ where: { projectId: p, contactId: 行.id } })).toBe(1);
    expect(await prisma.contactCustomer.count({ where: { contactId: 行.id, customerId: c } })).toBe(1);
    const el = (await 以(乙, () => CustomerDetailPage({ params: Promise.resolve({ id: c }), searchParams: Promise.resolve({}) } as never))) as ReactElement<{ 数据: 受限客户详情 }>;
    const 卡上 = el.props.数据.卡.联系人.find((x) => x.name === "乙新加的");
    expect(卡上).toMatchObject({ id: 行.id, 给联系方式: true });
    expect(el.props.数据.可改联系人.map((x) => x.id)).toEqual([行.id]);
    expect(el.props.数据.卡.联系人.find((x) => x.name === "客户原有联系")?.id).toBeUndefined();
  });

  it("乙改自己新增的：能改，不收主要联系人；版本过期拒", async () => {
    const { c, p } = await 搭();
    await 新增(乙, c, p);
    const 行 = await prisma.contact.findFirstOrThrow({ where: { name: "乙新加的" } });
    const 改 = await 以(乙, () => 改仅项目联系人Action(行.id, { name: "乙改过的", isPrimary: true, 版本: 行.updatedAt.toISOString() }));
    expect(改.ok).toBe(true);
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: 行.id } })).toMatchObject({ name: "乙改过的", isPrimary: false });
    const 旧版 = await 以(乙, () => 改仅项目联系人Action(行.id, { name: "再改", 版本: 行.updatedAt.toISOString() }));
    expect(旧版.ok).toBe(false);
  });

  it("拒：同事的项目、不存在的项目、不在集合的客户、客户原有的联系人、别人新增的、组员 / 客户负责人走这个动作", async () => {
    const { c, p, q, 老 } = await 搭();
    expect((await 新增(乙, c, q)).ok).toBe(false);
    expect((await 新增(乙, c, "没有这个项目")).ok).toBe(false);
    const 别家 = await 客户(甲.id);
    忘掉企业版范围();
    expect((await 新增(乙, 别家, p)).ok).toBe(false);
    const 老行 = await prisma.contact.findUniqueOrThrow({ where: { id: 老 } });
    expect((await 以(乙, () => 改仅项目联系人Action(老, { name: "乙改客户原有", 版本: 老行.updatedAt.toISOString() }))).ok).toBe(false);
    // 丙新增在自己项目上的，乙改不了；甲（客户负责人）不走这个动作
    expect((await 新增(丙, c, q, "丙新加的")).ok).toBe(true);
    const 丙的 = await prisma.contact.findFirstOrThrow({ where: { name: "丙新加的" } });
    expect((await 以(乙, () => 改仅项目联系人Action(丙的.id, { name: "乙改丙的", 版本: 丙的.updatedAt.toISOString() }))).ok).toBe(false);
    expect((await 新增(甲, c, p, "甲走仅项目")).ok).toBe(false);
    expect(await prisma.contact.count({ where: { name: { in: ["乙改客户原有", "乙改丙的", "甲走仅项目"] } } })).toBe(0);
  });

  it("撞号：不说撞了谁、哪位客户", async () => {
    const { c, p } = await 搭();
    const 外 = await 客户(甲.id, { name: "撞号外客户特征名" });
    await 联系人(外, "撞号外联系特征名", { phone: "13512345678" });
    忘掉企业版范围();
    const r = await 新增(乙, c, p, "撞号新人", "13512345678");
    expect(r.ok).toBe(false);
    const 文 = JSON.stringify(r);
    for (const x of ["撞号外客户特征名", "撞号外联系特征名", 甲.name, 外]) expect(文).not.toContain(x);
  });
});

describe("仅项目客户：客户本身、原有联系人照旧动不了，别处不带（提交 5）", () => {
  const 搭 = async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 乙.id);
    const 老 = await 联系人(c, "客户原有联系");
    await 挂项目(p, 老);
    const 乙自己的客户 = await 客户(乙.id);
    忘掉企业版范围();
    const 名 = (await prisma.customer.findUniqueOrThrow({ where: { id: c } })).name;
    return { c, p, 老, 乙自己的客户, 名 };
  };

  it("乙调 saveContact / deleteContact / detachContact / 挂到客户 / 换主客户 改客户原有联系人：全拒", async () => {
    const { c, 老, 乙自己的客户 } = await 搭();
    const 老行 = await prisma.contact.findUniqueOrThrow({ where: { id: 老 } });
    const 结果们 = [
      await 以(乙, () => saveContact({ id: 老, 版本: 老行.updatedAt.toISOString(), customerId: c, name: "乙改名", isPrimary: false })),
      await 以(乙, () => deleteContact(老)),
      await 以(乙, () => detachContact(老)),
      await 以(乙, () => 挂到客户(老, 乙自己的客户)),
      await 以(乙, () => 换主客户(老, 乙自己的客户)),
    ];
    for (const [i, r] of 结果们.entries()) expect(r.ok, String(i)).toBe(false);
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: 老 } })).toMatchObject({ name: "客户原有联系", customerId: c, deletedAt: null });
    expect(await prisma.contactCustomer.count({ where: { contactId: 老, customerId: 乙自己的客户 } })).toBe(0);
  });

  it("乙改客户、转让、放公海、删除、三态：全拒，客户原样", async () => {
    const { c } = await 搭();
    const 前 = await prisma.customer.findUniqueOrThrow({ where: { id: c } });
    const 结果们: { ok: boolean }[] = [
      await 以(乙, () => patchCustomer(c, "remark" as never, "乙改备注")),
      await 以(乙, () => assignSalesOwner([c], 乙.id)),
      // 放进公海：看不到的客户不算数（回 ok、动了 0 位）
      await 以(乙, () => 放进公海([c])).then((r) => ({ ok: r.ok && r.updated > 0 })),
      await 以(乙, () => 三态暂缓回收(c, "x")),
      await 以(乙, () => 三态继续持有(c, "x")),
    ];
    for (const [i, r] of 结果们.entries()) expect(r.ok, String(i)).toBe(false);
    await 以(乙, () => deleteCustomers([c] as never)).catch(() => null);
    const 后 = await prisma.customer.findUniqueOrThrow({ where: { id: c } });
    expect(后).toMatchObject({ salesOwnerId: 前.salesOwnerId, remark: 前.remark, deletedAt: null });
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(0);
  });

  it("导出、全局搜索、客户页签数、批量拉、/contacts 都不带这位", async () => {
    const { c, 老, 名 } = await 搭();
    expect((await 以(乙, () => 仅项目客户们(乙))).has(c)).toBe(true);
    expect((await 以(乙, () => 全局搜索(名))).客户.map((x) => x.id)).not.toContain(c);
    expect((await 以(乙, () => 全局搜索("客户原有联系"))).联系人.map((x) => x.id)).not.toContain(老);
    expect(JSON.stringify(await 以(乙, () => 导出客户({} as never)))).not.toContain(名);
    expect((await 以(乙, () => prisma.customer.findMany({ select: { id: true } }))).map((x) => x.id)).not.toContain(c);
    expect((await 以(乙, () => prisma.contact.findMany({ select: { id: true } }))).map((x) => x.id)).not.toContain(老);
    const 数 = await 以(乙, () => 客户页签数());
    expect(数.非公海).toBe(1);
  });
});

describe("路由连带（提交 6）", () => {
  it("乙：/projects/<id> 跳客户页项目页签、站内链接直接给客户页、项目列表不标进不了；公海项目照旧留在项目页判", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 乙.id);
    忘掉企业版范围();
    const 到 = `/customers/${c}?project=${p}`;
    expect(await 以(乙, () => 项目页去向(乙 as never, p))).toEqual({ 种: "客户页", 到 });
    await expect(以(乙, () => ProjectPage({ params: Promise.resolve({ id: p }) } as never))).rejects.toThrow(`REDIRECT:${到}`);
    expect((await 以(乙, () => 项目链接们(乙 as never, [p]))).get(p)).toBe(到);
    const 行 = (await 以(乙, () => 读项目列表(乙 as never, {} as never))).行.find((r) => r.id === p);
    expect(行?.进不了客户详情).toBeUndefined();
  });

  it("实线上级看下属负责、外组客户的项目：仍是只读卡（留在项目页、列表标进不了）", async () => {
    const 外人 = await 造人("out", "外组销售", "SALES", "sales");
    const c = await 客户(外人.id);
    const p = await 项目(c, 乙.id);
    忘掉企业版范围();
    expect(await 以(销售管理, () => 项目页去向(销售管理 as never, p))).toEqual({ 种: "留" });
    expect((await 以(销售管理, () => 项目链接们(销售管理 as never, [p]))).get(p)).toBe(`/projects/${p}`);
    const 行 = (await 以(销售管理, () => 读项目列表(销售管理 as never, {} as never))).行.find((r) => r.id === p);
    expect(行?.进不了客户详情).toBe(true);
  });
});

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
    for (const q of [{ keyword: 名 }, { keyword: "看板简称" }, { keyword: "看板公司" }, { customerType: "看板类型" }]) {
      expect((await 看板(乙, q)).ids, JSON.stringify(q)).toContain(p);
    }
  });

  it("按客户手机、联系人号码、备注、级别、状态、负责人筛：卡消失（拿筛选试不出看不到的客户）；「再看」同一份", async () => {
    const { p, 手机 } = await 搭();
    for (const q of [{ keyword: 手机 }, { keyword: "13711112222" }, { keyword: "特征备注" }, { level: "A" }, { custStatus: "特征状态" }, { salesOwnerId: 甲.id }, { phone: 手机 }]) {
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

/**
 * 统一公海过 999 行（11-02）：SQLite 一句最多 999 个参数，关联加载内部是 外键 IN (所有父行)，过限时 Prisma 要拆批。
 *   - 范围层给关联补的 看得到的项目 带 pooledAt: { not: null }，否定条件没法拆 → P2029（受限身份 + 公海客户 / 项目公海过 999，每次打开都报）
 *   - orderBy 字段没 select 时拆批合并 panic「no entry found for key」（历史负责人们，所有身份都中）
 * 修法：不用关联加载、不拼大 IN。这里按每种身份验行数不降，并和小数据下的老查询逐行对，口径不变。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "x", email: "x@local", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 市场成员key } from "@/lib/enterprise/market";
import { 读公海页, 公海取上限 } from "@/lib/enterprise/unified-pool-db";
import { 入池原因文字, 项目入池类, 系统操作人 } from "@/lib/enterprise/unified-pool";
import { 历史负责人们, 我回避的公海项目 } from "@/lib/project/pool-owner";
import { 看得到的客户 } from "@/lib/project/db";

type 人 = { id: string; name: string; role: string };
const 过限 = 1200;
const 大 = 120000;

async function 造人(key: string, 业务?: { bizRole: string; line?: string; managerId?: string; dottedManagerId?: string }): Promise<人> {
  const u = await prisma.user.create({ data: { email: `${key}@test`, name: key, title: "", role: "SALES", password: "x" } });
  if (业务) await prisma.entMember.create({ data: { userId: u.id, ...业务 } });
  return { id: u.id, name: key, role: "SALES" };
}

/** 每种身份一个：范围层对他们各加各的条件 */
async function 造组织() {
  const 总管理 = await 造人("director", { bizRole: "director" });
  const 全看管理员 = await 造人("admin", { bizRole: "admin" });
  const 按线管理员 = await 造人("admin-line", { bizRole: "admin", line: "内贸" });
  const 销售管理 = await 造人("mgr", { bizRole: "sales_mgr" });
  const 虚线上级 = await 造人("dotted", { bizRole: "sales" });
  const 销售 = await 造人("sales", { bizRole: "sales", managerId: 销售管理.id, dottedManagerId: 虚线上级.id });
  const 同事 = await 造人("peer", { bizRole: "sales", line: "外贸" });
  const 市场管理 = await 造人("market", { bizRole: "marketing_mgr" });
  const 市场成员 = await 造人("market-member", { bizRole: "sales" });
  const 没设角色 = await 造人("none");
  await prisma.setting.create({ data: { key: 市场成员key, value: JSON.stringify([市场管理.id, 市场成员.id]) } });
  忘掉企业版范围();
  return { 总管理, 全看管理员, 按线管理员, 销售管理, 虚线上级, 销售, 同事, 市场管理, 市场成员, 没设角色 };
}
let 组: Awaited<ReturnType<typeof 造组织>>;
/** 公海客户的负责人。11-03 起负责人本人回避自己进公海的客户，这里要看「项目名按范围」，客户归一位不在组里的人（同导入数据的占位账号） */
let 占位: 人;

const 读 = async (u: 人) => {
  mocks.user = { ...mocks.user, id: u.id, name: u.name, role: u.role };
  return 以谁的身份(u.id, () => 读公海页(u, {}, 1, 100000));
};
const 时刻 = (i: number) => new Date(Date.UTC(2026, 9, 1) + i * 1000);

/** n 位公海客户（负责人是占位），每位一个项目（项目不在公海，负责人 owner）；i 越大入池越新 */
async function 公海客户们(n: number, owner: string) {
  const 客户 = Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `客户${i}`, phone: `13${String(i).padStart(9, "0")}`, salesOwnerId: 占位.id }));
  await prisma.customer.createMany({ data: 客户 });
  await prisma.customerPool.createMany({ data: 客户.map((c, i) => ({ customerId: c.id, reason: "r", at: 时刻(i) })) });
  await prisma.project.createMany({ data: 客户.map((c, i) => ({ id: `p${i}`, name: `项目${i}`, customerId: c.id, ownerId: owner, creatorId: owner })) });
}

/** n 个公海项目（客户不在客户公海），每个两条放回留痕：早一条是 hist(i) 放的，晚一条是系统回收（fromOwnerId 同样是 hist(i)） */
async function 公海项目们(n: number, hist: (i: number) => string, 起 = 0) {
  const 号 = Array.from({ length: n }, (_, k) => 起 + k);
  await prisma.customer.createMany({ data: 号.map((i) => ({ id: `xc${i}`, name: `老客户${i}`, phone: `15${String(i).padStart(9, "0")}`, salesOwnerId: hist(i) })) });
  await prisma.project.createMany({ data: 号.map((i) => ({ id: `xp${i}`, name: `公海项目${i}`, customerId: `xc${i}`, ownerId: "", creatorId: hist(i), pooledAt: 时刻(i) })) });
  const 痕 = (i: number, userId: string, at: Date) => ({ projectId: `xp${i}`, kind: "pool-release", fromOwnerId: hist(i), userId, toPhase: "线索", toNode: "x", at });
  await prisma.projectNodeLog.createMany({ data: 号.flatMap((i) => [痕(i, hist(i), 时刻(i - 100000)), 痕(i, 系统操作人, 时刻(i))]) });
}

describe("统一公海过 999 行", () => {
  let 报错: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    忘掉企业版范围();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await prisma.setting.upsert({ where: { key: 规则.按组织看客户.key }, update: { value: "true" }, create: { key: 规则.按组织看客户.key, value: "true" } });
    组 = await 造组织();
    占位 = await 造人("placeholder");
    报错 = vi.spyOn(console, "error");
  });
  afterEach(() => {
    报错.mockRestore();
    vi.unstubAllEnvs();
    忘掉企业版范围();
  });

  it("公海客户过 999：每种身份都打得开、一行不少，项目名按各自的可见范围", async () => {
    await 公海客户们(过限, 组.销售.id);
    for (const [名, u] of Object.entries(组)) {
      const r = await 读(u);
      expect([名, r.总数]).toEqual([名, 过限]);
      expect([名, r.截断]).toEqual([名, false]);
      const 带项目 = r.行.filter((x) => x.项目名).length;
      // 项目负责人是自己 / 下属 / 能看全部 / 虚线下属 / 这条线的，看得到项目名；同事、市场、没设角色的看不到
      const 看得到 = ["总管理", "全看管理员", "按线管理员", "销售管理", "虚线上级", "销售"].includes(名);
      expect([名, 带项目]).toEqual([名, 看得到 ? 过限 : 0]);
    }
    const 销售看 = await 读(组.销售);
    expect(销售看.行.find((x) => x.customerId === "c7")).toMatchObject({ 项目名: "项目7", projectId: "p7" });
    expect(报错).not.toHaveBeenCalled();
  }, 大);

  it("公海属性是客户本身的事：每种身份分类和计数都一样，看不到项目也不落到「其他」；项目名、进程仍按可见范围", async () => {
    const 客户 = async (id: string, i: number) => {
      await prisma.customer.create({ data: { id, name: id, phone: `14${String(i).padStart(9, "0")}`, salesOwnerId: 占位.id } });
      await prisma.customerPool.create({ data: { customerId: id, reason: "r", at: 时刻(i) } });
    };
    const 项目 = (id: string, customerId: string, phase: string, node: string, owner = 组.销售.id) =>
      prisma.project.create({ data: { id, name: id, customerId, phase, node, ownerId: owner, creatorId: owner } });
    await 客户("线索客户", 1); await 项目("线索项目", "线索客户", "线索", "潜客培育");
    await 客户("商机客户", 2); await 项目("商机项目", "商机客户", "商机", "需求确认");
    await 客户("订单客户", 3); await 项目("订单项目", "订单客户", "订单", "签约");
    await 客户("没项目客户", 4);
    // 名下两个：销售只看得到自己的线索项目，定状态的是同事那个商机项目，分类也要按全部算
    await 客户("混合客户", 5);
    await 项目("混合线索", "混合客户", "线索", "潜客培育");
    await 项目("混合商机", "混合客户", "商机", "需求确认", 组.同事.id);

    const 期望 = { 线索客户: "线索池", 商机客户: "商机池", 订单客户: "其他", 没项目客户: "其他", 混合客户: "商机池" };
    for (const [名, u] of Object.entries(组)) {
      const r = await 读(u);
      expect([名, r.属性数]).toEqual([名, { 全部: 5, 线索池: 1, 商机池: 2, 其他: 2 }]);
      expect([名, Object.fromEntries(r.行.map((x) => [x.客户名, x.属性]))]).toEqual([名, 期望]);
    }
    // 显示的不跟着放开：同事看不到销售的项目，名字和进程照旧不露，只露自己的
    const 同事看 = await 读(组.同事);
    expect(同事看.行.find((x) => x.客户名 === "线索客户")).toMatchObject({ 项目名: null, 进程: null, projectId: null });
    expect(同事看.行.find((x) => x.客户名 === "混合客户")).toMatchObject({ 项目名: "混合商机" });
    const 销售看 = await 读(组.销售);
    expect(销售看.行.find((x) => x.客户名 === "混合客户")).toMatchObject({ 项目名: "混合线索", 属性: "商机池" });
    expect(报错).not.toHaveBeenCalled();
  }, 大);

  it("项目公海过 999：每种身份都打得开、一行不少，入池原因认最近一条留痕", async () => {
    await 公海项目们(过限, () => 组.同事.id);
    for (const [名, u] of Object.entries(组)) {
      if (名 === "同事") continue;
      const r = await 读(u);
      expect([名, r.总数]).toEqual([名, 过限]);
      expect([名, r.行.filter((x) => x.类 === "超时回收" && x.入池原因 === "超时回收").length]).toEqual([名, 过限]);
    }
    expect(报错).not.toHaveBeenCalled();
  }, 大);

  it("历史负责过 999 个项目的销售：自己的被剔，别人的都在；总管理、管理员豁免；销售管理不豁免但这些不是他的", async () => {
    await 公海项目们(过限, () => 组.销售.id);
    await 公海项目们(30, () => 组.同事.id, 过限);
    const 我的 = await 读(组.销售);
    expect(我的.总数).toBe(30);
    expect(我的.行.every((x) => Number(x.projectId!.slice(2)) >= 过限)).toBe(true);
    for (const 名 of ["总管理", "全看管理员", "按线管理员", "销售管理"] as const) {
      expect([名, (await 读(组[名])).总数]).toEqual([名, 过限 + 30]);
    }
    // 原负责人是我：同事看 30 行里都是他放的，领取按钮灰着
    const 同事看 = await 读(组.同事);
    expect(同事看.总数).toBe(过限);
    expect(同事看.行.every((x) => !x.原负责人是我)).toBe(true);
    await expect(以谁的身份(组.销售.id, () => 我回避的公海项目(prisma, 组.销售.id))).resolves.toHaveLength(过限);
  }, 大);

  it("两边都超上限：各取最新的 公海取上限 条、说一声截断，留下的行项目和入池原因都对", async () => {
    await 公海客户们(公海取上限 + 1, 组.销售.id);
    await 公海项目们(公海取上限 + 1, () => 组.同事.id);
    const r = await 读(组.销售);
    expect(r.截断).toBe(true);
    const 客户行 = r.行.filter((x) => x.种 === "客户");
    const 项目行 = r.行.filter((x) => x.种 === "项目");
    expect(客户行).toHaveLength(公海取上限);
    expect(项目行).toHaveLength(公海取上限);
    expect(客户行.some((x) => x.customerId === "c0")).toBe(false);
    expect(项目行.some((x) => x.projectId === "xp0")).toBe(false);
    expect(客户行.every((x) => x.项目名 === `项目${x.customerId.slice(1)}`)).toBe(true);
    expect(项目行.every((x) => x.入池原因 === "超时回收")).toBe(true);
  }, 大);

  it("同一刻入池的客户都排在上限边上：截断时不会张冠李戴", async () => {
    await 公海客户们(公海取上限 + 5, 组.销售.id);
    await prisma.customerPool.updateMany({ data: { at: 时刻(0) } });
    const r = await 读(组.销售);
    const 客户行 = r.行.filter((x) => x.种 === "客户");
    expect(客户行).toHaveLength(公海取上限);
    expect(客户行.every((x) => x.项目名 === `项目${x.customerId.slice(1)}`)).toBe(true);
  }, 大);

  it("历史负责人们、看得到的客户：直接传过 999 个 id，结果完整", async () => {
    await 公海项目们(过限, (i) => (i % 2 ? 组.销售.id : 组.同事.id));
    await prisma.projectNodeLog.create({ data: { projectId: "xp0", kind: "pool-release", fromOwnerId: 组.总管理.id, userId: 组.总管理.id, toPhase: "线索", toNode: "x", at: 时刻(9_000_000) } });
    const ids = Array.from({ length: 过限 }, (_, i) => `xp${i}`);
    const 们 = await 历史负责人们(prisma, ids);
    expect(们.size).toBe(过限);
    expect(们.get("xp0")).toBe(组.总管理.id); // 最近一条说了算
    expect(们.get("xp1")).toBe(组.销售.id);
    expect(们.get("xp2")).toBe(组.同事.id);

    const 客户ids = Array.from({ length: 过限 }, (_, i) => `xc${i}`);
    // 总管理都看得到；销售只看得到 salesOwnerId 是自己的（奇数号）；按线、市场各有范围，只要不报错且不串
    expect((await 以谁的身份(组.总管理.id, () => 看得到的客户(客户ids))).size).toBe(过限);
    const 销售看 = await 以谁的身份(组.销售.id, () => 看得到的客户(客户ids));
    expect(销售看.size).toBe(过限 / 2);
    expect(销售看.has("xc1")).toBe(true);
    expect(销售看.has("xc0")).toBe(false);
    for (const u of [组.按线管理员, 组.市场管理, 组.市场成员, 组.虚线上级, 组.销售管理, 组.没设角色]) {
      await expect(以谁的身份(u.id, () => 看得到的客户(客户ids))).resolves.toBeInstanceOf(Set);
    }
  }, 大);

  it("小数据下和带关联的老查询逐行一样：每种身份看到的项目、入池原因口径不变", async () => {
    const { 销售, 同事, 市场管理, 销售管理 } = 组;
    const 客 = async (id: string, owner: string) => prisma.customer.create({ data: { id, name: id, phone: `18${String(id.length)}${id.charCodeAt(id.length - 1)}000000`.slice(0, 11), salesOwnerId: owner } });
    const 项 = async (id: string, customerId: string, ownerId: string, 其他: Record<string, unknown> = {}) =>
      prisma.project.create({ data: { id, name: id, customerId, ownerId, creatorId: ownerId, ...其他 } });

    await 客("客a", 占位.id);
    await prisma.customerPool.create({ data: { customerId: "客a", reason: "r", at: 时刻(1) } });
    await 项("自己的", "客a", 销售.id, { createdAt: 时刻(1) });
    await 项("同事的", "客a", 同事.id, { createdAt: 时刻(2) });
    await 项("公海的", "客a", "", { createdAt: 时刻(3), pooledAt: 时刻(3), creatorId: 同事.id });
    await 项("已删的", "客a", 销售.id, { createdAt: 时刻(4), deletedAt: 时刻(4) });
    await 项("邀请中", "客a", 同事.id, { createdAt: 时刻(5) });
    await 项("已加入", "客a", 同事.id, { createdAt: 时刻(6) });
    await 项("市场建的", "客a", 同事.id, { createdAt: 时刻(7), creatorId: 市场管理.id });
    await prisma.projectMember.create({ data: { projectId: "邀请中", userId: 销售.id, inviteStatus: "INVITED" } });
    await prisma.projectMember.create({ data: { projectId: "已加入", userId: 销售.id, inviteStatus: "JOINED" } });
    await 客("客b", 同事.id);
    await prisma.customerPool.create({ data: { customerId: "客b", reason: "r", at: 时刻(2) } });
    await 客("客c", 同事.id);
    await 项("退回两次", "客c", "", { pooledAt: 时刻(8) });
    await 项("没留痕", "客c", "", { pooledAt: 时刻(9) });
    const 痕 = (userId: string, reason: string | null, at: Date, kind = "pool-release") =>
      prisma.projectNodeLog.create({ data: { projectId: "退回两次", kind, fromOwnerId: 同事.id, userId, reason, toPhase: "线索", toNode: "x", at } });
    await 痕(系统操作人, null, 时刻(5));
    await 痕(销售管理.id, "主动退回：不合适", 时刻(8));
    await 痕(系统操作人, null, 时刻(9), "node-change");

    for (const [名, u] of Object.entries(组)) {
      const r = await 读(u);
      const 老 = await 以谁的身份(u.id, async () => ({
        客户: await prisma.customer.findMany({ where: { pool: { isNot: null } }, select: { id: true, projects: { select: { name: true }, orderBy: { createdAt: "asc" } } } }),
        项目: await prisma.project.findMany({
          where: { pooledAt: { not: null }, customer: { pool: null } },
          select: { id: true, logs: { where: { kind: "pool-release" }, orderBy: { at: "desc" }, take: 1, select: { userId: true, reason: true, at: true } } },
        }),
      }));
      for (const c of 老.客户) {
        const 行 = r.行.find((x) => x.id === `c:${c.id}`)!;
        expect([名, c.id, 行.项目名]).toEqual([名, c.id, c.projects.length ? c.projects.map((p) => p.name).join("、") : null]);
      }
      // 同事是「退回两次」的历史负责人：这一行回避，老查询不管回避，这里单独算
      const 该有的项目 = 老.项目.filter((p) => !(名 === "同事" && p.id === "退回两次"));
      for (const p of 该有的项目) {
        const 行 = r.行.find((x) => x.id === `p:${p.id}`)!;
        const 类 = 项目入池类(p.logs[0] ?? null);
        expect([名, p.id, 行.类, 行.入池原因]).toEqual([名, p.id, 类, 入池原因文字(类, p.logs[0]?.reason)]);
      }
      expect([名, r.总数]).toEqual([名, 老.客户.length + 该有的项目.length]);
    }
    // 差分要真的分得开：销售看不到同事的、已删的、邀请中的；看得到自己的、公海的、已加入的
    const 销售看 = (await 读(销售)).行.find((x) => x.id === "c:客a")!;
    expect(销售看.项目名).toBe("自己的、公海的、已加入");
    expect((await 读(市场管理)).行.find((x) => x.id === "c:客a")!.项目名).toBe("公海的、市场建的");
    const 总管理看 = (await 读(组.总管理)).行.find((x) => x.id === "c:客a")!;
    expect(总管理看.项目名).toBe("自己的、同事的、公海的、邀请中、已加入、市场建的");
    expect((await 读(组.总管理)).行.find((x) => x.id === "p:退回两次")!.类).toBe("主动退回");
  }, 大);
});

/**
 * 客户负责人第一批（阶段 0）：把规格书第 4 节矩阵和第 10 节只读卡钉成用例，产品还没改。
 *
 * 用例名前缀：A 项目层动作不碰客户负责人 / B 两个公海分开 / C 客户进公海清空负责人 /
 * D 撤销原样回滚 / E 只读卡。「矩阵·xx」对应矩阵那一行，「第五节 n」对应落地规划待确认项。
 *
 * 默认开关一个都不改（公海规则.项目能单独领 等照默认），改前的红才是真的红。
 *
 * 「已清空」两种写法都认：salesOwnerId 必填且外键到 User，阶段 1 可能用占位账号，也可能改表。
 * 只读卡的入口阶段 1 才有，用变量路径动态 import，缺模块只让相关用例红、不让整个文件转换失败；
 * 约定：`读客户只读卡(me, projectId)` 返回 null（不让看）或
 * `{ 客户: { name, … }, 联系人: [{ name, position, phone?, email?, wechat? }] }`。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/shared-ws/current", async (原) => ({ ...(await 原<object>()), 当前是共享区: async () => false }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 无负责人占位名, 无负责人占位邮箱 } from "@/lib/pool";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 改项目, 放回公海, 领取公海项目, 公海超时收回 } from "@/lib/project/db";
import { 分配线索, 向导自动分配 } from "@/app/(app)/leads/assign-actions";
import { 分配公海项目, 撤销公海项目 } from "@/app/(app)/pool/actions";
import { 放进公海, 领取, 分配公海, 撤销公海 } from "@/app/(app)/customers/pool-actions";
import { assignSalesOwner, 撤销改负责人 } from "@/app/(app)/customers/actions";
import { 交接客户 } from "@/app/(app)/projects/handover/actions";
import { 停用分拣 } from "@/lib/offboard-db";
import { 离职放进公海 } from "@/lib/offboard-move";
import { 全局搜索 } from "@/app/(app)/global-search";
import { 导出客户 } from "@/app/(app)/customers/export-action";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };

let 总管: 人;
let 销售管理: 人;
let 虚线管理: 人;
let 市场: 人;
let 甲: 人;
let 乙: 人;
let 丙: 人;

const 造人 = async (key: string, name: string, role: string, bizRole: string, 上级?: { 实线?: string; 虚线?: string }): Promise<人> => {
  const email = `${key}@x`;
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  await prisma.entMember.create({
    data: { userId: u.id, bizRole, managerId: 上级?.实线, dottedManagerId: 上级?.虚线, ...(bizRole === "sales" ? { line: "内贸" } : {}) },
  });
  return { id: u.id, name, email, role, title: "", avatar: null };
};

const 当 = (u: 人) => { mocks.user = { ...u }; };
/** 以某人身份跑：requireUser 和 prisma 的范围都认这个人 */
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { 当(u); return 以谁的身份(u.id, fn); };

let 序号 = 0;
const 客户 = async (ownerId: string, name = "矩阵客户", extra: Record<string, unknown> = {}) => {
  序号 += 1;
  return (await prisma.customer.create({
    data: { name: `${name}${序号}`, phone: `139${String(序号).padStart(8, "0")}`, salesOwnerId: ownerId, ...extra },
  })).id;
};
const 项目 = async (customerId: string, ownerId: string, extra: Record<string, unknown> = {}) =>
  (await prisma.project.create({ data: { name: "矩阵项目", customerId, ownerId, creatorId: ownerId, ...extra } })).id;
const 联系人 = async (customerId: string, name: string, position = "采购") => {
  序号 += 1;
  return (await prisma.contact.create({
    data: { name, position, customerId, phone: `137${String(序号).padStart(8, "0")}`, email: `lx${序号}@example.com`, wechat: `wxtest${序号}` },
  })).id;
};

const 客户负责人 = async (c: string) => (await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId;
const 项目of = (p: string) => prisma.project.findUniqueOrThrow({ where: { id: p } });
const 客户在公海 = async (c: string) => !!(await prisma.customerPool.findUnique({ where: { customerId: c } }));
const 联系人们 = async (c: string) => (await prisma.contact.findMany({ where: { customerId: c }, select: { id: true } })).map((x) => x.id).sort();
const 历史条数 = (c: string) => prisma.customerOwnerLog.count({ where: { customerId: c } });
const 项目转手痕 = (p: string) => prisma.projectNodeLog.count({ where: { projectId: p, kind: { in: ["transfer", "pool-claim", "undo"] } } });

/** salesOwnerId 必填：空串，或占位账号 */
const 负责人已清空 = async (c: string) => {
  const v = await 客户负责人(c);
  if (v === "") return true;
  const u = await prisma.user.findUnique({ where: { id: v }, select: { email: true } });
  return u?.email === 无负责人占位邮箱;
};

/** 只读卡入口（阶段 1 才有）。变量路径，缺模块只红相关用例 */
type 只读卡 = { 客户: { name: string }; 联系人: { name: string; position?: string | null; phone?: string | null; email?: string | null; wechat?: string | null }[] } | null;
const 读卡 = async (u: 人, p: string): Promise<只读卡> => {
  const 路 = "@/lib/enterprise/customer-readonly-card";
  const m = (await import(/* @vite-ignore */ 路)) as { 读客户只读卡: (me: 人, projectId: string) => Promise<只读卡> };
  return 以(u, () => m.读客户只读卡(u, p));
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  总管 = await 造人("dir", "总管理", "ADMIN", "director");
  销售管理 = await 造人("smgr", "销售管理员", "MANAGER", "sales_mgr");
  虚线管理 = await 造人("dmgr", "虚线管理员", "MANAGER", "sales_mgr");
  市场 = await 造人("mkt", "市场同事", "SALES", "marketing_mgr");
  甲 = await 造人("jia", "销售甲某", "SALES", "sales", { 实线: 销售管理.id });
  乙 = await 造人("yi", "销售乙某", "SALES", "sales", { 实线: 销售管理.id, 虚线: 虚线管理.id });
  丙 = await 造人("bing", "销售丙某", "SALES", "sales", { 实线: 销售管理.id });
  await setSetting(规则.按组织看客户.key, true);
  await setSetting(规则.线索分配.key, true);
  invalidateSettingsCache();
  忘掉企业版范围();
});

afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("A① 项目层动作只改项目负责人，客户负责人不动", () => {
  it("A① 矩阵·项目转让：单项目客户，客户负责人和联系人不变、该项目变", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    const 联 = await 联系人(c, "王联系");
    await 以(总管, () => 改项目(总管, p, { ownerId: 丙.id }));
    expect((await 项目of(p)).ownerId).toBe(丙.id);
    expect(await 客户负责人(c)).toBe(甲.id);
    expect(await 联系人们(c)).toEqual([联]);
  });

  it("A① 矩阵·项目转让：多项目客户只动这一个项目，别的项目和客户负责人不动", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    const 别的 = await 项目(c, 甲.id);
    await 以(总管, () => 改项目(总管, p, { ownerId: 丙.id }));
    expect((await 项目of(p)).ownerId).toBe(丙.id);
    expect((await 项目of(别的)).ownerId).toBe(甲.id);
    expect(await 客户负责人(c)).toBe(甲.id);
  });

  it("A① 矩阵·项目转让：客户在客户公海时转项目，客户不跟着出公海", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id, { pooledAt: new Date() });
    await prisma.customerPool.create({ data: { customerId: c, reason: "测试放入", userId: null } });
    await 以(总管, () => 改项目(总管, p, { ownerId: 丙.id }));
    expect(await 客户在公海(c)).toBe(true);
    expect(await 客户负责人(c)).toBe(甲.id);
  });

  it("A① 矩阵·项目分配：销售之间手动分单项目客户的线索，客户负责人不变", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    expect(await 以(总管, () => 分配线索({ projectId: p, toUserId: 丙.id, line: "内贸" }))).toEqual({ ok: true });
    expect((await 项目of(p)).ownerId).toBe(丙.id);
    expect(await 客户负责人(c)).toBe(甲.id);
  });

  it("A① 矩阵·项目分配：销售把自己名下的线索向导自动分配给同事，客户负责人不变", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    // 11-09 起销售默认不能「自动」（只按建议留个人自持 / 暂不分配）：这里测的是客户负责人不动，先把「自动」开给销售
    await setSetting("enterprise.assign_use", { "dict-assign-1": ["marketing_mgr", "sales_mgr", "sales", "channel_ops", "project_ops"] });
    expect(await 以(甲, () => 向导自动分配(p))).toMatchObject({ ok: true });
    expect((await 项目of(p)).ownerId).not.toBe(甲.id);
    expect(await 客户负责人(c)).toBe(甲.id);
  });

  it("A① 矩阵·项目分配：管理员把线索公海的项目分给人，客户负责人不变", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    await 以(甲, () => 放回公海(甲, p));
    await 以(总管, () => 分配公海项目([p], 丙.id));
    expect((await 项目of(p)).ownerId).toBe(丙.id);
    expect(await 客户负责人(c)).toBe(甲.id);
  });

  it("A① 矩阵·线索公海领取：默认开关下能单独领，客户负责人不变", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    await 以(甲, () => 放回公海(甲, p));
    const r = await 以(丙, () => 领取公海项目(丙, p));
    expect(r).toMatchObject({ ok: true });
    expect((await 项目of(p)).ownerId).toBe(丙.id);
    expect(await 客户负责人(c)).toBe(甲.id);
  });

  it("第五节 1（待确认，先按建议）：市场首次分给销售算转客户，多项目客户整体交销售", async () => {
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    const 别的 = await 项目(c, 市场.id);
    await 联系人(c, "王联系");
    expect(await 以(市场, () => 分配线索({ projectId: p, toUserId: 甲.id, line: "内贸" }))).toEqual({ ok: true });
    expect(await 客户负责人(c)).toBe(甲.id);
    expect((await 项目of(p)).ownerId).toBe(甲.id);
    expect((await 项目of(别的)).ownerId).toBe(甲.id);
  });

  it("第五节 1（待确认，先按建议）：市场用向导自动分配，单项目客户整体交销售", async () => {
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    expect(await 以(市场, () => 向导自动分配(p))).toMatchObject({ ok: true });
    const 接手 = (await 项目of(p)).ownerId;
    expect(接手).not.toBe(市场.id);
    expect(await 客户负责人(c)).toBe(接手);
  });

  it("第五节 1（待确认，先按建议）：市场首次分给销售，单项目客户整体交销售", async () => {
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    expect(await 以(市场, () => 分配线索({ projectId: p, toUserId: 甲.id, line: "内贸" }))).toEqual({ ok: true });
    expect(await 客户负责人(c)).toBe(甲.id);
    expect((await 项目of(p)).ownerId).toBe(甲.id);
  });
});

describe("A② 转客户：名下全部项目（含同事在推的）、公海项目和联系人一起走（Even 11-08 决策一②，用户 11-10 按 Even）", () => {
  it("A② 矩阵·转客户：同事在推的项目一起给接手人", async () => {
    const c = await 客户(甲.id);
    const 自己的 = await 项目(c, 甲.id);
    const 同事的 = await 项目(c, 乙.id);
    expect(await 以(总管, () => assignSalesOwner([c], 丙.id))).toMatchObject({ ok: true, updated: 1 });
    expect(await 客户负责人(c)).toBe(丙.id);
    expect((await 项目of(自己的)).ownerId).toBe(丙.id);
    expect((await 项目of(同事的)).ownerId).toBe(丙.id);
  });

  it("A② 矩阵·转客户：还挂在线索公海的项目也一起走", async () => {
    const c = await 客户(甲.id);
    const 在推 = await 项目(c, 甲.id);
    const 公海里 = await 项目(c, 乙.id);
    await 以(乙, () => 放回公海(乙, 公海里));
    await prisma.customerPool.deleteMany({ where: { customerId: c } });
    await prisma.customer.update({ where: { id: c }, data: { salesOwnerId: 甲.id } });
    await prisma.project.update({ where: { id: 在推 }, data: { ownerId: 甲.id, pooledAt: null } });
    忘掉企业版范围();
    expect(await 以(总管, () => assignSalesOwner([c], 丙.id))).toMatchObject({ ok: true, updated: 1 });
    expect(await 项目of(公海里)).toMatchObject({ ownerId: 丙.id, pooledAt: null });
  });

  it("A② 矩阵·转客户：联系人仍挂在这家客户下，随客户走", async () => {
    const c = await 客户(甲.id);
    const 联 = await 联系人(c, "王联系");
    await 以(总管, () => assignSalesOwner([c], 丙.id));
    expect(await 客户负责人(c)).toBe(丙.id);
    expect(await 联系人们(c)).toEqual([联]);
  });

  it("A② 矩阵·上级裁决移交：销售管理移交客户，同事在推的项目一起给接手人", async () => {
    const c = await 客户(甲.id);
    const 同事的 = await 项目(c, 乙.id);
    expect(await 以(销售管理, () => assignSalesOwner([c], 丙.id))).toMatchObject({ ok: true, updated: 1 });
    expect(await 客户负责人(c)).toBe(丙.id);
    expect((await 项目of(同事的)).ownerId).toBe(丙.id);
  });

  it("第五节 3 / X-20（客户 11-09 回执 X4 改）：负责人本人转客户 = 申请移交，接手人确认前不生效", async () => {
    const c = await 客户(甲.id);
    expect(await 以(甲, () => assignSalesOwner([c], 丙.id))).toMatchObject({ ok: true, updated: 0, 交接中: 1, 申请移交: true });
    expect(await 客户负责人(c)).toBe(甲.id);
  });
});

describe("A③ 离职交接", () => {
  it("A③ 矩阵·离职交接（转交，第二节不改）：客户和他自己负责的项目交给接手人", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    await prisma.user.update({ where: { id: 甲.id }, data: { active: false } });
    expect(await 以(总管, () => 交接客户(甲.id, c, 丙.id))).toMatchObject({ ok: true });
    expect(await 客户负责人(c)).toBe(丙.id);
    expect((await 项目of(p)).ownerId).toBe(丙.id);
  });

  it("A③ 矩阵·离职交接（用户 11-09）：在职同事负责的不动，同事待分配的随客户给接手人并清状态", async () => {
    const c = await 客户(甲.id);
    const 自己的 = await 项目(c, 甲.id);
    const 同事的 = await 项目(c, 乙.id);
    const 待分配 = await 项目(c, 乙.id, { awaitAssignAt: new Date() });
    await prisma.user.update({ where: { id: 甲.id }, data: { active: false } });
    expect(await 以(总管, () => 交接客户(甲.id, c, 丙.id))).toMatchObject({ ok: true });
    expect(await 客户负责人(c)).toBe(丙.id);
    expect((await 项目of(自己的)).ownerId).toBe(丙.id);
    expect((await 项目of(同事的)).ownerId).toBe(乙.id);
    expect(await 项目of(待分配)).toMatchObject({ ownerId: 丙.id, awaitAssignAt: null });
  });

  it("A③ 离职「公海」方式：客户负责人清空，名下项目随客户包进公海并清负责人", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    await prisma.$transaction(async (tx) => {
      const 分 = await 停用分拣(tx, 甲.id, "公海", true);
      await 离职放进公海(tx, 分, 总管.id);
    });
    expect(await 客户在公海(c)).toBe(true);
    expect(await 负责人已清空(c)).toBe(true);
    expect(await 项目of(p)).toMatchObject({ ownerId: "" });
    expect((await 项目of(p)).pooledAt).not.toBeNull();
  });

  it("C 矩阵·离职公海：原负责人记进客户历史负责人", async () => {
    const c = await 客户(甲.id);
    await prisma.$transaction(async (tx) => {
      const 分 = await 停用分拣(tx, 甲.id, "公海", true);
      await 离职放进公海(tx, 分, 总管.id);
    });
    expect(await prisma.customerOwnerLog.count({ where: { customerId: c, fromOwnerId: 甲.id } })).toBe(1);
  });
});

describe("B 两个公海分开", () => {
  it("B① 项目退回：单项目客户不进客户公海、客户负责人不变", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    expect(await 以(甲, () => 放回公海(甲, p))).toEqual({ ok: true });
    expect((await 项目of(p)).pooledAt).not.toBeNull();
    expect(await 客户在公海(c)).toBe(false);
    expect(await 客户负责人(c)).toBe(甲.id);
  });

  it("B① 项目退回：多项目客户不进客户公海，别的项目不动", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    const 别的 = await 项目(c, 甲.id);
    expect(await 以(甲, () => 放回公海(甲, p))).toEqual({ ok: true });
    expect(await 客户在公海(c)).toBe(false);
    expect(await 项目of(别的)).toMatchObject({ ownerId: 甲.id, pooledAt: null });
  });

  it("B① / 第五节 2（项目超时先留）：项目超时收回只进线索公海，客户不动", async () => {
    const 今 = new Date("2026-10-26T10:00:00+08:00");
    await setSetting("orgRules", { ...默认组织规则, 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 3 } } });
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id, { createdAt: new Date(今.getTime() - 10 * 86400_000) });
    expect(await 以(甲, () => 公海超时收回(甲, 今))).toBe(1);
    expect((await 项目of(p)).pooledAt).not.toBeNull();
    expect(await 客户在公海(c)).toBe(false);
    expect(await 客户负责人(c)).toBe(甲.id);
  });

  it("B② 线索公海的项目能单独领：领走后客户和同客户别的项目不动", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    const 别的 = await 项目(c, 甲.id);
    await 以(甲, () => 放回公海(甲, p));
    expect(await 以(丙, () => 领取公海项目(丙, p))).toMatchObject({ ok: true });
    expect(await 项目of(p)).toMatchObject({ ownerId: 丙.id, pooledAt: null });
    expect(await 项目of(别的)).toMatchObject({ ownerId: 甲.id, pooledAt: null });
    expect(await 客户负责人(c)).toBe(甲.id);
  });

  it("B③ 矩阵·客户公海领取：整个客户包跟领取人走（项目、联系人一起）", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    const 联 = await 联系人(c, "王联系");
    expect(await 以(甲, () => 放进公海([c], "客户主动终止"))).toMatchObject({ ok: true, updated: 1 });
    expect((await 项目of(p)).pooledAt).not.toBeNull();
    expect(await 以(丙, () => 领取([c]))).toMatchObject({ ok: true, updated: 1 });
    expect(await 客户负责人(c)).toBe(丙.id);
    expect(await 客户在公海(c)).toBe(false);
    expect(await 项目of(p)).toMatchObject({ ownerId: 丙.id, pooledAt: null });
    expect(await 联系人们(c)).toEqual([联]);
  });

  it("B④ 界面文案：不再出现「项目公海」，统一叫「线索公海」", () => {
    const 根 = "src";
    const 文件们: string[] = [];
    const 走 = (目录: string) => {
      for (const 名 of readdirSync(目录)) {
        const 全 = join(目录, 名);
        if (statSync(全).isDirectory()) 走(全);
        else if (全.endsWith(".tsx")) 文件们.push(全);
      }
    };
    走(根);
    const 命中: string[] = [];
    for (const f of 文件们) {
      const 去注释 = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
      去注释.split("\n").forEach((行, i) => {
        // 函数名（放回项目公海、撤销…）不是文案，不算
        if (/^\s*import\b/.test(行)) return;
        if (/项目公海/.test(行.replace(/放回项目公海\(/g, "").replace(/放回项目公海(?=[,\s}])(?![^"'`]*["'`])/g, ""))) 命中.push(`${f}:${i + 1}`);
      });
    }
    expect(命中).toEqual([]);
  });
});

describe("C 客户进公海：清空负责人、记历史负责人、原负责人不能领回", () => {
  it("C 矩阵·客户放公海：客户负责人清空，名下项目随包清负责人", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    expect(await 以(甲, () => 放进公海([c], "客户主动终止"))).toMatchObject({ ok: true, updated: 1 });
    expect(await 负责人已清空(c)).toBe(true);
    expect(await 项目of(p)).toMatchObject({ ownerId: "" });
  });

  it("C 矩阵·客户放公海：原负责人记进客户历史负责人", async () => {
    const c = await 客户(甲.id);
    await 以(甲, () => 放进公海([c], "客户主动终止"));
    const 记 = await prisma.customerOwnerLog.findMany({ where: { customerId: c } });
    expect(记.map((x) => x.fromOwnerId)).toContain(甲.id);
  });

  it("C 原负责人不能领回（走真入口）；别人能领", async () => {
    const c = await 客户(甲.id);
    await 以(甲, () => 放进公海([c], "客户主动终止"));
    忘掉企业版范围();
    const r = await 以(甲, () => 领取([c]));
    expect(await 客户在公海(c)).toBe(true);
    expect(r.ok === false || (r as { updated?: number }).updated === 0).toBe(true);
    expect(await 以(丙, () => 领取([c]))).toMatchObject({ ok: true, updated: 1 });
    expect(await 客户负责人(c)).toBe(丙.id);
  });

  it("C 负责人已清空时，原负责人仍不能领回：按客户历史负责人判断", async () => {
    const 占位 = await prisma.user.create({ data: { email: 无负责人占位邮箱, name: 无负责人占位名, title: "", role: "SALES", password: "x" } });
    const c = await 客户(占位.id);
    await prisma.customerPool.create({ data: { customerId: c, reason: "客户主动终止", userId: 甲.id } });
    await prisma.customerOwnerLog.create({ data: { customerId: c, userId: 甲.id, fromOwnerId: 甲.id, toOwnerId: 占位.id, kind: "assign" } });
    忘掉企业版范围();
    const r = await 以(甲, () => 领取([c]));
    expect(await 客户在公海(c)).toBe(true);
    expect(r.ok === false || (r as { updated?: number }).updated === 0).toBe(true);
  });

  describe("批量转让不收公海客户（P-公海-04，四审 A3）", () => {
    const 放好 = async () => {
      const c = await 客户(甲.id);
      const p = await 项目(c, 甲.id);
      await 以(甲, () => 放进公海([c], "客户主动终止"));
      忘掉企业版范围();
      return { c, p };
    };
    const 全没动 = async (c: string, p: string) => {
      expect(await 负责人已清空(c)).toBe(true);
      expect(await 客户在公海(c)).toBe(true);
      expect(await 项目of(p)).toMatchObject({ ownerId: "" });
      expect((await 项目of(p)).pooledAt).not.toBeNull();
    };

    it("销售管理转公海客户：拒，说先领取或分配；客户、项目都没动", async () => {
      const { c, p } = await 放好();
      const r = await 以(销售管理, () => assignSalesOwner([c], 丙.id));
      expect(r).toMatchObject({ ok: false, error: expect.stringContaining("公海") });
      await 全没动(c, p);
    });

    it("被拒之后原负责人还是领不回", async () => {
      const { c } = await 放好();
      await 以(销售管理, () => assignSalesOwner([c], 丙.id));
      忘掉企业版范围();
      const r = await 以(甲, () => 领取([c]));
      expect(r.ok === false || (r as { updated?: number }).updated === 0).toBe(true);
      expect(await 客户在公海(c)).toBe(true);
    });

    it("一批里混着公海客户：整批拒，同批不在公海的也不换（同 虚线只读挡、转让挡）", async () => {
      const { c, p } = await 放好();
      const 普通 = await 客户(甲.id);
      const r = await 以(销售管理, () => assignSalesOwner([普通, c], 丙.id));
      expect(r).toMatchObject({ ok: false, error: expect.stringContaining("公海") });
      await 全没动(c, p);
      expect(await 客户负责人(普通)).toBe(甲.id);
    });

    it("交接要确认开着：也拒，不生成交接", async () => {
      await setSetting(规则.交接要确认.key, true);
      invalidateSettingsCache();
      const { c, p } = await 放好();
      const r = await 以(销售管理, () => assignSalesOwner([c], 丙.id));
      expect(r).toMatchObject({ ok: false, error: expect.stringContaining("公海") });
      expect(await prisma.entHandover.count()).toBe(0);
      await 全没动(c, p);
    });

    it("不归他管的人先说没权限：负责人转不了公海客户，话不变", async () => {
      const { c, p } = await 放好();
      const r = await 以(丙, () => assignSalesOwner([c], 乙.id));
      expect(r).toMatchObject({ ok: false, error: expect.stringContaining("只能转出") });
      await 全没动(c, p);
    });

    it("不在公海的照旧能转；不是企业版不受影响", async () => {
      const 普通 = await 客户(甲.id);
      expect(await 以(销售管理, () => assignSalesOwner([普通], 丙.id))).toMatchObject({ ok: true, updated: 1 });
      expect(await 客户负责人(普通)).toBe(丙.id);
      vi.stubEnv("CRM_ENTERPRISE", "");
      const 老 = await 客户(甲.id);
      await prisma.customerPool.create({ data: { customerId: 老, reason: "老规矩" } });
      expect(await 以(总管, () => assignSalesOwner([老], 丙.id))).toMatchObject({ ok: true, updated: 1 });
      expect(await 客户负责人(老)).toBe(丙.id);
    });
  });

  it.todo("C 矩阵·超时回收（客户级）：企业版 poolDays 锁 0、客户级超时没有入口，定入口后补");

  it("第五节 4（保留）：名下有同事在推的项目，不能放公海", async () => {
    const c = await 客户(甲.id);
    await 项目(c, 乙.id);
    const r = await 以(甲, () => 放进公海([c], "客户主动终止"));
    expect(r).toMatchObject({ ok: false });
    expect(await 客户在公海(c)).toBe(false);
    expect(await 客户负责人(c)).toBe(甲.id);
  });

  it("第五节 4（保留）：名下有未结束的订单阶段项目，不能放公海", async () => {
    const c = await 客户(甲.id);
    await 项目(c, 甲.id, { phase: "订单" });
    const r = await 以(甲, () => 放进公海([c], "客户主动终止"));
    expect(r).toMatchObject({ ok: false });
    expect(await 客户在公海(c)).toBe(false);
  });

  it("P-看-12 例外：订单项目拦住放公海时，自己负责的写项目名，同事的只写个数", async () => {
    const c = await 客户(甲.id);
    await 项目(c, 甲.id, { phase: "订单", name: "自己的大单" });
    await 项目(c, 乙.id, { phase: "订单", name: "同事的单子" });
    const r = await 以(甲, () => 放进公海([c], "客户主动终止"));
    if (r.ok) throw new Error("应被拦");
    expect(r.error).toContain("「自己的大单」");
    expect(r.error).toContain("另外有 1 个同事在推的项目");
    expect(r.error).not.toContain("同事的单子");
    expect(r.error).not.toContain(乙.name);
    // 一位能放、一位被订单拦：提示条也带上名字
    const 能放的 = await 客户(甲.id);
    const 部分 = await 以(甲, () => 放进公海([c, 能放的], "客户主动终止"));
    expect(部分).toMatchObject({ ok: true, updated: 1, 有订单: 1 });
    if (部分.ok) expect(部分.订单项目).toBe("「自己的大单」；另外有 1 个同事在推的项目");
  });
});

describe("D 撤销：恢复到动作前的归属，不产生新的归属历史，操作日志留着", () => {
  /** 页面撤销时把回执原样交回：原负责人、带过来、公海项目 */
  const 公海回执 = (r: unknown) => r as { 原负责人: { id: string; 值: string }[]; 带过来?: never; 公海项目?: string[] };

  const 放公海的客户 = async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    await 以(甲, () => 放进公海([c], "客户主动终止"));
    忘掉企业版范围();
    return { c, p, 动作前负责人: await 客户负责人(c), 动作前历史: await 历史条数(c) };
  };

  it("D 矩阵·撤销客户公海领取：归属回到领取前", async () => {
    const { c, p, 动作前负责人 } = await 放公海的客户();
    const r = await 以(丙, () => 领取([c]));
    expect(r).toMatchObject({ ok: true, updated: 1 });
    await 以(丙, () => 撤销公海("领取", 公海回执(r).原负责人, 公海回执(r).带过来, undefined, 公海回执(r).公海项目));
    expect(await 客户负责人(c)).toBe(动作前负责人);
    expect(await 客户在公海(c)).toBe(true);
    expect((await 项目of(p)).pooledAt).not.toBeNull();
  });

  it("D 矩阵·撤销客户公海领取：不留归属历史（记录数回到领取前、没有 undo）", async () => {
    const { c, 动作前历史 } = await 放公海的客户();
    const r = await 以(丙, () => 领取([c]));
    await 以(丙, () => 撤销公海("领取", 公海回执(r).原负责人, 公海回执(r).带过来, undefined, 公海回执(r).公海项目));
    expect(await 历史条数(c)).toBe(动作前历史);
    expect(await prisma.customerOwnerLog.count({ where: { customerId: c, kind: "undo" } })).toBe(0);
  });

  it("D 矩阵·撤销公海分配：归属回到分配前、不留归属历史", async () => {
    const { c, 动作前负责人, 动作前历史 } = await 放公海的客户();
    const r = await 以(总管, () => 分配公海([c], 丙.id));
    expect(r).toMatchObject({ ok: true, updated: 1 });
    await 以(总管, () => 撤销公海("分配", 公海回执(r).原负责人, 公海回执(r).带过来, 丙.id, 公海回执(r).公海项目));
    expect(await 客户负责人(c)).toBe(动作前负责人);
    expect(await 历史条数(c)).toBe(动作前历史);
  });

  it("D 矩阵·撤销转客户：负责人和项目回到转之前", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    const r = await 以(总管, () => assignSalesOwner([c], 丙.id));
    const 回 = r as unknown as { 原值: { id: string; 值: string }[]; 带过来: never };
    expect(await 以(总管, () => 撤销改负责人(回.原值, 丙.id, 回.带过来))).toMatchObject({ ok: true, updated: 1 });
    expect(await 客户负责人(c)).toBe(甲.id);
    expect((await 项目of(p)).ownerId).toBe(甲.id);
  });

  it("D 矩阵·撤销转客户：客户层不留归属历史", async () => {
    const c = await 客户(甲.id);
    await 项目(c, 甲.id);
    const 前 = await 历史条数(c);
    const r = await 以(总管, () => assignSalesOwner([c], 丙.id));
    const 回 = r as unknown as { 原值: { id: string; 值: string }[]; 带过来: never };
    await 以(总管, () => 撤销改负责人(回.原值, 丙.id, 回.带过来));
    expect(await 历史条数(c)).toBe(前);
  });

  it("D 矩阵·撤销转客户：项目层也不另记一条转让", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    const 前 = await 项目转手痕(p);
    const r = await 以(总管, () => assignSalesOwner([c], 丙.id));
    const 回 = r as unknown as { 原值: { id: string; 值: string }[]; 带过来: never };
    await 以(总管, () => 撤销改负责人(回.原值, 丙.id, 回.带过来));
    expect(await 项目转手痕(p)).toBe(前);
  });

  it("D 矩阵·撤销客户放公海：负责人和项目恢复、不留归属历史", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    const 前 = await 历史条数(c);
    const r = await 以(甲, () => 放进公海([c], "客户主动终止"));
    忘掉企业版范围();
    expect(await 以(甲, () => 撤销公海("放进", [{ id: c, 值: 甲.id }], undefined, undefined, 公海回执(r).公海项目))).toMatchObject({ ok: true, updated: 1 });
    expect(await 客户负责人(c)).toBe(甲.id);
    expect(await 客户在公海(c)).toBe(false);
    expect(await 项目of(p)).toMatchObject({ ownerId: 甲.id, pooledAt: null });
    expect(await 历史条数(c)).toBe(前);
  });

  it("D 矩阵·撤销线索公海领取：项目回线索公海、项目层不留痕，客户负责人不变", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    await 以(甲, () => 放回公海(甲, p));
    const 前 = await 项目转手痕(p);
    expect(await 以(丙, () => 领取公海项目(丙, p))).toMatchObject({ ok: true });
    expect(await 以(丙, () => 撤销公海项目("领取", [p]))).toMatchObject({ ok: true });
    expect((await 项目of(p)).pooledAt).not.toBeNull();
    expect(await 项目转手痕(p)).toBe(前);
    expect(await 客户负责人(c)).toBe(甲.id);
  });

  it("D 操作日志留着：撤销之后 AuditLog 里动作和撤销都在", async () => {
    const c = await 客户(甲.id);
    const 前 = await prisma.auditLog.count();
    const r = await 以(总管, () => assignSalesOwner([c], 丙.id));
    const 动作后 = await prisma.auditLog.count();
    expect(动作后).toBeGreaterThan(前);
    const 回 = r as unknown as { 原值: { id: string; 值: string }[]; 带过来: never };
    await 以(总管, () => 撤销改负责人(回.原值, 丙.id, 回.带过来));
    expect(await prisma.auditLog.count()).toBeGreaterThan(动作后);
  });
});

describe("E① 只负责项目的人：只读卡，不进客户层", () => {
  /** 客户归甲，项目归乙（丙是创建人）；项目上挂王联系，李联系只在客户上 */
  const 搭 = async () => {
    const c = await 客户(甲.id, "矩阵客户", { custStatus: "特征客户状态值" });
    const p = await 项目(c, 乙.id, { creatorId: 丙.id });
    const 王 = await 联系人(c, "王联系", "总经理");
    const 李 = await 联系人(c, "李联系", "财务");
    await prisma.projectContact.create({ data: { projectId: p, contactId: 王 } });
    忘掉企业版范围();
    return { c, p, 王, 李, 客户名: (await prisma.customer.findUniqueOrThrow({ where: { id: c } })).name };
  };

  it("E① 第 10.1：不进客户列表、不产生客户层入口", async () => {
    const { c } = await 搭();
    const 看到 = await 以(乙, () => prisma.customer.findMany({ select: { id: true } }));
    expect(看到.map((x) => x.id)).not.toContain(c);
    expect(await 以(乙, () => prisma.customer.findUnique({ where: { id: c }, select: { id: true } }))).toBeNull();
  });

  it("E① 第 10.3：全局搜不到这家客户", async () => {
    const { c, 客户名 } = await 搭();
    const r = await 以(乙, () => 全局搜索(客户名));
    expect(r.客户.map((x) => x.id)).not.toContain(c);
    // 对照：客户负责人搜得到，说明不是搜索本身没出结果
    expect((await 以(甲, () => 全局搜索(客户名))).客户.map((x) => x.id)).toContain(c);
  });

  it("E① 第 10.3：全局搜不到这家的联系人", async () => {
    const { 王, 李 } = await 搭();
    for (const [词, id] of [["王联系", 王], ["李联系", 李]] as const) {
      const r = await 以(乙, () => 全局搜索(词));
      expect(r.联系人.map((x) => x.id)).not.toContain(id);
    }
  });

  it("E① 第 10.3：导出里没有这家客户", async () => {
    const { 客户名 } = await 搭();
    const r = await 以(乙, () => 导出客户({} as never));
    expect(JSON.stringify(r)).not.toContain(客户名);
    // 对照：总管理导出里有
    expect(JSON.stringify(await 以(总管, () => 导出客户({} as never)))).toContain(客户名);
  });

  it("E① 第 10.3：批量拉联系人拉不到", async () => {
    const { 王, 李 } = await 搭();
    const 看到 = await 以(乙, () => prisma.contact.findMany({ select: { id: true } }));
    expect(看到.map((x) => x.id)).not.toContain(王);
    expect(看到.map((x) => x.id)).not.toContain(李);
    // 对照：客户负责人拉得到
    expect((await 以(甲, () => prisma.contact.findMany({ select: { id: true } }))).map((x) => x.id)).toContain(王);
  });

  it("E① 项目负责人从项目详情能打开只读卡：客户资料、联系人姓名和职务", async () => {
    const { p, 客户名 } = await 搭();
    const 卡 = await 读卡(乙, p);
    expect(卡?.客户.name).toBe(客户名);
    expect(卡?.联系人.map((x) => [x.name, x.position]).sort()).toEqual([["李联系", "财务"], ["王联系", "总经理"]]);
  });

  it("E① 只有自己项目的联系人显示联系方式，别的联系人不给", async () => {
    const { p } = await 搭();
    const 卡 = await 读卡(乙, p);
    const 王 = 卡?.联系人.find((x) => x.name === "王联系");
    const 李 = 卡?.联系人.find((x) => x.name === "李联系");
    expect(王?.phone).toBeTruthy();
    expect(王?.email).toBeTruthy();
    expect(李).toBeDefined();
    expect(李?.phone ?? null).toBeNull();
    expect(李?.email ?? null).toBeNull();
    expect(李?.wechat ?? null).toBeNull();
  });

  it("E① 第 10.4：卡里不露负责人身份、客户状态、客户级别", async () => {
    const { p } = await 搭();
    const 卡 = JSON.stringify(await 读卡(乙, p));
    for (const 不该有 of [甲.id, 甲.name, "salesOwnerId", "特征客户状态值", "custStatus", "followStatus", "decisionStatus", "level"]) {
      expect(卡).not.toContain(不该有);
    }
  });

  it("E① 第 10.2 / P-看-10：项目创建人不是负责人，看不了只读卡", async () => {
    const { p } = await 搭();
    expect(await 读卡(丙, p)).toBeNull();
  });

  it("E① 第五节 5（先做实线）：实线直属上级能看，虚线上级不能", async () => {
    const { p } = await 搭();
    expect(await 读卡(销售管理, p)).not.toBeNull();
    expect(await 读卡(虚线管理, p)).toBeNull();
  });

  it("E① 第 10.1：只读卡不是客户层入口——没负责项目的同事拿不到", async () => {
    const 丁 = await 造人("ding", "销售丁某", "SALES", "sales", { 实线: 销售管理.id });
    const { p } = await 搭();
    expect(await 读卡(丁, p)).toBeNull();
  });
});

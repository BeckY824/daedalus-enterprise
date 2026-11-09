/**
 * 客户负责人第一批 11-09 两个决定：
 * 一、市场首次分给销售（X-18）时待办、计划不搬、不关（P-转-10）：本人还能勾完成，接手人收到一句提醒；别的转客户入口照旧带活。
 * 二、批量自动分配时同一市场客户下几条线索按客户算一份：后面几条不挑人、不占额度、不写分配记录；客户负责人已是销售的还是一条条分。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
import { 分配线索, 自动分配线索, 向导自动分配, 批量自动分配, 项目分配线 } from "@/app/(app)/leads/assign-actions";
import { 自动分配不参与key, 不设配额key, 本月加额, 本月已分 } from "@/lib/enterprise/lead-assign";
import { assignSalesOwner } from "@/app/(app)/customers/actions";
import { toggleTask, completePlan, saveTask, deleteTask, savePlan, deletePlan } from "@/app/(app)/customers/[id]/actions";
import { 交接客户 } from "@/app/(app)/projects/handover/actions";
import { 收回提醒尾, 旧收回提醒尾 } from "@/lib/project/db";
import { 撞号提醒尾 } from "@/lib/enterprise/contact-format";
import { 不能改客户事项话, 没业务角色话 } from "@/lib/enterprise/follow-perm";
import { 只读角色话 } from "@/lib/enterprise/permissions";
import { 销售初判, 市场复核 } from "@/lib/project/lead-verify";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };

let 总管: 人;
let 市场: 人;
let 甲: 人;
let 乙: 人;
let 丙: 人;

const 造人 = async (key: string, name: string, role: string, bizRole: string | null): Promise<人> => {
  const email = `${key}@x`;
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  if (bizRole) await prisma.entMember.create({ data: { userId: u.id, bizRole, ...(bizRole === "sales" ? { line: "内贸" } : {}) } });
  return { id: u.id, name, email, role, title: "", avatar: null };
};

const 当 = (u: 人) => { mocks.user = { ...u }; };
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { 当(u); return 以谁的身份(u.id, fn); };

let 序号 = 0;
const 客户 = async (ownerId: string) => {
  序号 += 1;
  return (await prisma.customer.create({ data: { name: `客户${序号}`, phone: `139${String(序号).padStart(8, "0")}`, salesOwnerId: ownerId } })).id;
};
const 项目 = async (customerId: string, ownerId: string, extra: Record<string, unknown> = {}) => {
  序号 += 1;
  return (await prisma.project.create({ data: { name: `项目${序号}`, customerId, ownerId, creatorId: ownerId, ...extra } })).id;
};
const 待办 = async (customerId: string, ownerId: string, title = "打电话") => (await prisma.task.create({ data: { title, customerId, ownerId } })).id;
const 计划 = async (customerId: string, ownerId: string, subject = "回访") => (await prisma.followPlan.create({ data: { subject, plannedAt: new Date(), customerId, ownerId } })).id;

const 客户负责人 = async (c: string) => (await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId;
const 项目of = (p: string) => prisma.project.findUniqueOrThrow({ where: { id: p } });
const 待办of = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
const 计划of = (id: string) => prisma.followPlan.findUniqueOrThrow({ where: { id } });
const 通知们 = (userId: string) => prisma.entNotice.findMany({ where: { userId } });

const 只留参与 = async (...们: 人[]) => {
  const 全部 = await prisma.entMember.findMany({ select: { userId: true } });
  await setSetting(自动分配不参与key, 全部.map((x) => x.userId).filter((id) => !们.some((u) => u.id === id)));
  invalidateSettingsCache();
};

/** 活还在原负责人手里，没被搬、没被关，标题也没动 */
const 活还在 = async (t: string, p: string, 主人: string, 标题 = "打电话") => {
  expect(await 待办of(t)).toMatchObject({ ownerId: 主人, done: false, doneAt: null, title: 标题 });
  expect(await 计划of(p)).toMatchObject({ ownerId: 主人, done: false, doneAt: null });
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  总管 = await 造人("dir", "总管理", "ADMIN", "director");
  市场 = await 造人("mkt", "市场同事", "SALES", "marketing_mgr");
  甲 = await 造人("jia", "销售甲某", "SALES", "sales");
  乙 = await 造人("yi", "销售乙某", "SALES", "sales");
  丙 = await 造人("bing", "销售丙某", "SALES", "sales");
  await setSetting(规则.按组织看客户.key, true);
  await setSetting(规则.线索分配.key, true);
  await setSetting(不设配额key, true);
  invalidateSettingsCache();
  忘掉企业版范围();
});
afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); });

describe("决定一 1：市场首次分给销售，待办、计划不搬、不关", () => {
  for (const [说法, 勾] of [["没传勾", undefined], ["伪造 带待办=true", true], ["伪造 带待办=false", false]] as const) {
    it(`手动分（${说法}）：还归原负责人；客户、全部项目、公海项目、联系人、进行中的商机照走`, async () => {
      const c = await 客户(市场.id);
      const p = await 项目(c, 市场.id);
      const 别的 = await 项目(c, 市场.id);
      const 公海的 = await 项目(c, 市场.id, { pooledAt: new Date() });
      const 联系人 = (await prisma.contact.create({ data: { name: "王联系", customerId: c } })).id;
      const 商机 = (await prisma.opportunity.create({ data: { name: "商机", customerId: c, ownerId: 市场.id } })).id;
      const t = await 待办(c, 市场.id);
      const 点名 = await 待办(c, 市场.id, `跟进「${(await 项目of(p)).name}」`);
      const pl = await 计划(c, 市场.id);

      const r = await 以(市场, () => 分配线索({ projectId: p, toUserId: 甲.id, line: "内贸", ...(勾 === undefined ? {} : { 带待办: 勾 }) }));
      expect(r).toEqual({ ok: true });

      await 活还在(t, pl, 市场.id);
      expect(await 待办of(点名)).toMatchObject({ ownerId: 市场.id, done: false });
      expect(await 客户负责人(c)).toBe(甲.id);
      for (const id of [p, 别的, 公海的]) expect(await 项目of(id)).toMatchObject({ ownerId: 甲.id, pooledAt: null });
      expect((await prisma.contact.findUniqueOrThrow({ where: { id: 联系人 } })).customerId).toBe(c);
      expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: 商机 } })).ownerId).toBe(甲.id);
      // 留痕也不说带了 / 关了待办
      const 痕 = await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: p, kind: "transfer", toOwnerId: 甲.id } });
      expect(痕.reason).toBe("分配方式：指定分配");
    });
  }

  it("单条自动分配、向导自动分配：同样不搬不关", async () => {
    await 只留参与(甲);
    const c1 = await 客户(市场.id);
    const p1 = await 项目(c1, 市场.id);
    const t1 = await 待办(c1, 市场.id);
    const pl1 = await 计划(c1, 市场.id);
    expect(await 以(市场, () => 自动分配线索(p1, { 项目: true, 原负责人: 市场.id }))).toMatchObject({ ok: true, toUserId: 甲.id });
    await 活还在(t1, pl1, 市场.id);
    expect(await 客户负责人(c1)).toBe(甲.id);

    const c2 = await 客户(市场.id);
    const p2 = await 项目(c2, 市场.id);
    const t2 = await 待办(c2, 市场.id);
    const pl2 = await 计划(c2, 市场.id);
    expect(await 以(市场, () => 向导自动分配(p2))).toMatchObject({ ok: true, toUserId: 甲.id });
    await 活还在(t2, pl2, 市场.id);
    expect(await 客户负责人(c2)).toBe(甲.id);
  });

  it("带走的项目清掉待分配，分配方式这一格补上，已选的不改；只有分的那条写分配记录", async () => {
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    const 待分配 = await 项目(c, 市场.id, { awaitAssignAt: new Date() });
    const 已选 = await 项目(c, 市场.id, { assignMode: "公海捞取" });
    expect(await 以(市场, () => 分配线索({ projectId: p, toUserId: 甲.id, line: "内贸" }))).toEqual({ ok: true });
    expect(await 项目of(待分配)).toMatchObject({ ownerId: 甲.id, awaitAssignAt: null, assignMode: "指定分配" });
    expect(await 项目of(已选)).toMatchObject({ ownerId: 甲.id, assignMode: "公海捞取" });
    expect(await prisma.entLeadAssign.findMany({ select: { projectId: true } })).toEqual([{ projectId: p }]);
  });
});

describe("决定一 1：别的入口带活不变", () => {
  it("普通转客户：待办、计划跟新负责人（原负责人是市场也一样，这个入口不传 留下）", async () => {
    const c = await 客户(市场.id);
    await 项目(c, 市场.id);
    const t = await 待办(c, 市场.id);
    const pl = await 计划(c, 市场.id);
    expect(await 以(总管, () => assignSalesOwner([c], 甲.id))).toMatchObject({ ok: true, updated: 1 });
    expect((await 待办of(t)).ownerId).toBe(甲.id);
    expect((await 计划of(pl)).ownerId).toBe(甲.id);
  });

  it("离职交接：待办、计划跟接手人", async () => {
    const c = await 客户(甲.id);
    await 项目(c, 甲.id);
    const t = await 待办(c, 甲.id);
    const pl = await 计划(c, 甲.id);
    await prisma.user.update({ where: { id: 甲.id }, data: { active: false } });
    expect(await 以(总管, () => 交接客户(甲.id, c, 丙.id))).toMatchObject({ ok: true });
    expect((await 待办of(t)).ownerId).toBe(丙.id);
    expect((await 计划of(pl)).ownerId).toBe(丙.id);
  });

  it("客户负责人是销售时的普通分配：弹窗的勾照旧算数（带 / 关）", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    const 名 = (await 项目of(p)).name;
    const t = await 待办(c, 甲.id, `跟进「${名}」`);
    expect(await 以(总管, () => 分配线索({ projectId: p, toUserId: 乙.id, line: "内贸", 带待办: true }))).toEqual({ ok: true });
    expect((await 待办of(t)).ownerId).toBe(乙.id);
    expect(await 客户负责人(c)).toBe(甲.id);
    const 痕 = await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: p, kind: "transfer", toOwnerId: 乙.id } });
    expect(痕.reason).toContain("带过来 1 条");
  });
});

describe("决定一 2：弹窗要的判断（项目分配线）", () => {
  it("客户在市场手里 = 市场转客户；负责人是销售、客户在公海都不是", async () => {
    const 市场的 = await 客户(市场.id);
    const p1 = await 项目(市场的, 市场.id);
    expect(await 以(市场, () => 项目分配线(p1))).toMatchObject({ 市场转客户: true });

    const 销售的 = await 客户(甲.id);
    const p2 = await 项目(销售的, 市场.id);
    expect(await 以(总管, () => 项目分配线(p2))).toMatchObject({ 市场转客户: false });

    const 公海的 = await 客户(市场.id);
    const p3 = await 项目(公海的, 市场.id);
    await prisma.customerPool.create({ data: { customerId: 公海的, reason: "手动" } });
    expect(await 以(总管, () => 项目分配线(p3))).toMatchObject({ 市场转客户: false });
  });
});

describe("决定一 3：本人勾完成", () => {
  const 交出 = async () => {
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    const t = await 待办(c, 市场.id);
    const pl = await 计划(c, 市场.id);
    expect(await 以(市场, () => 分配线索({ projectId: p, toUserId: 甲.id, line: "内贸" }))).toEqual({ ok: true });
    return { c, p, t, pl };
  };

  it("交出后还能勾完成、取消完成自己的待办和计划", async () => {
    const { t, pl } = await 交出();
    expect(await 以(市场, () => toggleTask(t, true))).toEqual({ ok: true });
    expect(await 待办of(t)).toMatchObject({ done: true, ownerId: 市场.id });
    expect(await 以(市场, () => toggleTask(t, false))).toEqual({ ok: true });
    expect(await 待办of(t)).toMatchObject({ done: false, doneAt: null });
    expect(await 以(市场, () => completePlan(pl))).toEqual({ ok: true });
    expect(await 计划of(pl)).toMatchObject({ done: true, ownerId: 市场.id });
    expect(await 以(市场, () => completePlan(pl, false))).toEqual({ ok: true });
    expect(await 计划of(pl)).toMatchObject({ done: false, doneAt: null });
    // 审计写客户名，不是客户 id（市场已经看不到这位客户）
    const 审计 = await prisma.auditLog.findFirstOrThrow({ where: { entity: "FollowPlan", entityId: pl }, orderBy: { at: "desc" } });
    expect(审计.summary).toContain("客户");
    expect(审计.summary).not.toContain((await 计划of(pl)).customerId);
  });

  it("只放勾完成：编辑、删除、新建照旧拒，内容不变", async () => {
    const { c, t, pl } = await 交出();
    const 话 = { ok: false, error: 不能改客户事项话 };
    expect(await 以(市场, () => saveTask({ id: t, customerId: c, title: "改了" }))).toEqual(话);
    expect(await 以(市场, () => deleteTask(t))).toEqual(话);
    expect(await 以(市场, () => saveTask({ customerId: c, title: "新的" }))).toEqual(话);
    expect(await 以(市场, () => savePlan({ id: pl, customerId: c, subject: "改了", plannedAt: new Date().toISOString(), method: "电话沟通" }))).toEqual(话);
    expect(await 以(市场, () => deletePlan(pl))).toEqual(话);
    expect((await 待办of(t)).title).toBe("打电话");
    expect((await 计划of(pl)).subject).toBe("回访");
    expect(await prisma.task.count({ where: { customerId: c } })).toBe(1);
  });

  it("不能勾别人的", async () => {
    const { c } = await 交出();
    const 别人的待办 = await 待办(c, 乙.id);
    const 别人的计划 = await 计划(c, 乙.id);
    expect(await 以(市场, () => toggleTask(别人的待办, true))).toEqual({ ok: false, error: 不能改客户事项话 });
    expect(await 以(市场, () => completePlan(别人的计划))).toEqual({ ok: false, error: 不能改客户事项话 });
    expect((await 待办of(别人的待办)).done).toBe(false);
    expect((await 计划of(别人的计划)).done).toBe(false);
  });

  it("新负责人看得到、也能勾", async () => {
    const { t, pl } = await 交出();
    const 看 = await 以(甲, async () => [await prisma.task.findMany({ select: { id: true } }), await prisma.followPlan.findMany({ select: { id: true } })] as const);
    expect(看[0].map((x) => x.id)).toContain(t);
    expect(看[1].map((x) => x.id)).toContain(pl);
    expect(await 以(甲, () => toggleTask(t, true))).toEqual({ ok: true });
    expect(await 以(甲, () => completePlan(pl))).toEqual({ ok: true });
    expect((await 待办of(t)).ownerId).toBe(市场.id); // 勾了也还归原负责人
  });

  it("公海里的客户、没业务角色、只读角色：是本人的也照旧拒", async () => {
    const { c, t } = await 交出();
    await prisma.customerPool.create({ data: { customerId: c, reason: "手动" } });
    const r = await 以(市场, () => toggleTask(t, true));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("公海");

    const 没角色 = await 造人("none", "没角色", "SALES", null);
    const 只读 = await 造人("adm", "只读管理员", "SALES", "admin");
    const d = await 客户(甲.id);
    const 他的 = await 待办(d, 没角色.id);
    const 她的 = await 待办(d, 只读.id);
    const 他的计划 = await 计划(d, 没角色.id);
    const 她的计划 = await 计划(d, 只读.id);
    invalidateSettingsCache();
    忘掉企业版范围();
    expect(await 以(没角色, () => toggleTask(他的, true))).toEqual({ ok: false, error: 没业务角色话 });
    expect(await 以(只读, () => toggleTask(她的, true))).toEqual({ ok: false, error: 只读角色话 });
    expect(await 以(没角色, () => completePlan(他的计划))).toEqual({ ok: false, error: 没业务角色话 });
    expect(await 以(只读, () => completePlan(她的计划))).toEqual({ ok: false, error: 只读角色话 });
  });

  it("普通路径没被放宽的：客户不归我、项目不归我、待办也不归我还是拒", async () => {
    const c = await 客户(甲.id);
    const t = await 待办(c, 乙.id);
    expect(await 以(丙, () => toggleTask(t, true))).toEqual({ ok: false, error: 不能改客户事项话 });
  });
});

describe("决定一 4：分配通知加一句", () => {
  const 造活 = async (c: string, 主人: string) => {
    await 待办(c, 主人);
    await 待办(c, 主人, "第二条");
    await 待办(c, 主人, `某某${收回提醒尾}`);
    await 待办(c, 主人, `某某${旧收回提醒尾}`);
    await 待办(c, 主人, `某某${撞号提醒尾}`);
    await prisma.task.create({ data: { title: "做完了", customerId: c, ownerId: 主人, done: true, doneAt: new Date() } });
    await 计划(c, 主人);
    await prisma.followPlan.create({ data: { subject: "做完了", plannedAt: new Date(), customerId: c, ownerId: 主人, done: true } });
  };

  it("手动：写 N、M，系统提醒和做完的不算；只发接手人", async () => {
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    await 造活(c, 市场.id);
    await 待办(c, 乙.id, "同事的不算");
    await 以(市场, () => 分配线索({ projectId: p, toUserId: 甲.id, line: "内贸" }));
    const [n, ...多] = await 通知们(甲.id);
    expect(多).toEqual([]);
    expect(n.body).toBe("客户上还有原负责人 2 条未完成待办、1 条未完成计划");
    expect(await 通知们(市场.id)).toEqual([]);
  });

  it("单条自动：接在原来那句后面", async () => {
    await 只留参与(甲);
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    await 造活(c, 市场.id);
    await 以(市场, () => 自动分配线索(p, { 项目: true, 原负责人: 市场.id }));
    const [n] = await 通知们(甲.id);
    expect(n.body).toBe(`${市场.name} 点的自动分配，轮到了你。客户上还有原负责人 2 条未完成待办、1 条未完成计划`);
  });

  it("向导自动分配也有", async () => {
    await 只留参与(甲);
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    await 计划(c, 市场.id);
    await 以(市场, () => 向导自动分配(p));
    const [n] = await 通知们(甲.id);
    expect(n.body).toContain("客户上还有原负责人 0 条未完成待办、1 条未完成计划");
  });

  it("N、M 都是 0 不加", async () => {
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    await 待办(c, 市场.id, `某某${收回提醒尾}`);
    await 以(市场, () => 分配线索({ projectId: p, toUserId: 甲.id, line: "内贸" }));
    const [n] = await 通知们(甲.id);
    expect(n.body).toBe("");
  });

  it("不是市场首次分配的不加", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    await 计划(c, 甲.id);
    await 以(总管, () => 分配线索({ projectId: p, toUserId: 乙.id, line: "内贸" }));
    const [n] = await 通知们(乙.id);
    expect(n.body).not.toContain("未完成");
  });

  it("批量：同一客户几条只算一遍，名单后面接一句", async () => {
    await 只留参与(甲);
    const c = await 客户(市场.id);
    const ids = [await 项目(c, 市场.id, { name: "L1" }), await 项目(c, 市场.id, { name: "L2" })];
    await 计划(c, 市场.id);
    await 待办(c, 市场.id);
    await 以(市场, () => 批量自动分配(ids, { 项目: true }));
    const [n, ...多] = await 通知们(甲.id);
    expect(多).toEqual([]);
    expect(n.body).toBe("L1、L2。客户上还有原负责人 1 条未完成待办、1 条未完成计划");
  });
});

describe("决定二：批量自动分配按客户算一份", () => {
  const 记录们 = async () => (await prisma.entLeadAssign.findMany({ select: { projectId: true, toUserId: true, counted: true } }));

  it("C 三条 + D 一条，两个销售：C 全归一人，D 归另一人，额度 1:1", async () => {
    await 只留参与(甲, 乙);
    const C = await 客户(市场.id);
    const D = await 客户(市场.id);
    const [L1, L2, L3] = [await 项目(C, 市场.id), await 项目(C, 市场.id), await 项目(C, 市场.id)];
    const L4 = await 项目(D, 市场.id);
    const t = await 待办(C, 市场.id);
    const pl = await 计划(C, 市场.id);

    const r = await 以(市场, () => 批量自动分配([L1, L2, L3, L4], { 项目: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const A = (await 项目of(L1)).ownerId;
    const B = (await 项目of(L4)).ownerId;
    expect(new Set([A, B])).toEqual(new Set([甲.id, 乙.id]));
    for (const L of [L1, L2, L3]) expect((await 项目of(L)).ownerId).toBe(A);
    expect(await 客户负责人(C)).toBe(A);
    expect(await 客户负责人(D)).toBe(B);
    // 结果行
    expect(r.结果.map((x) => x.ok)).toEqual([true, true, true, true]);
    expect(r.结果.map((x) => (x.ok ? (x.随客户 ?? false) : null))).toEqual([false, true, true, false]);
    const A名 = A === 甲.id ? 甲.name : 乙.name;
    for (const x of r.结果.slice(1, 3)) expect(x).toMatchObject({ ok: true, toUserId: A, 接手人: A名 });
    // 额度：每个客户一条
    expect(await 本月已分(甲.id)).toBe(1);
    expect(await 本月已分(乙.id)).toBe(1);
    expect((await 记录们()).map((x) => x.projectId).sort()).toEqual([L1, L4].sort());
    // 决定一照样成立
    await 活还在(t, pl, 市场.id);
  });

  it("待分配变体：L2、L3 带待分配标记也不再被分走", async () => {
    await 只留参与(甲, 乙);
    const C = await 客户(市场.id);
    const D = await 客户(市场.id);
    const at = new Date();
    const [L1, L2, L3] = [await 项目(C, 市场.id, { awaitAssignAt: at }), await 项目(C, 市场.id, { awaitAssignAt: at }), await 项目(C, 市场.id, { awaitAssignAt: at })];
    const L4 = await 项目(D, 市场.id, { awaitAssignAt: at });
    const r = await 以(市场, () => 批量自动分配([L1, L2, L3, L4], { 项目: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const A = (await 项目of(L1)).ownerId;
    for (const L of [L1, L2, L3]) expect(await 项目of(L)).toMatchObject({ ownerId: A, awaitAssignAt: null });
    expect((await 项目of(L4)).ownerId).not.toBe(A);
    expect(r.结果.map((x) => (x.ok ? (x.随客户 ?? false) : null))).toEqual([false, true, true, false]);
    expect(await 本月已分(甲.id)).toBe(1);
    expect(await 本月已分(乙.id)).toBe(1);
  });

  it("只有一个销售：后面几条不报「留在原处」，写已随客户", async () => {
    await 只留参与(甲);
    const C = await 客户(市场.id);
    const [L1, L2] = [await 项目(C, 市场.id), await 项目(C, 市场.id)];
    const r = await 以(市场, () => 批量自动分配([L1, L2], { 项目: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.结果[1]).toMatchObject({ ok: true, toUserId: 甲.id, 接手人: 甲.name, 随客户: true });
    expect(JSON.stringify(r.结果)).not.toContain("留在原处");
    expect(await 记录们()).toHaveLength(1);
  });

  it("重读落空：后面那条已经结束了，还是报原来的错，不算随客户", async () => {
    await 只留参与(甲, 乙);
    const C = await 客户(市场.id);
    const L1 = await 项目(C, 市场.id);
    const 流失 = await 项目(C, 市场.id, { result: "线索流失" });
    const r = await 以(市场, () => 批量自动分配([L1, 流失], { 项目: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.结果.map((x) => x.ok)).toEqual([true, false]);
  });

  it("客户负责人已是销售：不是转客户，一条条分、各占额度、客户不动", async () => {
    await 只留参与(甲, 乙);
    const C = await 客户(丙.id);
    const [L1, L2] = [await 项目(C, 市场.id), await 项目(C, 市场.id)];
    const r = await 以(总管, () => 批量自动分配([L1, L2], { 项目: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await 客户负责人(C)).toBe(丙.id);
    expect(new Set([(await 项目of(L1)).ownerId, (await 项目of(L2)).ownerId])).toEqual(new Set([甲.id, 乙.id]));
    expect(r.结果.every((x) => x.ok && !x.随客户)).toBe(true);
    expect(await 记录们()).toHaveLength(2);
  });

  it("判无效补名额：随客户那条没有分配记录，判无效照样给现负责人 +1", async () => {
    await 只留参与(甲);
    await prisma.entLeadQuota.create({ data: { userId: 甲.id, quota: 5, setById: 总管.id } });
    const C = await 客户(市场.id);
    const [L1, L2] = [await 项目(C, 市场.id, { node: "线索验证" }), await 项目(C, 市场.id, { node: "线索验证" })];
    await 以(市场, () => 批量自动分配([L1, L2], { 项目: true }));
    expect(await prisma.entLeadAssign.count({ where: { projectId: L2 } })).toBe(0);
    const 甲身份 = { id: 甲.id, role: 甲.role };
    expect((await 销售初判(甲身份, L2, "无效", { invalidReason: "联系方式无效", verifyNote: "打了三次" })).ok).toBe(true);
    expect((await 市场复核({ id: 市场.id, role: 市场.role }, L2, false)).ok).toBe(true);
    expect((await 项目of(L2)).result).toBe("线索流失");
    expect(await 本月加额(甲.id)).toBe(1);
  });
});

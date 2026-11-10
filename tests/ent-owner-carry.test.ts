/**
 * 客户负责人第一批 11-09 两个决定：
 * 一、市场首次分给销售（X-18）时待办、计划不搬、不关（P-转-10）：本人还能勾完成，接手人收到一句提醒；别的转客户入口照旧带活。
 * 二、批量自动分配时同一市场客户下几条线索按客户算一份：后面几条不挑人、不占额度、不写分配记录；客户负责人已是销售的还是一条条分。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
  /** 分前看 之后、事务之前插一手（分项目给 进事务前读组织规则）：模拟这一下客户刚被放进公海 */
  插队: null as null | (() => Promise<void>),
  /** 带走并记下 进事务前读组织时插一手（外层已改完负责人）：模拟这一下客户又被别人改走。返回 true 算插完 */
  读组织前: null as null | (() => Promise<boolean>),
  /** 批量转过了权限闸门之后插一手：模拟另一页这时抢先把客户转走 */
  挡字段前: null as null | (() => Promise<void>),
}));
vi.mock("@/lib/enterprise/field-perm", async (原) => {
  const 真 = await 原<typeof import("@/lib/enterprise/field-perm")>();
  return {
    ...真,
    挡字段: async (...a: Parameters<typeof 真.挡字段>) => {
      const 手 = mocks.挡字段前;
      mocks.挡字段前 = null;
      if (手) await 手();
      return 真.挡字段(...a);
    },
  };
});
vi.mock("@/lib/enterprise/org", async (原) => {
  const 真 = await 原<typeof import("@/lib/enterprise/org")>();
  return {
    ...真,
    权限组织: async () => {
      if (mocks.读组织前 && (await mocks.读组织前())) mocks.读组织前 = null;
      return 真.权限组织();
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/shared-ws/current", async (原) => ({ ...(await 原<object>()), 当前是共享区: async () => false }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/project/org-rules-store", async (原) => {
  const 真 = await 原<typeof import("@/lib/project/org-rules-store")>();
  return {
    ...真,
    生效组织规则: async () => {
      const 手 = mocks.插队;
      mocks.插队 = null;
      if (手) await 手();
      return 真.生效组织规则();
    },
  };
});

import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 分配线索, 自动分配线索, 向导自动分配, 批量自动分配, 项目分配线, 分配带走的项目 } from "@/app/(app)/leads/assign-actions";
import { 自动分配不参与key, 不设配额key, 本月加额, 本月已分, 我分出去的 } from "@/lib/enterprise/lead-assign";
import { assignSalesOwner, patchCustomer, saveCustomer, 撤销改负责人, 转走项目预览of } from "@/app/(app)/customers/actions";
import { 待确认的交接, 确认交接 } from "@/app/(app)/customers/handover-actions";
import { 批量结果说法, 转走项目说法 } from "@/lib/carry-over";
import { 换负责人怎么来的 } from "@/lib/owner-log";
import { 持有数 } from "@/lib/project/db";
import { 读项目列表 } from "@/lib/project/list";
import { toggleTask, completePlan, saveTask, deleteTask, savePlan, deletePlan } from "@/app/(app)/customers/[id]/actions";
import { 交接客户, 交接项目, 交接全部 } from "@/app/(app)/projects/handover/actions";
import { 读离职交接 } from "@/lib/enterprise/offboard-handover";
import { 收回提醒尾, 旧收回提醒尾 } from "@/lib/project/db";
import { 撞号提醒尾 } from "@/lib/enterprise/contact-format";
import { 不能改客户事项话, 没业务角色话 } from "@/lib/enterprise/follow-perm";
import { 只读角色话 } from "@/lib/enterprise/permissions";
import { 销售初判, 市场复核 } from "@/lib/project/lead-verify";
import { 放进公海, 领取, 撤销公海, 分配公海 } from "@/app/(app)/customers/pool-actions";
import { 放回公海, 改项目, 领取公海项目, 公海超时收回 } from "@/lib/project/db";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 公海规则, 客户在公海项目不单领提示, 客户在公海找销管提示, 进公海关待办尾 } from "@/lib/enterprise/pool-rules";
import { 分配公海项目 } from "@/app/(app)/pool/actions";
import { 给客户建项目, 建项目带走的项目 } from "@/app/(app)/customers/[id]/project-actions";
import { 建档向导, type 建档向导输入 } from "@/app/(app)/projects/actions";
/** 11-09 起销售成员默认不能「指定」：这几条钉的是销售指定给同事以后怎么走，先按管理员把「指定」开给销售成员存一份 */
const 指定开给销售成员 = () => setSetting("enterprise.assign_use", { "dict-assign-0": ["marketing_mgr", "sales_mgr", "sales", "channel_ops", "project_ops"] });

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
  mocks.插队 = null;
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
    it(`手动分（${说法}）：还归原负责人；客户、原负责人的项目、公海项目、联系人、进行中的商机照走`, async () => {
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
  it("普通转客户：销售转销售，待办、计划跟新负责人", async () => {
    const c = await 客户(乙.id);
    await 项目(c, 乙.id);
    const t = await 待办(c, 乙.id);
    const pl = await 计划(c, 乙.id);
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
  it("客户在市场手里 = 市场转客户；负责人是销售的不是；客户在公海的：总管理能分（整包，P-公海-10），市场管理拿不到可选", async () => {
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
    expect(await 以(市场, () => 项目分配线(p3))).toBeNull();
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

/** 2 条算数的待办、1 条算数的计划，外加系统提醒和做完的（不算） */
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

describe("决定一 4：分配通知加一句（P-转-17：市场转销售写明「客户也转给你」）", () => {
  const 名of = async (c: string) => (await prisma.customer.findUniqueOrThrow({ where: { id: c } })).name;
  it("手动：写 N、M，系统提醒和做完的不算；只发接手人", async () => {
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    await 造活(c, 市场.id);
    await 待办(c, 乙.id, "同事的不算");
    await 以(市场, () => 分配线索({ projectId: p, toUserId: 甲.id, line: "内贸" }));
    const [n, ...多] = await 通知们(甲.id);
    expect(多).toEqual([]);
    expect(n.body).toBe(`客户「${await 名of(c)}」也转给你。客户上还有原负责人 2 条未完成待办、1 条未完成计划`);
    expect(await 通知们(市场.id)).toEqual([]);
  });

  it("单条自动：接在原来那句后面", async () => {
    await 只留参与(甲);
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    await 造活(c, 市场.id);
    await 以(市场, () => 自动分配线索(p, { 项目: true, 原负责人: 市场.id }));
    const [n] = await 通知们(甲.id);
    expect(n.body).toBe(`${市场.name} 点的自动分配，轮到了你。客户「${await 名of(c)}」也转给你。客户上还有原负责人 2 条未完成待办、1 条未完成计划`);
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

  it("N、M 都是 0 不加那句，客户也转给你照写", async () => {
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    await 待办(c, 市场.id, `某某${收回提醒尾}`);
    await 以(市场, () => 分配线索({ projectId: p, toUserId: 甲.id, line: "内贸" }));
    const [n] = await 通知们(甲.id);
    expect(n.body).toBe(`客户「${await 名of(c)}」也转给你`);
  });

  it("不是市场首次分配的不加", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    await 计划(c, 甲.id);
    await 以(总管, () => 分配线索({ projectId: p, toUserId: 乙.id, line: "内贸" }));
    const [n] = await 通知们(乙.id);
    expect(n.body).not.toContain("未完成");
    expect(n.body).not.toContain("也转给你");
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
    expect(n.body).toBe(`L1、L2。客户「${await 名of(c)}」也转给你。客户上还有原负责人 1 条未完成待办、1 条未完成计划`);
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

  it("判无效补名额：随客户那条没有分配记录、没占过额度，判无效不补", async () => {
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
    expect(await 本月加额(甲.id)).toBe(0);
  });
});

describe("客户公海里的项目不能单独分配（M-公海-06、X-13）", () => {
  const 拦的话 = { ok: false, error: 客户在公海项目不单领提示 };
  const 放进去 = async () => {
    const c = await 客户(甲.id);
    const 们 = [await 项目(c, 甲.id), await 项目(c, 甲.id), await 项目(c, 甲.id)];
    expect(await 以(甲, () => 放进公海([c], "客户主动终止"))).toMatchObject({ ok: true, updated: 1 });
    return { c, 们, 占位: await 客户负责人(c) };
  };
  /** 被拦 = 项目还在公海、没负责人，客户也没人接，没写分配记录 */
  const 没动 = async (c: string, p: string, 占位: string) => {
    expect(await 项目of(p)).toMatchObject({ ownerId: "" });
    expect((await 项目of(p)).pooledAt).not.toBeNull();
    expect(await 客户负责人(c)).toBe(占位);
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(1);
    expect(await prisma.entLeadAssign.count({ where: { projectId: p } })).toBe(0);
  };

  it("P-公海-10 总管理指定分配：整包出公海，客户和名下别的公海项目一起给这位销售", async () => {
    const { c, 们 } = await 放进去();
    expect(await 以(总管, () => 项目分配线(们[0]))).not.toBeNull();
    expect(await 以(总管, () => 分配线索({ projectId: 们[0], toUserId: 乙.id, line: "内贸" }))).toEqual({ ok: true });
    for (const p of 们) expect(await 项目of(p)).toMatchObject({ ownerId: 乙.id, pooledAt: null });
    expect(await 客户负责人(c)).toBe(乙.id);
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(0);
    expect(await prisma.entLeadAssign.count({ where: { projectId: 们[0] } })).toBe(1);
    expect(await prisma.customerOwnerLog.findFirst({ where: { customerId: c, toOwnerId: 乙.id } })).not.toBeNull();
  });

  it("P-公海-10 市场管理指定分配：继续拦，提示找销售管理；弹窗也打不开", async () => {
    const { c, 们, 占位 } = await 放进去();
    expect(await 以(市场, () => 项目分配线(们[0]))).toBeNull();
    expect(await 以(市场, () => 分配线索({ projectId: 们[0], toUserId: 乙.id, line: "内贸" }))).toEqual({ ok: false, error: 客户在公海找销管提示 });
    await 没动(c, 们[0], 占位);
  });

  it("自动分配：拦", async () => {
    await 只留参与(丙);
    const { c, 们, 占位 } = await 放进去();
    expect(await 以(总管, () => 自动分配线索(们[0], { 项目: true }))).toEqual(拦的话);
    await 没动(c, 们[0], 占位);
  });

  it("批量自动分配：被拦的行 ok:false，同批别的客户的线索照分", async () => {
    await 只留参与(丙);
    const { c, 们, 占位 } = await 放进去();
    const 别的客户 = await 客户(甲.id);
    const 正常 = await 项目(别的客户, 甲.id);
    const r = await 以(总管, () => 批量自动分配([们[0], 正常, 们[1]], { 项目: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.结果.map((x) => x.ok)).toEqual([false, true, false]);
    expect(r.结果[0]).toMatchObject(拦的话);
    expect(r.结果[2]).toMatchObject(拦的话);
    await 没动(c, 们[0], 占位);
    await 没动(c, 们[1], 占位);
    expect((await 项目of(正常)).ownerId).toBe(丙.id);
    expect(await 客户负责人(别的客户)).toBe(甲.id);
  });

  it("过了分前看才进公海：市场管理在事务里也拦（线索公海项目，负责人本来就空，乐观锁挡不住）", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    await 项目(c, 甲.id);
    expect((await 以(甲, () => 放回公海({ id: 甲.id, role: 甲.role }, p))).ok).toBe(true);
    mocks.插队 = async () => { await prisma.customerPool.create({ data: { customerId: c, reason: "手动" } }); };
    expect(await 以(市场, () => 分配线索({ projectId: p, toUserId: 乙.id, line: "内贸", 原负责人: null }))).toEqual({ ok: false, error: 客户在公海找销管提示 });
    expect(mocks.插队).toBeNull(); // 确实走到了分前看之后那一步
    expect(await 项目of(p)).toMatchObject({ ownerId: "" });
    expect((await 项目of(p)).pooledAt).not.toBeNull();
    expect(await prisma.entLeadAssign.count({ where: { projectId: p } })).toBe(0);
  });

  it("线索公海（单个项目进公海，客户不在公海）：指定、自动、批量都照分，客户负责人不动", async () => {
    await 只留参与(丙);
    const 造 = async () => {
      const c = await 客户(甲.id);
      const p = await 项目(c, 甲.id);
      await 项目(c, 甲.id); // 名下还有别的项目：客户不跟着进公海
      expect((await 以(甲, () => 放回公海({ id: 甲.id, role: 甲.role }, p))).ok).toBe(true);
      expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(0);
      expect((await 项目of(p)).pooledAt).not.toBeNull();
      return { c, p };
    };
    const a = await 造();
    expect(await 以(总管, () => 分配线索({ projectId: a.p, toUserId: 丙.id, line: "内贸" }))).toEqual({ ok: true });
    expect(await 项目of(a.p)).toMatchObject({ ownerId: 丙.id, pooledAt: null });
    expect(await 客户负责人(a.c)).toBe(甲.id);

    const b = await 造();
    expect(await 以(总管, () => 自动分配线索(b.p, { 项目: true }))).toMatchObject({ ok: true, toUserId: 丙.id });
    expect(await 客户负责人(b.c)).toBe(甲.id);

    const d = await 造();
    const r = await 以(总管, () => 批量自动分配([d.p], { 项目: true }));
    expect(r).toMatchObject({ ok: true, 结果: [{ ok: true, toUserId: 丙.id }] });
    expect(await 客户负责人(d.c)).toBe(甲.id);
  });
});

describe("客户公海里的项目不能经转让单独动（M-公海-06、X-13）", () => {
  const 拦的话 = { ok: false, error: 客户在公海项目不单领提示 };
  const 放进去 = async () => {
    const c = await 客户(甲.id);
    const 们 = [await 项目(c, 甲.id), await 项目(c, 甲.id)];
    expect(await 以(甲, () => 放进公海([c], "客户主动终止"))).toMatchObject({ ok: true, updated: 1 });
    return { c, 们 };
  };
  const 转 = (me: 人, p: string, 给: 人) => 以(me, () => 改项目({ id: me.id, role: me.role }, p, { ownerId: 给.id }));

  it("客户整包进了公海：总管理转让其中一个项目被拒，项目还在公海、没负责人，没留转让痕", async () => {
    const { c, 们: [a, b] } = await 放进去();
    expect(await 转(总管, a, 丙)).toEqual(拦的话);
    for (const p of [a, b]) {
      expect(await 项目of(p)).toMatchObject({ ownerId: "" });
      expect((await 项目of(p)).pooledAt).not.toBeNull();
    }
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(1);
    expect(await prisma.projectNodeLog.count({ where: { projectId: a, kind: "transfer" } })).toBe(0);
  });

  it("客户在公海、项目不在公海还有人负责（老数据）：总管理转给别人也拒", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 乙.id);
    await prisma.customerPool.create({ data: { customerId: c, reason: "手动" } });
    expect(await 转(总管, p, 丙)).toEqual(拦的话);
    expect(await 项目of(p)).toMatchObject({ ownerId: 乙.id, pooledAt: null });
  });

  it("线索公海（客户不在公海）的项目照样能转，出公海；客户不在公海的普通转让不受影响", async () => {
    const c = await 客户(甲.id);
    const 进公海的 = await 项目(c, 甲.id);
    const 普通的 = await 项目(c, 甲.id);
    expect((await 以(甲, () => 放回公海({ id: 甲.id, role: 甲.role }, 进公海的))).ok).toBe(true);
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(0);
    expect(await 转(总管, 进公海的, 丙)).toMatchObject({ ok: true, 变了: ["ownerId"] });
    expect(await 项目of(进公海的)).toMatchObject({ ownerId: 丙.id, pooledAt: null });
    expect(await 转(总管, 普通的, 丙)).toMatchObject({ ok: true, 变了: ["ownerId"] });
    expect(await 客户负责人(c)).toBe(甲.id);
  });

  it("没换负责人的不算转让，不走这条拦截（负责人还是原来的，只传同一个人 = 没变）", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 乙.id);
    await prisma.customerPool.create({ data: { customerId: c, reason: "手动" } });
    expect(await 转(总管, p, 乙)).toEqual({ ok: true, 变了: [] });
  });

  const 老数据 = async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 乙.id);
    await prisma.customerPool.create({ data: { customerId: c, reason: "手动" } });
    return { c, p };
  };

  it("老数据：拦住转让时告诉用户下一步（先到客户公海领取或分配这位客户），不只说不能转", async () => {
    const { p } = await 老数据();
    const r = await 转(总管, p, 丙);
    expect(r.ok).toBe(false);
    const 话 = (r as { error: string }).error;
    expect(话).toMatch(/转/);
    expect(话).toMatch(/先到客户公海领取或分配/);
  });

  it("老数据：按提示先领取客户，客户出公海；别人负责的项目不跟着走（领客户只带公海里的项目），之后能转", async () => {
    const { c, p } = await 老数据();
    expect(await 以(丙, () => 领取([c]))).toMatchObject({ ok: true, updated: 1 });
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(0);
    expect(await 客户负责人(c)).toBe(丙.id);
    expect(await 项目of(p)).toMatchObject({ ownerId: 乙.id, pooledAt: null });
    expect(await 转(总管, p, 丙)).toMatchObject({ ok: true, 变了: ["ownerId"] });
    expect(await 项目of(p)).toMatchObject({ ownerId: 丙.id, pooledAt: null });
  });

  it("老数据：负责人本人改名称、金额不受影响（不换负责人不走拦截），带上同一个负责人也一样", async () => {
    const { c, p } = await 老数据();
    const 改 = (patch: Record<string, unknown>) => 以(乙, () => 改项目({ id: 乙.id, role: 乙.role }, p, patch));
    expect(await 改({ name: "改过的名称", amount: 123 })).toMatchObject({ ok: true });
    expect(await 项目of(p)).toMatchObject({ name: "改过的名称", amount: 123, ownerId: 乙.id, pooledAt: null });
    expect(await 改({ name: "再改一次", ownerId: 乙.id })).toMatchObject({ ok: true });
    expect(await 项目of(p)).toMatchObject({ name: "再改一次", ownerId: 乙.id, pooledAt: null });
    expect(await prisma.projectNodeLog.count({ where: { projectId: p, kind: "transfer" } })).toBe(0);
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(1);
  });

  it("不是企业版不受影响：团队版老规矩照旧", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    忘掉企业版范围();
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    await prisma.customerPool.create({ data: { customerId: c, reason: "手动" } });
    const r = await 转(甲, p, 乙);
    expect(r).not.toEqual(拦的话);
    expect(r.ok).toBe(true);
    expect(await 项目of(p)).toMatchObject({ ownerId: 乙.id });
  });
});

describe("客户页新建项目之前列出会一起转走的项目（P-转-07，X-18 同分配弹窗一个条件）", () => {
  const 开项目模式 = async () => { await setSetting("business", { projectMode: true }); invalidateSettingsCache(); };
  const 建 = (me: 人, customerId: string, 分配方式: number, ownerId: string | null, 业务线 = "内贸") => 以(me, () => 给客户建项目({ customerId, 项目: { name: "页新建", amount: 0, currency: "CNY", ownerId, 分配方式, 业务线 }, 跟进: { type: "PHONE", content: "聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育" } } as Parameters<typeof 给客户建项目>[0]));
  const 看 = (me: 人, customerId: string, 分配方式: number | null, ownerId: string | null, 业务线 = "内贸") => 以(me, () => 建项目带走的项目(customerId, { 分配方式, ownerId, 业务线 }));

  it("指定分配给销售：列出市场自己的，同事在推的只给个数；真建完都到接手人名下（Even 口径）", async () => {
    await 开项目模式();
    const c = await 客户(市场.id);
    const 自己的 = await 项目(c, 市场.id);
    const 同事的 = await 项目(c, 乙.id);
    const r = await 看(市场, c, 0, 甲.id);
    expect(r.项目数).toBe(2);
    expect(r.项目.map((x) => x.负责人)).toEqual([undefined]);
    expect(r.同事).toEqual({ 项目数: 1 });
    expect(await 建(市场, c, 0, 甲.id)).toMatchObject({ ok: true, 转走: true });
    expect((await 项目of(自己的)).ownerId).toBe(甲.id);
    expect((await 项目of(同事的)).ownerId).toBe(甲.id);
    expect(await 客户负责人(c)).toBe(甲.id);
  });

  it("自动分配：还没挑人也列出来；真建完同事在推的项目随客户给挑中的销售", async () => {
    await 开项目模式();
    await 只留参与(甲);
    const c = await 客户(市场.id);
    const 同事的 = await 项目(c, 乙.id);
    const r = await 看(市场, c, 1, null);
    expect(r.项目).toEqual([]);
    expect(r).toMatchObject({ 项目数: 1, 同事: { 项目数: 1 } });
    expect(await 建(市场, c, 1, null)).toMatchObject({ ok: true, 转走: true });
    expect((await 项目of(同事的)).ownerId).toBe(甲.id);
  });

  it("这次不会转客户的不弹：公海捞取、暂不分配、自动但业务线暂不分配、没指定别人", async () => {
    await 开项目模式();
    const c = await 客户(市场.id);
    await 项目(c, 乙.id);
    expect((await 看(市场, c, 2, null)).项目数).toBe(0);
    expect((await 看(市场, c, 3, null)).项目数).toBe(0);
    expect((await 看(市场, c, 1, null, "暂不分配")).项目数).toBe(0);
    expect((await 看(市场, c, 0, 市场.id)).项目数).toBe(0);
    expect((await 看(市场, c, 0, null)).项目数).toBe(0);
  });

  it("不是 X-18 的不弹：客户负责人已是销售、客户在公海、接手人不是销售、名下没有同事的项目", async () => {
    await 开项目模式();
    const 销售的 = await 客户(甲.id);
    await 项目(销售的, 乙.id);
    expect((await 看(总管, 销售的, 0, 丙.id)).项目数).toBe(0);
    const 公海的 = await 客户(市场.id);
    await 项目(公海的, 乙.id);
    await prisma.customerPool.create({ data: { customerId: 公海的, reason: "手动" } });
    expect((await 看(总管, 公海的, 0, 丙.id)).项目数).toBe(0);
    const 给总管 = await 客户(市场.id);
    await 项目(给总管, 乙.id);
    expect((await 看(市场, 给总管, 0, 总管.id)).项目数).toBe(0);
    const 只有自己的 = await 客户(市场.id);
    await 项目(只有自己的, 市场.id);
    expect((await 看(市场, 只有自己的, 0, 甲.id)).项目数).toBe(0);
  });

  it("看不到这位客户的：不泄露项目名，回 0 个", async () => {
    const c = await 客户(市场.id);
    await 项目(c, 乙.id);
    await 开项目模式();
    expect((await 看(丙, c, 0, 甲.id)).项目数).toBe(0);
  });
});

describe("分配前列出会一起转走的项目（P-转-07，只在 X-18 且客户名下有同事项目时）", () => {
  it("市场手里的客户、名下有同事的项目：列出来（除了选中的这条），同事的只给个数；真分完都到接手人名下（Even 口径）", async () => {
    const c = await 客户(市场.id);
    const 选中 = await 项目(c, 市场.id);
    const 自己的 = await 项目(c, 市场.id);
    const 同事的 = await 项目(c, 乙.id);
    const r = await 以(市场, () => 分配带走的项目([选中], 甲.id));
    expect(r.项目数).toBe(2);
    expect(r.项目.map((x) => x.负责人)).toEqual([undefined]);
    expect(r.同事).toEqual({ 项目数: 1 });
    expect(r.项目.map((x) => x.name)).not.toContain((await 项目of(选中)).name);
    expect((await 分配线索({ projectId: 选中, toUserId: 甲.id, kind: "营销", 原负责人: 市场.id })).ok).toBe(true);
    for (const p of [选中, 自己的, 同事的]) expect((await 项目of(p)).ownerId).toBe(甲.id);
  });

  it("名下只有市场自己的、线索公海里的：不是同事项目，不弹", async () => {
    const c = await 客户(市场.id);
    const 选中 = await 项目(c, 市场.id);
    await 项目(c, 市场.id);
    await 项目(c, "", { pooledAt: new Date() });
    expect((await 以(市场, () => 分配带走的项目([选中], 甲.id))).项目数).toBe(0);
  });

  it("不是 X-18 的不弹：客户负责人已是销售、客户在公海、接手人不是销售", async () => {
    const 销售的 = await 客户(甲.id);
    const p1 = await 项目(销售的, 市场.id);
    await 项目(销售的, 乙.id);
    expect((await 以(总管, () => 分配带走的项目([p1], 丙.id))).项目数).toBe(0);

    const 公海的 = await 客户(市场.id);
    const p2 = await 项目(公海的, 市场.id);
    await 项目(公海的, 乙.id);
    await prisma.customerPool.create({ data: { customerId: 公海的, reason: "手动" } });
    expect((await 以(总管, () => 分配带走的项目([p2], 丙.id))).项目数).toBe(0);

    const 市场的 = await 客户(市场.id);
    const p3 = await 项目(市场的, 市场.id);
    await 项目(市场的, 乙.id);
    expect((await 以(总管, () => 分配带走的项目([p3], 总管.id))).项目数).toBe(0);
  });

  it("同事的项目其实归接手人、或就是选中的这条：不算要带走的，不弹", async () => {
    const c = await 客户(市场.id);
    const 选中 = await 项目(c, 市场.id);
    await 项目(c, 甲.id);
    expect((await 以(市场, () => 分配带走的项目([选中], 甲.id))).项目数).toBe(0);

    const d = await 客户(市场.id);
    const 同事的选中 = await 项目(d, 乙.id);
    expect((await 以(市场, () => 分配带走的项目([同事的选中], 甲.id))).项目数).toBe(0);
  });

  it("批量（接手人还没挑）：只算会走 X-18 的客户，暂不分配的不算；同客户的几条只列没选中的", async () => {
    const C = await 客户(市场.id);
    const [L1, L2] = [await 项目(C, 市场.id), await 项目(C, 市场.id)];
    const 同事的 = await 项目(C, 乙.id);
    const 没同事 = await 客户(市场.id);
    const L3 = await 项目(没同事, 市场.id);
    const r = await 以(市场, () => 分配带走的项目([L1, L2, L3]));
    expect(r).toEqual({ 项目数: 1, 项目: [], 同事: { 项目数: 1 } });
    expect(JSON.stringify(r)).not.toContain((await 项目of(同事的)).name);

    const 暂不 = await 客户(市场.id);
    const L4 = await 项目(暂不, 市场.id, { bizLine: "暂不分配" });
    await 项目(暂不, 乙.id);
    expect(await 以(市场, () => 分配带走的项目([L4]))).toEqual({ 项目数: 0, 项目: [] });
    // 同一条，手动指派能分：要问
    expect((await 以(市场, () => 分配带走的项目([L4], 甲.id))).同事?.项目数).toBe(1);
  });

  it("不能分配的人拿不到；不是企业版回 0 个", async () => {
    const c = await 客户(市场.id);
    const 选中 = await 项目(c, 市场.id);
    await 项目(c, 乙.id);
    expect(await 以(甲, () => 分配带走的项目([选中], 丙.id))).toEqual({ 项目数: 0, 项目: [] });
    vi.stubEnv("CRM_ENTERPRISE", "");
    忘掉企业版范围();
    expect(await 以(市场, () => 分配带走的项目([选中], 丙.id))).toEqual({ 项目数: 0, 项目: [] });
  });
});

describe("新建时指定给销售走同一条 X-18（客户页、新客户向导；P-转-03 三处同一条）", () => {
  beforeEach(async () => {
    await setSetting("business", { projectMode: true });
    invalidateSettingsCache();
  });
  const 跟进 = { type: "PHONE", content: "聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false };
  const 页建 = (customerId: string, 项目: Record<string, unknown>) => {
    序号 += 1;
    return 给客户建项目({ customerId, 项目: { name: `页项目${序号}`, amount: 0, currency: "CNY", ownerId: mocks.user.id, 业务线: "内贸", ...项目 }, 跟进 } as Parameters<typeof 给客户建项目>[0]);
  };
  const 向导 = async (项目: Record<string, unknown>) => {
    序号 += 1;
    const 渠 = await prisma.channel.create({ data: { name: `渠道${序号}`, channelOwnerId: 总管.id } });
    return 建档向导({
      客户: { name: `向导客户${序号}`, phone: `1391${String(序号).padStart(7, "0")}`, school: null, grade: null, major: null, followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null, salesOwnerId: 项目.ownerId ?? mocks.user.id, channelId: 渠.id, referrerCustomerId: null },
      联系人: { name: "王联系", position: "采购", phone: "" },
      项目: { name: `向导项目${序号}`, amount: 0, currency: "CNY", ownerId: mocks.user.id, 业务线: "内贸", ...项目 },
      跟进,
    } as 建档向导输入);
  };

  for (const 口 of ["指定", "自动"] as const) {
    it(`客户页·${口}分配：市场的客户转给销售，名下别的项目跟走，待办计划留在市场；两条结果一样`, async () => {
      await 只留参与(甲);
      const c = await 客户(市场.id);
      const 老项目 = await 项目(c, 市场.id);
      const 待分配的 = await 项目(c, 市场.id, { awaitAssignAt: new Date() });
      const 公海的 = await 项目(c, 市场.id, { pooledAt: new Date() });
      const t = await 待办(c, 市场.id);
      const pl = await 计划(c, 市场.id);
      const r = await 以(市场, () => 页建(c, 口 === "指定" ? { 分配方式: 0, ownerId: 甲.id } : { 分配方式: 1 }));
      // 市场转走后这位客户就看不到了：弹窗要离开客户页，留着刷新是 404
      expect(r).toMatchObject({ ok: true, 转走: true, 看不到客户了: true });
      if (!r.ok) return;
      expect(await 客户负责人(c)).toBe(甲.id);
      expect((await 项目of(r.projectId)).ownerId).toBe(甲.id);
      expect(await 项目of(老项目)).toMatchObject({ ownerId: 甲.id, assignMode: `${口}分配` });
      expect(await 项目of(待分配的)).toMatchObject({ ownerId: 甲.id, awaitAssignAt: null });
      expect(await 项目of(公海的)).toMatchObject({ ownerId: 甲.id, pooledAt: null });
      await 活还在(t, pl, 市场.id);
      expect(await prisma.customerOwnerLog.findMany({ where: { customerId: c }, select: { fromOwnerId: true, toOwnerId: true } })).toEqual([{ fromOwnerId: 市场.id, toOwnerId: 甲.id }]);
      // 随客户走的不写分配记录；指定建的这条本来也不写（自动分配占额度那条才写一行）
      expect(await prisma.entLeadAssign.count({ where: { projectId: { in: [老项目, 待分配的, 公海的] } } })).toBe(0);
      expect(await prisma.entLeadAssign.count({ where: { projectId: r.projectId } })).toBe(口 === "指定" ? 0 : 1);
    });
  }

  it("客户页·市场指定给市场管理自己 / 总管理给销售 / 销售给同事：客户负责人都不动（P-转-03）", async () => {
    await 指定开给销售成员();
    const 市的 = await 客户(市场.id);
    expect(await 以(市场, () => 页建(市的, { 分配方式: 0, ownerId: 市场.id }))).toMatchObject({ ok: true });
    expect(await 客户负责人(市的)).toBe(市场.id);

    const 销的 = await 客户(甲.id);
    const 带着 = await 项目(销的, 甲.id);
    const r = await 以(甲, () => 页建(销的, { 分配方式: 0, ownerId: 乙.id }));
    expect(r).toMatchObject({ ok: true });
    expect(await 客户负责人(销的)).toBe(甲.id);
    expect((await 项目of(带着)).ownerId).toBe(甲.id);

    const 总管的 = await 客户(总管.id);
    expect(await 以(总管, () => 页建(总管的, { 分配方式: 0, ownerId: 乙.id }))).toMatchObject({ ok: true });
    expect(await 客户负责人(总管的)).toBe(总管.id);

    // 总管理给市场客户指定销售：客户在市场手里、接手人是销售，同样是 X-18
    const 又市的 = await 客户(市场.id);
    expect(await 以(总管, () => 页建(又市的, { 分配方式: 0, ownerId: 乙.id }))).toMatchObject({ ok: true, 转走: true });
    expect(await 客户负责人(又市的)).toBe(乙.id);
  });

  it("客户页·没带分配方式、负责人选了销售（老弹窗）：一样走 X-18", async () => {
    const c = await 客户(市场.id);
    const r = await 以(市场, () => 页建(c, { ownerId: 甲.id }));
    expect(r).toMatchObject({ ok: true, 转走: true });
    expect(await 客户负责人(c)).toBe(甲.id);
  });

  it("新客户向导：市场指定给销售，客户归销售并留一行换负责人记录；销售 / 总管理指定给别人，客户留在建的人名下", async () => {
    await 指定开给销售成员();
    const r市 = await 以(市场, () => 向导({ 分配方式: 0, ownerId: 甲.id }));
    expect(r市).toMatchObject({ ok: true, 转走: true });
    if (!r市.ok) return;
    expect(await 客户负责人(r市.customerId)).toBe(甲.id);
    expect(await prisma.customerOwnerLog.findMany({ where: { customerId: r市.customerId }, select: { fromOwnerId: true, toOwnerId: true } })).toEqual([{ fromOwnerId: 市场.id, toOwnerId: 甲.id }]);
    expect(await prisma.entLeadAssign.count({ where: { projectId: r市.projectId } })).toBe(0);

    for (const [谁, 给] of [[甲, 乙], [总管, 乙]] as const) {
      const r = await 以(谁, () => 向导({ 分配方式: 0, ownerId: 给.id }));
      expect(r).toMatchObject({ ok: true, 转走: true });
      if (!r.ok) return;
      expect(await 客户负责人(r.customerId)).toBe(谁.id);
      expect((await 项目of(r.projectId)).ownerId).toBe(给.id);
    }
  });
});

describe("「我分出去的」显示随客户走的项目（标「随客户」，不占额度，不写分配行）", () => {
  const 行of = async (u: 人, p: string) => (await 以(u, () => 我分出去的(u.id))).find((x) => x.projectId === p);

  it("批量自动分配：本批随客户走的那条也在，标随客户；不写分配行、不占额度", async () => {
    await 只留参与(甲);
    const c = await 客户(市场.id);
    const [p, p2] = [await 项目(c, 市场.id), await 项目(c, 市场.id)];
    await 以(市场, () => 批量自动分配([p, p2], { 项目: true }));
    const 们 = await 以(市场, () => 我分出去的(市场.id));
    expect(们.map((x) => x.projectId).sort()).toEqual([p, p2].sort());
    expect(们.find((x) => x.projectId === p)?.随客户).toBeUndefined();
    expect(们.find((x) => x.projectId === p2)).toMatchObject({ 随客户: true, 接手人: 甲.name, 当前负责人: 甲.name });
    expect(await prisma.entLeadAssign.count({ where: { projectId: p2 } })).toBe(0);
    expect(await 本月已分(甲.id)).toBe(1);
  });

  it("单点分配带走的：商机阶段的、线索公海里的都在；状态跟现在走", async () => {
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    const 商机的 = await 项目(c, 市场.id, { phase: "商机", node: "方案报价" });
    const 公海的 = await 项目(c, 市场.id, { pooledAt: new Date() });
    await prisma.projectNodeLog.create({ data: { projectId: 公海的, userId: 市场.id, kind: "pool-release", fromOwnerId: 市场.id, toOwnerId: null, toPhase: "线索", toNode: "潜客培育" } });
    expect(await 以(市场, () => 分配线索({ projectId: p, toUserId: 甲.id }))).toMatchObject({ ok: true });
    expect(await 行of(市场, 商机的)).toMatchObject({ 随客户: true, 接手人: 甲.name, status: "商机 · 方案报价" });
    expect(await 行of(市场, 公海的)).toMatchObject({ 随客户: true, 接手人: 甲.name, 当前负责人: 甲.name });
    expect(await prisma.entLeadAssign.count({ where: { projectId: { in: [商机的, 公海的] } } })).toBe(0);
  });

  it("点分配的人和原项目负责人都看得到（同事待分配的随客户走）；接手人和不相干的人看不到", async () => {
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    const 同事的 = await 项目(c, 丙.id, { awaitAssignAt: new Date(), phase: "线索" });
    expect(await 以(总管, () => 分配线索({ projectId: p, toUserId: 甲.id }))).toMatchObject({ ok: true });
    expect(await 行of(总管, 同事的)).toMatchObject({ 随客户: true });
    expect(await 行of(丙, 同事的)).toMatchObject({ 随客户: true });
    expect(await 行of(甲, 同事的)).toBeUndefined();
    expect(await 行of(乙, 同事的)).toBeUndefined();
  });

  it("客户页指定分配带走的同样显示", async () => {
    await setSetting("business", { projectMode: true });
    invalidateSettingsCache();
    const c = await 客户(市场.id);
    const 老项目 = await 项目(c, 市场.id);
    const r = await 以(市场, () => 给客户建项目({ customerId: c, 项目: { name: "页新建", amount: 0, currency: "CNY", ownerId: 甲.id, 分配方式: 0, 业务线: "内贸" }, 跟进: { type: "PHONE", content: "聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false } } as Parameters<typeof 给客户建项目>[0]));
    expect(r).toMatchObject({ ok: true, 转走: true });
    expect(await 行of(市场, 老项目)).toMatchObject({ 随客户: true, 接手人: 甲.name });
  });

  it("后来又被我单独分出去：只留最近一次，那一次是分配行，不再标随客户", async () => {
    await 只留参与(甲);
    const c = await 客户(市场.id);
    const [p, p2] = [await 项目(c, 市场.id), await 项目(c, 市场.id)];
    await 以(市场, () => 批量自动分配([p, p2], { 项目: true }));
    await 只留参与(乙);
    const 再分 = await 以(市场, () => 批量自动分配([p2], { 项目: true }));
    expect(再分).toMatchObject({ ok: true, 结果: [{ ok: true, toUserId: 乙.id }] });
    const 们 = (await 以(市场, () => 我分出去的(市场.id))).filter((x) => x.projectId === p2);
    expect(们).toHaveLength(1);
    expect(们[0].随客户).toBeUndefined();
    expect(们[0].接手人).toBe(乙.name);
  });

  it("先单独分过、后来又随客户走：只留最近一次，标随客户，接手人是后来这位", async () => {
    const c = await 客户(市场.id);
    const q = await 项目(c, 市场.id);
    expect(await 以(市场, () => 分配线索({ projectId: q, toUserId: 甲.id }))).toMatchObject({ ok: true });
    // 客户转回市场（带原负责人甲的项目），市场再新分一条给乙：q 这回是随客户走的
    expect(await 以(总管, () => assignSalesOwner([c], 市场.id))).toMatchObject({ ok: true });
    const q2 = await 项目(c, 市场.id);
    await new Promise((r) => setTimeout(r, 5));
    expect(await 以(市场, () => 分配线索({ projectId: q2, toUserId: 乙.id }))).toMatchObject({ ok: true });
    const 们 = (await 以(市场, () => 我分出去的(市场.id))).filter((x) => x.projectId === q);
    expect(们).toHaveLength(1);
    expect(们[0]).toMatchObject({ 随客户: true, 接手人: 乙.name });
  });

  it("普通转客户（改客户负责人）带走的项目不算：不是分配", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    expect(await 以(总管, () => assignSalesOwner([c], 乙.id))).toMatchObject({ ok: true });
    expect((await 项目of(p)).ownerId).toBe(乙.id);
    expect(await 行of(甲, p)).toBeUndefined();
    expect(await 行of(总管, p)).toBeUndefined();
  });
});

describe("放回一个项目，只动这个项目的待办（P-公海-02，四审 A1）", () => {
  /** 客户归甲，丙负责「一号」「二号」，名下待办三条 */
  const 底子 = async () => {
    const c = await 客户(甲.id);
    const 一号 = await 项目(c, 丙.id, { name: "一号" });
    const 二号 = await 项目(c, 丙.id, { name: "二号" });
    return {
      c, 一号, 二号,
      一号的: await 待办(c, 丙.id, "跟进「一号」"),
      二号的: await 待办(c, 丙.id, "跟进「二号」"),
      别的事: await 待办(c, 丙.id, "别的事"),
    };
  };
  const 开着的 = (id: string, ownerId: string, title: string) => expect(待办of(id)).resolves.toMatchObject({ ownerId, title, done: false, doneAt: null });
  const 关着的 = (id: string, ownerId: string, title: string) => expect(待办of(id)).resolves.toMatchObject({ ownerId, title: `${title}${进公海关待办尾}`, done: true });

  it("不是客户负责人、还管着别的项目：放回只关这个项目的，别的项目和没点名的留给他", async () => {
    const { 一号, 一号的, 二号的, 别的事 } = await 底子();
    expect(await 以(丙, () => 放回公海(丙, 一号))).toEqual({ ok: true });
    await 关着的(一号的, 丙.id, "跟进「一号」");
    await 开着的(二号的, 丙.id, "跟进「二号」");
    await 开着的(别的事, 丙.id, "别的事");
  });

  it("接着领：领的人只带走这个项目的，留痕也只数这一条；「二号」还归丙", async () => {
    const { 一号, 二号, 一号的, 二号的, 别的事 } = await 底子();
    await 以(丙, () => 放回公海(丙, 一号));
    expect(await 以(乙, () => 领取公海项目(乙, 一号, true))).toEqual({ ok: true });
    await 开着的(一号的, 乙.id, "跟进「一号」");
    await 开着的(二号的, 丙.id, "跟进「二号」");
    await 开着的(别的事, 丙.id, "别的事");
    expect((await 项目of(二号)).ownerId).toBe(丙.id);
    const 痕 = await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: 一号, kind: "pool-claim" } });
    expect(痕.reason).toContain("带过来 1 条");
  });

  it("先后放回两个：各关各的；放最后一个才关没点名的，各自的领取人各带各的", async () => {
    const { 一号, 二号, 一号的, 二号的, 别的事 } = await 底子();
    await 以(丙, () => 放回公海(丙, 一号));
    await 以(丙, () => 放回公海(丙, 二号));
    await 关着的(二号的, 丙.id, "跟进「二号」");
    await 关着的(别的事, 丙.id, "别的事");
    await 以(乙, () => 领取公海项目(乙, 一号, true));
    await 开着的(一号的, 乙.id, "跟进「一号」");
    await 关着的(二号的, 丙.id, "跟进「二号」");
    await 关着的(别的事, 丙.id, "别的事");
    await 以(甲, () => 领取公海项目(甲, 二号, true));
    await 开着的(二号的, 甲.id, "跟进「二号」");
    await 开着的(别的事, 甲.id, "别的事");
  });

  it("超时回收一次收走两个（同一刻）：领一号的不带走点名二号的；二号的留给领二号的人", async () => {
    const 今 = new Date("2026-10-26T10:00:00+08:00");
    await setSetting("orgRules", { ...默认组织规则, 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 3 } } });
    invalidateSettingsCache();
    const { c, 一号, 二号, 一号的, 二号的 } = await 底子();
    await prisma.project.updateMany({ where: { customerId: c }, data: { createdAt: new Date(今.getTime() - 10 * 86400_000) } });
    expect(await 以(丙, () => 公海超时收回(丙, 今))).toBe(2);
    await 关着的(一号的, 丙.id, "跟进「一号」");
    await 关着的(二号的, 丙.id, "跟进「二号」");
    await 以(乙, () => 领取公海项目(乙, 一号, true));
    await 开着的(一号的, 乙.id, "跟进「一号」");
    await 关着的(二号的, 丙.id, "跟进「二号」");
    await 以(甲, () => 领取公海项目(甲, 二号, true));
    await 开着的(二号的, 甲.id, "跟进「二号」");
  });

  it("超时同刻：标题同时点了两个项目的，第一个领的人带走，后面领的不再动；点的项目都没领走之前不归别的项目", async () => {
    const 今 = new Date("2026-10-26T10:00:00+08:00");
    await setSetting("orgRules", { ...默认组织规则, 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 3 } } });
    invalidateSettingsCache();
    const c = await 客户(甲.id);
    const 一号 = await 项目(c, 丙.id, { name: "一号" });
    const 二号 = await 项目(c, 丙.id, { name: "二号" });
    const 三号 = await 项目(c, 丙.id, { name: "三号" });
    const 两个都点 = "一起跟进「一号」「二号」";
    const 点两个 = await 待办(c, 丙.id, 两个都点);
    await prisma.project.updateMany({ where: { customerId: c }, data: { createdAt: new Date(今.getTime() - 10 * 86400_000) } });
    expect(await 以(丙, () => 公海超时收回(丙, 今))).toBe(3);
    await 关着的(点两个, 丙.id, 两个都点);
    await 以(乙, () => 领取公海项目(乙, 三号, true));
    await 关着的(点两个, 丙.id, 两个都点);
    await 以(乙, () => 领取公海项目(乙, 一号, true));
    await 开着的(点两个, 乙.id, 两个都点);
    await 以(甲, () => 领取公海项目(甲, 二号, true));
    await 开着的(点两个, 乙.id, 两个都点);
  });

  it("不是客户负责人、这是他最后一个项目：照旧全关，领的人全部接走", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 丙.id, { name: "一号" });
    const 点名 = await 待办(c, 丙.id, "跟进「一号」");
    const 没点名 = await 待办(c, 丙.id, "别的事");
    await 以(丙, () => 放回公海(丙, p));
    await 关着的(点名, 丙.id, "跟进「一号」");
    await 关着的(没点名, 丙.id, "别的事");
    await 以(乙, () => 领取公海项目(乙, p, true));
    await 开着的(点名, 乙.id, "跟进「一号」");
    await 开着的(没点名, 乙.id, "别的事");
  });

  it("判断只在放回时算：放回后他又接了别的项目，领的人带回的还是当时关掉的那一批", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 丙.id, { name: "一号" });
    const 没点名 = await 待办(c, 丙.id, "别的事");
    await 以(丙, () => 放回公海(丙, p));
    await 项目(c, 丙.id, { name: "二号" });
    await 以(乙, () => 领取公海项目(乙, p, true));
    await 开着的(没点名, 乙.id, "别的事");
  });

  it("他别的项目已经结束了，不算还管着：照旧全关", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 丙.id, { name: "一号" });
    await 项目(c, 丙.id, { name: "二号", result: "丢单" });
    const 没点名 = await 待办(c, 丙.id, "别的事");
    await 以(丙, () => 放回公海(丙, p));
    await 关着的(没点名, 丙.id, "别的事");
  });

  it("客户负责人本人放回：只关点名这个项目的（没变）", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id, { name: "一号" });
    await 项目(c, 甲.id, { name: "二号" });
    const 点名 = await 待办(c, 甲.id, "跟进「一号」");
    const 没点名 = await 待办(c, 甲.id, "别的事");
    await 以(甲, () => 放回公海(甲, p));
    await 关着的(点名, 甲.id, "跟进「一号」");
    await 开着的(没点名, 甲.id, "别的事");
  });

  it("客户负责人最后一个项目放回（客户不跟进公海）：客户还归他，只关点名的（没变）", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id, { name: "一号" });
    const 点名 = await 待办(c, 甲.id, "跟进「一号」");
    const 没点名 = await 待办(c, 甲.id, "别的事");
    await 以(甲, () => 放回公海(甲, p));
    await 关着的(点名, 甲.id, "跟进「一号」");
    await 开着的(没点名, 甲.id, "别的事");
  });

  describe("客户整包进公海（没变）", () => {
    /** 甲两个在推项目 + 一个已结束的，名下四条待办，其中一条点名已结束的那个 */
    const 整包 = async () => {
      const c = await 客户(甲.id);
      await 项目(c, 甲.id, { name: "一号" });
      await 项目(c, 甲.id, { name: "二号" });
      await 项目(c, 甲.id, { name: "结束的", result: "丢单" });
      const 们 = [
        [await 待办(c, 甲.id, "跟进「一号」"), "跟进「一号」"],
        [await 待办(c, 甲.id, "跟进「二号」"), "跟进「二号」"],
        [await 待办(c, 甲.id, "跟进「结束的」"), "跟进「结束的」"],
        [await 待办(c, 甲.id, "别的事"), "别的事"],
      ] as const;
      const 放 = await 以(甲, () => 放进公海([c], "客户主动终止"));
      expect(放).toMatchObject({ ok: true, updated: 1 });
      for (const [id, title] of 们) await 关着的(id, 甲.id, title);
      return { c, 们, 放 };
    };

    it("全关，且同一刻；领客户的人全部接走", async () => {
      const { c, 们 } = await 整包();
      const 刻 = await prisma.task.findMany({ where: { customerId: c, ownerId: 甲.id }, select: { doneAt: true } });
      expect(new Set(刻.map((t) => t.doneAt?.getTime())).size).toBe(1);
      expect(await 以(丙, () => 领取([c], true))).toMatchObject({ ok: true, updated: 1 });
      for (const [id, title] of 们) await 开着的(id, 丙.id, title);
    });

    it("标题同时点了两个项目的：领客户的人照样接走", async () => {
      const c = await 客户(甲.id);
      await 项目(c, 甲.id, { name: "一号" });
      await 项目(c, 甲.id, { name: "二号" });
      const 两个都点 = "一起跟进「一号」「二号」";
      const 点两个 = await 待办(c, 甲.id, 两个都点);
      expect(await 以(甲, () => 放进公海([c], "客户主动终止"))).toMatchObject({ ok: true, updated: 1 });
      await 关着的(点两个, 甲.id, 两个都点);
      expect(await 以(丙, () => 领取([c], true))).toMatchObject({ ok: true, updated: 1 });
      await 开着的(点两个, 丙.id, 两个都点);
    });

    it("撤销：全部还给原负责人", async () => {
      const { c, 们, 放 } = await 整包();
      const 公海项目 = (放 as { 公海项目?: string[] }).公海项目;
      expect(公海项目).toHaveLength(2);
      expect(await 以(甲, () => 撤销公海("放进", [{ id: c, 值: 甲.id }], undefined, undefined, 公海项目))).toMatchObject({ ok: true, updated: 1 });
      for (const [id, title] of 们) await 开着的(id, 甲.id, title);
    });
  });
});

/**
 * 四审 A2 / X-45，用户定「不搬」：市场成员在客户层把客户转给销售，结果和项目分配入口一样（P-转-10）。
 * 判定同项目入口（算市场转客户）：看客户负责人和接手人的业务角色，不看谁点的
 */
/**
 * P-转-17 起市场成员的客户分给销售当场转、不走确认；确认交接这条路只剩「一批里混着别人的客户」整批发起。
 * P-转-16（11-10）起批量转同单条：系统管理员、实线上级转别人的直接转，只有负责人本人转自己的走申请；
 * 所以由这几位原负责人的实线上级「销管组长」（不是系统管理员）把这几位连同自己名下一位一起转给接手人，整批走申请，
 * 回这几位那条待确认的交接（按原负责人各一条）。组长当场造、当场挂成原负责人们的上级
 */
const 混批人 = async (): Promise<人> => {
  const 有 = await prisma.user.findUnique({ where: { email: "lead@x" } });
  return 有 ? { id: 有.id, name: 有.name, email: 有.email, role: 有.role, title: "", avatar: null } : 造人("lead", "销管组长", "SALES", "sales_mgr");
};
const 混批走交接 = async (cs: string[], 接手: 人) => {
  const 组长 = await 混批人();
  const 原们 = (await prisma.customer.findMany({ where: { id: { in: cs } }, select: { salesOwnerId: true } })).map((c) => c.salesOwnerId!);
  await prisma.entMember.updateMany({ where: { userId: { in: 原们 } }, data: { managerId: 组长.id } });
  忘掉企业版范围();
  const 陪 = await 客户(组长.id);
  const r = await 以(组长, () => assignSalesOwner([...cs, 陪], 接手.id));
  const h = await prisma.entHandover.findFirstOrThrow({ where: { toUserId: 接手.id, fromUserId: { not: 组长.id }, status: "待确认" }, orderBy: { createdAt: "desc" } });
  return { r, h, 组长 };
};

describe("A2：客户层把市场成员的客户转给销售", () => {
  const 开交接确认 = async () => { await setSetting(规则.交接要确认.key, true); invalidateSettingsCache(); };
  const 列表行 = async (u: 人, p: string) => (await 以(u, () => 读项目列表(u as never, {} as never))).行.find((r: { id: string }) => r.id === p) as { 待分配?: boolean } | undefined;
  /** 市场手里一位客户：一个待分配项目、一个普通项目、一个已选分配方式的，加市场的待办、计划 */
  const 市场客户 = async () => {
    const c = await 客户(市场.id);
    const 等分 = await 项目(c, 市场.id, { awaitAssignAt: new Date(), phase: "线索" });
    const 普通 = await 项目(c, 市场.id, { phase: "线索" });
    const 已选 = await 项目(c, 市场.id, { phase: "线索", assignMode: "公海捞取" });
    return { c, 等分, 普通, 已选, t: await 待办(c, 市场.id), pl: await 计划(c, 市场.id) };
  };
  const 都对 = async (x: Awaited<ReturnType<typeof 市场客户>>, 接手: 人) => {
    expect(await 客户负责人(x.c)).toBe(接手.id);
    await 活还在(x.t, x.pl, 市场.id);
    // 新负责人也看得到留下的待办、计划
    expect((await 以(接手, () => prisma.task.findMany({ where: { customerId: x.c } }))).map((r) => r.id)).toContain(x.t);
    expect((await 以(接手, () => prisma.followPlan.findMany({ where: { customerId: x.c } }))).map((r) => r.id)).toContain(x.pl);
    expect(await 项目of(x.等分)).toMatchObject({ ownerId: 接手.id, awaitAssignAt: null, assignMode: "指定分配" });
    expect(await 项目of(x.普通)).toMatchObject({ ownerId: 接手.id, assignMode: "指定分配" });
    expect(await 项目of(x.已选)).toMatchObject({ ownerId: 接手.id, assignMode: "公海捞取" });
    // 三个都算接手人手上的，待分配那个不再漏数
    expect(await 持有数(prisma, 接手.id)).toBe(3);
    expect((await 列表行(接手, x.等分))?.待分配).toBeUndefined();
    expect(await 列表行(接手, x.等分)).toBeDefined();
  };

  it("批量转（没开交接确认）：不搬不关、清待分配、补分配方式、计入持有", async () => {
    const x = await 市场客户();
    expect(await 持有数(prisma, 甲.id)).toBe(0);
    expect(await 以(市场, () => assignSalesOwner([x.c], 甲.id))).toMatchObject({ ok: true, updated: 1 });
    await 都对(x, 甲);
  });

  it("开交接确认、市场自己转给销售：不走确认，当场转，结果同上（P-转-17）", async () => {
    await 开交接确认();
    const x = await 市场客户();
    expect(await 以(市场, () => assignSalesOwner([x.c], 甲.id))).toMatchObject({ ok: true, updated: 1 });
    expect(await prisma.entHandover.count()).toBe(0);
    await 都对(x, 甲);
  });

  it("开交接确认、混着销售的客户整批走确认：确认前什么都不动，确认后结果同上；痕的操作人是发起的那位", async () => {
    await 开交接确认();
    const x = await 市场客户();
    const { r, h, 组长 } = await 混批走交接([x.c], 甲);
    expect(r).toMatchObject({ ok: true, 交接中: 2 });
    expect(await 项目of(x.等分)).toMatchObject({ ownerId: 市场.id, assignMode: null });
    expect((await 项目of(x.等分)).awaitAssignAt).not.toBeNull();
    expect(await 以(甲, () => 确认交接(h.id))).toEqual({ ok: true, 客户: 1 });
    await 都对(x, 甲);
    expect((await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: x.普通, kind: "transfer", toOwnerId: 甲.id } })).userId).toBe(组长.id);
  });

  it("判定同项目入口，不看谁点的：总管理转走市场成员的客户也算", async () => {
    const x = await 市场客户();
    expect(await 以(总管, () => assignSalesOwner([x.c], 甲.id))).toMatchObject({ ok: true, updated: 1 });
    await 都对(x, 甲);
  });

  it("客户页改负责人（单字段、整表保存）走同一段", async () => {
    const x = await 市场客户();
    expect(await 以(市场, () => patchCustomer(x.c, "salesOwnerId", 甲.id))).toMatchObject({ ok: true });
    await 都对(x, 甲);

    // 整表保存：要负责人本人且能按负责人编辑，市场管理改不了客户资料；市场角色里渠运能改，用渠运走这条
    const 市场成员 = await 造人("mkt3", "渠运同事", "SALES", "channel_ops");
    const y = await 市场客户();
    await prisma.customer.update({ where: { id: y.c }, data: { salesOwnerId: 市场成员.id } });
    await prisma.project.updateMany({ where: { customerId: y.c }, data: { ownerId: 市场成员.id } });
    await prisma.task.update({ where: { id: y.t }, data: { ownerId: 市场成员.id } });
    await prisma.followPlan.update({ where: { id: y.pl }, data: { ownerId: 市场成员.id } });
    const r = await prisma.customer.findUniqueOrThrow({ where: { id: y.c } });
    const base = { name: r.name, phone: r.phone, school: r.school, grade: r.grade, major: r.major, followStatus: r.followStatus, decisionStatus: r.decisionStatus, expectedSignAt: r.expectedSignAt, remark: r.remark, salesOwnerId: r.salesOwnerId, channelId: r.channelId, referrerCustomerId: r.referrerCustomerId };
    expect(await 以(市场成员, () => saveCustomer({ id: y.c, updatedAt: r.updatedAt.toISOString(), base, ...base, salesOwnerId: 乙.id } as unknown as Parameters<typeof saveCustomer>[0]))).toMatchObject({ ok: true });
    expect(await 客户负责人(y.c)).toBe(乙.id);
    await 活还在(y.t, y.pl, 市场成员.id);
    expect(await 项目of(y.等分)).toMatchObject({ ownerId: 乙.id, awaitAssignAt: null, assignMode: "指定分配" });
  });

  it("一批混着：市场的不搬，销售的照旧带走", async () => {
    const x = await 市场客户();
    const s = await 客户(乙.id);
    const st = await 待办(s, 乙.id);
    const spl = await 计划(s, 乙.id);
    const r = await 以(总管, () => assignSalesOwner([x.c, s], 甲.id));
    expect(r).toMatchObject({ ok: true, updated: 2 });
    await 活还在(x.t, x.pl, 市场.id);
    expect((await 待办of(st)).ownerId).toBe(甲.id);
    expect((await 计划of(spl)).ownerId).toBe(甲.id);
    if (r.ok) expect(r.带走).toMatchObject({ 计划和待办: 2 });
  });

  it("销售转销售（直转、确认交接）：照旧带走，待分配和分配方式不动", async () => {
    for (const 走交接 of [false, true]) {
      if (走交接) await 开交接确认();
      const c = await 客户(乙.id);
      const 等分 = await 项目(c, 乙.id, { awaitAssignAt: new Date(), phase: "线索" });
      const t = await 待办(c, 乙.id);
      const pl = await 计划(c, 乙.id);
      if (走交接) {
        // P-转-16 起总管理批量转直接转，确认交接走混批（乙的上级连同自己名下一位一起转）
        const { h } = await 混批走交接([c], 甲);
        expect(await 以(甲, () => 确认交接(h.id))).toEqual({ ok: true, 客户: 1 });
      } else await 以(总管, () => assignSalesOwner([c], 甲.id));
      expect(await 客户负责人(c)).toBe(甲.id);
      expect((await 待办of(t)).ownerId).toBe(甲.id);
      expect((await 计划of(pl)).ownerId).toBe(甲.id);
      const p = await 项目of(等分);
      expect(p.ownerId).toBe(甲.id);
      expect(p.awaitAssignAt).not.toBeNull();
      expect(p.assignMode).toBeNull();
    }
  });

  it("接手的不是销售（市场转市场管理）：照旧带走", async () => {
    const 市场二 = await 造人("mkt2", "市场二", "SALES", "marketing_mgr");
    const c = await 客户(市场.id);
    const t = await 待办(c, 市场.id);
    await 以(总管, () => assignSalesOwner([c], 市场二.id));
    expect((await 待办of(t)).ownerId).toBe(市场二.id);
  });

  describe("外层改完负责人后，进事务前客户又被别人改走", () => {
    /** 客户一归 接手 就被改给 丙（或放进公海），只插一次 */
    const 被抢走 = (c: string, 接手: 人, 动作: () => Promise<unknown> = () => prisma.customer.update({ where: { id: c }, data: { salesOwnerId: 丙.id } })) => {
      mocks.读组织前 = async () => {
        // 操作人这时已经看不到这位客户了（负责人刚改走），放开范围查和插手
        return 看全部(async () => {
          if ((await 客户负责人(c)) !== 接手.id) return false;
          await 动作();
          return true;
        });
      };
    };
    const 都没动 = async (x: Awaited<ReturnType<typeof 市场客户>>, 主: string | null) => {
      expect(mocks.读组织前).toBeNull();
      if (主) expect(await 客户负责人(x.c)).toBe(主);
      await 活还在(x.t, x.pl, 市场.id);
      for (const p of [x.等分, x.普通]) expect(await 项目of(p)).toMatchObject({ ownerId: 市场.id, assignMode: null });
      expect((await 项目of(x.等分)).awaitAssignAt).not.toBeNull();
      expect(await 持有数(prisma, 甲.id)).toBe(0);
      expect(await prisma.customerOwnerLog.count({ where: { customerId: x.c, toOwnerId: 甲.id } })).toBe(0);
    };
    afterEach(() => { mocks.读组织前 = null; });

    it("批量转：不写回、不清待分配、不进撤销，也不算转成", async () => {
      const x = await 市场客户();
      被抢走(x.c, 甲);
      const r = await 以(市场, () => assignSalesOwner([x.c], 甲.id));
      await 都没动(x, 丙.id);
      expect(r).toMatchObject({ ok: true, updated: 0, 原值: [], 带走: { 没转成: 1 } });
      if (!r.ok) throw new Error(r.error);
      expect(r.带过来).toMatchObject({ 项目: [], 公海项目: [] });
      expect(r.带过来?.清待分配).toBeUndefined();
      // 接手人没收到「分给你」
      expect(await 通知们(甲.id)).toHaveLength(0);
    });

    it("一批里只被抢走一位：另一位照常转，计数只算转成的", async () => {
      const x = await 市场客户();
      const y = await 市场客户();
      被抢走(y.c, 甲);
      const r = await 以(市场, () => assignSalesOwner([x.c, y.c], 甲.id));
      expect(r).toMatchObject({ ok: true, updated: 1, 带走: { 没转成: 1 } });
      if (!r.ok) throw new Error(r.error);
      expect(r.原值?.map((v) => v.id)).toEqual([x.c]);
      expect(await 客户负责人(x.c)).toBe(甲.id);
      expect(await 客户负责人(y.c)).toBe(丙.id);
      expect((await 项目of(x.等分)).awaitAssignAt).toBeNull();
      expect((await 项目of(y.等分)).awaitAssignAt).not.toBeNull();
      // 通知只说转成的这位（单条的标题带客户名）
      const 分配 = (await 通知们(甲.id)).filter((n) => n.kind === "分配");
      expect(分配).toHaveLength(1);
      expect(分配[0].link).toBe(`/customers/${x.c}`);
    });

    it("确认交接：同样不动，接手数不算这位", async () => {
      await 开交接确认();
      const x = await 市场客户();
      const { h } = await 混批走交接([x.c], 甲);
      被抢走(x.c, 甲);
      expect(await 以(甲, () => 确认交接(h.id))).toEqual({ ok: true, 客户: 0 });
      await 都没动(x, 丙.id);
    });

    it("客户页改负责人：不写回、不通知", async () => {
      const x = await 市场客户();
      被抢走(x.c, 甲);
      expect(await 以(市场, () => patchCustomer(x.c, "salesOwnerId", 甲.id))).toMatchObject({ ok: true, 带走: { 没转成: 1 } });
      await 都没动(x, 丙.id);
      expect(await 通知们(甲.id)).toHaveLength(0);
    });

    it("编辑表单改负责人：不写回、不通知", async () => {
      const 市场成员 = await 造人("mkt4", "渠运同事", "SALES", "channel_ops");
      const y = await 市场客户();
      await prisma.customer.update({ where: { id: y.c }, data: { salesOwnerId: 市场成员.id } });
      await prisma.project.updateMany({ where: { customerId: y.c }, data: { ownerId: 市场成员.id } });
      await prisma.task.update({ where: { id: y.t }, data: { ownerId: 市场成员.id } });
      await prisma.followPlan.update({ where: { id: y.pl }, data: { ownerId: 市场成员.id } });
      const r = await prisma.customer.findUniqueOrThrow({ where: { id: y.c } });
    const base = { name: r.name, phone: r.phone, school: r.school, grade: r.grade, major: r.major, followStatus: r.followStatus, decisionStatus: r.decisionStatus, expectedSignAt: r.expectedSignAt, remark: r.remark, salesOwnerId: r.salesOwnerId, channelId: r.channelId, referrerCustomerId: r.referrerCustomerId };
      被抢走(y.c, 乙);
      expect(await 以(市场成员, () => saveCustomer({ id: y.c, updatedAt: r.updatedAt.toISOString(), base, ...base, salesOwnerId: 乙.id } as unknown as Parameters<typeof saveCustomer>[0]))).toMatchObject({ ok: true, 带走: { 没转成: 1 } });
      expect(mocks.读组织前).toBeNull();
      expect(await 客户负责人(y.c)).toBe(丙.id);
      await 活还在(y.t, y.pl, 市场成员.id);
      expect((await 项目of(y.等分)).awaitAssignAt).not.toBeNull();
      expect(await 通知们(乙.id)).toHaveLength(0);
    });

    it("被放进公海：一样不走，不会把活带给接手人", async () => {
      const x = await 市场客户();
      被抢走(x.c, 甲, () => prisma.customer.update({ where: { id: x.c }, data: { salesOwnerId: 总管.id, pool: { create: {} } } }));
      await 以(市场, () => assignSalesOwner([x.c], 甲.id));
      await 都没动(x, null);
    });
  });

  describe("接手确认框的说法（确认说明）", () => {
    const 说明 = async (from: 人, to: 人, kind: string) => {
      await prisma.entHandover.create({ data: { kind, fromUserId: from.id, toUserId: to.id, byUserId: 总管.id, customerIds: "[]" } });
      return (await 以(to, () => 待确认的交接())).等我确认[0].确认说明;
    };
    // 转让：全部项目（含同事在推的）一起转（P-转-07 Even 口径；有项目时写个数，见 ent-transfer-request）；离职交接在职同事在推的不动（P-转-14）
    const 留下话 = "确认后这些客户和名下的联系人、沟通记录、全部项目，都转到你名下；原负责人没做完的待办和计划不转过来，你也能看到。";
    const 带走话 = "确认后这些客户和名下的联系人、沟通记录、全部项目，连同原负责人没做完的待办和计划，都转到你名下。";
    const 离职话 = "确认后这些客户和名下的联系人、沟通记录，连同原负责人自己负责的项目、没做完的待办和计划，都转到你名下；同事负责的项目负责人不变（待分配的一起转给你）。";

    it("市场转给销售：全部项目一起转，待办、计划还归原负责人", async () => {
      expect(await 说明(市场, 甲, "转让")).toBe(留下话);
    });
    it("销售转销售：全部项目和待办、计划一起带走", async () => {
      expect(await 说明(甲, 乙, "转让")).toBe(带走话);
    });
    it("离职交接：市场成员离职也一起带走，在职同事的不动", async () => {
      expect(await 说明(市场, 甲, "离职")).toBe(离职话);
    });
  });

  it("撤销（P-撤销-01 按原样回滚）：负责人、待分配时刻、分配方式都还原，留下的活还在市场手里；已选的分配方式不动", async () => {
    const x = await 市场客户();
    const 原时刻 = (await 项目of(x.等分)).awaitAssignAt!;
    const r = await 以(市场, () => assignSalesOwner([x.c], 甲.id));
    if (!r.ok) throw new Error(r.error);
    // 前端拿到的结果走一趟序列化再传回来
    const 带过来 = JSON.parse(JSON.stringify(r.带过来));
    expect(await 以(市场, () => 撤销改负责人(r.原值 ?? [], 甲.id, 带过来))).toMatchObject({ ok: true, updated: 1 });
    expect(await 客户负责人(x.c)).toBe(市场.id);
    await 活还在(x.t, x.pl, 市场.id);
    const 回来 = await 项目of(x.等分);
    expect(回来).toMatchObject({ ownerId: 市场.id, assignMode: null });
    expect(回来.awaitAssignAt?.getTime()).toBe(原时刻.getTime());
    expect(await 项目of(x.普通)).toMatchObject({ ownerId: 市场.id, assignMode: null });
    expect(await 项目of(x.已选)).toMatchObject({ ownerId: 市场.id, assignMode: "公海捞取" });
    expect(await 持有数(prisma, 甲.id)).toBe(0);
  });
});

describe("两页竞争转同一位客户：慢的一页怎么报", () => {
  const 开交接确认 = async () => { await setSetting(规则.交接要确认.key, true); invalidateSettingsCache(); };
  /** 慢页过了权限闸门，快页这时抢先把客户转走 */
  const 快页转走 = (c: string, 给: 人) => { mocks.挡字段前 = async () => { await 看全部(() => prisma.customer.update({ where: { id: c }, data: { salesOwnerId: 给.id } })); }; };
  afterEach(() => { mocks.挡字段前 = null; });

  it("被转给别人：没转，不说已不存在；客户还归抢先那位", async () => {
    const c = await 客户(市场.id);
    快页转走(c, 甲);
    const r = await 以(市场, () => assignSalesOwner([c], 乙.id));
    expect(r).toMatchObject({ ok: true, updated: 0, unchanged: 0, missing: 0, 没转: 1 });
    expect(await 客户负责人(c)).toBe(甲.id);
    expect(await 通知们(乙.id)).toHaveLength(0);
  });

  it("被转给同一位接手人：同样报没转", async () => {
    const c = await 客户(市场.id);
    快页转走(c, 甲);
    expect(await 以(市场, () => assignSalesOwner([c], 甲.id))).toMatchObject({ ok: true, updated: 0, unchanged: 0, missing: 0, 没转: 1 });
  });

  it("真删了（硬删、进回收站）：还是已不存在，不算没转", async () => {
    const 硬删 = await 客户(市场.id);
    const 软删 = await 客户(市场.id);
    mocks.挡字段前 = async () => {
      await 看全部(async () => {
        await prisma.customer.delete({ where: { id: 硬删 } });
        await prisma.customer.update({ where: { id: 软删 }, data: { deletedAt: new Date() } });
      });
    };
    const r = await 以(市场, () => assignSalesOwner([硬删, 软删], 甲.id));
    expect(r).toMatchObject({ ok: true, updated: 0, unchanged: 0, missing: 2 });
    if (r.ok) expect(r.没转).toBeUndefined();
  });

  it("一批混着：转成的、被转走的、删了的各算各的", async () => {
    const 转成 = await 客户(市场.id);
    const 被转走 = await 客户(市场.id);
    const 删了 = await 客户(市场.id);
    mocks.挡字段前 = async () => {
      await 看全部(async () => {
        await prisma.customer.update({ where: { id: 被转走 }, data: { salesOwnerId: 丙.id } });
        await prisma.customer.delete({ where: { id: 删了 } });
      });
    };
    const r = await 以(市场, () => assignSalesOwner([转成, 被转走, 删了], 甲.id));
    expect(r).toMatchObject({ ok: true, updated: 1, unchanged: 0, missing: 1, 没转: 1 });
    expect(await 客户负责人(转成)).toBe(甲.id);
    expect(await 客户负责人(被转走)).toBe(丙.id);
  });

  it("开着交接确认（P-转-16 起批量转不看这个开关）：慢页同样报没转，不发起交接", async () => {
    await 开交接确认();
    const c = await 客户(市场.id);
    快页转走(c, 甲);
    const r = await 以(市场, () => assignSalesOwner([c], 乙.id));
    expect(r).toMatchObject({ ok: true, updated: 0, missing: 0, 没转: 1 });
    expect(r.ok && r.交接中).toBeFalsy();
    expect(await prisma.entHandover.count()).toBe(0);
  });

  it("开着交接确认（同上，不看开关）、真删了：已不存在", async () => {
    await 开交接确认();
    const c = await 客户(市场.id);
    mocks.挡字段前 = async () => { await 看全部(() => prisma.customer.delete({ where: { id: c } })); };
    const r = await 以(市场, () => assignSalesOwner([c], 乙.id));
    expect(r).toMatchObject({ ok: true, updated: 0, missing: 1 });
    expect(r.ok && r.交接中).toBeFalsy();
    if (r.ok) expect(r.没转).toBeUndefined();
  });

  it("两页不重叠（快页全做完慢页才点）：过不了转让权限，被拦下，客户不动", async () => {
    const c = await 客户(市场.id);
    await 以(市场, () => assignSalesOwner([c], 甲.id));
    expect(await 以(市场, () => assignSalesOwner([c], 乙.id))).toEqual({ ok: false, error: "只能转出自己的或直属下属的客户；别的找系统管理员转" });
    expect(await 客户负责人(c)).toBe(甲.id);
  });

  describe("提示原文（批量分配那条）", () => {
    const 基 = { updated: 0, unchanged: 0, missing: 0 };
    it("被转走", () => {
      expect(批量结果说法({ ...基, 没转: 1 }, "已转给 销售甲某")).toBe("已转给 销售甲某：0 条，1 条刚被别人改了负责人，没转");
    });
    it("真删了", () => {
      expect(批量结果说法({ ...基, missing: 1 }, "已转给 销售甲某")).toBe("已转给 销售甲某：0 条，1 条已不存在（可能已删除）");
    });
    it("外层被转走和进事务后被改走，合成一句", () => {
      expect(批量结果说法({ ...基, updated: 1, 没转: 1, 带走: { 计划和待办: 0, 商机: 0, 没转成: 2 } }, "已转给 销售甲某")).toBe("已转给 销售甲某：1 条，3 条刚被别人改了负责人，没转");
    });
  });
});

describe("市场转销售：客户层三个入口的通知也写条数（P-转-10，口径同项目分配）", () => {
  const 句 = "客户上还有原负责人 2 条未完成待办、1 条未完成计划";
  /** 混批里组长转自己名下那一位：申请移交的说法 */
  const 申请那句 = "你确认后才转到你名下；不确认不生效，客户还在原负责人名下。";
  const 开交接确认 = async () => { await setSetting(规则.交接要确认.key, true); invalidateSettingsCache(); };
  const 分配 = async (u: 人) => (await 通知们(u.id)).filter((n) => n.kind === "分配");
  const 交接 = async (u: 人) => (await 通知们(u.id)).filter((n) => n.kind === "交接");
  const 市场带活 = async () => { const c = await 客户(市场.id); await 造活(c, 市场.id); await 待办(c, 乙.id, "同事的不算"); return c; };
  /** 渠运是市场角色，改得了客户资料：整表保存走这条 */
  const 渠运带活 = async () => {
    const u = await 造人("qy", "渠运同事", "SALES", "channel_ops");
    const c = await 客户(u.id);
    await 造活(c, u.id);
    const r = await prisma.customer.findUniqueOrThrow({ where: { id: c } });
    const base = { name: r.name, phone: r.phone, school: r.school, grade: r.grade, major: r.major, followStatus: r.followStatus, decisionStatus: r.decisionStatus, expectedSignAt: r.expectedSignAt, remark: r.remark, salesOwnerId: r.salesOwnerId, channelId: r.channelId, referrerCustomerId: r.referrerCustomerId };
    return { u, c, r, base };
  };
  const 存 = (x: Awaited<ReturnType<typeof 渠运带活>>, 给: 人, updatedAt: Date) =>
    以(x.u, () => saveCustomer({ id: x.c, updatedAt: updatedAt.toISOString(), base: x.base, ...x.base, salesOwnerId: 给.id } as unknown as Parameters<typeof saveCustomer>[0]));

  it("批量转一位：正文就是这句，只发接手人", async () => {
    const c = await 市场带活();
    await 以(市场, () => assignSalesOwner([c], 甲.id));
    const [n, ...多] = await 分配(甲);
    expect(多).toEqual([]);
    expect(n.body).toBe(句);
    expect(await 分配(市场)).toEqual([]);
  });

  it("批量转几位：名单后面接一句，合起来数", async () => {
    const a = await 市场带活();
    const b = await 市场带活();
    await 以(市场, () => assignSalesOwner([a, b], 甲.id));
    const [n] = await 分配(甲);
    const 名 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).name;
    expect(n.body).toBe(`${await 名(a)}、${await 名(b)}。客户上还有原负责人 4 条未完成待办、2 条未完成计划`);
  });

  it("一批混着销售的客户：销售那位带走了，不算", async () => {
    const a = await 市场带活();
    const b = await 客户(乙.id);
    await 待办(b, 乙.id);
    await 以(总管, () => assignSalesOwner([a, b], 甲.id));
    expect((await 分配(甲))[0].body).toContain(句);
  });

  it("客户页单字段改负责人", async () => {
    const c = await 市场带活();
    await 以(市场, () => patchCustomer(c, "salesOwnerId", 甲.id));
    expect((await 分配(甲))[0].body).toBe(句);
  });

  it("编辑表单改负责人（直接存）", async () => {
    const x = await 渠运带活();
    expect(await 存(x, 甲, x.r.updatedAt)).toMatchObject({ ok: true });
    expect((await 分配(甲))[0].body).toBe(句);
  });

  it("编辑表单改负责人（别人先改了别的字段，合并存）", async () => {
    const x = await 渠运带活();
    await prisma.customer.update({ where: { id: x.c }, data: { remark: "同事先改的" } });
    expect(await 存(x, 甲, x.r.updatedAt)).toMatchObject({ ok: true });
    expect(await 客户负责人(x.c)).toBe(甲.id);
    expect((await 分配(甲))[0].body).toBe(句);
  });

  it("确认交接：接手人发起时那条就写，确认后发起人那条也写（按确认那刻数）", async () => {
    await 开交接确认();
    const c = await 市场带活();
    const { h, 组长 } = await 混批走交接([c], 甲);
    // 陪着的销售客户那条不说；那条是组长转自己名下的，按申请移交写（P-转-16）
    expect((await 交接(甲)).map((n) => n.body).sort()).toEqual([申请那句, `确认之前这些客户还在原负责人名下，确认后才转到你名下。${句}`].sort());
    await 待办(c, 市场.id, "发起后又多一条");
    await 以(甲, () => 确认交接(h.id));
    const 确认那条 = (await 交接(组长)).find((n) => n.title.includes("确认接手"));
    expect(确认那条?.body).toBe("客户上还有原负责人 3 条未完成待办、1 条未完成计划");
    // 原负责人那条只说客户已交出去
    const 原那条 = (await 交接(市场)).find((n) => n.title.includes("已交给"));
    expect(原那条?.body ?? "").toBe("");
  });

  it("都是 0 不加：批量转、确认交接", async () => {
    const c = await 客户(市场.id);
    await 待办(c, 市场.id, `某某${收回提醒尾}`);
    await 以(市场, () => assignSalesOwner([c], 甲.id));
    expect((await 分配(甲))[0].body).toBe("");
    await 开交接确认();
    const d = await 客户(市场.id);
    await 混批走交接([d], 乙);
    expect((await 交接(乙)).map((n) => n.body).sort()).toEqual([申请那句, "确认之前这些客户还在原负责人名下，确认后才转到你名下。"].sort());
  });

  it("销售转销售不加：批量转、改负责人、确认交接", async () => {
    const a = await 客户(乙.id);
    await 造活(a, 乙.id);
    await 以(总管, () => assignSalesOwner([a], 甲.id));
    const b = await 客户(乙.id);
    await 造活(b, 乙.id);
    await 以(总管, () => patchCustomer(b, "salesOwnerId", 甲.id));
    for (const n of await 分配(甲)) expect(n.body).not.toContain("未完成");
    expect(await 分配(甲)).toHaveLength(2);

    await 开交接确认();
    const c = await 客户(乙.id);
    await 造活(c, 乙.id);
    const { h, 组长 } = await 混批走交接([c], 丙);
    await 以(丙, () => 确认交接(h.id));
    for (const n of [...(await 交接(丙)), ...(await 交接(组长)), ...(await 交接(乙))]) expect(n.body).not.toContain("未完成");
  });

  it("接手的不是销售（市场转市场管理）不加", async () => {
    const 市场二 = await 造人("mkt2", "市场二", "SALES", "marketing_mgr");
    const c = await 市场带活();
    await 以(总管, () => assignSalesOwner([c], 市场二.id));
    expect((await 分配(市场二))[0].body).not.toContain("未完成");
  });

  it("离职交接确认不加", async () => {
    const c = await 市场带活();
    const h = await prisma.entHandover.create({ data: { kind: "离职", way: "转交", fromUserId: 市场.id, toUserId: 甲.id, byUserId: 总管.id, customerIds: JSON.stringify([c]), counts: JSON.stringify({ 客户: 1 }) } });
    expect(await 以(甲, () => 确认交接(h.id))).toMatchObject({ ok: true });
    for (const n of await 交接(总管)) expect(n.body).not.toContain("未完成");
  });
});

describe("转客户：名下全部项目（含同事在推的）随客户给接手人（Even 11-08 决策一②，P-转-07；用户 11-10 统一按 Even）", () => {
  const 开项目模式 = async () => { await setSetting("business", { projectMode: true }); invalidateSettingsCache(); };
  const 开交接确认 = async () => { await setSetting(规则.交接要确认.key, true); invalidateSettingsCache(); };
  const 负责人of = async (p: string) => (await 项目of(p)).ownerId;
  const 待分配of = async (p: string) => (await 项目of(p)).awaitAssignAt;
  /** 客户负责人把客户转给甲的四个入口。项目分配要选中一条：选中的是原负责人自己的 */
  const 四入口: [string, (me: 人, c: string, 选中: string, 给: 人) => Promise<unknown>][] = [
    ["项目分配", (me, _c, 选中, 给) => 以(me, () => 分配线索({ projectId: 选中, toUserId: 给.id, line: "内贸" }))],
    ["批量转", (me, c, _选中, 给) => 以(me, () => assignSalesOwner([c], 给.id))],
    ["客户页改负责人", (me, c, _选中, 给) => 以(me, () => patchCustomer(c, "salesOwnerId", 给.id))],
    // P-转-17 起市场自己转给销售不走确认，确认交接只剩混批（P-转-16 起由原负责人的实线上级连同自己名下的一起转）
    ["确认交接", async (_me, c, _选中, 给) => {
      await 开交接确认();
      const { h } = await 混批走交接([c], 给);
      return 以(给, () => 确认交接(h.id));
    }],
  ];

  describe("同事在推的项目一起转", () => {
    it.each(四入口)("%s：自己的、同事在推的都跟客户走，记一笔转让", async (_名, 转) => {
      const c = await 客户(市场.id);
      const 选中 = await 项目(c, 市场.id);
      const 另一个 = await 项目(c, 市场.id);
      const 同事的 = await 项目(c, 乙.id);
      await 转(市场, c, 选中, 甲);
      expect(await 客户负责人(c)).toBe(甲.id);
      expect(await 负责人of(选中)).toBe(甲.id);
      expect(await 负责人of(另一个)).toBe(甲.id);
      expect(await 负责人of(同事的)).toBe(甲.id);
      expect(await prisma.projectNodeLog.count({ where: { projectId: 同事的, kind: "transfer" } })).toBe(1);
    });

    it.each(四入口)("P-转-19 %s：在推项目被带走的同事收到通知（不写待分配），他的待办和计划留在他名下、能勾完成", async (_名, 转) => {
      const c = await 客户(市场.id);
      const 选中 = await 项目(c, 市场.id);
      const 同事的 = await 项目(c, 乙.id);
      const t = await 待办(c, 乙.id);
      const pl = await 计划(c, 乙.id);
      await 转(市场, c, 选中, 甲);
      expect(await 负责人of(同事的)).toBe(甲.id);
      await 活还在(t, pl, 乙.id);
      const 他的 = (await 通知们(乙.id)).filter((n) => n.title.includes("随客户一起给了"));
      expect(他的).toHaveLength(1);
      expect(他的[0].title).toContain("你名下的项目");
      expect(他的[0].title).not.toContain("待分配");
      expect(他的[0].title).toContain((await 项目of(同事的)).name);
      expect(他的[0].body).toContain("待办和计划还在你名下");
      expect(他的[0].body).toContain("勾完成");
      expect((await 通知们(甲.id)).filter((n) => n.title.includes("随客户一起给了"))).toHaveLength(0);
    });

    it("同事的已结束项目不动", async () => {
      const c = await 客户(市场.id);
      const 结束的 = await 项目(c, 乙.id, { result: "流失" });
      await 以(市场, () => assignSalesOwner([c], 甲.id));
      expect(await 负责人of(结束的)).toBe(乙.id);
    });

    it("销售转销售、总管理移交：一样连同事在推的一起带", async () => {
      const a = await 客户(甲.id);
      const 甲的a = await 项目(a, 甲.id);
      const 乙的a = await 项目(a, 乙.id);
      await 以(总管, () => assignSalesOwner([a], 丙.id));
      expect([await 负责人of(甲的a), await 负责人of(乙的a)]).toEqual([丙.id, 丙.id]);
      const b = await 客户(甲.id);
      const 甲的b = await 项目(b, 甲.id);
      const 乙的b = await 项目(b, 乙.id);
      await 以(总管, () => patchCustomer(b, "salesOwnerId", 丙.id));
      expect([await 负责人of(甲的b), await 负责人of(乙的b)]).toEqual([丙.id, 丙.id]);
    });

    it("项目分配选中的是同事负责的：选中那条照分，同客户别的同事在推的也随客户走", async () => {
      const c = await 客户(市场.id);
      const 选中 = await 项目(c, 乙.id);
      const 自己的 = await 项目(c, 市场.id);
      const 别的同事 = await 项目(c, 丙.id);
      // 市场成员看不到同事负责的项目，这一下只有看全部的人点得到
      expect(await 以(总管, () => 分配线索({ projectId: 选中, toUserId: 甲.id, line: "内贸" }))).toEqual({ ok: true });
      expect([await 负责人of(选中), await 负责人of(自己的), await 负责人of(别的同事)]).toEqual([甲.id, 甲.id, 甲.id]);
    });

    it("撤销（市场转销售）：两个项目和客户都回到转之前，同事的还给同事", async () => {
      const c = await 客户(市场.id);
      const 自己的 = await 项目(c, 市场.id);
      const 同事的 = await 项目(c, 乙.id);
      const r = await 以(市场, () => assignSalesOwner([c], 甲.id));
      if (!r.ok) throw new Error(r.error);
      expect(await 负责人of(同事的)).toBe(甲.id);
      expect(await 以(市场, () => 撤销改负责人(r.原值 ?? [], 甲.id, JSON.parse(JSON.stringify(r.带过来))))).toMatchObject({ ok: true, updated: 1 });
      expect(await 客户负责人(c)).toBe(市场.id);
      expect([await 负责人of(自己的), await 负责人of(同事的)]).toEqual([市场.id, 乙.id]);
      expect(await prisma.projectNodeLog.count({ where: { projectId: { in: [自己的, 同事的] }, kind: "transfer" } })).toBe(0);
    });

    it("撤销（销售转销售）：两个项目和客户都回到转之前，同事的还给同事", async () => {
      const c = await 客户(甲.id);
      const 自己的 = await 项目(c, 甲.id);
      const 同事的 = await 项目(c, 乙.id);
      const r = await 以(总管, () => assignSalesOwner([c], 丙.id));
      if (!r.ok) throw new Error(r.error);
      expect(await 负责人of(同事的)).toBe(丙.id);
      expect(await 以(总管, () => 撤销改负责人(r.原值 ?? [], 丙.id, JSON.parse(JSON.stringify(r.带过来))))).toMatchObject({ ok: true, updated: 1 });
      expect(await 客户负责人(c)).toBe(甲.id);
      expect([await 负责人of(自己的), await 负责人of(同事的)]).toEqual([甲.id, 乙.id]);
    });
  });

  describe("转前预览：同事在推的算转走、只给个数（X-49 待定）", () => {
    it("自己的、公海里的列名字，同事的只进「同事」个数；转完的数和预览一致", async () => {
      const c = await 客户(市场.id);
      await 项目(c, 市场.id, { name: "自己的" });
      await 项目(c, 乙.id, { name: "同事的" });
      await 项目(c, "", { name: "公海里的", pooledAt: new Date() });
      const 预 = await 以(市场, () => 转走项目预览of([c], 甲.id));
      expect(预.项目数).toBe(3);
      expect(预.项目.map((x) => [x.name, x.负责人])).toEqual([["自己的", undefined], ["公海里的", "线索公海"]]);
      expect(预.同事).toEqual({ 项目数: 1 });
      expect(JSON.stringify(预)).not.toContain("同事的");
      const r = await 以(市场, () => assignSalesOwner([c], 甲.id));
      expect(r).toMatchObject({ ok: true, 带走: { 项目: 3 } });
    });

    it("只有同事的：只说个数，不列名字", () => {
      const 说 = 转走项目说法({ 项目数: 1, 项目: [], 同事: { 项目数: 1 } });
      expect(说).toEqual({ 标题: "会一起转走的 1 个项目", 行: [], 还有: "", 同事: "有 1 个同事在推的项目，负责人会一起改成新负责人" });
    });

    it("分配弹窗：有同事项目才弹，列转走的、同事的给个数，选中的那条不算", async () => {
      const c = await 客户(市场.id);
      const 选中 = await 项目(c, 市场.id, { name: "选中的" });
      await 项目(c, 市场.id, { name: "另一个" });
      await 项目(c, 乙.id, { name: "同事的" });
      const 预 = await 以(市场, () => 分配带走的项目([选中], 甲.id));
      expect(预).toMatchObject({ 项目数: 2, 项目: [{ name: "另一个" }] });
      expect(预.同事).toEqual({ 项目数: 1 });
    });
  });

  describe("规则 2：同事负责的项目正在待分配，随客户给接手人并清待分配", () => {
    it.each(四入口)("%s：待分配的随客户走、状态清掉；同事在推的也随客户走", async (_名, 转) => {
      const c = await 客户(市场.id);
      const 选中 = await 项目(c, 市场.id);
      const 待分配 = await 项目(c, 乙.id, { awaitAssignAt: new Date() });
      const 同事的 = await 项目(c, 丙.id);
      await 转(市场, c, 选中, 甲);
      expect(await 负责人of(待分配)).toBe(甲.id);
      expect(await 待分配of(待分配)).toBeNull();
      expect(await 负责人of(同事的)).toBe(甲.id);
    });

    it.each(四入口)("P-转-19 %s：这位同事收到通知，写清项目、接手人，他的待办和计划留在他名下、能勾完成", async (_名, 转) => {
      const c = await 客户(市场.id);
      const 选中 = await 项目(c, 市场.id);
      const 待分配 = await 项目(c, 乙.id, { awaitAssignAt: new Date() });
      const t = await 待办(c, 乙.id, "回访");
      await 转(市场, c, 选中, 甲);
      expect(await 负责人of(待分配)).toBe(甲.id);
      expect((await 待办of(t)).ownerId).toBe(乙.id);
      const 他的 = (await 通知们(乙.id)).filter((n) => n.title.includes("待分配"));
      expect(他的).toHaveLength(1);
      expect(他的[0].title).toContain((await 项目of(待分配)).name);
      expect(他的[0].title).toContain(甲.name);
      expect(他的[0].body).toContain("待办和计划还在你名下");
      expect(他的[0].body).toContain("勾完成");
      // 不相干的、接手人不收这一条
      expect((await 通知们(丙.id)).filter((n) => n.title.includes("待分配"))).toHaveLength(0);
      expect((await 通知们(甲.id)).filter((n) => n.title.includes("你名下待分配"))).toHaveLength(0);
    });

    it("P-转-19 停用的同事、点转让的人自己不收", async () => {
      const c = await 客户(甲.id);
      const 自己的 = await 项目(c, 总管.id, { awaitAssignAt: new Date() });
      const 停了 = await 项目(c, 乙.id, { awaitAssignAt: new Date() });
      await prisma.user.update({ where: { id: 乙.id }, data: { active: false } });
      const r = await 以(总管, () => assignSalesOwner([c], 丙.id));
      if (!r.ok) throw new Error(r.error);
      expect(await 负责人of(自己的)).toBe(丙.id);
      expect(await 负责人of(停了)).toBe(丙.id);
      expect((await 通知们(总管.id)).filter((n) => n.title.includes("你名下待分配"))).toHaveLength(0);
      expect((await 通知们(乙.id)).filter((n) => n.title.includes("你名下待分配"))).toHaveLength(0);
    });

    it("销售转销售也一样；撤销后负责人和待分配时刻都还原", async () => {
      const 时刻 = new Date("2026-11-01T08:00:00.000Z");
      const c = await 客户(甲.id);
      const 待分配 = await 项目(c, 乙.id, { awaitAssignAt: 时刻 });
      const r = await 以(总管, () => assignSalesOwner([c], 丙.id));
      if (!r.ok) throw new Error(r.error);
      expect(await 负责人of(待分配)).toBe(丙.id);
      expect(await 待分配of(待分配)).toBeNull();
      await 以(总管, () => 撤销改负责人(r.原值 ?? [], 丙.id, JSON.parse(JSON.stringify(r.带过来))));
      expect(await 负责人of(待分配)).toBe(乙.id);
      expect(await 待分配of(待分配)).toEqual(时刻);
    });

    it("市场转销售撤销：同事待分配的、市场自己的都还原", async () => {
      const 时刻 = new Date("2026-11-01T08:00:00.000Z");
      const c = await 客户(市场.id);
      const 自己的 = await 项目(c, 市场.id);
      const 待分配 = await 项目(c, 乙.id, { awaitAssignAt: 时刻 });
      const r = await 以(市场, () => assignSalesOwner([c], 甲.id));
      if (!r.ok) throw new Error(r.error);
      await 以(市场, () => 撤销改负责人(r.原值 ?? [], 甲.id, JSON.parse(JSON.stringify(r.带过来))));
      expect([await 负责人of(自己的), await 负责人of(待分配)]).toEqual([市场.id, 乙.id]);
      expect(await 待分配of(待分配)).toEqual(时刻);
    });

    it("接手人自己占着的待分配：负责人本来就是他，也清掉，撤销还原", async () => {
      const 时刻 = new Date("2026-11-01T08:00:00.000Z");
      const c = await 客户(甲.id);
      const 他占的 = await 项目(c, 丙.id, { awaitAssignAt: 时刻 });
      const r = await 以(总管, () => assignSalesOwner([c], 丙.id));
      if (!r.ok) throw new Error(r.error);
      expect(await 待分配of(他占的)).toBeNull();
      await 以(总管, () => 撤销改负责人(r.原值 ?? [], 丙.id, JSON.parse(JSON.stringify(r.带过来))));
      expect(await 负责人of(他占的)).toBe(丙.id);
      expect(await 待分配of(他占的)).toEqual(时刻);
    });

    it("预览：待分配的列名字写「待分配」，在推的只算个数", async () => {
      const c = await 客户(市场.id);
      await 项目(c, 乙.id, { name: "待分配的", awaitAssignAt: new Date() });
      await 项目(c, 丙.id, { name: "同事的" });
      const 预 = await 以(市场, () => 转走项目预览of([c], 甲.id));
      expect(预.项目).toEqual([{ name: "待分配的", 客户: expect.any(String), 负责人: "待分配" }]);
      expect(预).toMatchObject({ 项目数: 2, 同事: { 项目数: 1 } });
    });
  });

  describe("规则 1：离职交接在职同事在推的不动（P-转-14，Even 没覆盖），只转离职者自己的和待分配的", () => {
    const 场景 = async () => {
      await 开项目模式();
      const c = await 客户(甲.id);
      const 他的 = await 项目(c, 甲.id);
      const 同事的 = await 项目(c, 乙.id);
      const 待分配 = await 项目(c, 乙.id, { awaitAssignAt: new Date() });
      await prisma.user.update({ where: { id: 甲.id }, data: { active: false } });
      return { c, 他的, 同事的, 待分配 };
    };
    const 查 = async (x: Awaited<ReturnType<typeof 场景>>) => {
      expect(await 客户负责人(x.c)).toBe(丙.id);
      expect(await 负责人of(x.他的)).toBe(丙.id);
      expect(await 负责人of(x.同事的)).toBe(乙.id);
      expect(await 负责人of(x.待分配)).toBe(丙.id);
      expect(await 待分配of(x.待分配)).toBeNull();
    };

    it("交一位客户", async () => {
      const x = await 场景();
      expect(await 以(总管, () => 交接客户(甲.id, x.c, 丙.id))).toMatchObject({ ok: true });
      await 查(x);
    });
    it("全部交给", async () => {
      const x = await 场景();
      expect(await 以(总管, () => 交接全部(甲.id, 丙.id))).toMatchObject({ ok: true });
      await 查(x);
    });
    it("确认离职交接（升级前留下的那笔）", async () => {
      const x = await 场景();
      const h = await prisma.entHandover.create({ data: { kind: "离职", way: "转交", fromUserId: 甲.id, toUserId: 丙.id, byUserId: 总管.id, customerIds: JSON.stringify([x.c]), counts: JSON.stringify({ 客户: 1 }) } });
      await 以(丙, () => 确认交接(h.id));
      await 查(x);
    });
    it("同事待分配项目的卡点认领跟着项目给接手人，在职同事不再挂着", async () => {
      const x = await 场景();
      const 卡 = await prisma.entBlocker.create({ data: { code: "BLK-20261101-901", projectId: x.待分配, customerId: x.c, phase: "线索", type: "中度卡点", impact: "短期不影响", obstacle: "价格", description: "等报价", dueDays: 3, dueAt: new Date(), status: "待接受", creatorId: 乙.id, claims: { create: { userId: 乙.id } } } });
      expect(await 以(总管, () => 交接全部(甲.id, 丙.id))).toMatchObject({ ok: true });
      expect((await prisma.entBlockerClaim.findMany({ where: { blockerId: 卡.id } })).map((o) => o.userId)).toEqual([丙.id]);
    });
    it("看板上这位客户的项目数：只数交出去会走的", async () => {
      const x = await 场景();
      const 们 = await 读离职交接(总管);
      expect(们.find((p) => p.id === 甲.id)?.客户.find((c) => c.id === x.c)?.项目数).toBe(2);
    });
  });

  describe("规则 3：持有上限只算实际转到接手人名下的；直接转客户带的原负责人项目不拦，接同事的待分配项目超了拦（M-公海-18，11-09）", () => {
    const 上限 = async (n: number) => { await setSetting("orgRules", { ...默认组织规则, 公海: { ...默认组织规则.公海, 持有上限开: true, 默认上限: n } }); invalidateSettingsCache(); };

    it("接手人已到上限：带原负责人自己的和同事在推的，转客户不拦；持有数按实际接到的算", async () => {
      await 上限(1);
      const 已有 = await 客户(甲.id);
      await 项目(已有, 甲.id);
      const c = await 客户(市场.id);
      await 项目(c, 市场.id);
      await 项目(c, 乙.id);
      expect(await 持有数(prisma, 甲.id)).toBe(1);
      expect(await 以(市场, () => assignSalesOwner([c], 甲.id))).toMatchObject({ ok: true, updated: 1 });
      expect(await 持有数(prisma, 甲.id)).toBe(3);
      expect(await 持有数(prisma, 乙.id)).toBe(0);
    });

    it("接待分配：客户上挂着同事的待分配项目，接手人超上限就拦，说清谁、上限、现有数；什么都不动", async () => {
      await 上限(1);
      const 已有 = await 客户(甲.id);
      await 项目(已有, 甲.id);
      const c = await 客户(市场.id);
      const 自己的 = await 项目(c, 市场.id);
      const 待分配 = await 项目(c, 丙.id, { awaitAssignAt: new Date() });
      for (const 转 of [
        () => 以(市场, () => assignSalesOwner([c], 甲.id)),
        () => 以(市场, () => patchCustomer(c, "salesOwnerId", 甲.id)),
      ]) {
        const r = await 转();
        expect(r.ok).toBe(false);
        const 话 = (r as { error: string }).error;
        expect(话).toContain("销售甲某");
        expect(话).toContain("已经有 1 个");
        expect(话).toContain("持有上限（1 个）");
        expect(await 客户负责人(c)).toBe(市场.id);
        expect(await 项目of(自己的)).toMatchObject({ ownerId: 市场.id });
        expect(await 项目of(待分配)).toMatchObject({ ownerId: 丙.id });
        expect((await 项目of(待分配)).awaitAssignAt).not.toBeNull();
      }
      expect(await 持有数(prisma, 甲.id)).toBe(1);
      // 放宽到 2 就能接：他自己的 1 + 同事待分配 1 = 2，市场自己的项目不算进拦的数
      await 上限(2);
      expect(await 以(市场, () => assignSalesOwner([c], 甲.id))).toMatchObject({ ok: true, updated: 1 });
      expect(await 持有数(prisma, 甲.id)).toBe(3);
    });

    const 公海客户 = async (项目数: number) => {
      const c = await 客户(甲.id);
      for (let i = 0; i < 项目数; i++) await 项目(c, 甲.id, { pooledAt: new Date() });
      await prisma.customerPool.create({ data: { customerId: c, reason: "手动" } });
      return c;
    };
    const 丙先有一个 = async () => { await 项目(await 客户(丙.id), 丙.id); };

    it("领多项目的公海客户：超上限整批拦，说清再接几个；客户还在公海；放宽后能领", async () => {
      await 上限(2);
      await 丙先有一个();
      const c = await 公海客户(2);
      const r = await 以(丙, () => 领取([c]));
      expect(r.ok).toBe(false);
      const 话 = (r as { error: string }).error;
      expect(话).toContain("销售丙某");
      expect(话).toContain("已经有 1 个");
      expect(话).toContain("再接这 2 个");
      expect(话).toContain("持有上限（2 个）");
      expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(1);
      expect(await 持有数(prisma, 丙.id)).toBe(1);
      await 上限(3);
      expect(await 以(丙, () => 领取([c]))).toMatchObject({ ok: true, updated: 1 });
      expect(await 持有数(prisma, 丙.id)).toBe(3);
    });

    it("把多项目的公海客户分给同事：同样拦", async () => {
      await 上限(2);
      await 丙先有一个();
      const c = await 公海客户(2);
      const r = await 以(总管, () => 分配公海([c], 丙.id));
      expect(r.ok).toBe(false);
      expect((r as { error: string }).error).toContain("再接这 2 个");
      expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(1);
    });

    it("确认转让交接：接手人确认时超上限拦，交接还挂着；放宽后能确认", async () => {
      await setSetting(规则.交接要确认.key, true);
      await 上限(2);
      await 丙先有一个();
      const c = await 客户(甲.id);
      await 项目(c, 甲.id);
      await 项目(c, 甲.id);
      // P-转-16 起总管理批量转直接转；负责人本人（甲）转自己的走申请
      expect(await 以(甲, () => assignSalesOwner([c], 丙.id))).toMatchObject({ ok: true, 交接中: 1 });
      const [h] = (await 以(丙, () => 待确认的交接())).等我确认;
      const r = await 以(丙, () => 确认交接(h.id));
      expect(r.ok).toBe(false);
      expect((r as { error: string }).error).toContain("再接这 2 个");
      expect(await 客户负责人(c)).toBe(甲.id);
      expect((await prisma.entHandover.findUniqueOrThrow({ where: { id: h.id } })).status).toBe("待确认");
      await 上限(3);
      expect(await 以(丙, () => 确认交接(h.id))).toMatchObject({ ok: true });
      expect(await 客户负责人(c)).toBe(丙.id);
      expect(await 持有数(prisma, 丙.id)).toBe(3);
    });

    it("确认离职交接：按交出去会走的项目数拦", async () => {
      await 上限(2);
      await 丙先有一个();
      const c = await 客户(甲.id);
      await 项目(c, 甲.id);
      await 项目(c, 甲.id);
      const h = await prisma.entHandover.create({ data: { kind: "离职", way: "转交", fromUserId: 甲.id, toUserId: 丙.id, byUserId: 总管.id, customerIds: JSON.stringify([c]), counts: JSON.stringify({ 客户: 1 }) } });
      const r = await 以(丙, () => 确认交接(h.id));
      expect(r.ok).toBe(false);
      expect((r as { error: string }).error).toContain("再接这 2 个");
      expect(await 客户负责人(c)).toBe(甲.id);
      await 上限(3);
      expect(await 以(丙, () => 确认交接(h.id))).toMatchObject({ ok: true });
      expect(await 持有数(prisma, 丙.id)).toBe(3);
    });

    // 11-09 补 #203 漏的三条路（M-公海-18）
    it("分项目给（市场转一位）：客户上同事待分配的项目随客户进手，一起数；超了拦、什么都不动；放宽后能分", async () => {
      await 上限(2);
      await 项目(await 客户(甲.id), 甲.id);
      const c = await 客户(市场.id);
      const p = await 项目(c, 市场.id);
      const 待分配 = await 项目(c, 丙.id, { awaitAssignAt: new Date() });
      const r = await 以(市场, () => 分配线索({ projectId: p, toUserId: 甲.id, line: "内贸" }));
      expect(r.ok).toBe(false);
      const 话 = (r as { error: string }).error;
      expect(话).toContain("销售甲某");
      expect(话).toContain("已经有 1 个");
      expect(话).toContain("再接这 2 个");
      expect(话).toContain("持有上限（2 个）");
      expect(await 客户负责人(c)).toBe(市场.id);
      expect(await 项目of(p)).toMatchObject({ ownerId: 市场.id });
      expect(await 项目of(待分配)).toMatchObject({ ownerId: 丙.id });
      await 上限(3);
      expect(await 以(市场, () => 分配线索({ projectId: p, toUserId: 甲.id, line: "内贸" }))).toEqual({ ok: true });
      expect(await 持有数(prisma, 甲.id)).toBe(3);
    });

    it("分项目给不是市场转客户：只算手上这一个，同事待分配的不数", async () => {
      await 上限(2);
      await 项目(await 客户(甲.id), 甲.id);
      const c = await 客户(乙.id);
      const p = await 项目(c, 乙.id);
      await 项目(c, 丙.id, { awaitAssignAt: new Date() });
      expect(await 以(总管, () => 分配线索({ projectId: p, toUserId: 甲.id, line: "内贸" }))).toEqual({ ok: true });
      expect(await 持有数(prisma, 甲.id)).toBe(2);
    });

    describe("领 / 分线索公海里的项目，开关 领项目带走单项目客户 开着：客户名下别的公海项目一起来，一起数", () => {
      const 原 = 公海规则.领项目带走单项目客户;
      beforeEach(() => { 公海规则.领项目带走单项目客户 = true; });
      afterEach(() => { 公海规则.领项目带走单项目客户 = 原; });
      const 两个公海项目 = async () => {
        const c = await 公海客户(2);
        const [p] = await prisma.project.findMany({ where: { customerId: c }, orderBy: { createdAt: "asc" }, select: { id: true } });
        return { c, p: p.id };
      };
      for (const [名, 动] of [
        ["自己领", (p: string) => 以(丙, () => 领取公海项目(丙, p))],
        ["总管理分给他", async (p: string) => {
          const r = await 以(总管, () => 分配公海项目([p], 丙.id));
          return r.ok && r.没分到.length ? { ok: false as const, error: r.没分到[0].原因 } : r;
        }],
      ] as const) {
        it(`${名}：超了拦，项目和客户都还在公海；放宽后能领`, async () => {
          await 上限(2);
          await 丙先有一个();
          const { c, p } = await 两个公海项目();
          const r = await 动(p);
          expect(r.ok).toBe(false);
          const 话 = (r as { error: string }).error;
          expect(话).toContain("销售丙某");
          expect(话).toContain("再接这 2 个");
          expect(话).toContain("持有上限（2 个）");
          expect((await 项目of(p)).pooledAt).not.toBeNull();
          expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(1);
          expect(await 持有数(prisma, 丙.id)).toBe(1);
          await 上限(3);
          expect(await 动(p)).toMatchObject({ ok: true });
          expect(await 持有数(prisma, 丙.id)).toBe(3);
        });
      }
    });

    describe("离职交接看板：交之前按交出去会进手的项目数拦", () => {
      const 开项目模式 = async () => { await setSetting("business", { projectMode: true }); invalidateSettingsCache(); };
      const 场景 = async () => {
        await 开项目模式();
        await 丙先有一个();
        const c = await 客户(甲.id);
        await 项目(c, 甲.id);
        await 项目(c, 乙.id, { awaitAssignAt: new Date() });
        const 挂别处 = await 项目(await 客户(乙.id), 甲.id);
        await prisma.user.update({ where: { id: 甲.id }, data: { active: false } });
        return { c, 挂别处 };
      };
      it("交一位客户：他自己的 + 同事待分配的一起数；超了不交", async () => {
        const x = await 场景();
        await 上限(2);
        const r = await 以(总管, () => 交接客户(甲.id, x.c, 丙.id));
        expect(r.ok).toBe(false);
        expect((r as { error: string }).error).toContain("再接这 2 个");
        expect(await 客户负责人(x.c)).toBe(甲.id);
        await 上限(3);
        expect(await 以(总管, () => 交接客户(甲.id, x.c, 丙.id))).toMatchObject({ ok: true });
        expect(await 持有数(prisma, 丙.id)).toBe(3);
      });
      it("交一个项目：到上限了不交，话同单个指派", async () => {
        const x = await 场景();
        await 上限(1);
        const r = await 以(总管, () => 交接项目(甲.id, x.挂别处, 丙.id));
        expect(r.ok).toBe(false);
        expect((r as { error: string }).error).toContain("到持有上限（1 个）了");
        expect(await 项目of(x.挂别处)).toMatchObject({ ownerId: 甲.id });
        await 上限(2);
        expect(await 以(总管, () => 交接项目(甲.id, x.挂别处, 丙.id))).toMatchObject({ ok: true });
      });
      it("全部交给：按此刻分拣会进手的数（3 个）拦；放宽后能交", async () => {
        const x = await 场景();
        await 上限(3);
        const r = await 以(总管, () => 交接全部(甲.id, 丙.id));
        expect(r.ok).toBe(false);
        expect((r as { error: string }).error).toContain("再接这 3 个");
        expect(await 客户负责人(x.c)).toBe(甲.id);
        await 上限(4);
        expect(await 以(总管, () => 交接全部(甲.id, 丙.id))).toMatchObject({ ok: true });
        expect(await 持有数(prisma, 丙.id)).toBe(4);
      });
    });

    it("上限没开（现状 999 / 默认关）：三处都照旧", async () => {
      await 丙先有一个();
      const c = await 公海客户(3);
      expect(await 以(丙, () => 领取([c]))).toMatchObject({ ok: true, updated: 1 });
      const d = await 客户(市场.id);
      await 项目(d, 乙.id, { awaitAssignAt: new Date() });
      expect(await 以(市场, () => assignSalesOwner([d], 丙.id))).toMatchObject({ ok: true, updated: 1 });
      expect(await 持有数(prisma, 丙.id)).toBe(5);
    });
  });
});

describe("负责人兼任市场和销售：按销售算，转出时待办和计划一起搬（用户 11-09）", () => {
  // 负责人本人转自己的走申请移交（X4），直接转由总管理来点；确认交接那条照旧由本人发起
  const 开交接确认 = async () => { await setSetting(规则.交接要确认.key, true); invalidateSettingsCache(); };
  const 兼任写法 = ["marketing_mgr,sales", "channel_ops,sales"];
  const 造兼任 = (写法: string) => 造人(`dual-${写法.replace(/\W/g, "-")}`, "兼任某某", "SALES", 写法);
  const 他的客户 = async (主人: string) => {
    const c = await 客户(主人);
    return { c, p: await 项目(c, 主人), t: await 待办(c, 主人), pl: await 计划(c, 主人) };
  };
  const 都归 = async (x: { c: string; p: string; t: string; pl: string }, 谁: string) => {
    expect(await 客户负责人(x.c)).toBe(谁);
    expect((await 项目of(x.p)).ownerId).toBe(谁);
    expect((await 待办of(x.t)).ownerId).toBe(谁);
    expect((await 计划of(x.pl)).ownerId).toBe(谁);
  };

  describe.each(兼任写法)("业务角色 %s", (写法) => {
    it("批量转：待办和计划跟着走，通知不写留下的条数；撤销后都回来", async () => {
      const 兼任 = await 造兼任(写法);
      const x = await 他的客户(兼任.id);
      const r = await 以(总管, () => assignSalesOwner([x.c], 甲.id));
      if (!r.ok) throw new Error(r.error);
      expect(r.updated).toBe(1);
      await 都归(x, 甲.id);
      expect(JSON.stringify(await 通知们(甲.id))).not.toContain("客户上还有原负责人");
      expect(await 以(总管, () => 撤销改负责人(r.原值 ?? [], 甲.id, JSON.parse(JSON.stringify(r.带过来))))).toMatchObject({ ok: true, updated: 1 });
      await 都归(x, 兼任.id);
    });

    it("客户页改负责人：待办和计划跟着走", async () => {
      const 兼任 = await 造兼任(写法);
      const x = await 他的客户(兼任.id);
      expect(await 以(总管, () => patchCustomer(x.c, "salesOwnerId", 甲.id))).toMatchObject({ ok: true });
      await 都归(x, 甲.id);
    });

    it("确认交接：确认前不动，确认后待办和计划跟着走；接手确认框说待办和计划一起转", async () => {
      await 开交接确认();
      const 兼任 = await 造兼任(写法);
      const x = await 他的客户(兼任.id);
      expect(await 以(兼任, () => assignSalesOwner([x.c], 甲.id))).toMatchObject({ ok: true, 交接中: 1 });
      await 都归(x, 兼任.id);
      const h = (await 以(甲, () => 待确认的交接())).等我确认[0];
      expect(h.确认说明).toContain("没做完的待办和计划，都转到你名下");
      expect(h.确认说明).not.toContain("不转过来");
      expect(await 以(甲, () => 确认交接(h.id))).toEqual({ ok: true, 客户: 1 });
      await 都归(x, 甲.id);
      expect(JSON.stringify(await 通知们(兼任.id))).not.toContain("客户上还有原负责人");
    });

    it("项目分配不再算转客户：弹窗判断同销售，只动这一条项目，客户和别的项目不动（P-转-03）", async () => {
      const 兼任 = await 造兼任(写法);
      const x = await 他的客户(兼任.id);
      const 别的项目 = await 项目(x.c, 兼任.id);
      // 总管理来分：只有 channel_ops 和 sales 的人自己没有分配权
      expect(await 以(总管, () => 项目分配线(x.p))).toMatchObject({ 市场转客户: false });
      expect((await 以(总管, () => 分配带走的项目([x.p], 甲.id))).项目数).toBe(0);
      expect(await 以(总管, () => 分配线索({ projectId: x.p, toUserId: 甲.id, line: "内贸" }))).toEqual({ ok: true });
      expect((await 项目of(x.p)).ownerId).toBe(甲.id);
      expect(await 客户负责人(x.c)).toBe(兼任.id);
      expect((await 项目of(别的项目)).ownerId).toBe(兼任.id);
    });
  });

  it("对照：纯市场角色同样三个入口仍不搬", async () => {
    await setSetting(规则.交接要确认.key, false);
    invalidateSettingsCache();
    const a = await 他的客户(市场.id);
    expect(await 以(市场, () => assignSalesOwner([a.c], 甲.id))).toMatchObject({ ok: true, updated: 1 });
    const b = await 他的客户(市场.id);
    expect(await 以(市场, () => patchCustomer(b.c, "salesOwnerId", 甲.id))).toMatchObject({ ok: true });
    await 开交接确认();
    const d = await 他的客户(市场.id);
    const { h } = await 混批走交接([d.c], 甲);
    expect(await 以(甲, () => 确认交接(h.id))).toEqual({ ok: true, 客户: 1 });
    for (const x of [a, b, d]) {
      expect(await 客户负责人(x.c)).toBe(甲.id);
      expect((await 待办of(x.t)).ownerId).toBe(市场.id);
      expect((await 计划of(x.pl)).ownerId).toBe(市场.id);
    }
  });

  it("接手人是兼任、原负责人是纯市场：还是市场转销售，不搬", async () => {
    const 兼任 = await 造兼任("marketing_mgr,sales");
    const x = await 他的客户(市场.id);
    expect(await 以(市场, () => assignSalesOwner([x.c], 兼任.id))).toMatchObject({ ok: true, updated: 1 });
    expect(await 客户负责人(x.c)).toBe(兼任.id);
    expect((await 待办of(x.t)).ownerId).toBe(市场.id);
    expect((await 计划of(x.pl)).ownerId).toBe(市场.id);
  });
});

describe("撤销转客户按原样回滚、不半撤（P-撤销-01，4B）", () => {
  const 转 = async (操作人: 人, cs: string[], 到: 人) => {
    const r = await 以(操作人, () => assignSalesOwner(cs, 到.id));
    if (!r.ok) throw new Error(r.error);
    return r;
  };
  const 撤 = (操作人: 人, r: { 原值?: { id: string; 值: string }[]; 带过来?: unknown }, 新: 人) =>
    以(操作人, () => 撤销改负责人(r.原值 ?? [], 新.id, JSON.parse(JSON.stringify(r.带过来))));

  it("带过来的待办被接手人做完了：整批拒、一条都不改，说清原因", async () => {
    const c1 = await 客户(甲.id);
    const c2 = await 客户(甲.id);
    const t1 = await 待办(c1, 甲.id);
    const t2 = await 待办(c2, 甲.id);
    const p1 = await 项目(c1, 甲.id);
    const r = await 转(总管, [c1, c2], 丙);
    expect((await 待办of(t2)).ownerId).toBe(丙.id);
    await prisma.task.update({ where: { id: t2 }, data: { done: true, doneAt: new Date() } });
    const 撤了 = await 撤(总管, r, 丙);
    expect(撤了.ok).toBe(false);
    if (撤了.ok) return;
    expect(撤了.error).toContain("有 1 条已经被改过");
    expect(撤了.error).toContain("这次一条都没改");
    expect([await 客户负责人(c1), await 客户负责人(c2)]).toEqual([丙.id, 丙.id]);
    expect((await 待办of(t1)).ownerId).toBe(丙.id);
    expect((await 项目of(p1)).ownerId).toBe(丙.id);
    expect(await prisma.customerOwnerLog.count({ where: { customerId: { in: [c1, c2] }, toOwnerId: 丙.id } })).toBe(2);
  });

  it("带过来的项目被改给了别人：拒，客户和别的活都不动", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    const 另一个 = await 项目(c, 甲.id);
    const r = await 转(总管, [c], 丙);
    await prisma.project.update({ where: { id: p }, data: { ownerId: 乙.id } });
    const 撤了 = await 撤(总管, r, 丙);
    expect(撤了).toMatchObject({ ok: false });
    if (撤了.ok) return;
    expect(撤了.error).not.toContain("一条都没改"); // 只有一位，不说「一批」
    expect(撤了.error).toContain("要改回请手工改");
    expect(await 客户负责人(c)).toBe(丙.id);
    expect((await 项目of(另一个)).ownerId).toBe(丙.id);
  });

  it("一批两位、其中一位负责人又被改过：两位都不撤", async () => {
    const c1 = await 客户(甲.id);
    const c2 = await 客户(甲.id);
    const r = await 转(总管, [c1, c2], 丙);
    expect(await 以(总管, () => assignSalesOwner([c2], 乙.id))).toMatchObject({ ok: true, updated: 1 });
    const 撤了 = await 撤(总管, r, 丙);
    expect(撤了).toMatchObject({ ok: false });
    if (撤了.ok) return;
    expect(撤了.error).toContain("1 位客户现在撤不了");
    expect([await 客户负责人(c1), await 客户负责人(c2)]).toEqual([丙.id, 乙.id]);
  });

  it("成批还原：两位原负责人、每位两个客户，客户、待办、计划、项目、记录都回到转之前", async () => {
    const 原 = [甲, 甲, 乙, 乙];
    const 们 = [];
    for (const u of 原) {
      const c = await 客户(u.id);
      们.push({ c, u, t: await 待办(c, u.id), pl: await 计划(c, u.id), ps: [await 项目(c, u.id), await 项目(c, u.id)] });
    }
    const r = await 转(总管, 们.map((x) => x.c), 丙);
    expect(r).toMatchObject({ updated: 4 });
    for (const x of 们) expect((await 项目of(x.ps[0])).ownerId).toBe(丙.id);
    expect(await 撤(总管, r, 丙)).toMatchObject({ ok: true, updated: 4, unchanged: 0 });
    for (const x of 们) {
      expect(await 客户负责人(x.c)).toBe(x.u.id);
      for (const p of x.ps) expect((await 项目of(p)).ownerId).toBe(x.u.id);
      expect((await 待办of(x.t)).ownerId).toBe(x.u.id);
      expect((await 计划of(x.pl)).ownerId).toBe(x.u.id);
    }
    const ids = 们.map((x) => x.c);
    expect(await prisma.customerOwnerLog.count({ where: { customerId: { in: ids } } })).toBe(0);
    expect(await prisma.projectNodeLog.count({ where: { projectId: { in: 们.flatMap((x) => x.ps) }, kind: "transfer" } })).toBe(0);
  });
});

describe("市场第一次分给销售记成「分配」，不算转客户（P-转-03）", () => {
  it("客户页转、项目分配两个入口都记 market-assign，显示「分配」；销售转销售照旧记 assign", async () => {
    const c1 = await 客户(市场.id);
    expect(await 以(市场, () => assignSalesOwner([c1], 甲.id))).toMatchObject({ ok: true, updated: 1 });
    const c2 = await 客户(市场.id);
    const p = await 项目(c2, 市场.id);
    expect(await 以(市场, () => 分配线索({ projectId: p, toUserId: 甲.id, line: "内贸" }))).toEqual({ ok: true });
    const c3 = await 客户(甲.id);
    expect(await 以(总管, () => assignSalesOwner([c3], 丙.id))).toMatchObject({ ok: true, updated: 1 });
    const 种类 = async (c: string) => (await prisma.customerOwnerLog.findMany({ where: { customerId: c }, select: { kind: true } })).map((x) => x.kind);
    expect(await 种类(c1)).toEqual(["market-assign"]);
    expect(await 种类(c2)).toEqual(["market-assign"]);
    expect(await 种类(c3)).toEqual(["assign"]);
    expect(换负责人怎么来的("market-assign")).toBe("分配");
  });

  describe("公海项目领 / 分给销售，客户还在市场手里（P-公海-11、X-60）", () => {
    /** 市场建的客户（有创建人那一行）、市场名下：一个放进线索公海的项目 + 市场自己的待办、计划 */
    const 市场客户的公海项目 = async (创建人: string = 市场.id, 负责人: string = 市场.id) => {
      const c = await 客户(负责人);
      await prisma.customerCreator.create({ data: { customerId: c, userId: 创建人 } });
      const p = await 项目(c, 市场.id, { pooledAt: new Date(), phase: "线索" });
      return { c, p, t: await 待办(c, 负责人), pl: await 计划(c, 负责人) };
    };
    const 种类 = async (c: string) => (await prisma.customerOwnerLog.findMany({ where: { customerId: c }, select: { kind: true, fromOwnerId: true, toOwnerId: true } }));

    it("销售自己领：客户创建人、负责人都是市场 → 客户负责人变成领的销售，记「分配」（market-assign）；项目创建人不变，市场的待办、计划不搬", async () => {
      const x = await 市场客户的公海项目();
      expect(await 以(甲, () => 领取公海项目(甲, x.p, true))).toEqual({ ok: true });
      expect(await 客户负责人(x.c)).toBe(甲.id);
      expect(await 种类(x.c)).toEqual([{ kind: "market-assign", fromOwnerId: 市场.id, toOwnerId: 甲.id }]);
      expect(await 项目of(x.p)).toMatchObject({ ownerId: 甲.id, creatorId: 市场.id, pooledAt: null });
      await 活还在(x.t, x.pl, 市场.id);
    });

    it("销售自己领：客户创建人不是市场 → 客户留在市场名下，只换项目负责人", async () => {
      const x = await 市场客户的公海项目(乙.id);
      expect(await 以(甲, () => 领取公海项目(甲, x.p))).toEqual({ ok: true });
      expect(await 客户负责人(x.c)).toBe(市场.id);
      expect(await 种类(x.c)).toEqual([]);
      expect((await 项目of(x.p)).ownerId).toBe(甲.id);
    });

    it("客户已归销售乙：销售甲再领同客户的公海项目，客户仍归乙", async () => {
      const x = await 市场客户的公海项目(市场.id, 乙.id);
      expect(await 以(甲, () => 领取公海项目(甲, x.p))).toEqual({ ok: true });
      expect(await 客户负责人(x.c)).toBe(乙.id);
      expect(await 种类(x.c)).toEqual([]);
    });

    it("总管理把公海项目分给销售：客户还在市场手里 → 整体给这位销售，记「分配」；不看客户创建人", async () => {
      const x = await 市场客户的公海项目(乙.id);
      const r = await 以(总管, () => 分配公海项目([x.p], 丙.id));
      expect(r).toMatchObject({ ok: true, 分到: [x.p], 没分到: [] });
      expect(await 客户负责人(x.c)).toBe(丙.id);
      expect(await 种类(x.c)).toEqual([{ kind: "market-assign", fromOwnerId: 市场.id, toOwnerId: 丙.id }]);
      expect(await 项目of(x.p)).toMatchObject({ ownerId: 丙.id, creatorId: 市场.id });
      await 活还在(x.t, x.pl, 市场.id);
    });
  });

  it("市场分出去再撤销：那条「分配」记录删掉、客户回到市场", async () => {
    const c = await 客户(市场.id);
    const r = await 以(市场, () => assignSalesOwner([c], 甲.id));
    if (!r.ok) throw new Error(r.error);
    expect(await 以(市场, () => 撤销改负责人(r.原值 ?? [], 甲.id, JSON.parse(JSON.stringify(r.带过来))))).toMatchObject({ ok: true, updated: 1 });
    expect(await 客户负责人(c)).toBe(市场.id);
    expect(await prisma.customerOwnerLog.count({ where: { customerId: c } })).toBe(0);
  });
});

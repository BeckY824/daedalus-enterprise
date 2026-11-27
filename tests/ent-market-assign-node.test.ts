/**
 * 审核 11-18「节点与市场分配」：复现单测（N-1、N-2、V-1、V-2、V-3，原在审核副本 tests/audit-1118/node-market-assign.test.ts，修前全红）+ 修后的对照用例。
 *   N 市场分给销售：停在潜客培育的项目进线索验证（market-assign-node.ts）；销售自建自持、市场建给自己的不推；撤销推回
 *     （M-线索-01「市场分配后销售判有效 / 无效」、P-看-06、客户 11-18：「市场分过来的客户……销售看到他时，就应该直接在线索验证这一个环节了」）
 *   V 判无效交市场复核：收到通知的人 = 能拍板的人（org-core 市场复核人们），兜底 客户创建人 → 无主线索复核人 → 系统管理员（P-线索-03 + 11-18）
 *     （客户 11-18：「当销售标记无效后，无人能收到这个处理」「市场管理周亮收到了，代存龙（创建人）没有收到提醒」）
 *   P 等复核时客户整位放进公海：拦（X-77「推进和放公海都拦」）
 *   B 补建认标记：creatorId = system 或 importBatch = 补建批次（system-created.ts），存量改创建人后新建数不被撑大
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { resetDb } from "./reset";
import { 分配线索, 设线部门, 自动分配线索, 撤销自动分配 } from "@/app/(app)/leads/assign-actions";
import { saveCustomer, assignSalesOwner, 撤销改负责人 } from "@/app/(app)/customers/actions";
import { 放进公海 } from "@/app/(app)/customers/pool-actions";
import { 建档向导, type 建档向导输入 } from "@/app/(app)/projects/actions";
import { 设无主线索复核人 } from "@/app/(app)/settings/org-actions";
import { 不设配额key, 自动分配不参与key } from "@/lib/enterprise/lead-assign";
import { 规则 } from "@/lib/enterprise/rules";
import { 销售初判, 能拍板, 市场复核, 待我复核的 } from "@/lib/project/lead-verify";
import { 验证待办通知 } from "@/lib/enterprise/notice-sources";
import { 读组织于, 市场复核要读的, 建组织 } from "@/lib/enterprise/org";
import { 市场分配进验证理由, 算市场分给销售 } from "@/lib/enterprise/market-assign-node";
import { 补建创建人, 补建批次, 补建的, 不算补建, 是补建, 仅记录用来源 } from "@/lib/project/system-created";
import { 给客户建项目 } from "@/app/(app)/customers/[id]/project-actions";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";

type 人 = { id: string; name: string; role: string };
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name, role: u.role }; };

let 管理员: 人, 市管: 人, 别线市管: 人, 渠道运营: 人, 销管: 人, 销售: 人, 销售二: 人;
let 序 = 0;

async function 建人(email: string, name: string, bizRole: string, deptId: string | null, managerId: string | null = null, role = "SALES"): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x", active: true, createdAt: new Date(2026, 0, ++序) } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, deptId, managerId } });
  return { id: u.id, name, role };
}
const 建客户 = async (owner: string, creator?: string) => {
  // 企业版客户没有电话（E-260）：号记在主要联系人上（放回公海查联系方式按联系人的号判）
  const c = await prisma.customer.create({ data: { name: `客户${++序}`, phone: "", salesOwnerId: owner, addrCountry: "美国", bizLine: "外贸", contacts: { create: { name: `联系人${序}`, phone: `1390000${String(序).padStart(4, "0")}`, isPrimary: true } } } });
  if (creator) await prisma.customerCreator.create({ data: { customerId: c.id, userId: creator } });
  return c.id;
};
const 建项目 = async (customerId: string, d: { ownerId: string; creatorId: string; node: string; importBatch?: string }) =>
  (await prisma.project.create({ data: { name: `项目${++序}`, customerId, ...d, phase: "线索", bizLine: "外贸" } })).id;
const 节点 = async (id: string) => (await prisma.project.findUniqueOrThrow({ where: { id } })).node;
const 推进痕 = (projectId: string) => prisma.projectNodeLog.count({ where: { projectId, fromNode: "潜客培育", toNode: "线索验证" } });
/** 这条线索现在「待市场复核」时收到通知的人 */
const 收到复核通知的 = async () =>
  new Set((await prisma.entNotice.findMany({ where: { kind: "线索验证" }, select: { userId: true } })).map((n) => n.userId));
/** 能拍板市场复核的人（照 能拍板 判）：项目按线上读法带上客户创建人（市场复核要读的） */
const 能复核的 = async (projectId: string, 候选: 人[]) => {
  const org = await 读组织于(prisma);
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { ...市场复核要读的, pooledAt: true, awaitAssignAt: true } });
  return new Set(候选.filter((u) => 能拍板({ id: u.id, role: u.role } as never, "市场复核", p, org)).map((u) => u.id));
};
const 排 = (s: Set<string>) => [...s].sort();
const 判无效并通知 = async (P: string) => {
  expect(await 销售初判(销管 as never, P, "无效", { invalidReason: "需求不存在" })).toEqual({ ok: true });
  await 验证待办通知(销管, P);
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  const 外贸部 = (await prisma.entDept.create({ data: { name: "外贸事业部" } })).id;
  const MVP = (await prisma.entDept.create({ data: { name: "MVP战队", parentId: 外贸部 } })).id;
  const 市场部 = (await prisma.entDept.create({ data: { name: "市场运营部" } })).id;
  const 企划部 = (await prisma.entDept.create({ data: { name: "营销企划部" } })).id;
  管理员 = await 建人("admin", "系统管理员", "director", null, null, "ADMIN");
  市管 = await 建人("zl", "市管周", "marketing_mgr", 市场部);
  别线市管 = await 建人("cz", "别线市管", "marketing_mgr", 市场部);
  // 正式库里那位渠道运营：channel_ops，部门是营销企划部（名字不带「市场」），直属上级是市管
  渠道运营 = await 建人("dcl", "渠道运营代", "channel_ops", 企划部, 市管.id);
  销管 = await 建人("zwc", "销管甄", "sales_mgr", MVP);
  销售 = await 建人("s1", "销售一", "sales", MVP, 销管.id);
  销售二 = await 建人("s2", "销售二", "sales", MVP, 销管.id);
  for (const k of [规则.按组织看客户.key, 规则.线索分配.key]) await setSetting(k, true);
  await setSetting(不设配额key, true);
  当(管理员);
  expect(await 设线部门({ 内贸: [], 外贸: [MVP] })).toEqual({ ok: true });
});

describe("N 市场分给销售：停在潜客培育的进线索验证", () => {
  it("N-1 市场管理把停在潜客培育的线索指定分配给销售：项目进线索验证，留一行节点变更", async () => {
    const c = await 建客户(市管.id, 市管.id);
    const P = await 建项目(c, { ownerId: 市管.id, creatorId: 市管.id, node: "潜客培育" });
    当(市管);
    const r = await 分配线索({ projectId: P, toUserId: 销售.id, 原负责人: 市管.id });
    expect(r.ok).toBe(true);
    // 客户整体给了销售（P-转-03 例外）
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId).toBe(销售.id);
    expect(await 节点(P)).toBe("线索验证");
    expect(await prisma.projectNodeLog.count({ where: { projectId: P, fromNode: "潜客培育", toNode: "线索验证" } })).toBe(1);
    // 操作人 = 分配的人，理由写明；不走「前两个节点要先有沟通」：这条一条沟通都没有也推了
    expect(await prisma.projectNodeLog.findFirst({ where: { projectId: P, toNode: "线索验证" }, select: { userId: true, reason: true, kind: true } }))
      .toEqual({ userId: 市管.id, reason: 市场分配进验证理由, kind: "node" });
  });

  it("N-2 市场管理新建客户直接选销售当负责人：自动带的项目在线索验证", async () => {
    当(市管);
    const r = await saveCustomer({
      name: "新客户", phone: "13712345678", school: null, grade: null, major: null,
      followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
      salesOwnerId: 销售.id, channelId: null, referrerCustomerId: null,
      企业资料: { bizLine: "外贸" },
    } as Parameters<typeof saveCustomer>[0]);
    if (!r.ok) throw new Error(r.error);
    const 项目们 = await prisma.project.findMany({ where: { customerId: r.id! } });
    expect(项目们).toHaveLength(1);
    expect(项目们[0].ownerId).toBe(销售.id);
    expect(项目们[0].node).toBe("线索验证");
    expect(await 推进痕(项目们[0].id)).toBe(1);
  });

  it("N-2 对照：市场管理新建客户记在自己名下 / 销售自己建：都留在潜客培育", async () => {
    const 建 = async (who: 人, owner: 人, phone: string) => {
      当(who);
      const r = await saveCustomer({
        name: `新客户${phone}`, phone, school: null, grade: null, major: null,
        followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
        salesOwnerId: owner.id, channelId: null, referrerCustomerId: null, 企业资料: { bizLine: "外贸" },
      } as Parameters<typeof saveCustomer>[0]);
      if (!r.ok) throw new Error(r.error);
      return (await prisma.project.findFirstOrThrow({ where: { customerId: r.id! } })).id;
    };
    expect(await 节点(await 建(市管, 市管, "13712340001"))).toBe("潜客培育");
    expect(await 节点(await 建(销售, 销售, "13712340002"))).toBe("潜客培育");
  });

  it("N-3 对照：销售管理把销售自建自持的潜客培育线索改派给另一位销售：不推", async () => {
    const c = await 建客户(销售.id, 销售.id);
    const P = await 建项目(c, { ownerId: 销售.id, creatorId: 销售.id, node: "潜客培育" });
    当(销管);
    const r = await 分配线索({ projectId: P, toUserId: 销售二.id, 原负责人: 销售.id });
    expect(r.ok).toBe(true);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: P } })).ownerId).toBe(销售二.id);
    expect(await 节点(P)).toBe("潜客培育");
    expect(await 推进痕(P)).toBe(0);
  });

  it("N-4 市场转给销售：原负责人（市场）名下别的潜客培育项目一起进线索验证；已经往后走的、同事在推的不动", async () => {
    const c = await 建客户(市管.id, 市管.id);
    const P = await 建项目(c, { ownerId: 市管.id, creatorId: 市管.id, node: "潜客培育" });
    const 别的 = await 建项目(c, { ownerId: 市管.id, creatorId: 市管.id, node: "潜客培育" });
    const 推进过的 = await 建项目(c, { ownerId: 市管.id, creatorId: 市管.id, node: "线索推进" });
    const 同事自建 = await 建项目(c, { ownerId: 销售二.id, creatorId: 销售二.id, node: "潜客培育" });
    当(市管);
    expect((await 分配线索({ projectId: P, toUserId: 销售.id, 原负责人: 市管.id })).ok).toBe(true);
    expect(await 节点(P)).toBe("线索验证");
    expect(await 节点(别的)).toBe("线索验证");
    expect(await 节点(推进过的)).toBe("线索推进");
    // 同事在推的随客户带过来（P-转-07），是销售自己建的：不推
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 同事自建 } })).ownerId).toBe(销售.id);
    expect(await 节点(同事自建)).toBe("潜客培育");
  });

  it("N-5 市场管理自动分配 + 撤销：进线索验证，撤销推回潜客培育、删掉那行节点变更", async () => {
    const 全部 = await prisma.entMember.findMany({ select: { userId: true } });
    await setSetting(自动分配不参与key, 全部.map((x) => x.userId).filter((id) => id !== 销售.id));
    invalidateSettingsCache();
    const c = await 建客户(市管.id, 市管.id);
    const P = await 建项目(c, { ownerId: 市管.id, creatorId: 市管.id, node: "潜客培育" });
    const 别的 = await 建项目(c, { ownerId: 市管.id, creatorId: 市管.id, node: "潜客培育" });
    当(市管);
    const r = await 自动分配线索(P, { 项目: true, 原负责人: 市管.id });
    if (!r.ok) throw new Error(r.error);
    expect(r.toUserId).toBe(销售.id);
    expect([await 节点(P), await 节点(别的)]).toEqual(["线索验证", "线索验证"]);
    expect(await 撤销自动分配(P, r.还原)).toEqual({ ok: true });
    expect(await prisma.project.findUniqueOrThrow({ where: { id: P } })).toMatchObject({ ownerId: 市管.id, node: "潜客培育" });
    expect(await prisma.project.findUniqueOrThrow({ where: { id: 别的 } })).toMatchObject({ ownerId: 市管.id, node: "潜客培育" });
    expect(await 推进痕(P) + await 推进痕(别的)).toBe(0);
  });

  it("N-6 客户层转给销售（客户转让）+ 撤销：名下潜客培育的项目进线索验证，撤销推回", async () => {
    const c = await 建客户(市管.id, 市管.id);
    const P = await 建项目(c, { ownerId: 市管.id, creatorId: 市管.id, node: "潜客培育" });
    当(市管);
    const r = await assignSalesOwner([c], 销售.id, null, undefined, { 说明: "测试原因" });
    if (!r.ok) throw new Error(r.error);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId).toBe(销售.id);
    expect(await 节点(P)).toBe("线索验证");
    expect(r.带过来?.推节点).toEqual([P]);
    const 撤 = await 撤销改负责人([{ id: c, 值: 市管.id }], 销售.id, r.带过来);
    expect(撤.ok).toBe(true);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: P } })).toMatchObject({ ownerId: 市管.id, node: "潜客培育" });
    expect(await 推进痕(P)).toBe(0);
  });

  it("N-7 建档向导：市场管理指定给销售，项目进线索验证；指定给自己留在潜客培育", async () => {
    const 渠 = await prisma.channel.create({ data: { name: "渠道甲", channelOwnerId: 管理员.id } });
    const 跟进 = { type: "PHONE", content: "聊了需求", occurredAt: "2026-11-18 10:00", 节点: "潜客培育", 明确回复: false };
    const 向导 = (ownerId: string, phone: string, 分配方式?: number) => 建档向导({
      客户: { name: `向导客户${phone}`, phone, school: null, grade: null, major: null, followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null, salesOwnerId: 市管.id, channelId: 渠.id, referrerCustomerId: null },
      联系人: { name: "王联系", position: "采购", phone: "" },
      项目: { name: `向导项目${phone}`, amount: 0, currency: "CNY", ownerId, 业务线: "外贸", ...(分配方式 === undefined ? {} : { 分配方式 }) },
      跟进,
    } as 建档向导输入);
    当(市管);
    const 给销售 = await 向导(销售.id, "13700000001", 0);
    if (!给销售.ok) throw new Error(给销售.error);
    const p1 = await prisma.project.findFirstOrThrow({ where: { name: "向导项目13700000001" } });
    expect(p1).toMatchObject({ ownerId: 销售.id, node: "线索验证" });
    const 给自己 = await 向导(市管.id, "13700000002");
    if (!给自己.ok) throw new Error(给自己.error);
    expect(await prisma.project.findFirstOrThrow({ where: { name: "向导项目13700000002" } })).toMatchObject({ ownerId: 市管.id, node: "潜客培育" });
  });

  it("N-8 判定（纯函数）：接手人得是销售；销售自建自持不算；分的人或原负责人是市场成员才算", async () => {
    const org = await 读组织于(prisma);
    const 判 = (分配人: 人, 原: 人 | null, 接手人: 人, 创建人?: 人, 市场转客户 = false) =>
      算市场分给销售(org, { 分配人: 分配人.id, 原: 原?.id ?? null, 接手人: 接手人.id, 创建人: 创建人?.id ?? null, 市场转客户 });
    expect(判(市管, 市管, 销售)).toBe(true);
    expect(判({ id: "system", name: "系统", role: "" }, 渠道运营, 销售, 渠道运营)).toBe(true); // 定时分配到点：原负责人是渠道运营
    expect(判(市管, 市管, 别线市管)).toBe(false); // 接手的不是销售
    expect(判(销管, 销售, 销售二, 销售)).toBe(false); // 销售管理之间改派
    expect(判(市管, 销售, 销售二, 销售)).toBe(false); // 销售自建自持
    expect(判(销管, 销售, 销售二, 销售, true)).toBe(false); // 客户在市场手里，这条也是销售自建自持
    expect(判(销管, 市管, 销售, 市管)).toBe(true); // 销售管理把市场手里的分给销售
  });
});

describe("V 判无效交市场复核：收通知的 = 能拍板的", () => {
  it("V-1 渠道运营建的线索，销售判无效：创建人和他的直属市场管理收到、能拍；别线市场管理收不到", async () => {
    const c = await 建客户(销管.id, 渠道运营.id);
    const P = await 建项目(c, { ownerId: 销管.id, creatorId: 渠道运营.id, node: "线索验证" });
    await 判无效并通知(P);
    const 收 = await 收到复核通知的();
    const 能 = await 能复核的(P, [管理员, 市管, 别线市管, 渠道运营]);
    expect(能.has(渠道运营.id)).toBe(true);
    expect(收.has(渠道运营.id)).toBe(true);
    expect([...收].filter((id) => !能.has(id))).toEqual([]);
    expect(排(收)).toEqual(排(能));
    expect(排(收)).toEqual(排(new Set([渠道运营.id, 市管.id])));
  });

  it("V-2 补建项目（创建人 system）判无效：找客户创建人那条链，收到的都能拍", async () => {
    const c = await 建客户(销管.id, 渠道运营.id);
    const P = await 建项目(c, { ownerId: 销管.id, creatorId: "system", node: "线索验证" });
    await 判无效并通知(P);
    const 收 = await 收到复核通知的();
    const 能 = await 能复核的(P, [管理员, 市管, 别线市管, 渠道运营]);
    expect([...收].some((id) => 能.has(id))).toBe(true);
    expect(排(收)).toEqual(排(能));
    expect(排(收)).toEqual(排(new Set([渠道运营.id, 市管.id])));
    // 真能拍：收到的渠道运营点「判无效」成了
    expect(await 市场复核(渠道运营 as never, P, false, "确实无效")).toMatchObject({ ok: true });
  });

  it("V-2b 补建项目、客户也没有创建人：没设无主线索复核人 → 系统管理员收到、能拍；设了 → 只给那位", async () => {
    const c = await 建客户(销管.id);
    const P = await 建项目(c, { ownerId: 销管.id, creatorId: "system", node: "线索验证" });
    await 判无效并通知(P);
    expect(排(await 收到复核通知的())).toEqual([管理员.id]);
    expect(排(await 能复核的(P, [管理员, 市管, 别线市管, 渠道运营]))).toEqual([管理员.id]);

    // 设置：无主线索复核人 = 市管（只有能改后台设置的人能设）
    当(销管);
    expect((await 设无主线索复核人(市管.id)).ok).toBe(false);
    当(管理员);
    expect(await 设无主线索复核人(市管.id)).toEqual({ ok: true });
    invalidateSettingsCache();
    expect((await 读组织于(prisma)).无主线索复核人).toBe(市管.id);
    expect(排(await 能复核的(P, [管理员, 市管, 别线市管, 渠道运营]))).toEqual([市管.id]);
    await prisma.entNotice.deleteMany({});
    // 撤回重判，再发一轮通知：只给市管
    await prisma.entLeadVerify.deleteMany({});
    await 判无效并通知(P);
    expect(排(await 收到复核通知的())).toEqual([市管.id]);
    // 待我复核的列表同一份
    expect((await 待我复核的({ id: 市管.id, role: "SALES" })).map((x) => x.projectId)).toEqual([P]);
    expect(await 待我复核的({ id: 别线市管.id, role: "SALES" })).toEqual([]);
    // 清空：回到系统管理员
    expect(await 设无主线索复核人(null)).toEqual({ ok: true });
    expect((await 读组织于(prisma)).无主线索复核人).toBe(null);
  });

  it("V-4 项目创建人不是市场成员（总管理建的）、已停用没有上级：都改看客户创建人那条链", async () => {
    const c = await 建客户(销管.id, 渠道运营.id);
    const 总管建的 = await 建项目(c, { ownerId: 销管.id, creatorId: 管理员.id, node: "线索验证" });
    expect(排(await 能复核的(总管建的, [管理员, 市管, 别线市管, 渠道运营]))).toEqual(排(new Set([渠道运营.id, 市管.id])));
    const 走了 = await 建人("gone", "离职市场", "channel_ops", null);
    await prisma.user.update({ where: { id: 走了.id }, data: { active: false } });
    const 离职建的 = await 建项目(c, { ownerId: 销管.id, creatorId: 走了.id, node: "线索验证" });
    expect(排(await 能复核的(离职建的, [管理员, 市管, 别线市管, 渠道运营]))).toEqual(排(new Set([渠道运营.id, 市管.id])));
  });

  it("V-5 纯函数：离职的创建人有直属市场管理 → 那位；兜底人是负责人 → 跳过给系统管理员", async () => {
    const org = 建组织(
      [{ id: "dir", role: "ADMIN", active: true }, { id: "mm", role: "SALES", active: true }, { id: "s", role: "SALES", active: true }, { id: "gone", role: "SALES", active: false }],
      [
        { userId: "dir", deptId: null, bizRole: "director", line: null, managerId: null, dottedManagerId: null },
        { userId: "mm", deptId: null, bizRole: "marketing_mgr", line: null, managerId: null, dottedManagerId: null },
        { userId: "s", deptId: null, bizRole: "sales", line: null, managerId: null, dottedManagerId: null },
        { userId: "gone", deptId: null, bizRole: "channel_ops", line: null, managerId: "mm", dottedManagerId: null },
      ],
      [],
    );
    const { 市场复核人们 } = await import("@/lib/enterprise/org-core");
    expect(市场复核人们(org, { creatorId: "gone", ownerId: "s" })).toEqual(["mm"]);
    expect(市场复核人们({ ...org, 无主线索复核人: "s" }, { creatorId: "system", ownerId: "s" })).toEqual(["dir"]);
    expect(市场复核人们({ ...org, 无主线索复核人: "mm" }, { creatorId: "system", ownerId: "s", customer: { creator: null } })).toEqual(["mm"]);
  });
});

describe("P 等复核时客户整位放进公海", () => {
  it("V-3 等市场复核时销售把客户整个放进公海：拦下，验证状态还在", async () => {
    const c = await 建客户(销管.id, 渠道运营.id);
    const P = await 建项目(c, { ownerId: 销管.id, creatorId: 渠道运营.id, node: "线索验证" });
    expect(await 销售初判(销管 as never, P, "无效", { invalidReason: "需求不存在" })).toEqual({ ok: true });
    expect((await prisma.entLeadVerify.findUniqueOrThrow({ where: { projectId: P } })).pending).toBe("市场复核");
    当(销管);
    const r = await 放进公海([c], "客户主动终止");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/在等市场复核，复核完再放公海/);
    expect((await prisma.entLeadVerify.findUnique({ where: { projectId: P } }))?.pending).toBe("市场复核");
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(0);
  });

  it("V-3 对照：没有在验证的线索照常能放；勾两位时在验证的那位跳过、别的照放", async () => {
    const 能放的 = await 建客户(销管.id, 渠道运营.id);
    await 建项目(能放的, { ownerId: 销管.id, creatorId: 渠道运营.id, node: "线索验证" });
    const 在验的 = await 建客户(销管.id, 渠道运营.id);
    const P = await 建项目(在验的, { ownerId: 销管.id, creatorId: 渠道运营.id, node: "线索验证" });
    expect(await 销售初判(销管 as never, P, "无效", { invalidReason: "需求不存在" })).toEqual({ ok: true });
    当(销管);
    const r = await 放进公海([能放的, 在验的], "客户主动终止");
    expect(r).toMatchObject({ ok: true, updated: 1, 验证中: 1 });
    expect(await prisma.customerPool.count({ where: { customerId: 能放的 } })).toBe(1);
    expect(await prisma.customerPool.count({ where: { customerId: 在验的 } })).toBe(0);
  });
});

describe("B 补建认标记（creatorId = system 或 importBatch = 补建批次）", () => {
  it("改了创建人、带补建批次的仍算补建：新建类不数它；importBatch 空的照常数（NOT 里不丢 NULL 行）", async () => {
    const c = await 建客户(销售.id);
    const 正常 = await 建项目(c, { ownerId: 销售.id, creatorId: 销售.id, node: "潜客培育" });
    const 系统 = await 建项目(c, { ownerId: 销售.id, creatorId: 补建创建人, node: "潜客培育" });
    const 改了创建人 = await 建项目(c, { ownerId: 销售.id, creatorId: 市管.id, node: "潜客培育", importBatch: 补建批次 });
    const 别的批次 = await 建项目(c, { ownerId: 销售.id, creatorId: 市管.id, node: "潜客培育", importBatch: "别的批次" });
    const 数 = async (where: object) => (await prisma.project.findMany({ where: { customerId: c, ...where }, select: { id: true } })).map((p) => p.id).sort();
    expect(await 数(不算补建)).toEqual([正常, 别的批次].sort());
    expect(await 数(补建的)).toEqual([系统, 改了创建人].sort());
    expect(await 数({ NOT: 补建的 })).toEqual([正常, 别的批次].sort());
    expect(是补建({ creatorId: 市管.id, importBatch: 补建批次 })).toBe(true);
    expect(是补建({ creatorId: 补建创建人, importBatch: null })).toBe(true);
    expect(是补建({ creatorId: 市管.id, importBatch: null })).toBe(false);
  });
});

describe("X-147 待定 4：仅记录用的市场分给销售也停在潜客培育", () => {
  it("市场管理在客户页勾着仅记录用建、指定给销售：停在潜客培育，不留进线索验证的痕", async () => {
    await setSetting("orgRules", { ...默认组织规则, 阶段: { ...默认组织规则.阶段, 仅记录用: true } });
    const c = await 建客户(市管.id, 市管.id);
    当(市管);
    const 建 = (仅记录用: boolean) => 给客户建项目({
      customerId: c,
      项目: { name: `记沟通${仅记录用 ? "仅记录用" : "普通"}`, amount: 0, currency: "CNY", ownerId: 销售.id },
      跟进: { type: "PHONE", content: "问了一下", occurredAt: "2026-11-20 10:00", 节点: "潜客培育" },
      仅记录用,
    });
    const r = await 建(true);
    if (!r.ok) throw new Error(r.error);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: r.projectId }, select: { ownerId: true, node: true, source: true } }))
      .toEqual({ ownerId: 销售.id, node: "潜客培育", source: 仅记录用来源 });
    expect(await 推进痕(r.projectId)).toBe(0);
  });

  it("对照：市场管理客户页建普通项目指定给销售照进线索验证；仅记录用的之后再分 / 转给销售也不推", async () => {
    const c = await 建客户(市管.id, 市管.id);
    当(市管);
    const r = await 给客户建项目({
      customerId: c,
      项目: { name: "普通", amount: 0, currency: "CNY", ownerId: 销售.id },
      跟进: { type: "PHONE", content: "问了一下", occurredAt: "2026-11-20 10:00", 节点: "潜客培育" },
    });
    if (!r.ok) throw new Error(r.error);
    expect(await 节点(r.projectId)).toBe("线索验证");
    // 已有的仅记录用项目（962 补建那种）：市场管理分配线索给销售，负责人换了、节点不动
    const c2 = await 建客户(市管.id, 市管.id);
    const P = (await prisma.project.create({ data: { name: "补建", customerId: c2, ownerId: 市管.id, creatorId: 市管.id, phase: "线索", node: "潜客培育", bizLine: "外贸", source: 仅记录用来源 } })).id;
    expect((await 分配线索({ projectId: P, toUserId: 销售.id, 原负责人: 市管.id })).ok).toBe(true);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: P }, select: { ownerId: true, node: true } })).toEqual({ ownerId: 销售.id, node: "潜客培育" });
    expect(await 推进痕(P)).toBe(0);
  });

  it("待定 5：销售到了持有上限，市场管理再分一个仅记录用的给他不拦（普通的照拦）", async () => {
    await setSetting("orgRules", { ...默认组织规则, 公海: { ...默认组织规则.公海, 持有上限开: true, 默认上限: 1 } });
    const c0 = await 建客户(销售.id);
    await 建项目(c0, { ownerId: 销售.id, creatorId: 销售.id, node: "潜客培育" });
    const c = await 建客户(市管.id, 市管.id);
    const 普 = await 建项目(c, { ownerId: 市管.id, creatorId: 市管.id, node: "潜客培育" });
    const 记 = (await prisma.project.create({ data: { name: "补建", customerId: c, ownerId: 市管.id, creatorId: 市管.id, phase: "线索", node: "潜客培育", bizLine: "外贸", source: 仅记录用来源 } })).id;
    当(市管);
    expect(await 分配线索({ projectId: 普, toUserId: 销售.id, 原负责人: 市管.id })).toMatchObject({ ok: false, error: expect.stringContaining("持有上限") });
    expect(await 分配线索({ projectId: 记, toUserId: 销售.id, 原负责人: 市管.id })).toMatchObject({ ok: true });
  });
});

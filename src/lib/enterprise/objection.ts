/**
 * 12-22 第 2 阶段 A 段 · 转让异议（判定页 #7 #8 #18，表 EntTransferObjection / migrations/193）。
 *
 * 流程：上级 / 条线总管理 / 系统管理员直接转客户（要写原因那一路）→ 事务提交后调 记转让异议入口：
 *   被换掉的客户负责人、被随客户转走的在推项目的同事，各记一行「可提」（30 天，从转让那一刻起），
 *   通知里带「提异议」入口（链到 /objections）；留着的同事项目只收知会（同事项目保留知会），不记行、不带异议；
 * 受影响的人在 /objections 点「提异议」→ 提异议：理由必填 ≤200 字、30 天内、同一条只能提一次（updateMany 带「可提」条件，并发双击只成一次），
 * 提交时按「让这次变动生效的那位的上一级」算好裁定人（objection-core.ts 算裁定人）、通知他们。裁定、撤回属 B 段。
 * 转让发起的通知、记行出任何错只记日志，不往外抛（转让已经成了）。
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { recordAudit } from "@/lib/audit";
import { 企业版 } from "./switch";
import { notify } from "./notify";
import { 读组织 } from "./org";
import { 客户显名, 显名列 } from "./customer-title";
import type { 同事待分配条 } from "./notice-sources";
import { 异议可提, 异议已撤销, 异议待裁定, 异议理由上限, 异议截止, 异议期天数, 算裁定人, type 裁定人结果 } from "./objection-core";
import type { EntTransferObjection } from "@/generated/prisma";

export type 异议入口们 = {
  /** 被换掉的客户负责人 → 他那几条客户异议行 */
  客户: Map<string, { id: string; customerId: string }[]>;
  /** 随客户转走的在推项目 id → 异议行 id */
  项目: Map<string, string>;
};

const 空入口 = (): 异议入口们 => ({ 客户: new Map(), 项目: new Map() });

/**
 * 转让事务提交后调：给每位受影响的人记一行异议入口。
 * 转成 = 这次真换了负责人的客户（旧 = 原负责人）；在推 = 随客户转走的在推项目（同事待分配随客户通知 同一份，只取 在推）。
 * 点转让的人自己、接手人、已停用的不记；找不到那次转让的换负责人记录（没写原因的老路径）也不记
 */
export async function 记转让异议入口(操作人: { id: string; name: string }, 新: string, 转成: readonly { customerId: string; 旧: string }[], 在推条们: readonly 同事待分配条[]): Promise<异议入口们> {
  const 出 = 空入口();
  if (!企业版()) return 出;
  try {
    const 旧of = new Map(转成.map((c) => [c.customerId, c.旧]));
    const 在推们 = 在推条们.filter((x) => x.在推 && 旧of.has(x.customerId));
    const 人ids = [...new Set([...转成.map((c) => c.旧), ...在推们.map((x) => x.原)])];
    const 在职 = new Set((await prisma.user.findMany({ where: { id: { in: 人ids }, active: true }, select: { id: true } })).map((u) => u.id));
    const 可 = (id: string) => 在职.has(id) && id !== 操作人.id && id !== 新;
    const 日志 = new Map<string, { id: string; at: Date }>();
    for (const customerId of new Set([...转成.map((c) => c.customerId)])) {
      const 旧 = 旧of.get(customerId)!;
      const l = await 看全部(() => prisma.customerOwnerLog.findFirst({
        where: { customerId, userId: 操作人.id, fromOwnerId: 旧, toOwnerId: 新, kind: "assign", reason: { not: null } },
        orderBy: { at: "desc" }, select: { id: true, at: true },
      }));
      if (l) 日志.set(customerId, l);
    }
    const 客户们 = await 看全部(() => prisma.customer.findMany({ where: { id: { in: [...日志.keys()] } }, select: 显名列 }));
    const 客户名 = new Map(客户们.map((c) => [c.id, 客户显名(c)]));
    const 项目们 = await 看全部(() => prisma.project.findMany({ where: { id: { in: 在推们.map((x) => x.id) } }, select: { id: true, name: true } }));
    const 项目名 = new Map(项目们.map((p) => [p.id, p.name]));
    const 记 = async (customerId: string, objectorUserId: string, projectId: string | null, 名: string) => {
      const l = 日志.get(customerId);
      if (!l) return null;
      const targetKey = projectId ?? "customer";
      const r = await prisma.entTransferObjection.upsert({
        where: { ownerLogId_objectorUserId_targetKey: { ownerLogId: l.id, objectorUserId, targetKey } },
        create: { ownerLogId: l.id, customerId, projectId, kind: projectId ? "项目" : "客户", targetKey, targetName: 名.slice(0, 120), objectorUserId, operatorUserId: 操作人.id, toOwnerId: 新, expiresAt: 异议截止(l.at) },
        update: {},
        select: { id: true },
      });
      return r.id;
    };
    for (const c of 转成) {
      if (!可(c.旧)) continue;
      const id = await 记(c.customerId, c.旧, null, 客户名.get(c.customerId) ?? "（一位客户）");
      if (id) 出.客户.set(c.旧, [...(出.客户.get(c.旧) ?? []), { id, customerId: c.customerId }]);
    }
    for (const p of 在推们) {
      if (!可(p.原)) continue;
      const id = await 记(p.customerId, p.原, p.id, 项目名.get(p.id) ?? "（一个项目）");
      if (id) 出.项目.set(p.id, id);
    }
  } catch (e) {
    console.warn("[异议] 入口没记上：", e instanceof Error ? e.message : e);
  }
  return 出;
}

export type 异议行 = {
  id: string; 类别: "客户" | "项目"; 对象: string; 状态: string; 操作人: string; 新负责人: string;
  转让于: string; 截止: string; 剩几天: number; 过期: boolean;
  理由?: string; 裁定人?: string; 裁定角色?: string; 裁定说明?: string;
};

/** 按当前组织重算一批异议的裁定人（口径 A2 / B1：停用、调岗的不算，去掉发起人和接手人）；组织、客户线、转让前负责人各一次批量读 */
export async function 重算裁定人们(行们: readonly Pick<EntTransferObjection, "id" | "customerId" | "ownerLogId" | "operatorUserId" | "objectorUserId" | "toOwnerId">[]): Promise<Map<string, 裁定人结果>> {
  const 出 = new Map<string, 裁定人结果>();
  if (!行们.length) return 出;
  const org = await 读组织();
  const [日志们, 客户们] = await Promise.all([
    prisma.customerOwnerLog.findMany({ where: { id: { in: [...new Set(行们.flatMap((r) => (r.ownerLogId ? [r.ownerLogId] : [])))] } }, select: { id: true, fromOwnerId: true } }),
    看全部(() => prisma.customer.findMany({ where: { id: { in: [...new Set(行们.map((r) => r.customerId))] } }, select: { id: true, bizLine: true } })),
  ]);
  const 原 = new Map(日志们.map((l) => [l.id, l.fromOwnerId]));
  const 线 = new Map(客户们.map((c) => [c.id, c.bizLine]));
  for (const r of 行们) 出.set(r.id, 算裁定人(org, r.operatorUserId, 线.get(r.customerId), 原.get(r.ownerLogId ?? "") ?? r.objectorUserId, r.objectorUserId, r.toOwnerId));
  return 出;
}

const 剩几天 = (截止: Date, 现在: Date) => Math.max(0, Math.ceil((截止.getTime() - 现在.getTime()) / 86_400_000));

/** 我的异议：还能提的（「能提异议的通知」）和已经提了的（「我提的异议」）；过了 30 天没提的不列 */
export async function 我的异议(userId: string, 现在: Date = new Date()): Promise<{ 能提: 异议行[]; 已提: 异议行[] }> {
  const 行们 = await prisma.entTransferObjection.findMany({
    where: { objectorUserId: userId, status: { not: 异议已撤销 }, OR: [{ status: { not: 异议可提 } }, { expiresAt: { gte: 现在 } }] },
    orderBy: { createdAt: "desc" }, take: 200,
  });
  // 待裁定的按当前组织重算裁定人（裁定人停用 / 调岗后，这里显示的是现在能裁的人）
  const 现裁 = await 重算裁定人们(行们.filter((r) => r.status === 异议待裁定));
  const 裁们of = (r: (typeof 行们)[number]): string[] => 现裁.get(r.id)?.ids ?? (r.judgeIds ? (JSON.parse(r.judgeIds) as string[]) : []);
  const ids = [...new Set(行们.flatMap((r) => [r.operatorUserId, r.toOwnerId, ...裁们of(r)]))];
  const 名 = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const 转 = (r: (typeof 行们)[number]): 异议行 => ({
    id: r.id, 类别: r.kind === "项目" ? "项目" : "客户", 对象: r.targetName, 状态: r.status, 操作人: 名.get(r.operatorUserId) ?? "", 新负责人: 名.get(r.toOwnerId) ?? "",
    转让于: r.createdAt.toISOString(), 截止: r.expiresAt.toISOString(), 剩几天: 剩几天(r.expiresAt, 现在), 过期: r.expiresAt < 现在,
    ...(r.reason ? { 理由: r.reason } : {}),
    ...(r.judgeIds ? { 裁定人: 裁们of(r).map((x) => 名.get(x) ?? "").filter(Boolean).join("、") } : {}),
    ...(r.judgeRole ? { 裁定角色: 现裁.get(r.id)?.角色 ?? r.judgeRole } : {}),
    ...(r.judgeNote ? { 裁定说明: r.judgeNote } : {}),
  });
  return { 能提: 行们.filter((r) => r.status === 异议可提).map(转), 已提: 行们.filter((r) => r.status !== 异议可提).map(转) };
}

export type 提异议结果 = { ok: true; 裁定人: string[]; 角色: string } | { ok: false; error: string };

/** 提异议：理由必填 ≤200 字、30 天内、同一条只能提一次；提交时算裁定人并通知他们 */
export async function 提异议(me: { id: string; name: string }, id: unknown, 理由: unknown, 现在: Date = new Date()): Promise<提异议结果> {
  if (!企业版()) return { ok: false, error: "这个功能只有企业版有" };
  if (typeof id !== "string" || !id) return { ok: false, error: "没找到这条异议入口" };
  const 话 = typeof 理由 === "string" ? 理由.trim() : "";
  if (!话) return { ok: false, error: "请写异议理由" };
  if (话.length > 异议理由上限) return { ok: false, error: `异议理由最多 ${异议理由上限} 字` };
  const 行 = await prisma.entTransferObjection.findUnique({ where: { id } });
  // 别人的入口当没有，不透露存在
  if (!行 || 行.objectorUserId !== me.id) return { ok: false, error: "没找到这条异议入口" };
  if (行.status === 异议已撤销) return { ok: false, error: "这次转让已被撤销，不用再提异议" };
  if (行.status !== 异议可提) return { ok: false, error: "这一条已经提过异议了，等裁定" };
  if (现在 > 行.expiresAt) return { ok: false, error: `已超过 ${异议期天数} 天异议期，不能再提；有问题请直接找系统管理员` };
  const org = await 读组织();
  const [日志, 客户] = await Promise.all([
    prisma.customerOwnerLog.findUnique({ where: { id: 行.ownerLogId ?? "" }, select: { fromOwnerId: true } }),
    prisma.customer.findUnique({ where: { id: 行.customerId }, select: { bizLine: true } }),
  ]);
  const 裁 = 算裁定人(org, 行.operatorUserId, 客户?.bizLine, 日志?.fromOwnerId ?? me.id, me.id, 行.toOwnerId);
  if (!裁.ids.length) return { ok: false, error: "找不到裁定人，请联系系统管理员" };
  // 并发 / 双击：只有第一次把「可提」改成「待裁定」，后到的命中 0 行
  const r = await prisma.entTransferObjection.updateMany({
    where: { id: 行.id, status: 异议可提, objectorUserId: me.id },
    data: { status: 异议待裁定, reason: 话, submittedAt: 现在, judgeIds: JSON.stringify(裁.ids), judgeRole: 裁.角色 },
  });
  if (r.count !== 1) {
    const 现 = await prisma.entTransferObjection.findUnique({ where: { id: 行.id }, select: { status: true } });
    return { ok: false, error: 现?.status === 异议已撤销 ? "这次转让已被撤销，不用再提异议" : "这一条已经提过异议了，等裁定" };
  }
  const 人们 = await prisma.user.findMany({ where: { id: { in: [...裁.ids, 行.operatorUserId, 行.toOwnerId] } }, select: { id: true, name: true, active: true } });
  const 名 = new Map(人们.map((u) => [u.id, u.name]));
  await recordAudit({
    user: me, action: "assign", entity: "Customer", entityId: 行.customerId,
    summary: `${me.name} 对${行.kind}「${行.targetName}」的转让提了异议，由${裁.角色}裁定${裁.本人发起 ? "（本人发起、无人回避）" : ""}${裁.本人接手 ? "（本人接手、本人裁定（无人回避））" : ""}`,
    detail: { 异议: 行.id, 换负责人记录: 行.ownerLogId, 对象: 行.targetKey, 理由: 话, 裁定人: 裁.ids, ...(裁.本人发起 ? { 本人发起: true } : {}), ...(裁.本人接手 ? { 本人接手: true } : {}) },
  }).catch((e) => console.warn("[异议] 留痕没写上：", e));
  await notify(人们.filter((u) => 裁.ids.includes(u.id) && u.active).map((u) => u.id), {
    kind: "异议",
    title: `${me.name} 对${行.kind}「${行.targetName}」的转让提了异议，请你裁定（${名.get(行.operatorUserId) ?? ""} 转给 ${名.get(行.toOwnerId) ?? ""}）`,
    body: `理由：${话}`,
    link: "/objections",
    key: `objection:${行.id}`,
  });
  return { ok: true, 裁定人: 裁.ids.map((x) => 名.get(x) ?? "").filter(Boolean), 角色: 裁.角色 };
}

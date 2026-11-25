/**
 * 企业版项目换客户（2026-11-25，客户 E-277 第一批「项目挂错了客户」；方案 docs/合并客户-第一批-落地.md 第七节）。
 *
 * 一个项目连沟通、附件、项目联系人整体挪到另一位客户：
 *   - Project.customerId 改成目标客户；负责人、组员、节点、阶段、结局、来源、回款、提成都不动（跟着项目 id 走）
 *   - 挂在这个项目上的沟通（FollowUpProject）所属客户改成目标客户，含回收站里的；附件挂项目 / 沟通，不用动
 *   - 卡点冗余的 customerId 改成目标客户；必填拦截记录照旧记当时的（同合并客户 2.3）
 *   - 项目联系人（主联系人 + ProjectContact）还是原客户的人：挂靠到目标客户（ContactCustomer），在目标客户页看得到；已挂着的不重复
 *   - 项目关联客户里本来就有目标客户的：那行删掉（目标客户成了主客户，主客户不在这张表里占行）
 *   - 重复咨询原始客户是原客户的：改指目标客户，序号接在目标客户已有最大号后面
 * 拦法同合并客户（E-277「拦法同合并」）：两家客户都是自己负责（能删客户的角色），没结束的项目负责人也是自己；系统管理员可代换。
 * 交接中、标了无效、业务线不同、一家在公海一家不在（先领）都拦；两家都在公海只有系统管理员能换。订单阶段、有回款的也能换，预览里列明。
 * 不单独撤回：换错了再换回去（E-277「超过 30 天用项目换客户一个个挪回」）。操作日志项目、两位客户各一条。
 */
import type { PrismaClient, Prisma } from "@/generated/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 看已删 } from "./soft-delete-core";
import { 企业版 } from "./switch";
import { 权限组织, type 组织 } from "./org";
import { 能删除, 是系统管理员, 只读角色, 只看的人 } from "./permissions";
import { 交接中的客户 } from "./handover-db";
import { 跟着项目重算, 客户状态自动 } from "./cust-status-auto-db";
import { 存沟通后重算三态 } from "./tri-state-db";
import { notify } from "./notify";
import { 通知里的客户名 } from "./notice-mask";
import { 客户编号文字 } from "@/lib/customer-no";
import { 忘掉企业版范围 } from "./visibility";
import { 读客户, 重算最近跟进, 拦下, type 客户行, type 合并人 } from "./customer-merge";

type 库 = PrismaClient;
type Tx = Prisma.TransactionClient;
type 结果<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const 换客户通知种类 = "项目换客户";
export const 挂靠说明 = "随项目换客户挂过来";

const 项目列 = { id: true, name: true, customerId: true, ownerId: true, result: true, pooledAt: true, phase: true, contactId: true, repeatOfCustomerId: true } satisfies Prisma.ProjectSelect;
type 项目行 = Prisma.ProjectGetPayload<{ select: typeof 项目列 }>;

const 名 = (c: 客户行) => 通知里的客户名(c);
const 有值 = (v: unknown) => v !== null && v !== undefined && v !== "";

async function 拦的原因(db: Tx | 库, p: 项目行 | null, 原: 客户行 | null, 目标: 客户行 | null, me: 合并人, org: 组织 | null): Promise<string[]> {
  if (!企业版()) return ["只有企业版能给项目换客户"];
  if (!p) return ["项目不存在或已删除，刷新看看"];
  if (!原 || !目标) return ["客户不存在或已删除，刷新看看"];
  if (原.id === 目标.id) return ["项目已经在这位客户名下，请选另一位客户"];
  if (!org || 只读角色(me, org) || 只看的人(org, me.id)) return ["你只能看，不能给项目换客户"];
  const 管 = 是系统管理员(me, org);
  const 因: string[] = [];
  if (!!原.pool !== !!目标.pool) 因.push(`「${名(原.pool ? 原 : 目标)}」在公海里，先领出来再换`);
  else if (原.pool && !管) 因.push("两位客户都在公海里，只有系统管理员能给项目换客户");
  if (!管 && !原.pool) {
    const 不是我的 = [原, 目标].filter((c) => !能删除(me, org, c.salesOwnerId));
    if (不是我的.length) 因.push(`${不是我的.map((c) => `「${名(c)}」`).join("")}不是你负责的，只能在两位都由你负责的客户之间换；要换请找系统管理员`);
    else if (!p.result && !p.pooledAt && p.ownerId && p.ownerId !== me.id) 因.push("这个项目是同事负责、还没结束，不能直接换客户；请找系统管理员");
  }
  const 交接 = await 交接中的客户([原.id, 目标.id], db as Tx);
  for (const c of [原, 目标]) if (交接.has(c.id)) 因.push(`「${名(c)}」正在转让交接中，等接手人确认或撤回交接后再换`);
  for (const c of [原, 目标]) if (c.poolInvalidAt) 因.push(`「${名(c)}」标了无效客户，先由系统管理员恢复再换`);
  if (有值(原.bizLine) && 有值(目标.bizLine) && 原.bizLine !== 目标.bizLine) 因.push(`两位客户业务线不同（${原.bizLine} / ${目标.bizLine}），不能换`);
  return 因;
}

export type 换客户预览结果 = {
  能换: boolean;
  原因: string[];
  /** 确认框列明：订单阶段、回款几笔、挪几条沟通、几位项目联系人挂靠过去 */
  条数: { 沟通: number; 回款: number; 订单: boolean; 联系人: number } | null;
};

async function 项目联系人们(db: Tx | 库, p: 项目行): Promise<string[]> {
  const ids = (await db.projectContact.findMany({ where: { projectId: p.id }, select: { contactId: true } })).map((x) => x.contactId);
  return [...new Set([...(p.contactId ? [p.contactId] : []), ...ids])];
}

export async function 项目换客户预览(db: 库, projectId: string, 目标id: string, me: 合并人): Promise<换客户预览结果> {
  const org = await 权限组织();
  const p = await 看全部(() => db.project.findFirst({ where: { id: projectId, deletedAt: null }, select: 项目列 }));
  const [原, 目标] = await Promise.all([p ? 读客户(db, p.customerId) : null, 读客户(db, 目标id)]);
  const 原因 = await 拦的原因(db, p, 原, 目标, me, org);
  if (原因.length || !p) return { 能换: false, 原因, 条数: null };
  const [沟通, 回款, 人们] = await 看全部(() => Promise.all([
    db.followUp.count({ where: { deletedAt: null, projectNode: { projectId: p.id } } }),
    db.entProjectPayment.count({ where: { projectId: p.id } }),
    项目联系人们(db, p),
  ]));
  return { 能换: true, 原因: [], 条数: { 沟通, 回款, 订单: p.phase === "订单", 联系人: 人们.length } };
}

export async function 项目换客户(db: 库, projectId: string, 目标id: string, me: 合并人, 现在: Date = new Date()): Promise<结果<{ 沟通: number; 挂靠: number }>> {
  const org = await 权限组织();
  const 开 = await 客户状态自动();
  let 通知要: { p: 项目行; 原: 客户行; 目标: 客户行 } | null = null;
  let r: { 沟通: number; 挂靠: number };
  try {
    r = await 看已删(() =>
      看全部(() =>
        db.$transaction(async (tx) => {
          const p = await tx.project.findFirst({ where: { id: projectId, deletedAt: null }, select: 项目列 });
          const [原, 目标] = [p ? await 读客户(tx, p.customerId) : null, await 读客户(tx, 目标id)];
          const 原因 = await 拦的原因(tx, p, 原, 目标, me, org);
          if (原因.length) throw new 拦下(原因.join("；"));
          const 结 = await 挪项目(tx, p!, 原!, 目标!, me, 现在);
          await 重算最近跟进(tx, 原!.id);
          await 重算最近跟进(tx, 目标!.id);
          await 跟着项目重算(tx, 开, [原!.id, 目标!.id]);
          通知要 = { p: p!, 原: 原!, 目标: 目标! };
          return 结;
        }, { timeout: 60_000 }),
      ),
    );
  } catch (e) {
    if (e instanceof 拦下) return { ok: false, error: e.message };
    throw e;
  }
  忘掉企业版范围();
  const 要 = 通知要 as { p: 项目行; 原: 客户行; 目标: 客户行 } | null;
  if (要) {
    await 存沟通后重算三态([要.原.id, 要.目标.id], 现在).catch((e) => console.warn("[项目换客户] 三态没重算上：", e instanceof Error ? e.message : e));
    // 系统管理员代换时：项目负责人、两位客户负责人不是操作人本人的各一条（同合并客户第六节第 3 条，我方加的）
    await notify([要.p.ownerId, 要.原.salesOwnerId, 要.目标.salesOwnerId].filter((u) => u && u !== me.id), {
      kind: 换客户通知种类,
      title: `项目「${要.p.name}」换到了「${名(要.目标)}」`,
      body: `${me.name}把项目「${要.p.name}」从「${名(要.原)}」${客户编号文字(要.原.customerNo) ?? ""}换到了「${名(要.目标)}」${客户编号文字(要.目标.customerNo) ?? ""}，沟通、附件、项目联系人跟着项目走，负责人不变。`,
      link: `/customers/${要.目标.id}?project=${要.p.id}`,
      key: `project-move:${要.p.id}:${要.目标.id}:${Date.now()}`,
    });
  }
  return { ok: true, ...r! };
}

async function 挪项目(tx: Tx, p: 项目行, 原: 客户行, 目标: 客户行, me: 合并人, 现在: Date): Promise<{ 沟通: number; 挂靠: number }> {
  await tx.project.update({ where: { id: p.id }, data: { customerId: 目标.id } });
  // 重复咨询：原始客户是原客户的改指目标客户，序号接在后面
  if (p.repeatOfCustomerId === 原.id) {
    const 序 = ((await tx.project.aggregate({ where: { repeatOfCustomerId: 目标.id }, _max: { repeatSeq: true } }))._max.repeatSeq ?? 0) + 1;
    await tx.project.update({ where: { id: p.id }, data: { repeatOfCustomerId: 目标.id, repeatSeq: 序 } });
  }
  const 沟通们 = (await tx.followUpProject.findMany({ where: { projectId: p.id }, select: { followUpId: true } })).map((x) => x.followUpId);
  const 沟通 = 沟通们.length ? (await tx.followUp.updateMany({ where: { id: { in: 沟通们 }, customerId: 原.id }, data: { customerId: 目标.id } })).count : 0;
  await tx.entBlocker.updateMany({ where: { projectId: p.id, customerId: 原.id }, data: { customerId: 目标.id } });
  await tx.projectCustomer.deleteMany({ where: { projectId: p.id, customerId: 目标.id } });
  // 项目联系人挂靠到目标客户（主客户就是目标客户的、已挂着的跳过）
  const 人们 = await 项目联系人们(tx, p);
  const 已在 = new Set([
    ...(await tx.contactCustomer.findMany({ where: { customerId: 目标.id, contactId: { in: 人们 } }, select: { contactId: true } })).map((x) => x.contactId),
    ...(await tx.contact.findMany({ where: { id: { in: 人们 }, customerId: 目标.id }, select: { id: true } })).map((x) => x.id),
  ]);
  const 要挂 = 人们.filter((id) => !已在.has(id));
  if (要挂.length) await tx.contactCustomer.createMany({ data: 要挂.map((contactId) => ({ contactId, customerId: 目标.id, note: 挂靠说明 })) });
  const 话 = `项目换客户：「${p.name}」从「${名(原)}」${客户编号文字(原.customerNo) ?? ""}换到「${名(目标)}」${客户编号文字(目标.customerNo) ?? ""}（${沟通} 条沟通${要挂.length ? `，${要挂.length} 位项目联系人挂靠过去` : ""}）`;
  const detail = JSON.stringify({ projectId: p.id, 从: 原.id, 到: 目标.id, 沟通, 挂靠: 要挂 });
  await tx.auditLog.createMany({
    data: [
      { userId: me.id, userName: me.name, action: "project-move-customer", entity: "Project", entityId: p.id, at: 现在, summary: 话, detail },
      { userId: me.id, userName: me.name, action: "project-move-customer", entity: "Customer", entityId: 原.id, at: 现在, summary: 话, detail },
      { userId: me.id, userName: me.name, action: "project-move-customer", entity: "Customer", entityId: 目标.id, at: 现在, summary: 话, detail },
    ],
  });
  return { 沟通, 挂靠: 要挂.length };
}

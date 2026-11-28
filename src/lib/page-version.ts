import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { 页面种类 } from "@/lib/page-fresh";

/**
 * 「这页数据变了没」（跳转优化 PR-D）：按页面主体和它挂的几样东西的更新时间 / 条数算一个短串，
 * 变了才让前端 router.refresh。只回哈希，不回任何字段；可见范围走 prisma 的限定层（和页面同一个口径）：
 * 被转走 / 看不到了，主体读不到 → 回 "gone"，和之前的不同 → 前端刷新，由页面服务端判「无权」。
 * 返回 null = 这页不支持 / 参数不对（前端当没有基线、不刷）。
 */
const 短 = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const 时 = (d: Date | null | undefined) => (d ? d.getTime() : 0);

type 聚合 = { _count: { _all: number }; _max: { updatedAt?: Date | null; createdAt?: Date | null; at?: Date | null } };
/** 条数 + 最近更新（没有 updatedAt 的表用 createdAt / at：只增不改的表，原地改的靠删了重建换新时间） */
const 串 = (x: { _count: unknown; _max: unknown }) => {
  const a = x as 聚合;
  return `${a._count._all}/${时(a._max.updatedAt ?? a._max.createdAt ?? a._max.at)}`;
};

export async function 页面版本(种类: 页面种类, id: string, 查询: URLSearchParams): Promise<string | null> {
  if (种类 === "customer") {
    // 页面上露出的东西逐样纳入。ContactMethod 改号是「删了重建」（存联系人号码，customer-v2-db.ts）→ createdAt 换新；
    // CustomerExtra（外贸档案）无 updatedAt：写它会顺手推客户 updatedAt（写外贸档案，碰版本默认开；新建 / 导入的客户本来就是新的）→ 已由 c.updatedAt 覆盖。
    // 关联客户 / 推荐 / 渠道负责人 / 归属：EntCustomerLink 单独数，其余是 Customer 自己的列（updatedAt 覆盖）；公海 / 领取行单独取
    const c = await prisma.customer.findUnique({ where: { id }, select: { updatedAt: true, salesOwnerId: true, channelOwnerId: true, deletedAt: true, pool: { select: { at: true, userId: true } }, claim: { select: { at: true, userId: true } } } });
    if (!c) return "gone";
    const 联系人们 = await prisma.contact.findMany({ where: { customerId: id }, select: { id: true, updatedAt: true } });
    const 联系人最近 = 联系人们.reduce((m, x) => Math.max(m, x.updatedAt.getTime()), 0);
    const [沟通, 项目, 计划, 待办, 合同, 号码, 附件, 关联, 下游, 项目客户] = await Promise.all([
      prisma.followUp.aggregate({ where: { customerId: id }, _count: { _all: true }, _max: { updatedAt: true } }),
      prisma.project.aggregate({ where: { customerId: id }, _count: { _all: true }, _max: { updatedAt: true } }),
      prisma.followPlan.aggregate({ where: { customerId: id }, _count: { _all: true }, _max: { updatedAt: true } }),
      prisma.task.aggregate({ where: { customerId: id }, _count: { _all: true }, _max: { updatedAt: true } }),
      prisma.contract.aggregate({ where: { customerId: id }, _count: { _all: true }, _max: { updatedAt: true } }),
      prisma.contactMethod.aggregate({ where: { customerId: id }, _count: { _all: true }, _max: { createdAt: true } }),
      prisma.attachment.aggregate({ where: { contactId: { in: 联系人们.map((x) => x.id) } }, _count: { _all: true }, _max: { createdAt: true } }),
      prisma.entCustomerLink.aggregate({ where: { OR: [{ customerId: id }, { otherId: id }] }, _count: { _all: true }, _max: { createdAt: true } }),
      prisma.customer.aggregate({ where: { OR: [{ referrerCustomerId: id }, { attributionCustomerId: id }] }, _count: { _all: true }, _max: { updatedAt: true } }),
      prisma.projectCustomer.aggregate({ where: { customerId: id }, _count: { _all: true }, _max: { createdAt: true } }),
    ]);
    const 池 = `${时(c.pool?.at)}/${c.pool?.userId ?? ""}|${时(c.claim?.at)}/${c.claim?.userId ?? ""}`;
    return 短(`c|${时(c.updatedAt)}|${c.salesOwnerId}|${c.channelOwnerId ?? ""}|${时(c.deletedAt)}|${池}|${联系人们.length}/${联系人最近}|${[沟通, 项目, 计划, 待办, 合同, 号码, 附件, 关联, 下游, 项目客户].map(串).join("|")}`);
  }
  if (种类 === "project") {
    // 顶部客户卡（load.ts）：客户转走后只读卡露哪些字段看归属 → 客户的 salesOwnerId / updatedAt / deletedAt 一并算
    const p = await prisma.project.findUnique({ where: { id }, select: { updatedAt: true, ownerId: true, node: true, pooledAt: true, customerId: true, customer: { select: { updatedAt: true, salesOwnerId: true, deletedAt: true, pool: { select: { at: true, userId: true } }, claim: { select: { at: true, userId: true } } } } } });
    if (!p) return "gone";
    const [沟通, 日志, 成员, 计划, 附件, 联系人] = await Promise.all([
      prisma.followUp.aggregate({ where: { projectNode: { is: { projectId: id } } }, _count: { _all: true }, _max: { updatedAt: true } }),
      prisma.projectNodeLog.aggregate({ where: { projectId: id }, _count: { _all: true }, _max: { at: true } }),
      prisma.projectMember.findMany({ where: { projectId: id }, select: { userId: true, roleId: true, inviteStatus: true } }),
      prisma.followPlan.aggregate({ where: { projectId: id }, _count: { _all: true }, _max: { updatedAt: true } }),
      prisma.attachment.aggregate({ where: { projectId: id }, _count: { _all: true }, _max: { createdAt: true } }),
      // 顶部客户卡露联系人：客户的联系人条数 + 最近更新
      p.customerId ? prisma.contact.aggregate({ where: { customerId: p.customerId }, _count: { _all: true }, _max: { updatedAt: true } }) : Promise.resolve({ _count: { _all: 0 }, _max: { updatedAt: null } }),
    ]);
    const 队 = 成员.map((m) => `${m.userId}:${m.roleId ?? ""}:${m.inviteStatus}`).sort().join(",");
    const 客 = p.customer ? `${时(p.customer.updatedAt)}/${p.customer.salesOwnerId}/${时(p.customer.deletedAt)}/${时(p.customer.pool?.at)}/${p.customer.pool?.userId ?? ""}|${时(p.customer.claim?.at)}/${p.customer.claim?.userId ?? ""}` : "";
    return 短(`p|${时(p.updatedAt)}|${p.ownerId}|${p.node}|${时(p.pooledAt)}|${客}|${队}|${[沟通, 日志, 计划, 附件, 联系人].map(串).join("|")}`);
  }
  if (种类 === "customer-list") {
    // 列表：条件和页面同一个函数（客户筛选条件）；没带范围时比页面看到的集合大，只会多刷、不会漏刷
    const { 客户筛选条件 } = await import("@/app/(app)/customers/query");
    const sp: Record<string, string> = {};
    for (const [k, v] of 查询) sp[k] = v;
    const where = await 客户筛选条件(sp as never);
    const a = await prisma.customer.aggregate({ where, _count: { _all: true }, _max: { updatedAt: true } });
    return 短(`l|${串(a)}`);
  }
  return null;
}

/**
 * 页面渲染时顺手算一份版本（随页面下发，components/RenderedVersion；前端拿它和现在的比，见 lib/page-fresh）。
 * 和 /api/page-version 同一个函数同一个口径；不支持的页 / 出错回 null（前端当没有基线、不刷）。
 * 页面一进来就开算（不等页面数据读完）：版本只会比页面数据更旧，不会漏刷。
 */
export async function 渲染版本(种类: 页面种类, id: string, 查询: Record<string, string | string[] | undefined> = {}): Promise<string | null> {
  try {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(查询)) for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, x);
    const { 认页面 } = await import("@/lib/page-fresh");
    const 路径 = 种类 === "customer" ? `/customers/${id}` : 种类 === "project" ? `/projects/${id}` : "/customers";
    const 页 = 认页面(路径, q.toString());
    if (!页) return null;
    return await 页面版本(页.种类, 页.id, new URLSearchParams(页.查询));
  } catch {
    return null;
  }
}

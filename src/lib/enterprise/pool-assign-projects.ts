import type { Prisma } from "@/generated/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import type { 组织 } from "@/lib/enterprise/org";
import { 记转让 } from "@/lib/project/db";
import { 单项目客户跟着领, 客户整包出公海, type 整包出公海 } from "@/lib/enterprise/pool-link";
import { 历史负责人 } from "@/lib/project/pool-owner";
import { 换负责人待办, 待办痕 } from "@/lib/project/carry-tasks";
import type { 同事待分配条 } from "@/lib/enterprise/notice-sources";
import { 公海项目市场转, 转客户给销售 } from "@/lib/enterprise/market-transfer";
import type { 带走的 } from "@/lib/carry-over-db";
import { 换负责人 } from "@/lib/project/owner-write";
import { 验证中不能改派 } from "@/lib/project/lead-verify-guard";

/**
 * 分配时客户在客户公海里、整包出公海的那几位（P-公海-10）：撤销条原样带回 撤销公海项目，整包退回。
 * 形状同客户公海分配的撤销条（原 = 客户 id + 出公海前的负责人、带过来、公海项目），撤销时照 撤销公海 认，前端传的不信
 */
export type 整包撤销 = { 原: { id: string; 值: string }[]; 带过来: 带走的; 公海项目: string[] };

/** 分公海项目事务外先备好的：组织（市场转客户要认角色）、分配方式叫法、带不带待办（C-06） */
export type 分项目上下文 = { org: 组织 | null; way: string; 带: boolean | undefined };

export type 分项目们结果 = {
  分到: string[];
  没分到: { id: string; 原因: string }[];
  /** 整包出公海时一起带出来的别的公海项目个数、整包出公海的客户几位（分配通知用） */
  跟来: number;
  连客户: number;
  整包: 整包撤销;
  /** 随客户换了负责人的同事待分配项目：事务提交后再发通知（P-转-19） */
  随客户: 同事待分配条[];
};

/**
 * 在调用方的事务里把线索公海里的几个项目分给 给（10-30 P0 #6，11-11 从 pool/actions 分配公海项目 挪进库层：公海页同时勾了客户行和项目行，
 * 要和分客户放进同一个事务，持有上限合起来整批核，M-公海-18）。不核上限，调用方整批写完再 整批核上限。
 * 规矩同 领取公海项目：标了无效的客户的项目分不了、已结束的项目分不了（X-70）、验证中的不能改派（X-77）；记一行 pool-claim（操作人 = 我，到 = 给的那位），撤销认的就是这一行；
 * 客户不在客户公海里：分到的只换项目负责人，客户负责人不变；客户在客户公海里：客户和名下别的公海项目整包出公海给这位（P-公海-10）；
 * 客户还在市场手里、分给销售 = 市场第一次分给销售，客户整体给他，记「分配」（P-公海-11）。分不了的说原因、不拦别的。
 * 老签约调用方在事务外先钉住；事务里只用 tx
 */
export async function 在事务里分公海项目们(
  tx: Prisma.TransactionClient, 操作人: string, 给: string, ids: string[], 上下文: 分项目上下文,
): Promise<分项目们结果> {
  const { org, way, 带 } = 上下文;
  const 出: 分项目们结果 = { 分到: [], 没分到: [], 跟来: 0, 连客户: 0, 整包: { 原: [], 带过来: { 计划: [], 待办: [], 商机: [], 项目: [] }, 公海项目: [] }, 随客户: [] };
  for (const id of ids) {
    let 包: 整包出公海 | null = null;
    let 同事待分配: 同事待分配条[] = [];
    const 原因 = await (async () => {
      const p = await tx.project.findUnique({ where: { id }, select: { id: true, name: true, phase: true, node: true, result: true, ownerId: true, pooledAt: true, customerId: true } });
      if (!p) return "这个项目已经不在了";
      if (!p.pooledAt) return "已经被人领走了";
      // 已结束的项目不能单独分（X-70、P-公海-02，同 领取公海项目）：老数据里已在公海又有结局的，要分走客户整包
      if (企业版() && p.result) return `这个项目已经结束（${p.result}），不能单独分配`;
      // 验证中不能改派（X-77）：进公海时验证已清（老数据可能还挂着），挂着的先撤回验证
      const 验 = await 验证中不能改派(tx, id);
      if (验) return 验;
      const c = await tx.customer.findUnique({ where: { id: p.customerId }, select: { poolInvalidAt: true, pool: { select: { customerId: true } } } });
      if (c?.pool && c.poolInvalidAt) return "客户标了无效，要系统管理员先恢复";
      const 出整包 = 企业版() && !!c?.pool;
      // 客户还在市场手里、分给销售 = 市场第一次分给销售，客户整体给他，记「分配」（P-公海-11；不看客户创建人），同事待分配的随客户进手
      const 转 = 出整包 || !org ? null : await 公海项目市场转(tx, org, p, 给, false);
      await tx.project.update({ where: { id }, data: { ...换负责人(给), pooledAt: null, nextStepAt: null, nextStepText: null } });
      // 公海里的项目 ownerId 是空的（企业版进公海清负责人）：从谁 记留痕里的历史负责人
      const 原 = (await 历史负责人(tx, id)) ?? (p.ownerId || null);
      // 市场转客户的待办计划还归市场（P-转-10），勾不算数
      const 这带 = 转 ? undefined : 带;
      const 几条 = await 换负责人待办(tx, p, 原, 给, 这带);
      await 记转让(tx, p, 操作人, 原, 给, "pool-claim", 待办痕(这带, 几条));
      if (出整包) 包 = await 客户整包出公海(tx, p.customerId, 给, 操作人, 带, "pool-assign");
      else await 单项目客户跟着领(tx, p.customerId, 给, 操作人, 这带);
      if (转) 同事待分配 = (await 转客户给销售(tx, p.customerId, 转.原, 给, 操作人, way)).同事待分配;
      return null;
    })();
    if (原因) {
      出.没分到.push({ id, 原因 });
      continue;
    }
    出.分到.push(id);
    出.随客户.push(...同事待分配);
    const 带来 = 包 as 整包出公海 | null;
    if (带来) {
      出.连客户 += 1;
      出.跟来 += 带来.公海项目.length;
      出.整包.原.push({ id: 带来.customerId, 值: 带来.旧 });
      出.整包.公海项目.push(...带来.公海项目);
      for (const k of ["计划", "待办", "商机", "项目"] as const) 出.整包.带过来[k]!.push(...(带来.带过来[k] ?? []));
    }
  }
  return 出;
}

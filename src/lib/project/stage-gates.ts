/**
 * 企业版三大阶段的两道门（2026-10-26 会定，只企业版；开关关着一律放行、不查库、不写）：
 *   1. 记沟通要选项目当前阶段 + 客户是否明确回复（一条沟通只挂一个项目，FollowUpProject 本来就是一条一行）；
 *   2. 有效线索要至少一条有效沟通（客户明确回复了的）：没有就推不过「线索验证」（MQL 判合格）。
 * 标记存 EntFollowUpMark（迁移 055），团队版、桌面端那张表一直空着。
 */
import type { Prisma } from "@/generated/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 节点序号, 字典of, 是阶段, type 位置 } from "./nodes";
import type { 组织规则 } from "./org-rules";

/** 过了这个节点才算有效线索（MQL 合格）：往后推要先有一条有效沟通 */
export const 有效线索节点 = "线索验证";
/** MQL 不合格退回潜客培育时，下一步计划内容的字数上限（必填） */
export const 培育计划上限 = 200;
/** 线索验证（P12）判无效时，无效原因不走字典自由填的字数上限 */
export const 无效原因上限 = 200;
export const 缺有效沟通 = "线索验证合格要先有一条客户明确回复的沟通：记一条沟通、选「客户明确回复了」再推";

/** 这个项目有几条有效沟通（客户明确回复了的，跟进还在的） */
export async function 有效沟通数(tx: Prisma.TransactionClient, projectId: string): Promise<number> {
  const 标 = await tx.entFollowUpMark.findMany({ where: { projectId, replied: true }, select: { followUpId: true } });
  if (!标.length) return 0;
  return tx.followUpProject.count({ where: { projectId, followUpId: { in: 标.map((m) => m.followUpId) } } });
}

/** 后台开了「前两个节点要沟通」时管的节点：线索、商机两个阶段各自的前两个节点 */
export function 要沟通的节点(): string[] {
  const 字典 = 字典of(true);
  return [...字典.节点们.线索.slice(0, 2), ...字典.节点们.商机.slice(0, 2)];
}
export const 缺本节点沟通 = (node: string) => `「${node}」要先记一条沟通才能往后推：后台开了「线索、商机前两个进程各要一条沟通」`;

/**
 * 往前推到 到：线索阶段越过「线索验证」要先有有效沟通；
 * 后台开了 阶段.前两节点要沟通（默认关）时，从线索、商机的前两个节点往后推，这个节点上要记过至少一条沟通（FollowUpProject.node）。
 * 不是企业版、不是往这儿推的，一律 null
 */
export async function 企业版推进关(tx: Prisma.TransactionClient, p: 位置 & { id: string }, 到: 位置, 规则?: 组织规则): Promise<string | null> {
  if (!企业版() || p.result) return null;
  const 字典 = 字典of(true);
  if (节点序号(到, 字典) <= 节点序号(p, 字典)) return null;
  if (规则?.阶段.前两节点要沟通 && 要沟通的节点().includes(p.node)) {
    if (!(await tx.followUpProject.count({ where: { projectId: p.id, node: p.node } }))) return 缺本节点沟通(p.node);
  }
  if (p.phase !== "线索") return null;
  if (节点序号(到, 字典) <= 节点序号({ phase: "线索", node: 有效线索节点 }, 字典)) return null;
  return (await 有效沟通数(tx, p.id)) > 0 ? null : 缺有效沟通;
}

/** 企业版记沟通：阶段要选、要是项目当前阶段；客户是否明确回复要选。不是企业版 null */
export function 记沟通阶段问题(input: { 阶段?: unknown; 明确回复?: unknown }, p: { phase: string }): string | null {
  if (!企业版()) return null;
  if (!是阶段(input.阶段)) return "记沟通要选项目当前所在的阶段";
  if (input.阶段 !== p.phase) return `项目现在在${p.phase}阶段，沟通只能记在${p.phase}阶段`;
  if (typeof input.明确回复 !== "boolean") return "请选：客户明确回复了吗";
  return null;
}

/** 记下这条沟通的阶段和明确回复；不是企业版不写 */
export async function 记沟通标记(tx: Prisma.TransactionClient, followUpId: string, projectId: string, phase: string, replied: boolean): Promise<void> {
  if (!企业版()) return;
  await tx.entFollowUpMark.create({ data: { followUpId, projectId, phase, replied } });
}

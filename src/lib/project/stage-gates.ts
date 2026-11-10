/**
 * 企业版三大阶段的两道门（2026-10-26 会定，只企业版；开关关着一律放行、不查库、不写）：
 *   1. 记沟通要选项目当前阶段（一条沟通只挂一个项目，FollowUpProject 本来就是一条一行）；
 *   2. 有效线索要先有有效沟通：没有就推不过「线索验证」（MQL 判合格）。
 *      11-05 客户定去掉「客户明确回复了吗」：有效沟通 = 线索验证节点配的必填项都填了，没配就看需求状态选了（required.ts 有效沟通还差）。
 * 标记存 EntFollowUpMark（迁移 055），团队版、桌面端那张表一直空着。
 */
import type { Prisma } from "@/generated/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 节点序号, 字典of, 是阶段, 本套位置, 同名们, type 位置 } from "./nodes";
import type { 组织规则 } from "./org-rules";

/** 过了这个节点才算有效线索（MQL 合格）：往后推要先有一条有效沟通 */
export const 有效线索节点 = "线索验证";
export const 缺有效沟通 = "线索验证合格要先填好「线索验证」的必填项";
/** 新建（向导、客户页建项目、AI 建档）只能落在线索验证及之前：建的时候还填不了线索验证的必填项（11-05） */
export const 建档不能过线索验证 = "新建只能落在「线索验证」及之前：在项目里填好线索验证的必填项后再往下推";
/** 带上还差哪几项：「…：还差需求状态、项目级别」 */
export const 缺有效沟通还差 = (差: string[]) => (差.length ? `${缺有效沟通}：还差${差.join("、")}` : 缺有效沟通);

/** 这个项目有几条勾了「客户明确回复了」的沟通（11-05 起不再当门槛，只留旧数据统计用） */
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
 * 往前推到 到：线索阶段越过「线索验证」要先有有效沟通（有效沟通差：调用方按组织规则算出还差的叫法；不给就看需求状态选了没有）；
 * 后台开了 阶段.前两节点要沟通（默认关）时，从线索、商机的前两个节点往后推，这个节点上要记过至少一条沟通（FollowUpProject.node）。
 * 不是企业版、不是往这儿推的，一律 null
 */
export async function 企业版推进关(tx: Prisma.TransactionClient, p: 位置 & { id: string }, 到: 位置, 规则?: 组织规则, 有效沟通差?: () => Promise<string[]>): Promise<string | null> {
  // 有结局的改回到后面的节点也照拦（11-03 A5-1）；结局本身不归这里管（到.result 有值不算往前推）
  if (!企业版() || 到.result) return null;
  const 字典 = 字典of(true);
  if (节点序号(到, 字典) <= 节点序号(p, 字典)) return null;
  // 库里存着旧名的项目（企业版 10-31 改名）先对到新名；沟通挂的节点新旧名都算
  const 节 = 本套位置(p, 字典).node;
  if (规则?.阶段.前两节点要沟通 && 要沟通的节点().includes(节)) {
    if (!(await tx.followUpProject.count({ where: { projectId: p.id, node: { in: 同名们(节) } } }))) return 缺本节点沟通(节);
  }
  if (p.phase !== "线索") return null;
  if (节点序号(到, 字典) <= 节点序号({ phase: "线索", node: 有效线索节点 }, 字典)) return null;
  if (有效沟通差) {
    const 差 = await 有效沟通差();
    return 差.length ? 缺有效沟通还差(差) : null;
  }
  const 行 = await tx.project.findUnique({ where: { id: p.id }, select: { demandStatus: true } });
  return 行?.demandStatus?.trim() ? null : 缺有效沟通还差(["需求状态"]);
}

/** 企业版记沟通：阶段要选、要是项目当前阶段（11-05 起不再问客户是否明确回复）。不是企业版 null */
export function 记沟通阶段问题(input: { 阶段?: unknown }, p: { phase: string }): string | null {
  if (!企业版()) return null;
  if (!是阶段(input.阶段)) return "记沟通要选项目当前所在的阶段";
  if (input.阶段 !== p.phase) return `项目现在在${p.phase}阶段，沟通只能记在${p.phase}阶段`;
  return null;
}

/** 记下这条沟通的阶段（replied 11-05 起界面不再问，一律 false，列留着不删）；不是企业版不写 */
export async function 记沟通标记(tx: Prisma.TransactionClient, followUpId: string, projectId: string, phase: string, replied: boolean): Promise<void> {
  if (!企业版()) return;
  await tx.entFollowUpMark.create({ data: { followUpId, projectId, phase, replied } });
}

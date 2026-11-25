/**
 * 合并客户挪过来的换负责人记录（11-25，PR #457 服务端第二单）。
 *
 * 合并时 B 的 CustomerOwnerLog 整体改指 A（E-277「历史负责人挪到留下那家，公海回避照认」）：左栏历史负责人、超时链
 *（reply-overdue.ts 按客户读换人记录）照认这些行。但「合并本身不拨钟、留下那家自己的历史优先」（总控 11-25 定，我方决定）：
 *   - 三态（tri-state-db.ts 收三态客户、tri-state-transfer.ts 当下归零）：B 的转让不拨 A 的钟、不算 A 的转让次数
 *   - 历史变更「建档」的首任负责人：只认 A 自己的
 *   - 公海前负责人 / 公海原负责人（领取带活、公海回避、撤销放进公海）：两家都在公海时只认 A 自己那条 pool-release
 * 这些读法排除合并挪来的行。哪些行是挪来的，认合并单明细（customer-merge.ts 合并明细.改指["customerOwnerLog.customerId"]），
 * 不给行打标记：撤回合并时这些行改回 B，自然不再挂在 A 名下，行为照旧。
 * 不看合并单状态：撤回时没还原、留在 A 的那几行照样算挪来的。连着并（B 并进 A、A 再并进 C）：A→C 那张单挪的就是当时挂 A 的全部，
 * 已含 B 来的那几行，C 上一并排除
 */
import type { Prisma } from "@/generated/prisma";

/** customer-merge.ts 客户单、改指键("customerOwnerLog", "customerId")：两边要一致（tests/ent-customer-merge-owner-log.test.ts 按行为钉住） */
const 客户单 = "客户";
const 换人键 = "customerOwnerLog.customerId";

type 读合并单 = Pick<Prisma.TransactionClient, "entCustomerMerge">;

/** 合并挪到这几家名下的换负责人记录 id */
export async function 合并挪来的换人记录(db: 读合并单, customerIds: readonly string[]): Promise<Set<string>> {
  const 出 = new Set<string>();
  const ids = [...new Set(customerIds)];
  for (let i = 0; i < ids.length; i += 400) {
    const 单们 = await db.entCustomerMerge.findMany({ where: { kind: 客户单, intoId: { in: ids.slice(i, i + 400) } }, select: { detail: true } });
    for (const m of 单们) {
      let 明: unknown;
      try { 明 = JSON.parse(m.detail); } catch { continue; }
      const 行 = (明 as { 改指?: Record<string, unknown> } | null)?.改指?.[换人键];
      if (Array.isArray(行)) for (const id of 行) if (typeof id === "string") 出.add(id);
    }
  }
  return 出;
}

/** 换负责人记录里去掉合并挪来的（留下那家自己的）；没有记录不查合并单 */
export async function 去掉合并挪来的<T extends { id: string; customerId: string }>(db: 读合并单, 行们: T[]): Promise<T[]> {
  if (!行们.length) return 行们;
  const 挪来 = await 合并挪来的换人记录(db, 行们.map((r) => r.customerId));
  return 挪来.size ? 行们.filter((r) => !挪来.has(r.id)) : 行们;
}

/**
 * 线索验证（P12）在等的时候拦住别的入口：改节点、放回公海、判 MQL 都先问一句。单独一个文件，db.ts 引它不绕回 lead-verify.ts。
 * 等复核（市场复核 / 总管理终判）时负责人、老板都不能自己推、点结局、放公海，免得绕过复核；
 * 复核有结果、等销售终验 / 认领时也拦，要在详情页「线索验证」里点（那边带 验证放行 调进来）。不是企业版 null
 */
import type { Prisma } from "@/generated/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 看全部 } from "@/lib/team-scope";

export const 等复核的 = ["市场复核", "总管理终判"] as const;

export async function 等复核拦(db: Pick<Prisma.TransactionClient, "entLeadVerify">, projectId: string): Promise<string | null> {
  if (!企业版()) return null;
  const v = await db.entLeadVerify.findUnique({ where: { projectId }, select: { pending: true } });
  if (!v?.pending) return null;
  if ((等复核的 as readonly string[]).includes(v.pending)) return `这条线索在等${v.pending}，复核完再动`;
  return `这条线索复核有结果了，先在详情页「线索验证」里处理（${v.pending}）`;
}

/**
 * 验证中（等复核、等销售：pending 有值）的线索不能分配、不能改负责人（X-77、M-线索-02）：复核人、终验销售跟着负责人走，改派会把在等的那一步换了人。
 * 手动 / 自动 / 批量分配（assign-actions.ts 分前看、分项目给事务里）和改项目换负责人都问它。不是企业版 null
 */
export async function 验证中不能改派(db: Pick<Prisma.TransactionClient, "entLeadVerify">, projectId: string): Promise<string | null> {
  if (!企业版()) return null;
  const v = await db.entLeadVerify.findUnique({ where: { projectId }, select: { pending: true } });
  if (!v?.pending) return null;
  return `这条线索在验证中（等${v.pending}），不能分配、不能改负责人；验证走完或先撤回验证再分`;
}

/**
 * 客户换负责人（转让、交接确认）时名下项目跟着走（P-转-07）：名下有验证中的线索就整批拦（X-77「验证中不能改派，要改先撤回验证」），
 * 不然复核人、终验销售跟着负责人一起换了。看全部：同事负责的项目也跟着走，不受操作人范围限制。在公海里的项目不跟着走，不算。不是企业版 null
 */
export async function 客户有验证中线索(db: Pick<Prisma.TransactionClient, "entLeadVerify">, customerIds: string[]): Promise<string | null> {
  if (!企业版() || !customerIds.length) return null;
  const v = await 看全部(() => db.entLeadVerify.findFirst({
    where: { pending: { not: null }, project: { customerId: { in: customerIds }, pooledAt: null, deletedAt: null } },
    select: { pending: true, project: { select: { name: true } } },
  }));
  if (!v) return null;
  return `名下项目「${v.project.name}」的线索在验证中（等${v.pending}），不能换负责人；验证走完或先撤回验证再转`;
}

/**
 * 客户整位放进公海之前（X-77「推进和放公海都拦」，审核 11-18 P0）：名下有线索在验证中（pending 有值：等市场复核、总管理终判、销售终验 / 认领），
 * 这位不能放——放了 客户名下在推项目进公海 会把验证状态清掉（进公海清验证），复核这一步就没了。项目层放回公海早就拦（db.ts 等复核拦），客户层补上。
 * 回 客户 id → 拦的那句（说清在等什么、下一步做什么）。看全部：同事负责的也算。在公海里、回收站里的项目不算。不是企业版空
 */
export async function 客户验证中不能放公海(db: Pick<Prisma.TransactionClient, "entLeadVerify">, customerIds: string[]): Promise<Map<string, string>> {
  const 出 = new Map<string, string>();
  if (!企业版() || !customerIds.length) return 出;
  for (let i = 0; i < customerIds.length; i += 500) {
    const 行 = await 看全部(() => db.entLeadVerify.findMany({
      where: { pending: { not: null }, project: { customerId: { in: customerIds.slice(i, i + 500) }, pooledAt: null, deletedAt: null } },
      select: { pending: true, project: { select: { name: true, customerId: true } } },
    }));
    for (const v of 行) {
      if (出.has(v.project.customerId) || !v.pending) continue;
      const 等复核 = (等复核的 as readonly string[]).includes(v.pending);
      出.set(v.project.customerId, 等复核
        ? `这位客户有线索「${v.project.name}」在等${v.pending}，${v.pending === "市场复核" ? "复核" : "终判"}完再放公海`
        : `这位客户有线索「${v.project.name}」复核有结果了（等${v.pending}），先在项目详情「线索验证」里处理完再放公海`);
    }
  }
  return 出;
}

/**
 * 复核判死（市场复核 / 总管理终判判了无效线索）是终局（11-03 测试 A4-1）：结局改不回进行中，谁都不行，免得一人推翻别的角色的裁决。
 * 销售初判即终判（创建人是销售，自己判的）不算复核，照旧能自己改回。不是企业版 null
 */
export async function 复核判死拦(db: Pick<Prisma.TransactionClient, "entLeadVerify" | "entLeadVerifyLog">, projectId: string): Promise<string | null> {
  if (!企业版()) return null;
  const v = await db.entLeadVerify.findUnique({ where: { projectId }, select: { finalResult: true } });
  if (v?.finalResult !== "无效线索") return null;
  const 末 = await db.entLeadVerifyLog.findFirst({ where: { projectId, verdict: "无效" }, orderBy: { at: "desc" }, select: { step: true } });
  if (!末 || 末.step === "销售初判") return null;
  return `这条线索${末.step}判了无效线索，是终局，改不回进行中`;
}

/** 进公海清掉旧验证状态时留的那行痕的步骤名（EntLeadVerifyLog.step） */
export const 进公海清验证步 = "进公海清验证";

/**
 * 线索进公海时清掉旧验证状态（X-78 → M-线索-02，9f）：删掉验证状态那一行（= 回到暂未判定、不在等），
 * 领走的人从头验证，旧的判定、等哪步不跟着复现；有过状态的留一行痕「进公海清验证」，以前的痕都留着。
 * 放回、超时回收、客户整体进公海连带、离职放进公海四处同一笔事务里调（和 进公海清组员 并排）。不是企业版不动
 */
export async function 进公海清验证(tx: Pick<Prisma.TransactionClient, "entLeadVerify" | "entLeadVerifyLog">, projectIds: string[], 操作人: string): Promise<void> {
  if (!企业版() || !projectIds.length) return;
  for (let i = 0; i < projectIds.length; i += 500) {
    const 这批 = projectIds.slice(i, i + 500);
    const 有 = await 看全部(() => tx.entLeadVerify.findMany({ where: { projectId: { in: 这批 } }, select: { projectId: true, verdict: true, pending: true } }));
    if (!有.length) continue;
    await tx.entLeadVerifyLog.createMany({ data: 有.map((v) => ({ projectId: v.projectId, step: 进公海清验证步, verdict: v.verdict, note: v.pending ? `清之前等${v.pending}` : null, userId: 操作人 })) });
    await 看全部(() => tx.entLeadVerify.deleteMany({ where: { projectId: { in: 有.map((v) => v.projectId) } } }));
  }
}

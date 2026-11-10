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

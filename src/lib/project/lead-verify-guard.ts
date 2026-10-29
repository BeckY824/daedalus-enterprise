/**
 * 线索验证（P12）在等的时候拦住别的入口：改节点、放回公海、判 MQL 都先问一句。单独一个文件，db.ts 引它不绕回 lead-verify.ts。
 * 等复核（市场复核 / 总管理终判）时负责人、老板都不能自己推、点结局、放公海，免得绕过复核；
 * 复核有结果、等销售终验 / 认领时也拦，要在详情页「线索验证」里点（那边带 验证放行 调进来）。不是企业版 null
 */
import type { Prisma } from "@/generated/prisma";
import { 企业版 } from "@/lib/enterprise/switch";

export const 等复核的 = ["市场复核", "总管理终判"] as const;

export async function 等复核拦(db: Pick<Prisma.TransactionClient, "entLeadVerify">, projectId: string): Promise<string | null> {
  if (!企业版()) return null;
  const v = await db.entLeadVerify.findUnique({ where: { projectId }, select: { pending: true } });
  if (!v?.pending) return null;
  if ((等复核的 as readonly string[]).includes(v.pending)) return `这条线索在等${v.pending}，复核完再动`;
  return `这条线索复核有结果了，先在详情页「线索验证」里处理（${v.pending}）`;
}

import type { PrismaClient } from "@/generated/prisma";
import { 写回填, 算回填计划 } from "@/lib/enterprise/pool-prev-owner-backfill";

/**
 * 测试里直接往库里塞 pool-release 留痕 / 公海行（不走放回公海的动作）后，补一遍 poolPrevOwnerId 两列，
 * 等于上线时跑回填脚本（E-417 包 2 起回避只认这两列，不再从留痕推算）。走真动作（放回公海、放进公海）的不用调，动作自己写列
 */
export async function 回填放回人列(db: PrismaClient): Promise<void> {
  await 写回填(db, await 算回填计划(db), () => {});
}

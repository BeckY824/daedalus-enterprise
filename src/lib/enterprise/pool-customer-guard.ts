/**
 * 线索 / 项目不能挂到客户公海里的客户名下（P-公海-08，X-13 / X-40）：客户在公海 = 没有负责人，先领取。
 * 挂了就会在公海客户名下建出有负责人的项目，绕过「项目不能单独领」（M-公海-06）。
 *
 * 单条转项目 / 并入、老线索批量转项目（lead-to-project.ts）、导入线索落项目（enterprise-import/apply.ts）共用这一个判断：
 * 只认客户公海那一行（CustomerPool），占位负责人但不在公海的不拦；不是企业版不拦。
 * 拦了怎么办由调用方定：单条回提示，批量跳过这条记原因，导入记成没写进去。
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { 企业版 } from "./switch";

type 库 = Prisma.TransactionClient | typeof prisma;

/** 在公海里：回客户名，调用方拼提示；不在公海、客户不在了、不是企业版：回 null */
export async function 公海客户要先领取(db: 库, customerId: string): Promise<{ 客户名: string } | null> {
  if (!企业版()) return null;
  const 行 = await db.customerPool.findUnique({ where: { customerId }, select: { customer: { select: { name: true } } } });
  return 行 ? { 客户名: 行.customer.name } : null;
}

/** 批量、导入逐条列原因用（带客户名）。和客户页那句「这位客户在公海里，先领取再建项目」（pool-rules 公海客户先领取话）同一个说法 */
export function 公海客户先领取说(客户名: string, 再做: string): string {
  return `客户「${客户名}」在公海里，先领取再${再做}`;
}

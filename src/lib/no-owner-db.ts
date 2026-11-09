import type { Prisma } from "@/generated/prisma";
import { 无负责人占位名, 无负责人占位邮箱 } from "./pool";

/**
 * 「没人负责」占位账号（lib/pool.ts 那三条常量）的 id，没有就建：Customer.salesOwnerId 必填，
 * 公海里没有负责人的客户挂在它名下。停用、登不进来；名单、看板按邮箱滤掉它（各处自己滤，这里只管找到）。
 * 只要 user 表：导入（enterprise-import/apply.ts）和客户进公海清负责人（enterprise/pool-link.ts）都走这一处
 */
export async function 无负责人占位Id(tx: Pick<Prisma.TransactionClient, "user">): Promise<string> {
  const u = await tx.user.upsert({
    where: { email: 无负责人占位邮箱 },
    update: {},
    create: { email: 无负责人占位邮箱, name: 无负责人占位名, password: "!不能登录", active: false },
    select: { id: true },
  });
  return u.id;
}

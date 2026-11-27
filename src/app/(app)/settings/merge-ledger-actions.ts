"use server";

/**
 * 设置 → 合并台账（lib/enterprise/merge-ledger.ts）：列表和导出两个动作，前端只传时间范围和搜索词，
 * 谁能看（只有系统管理员）在数据层按登录的人重新判；导出按同一组条件在服务端重查，记导出日志，浏览器拼成 xlsx 下载（lib/xlsx-write.ts）
 */
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { 读合并台账, 导出合并台账, type 台账条件 } from "@/lib/enterprise/merge-ledger";

export async function 查合并台账(条件: 台账条件) {
  const me = await requireUser();
  return 读合并台账(prisma, me, 条件);
}

export async function 导出合并台账Action(条件: 台账条件) {
  const me = await requireUser();
  return 导出合并台账(prisma, me, 条件);
}

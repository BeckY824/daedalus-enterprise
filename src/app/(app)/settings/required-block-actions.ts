"use server";

/**
 * 设置 → 节点推进：导出必填拦截记录（2026-11-23，lib/project/required-block.ts）。
 * 谁能导：和别的导出同一道门（能导入导出：企业版只给系统管理员 / 总管理，P-全局-02）；导一次记一行导出日志。
 * 回的是表格数据，浏览器拼成 xlsx 下载（lib/xlsx-write.ts）
 */
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 企业版 } from "@/lib/enterprise/switch";
import { 能导入导出, 不能导入导出 } from "@/lib/enterprise/import-perm";
import { 读拦截导出, type 拦截导出 } from "@/lib/project/required-block";

/** 最多往回导多少天（表里只增不删，一年足够看「上线一个月后再看」） */
const 最多天 = 366;

export async function 导出必填拦截Action(天: number): Promise<{ ok: true; 数据: 拦截导出 } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!企业版()) return { ok: false, error: "只有企业版有必填拦截记录" };
  if (!(await 能导入导出(me))) return { ok: false, error: 不能导入导出 };
  const n = Number.isInteger(天) && 天 > 0 ? Math.min(天, 最多天) : 30;
  const 今 = new Date();
  const 数据 = await 读拦截导出(new Date(今.getTime() - n * 86_400_000), 今);
  await recordAudit({
    user: me, action: "export", entity: "EntRequiredBlock",
    summary: `导出必填拦截记录：近 ${n} 天 ${数据.汇总.次数} 次、${数据.汇总.项目数} 个项目`,
    detail: { 天: n, 次数: 数据.汇总.次数 },
  });
  return { ok: true, 数据 };
}

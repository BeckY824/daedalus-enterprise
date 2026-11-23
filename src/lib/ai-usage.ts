/**
 * AI 用量：每次真的调了模型就记一条操作日志（action=ai_use，entityId=功能键）。
 * 设置页据此汇总本月各功能用了多少次——没有单独的计数表，日志本来就只增不删，
 * 少一张表就少一处会和真实情况对不上的地方。
 */
import { businessDayjs } from "./business-clock";
import { prisma } from "./prisma";
import { recordAudit, type Actor } from "./audit";
import { 企业版 } from "./enterprise/switch";

export const AI_FEATURES = {
  parse: "跟进速记",
  brief: "临战简报",
  ask: "问数据",
  wakeup: "盯盘话术",
  explain: "盯盘解读",
  invite: "转介绍邀请",
  paste: "粘成表格",
  research: "联网背调",
  // 批次 20d：这三处原来不记 ai_use，用量和留痕里看不到
  card: "名片整理",
  mcp: "MCP 查询",
  importClean: "导入清洗",
  // 2026-11-17：首页对话框带截图问，图里的字在服务器上认（app/api/mobile/scan?use=ask）
  shot: "截图识字",
  // 2026-11-22 录音点评 PR4：转写成功一次记一条（coach-rec-jobs.ts，明细里带秒数），设置页另按秒合计
  asr: "录音转写",
  // 2026-11-22 录音点评 PR5：转写好了 AI 整理主题和要点（自动的第一次、重新整理都记；不扣个人 AI 提问次数）
  coachSum: "录音点评整理",
} as const;
export type AiFeature = keyof typeof AI_FEATURES;

/** 企业版把「简报」叫「智能总结」（10-27 会议：「将简报功能名称改为智能总结」）；只在服务端读开关 */
export function 简报名(): string {
  return 企业版() ? "智能总结" : "简报";
}

export async function recordAiUse(user: Actor, feature: AiFeature, summary: string, entityId?: string | null) {
  await recordAudit({ user, action: "ai_use", entity: "Ai", entityId: feature, summary, detail: entityId ? { 对象: entityId } : undefined });
}

/** 秒：只有录音转写有（本月转了多少秒，按每条明细里的 秒 加起来） */
export type AiUsage = { feature: AiFeature; label: string; count: number; 秒?: number }[];

/** 本月（自然月）各功能的调用次数，含 0 的项（录音转写、录音点评整理例外：0 次不列），按功能固定顺序 */
export async function aiUsageThisMonth(now = new Date()): Promise<AiUsage> {
  const start = businessDayjs(now).startOf("month").toDate();
  const rows = await prisma.auditLog.groupBy({
    by: ["entityId"],
    where: { action: "ai_use", at: { gte: start } },
    _count: { _all: true },
  });
  const map = new Map(rows.map((r) => [r.entityId, r._count._all]));
  // 录音转写按秒：只有企业版有，没转过就不查
  let 转写秒 = 0;
  if (企业版() && map.get("asr")) {
    for (const r of await prisma.auditLog.findMany({ where: { action: "ai_use", entityId: "asr", at: { gte: start } }, select: { detail: true } })) {
      try {
        const 秒 = Number((JSON.parse(r.detail ?? "{}") as { 秒?: unknown }).秒);
        if (Number.isFinite(秒) && 秒 > 0) 转写秒 += 秒;
      } catch {
        /* 明细坏了的不算秒，次数照算 */
      }
    }
  }
  return (Object.keys(AI_FEATURES) as AiFeature[])
    // 录音转写：只企业版、本月转过才列（开关关着 / 没用过时设置页和现在一样，PR4 审查；同设置页对 invite 的做法）；录音点评整理（PR5）同样
    .filter((f) => (f !== "asr" && f !== "coachSum") || (企业版() && (map.get(f) ?? 0) > 0))
    .map((f) => ({ feature: f, label: f === "brief" && 企业版() ? "智能总结" : AI_FEATURES[f], count: map.get(f) ?? 0, ...(f === "asr" ? { 秒: 转写秒 } : {}) }));
}

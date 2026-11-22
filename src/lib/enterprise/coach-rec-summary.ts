/**
 * 录音点评 · AI 整理（11-22，录音点评 PR5，改版方案 §4.4）：转写全文 → 主题（40 字内）+ 要点（三段；多人对话、整段交的四段）。
 *
 * - 只根据转写说的写，不编；人名、校名照转写；说话人只有编号，提示词里说「说话人 1 多半是发起人」但不硬猜
 * - 转写去掉时间、说话人标记后不到 50 字，或者模型说听不出内容 → 不总结，确认框提示「没听清，请自己写」（不调模型 / 不记用量）
 * - 多于一个说话人、而且整段交给腾讯云（没切段：切段时说话人编号各段各算，对不上）才要第四段「对方的回应 / 达成的共识」
 * - 走现有模型配置（lib/llm.ts chatJSON），不扣个人 AI 提问次数；用量由调用方记（ai-usage.ts coachSum「录音点评整理」）
 * - 模型原文不进日志、不进报错（报错只写给人看的话）
 */
import { 主题标题上限, 主题内容上限 } from "./coach-topic";

/** 转写去掉时间、说话人标记以后少于这个字数就不总结 */
export const 最少可总结字数 = 50;
/** 交给模型的转写最多这么多字（2 小时约 3.5 万字；再长的截前面这些，确认框里照样给全文） */
export const 交模型字数上限 = 40_000;
export const 没听清话 = "没听清录音里说了什么，请自己写主题和要点";

export const 段名 = { 好: "做得好的", 改: "要改进的", 下一步: "下一步建议", 回应: "对方的回应 / 达成的共识" } as const;

/** 转写全文里真正说的话（去掉「(mm:ss) 说话人 N：」） */
export function 正文字数(转写: string): number {
  return 转写
    .split("\n")
    .map((l) => l.replace(/^\(\d{1,2}(?::\d{2}){1,2}\)\s*(说话人\s*\d+[：:])?/, ""))
    .join("")
    .replace(/[\s，。、！？,.!?（）()：:；;“”"'…-]/g, "").length;
}

export function 要第四段(说话人数: number | null, 切段了: boolean): boolean {
  return (说话人数 ?? 0) > 1 && !切段了;
}

export function 整理提示词(转写: string, 四段: boolean): string {
  const 截 = 转写.length > 交模型字数上限 ? `${转写.slice(0, 交模型字数上限)}\n（后面还有，太长截掉了）` : 转写;
  return [
    "下面是一段销售教练（或上级）对一个销售项目做口头点评的录音转写，机器识别，可能有错字。请整理成一条点评，给负责这个项目的销售看。",
    "要求：",
    "1. 只根据转写里说了的写，不编、不补转写里没有的事实；人名、学校名、公司名照转写写；",
    "2. 说话人只有编号，「说话人 1」多半是发起点评的人，但不确定时不要硬猜是谁；",
    `3. 主题：一句话说这次点评的核心，${主题标题上限} 字以内；`,
    "4. 每段 1–3 条，每条一句话，口语、具体；下一步建议尽量带时间和动作；转写里没提到的段落给空数组；",
    四段
      ? "5. 录音里不止一个人在说：另写「对方的回应」，说被点评的一方怎么回应、双方定下了什么；"
      : "5. 不写「对方的回应」，给空数组；",
    "6. 如果转写听不出在说什么（全是杂音、语气词、和项目无关），可总结给 false，其余留空。",
    "只输出 JSON，格式：",
    '{"可总结": true, "主题": "…", "做得好的": ["…"], "要改进的": ["…"], "下一步建议": ["…"], "对方的回应": ["…"]}',
    "",
    "转写：",
    截,
  ].join("\n");
}

export type 整理结果 = { 可总结: false } | { 可总结: true; 主题: string; 要点: string };

const 条们 = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 3) : [];

/** 模型回的内容认不出（不是对象、缺主题或要点）：当整理失败，不当「没听清」（PR5 审查） */
export const 回的不对话 = "AI 回的内容格式不对";
/** 模型回了话、但内容认不出（JSON 解不开、缺主题要点）：调过模型，整理一轮照记用量（PR5 审查） */
export class 回的不对错 extends Error {
  readonly 调了 = true;
  constructor() {
    super(回的不对话);
  }
}

/**
 * 模型回的 JSON → 主题、要点（按段拼成「【段名】\n· 一条」；超长按主题上限截）。
 * 只有模型明说 可总结: false 才算没听清；别的认不出的（不是对象、缺主题或要点）抛错 = 整理失败（PR5 审查）
 */
export function 认整理结果(j: unknown, 四段: boolean): 整理结果 {
  if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error(回的不对话);
  const o = j as Record<string, unknown>;
  if (o.可总结 === false) return { 可总结: false };
  const 主题 = typeof o.主题 === "string" ? o.主题.replace(/\s+/g, " ").trim().slice(0, 主题标题上限) : "";
  const 段们: [string, string[]][] = [
    [段名.好, 条们(o.做得好的)],
    [段名.改, 条们(o.要改进的)],
    [段名.下一步, 条们(o.下一步建议)],
    ...(四段 ? ([[段名.回应, 条们(o.对方的回应)]] as [string, string[]][]) : []),
  ];
  const 要点 = 段们.filter(([, 们]) => 们.length).map(([名, 们]) => `【${名}】\n${们.map((x) => `· ${x}`).join("\n")}`).join("\n").slice(0, 主题内容上限);
  if (!主题 || !要点) throw new Error(回的不对话);
  return { 可总结: true, 主题, 要点 };
}

/**
 * 整理一条：字数不够直接回「不可总结」（没调模型）；调了模型回 { 调了: true }。模型出错抛（话给人看）
 */
export async function AI整理(转写: string, 说话人数: number | null, 切段了: boolean): Promise<整理结果 & { 调了: boolean }> {
  if (正文字数(转写) < 最少可总结字数) return { 可总结: false, 调了: false };
  const 四段 = 要第四段(说话人数, 切段了);
  const { chatJSON, JSON格式不对 } = await import("@/lib/llm");
  let j: unknown;
  try {
    j = await chatJSON(整理提示词(转写, 四段), { feature: "other", timeoutMs: 120_000, maxTokens: 2_000, temperature: 0.2 });
  } catch (e) {
    // 模型回了、但不是 JSON：算调过（记用量），话照「格式不对」给人看
    if (e instanceof Error && e.message === JSON格式不对) throw new 回的不对错();
    throw e;
  }
  try {
    return { ...认整理结果(j, 四段), 调了: true };
  } catch {
    throw new 回的不对错();
  }
}

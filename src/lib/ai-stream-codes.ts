/**
 * /api/ai/stream 结果事件里的 code（设计语言 HC-2b，11-22）。
 *
 * 出错时服务端除了给人看的那句 error，再带一个固定的 code，界面按 code 认是哪一类，不看文案：
 *   timeout —— 模型那边超时没回音（llm.ts 的 AbortSignal.timeout，name = TimeoutError）。
 *              界面写「等了 N 秒没回来」+ 重试（components/AiStatus.tsx）
 * 服务端和浏览器两边都 import 这一份，不在两头各写一个字符串。
 */
export const AI流错误码 = { 超时: "timeout" } as const;
export type AI流错误码 = (typeof AI流错误码)[keyof typeof AI流错误码];

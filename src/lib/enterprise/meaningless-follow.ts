/**
 * 无意义沟通不能保存（F-052，11-25 客户定「判为无意义就不能提交」）：服务端那一道。
 *
 * 判据只在 tri-state-quota.ts 判沟通无意义（一期：不足 4 个字；**判据第二期换成按意义判**，只换那个函数）。
 * 记沟通的两处服务端动作保存前都过这里：saveFollowUp（客户速记 / 记跟进、完成计划、首页 AI 记沟通卡、项目页改沟通）、
 * 记项目沟通Action（项目页记沟通、回收预警「记一条沟通」、首页 AI 项目卡）。前端那一行提示只是早说，拦以这里为准。
 * 开关「无意义沟通不能保存」（rules-table.ts 无意义沟通拦，默认开）关着就不拦，回到照存 + 轻提示。
 * 导入、飞书 / 钉钉同步、同号留痕这些系统写的不走这两个动作，不拦
 */
import { 规则开着 } from "./rules";
import { 读占位词 } from "./tri-state-db";
import { 判沟通无意义, 无意义不能存话 } from "./tri-state-quota";

export type 沟通判定须知 = { 拦: boolean; 占位词: readonly string[] };

/** 记沟通的框打开时要的：开关开没开、占位词表（前端那一行提示和服务端同一把尺） */
export async function 读沟通判定须知(): Promise<沟通判定须知> {
  const [拦, 占位词] = await Promise.all([规则开着("无意义沟通拦"), 读占位词()]);
  return { 拦, 占位词 };
}

/**
 * 判一下这条拦不拦：拦就回那句话（不存），不拦回 null。开关关着、不是企业版（规则开着 回 false）都不查词表。
 * AI生成 = 这条带速记原文（FollowUpSource）：以生成结果判，有字就不拦（同 有内容的沟通）
 */
export async function 沟通无意义挡(内容: string | null | undefined, 类型: string | null | undefined, 选: { 标题?: string | null; AI生成?: boolean } = {}): Promise<string | null> {
  if (!(await 规则开着("无意义沟通拦"))) return null;
  // 先不带词表判：够字数的（绝大多数）到这里就放行，不多查一次库；太短的再按后台词表判（只有占位词的不拦）
  if (!判沟通无意义(内容, 类型, { ...选, 占位词: [] }).无意义) return null;
  const 判 = 判沟通无意义(内容, 类型, { ...选, 占位词: await 读占位词() });
  return 判.无意义 ? 无意义不能存话(内容, 判) : null;
}

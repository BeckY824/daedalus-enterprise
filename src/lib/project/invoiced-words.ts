/**
 * 项目「已开票」的常量和话术（不碰库，界面、项目合并、服务端共用）。规矩见 lib/project/invoiced.ts 文件头
 */

/** 撤回期限（E-363 四②「30 天内误勾只有系统管理员能撤回，过 30 天谁都不能改」） */
export const 已开票撤回天数 = 30;
/** 不能勾的那一句（能标已开票 为假时） */
export const 不能标已开票话 = "只有系统管理员或被指定「可标已开票」的人能勾";
/** 项目合并拦话：「X」已开票，不能合并（和「已签合同，不能合并」同一个说法） */
export const 已开票不能合并 = (名: string) => `「${名 || "未命名项目"}」已开票，不能合并`;
/** 项目合并用：两边任一勾了都拦，回拦话（空 = 不拦）。project-merge.ts 阶段和钱拦 里和已签合同并列调 */
export function 已开票拦合并(p: { name: string; invoiced?: boolean | null }): string[] {
  return p.invoiced ? [已开票不能合并(p.name)] : [];
}

/** 项目详情要的那一格：勾没勾、谁何时、我能不能勾、能不能取消（不能 = 那一句，悬停写） */
export type 已开票格 = { 勾了: boolean; 谁: string | null; 何时: string | null; 能勾: boolean; 取消不给: string | null };

/**
 * 首页待办「待分配新线索」（11-21 改版）：纯数据和纯函数，浏览器组件也 import，别 import prisma。读库、算范围在 await-assign-scope.ts。
 *
 * 原来每出一次「没自动分出去」就往能分配的人各自的 Setting 里存一张快照，首页、新线索页顶上一条一张黄色大卡，分走了也不消，
 * 只能一张张关（用户 11-21：「非常影响体验」）。现在照「待回复客户」（P-转-35）合成一行带条数：条数每次从库里现数，
 * 分走了自动少，没有了整行不画，不能关。铃铛、飞书照旧一事一条（lead-full-notice.ts）
 */
import type { Prisma } from "@/generated/prisma";

/** 新线索页的筛选键：/leads?f=await-assign 只列「待分配新线索」那一行数到的那几条（同一个条件，lib/project/list.ts） */
export const 待分配筛 = "await-assign";
/** 筛选标签、首页那一行的名字 */
export const 待分配筛名 = "待分配新线索";
export const 待分配筛说明 = "还在新线索、没定时、没进公海、没结局，等人手动分的；只算你能分的业务线";
/** 首页那一行点「去分配」去哪 */
export const 待分配链接 = `/leads?f=${待分配筛}`;

/** 首页那一行要的：几条、最早那条从什么时候起待分配（ISO）。没有 = null，不画 */
export type 待分配数 = { 条数: number; 最早: string | null };

/**
 * 正在等人手动分的新线索：线索阶段、标了待分配、没定时（定时的到点后台分，P-转-37）、不在公海、没结局、没进回收站。
 * 谁能看哪几条另由 待分配范围（await-assign-scope.ts）收窄
 */
export const 待分配在等: Prisma.ProjectWhereInput = {
  phase: "线索",
  awaitAssignAt: { not: null },
  scheduledAssignAt: null,
  pooledAt: null,
  result: null,
  deletedAt: null,
};

/**
 * 自动分配挑不到人时回的那句带着尾巴「已留在新线索待分配 / 这条新线索留在原处，可以手动指派」（assign-actions.ts 挑不到）。
 * 当「为什么」往提醒、提示里拼时只要原因本身，不然和后面「线索留在新线索、没有负责人」一句里两种说法（11-21）
 */
export function 挑不到原因(话: string): string {
  return 话.replace(/。?(已留在新线索待分配|这条新线索留在原处)，可以手动指派$/, "");
}

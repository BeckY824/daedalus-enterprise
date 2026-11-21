/**
 * 首页待办「待分配新线索」（11-21 改版）：纯数据和纯函数，浏览器组件也 import，别 import prisma。读库、算范围在 await-assign-scope.ts。
 *
 * 原来每出一次「没自动分出去」就往能分配的人各自的 Setting 里存一张快照，首页、新线索页顶上一条一张黄色大卡，分走了也不消，
 * 只能一张张关（用户 11-21：「非常影响体验」）。现在照「待回复客户」（P-转-35）合成一行带条数：条数每次从库里现数，
 * 分走了自动少，没有了整行不画，不能关。铃铛、飞书照旧一事一条（lead-full-notice.ts）
 */
import type { Prisma } from "@/generated/prisma";
import type { 组织 } from "./org-core";
import { 三种业务线, 是业务线, 项目业务线 } from "./assign-line";
import type { 线 } from "./lead-assign";

/** 新线索页的筛选键：/leads?f=await-assign 只列「待分配新线索」那一行数到的那几条（同一个条件，lib/project/list.ts） */
export const 待分配筛 = "await-assign";
/** 筛选标签、首页那一行的名字 */
export const 待分配筛名 = "待分配新线索";
export const 待分配筛说明 = "还在新线索、没定时、没进公海、没结局，等人手动分的；只算你能分的业务线";
/** 首页那一行点「去分配」去哪 */
export const 待分配链接 = `/leads?f=${待分配筛}`;

/** 首页那一行要的：几条、最早那条从什么时候起待分配（服务端按北京墙钟写好的「MM-DD HH:mm」，跨年带年）。没有 = null，不画 */
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

/** 设了业务线的人能分哪几条：这条线的（同 项目业务线），加上「暂不分配」的 */
export function 本线待分配条件(org: 组织, 线: 线): Prisma.ProjectWhereInput {
  const 未填: Prisma.ProjectWhereInput = { OR: [{ bizLine: null }, { bizLine: { notIn: [...三种业务线] } }] };
  const 外贸们 = [...org.成员].filter(([, m]) => m.line === "外贸").map(([id]) => id);
  const 负责人 = 线 === "外贸" ? { ownerId: { in: 外贸们 } } : { ownerId: { notIn: 外贸们 } };
  return { OR: [{ bizLine: 线 }, { bizLine: "暂不分配" }, { AND: [未填, 负责人] }] };
}

/**
 * 待分配对本线管理放开（P-转-42，用户 11-21 定「放开给本线管理」）：销售管理、条线总管理（总管理设了业务线）看得到、能手动分配
 * 还在待分配的新线索——负责人那一格是建的人（常是市场同事）占着，按原可见范围（只到下属）他们看不到、分不了。
 * 回这人放开到哪条线（null = 没设线，各线都算）；不是这两类 = undefined。开关、只读、只看某人由调用方判。
 * 只放开看和分配：改字段、初判 / 推进、删、转让照旧按负责人判（permissions.ts），客户本身不跟着放开；分出去后照原范围
 */
export function 本线放开的线(org: 组织, id: string): 线 | null | undefined {
  const m = org.成员.get(id);
  if (!m) return undefined;
  if (m.角色们.includes("sales_mgr")) return 是业务线(m.line) ? m.line : null;
  if (m.角色们.includes("director") && 是业务线(m.line)) return m.line;
  return undefined;
}

/** 放开的那几条在库里的条件（可见层 team-scope 并进项目的读条件） */
export function 本线放开条件(org: 组织, 线: 线 | null): Prisma.ProjectWhereInput {
  return 线 ? { AND: [待分配在等, 本线待分配条件(org, 线)] } : 待分配在等;
}

/** 同一件事的纯判断（项目详情 能看项目）：这条项目现在是不是还在待分配、业务线是不是这人放开的线 */
export function 本线放开看得到(org: 组织, id: string, p: {
  ownerId: string; bizLine?: string | null; phase?: string | null; result?: string | null; pooledAt?: Date | null;
  awaitAssignAt?: Date | null; scheduledAssignAt?: Date | null; deletedAt?: Date | null;
}): boolean {
  const 线 = 本线放开的线(org, id);
  if (线 === undefined) return false;
  if (p.phase !== "线索" || !p.awaitAssignAt || p.scheduledAssignAt || p.pooledAt || p.result || p.deletedAt) return false;
  if (!线) return true;
  const 项目线 = 项目业务线(p, org.成员);
  return 项目线 === 线 || 项目线 === "暂不分配";
}

/**
 * 自动分配挑不到人时回的那句带着尾巴「已留在新线索待分配 / 这条新线索留在原处，可以手动指派」（assign-actions.ts 挑不到）。
 * 当「为什么」往提醒、提示里拼时只要原因本身，不然和后面「线索留在新线索、没有负责人」一句里两种说法（11-21）
 */
export function 挑不到原因(话: string): string {
  return 话.replace(/。?(已留在新线索待分配|这条新线索留在原处)，可以手动指派$/, "");
}

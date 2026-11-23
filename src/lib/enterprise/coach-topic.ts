/**
 * 企业版教练主题（11-17，销售教练角色 PR2）的判定：谁能发、谁能看、谁能回、谁能关，状态怎么走。纯函数，不碰数据库。
 * 读写库在 coach-topic-db.ts，动作在 customers/[id]/coach-topic-actions.ts，都只认这里。
 *
 * 主题不是沟通记录（Q1 选 B，单独两张表）：不拨三态钟、不清冷标、不重置额度、不顶替下一步计划、不算节点推进。
 * 权限只认业务角色（permissions.ts 文件头），账号 ADMIN / MANAGER 不放行。
 *
 * 每题的取舍集中在下面这几个常量 / 函数里，用户改口只动一处：
 *   Q2 虚线上级能发          → 虚线上级能发
 *   Q3 实线上级管几层        → 实线上级层数
 *   Q4 原话没提的几类        → 系统管理员能发、条线总管理能发；上级按关系认（11-17 评估：市场管理只要是负责人的实线 / 虚线上级就能发）
 *   Q5 填写人                → 填写人能代录（动作里不收 authorId，见 coach-topic-actions.ts）
 *   Q6 谁看得到              → 能看主题
 *   Q7 状态、收尾            → 主题状态、回复后状态、已结束项目能发、冻结了、进公海自动关、发起人不在了谁能关
 *   Q8 改删                  → 主题能改删、能删主题、主题进回收站
 *   Q11 通知谁               → 发起通知谁、回复通知谁、关闭通知谁（coach-topic-db.ts 照这几个发）
 */
import { 业务线放行, 只读角色, 是教练, 是系统管理员, 只看的人, 没设业务角色, 能看项目, type 谁, type 权限项目 } from "./permissions";
import { 条线范围of } from "./line-viewer";
import { 实线下属, 虚线下属, type 组织 } from "./org-core";

/** Q2（11-17 定，客户方原话「包括实线上级或者虚线上级」）：虚线上级能对虚线下属（和他们的实线下属）负责的项目发主题；虚线下属的别的数据照旧只读 */
export const 虚线上级能发 = true;
/** Q3（先按建议）：实线上级按整条下属链（看得到就能点评）；改成 1 = 只管直属一级 */
export const 实线上级层数 = Infinity;
/**
 * Q4（先按建议 + 11-17 评估改）：系统管理员能发（全部项目）；条线总管理能发（本线）。
 * 上级按关系认、不看是销售管理还是市场管理：负责人的实线上级（整条链）、虚线上级（含虚线下属的实线下属，同「看」的范围）都能发。
 * 「市场管理不能发」只指跟负责人没有上下级关系的市场管理——他本来就落不进上面任何一类，不用另写
 */
export const 系统管理员能发 = true;
export const 条线总管理能发 = true;
/** Q5（先按建议）：填写人锁定为当前登录人，不能代别人发 */
export const 填写人能代录 = false;
/** Q7（先按建议）：已结束（有结局）的项目也能发（复盘用）；公海里的不能发（没有负责人，没人回） */
export const 已结束项目能发 = true;
/** Q7（11-17 评估改）：项目进公海时，没关的主题自动关闭并留痕（不让领走的新负责人背给前任的待回复）；转让、交接照旧跟到新负责人 */
export const 进公海自动关 = true;
/** Q7（11-17 评估改）：发起人停用 / 没了业务角色，项目负责人也能关（系统管理员一直能关） */
export const 发起人不在了负责人能关 = true;
/** Q8（先按建议）：发出后主题、回复都不能改、不能删；只有系统管理员能软删 */
export const 主题能改删 = false;
/** Q8（11-17 评估改）：第一版不接回收站——系统管理员软删只是在 deletedAt 打个记号，不进回收站、不能恢复、不 30 天清 */
export const 主题进回收站 = false;

export const 主题状态 = ["待回复", "已回复", "已关闭"] as const;
export type 主题状态 = (typeof 主题状态)[number];
export const 主题标题上限 = 40;
export const 主题内容上限 = 2000;
export const 回复上限 = 2000;
/** 界面上的标签 */
export const 教练发起标签 = "教练发起";

/** 判主题用到的项目字段：deletedAt 有值 = 进了回收站；result 有值 = 已结束 */
export type 主题项目 = 权限项目 & { deletedAt?: Date | null; result?: string | null };
export type 主题行 = { authorId: string; status: string; deletedAt?: Date | null };

/** 发得出主题的身份（判能不能发、留痕用；界面「填写人：张三（总管理）」那一格写主业务角色名，见 coach-topic-db.ts 角色叫法） */
export type 发起身份 = "销售教练" | "系统管理员" | "条线总管理" | "实线上级" | "虚线上级";

/** 项目进了公海、进了回收站：主题冻结成只读（不能发、回、关），不再提醒。进公海那一下没关的已自动关（进公海关主题）；项目从回收站恢复后照旧 */
export function 冻结了(p: 主题项目): boolean {
  return !!p.pooledAt || !!p.deletedAt;
}

/**
 * 我按什么身份能对这个项目发主题；不能 = null。
 * 不看冻结（公海、回收站）：能发主题 再判；能看主题 用这个判「能对这个项目发主题的人」。
 * 项目负责人本人不发（主题是给负责人的，他在主题下回复）
 */
export function 发起身份of(me: 谁, p: 主题项目, org: 组织 | null): 发起身份 | null {
  if (!org || 没设业务角色(org, me.id) || 只看的人(org, me.id)) return null;
  if (p.ownerId === me.id) return null;
  // 销售教练：看得到的项目都能发（第一版不按线，看全部）
  if (是教练(me, org)) return 能看项目(me, p, org) ? "销售教练" : null;
  // 别的只读角色（管理员）：只能看（Q6 看得到主题，但不发）
  if (只读角色(me, org)) return null;
  if (是系统管理员(me, org)) return 系统管理员能发 ? "系统管理员" : null;
  const 条线 = 条线范围of(org, me.id);
  if (条线总管理能发 && 条线 && 条线.人们.includes(p.ownerId)) return "条线总管理";
  // 按关系认（11-17 评估）：销售管理、市场管理都一样，只看是不是负责人的上级
  if (实线下属(org, me.id, 实线上级层数).has(p.ownerId) && 业务线放行(org, me.id, p)) return "实线上级";
  if (虚线上级能发) {
    // 同 permissions.ts 看得到下属的：虚线下属和他们的实线下属，不按业务线滤（虚线是专门跨线配的）
    for (const d of 虚线下属(org, me.id)) if (d === p.ownerId || 实线下属(org, d).has(p.ownerId)) return "虚线上级";
  }
  return null;
}

/** 能不能对这个项目发主题：有发起身份、项目没冻结（公海、回收站）、已结束的按 已结束项目能发 */
export function 能发主题(me: 谁, p: 主题项目, org: 组织 | null): boolean {
  if (冻结了(p) || (!已结束项目能发 && !!p.result)) return false;
  return 发起身份of(me, p, org) !== null;
}

/** 不能发时那一句（界面不摆按钮，服务端照样挡） */
export function 不能发主题话(me: 谁, p: 主题项目, org: 组织 | null): string | null {
  if (能发主题(me, p, org)) return null;
  if (p.pooledAt) return "公海里的项目没有负责人，不能发主题";
  if (p.deletedAt) return "项目在回收站里，不能发主题";
  if (p.ownerId === me.id) return "这是你负责的项目：主题由教练、上级发起，你在主题下回复";
  return "你不能对这个项目发主题";
}

/**
 * Q6（先按建议）谁看得到主题：先得看得到项目（能看项目；两张表不在 scope-policy 的范围父表里，限定层管不到，读入口都过这里），
 * 再是发起人、项目负责人、所有能对这个项目发主题的人，加上只读管理员（他看全部；按线的只看这条线）；
 * 项目组员、市场成员看不到。冻结了照样看得到（只读）。系统管理员软删了的谁都看不到（第一版不进回收站）
 */
export function 能看主题(me: 谁, t: 主题行, p: 主题项目, org: 组织 | null): boolean {
  if (!org || t.deletedAt || !能看项目(me, p, org)) return false;
  if (t.authorId === me.id || p.ownerId === me.id || 只读角色(me, org)) return true;
  return 发起身份of(me, p, org) !== null;
}

/**
 * 回复：项目负责人；发起人追问；能对这个项目发主题的人（教练只回自己发的）。
 * 冻结了、关了、删了的不能回
 */
export function 能回主题(me: 谁, t: 主题行, p: 主题项目, org: 组织 | null): boolean {
  if (!org || t.deletedAt || t.status === "已关闭" || 冻结了(p)) return false;
  if (p.ownerId === me.id) return true;
  if (t.authorId === me.id) return 发起身份of(me, p, org) !== null;
  if (是教练(me, org)) return false;
  return 发起身份of(me, p, org) !== null;
}

/**
 * 关闭（Q7）：系统管理员；发起人（他还能对这个项目发主题，或他自己接手成了负责人——自己点评过的项目自己回不如直接关）；
 * 发起人停用 / 没了业务角色时，项目负责人也能关（发起人不在了负责人能关）。冻结了、关了、删了的不能关。
 * 进公海自动关（进公海自动关），v1 不做超时提醒
 */
export function 能关主题(me: 谁, t: 主题行, p: 主题项目, org: 组织 | null): boolean {
  if (!org || t.deletedAt || t.status === "已关闭" || 冻结了(p)) return false;
  if (是系统管理员(me, org)) return true;
  if (t.authorId === me.id) return p.ownerId === me.id || 发起身份of(me, p, org) !== null;
  return 发起人不在了负责人能关 && p.ownerId === me.id && 没设业务角色(org, t.authorId);
}

/** Q8：软删只有系统管理员；冻结了照样能删。第一版只打记号（主题进回收站 = false） */
export function 能删主题(me: 谁, org: 组织 | null): boolean {
  return !!org && 是系统管理员(me, org);
}

/**
 * Q7（11-17 评估改）：负责人回了 → 已回复；发起人回 = 追问 → 回到待回复；
 * 别的能回的人（第三方，比如上级在教练的主题下说一句）不改状态，通知发起人和负责人（回复通知谁）
 */
export function 回复后状态(回复人: string, t: { authorId: string; status: string }, p: { ownerId: string }): 主题状态 {
  if (回复人 === p.ownerId) return "已回复";
  if (回复人 === t.authorId) return "待回复";
  return t.status as 主题状态;
}

/** Q11（先按建议）：发起时只通知项目负责人，不抄送他的上级。自己不通知自己 */
export function 发起通知谁(作者: string, p: { ownerId: string }): string[] {
  return [p.ownerId].filter((x) => x && x !== 作者);
}
/** Q11：负责人回复只通知发起人；发起人追问通知负责人（再走一遍待回复）；第三方回复通知发起人和负责人。自己不通知自己 */
export function 回复通知谁(回复人: string, t: { authorId: string }, p: { ownerId: string }): string[] {
  const 们 = 回复人 === p.ownerId ? [t.authorId] : [p.ownerId, t.authorId];
  return [...new Set(们)].filter((x) => x && x !== 回复人);
}
/** Q11：关闭通知负责人。自己不通知自己 */
export function 关闭通知谁(关的人: string, p: { ownerId: string }): string[] {
  return [p.ownerId].filter((x) => x && x !== 关的人);
}

/** 标题、内容规整：去头尾空白；空的、超长的回那一句 */
export function 主题输入问题(x: { title?: unknown; body?: unknown }): string | null {
  const title = typeof x.title === "string" ? x.title.trim() : "";
  const body = typeof x.body === "string" ? x.body.trim() : "";
  if (!title) return "主题要写一句话";
  if (title.length > 主题标题上限) return `主题最多 ${主题标题上限} 字`;
  if (!body) return "内容要写点评或建议";
  if (body.length > 主题内容上限) return `内容最多 ${主题内容上限} 字`;
  return null;
}
export function 回复输入问题(body: unknown): string | null {
  const b = typeof body === "string" ? body.trim() : "";
  if (!b) return "回复不能是空的";
  if (b.length > 回复上限) return `回复最多 ${回复上限} 字`;
  return null;
}

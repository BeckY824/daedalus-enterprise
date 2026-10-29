/**
 * 企业版项目字段的小算法（10-29 P6）：已立项天数、按预计成交排、AI 解析结果预填「记一条沟通」。
 * 纯函数，服务端和浏览器都能用；不碰库。
 */
import { dayjs } from "@/lib/utils";
import type { FollowUpDraft } from "@/lib/ai-draft";

/** 已立项几天：按自然日数（建项目当天 = 0），时间点在今天之后（时钟拨过）也算 0。时区跟进程走（业务时区） */
export function 已立项天数(createdAt: Date | string, 今天: Date | string = new Date()): number {
  const 天 = dayjs(今天).startOf("day").diff(dayjs(createdAt).startOf("day"), "day");
  return 天 > 0 ? 天 : 0;
}

/**
 * 列表按预计成交日期排：日子早的在前，没填的总在最后（YYYY-MM-DD 字符串直接比）。
 * 倒序 = 表格点成「降序」时（antd 会把结果整个取反）：没填的那一半先反过来，取反后照样在最后
 */
export function 按预计成交排(a: string | null | undefined, b: string | null | undefined, 倒序 = false): number {
  if (!a && !b) return 0;
  if (!a) return 倒序 ? -1 : 1;
  if (!b) return 倒序 ? 1 : -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 项目「下一步做什么」最多几个字（10-29：下一步改成自己写的一句话 + 可选时间；向导、项目详情、服务端校验同一个数） */
export const 下一步文字上限 = 100;

/** 项目「记一条沟通」弹窗的时间格式（和弹窗里的输入框同一个） */
export const 沟通时间格式 = "YYYY-MM-DD HH:mm";

export type 沟通预填 = { type?: string; content?: string; occurredAt?: string; 下一步?: string; 下一步时间?: string };

/**
 * AI 解析出来的草稿 → 项目「记一条沟通」弹窗要预填的格子。只是预填，人核对后点「记下」才写库。
 * - 类型：弹窗能选的才填（项目沟通不收待办 / 提醒），不认识的留着人选
 * - 内容：用整理好的正文，没有就用标题
 * - 沟通时间：模型给的且不晚于现在才填（项目沟通不记将来的时间）
 * - 下一步（做什么，10-29）：约定的下次跟进的主题优先，没有就取带日子的那条待办、再没有就第一条待办的标题；超过 100 字截掉
 * - 下一步时间：约定的下次跟进（plan）优先，没有就第一条带日子的待办；只填今天及以后的日子
 * - 「客户明确回复了吗」不猜，留给人选（线索验证往后推看这一格）
 */
export function 项目沟通预填(草稿: FollowUpDraft, 能选类型: readonly string[], 现在: Date = new Date()): 沟通预填 {
  const 填: 沟通预填 = {};
  const f = 草稿.followUp;
  if (能选类型.includes(f.type)) 填.type = f.type;
  const 内容 = (f.content || f.title || "").trim();
  if (内容) 填.content = 内容;
  if (f.occurredAt) {
    const t = dayjs(f.occurredAt);
    if (t.isValid() && !t.isAfter(现在)) 填.occurredAt = t.format(沟通时间格式);
  }
  const 做什么 = (草稿.plan?.subject || (草稿.tasks.find((x) => x.dueAt) ?? 草稿.tasks[0])?.title || "").trim().slice(0, 下一步文字上限);
  if (做什么) 填.下一步 = 做什么;
  const 下次 = 草稿.plan?.plannedAt || 草稿.tasks.find((x) => x.dueAt)?.dueAt || null;
  if (下次) {
    const t = dayjs(下次);
    if (t.isValid() && !t.startOf("day").isBefore(dayjs(现在).startOf("day"))) 填.下一步时间 = t.format("YYYY-MM-DD");
  }
  return 填;
}

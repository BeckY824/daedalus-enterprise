/**
 * 企业版超时回收（2026-10-24，D-34）：线索、商机阶段的项目在一个节点上太久没跟进，自动回到项目公海。
 * 这里只算日子（界面也引，不能碰 prisma）；扫库、回收、提醒在 lib/project/db.ts 的 公海超时收回。
 *
 * 规矩：
 *   - 老板按节点设最长处理天数，没设的节点不回收；订单阶段、已有结局的、已在公海的都不回收
 *   - 企业版（10-26，清单 C7）：没设的节点按字典的默认天数（7 天）算；设了的按设的，改了以后新的回收日按新天数
 *   - 起点 = 最近一次「有人管」：建项目、换节点、接手（转让/领取）、客户上记了跟进，取最晚的
 *   - 起算日（10-31，超时回收设置里配，默认 2026-11-01）：起点早于起算日的一律从起算日算，之前的日子不计入超时
 *   - 起点 + 节点天数 那天还没新动静 → 回收（按自然日，和客户公海一样）
 *   - 记沟通时填了下一步时间：下一步那天过完还没跟进就回收，但不会比节点天数更晚（节点天数是上限）
 *   - 回收前一天（10-27）：夜扫给负责人一条待办提醒；项目看板、列表标「即将回收」
 */
import { dayjs } from "@/lib/utils";
import type { 组织规则 } from "./org-rules";
import { 团队版字典, 同名们, type 阶段字典 } from "./stage-dict";

export const 超时理由 = "超过进程处理时长没跟进，自动回到项目公海";
/** 企业版手动放回公海时选的「回收原因」（字典）记成「回收原因：X」（10-27） */
export const 回收原因前缀 = "回收原因：";

/**
 * 超时回收是系统做的：节点留痕（ProjectNodeLog.userId）、操作日志记在「系统」名下，不记在谁碰巧打开了页面、或夜扫找的那位老板名下（QA #16）。
 * 两列都不建外键（指向人的列），id 不是真成员；界面上按这个 id 显示「系统」
 */
export const 系统 = { id: "system", name: "系统" } as const;

export type 超时项目 = {
  phase: string;
  node: string;
  result?: string | null;
  pooledAt?: Date | string | null;
  nextStepAt?: Date | string | null;
};

/** 起点：这几个时间里最晚的那个（建项目、最后一行节点变更 / 转让 / 领取、客户上最后一次跟进），空的跳过 */
export function 超时起点(...时间: (Date | string | null | undefined)[]): Date {
  return 时间
    .filter((t): t is Date | string => !!t)
    .map((t) => new Date(t))
    .reduce((a, b) => (b > a ? b : a));
}

/** 计时真正的起点（当天零点）：max(原来的起点, 起算日)。起算日没设 / 存坏了 = 原来的起点 */
export function 计时起点(规则: 组织规则, 起点: Date | string) {
  const 起 = dayjs(起点).startOf("day");
  const 算 = 规则.超时回收.起算日 ? dayjs(规则.超时回收.起算日).startOf("day") : null;
  return 算 && 算.isValid() && 算.isAfter(起) ? 算 : 起;
}

/** 这个节点按几天收：设了按设的，没设按字典默认（团队版 null = 不收）。项目存的旧名、配置里的旧 key 都认（企业版 10-31 改名） */
export function 节点超时天数(规则: 组织规则, node: string, 字典: 阶段字典 = 团队版字典): number | null {
  const 们 = 规则.超时回收.节点天数;
  return 们[node] || 同名们(node).map((n) => 们[n]).find(Boolean) || 字典.默认超时天数 || null;
}

/** 哪天会被收回（YYYY-MM-DD）；不会被收回 = null。字典不传 = 团队版（没设天数不收） */
export function 超时回收日(规则: 组织规则, p: 超时项目, 起点: Date | string, 字典: 阶段字典 = 团队版字典): string | null {
  if (!规则.超时回收.开) return null;
  if (p.phase !== "线索" && p.phase !== "商机") return null;
  if (p.result || p.pooledAt) return null;
  const 天数 = 节点超时天数(规则, p.node, 字典);
  if (!天数) return null;
  const 起 = 计时起点(规则, 起点);
  let 日 = 起.add(天数, "day");
  if (p.nextStepAt) {
    const 下一步 = dayjs(p.nextStepAt).startOf("day");
    if (!下一步.isBefore(起)) {
      const 过完 = 下一步.add(1, "day");
      if (过完.isBefore(日)) 日 = 过完;
    }
  }
  return 日.format("YYYY-MM-DD");
}

/** 到了回收日就算超时 */
export function 已超时(回收日: string | null, 今: Date | string = new Date()): boolean {
  if (!回收日) return false;
  return dayjs(今).format("YYYY-MM-DD") >= 回收日;
}

/** 回收日是明天（或今天还没扫到）：给负责人提前一天提醒、看板 / 列表标「即将回收」（10-27） */
export function 即将回收(回收日: string | null, 今: Date | string = new Date()): boolean {
  if (!回收日) return false;
  return dayjs(回收日).diff(dayjs(今).startOf("day"), "day") <= 1;
}

/** 回收前一天给负责人的待办提醒标题（同一天同一个项目只提醒一次，按标题查重） */
export function 将回收提醒(项目名: string, 节点: string, 回收日: string): string {
  return `${将回收提醒头(项目名, 节点)}${回收日} 会自动回到项目公海`;
}

/** 提醒标题去掉回收日的那截：记了沟通后按它找这个项目这个节点还没勾的提醒 */
export function 将回收提醒头(项目名: string, 节点: string): string {
  return `项目「${项目名}」在「${节点}」再不跟进，`;
}

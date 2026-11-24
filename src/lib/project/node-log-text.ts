/**
 * 项目节点记录（ProjectNodeLog）给人看的那几句：项目详情「进程变更」卡、客户详情「历史变更」弹窗共用一套，不另写。
 * 纯函数、不碰库：项目详情是客户端组件也 import（原来写在 ProjectDetail.tsx 里，11-24 历史变更挪出来）
 */
import { 公海领取文字 } from "./transfer-log-text";
import { 结局叫法, 团队版字典, type 位置, type 阶段字典 } from "./nodes";
import { 超时理由 } from "./timeout";

/** 项目怎么进的公海（load.ts 按理由分）：超时 = 系统收的；停用 = 管理员办停用时放的；手动 = 有人放回 */
export type 放回方式 = "超时" | "停用" | "手动";

/** 节点记录里换负责人那几种行要的几样（项目详情 logs 一行就满足） */
export type 换人行 = {
  kind: "node" | "transfer" | "pool-release" | "pool-claim";
  who: string;
  reason: string | null;
  transfer: { from: string; to: string } | null;
  放回方式?: 放回方式;
};

/** 「线索·潜客培育」「订单·验收交付（异常状态）」；结局按字典的叫法（后台改了出口叫法就用改的） */
export function 位置文字(p: 位置, 字典: 阶段字典 = 团队版字典): string {
  return `${p.phase}·${p.node}${p.result ? `（${结局叫法(p.result, 字典)}）` : ""}`;
}

/** 节点变更里换负责人那几种行怎么说。放回公海按真正的操作人说（QA 第 14 条：超时是系统、停用是办的那位管理员，不是原负责人） */
export function 换人文字(l: 换人行): string {
  const t = l.transfer ?? { from: "没人", to: "没人" };
  if (l.kind === "pool-release") {
    // 老数据没带方式的按理由认超时
    const 方式 = l.放回方式 ?? (l.reason === 超时理由 ? "超时" : "手动");
    if (方式 === "超时") return `${t.from} 的项目超时没跟进，系统自动收回到线索公海`;
    if (方式 === "停用") return `${l.who} 办成员停用，把 ${t.from} 的项目放回线索公海`;
    return l.who === t.from ? `${t.from} 把项目放回线索公海` : `${l.who} 把 ${t.from} 的项目放回线索公海`;
  }
  // 按留痕原因的开头分客户公海分配 / 线索公海分配 / 跟着客户 / 自己领（lib/project/transfer-log-text.ts，3703 实操 11-21）
  if (l.kind === "pool-claim") return 公海领取文字({ who: l.who, reason: l.reason, to: t.to });
  return `负责人从 ${t.from} 转给 ${t.to}`;
}

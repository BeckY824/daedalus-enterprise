/**
 * 流转线（32G，Even 11-20 口径 + 用户 11-20 拍板）的纯函数：不连库，范围层（visibility.ts）、写库那边（flow-line.ts）、单测都用这份。
 *
 * 每条线索（项目）有一条固定的线（内贸 / 外贸），存在 Project.flowLine（迁移 157），客户的线 = 名下线索最近一次写的线（Customer.flowLine，迁移 158）。
 * 只在这几种时候写：
 *   - 市场分配那一刻（自动或指定）：按 P-转-26 定的分配方向（含手改），方向判不出按接收人所在事业部
 *   - 销售 / 市场新增：按新增人所在事业部（市场建了马上分出去的，分配那一刻再按方向写一次）
 *   - 管理（总管理、销售管理，含系统管理员）手动指定 = 改线：写成接收人所在事业部
 * 系统自动的超时转、公海领取、销售自己转让都不改线。
 *
 * 用处：超时转只在这条线里挑人（assign-actions.ts 超时转出）；公海按线给人看（公海线of：内贸的人只看内贸的公海，外贸同理）。
 */
import type { 组织 } from "./org-core";
import { 是系统管理员of, 是市场成员of, 管理指定不限of } from "./org-core";
import { 本人事业部 } from "./customer-region";
import type { 线部门 } from "./assign-line";
import type { 线 } from "./lead-assign";

export const 认线 = (x: unknown): 线 | null => (x === "内贸" || x === "外贸" ? x : null);

const 角色们 = (org: 组织, id: string) => org.成员.get(id)?.角色们 ?? [];

/**
 * 这个人在公海里只看哪条线（P-公海 按线可见，32G）。undefined = 两条线都看：
 *   - 系统管理员（是系统管理员of：没设线的总管理，或带系统管理员标记的）
 *   - 只读管理员、销售教练（业务角色 admin / coach，不兼总管理；教练「公海照看同只读管理员」P-教练-04）
 *   - 市场成员：有市场管理 / 渠道运营角色（兼销售的也算，任一角色放行 P-判定-01），或按部门认的市场成员（M-角色-02，市场成员们 那份名单）
 *   - 判不出事业部的人（没部门、部门名里看不出内外贸，同 业务线放行「自己没设业务线不限」）
 * 其余（销售、销售管理、条线总管理……）= 本人事业部（成员业务线 → 所在部门）
 */
export function 公海线of(org: 组织, 设: 线部门 | null, 市场人们: ReadonlySet<string>, id: string): 线 | undefined {
  if (是系统管理员of(org, id)) return undefined;
  const 们 = 角色们(org, id);
  if (们.some((r) => r === "admin" || r === "coach") && !们.includes("director")) return undefined;
  if (们.some((r) => r === "marketing_mgr" || r === "channel_ops") || 市场人们.has(id)) return undefined;
  return 本人事业部(org, 设, id) ?? undefined;
}

/** 新增时的线：新增人所在事业部（判不出 = null，先空着，之后分配 / 管理指定时再写） */
export function 新建线of(org: 组织, 设: 线部门 | null, 建的人: string): 线 | null {
  return 本人事业部(org, 设, 建的人);
}

/**
 * 换负责人的时候线怎么变（undefined = 不改）：
 *   - 自动分配（市场自动分配、定时到点）：方向 → 接收人事业部
 *   - 操作人有管理角色（总管理、销售管理，含系统管理员；兼市场的按管理算，同 管理指定不限of）手动指定 = 改线：接收人事业部 → 方向
 *   - 操作人是市场成员（市场管理、渠道运营）手动指定：方向（P-转-26，含手改）→ 接收人事业部
 *   - 其余（系统自动的超时转、自己领公海、销售自己转让、没有操作人）：不改
 * 超时转不走这里（调用方直接不改）；操作人 = 接收人（自己领）一律不改
 */
export function 换人后的线(
  org: 组织, 设: 线部门 | null,
  a: { 操作人: string | null; 接手人: string; 方向?: 线 | null; 自动?: boolean },
): 线 | undefined {
  const 接手线 = () => 本人事业部(org, 设, a.接手人) ?? undefined;
  if (a.自动) return a.方向 ?? 接手线();
  if (!a.操作人 || a.操作人 === a.接手人) return undefined;
  if (管理指定不限of(org, a.操作人) || 是系统管理员of(org, a.操作人)) return 接手线() ?? a.方向 ?? undefined;
  const 们 = 角色们(org, a.操作人);
  if (们.some((r) => r === "marketing_mgr" || r === "channel_ops") || 是市场成员of(org, a.操作人)) return a.方向 ?? 接手线();
  return undefined;
}

/**
 * 超时转用的线：项目上存的流转线；没存（老数据定线脚本没跑到、新增人判不出事业部）按当时负责人所在事业部兜底；
 * 还判不出 = null（不转、只记日志）
 */
export function 超时转的线(org: 组织, 设: 线部门 | null, 存的: unknown, 当时负责人: string): 线 | null {
  return 认线(存的) ?? 本人事业部(org, 设, 当时负责人);
}

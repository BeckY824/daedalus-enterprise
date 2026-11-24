/**
 * 市场角色的项目页（11-04 P-界面-05 / 08、P-看-05 / 06、P-线索-02）。只认「市场成员」「市场管理」两类，别的角色一律 null、照旧。
 *
 * 范围（不另开视图，就是左栏「项目」页的默认范围）：
 * - 市场成员（含渠运）：自己负责的 ∪ 自己创建、已分配给别人的（不在公海）。
 * - 市场管理：本人 + 实线下属（逐级）负责的或创建的（不在公海），多一个「创建人」筛选。
 *   团队范围（team-scope 看得到的项目）给市场管理的是全部市场成员（P-看-04 还没做），这里按实线收窄。
 * - 都加上自己是已加入组员的（组员本来就能进、能看，不收）。
 * - 进了公海的不在项目页（归因看渠道页看板的「进公海」）；被领走后 pooledAt 清空、负责人是领走的人，照这条又回来。
 *
 * 只看进度（P-看-06）：负责人不在圈里、我也不是组员 → 列表里看得到这一行，点不进详情；
 * 详情页、搜索、提醒链接、收藏、直接输网址都在服务端挡（见 市场挡详情）。
 * 例外：等「市场复核」、我能拍板的那条（复核要进详情看来龙去脉），照旧能进。
 */
import { 实线下属, type 组织 } from "./org-core";
import { 只看的人, 业务线放行 } from "./permissions";

export type 市场视角 = "市场成员" | "市场管理";

/**
 * 一个人在项目页算不算市场视角。总管理 / 销售 / 销管兼着的不算（他们本来的范围更大）；设了「只看某人」的照旧走那条。
 * 销售教练、只读管理员（看全部那一类）放在市场部门里也不算（录音点评跟进 11-22，3703 实操：教练在市场部门里按「市场成员」挡详情，
 * 打开哪个项目都是「没有找到这条记录」）：他们按 P-教练-01 / 只读管理员的口径看全部，不论部门
 */
export function 市场视角of(org: 组织 | null, id: string, 市场成员集: ReadonlySet<string>): 市场视角 | null {
  if (!org || 只看的人(org, id)) return null;
  const 们 = org.成员.get(id)?.角色们 ?? [];
  if (们.some((r) => r === "director" || r === "sales" || r === "sales_mgr" || r === "coach" || r === "admin")) return null;
  if (们.includes("marketing_mgr")) return "市场管理";
  if (市场成员集.has(id) || 们.includes("channel_ops")) return "市场成员";
  return null;
}

/** 圈：市场成员 = 自己；市场管理 = 自己 + 实线下属（照 业务线放行，同 看得到下属的） */
export function 市场圈(org: 组织, id: string, 视角: 市场视角): string[] {
  if (视角 === "市场成员") return [id];
  return [id, ...[...实线下属(org, id)].filter((x) => x !== id && 业务线放行(org, id, { ownerId: x }))];
}

/** 项目列表的 where（和别的条件 AND）。创建人 = 市场管理在筛的那位，不在圈里的当没筛 */
export function 市场项目条件(我: string, 圈: readonly string[], 创建人 = "") {
  const 筛 = 创建人 && 圈.includes(创建人) ? 创建人 : "";
  return {
    pooledAt: null,
    ...(筛 ? { creatorId: 筛 } : {}),
    OR: [
      { ownerId: { in: [...圈] } },
      { creatorId: { in: [...圈] }, ownerId: { not: "" } },
      { members: { some: { userId: 我, inviteStatus: "JOINED" } } },
    ],
  };
}

/** 这一行是不是「只看进度」：负责人不在圈里、我不是已加入的组员、也不是等我拍板的市场复核 */
export function 只看进度(圈: readonly string[], 我: string, p: { ownerId: string; 已加入?: readonly string[] }, 等我复核 = false): boolean {
  if (等我复核) return false;
  if (圈.includes(p.ownerId)) return false;
  if (p.已加入?.includes(我)) return false;
  return true;
}

/**
 * 详情页、搜索、提醒、收藏那几处问：市场视角的人能不能进这条的详情。不是市场视角 = 不管（返回 false，交回原来的 能看项目）。
 * 进了公海的不在这里挡（公海页、领取那条照旧）
 */
export function 市场挡详情(
  org: 组织 | null, 我: string, 市场成员集: ReadonlySet<string>,
  p: { ownerId: string; pooledAt?: Date | null; 已加入?: readonly string[] }, 等我复核 = false,
): boolean {
  const 视角 = 市场视角of(org, 我, 市场成员集);
  if (!视角 || !org || p.pooledAt) return false;
  return 只看进度(市场圈(org, 我, 视角), 我, p, 等我复核);
}

/**
 * 按部门认的市场成员、只挂销售（P-看-17，用户 11-24）：在市场成员名单里（M-角色-02 按部门认，或逐人设的），业务角色有销售、
 * 没有市场角色（市场管理、渠运）也没有总管理 / 销管 / 教练 / 只读管理员。市场视角of 因为兼着销售不认他（项目页按销售那套画、列表不收窄），
 * 列表按 P-看-05 放开（visibility.ts 市场的人 给 [id]），详情 能看项目 只认业务角色，自己建的、已分给别人的进不去
 */
export function 部门市场销售(org: 组织 | null, id: string, 市场成员集: ReadonlySet<string>): boolean {
  if (!org || 只看的人(org, id) || !市场成员集.has(id)) return false;
  const 们 = org.成员.get(id)?.角色们 ?? [];
  return 们.includes("sales") && !们.some((r) => r === "director" || r === "sales_mgr" || r === "coach" || r === "admin" || r === "marketing_mgr" || r === "channel_ops");
}

/**
 * 这条是不是「部门市场销售」点进来、该跳市场视角页（P-界面-11）而不是 404 的那种：自己建的、已分给别人（有负责人、不在公海）、自己也没进组。
 * 只认列表里真有这一行的（同 市场项目条件 的「建的人在圈里、已有负责人」），调用方另判 能看项目 不过才跳
 */
export function 部门市场销售该转向(
  org: 组织 | null, 我: string, 市场成员集: ReadonlySet<string>,
  p: { ownerId: string; creatorId?: string | null; pooledAt?: Date | null; 已加入?: readonly string[] },
): boolean {
  if (p.pooledAt || !p.ownerId || p.ownerId === 我 || p.creatorId !== 我 || p.已加入?.includes(我)) return false;
  return 部门市场销售(org, 我, 市场成员集);
}

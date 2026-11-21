/**
 * 「待分配新线索」谁看得到、看哪几条（11-21 改版，P-转-21 / P-转-38 / X-79）：首页那一行的条数和新线索页 f=await-assign 列的行，
 * 都由 lib/project/list.ts 列表条件 把这里的条件并进去，同一个函数，数对得上。
 *
 * - 「线索分配」开着：能手动分配线索的人（市场管理、销售管理、总管理，permissions.ts 能分配线索）才有；
 *   按他能分的业务线圈：系统管理员、没设业务线的不限；设了业务线的（内贸销售管理、外贸条线总管理……）只看这条线的，
 *   外加业务线是「暂不分配」的（哪条线都没定，谁分都行）。项目算哪条线同 assign-line.ts 项目业务线：填了按填的，没填按负责人的线，再没有按内贸。
 * - 开关关着：只有系统管理员（X-79：已进待分配的由系统管理员处理），不限线。
 * - 别的人（销售、只读管理员、设了只看某人的）：null，什么都没有。
 *
 * 不套首页指标卡「按负责人圈」（home-cards 首页卡的人）：待分配时负责人那一格是建的人占着，按负责人圈会把上级数成 0。
 * 可见范围照旧由限定层管（同列表、同分配弹窗 分前看），这里只收窄，不放宽
 */
import type { Prisma } from "@/generated/prisma";
import { 企业版 } from "./switch";
import { 读组织 } from "./org";
import { 规则开着 } from "./rules";
import { 能分配线索, 是系统管理员, type 谁 } from "./permissions";
import type { 组织 } from "./org-core";
import { 待分配在等, 本线待分配条件 } from "./await-assign-core";

/** 我能看的待分配新线索的条件；null = 我没有这一行（不画、新线索页筛出来是空的） */
export async function 待分配范围(me: 谁, 预读?: { org?: 组织; 开着?: boolean }): Promise<Prisma.ProjectWhereInput | null> {
  if (!企业版()) return null;
  const org = 预读?.org ?? (await 读组织());
  const 开着 = 预读?.开着 ?? (await 规则开着("线索分配"));
  if (!开着) return 是系统管理员(me, org) ? 待分配在等 : null;
  if (!能分配线索(me, org)) return null;
  const 线 = 是系统管理员(me, org) ? null : (org.成员.get(me.id)?.line ?? null);
  return 线 === "内贸" || 线 === "外贸" ? { AND: [待分配在等, 本线待分配条件(org, 线)] } : 待分配在等;
}

/**
 * 企业版权限：只认业务角色（2026-11-01 用户定）。
 *
 *   「账号只保持姓名，角色才是他们的实际权限。例如账号：某某，角色：销售管理。这就结束了」
 *   「兜底不留，没设业务角色就没权限。」
 *
 * 所以这里不看账号角色（User.role 的 ADMIN / MANAGER），只看组织里的业务角色（EntMember.bizRole，可多选，org-core.ts 角色们）。
 * 没设业务角色 = 下面每个动作都拒。页面、接口都调这几个函数，别各自再写一遍角色判断。
 *
 * 规则（会议 §4 + 11-01 拍板）：
 *   - 总管理（director）：看全部；能转让、重新分配，但**不能编辑项目内容**（字段、节点推进、沟通）；
 *     只有总管理能删除、能在回收站恢复（C3、C4）；能进设置，勾了「不管设置」的进不了（C1），其余照旧
 *   - 管理员（admin，11-01 晚定）：「可以看所有。但不能做任何编辑」——看全部、任何写都拒（客户、项目、线索、沟通、待办、卡点、
 *     设置、分配、删除、导入）。设置页能看不能改；组织架构、业务角色的分配只有总管理能做。兼了别的角色也只读（总管理除外）。
 *     服务端统一拦在 lib/team-scope.ts 加上限定（同切换视图那一层），见 只读角色
 *   - 切换视图：只有总管理、管理员（11-01 晚定）
 *   - 销售（sales / sales_mgr）：自己是负责人的项目能看、能编辑；只是创建人不是负责人 = 没有任何权限
 *   - 市场（marketing_mgr / channel_ops）：自己创建的项目只能看
 *   - 管理（直属上级，含销售管理）：看自己的 + 下属的（实线整条链；虚线下属只能看），能转让、重新分配，不能编辑内容（C2）；
 *     自己当负责人的按负责人规则
 *   - 分配线索：市场管理、销售管理、总管理（A7）
 *   - 管理类成员看别人的项目再按自己的业务线（EntMember.line）过滤：外贸只看外贸、内贸只看内贸、没设不限
 *   - 被邀请进项目、点了同意的组员（项目运营部、营销企划部这类）：能看、不能编辑
 *
 * 不是企业版（团队版 / 老测试，这个仓库已不部署）按老规矩（账号角色）走，见 老；
 * 企业版里 org 传 null 一律拒，不留后门。org 用 org.ts 的 权限组织() 读。
 */
import type { 业务角色, 业务线 } from "@/lib/sync/dept-policy";
import { 实线下属, 虚线下属, type 组织 } from "./org-core";
import { 企业版 } from "./switch";

export type 谁 = { id: string; role?: string | null };
/** 判权限用到的项目字段。已加入 = 点了同意（inviteStatus = JOINED）的组员 userId */
export type 权限项目 = { ownerId: string; creatorId?: string | null; pooledAt?: Date | null; 已加入?: readonly string[] };

/** 总管理：能管全公司（转让、删除、恢复、设置）。11-01 晚起不含 admin（admin 只读） */
const 总管理角色: readonly 业务角色[] = ["director"];
/** 看全部：总管理 + 管理员（只读） */
const 看全部角色: readonly 业务角色[] = ["director", "admin"];
/** 负责人规则能编辑的角色 */
const 负责人角色: readonly 业务角色[] = ["sales", "sales_mgr"];
/** 「市场」：自己创建的项目只能看 */
const 市场角色: readonly 业务角色[] = ["marketing_mgr", "channel_ops"];
/** 能分配线索（A7） */
const 分线索角色: readonly 业务角色[] = ["director", "sales_mgr", "marketing_mgr"];

const 角色们 = (org: 组织, id: string): readonly 业务角色[] => org.成员.get(id)?.角色们 ?? [];
const 有 = (org: 组织, id: string, 们: readonly 业务角色[]) => 角色们(org, id).some((r) => 们.includes(r));

/**
 * 不是企业版时的老规矩（团队版 / 老测试）：账号 ADMIN / MANAGER 放行，org 传不传都不看。
 * 企业版里不走这里：org 一定要传，传了 null 就拒。这是整个仓库里判权限唯一还看账号角色的地方
 */
const 老 = () => !企业版();
const 老管 = (me: 谁) => me.role === "ADMIN" || me.role === "MANAGER";
const 老板 = (me: 谁) => me.role === "ADMIN";

/** 没设业务角色（不在职、没有 EntMember 行、角色串空） */
export function 没设业务角色(org: 组织, userId: string): boolean {
  return 角色们(org, userId).length === 0;
}

/** 总管理（director）：企业版问「能不能管全公司」都调这个。只问「看不看得到全部」用 能看全部 */
export function 是总管理(me: 谁, org: 组织 | null): boolean {
  if (老()) return 老板(me);
  return !!org && 有(org, me.id, 总管理角色);
}

/** 能看全部：总管理、管理员（admin 只读）。老规矩 = 账号 ADMIN / MANAGER */
export function 能看全部(me: 谁, org: 组织 | null): boolean {
  if (老()) return 老管(me);
  return !!org && 有(org, me.id, 看全部角色);
}

/**
 * 只读角色：业务角色里有管理员（admin）、又不是总管理（director）。「可以看所有。但不能做任何编辑」（11-01）。
 * 写全拒：服务端在 lib/team-scope.ts 加上限定统一拦（visibility.ts 算出来的范围带 只读），界面写入按钮按这个藏 / 灰。
 * 不是企业版没有这个角色
 */
export function 只读角色(me: 谁, org: 组织 | null): boolean {
  return !老() && !!org && 有(org, me.id, ["admin"]) && !有(org, me.id, 总管理角色);
}
/** 只读角色写的时候那一句 */
export const 只读角色话 = "管理员只能看，不能改任何数据";

/* 切换视图（M-权限-08）只有总管理、管理员：见 view-as.ts 能切换视图（菜单、action、认票同一处） */

/** 有没有某个业务角色（兼几个的算任一个）。org = null（不是企业版）一律没有 */
export function 有业务角色(me: 谁, org: 组织 | null, ...们: 业务角色[]): boolean {
  return !老() && !!org && 有(org, me.id, 们);
}

/**
 * 项目的业务线（判管理类成员看不看得到）。
 * 暂时按负责人的 EntMember.line 判；PR-C 合并后改用 项目业务线()（项目上新加的业务线字段）。
 * null = 说不清（负责人没设业务线），不按业务线拦
 */
export function 项目可见业务线(org: 组织, p: { ownerId: string }): 业务线 | null {
  return org.成员.get(p.ownerId)?.line ?? null;
}

/** 管理类成员按自己的业务线过滤别人的项目：自己没设业务线不限；项目说不清业务线也不拦 */
export function 业务线放行(org: 组织, 我: string, p: { ownerId: string }): boolean {
  const 我线 = org.成员.get(我)?.line ?? null;
  if (!我线) return true;
  const 线 = 项目可见业务线(org, p);
  return !线 || 线 === 我线;
}

/** 负责人在不在我手下（实线下属整条链），且业务线对得上：管理转让、重新分配按这个 */
function 实线管得到(org: 组织, 我: string, ownerId: string): boolean {
  return 实线下属(org, 我).has(ownerId) && 业务线放行(org, 我, { ownerId });
}
/** 只看：实线下属（业务线对得上）+ 虚线下属（虚线只能看，D-39；虚线是专门跨线配的，不按业务线滤） */
function 看得到下属的(org: 组织, 我: string, ownerId: string): boolean {
  if (实线下属(org, 我).has(ownerId) && 业务线放行(org, 我, { ownerId })) return true;
  for (const d of 虚线下属(org, 我)) if (d === ownerId || 实线下属(org, d).has(ownerId)) return true;
  return false;
}

/** 看：项目详情、列表里露不露 */
export function 能看项目(me: 谁, p: 权限项目, org: 组织 | null): boolean {
  if (老()) return 老管(me) || me.id === p.ownerId || !!p.pooledAt;
  if (!org || 没设业务角色(org, me.id)) return false;
  if (有(org, me.id, 看全部角色)) return true;
  // 项目公海：谁都看得到才能领（历史负责人不能领、不能看另由公海那条规则管）
  if (p.pooledAt) return true;
  if (p.ownerId === me.id) return true;
  if (p.已加入?.includes(me.id)) return true;
  if (p.creatorId === me.id && 有(org, me.id, 市场角色)) return true;
  return 看得到下属的(org, me.id, p.ownerId);
}

/**
 * 编辑项目内容（字段、节点推进、沟通、交付勾选、组员）：只有负责人本人，且负责人得是销售 / 销售管理。
 * 总管理、上级、市场、组员都只能看（C2）。公海里的项目没有负责人：谁都改不了，先领
 */
export function 能编辑项目(me: 谁, p: 权限项目, org: 组织 | null): boolean {
  if (老()) return 老管(me) || (!p.pooledAt && me.id === p.ownerId);
  if (!org || p.pooledAt || 只读角色(me, org)) return false;
  return p.ownerId === me.id && 有(org, me.id, 负责人角色);
}

/**
 * 转让、重新分配负责人（含公海里的项目指给人）：总管理；负责人的实线上级（业务线对得上）；
 * 负责人本人转出自己的项目（11-02：「负责人自己转出也可以，前提是自己的项目」）。
 * 公海里的项目原负责人已清掉，按「销售管理 + 业务线」放行
 */
export function 能转让项目(me: 谁, p: 权限项目, org: 组织 | null): boolean {
  if (老()) return 老管(me) || (!p.pooledAt && me.id === p.ownerId);
  if (!org || 只读角色(me, org)) return false;
  if (有(org, me.id, 总管理角色)) return true;
  if (能编辑项目(me, p, org)) return true;
  if (p.pooledAt) return 有(org, me.id, ["sales_mgr"]) && 业务线放行(org, me.id, p);
  return 实线管得到(org, me.id, p.ownerId);
}

/** 负责人转出自己的客户（11-02，同 能转让项目 的负责人本人）：销售、销售管理；转的是不是他自己的、在不在公海，调用处查 */
export function 能转出自己的(me: 谁, org: 组织 | null): boolean {
  if (老()) return true;
  return !!org && !只读角色(me, org) && 有(org, me.id, 负责人角色);
}

/** 放回公海：负责人本人（能编辑的），或能转让的（老板、主管也能退回公海 #137 → 总管理、上级） */
export function 能放回公海(me: 谁, p: 权限项目, org: 组织 | null): boolean {
  return !p.pooledAt && (能编辑项目(me, p, org) || 能转让项目(me, p, org));
}

/** 分配线索（A7）：市场管理、销售管理、总管理 */
export function 能分配线索(me: 谁, org: 组织 | null): boolean {
  if (老()) return 老管(me);
  return !!org && !只读角色(me, org) && 有(org, me.id, 分线索角色);
}

/**
 * 公海：分给同事、撤销分配、把别人的客户放回公海、标无效客户（原 constants.ts 管全队客户 = 账号 ADMIN / MANAGER）：
 * 总管理、销售管理。恢复无效客户另走 能恢复（只有总管理，C4）
 */
export function 能管公海(me: 谁, org: 组织 | null): boolean {
  if (老()) return 老管(me);
  return !!org && !只读角色(me, org) && 有(org, me.id, ["director", "sales_mgr"]);
}

/** 删除（客户、联系人、项目、线索、沟通记录进回收站；彻底删除）：只有总管理 director（C3；管理员 admin 只读，不能删） */
export function 能删除(me: 谁, org: 组织 | null): boolean {
  return 是总管理(me, org);
}

/** 回收站：看、恢复，公海里恢复无效客户：只有总管理（C4） */
export function 能恢复(me: 谁, org: 组织 | null): boolean {
  return 是总管理(me, org);
}

/** 进设置页（看）：总管理、管理员（只读看），勾了「不管设置」的不行（C1） */
export function 能进设置(me: 谁, org: 组织 | null): boolean {
  if (老()) return 老板(me);
  return !!org && 有(org, me.id, 看全部角色) && !org.成员.get(me.id)?.不管设置;
}

/** 改后台设置（含组织架构、业务角色分配）：只有总管理 director，勾了「不管设置」的不行（C1）。管理员能进设置页看、不能改 */
export function 能改后台设置(me: 谁, org: 组织 | null): boolean {
  if (老()) return 老板(me);
  return !!org && 有(org, me.id, 总管理角色) && !org.成员.get(me.id)?.不管设置;
}

/**
 * 「经理」：老规矩 = 账号 ADMIN / MANAGER；企业版 = 总管理（director）、销售管理。
 * 需求补全期往前推、缺必填硬推这类「经理才行」的口子用，前提是先过了 能编辑项目（总管理过不了，等于只剩自己当负责人的销售管理）
 */
export function 是经理(me: 谁, org: 组织 | null): boolean {
  if (老()) return 老管(me);
  return !!org && 有(org, me.id, ["director", "sales_mgr"]);
}

/**
 * 「管理层」：总管理、销售管理、市场管理，或手下有人（直属 / 虚线上级）。
 * 首页、复盘按人看、给下属推必填这类「管人」的入口用；不等于能编辑别人的项目
 */
export function 是管理层(me: 谁, org: 组织 | null): boolean {
  if (老()) return 老管(me);
  if (!org) return false;
  return 有(org, me.id, ["director", "admin", "sales_mgr", "marketing_mgr"]) || 实线下属(org, me.id, 1).size > 0 || 虚线下属(org, me.id, 1).size > 0;
}

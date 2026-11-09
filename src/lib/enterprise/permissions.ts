/**
 * 企业版权限：只认业务角色（2026-11-01 用户定），规则按《CRM权限方案终版 V3.5.1》+《权限表反馈》（11-03）。
 *
 *   「账号只保持姓名，角色才是他们的实际权限。」「兜底不留，没设业务角色就没权限。」
 *
 * 不看账号角色（User.role），只看 EntMember.bizRole（可多选，org-core.ts 角色们）。页面、接口都调这里，别各自再写一遍角色判断。
 *
 * 四权（看 / 编 / 转 / 删）：
 *   - 系统管理员（director、没设业务线）：全部；软删、真删、回收站；切换视角、后台设置、导入导出、成员管理只给他
 *   - 条线总管理（director 又设了业务线）：看本线人员名下全部；条线内别人负责的只看，本人负责的能编（X-07）；条线内能转让；不能删（line-viewer.ts 条线范围of）
 *   - 销管（sales_mgr）：看实线下属整条链 + 自己 + 公海；只编辑自己负责的；转让直属一级（同业务线）；自己负责的能软删
 *   - 销售（sales）：自己 + 公海；编辑、转让、软删自己负责的
 *   - 市管（marketing_mgr）：看本人 + 直属下级创建的项目（线索，不管什么状态，11-05 客户定）+ 直属市场成员相关的 + 公海；不编辑；转让直属一级；不删。
 *     能当负责人、交接接收人（11-05 客户：「市场管理是可以当负责人的」），名下的能转出
 *   - 项目组员（project_ops）：看加入的项目；被指定为负责人才能编辑；不转、不删
 *   - 渠运（channel_ops）：本人负责的能看、编、软删，成熟后转出给销售；自己创建的客户一直看得到（market.ts）；不领公海
 *   - 设了「只看某人」的（org.只看某人，V3.5.1 市管特例）：业务数据只看 那个人 = 创建人或负责人 的，公海照常；不当负责人、不编、不转、不删
 *   - 管理员只读（admin、不兼 director）：看全部（设了业务线只看这条线，line-viewer.ts）；什么都不能改，服务端统一拦在 team-scope
 *   - 没设角色 / 停用：只看公海
 * 转让白名单（四选一）：负责人本人、实线直属上级（只一级）、条线总管理（条线内）、系统管理员。
 * 领公海：销售、销管、条线总管理、系统管理员。回收站：系统管理员 + 回收站副手（org.回收站副手）。
 *
 * 不是企业版（这个仓库已不部署）按老规矩（账号角色）走，见 老；企业版里 org 传 null 一律拒。org 用 org.ts 的 权限组织() 读。
 */
import type { 业务角色, 业务线 } from "@/lib/sync/dept-policy";
import { 项目业务线 } from "./assign-line";
import { 按线的线, 按线范围of, 条线范围of } from "./line-viewer";
import { 实线下属, 虚线下属, type 组织 } from "./org-core";
import { 企业版 } from "./switch";

export type 谁 = { id: string; role?: string | null };
/** 判权限用到的项目字段。已加入 = 点了同意（inviteStatus = JOINED）的组员 userId */
export type 权限项目 = { ownerId: string; creatorId?: string | null; pooledAt?: Date | null; bizLine?: string | null; 已加入?: readonly string[] };

/** 负责人规则能编辑的角色：销售、销管、渠运，项目组员被指定为负责人时也能（V3.5.1） */
const 可编辑角色: readonly 业务角色[] = ["sales", "sales_mgr", "channel_ops", "project_ops"];
/** 能转出、软删自己名下的：销售、销管、渠运（项目组员不能） */
const 负责人角色: readonly 业务角色[] = ["sales", "sales_mgr", "channel_ops"];
/** 「市场」：自己创建的项目只能看 */
const 市场角色: readonly 业务角色[] = ["marketing_mgr", "channel_ops"];
/** 能分配线索（A7） */
const 分线索角色: readonly 业务角色[] = ["director", "sales_mgr", "marketing_mgr"];
/** 领公海（V3.5.1）：销售、销管、条线总管理、系统管理员 */
const 领公海角色: readonly 业务角色[] = ["sales", "sales_mgr", "director"];

const 角色们 = (org: 组织, id: string): readonly 业务角色[] => org.成员.get(id)?.角色们 ?? [];
const 有 = (org: 组织, id: string, 们: readonly 业务角色[]) => 角色们(org, id).some((r) => 们.includes(r));

/** 销售：销售、销售管理（市场分给销售算转客户时认这两个，只看业务角色） */
const 销售角色: readonly 业务角色[] = ["sales", "sales_mgr"];
export const 是市场角色 = (org: 组织, id: string): boolean => 有(org, id, 市场角色);
export const 是销售角色 = (org: 组织, id: string): boolean => 有(org, id, 销售角色);

/** 设了「只看某人」（V3.5.1 市管特例）：回那个人的 id；没设 null。企业版里才有 */
export function 只看的人(org: 组织 | null, id: string): string | null {
  return (!老() && org?.只看某人?.get(id)) || null;
}
/** 设了「只看某人」的人写的时候那一句 */
export const 只看某人话 = "你设了「只看某人」，只能看，不能改";

/**
 * 不是企业版时的老规矩（团队版 / 老测试）：账号 ADMIN / MANAGER 放行，org 传不传都不看。
 * 企业版里不走这里：org 一定要传，传了 null 就拒。这是整个仓库里判权限唯一还看账号角色的地方
 */
const 老 = () => !企业版();
const 老管 = (me: 谁) => me.role === "ADMIN" || me.role === "MANAGER";
const 老板 = (me: 谁) => me.role === "ADMIN";

/** 没设业务角色（不在职、没有 EntMember 行、角色串空） */
export function 没设业务角色(org: 组织 | null, userId: string): boolean {
  return !org || 角色们(org, userId).length === 0;
}

/**
 * 系统管理员（V3.5.1）：业务角色总管理（director）、没设业务线。设了业务线的总管理是条线总管理，不算（line-viewer.ts 条线的线）。
 * 企业版问「能不能管全公司」（真删、回收站、设置、切换视角、导入导出、成员管理）都调这个。只问「看不看得到全部」用 能看全部
 */
export function 是系统管理员(me: 谁, org: 组织 | null): boolean {
  if (老()) return 老板(me);
  const m = org?.成员.get(me.id);
  return !!m && m.角色们.includes("director") && !m.line;
}

/** 老名字：等于 是系统管理员（V3.5.1 起条线总管理不在内） */
export const 是总管理 = 是系统管理员;

/** 能看全部：系统管理员、没设业务线的管理员（admin 只读）。条线总管理只看本线（条线范围of）。老规矩 = 账号 ADMIN / MANAGER */
export function 能看全部(me: 谁, org: 组织 | null): boolean {
  if (老()) return 老管(me);
  return !!org && (是系统管理员(me, org) || (只读角色(me, org) && !按线的线(org, me.id)));
}

/** 管理员设了业务线（11-02）：只看这条线，回这条线；别的情况 null。写一律拒，同 只读角色 */
export function 只读按线(me: 谁, org: 组织 | null): 业务线 | null {
  return !老() && org ? 按线的线(org, me.id) : null;
}

/**
 * 只读角色：业务角色里有管理员（admin）、又不是总管理（director）。「可以看所有。但不能做任何编辑」（11-01）。
 * 写全拒：服务端在 lib/team-scope.ts 加上限定统一拦（visibility.ts 算出来的范围带 只读），界面写入按钮按这个藏 / 灰。
 * 不是企业版没有这个角色
 */
export function 只读角色(me: 谁, org: 组织 | null): boolean {
  return !老() && !!org && 有(org, me.id, ["admin"]) && !有(org, me.id, ["director"]);
}
/** 只读角色写的时候那一句 */
export const 只读角色话 = "管理员只能看，不能改任何数据";
/**
 * 能当负责人（11-03 完成度 D3-9 / C3-1）：企业版 = 有业务角色、不是只读管理员（含按线的）；不看账号角色——
 * 账号 ADMIN 的真销售能选，没设角色的人、只读管理员选不到（原来只排除账号 ADMIN，管理员照样进下拉、能被转给、能接交接）。
 * 下拉（owners.ts 负责人口径）和服务端各入口都按这一处。不是企业版一律能（老规矩在 负责人口径 里）
 */
export function 能当负责人(org: 组织 | null, userId: string): boolean {
  return 不能当负责人话(org, userId) === null;
}
/**
 * 不能当负责人时那一句；能当 = null。市场管理也能当（11-05 客户：「市场管理是可以当负责人的」）
 */
export function 不能当负责人话(org: 组织 | null, userId: string): string | null {
  if (老()) return null;
  if (没设业务角色(org, userId)) return "该成员还没设业务角色，不能当负责人，请找总管理设置";
  if (只读角色({ id: userId }, org)) return "管理员只读，不能当负责人";
  if (只看的人(org, userId)) return "设了「只看某人」的成员只能看，不能当负责人";
  return null;
}
/** 没设业务角色的领公海（11-03 用户定：无法领）。账号的 ADMIN / MANAGER 不算；别人分给他不在此列 */
export const 没业务角色不能领话 = "还没设业务角色，不能领公海里的客户和项目，请找总管理设置";
/** 有业务角色、但这个角色不领公海（市管、渠运、项目组员、只看某人的，V3.5.1）时那一句 */
export const 不能领公海话 = "你的角色不能领公海里的客户和项目，请找销售或销售管理";
/** 没设业务角色的新建项目：五种分配方式一样都用不了（assign-use 能用分配方式），向导入口和服务端都说这句（11-03 D3-6） */
export const 没业务角色不能新建话 = "还没设业务角色，不能新建项目，请找总管理设置";

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

/** 只看：实线下属（业务线对得上）+ 虚线下属（虚线只能看，D-39；虚线是专门跨线配的，不按业务线滤） */
function 看得到下属的(org: 组织, 我: string, ownerId: string): boolean {
  if (实线下属(org, 我).has(ownerId) && 业务线放行(org, 我, { ownerId })) return true;
  for (const d of 虚线下属(org, 我)) if (d === ownerId || 实线下属(org, d).has(ownerId)) return true;
  return false;
}

/** 看：项目详情、列表里露不露 */
export function 能看项目(me: 谁, p: 权限项目, org: 组织 | null): boolean {
  if (老()) return 老管(me) || me.id === p.ownerId || !!p.pooledAt;
  // 没设角色：只看公海（V3.5.1）
  if (!org || 没设业务角色(org, me.id)) return !老() && !!org && !!p.pooledAt;
  // 只看某人：那个人（和自己）是负责人或创建人的，加上公海
  const 目标 = 只看的人(org, me.id);
  if (目标) return !!p.pooledAt || [目标, me.id].some((x) => x === p.ownerId || x === p.creatorId);
  if (能看全部(me, org)) return true;
  // 项目公海：谁都看得到才能领（历史负责人不能领、不能看另由公海那条规则管）
  if (p.pooledAt) return true;
  if (p.ownerId === me.id) return true;
  if (p.已加入?.includes(me.id)) return true;
  const 条线 = 条线范围of(org, me.id);
  if (条线 && (条线.人们.includes(p.ownerId) || (!!p.creatorId && 条线.人们.includes(p.creatorId)))) return true;
  const 按线 = 按线范围of(org, me.id);
  if (按线) return 按线.人们.includes(p.ownerId) || (!!p.creatorId && 按线.人们.includes(p.creatorId)) || 项目业务线(p, org.成员) === 按线.线;
  if (p.creatorId === me.id && 有(org, me.id, 市场角色)) return true;
  // 市场管理：直属下级建的项目（线索）不管什么状态都看得到（11-05 客户定；列表同 team-scope 的 市场全看）
  if (p.creatorId && 有(org, me.id, ["marketing_mgr"]) && 实线下属(org, me.id, 1).has(p.creatorId)) return true;
  return 看得到下属的(org, me.id, p.ownerId);
}

/**
 * 编辑项目内容（字段、节点推进、沟通、交付勾选、组员）：系统管理员；或负责人本人，且是销售 / 销管 / 渠运 / 项目组员 / 条线总管理（V3.5.1、X-07）。
 * 别人负责的：条线总管理、上级、市场、管理员只读都只能看。公海里的项目没有负责人：谁都改不了，先领
 */
export function 能编辑项目(me: 谁, p: 权限项目, org: 组织 | null): boolean {
  if (老()) return 老管(me) || (!p.pooledAt && me.id === p.ownerId);
  if (!org || p.pooledAt || 只读角色(me, org) || 只看的人(org, me.id)) return false;
  if (是系统管理员(me, org)) return true;
  return p.ownerId === me.id && 能按负责人编辑(org, me.id);
}

/** 负责人本人能不能改自己名下的：销售、销管、渠运、项目组员、条线总管理（X-07，11-05 用户定「按建议，能改」：
 *  条线总管理本人负责的能编，条线内别人负责的只看——别人的在调用处 ownerId === me.id 就拦了）。多角色取并集（P-判定-01） */
function 能按负责人编辑(org: 组织, id: string): boolean {
  return 有(org, id, 可编辑角色) || !!条线范围of(org, id);
}

/**
 * 转让、重新分配负责人（含公海里的项目指给人）。白名单四选一（V3.5.1）：
 *   负责人本人（销售、销管）、实线直属上级（只一级，业务线对得上）、条线总管理（条线内）、系统管理员。
 * 公海里的项目原负责人已清掉，按「能管公海 + 业务线」放行
 */
export function 能转让项目(me: 谁, p: 权限项目, org: 组织 | null): boolean {
  if (老()) return 老管(me) || (!p.pooledAt && me.id === p.ownerId);
  if (!org || 只读角色(me, org) || 没设业务角色(org, me.id) || 只看的人(org, me.id)) return false;
  if (是系统管理员(me, org)) return true;
  if (p.pooledAt) return 能管公海(me, org) && 业务线放行(org, me.id, p);
  return 能转让名下(me, p.ownerId, org);
}

/** 负责人是 ownerId 的东西（项目、客户）我能不能转给别人：负责人本人、直属一级上级、条线总管理。系统管理员、只读调用前已判 */
function 能转让名下(me: 谁, ownerId: string, org: 组织): boolean {
  if (ownerId === me.id) return 能转出自己的(me, org);
  if (实线下属(org, me.id, 1).has(ownerId) && 业务线放行(org, me.id, { ownerId })) return true;
  return !!条线范围of(org, me.id)?.人们.includes(ownerId);
}

/** 负责人转出自己的（同 能转让项目 的负责人本人）：销售、销管、渠运、市管（11-03 反馈 7；11-05 客户：市场管理可以当负责人）；
 *  项目组员不能转。市管不进 负责人角色：那份名单还管软删，市管不删。转的是不是他自己的、在不在公海，调用处查 */
export function 能转出自己的(me: 谁, org: 组织 | null): boolean {
  if (老()) return true;
  return !!org && !只读角色(me, org) && !只看的人(org, me.id) && 有(org, me.id, [...负责人角色, "marketing_mgr"]);
}

/** 转让客户（客户详情「转给」、批量转让）：同项目的白名单；公海里的客户走公海分配（能管公海） */
export function 能转让客户(me: 谁, c: { salesOwnerId: string | null; 在公海: boolean }, org: 组织 | null): boolean {
  if (老()) return true;
  if (!org || 只读角色(me, org) || 没设业务角色(org, me.id) || 只看的人(org, me.id)) return false;
  if (是系统管理员(me, org)) return true;
  if (c.在公海 || !c.salesOwnerId) return 能管公海(me, org);
  return 能转让名下(me, c.salesOwnerId, org);
}

/**
 * 改客户详情（字段、行内改一格、编辑客户）：同项目——系统管理员；或负责人本人且是销售 / 销管 / 渠运 / 项目组员 / 条线总管理。
 * 公海里的客户谁都改不了，先领；还没负责人的（不在公海）给能管公海的（系统管理员、销管）
 */
export function 能改客户(me: 谁, c: { salesOwnerId: string | null; 在公海: boolean }, org: 组织 | null): boolean {
  if (老()) return true;
  if (!org || c.在公海 || 只读角色(me, org) || 只看的人(org, me.id)) return false;
  if (是系统管理员(me, org)) return true;
  if (!c.salesOwnerId) return 能管公海(me, org);
  return c.salesOwnerId === me.id && 能按负责人编辑(org, me.id);
}

/** 放回公海：能转让的才能放回（负责人本人、直属一级上级、条线总管理、系统管理员） */
export function 能放回公海(me: 谁, p: 权限项目, org: 组织 | null): boolean {
  return !p.pooledAt && 能转让项目(me, p, org);
}

/** 分配线索（A7）：市场管理、销售管理、总管理；设了「只看某人」的不行（11-03） */
export function 能分配线索(me: 谁, org: 组织 | null): boolean {
  if (老()) return 老管(me);
  return !!org && !只读角色(me, org) && !只看的人(org, me.id) && 有(org, me.id, 分线索角色);
}

/**
 * 公海：分给同事、撤销分配、把别人的客户放回公海、标无效客户（原 constants.ts 管全队客户 = 账号 ADMIN / MANAGER）：
 * 总管理（系统管理员、条线总管理）、销售管理。恢复无效客户另走 能恢复
 */
export function 能管公海(me: 谁, org: 组织 | null): boolean {
  if (老()) return 老管(me);
  return !!org && !只读角色(me, org) && 有(org, me.id, ["director", "sales_mgr"]);
}

/**
 * 软删（客户、联系人、项目、线索、沟通记录进回收站）：系统管理员；销售、销管、渠运删自己负责的（V3.5.1）。
 * 条线总管理、市管、项目组员、管理员只读、只看某人的不能删。负责人 = 这一行的负责人（客户 salesOwnerId、项目 ownerId）；
 * 跟进、附件这类挂在项目 / 客户下的，传它所属那一行的负责人
 */
export function 能删除(me: 谁, org: 组织 | null, 负责人: string | null | undefined): boolean {
  if (老()) return 老板(me);
  if (!org || 只读角色(me, org) || 只看的人(org, me.id)) return false;
  if (是系统管理员(me, org)) return true;
  return !!负责人 && 负责人 === me.id && 有(org, me.id, 负责人角色) && !条线范围of(org, me.id);
}

/** 列表上摆不摆删除按钮（批量删）：有可能删得了任何一行的人。每行删不删得了，服务端再按 能删除 逐行判 */
export function 能删一些(me: 谁, org: 组织 | null): boolean {
  if (老()) return 老板(me);
  if (!org || 只读角色(me, org) || 只看的人(org, me.id)) return false;
  return 是系统管理员(me, org) || (有(org, me.id, 负责人角色) && !条线范围of(org, me.id));
}

/** 真删（回收站里彻底删除、清空回收站）：只有系统管理员 */
export function 能真删(me: 谁, org: 组织 | null): boolean {
  return 是系统管理员(me, org);
}

/** 回收站：看、恢复，公海里恢复无效客户：系统管理员 + 回收站副手（V3.5.1） */
export function 能恢复(me: 谁, org: 组织 | null): boolean {
  if (是系统管理员(me, org)) return true;
  return !老() && !!org?.成员.has(me.id) && !!org.回收站副手?.has(me.id);
}

/** 领公海（V3.5.1）：销售、销管、条线总管理、系统管理员；管理员只读、市管、项目组员、没设角色的不能领 */
export function 能领公海(me: 谁, org: 组织 | null): boolean {
  if (老()) return true;
  return !!org && !只读角色(me, org) && !只看的人(org, me.id) && 有(org, me.id, 领公海角色);
}

/** 摆不摆「领取」「新建客户」「新线索」（11-03 D3-7 ④）：没设业务角色、只读管理员看不到；服务端各入口另拦。不是企业版一律摆 */
export function 能新建和领取(me: 谁, org: 组织 | null): boolean {
  if (老()) return true;
  return !!org && !没设业务角色(org, me.id) && !只读角色(me, org);
}

/** 新建项目（建档向导）挡在哪：能 = null；只读管理员说只能看，没设业务角色说去设（11-03 D3-7 ④） */
export function 不能新建项目话(me: 谁, org: 组织 | null): string | null {
  if (能新建和领取(me, org)) return null;
  return org && 只读角色(me, org) ? 只读角色话 : 没业务角色不能新建话;
}

/**
 * 公海「分配给…」能不能分给这个人（11-03 B2-7）：先得能当负责人（在职、有业务角色、不是只读）；
 * 分的人不是系统管理员、自己又有业务线时，只能分给同业务线的（对方没设线也不行）。能分 = null。不是企业版不管线
 */
export function 公海分不给话(me: 谁, org: 组织 | null, 目标: string): string | null {
  const 不行 = 不能当负责人话(org, 目标);
  if (不行) return 不行;
  if (老() || !org || 是系统管理员(me, org)) return null;
  const 我线 = org.成员.get(me.id)?.line ?? null;
  if (!我线) return null;
  return org.成员.get(目标)?.line === 我线 ? null : "只能分给同业务线的同事";
}

/** 进设置页：只有系统管理员（V3.5.1 后台设置只给系统管理员），勾了「不管设置」的不行（C1） */
export function 能进设置(me: 谁, org: 组织 | null): boolean {
  if (老()) return 老板(me);
  return 是系统管理员(me, org) && !org?.成员.get(me.id)?.不管设置;
}

/** 改后台设置（含组织架构、业务角色分配）：同 能进设置 */
export function 能改后台设置(me: 谁, org: 组织 | null): boolean {
  return 能进设置(me, org);
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
 * 「管理层」：总管理、销售管理、市场管理，或手下有人（直属 / 虚线上级）；设了「只看某人」的不算（11-03）。
 * 首页、复盘按人看、给下属推必填这类「管人」的入口用；不等于能编辑别人的项目
 */
export function 是管理层(me: 谁, org: 组织 | null): boolean {
  if (老()) return 老管(me);
  if (!org || 只看的人(org, me.id)) return false;
  return 有(org, me.id, ["director", "admin", "sales_mgr", "marketing_mgr"]) || 实线下属(org, me.id, 1).size > 0 || 虚线下属(org, me.id, 1).size > 0;
}

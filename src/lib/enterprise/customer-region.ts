/**
 * 市场成员自动分配按客户区域定事业部（P-转-26 自动分配这一半，X-141 我方建议；用户 11-17：「无需选择内贸还是外贸……客户中国大陆或非中国大陆识别自动对应到内贸还是外贸」）。
 * 纯函数，界面（建档向导）和服务端（assign-actions 自动分给）共用，别 import prisma。
 *
 * - 区域（X-141 ①）：按客户国家判；国家空但有省 / 市 / 区县的算中国大陆（规整地址 也这么存）；港澳台算非大陆；四格全空 = 未知。
 *   客户地址全空时退到项目所在地（建档向导新建的客户没有地址格，只填了项目所在地）
 * - 去向：大陆 → 内贸；非大陆 → 外贸；未知 → 不限事业部（两条线的销售都进候选），提示「客户没填区域……」
 * - 谁受这条管（X-141 ②④）：按岗位认的市场成员 = 业务角色有市场管理或渠道运营的人；别的角色发起照 P-转-08 不限
 * - 候选（X-141 ③）：内外贸都不含销售管理（兼着销售的销售管理也去掉）
 * - 指定分配的事业部限制（P-转-26 另一半）这次没做，见 X-141
 */
import { 是国内, type 客户地址 } from "./customer-v2";
import type { 组织 } from "./org-core";
import type { 线 } from "./lead-assign";

export type 客户区域 = "大陆" | "非大陆" | "未知";

const 格 = (x: string | null | undefined) => String(x ?? "").trim();
/** 港澳台：国家那格写成「中国香港」「香港」「Hong Kong」「台湾省」……，或国家是中国、省那格是港澳台 */
const 港澳台 = /^(中国|中國)?\s*(香港|澳门|澳門|台湾|臺灣)|^(hong\s*kong|macau|macao|taiwan)\b|^(hk|mo|tw)$/i;

/** 是国内 以外、也当「中国」的写法（繁体、全称、英文全称）；港澳台再看省 / 市那一格 */
const 也算中国 = /^(中國|中國大陸|中华人民共和国|中華人民共和國|大陆|people'?s\s+republic\s+of\s+china|mainland\s+china)$/i;

/** 客户（或项目所在地）的区域：国家 → 省 → 市 → 区县四格 */
export function 客户区域of(a: Partial<客户地址> | null | undefined): 客户区域 {
  const 国 = 格(a?.addrCountry), 省 = 格(a?.addrProvince), 市 = 格(a?.addrCity), 区 = 格(a?.addrDistrict);
  if (!国 && !省 && !市 && !区) return "未知";
  if (!国 || 是国内(国) || 也算中国.test(国)) return 港澳台.test(省) || 港澳台.test(市) ? "非大陆" : "大陆";
  return "非大陆";
}

/** 区域 → 事业部：大陆 内贸，非大陆 外贸，未知 null（不限） */
export const 区域定线 = (r: 客户区域): 线 | null => (r === "大陆" ? "内贸" : r === "非大陆" ? "外贸" : null);

/** 先看客户地址，客户四格全空再看项目所在地；都空 = 未知 */
export function 区域of(客户: Partial<客户地址> | null | undefined, 项目?: Partial<客户地址> | null): 客户区域 {
  const r = 客户区域of(客户);
  return r === "未知" && 项目 ? 客户区域of(项目) : r;
}

/** 客户区域定的线（大陆 内贸 / 非大陆 外贸），未知 = null */
export const 区域线of = (客户: Partial<客户地址> | null | undefined, 项目?: Partial<客户地址> | null): 线 | null => 区域定线(区域of(客户, 项目));

/** 按岗位认的市场成员（X-141 ②）：市场管理、渠道运营。他们发起的自动分配按客户区域定事业部 */
export const 按区域分配的角色们 = ["marketing_mgr", "channel_ops"] as const;
export const 按区域分配 = (角色们: readonly string[]): boolean => 角色们.some((r) => (按区域分配的角色们 as readonly string[]).includes(r));
export const 按区域分配of = (org: Pick<组织, "成员">, userId: string): boolean => 按区域分配(org.成员.get(userId)?.角色们 ?? []);

/** 候选里去掉销售管理（X-141 ③：内外贸自动分配都不给销售管理，兼着销售的也去掉） */
export const 去掉销售管理 = (org: Pick<组织, "成员">, 人们: readonly string[]): string[] =>
  人们.filter((id) => !org.成员.get(id)?.角色们.includes("sales_mgr"));

/** 客户四格全空时结果里带的那句 */
export const 区域未填提示 = "客户没填区域，按全部销售分配，建议补区域";

/** 建档界面上业务线那一格换成的只读说明：认出线 = 「按客户区域自动定：内贸」；没认出 = 未填提示 */
export const 区域定线说明 = (l: 线 | null): string =>
  l ? `按客户区域自动定：${l}（中国大陆 → 内贸，其余含港澳台 → 外贸）` : `按客户区域自动定：${区域未填提示}`;

/** 自动分配成了以后「为什么是他」后面接的那半句 */
export const 区域分配理由 = (l: 线 | null): string => (l ? `按客户区域定${l}` : 区域未填提示);

/** 选了自动分配以后分配方式底下那句（市场成员；别的角色照旧用 assign-line 分配说明[1]） */
export const 区域分配说明 = "建好后按客户区域自动分：中国大陆 → 内贸销售，其余（含港澳台）→ 外贸销售，不分给销售管理；没人可分 = 留在新线索待分配";

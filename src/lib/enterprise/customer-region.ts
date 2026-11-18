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
import { 验客户电话 } from "./contact-format";
import { 线部门们, type 线部门 } from "./assign-line";
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
export const 区域分配说明 = "建好后按下面的分配方向自动分（默认按客户区域：中国大陆 → 内贸销售，其余含港澳台 → 外贸销售），不分给销售管理；没人可分 = 留在新线索待分配";

// —— 分配方向（11-18 用户：「内贸的市场管理及成员的分配方向可以默认为是内贸的，但他可以手动修改为外贸，反之……」）——
/*
  市场成员发起的自动分配，「分配方向：内贸 / 外贸」是一格可改的选择，默认按顺序定：
  ① 客户区域（区域of：客户地址，空了看项目所在地）→ 大陆内贸、非大陆外贸；
  ② 区域未知看电话：大陆手机号（含 +86 / 0086）→ 内贸，带别的国际区号（含港澳台）→ 外贸，座机 / 认不出 → 下一步；
  ③ 还判不出 → 录入人本人的事业部（本人事业部）；本人也没有 = 不限（两条线都算，提示补区域）。
  人手动改了就按手动的；界面只在人改过时交「分配方向」，没交服务端按同一顺序现算（不信界面算的默认）
*/
export type 方向来源 = "区域" | "电话" | "本人" | "手动" | "不限";
export type 分配方向 = { 线: 线 | null; 来源: 方向来源 };

/** 电话定线：按给的顺序，第一个认得出的号说了算（大陆手机 内贸、国外号 外贸）；座机、格式不对、空的跳过 */
export function 电话定线(号们: readonly (string | null | undefined)[]): 线 | null {
  for (const 号 of 号们) {
    if (!号 || !String(号).trim()) continue;
    const r = 验客户电话(String(号), { 放过占位: false });
    if (r.ok && r.值) return r.国外 ? "外贸" : "内贸";
  }
  return null;
}

/** 默认分配方向：区域 → 电话 → 本人事业部 → 不限 */
export function 默认分配方向(x: {
  客户?: Partial<客户地址> | null; 项目?: Partial<客户地址> | null; 号们?: readonly (string | null | undefined)[]; 本人线?: 线 | null;
  /** 界面上老客户只拿得到服务端算好的线（客户区域线 / 客户电话线）：给了非空就先用它 */
  客户线?: 线 | null; 电话线?: 线 | null;
}): 分配方向 {
  const 区 = x.客户线 ?? 区域线of(x.客户, x.项目);
  if (区) return { 线: 区, 来源: "区域" };
  const 电 = x.电话线 ?? 电话定线(x.号们 ?? []);
  if (电) return { 线: 电, 来源: "电话" };
  if (x.本人线) return { 线: x.本人线, 来源: "本人" };
  return { 线: null, 来源: "不限" };
}

/** 交上来的分配方向：内贸 / 外贸 照收；没交（undefined / null / 空串）= undefined，按默认；别的 = error */
export function 认分配方向(x: unknown): { ok: true; 线: 线 | undefined } | { ok: false; error: string } {
  if (x === undefined || x === null || x === "") return { ok: true, 线: undefined };
  if (x === "内贸" || x === "外贸") return { ok: true, 线: x };
  return { ok: false, error: "分配方向只能选内贸或外贸" };
}

/** 界面上分配方向底下那句：默认值从哪来 */
export function 方向来源说明(d: 分配方向): string {
  if (!d.线) return 区域未填提示;
  if (d.来源 === "区域") return `按客户区域：${d.线}`;
  if (d.来源 === "电话") return `按电话（${d.线 === "内贸" ? "大陆手机号" : "国外号码"}）：${d.线}`;
  if (d.来源 === "本人") return `按你所在事业部：${d.线}`;
  return `你选的：${d.线}`;
}

/** 自动分配成了以后「为什么是他」后面接的那半句（按分配方向） */
export const 方向分配理由 = (d: 分配方向): string => (d.线 ? (d.来源 === "手动" ? `按选的分配方向：${d.线}` : 方向来源说明(d)) : 区域未填提示);

/**
 * 录入人本人的事业部：成员业务线（EntMember.line）→ 所在部门落在哪条线勾的参与部门里（只落在一条才算）→
 * 往上找部门名带「内贸」「外贸」的（M-角色-02：市场运营部在两个事业部下面）。都没有 = null
 */
export function 本人事业部(org: Pick<组织, "成员" | "部门">, 设: 线部门 | null, userId: string): 线 | null {
  const m = org.成员.get(userId);
  if (!m) return null;
  if (m.line === "内贸" || m.line === "外贸") return m.line;
  if (!m.deptId) return null;
  if (设) {
    const 在 = (["内贸", "外贸"] as const).filter((l) => 设[l].length && 线部门们(org.部门, 设[l]).has(m.deptId!));
    if (在.length === 1) return 在[0];
  }
  const 走过 = new Set<string>();
  for (let id: string | null = m.deptId; id && !走过.has(id); id = org.部门.get(id)?.parentId ?? null) {
    走过.add(id);
    const 名 = org.部门.get(id)?.name ?? "";
    const 内 = 名.includes("内贸"), 外 = 名.includes("外贸");
    if (内 !== 外) return 内 ? "内贸" : "外贸";
  }
  return null;
}

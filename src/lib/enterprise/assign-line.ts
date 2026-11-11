/**
 * 企业版项目线索的自动分配（2026-11-01 会议 §1 / §3 / §4，清单第一节 A1–A11；11-01 16:05 拍板改）：纯数据和纯函数，设置页客户端也 import，别 import prisma。
 *
 * - 走哪条线（A1–A3）：人手动选「业务线」（内贸 / 外贸 / 暂不分配），记在项目上（Project.bizLine，迁移 106）；新建客户也能选（Customer.bizLine）。
 *   新建项目必填；「暂不分配」不进自动分配。老项目没填按负责人的线、再没有按内贸（项目业务线）。
 *   不按地址自动判（地址只用来给个建议，见 建议业务线；台湾按 台湾算）。
 * - 谁参与（A4 / A5）：后台给每条线勾一组部门（连下级部门）；候选人 = 部门在里面、在职、有销售业务角色的人（自动分配只给「销售」，销售管理只能手动指派，11-02），
 *   个人的「参与状态」（暂停 / 禁止）照旧去掉，两层都满足才挑。某条线一个部门都没勾 = 退回老规矩（按成员的内贸 / 外贸标记）。
 * - 分配方式默认值（A6）：市场 → 自动分配，销售 → 个人自持，其他 → 暂不分配；用户能改。
 */
import { 是国内, type 客户地址 } from "./customer-v2";
import type { 组织 } from "./org-core";
import type { 组织部门 } from "./org-tree";
import type { 线 } from "./lead-assign";

/** 两条业务线（各条线参与的部门、成员的内贸 / 外贸标记只认这两个） */
export const 两条线: readonly 线[] = ["内贸", "外贸"];
export const 是业务线 = (x: unknown): x is 线 => x === "内贸" || x === "外贸";

/**
 * 项目 / 客户上的业务线（11-01 16:1x 拍板）：三选一 内贸 / 外贸 / 暂不分配。
 * 「暂不分配」= 不进自动分配，建好落到新线索等人手动分；超时回收按内贸的时长
 */
export type 项目线 = 线 | "暂不分配";
export const 三种业务线: readonly 项目线[] = ["内贸", "外贸", "暂不分配"];
export const 是项目线 = (x: unknown): x is 项目线 => 是业务线(x) || x === "暂不分配";

/** 交来的业务线：三种之一原样，空 = null，别的 = undefined（调用方报错） */
export function 认业务线(x: unknown): 项目线 | null | undefined {
  if (x === null || x === undefined) return null;
  const v = String(x).trim();
  if (!v) return null;
  return 是项目线(v) ? v : undefined;
}

/** 业务线填了不认得时的话 */
export const 业务线不认得 = "业务线只能选内贸、外贸或暂不分配";
/** 新建项目没选业务线时的话（新建必填） */
export const 业务线必填 = "业务线必填（内贸 / 外贸 / 暂不分配）";
/**
 * 客户业务线没填时的话（M-必填-13，11-11）：新建客户必填；编辑时交了这一格又是空的也拦。「暂不分配」算填了。
 * 存量空着的不补：没交这一格的入口（就地改别的格、列表行里打开的编辑框）照存，不因为它空着被挡
 */
export const 客户业务线必填 = "客户业务线必填（内贸 / 外贸 / 暂不分配）";

/** 按 userId 查成员的业务线：组织的 成员（org.成员）、或自己从 EntMember 读出来的 Map 都行 */
export type 成员线查 = { get(userId: string): { line?: string | null } | undefined };

/**
 * 项目走哪条业务线（A1 / C7）：总返回三种之一。
 * 项目上填了 → 用填的；老项目没填（或存坏了）→ 负责人的业务线（成员的内贸 / 外贸标记）；负责人也没设 → 内贸。
 * 自动分配、手动指派过滤候选、超时回收按内外贸分开时长都从这里读。不传 成员 = 不看负责人，没填直接按内贸
 */
export function 项目业务线(p: { bizLine?: string | null; ownerId?: string | null } | null | undefined, 成员?: 成员线查 | null): 项目线 {
  if (是项目线(p?.bizLine)) return p!.bizLine as 项目线;
  const 负责人线 = p?.ownerId ? 成员?.get(p.ownerId)?.line : null;
  return 是业务线(负责人线) ? 负责人线 : "内贸";
}

/** 台湾算哪条线（A2：外贸）。只在按地址给建议时用，要改只改这里 */
export const 台湾算: 线 = "外贸";

const 台湾 = /^(中国)?(台湾|臺灣)/;
const 港澳 = /^(中国)?(香港|澳门|澳門)/;
const 格 = (x: string | null | undefined) => String(x ?? "").trim();

/**
 * 按地址给业务线的建议（只在界面上用：新建项目没手动选过时预填、旁边提示请确认，见 所在地预填 / 所在地提示；不参与自动分配）：
 * - 国家是中国（或没填国家、只填了省市区县）：省这一格是香港 / 澳门 → 外贸，台湾 → 台湾算，其余 → 内贸
 * - 国家填的是别的：「中国台湾」「台湾」→ 台湾算；其余（含「中国香港」「中国澳门」、任何外国）→ 外贸
 * - 四格全空 → null（没建议）
 */
export function 建议业务线(a: Partial<客户地址> | null | undefined): 线 | null {
  const 国 = 格(a?.addrCountry), 省 = 格(a?.addrProvince), 市 = 格(a?.addrCity), 区 = 格(a?.addrDistrict);
  if (!国 && !省 && !市 && !区) return null;
  if (!国 || 是国内(国)) {
    if (台湾.test(省)) return 台湾算;
    if (港澳.test(省)) return "外贸";
    return "内贸";
  }
  if (台湾.test(国)) return 台湾算;
  return "外贸";
}

/**
 * 按项目所在地识别业务线（11-02：「项目所在地就是项目内的区域和地址，可以自动识别，但需要确认」）：
 * 新建项目两个入口用这个决定要不要预填。没识别出线 / 人手动选过业务线 / 已经是这条线 = null（不动）；
 * 否则返回要预填的线。只给建议，提交时业务线照旧必填，交上去才算人确认了
 */
export function 所在地预填(建议: 线 | null, 当前: string | null | undefined, 手动选过: boolean): 线 | null {
  if (!建议 || 手动选过 || 当前 === 建议) return null;
  return 建议;
}

/**
 * 业务线下拉旁边那句（新建、编辑共用）：没识别出线 = null。
 * 同 = 所选就是识别出的线（或还没选）——「按项目所在地识别为「外贸」，请确认」；
 * 不同 = 「所在地看像外贸，当前选的是内贸」（编辑里再给一个「改成 外贸」，点了才改）
 */
export function 所在地提示(建议: 线 | null, 当前: string | null | undefined): { 同: boolean; 话: string } | null {
  if (!建议) return null;
  if (!当前 || 当前 === 建议) return { 同: 当前 === 建议, 话: `按项目所在地识别为「${建议}」，请确认` };
  return { 同: false, 话: `所在地看像${建议}，当前选的是${当前}` };
}

// —— 各条线参与自动分配的部门（A4 / A5）——

/** Setting：{ 内贸: 部门编号[], 外贸: 部门编号[] }；没存 / 存坏了 = 两条线都没勾 */
export const 线部门key = "enterprise.lead_assign.line_depts";
export type 线部门 = Record<线, string[]>;

const 规整一组 = (x: unknown): string[] =>
  Array.isArray(x) ? [...new Set(x.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim()))] : [];

/** 存的、交来的都过一遍：每条线去重、去空；不是对象 = 两条都空 */
export function 规整线部门(x: unknown): 线部门 {
  const o = x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
  return { 内贸: 规整一组(o["内贸"]), 外贸: 规整一组(o["外贸"]) };
}

/** 勾的部门（还在的）连下级部门；成环的部门也只走一遍 */
export function 线部门们(部门: ReadonlyMap<string, Pick<组织部门, "id" | "parentId">>, 设的: readonly string[]): Set<string> {
  const 子 = new Map<string, string[]>();
  for (const d of 部门.values()) if (d.parentId) 子.set(d.parentId, [...(子.get(d.parentId) ?? []), d.id]);
  const 出 = new Set<string>();
  const 走 = 设的.filter((id) => 部门.has(id));
  while (走.length) {
    const id = 走.pop()!;
    if (出.has(id)) continue;
    出.add(id);
    走.push(...(子.get(id) ?? []));
  }
  return 出;
}

/** 这条线勾了还在的部门没有：没有 = 退回按成员内贸 / 外贸标记（界面上提示「还没勾部门」） */
export const 线勾了部门 = (org: Pick<组织, "部门">, 设: 线部门, line: 线): boolean => 设[line].some((id) => org.部门.has(id));

const 销售角色 = new Set(["sales", "sales_mgr"]);

/**
 * 自动分配只分给有「销售」业务角色的人（11-02 用户：销售管理参不参与 →「只给销售」）；兼着销售的销售管理照样参与。
 * 候选（按部门候选 / 自动候选人们）照旧含销售管理，手动指派还能挑；只有自动分配那一步再过这一道
 */
export const 只留销售 = (org: Pick<组织, "成员">, 人们: readonly string[]): string[] =>
  人们.filter((id) => !!org.成员.get(id)?.角色们.includes("sales"));

/**
 * 按部门挑自动分配的候选人（参与状态、配额由 挑接手人 再筛）：
 * 这条线勾了部门 → 部门（连下级）在里面、有销售业务角色的在职成员（组织里只有在职的人），去掉现负责人；
 * 没勾 → 退回 按成员标记(org, 现负责人, line)（就是 lead-assign 的 自动候选人们）
 */
export function 按部门候选(
  org: 组织,
  现负责人: string | null,
  line: 线,
  设: 线部门,
  按成员标记: (org: 组织, 现负责人: string | null, line: 线) => string[],
): string[] {
  if (!线勾了部门(org, 设, line)) return 按成员标记(org, 现负责人, line);
  const 部门 = 线部门们(org.部门, 设[line]);
  return [...org.成员.values()]
    .filter((m) => m.userId !== 现负责人 && !!m.deptId && 部门.has(m.deptId) && m.角色们.some((r) => 销售角色.has(r)))
    .map((m) => m.userId);
}

// —— 分配方式默认值（A6）——

/** 分配方式的序号（dict.ts 分配方式 那一组的位置，固定不动） */
export const 分配方式序号 = { 指定分配: 0, 自动分配: 1, 公海捞取: 2, 暂不分配: 3, 个人自持: 4 } as const;

/**
 * 新建线索 / 项目时「分配方式」的默认值（会议 §1 / §3）：市场 → 自动分配；销售 → 个人自持；其他 → 暂不分配。
 * 这里的「市场」（X-93、M-角色-02）= 市场管理 + 渠运 + 按部门认的市场成员（部门名带「市场」及其下级；营销企划部不算），
 * 按部门认的由调用方读库算好传 部门市场成员。兼着市场和销售的按市场算。
 * 默认的那个这人用不了（后台按角色关掉了）时退到他能用的第一个；都用不了 = undefined
 */
const 算市场 = (角色们: readonly string[], 部门市场成员: boolean) => 部门市场成员 || 角色们.includes("marketing_mgr") || 角色们.includes("channel_ops");

export function 默认分配方式(角色们: readonly string[], 能用: readonly number[], 部门市场成员 = false): number | undefined {
  const 想 = 算市场(角色们, 部门市场成员)
    ? 分配方式序号.自动分配
    : 角色们.some((r) => 销售角色.has(r))
      ? 分配方式序号.个人自持
      : 分配方式序号.暂不分配;
  return 能用.includes(想) ? 想 : 能用[0];
}

/** 选自动分配要不要再确认（A9）：有销售业务角色、又不算市场的（市场建的分出去后还能看，销售分出去就看不到了；市场口径同上，X-93） */
export const 是销售角色 = (角色们: readonly string[], 部门市场成员 = false): boolean => !算市场(角色们, 部门市场成员) && 角色们.some((r) => 销售角色.has(r));

/** 销售选「自动分配」时的确认话（A9）：分出去以后这个项目就不在他名下了 */
export const 销售自动分确认 = "分出去后你将看不到这个项目，确定按自动分配建吗？";

/** 选了分配方式之后底下那句说明（新建项目向导、客户页新建项目、首页新线索卡共用一份；0 = 指定分配不用说明） */
export const 分配说明: Readonly<Record<number, string>> = {
  1: "建好后按业务线自动分给那条线正常参与的销售；业务线选了暂不分配或没人可分 = 留在新线索待分配",
  2: "建好后放进线索公海，等人捞取",
  3: "建好后记在你名下，在潜客培育自己跟进，之后可以再分配",
  4: "记在你名下，自己跟进",
};

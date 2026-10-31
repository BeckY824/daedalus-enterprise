/**
 * 项目画像和项目所在地（企业版 P11，迁移 087 / 093）的纯规矩：产品需求多选怎么存、详细地址怎么规整、项目区域怎么算。
 * 不碰库，界面、profile.ts、db.ts 改项目 共用。
 * 五项选项见 enterprise/dict-kinds.ts 项目画像项（设置 → 项目模式 里改字典）。
 * 所在地（定稿 -2 版）和客户地址同一套：国家/地区 → 省 → 市 → 区县级市（规整用 customer-v2.ts 规整地址），
 * 外加一格详细地址（定位），存 087 加的 location 列；都不必填
 */
import { 是国内, 联系人地址上限, 规整地址, 认企业级别, type 客户地址 } from "@/lib/enterprise/customer-v2";
import { 默认币种, 是币种 } from "@/lib/currency";

/** 详细地址（定位）最多几个字：和联系人地址一个上限 */
export const 详细地址上限 = 联系人地址上限;
export const 详细地址提示 = "街道、门牌、园区等";

/** 库里 productNeeds 存 JSON 数组字符串；读出来认不出（手改坏了、旧数据）就当没选，不报错 */
export function 读产品需求(存的: string | null | undefined): string[] {
  if (!存的) return [];
  try {
    const v: unknown = JSON.parse(存的);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];
  } catch {
    return [];
  }
}

/** 存之前：去空白、去重、保留勾选顺序；一项都没有存 null（和没填一样） */
export function 存产品需求(选的: readonly string[]): string | null {
  const 留 = [...new Set(选的.map((x) => x.trim()).filter(Boolean))];
  return 留.length ? JSON.stringify(留) : null;
}

/** 详细地址：去首尾空白、中间连着的空白并成一个；空 = null；超长报错（不悄悄截断） */
export function 规整详细地址(v: unknown): { ok: true; 值: string | null } | { ok: false; error: string } {
  if (v === null || v === undefined) return { ok: true, 值: null };
  if (typeof v !== "string") return { ok: false, error: "详细地址要写文字" };
  const t = v.trim().replace(/\s+/g, " ");
  if (!t) return { ok: true, 值: null };
  if ([...t].length > 详细地址上限) return { ok: false, error: `详细地址最多 ${详细地址上限} 个字` };
  return { ok: true, 值: t };
}

/** 省这一格写的是港澳台（「香港」「香港特别行政区」「中国台湾」「台湾省」都算） */
const 港澳台 = /^(中国)?(香港|澳门|澳門|台湾|臺灣)/;

/**
 * 项目区域（列表、详情上显示用，定稿 -2 版）：
 *   国家为空 → 空串；国内 → 取市，省是香港 / 澳门 / 台湾时取省；国外 → 取国家。
 * 国家用 customer-v2.ts 是国内 认（中国 / 中国大陆 / China 都算国内）；国家候选里的「中国香港」之类是当国外存的，取国家
 */
export function 项目区域(a: Partial<客户地址> | null | undefined): string {
  const 格 = (x: string | null | undefined) => (x ?? "").trim();
  const 国家 = 格(a?.addrCountry);
  if (!国家) return "";
  if (!是国内(国家)) return 国家;
  const 省 = 格(a?.addrProvince);
  return 港澳台.test(省) ? 省 : 格(a?.addrCity);
}

/** 编辑项目里的级别和所在地（企业版，迁移 093 + 087 的 location）：没传的格 = 不动 */
export type 项目级别和地址 = { level: string | null } & 客户地址 & { location: string | null };
export const 地址键 = ["addrCountry", "addrProvince", "addrCity", "addrDistrict"] as const;

/**
 * 编辑项目交上来的级别、地址四格、详细地址 → 要存的值（改项目 合进 新 里比变没变）。
 *   级别：没传 = 原样；空 = 清掉；S / A / B / C 以外的拦下（老的 D 也不收）
 *   地址：四格一格都没传 = 原样；传了哪几格就和原来的拼起来整套过 规整地址（客户地址同一套校验：国外只留国家 + 城市）
 *   详细地址：没传 = 原样；规整详细地址
 */
export function 项目级别和地址改成(
  patch: Partial<Record<keyof 项目级别和地址, unknown>>,
  原: 项目级别和地址,
): { ok: true; 值: 项目级别和地址 } | { ok: false; error: string } {
  const level = patch.level === undefined ? 原.level : 认企业级别(patch.level);
  if (level === undefined) return { ok: false, error: "项目级别只能选 S / A / B / C" };
  let 地址: 客户地址 = { addrCountry: 原.addrCountry, addrProvince: 原.addrProvince, addrCity: 原.addrCity, addrDistrict: 原.addrDistrict };
  if (地址键.some((k) => patch[k] !== undefined)) {
    const 拼 = { ...地址 } as Record<keyof 客户地址, unknown>;
    for (const k of 地址键) if (patch[k] !== undefined) 拼[k] = patch[k];
    const r = 规整地址(拼);
    if (!r.ok) return r;
    地址 = r.值;
  }
  let location = 原.location;
  if (patch.location !== undefined) {
    const r = 规整详细地址(patch.location);
    if (!r.ok) return r;
    location = r.值;
  }
  return { ok: true, 值: { level, ...地址, location } };
}

/**
 * 成交需求、合同金额、定金金额（企业版，迁移 097）：客户原表三列照原样进来，编辑项目里可改。
 * 和 amount（「金额」：看板合计、提成的成交金额）各是各的，不互相抄
 */
export type 项目成交钱 = {
  dealDemand: string | null;
  contractAmount: number | null;
  contractCurrency: string | null;
  depositAmount: number | null;
  depositCurrency: string | null;
};
export const 成交钱键 = ["dealDemand", "contractAmount", "contractCurrency", "depositAmount", "depositCurrency"] as const;
/** 需求描述（原成交需求，列 dealDemand）最多几个字：和项目备注一个上限 */
export const 成交需求上限 = 500;

/** 金额一格：空 = null；要是不小于 0 的数（界面交的是数字；导入那边先用 认金额 认好再来） */
function 认这格金额(v: unknown, 名: string): { ok: true; 值: number | null } | { ok: false; error: string } {
  if (v === null || v === undefined || v === "") return { ok: true, 值: null };
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "").trim()) : NaN;
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: `${名}要填不小于 0 的数字` };
  return { ok: true, 值: n };
}

/**
 * 编辑项目交上来的成交需求和两个金额 → 要存的值（改项目 合进 新 里比变没变）。
 *   成交需求：没传 = 原样；去首尾空白，空 = 清掉；超长报错（不悄悄截断）
 *   金额：没传 = 原样；空 = 清掉（币种跟着清）；负数、认不出的数报错
 *   币种：没传 = 原样，原来也没有就落人民币；认不出报错；金额是空的币种一律存空（只有币种没有数没意义）
 */
export function 项目成交钱改成(
  patch: Partial<Record<keyof 项目成交钱, unknown>>,
  原: 项目成交钱,
): { ok: true; 值: 项目成交钱 } | { ok: false; error: string } {
  let dealDemand = 原.dealDemand;
  if (patch.dealDemand !== undefined) {
    if (patch.dealDemand !== null && typeof patch.dealDemand !== "string") return { ok: false, error: "需求描述要写文字" };
    const t = (patch.dealDemand ?? "").trim();
    if ([...t].length > 成交需求上限) return { ok: false, error: `需求描述最多 ${成交需求上限} 个字` };
    dealDemand = t || null;
  }
  const 一项 = (金额键: "contractAmount" | "depositAmount", 币种键: "contractCurrency" | "depositCurrency", 名: string) => {
    let 数 = 原[金额键];
    if (patch[金额键] !== undefined) {
      const r = 认这格金额(patch[金额键], 名);
      if (!r.ok) return r;
      数 = r.值;
    }
    let 币 = 原[币种键];
    if (patch[币种键] !== undefined && patch[币种键] !== null && patch[币种键] !== "") {
      if (!是币种(patch[币种键])) return { ok: false as const, error: `${名}的币种「${String(patch[币种键])}」认不出来` };
      币 = patch[币种键] as string;
    }
    return { ok: true as const, 数, 币: 数 === null ? null : (币 ?? 默认币种) };
  };
  const 合同 = 一项("contractAmount", "contractCurrency", "合同金额");
  if (!合同.ok) return 合同;
  const 定金 = 一项("depositAmount", "depositCurrency", "定金金额");
  if (!定金.ok) return 定金;
  return { ok: true, 值: { dealDemand, contractAmount: 合同.数, contractCurrency: 合同.币, depositAmount: 定金.数, depositCurrency: 定金.币 } };
}

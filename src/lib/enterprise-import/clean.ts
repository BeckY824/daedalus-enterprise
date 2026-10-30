/**
 * 清洗：原始记录 + 映射 → 待写的记录 + 问题清单。试跑和正式导入、之后的同步都走这一个函数，结果一模一样。
 *
 * 这里不碰库：我们这边已有的东西（对照表、客户名、电话、商机名）由调用方查好装进 本地索引 传进来。
 *
 * 清洗做的事：
 *   - 按列映射把原列落到标准字段；映射成「进备注」的列拼成「表头：值」进备注（跟进进内容），一格不丢
 *   - 负责人、阶段、线索状态、跟进方式、跟进状态按映射换成我们的值；对不上的用默认值 + 记一笔「提醒」
 *   - 客户状态、客户类型（企业版字典）和启用的选项一字不差才落，对不上原样进备注；客户类型先过 客户类型对照（mapping.ts），
 *     原表空着、写的是意向客户这类阶段的都落「暂不确认」（字典里没启用这项就不落）；意向客户顺带补 B 级（级别那格空着才补）
 *   - 电话、日期、金额、赢率按我们的格式认；认不出的原样进备注 + 提醒，不硬塞
 *   - 同一批里同号、外部 ID 不同 → 认作同一家，后一条并进前一条（名字不同另提醒）；名字很像但号不同 → 疑似重名，照写、提醒
 *   - 联系人 / 商机 / 跟进挂客户：先认所属客户 ID，再认客户名（本批里唯一、或我们这边唯一）；认不出整条跳过
 *   - 客户：对照表里有 → 落到那条；没导过但我们这边有同号客户 → 连上它（只补空格子）；否则新建
 *   - 规则认不出的格子先查 m.格式（AI 清洗补认的 / 人在报告里改的，见 ai-clean.ts），查到的照规则再认一遍才用；
 *     m.同一家 认作同一家的两家客户，后一家并进前一家。并进去的那条空着的格子、别名、另一个号带到前一条上
 *   - 电话格里写的是邮箱 / 微信 / WhatsApp 的放进对应的格子；一格几个号的第一个当电话，其余进备注
 *   - 联系人的手机 / 邮箱 / 微信和我们这边已有的联系人、或本批前面一条撞了（同类型同查重键，P13 第 2 条）：照写，
 *     提醒「号码重复」并带上撞到的那位（报告里能点进去），不并、不跳过——是不是同一个人、要不要挂过去由人定
 */
import { createHash } from "node:crypto";
import { CUSTOMER_SOURCES, FOLLOW_TYPES, OPP_STAGES, STAGE_PROBABILITY, TRADE_SOURCES } from "../constants";
import { 国家候选 } from "../customer-extra";
import { 联系人号查重键 } from "../enterprise/customer-v2";
import { 认日期 } from "../import/plan";
import { 查电话, 号键 } from "../phone";
import { 拆多人, 进备注, 输单, 对客户类型, 客户类型空着, 客户类型等级 } from "./mapping";
import { 第一个节点, 是结局 } from "../project/nodes";
import { 结局默认节点, 节点所在阶段 } from "./project-values";
import { 企业级别, 规整地址, 简称上限, 性别们, 爱好上限, 联系人地址上限, 认生日 } from "../enterprise/customer-v2";
import { 默认币种, 认币种 } from "../currency";
import { 成交需求上限 } from "../project/profile-rules";
import { 实体顺序, 必填, 实体名, 字段中文, type 原始记录, type 实体, type 映射, type 问题, type 待写, type 格式类 } from "./types";

/** 我们这边已有的东西，调用方从库里查好传进来。键都已规整过（见下面的 名键 / 号键） */
export type 本地索引 = {
  /** `${实体}|${外部ID}` → 我们这边的 id（以前导过的） */
  引用: Map<string, string>;
  /** `${实体}|${外部ID}` → 上次导入时的指纹（没给就都当有变化） */
  指纹?: Map<string, string>;
  /** 客户名键 → 客户 id（可能多个） */
  客户名: Map<string, string[]>;
  /** 号键 → 客户 id（可能多个） */
  客户号: Map<string, string[]>;
  /** `${客户id}|${商机名键}` → 商机 id（可能多个） */
  商机名: Map<string, string[]>;
  /** 企业版字典里启用着的客户状态（custStatus）。没给 = 不认，原系统的客户状态一律进备注 */
  客户状态?: readonly string[];
  /** 渠道名键 → 渠道 id（启用中的；渠道全称和「渠道名称」那一段都认，一段对上几家的不认）。没给 = 来源只存文字，不挂渠道 */
  渠道?: Map<string, string>;
  /** 企业版字典里启用着的客户分配方式（custAssign）。没给 = 不认，原系统的分配方式一律进备注 */
  分配方式?: readonly string[];
  /** 企业版字典里启用着的客户类型（custType）。没给 = 不认，一律进备注 */
  客户类型?: readonly string[];
  /** `${kind}|${查重键}` → 我们这边有这个号的联系人（kind = phone / email / wechat，键见 联系人号查重键）。没给 = 不查 */
  联系人号?: Map<string, 已有联系人[]>;
};

/** 号码撞到的我们这边那位联系人：名字 + 主客户（报告里点进主客户页） */
export type 已有联系人 = { id: string; name: string; customerId: string; customerName: string };

/** 导入的联系人要查重的几格：标准字段 → ContactMethod.kind 和报告里的叫法 */
export const 联系人查重格 = [["phone", "phone", "手机"], ["email", "email", "邮箱"], ["wechat", "wechat", "微信"]] as const;

export const 空索引 = (): 本地索引 => ({ 引用: new Map(), 客户名: new Map(), 客户号: new Map(), 商机名: new Map() });

/** 名字比较用的键：去空白、全角转半角、小写 */
export function 名键(s: string): string {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s　]/g, "")
    .toLowerCase();
}

/** 疑似重名用的公司名键：再去掉括号、标点和「有限公司」这类尾巴。只用来提醒，不拿来合并 */
export function 公司名键(s: string): string {
  return 名键(s)
    .replace(/[(\[【][^)\]】]*[)\]】]/g, "")
    .replace(/[.,·、，。\-_'"“”‘’]/g, "")
    .replace(/(股份有限公司|有限责任公司|有限公司|集团公司|集团|公司|co\.?ltd|ltd|inc|llc|corp)$/i, "");
}

export type 清洗结果 = { 待写: 待写[]; 问题: 问题[] };

export type 标准 = { 值: Record<string, string>; 附加: string[] };

/** 一条原始记录按列映射拆成：标准字段的值（同一字段多列时取第一格有值的）+ 要拼进备注的「表头：值」 */
export function 拆(r: 原始记录, 列: Record<string, string>): 标准 {
  const 值: Record<string, string> = {};
  const 附加: string[] = [];
  for (const [h, raw] of Object.entries(r.字段)) {
    const v = (raw ?? "").trim();
    const std = 列[h];
    if (!v || !std) continue;
    if (std === 进备注) 附加.push(`${h}：${v}`);
    else if (!值[std]) 值[std] = v;
  }
  return { 值, 附加 };
}

function 指纹(x: unknown): string {
  return createHash("sha1").update(JSON.stringify(x)).digest("hex").slice(0, 20);
}

function 拼备注(...段: (string | undefined | null)[]): string | null {
  const s = 段.filter((x) => x && x.trim()).join("\n");
  return s || null;
}

/** 项目成交钱那五格（迁移 097），非项目模式进备注的顺序 */
const 成交钱列 = ["dealDemand", "contractAmount", "contractCurrency", "depositAmount", "depositCurrency"] as const;

/** 金额前面带的货币符号认得出就用它（认金额会把符号去掉）；没有 = null */
function 符号币种(v: string): string | null {
  const s = v.trim();
  if (/^(US\$|USD|\$)/i.test(s) || /usd$/i.test(s)) return "USD";
  if (/^(¥|￥|RMB|CNY)/i.test(s) || /(元|人民币|rmb|cny)$/i.test(s)) return "CNY";
  return null;
}

/** 是 / 否：关键联系人这种格子 */
function 认是否(v: string): boolean {
  return /^(是|y|yes|true|1|√|✓|主|主要|关键)$/i.test(v.trim());
}

const 全角数字 = (s: string) => s.replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/** 金额：去掉货币符号、千分位、「元 / 元整 / 整」，「k / 千 / 万 / 亿」乘上去，全角数字也认。认不出返回 null */
export function 认金额(v: string): number | null {
  let s = 全角数字(v.trim())
    .replace(/[,，\s]/g, "")
    .replace(/^(¥|￥|\$|US\$|RMB|CNY|USD)/i, "")
    .replace(/(元整|整|元|人民币|rmb|cny|usd)$/i, "");
  let 倍 = 1;
  const 单位 = /(k|千|万|亿)$/i.exec(s);
  if (单位) {
    倍 = { k: 1000, 千: 1000, 万: 10000, 亿: 100000000 }[单位[1].toLowerCase() as "k"] ?? 1;
    s = s.slice(0, -1);
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s) * 倍;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** 赢率：「60%」「60」「0.6」都认成 60。认不出返回 null */
export function 认赢率(v: string): number | null {
  const s = v.trim().replace(/[%％]$/, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  let n = Number(s);
  if (n > 0 && n < 1 && s.includes(".")) n *= 100;
  return n >= 0 && n <= 100 ? Math.round(n) : null;
}

/**
 * 跟进时间要带时分（同一天几次跟进得排得出先后）。日期部分走大批导入的 认日期（同一套写法），
 * 再认后面的「14:30」「14:30:05」或 Excel 序列号的小数部分。认不出返回 null
 */
export function 认时间(v: string): Date | null {
  const d = 认日期(v);
  if (!d) return null;
  const s = v.trim();
  if (/^\d{4,6}\.\d+$/.test(s)) {
    const 秒 = Math.round((Number(s) % 1) * 86400);
    d.setHours(Math.floor(秒 / 3600), Math.floor((秒 % 3600) / 60), 秒 % 60, 0);
    return d;
  }
  const t = /[\sT日](\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?/.exec(s);
  if (t) {
    const [h, m, sec] = [Number(t[1]), Number(t[2]), Number(t[3] ?? 0)];
    if (h < 24 && m < 60 && sec < 60) d.setHours(h, m, sec, 0);
  }
  return d;
}

export const 国家们: string[] = 国家候选.flatMap((g) => g.国家);
export const 来源们: string[] = [...new Set<string>([...CUSTOMER_SOURCES, ...TRADE_SOURCES])];

/** 一格按类再认一遍：AI 回的、人改的都要过这一关，认不出返回 null（不用） */
export function 校验格式(类: 格式类, v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  if (类 === "金额") {
    const n = 认金额(s);
    return n === null ? null : String(n);
  }
  if (类 === "日期" || 类 === "时间") {
    const d = 类 === "日期" ? 认日期(s) : 认时间(s);
    return d && d.getFullYear() >= 1990 && d.getFullYear() <= 2100 ? s : null;
  }
  return (类 === "国家" ? 国家们 : 来源们).includes(s) ? s : null;
}

/** 商机状态列：赢 / 输 / 进行中 */
function 认商机状态(v: string): "WON" | "LOST" | "OPEN" {
  if (/赢|成交|签约|won/i.test(v) && !/未成交/.test(v)) return "WON";
  if (/输|丢|失败|未成交|lost|关闭|closed/i.test(v)) return "LOST";
  return "OPEN";
}

/** 跟进记录的状态：大多是已完成；「待办 / 未完成」算待处理 */
function 认跟进记录状态(v: string): string {
  if (/待|未完成|计划|todo|pending/i.test(v)) return "待处理";
  if (/已发送|sent/i.test(v)) return "已发送";
  return "已完成";
}

/** 客户级别只认企业版的 S / A / B / C（定稿 P5 第 23 条）：「S级」「a类」认成大写一个字母，老的 D 并进 C，别的认不出 */
function 认等级(v: string): string | null {
  const m = /^([a-dsA-DS])(类|級|级|档|$)/.exec(v.trim());
  return m ? 企业级别(m[1]) : null;
}

/** 企业版客户 / 联系人的新几格（迁移 072）：只有认出来的才放进 值（逐格留空：空的不带这一格，不会清掉我们这边的） */
type 新格 = Record<string, string>;

/** 客户的外贸几格：落 CustomerExtra，写的时候从 值 里分出来 */
export const 客户附加列 = ["email", "wechat", "whatsapp", "country", "source", "level", "website"] as const;
/** 客户主表上企业版的新几格（迁移 072）：简称、地址四格、分配方式 */
export const 客户新列 = ["shortName", "addrCountry", "addrProvince", "addrCity", "addrDistrict", "assignWay"] as const;
/** 联系人主表上企业版的新几格（迁移 072）：性别、生日、爱好、地址 */
export const 联系人新列 = ["gender", "birthday", "hobby", "address"] as const;

type 号 = { phone: string; email?: string; wechat?: string; whatsapp?: string; 另: string[] };

export function 清洗(记录: readonly 原始记录[], m: 映射, 本地: 本地索引 = 空索引()): 清洗结果 {
  const 问题们: 问题[] = [];
  const 出问题 = (r: 原始记录, 级别: 问题["级别"], 类别: 问题["类别"], 说明: string) =>
    问题们.push({ 级别, 类别, 实体: r.实体, 外部ID: r.外部ID, 行号: r.行号, 出处: r.出处, 说明 });

  const 按类: Record<实体, 原始记录[]> = { customer: [], contact: [], lead: [], opportunity: [], followup: [] };
  for (const r of 记录) 按类[r.实体]?.push(r);

  const 待写们: 待写[] = [];
  /** 本批里写下来的客户 / 商机：外部 ID → 待写；客户名键 → 外部 ID 们 */
  const 批客户 = new Map<string, 待写>();
  const 批客户名 = new Map<string, string[]>();
  const 批商机 = new Map<string, 待写>();
  /** 本批联系人的号：`${kind}|${查重键}` → 先出现的那条 */
  const 批联系人号 = new Map<string, 原始记录>();

  const 负责人 = (r: 原始记录, 写法: string | undefined): string => {
    if (!写法) {
      出问题(r, "提醒", "负责人空着", "原系统没写负责人，先落到默认负责人名下");
      return m.默认负责人Id;
    }
    const id = m.负责人[写法];
    const 几个 = 拆多人(写法);
    if (id && 几个.length) 出问题(r, "提醒", "负责人有几个", `负责人写了 ${几个.length} 个人（${写法}），我们一条只有一个负责人，按映射落到其中一个名下，其余的人请导完再看要不要协作`);
    if (id) return id;
    出问题(r, "提醒", "负责人对不上", `负责人「${写法}」对不上我们这边的成员，先落到默认负责人名下`);
    return m.默认负责人Id;
  };

  /**
   * 电话格：是号码就规整；写的是邮箱 / 「微信：xx」/「WhatsApp：xx」的放进对应的格子；
   * 一格几个号（逗号、斜杠、顿号隔开）第一个当电话，其余的放进「另」；都不是就原样进备注
   */
  const 认电话 = (r: 原始记录, v: string | undefined, 附加: string[]): 号 => {
    if (!v) return { phone: "", 另: [] };
    // 前缀和分隔符先看：「WhatsApp: +1 415…」「138…/139…」整格丢给 查电话 也能认出一个号，会把其余的吞掉
    const t = v.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) {
      出问题(r, "提醒", "格式不对", `电话格里写的是邮箱「${t}」，放进了邮箱`);
      return { phone: "", email: t, 另: [] };
    }
    const 前缀 = /^(微信|weixin|wechat|wx|vx|whatsapp|wa)号?\s*[:：\s]\s*(\S.*)$/i.exec(t);
    if (前缀) {
      const 微信 = /^(微信|weixin|wechat|wx|vx)$/i.test(前缀[1]);
      出问题(r, "提醒", "格式不对", `电话格里写的是${微信 ? "微信" : " WhatsApp "}「${t}」，放进了${微信 ? "微信" : " WhatsApp "}`);
      return 微信 ? { phone: "", wechat: 前缀[2].trim(), 另: [] } : { phone: "", whatsapp: 前缀[2].trim(), 另: [] };
    }
    const 段 = t.split(/[,，;；/、\n]+/).map((x) => x.trim()).filter(Boolean);
    if (段.length > 1) {
      const 号们 = 段.map((x) => 查电话(x, { 必填: false }));
      if (号们.every((x) => x.ok)) {
        const [首, ...余] = 号们.map((x) => (x.ok ? x.phone : ""));
        出问题(r, "提醒", "格式不对", `电话格里有 ${段.length} 个号，第一个当电话，其余放进了备注`);
        return { phone: 首, 另: 余 };
      }
    }
    const p = 查电话(v, { 必填: false });
    if (p.ok) return { phone: p.phone, 另: [] };
    附加.unshift(`电话：${v}`);
    出问题(r, "提醒", "格式不对", `电话「${v}」看不出是个号码，原样放进了备注`);
    return { phone: "", 另: [] };
  };

  /** 字段本来有值就留着，电话格里认出的同类值放进备注；本来空着就用认出的 */
  const 补格 = (已有: string | undefined, 认出: string | undefined, 标签: string, 附加: string[]): string | null => {
    if (!认出) return 已有 ?? null;
    if (!已有) return 认出;
    if (已有 !== 认出) 附加.push(`${标签}：${认出}`);
    return 已有;
  };

  /** 规则认不出的格子：查 m.格式（AI 清洗补认的 / 人在报告里改的），照规则再认一遍才用 */
  const 查格式 = (类: 格式类, v: string): string | null => {
    const t = m.格式?.[类]?.[v];
    return typeof t === "string" ? 校验格式(类, t) : null;
  };
  const 补日期 = (类: "日期" | "时间", v: string): Date | null => {
    const t = 查格式(类, v);
    return t ? (类 === "日期" ? 认日期(t) : 认时间(t)) : null;
  };

  /**
   * 项目的成交需求 / 合同金额 / 定金金额（迁移 097）。项目模式才落这几格，否则原样进备注。
   * 和客户新几格一样逐格留空：原表这一格空着就不带这个键（apply 只补的格，不算原系统清空）。
   * 金额带的币种：币种列 → 金额前面的符号（$ / US$ / USD 算美元）→ 默认人民币；币种列认不出就按后两步定的写，提醒一笔、原样进备注
   */
  const 项目成交钱格 = (r: 原始记录, v: Record<string, string>, 项目: boolean, 附加: string[]): 待写["值"] => {
    const 出: 待写["值"] = {};
    if (!项目) {
      for (const k of 成交钱列) if (v[k]) 附加.push(`${字段中文[k]}：${v[k]}`);
      return 出;
    }
    if (v.dealDemand) {
      const 字 = [...v.dealDemand.trim()];
      if (字.length > 成交需求上限) {
        出问题(r, "提醒", "格式不对", `成交需求超过 ${成交需求上限} 字，截到 ${成交需求上限} 字，全文放进了备注`);
        附加.push(`成交需求：${字.join("")}`);
      }
      出.dealDemand = 字.slice(0, 成交需求上限).join("");
    }
    for (const [金额键, 币种键] of [["contractAmount", "contractCurrency"], ["depositAmount", "depositCurrency"]] as const) {
      const 名 = 字段中文[金额键];
      const 原 = v[金额键];
      if (!原) {
        if (v[币种键]) 附加.push(`${字段中文[币种键]}：${v[币种键]}`);
        continue;
      }
      const 补 = 查格式("金额", 原);
      const a = 认金额(原) ?? (补 === null ? null : Number(补));
      if (a === null || !Number.isFinite(a) || a < 0) {
        附加.push(`${名}：${原}${v[币种键] ? ` ${v[币种键]}` : ""}`);
        出问题(r, "提醒", "格式不对", `${名}「${原}」认不出，没写，原样放进了备注`);
        continue;
      }
      let 币 = 符号币种(原) ?? 默认币种;
      if (v[币种键]) {
        const c = 认币种(v[币种键]);
        if (c) 币 = c;
        else {
          附加.push(`${字段中文[币种键]}：${v[币种键]}`);
          出问题(r, "提醒", "格式不对", `${字段中文[币种键]}「${v[币种键]}」认不出，按 ${币} 写，原样放进了备注`);
        }
      }
      出[金额键] = a;
      出[币种键] = 币;
    }
    return 出;
  };

  /** m.同一家 认作同一家的：后一家名键 → 前一家名键们 */
  const 同家前 = new Map<string, string[]>();
  for (const [k, 是] of Object.entries(m.同一家 ?? {})) {
    const i = k.indexOf("|");
    if (!是 || i < 0) continue;
    const [前, 后] = [k.slice(0, i), k.slice(i + 1)];
    同家前.set(后, [...(同家前.get(后) ?? []), 前]);
  }
  const 找同家 = (nk: string): 待写 | undefined => {
    for (const 前 of 同家前.get(nk) ?? []) {
      const ids = 批客户名.get(前) ?? [];
      if (ids.length !== 1) continue;
      let w = 批客户.get(ids[0]);
      while (w?.并入) w = 批客户.get(w.并入);
      if (w) return w;
    }
    return undefined;
  };

  const 对值 = (r: 原始记录, 名: keyof 映射["值"], v: string | undefined, 默认: string, 叫法: string): string => {
    if (!v) return 默认;
    const hit = m.值[名][v];
    if (hit) return hit;
    出问题(r, "提醒", 名 === "阶段" ? "阶段对不上" : "值对不上", `${叫法}「${v}」对不上，先按「${默认}」写`);
    return 默认;
  };

  /** 客户状态：和字典里启用的某一项一字不差才落；对不上原样进备注，提醒一笔（不猜、不落默认值） */
  const 认字典 = (r: 原始记录, v: string | undefined, 附加: string[], 叫法: string, 选项: readonly string[] | undefined): string | null => {
    const t = v?.trim();
    if (!t) return null;
    if (选项?.includes(t)) return t;
    附加.push(`${叫法}：${t}`);
    出问题(r, "提醒", "值对不上", `${叫法}「${t}」不在我们的${叫法}选项里，原样放进了备注`);
    return null;
  };

  /**
   * 客户类型：空着的落「暂不确认」；先过对照表，对上的（还启用着）就落；其余照 认字典，原值进备注。
   * 「暂不确认」被管理员停用 / 改名了就不落、也不提醒（空格本来就没什么可进备注的）
   */
  const 认客户类型 = (r: 原始记录, v: string | undefined, 附加: string[]): string | null => {
    if (!v?.trim()) return 本地.客户类型?.includes(客户类型空着) ? 客户类型空着 : null;
    const 对 = 对客户类型(v);
    if (对 === 客户类型空着 && !本地.客户类型?.includes(对)) return null;
    if (对 && 本地.客户类型?.includes(对)) return 对;
    return 认字典(r, v, 附加, "客户类型", 本地.客户类型);
  };

  /**
   * 联系人号码查重：每格算查重键，先比本批前面的（报一次就够），再比我们这边已有的（以前导过、落到同一位的不算）。
   * 只提醒不拦：照写，说清撞了谁
   */
  const 查联系人号 = (r: 原始记录, 值: 待写["值"], 自己?: string) => {
    for (const [格, kind, 叫法] of 联系人查重格) {
      const v = 值[格];
      const 键 = typeof v === "string" ? 联系人号查重键(kind, v) : "";
      if (!键) continue;
      const k = `${kind}|${键}`;
      const 前 = 批联系人号.get(k);
      if (前) 出问题(r, "提醒", "号码重复", `${叫法} ${v} 和本批${前.行号 ? `第 ${前.行号} 行` : `「${前.外部ID}」`}的联系人一样，照写两位，请人看是不是同一个人`);
      else 批联系人号.set(k, r);
      const 撞 = (本地.联系人号?.get(k) ?? []).filter((x) => x.id !== 自己);
      if (!撞.length) continue;
      const 头 = 撞[0];
      问题们.push({
        级别: "提醒", 类别: "号码重复", 实体: r.实体, 外部ID: r.外部ID, 行号: r.行号, 出处: r.出处,
        说明: `${叫法} ${v} 已经记在联系人「${头.name}」（${头.customerName}）身上${撞.length > 1 ? `等 ${撞.length} 位` : ""}，照写、不合并；是不是同一个人请导完点进去核对`,
        链接: 撞.slice(0, 3).map((x) => ({ 名: `${x.name}（${x.customerName}）`, 客户Id: x.customerId })),
      });
    }
  };

  const 缺必填 = (r: 原始记录, s: 标准): boolean => {
    const 缺 = 必填[r.实体].filter((f) => !s.值[f]);
    if (!缺.length) return false;
    出问题(r, "跳过", "缺必填", `没有${缺.map((f) => 字段中文[f] ?? f).join("、")}，这一条不导`);
    return true;
  };

  /** 挂客户：所属客户 ID → 本批 / 以前导过的；再按客户名 → 本批唯一 / 我们这边唯一 */
  const 找客户 = (r: 原始记录, s: 标准): 待写["父客户"] | null => {
    const ref = s.值.customerRef;
    if (ref) {
      const 批 = 批客户.get(ref);
      if (批) return { 外部ID: 批.并入 ?? 批.外部ID };
      const 本 = 本地.引用.get(`customer|${ref}`);
      if (本) return { 本地ID: 本 };
    }
    const 名 = s.值.customerName;
    if (名) {
      const 批 = 批客户名.get(名键(名)) ?? [];
      if (批.length === 1) return { 外部ID: 批[0] };
      if (批.length > 1) {
        出问题(r, "跳过", "客户不唯一", `这批数据里叫「${名}」的客户有 ${批.length} 个，分不出挂哪个；请补「所属客户 ID」列`);
        return null;
      }
      const 本 = 本地.客户名.get(名键(名)) ?? [];
      if (本.length === 1) return { 本地ID: 本[0] };
      if (本.length > 1) {
        出问题(r, "跳过", "客户不唯一", `我们这边叫「${名}」的客户有 ${本.length} 个，分不出挂哪个`);
        return null;
      }
    }
    出问题(r, "跳过", "找不到客户", ref || 名 ? `找不到所属客户「${名 || ref}」，这一条不导` : "没有所属客户，这一条不导");
    return null;
  };

  const 定指纹 = (w: 待写) => {
    w.指纹 = 指纹([w.值, w.父客户 ?? null, w.父商机 ?? null, w.并入 ?? null]);
    if (w.目标?.方式 === "对照" && 本地.指纹?.get(`${w.实体}|${w.外部ID}`) === w.指纹) w.没变 = true;
    else delete w.没变;
  };

  const 收 = (r: 原始记录, 值: 待写["值"], 附: Partial<待写> = {}): 待写 => {
    const w: 待写 = { 实体: r.实体, 外部ID: r.外部ID, 值, 指纹: "", 原始: r.字段, 行号: r.行号, 出处: r.出处, ...附 };
    定指纹(w);
    待写们.push(w);
    return w;
  };

  /** 分配方式：和字典里启用的某一项一字不差才落；对不上原样进备注，提醒一笔（同 认字典） */
  const 认分配方式 = (r: 原始记录, v: string | undefined, 附加: string[]): string | null => {
    const t = v?.trim();
    if (!t) return null;
    if (本地.分配方式?.includes(t)) return t;
    附加.push(`分配方式：${t}`);
    出问题(r, "提醒", "值对不上", `分配方式「${t}」不在我们的分配方式选项里，原样放进了备注`);
    return null;
  };

  /** 来源对渠道：原文或格式认过的写法和某个渠道的名字对上就挂上（只补空，写的时候再看）；对不上的原样进备注、提醒一笔，不中断 */
  const 认渠道 = (r: 原始记录, 原: string | undefined, 认过: string | null, 附加: string[]): string | null => {
    const t = 原?.trim();
    if (!t || !本地.渠道) return null;
    const hit = 本地.渠道.get(名键(t)) ?? (认过 ? 本地.渠道.get(名键(认过)) : undefined);
    if (hit) return hit;
    附加.push(`来源：${t}`);
    出问题(r, "提醒", "值对不上", `来源「${t}」对不上我们的渠道，没挂渠道，原样放进了备注`);
    return null;
  };

  /** 客户的简称 / 地址 / 分配方式：认出来的放进 新格，认不出的进备注 + 提醒 */
  const 客户新格 = (r: 原始记录, v: Record<string, string | undefined>, 附加: string[]): 新格 => {
    const o: 新格 = {};
    const 简称 = v.shortName?.trim();
    if (简称) {
      o.shortName = 简称.slice(0, 简称上限);
      if (简称.length > 简称上限) {
        附加.push(`客户简称：${简称}`);
        出问题(r, "提醒", "格式不对", `客户简称超过 ${简称上限} 个字，截到前 ${简称上限} 个字，原文放进了备注`);
      }
    }
    const 地址原 = { addrCountry: v.addrCountry, addrProvince: v.addrProvince, addrCity: v.addrCity, addrDistrict: v.addrDistrict };
    if (Object.values(地址原).some((x) => x?.trim())) {
      const 地 = 规整地址(地址原);
      const 原文 = (["addrCountry", "addrProvince", "addrCity", "addrDistrict"] as const).map((k) => 地址原[k]?.trim()).filter(Boolean).join(" ");
      if (!地.ok) {
        附加.push(`地址：${原文}`);
        出问题(r, "提醒", "格式不对", `地址认不出（${地.error}），原样放进了备注`);
      } else {
        for (const [k, x] of Object.entries(地.值)) if (x) o[k] = x;
        // 国外的省 / 区县不存（只记国家 + 城市）：丢掉的那几格进备注，一格不丢
        const 丢 = (["addrProvince", "addrDistrict"] as const).filter((k) => 地址原[k]?.trim() && !地.值[k]);
        if (丢.length) 附加.push(...丢.map((k) => `${字段中文[k]}：${地址原[k]!.trim()}`));
      }
    }
    const 分配 = 认分配方式(r, v.assignWay, 附加);
    if (分配) o.assignWay = 分配;
    return o;
  };

  /** 联系人的性别 / 生日 / 爱好 / 地址：认出来的放进 新格，认不出的进备注 + 提醒 */
  const 联系人新格 = (r: 原始记录, v: Record<string, string | undefined>, 附加: string[]): 新格 => {
    const o: 新格 = {};
    const 性别 = v.gender?.trim();
    if (性别) {
      const 认 = /^(男|男性|先生|m|male)$/i.test(性别) ? "男" : /^(女|女性|女士|f|female)$/i.test(性别) ? "女" : null;
      if (认 && (性别们 as readonly string[]).includes(认)) o.gender = 认;
      else {
        附加.push(`性别：${性别}`);
        出问题(r, "提醒", "值对不上", `性别「${性别}」认不出（只认男 / 女），原样放进了备注`);
      }
    }
    const 生日原 = v.birthday?.trim();
    if (生日原) {
      let 生日 = 认生日(生日原);
      if (生日 === undefined) {
        const d = 认日期(生日原);
        if (d) 生日 = 认生日(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
      }
      if (生日) o.birthday = 生日;
      else {
        附加.push(`生日：${生日原}`);
        出问题(r, "提醒", "格式不对", `生日「${生日原}」认不出日期，原样放进了备注`);
      }
    }
    for (const [k, 上限, 名] of [["hobby", 爱好上限, "爱好"], ["address", 联系人地址上限, "联系人地址"]] as const) {
      const t = v[k]?.trim();
      if (!t) continue;
      o[k] = t.slice(0, 上限);
      if (t.length > 上限) {
        附加.push(`${名}：${t}`);
        出问题(r, "提醒", "格式不对", `${名}超过 ${上限} 个字，截到前 ${上限} 个字，原文放进了备注`);
      }
    }
    return o;
  };

  /** 客户并进前一条：前一条空着的格子拿后一条的补上，名字不同记「又名」、号不同记「另一个电话」、后一条的备注也拼过去，再重算前一条的指纹 */
  const 带过去 = (主: 待写, 后: 待写) => {
    const [a, b] = [主.值, 后.值];
    const 段: string[] = [];
    if (名键(String(b.name ?? "")) !== 名键(String(a.name ?? ""))) 段.push(`又名：${b.name}`);
    // 以前 custStatus 那行插在电话的 if / else 中间，把「另一个电话」吞了（P8 修）
    if (b.phone && !a.phone) a.phone = b.phone;
    else if (b.phone && 号键(String(b.phone)) !== 号键(String(a.phone))) 段.push(`另一个电话：${b.phone}`);
    if (b.custStatus && !a.custStatus) a.custStatus = b.custStatus;
    else if (b.custStatus && a.custStatus !== b.custStatus) 段.push(`客户状态：${b.custStatus}`);
    // 「暂不确认」是原表空着 / 写的阶段落的（10-30）：当空的看，后一条有真类型就换上，后一条是暂不确认的不进备注
    const 未定 = (v: unknown) => !v || v === 客户类型空着;
    if (!未定(b.customerType) && 未定(a.customerType)) a.customerType = b.customerType;
    else if (b.customerType && !a.customerType) a.customerType = b.customerType;
    else if (!未定(b.customerType) && a.customerType !== b.customerType) 段.push(`客户类型：${b.customerType}`);
    if (b.channelId && !a.channelId) a.channelId = b.channelId;
    for (const k of [...客户附加列, ...客户新列]) {
      if (b[k] == null || b[k] === "") continue;
      if (a[k] == null || a[k] === "") a[k] = b[k];
      else if (a[k] !== b[k]) 段.push(`${字段中文[k] ?? k}：${b[k]}`);
    }
    if (b.remark) 段.push(String(b.remark));
    const 已有 = String(a.remark ?? "");
    a.remark = 拼备注(a.remark == null ? null : String(a.remark), ...段.filter((x) => !已有.includes(x)));
    定指纹(主);
  };

  for (const e of 实体顺序) {
    const 列 = m.列[e] ?? {};
    const 见过ID = new Map<string, 原始记录>();
    /** 客户本批去重：号键 → 第一条；公司名键 → 第一条 */
    const 同号 = new Map<string, 待写>();
    const 像名 = new Map<string, 原始记录>();

    for (const r of 按类[e]) {
      const 先前 = 见过ID.get(r.外部ID);
      if (先前) {
        出问题(r, "跳过", "ID 重复", `原系统 ID「${r.外部ID}」和${先前.行号 ? `第 ${先前.行号} 行` : "前面一条"}重复，只导前一条`);
        continue;
      }
      见过ID.set(r.外部ID, r);
      const s = 拆(r, 列);
      if (缺必填(r, s)) continue;
      const 附加 = [...s.附加];
      const 对照 = 本地.引用.get(`${e}|${r.外部ID}`);
      const 目标: 待写["目标"] = 对照 ? { 本地ID: 对照, 方式: "对照" } : undefined;

      if (e === "customer") {
        const 号 = 认电话(r, s.值.phone, 附加);
        const phone = 号.phone;
        附加.push(...号.另.map((x) => `另一个电话：${x}`));
        // 级别那格空着、原表客户类型写的是意向客户 → B 级（10-30 对方给的对照）
        const level = s.值.level ? 认等级(s.值.level) : (客户类型等级(s.值.customerType) ?? null);
        if (s.值.level && !level) 附加.push(`客户等级：${s.值.level}`);
        const email = 补格(s.值.email, 号.email, "邮箱", 附加);
        const wechat = 补格(s.值.wechat, 号.wechat, "微信", 附加);
        const whatsapp = 补格(s.值.whatsapp, 号.whatsapp, "WhatsApp", 附加);
        const custStatus = 认字典(r, s.值.custStatus, 附加, "客户状态", 本地.客户状态);
        const customerType = 认客户类型(r, s.值.customerType, 附加);
        const source = s.值.source ? (查格式("来源", s.值.source) ?? s.值.source) : null;
        const channelId = 认渠道(r, s.值.source, source, 附加);
        const 新 = 客户新格(r, s.值, 附加);
        const 值: 待写["值"] = {
          name: s.值.name,
          phone,
          salesOwnerId: 负责人(r, s.值.owner),
          followStatus: 对值(r, "跟进状态", s.值.followStatus, "待跟进", "跟进状态"),
          // 没认出就不带这一格：以前导过的照三方比对，不会因为这次没给就把我们这边的客户状态清掉
          ...(custStatus ? { custStatus } : {}),
          ...(customerType ? { customerType } : {}),
          remark: 拼备注(s.值.remark, ...附加),
          email,
          wechat,
          whatsapp,
          country: s.值.country ? (查格式("国家", s.值.country) ?? s.值.country) : null,
          source,
          level,
          website: s.值.website ?? null,
          // 对上渠道才带 channelId（写的时候只补空、归属没定的才挂）；新几格也是认出来才带
          ...(channelId ? { channelId } : {}),
          ...新,
        };
        // 同号：并进前一条（外部 ID 不同，原系统里重复建了）。和我们这边「一个号一位客户」的查重一个口径，名字不同也并，提醒人看
        const 键 = phone ? 号键(phone) : "";
        const 前 = 键 ? 同号.get(键) : undefined;
        if (前) {
          const 哪条 = 前.行号 ? `第 ${前.行号} 行` : `「${前.外部ID}」`;
          出问题(
            r,
            "提醒",
            "重名",
            名键(String(前.值.name)) === 名键(s.值.name)
              ? `和${哪条}同名同号，认作同一家，合成一条`
              : `和${哪条}「${前.值.name}」同号、名字不同，按同一家合成一条，请人看一眼`,
          );
          const w = 收(r, 值, { 并入: 前.外部ID, 目标 });
          带过去(前, w);
          批客户.set(r.外部ID, w);
          continue;
        }
        // AI 清洗 / 人在报告里认作同一家（名字很像、号不同）：也并进前一家
        const 同家 = 找同家(名键(s.值.name));
        if (同家) {
          出问题(r, "提醒", "重名", `和${同家.行号 ? `第 ${同家.行号} 行` : `「${同家.外部ID}」`}「${同家.值.name}」认作同一家（AI 清洗或报告里定的），合成一条，请人看一眼`);
          const w = 收(r, 值, { 并入: 同家.外部ID, 目标 });
          带过去(同家, w);
          批客户.set(r.外部ID, w);
          if (键 && !同号.has(键)) 同号.set(键, 同家);
          continue;
        }
        // 没导过、我们这边有同号客户：连上它
        let 落 = 目标;
        if (!落 && phone) {
          const 本地同号 = 本地.客户号.get(号键(phone)) ?? [];
          if (本地同号.length === 1) {
            落 = { 本地ID: 本地同号[0], 方式: "同号" };
            出问题(r, "提醒", "重名", `我们这边已有同号客户，连上它，只补空着的格子`);
          } else if (本地同号.length > 1) 出问题(r, "提醒", "疑似重名", `我们这边有 ${本地同号.length} 个客户是这个号，照新建，请人工合并`);
        }
        if (!落) {
          const k = 公司名键(s.值.name);
          const 像 = k ? 像名.get(k) : undefined;
          if (像) 出问题(r, "提醒", "疑似重名", `和${像.行号 ? `第 ${像.行号} 行` : "前面一条"}名字很像、电话不同，照写两条，请人看一眼`);
          else if (k) 像名.set(k, r);
          if (!像 && (本地.客户名.get(名键(s.值.name)) ?? []).length) 出问题(r, "提醒", "疑似重名", `我们这边已经有叫「${s.值.name}」的客户，照新建，请人看一眼`);
        }
        const w = 收(r, 值, { 目标: 落 });
        if (键) 同号.set(键, w);
        批客户.set(r.外部ID, w);
        const nk = 名键(s.值.name);
        批客户名.set(nk, [...(批客户名.get(nk) ?? []), r.外部ID]);
        continue;
      }

      if (e === "lead") {
        const 号 = 认电话(r, s.值.phone, 附加);
        附加.push(...号.另.map((x) => `另一个电话：${x}`));
        const email = 补格(s.值.email, 号.email, "邮箱", 附加);
        if (号.wechat) 附加.push(`微信：${号.wechat}`);
        if (号.whatsapp) 附加.push(`WhatsApp：${号.whatsapp}`);
        收(
          r,
          {
            name: s.值.name,
            contact: s.值.contact ?? null,
            phone: 号.phone || null,
            email,
            industry: s.值.industry ?? null,
            source: s.值.source ? (查格式("来源", s.值.source) ?? s.值.source) : "其他",
            status: 对值(r, "线索状态", s.值.status, "待跟进", "线索状态"),
            ownerId: 负责人(r, s.值.owner),
            remark: 拼备注(s.值.remark, ...附加),
          },
          { 目标 },
        );
        continue;
      }

      // 下面三类都要挂客户
      const 父客户 = 找客户(r, s);
      if (!父客户) continue;

      if (e === "contact") {
        const 号 = 认电话(r, s.值.phone, 附加);
        附加.push(...号.另.map((x) => `另一个电话：${x}`));
        const email = 补格(s.值.email, 号.email, "邮箱", 附加);
        const wechat = 补格(s.值.wechat, 号.wechat, "微信", 附加);
        if (号.whatsapp) 附加.push(`WhatsApp：${号.whatsapp}`);
        const 新 = 联系人新格(r, s.值, 附加);
        const 值: 待写["值"] = {
          ...新,
          name: s.值.name,
          position: s.值.position ?? null,
          phone: 号.phone || null,
          email,
          wechat,
          isPrimary: s.值.isPrimary ? 认是否(s.值.isPrimary) : false,
          remark: 拼备注(s.值.remark, ...附加),
        };
        查联系人号(r, 值, 目标?.本地ID);
        收(r, 值, { 父客户, 目标 });
        continue;
      }

      if (e === "opportunity") {
        // 项目模式：stage = 项目节点，status = 结局（没结局 = OPEN）；赢率项目没有，预计成交落项目上（10-27）
        const 项目 = !!m.项目;
        let status: string;
        let stage: string;
        if (项目) {
          const 位 = 对值(r, "阶段", s.值.stage, 第一个节点.node, "当前进程");
          stage = 是结局(位) ? 结局默认节点(位) : 位;
          status = 是结局(位) ? 位 : "OPEN";
          // 原系统另有一列状态说了输单：线索阶段算线索流失，商机阶段算丢单；
          // 订单阶段的统一标成异常状态、停在原节点，不退回商机（10-27 会上定），异常类别导完再补
          if (status === "OPEN" && s.值.status && 认商机状态(s.值.status) === "LOST") {
            const 在 = 节点所在阶段(stage);
            status = 在 === "线索" ? "线索流失" : 在 === "订单" ? "异常状态" : "丢单";
            if (status === "异常状态") 出问题(r, "提醒", "值对不上", `订单阶段「${stage}」写了输单，导成异常状态、停在「${stage}」；异常类别导完到项目里补`);
          }
        } else {
          const 阶段 = 对值(r, "阶段", s.值.stage, OPP_STAGES[0], "商机阶段");
          status = s.值.status ? 认商机状态(s.值.status) : "OPEN";
          stage = 阶段;
          if (阶段 === 输单) {
            status = "LOST";
            stage = OPP_STAGES[0];
          } else if (阶段 === "赢单成交" && status === "OPEN") status = "WON";
          if (status === "WON") stage = "赢单成交";
        }
        let amount = 0;
        if (s.值.amount) {
          const 补 = 查格式("金额", s.值.amount);
          const a = 认金额(s.值.amount) ?? (补 === null ? null : Number(补));
          if (a === null) {
            附加.push(`金额：${s.值.amount}`);
            出问题(r, "提醒", "格式不对", `金额「${s.值.amount}」认不出，先记 0，原样放进了备注`);
          } else amount = a;
        }
        let probability: number | null = 项目 ? null : status === "WON" ? 100 : status === "LOST" ? 0 : (STAGE_PROBABILITY[stage] ?? 10);
        if (项目 && s.值.probability) 附加.push(`赢率：${s.值.probability}`);
        if (!项目 && s.值.probability && status === "OPEN") {
          const p = 认赢率(s.值.probability);
          if (p === null) 出问题(r, "提醒", "格式不对", `赢率「${s.值.probability}」认不出，按阶段给 ${probability}%`);
          else probability = p;
        }
        let expectedDealAt: string | null = null;
        if (s.值.expectedDealAt) {
          const d = 认日期(s.值.expectedDealAt) ?? 补日期("日期", s.值.expectedDealAt);
          if (d) expectedDealAt = d.toISOString();
          else {
            附加.push(`预计成交：${s.值.expectedDealAt}`);
            出问题(r, "提醒", "格式不对", `预计成交日期「${s.值.expectedDealAt}」认不出，原样放进了备注`);
          }
        }
        // 赢单 / 输单要有个历史日期，不然看板会把它算成本月的成交
        const 结了 = 项目 ? `项目「${status}」` : status === "WON" ? "赢单" : "输单";
        let closedAt: string | null = null;
        if (status !== "OPEN") {
          const d = s.值.closedAt ? (认日期(s.值.closedAt) ?? 补日期("日期", s.值.closedAt)) : null;
          if (d) closedAt = d.toISOString();
          else if (s.值.closedAt) {
            附加.push(`结单日期：${s.值.closedAt}`);
            出问题(r, "提醒", "格式不对", `结单日期「${s.值.closedAt}」认不出，原样放进了备注`);
          }
          if (!closedAt) {
            closedAt = expectedDealAt;
            出问题(
              r,
              "提醒",
              "缺日期",
              expectedDealAt
                ? `${结了}没有结单日期，按预计成交日期记`
                : `${结了}没有结单日期，会按导入当天算进看板`,
            );
          }
        }
        const 钱 = 项目成交钱格(r, s.值, 项目, 附加);
        const w = 收(
          r,
          {
            name: s.值.name,
            amount,
            stage,
            status,
            probability,
            expectedDealAt,
            closedAt,
            ownerId: 负责人(r, s.值.owner),
            remark: 拼备注(s.值.remark, ...附加),
            ...钱,
          },
          { 父客户, 目标 },
        );
        批商机.set(r.外部ID, w);
        continue;
      }

      // followup
      let content = s.值.content ?? "";
      const 类型 = 对值(r, "跟进类型", s.值.type, "OTHER", "跟进方式");
      const 类型名 = FOLLOW_TYPES.find((t) => t.value === 类型)?.label ?? "跟进";
      if (!content && !s.值.title) {
        出问题(r, "跳过", "缺必填", "没有跟进内容，这一条不导");
        continue;
      }
      // 标题只从原内容取前 20 字，别把拼进去的「表头：值」带进标题
      const title = s.值.title || content.replace(/\s+/g, " ").trim().slice(0, 20) || 类型名;
      if (!content) content = s.值.title!;
      if (附加.length) content = 拼备注(content, ...附加) ?? "";
      let occurredAt: string | null = null;
      if (s.值.occurredAt) {
        const d = 认时间(s.值.occurredAt) ?? 补日期("时间", s.值.occurredAt);
        if (d) occurredAt = d.toISOString();
        else {
          content = 拼备注(content, `跟进时间：${s.值.occurredAt}`) ?? content;
          出问题(r, "提醒", "格式不对", `跟进时间「${s.值.occurredAt}」认不出，按导入时间记，原样放进了内容`);
        }
      } else 出问题(r, "提醒", "格式不对", "没有跟进时间，按导入时间记");
      // 挂商机：所属商机 ID → 本批 / 以前导过的；商机名 → 同一客户下唯一的
      let 父商机: 待写["父商机"];
      const oref = s.值.opportunityRef;
      const oname = s.值.opportunityName;
      if (oref) {
        if (批商机.has(oref)) 父商机 = { 外部ID: oref };
        else if (本地.引用.has(`opportunity|${oref}`)) 父商机 = { 本地ID: 本地.引用.get(`opportunity|${oref}`)! };
      }
      if (!父商机 && oname) {
        const 同客户 = [...批商机.values()].filter((o) => 同一客户(o.父客户, 父客户) && 名键(String(o.值.name)) === 名键(oname));
        if (同客户.length === 1) 父商机 = { 外部ID: 同客户[0].外部ID };
        else if ("本地ID" in 父客户) {
          const 本 = 本地.商机名.get(`${父客户.本地ID}|${名键(oname)}`) ?? [];
          if (本.length === 1) 父商机 = { 本地ID: 本[0] };
        }
      }
      if (!父商机 && (oref || oname)) 出问题(r, "提醒", "找不到商机", `找不到所属商机「${oname || oref}」，跟进照导，只挂在客户下面`);
      收(
        r,
        {
          type: 类型,
          title,
          content,
          status: s.值.status ? 认跟进记录状态(s.值.status) : "已完成",
          occurredAt,
          ownerId: 负责人(r, s.值.owner),
        },
        { 父客户, 父商机, 目标 },
      );
    }
  }
  return { 待写: 待写们, 问题: 问题们 };
}

function 同一客户(a: 待写["父客户"], b: 待写["父客户"]): boolean {
  if (!a || !b) return false;
  if ("外部ID" in a && "外部ID" in b) return a.外部ID === b.外部ID;
  if ("本地ID" in a && "本地ID" in b) return a.本地ID === b.本地ID;
  return false;
}

/** 报告里按类数一数 */
export function 数一数(结果: 清洗结果): Record<实体, { 待写: number; 新建: number; 更新: number; 没变: number; 并入: number; 跳过: number; 提醒: number }> {
  const out = Object.fromEntries(实体顺序.map((e) => [e, { 待写: 0, 新建: 0, 更新: 0, 没变: 0, 并入: 0, 跳过: 0, 提醒: 0 }])) as ReturnType<typeof 数一数>;
  for (const w of 结果.待写) {
    const c = out[w.实体];
    c.待写++;
    if (w.并入) c.并入++;
    else if (w.没变) c.没变++;
    else if (w.目标) c.更新++;
    else c.新建++;
  }
  for (const p of 结果.问题) out[p.实体][p.级别 === "跳过" ? "跳过" : "提醒"]++;
  return out;
}

export { 实体名 };

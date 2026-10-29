/**
 * 企业版客户与联系人改版（2026-10-29，定稿 P5：第 22–24、29、30 条，待定 14–17、19）的纯数据和纯函数。
 * 浏览器和服务端都用这一份：别在这里 import 任何服务端模块。读写库的在 customer-v2-db.ts。
 *
 * 能改的口子都在这里（对方定稿再细化时只改这几处）：
 *   企业客户级别 / 企业级别说明 —— S / A / B / C，老的 D 一律当 C（customer-v2-db.ts 的 级别D改C 只做一次）
 *   国内叫法 —— 地址里算「国内」的国家名：国内选到区县，国外只记国家和城市
 *   附件分类们 —— 联系人附件的两格：名片 / 相册
 *   内置号码种类 —— 号码类型字典（contactKind）默认几项分别记成 ContactMethod 的哪种 kind、按什么规矩验
 *   客户页摆法 —— 企业版项目模式下客户页留哪几块（待定 14：蓝留、黄移到项目、红不放）
 * 分配方式、号码类型的选项本身在企业版字典（dict-kinds.ts 的 custAssign / contactKind），设置里能改能加。
 */
import { 验号码, type 号码类型 } from "./contact-format";

// ---------- 客户级别 ----------

/** 企业版客户级别（定稿 P5 第 23 条）：S 最高。还是存在 CustomerExtra.level 这一列，只换了能选的几档 */
export const 企业客户级别 = ["S", "A", "B", "C"] as const;
export type 企业客户级别 = (typeof 企业客户级别)[number];
export const 企业级别说明: Record<企业客户级别, string> = { S: "S 战略", A: "A 重点", B: "B 常规", C: "C 培育" };

/**
 * 库里存的级别 → 企业版的级别。老的四档（A–D）里 A / B / C 照旧，D 并进 C（定稿：D→C）；S 原样；
 * 小写、带「级」「类」的照 认等级 的口径认；空和认不出的都当没分级（null）
 */
export function 企业级别(v: unknown): 企业客户级别 | null {
  const t = String(v ?? "").trim().toUpperCase().replace(/[级類类\s]/g, "");
  if (t === "D") return "C";
  return (企业客户级别 as readonly string[]).includes(t) ? (t as 企业客户级别) : null;
}

/** 表单交上来的级别：空 = 没分级（null），S/A/B/C 认，别的（含 D）不收（undefined） */
export function 认企业级别(v: unknown): 企业客户级别 | null | undefined {
  if (v == null || String(v).trim() === "") return null;
  const t = String(v).trim().toUpperCase();
  return (企业客户级别 as readonly string[]).includes(t) ? (t as 企业客户级别) : undefined;
}

// ---------- 客户地址 ----------

/** 地址里算国内的国家名（待定 17：国内选到区县，国外只选国家和城市） */
export const 国内叫法 = "中国";
const 国内别名 = new Set(["中国", "中国大陆", "china", "cn", "prc"]);
export const 是国内 = (country: string | null | undefined): boolean => 国内别名.has(String(country ?? "").trim().toLowerCase());

export type 客户地址 = { addrCountry: string | null; addrProvince: string | null; addrCity: string | null; addrDistrict: string | null };
export const 地址每格上限 = 40;

/**
 * 表单交上来的地址 → 存库的四格。全空 = 没填（四格都是 null）。
 * 只填了省 / 市 / 区县没填国家的当国内；国内的国家统一存「中国」；国外的省、区县存空（只记国家 + 城市）
 */
export function 规整地址(v: Partial<Record<keyof 客户地址, unknown>> | null | undefined): { ok: true; 值: 客户地址 } | { ok: false; error: string } {
  const 格 = (x: unknown) => (typeof x === "string" ? x.trim().replace(/\s+/g, " ") : "") || null;
  let country = 格(v?.addrCountry);
  const province = 格(v?.addrProvince), city = 格(v?.addrCity), district = 格(v?.addrDistrict);
  for (const x of [country, province, city, district]) {
    if (x && x.length > 地址每格上限) return { ok: false, error: `地址每一格最多 ${地址每格上限} 个字` };
  }
  if (!country && (province || city || district)) country = 国内叫法;
  if (!country) return { ok: true, 值: { addrCountry: null, addrProvince: null, addrCity: null, addrDistrict: null } };
  if (是国内(country)) return { ok: true, 值: { addrCountry: 国内叫法, addrProvince: province, addrCity: city, addrDistrict: district } };
  return { ok: true, 值: { addrCountry: country, addrProvince: null, addrCity: city, addrDistrict: null } };
}

/** 客户页上显示的一行地址：国内「广东省 深圳市 南山区」（不再写中国），国外「美国 洛杉矶」；没填 = 空串 */
export function 拼地址(a: Partial<客户地址> | null | undefined): string {
  if (!a) return "";
  const 段 = 是国内(a.addrCountry) || (!a.addrCountry && (a.addrProvince || a.addrDistrict))
    ? [a.addrProvince, a.addrCity, a.addrDistrict]
    : [a.addrCountry, a.addrCity];
  // 直辖市省和市同名（北京市 北京市）只写一遍
  return 段.map((x) => (x ?? "").trim()).filter(Boolean).filter((x, i, 全) => 全.indexOf(x) === i).join(" ");
}

// ---------- 客户简称、分配方式 ----------

export const 简称上限 = 20;

// ---------- 关联客户 ----------

export const 关联说明上限 = 40;
/** 一对客户只记一行：小的 id 放 customerId、大的放 otherId。同一位不能关联自己（返回 null） */
export function 关联对(a: string, b: string): { customerId: string; otherId: string } | null {
  if (!a || !b || a === b) return null;
  return a < b ? { customerId: a, otherId: b } : { customerId: b, otherId: a };
}
/** 从这位客户这一头看，一行关联的「另一位」是谁 */
export const 另一头 = (行: { customerId: string; otherId: string }, 我: string): string => (行.customerId === 我 ? 行.otherId : 行.customerId);

// ---------- 联系人 ----------

export const 性别们 = ["男", "女"] as const;
export const 爱好上限 = 60;
export const 联系人地址上限 = 100;
/** 生日：只收 YYYY-MM-DD 的真实日子（2 月 30 日这种不收）；空 = null；不对 = undefined */
export function 认生日(v: unknown): string | null | undefined {
  if (v == null || String(v).trim() === "") return null;
  const t = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const 日 = new Date(Date.UTC(y, mo - 1, d));
  if (日.getUTCFullYear() !== y || 日.getUTCMonth() !== mo - 1 || 日.getUTCDate() !== d || y < 1900 || y > 2100) return undefined;
  return t;
}

/** 联系人附件的两格（待定 19：名片和相册都是图片附件）。没分类的老附件算相册 */
export const 附件分类们 = ["名片", "相册"] as const;
export type 附件分类 = (typeof 附件分类们)[number];
export const 是附件分类 = (v: unknown): v is 附件分类 => (附件分类们 as readonly unknown[]).includes(v);

/**
 * 号码类型字典（contactKind）的默认几项 → ContactMethod.kind 和验法（下标 = 字典默认项的序号，dict-kinds.ts 的默认顺序）。
 * 按序号认，不按名字认：设置里把「手机」改叫「手机号」，存的 kind 还是 phone。
 * 验：能用建档那套格式规矩的（手机 / 邮箱 / 微信 / 旺旺）按 验号码；座机、WhatsApp 和自己加的只做轻校验（号码格式没有定稿）
 */
export const 内置号码种类: readonly { kind: string; 验?: 号码类型 }[] = [
  { kind: "phone", 验: "手机号" },
  { kind: "landline" },
  { kind: "wechat", 验: "微信" },
  { kind: "email", 验: "邮箱" },
  { kind: "whatsapp" },
  { kind: "wangwang", 验: "旺旺ID" },
];
/** 自己加的号码类型存成 custom:<叫法> */
export const 自定种类前缀 = "custom:";
export const 号码上限 = 80;
export const 每人最多号码 = 20;

/** 一个号码种类：字典里现在的叫法 + 存库的 kind + 验法 */
export type 号码种类 = { 名: string; kind: string; 验?: 号码类型 };

/** 字典项（id、叫法）→ 号码种类。默认项 id 是 dict-contactKind-<序号>（dict.ts 默认id） */
export function 认号码种类(项: { id: string; name: string }): 号码种类 {
  const m = /^dict-contactKind-(\d+)$/.exec(项.id);
  const 内置 = m ? 内置号码种类[Number(m[1])] : undefined;
  return 内置 ? { 名: 项.name, kind: 内置.kind, 验: 内置.验 } : { 名: 项.name, kind: `${自定种类前缀}${项.name}` };
}

/**
 * 验一个号（联系人表单交上来的一行）。按种类：有 验 的走 验号码；其余去首尾空格、压空白，长度不超；
 * 座机 / WhatsApp 要有至少 5 位数字、只许数字和 + - ( ) 空格 #（分机）。键 = 查重 / 去重比的规整值
 */
export function 验一行号码(种: 号码种类, 原: unknown): { ok: true; 值: string; 键: string } | { ok: false; error: string } {
  const s = typeof 原 === "string" ? 原.trim().replace(/\s+/g, " ") : "";
  if (!s) return { ok: false, error: `${种.名}没填` };
  if (s.length > 号码上限) return { ok: false, error: `${种.名}最多 ${号码上限} 个字` };
  if (种.验) {
    const r = 验号码(种.验, s);
    return r.ok ? { ok: true, 值: r.值, 键: r.键 } : { ok: false, error: `${种.名}「${s}」：${r.提示}` };
  }
  if (种.kind === "landline" || 种.kind === "whatsapp") {
    const 数字 = s.replace(/\D/g, "");
    if (!/^[\d+\-()（）\s#]+$/.test(s.replace(/[０-９]/g, "0")) || 数字.length < 5 || 数字.length > 20) return { ok: false, error: `${种.名}「${s}」格式不对：只填数字（可以带 + - 和括号）` };
    return { ok: true, 值: s, 键: 数字 };
  }
  return { ok: true, 值: s, 键: s.toLowerCase().replace(/\s+/g, "") };
}

/** 号码们里第一个手机 / 邮箱 / 微信 → 联系人老三格（列表、查重、导出还读这三格，企业版照填上，老的版本读得懂） */
export function 老三格(号码们: readonly { kind: string; value: string }[]): { phone: string | null; email: string | null; wechat: string | null } {
  const 第一 = (k: string) => 号码们.find((x) => x.kind === k)?.value ?? null;
  return { phone: 第一("phone"), email: 第一("email"), wechat: 第一("wechat") };
}

// ---------- 客户页摆法 ----------

/**
 * 客户页留哪几块（待定 14，10-27 会议「项目页是跟进记录主入口」）。只有企业版项目模式改；别的照旧全摆。
 *   留（蓝）：客户详情、联系人、项目信息、关联客户（新卡）、AI 面板
 *   移到项目（黄）：记录输入、待办
 *   客户页不放（红）：转让（走整客户转让）、背调、下次跟进
 * 客户详情里划掉的旧字段（第 22、29、30 条：行业、职位、国家、WhatsApp、邮箱、微信、阿里 ID、旧客户等级、预计签约、客户属性）也一起不摆，库里照留
 */
export function 客户页摆法(企业项目模式: boolean) {
  const 老 = !企业项目模式;
  return {
    记录输入: 老,
    待办: 老,
    下次跟进: 老,
    转让: 老,
    背调: 老,
    旧字段: 老,
    关联客户: 企业项目模式,
    新字段: 企业项目模式,
    新建项目: 企业项目模式,
  } as const;
}

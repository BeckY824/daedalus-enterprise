import { 币种名 } from "./currency";
import { 全角转半角 } from "./fullwidth";

/**
 * 金额输入框（antd InputNumber）的 formatter。商机、签约、赢单顺手登记签约三处共用。
 * **敲的时候不加 ¥ 也不加千分位，失焦后再格式化**；¥ 放在框外（InputNumber 的 prefix）。
 *
 * 2026-09-28 审查 S6，本机复现过：原来的 formatter 边敲边加「¥ 」和逗号，parser 又把空串
 * 读成 0——全选删掉后框里剩「¥ 0」、光标停在最前，接着敲 18000 得到的是 180,000。
 * 不是眼花，是真存成了十八万。userTyping 时原样返回人敲的字，就没有东西会在光标底下挪动；
 * 不给自定义 parser，空串就是空（null），不会凭空冒出一个 0。
 */
export function 金额格式(v: number | string | undefined, info: { userTyping: boolean; input: string }): string {
  if (info.userTyping) return info.input;
  if (v === undefined || v === null || v === "") return "";
  // 只给整数部分加千分位：外币带小数（2026-10-03），整串套正则会把 1234.5678 写成「1,234.5,678」
  const [整, 小] = `${v}`.split(".");
  return 整.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (小 !== undefined ? `.${小}` : "");
}

/**
 * 金额：去掉货币符号、千分位、「元 / 元整 / 整」，「k / 千 / 万 / w / 亿」乘上去，全角数字也认。认不出返回 null。
 * 导入（enterprise-import/clean）、AI 卡上的金额框（AmountTextInput）、页面上的金额框（AmountInput）共用：
 * 负数、「约5万」「面议」「5万5」这类认不出，不悄悄去掉符号存成别的数。「12.」「.5」这种敲到一半的小数照认（不丢信息）
 */
export function 认金额(v: string): number | null {
  return 拆金额(v)?.值 ?? null;
}

/** 「$」也是港币、新加坡元、澳元、加元…自己的记号，「¥」也是日元的：选这几种时写这个记号不算对不上 */
const 美元记号币 = ["USD", "HKD", "SGD", "AUD", "CAD", "NZD", "TWD", "MXN"];
const 前记号: [RegExp, string[]][] = [
  [/^(US\$|USD)/i, ["USD"]],
  [/^\$/, 美元记号币],
  [/^(RMB|CNY)/i, ["CNY"]],
  [/^(¥|￥)/, ["CNY", "JPY"]],
];
const 后记号: [RegExp, string[] | null][] = [
  [/(元整|元|人民币|rmb|cny)$/i, ["CNY"]],
  [/usd$/i, ["USD"]],
  // 「整」不是币种
  [/整$/, null],
];

/**
 * 认金额 的底子：倍 ≠ 1 = 带了「万 / 千 / k / w」，框旁要说换算成了多少；
 * 币 = 字里写了的币种（¥ / 元 / RMB → CNY，$ / USD → USD），没写 = null；可为 = 这个记号也能算哪几种（「$」港币也用、「¥」日元也用）。
 * 前后都写了又对不上（「$5000元」）= 认不出，不挑一个。全角字母、数字、点、逗号都先转半角（「３ｗ」「１２．５万」）
 */
export function 拆金额(v: string): { 值: number; 倍: number; 币: string | null; 可为: string[] } | null {
  let s = 全角转半角(v.trim()).replace(/[,，\s]/g, "");
  let 可为: string[] | null = null;
  for (const [re, 码] of 前记号) {
    const m = re.exec(s);
    if (!m) continue;
    可为 = 码;
    s = s.slice(m[0].length);
    break;
  }
  for (const [re, 码] of 后记号) {
    const m = re.exec(s);
    if (!m) continue;
    s = s.slice(0, -m[0].length);
    if (码) {
      可为 = 可为 ? 可为.filter((c) => 码.includes(c)) : 码;
      if (!可为.length) return null;
    }
    break;
  }
  let 倍 = 1;
  const 单位 = /(k|千|万|w|亿)$/i.exec(s);
  if (单位) {
    倍 = { k: 1000, 千: 1000, 万: 10000, w: 10000, 亿: 100000000 }[单位[1].toLowerCase() as "k"] ?? 1;
    s = s.slice(0, -1);
  }
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s) * 倍;
  return Number.isFinite(n) && n >= 0 ? { 值: Math.round(n * 100) / 100, 倍, 币: 可为?.[0] ?? null, 可为: 可为 ?? [] } : null;
}

/** 金额字里写了哪种币（¥ / 元 / RMB / CNY → CNY；$ / US$ / USD → USD）；没写或认不出 = null。导入、AI 收卡共用 */
export function 金额字币种(v: string): string | null {
  return 拆金额(v)?.币 ?? null;
}

/**
 * 金额字里写的币种记号，不要求整串认得出（审查 11-20 第二轮）：导入时金额靠 AI 清洗 / 模拟清洗补认回来
 * （「约5000USD」「五千元」规则认不出），币种不能因此落成默认人民币。
 * 扫整串（数字以外的字都看，审查 11-20 第三轮）：括号、后缀里的记号也算（「5000美元（2024年）」「5000 USD/2年」
 * 「约3.6万元(5000美元)」），年份、期数、「含税13%」里的数字不碍事。
 * - 无：没写记号；
 * - 币：写了认得的记号（元 / 人民币 / RMB / CNY / ¥ → CNY，$ / US$ / USD / 美元 → USD；「$」「¥」另可为别的币，见 拆金额）；
 * - 矛盾：写了几个、对不上（「$5000元」「约3.6万元(5000美元)」），不挑一个；
 * - 不认得：写了别的币种记号，不猜——「HK$」「EUR」「€」「円」「Rs」「泰铢」，「中文 + 元 / 币」（「韩元」「港币」「澳币」），
 *   三位大写字母（「CHF」「KRW」）；和认得的记号一起出现也算不认得（「5000元（港币）」）。
 */
export type 金额记号 =
  | { 类: "无" }
  | { 类: "币"; 币: string; 可为: string[] }
  | { 类: "矛盾"; 记号: string[] }
  | { 类: "不认得"; 记号: string };
/** 不分大小写的拉丁字（正则里只给这几处，三位大写代码要分大小写） */
const 不分大小写 = (w: string) => w.replace(/[a-z]/gi, (c) => `[${c.toUpperCase()}${c.toLowerCase()}]`);
const 拉丁 = (re: string) => `(?<![A-Za-z])(?:${re})(?![A-Za-z])`;
const 记号扫 = new RegExp(
  [
    // 认得的（「美元」「人民币」放在泛的「中文 + 元 / 币」前面）
    `${不分大小写("US")}\\$`,
    拉丁(["usd", "rmb", "cny"].map(不分大小写).join("|")),
    "美元|美金|人民币|[¥￥$]",
    // 不认得的
    `[A-Za-z]{1,2}\\$`,
    拉丁(["eur", "gbp", "jpy", "hkd", "sgd", "aud", "cad", "nzd", "twd", "mxn", "krw", "chf", "inr", "thb", "rub", "myr", "aed"].map(不分大小写).join("|")),
    拉丁("[A-Z]{3}"),
    拉丁("Rs\\.?"),
    "[€£₩₹₽₫฿円]|英镑|泰铢|卢比|卢布|比索|法郎|林吉特|里拉|兰特|迪拉姆|里亚尔|雷亚尔|克朗|兹罗提|福林|越南盾",
    // 「韩元」「日元」「港币」「澳币」：中文 + 元 / 币；「万元」「千元」「亿元」「多元」不算
    "(?![万千亿百十佰仟拾多余整])\\p{Script=Han}[元币]",
    "元",
  ].join("|"),
  "gu",
);
const 认得记号 = (t: string): string[] | null => {
  const u = t.toUpperCase();
  if (u === "US$" || u === "USD" || t === "美元" || t === "美金") return ["USD"];
  if (u === "$") return 美元记号币;
  if (t === "元" || t === "人民币" || u === "RMB" || u === "CNY") return ["CNY"];
  if (t === "¥" || t === "￥") return ["CNY", "JPY"];
  return null;
};
export function 金额字记号(v: string): 金额记号 {
  const s = 全角转半角(v.trim());
  const 记号: string[] = [];
  let 可为: string[] | null = null;
  for (const m of s.matchAll(记号扫)) {
    const 码 = 认得记号(m[0]);
    if (!码) return { 类: "不认得", 记号: m[0] };
    记号.push(m[0]);
    可为 = 可为 ? 可为.filter((c) => 码.includes(c)) : 码;
  }
  if (!可为) return { 类: "无" };
  return 可为.length ? { 类: "币", 币: 可为[0], 可为 } : { 类: "矛盾", 记号 };
}

/** AI 收卡：模型交的金额字串里写了币种记号（¥ / 元 / $ / USD）就给出来，和 currency 对不上要拒，不悄悄按 currency 存（审查 11-20）。数字、没写记号 = null */
export function 金额字带币(v: unknown): { 币: string; 可为: string[] } | null {
  if (typeof v !== "string") return null;
  const r = 拆金额(v);
  return r?.币 ? { 币: r.币, 可为: r.可为 } : null;
}

/** 字里写的币种和选的不一样时说的那句（金额框、AI 卡共用） */
export const 币种对不上话 = (原文: string, 写的: string, 选的: string) =>
  `「${原文}」写的是${币种名(写的)}，币种选的是${币种名(选的)}：改币种，或去掉「${写的 === "USD" ? "$ / USD" : "¥ / 元"}」`;

/** 认不出时说的那句（金额框、AI 卡、测试共用） */
export const 金额认不出话 = (原文: string) => `认不出「${原文}」：只填不小于 0 的数字，可带千分位、¥、万 / 千 / k / w`;

/** 千分位，给「＝ 125,000」这种换算提示用 */
export const 千分位 = (n: number) => 金额格式(n, { userTyping: false, input: "" });

export type 金额原文 =
  | { 类: "空" }
  | { 类: "数"; 值: number; 币: string | null }
  /** 带了单位：框旁写「＝ 换算后」 */
  | { 类: "换算"; 值: number; 币: string | null }
  | { 类: "错"; 话: string };

/**
 * 金额框里敲的这串字算什么。上限：超了也算错（不悄悄压成上限）。
 * 币种 = 框旁选的币种：字里写了币种记号（「5000元」「USD 5000」）又和选的不一样，算错、说清楚（不悄悄按选的存）；没写记号的照常按选的
 */
export function 读金额原文(原文: string, 上限?: number, 币种?: string | null): 金额原文 {
  if (!原文.trim()) return { 类: "空" };
  const r = 拆金额(原文);
  if (!r) return { 类: "错", 话: 金额认不出话(原文.trim()) };
  if (币种 && r.币 && !r.可为.includes(币种)) return { 类: "错", 话: 币种对不上话(原文.trim(), r.币, 币种) };
  if (上限 !== undefined && r.值 > 上限) return { 类: "错", 话: `「${原文.trim()}」超过上限 ${千分位(上限)}` };
  return r.倍 === 1 ? { 类: "数", 值: r.值, 币: r.币 } : { 类: "换算", 值: r.值, 币: r.币 };
}

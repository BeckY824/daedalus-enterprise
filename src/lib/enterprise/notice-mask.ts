/**
 * 通知文字里的号码（2026-11-18，审核 通知与定时任务 P1-2）：P-转-12「提醒里不带手机号」、P-教练-21「飞书只推标题和去哪看，不带……手机号」。
 *
 * notify() 写库之前、feishu-push 发出之前都过一遍 通知文字打码：凡是像手机号、电话的数字串一律打码。
 * 这一层只是兜底——各处通知自己的文案照样不放号码（撞号、挂靠、同号录入改成打码或不写），别只靠它。
 * 客户名本身就是号码的（正式库里有好几万家）也靠这里打掉；拼标题时能拿到客户的，用 通知里的客户名 换成客户编号。
 *
 * 和 utils.ts 的 文字里号码打码（留痕用）不同：通知正文里常有「2026-11-18 08:00」「1250000.00 元」这类日期、时间、金额，
 * 那边会把日期连着时间、带小数的金额当号码打掉；这里按数字段的样子分开认，只打号码样的：
 *   - 连写的：大陆手机、0 开头的座机、400 / 800、+ 开头 8 位以上、或者 9 位以上（海外号常不带 +）
 *   - 带空格 / 横线 / 括号分段的：合计 7 位以上，且不是日期（头一段 4 位、后面每段不超过 2 位）
 *   - 挨着字母、小数点的不认（项目 id、客户编号 NO.00012、卡点编号 BLK-20261118-001、金额小数）
 *   - 下划线、点号分段的也认（11-22 录音点评 PR6：转写、文件名里常见 138_1234_5678、138.1234.5678）：
 *     先按上面的老规则打一遍（不看点号、下划线，原来能打的照打：「1. 13812345678」「2026.11.22 13812345678」），
 *     再单独认整串只用点号 / 下划线分段的：每段至少 3 位（开头的 86 / +86 国家码除外），合起来是大陆手机 / 座机 / 400 号，
 *     或 3 段以上、合计 10 位以上、第一段不是 4 位年份（11-23 收紧：年份开头的单号 2026.1122.0001、3-3-3 的编号 123.456.789 不打）；
 *     版本号（10.0.19045.3803）、日期（2026.11.22）、金额小数、IP 地址（4 段、每段 ≤3 位）都不认（PR6 二审）
 */
import { 全角数字转半角 } from "@/lib/fullwidth";
import { maskPhone } from "@/lib/utils";
import { 客户编号文字, 短号 } from "@/lib/customer-no";

const 连写号码 = /^(?:(?:\+?86)?1[3-9]\d{9}|0\d{9,11}|[48]00\d{7})$/;
// 前面挨着字母、数字、小数点、「字母-」（卡点编号 BLK-20261118-001 这类）的不认；后面挨着字母数字、小数的不认
const 候选 = /(?<![A-Za-z0-9.]|[A-Za-z]-)\+?\d[\d \-()（）]*\d(?![A-Za-z0-9]|\.\d)/g;
// 整串只用点号 / 下划线分段的数字（PR6）：前后不挨字母数字、点号、下划线
const 点号候选 = /(?<![A-Za-z0-9._]|[A-Za-z]-)\+?\d+(?:[._]\d+)+(?![A-Za-z0-9]|[._]\d)/g;

/**
 * 点号 / 下划线分段的像不像号码：每段 ≥3 位（开头国家码 86 除外）；合起来是连写号码（大陆手机 / 座机 / 400）就算；
 * 合起来不是连写号码的，要 3 段以上、合计 10 位以上（海外 3-3-4 这类），且第一段不是 4 位年份（19xx / 20xx）；IP 地址样子的不算。
 * 11-23 收紧：「订单 2026.1122.0001」（年份开头的单号）、「ID 123.456.789」（3-3-3 共 9 位的编号）原来被当号码打掉，现在不打
 */
function 像点号号码(串: string): boolean {
  let 段们 = 串.replace(/^\+/, "").split(/[._]/);
  if (段们.length > 2 && 段们[0] === "86") 段们 = 段们.slice(1);
  const 数字 = 段们.join("");
  if (数字.length < 7 || 数字.length > 16) return false;
  if (!段们.every((g) => g.length >= 3)) return false;
  if (段们.length === 4 && 段们.every((g) => g.length <= 3)) return false;
  if (连写号码.test(数字)) return true;
  return 段们.length >= 3 && 数字.length >= 10 && !/^(?:19|20)\d\d$/.test(段们[0]);
}

/**
 * 按两道认号码，认到的交给 换：先老规则（空格、横线、括号分段），再点号 / 下划线分段的。
 * 客户详情「历史变更」也用（customers/[id]/history-data.ts）：认到的串交给 号码脱敏器，电话设成「藏」的角色才打码
 */
export function 逐个号码(s: string, 换: (串: string) => string): string {
  return 全角数字转半角(s)
    .replace(候选, (m) => (像号码(m) ? 换(m) : m))
    .replace(点号候选, (m) => (像点号号码(m) ? 换(m) : m));
}

function 像号码(串: string): boolean {
  const 带加号 = 串.startsWith("+");
  const 段们 = 串.replace(/^\+/, "").split(/[ \-()（）]+/).filter(Boolean);
  const 数字 = 段们.join("");
  if (数字.length < 7 || 数字.length > 16) return false;
  if (段们.length === 1) return 连写号码.test(数字) || (带加号 && 数字.length >= 8) || 数字.length >= 9;
  // 分段的：日期（2026-11-18、2026-11-18 08）不是号码
  if (段们[0].length === 4 && 段们.slice(1).every((g) => g.length <= 2)) return false;
  // 每段都只有 1 位（「第 3 次 7 天」这种拼出来的）不算
  if (段们.every((g) => g.length === 1)) return false;
  return true;
}

/** 认到的号码串只留数字（大陆手机去掉 86 国家码） */
export const 号码数字 = (串: string): string => 串.replace(/\D/g, "").replace(/^86(?=1[3-9]\d{9}$)/, "");

function 打掉(串: string): string {
  return maskPhone(号码数字(串));
}

/**
 * 打码还原（11-22 录音点评 PR5 审查）：销售教练在确认框里看到的是打过码的草稿，存回去（稍后再发、发出）时库里要存原文。
 * 提交上来的字里，和原文打码后一模一样的那一串（139****5678）按原文换回原号码；同一个打码样子对应几个原号码的按出现顺序轮着用。
 * 教练自己改过、新写的号码照他写的存（对不上原文的不动）。原文们：原来的主题、要点、转写（教练可能从转写里抄）
 */
export function 打码还原(提交: string, 原文们: readonly (string | null | undefined)[]): string {
  if (!提交 || !提交.includes("*")) return 提交;
  const 表 = new Map<string, string[]>();
  for (const s of 原文们) {
    if (!s || !/\d|[０-９]/.test(s)) continue;
    逐个号码(s, (m) => {
      const k = 打掉(m);
      const 们 = 表.get(k) ?? [];
      if (!们.includes(m)) 们.push(m);
      表.set(k, 们);
      return m;
    });
  }
  if (!表.size) return 提交;
  const 键们 = [...表.keys()].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const 用过 = new Map<string, number>();
  return 提交.replace(new RegExp(键们.join("|"), "g"), (k) => {
    const 们 = 表.get(k)!;
    const i = 用过.get(k) ?? 0;
    用过.set(k, i + 1);
    return 们[i % 们.length];
  });
}

// 打码后的样子（maskPhone 出来的：11 位以上留头 3 尾 4，7–10 位留头 2 尾 2）
const 打码样子 = /(?<![\d*])(?:\d{3}\*{4}\d{4}|\d{2}\*{4}\d{2})(?![\d*])/g;

/** 存回去之前（录音点评跟进 11-22，3703 实操）：确认框开着时这条在别处重新整理过、原号码没了，打码段就换不回去——这时别把打码的样子存进库 */
export const 内容变了话 = "内容已在别处更新，请重新打开";

/**
 * 还原以后还剩打码段、原文里又找不到这个样子（原文本身就带星号的不算）：打码段对不上原号码，返回 true；调用方再看 版本变了，两样都是才拒存（412 + 内容变了话）。
 * 原文们同 打码还原：现在库里的主题、要点、转写
 */
/** 打开确认框时带上的 更新于 和库里的不一样（没带也算变了：老页面） */
export function 版本变了(版本: unknown, 库里: Date): boolean {
  return typeof 版本 !== "string" || 版本 !== 库里.toISOString();
}

export function 有对不上的码(还原后: unknown, 原文们: readonly (string | null | undefined)[]): boolean {
  if (typeof 还原后 !== "string" || !还原后.includes("*")) return false;
  const 码们 = 还原后.match(打码样子);
  if (!码们) return false;
  const 原 = 原文们.filter(Boolean).join("\n");
  return 码们.some((k) => !原.includes(k));
}

/** 标题、正文里像号码的数字串都打码；没有号码原样返回 */
export function 通知文字打码(s: string): string {
  if (!s || !/\d|[０-９]/.test(s)) return s;
  return 逐个号码(s, 打掉);
}

/** 整个名字就是一个号码（去掉空格、横线、括号、+ 以后只剩 7 位以上数字） */
export function 名字是号码(name: string | null | undefined): boolean {
  const t = 全角数字转半角((name ?? "").trim());
  return /^[\d\s\-+()（）]+$/.test(t) && 像号码(t);
}

/**
 * 通知里怎么称呼这位客户：名字就是号码的、全称简称都空着的换成客户编号（没编号用短号），名字里夹着号码的打码，其余原样。
 * 要有客户编号就 select customerNo（全称空着兜简称就 select shortName）；没传 id 又没编号时写「一位客户」
 */
export function 通知里的客户名(c: { name: string | null | undefined; shortName?: string | null; customerNo?: number | null; id?: string | null }): string {
  // 企业版客户名称选填（11-19）：全称空着兜简称 → 客户编号（短号），不写成空白
  const name = (c.name ?? "").trim() || (c.shortName ?? "").trim();
  if (!name || 名字是号码(name)) {
    const 编号 = 客户编号文字(c.customerNo) ?? (c.id ? 短号(c.id) : "");
    return 编号 ? `客户 ${编号}` : "一位客户";
  }
  return 通知文字打码(name);
}

/** 撞号台账的键写进通知：手机号打码，邮箱只留头一个字和域名，其余（微信、旺旺 ID、客户名）照文字打码 */
export function 撞的写法(keyType: string, keyValue: string): string {
  const v = (keyValue ?? "").trim();
  if (keyType === "手机号") return `手机号 ${打掉(v)}`;
  if (keyType === "邮箱") {
    const at = v.indexOf("@");
    return `邮箱 ${at > 0 ? `${v[0]}***${v.slice(at)}` : "***"}`;
  }
  if (keyType === "客户名" || keyType === "公司名") return `${keyType}「${名字是号码(v) ? "（号码）" : 通知文字打码(v)}」`;
  return `${keyType} ${通知文字打码(v)}`;
}

/**
 * 文件名里的号码打码（11-22 录音点评 PR2 审查；PR4 改成按数字段整段打）：安卓通话录音的文件名常把号码和日期拼在一起——
 * 「通话录音-13812345678-20261122.m4a」「通话录音 138 1234 5678 20261122093012.m4a」「+86 138-1234-5678_0922.m4a」。
 * 按 \+?数字[数字 空格 横线 括号]*数字 取一段（「+86 138 1234 5678 2026…」整个是一段），这一段合计 7 位以上数字就整段打码：
 * 只剩数字、「86 + 大陆手机」去掉 86，再 maskPhone（留头 3 尾 4）。号码和日期连在一段的，日期跟着一起打（文件名里不需要它们）；
 * 不到 7 位的段（0922、m4a 里的 4）原样。不再先过 通知文字打码：那边按「像不像号码」挑，分段写的号码连着日期会漏。
 * PR6：下划线、点号也算分段（通话录音_138_1234_5678.m4a、138.1234.5678.m4a）；单独一个日期（2026.11.22、2026_11_22）不打
 */
export function 文件名打码(name: string): string {
  if (!name || !/\d|[０-９]/.test(name)) return name;
  return 全角数字转半角(name).replace(/\+?\d[\d \-_.()（）]*\d/g, (段) => {
    if (/^\d{4}[-_.]\d{1,2}[-_.]\d{1,2}$/.test(段)) return 段;
    const 数字 = 段.replace(/\D/g, "");
    return 数字.length >= 7 ? maskPhone(数字.replace(/^86(?=1[3-9]\d{9}$)/, "")) : 段;
  });
}

/**
 * 打码还原以后变长了（带分隔的号码 139-1234-5678 打码成 139****5678，还原回来多出几个字）超过上限：回一句给人看的话；没超回 null（PR5 审查）。
 * 提交的本身就超的不在这里管（照原来的「最多 N 字」）
 */
export function 还原超长话(提交: unknown, 还原后: unknown, 上限: number, 名: string): string | null {
  if (typeof 提交 !== "string" || typeof 还原后 !== "string") return null;
  const 长 = 还原后.trim().length;
  return 提交.trim().length <= 上限 && 长 > 上限 ? `${名}里的号码换回原号码后有 ${长} 字，超过 ${上限} 字，请删几个字再发` : null;
}


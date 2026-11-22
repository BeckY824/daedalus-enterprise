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
 */
import { 全角数字转半角 } from "@/lib/fullwidth";
import { maskPhone } from "@/lib/utils";
import { 客户编号文字, 短号 } from "@/lib/customer-no";

const 连写号码 = /^(?:(?:\+?86)?1[3-9]\d{9}|0\d{9,11}|[48]00\d{7})$/;
// 前面挨着字母、数字、小数点、「字母-」（卡点编号 BLK-20261118-001 这类）的不认；后面挨着字母数字、小数的不认
const 候选 = /(?<![A-Za-z0-9.]|[A-Za-z]-)\+?\d[\d \-()（）]*\d(?![A-Za-z0-9]|\.\d)/g;

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

function 打掉(串: string): string {
  const 数字 = 串.replace(/\D/g, "").replace(/^86(?=1[3-9]\d{9}$)/, "");
  return maskPhone(数字);
}

/** 标题、正文里像号码的数字串都打码；没有号码原样返回 */
export function 通知文字打码(s: string): string {
  if (!s || !/\d|[０-９]/.test(s)) return s;
  return 全角数字转半角(s).replace(候选, (m) => (像号码(m) ? 打掉(m) : m));
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
 * 文件名里的号码打码（11-22 录音点评 PR2 审查）：安卓通话录音的文件名常把号码和日期拼在一起——
 * 「通话录音-13812345678-20261122.m4a」「通话录音 13812345678 20261122093012.m4a」「record-13812345678.m4a」，
 * 通知文字打码 认不出（号码和日期并成一段超过 16 位、或者号码前面是「字母-」），所以文件名单走这里：
 * 先过 通知文字打码（带空格 / 横线分段写的号码「138 1234 5678」它认得），再按非数字分段，连着 7 位以上的数字一律打掉
 * （日期、时刻一起打，文件名里不需要它们）。顺序不能反：先打长串再过 通知文字打码，打剩的尾巴和后面的日期会被它当成一个号码再打一遍
 */
export function 文件名打码(name: string): string {
  if (!name || !/\d|[０-９]/.test(name)) return name;
  return 通知文字打码(全角数字转半角(name)).replace(/\d{7,}/g, (m) => maskPhone(m));
}

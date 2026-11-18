/**
 * 新线索卡备注里认号码（10-27 起在 ai-lead-dedupe.ts，11-17 搬出来）：纯函数，浏览器和服务端都用——
 * 卡上「联系方式」必填（M-必填-01）要算上备注里认得出的邮箱 / 微信 / 阿里国际站ID，和落库时 dashboard/apply.ts 认的同一份
 */
import { 验号码, type 号码类型 } from "./contact-format";

export type 认出的号 = { 类型: 号码类型; 值: string; 键: string };

/** 行头去掉空格、小写以后查。「阿里国际站ID」是 10-29 的新叫法，旧的「旺旺 / 旺旺ID」、简称「阿里ID / 国际站ID」都认 */
const 行名: Record<string, 号码类型> = {
  邮箱: "邮箱", 微信: "微信",
  阿里国际站id: "旺旺ID", 阿里国际站: "旺旺ID", 阿里id: "旺旺ID", 国际站id: "旺旺ID", 旺旺: "旺旺ID", 旺旺id: "旺旺ID",
};
const 号码行 = /^\s*(邮箱|微信|阿里国际站\s*(?:id)?|阿里\s*id|国际站\s*id|旺旺\s*(?:id)?)\s*[：:]\s*(.+?)\s*$/i;
const 裸邮箱 = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

/**
 * 备注里认号码：「邮箱：x」「微信：x」「阿里国际站ID：x」（旧的「旺旺：x / 旺旺ID：x」也认）这样的行，验得过才认、整行拿掉；每种只认第一个，再有的留在备注。
 * 没有邮箱行时，正文里夹着的一个邮箱也认（只认不删，句子不拆）
 */
export function 认出备注里的号码(备注: string): { 号们: 认出的号[]; 剩: string } {
  const 号们: 认出的号[] = [];
  const 有 = (t: 号码类型) => 号们.some((h) => h.类型 === t);
  const 剩行 = 备注.split(/\r?\n/).filter((行) => {
    const m = 号码行.exec(行);
    if (!m) return true;
    const 类型 = 行名[m[1].replace(/\s+/g, "").toLowerCase()];
    if (有(类型)) return true;
    const r = 验号码(类型, m[2]);
    if (!r.ok) return true;
    号们.push({ 类型, 值: r.值, 键: r.键 });
    return false;
  });
  const 剩 = 剩行.join("\n").trim();
  if (!有("邮箱")) {
    const m = 裸邮箱.exec(剩);
    const r = m && 验号码("邮箱", m[0]);
    if (r && r.ok) 号们.push({ 类型: "邮箱", 值: r.值, 键: r.键 });
  }
  return { 号们, 剩 };
}

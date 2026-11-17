/**
 * 搜索词的纯文本处理（不碰库，浏览器、服务端都能用）：去空白、规整、拆词、认号码 / 网址，内存里比一个词。
 * 原来都在 search-keyword.ts（那边 import 了 prisma，统一公海的 筛排 在浏览器里也要用，23D 挪出来）；search-keyword.ts 原样再导出，老的 import 不用改。
 */
import { 全角数字转半角 } from "./fullwidth";
import { 看成客户编号 } from "./customer-no";

/** 去掉前后空白（含全角空格 U+3000，String.trim 本就认）。不是字符串的当没搜 */
export function 搜索词(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/* ---------------- 查询侧规整、拆词（员工反馈第 2 批 2F，11-17） ----------------
  原来整串当一段「连续包含」比：全角空格、两个空格、词序、全角半角括号、全角字母都要和库里一模一样才中（员工反馈「按名字没找到」）。
  只动查询这一侧，库里的写法、三字索引都不动（库侧归一是第 3 批 3H）：
    - 规整：各种空白（含全角空格 U+3000）归成一个半角空格；全角字母、数字转半角（字母比的时候全角半角都认，见 包含模式 的 认全角字母）；
    - 拆词：按空格和常见的括号、逗号、顿号、分号拆开，每个词都要中（可以中在不同的列），每个词照旧走三字索引 / GLOB 那两条路；
      拆开后的结果包含原来整串能中的（整串在哪一列，拆出来的每个词就都在那一列），所以只会多中；
      唯一少中的：库里存的是全角数字、人也照样敲全角数字（输入转了半角，数字不像字母那样两种都认——数字要走三字索引），留给库侧归一；
    - 整串像号码（「138 0000」）、像客户编号（「NO. 112」）、像网址的不拆，原样当一个词。
*/

/** 拆词的分隔：空白，以及全角 / 半角的圆括号、方头括号、逗号、顿号、分号（「某某(集团)」也能中「某某（集团）」） */
const 分隔 = /[\s()（）【】,，、;；]+/u;
/** 一次最多比几个词：多出来的不比（只会多出结果），SQL 不至于拼得太长 */
export const 最多几个词 = 6;

/** 查询侧规整：去头尾、空白归一成一个半角空格、全角字母数字转半角。不是字符串的当没搜 */
export function 规整搜索词(v: unknown): string {
  return 搜索词(v).replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\s+/gu, " ");
}

/** 全角字母转半角（只动字母：同 包含模式 的 认全角字母，数字照旧原样比） */
const 全角字母转半角 = (s: string) => s.replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/**
 * 在内存里比一个词（公海的项目行、项目名，23D）：文本里的全角字母转半角、都小写后看包含不包含。
 * 词是 拆搜索词 给的（已规整），大小写不用管；文本空的不中。比法同库里 包含模式(词, true)：字母全角半角、大小写都认，数字原样
 */
export function 含词(文本: string | null | undefined, 词: string): boolean {
  return !!文本 && 全角字母转半角(文本).toLowerCase().includes(词.toLowerCase());
}

/**
 * 交给 Prisma contains（LIKE，只认 ASCII 大小写）比的几种写法（项目列表，23D）：词本身，再加字母（和数字）换成全角的写法，
 * 库里存的是全角字母、人也照样敲全角的照旧能中（规整把输入转成了半角）。词里没有 ASCII 字母数字的只有它自己
 */
export function 全半角写法(词: string): string[] {
  if (!/[A-Za-z0-9]/.test(词)) return [词];
  const 全 = (re: RegExp) => 词.replace(re, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
  return [...new Set([词, 全(/[A-Za-z]/g), 全(/[A-Za-z0-9]/g)])];
}

/**
 * 关键词拆成要都中的几个词（已规整）。没搜返回空数组。
 * 被别的词包含的词去掉（「华东 华东测试」只比「华东测试」，结果一样）
 */
export function 拆搜索词(v: unknown): string[] {
  const k = 规整搜索词(v);
  if (!k) return [];
  if (号码片段(k) || 看成客户编号(k) !== null || 网址域名(k)) return [k];
  const 词们 = [...new Set(k.split(分隔).filter(Boolean))];
  if (!词们.length) return [k];
  const 小 = 词们.map((w) => w.toLowerCase());
  return 词们.filter((w, i) => !小.some((o, j) => j !== i && o.includes(小[i]) && (o !== 小[i] || j < i))).slice(0, 最多几个词);
}

/**
 * 关键词像一段号码（只有数字、空格、横杠、括号、+，至少 3 位数字）时，给出拿去搜电话列的纯数字；不像返回 null。
 * 全角数字也认。库里电话是规整后的纯数字，所以只能拿纯数字去比
 */
export function 号码片段(k: string): string | null {
  const 半角 = 全角数字转半角(k).replace(/＋/g, "+");
  if (!/^[\d\s\-+()（）－]+$/.test(半角)) return null;
  // 明写了国家码的（「+86 138」「0086-138」「(+86)138」，11-11）：前面的 +86 / 0086 去掉再比，搜号码的一段也认
  const 去码 = 半角.trim().replace(/^[(（]?\s*(?:\+|00)\s*86\s*[)）]?[\s\-－]*/, "");
  const 数字 = 去码.replace(/\D/g, "");
  // 完整大陆手机号去国家码，与保存规则相同；短片段和海外号不猜。
  const 规范 = 数字.replace(/^0*86(?=1[3-9]\d{9}$)/, "");
  return 规范.length >= 3 ? 规范 : null;
}

/**
 * 关键词像一个网址时，拿去比官网那一格的域名（2026-10-17 PR26 手测）。
 * 从「官网 ↗」打开、再从地址栏复制回来的是 https://www.acme.com/，或带着 /contact 这样的路径；
 * 库里存的是人填的 www.acme.com，原样包含匹配对不上。去掉协议、www.、端口、路径和末尾斜杠，小写。
 * 不像网址的（没有点、带空格、邮箱的 @）返回 null，官网那一格照原样比
 */
export function 网址域名(k: string): string | null {
  const m = /^(?:https?:\/\/)?(?:www\.)?([^\s/?#:@]+\.[^\s/?#:@.]{2,})(?::\d+)?(?:[/?#]\S*)?$/i.exec(k.trim());
  return m ? m[1].toLowerCase() : null;
}

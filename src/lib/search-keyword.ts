/**
 * 列表页搜索框的关键词怎么用（2026-10-04 J-008）。
 *
 * 原来关键词原样丢给 Prisma 的 contains，三处对不上人的直觉：
 * 1. 不 trim：从微信里复制来的「张三 」带个空格，一个都搜不到，人以为客户不在，转头再建一份——造出重复档案；
 * 2. 号码带空格：人照名片念着敲「138 0000」，库里存的是规整过的「13800001111」（lib/phone.ts），对不上；
 * 3. SQLite 的 LIKE 里 % 和 _ 是通配符，Prisma 不转义：搜「100%」把「100分客户」也搜出来，搜「a_b」连「axb」也算。
 */
import { 企业版 } from "./enterprise/switch";
import { 号键SQL } from "./phone-dedupe";
import { prisma } from "./prisma";
import type { Prisma } from "@/generated/prisma";
import { 看成客户编号 } from "./customer-no";
import { 搜索词, 拆搜索词, 号码片段, 网址域名 } from "./search-terms";

// 纯文本那几样挪到了 search-terms.ts（23D：统一公海的 筛排 在浏览器里也要拆词），这里原样再导出，老的 import 不用改
export { 搜索词, 规整搜索词, 拆搜索词, 最多几个词, 号码片段, 网址域名, 含词, 全半角写法 } from "./search-terms";

// SQLite GLOB 按Unicode码点匹配，但不折叠大小写。字符组补齐单码点大小写等价类；
// 不把ß改成SS等多字符展开，不改变原文，也不要求旧库重新写入搜索索引。
let 大小写组: Map<string, Set<string>> | undefined;
function 大小写等价组() {
  if (大小写组) return 大小写组;
  const groups = new Map<string, Set<string>>();
  const connect = (a: string, b: string) => {
    if (a === b || [...b].length !== 1) return;
    const left = groups.get(a) ?? new Set([a]);
    const right = groups.get(b) ?? new Set([b]);
    for (const c of right) left.add(c);
    for (const c of left) groups.set(c, left);
  };
  for (let n = 0; n <= 0x10ffff; n++) {
    const c = String.fromCodePoint(n);
    connect(c, c.toLowerCase()); connect(c, c.toUpperCase());
  }
  大小写组 = groups;
  return groups;
}

/** ASCII 字母 → 它的全角写法（ａ-ｚ、Ａ-Ｚ） */
const 全角了 = (c: string) => String.fromCharCode(c.charCodeAt(0) + 0xfee0);

/**
 * 认全角字母 = 字母那一组再带上全角写法（客户搜索 2F：输入已转半角，库里的「ＡＢＣ」也要中）。
 * 只动字母：字母本来就有大小写组、从不走三字索引，多几个字不改走哪条路；数字、标点照旧原样比（数字要走三字索引）
 */
export function 包含模式(k: string, 认全角字母 = false): string {
  const groups = 大小写等价组();
  return "*" + [...k].map(c => {
    const variants = groups.get(c);
    if (variants && 认全角字母 && /^[A-Za-z]$/.test(c)) return `[${[...variants].join("")}${[...variants].filter((v) => /^[A-Za-z]$/.test(v)).map(全角了).join("")}]`;
    if (variants) return `[${[...variants].join("")}]`;
    return c === "[" ? "[[]" : c === "]" ? "[]]" : c === "*" ? "[*]" : c === "?" ? "[?]" : c;
  }).join("") + "*";
}

/* ---------------- 三字索引（迁移 141，2026-11-14） ----------------
  8.6 万客户的库，原来每次搜索都对客户表、扩展资料表整表 GLOB '*词*'（号码搜索单句 60+ ms，名字 35 ms，是 SQL 耗时第 1 名）。
  迁移 141 建了两张 FTS5 trigram 表（区分大小写），各列原样存一份，外加号键：CustomerSearch（客户本表那几列）、CustomerExtraSearch（扩展资料那几列）。
  trigram 的短语查询 "abc…" = 同一列里连续出现这一串，和 GLOB '*abc…*' 是同一个意思，但走索引。只在结果一定一样时才换过去：
    - 词（以及拿去比电话、官网的那一串）每串至少 3 个字：trigram 比不了 1、2 个字（两个字的中文名照旧整表 GLOB）；
    - 每个字都没有大小写变体（汉字、数字、标点这类）：GLOB 那边是按 包含模式 的大小写等价类比的，区分大小写的索引替不了；
    - 字符串是合法的 Unicode（没有落单的代理项）。
  其余照旧走 GLOB。联系人、联系人号码子表两句不在索引里，原样不动。索引表不在（没跑迁移的库）也照旧走 GLOB
*/

/* ---------------- 简称、客户编号（11-17 客户抬头 PR-0） ----------------
  简称（Customer.shortName）原来不在任何搜索里：三字索引（141）建表时没带这一列，FTS5 表也加不了列。
  不另建一张 FTS 表（那要再登记一条迁移例外、再挂一组触发器、每次启动回填），改用迁移 145 的部分索引：只收有简称的行。
  简称几乎都空（正式库 11-17：8.6 万位里 0 位有值），按这条索引逐个 GLOB 只扫有简称的那几位，两个字的简称也一样走它；
  比法和名字那几列一样（包含模式：包含即中、单个字符大小写等价、通配符转义）。全称就是 name，原来就在搜。
  客户编号（NO. + 5 位，迁移 146 的 customerNo）：关键词像编号时按唯一索引精确比（客户编号SQL），不进三字索引。
*/

/** 只比简称、按迁移 145 的部分索引扫（rowid 子查询只读索引；索引没建上的老库照样对，只是退回整表扫） */
const 简称SQL = () => `c.rowid IN (SELECT x.rowid FROM "Customer" x WHERE x."shortName" IS NOT NULL AND x."shortName" GLOB ?)`;

/** 客户编号精确比的那一段（客户表别名 c，走 Customer_customerNo_key 唯一索引）；关键词不像编号返回 null（不比） */
export function 客户编号SQL(k: string): { sql: string; values: string[] } | null {
  const n = 看成客户编号(k);
  return n === null ? null : { sql: `c."customerNo" = CAST(? AS INTEGER)`, values: [String(n)] };
}

/** 两张索引表都在。在了就记住（表只加不删）；不在每次再看一眼，迁移跑完不用重启就用上。托管版各库不同，不记 */
let 三字索引在过 = false;
/** 用例用：强制走 / 不走三字索引（undefined = 按库里有没有） */
let 三字索引强制: boolean | undefined;
export function 设三字索引(v: boolean | undefined) { 三字索引强制 = v; }

async function 三字索引可用(): Promise<boolean> {
  if (三字索引强制 !== undefined) return 三字索引强制;
  if (三字索引在过) return true;
  const rows = await prisma.$queryRawUnsafe<{ n: number | bigint }[]>(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('CustomerSearch', 'CustomerExtraSearch')`,
  );
  const 在 = Number(rows[0]?.n ?? 0) === 2;
  if (在 && process.env.MULTI_TENANT !== "1") 三字索引在过 = true;
  return 在;
}

/** 这一串能交给三字索引：≥3 个字、没有一个字有大小写变体、合法 Unicode */
export function 三字可比(s: string): boolean {
  const 字 = [...s];
  if (字.length < 3 || !s.isWellFormed()) return false;
  const groups = 大小写等价组();
  return 字.every((c) => !groups.has(c));
}

/** 别的字小写后会变出来的字（「İ」小写是 i + U+0307 这类）。名键必含字 排掉它们 */
let 小写产物: Set<string> | undefined;
function 小写变出来的字() {
  if (小写产物) return 小写产物;
  const s = new Set<string>();
  for (let n = 0; n <= 0x10ffff; n++) {
    const c = String.fromCodePoint(n);
    const l = c.toLowerCase();
    if (l !== c) for (const x of l) s.add(x);
  }
  小写产物 = s;
  return s;
}

/**
 * 客户名查重（名键 = 全角转半角 → 去空白 → 小写，enterprise-import/clean.ts）的必要条件：名键里这些字，原名里一定原样有。
 * 只挑「稳定」的字：不是 ASCII（全角转半角只变出 ASCII）、不是空白、没有大小写变体、也不是别的字小写后变出来的——汉字基本都是。
 * 名键等于 k 的原名，每个这种字都只能来自原名里的它自己，所以拿 instr 在库里先筛，不漏人。最多给 3 个；一个都没有返回空数组（调用方别筛）
 */
export function 名键必含字(k: string): string[] {
  const groups = 大小写等价组(), 产物 = 小写变出来的字();
  const 出: string[] = [];
  for (const c of k) {
    if (出.length >= 3) break;
    if (c.codePointAt(0)! < 0x80 || /\s/.test(c) || !c.isWellFormed() || groups.has(c) || 产物.has(c) || 出.includes(c)) continue;
    出.push(c);
  }
  return 出;
}

/** FTS5 短语：整串加双引号，里面的双引号写两个 */
const 短语 = (s: string) => `"${s.replace(/"/g, '""')}"`;
/** {列 列 …} : "串"，几段 OR 起来 */
const 匹配式 = (段: [readonly string[], string][]) => 段.map(([列, s]) => `{${列.join(" ")}} : ${短语(s)}`).join(" OR ");

/**
 * 客户名在三字索引里比的条件（公海搜索用；词已是调用方规整过的，比法同 包含模式(词) 的 GLOB）。用不上返回 null，调用方照旧 GLOB
 */
export async function 客户名索引式(词: string): Promise<string | null> {
  if (!三字可比(词) || !(await 三字索引可用())) return null;
  return 匹配式([[["name"], 词]]);
}

/**
 * 企业版字段权限把电话设成「藏」的人，搜索也不按号码匹配（2026-10-26 Y27）。
 * 列表上号码打了码，可拿完整号码、前 7 位、后 4 位一搜还是能把人搜出来——等于从搜索框试出号码。
 * 客户 / 联系人 / 线索的电话、外贸档案的 WhatsApp 都算「电话」。姓名、邮箱等照常能搜。
 * 开关关着不读库，个人版、团队版（含共享区）照旧按号码搜。
 * userId 不给 = 当前登录的人；不走 cookie 的入口（AI 助手经 MCP 调）必须传
 */
export async function 号码藏着(userId?: string): Promise<boolean> {
  if (!企业版()) return false;
  const { 字段权限of } = await import("./enterprise/field-perm");
  return (await 字段权限of(userId))("电话") === "藏";
}

/** 小in组成一个OR，整条查询保留一次全局orderBy/skip/take。 */
export function 客户id集合(ids: readonly string[]): Prisma.CustomerWhereInput {
  const chunks: Prisma.CustomerWhereInput[] = [];
  for (let i=0;i<ids.length;i+=500) chunks.push({id:{in:ids.slice(i,i+500)}});
  return chunks.length ? {OR:chunks} : {id:{in:[]}};
}

/**
 * 客户电话按号键比（像号码的关键词、手机号筛选）。不写成 号键SQL(c.phone) GLOB ?：外层按 deletedAt 一行行扫时，每行都要现算 20 层 replace
 * （8.5 万客户号码搜索 337 ms 里占 ~100 ms，11-14）；写成按 rowid 的子查询，子查询只读号键表达式索引（迁移 021 Customer_phoneKey_idx）里存好的值，
 * 对上的才回表。同一张表同一行，rowid 对 rowid，结果一样；索引没建上（没跑迁移的库）退回现算，也照样对
 */
const 客户号键SQL = () => `c.rowid IN (SELECT x.rowid FROM "Customer" x WHERE ${号键SQL('x."phone"')} GLOB ?)`;

/**
 * 联系人电话按号键比：同 客户号键SQL，按 rowid 的子查询只读号键表达式索引（迁移 142 Contact_phoneKey_idx）里存好的值，
 * 不在联系人表上一行行现算 20 层 replace（5.5 千联系人约 5 ms → 0.3 ms，11-14）。用在 t = Contact 的子查询里；索引没建上照样对
 */
const 联系人号键SQL = () => `t.rowid IN (SELECT x.rowid FROM "Contact" x WHERE ${号键SQL('x."phone"')} GLOB ?)`;

/**
 * 联系人号码子表里能按号码搜的那几类（11-11）：手机号、WhatsApp。只算挂在联系人身上、联系人没删进回收站的（客户页上看得到的那些；
 * 客户本身挂在子表上、contactId 空的号页面上不显示，同退回公海查联系方式 return-contact-check.ts，不算）。值按号键比
 */
export const 子表可搜号类 = ["phone", "whatsapp"] as const;
// 用时再拼（号键SQL 在别的用例里会被 mock 掉，模块加载时就调会让整个导入失败）。
// 式子是 号键SQL("m.value")：迁移 137 给 ContactMethod 建了同一个式子的表达式索引（ContactMethod_kind_valueKey_idx，带 customerId、contactId），
// 7.4 万行不再每行现算 20 层 replace（137 ms → 5 ms，11-14）。不换成 numberKey：那是查重的键，规则和号键不一样（WhatsApp 的键小写了等），换过去搜出来的会变
const 联系人子表号SQL = () => `c.id IN (SELECT m."customerId" FROM "ContactMethod" m JOIN "Contact" mt ON mt.id = m."contactId" WHERE mt."deletedAt" IS NULL AND m.kind IN (${子表可搜号类.map((k) => `'${k}'`).join(", ")}) AND ${号键SQL("m.value")} GLOB ?)`;

/**
 * 「手机号」筛选（11-11 客户列表、项目列表的更多筛选）：只比号码，和搜索框里像号码的那一半同一套——
 * 输入先去空格、横杠、括号、明写的 +86 / 0086（号码片段），库里那一侧按号键比；包含就算（输后几位、中间一段都行），至少 3 位数字。
 * 比哪些：客户电话、外贸档案 WhatsApp、没删的联系人的电话、联系人号码子表里的手机号 / WhatsApp（联系人没删的）。
 * 电话「藏」着的人（字段权限，Y27，同 号码藏着）不按号码比：返回 null，调用方当没筛（页面上也不摆这一项）；
 * 不像号码的（带字母、不到 3 位数字）返回一个谁都不中的条件。只给客户 id，行照旧经限定层取，可见范围不放宽
 */
export async function 客户号码SQL(raw: unknown, userId?: string): Promise<{ sql: string; values: string[] } | null> {
  const k = 搜索词(raw);
  if (!k || (await 号码藏着(userId))) return null;
  const phone = 号码片段(k);
  if (!phone) return { sql: "(0)", values: [] };
  const p = 包含模式(phone);
  // 号码片段是 ≥3 位的纯数字，三字索引一定比得了（迁移 141）；客户电话、WhatsApp 两句换成索引里的号键列，联系人两句照旧
  if (三字可比(phone) && (await 三字索引可用())) {
    const m = 匹配式([[["phoneKey"], phone]]);
    return {
      sql: `(c.id IN (SELECT s.cid FROM "CustomerSearch" s WHERE "CustomerSearch" MATCH ?) OR c.id IN (SELECT s.cid FROM "CustomerExtraSearch" s WHERE "CustomerExtraSearch" MATCH ?) OR c.id IN (SELECT t."customerId" FROM "Contact" t WHERE t."deletedAt" IS NULL AND ${联系人号键SQL()}) OR ${联系人子表号SQL()})`,
      values: [m, m, p, p],
    };
  }
  return {
    sql: `(${客户号键SQL()} OR c.id IN (SELECT e."customerId" FROM "CustomerExtra" e WHERE ${号键SQL("e.whatsapp")} GLOB ?) OR c.id IN (SELECT t."customerId" FROM "Contact" t WHERE t."deletedAt" IS NULL AND ${联系人号键SQL()}) OR ${联系人子表号SQL()})`,
    values: [p, p, p, p],
  };
}

/** 客户号码SQL 换成客户 id 条件（客户列表、导出用）；null = 不筛 */
export async function 客户号码条件(raw: unknown, userId?: string): Promise<Prisma.CustomerWhereInput | null> {
  const w = await 客户号码SQL(raw, userId);
  if (!w) return null;
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT c.id FROM "Customer" c WHERE ${w.sql}`, ...w.values);
  return 客户id集合(rows.map((r) => r.id));
}

/**
 * 关键词拼成一段 WHERE（客户表别名 c），只有内置列名进 SQL，值全部参数绑定；没关键词返回 null。
 * 客户关键词条件和列表页的 关键词分页（customers/query.ts）共用这一份，号码藏着（Y27）、Unicode 大小写规则都在这里。
 * 走索引 = 这一段全是能按索引取的 c.id IN (…) / c.rowid IN (…)（三字索引、简称的部分索引；PR-1 起还有编号唯一索引）：调用方另带的 deletedAt IS NULL 要写成 +c."deletedAt"，不然 SQLite 顺 deletedAt 索引扫 8.6 万位、逐位查名单，
 * 写成 + 才会从名单出发逐个按主键取（MULTI-INDEX OR，名字 11 → 1 ms）
 * 关键词先规整、拆词（拆搜索词，2F）：每个词各拼一段、AND 起来；一个词时和原来同一段 SQL。
 */
export async function 客户关键词SQL(raw: unknown, onlyPicker = false, userId?: string, 另比?: 另比一词): Promise<关键词段 | null> {
  const 词们 = 拆搜索词(raw);
  if (!词们.length) return null;
  const 藏号 = await 号码藏着(userId);
  const 段们: 关键词段[] = [];
  for (const k of 词们) {
    const w = await 一个词SQL(k, onlyPicker, 藏号);
    const 另 = 另比 ? await 另比(k) : null;
    // 另比的那一段也是 c.id IN (…)，接在 OR 里不改走不走索引
    段们.push(另 ? { sql: `(${w.sql} OR ${另.sql})`, values: [...w.values, ...另.values], ...(w.走索引 ? { 走索引: true as const } : {}) } : w);
  }
  if (段们.length === 1) return 段们[0];
  // 每个词都要中。都走索引才算走索引（调用方据此写 +deletedAt）
  return { sql: `(${段们.map((s) => s.sql).join(" AND ")})`, values: 段们.flatMap((s) => s.values), ...(段们.every((s) => s.走索引) ? { 走索引: true as const } : {}) };
}

/** 关键词拼出来的一段 WHERE（客户表别名 c）和它的绑定值；走索引 见 客户关键词SQL */
export type 关键词段 = { sql: string; values: string[]; 走索引?: true };
/**
 * 每个词另外再比的一段（客户列表比项目名，lib/project/customer-list-projects.ts 项目名另比）：给一段 c.id IN (…)，这个词在客户本身那几列没中、这段中了也算；null = 不另比
 */
export type 另比一词 = (词: string) => Promise<{ sql: string; values: string[] } | null>;

/** 一个已规整、不再拆的词 */
async function 一个词SQL(k: string, onlyPicker: boolean, 藏号: boolean): Promise<关键词段> {
  const phone = 号码片段(k);
  const 站 = 网址域名(k) ?? k;
  const pattern = 包含模式(k, true), phonePattern = 包含模式(phone ?? k), sitePattern = 包含模式(站, true);
  // 三字索引里的列；简称不在索引里，两条路各自另比（简称SQL / 本行那一格），选客户弹窗、全局搜索（onlyPicker）也比
  const fields = onlyPicker ? ["name", "school"] : ["name", "school", "major", "grade", "remark"];
  const 编号 = 客户编号SQL(k);
  // 三字索引（迁移 141）：用到的每一串都比得了才换，客户本表、扩展资料两句换成索引，联系人两句照旧；逐列和下面的 GLOB 一一对应
  if (三字可比(k) && 三字可比(phone ?? k) && (onlyPicker || 三字可比(站)) && (await 三字索引可用())) {
    const 本表: [readonly string[], string][] = [[fields, k]];
    if (!藏号) {
      本表.push([["phone"], phone ?? k]);
      if (phone) 本表.push([["phoneKey"], phone]);
    }
    const parts = [`c.id IN (SELECT s.cid FROM "CustomerSearch" s WHERE "CustomerSearch" MATCH ?)`, 简称SQL()];
    const values = [匹配式(本表), pattern];
    if (编号) { parts.push(编号.sql); values.push(...编号.values); }
    if (!onlyPicker) {
      const 扩展: [readonly string[], string][] = [[["email", "wechat", "country", "alibabaId"], k], [["website"], 站]];
      if (!藏号) {
        扩展.push([["whatsapp"], k], [["whatsapp"], phone ?? k]);
        if (phone) 扩展.push([["phoneKey"], phone]);
      }
      parts.push(`c.id IN (SELECT s.cid FROM "CustomerExtraSearch" s WHERE "CustomerExtraSearch" MATCH ?)`);
      values.push(匹配式(扩展));
      const 号键比 = !藏号 && phone;
      const 号值 = 藏号 ? [] : [pattern, phonePattern];
      parts.push(`c.id IN (SELECT t."customerId" FROM "Contact" t WHERE t."deletedAt" IS NULL AND (t.name GLOB ? OR ${藏号 ? "" : "t.phone GLOB ? OR t.phone GLOB ? OR "}${号键比 ? `${联系人号键SQL()} OR ` : ""}t.email GLOB ? OR t.wechat GLOB ?))`);
      values.push(pattern, ...号值, ...(号键比 ? [phonePattern] : []), pattern, pattern);
      if (号键比) { parts.push(联系人子表号SQL()); values.push(phonePattern); }
    }
    return { sql: `(${parts.join(" OR ")})`, values, 走索引: true };
  }
  // 简称在 GLOB 这条路上直接比本行那一格：反正整表在扫，多比一格几乎不花时间（简称多半是空的）
  const parts = [...fields, "shortName"].map(c => `c."${c}" GLOB ?`);
  const values = parts.map(() => pattern);
  if (编号) { parts.push(编号.sql); values.push(...编号.values); }
  if (!藏号) {
    parts.push('c."phone" GLOB ?'); values.push(phonePattern);
    if (phone) { parts.push(客户号键SQL()); values.push(phonePattern); }
  }
  if (!onlyPicker) {
    // 电话藏着时 WhatsApp、联系人电话两列不进条件（Y27）
    const 号值 = 藏号 ? [] : [pattern, phonePattern];
    // 像号码的（11-11）：WhatsApp、联系人电话也按号键（去空格、横杠、括号、+）比，库里带格式存的老号照样搜得到
    const 号键比 = !藏号 && phone;
    // 两张子表（原来还有订单号，订单表 2026-10-29 删了）用不相关的 IN 子查询：SQLite 各扫一遍、记成一张表，每个客户只查表。
    // 原来写 EXISTS（按 customerId 相关），没被本表列命中的每个客户都要回子表各查一次；
    // 10 万客户一次搜索 ~50 ms → ~26 ms，带扩展资料/联系人的库 ~140 → ~60 ms。customerId 两张表都非空，结果和 EXISTS 一样（2026-10-26）
    parts.push(`c.id IN (SELECT e."customerId" FROM "CustomerExtra" e WHERE ${藏号 ? "" : "e.whatsapp GLOB ? OR e.whatsapp GLOB ? OR "}${号键比 ? `${号键SQL("e.whatsapp")} GLOB ? OR ` : ""}e.email GLOB ? OR e.wechat GLOB ? OR e.country GLOB ? OR e.website GLOB ? OR e."alibabaId" GLOB ?)`);
    values.push(...号值,...(号键比 ? [phonePattern] : []),pattern,pattern,pattern,sitePattern,pattern);
    // 回收站里的联系人（企业版软删，P9）不算命中；不是企业版 deletedAt 一直是空
    parts.push(`c.id IN (SELECT t."customerId" FROM "Contact" t WHERE t."deletedAt" IS NULL AND (t.name GLOB ? OR ${藏号 ? "" : "t.phone GLOB ? OR t.phone GLOB ? OR "}${号键比 ? `${联系人号键SQL()} OR ` : ""}t.email GLOB ? OR t.wechat GLOB ?))`);
    values.push(pattern,...号值,...(号键比 ? [phonePattern] : []),pattern,pattern);
    // 联系人号码子表（企业版，ContactMethod）里的手机号、WhatsApp（11-11）：老 Contact.phone 只存了一个号，多出来的号只在子表里
    if (号键比) { parts.push(联系人子表号SQL()); values.push(phonePattern); }
  }
  return { sql: `(${parts.join(" OR ")})`, values };
}

/** 仅内置列名参与SQL；值全部参数绑定。最终模型查询继续经过租户/业务员限定。 */
export async function 客户关键词条件(raw: unknown, onlyPicker = false, userId?: string, 另比?: 另比一词): Promise<Prisma.CustomerWhereInput> {
  const w = await 客户关键词SQL(raw, onlyPicker, userId, 另比);
  if (!w) return {};
  const rows = await prisma.$queryRawUnsafe<{id:string}[]>(`SELECT c.id FROM "Customer" c WHERE ${w.sql}`, ...w.values);
  // 避免Prisma把一个超长in拆成多条各自skip的查询，导致后页静默变空。
  return 客户id集合(rows.map(r=>r.id));
}

/** 线索与客户共用号码片段/Unicode字面规则；裸查询仅取ID，最终列表仍走权限限定。 */
export async function 线索关键词条件(raw: unknown, userId?: string): Promise<Prisma.LeadWhereInput> {
  const k = 搜索词(raw);
  if (!k) return {};
  const 藏号 = await 号码藏着(userId);
  const phone = 号码片段(k);
  const pattern = 包含模式(k);
  const parts = ["name", "contact", "email", "industry", "remark"].map(c => `l."${c}" GLOB ?`);
  const values = parts.map(() => pattern);
  if (!藏号) {
    parts.push('l."phone" GLOB ?'); values.push(包含模式(phone ?? k));
    if (phone) { parts.push(`${号键SQL('l."phone"')} GLOB ?`); values.push(包含模式(phone)); }
  }
  const rows = await prisma.$queryRawUnsafe<{id:string}[]>(`SELECT l.id FROM "Lead" l WHERE ${parts.join(" OR ")}`, ...values);
  const chunks: Prisma.LeadWhereInput[] = [];
  for (let i=0;i<rows.length;i+=500) chunks.push({id:{in:rows.slice(i,i+500).map(r=>r.id)}});
  return chunks.length ? {OR:chunks} : {id:{in:[]}};
}

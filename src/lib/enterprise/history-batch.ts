/**
 * 客户「历史变更」里的系统批量修正怎么认、怎么折（11-24，customers/[id]/history-data.ts 用）。纯函数、不碰库，有用例（tests/ent-history-batch.test.ts）。
 *
 * 为什么要折：数据迁移、导入后修正脚本往 AuditLog（entity=Customer、action=update）写了 10 万多条（正式库副本 11-24 盘点），
 * 一位客户身上常有好几条「按原表补…」「[批次] …」，不折会把人工改动淹掉。
 *
 * 先判人工（审查后补）：明细是数组、每一项都带「字段」键的（界面上人改资料写的 [{字段, 原值, 新值}]）一律算人工改动，下面几条都不看。
 * 正式库副本里批量修正的明细是数组的 0 条（审查核过），显示名里带全角括号的员工改资料不会再被认成批量。
 *
 * 认的规矩（任一条成立就算系统批量修正；本机正式库副本 work.db 只读看过这几类长什么样）：
 *   1. 操作人是「系统」（userId = system）：后台批量统一省市写法、补退回次数这类
 *   2. 操作人名字带中文括号「（」、且和这个账号现在的名字不一样：脚本把说明写进 userName，如「管理员（48：…渠道收尾）」
 *      「管理员（渠道负责人回填：…）」；员工显示名本身带括号的（「张三（市场）」这类），userName 就是他的名字，不算。
 *      调用方查得到账号现名就传 本名（建档入口、客户块都传）；没传 = 只按括号认
 *   3. 说明以「[」开头：修正脚本统一的批次头，如「[M21① 清公海挂负责人 NO.42193] …」「[E-220 客户状态补写 批试点 NO.85326] …」
 *   4. 说明以「按原表补」开头：导入后按原表补客户资料
 *   5. 明细是 JSON 对象（不是数组）且带「脚本 / 批次 / 批次Id / 数据ID / 依据」任一个键：销帮帮全量导入后的那几轮修正
 *      （「客户 X 创建人记为 Y（按销帮帮原表…）」「修改客户「X」：备注加 2 行…」）
 * 界面上人改资料写的明细一律是数组 [{字段, 原值, 新值}]（customers/actions.ts describeCustomerChanges），关联客户 / 挂联系人写的对象
 * 不带这几个键，都不会被认成批量。管理员账号本人在界面上改的（userName 就是「管理员」、明细是数组）照算人工改动。
 *
 * 怎么折：同一个北京日、同一批（批次 = 明细里的 批次 / 批次Id / 脚本，其次 userName 的括号说明、说明里 [] 那一段去掉编号，
 * 再其次「按原表补」「系统」）折成一行「系统批量修正 N 处」，点开看明细
 */
import { beijingDay } from "@/lib/business-clock";

export type 审计原行 = { id: string; at: Date; userId: string; userName: string; summary: string; detail: string | null };

const 脚本键 = ["批次", "批次Id", "脚本", "数据ID", "依据"] as const;

function 明细对象(detail: string | null): Record<string, unknown> | null {
  if (!detail || detail[0] !== "{") return null;
  try {
    const v: unknown = JSON.parse(detail);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const 字 = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

/** [批次头 NO.123] 里去掉编号那段：同一批不同客户的头一样，才折得到一起 */
function 批次头(summary: string): string | null {
  if (!summary.startsWith("[")) return null;
  const 尾 = summary.indexOf("]");
  const 头 = (尾 > 0 ? summary.slice(1, 尾) : summary.slice(1)).replace(/\s*NO\.\d+.*$/, "").trim();
  return 头 || "批次";
}

/** 明细是不是界面上人改资料写的那种：非空数组、每一项都是带「字段」键的对象 */
function 是字段改动(detail: string | null): boolean {
  if (!detail || detail.trimStart()[0] !== "[") return false;
  try {
    const v: unknown = JSON.parse(detail);
    return Array.isArray(v) && v.length > 0 && v.every((x) => !!x && typeof x === "object" && !Array.isArray(x) && "字段" in x);
  } catch {
    return false;
  }
}

/**
 * 这一条是不是系统批量修正：是 → 回它属于哪一批（同一天同一批的折一起）；不是（人在界面上改的）→ null。
 * 本名 = 这条 userId 那个账号现在的名字（查不到 / 没查 = 不传）：userName 和它一样就不按括号认批量
 */
export function 批量批次(r: Pick<审计原行, "userId" | "userName" | "summary" | "detail">, 本名?: string | null): string | null {
  if (是字段改动(r.detail)) return null;
  const o = 明细对象(r.detail);
  const 明细批 = o ? 字(o.批次) ?? 字(o.批次Id) ?? 字(o.脚本) : null;
  const 有脚本键 = !!o && 脚本键.some((k) => k in o);
  if (r.userId === "system") return 明细批 ?? "系统";
  if (r.userName.includes("（") && r.userName !== 本名) return 明细批 ?? r.userName;
  const 头 = 批次头(r.summary);
  if (头) return 明细批 ?? 头;
  if (r.summary.startsWith("按原表补")) return 明细批 ?? "按原表补";
  if (有脚本键) return 明细批 ?? (o && 字(o.依据)) ?? "导入后修正";
  return null;
}

/** 折叠行上那句说明：第一条的说明去掉 [批次头]，客户自己的名字不重复 */
export function 批量说明(summary: string): string {
  const s = summary.startsWith("[") && summary.includes("]") ? summary.slice(summary.indexOf("]") + 1).trim() : summary.trim();
  return s || summary;
}

export type 可折<T> = { 种: "单"; 行: T } | { 种: "批"; 键: string; 行们: T[] };

/**
 * 按时间倒序排好的一串（客户块一页），把连着的、同一天同一批的系统批量修正折成一组。
 * 认不出批次的（人工改动、负责人、状态…）原样一条一组。批次 = 取批次(行)，null = 不折
 */
export function 折批量<T extends { at: Date | string }>(行们: readonly T[], 取批次: (r: T) => string | null): 可折<T>[] {
  const 出: 可折<T>[] = [];
  for (const r of 行们) {
    const 批 = 取批次(r);
    if (批 === null) { 出.push({ 种: "单", 行: r }); continue; }
    const 键 = `${beijingDay(new Date(r.at))}|${批}`;
    // 同一天同一批：前面已经开了这一组就并进去（中间夹了人工改动也并，这一天的这批只出一行）
    const 已有 = 出.find((x): x is Extract<可折<T>, { 种: "批" }> => x.种 === "批" && x.键 === 键);
    if (已有) 已有.行们.push(r);
    else 出.push({ 种: "批", 键, 行们: [r] });
  }
  return 出;
}

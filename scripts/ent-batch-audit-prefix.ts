/**
 * 企业版正式库批量写入脚本共用：操作日志（AuditLog）正文前缀 + detail 四个键（E-218 / E-220 两个数据脚本用；打包时一起打进 cjs，服务器上不用另传）。
 * 来由：客户 E-244 要求每次批量写都带批次号和真实操作人（审计用）。我方答复：从下一次批量写起，
 *   AuditLog.summary 开头写成「[批次 <批次号> · 执行：Becky（服务商）· 依据 E-xxx]」，
 *   detail JSON 带「批次」「执行」「依据」「对应行」四个键；userId / userName 是 --操作人 指定的账号（必填，不再默认第一个系统管理员）；
 *   ProjectNodeLog 这类没有正文的表不动，靠批次号对到 AuditLog（detail「对应行」记下那一行的表和 id）。
 * 和客户目录草稿里的 共用-日志前缀.cjs 逐字同一套（前缀写法、依据格式、加键顺序、核本批口径）。
 * 用法（脚本里）：
 *   核参数(argv, ["--dry-run", "--write"], ["--basis", "--操作人", "--log"]);  // 最先调：不认识的参数直接退出（exit 2）
 *   const 依据号 = 取依据(argv);              // --basis E-218 或 E-220/E-223，必填，没传 / 格式不对就退出（exit 2）
 *   const 操作人id = 取操作人(argv);          // --操作人 <userId>，必填，没传就退出（exit 2）
 *   summary = 加前缀(批次, 依据号, 原summary)
 *   detail  = JSON.stringify(加键({ ...原detail }, 批次, 依据号, { 表: 行id }))
 *   事务里写完回读：核本批(db, 批次, 依据号, 起点) → 本批（detail.批次 = 批次）日志里前缀 / 三个键不对的条数，不是 0 就抛错回滚
 */
import type { DatabaseSync } from "node:sqlite";

export const 执行 = "Becky（服务商）";
/**
 * E-编号：E-232，可多个，用 / 、 , ， 隔开（统一成「/」）。第一个必须是 E-编号（原件编号），后面可以跟口径编号 X-（如 --basis E-132/X-147：
 * 依据是 E-132 那份答复、主题是 X-147），单写 X- 不行
 */
const 依据式 = /^E-\d{3,}(?:\s*[/、,，]\s*[EX]-\d{3,})*$/;

export function 取依据(argv: readonly string[]): string {
  const i = argv.indexOf("--basis");
  const v = i >= 0 ? argv[i + 1] : undefined;
  if (v == null || v.startsWith("--") || !依据式.test(v.trim())) {
    console.error(`缺 --basis 或格式不对（${v == null ? "没传" : `「${v}」`}）：要写成 --basis E-232、--basis E-232/E-233 或 --basis E-132/X-147（客户 E-244：每条操作日志带依据编号），不传不跑`);
    process.exit(2);
  }
  return v.trim().split(/\s*[/、,，]\s*/).join("/");
}

/** --操作人 必填：AuditLog 的 userId / userName 记谁，跑的人自己指定（不再默认第一个启用的系统管理员——那是客户的管理员账号） */
export function 取操作人(argv: readonly string[]): string {
  const i = argv.indexOf("--操作人");
  const v = i >= 0 ? argv[i + 1] : undefined;
  if (v == null || v.startsWith("--") || !v.trim()) {
    console.error(`缺 --操作人（${v == null ? "没传" : `「${v}」`}）：要写成 --操作人 <userId>（操作日志记在这个账号名下），不传不跑`);
    process.exit(2);
  }
  return v.trim();
}

/**
 * 参数逐个核（3704 实操 r64 第 6 条：e218 带 --undo 不报错、被当成空跑）：认的只有 开关、带值（后面跟一个值）和一个库路径；
 * 别的（拼错的、脚本没有的模式、多出来的路径、带值的缺值、同一个参数给两遍）一律报错、退出码 2，库都不打开、什么都不写。
 * 要在脚本最前面、读任何参数之前调
 */
export function 核参数(argv: readonly string[], 开关: readonly string[], 带值: readonly string[]): void {
  const 错 = (m: string): never => { console.error(`${m}，不跑（什么都没写）`); process.exit(2); };
  const 见过 = new Set<string>();
  let 路径数 = 0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("-")) {
      if (!开关.includes(a) && !带值.includes(a)) 错(`不认识的参数「${a}」（这个脚本只认：${[...开关, ...带值.map((k) => `${k} <值>`)].join(" ")}）`);
      if (见过.has(a)) 错(`参数「${a}」给了两遍`);
      见过.add(a);
      if (带值.includes(a)) {
        const v = argv[i + 1];
        if (v == null || v.startsWith("--")) 错(`参数「${a}」后面缺值`);
        i += 1;
      }
      continue;
    }
    if (++路径数 > 1) 错(`多出来的参数「${a}」（只要一个库路径）`);
  }
}

export function 前缀(批次: string, 依据: string): string {
  if (!批次 || !依据) throw new Error("日志前缀缺批次或依据");
  return `[批次 ${批次} · 执行：${执行}· 依据 ${依据}]`;
}

export const 加前缀 = (批次: string, 依据: string, summary: string) => `${前缀(批次, 依据)} ${summary}`;

/** detail 里加「批次」「执行」「依据」（依据 = E-编号；原来那句依据原话挪到「依据原话」），对应行 = { 表: 行id } */
export function 加键(detail: Record<string, unknown>, 批次: string, 依据: string, 对应行?: Record<string, string>): Record<string, unknown> {
  const { 依据: 原话, 批次: _旧批次, 执行: _旧执行, ...余 } = detail;
  return { 批次, 执行, 依据, ...(原话 != null && 原话 !== 依据 ? { 依据原话: 原话 } : {}), ...余, ...(对应行 ? { 对应行 } : {}) };
}

/**
 * 本批日志逐条核：正文以前缀开头、detail 三个键齐。返回本批条数和不对的条数（应为 0）。
 * 起点：只看 at >= 起点 的日志（大库省时；脚本传本次写入开始的时刻）
 */
export function 核本批(db: DatabaseSync, 批次: string, 依据: string, 起点 = 0): { 条数: number; 错: number } {
  const p = 前缀(批次, 依据);
  const 行们 = db.prepare("SELECT summary, detail FROM AuditLog WHERE at >= ? AND json_valid(detail) AND json_extract(detail, '$.批次') = ?").all(起点, 批次) as { summary: unknown; detail: unknown }[];
  let 错 = 0;
  for (const r of 行们) {
    const d = JSON.parse(String(r.detail)) as Record<string, unknown>;
    if (!String(r.summary ?? "").startsWith(p) || d.执行 !== 执行 || d.依据 !== 依据 || d.批次 !== 批次) 错 += 1;
  }
  return { 条数: 行们.length, 错 };
}

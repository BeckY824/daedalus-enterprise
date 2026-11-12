/**
 * 企业版「切换视图」（M-权限-08，10-31）：总管理员挑一个人，界面按这个人的权限渲染——看他看得到的客户、项目、首页数，
 * 菜单、按钮也按他的角色画。用来核权限、帮业务员看「他那边长什么样」。仿 demo-switch.ts，但这是正式部署能用的：
 *
 *   - 只有业务角色总管理（director）、管理员（admin）能切（11-01 晚定，账号 ADMIN 不再放行）。拦在 server action 里，不只藏入口
 *   - **切换期间整个服务端只读**：加上限定（lib/team-scope.ts）里所有写（create / update / upsert / delete…）和写库的裸 SQL 一律拒，
 *     抛 视图只读错误（code 同 只读错误，不在了() 原样回这句话）。不靠界面藏按钮：哪个按钮点了都改不了库
 *   - 状态放在一张单独的签名票（crm_view_as，2 小时）里，会话票（crm_session）不动：退出 = 删这张票，原身份原样回来。
 *     票里只有 va（看谁）、vb（谁在看），**不带 sub**——两张票同一把钥匙签，这张塞进 crm_session 也认不成任何人
 *   - 票只认签它的那个会话：vb 必须等于 crm_session 的 sub，vs 必须等于 crm_session 的 ims（首次签发时刻，顺延不变）。
 *     换人登录、退出再登录（同一个人也是新会话、新 ims）、退出登录（destroySession 一起删）都作废
 *   - 开始、退出各记一条操作留痕（action = view-as / view-as-exit）；切换中试图写库被拦下的，记在真身名下（action = view-as-blocked，
 *     写明在看谁、拦的是哪张表的哪种写），走放行通道；一个请求最多一条，同一真身 / 被看的人 / 同一种写一分钟内只记一条（防刷）
 *   - 切换中真身被降级（不再是系统管理员）、被看的人被停用：getCurrentUser 不再认这张票（读按真身自己），
 *     但写照样拦——拦写只看票（签名、会话），不查库，直到票过期（2 小时）或点「退出」。这是有意的：宁可多拦，不会多放
 *   - **带着视图票、但票验不过**（过期、上线前签的没绑会话的旧票、退出重登后的旧标签页）：读按真身，可这次请求的写一律拒，
 *     回「视角已失效，请刷新页面」——没刷新的页面顶上还挂着只读横幅，不能让人以为在看别人、实际以本人身份写进去。
 *     清票在能改 cookie 的地方：proxy 遇到带坏票的页面请求（GET / HEAD）把票删掉、这次渲染也当没票（横幅消失），
 *     /api 非 GET 带坏票 403（view-as-gate.ts）；开始 / 退出视图本身照常（退出顺手删票）。删票之后的下一次请求就是普通真身请求
 *
 * 写库之外（11-02）：不经过库的副作用——调外部接口（飞书推送和同步、AI 模型）、往磁盘写附件、把数据带走（导出、下载附件）——
 * 限定那一层看不到，各入口开头调 视图外部拦 / 视图外部拒 / 视图拒绝响应（本文件）统一拒，话术在 view-as-words.ts；
 * llm.ts、jev/client.ts、enterprise-import/net.ts、feishu-push.ts 这几个出口再兜一道，后来新加的入口忘了拦也发不出去。
 * 界面上的按钮按 components/ViewAsContext.tsx 禁用。附件在页面里看图、播录音不拦：预览本来就要看，真身也有权限。
 * 页面渲染时顺手写库的（首页、客户页每天扫一次掉公海 / 超时收回）在切换期间直接跳过，见 pool-db.ts、project/db.ts。
 *
 * 开关（11-12 第二轮用户定：默认开）：企业版下没设环境变量就有这个功能，客户服务器上现有的切换视图照旧；只有 CRM_ENT_VIEW_AS=0 才关。
 * 关着时入口不画、开始视图拒、带着的票（哪怕签名对）一律不认、写不拦——和没有这个功能完全一样，也不读 cookie。
 * 被看的人不能是系统管理员（11-12 用户定：保持）。
 * 被看的人的 AI 对话不给看（11-12 用户定）：历史列表、内容都在取数处（dashboard/threads.ts）回空，入口写一句「视角查看时不显示对方的 AI 对话」；
 * 通知、个人设置照常可见。
 *
 * 本模块不在顶层 import next/headers：lib/team-scope.ts（每条写都过）和测试都要用它，同 visibility.ts 是谁()。
 */
import { cache } from "react";
import { SignJWT, jwtVerify } from "jose";
import { readSecret } from "@/lib/secret";
import { 全进程上下文 } from "@/lib/process-als";
import { 企业版 } from "./switch";
import { 视图外部话, 视图只读话, 视图失效话 } from "./view-as-words";
import { 是系统管理员of, type 组织 } from "./org-core";

/** 视图票的 cookie 名 */
export const 视图票 = "crm_view_as";
/** lib/auth.ts 的 COOKIE */
const 会话票 = "crm_session";
/** 视图票有效时长：核完就退，忘了退两小时后自己失效 */
export const 视图小时 = 2;

export type 视图 = { 由: string; 谁: string };

/** 这个部署开没开切换视图：企业版、而且没有 CRM_ENT_VIEW_AS=0（默认开）。关着时下面所有判断都当没有票 */
export function 切换视图开着(): boolean {
  return 企业版() && process.env.CRM_ENT_VIEW_AS !== "0";
}

/** 切换期间所有写被拒时那一句（code 同 lib/team-scope.ts 只读错误，not-there.ts 不在了() 原样回给界面） */
export class 视图只读错误 extends Error {
  code = "CRM_READONLY";
  constructor(message = 视图只读话) {
    super(message);
  }
}

/**
 * 能不能切换视图：只给系统管理员（V3.5.1，11-03）= 业务角色总管理（director），没设业务线或带系统管理员标记（P-判定-06，同 permissions.ts 是系统管理员）。
 * 条线总管理、管理员只读、账号 ADMIN 都不行。菜单（view-as-menu.ts）、action（view-as-actions.ts）、认票（auth.ts）同这一处
 */
export function 能切换视图(org: 组织, userId: string): boolean {
  return 是系统管理员of(org, userId);
}

/** 能不能被看：不能是系统管理员（管理员之间互看待定，先不给）。名单、开始视图、认票同这一处 */
export function 能被看(org: 组织, userId: string): boolean {
  return !是系统管理员of(org, userId);
}

const 钥 = () => new TextEncoder().encode(readSecret());

/** 会话票上的 ims 归一：没有（老票、测试票）当 0 */
export function 会话时刻(ims: unknown): number {
  return typeof ims === "number" ? ims : 0;
}

/** 签一张视图票：由 = 真身（会话票的 sub），谁 = 要看的那个人，会话ims = 会话票的 ims（绑在这一次登录上） */
export async function 签视图票(由: string, 谁: string, 会话ims?: unknown): Promise<string> {
  return new SignJWT({ typ: "view-as", va: 谁, vb: 由, vs: 会话时刻(会话ims) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${视图小时}h`)
    .sign(钥());
}

export type 会话身份 = { sub: string; ims: number };

/** 验视图票：签名、没过期、类型对、而且是这个会话（sub + ims）签的。不对回 null */
export async function 验视图票(票: string | undefined | null, 会话: 会话身份 | null | undefined): Promise<视图 | null> {
  if (!切换视图开着() || !票 || !会话?.sub) return null;
  try {
    const { payload } = await jwtVerify(票, 钥());
    if (payload.typ !== "view-as" || typeof payload.va !== "string" || typeof payload.vb !== "string") return null;
    if (payload.vb !== 会话.sub || payload.va === payload.vb) return null;
    if (payload.vs !== 会话.ims) return null;
    return { 由: payload.vb, 谁: payload.va };
  } catch {
    return null;
  }
}

/** 会话票的 sub + ims（不查库：这里只回答「这张视图票是不是这个会话签的」，人停没停用由 getCurrentUser 管） */
export async function 读会话身份(票: string | undefined | null): Promise<会话身份 | null> {
  if (!票) return null;
  try {
    const { payload } = await jwtVerify(票, 钥());
    return typeof payload.sub === "string" ? { sub: payload.sub, ims: 会话时刻(payload.ims) } : null;
  } catch {
    return null;
  }
}

let 头: Promise<typeof import("next/headers")> | undefined;

/**
 * 这个请求的视图票：有效回 {由, 谁}；带着票但验不过回 "坏"；没带、开关关着、不在请求里（后台、脚本）回 null。
 * 开关关着连 cookie 都不读
 */
async function 票情况(): Promise<视图 | "坏" | null> {
  if (!切换视图开着()) return null;
  let 视: string | undefined;
  let 会话: string | undefined;
  try {
    const { cookies } = await (头 ??= import("next/headers"));
    const s = await cookies();
    视 = s.get(视图票)?.value;
    if (!视) return null;
    会话 = s.get(会话票)?.value;
  } catch (e) {
    // Next 静态渲染时的「这页要动态」信号带 digest，得原样抛回去
    if (e && typeof e === "object" && "digest" in e) throw e;
    return null;
  }
  return (await 验视图票(视, await 读会话身份(会话))) ?? "坏";
}

/** 这个请求带着有效的视图票：回 {由, 谁}；没有、无效、不在请求里（后台、脚本）回 null */
export async function 当前视图(): Promise<视图 | null> {
  const s = await 票情况();
  return s === "坏" ? null : s;
}

/** 这个请求带着视图票、但验不过（见文件头）：写要拒、提示刷新 */
export async function 视图票失效(): Promise<boolean> {
  return (await 票情况()) === "坏";
}

const 放行 = 全进程上下文<true>("视图放行");

/** 只给开始 / 退出那两条留痕用：这一段里的写不拦（别处一律不许用） */
export function 视图放行<T>(fn: () => Promise<T>): Promise<T> {
  return 放行.run(true, async () => await fn());
}

/**
 * 一个请求一份：React cache 只在页面渲染（服务端组件）里按请求分；server action、/api 路由里每次调都新给一份，
 * 实际靠下面的一分钟去重兜（同一真身 / 被看的人 / 同一种写一分钟一条）
 */
const 本请求留痕 = cache((): { 记了: boolean } => ({ 记了: false }));
/** 真身|被看的人|哪种写 → 上次记的时刻 */
const 最近留痕 = new Map<string, number>();
const 留痕间隔 = 60_000;
const 在记的 = new Set<Promise<void>>();

/**
 * 拦下一笔写，记一条留痕在真身名下（走放行通道）。不等它写完：拦下的写可能在一个事务里，
 * SQLite 只有一把写锁，同步等会和外面那个事务互相等。测试用 等拦下留痕() 等它落库
 */
function 记拦下(v: 视图, 动作: string): void {
  const 本 = 本请求留痕();
  if (本.记了) return;
  const 键 = `${v.由}|${v.谁}|${动作}`;
  const 现在 = Date.now();
  const 上次 = 最近留痕.get(键);
  if (上次 !== undefined && 现在 - 上次 < 留痕间隔) return;
  本.记了 = true;
  最近留痕.set(键, 现在);
  if (最近留痕.size > 500) for (const [k, t] of 最近留痕) if (现在 - t >= 留痕间隔) 最近留痕.delete(k);
  const p = 视图放行(async () => {
    const [{ prisma }, { recordAudit }] = await Promise.all([import("@/lib/prisma"), import("@/lib/audit")]);
    const 人 = await prisma.user.findMany({ where: { id: { in: [v.由, v.谁] } }, select: { id: true, name: true } });
    const 名 = (id: string) => 人.find((u) => u.id === id)?.name ?? "（已删除）";
    await recordAudit({
      user: { id: v.由, name: 名(v.由) },
      action: "view-as-blocked",
      entity: "User",
      entityId: v.谁,
      summary: `以「${名(v.谁)}」的视图查看时试图改数据，已拦下（${动作}）`,
      detail: { 动作 },
    });
  })
    .catch((e) => console.error("记切换视图拦下留痕失败：", e))
    .finally(() => 在记的.delete(p));
  在记的.add(p);
}

/** 测试用：等拦下的留痕都落库 */
export async function 等拦下留痕(): Promise<void> {
  await Promise.all([...在记的]);
}

/** 测试用：忘掉节流记录 */
export function 忘掉拦下留痕(): void {
  最近留痕.clear();
}

/**
 * 每条写之前过一下（lib/team-scope.ts 加上限定）：切换视图期间一律拒；带着验不过的视图票也拒（提示刷新，不记留痕）。
 * 动作 = 哪张表的哪种写（留痕用），如 Customer.update
 */
export async function 视图写拦(动作 = "写库"): Promise<void> {
  if (放行.getStore()) return;
  const v = await 票情况();
  if (!v) return;
  if (v === "坏") throw new 视图只读错误(视图失效话);
  记拦下(v, 动作);
  throw new 视图只读错误();
}

/** 只读预览期间（带着验不过的票也算），页面渲染时顺手做的每天一扫（掉公海、超时收回）跳过：回 true = 跳过 */
export async function 视图中跳过(): Promise<boolean> {
  return !放行.getStore() && !!(await 票情况());
}

/** 外部副作用被拒时那一句：在切换回 视图外部话，票失效回 视图失效话，都不是回 null */
async function 外部拒的话(): Promise<string | null> {
  if (放行.getStore()) return null;
  const v = await 票情况();
  return v === "坏" ? 视图失效话 : v ? 视图外部话 : null;
}

/**
 * 这个请求是不是在切换视图（带着验不过的票也算：这次请求照样不许改，见文件头）：不经过库的动作（导出、上传、发飞书、调 AI）都问它。
 * 不是企业版的部署直接 false，连 cookie 都不读；不在请求里（定时同步、脚本）读不到票，也是 false
 */
export async function 正在切换视图(): Promise<boolean> {
  return 切换视图开着() && (await 视图中跳过());
}

/** 切换视图（或票失效）就抛（code 同只读错误）：会抛错的 action、底层出口用 */
export async function 视图外部拦(): Promise<void> {
  const 话 = await 外部拒的话();
  if (话) throw new 视图只读错误(话);
}

/** 切换视图（或票失效）就回一个 {ok:false,error}，否则 null：回结果的 action 用，`const 拒 = await 视图外部拒(); if (拒) return 拒;` */
export async function 视图外部拒(): Promise<{ ok: false; error: string } | null> {
  const 话 = await 外部拒的话();
  return 话 ? { ok: false, error: 话 } : null;
}

/** 切换视图（或票失效）就回 403（{error}），否则 null：route.ts 用 */
export async function 视图拒绝响应(): Promise<Response | null> {
  const 话 = await 外部拒的话();
  return 话 ? Response.json({ error: 话 }, { status: 403 }) : null;
}

/** 裸 SQL 扩展钩子拿到的参数里取 SQL 原文：字符串、[字符串, ...参数]、Prisma.sql 模板（带 strings / sql）。认不出回 null */
export function 原文SQL(args: unknown): string | null {
  const a = Array.isArray(args) && typeof args[0] === "string" ? args[0] : args;
  if (typeof a === "string") return a;
  if (!a || typeof a !== "object") return null;
  const o = a as { sql?: unknown; strings?: unknown };
  if (typeof o.sql === "string") return o.sql;
  const strings = o.strings ?? a;
  if (Array.isArray(strings) && strings.every((x) => typeof x === "string")) return strings.join("?");
  return null;
}

/** 查表结构 / 做检查的只读 PRAGMA：带不带括号参数都只是读（PRAGMA table_info("Customer")） */
const 只读查询PRAGMA = new Set([
  "table_info", "table_xinfo", "table_list", "index_list", "index_info", "index_xinfo", "foreign_key_list", "foreign_key_check",
  "quick_check", "integrity_check", "database_list", "collation_list", "function_list", "module_list", "pragma_list", "compile_options",
]);
/** 读设置值的 PRAGMA：只有光秃秃的「PRAGMA journal_mode」是读，带 = 或括号（PRAGMA user_version(5)）就是在改 */
const 只读设置PRAGMA = new Set([
  "journal_mode", "user_version", "application_id", "schema_version", "busy_timeout", "synchronous", "foreign_keys", "defer_foreign_keys",
  "secure_delete", "page_size", "page_count", "freelist_count", "max_page_count", "cache_size", "auto_vacuum", "encoding",
  "data_version", "locking_mode", "temp_store", "mmap_size", "recursive_triggers", "query_only", "wal_autocheckpoint",
]);

/** 一条里的每个 PRAGMA 都在白名单里、用的是只读写法才算读；不在白名单的（wal_checkpoint、optimize…）一律当写 */
function 有写的PRAGMA(s: string): boolean {
  for (const m of s.matchAll(/\bpragma\s+(?:"?[^\s."=(;]+"?\s*\.\s*)?"?([^\s."=(;]+)"?\s*(=|\()?/gi)) {
    const 名 = m[1].toLowerCase();
    const 带 = m[2];
    if (带 === "=") return true;
    if (只读查询PRAGMA.has(名)) continue;
    if (只读设置PRAGMA.has(名) && !带) continue;
    return true;
  }
  return false;
}

/**
 * 裸 SQL 会不会写库（加上限定拦 $executeRaw* 一律拒；$queryRaw* 看原文）。认不出原文的当会写（宁可拒）
 */
export function 会写库的SQL(sql: string | null): boolean {
  if (sql === null) return true;
  const s = sql.replace(/\s+/g, " ");
  // replace( 是读用的字符串函数（号键SQL 里大量用），只有 REPLACE INTO 才写；INSERT OR REPLACE 已被 insert 拦
  return (
    /\b(insert|update|delete|create|drop|alter|attach|detach|vacuum|reindex)\b/i.test(s) ||
    /\breplace\s+into\b/i.test(s) ||
    有写的PRAGMA(s)
  );
}

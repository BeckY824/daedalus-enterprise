/**
 * 企业版「切换视图」（M-权限-08，10-31）：总管理员挑一个人，界面按这个人的权限渲染——看他看得到的客户、项目、首页数，
 * 菜单、按钮也按他的角色画。用来核权限、帮业务员看「他那边长什么样」。仿 demo-switch.ts，但这是正式部署能用的：
 *
 *   - 只有总管理员能切：账号 ADMIN，或组织里的总管理员（同 visibility.ts 组织范围of 看全部的那两种）。拦在 server action 里，不只藏入口
 *   - **切换期间整个服务端只读**：加上限定（lib/team-scope.ts）里所有写（create / update / upsert / delete…）和写库的裸 SQL 一律拒，
 *     抛 视图只读错误（code 同 只读错误，不在了() 原样回这句话）。不靠界面藏按钮：哪个按钮点了都改不了库
 *   - 状态放在一张单独的签名票（crm_view_as，2 小时）里，会话票（crm_session）不动：退出 = 删这张票，原身份原样回来。
 *     票里只有 va（看谁）、vb（谁在看），**不带 sub**——两张票同一把钥匙签，这张塞进 crm_session 也认不成任何人
 *   - 票只认签它的那个会话：vb 必须等于 crm_session 的 sub。换人登录、退出登录（destroySession 一起删）都作废
 *   - 开始、退出各记一条操作留痕（action = view-as / view-as-exit）
 *
 * 限度（只读预览，写进交接）：挡的是**写库**。不经过库的副作用——调外部接口（飞书推送、AI 模型）、往磁盘写附件——这一层看不到；
 * 这些入口落库那一步会被拒，但外部那一下可能已经发出去了。所以切换期间别去点「发飞书」「上传」「问 AI」这类按钮。
 * 页面渲染时顺手写库的（首页、客户页每天扫一次掉公海 / 超时收回）在切换期间直接跳过，见 pool-db.ts、project/db.ts。
 *
 * 本模块不在顶层 import next/headers：lib/team-scope.ts（每条写都过）和测试都要用它，同 visibility.ts 是谁()。
 */
import { SignJWT, jwtVerify } from "jose";
import { readSecret } from "@/lib/secret";
import { 全进程上下文 } from "@/lib/process-als";
import { 管理员类别of, type 组织 } from "./org-core";

/** 视图票的 cookie 名 */
export const 视图票 = "crm_view_as";
/** lib/auth.ts 的 COOKIE */
const 会话票 = "crm_session";
/** 视图票有效时长：核完就退，忘了退两小时后自己失效 */
export const 视图小时 = 2;

export type 视图 = { 由: string; 谁: string };

/** 切换期间所有写被拒时那一句（code 同 lib/team-scope.ts 只读错误，not-there.ts 不在了() 原样回给界面） */
export class 视图只读错误 extends Error {
  code = "CRM_READONLY";
  constructor(message = "正在切换视图（只读）：不能改任何数据。要改请先点顶上的「退出」回到自己的身份") {
    super(message);
  }
}

/** 能不能切换视图：账号 ADMIN，或组织里的总管理员 */
export function 能切换视图(org: 组织, 账号角色: string | null | undefined, userId: string): boolean {
  return 账号角色 === "ADMIN" || 管理员类别of(org, userId) === "总管理员";
}

const 钥 = () => new TextEncoder().encode(readSecret());

/** 签一张视图票：由 = 真身（会话票的 sub），谁 = 要看的那个人 */
export async function 签视图票(由: string, 谁: string): Promise<string> {
  return new SignJWT({ typ: "view-as", va: 谁, vb: 由 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${视图小时}h`)
    .sign(钥());
}

/** 验视图票：签名、没过期、类型对、而且是这个会话（sub）签的。不对回 null */
export async function 验视图票(票: string | undefined | null, 会话sub: string | null | undefined): Promise<视图 | null> {
  if (!票 || !会话sub) return null;
  try {
    const { payload } = await jwtVerify(票, 钥());
    if (payload.typ !== "view-as" || typeof payload.va !== "string" || typeof payload.vb !== "string") return null;
    if (payload.vb !== 会话sub || payload.va === payload.vb) return null;
    return { 由: payload.vb, 谁: payload.va };
  } catch {
    return null;
  }
}

/** 会话票的 sub（不查库：这里只回答「这张视图票是不是这个会话签的」，人停没停用由 getCurrentUser 管） */
async function 会话的人(票: string | undefined): Promise<string | null> {
  if (!票) return null;
  try {
    const { payload } = await jwtVerify(票, 钥());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

let 头: Promise<typeof import("next/headers")> | undefined;

/** 这个请求带着有效的视图票：回 {由, 谁}；没有、无效、不在请求里（后台、脚本）回 null */
export async function 当前视图(): Promise<视图 | null> {
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
  return 验视图票(视, await 会话的人(会话));
}

const 放行 = 全进程上下文<true>("视图放行");

/** 只给开始 / 退出那两条留痕用：这一段里的写不拦（别处一律不许用） */
export function 视图放行<T>(fn: () => Promise<T>): Promise<T> {
  return 放行.run(true, async () => await fn());
}

/** 每条写之前过一下（lib/team-scope.ts 加上限定）：切换视图期间一律拒 */
export async function 视图写拦(): Promise<void> {
  if (放行.getStore()) return;
  if (await 当前视图()) throw new 视图只读错误();
}

/** 只读预览期间，页面渲染时顺手做的每天一扫（掉公海、超时收回）跳过：回 true = 跳过 */
export async function 视图中跳过(): Promise<boolean> {
  return !放行.getStore() && !!(await 当前视图());
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

/**
 * 裸 SQL 会不会写库（加上限定拦 $executeRaw* 一律拒；$queryRaw* 看原文）。认不出原文的当会写（宁可拒）
 */
export function 会写库的SQL(sql: string | null): boolean {
  if (sql === null) return true;
  const s = sql.replace(/\s+/g, " ");
  return /\b(insert|update|delete|replace|create|drop|alter|attach|detach|vacuum|reindex)\b/i.test(s) || /\bpragma\s+[\w.]+\s*=/i.test(s);
}

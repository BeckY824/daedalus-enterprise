/**
 * 运行记录里的「谁」（批次 28-⑤）：只记业务角色 + 当天的人员短号，不记用户名、不记用户 id。
 *
 * 人员短号 = HMAC-SHA256(会话密钥, "tel|UTC日期|用户id") 取前 8 位十六进制：
 * - 为什么要它：同一个报错是一个人撞了 50 次、还是 50 个人各撞一次，处理办法完全不同（摘要里的「人数」列）
 * - 为什么这样算：带密钥，拿到文件的人对着用户表也算不回是谁；带日期，隔天就变，跨天串不起一个人的轨迹
 *
 * 角色按会话票（crm_session）认：验签 → sub → EntMember.bizRole（拆角色排好序，多角色逗号连）。
 * 没登录记「未登录」，没设业务角色记「无角色」（11-01 起没设 = 没权限）。查到的角色在进程里记 10 分钟，慢请求多也不多查库。
 * 切换视图时记的是真身（会话票上的那个人）。
 */
import { createHmac } from "node:crypto";
import { jwtVerify } from "jose";
import { readSecret } from "../secret";

export const 会话cookie = "crm_session";
const 角色记多久 = 10 * 60_000;

type 查角色 = (userId: string) => Promise<string | null>;

/** 默认：查 EntMember。用到才引 prisma（单测换成假的） */
const 查库角色: 查角色 = async (userId) => {
  const { prisma } = await import("../prisma");
  const { 拆角色 } = await import("../enterprise/org-core");
  const m = await prisma.entMember.findUnique({ where: { userId }, select: { bizRole: true } });
  const 们 = 拆角色(m?.bizRole);
  return 们.length ? 们.join(",") : null;
};

const g = globalThis as unknown as { __crmTelRoles?: Map<string, { 角色: string; 到: number }> };
const 角色缓存 = (g.__crmTelRoles ??= new Map());

/** cookie 头里取会话票（只取这一个，别的 cookie 不看） */
export function 取会话票(cookie: unknown): string | null {
  const s = Array.isArray(cookie) ? cookie.join("; ") : typeof cookie === "string" ? cookie : "";
  for (const 段 of s.split(";")) {
    const i = 段.indexOf("=");
    if (i > 0 && 段.slice(0, i).trim() === 会话cookie) return 段.slice(i + 1).trim() || null;
  }
  return null;
}

export function 人员短号(userId: string, 现在 = Date.now(), 密钥 = readSecret()): string {
  const 天 = new Date(现在).toISOString().slice(0, 10);
  return createHmac("sha256", 密钥).update(`tel|${天}|${userId}`).digest("hex").slice(0, 8);
}

export type 身份 = { role: string; u?: string };

/** 从 cookie 头认出角色和短号；出什么错都回「未登录」，不往外抛 */
export async function 认身份(cookie: unknown, opts: { 查?: 查角色; 现在?: number; 密钥?: string } = {}): Promise<身份> {
  const 票 = 取会话票(cookie);
  if (!票) return { role: "未登录" };
  try {
    const 密钥 = opts.密钥 ?? readSecret();
    const { payload } = await jwtVerify(票, new TextEncoder().encode(密钥));
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    if (!sub) return { role: "未登录" };
    const 现在 = opts.现在 ?? Date.now();
    let 记 = 角色缓存.get(sub);
    if (!记 || 记.到 < 现在) {
      const 角色 = (await (opts.查 ?? 查库角色)(sub).catch(() => null)) ?? "无角色";
      记 = { 角色, 到: 现在 + 角色记多久 };
      if (角色缓存.size > 5000) 角色缓存.clear();
      角色缓存.set(sub, 记);
    }
    return { role: 记.角色, u: 人员短号(sub, 现在, 密钥) };
  } catch {
    return { role: "未登录" };
  }
}

/** 测试用 */
export function 清角色缓存() {
  角色缓存.clear();
}

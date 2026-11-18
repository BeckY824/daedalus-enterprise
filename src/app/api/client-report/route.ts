import type { NextRequest } from "next/server";
import { 规整上报 } from "@/lib/telemetry/fields";
import { 写一条, 遥测开着 } from "@/lib/telemetry/store";
import { 包上限字节, 上报成行, 路由表, 限流器 } from "@/lib/telemetry/server";
import { 认身份, 取会话票 } from "@/lib/telemetry/who";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 浏览器报错上报（批次 28-⑤，企业版运行记录）：components/ErrorReporter.tsx（未捕获错误、错误边界、动作失败）
 * 和 lib/old-browser.ts 的整页提示（sendBeacon，ES5）往这里 POST 一小包 JSON。
 *
 * - 公开：旧浏览器提示出现在登录页上的人还没登录，也要能报；没登录的只收「旧浏览器」那一类，别的照回 204、不落
 * - 包最多 4KB（按读到的字节算，不信 content-length）；每个会话 10 分钟最多 30 条、整个进程每分钟 300 条，超了 429
 * - 只认包里的 k / n / m / d / p / f 几个键（lib/telemetry/fields.ts 规整上报），路径归成路由模式、报错脱敏后才落；
 *   浏览器版本从 User-Agent 头认、角色从会话票认，都在服务端做，浏览器说的不算
 * - 限流的键：有会话票按票的哈希，没有按来源地址的哈希——只在内存里，不落盘
 * - 不是企业版、或关了（CRM_TELEMETRY=0）：204，什么都不做
 * 回 204 不带内容：sendBeacon 不看回应，页面那头也不等它
 */
const 限 = ((globalThis as unknown as { __crmTelLimit?: 限流器 }).__crmTelLimit ??= new 限流器());

const 空 = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

/** 读请求体，超过上限回 null（边读边数，不先整个读进来） */
async function 读体(req: NextRequest, 上限: number): Promise<string | null> {
  const 声明 = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(声明) && 声明 > 上限) return null;
  if (!req.body) return "";
  const r = req.body.getReader();
  const 块: Uint8Array[] = [];
  let 长 = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    长 += value.byteLength;
    if (长 > 上限) {
      await r.cancel().catch(() => null);
      return null;
    }
    块.push(value);
  }
  return Buffer.concat(块).toString("utf8");
}

function 限流键(req: NextRequest): string {
  const 票 = 取会话票(req.headers.get("cookie"));
  const 来源 = 票 ? `s:${票}` : `a:${(req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "?"}`;
  return createHash("sha256").update(来源).digest("hex").slice(0, 16);
}

export async function POST(req: NextRequest) {
  if (!遥测开着()) return 空(204);
  const 体 = await 读体(req, 包上限字节).catch(() => null);
  if (体 === null) return 空(413);
  let j: unknown;
  try {
    j = JSON.parse(体);
  } catch {
    return 空(400);
  }
  const 报 = 规整上报(j);
  if (!报) return 空(400);
  if (!限.过(限流键(req))) return 空(429);
  const 谁 = await 认身份(req.headers.get("cookie"));
  if (谁.role === "未登录" && 报.类 !== "old") return 空(204);
  写一条(上报成行(报, req.headers.get("user-agent"), 谁, 路由表()));
  return 空(204);
}

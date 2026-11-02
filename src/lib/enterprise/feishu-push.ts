/**
 * 企业版：把站内通知用飞书应用机器人推给本人（2026-11-01）。
 *
 *   令牌   POST /open-apis/auth/v3/tenant_access_token/internal  {app_id, app_secret}
 *   发消息 POST /open-apis/im/v1/messages?receive_id_type=open_id  {receive_id, msg_type: "post", content, uuid}
 *
 * - 凭据和导入、通讯录同步、飞书登录同一份：Setting `entConn.feishu`，没存就看 ENT_FEISHU_APP_ID / ENT_FEISHU_APP_SECRET
 * - 组织开关 `entFeishuPush`（设置 → 组织 → 飞书推送），默认关；关着一次飞书请求都不发
 * - 收件人 = User.feishuOpenId（飞书登录、通讯录同步时记下的）；没绑的只有站内通知
 * - 链接 = ENT_PUBLIC_URL + 站内路径；没配 ENT_PUBLIC_URL 就只发标题和正文
 * - 令牌按 expire 缓存到快过期（提前 5 分钟），飞书说令牌失效时清掉重拿一次
 * - 每条通知先把 feishuStatus 从「待推」抢成「推送中」再发，抢不到就不发：同一条不会推两遍；
 *   请求体再带 uuid = 通知 id，飞书那边一小时内同 uuid 也只发一次
 * - 推不出去只记在那一行（feishuStatus / feishuError），从不往外抛
 */
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { multiTenant } from "@/lib/tenant/context";
import { 读连接配置 } from "@/lib/enterprise-import/adapter";
import { 正在切换视图 } from "./view-as";

export const 飞书推送开关键 = "entFeishuPush";
const 默认基址 = "https://open.feishu.cn";
/** 飞书说令牌不对 / 过期了：清缓存重拿一次 */
const 令牌失效码 = new Set([99991661, 99991663, 99991668]);
/** 应用没开「以应用身份发消息」或开了没发版 */
const 没权限码 = 99991672;

const 有值 = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

export type 推送凭据 = { appId: string; appSecret: string; 基址: string };

export async function 飞书推送开着(): Promise<boolean> {
  return (await getSetting<boolean>(飞书推送开关键)) === true;
}

/** 配了飞书应用才推；多租户托管不推 */
export async function 推送凭据(): Promise<推送凭据 | null> {
  if (multiTenant()) return null;
  const c = (await 读连接配置("feishu")) ?? {};
  const appId = 有值(c.appId) ? c.appId : process.env.ENT_FEISHU_APP_ID;
  const appSecret = 有值(c.appSecret) ? c.appSecret : process.env.ENT_FEISHU_APP_SECRET;
  if (!有值(appId) || !有值(appSecret)) return null;
  const 基址 = (有值(c.基址) ? c.基址 : 默认基址).trim().replace(/\/+$/, "");
  return { appId: appId.trim(), appSecret: appSecret.trim(), 基址 };
}

/** 站内路径拼成飞书里能点开的完整地址；没配 ENT_PUBLIC_URL 或 link 为空返回 null */
export function 完整链接(link: string | null | undefined): string | null {
  const 根 = process.env.ENT_PUBLIC_URL;
  if (!有值(根) || !有值(link)) return null;
  if (/^https?:\/\//i.test(link)) return link;
  return `${根.trim().replace(/\/+$/, "")}${link.startsWith("/") ? "" : "/"}${link}`;
}

/* ───────────────────────── 令牌 ───────────────────────── */

let 令牌缓存: { 键: string; 值: string; 到期: number } | null = null;

/** 测试用：清掉缓存的令牌 */
export function 清飞书推送令牌() {
  令牌缓存 = null;
}

class 推送出错 extends Error {}

async function 拿令牌(c: 推送凭据, 换新 = false): Promise<string> {
  const 键 = `${c.基址}|${c.appId}`;
  if (!换新 && 令牌缓存 && 令牌缓存.键 === 键 && 令牌缓存.到期 > Date.now()) return 令牌缓存.值;
  const res = await fetch(`${c.基址}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: c.appId, app_secret: c.appSecret }),
  });
  const j = (await res.json().catch(() => null)) as { code?: number; msg?: string; tenant_access_token?: unknown; expire?: unknown } | null;
  if (!res.ok || j?.code !== 0 || typeof j?.tenant_access_token !== "string") {
    令牌缓存 = null;
    throw new 推送出错(`拿令牌失败：HTTP ${res.status}，code ${j?.code ?? "?"} ${j?.msg ?? ""}`.trim());
  }
  const 秒 = typeof j.expire === "number" && j.expire > 0 ? j.expire : 7200;
  令牌缓存 = { 键, 值: j.tenant_access_token, 到期: Date.now() + Math.max(60, 秒 - 300) * 1000 };
  return 令牌缓存.值;
}

/* ───────────────────────── 发一条 ───────────────────────── */

export type 飞书消息 = { 标题: string; 正文: string; 链接: string | null; uuid: string };

/** 富文本（post）：标题 + 正文 + 「打开 CRM 查看」链接 */
export function 消息体(openId: string, m: 飞书消息) {
  const 段: { tag: string; text: string; href?: string }[][] = [];
  if (m.正文.trim()) 段.push([{ tag: "text", text: m.正文 }]);
  if (m.链接) 段.push([{ tag: "a", text: "打开 CRM 查看", href: m.链接 }]);
  return {
    receive_id: openId,
    msg_type: "post",
    content: JSON.stringify({ zh_cn: { title: m.标题, content: 段 } }),
    uuid: m.uuid.slice(0, 50),
  };
}

async function 发(c: 推送凭据, openId: string, m: 飞书消息, 已重试 = false): Promise<void> {
  const 令牌 = await 拿令牌(c, 已重试);
  const res = await fetch(`${c.基址}/open-apis/im/v1/messages?receive_id_type=open_id`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${令牌}` },
    body: JSON.stringify(消息体(openId, m)),
  });
  const j = (await res.json().catch(() => null)) as { code?: number; msg?: string } | null;
  if (res.ok && j?.code === 0) return;
  if (!已重试 && typeof j?.code === "number" && 令牌失效码.has(j.code)) {
    令牌缓存 = null;
    return 发(c, openId, m, true);
  }
  const 提示 = j?.code === 没权限码 ? "（飞书应用没开「以应用身份发消息」权限或没发布版本）" : "";
  throw new 推送出错(`发消息失败：HTTP ${res.status}，code ${j?.code ?? "?"} ${j?.msg ?? ""}${提示}`.trim());
}

/* ───────────────────────── 推一批通知 ───────────────────────── */

const 截 = (s: string) => (s.length > 500 ? `${s.slice(0, 500)}…` : s);

/**
 * 把这几条「待推」的通知推到飞书，结果写回各自那一行。从不抛。
 * 开关关着、没配应用：整批记「没推」，一次飞书请求都不发。
 */
export async function 推通知们(ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  try {
    if (await 正在切换视图()) return; // 只读预览不发飞书（通知落库那一步本来也被拒，这里兜底）
    const 记没推 = (原因: string, 哪些: readonly string[] = ids) =>
      prisma.entNotice.updateMany({ where: { id: { in: [...哪些] }, feishuStatus: "待推" }, data: { feishuStatus: "没推", feishuError: 原因, feishuAt: new Date() } });
    if (!(await 飞书推送开着())) return void (await 记没推("飞书推送没开"));
    const c = await 推送凭据();
    if (!c) return void (await 记没推("没配飞书应用"));

    const 行们 = await prisma.entNotice.findMany({ where: { id: { in: [...ids] }, feishuStatus: "待推" } });
    const 人们 = await prisma.user.findMany({
      where: { id: { in: [...new Set(行们.map((r) => r.userId))] } },
      select: { id: true, feishuOpenId: true, active: true },
    });
    const openId = new Map(人们.filter((u) => u.active && 有值(u.feishuOpenId)).map((u) => [u.id, u.feishuOpenId!]));

    for (const r of 行们) {
      const 收 = openId.get(r.userId);
      if (!收) {
        await 记没推("没绑飞书", [r.id]);
        continue;
      }
      // 先抢：别的调用已经在推这条就不再推
      const 抢 = await prisma.entNotice.updateMany({ where: { id: r.id, feishuStatus: "待推" }, data: { feishuStatus: "推送中" } });
      if (抢.count !== 1) continue;
      try {
        await 发(c, 收, { 标题: r.title, 正文: r.body, 链接: 完整链接(r.link), uuid: r.id });
        await prisma.entNotice.update({ where: { id: r.id }, data: { feishuStatus: "已推", feishuError: null, feishuAt: new Date() } });
      } catch (e) {
        const 原因 = e instanceof 推送出错 ? e.message : `发消息失败：${e instanceof Error ? e.message : String(e)}`;
        await prisma.entNotice.update({ where: { id: r.id }, data: { feishuStatus: "失败", feishuError: 截(原因), feishuAt: new Date() } }).catch(() => {});
      }
    }
  } catch (e) {
    // 读库出错之类：整批留着「待推」，不影响主流程
    console.warn("[飞书推送] 这一批没推成：", e instanceof Error ? e.message : e);
  }
}

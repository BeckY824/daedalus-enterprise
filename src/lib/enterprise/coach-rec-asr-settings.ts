/**
 * 设置 → AI 接入 →「语音转文字」（11-22，录音点评 PR4，方案 PR4 一节）：状态、测试连接（请求体、签名地址两条路都测）、开关、大文件怎么交。
 * 界面在 app/(app)/settings/AsrCard.tsx，服务器动作在 app/(app)/settings/asr-actions.ts（只是认人 + 调这里）。
 *
 * - 谁能改：和改后台设置一个口径（能改后台设置：系统管理员，勾了「不管设置」的不行；管理员 admin 只读）；切换视图时只读
 * - 谁能看：只有系统管理员（和前端一致：admin 进不了 AI 接入页签；销售教练等别的只读角色也不看，回 403）
 * - 密钥：这里只回「已配置（服务器环境）/ 未配置 / 解不开 / 假通道」，**不提供输入框**、不回任何密钥内容（方案 §4.5）
 * - 开开关要密钥在、ffmpeg 自检过；关随时能关。改开关、改交法、测连接都进审计（摘要里没有密钥、签名、地址）
 * - 测试连接：ffmpeg 现生成 3 秒正弦音（不是业务数据）放 coach-rec/_asrtest/<样例编号>.m4a，两条路同时交、各等最多 45 秒；
 *   签名地址那条腾讯云从 ENT_PUBLIC_URL + 签名地址取（路由认样例编号，见 coach-rec-db.ts 取给转写）。测完删样例
 */
import { randomBytes } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { recordAudit, type Actor } from "@/lib/audit";
import { getSetting, setSetting } from "@/lib/settings";
import { 企业版 } from "./switch";
import { 权限组织 } from "./org";
import { 能改后台设置 } from "./permissions";
import { 正在切换视图 } from "./view-as";
import { 录音点评开关键, 录音点评开着, 样例编号头, 样例目录 } from "./coach-rec-db";
import { 大文件交法键, 大文件交法们, 读大文件交法, type 大文件交法 } from "./coach-rec-jobs";
import { 签取文件地址 } from "./coach-rec-sign";
import { 站点源 } from "./feishu-jsapi";
import { 选通道, 通道密钥状态, 通道错, type 密钥状态, type 转写通道, type 交的音频 } from "./asr/channel";
import { ffmpeg自检, 生成样例 } from "./asr/ffmpeg";

export const 上次测试键 = "enterprise.coachRec.asrTest";
export type 一条路 = { ok: boolean; 话: string };
export type 测试结果 = { at: string; 请求体: 一条路; 签名地址: 一条路 };

export type 转写设置概况 = {
  开: boolean;
  能改: boolean;
  密钥: 密钥状态;
  ffmpeg: 一条路;
  配了地址: boolean;
  交法: 大文件交法;
  上次测试: 测试结果 | null;
};

type 人 = Actor & { role: string };
type 结果 = { ok: true; 概况: 转写设置概况 } | { ok: false; error: string };

async function 能改(me: 人): Promise<boolean> {
  return 能改后台设置(me, await 权限组织()) && !(await 正在切换视图());
}
const 密钥齐 = (x: 密钥状态) => x === "已配置" || x === "假通道";

/** 能看这一块：只有系统管理员（能改后台设置），和前端 AI 接入页签一致、最小权限。管理员 admin、销售教练等都不看 */
async function 能看(me: 人): Promise<boolean> {
  return 能改后台设置(me, await 权限组织());
}

async function 概况of(me: 人): Promise<转写设置概况> {
  const [开, 改, 密钥, 检, 交法, 上次] = await Promise.all([录音点评开着(), 能改(me), 通道密钥状态(), ffmpeg自检(), 读大文件交法(), getSetting<测试结果>(上次测试键)]);
  return {
    开, 能改: 改, 密钥,
    ffmpeg: 检.ok ? { ok: true, 话: `正常（${检.版本}）` } : { ok: false, 话: 检.话 },
    配了地址: !!站点源(process.env.ENT_PUBLIC_URL), 交法, 上次测试: 上次 && typeof 上次 === "object" && "at" in 上次 ? 上次 : null,
  };
}

export const 不给看话 = "只有系统管理员能看语音转文字设置";
/** 看状态：系统管理员拿概况；别的人回 403（界面不画这一块）；不是企业版回 null */
export async function 读转写设置(me: 人): Promise<转写设置概况 | { ok: false; status: 403; error: string } | null> {
  if (!企业版()) return null;
  if (!(await 能看(me))) return { ok: false, status: 403, error: 不给看话 };
  return 概况of(me);
}

export async function 设录音点评开关(me: 人, 开: boolean): Promise<结果> {
  if (!企业版()) return { ok: false, error: "只有企业版能用" };
  if (!(await 能改(me))) return { ok: false, error: "只有系统管理员能改（切换视图时不能改）" };
  if (开 === (await 录音点评开着())) return { ok: true, 概况: await 概况of(me) };
  if (开) {
    const 密钥 = await 通道密钥状态();
    if (!密钥齐(密钥)) return { ok: false, error: 密钥 === "解不开" ? "服务器上的密钥解不开（换过 auth-secret），要重新写密钥" : "服务器还没配腾讯云密钥，配好、重启后再打开" };
    const 检 = await ffmpeg自检();
    if (!检.ok) return { ok: false, error: `${检.话}，装好后再打开` };
  }
  await setSetting(录音点评开关键, 开 === true);
  await recordAudit({ user: me, action: "update", entity: "Setting", entityId: 录音点评开关键, summary: `${开 ? "打开" : "关掉"}录音点评（语音转文字）` });
  return { ok: true, 概况: await 概况of(me) };
}

export async function 设大文件交法(me: 人, 交法: unknown): Promise<结果> {
  if (!企业版()) return { ok: false, error: "只有企业版能用" };
  if (!(await 能改(me))) return { ok: false, error: "只有系统管理员能改（切换视图时不能改）" };
  if (!(大文件交法们 as readonly unknown[]).includes(交法)) return { ok: false, error: "没有这种交法" };
  if (交法 !== (await 读大文件交法())) {
    await setSetting(大文件交法键, 交法);
    await recordAudit({ user: me, action: "update", entity: "Setting", entityId: 大文件交法键, summary: `录音大文件改成「${交法}」交给腾讯云` });
  }
  return { ok: true, 概况: await 概况of(me) };
}

const 睡 = (毫秒: number) => new Promise((r) => setTimeout(r, 毫秒));

/** 交一次、等结果（最多 等毫秒）：成功 = 通了；失败、出错写给人看的话 */
async function 试一条路(通道: 转写通道, 音频: 交的音频, 等毫秒: number, 间隔: number): Promise<一条路> {
  const 起 = Date.now();
  let 号: string;
  try {
    号 = await 通道.提交({ 档: "16k", 音频 });
  } catch (e) {
    return { ok: false, 话: e instanceof 通道错 ? e.话 : "提交出错了" };
  }
  while (Date.now() - 起 < 等毫秒) {
    try {
      const r = await 通道.查(号);
      if (r.状态 === "成功") return { ok: true, 话: `通了（${Math.max(1, Math.round((Date.now() - 起) / 1000))} 秒出结果）` };
      if (r.状态 === "失败") return { ok: false, 话: r.话 };
    } catch (e) {
      if (e instanceof 通道错 && !e.可重试) return { ok: false, 话: e.话 };
    }
    await 睡(间隔);
  }
  return { ok: false, 话: `交上了，但 ${Math.round(等毫秒 / 1000)} 秒内没出结果（腾讯云排队），过一会儿再测一次` };
}

/** 测试连接：两条路同时测，结果存起来（设置卡上显示「上次测试」）。opt 只给测试缩短等待 */
export async function 测转写连接(me: 人, opt: { 等毫秒?: number; 间隔?: number } = {}): Promise<{ ok: true; 结果: 测试结果; 概况: 转写设置概况 } | { ok: false; error: string }> {
  if (!企业版()) return { ok: false, error: "只有企业版能用" };
  if (!(await 能改(me))) return { ok: false, error: "只有系统管理员能测（切换视图时不能测）" };
  const 通道 = await 选通道();
  if (!通道) return { ok: false, error: "服务器还没配腾讯云密钥（或者解不开），测不了" };
  const 检 = await ffmpeg自检();
  if (!检.ok) return { ok: false, error: 检.话 };
  const 目录 = 样例目录();
  await fsp.mkdir(目录, { recursive: true });
  // 顺手清掉以前留下的样例（测到一半进程没了的）
  for (const f of await fsp.readdir(目录).catch(() => [] as string[])) {
    const st = await fsp.stat(path.join(目录, f)).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 30 * 60 * 1000) await fsp.rm(path.join(目录, f), { force: true });
  }
  const 号 = 样例编号头 + [...randomBytes(16)].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  const 文件 = path.join(目录, `${号}.m4a`);
  const 等毫秒 = opt.等毫秒 ?? 45_000;
  const 间隔 = opt.间隔 ?? 2_000;
  let 结果: 测试结果;
  try {
    await 生成样例(文件);
    const 数据 = await fsp.readFile(文件);
    const 源 = 站点源(process.env.ENT_PUBLIC_URL);
    const [体, 址] = await Promise.all([
      试一条路(通道, { 方式: "请求体", 数据 }, 等毫秒, 间隔),
      源 ? 试一条路(通道, { 方式: "地址", url: `${源}${签取文件地址(号)}` }, 等毫秒, 间隔) : Promise.resolve({ ok: false, 话: "服务器没配 ENT_PUBLIC_URL，签名地址这条测不了（大文件会自动切段提交）" }),
    ]);
    结果 = { at: new Date().toISOString(), 请求体: 体, 签名地址: 址 };
  } catch (e) {
    console.warn(`[录音转写] 测试连接出错：${e instanceof Error ? e.message.slice(0, 200) : e}`);
    return { ok: false, error: "生成样例音频出错了（ffmpeg）" };
  } finally {
    await fsp.rm(文件, { force: true }).catch(() => {});
  }
  await setSetting(上次测试键, 结果);
  await recordAudit({ user: me, action: "update", entity: "Setting", entityId: 上次测试键, summary: `测试了语音转文字连接：请求体${结果.请求体.ok ? "通" : "不通"}、签名地址${结果.签名地址.ok ? "通" : "不通"}` });
  return { ok: true, 结果, 概况: await 概况of(me) };
}

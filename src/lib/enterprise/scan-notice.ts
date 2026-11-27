/**
 * ④ 扫库检测 · 第 2 阶段（2026-11-27，E-383 / E-386）：凌晨扫 + 早 8 点通知。
 *   - 扫：北京 00:05 后、一天一次（Setting 水位），按「昨天」的 EntScanQuery 聚合每人 查询次数（行数）/ 撞上次数（hit 行数），
 *     查询 ≥ 50 次且 撞上 ÷ 查询 ≥ 60% 的 upsert 进 EntScanTrigger（人 + 日唯一）。50、60% 定死，不进设置。
 *     只补昨天一天，不追更早（服务停过开机后补扫昨天）。
 *   - 发：北京 08:00 后、一天一次（Setting 水位），把 EntScanTrigger 里最近 3 个北京日（含昨天）、还没发的按日期从早到晚逐条发给查询人的直属上级；
 *     直属上级没填 / 停用 / 填自己 → 系统管理员们（不兜条线总管理）；收件人里永远去掉查询人本人，去掉后为空改发系统管理员（仍去掉本人），再空就不发、warn 一行。同人同日最多一条（去重键 + noticeAt 非空不再发）。
 *   - 内容只写谁、哪天、查了几次、撞上几次、撞号率，不带号码和客户名。站内通知，绑了飞书的 notify 自动推。
 *   - 总开关 enterprise.scan4.on 关了：不扫、不发（已写进 EntScanTrigger 的也不发）。
 */
import { prisma } from "@/lib/prisma";
import { getSetting, setSetting } from "@/lib/settings";
import { beijingDay, beijingWallIso } from "@/lib/business-clock";
import { 企业版 } from "@/lib/enterprise/switch";
import { 读组织 } from "./org";
import { 直属上级of, 离职直属上级 } from "./org-core";
import { 系统管理员们 } from "./tri-state-people";
import { notify } from "./notify";
import { 扫库检测开着 } from "./scan-query";

export const 扫库阈值 = { 次数: 50, 撞号率: 0.6 } as const;
export const 扫库扫时刻 = "00:05";
export const 扫库发时刻 = "08:00";
export const 扫库扫水位键 = "entScan4ScanDay";
export const 扫库发水位键 = "entScan4NoticeDay";

const 钟点 = (现在: Date) => beijingWallIso(现在).slice(11, 16);

/**
 * 备份避让（E-387：避开 c2 北京 00:30 / 03:30 备份）：北京 00:15–00:50、03:15–03:50（两头都含）不开始扫、不开始清理。
 * 钟每分钟一遍，落在窗口里的这一遍直接跳过，窗口结束（00:51 / 03:51）后的下一遍照常补上；停机后开机补扫正好落在窗口里的同理推迟。
 * 早 8 点发通知不受影响（不在窗口里，也不用这个判）。HH:MM 定长，字符串可直接比大小
 */
export const 扫库避让窗口 = [["00:15", "00:50"], ["03:15", "03:50"]] as const;
export function 在备份窗口(现在: Date): boolean {
  const t = 钟点(现在);
  return 扫库避让窗口.some(([起, 止]) => t >= 起 && t <= 止);
}

/** 北京日 YYYY-MM-DD 的前一天 */
export function 前一天(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const 撞号百分比 = 60; // 整数常量：撞上 ×100 ≥ 查询 ×60，不用 0.6 浮点

/** 达标：次数 ≥ 50 且 撞上 ×100 ≥ 查询 ×60（整数比，避免浮点） */
export const 达标 = (查询: number, 撞上: number): boolean => 查询 >= 扫库阈值.次数 && 撞上 * 100 >= 查询 * 撞号百分比;

export type 扫库明细 = { 扫: { 日: string; 达标: number } | null; 发: { 日: string; 条: number } | null };

/** 扫某一天：返回新写 / 更新的达标人数 */
async function 扫一天(day: string): Promise<number> {
  const 行 = await prisma.entScanQuery.groupBy({ by: ["userId"], where: { day }, _count: { _all: true } });
  const 撞 = await prisma.entScanQuery.groupBy({ by: ["userId"], where: { day, hit: true }, _count: { _all: true } });
  const 撞数 = new Map(撞.map((x) => [x.userId, x._count._all]));
  let n = 0;
  for (const x of 行) {
    const 查询 = x._count._all;
    const 撞上 = 撞数.get(x.userId) ?? 0;
    if (!达标(查询, 撞上)) continue;
    await prisma.entScanTrigger.upsert({
      where: { day_userId: { day, userId: x.userId } },
      create: { day, userId: x.userId, queries: 查询, hits: 撞上 },
      update: { queries: 查询, hits: 撞上 },
    });
    n++;
  }
  return n;
}

/** 通知文字：不带号码和客户名 */
export function 扫库通知文字(名: string, day: string, 查询: number, 撞上: number): { title: string; body: string } {
  const 率 = Math.round((撞上 * 100) / 查询);
  const md = day.slice(5);
  const s = `扫库检测：${名} ${md} 查询 ${查询} 次，撞上 ${撞上} 次，撞号率 ${率}%`;
  return { title: s, body: s };
}

export const 扫库补发天数 = 3;

/** 发「最近 3 个北京日内（含昨天）、noticeAt 为空」的触发，日期从早到晚；通知正文里的日期照各自那天 */
async function 发近几天(今天: string): Promise<number> {
  const 条们 = await prisma.entScanTrigger.findMany({
    where: { day: { gte: 前几天(今天, 扫库补发天数), lte: 前一天(今天) }, noticeAt: null },
    orderBy: [{ day: "asc" }, { createdAt: "asc" }],
  });
  if (!条们.length) return 0;
  const org = await 读组织();
  const 名们 = new Map((await prisma.user.findMany({ where: { id: { in: 条们.map((x) => x.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  let 发了 = 0;
  for (const t of 条们) {
    // 在职：手填的直属上级；查询人已停用：停用前手填的上级（在职才算）。没填 / 停用 / 填自己 = null → 系统管理员们（不兜条线总管理）
    const 上 = org.成员.has(t.userId) ? 直属上级of(org, t.userId) : 离职直属上级(org, t.userId);
    // 收件人去掉查询人本人；去掉后为空 → 全部系统管理员（仍去掉本人）；还为空 → 不发、只留一行 warn（不带号码 / 客户名）
    let 收 = (上 ? [上] : 系统管理员们(org)).filter((id) => id !== t.userId);
    if (!收.length) 收 = 系统管理员们(org).filter((id) => id !== t.userId);
    if (!收.length) {
      console.warn("[扫库检测] 没人可收", t.userId, t.day);
      continue;
    }
    const { title, body } = 扫库通知文字(名们.get(t.userId) ?? "（账号已删除）", t.day, t.queries, t.hits);
    await notify(收, { kind: "扫库检测", title, body, link: null, key: `扫库检测:${t.day}:${t.userId}` });
    await prisma.entScanTrigger.update({ where: { id: t.id }, data: { notifiedTo: 收.join(","), noticeAt: new Date() } });
    发了++;
  }
  return 发了;
}

/**
 * 钟上那一遍（nightly.ts 调；测试 / 实操用假时钟直接调）：北京 00:05 后扫昨天（一天一次）、08:00 后发最近 3 天没发的（一天一次）。
 * 开关关了 / 不是企业版 = 都不做（返回 null）。自己出错由调用方兜；扫和发各管各的水位，发失败不记水位、下一遍再试
 */
export async function 钟上扫库检测(现在: Date = new Date()): Promise<扫库明细 | null> {
  if (!企业版() || !(await 扫库检测开着())) return null;
  const 今天 = beijingDay(现在);
  const 昨天 = 前一天(今天);
  const 明细: 扫库明细 = { 扫: null, 发: null };
  const 避让 = 在备份窗口(现在);
  if (!避让 && 钟点(现在) >= 扫库扫时刻 && (await getSetting<string>(扫库扫水位键)) !== 今天) {
    明细.扫 = { 日: 昨天, 达标: await 扫一天(昨天) };
    await setSetting(扫库扫水位键, 今天);
  }
  if (钟点(现在) >= 扫库发时刻 && (await getSetting<string>(扫库发水位键)) !== 今天) {
    // 今天的扫还没跑过（极端：00:05–08:00 间没开机，08:00 后才开）：先补扫昨天再发
    if (!避让 && !明细.扫 && (await getSetting<string>(扫库扫水位键)) !== 今天) {
      明细.扫 = { 日: 昨天, 达标: await 扫一天(昨天) };
      await setSetting(扫库扫水位键, 今天);
    }
    明细.发 = { 日: 昨天, 条: await 发近几天(今天) };
    await setSetting(扫库发水位键, 今天);
  }
  return 明细.扫 || 明细.发 ? 明细 : null;
}

export const 扫库保留天数 = 90;
export const 扫库清水位键 = "entScan4PurgeDay";

/** 北京日 YYYY-MM-DD 往前推 n 天（YYYY-MM-DD 定长，字符串可直接比大小） */
export function 前几天(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * 90 天清理（E-383）：删 EntScanQuery / EntScanTrigger 里 day < 今天 − 90 天的行（「超过 90 天删」：正好 90 天前那天还留，91 天前删）。
 * 一天一次（Setting 水位），北京 00:05 后、避开备份窗口才开始；按范围一次删光，停机几天后开机第一遍就把所有超期的清掉。开关关着照清。不是企业版 = null
 */
export async function 钟上清扫库记录(现在: Date = new Date()): Promise<{ 查询: number; 触发: number } | null> {
  if (!企业版()) return null;
  if (在备份窗口(现在) || 钟点(现在) < 扫库扫时刻) return null; // 清理和扫一起：00:05 后、避开备份窗口（E-387）
  const 今天 = beijingDay(现在);
  if ((await getSetting<string>(扫库清水位键)) === 今天) return null;
  const 线 = 前几天(今天, 扫库保留天数);
  const 查询 = (await prisma.entScanQuery.deleteMany({ where: { day: { lt: 线 } } })).count;
  const 触发 = (await prisma.entScanTrigger.deleteMany({ where: { day: { lt: 线 } } })).count;
  await setSetting(扫库清水位键, 今天);
  return { 查询, 触发 };
}

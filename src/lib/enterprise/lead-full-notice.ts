/**
 * 企业版自动分配「都已满额」提醒（A8，2026-10-26）。
 *
 * 自动分配因为能接的人都分满了、一条没分出去时，除了当场的提示，再给市场管理、总管理员各留一条站内提醒，
 * 让他们去找销售的上级调配额。显示在首页顶部、线索页顶部，各人看过自己关。
 *
 * 为什么不走待办（Task）：待办必须挂客户，线索还没有客户；也不进铃铛、Dock 的数，那些数的是要跟进的客户。
 * 存 Setting，每人一个键、一份列表：企业版是一台服务器一个库，Setting 不跨端同步，按人分的键不会串到别人那儿。
 * 一次点击（单条或批量）只发一条，列出没分出去的线索；每人最多留最近 20 条。
 *
 * 11-01（清单 A10）同一套也发「待分配」：新建线索选了自动分配、但这条业务线没人可分或业务线是「暂不分配」，线索留在新线索等人手动分，
 * 同样告诉市场管理、总管理员；条目带 原因，界面按原因换说法。老条目没有 原因 = 满额。
 */
import { getSetting, invalidateSettingsCache } from "@/lib/settings";
import { 查完再写 } from "@/lib/check-then-write";
import { 管理员类别们of, type 组织 } from "./org-core";
import { 企业版 } from "./switch";
import { notify } from "./notify";

export type 提醒原因 = "满额" | "待分配";
export type 满额提醒 = { id: string; at: string; 条数: number; 线索: string[]; 谁点的: string; 原因?: 提醒原因; 为什么?: string };

const 键 = (userId: string) => `entLeadFullNotice:${userId}`;
const 最多留 = 20;

/** 收提醒的人：组织里的市场管理、总管理员（只认业务角色，11-01；账号管理员没设业务角色的收不到） */
export function 满额提醒收件人(org: 组织, 原因: 提醒原因 = "满额"): string[] {
  return [...org.成员.keys()].filter((id) => {
    const 类们 = 管理员类别们of(org, id);
    // 待分配的线索销售管理也能手动分（11-01 A7），一起提醒
    return 类们.has("市场管理") || 类们.has("总管理员") || (原因 === "待分配" && 类们.has("销售管理"));
  });
}

/** Setting 里不是数组（没发过、被手改坏）都当没有 */
function 认列表(v: unknown): 满额提醒[] {
  return Array.isArray(v) ? v.filter((x): x is 满额提醒 => !!x && typeof x === "object" && typeof (x as 满额提醒).id === "string") : [];
}
const 解析 = (value: string | undefined) => {
  try {
    return 认列表(value ? JSON.parse(value) : null);
  } catch {
    return [];
  }
};

export async function 读满额提醒(userId: string): Promise<满额提醒[]> {
  return 认列表(await getSetting<unknown>(键(userId)));
}

/** 发一条：线索名是这一次点击里因都已满额没分出去的那几条；空的不发，不是企业版不发 */
export async function 发满额提醒(org: 组织, 线索: string[], 谁点的: string, 今 = new Date(), 另: { 原因?: 提醒原因; 为什么?: string } = {}): Promise<void> {
  if (!企业版()) return;
  const 收件人 = 满额提醒收件人(org, 另.原因);
  if (!线索.length || !收件人.length) return;
  const 条: 满额提醒 = {
    id: `${今.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`, at: 今.toISOString(), 条数: 线索.length, 线索, 谁点的,
    ...(另.原因 && 另.原因 !== "满额" ? { 原因: 另.原因 } : {}), ...(另.为什么 ? { 为什么: 另.为什么 } : {}),
  };
  // 读-改-写放进一个事务：两个人同时点自动分配，后写的不会把先写的盖掉
  await 查完再写(async (tx) => {
    for (const userId of 收件人) {
      const 行 = await tx.setting.findUnique({ where: { key: 键(userId) } });
      const value = JSON.stringify([条, ...解析(行?.value)].slice(0, 最多留));
      await tx.setting.upsert({ where: { key: 键(userId) }, update: { value }, create: { key: 键(userId), value } });
    }
  });
  invalidateSettingsCache();
  const 名单 = `${线索.slice(0, 10).join("、")}${线索.length > 10 ? ` 等 ${线索.length} 条` : ""}`;
  // 待分配不是满额：这条业务线没人可分或选了暂不分配，说法和界面（leads/LeadFullNotices.tsx）对齐
  await notify(收件人, 另.原因 === "待分配" ? {
    kind: "待分配",
    title: `待分配：${线索.length} 条新线索没自动分出去`,
    body: `${名单}（${谁点的} 建的）。${另.为什么 ? `${另.为什么}。` : ""}线索留在新线索、没有负责人：去新线索手动分。`,
    link: "/leads",
    key: `full:${条.id}`,
  } : {
    kind: "满额",
    title: `自动分配没分出去：${线索.length} 条线索都已满额`,
    body: `${谁点的} 点的自动分配，能接的人都分满了：${名单}。找销售的上级调配额，或者手动分。`,
    link: "/leads",
    key: `full:${条.id}`,
  });
}

/** 新建线索选了自动分配、没分出去（这条业务线没人可分），留在新线索待分配：告诉市场管理、销售管理、总管理员（A7 / A10） */
export async function 发待分配提醒(org: 组织, 线索: string[], 谁建的: string, 为什么: string, 今 = new Date()): Promise<void> {
  await 发满额提醒(org, 线索, 谁建的, 今, { 原因: "待分配", 为什么 });
}

/** 关掉我自己的一条；不在（关过了、id 不对）当关好了 */
export async function 关掉满额提醒(userId: string, id: string): Promise<void> {
  const 变了 = await 查完再写(async (tx) => {
    const 行 = await tx.setting.findUnique({ where: { key: 键(userId) } });
    const 现在 = 解析(行?.value);
    const 新 = 现在.filter((x) => x.id !== id);
    if (新.length === 现在.length) return false;
    await tx.setting.update({ where: { key: 键(userId) }, data: { value: JSON.stringify(新) } });
    return true;
  });
  if (变了) invalidateSettingsCache();
}

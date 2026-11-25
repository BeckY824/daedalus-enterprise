/**
 * 企业版站内通知（2026-11-01，表 EntNotice / migrations/109）。
 *
 * notify(userIds, {kind, title, body, link, key})：给这几位各记一条，然后在后台试着推飞书（feishu-push.ts）。
 * - 只在企业版写；别的版本直接返回
 * - 同一人同一 key 只记一行：重复调用（双击、重试、两处都触发）不会重复提醒，也不会重复推；走 upsert，不靠撞唯一约束（不刷 prisma:error）
 *   key 不传时按内容 + 当前这一分钟算，挡住同一刻的重复调用；按事件区分的调用方自己传 key
 * - 写库、推送出任何错都只记日志，从不往外抛：通知不能挡住分配、验证这些主流程
 * - 标题、正文里像手机号 / 电话的数字串写库前一律打码（notice-mask.ts，P-转-12「提醒里不带手机号」，站内和飞书同一份）；
 *   这是兜底，客户名就是号码的也靠它。各处通知自己的文案照样不放号码，别只靠这一层
 */
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 推通知们 } from "@/lib/enterprise/feishu-push";
import { 通知文字打码 } from "./notice-mask";
import { 市场进不了详情的 } from "./market-view-db";

export type 通知 = {
  /** 来源：自动分配 / 分配 / 验证 / 邀请 / 卡点 / 交接 / 满额 / 待分配 / 回收 / 将回收 / 跟进到期 / 跟进逾期 */
  kind: string;
  title: string;
  body?: string;
  /** 站内相对路径，如 /projects/xxx */
  link?: string | null;
  /** 去重键：同一人同一 key 只记一次 */
  key?: string;
  /** 只记站内、不推飞书（三态「让同事结束项目」：飞书只推三级提醒链上的人，M-公海-33） */
  不推飞书?: boolean;
};

const 在推 = new Set<Promise<void>>();

/** 测试用：等后台的飞书推送都跑完 */
export async function 等通知推完(): Promise<void> {
  while (在推.size) await Promise.all([...在推]);
}

function 默认键(n: 通知): string {
  const 分钟 = Math.floor(Date.now() / 60_000);
  return `auto:${createHash("sha1").update(`${n.kind}\n${n.title}\n${n.body ?? ""}\n${n.link ?? ""}`).digest("hex").slice(0, 16)}:${分钟}`;
}

const 是重复 = (e: unknown) => (e as { code?: string })?.code === "P2002";

/** 记下通知，返回新记的条数（重复的不算）。从不抛 */
export async function notify(userIds: readonly (string | null | undefined)[], n: 通知): Promise<number> {
  if (!企业版()) return 0;
  const 们 = [...new Set(userIds.filter((u): u is string => typeof u === "string" && u !== ""))];
  if (!们.length || !n.title.trim()) return 0;
  const key = n.key ?? 默认键(n);
  const title = 通知文字打码(n.title).slice(0, 200);
  const body = 通知文字打码(n.body ?? "").slice(0, 2000);
  const 新的: string[] = [];
  for (const userId of 们) {
    try {
      // 不用 create 撞唯一约束来去重（11-26）：撞上时 Prisma 自己先打一条 prisma:error 再抛 P2002，
      // 「快轮到」每次分配都按同一轮的键再试一遍、同一分钟重复交也一样，服务日志、CI 日志里刷满这句（其实已被吞掉、不影响保存）。
      // upsert + update 空：Prisma 在 SQLite 上是 BEGIN IMMEDIATE 里先查再写，同一人同一键已有就原样返回那一行、不报错；
      // 先定好新行的 id，回来的是它才算新记的（是旧行的 id = 这条早就发过）
      const id = randomUUID();
      const r = await prisma.entNotice.upsert({
        where: { userId_dedupeKey: { userId, dedupeKey: key } },
        create: { id, userId, kind: n.kind, title, body, link: n.link ?? null, dedupeKey: key },
        update: {},
        select: { id: true },
      });
      if (r.id === id) 新的.push(r.id);
    } catch (e) {
      if (!是重复(e)) console.warn("[通知] 没记上：", e instanceof Error ? e.message : e);
    }
  }
  if (新的.length && !n.不推飞书) {
    const p: Promise<void> = 推通知们(新的).finally(() => 在推.delete(p));
    在推.add(p);
  }
  return 新的.length;
}

/* ───────────────────────── 铃铛读写（按人） ───────────────────────── */

export type 通知行 = {
  id: string; kind: string; title: string; body: string; link: string | null; read: boolean; createdAt: string;
  /** 这条带「放弃（豁免）」、且此刻我还能放弃那条线索（notice-actions.ts 读我的通知 现判，11-21）：那条项目 id；铃铛原地弹放弃框 */
  放弃项目?: string;
};

export async function 我的通知(userId: string, 条数 = 30): Promise<通知行[]> {
  const 行们 = await prisma.entNotice.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(1, 条数), 100),
    select: { id: true, kind: true, title: true, body: true, link: true, readAt: true, createdAt: true },
  });
  // 市场角色：链到「已分给圈外的人」的项目详情的，改链项目列表（那一行在列表里看进度，详情页本来也挡，11-04 P-看-06）
  // 带 ?giveup=1 的（分到我的线索、超时提醒，11-21）同样认：挡了就改链项目列表，参数一起丢
  const 项目id = (link: string | null) => /^\/projects\/([^/?#]+)(?:\?[^#]*)?$/.exec(link ?? "")?.[1];
  const ids = 行们.map((r) => 项目id(r.link)).filter((x): x is string => !!x).map((x) => decodeURIComponent(x));
  const 挡 = ids.length ? await 市场进不了详情的(userId, ids) : new Set<string>();
  const 链 = (link: string | null) => {
    const id = 项目id(link);
    return id && 挡.has(decodeURIComponent(id)) ? "/projects" : link;
  };
  return 行们.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: 链(r.link), read: r.readAt !== null, createdAt: r.createdAt.toISOString() }));
}

export async function 未读通知数(userId: string): Promise<number> {
  return prisma.entNotice.count({ where: { userId, readAt: null } });
}

/** 只能标自己的 */
export async function 标通知已读(userId: string, id: string): Promise<void> {
  await prisma.entNotice.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
}

export async function 全部通知已读(userId: string): Promise<number> {
  const r = await prisma.entNotice.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  return r.count;
}

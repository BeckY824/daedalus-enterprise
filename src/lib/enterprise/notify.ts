/**
 * 企业版站内通知（2026-11-01，表 EntNotice / migrations/109）。
 *
 * notify(userIds, {kind, title, body, link, key})：给这几位各记一条，然后在后台试着推飞书（feishu-push.ts）。
 * - 只在企业版写；别的版本直接返回
 * - 同一人同一 key 只记一行：重复调用（双击、重试、两处都触发）不会重复提醒，也不会重复推
 *   key 不传时按内容 + 当前这一分钟算，挡住同一刻的重复调用；按事件区分的调用方自己传 key
 * - 写库、推送出任何错都只记日志，从不往外抛：通知不能挡住分配、验证这些主流程
 */
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 推通知们 } from "@/lib/enterprise/feishu-push";

export type 通知 = {
  /** 来源：自动分配 / 分配 / 验证 / 邀请 / 卡点 / 交接 / 满额 / 回收 / 跟进到期 */
  kind: string;
  title: string;
  body?: string;
  /** 站内相对路径，如 /projects/xxx */
  link?: string | null;
  /** 去重键：同一人同一 key 只记一次 */
  key?: string;
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
  const 新的: string[] = [];
  for (const userId of 们) {
    try {
      const r = await prisma.entNotice.create({
        data: { userId, kind: n.kind, title: n.title.slice(0, 200), body: (n.body ?? "").slice(0, 2000), link: n.link ?? null, dedupeKey: key },
        select: { id: true },
      });
      新的.push(r.id);
    } catch (e) {
      if (!是重复(e)) console.warn("[通知] 没记上：", e instanceof Error ? e.message : e);
    }
  }
  if (新的.length) {
    const p: Promise<void> = 推通知们(新的).finally(() => 在推.delete(p));
    在推.add(p);
  }
  return 新的.length;
}

/* ───────────────────────── 铃铛读写（按人） ───────────────────────── */

export type 通知行 = { id: string; kind: string; title: string; body: string; link: string | null; read: boolean; createdAt: string };

export async function 我的通知(userId: string, 条数 = 30): Promise<通知行[]> {
  const 行们 = await prisma.entNotice.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(1, 条数), 100),
    select: { id: true, kind: true, title: true, body: true, link: true, readAt: true, createdAt: true },
  });
  return 行们.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, read: r.readAt !== null, createdAt: r.createdAt.toISOString() }));
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

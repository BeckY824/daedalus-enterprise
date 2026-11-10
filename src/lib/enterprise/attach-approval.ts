/**
 * 企业版挂靠审批（2026-11-10，机制表 P-挂靠-02 / P-看-13）。
 *
 * 撞号台账（EntDupeHit）里点了「申请挂靠」、状态待处理的那一行就是一条挂靠申请（dupe-ledger.ts 申请挂靠 写进来）：
 *   - 审批人：申请那一刻定 = 客户负责人；负责人已离职 = 他手填的直属上级（同 4E 通知的口径）。
 *   - 24 小时没人处理：转给负责人的实线上级（直属上级，手填的那位），通知他；只转一次。转过之后只有新审批人能批，原负责人不能再批。
 *     没有上级可转（没填、停用了、上级就是现在的审批人）= 审批人不变，也记上转过的时刻，不再每分钟扫它。
 *   - 批准：客户负责人不变、不加项目组；申请人拿这家客户的只读卡（P-看-13，customer-readonly-card.ts 同一张卡），通知客户负责人（批的就是他自己就不发）。
 *   - 批准 / 拒绝都告诉申请人一声（站内通知）。
 *   - 只读卡：客户资料 + 联系人姓名、职务；只有申请人自己项目上的联系人给联系方式；不给负责人、级别、状态；
 *     不进客户列表、搜索、导出（限定层不动），只从「挂靠申请」页点开时取。客户进了公海、删了就不开。
 *
 * 超时转上级挂在夜扫那个钟上（lib/project/nightly.ts），每分钟看一眼；切换视图里跳过；任何错只记日志，从不往外抛。
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 企业版 } from "./switch";
import { 读组织 } from "./org";
import { 直属上级of, type 组织 } from "./org-core";
import { notify } from "./notify";
import { 视图中跳过 } from "./view-as";
import { 读卡底子, 拼卡, type 客户只读卡 } from "./customer-readonly-card";
import type { 谁 } from "./permissions";

export const 挂靠超时小时 = 24;
const 小时毫秒 = 3_600_000;
const 申请 = { action: "申请挂靠" } as const;
export const 挂靠页 = "/projects/attach";

/** 申请那一刻的审批人：负责人在职 = 他；离职了 = 他手填的直属上级（在职的）；都没有 = null */
export function 挂靠审批人(org: 组织, ownerId: string | null): string | null {
  if (!ownerId) return null;
  if (org.成员.has(ownerId)) return ownerId;
  const 上 = org.离职上级?.get(ownerId);
  return 上 && org.成员.has(上) ? 上 : null;
}

/** 负责人的实线上级（转审批用）：在职负责人 = 直属上级；离职负责人 = 他手填的直属上级 */
function 实线上级(org: 组织, ownerId: string | null): string | null {
  if (!ownerId) return null;
  if (org.成员.has(ownerId)) return 直属上级of(org, ownerId);
  return 挂靠审批人(org, ownerId);
}

async function 名字们(ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const 们 = [...new Set(ids.filter((x): x is string => !!x))];
  if (!们.length) return new Map();
  const us = await prisma.user.findMany({ where: { id: { in: 们 } }, select: { id: true, name: true } });
  return new Map(us.map((u) => [u.id, u.name]));
}

async function 客户名们(ids: readonly string[]): Promise<Map<string, string>> {
  const 们 = [...new Set(ids)];
  if (!们.length) return new Map();
  const cs = await 看全部(() => prisma.customer.findMany({ where: { id: { in: 们 } }, select: { id: true, name: true } }));
  return new Map(cs.map((c) => [c.id, c.name]));
}

export type 待审批挂靠 = {
  id: string;
  申请人: string;
  客户名: string;
  /** 撞的是什么：「手机号：138…」 */
  撞的: string;
  负责人: string;
  申请时间: Date;
  /** 24 小时没处理、从负责人那转过来的 */
  转来的: boolean;
};

/** 等我审批的（我是当前审批人、还待处理） */
export async function 待我审批的挂靠(me: 谁): Promise<待审批挂靠[]> {
  if (!企业版()) return [];
  const 行们 = await prisma.entDupeHit.findMany({
    where: { ...申请, status: "待处理", approverId: me.id },
    orderBy: { actionAt: "asc" },
    take: 200,
  });
  const [org, 人, 客户] = await Promise.all([读组织(), 名字们(行们.flatMap((r) => [r.userId, r.ownerId])), 客户名们(行们.map((r) => r.customerId))]);
  return 行们.map((r) => ({
    id: r.id,
    申请人: 人.get(r.userId) ?? "",
    客户名: 客户.get(r.customerId) ?? "",
    撞的: `${r.keyType}：${r.keyValue}`,
    负责人: (r.ownerId && 人.get(r.ownerId)) || "",
    申请时间: r.actionAt ?? r.createdAt,
    转来的: !!r.escalatedAt && r.approverId !== 挂靠审批人(org, r.ownerId),
  }));
}

export type 我的挂靠 = {
  id: string;
  /** 批准了才给；没批准前只有按客户名撞上的给（撞的时候就露出过名字），按号码撞上的不给 */
  客户名: string | null;
  撞的: string;
  状态: "待审批" | "已批准" | "没批准";
  申请时间: Date;
  处理时间: Date | null;
};

/** 我申请过的（每条申请一行；同一客户重复点的不算） */
export async function 我的挂靠申请(me: 谁): Promise<我的挂靠[]> {
  if (!企业版()) return [];
  const 行们 = await prisma.entDupeHit.findMany({
    where: { ...申请, userId: me.id, status: { in: ["待处理", "已批准", "已拒绝"] } },
    orderBy: { actionAt: "desc" },
    take: 200,
  });
  const 客户 = await 客户名们(行们.map((r) => r.customerId));
  return 行们.map((r) => {
    const 状态 = r.status === "已批准" ? "已批准" : r.status === "已拒绝" ? "没批准" : "待审批";
    return {
      id: r.id,
      客户名: 状态 === "已批准" || r.keyType === "客户名" ? 客户.get(r.customerId) ?? null : null,
      撞的: `${r.keyType}：${r.keyValue}`,
      状态,
      申请时间: r.actionAt ?? r.createdAt,
      处理时间: r.decidedAt,
    };
  });
}

/** 批准 / 拒绝。只有当前审批人能批；并发两人同时点，只认先到的那一下 */
export async function 审批挂靠(me: { id: string; name: string }, 撞号id: string, 批: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!企业版()) return { ok: false, error: "企业版才有挂靠审批" };
  const 行 = await prisma.entDupeHit.findUnique({ where: { id: 撞号id } });
  if (!行 || 行.action !== 申请.action || 行.approverId !== me.id) return { ok: false, error: "找不到这条挂靠申请，可能已转给别人审批" };
  if (行.status !== "待处理") return { ok: false, error: "这条挂靠申请已经处理过了" };
  const 现在 = new Date();
  const r = await prisma.entDupeHit.updateMany({
    where: { id: 行.id, status: "待处理", approverId: me.id },
    data: { status: 批 ? "已批准" : "已拒绝", decidedById: me.id, decidedAt: 现在 },
  });
  if (!r.count) return { ok: false, error: "这条挂靠申请刚被处理过了，刷新看看" };

  const [org, 客户, 人] = await Promise.all([读组织(), 客户名们([行.customerId]), 名字们([行.userId])]);
  const 客户名 = 客户.get(行.customerId) ?? "";
  if (org.成员.has(行.userId)) {
    await notify([行.userId], {
      kind: "挂靠",
      title: 批 ? `挂靠申请已批准：客户「${客户名}」` : `挂靠申请没批准：客户「${客户名}」`,
      body: 批 ? `${me.name} 批准了。客户负责人不变，你可以在「挂靠申请」里打开这家客户的只读卡` : `${me.name} 没批准这次挂靠申请`,
      link: 挂靠页,
      key: `挂靠结果:${行.id}`,
    });
  }
  // P-挂靠-02：批准后通知客户负责人（他自己批的不用再告诉他）
  if (批 && 行.ownerId && 行.ownerId !== me.id && org.成员.has(行.ownerId)) {
    await notify([行.ownerId], {
      kind: "挂靠",
      title: `${me.name} 批准了 ${人.get(行.userId) ?? ""} 挂靠你负责的客户「${客户名}」`,
      body: "客户负责人还是你；对方只拿到这家客户的只读卡（客户资料和联系人姓名、职务）",
      link: 挂靠页,
      key: `挂靠批准:${行.id}`,
    });
  }
  return { ok: true };
}

/** 夜扫的钟上每分钟一次：申请等了 24 小时还待处理的，转给负责人的实线上级。回新转了几条 */
export async function 挂靠超时转上级(现在: Date = new Date()): Promise<number> {
  if (!企业版()) return 0;
  try {
    if (await 视图中跳过()) return 0;
    const 截止 = new Date(现在.getTime() - 挂靠超时小时 * 小时毫秒);
    const 行们 = await prisma.entDupeHit.findMany({
      where: { ...申请, status: "待处理", escalatedAt: null, actionAt: { lte: 截止 } },
      take: 200,
    });
    if (!行们.length) return 0;
    const org = await 读组织();
    const [人, 客户] = await Promise.all([名字们(行们.flatMap((r) => [r.userId, r.ownerId])), 客户名们(行们.map((r) => r.customerId))]);
    let n = 0;
    for (const 行 of 行们) {
      const 上 = 实线上级(org, 行.ownerId);
      const 转 = !!上 && 上 !== 行.approverId;
      const r = await prisma.entDupeHit.updateMany({
        where: { id: 行.id, status: "待处理", escalatedAt: null },
        data: { escalatedAt: 现在, ...(转 ? { approverId: 上 } : {}) },
      });
      if (!r.count || !转) continue;
      n++;
      await notify([上], {
        kind: "挂靠",
        title: `挂靠申请 ${挂靠超时小时} 小时没人处理，转给你审批：客户「${客户.get(行.customerId) ?? ""}」`,
        body: `${人.get(行.userId) ?? ""} 申请挂靠 ${(行.ownerId && 人.get(行.ownerId)) || "已离职同事"} 负责的这位客户，负责人 ${挂靠超时小时} 小时没处理。到「挂靠申请」里批准或拒绝`,
        link: 挂靠页,
        key: `挂靠升级:${行.id}`,
      });
    }
    return n;
  } catch (e) {
    console.error("[挂靠审批] 超时转上级出错，下一遍再试", e);
    return 0;
  }
}

/** 批准后申请人点开的只读卡（P-看-13）：只认申请人本人、已批准、客户没进公海没删。不让看 = null */
export async function 读挂靠只读卡(me: 谁, 撞号id: string): Promise<客户只读卡 | null> {
  if (!企业版()) return null;
  const 行 = await prisma.entDupeHit.findUnique({ where: { id: 撞号id } });
  if (!行 || 行.userId !== me.id || 行.action !== 申请.action || 行.status !== "已批准") return null;
  // 联系方式只给申请人自己项目上的联系人
  const 底 = await 读卡底子(行.customerId, me.id);
  if (!底 || 底.在公海) return null;
  return 拼卡(me, 行.customerId, 底);
}

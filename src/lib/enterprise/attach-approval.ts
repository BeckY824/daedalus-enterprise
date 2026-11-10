/**
 * 企业版挂靠审批（2026-11-10，机制表 P-挂靠-02 / P-看-13）。
 *
 * 撞号台账（EntDupeHit）里点了「申请挂靠」、状态待处理的那一行就是一条挂靠申请（dupe-ledger.ts 申请挂靠 写进来）：
 *   - 审批人 = 客户现在的负责人（Customer.salesOwnerId），不是申请那一刻的：客户换负责人（转让、交接、离职交接、公海领取 / 分配、撤销）
 *     时，还没转过上级的待处理申请跟着换到新负责人（owner-log-db.ts 记换负责人 / 删被撤的换负责人记录，换负责人的几条路都走那两处）。
 *     负责人已离职也还是他；审批人已停用的，下一遍扫就按没人往上找（11-10 新口径），不等 24 小时。
 *   - 24 小时没人处理：转给现审批人的实线上级（直属上级；离职的 = 他手填的那位），通知他。转过之后只有新审批人能批，原负责人不能再批，
 *     之后客户再换负责人也不跟着换。没有上级、上级停用了 → 给总管理（director）；转过之后再满 24 小时接着往上，到总管理为止，不作废（11-10 新口径，见 挂靠超时转上级）。
 *   - 批准：客户负责人不变、不加项目组；申请人拿这家客户的只读卡（P-看-13，customer-readonly-card.ts 同一张卡），通知客户现在的负责人（批的就是他自己就不发）。
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
import { 挂靠进公海状态 } from "@/lib/owner-log-db";
import { recordAudit } from "@/lib/audit";
import { 系统 } from "@/lib/project/timeout";

export const 挂靠超时小时 = 24;
const 小时毫秒 = 3_600_000;
const 申请 = { action: "申请挂靠" } as const;
export const 挂靠页 = "/projects/attach";

/** 负责人的实线上级（转审批用）：在职负责人 = 直属上级；离职负责人 = 他手填的直属上级（在职的）；都没有 = null */
function 实线上级(org: 组织, ownerId: string | null): string | null {
  if (!ownerId) return null;
  if (org.成员.has(ownerId)) return 直属上级of(org, ownerId);
  const 上 = org.离职上级?.get(ownerId);
  return 上 && org.成员.has(上) ? 上 : null;
}

async function 名字们(ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const 们 = [...new Set(ids.filter((x): x is string => !!x))];
  if (!们.length) return new Map();
  const us = await prisma.user.findMany({ where: { id: { in: 们 } }, select: { id: true, name: true } });
  return new Map(us.map((u) => [u.id, u.name]));
}

/** 客户名和客户现在的负责人 */
async function 客户们(ids: readonly string[]): Promise<Map<string, { 名: string; 负责人: string }>> {
  const 们 = [...new Set(ids)];
  if (!们.length) return new Map();
  const cs = await 看全部(() => prisma.customer.findMany({ where: { id: { in: 们 } }, select: { id: true, name: true, salesOwnerId: true } }));
  return new Map(cs.map((c) => [c.id, { 名: c.name, 负责人: c.salesOwnerId }]));
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
  const 客户 = await 客户们(行们.map((r) => r.customerId));
  const 人 = await 名字们(行们.flatMap((r) => [r.userId, 客户.get(r.customerId)?.负责人 ?? null]));
  return 行们.map((r) => {
    const 负责人 = 客户.get(r.customerId)?.负责人 ?? null;
    return {
      id: r.id,
      申请人: 人.get(r.userId) ?? "",
      客户名: 客户.get(r.customerId)?.名 ?? "",
      撞的: `${r.keyType}：${r.keyValue}`,
      负责人: (负责人 && 人.get(负责人)) || "",
      申请时间: r.actionAt ?? r.createdAt,
      转来的: !!r.escalatedAt && r.approverId !== 负责人,
    };
  });
}

export type 我的挂靠 = {
  id: string;
  /** 批准了才给；没批准前只有按客户名撞上的给（撞的时候就露出过名字），按号码撞上的不给 */
  客户名: string | null;
  撞的: string;
  状态: "待审批" | "已批准" | "没批准" | "客户已进公海";
  申请时间: Date;
  处理时间: Date | null;
};

/** 我申请过的（每条申请一行；同一客户重复点的不算） */
export async function 我的挂靠申请(me: 谁): Promise<我的挂靠[]> {
  if (!企业版()) return [];
  const 行们 = await prisma.entDupeHit.findMany({
    where: { ...申请, userId: me.id, status: { in: ["待处理", "已批准", "已拒绝", 挂靠进公海状态] } },
    orderBy: { actionAt: "desc" },
    take: 200,
  });
  const 客户 = await 客户们(行们.map((r) => r.customerId));
  return 行们.map((r) => {
    const 状态 = r.status === "已批准" ? "已批准" : r.status === "已拒绝" ? "没批准" : r.status === 挂靠进公海状态 ? 挂靠进公海状态 : "待审批";
    return {
      id: r.id,
      客户名: 状态 === "已批准" || r.keyType === "客户名" ? 客户.get(r.customerId)?.名 ?? null : null,
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

  const [org, 客户, 人] = await Promise.all([读组织(), 客户们([行.customerId]), 名字们([行.userId])]);
  const 客户名 = 客户.get(行.customerId)?.名 ?? "";
  const 负责人 = 客户.get(行.customerId)?.负责人 ?? null;
  if (org.成员.has(行.userId)) {
    await notify([行.userId], {
      kind: "挂靠",
      title: 批 ? `挂靠申请已批准：客户「${客户名}」` : `挂靠申请没批准：客户「${客户名}」`,
      body: 批 ? `${me.name} 批准了。客户负责人不变，你可以在「挂靠申请」里打开这家客户的只读卡` : `${me.name} 没批准这次挂靠申请`,
      link: 挂靠页,
      key: `挂靠结果:${行.id}`,
    });
  }
  // P-挂靠-02：批准后通知客户现在的负责人（他自己批的不用再告诉他）
  if (批 && 负责人 && 负责人 !== me.id && org.成员.has(负责人)) {
    await notify([负责人], {
      kind: "挂靠",
      title: `${me.name} 批准了 ${人.get(行.userId) ?? ""} 挂靠你负责的客户「${客户名}」`,
      body: "客户负责人还是你；对方只拿到这家客户的只读卡（客户资料和联系人姓名、职务）",
      link: 挂靠页,
      key: `挂靠批准:${行.id}`,
    });
  }
  return { ok: true };
}

/**
 * 客户进公海时关掉的挂靠申请（owner-log-db.ts 挂靠申请进公海关，P-挂靠-01 / 02）：给申请人各发一条「客户已进公海，可去公海领取」。
 * 调用方在进公海那笔事务提交后调，传这次进公海的客户；按客户找出刚关的（近 1 小时），key 按申请行，重调不重发。
 * 只发在职成员；客户名同「我的挂靠申请」：按客户名撞上的才写名字，按号码撞上的写撞的号码
 */
export async function 进公海挂靠通知(customerIds: readonly string[]): Promise<void> {
  if (!企业版() || !customerIds.length) return;
  const 关的 = await prisma.entDupeHit.findMany({
    where: { ...申请, customerId: { in: [...new Set(customerIds)] }, status: 挂靠进公海状态, decidedAt: { gte: new Date(Date.now() - 小时毫秒) } },
    select: { id: true, userId: true, customerId: true, keyType: true, keyValue: true },
  });
  if (!关的.length) return;
  const [org, 客户] = await Promise.all([读组织(), 客户们(关的.map((r) => r.customerId))]);
  for (const r of 关的) {
    if (!org.成员.has(r.userId)) continue;
    const 哪家 = r.keyType === "客户名" ? `客户「${客户.get(r.customerId)?.名 ?? r.keyValue}」` : `撞到的客户（${r.keyType}：${r.keyValue}）`;
    await notify([r.userId], {
      kind: "挂靠",
      title: `挂靠申请已关闭：${哪家}已进公海`,
      body: "客户进了公海，没有负责人审批这次挂靠；要跟这家客户，可去公海领取",
      link: "/pool",
      key: `挂靠进公海:${r.id}`,
    });
  }
}

/**
 * 存量回填（迁移 117 之前就待处理的申请没有审批人）：补成客户现在的负责人。迁移目录不许 UPDATE（tests/migrations.test.ts），
 * 所以放在每分钟那一遍的开头；只认审批人为空、还没转过上级的，补过一次就不再命中，可重复跑。回补了几条
 */
export async function 补挂靠审批人(): Promise<number> {
  const 行们 = await prisma.entDupeHit.findMany({
    where: { ...申请, status: "待处理", approverId: null, escalatedAt: null },
    select: { id: true, customerId: true },
    take: 500,
  });
  if (!行们.length) return 0;
  const 客户 = await 客户们(行们.map((r) => r.customerId));
  let n = 0;
  for (const r of 行们) {
    const 负责人 = 客户.get(r.customerId)?.负责人;
    if (!负责人) continue;
    n += (await prisma.entDupeHit.updateMany({ where: { id: r.id, approverId: null, status: "待处理", escalatedAt: null }, data: { approverId: 负责人 } })).count;
  }
  return n;
}

/** 在职的总管理（业务角色 director；只读管理员 admin 不算）。几位时先同业务线的、再没设业务线的，同档按 id 排，每次挑到同一位 */
function 总管理of(org: 组织, line: string | null, 排除: string | null): string | null {
  const 档 = (m: { line: string | null }) => (line && m.line === line ? 0 : m.line === null ? 1 : 2);
  const 们 = [...org.成员.values()].filter((m) => m.角色们.includes("director") && m.userId !== 排除);
  们.sort((a, b) => 档(a) - 档(b) || (a.userId < b.userId ? -1 : 1));
  return 们[0]?.userId ?? null;
}

/**
 * 超时了该转给谁（11-10 新口径）：现审批人的实线直属上级；没有上级、上级已停用 → 总管理；现审批人已是在职总管理 → 到顶，回 null。
 * 现审批人已停用 = 按没人算：他手填的上级还在职给上级，否则给总管理。没有在职总管理可给也回 null（原样不动，下一遍再看）
 */
export function 挂靠下一位审批人(org: 组织, 现审批人: string | null): string | null {
  const m = 现审批人 ? org.成员.get(现审批人) : undefined;
  if (m?.角色们.includes("director")) return null;
  const 上 = 实线上级(org, 现审批人);
  if (上 && 上 !== 现审批人) return 上;
  return 总管理of(org, m?.line ?? null, 现审批人);
}

/**
 * 夜扫的钟上每分钟一次：先补存量审批人；再把超时的申请往上转一级（P-挂靠-02，11-10 新口径）：
 *   - 等了 24 小时还待处理 → 转给现审批人的实线直属上级；没有上级、上级已停用 → 总管理；
 *   - 转过之后再满 24 小时（从上次转的时刻算）还没人处理 → 接着往上，直到总管理；到了总管理就停在他那，不作废；
 *   - 现审批人已停用 → 不等 24 小时，这一遍就往上找；
 *   - 按「状态、审批人、上次转的时刻都没变」条件写（命中 0 行 = 刚被人批了 / 换了审批人，跳过，不通知不留痕）；
 *   - 每转一级通知新审批人一次（key 带新审批人）、记一条操作日志（记在「系统」名下）。
 * 回新转了几条
 */
export async function 挂靠超时转上级(现在: Date = new Date()): Promise<number> {
  if (!企业版()) return 0;
  try {
    if (await 视图中跳过()) return 0;
    await 补挂靠审批人();
    const org = await 读组织();
    const 截止 = new Date(现在.getTime() - 挂靠超时小时 * 小时毫秒);
    const 在职 = [...org.成员.keys()];
    const 行们 = await prisma.entDupeHit.findMany({
      where: {
        ...申请,
        status: "待处理",
        OR: [{ escalatedAt: null, actionAt: { lte: 截止 } }, { escalatedAt: { lte: 截止 } }, { approverId: { notIn: 在职 } }],
      },
      orderBy: { actionAt: "asc" },
      take: 500,
    });
    if (!行们.length) return 0;
    const 客户 = await 客户们(行们.map((r) => r.customerId));
    const 人 = await 名字们(行们.flatMap((r) => [r.userId, r.approverId, 客户.get(r.customerId)?.负责人 ?? null]));
    let n = 0;
    for (const 行 of 行们) {
      // 客户删了查不到：没有可审批的对象，不转
      if (!客户.has(行.customerId)) continue;
      const 上 = 挂靠下一位审批人(org, 行.approverId);
      if (!上) continue;
      const r = await prisma.entDupeHit.updateMany({
        where: { id: 行.id, status: "待处理", approverId: 行.approverId, escalatedAt: 行.escalatedAt },
        data: { escalatedAt: 现在, approverId: 上 },
      });
      if (!r.count) continue;
      n++;
      const 客户名 = 客户.get(行.customerId)?.名 ?? "";
      const 负责人 = 客户.get(行.customerId)?.负责人 ?? null;
      const 原 = 行.approverId ? (人.get(行.approverId) ?? "") : "";
      const 原停用 = !!行.approverId && !org.成员.has(行.approverId);
      const 上名 = (await 名字们([上])).get(上) ?? "";
      await recordAudit({
        user: 系统, action: "assign", entity: "EntDupeHit", entityId: 行.id,
        summary: `挂靠申请（客户「${客户名}」）${原停用 ? `审批人「${原}」已停用` : `${挂靠超时小时} 小时没人处理`}，审批人从「${原 || "（没有）"}」转给「${上名}」`,
        detail: { 挂靠申请: 行.id, customerId: 行.customerId, 申请人: 行.userId, 原审批人: 行.approverId, 新审批人: 上, 原因: 原停用 ? "审批人已停用" : "超时" },
      });
      await notify([上], {
        kind: "挂靠",
        title: `挂靠申请${原停用 ? "的审批人已停用" : ` ${挂靠超时小时} 小时没人处理`}，转给你审批：客户「${客户名}」`,
        body: `${人.get(行.userId) ?? ""} 申请挂靠 ${(负责人 && 人.get(负责人)) || "已离职同事"} 负责的这位客户，${原停用 ? "原审批人已停用" : `${原 || "原审批人"} ${挂靠超时小时} 小时没处理`}。到「挂靠申请」里批准或拒绝`,
        link: 挂靠页,
        key: `挂靠升级:${行.id}:${上}`,
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

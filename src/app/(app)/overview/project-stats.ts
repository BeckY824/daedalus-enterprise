import { prisma } from "@/lib/prisma";
import { 成员选项 } from "@/lib/utils";
import { 阶段们, 节点们, 结局们, type 阶段 } from "@/lib/project/nodes";
import { bucketOf, 刻度们, type 粒度 } from "./data";
import { 项目漏斗of, type 漏斗格 } from "./funnel";

/**
 * 企业版只用项目时「数据」页的数（10-26 用户：「「数据」页改成按项目统计」，线索 / 商机 / 订单是项目的三大阶段）。
 *
 * 看得到哪些项目不在这里管：prisma 外面那层（lib/team-scope）已经按人限定了 project 的查询。
 * 金额只算本位币，不换汇（和签约复盘同一个理由：折出来的数说不清按哪天的汇率）；外币的另外数一下告诉人。
 */

export type 节点格 = { phase: 阶段; node: string; count: number; amount: number };
export type 人行现在 = { id: string; name: string; 线索: number; 商机: number; 订单: number; 商机金额: number; 订单金额: number };

export type 项目现在 = {
  阶段: { phase: 阶段; count: number; amount: number }[];
  节点: 节点格[];
  /** 已经有结局的，各几个（不限时间） */
  结局: { result: string; count: number }[];
  公海: number;
  按人: 人行现在[];
  /** 进行中但不是本位币的，金额没算进来 */
  外币: number;
  /** 全周期漏斗：看得到的全部项目（含已结束的）走到了哪一步（funnel.ts） */
  漏斗: 漏斗格[];
};

/** 进行中 = 还没有结局 */
export async function 项目现在(本位币: string): Promise<项目现在> {
  const rows = await prisma.project.findMany({ select: { phase: true, node: true, result: true, amount: true, currency: true, ownerId: true, pooledAt: true } });
  const 进行中 = rows.filter((p) => !p.result);
  const 钱 = (p: { amount: number; currency: string }) => (p.currency === 本位币 ? p.amount : 0);

  const 节点 = 阶段们.flatMap((phase) =>
    节点们[phase].map((node) => {
      const 这些 = 进行中.filter((p) => p.phase === phase && p.node === node);
      return { phase, node, count: 这些.length, amount: 这些.reduce((s, p) => s + 钱(p), 0) };
    }),
  );
  const 阶段 = 阶段们.map((phase) => {
    const 这些 = 进行中.filter((p) => p.phase === phase);
    return { phase, count: 这些.length, amount: 这些.reduce((s, p) => s + 钱(p), 0) };
  });

  // 公海里的不算在谁头上（负责人还是原来那个人，可人已经不管它了）
  const 人 = new Map<string, 人行现在>();
  for (const p of 进行中) {
    if (p.pooledAt) continue;
    const r = 人.get(p.ownerId) ?? { id: p.ownerId, name: "", 线索: 0, 商机: 0, 订单: 0, 商机金额: 0, 订单金额: 0 };
    if (p.phase === "线索") r.线索++;
    else if (p.phase === "商机") { r.商机++; r.商机金额 += 钱(p); }
    else if (p.phase === "订单") { r.订单++; r.订单金额 += 钱(p); }
    人.set(p.ownerId, r);
  }

  return {
    阶段,
    节点,
    结局: 结局们.map((result) => ({ result, count: rows.filter((p) => p.result === result).length })),
    公海: 进行中.filter((p) => p.pooledAt).length,
    按人: (await 起名(人)).sort((a, b) => b.商机金额 + b.订单金额 - (a.商机金额 + a.订单金额) || b.线索 + b.商机 + b.订单 - (a.线索 + a.商机 + a.订单)),
    外币: 进行中.filter((p) => p.currency !== 本位币 && p.amount > 0).length,
    漏斗: 项目漏斗of(rows),
  };
}

export type 段桶 = { label: string; 新建: number; 转商机: number; 转订单: number; 成功交付: number };
export type 人行一段 = { id: string; name: string; 新建: number; 转商机: number; 转订单: number; 成功交付: number; 交付金额: number; 没成: number };

export type 项目一段 = {
  合计: { 新建: number; 转商机: number; 转订单: number; 成功交付: number; 交付金额: number; 线索流失: number; 丢单: number; 异常状态: number };
  trend: 段桶[];
  按人: 人行一段[];
  /** 这一段成功交付的外币项目，金额没算进来 */
  外币: number;
  /**
   * 成交：这一段里转了订单、或成功交付结束的项目，一个项目只数一次（两样都有也只算一个）。
   * 企业版首页「本月成交」用它（10-28 去遗留 A4），不按客户签约数
   */
  成交: number;
  /** 漏斗：这一段新建的项目（同「新建」的 createdAt）现在走到了哪一步（funnel.ts） */
  漏斗: 漏斗格[];
};

/**
 * 一段时间里发生了什么。
 *   新建：项目建在这一段（createdAt）
 *   转商机 / 转订单：这一段里有一次从线索进商机 / 从商机进订单的节点变更（一个项目只数一次，来回改不重复算）
 *   成功交付 / 线索流失 / 丢单 / 异常状态：现在是这个结局、结束在这一段（closedAt）——后来又恢复了的不算
 * 按人拆按项目现在的负责人，不是当时的。
 */
export async function 项目一段(from: Date, to: Date, 粒: 粒度, 本位币: string): Promise<项目一段> {
  const 段 = { gte: from, lte: to };
  const [新, 变, 结] = await Promise.all([
    prisma.project.findMany({ where: { createdAt: 段 }, select: { id: true, ownerId: true, createdAt: true, phase: true, result: true } }),
    prisma.projectNodeLog.findMany({
      where: { kind: "node", at: 段, OR: [{ fromPhase: "线索", toPhase: "商机" }, { fromPhase: "商机", toPhase: "订单" }] },
      select: { projectId: true, fromPhase: true, at: true, project: { select: { ownerId: true } } },
      orderBy: { at: "asc" },
    }),
    prisma.project.findMany({ where: { result: { not: null }, closedAt: 段 }, select: { id: true, ownerId: true, result: true, closedAt: true, amount: true, currency: true } }),
  ]);

  const 桶 = new Map<string, 段桶>(刻度们(from, to, 粒).map((label) => [label, { label, 新建: 0, 转商机: 0, 转订单: 0, 成功交付: 0 }]));
  // 今天以后的刻度不铺；万一有日期写在以后的，也给它一个刻度，别让数凭空少掉
  const 进桶 = (d: Date, k: "新建" | "转商机" | "转订单" | "成功交付") => {
    const label = bucketOf(d, 粒);
    const b = 桶.get(label) ?? { label, 新建: 0, 转商机: 0, 转订单: 0, 成功交付: 0 };
    b[k]++;
    桶.set(label, b);
  };
  const 人 = new Map<string, 人行一段>();
  const 行 = (id: string) => {
    const r = 人.get(id) ?? { id, name: "", 新建: 0, 转商机: 0, 转订单: 0, 成功交付: 0, 交付金额: 0, 没成: 0 };
    人.set(id, r);
    return r;
  };

  for (const p of 新) {
    进桶(p.createdAt, "新建");
    行(p.ownerId).新建++;
  }
  const 数过 = new Set<string>();
  for (const l of 变) {
    const k = l.fromPhase === "线索" ? "转商机" : "转订单";
    if (数过.has(`${k}:${l.projectId}`)) continue;
    数过.add(`${k}:${l.projectId}`);
    进桶(l.at, k);
    行(l.project.ownerId)[k]++;
  }
  const 合计 = { 新建: 新.length, 转商机: 0, 转订单: 0, 成功交付: 0, 交付金额: 0, 线索流失: 0, 丢单: 0, 异常状态: 0 };
  for (const k of 数过) 合计[k.startsWith("转商机") ? "转商机" : "转订单"]++;
  let 外币 = 0;
  for (const p of 结) {
    const r = p.result as "成功交付" | "线索流失" | "丢单" | "异常状态";
    if (!(r in 合计)) continue;
    合计[r]++;
    if (r === "成功交付") {
      进桶(p.closedAt!, "成功交付");
      const 算 = p.currency === 本位币 ? p.amount : 0;
      if (p.currency !== 本位币 && p.amount > 0) 外币++;
      合计.交付金额 += 算;
      const x = 行(p.ownerId);
      x.成功交付++;
      x.交付金额 += 算;
    } else if (r === "线索流失" || r === "丢单") 行(p.ownerId).没成++;
  }

  const 成交了 = new Set<string>([
    ...[...数过].filter((k) => k.startsWith("转订单:")).map((k) => k.slice("转订单:".length)),
    ...结.filter((p) => p.result === "成功交付").map((p) => p.id),
  ]);

  return {
    合计,
    成交: 成交了.size,
    trend: [...桶.values()].sort((a, b) => a.label.localeCompare(b.label)),
    按人: (await 起名(人)).sort((a, b) => b.交付金额 - a.交付金额 || b.成功交付 - a.成功交付 || b.转订单 - a.转订单 || b.转商机 - a.转商机 || b.新建 - a.新建),
    外币,
    漏斗: 项目漏斗of(新),
  };
}

/** 填上名字；同名的带上邮箱分开，人已经删了的写「已不在的成员」 */
async function 起名<T extends { id: string; name: string }>(人: Map<string, T>): Promise<T[]> {
  const users = await prisma.user.findMany({ where: { id: { in: [...人.keys()] } }, select: { id: true, name: true, email: true } });
  const 标签 = new Map(成员选项(users).map((o) => [o.value, o.label]));
  return [...人.values()].map((r) => ({ ...r, name: 标签.get(r.id) ?? "已不在的成员" }));
}

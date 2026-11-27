/**
 * 回避名单根因（E-417 包 1，迁移 194）：给「现在在公海里」的项目和客户回填 poolPrevOwnerId（最近一次放进公海时的原负责人），
 * 以及上 c2 回填后用的对拍（旧算法的回避集合 vs 按列算的集合，必须完全相同）。脚本在 scripts/pool-prev-owner-backfill.ts、
 * scripts/pool-prev-owner-compare.ts，这里是可测的逻辑。
 *
 * 认法（同现在的读法，一律只认最近一次）：
 *   - 项目：最近一条 pool-release 的 fromOwnerId（空 = 导入时就没负责人，列留空）；在公海里（pooledAt 非空）的都算，含回收站里的（恢复后列是对的）
 *   - 客户：在公海里（有 CustomerPool 行）。负责人挂占位账号的：最近一条 pool-release（toOwnerId = 占位）的 fromOwnerId，
 *     合并客户挪来的不认；负责人还是真人的（M-公海-03 之前进公海、存量脚本没跑到的老数据）：写当前负责人
 * 只写 poolPrevOwnerId 这一列（updatedAt 原样写回，不刷）。逐行「读到的旧值和 updatedAt 没变才写」（compare-and-set）：跑的时候别人刚放进公海写了新值，就不覆盖。
 * 可以重复跑：值已经相同的跳过。
 */
import type { PrismaClient } from "@/generated/prisma";
import { 去掉合并挪来的 } from "./merge-moved-logs";
import { 无负责人占位邮箱 } from "@/lib/pool";

const 批 = 400;

export type 回填行 = {
  id: string;
  /** 库里现在的值 */
  现值: string | null;
  /** 应写的值；null = 没有原负责人可写（无留痕 / 留痕没记人） */
  应写: string | null;
  /** 读到这一行时的 updatedAt：写的时候原样写回（不刷成现在）并带进条件（这一行中间被别处改了就不覆盖） */
  更新于: Date;
  /** 放进公海的时刻（项目 pooledAt、客户 CustomerPool.at），做按日期的表 */
  进公海于: Date | null;
  /** 值从哪来，逐行日志用 */
  来源: string;
};
/**
 * 口径核对（只出数，不影响写）：在公海、挂占位账号的客户里，最近一条 toOwnerId = 占位（旧算法的取法，不限 kind）的 kind 不是 pool-release 的，按 kind 数。
 * 回填只认 pool-release；这个数是 0 两种口径一致，不是 0 对拍前就知道不一致是这几位
 */
export type 回填计划 = { 项目: 回填行[]; 客户: 回填行[]; 占位: string | null; 数于: Date; 占位非放回: { 位数: number; 按种类: Record<string, number> } };
export type 回填结果 = { 写了: number; 已相同跳过: number; 无可写: number; 并发跳过: number };

const 分段 = <T,>(a: T[], n: number): T[][] => {
  const 出: T[][] = [];
  for (let i = 0; i < a.length; i += n) 出.push(a.slice(i, i + n));
  return 出;
};

/** 算计划，不写库 */
export async function 算回填计划(db: PrismaClient): Promise<回填计划> {
  const 数于 = new Date();
  const 占位 = (await db.user.findUnique({ where: { email: 无负责人占位邮箱 }, select: { id: true } }))?.id ?? null;

  const 项目们 = await db.project.findMany({ where: { pooledAt: { not: null } }, select: { id: true, pooledAt: true, poolPrevOwnerId: true, updatedAt: true }, orderBy: { id: "asc" } });
  const 项目行: 回填行[] = [];
  for (const 段 of 分段(项目们, 批)) {
    const 留痕 = await db.projectNodeLog.findMany({
      where: { projectId: { in: 段.map((p) => p.id) }, kind: "pool-release" },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      select: { projectId: true, fromOwnerId: true },
    });
    const 最近 = new Map<string, string | null>();
    for (const l of 留痕) if (!最近.has(l.projectId)) 最近.set(l.projectId, l.fromOwnerId || null);
    for (const p of 段) {
      项目行.push({ id: p.id, 更新于: p.updatedAt, 现值: p.poolPrevOwnerId, 应写: 最近.get(p.id) ?? null, 进公海于: p.pooledAt, 来源: 最近.has(p.id) ? "最近一条 pool-release 的 from" : "没有 pool-release 留痕" });
    }
  }

  const 客户们 = await db.customer.findMany({ where: { pool: { isNot: null } }, select: { id: true, salesOwnerId: true, deletedAt: true, poolPrevOwnerId: true, updatedAt: true, pool: { select: { at: true } } }, orderBy: { id: "asc" } });
  const 客户行: 回填行[] = [];
  const 占位非放回 = { 位数: 0, 按种类: {} as Record<string, number> };
  for (const 段 of 分段(客户们, 批)) {
    const 挂占位 = 段.filter((c) => 占位 && c.salesOwnerId === 占位);
    const 最近 = new Map<string, string | null>();
    if (挂占位.length && 占位) {
      const 记录 = await 去掉合并挪来的(db, await db.customerOwnerLog.findMany({
        where: { customerId: { in: 挂占位.map((c) => c.id) }, toOwnerId: 占位, kind: "pool-release" },
        orderBy: [{ at: "desc" }, { id: "desc" }],
        select: { id: true, customerId: true, fromOwnerId: true },
      }));
      for (const r of 记录) if (!最近.has(r.customerId)) 最近.set(r.customerId, r.fromOwnerId || null);
      // 口径核对：旧算法不限 kind，取最近一条 toOwnerId = 占位
      // 回收站里的客户不算（对拍和旧算法的候选都带 deletedAt: null）
      const 全种类 = await 去掉合并挪来的(db, await db.customerOwnerLog.findMany({
        where: { customerId: { in: 挂占位.filter((c) => !c.deletedAt).map((c) => c.id) }, toOwnerId: 占位 },
        orderBy: [{ at: "desc" }, { id: "desc" }],
        select: { id: true, customerId: true, kind: true },
      }));
      const 看过 = new Set<string>();
      for (const r of 全种类) {
        if (看过.has(r.customerId)) continue;
        看过.add(r.customerId);
        if (r.kind !== "pool-release") { 占位非放回.位数++; 占位非放回.按种类[r.kind] = (占位非放回.按种类[r.kind] ?? 0) + 1; }
      }
    }
    for (const c of 段) {
      const 挂的占位 = !!占位 && c.salesOwnerId === 占位;
      const 应写 = 挂的占位 ? 最近.get(c.id) ?? null : c.salesOwnerId || null;
      const 来源 = 挂的占位 ? (最近.has(c.id) ? "最近一条 pool-release（去掉合并挪来的）的 from" : "没有 pool-release 留痕") : "老数据，负责人还没改挂占位账号，取当前负责人";
      客户行.push({ id: c.id, 更新于: c.updatedAt, 现值: c.poolPrevOwnerId, 应写, 进公海于: c.pool?.at ?? null, 来源 });
    }
  }
  return { 项目: 项目行, 客户: 客户行, 占位, 数于, 占位非放回 };
}

/** 这一行要不要写 */
export function 动作of(r: 回填行): "写" | "已相同" | "无可写" {
  if (r.应写 === null) return "无可写";
  return r.现值 === r.应写 ? "已相同" : "写";
}

/**
 * 真写。一行一笔小事务：条件带上读到的旧值（compare-and-set），别人这时写了新值就不覆盖。
 * 日志每行回调一次（逐行日志：实体、id、旧值、新值、动作；不写名字）
 */
export async function 写回填(db: PrismaClient, 计划: 回填计划, 日志: (行: string) => void): Promise<{ 项目: 回填结果; 客户: 回填结果 }> {
  const 做 = async (实体: "项目" | "客户", 行们: 回填行[]): Promise<回填结果> => {
    const 结 = { 写了: 0, 已相同跳过: 0, 无可写: 0, 并发跳过: 0 };
    for (const r of 行们) {
      const 动 = 动作of(r);
      if (动 === "已相同") { 结.已相同跳过++; 日志(`${实体}\t${r.id}\t已相同跳过\t${r.现值}`); continue; }
      if (动 === "无可写") { 结.无可写++; 日志(`${实体}\t${r.id}\t无可写\t现值 ${r.现值 ?? "空"}\t${r.来源}`); continue; }
      // 条件带上读到的旧值和 updatedAt（别处中间改过这一行就不覆盖，重跑一遍即可），updatedAt 原样写回：Prisma 不会把 @updatedAt 刷成现在，「最近更新」排序和提醒不动
      const where = { id: r.id, poolPrevOwnerId: r.现值, updatedAt: r.更新于 };
      const 改 = 实体 === "项目"
        ? (await db.project.updateMany({ where, data: { poolPrevOwnerId: r.应写, updatedAt: r.更新于 } })).count
        : (await db.customer.updateMany({ where, data: { poolPrevOwnerId: r.应写, updatedAt: r.更新于 } })).count;
      if (改 > 0) { 结.写了++; 日志(`${实体}\t${r.id}\t写\t${r.现值 ?? "空"} -> ${r.应写}\t${r.来源}`); }
      else { 结.并发跳过++; 日志(`${实体}\t${r.id}\t并发跳过\t读到 ${r.现值 ?? "空"}，写前已被改\t${r.来源}`); }
    }
    return 结;
  };
  return { 项目: await 做("项目", 计划.项目), 客户: await 做("客户", 计划.客户) };
}

const 北京格式 = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
export const 北京时刻 = (d: Date): string => 北京格式.format(d);
export const 北京日 = (d: Date): string => 北京格式.format(d).slice(0, 10);

/** 三张表（总行数 / 按人前 20 + 其余合计 / 按放进公海的北京日期）+ 数于北京时刻，纯文本。dry 只打印这个 */
export function 汇总表(计划: 回填计划): string {
  const 行: string[] = [`数于（北京时刻）${北京时刻(计划.数于)}`];
  for (const [名, 行们] of [["项目", 计划.项目], ["客户", 计划.客户]] as const) {
    const 将写 = 行们.filter((r) => 动作of(r) === "写").length;
    const 相同 = 行们.filter((r) => 动作of(r) === "已相同").length;
    const 无 = 行们.length - 将写 - 相同;
    行.push("", `## ${名}：表 1 总行数`, `在公海里 ${行们.length} 行；将写 ${将写}；已相同 ${相同}；无可写（没有原负责人）${无}`);

    const 按人 = new Map<string, number>();
    for (const r of 行们) 按人.set(r.应写 ?? "（无原负责人）", (按人.get(r.应写 ?? "（无原负责人）") ?? 0) + 1);
    const 排 = [...按人].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    行.push("", `## ${名}：表 2 按人（原负责人 id，前 20 + 其余合计）`);
    for (const [人, n] of 排.slice(0, 20)) 行.push(`${人}\t${n}`);
    if (排.length > 20) 行.push(`其余 ${排.length - 20} 人合计\t${排.slice(20).reduce((s, x) => s + x[1], 0)}`);

    const 按日 = new Map<string, number>();
    for (const r of 行们) { const k = r.进公海于 ? 北京日(r.进公海于) : "（没有时刻）"; 按日.set(k, (按日.get(k) ?? 0) + 1); }
    行.push("", `## ${名}：表 3 按放进公海的北京日期`);
    for (const [日, n] of [...按日].sort((a, b) => a[0].localeCompare(b[0]))) 行.push(`${日}\t${n}`);
  }
  const { 位数, 按种类 } = 计划.占位非放回;
  行.push("", "## 口径核对：在公海、挂占位的客户里，最近一条 to = 占位但 kind 不是 pool-release 的（0 = 回填口径和旧算法一致）", `${位数} 位${位数 ? "；按 kind：" + Object.entries(按种类).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${k} ${n}`).join("、") : ""}`);
  return 行.join("\n");
}

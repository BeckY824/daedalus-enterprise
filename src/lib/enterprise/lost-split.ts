/**
 * 线索流失细分（P-界面-66，客户 E-339）：结局「线索流失」的项目再分三类——项目合并 / 重复线索 / 其他线索流失。
 * 看板拆列（lib/project/list.ts 拆流失组）用；数据页线索瀑布、结局分布、项目详情那几处（第二段）也接这一个，口径只有一份。
 *
 * - 项目合并：这个项目作为被并方（fromId）有一张状态「已合并」的项目合并单（EntCustomerMerge kind = 项目）。
 * - 重复线索：线索验证终判「无效线索」、无效原因是「重复线索」；没有（对得上的）终判时，手动结束为线索流失、无效原因选了「重复线索」也算。
 *   「重复线索」按字典同一项认（cust-status-auto-db.ts 重复线索名们：字典 dict-invalid-5 现在的名字 + 原名，改过名也照认）。
 * - 同一项目只归一类：已并掉的只算项目合并；否则有终判按终判（终判的原因不是重复线索 = 其他，不再看手动原因），没终判按手动原因。
 * - 归列要和「这一次结束」对得上：合并单的时间 / 终判的时间 / 那一条手动结束的节点变更时间，和项目 closedAt 相差不超过 归列容差毫秒 才算。
 *   收掉的边角：判过重复线索（或并过）、后来改回进程、再被普通关成线索流失——那次的 closedAt 是新的，旧的终判 / 合并单对不上，按这次手动的原因归。
 *   不加字段、不改历史：撤回合并（单子变已撤回、项目回原结局）、改回进程（结局清掉）的项目下次读就自动回原列。
 * - closedAt 空着的线索流失（老数据）：什么都对不上，归其他线索流失。
 * - 一批 500 个分段查，每段三句（合并单、线索验证、手动结束的节点变更），不按项目查。读的是这几个项目自己的单子和留痕，
 *   调用方已按可见范围筛过项目，这里包 看全部，不再被限定滤掉。
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 重复线索名们 } from "./cust-status-auto-db";
import { 项目单 } from "./project-merge-guard";

export type 流失细分 = "项目合并" | "重复线索" | "其他线索流失";

/**
 * 合并单 / 终判 / 手动结束的时间和项目 closedAt 最多差多少还算「同一次结束」（毫秒）：2 分钟。
 * - 项目合并（project-merge.ts 执行项目合并）：closedAt、合并单 at、终判 finalAt 写的是同一个 现在，差 0。
 * - 线索验证判死（lead-verify.ts 判死）：verifiedAt / reviewedAt / finalAt 是进事务前 new Date() 取的，closedAt 是事务里另取的；
 *   查完再写 排队最多等 10 秒、单次最长 15 秒、撞上别的写入最多重来 3 轮，最坏约 75 秒，2 分钟兜得住。
 * - 手动结束（db.ts 改节点 / 终止进程）：closedAt 和节点变更那一行在同一个事务里，差几毫秒。
 * 改回进程再关成线索流失要在 2 分钟内做完才会被误认，实际碰不到。
 */
export const 归列容差毫秒 = 2 * 60 * 1000;

const 一批 = 500;
const 无效原因前缀 = "无效原因：";

type 读库 = Pick<Prisma.TransactionClient, "entCustomerMerge" | "entLeadVerify" | "projectNodeLog" | "entDictItem">;
type 时刻 = Date | string | null | undefined;

const 毫秒 = (t: 时刻): number | null => {
  if (t == null) return null;
  const n = (t instanceof Date ? t : new Date(t)).getTime();
  return Number.isNaN(n) ? null : n;
};
const 对得上 = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) <= 归列容差毫秒;

/** 节点变更备注里的无效原因：「无效原因：X」开头那一段（手动结束是 X + 换行 + 补充，判死 / 合并是 X + 「；」+ 说明） */
export function 备注里的无效原因(reason: string | null | undefined): string | null {
  if (!reason || !reason.startsWith(无效原因前缀)) return null;
  const 值 = reason.slice(无效原因前缀.length).split(/[\n；]/)[0]?.trim();
  return 值 || null;
}

/**
 * 一批项目各归哪一类：只回结局是「线索流失」的那几个（别的结局不在回的 Map 里）。
 * 名们 = 重复线索名们() 读好的（一页里多处调用时只读一次字典），不传现读。
 */
export async function 线索流失细分(
  项目们: readonly { id: string; result: string | null; closedAt: 时刻 }[],
  选项: { db?: 读库; 名们?: readonly string[] } = {},
): Promise<Map<string, 流失细分>> {
  const 出 = new Map<string, 流失细分>();
  const 流失 = 项目们.filter((p) => p.result === "线索流失");
  if (!流失.length) return 出;
  const db = 选项.db ?? prisma;
  return 看全部(async () => {
    const 名 = new Set(选项.名们 ?? (await 重复线索名们(db)));
    for (let i = 0; i < 流失.length; i += 一批) {
      const 段 = 流失.slice(i, i + 一批);
      const ids = 段.map((p) => p.id);
      const [单们, 验证们, 手动们] = await Promise.all([
        db.entCustomerMerge.findMany({ where: { kind: 项目单, status: "已合并", fromId: { in: ids } }, select: { fromId: true, at: true } }),
        db.entLeadVerify.findMany({
          where: { projectId: { in: ids }, finalResult: "无效线索" },
          select: { projectId: true, invalidReason: true, verifiedAt: true, reviewedAt: true, finalAt: true },
        }),
        db.projectNodeLog.findMany({
          where: { projectId: { in: ids }, toResult: "线索流失", reason: { startsWith: 无效原因前缀 } },
          select: { projectId: true, at: true, reason: true },
        }),
      ]);
      const 并 = new Map<string, number[]>();
      for (const d of 单们) 并.set(d.fromId, [...(并.get(d.fromId) ?? []), d.at.getTime()]);
      const 验 = new Map(验证们.map((v) => [v.projectId, v]));
      const 手 = new Map<string, { at: number; 原因: string | null }[]>();
      for (const l of 手动们) 手.set(l.projectId, [...(手.get(l.projectId) ?? []), { at: l.at.getTime(), 原因: 备注里的无效原因(l.reason) }]);
      for (const p of 段) {
        const 关 = 毫秒(p.closedAt);
        if ((并.get(p.id) ?? []).some((t) => 对得上(t, 关))) { 出.set(p.id, "项目合并"); continue; }
        const v = 验.get(p.id);
        // 终判那一刻：判死的那一步写的时间（初判即终判 verifiedAt、市场复核 reviewedAt、总管理终判 / 合并 finalAt），取最晚的
        const 判时 = v ? Math.max(...[v.verifiedAt, v.reviewedAt, v.finalAt].map((t) => 毫秒(t) ?? -Infinity)) : null;
        if (v && 对得上(Number.isFinite(判时) ? 判时 : null, 关)) {
          出.set(p.id, v.invalidReason != null && 名.has(v.invalidReason.trim()) ? "重复线索" : "其他线索流失");
          continue;
        }
        // 没终判（或终判是以前那一次的）：按这一次结束的那条节点变更里选的无效原因；同一刻有几条取最近的
        const 这次 = (手.get(p.id) ?? []).filter((l) => 对得上(l.at, 关)).sort((a, b) => b.at - a.at)[0];
        出.set(p.id, 这次?.原因 && 名.has(这次.原因) ? "重复线索" : "其他线索流失");
      }
    }
    return 出;
  });
}

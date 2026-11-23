/**
 * 企业版必填拦截记录（2026-11-23，迁移 164，表 EntRequiredBlock）。
 *
 * 客户要（11-23）：「点完成缺必填时只在页面提示、不留记录」是黑箱——加一条记录：时间、客户 / 项目编号、节点、缺哪几项；
 * 先只记录不报警，之后按天按节点出数。另要能答两个数：被必填拦下的次数（按节点分布）、卡在某个节点超过 24 小时的项目。
 *
 * 记什么：往前推节点被这三道关拦下（都是「缺东西」，不是没权限）：
 *   - 节点必填：节点推进配的必填没齐（lib/project/db.ts 改节点、看板拖动预检、项目页「完成节点」开补填框）
 *   - 线索验证：推过线索验证要的几样没齐（stage-gates.ts 企业版推进关；节点推进开关关着也拦）
 *   - 本节点沟通：后台开了「前两个进程各要一条沟通」、本节点没沟通（同上）
 * 没权限、等复核、待分配、补全期这些拦法不记（不是缺必填）。
 * 自动推进（存字段、记沟通后齐了才推）没齐时不记：那不是人要推，记了每次保存都算一次拦截、数会虚高。
 *
 * 不重复算：同一人、同一项目、同一节点、同一种拦法 10 分钟内只记一行（反复点同一个按钮、预检后又真推一次，都算一次）。
 * 「卡了多久」不另存：导出时找这一行之后项目第一次离开这个节点的节点变更（ProjectNodeLog kind=node）算；还没离开 = 到导出那一刻还卡着。
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "../prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 客户编号显示 } from "../customer-no";
import { dayjs } from "../utils";

export const 拦截种类 = ["节点必填", "线索验证", "本节点沟通"] as const;
export type 拦截种类 = (typeof 拦截种类)[number];

/** 入口白名单：界面交上来的不在里面一律记「其他」 */
export const 拦截入口们 = ["完成节点", "看板拖动", "首页AI", "线索验证判定", "判MQL", "改进程", "其他"] as const;
export type 拦截入口 = (typeof 拦截入口们)[number];
export const 认入口 = (v: unknown): 拦截入口 => (拦截入口们 as readonly string[]).includes(v as string) ? (v as 拦截入口) : "其他";

/** 同一件事 10 分钟内只记一行 */
export const 拦截去重分钟 = 10;

export type 拦截 = {
  userId: string;
  p: { id: string; customerId: string | null; phase: string; node: string };
  到?: { phase: string; node: string } | null;
  种: 拦截种类;
  缺: readonly string[];
  入口: 拦截入口;
  代推?: boolean;
};

/**
 * 记一行（不是企业版不记）。写库失败只打日志、不抛：留痕不能把推进本身的回话弄丢。
 * tx：在 改节点 的事务里写（改节点 被拦是 return，不回滚，这一行照样落库）
 */
export async function 记必填拦截(db: Pick<Prisma.TransactionClient, "entRequiredBlock">, x: 拦截, 今: Date = new Date()): Promise<boolean> {
  if (!企业版()) return false;
  try {
    const 近 = await db.entRequiredBlock.findFirst({
      where: { userId: x.userId, projectId: x.p.id, node: x.p.node, kind: x.种, at: { gte: new Date(今.getTime() - 拦截去重分钟 * 60_000) } },
      select: { id: true },
    });
    if (近) return false;
    await db.entRequiredBlock.create({
      data: {
        at: 今, userId: x.userId, projectId: x.p.id, customerId: x.p.customerId ?? null, phase: x.p.phase, node: x.p.node,
        toPhase: x.到?.phase ?? null, toNode: x.到?.node ?? null,
        kind: x.种, missing: JSON.stringify([...x.缺].slice(0, 30)), entry: x.入口, onBehalf: !!x.代推,
      },
    });
    return true;
  } catch (e) {
    console.error("必填拦截记录没写上", e);
    return false;
  }
}

const 读缺 = (s: string): string[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch { return []; }
};

export type 拦截导出 = {
  明细: { 表头: string[]; 行: string[][] };
  按节点: { 表头: string[]; 行: (string | number)[][] };
  /** 截断：起 ~ 今 之间超过 上限 行，只导了最新的 上限 行（最早那一行的时刻见 最早），别的数也只按导出的这些行算 */
  汇总: { 起: string; 止: string; 次数: number; 项目数: number; 卡超24小时项目数: number; 截断: boolean; 最早: string | null };
};

/** 一次最多导多少行（表只增不删；超了留最新的，汇总表写明截断） */
export const 拦截导出上限 = 50_000;

/** 一个项目在一个节点上的一段「卡」：从这一段第一次被拦到离开这个节点（没离开 = 到 今）；节点 = 「阶段·节点」，按节点那张表的键 */
type 段 = { projectId: string; 节点: string; 首拦: Date; 离开: Date | null };

type 拦截行 = Prisma.EntRequiredBlockGetPayload<object>;
type 节点变更 = { projectId: string; at: Date; fromNode: string | null; toNode: string | null; toResult: string | null; fromResult: string | null };
/** 拼导出要的几样关联（读拦截导出 从库里取；拆出来是为了不碰库就能量大批量的耗时） */
export type 拦截关联 = {
  项目们: { id: string; name: string; deletedAt: Date | null }[];
  人们: { id: string; name: string }[];
  客户们: { id: string; name: string; customerNo: number | null }[];
  /** 按 at 正序 */
  变更们: 节点变更[];
};

/**
 * 导出（系统管理员在设置 → 节点推进里点）：起 ~ 今 的拦截明细、按节点分布，和「卡超 24 小时的项目数」。
 * 卡超 24 小时 = 同一项目在同一节点上第一次被拦后，过了 24 小时才离开这个节点（或到现在还没离开、已经过了 24 小时）。
 */
export async function 读拦截导出(起: Date, 今: Date = new Date(), 上限: number = 拦截导出上限): Promise<拦截导出> {
  // 超上限留最新的（倒序取 上限 + 1 行，多出那一行只用来判截断），再翻回时间正序；原来正序取前 5 万行，丢的是最新的、也不提示
  const 倒序 = await prisma.entRequiredBlock.findMany({ where: { at: { gte: 起, lte: 今 } }, orderBy: [{ at: "desc" }, { id: "desc" }], take: 上限 + 1 });
  const 截断 = 倒序.length > 上限;
  const 行们 = 倒序.slice(0, 上限).reverse();
  const 项目ids = [...new Set(行们.map((r) => r.projectId))];
  const 人ids = [...new Set(行们.map((r) => r.userId))];
  const 客户ids = [...new Set(行们.map((r) => r.customerId).filter((x): x is string => !!x))];
  const [项目们, 人们, 客户们, 变更们] = await Promise.all([
    项目ids.length ? prisma.project.findMany({ where: { id: { in: 项目ids } }, select: { id: true, name: true, deletedAt: true } }) : [],
    人ids.length ? prisma.user.findMany({ where: { id: { in: 人ids } }, select: { id: true, name: true } }) : [],
    客户ids.length ? prisma.customer.findMany({ where: { id: { in: 客户ids } }, select: { id: true, name: true, customerNo: true } }) : [],
    项目ids.length
      ? prisma.projectNodeLog.findMany({ where: { projectId: { in: 项目ids }, kind: "node", at: { gte: 起 } }, select: { projectId: true, at: true, fromNode: true, toNode: true, toResult: true, fromResult: true }, orderBy: { at: "asc" } })
      : [],
  ]);
  return 汇拦截导出(行们, { 项目们, 人们, 客户们, 变更们 }, 起, 今, 截断);
}

/**
 * 读拦截导出 的计算那半：行们按 at 正序。一遍过、不回头找（原来按节点统计每一段都在全部行里 find 一次，5 万行是平方级）：
 * 段建的时候带上「阶段·节点」；离开时刻只在开新段时找一次（同一段里后面几行的离开时刻就是这一段的），变更按时刻二分
 */
export function 汇拦截导出(行们: readonly 拦截行[], 关联: 拦截关联, 起: Date, 今: Date, 截断 = false): 拦截导出 {
  const 项目 = new Map(关联.项目们.map((p) => [p.id, p]));
  const 人 = new Map(关联.人们.map((u) => [u.id, u.name]));
  const 客户 = new Map(关联.客户们.map((c) => [c.id, c]));
  const 变更 = new Map<string, 节点变更[]>();
  for (const l of 关联.变更们) (变更.get(l.projectId) ?? 变更.set(l.projectId, []).get(l.projectId)!).push(l);
  /** 这一刻之后项目第一次离开 node 的时刻（换了节点、或点了结局） */
  const 离开于 = (projectId: string, node: string, 从: Date): Date | null => {
    const ls = 变更.get(projectId);
    if (!ls) return null;
    let lo = 0;
    let hi = ls.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (ls[m].at <= 从) lo = m + 1;
      else hi = m;
    }
    for (let i = lo; i < ls.length; i++) {
      const l = ls[i];
      if (l.fromNode !== node) continue;
      if (l.toNode !== node || (l.toResult ?? null) !== (l.fromResult ?? null)) return l.at;
    }
    return null;
  };
  const 小时 = (a: Date, b: Date) => Math.round(((b.getTime() - a.getTime()) / 3_600_000) * 10) / 10;
  const 超过24 = (s: 段) => (s.离开 ?? 今).getTime() - s.首拦.getTime() > 24 * 3_600_000;

  const 段们: 段[] = [];
  const 当前段 = new Map<string, 段>();
  const 节点表 = new Map<string, { 次: number; 项目: Set<string>; 超24: Set<string>; 还卡: Set<string> }>();
  const 明细行: string[][] = [];
  for (const r of 行们) {
    const 节点 = `${r.phase}·${r.node}`;
    const v = 节点表.get(节点) ?? 节点表.set(节点, { 次: 0, 项目: new Set(), 超24: new Set(), 还卡: new Set() }).get(节点)!;
    v.次++;
    v.项目.add(r.projectId);
    const 键 = `${r.projectId}\u0000${r.node}`;
    let 段 = 当前段.get(键);
    // 同一段卡：上一段还没离开，或这一行在上一段离开之前（这时这一行之后第一次离开就是这一段的离开）
    if (!段 || (段.离开 && 段.离开 <= r.at)) {
      段 = { projectId: r.projectId, 节点, 首拦: r.at, 离开: 离开于(r.projectId, r.node, r.at) };
      段们.push(段);
      当前段.set(键, 段);
    }
    const 离开 = 段.离开;
    const p = 项目.get(r.projectId);
    const c = r.customerId ? 客户.get(r.customerId) : undefined;
    明细行.push([
      时(r.at), 人.get(r.userId) ?? "（账号已不在）",
      c ? 客户编号显示(c) : r.customerId ? "（客户已不在）" : "—", c?.name ?? "",
      p ? `${p.name}${p.deletedAt ? "（已删）" : ""}` : "（已删）",
      节点, r.toNode ? `${r.toPhase ?? ""}·${r.toNode}` : "",
      r.kind, 读缺(r.missing).join("、"), r.entry, r.onBehalf ? "是" : "",
      离开 ? 时(离开) : "还没推过去", String(小时(r.at, 离开 ?? 今)),
    ]);
  }
  const 超24 = new Set<string>();
  for (const s of 段们) {
    const v = 节点表.get(s.节点)!;
    if (超过24(s)) {
      超24.add(s.projectId);
      v.超24.add(s.projectId);
    }
    if (!s.离开) v.还卡.add(s.projectId);
  }
  return {
    明细: {
      表头: ["时间（北京）", "操作人", "客户编号", "客户名", "项目", "被拦时在", "想推到", "拦法", "缺哪几项", "入口", "上级代推", "之后离开这个节点", "卡了多久（小时）"],
      行: 明细行,
    },
    按节点: {
      表头: ["节点", "被拦次数", "涉及项目数", "卡超 24 小时的项目数", "到现在还卡着的项目数"],
      行: [...节点表].sort((a, b) => b[1].次 - a[1].次).map(([k, v]) => [k, v.次, v.项目.size, v.超24.size, v.还卡.size]),
    },
    汇总: { 起: 时(起), 止: 时(今), 次数: 行们.length, 项目数: new Set(行们.map((r) => r.projectId)).size, 卡超24小时项目数: 超24.size, 截断, 最早: 行们.length ? 时(行们[0].at) : null },
  };
}

const 时 = (d: Date) => dayjs(d).format("YYYY-MM-DD HH:mm");

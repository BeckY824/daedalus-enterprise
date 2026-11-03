/**
 * 项目列表 / 看板的读（2026-10-23，D-31）。看板按 nodes.ts 的 看板列们 分列，
 * 每列列头写项目数和金额合计，金额按币种分开不换汇（总控 10-23 定：项目不进首页统计、数据页、业绩，只在自己的看板里合计）。
 */
import { 按币种合计, type 币种合计 } from "../currency";
import { 有值 } from "../empty-value";
import { 看板列, 看板列们, 是阶段, type 看板列 as 列名 } from "./nodes";
import { 阶段们, 是交付, 结局叫法, type 阶段, type 阶段字典 } from "./stage-dict";

export type 项目行 = {
  id: string;
  name: string;
  customerId: string;
  /** 公海里同事客户的项目不给客户名（lib/project/db.ts 露客户），领了再看 */
  customerName: string | null;
  ownerId: string;
  ownerName: string;
  phase: string;
  node: string;
  result: string | null;
  /** 异常状态时选的类别名（类别停用了也照显示）和备注 */
  exceptionCategory: string | null;
  exceptionReason: string | null;
  /** 在项目公海里（ownerId 还是放回去的人，界面写「公海」） */
  pooled: boolean;
  /** 企业版新线索待分配（11-01 A7 / A10）：建好没分出去，负责人那一格只是建的人占着 */
  待分配?: boolean;
  /** 企业版超时回收：明天（或今天）就要回到项目公海的回收日，看板 / 列表标「即将回收」；不会收 = 不带（10-27） */
  即将回收?: string | null;
  /** 企业版：这个项目的回收日 YYYY-MM-DD（列表「回公海日」列；不会收 = null）、项目上填的下一步时间 YYYY-MM-DD（没填 = null）；别的版本不给 */
  回收日?: string | null;
  下一步时间?: string | null;
  /** 企业版：被收回公海几次（放回、超时回收都算，recycle-count.ts）；别的版本不给 */
  收回次数?: number;
  /** 企业版（10-29 P6）：预计成交日期 YYYY-MM-DD（没填 = null）、已立项天数、项目来源名（项目没选跟客户来源走，都没有 = null）；别的版本不给 */
  expectedDealAt?: string | null;
  已立项天数?: number;
  项目来源?: string | null;
  /** 企业版（P11 定稿 -2 版，迁移 093）：项目级别 S / A / B / C，null = 没分级；别的版本不给 */
  level?: string | null;
  amount: number;
  currency: string;
  updatedAt: string;
};

/** 列：分列用的 key；名：列头写的；色：按哪一档上色（团队版五列各自，企业版进程列跟所在阶段、出口列跟成功交付 / 没成）；阶段：进程列所在阶段（出口列没有） */
export type 看板一列 = { 列: string; 名: string; 色: 列名; 阶段?: 阶段; 空态: string; 数: number; 合计: 币种合计[]; 行: 项目行[] };

const 五列空态: Record<列名, string> = {
  线索: "还没有在培育的线索",
  商机: "还没有在谈的商机",
  订单: "还没有在交付的订单",
  成功交付: "还没有交付完的项目",
  没成: "没有流失或丢掉的项目",
};

type 列定义 = Omit<看板一列, "数" | "合计" | "行">;

/**
 * 企业版（11-03 反馈 6：「项目看板的显示不要用现在的阶段，而是所有进程，例如潜客培育等」）：
 * 三个阶段的进程一个一列（异常状态留在所在进程那列、标红），后面三列出口：交付结清、线索流失、商机丢单（叫法跟字典 / 后台改的）。
 * 阶段筛了只摆这一阶段的进程和它的出口。
 */
function 进程列们(字典: 阶段字典, 只看阶段?: string): 列定义[] {
  const 阶们 = 是阶段(只看阶段) ? [只看阶段] : 阶段们;
  const 进程 = 阶们.flatMap((s) => 字典.节点们[s].map((n): 列定义 => ({ 列: n, 名: n, 色: s, 阶段: s, 空态: `还没有在${n}的项目` })));
  const 出口 = (["订单", "线索", "商机"] as const).filter((s) => 阶们.includes(s)).flatMap((s) =>
    字典.出口们[s].flatMap((o): 列定义[] => (o.结局 && o.结局 !== "异常状态" ? [{ 列: o.结局, 名: o.叫法, 色: 是交付(o.结局) ? "成功交付" : "没成", 空态: `还没有${o.叫法}的项目` }] : [])),
  );
  return [...进程, ...出口];
}

/** 企业版这一行落哪列：有结局（异常除外）进出口列，其余进所在进程；认不出的进程落本阶段第一列，不丢 */
function 进程列(r: 项目行, 字典: 阶段字典): string {
  if (r.result && r.result !== "异常状态") return 是交付(r.result) ? (字典.出口们.订单[0].结局 ?? r.result) : r.result;
  const 阶 = 是阶段(r.phase) ? r.phase : "线索";
  return 字典.节点们[阶].includes(r.node) ? r.node : 字典.节点们[阶][0];
}

/**
 * 看板卡片那行小字（11-03 A5-5：卡片小字跟着当前进程走）：企业版写的进程就是卡片落的那列（进程列），
 * 不再直接写库里的 node——认不出的旧进程落本阶段第一列时，小字也写那一列，不会列和字对不上；
 * 交付结清写结局叫法（A5-6），流失 / 丢单写「结局 · 停在的进程」，异常写「异常 · 类别 · 进程」。团队版照旧写 node。
 */
export function 卡片小字(r: 项目行, 字典?: 阶段字典): string {
  const 企 = 字典?.名 === "企业版";
  const 异常 = r.result === "异常状态";
  const 进程 = 企 && (!r.result || 异常) ? 进程列(r, 字典!) : r.node;
  if (异常) return `异常 · ${有值(r.exceptionCategory) ? `${r.exceptionCategory} · ` : ""}${进程}`;
  if (r.result && 是交付(r.result)) return 结局叫法(r.result, 字典);
  return `${r.result ? `${结局叫法(r.result, 字典)} · ` : ""}${进程}`;
}

/**
 * 每列都在（空的也摆出来，列头写 0），列里按最近改过的排前。
 * 团队版五列（三个阶段 + 成功交付 + 没成）；传了企业版字典按进程分列（进程列们）。
 */
export function 看板分列(行: 项目行[], 字典?: 阶段字典, 只看阶段?: string): 看板一列[] {
  const 企 = 字典?.名 === "企业版";
  const 列们: 列定义[] = 企 ? 进程列们(字典!, 只看阶段) : 看板列们.map((c) => ({ 列: c, 名: c, 色: c, 空态: 五列空态[c] }));
  const 落 = (r: 项目行) => (企 ? 进程列(r, 字典!) : 看板列(r));
  return 列们.map((定) => {
    const 这列 = 行.filter((r) => 落(r) === 定.列).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { ...定, 数: 这列.length, 合计: 按币种合计(这列, (r) => r.amount, (r) => r.currency), 行: 这列 };
  });
}

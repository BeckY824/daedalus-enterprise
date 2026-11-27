/**
 * 企业版 · 合并台账（2026-12-02 上线，客户 E-336 / E-337 / E-339）：项目合并（合并客户第二批 2a，11-27 上线）一单一行，只读。
 *
 * 读的是 2a 的合并单表 EntCustomerMerge（kind = 项目，fromId = 被并的 B、intoId = 留下的 A），表里有什么列什么、不补数据：
 *   - 合并时间 at、发起人 byUserId、状态（已合并 / 已撤回）、撤回人 undoneById、撤回时间 undoneAt
 *   - 留下项目名 detail.留下名、被并项目名 fromName（合并那一刻的名字，B 清掉了照样有）
 *   - 客户 detail.客户（A 的客户 id，名字现查，连回收站里的）
 *   - 两边负责人：留下 detail.负责人、被并 fromOwnerId（合并那一刻的；2a 只并同负责人的，两格通常同一个人，后面批次放开了照样对）
 *   - 开票自查 detail.自查.谁 / 时间（合并的人勾「两个项目都未开票」时记的）
 * 用途：运营对账；系统管理员每周一拿它和财务开票清单对一遍，误勾的 30 天内到被并项目详情里撤回；公海客户合并到留下那家客户详情的历史变更里撤回（台账上不做撤回）。
 * 谁能看、能导：只有系统管理员（是系统管理员）。导出和列表走同一个 读合并台账、同一组条件，导一次记一行导出日志。
 * 首页 AI 不给（lib/ai 不引这个文件）：台账是管理员对账用的审计视图，AI 工具按角色给、合并本身也不给 AI（merge-actions 头注）。
 */
import type { PrismaClient } from "@/generated/prisma";
import { 客户编号文字 } from "@/lib/customer-no";
import { 看全部 } from "@/lib/team-scope";
import { 看已删 } from "./soft-delete-core";
import { 企业版 } from "./switch";
import { 权限组织 } from "./org";
import { 是系统管理员 } from "./permissions";
import { 客户显名, 显名列 } from "./customer-title";
import { 项目单 } from "./project-merge-guard";

/** 客户合并单 kind（同 customer-merge.ts 客户单；这里另写一份免得引它的值） */
const 客户合并单 = "客户";
import { recordAudit } from "@/lib/audit";
import { 是日期, 创建时间段 } from "@/lib/custom-date-range";
import type { 合并人 } from "./customer-merge";

type 库 = Pick<PrismaClient, "entCustomerMerge" | "user" | "customer">;
type 结果<T> = ({ ok: true } & T) | { ok: false; error: string };

/** 台账列的两种状态（2b 以后的 待同意 / 已拒绝 / 已作废 不进台账） */
export const 台账状态 = ["已合并", "已撤回"] as const;
/** 一次最多列 / 导多少单：超了只给最新的这些、标截断，界面和导出都说清 */
export const 台账上限 = 5000;
export const 只有系统管理员能看台账 = "只有系统管理员能看合并台账";

/** 起 / 止：北京日历日 YYYY-MM-DD（两端都含：起日 00:00:00.000 ～ 止日 23:59:59.999，北京时间），服务端换成时刻 */
export type 台账条件 = { 起?: string | null; 止?: string | null; 词?: string | null };
export type 台账行 = {
  id: string;
  /** 项目合并 / 公海客户合并（两家都在公海的客户合并，P-合并-07）；公海客户合并行：客户 = 留下的客户、留下 / 被并项目格留空、被并客户见 被并客户 */
  类型: "项目合并" | "公海客户合并";
  被并客户: string;
  /** 公海客户合并行：被并客户的编号（合并单 fromNo 写成 NO.xxxxx；老单没有就空） */
  被并编号: string;
  at: string;
  发起人: string;
  客户id: string | null;
  客户: string;
  /** 客户现在的状态：在 / 回收站（名字后带「（已删除）」、还能点开恢复）/ 已删（彻底删除，不出链接） */
  客户状态: "在" | "回收站" | "已删";
  留下id: string;
  留下项目: string;
  被并id: string;
  被并项目: string;
  留下负责人: string;
  被并负责人: string;
  自查人: string;
  自查时间: string | null;
  状态: string;
  撤回人: string;
  撤回时间: string | null;
};

type 明细 = { 公海?: unknown; 留下名?: unknown; 客户?: unknown; 负责人?: unknown; 自查?: { 谁?: unknown; 时间?: unknown } };
function 读明细(detail: string): 明细 {
  try {
    const v = JSON.parse(detail) as unknown;
    return v && typeof v === "object" ? (v as 明细) : {};
  } catch { return {}; }
}
const 字 = (v: unknown) => (typeof v === "string" ? v : "");
/** 明细里记的时间：认得出的才用 */
function 读时刻(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** 前端传来的起止日：只认 YYYY-MM-DD 的北京日历日，别的当没填 */
const 日 = (v: unknown): string | null => (是日期(v) ? v : null);
/** 搜：去空白、不分大小写，客户名、留下项目名、被并项目名任一包含就算 */
const 规整 = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** 这行说的客户：项目合并是留下项目所属客户（明细.客户），公海客户合并是留下的那家（intoId） */
const 客户idOf = (m: { kind: string; intoId: string }, 明: 明细) => (m.kind === 客户合并单 ? m.intoId : 字(明.客户));

export async function 能看合并台账(me: 合并人): Promise<boolean> {
  return 企业版() && 是系统管理员(me, await 权限组织());
}

/** 列表和导出共用：按合并时间倒序，起止含两端；词按名字筛（名字在明细 JSON 里、客户名要现查，查完在这里筛） */
export async function 读合并台账(db: 库, me: 合并人, 条件: 台账条件 | null | undefined): Promise<结果<{ 行们: 台账行[]; 截断: boolean }>> {
  if (!企业版()) return { ok: false, error: "只有企业版有合并台账" };
  if (!(await 能看合并台账(me))) return { ok: false, error: 只有系统管理员能看台账 };
  const 段 = 创建时间段(日(条件?.起) ?? undefined, 日(条件?.止) ?? undefined);
  const 词 = 规整(字(条件?.词)).slice(0, 60);
  const 单们 = await 看全部(() => db.entCustomerMerge.findMany({
    where: { OR: [{ kind: 项目单 }, { kind: 客户合并单, detail: { contains: '"公海":true' } }], status: { in: [...台账状态] }, ...(段 ? { at: { ...(段.gte ? { gte: 段.gte } : {}), ...(段.lte ? { lte: 段.lte } : {}) } } : {}) },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    // 有搜索词时先多拿一些再筛（名字不在列上）；没词直接按上限拿、多拿一条判截断
    take: 词 ? 台账上限 * 4 : 台账上限 + 1,
    select: { id: true, kind: true, fromId: true, intoId: true, fromName: true, fromNo: true, fromOwnerId: true, byUserId: true, status: true, detail: true, at: true, undoneAt: true, undoneById: true },
  }));
  const 明们 = new Map(单们.map((m) => [m.id, 读明细(m.detail)]));
  const 人ids = new Set<string>();
  const 客户ids = new Set<string>();
  for (const m of 单们) {
    const 明 = 明们.get(m.id)!;
    for (const id of [m.byUserId, m.undoneById, m.fromOwnerId, 字(明.负责人)]) if (id) 人ids.add(id);
    const 客id = 客户idOf(m, 明);
    if (客id) 客户ids.add(客id);
  }
  const [人们, 客户们] = await Promise.all([
    人ids.size ? db.user.findMany({ where: { id: { in: [...人ids] } }, select: { id: true, name: true } }) : [],
    客户ids.size ? 看全部(() => 看已删(() => db.customer.findMany({ where: { id: { in: [...客户ids] } }, select: { ...显名列, deletedAt: true } }))) : [],
  ]);
  const 叫 = new Map(人们.map((u) => [u.id, u.name]));
  const 人名 = (id: string | null | undefined) => (id ? 叫.get(id) ?? "（已删除的账号）" : "");
  const 客们 = new Map(客户们.map((c) => [c.id, c]));

  const 全部 = 单们.flatMap((m): 台账行[] => {
    const 明 = 明们.get(m.id)!;
    const 公海单 = m.kind === 客户合并单;
    if (公海单 && 明.公海 !== true) return [];
    const 客户id = 客户idOf(m, 明) || null;
    const 客 = 客户id ? 客们.get(客户id) : undefined;
    const 客户状态 = !客户id || (客 && !客.deletedAt) ? "在" : 客 ? "回收站" : "已删";
    const 自查时间 = 读时刻(明.自查?.时间);
    return [{
      id: m.id,
      类型: 公海单 ? "公海客户合并" : "项目合并",
      被并客户: 公海单 ? m.fromName : "",
      被并编号: 公海单 ? 客户编号文字(m.fromNo) ?? "" : "",
      at: m.at.toISOString(),
      发起人: 人名(m.byUserId),
      客户id,
      客户: !客户id ? "" : 客 ? `${客户显名(客)}${客.deletedAt ? "（已删除）" : ""}` : "（已删除的客户）",
      客户状态,
      留下id: m.intoId,
      留下项目: 公海单 ? "" : 字(明.留下名) || "未命名项目",
      被并id: m.fromId,
      被并项目: 公海单 ? "" : m.fromName || "未命名项目",
      留下负责人: 公海单 ? "" : 人名(字(明.负责人)),
      被并负责人: 公海单 ? "" : 人名(m.fromOwnerId),
      自查人: 字(明.自查?.谁),
      自查时间: 自查时间 ? 自查时间.toISOString() : null,
      状态: m.status,
      撤回人: m.status === "已撤回" ? 人名(m.undoneById) : "",
      撤回时间: m.status === "已撤回" && m.undoneAt ? m.undoneAt.toISOString() : null,
    }];
  });
  const 筛 = 词 ? 全部.filter((r) => [r.客户, r.留下项目, r.被并项目, r.被并客户].some((x) => 规整(x).includes(词))) : 全部;
  return { ok: true, 行们: 筛.slice(0, 台账上限), 截断: 筛.length > 台账上限 || (!!词 && 单们.length >= 台账上限 * 4) };
}

/** 导出：同一个 读合并台账、同一组条件，导一次记一行导出日志（设置 → 导出记录 看得到） */
export async function 导出合并台账(db: 库, me: 合并人, 条件: 台账条件 | null | undefined): Promise<结果<{ 行们: 台账行[]; 截断: boolean }>> {
  const r = await 读合并台账(db, me, 条件);
  if (!r.ok) return r;
  const 起 = 日(条件?.起);
  const 止 = 日(条件?.止);
  const 范围 = [起 ? `${起} 起` : "", 止 ? `${止} 止` : ""].filter(Boolean).join("、") || "全部时间";
  await recordAudit({
    user: me, action: "export", entity: "EntCustomerMerge",
    summary: `导出合并台账：${范围}${条件?.词 ? `、搜「${条件.词.slice(0, 30)}」` : ""}，${r.行们.length} 单${r.截断 ? "（超上限，只导了最新的）" : ""}`,
    detail: { 起, 止, 词: 条件?.词 ?? null, 行数: r.行们.length, 截断: r.截断 },
  });
  return r;
}

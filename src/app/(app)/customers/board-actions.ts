"use server";
/**
 * 客户页看板列底「再看 20 个」（11-12 用户：「按建议改，每列各自取数」）：这一列按当前排序接着往后取一段。
 * 只读：条件和首屏同一份（board-query.ts 客户页看板条件 → lib/project/list.ts 列表条件，可见范围、公海、回避都在里面），
 * 再并上这一列的节点条件；列键白名单、偏移 / 条数有上限都在 读看板一列 里。切换视图（只读预览）里照样能用（不写库）
 */
import { requireUser } from "@/lib/auth";
import { 企业版 } from "@/lib/enterprise/switch";
import { getBusiness } from "@/lib/business";
import { 读看板一列, 每列条数 } from "@/lib/project/list";
import type { 项目行 } from "@/lib/project/board";
import { 看板三态点 } from "@/lib/project/board-tri-dots";
import type { 三态标 } from "@/lib/enterprise/tri-state-label";
import { 客户页看板条件, type 客户页看板地址 } from "./board-query";
import { 在看子集 } from "./query";

export type 再看结果 = { ok: true; 行: 项目行[]; 总: number; 三态点?: Record<string, 三态标> } | { ok: false; error: string };

/**
 * 地址栏 = 客户页现在的查询串（界面原样给 location.search）；列 = 看板一列.列；偏移 = 这一列已经摆了几张。
 * 回这一段卡片、这一列一共几个（「已显示 N / 总数」用），三态开着时带这一批卡片的色点
 */
export async function 再看一列(地址栏: unknown, 列: unknown, 偏移: unknown, 条数: unknown = 每列条数): Promise<再看结果> {
  const me = await requireUser();
  if (!企业版() || !(await getBusiness()).projectMode) return { ok: false, error: "项目看板没开" };
  if (typeof 地址栏 !== "string" || typeof 列 !== "string" || typeof 偏移 !== "number" || typeof 条数 !== "number") return { ok: false, error: "参数不对" };
  // 查询串里的值都是字符串；同名参数只认第一个
  const 值 = new Map<string, string>();
  for (const [k, v] of new URLSearchParams(地址栏)) if (!值.has(k)) 值.set(k, v);
  const sp: Record<string, string> = Object.fromEntries(值);
  // 子集（导入这一批、本月新增、直接推荐）里画的是列表，没有看板
  if (在看子集(sp)) return { ok: false, error: "这里没有看板" };
  const { 项目, 客户 } = await 客户页看板条件(sp as 客户页看板地址);
  const r = await 读看板一列(me, { ...项目, 客户 }, 列, 偏移, 条数);
  if (!r) return { ok: false, error: "参数不对" };
  return { ok: true, 行: r.行, 总: r.总, 三态点: await 看板三态点(r.行) };
}

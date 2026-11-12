"use server";
/**
 * 项目页看板（/projects、市场角色客户页「我分出去的」）列底「再看 20 个」（11-12）：这一列接着往后取一段。
 * 只读：条件和首屏同一份——地址栏经 page-query.ts 项目页筛选（同 board-page.tsx 项目页），再进 lib/project/list.ts 列表条件
 * （可见范围、市场范围、原负责人回避、pool / recycled / f 首页卡都在里面），并上这一列的节点条件；列键白名单、偏移 / 条数上限在 读看板一列 里。
 * 看板列里恒按最近改过在前（同改动前的看板），地址栏的 sort 只管列表，不带进来。切换视图（只读预览）里照样能用（不写库）
 */
import { requireUser } from "@/lib/auth";
import { 企业版 } from "@/lib/enterprise/switch";
import { getBusiness } from "@/lib/business";
import { 读看板一列, 每列条数 } from "@/lib/project/list";
import type { 项目行 } from "@/lib/project/board";
import { 项目页筛选 } from "./page-query";

export type 项目页再看结果 = { ok: true; 行: 项目行[]; 总: number } | { ok: false; error: string };

/** 地址栏 = 这一页现在的查询串（界面原样给 location.search）；列 = 看板一列.列；偏移 = 这一列已经摆了几张 */
export async function 再看项目页一列(地址栏: unknown, 列: unknown, 偏移: unknown, 条数: unknown = 每列条数): Promise<项目页再看结果> {
  const me = await requireUser();
  // 项目模式关着时项目页不存在（projects/page.tsx 404），这里也不给
  if (!(await getBusiness()).projectMode) return { ok: false, error: "项目看板没开" };
  if (typeof 地址栏 !== "string" || typeof 列 !== "string" || typeof 偏移 !== "number" || typeof 条数 !== "number") return { ok: false, error: "参数不对" };
  // 查询串里的值都是字符串；同名参数只认第一个
  const 值 = new Map<string, string>();
  for (const [k, v] of new URLSearchParams(地址栏)) if (!值.has(k)) 值.set(k, v);
  const { sp } = 项目页筛选(Object.fromEntries(值) as Record<string, string>);
  // 企业版 ?pool=1 首屏转去 /pool（board-page.tsx），这里没有看板
  if (企业版() && sp.pool === "1") return { ok: false, error: "这里没有看板" };
  const r = await 读看板一列(me, { ...sp, sort: undefined }, 列, 偏移, 条数);
  if (!r) return { ok: false, error: "参数不对" };
  return { ok: true, 行: r.行, 总: r.总 };
}

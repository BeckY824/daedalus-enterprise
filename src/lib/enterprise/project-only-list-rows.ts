/**
 * 客户列表第 1 页顶上那一小块「仅项目」（只负责项目的人，project-only-customers.ts）：他看不到、但名下有自己项目的客户。
 * 绕开限定层读（看全部），所以 select 只写白名单：名字、简称、公司、客户编号、客户类型、客户属性、地区，再加我自己项目的当前节点和个数。
 * 电话、负责人、备注、级别、状态、最近跟进这些一概不取（客户行 客户行字段 那份带着它们，不复用）。
 * 不进总数、不进导出、不能勾；筛选只认 仅项目安全条件 给的白名单条件（null = 这一块不摆）
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 拼地址 } from "./customer-v2";
import { 仅项目客户们 } from "./project-only-customers";
import { 本套位置 } from "@/lib/project/nodes";
import { 企业版字典, 显示节点名 } from "@/lib/project/stage-dict";
import { 后售项目们 } from "@/lib/project/after-sale";
import { 最近有动静的, 节点字 } from "@/lib/project/customer-list-projects";
import type { 抬头节点格 } from "./customer-title";

export type 仅项目列表行 = {
  id: string;
  name: string;
  shortName: string | null;
  school: string | null;
  /** 客户编号（迁移 146，11-17 客户抬头 PR-1b）：块里紧跟客户名一列，和下面客户表格的「编号」同一写法 */
  customerNo: number | null;
  customerType: string | null;
  customerAttr: string | null;
  地区: string;
  /** 抬头区域段用（F-040 审查）：有区域没主体的客户在块里照「区|节点」，和下面客户表格第一列一样 */
  addrCountry: string | null;
  addrProvince: string | null;
  addrCity: string | null;
  addrDistrict: string | null;
  /** 我自己在这位客户名下的项目里最近有动静的那个的节点（同客户列表「当前节点」的写法） */
  当前节点: string | null;
  /** 抬头用（F-040）：同一个项目的节点、项目名；全空客户抬头写项目名（customer-title.ts 全空抬头） */
  抬头格?: 抬头节点格 | null;
  当前阶段: string | null;
  项目数: number;
  仅项目: true;
};

/** 一块最多摆这么多位（按我的项目最近改过在前）；再多的走看板或项目列表 */
export const 仅项目块上限 = 50;

/** 行们 = 最多 仅项目块上限 位；超了 = true（块上写「前 50 位」） */
export async function 仅项目列表行们(me: { id: string; role?: string | null }, 条件: Prisma.CustomerWhereInput): Promise<{ 行们: 仅项目列表行[]; 超了: boolean }> {
  const 空 = { 行们: [], 超了: false };
  const 表 = await 仅项目客户们(me);
  if (!表.size) return 空;
  const 客户们 = await 看全部(() => prisma.customer.findMany({
    where: { AND: [{ id: { in: [...表.keys()] }, deletedAt: null, pool: { is: null } }, 条件] },
    select: { id: true, name: true, shortName: true, school: true, customerNo: true, customerType: true, customerAttr: true, addrCountry: true, addrProvince: true, addrCity: true, addrDistrict: true },
  }));
  if (!客户们.length) return 空;
  const 项目ids = 客户们.flatMap((c) => 表.get(c.id) ?? []);
  const 项目们 = await 看全部(() => prisma.project.findMany({
    where: { id: { in: 项目ids }, ownerId: me.id, pooledAt: null, deletedAt: null },
    select: { id: true, customerId: true, phase: true, node: true, result: true, updatedAt: true, name: true },
  }));
  const 按客户 = new Map<string, typeof 项目们>();
  for (const p of 项目们) 按客户.set(p.customerId, [...(按客户.get(p.customerId) ?? []), p]);
  const 选中 = new Map(客户们.flatMap((c) => { const d = 最近有动静的(按客户.get(c.id) ?? []); return d ? [[c.id, d] as const] : []; }));
  // 后售培育（P-界面-63）：选中的项目一页一次判（后售项目们，看客户名下全部项目，同客户表格「当前节点」客户项目概况们）
  const 后售们 = await 后售项目们([...选中.values()]);
  const 行们 = 客户们.flatMap((c) => {
    const ps = 按客户.get(c.id) ?? [];
    const d = 选中.get(c.id);
    if (!ps.length || !d) return [];
    const 本 = 本套位置({ phase: d.phase, node: d.node, result: d.result }, 企业版字典);
    const 位 = 本 ? { ...本, node: 显示节点名(本.node, 后售们.has(d.id), 企业版字典) } : null;
    const 行: 仅项目列表行 = {
      id: c.id, name: c.name, shortName: c.shortName, school: c.school, customerNo: c.customerNo, customerType: c.customerType, customerAttr: c.customerAttr,
      addrCountry: c.addrCountry, addrProvince: c.addrProvince, addrCity: c.addrCity, addrDistrict: c.addrDistrict,
      地区: 拼地址(c),
      当前节点: 位 ? 节点字(位) : null,
      抬头格: 位 ? { 节点: 节点字(位), 项目名: d.name } : null,
      当前阶段: 位?.phase ?? null, 项目数: ps.length, 仅项目: true,
    };
    return [{ 行, 动: Math.max(...ps.map((p) => p.updatedAt.getTime())) }];
  });
  行们.sort((a, b) => b.动 - a.动 || a.行.id.localeCompare(b.行.id));
  return { 行们: 行们.slice(0, 仅项目块上限).map((x) => x.行), 超了: 行们.length > 仅项目块上限 };
}

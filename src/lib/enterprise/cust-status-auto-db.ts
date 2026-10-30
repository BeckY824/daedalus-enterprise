/**
 * 企业版客户状态按项目自动算：读写库这一半（规则在 cust-status-auto.ts）。
 *
 * - 只在 企业版只用项目()（CRM_ENTERPRISE=1 且项目模式开着）时算；关着一格不建不改。
 *   开关在事务外面读（事务里只用 tx），读好的真假传进 跟着项目重算(tx, 开, …)。
 * - 存的是字典 custStatus 第 i 项「现在的名字」：按固定 id dict-custStatus-<i> 去字典表取，表里还没这一项（字典没初始化过）用默认名。
 *   只读字典、不补默认行（企业字典() 第一次读会写库，这里不碰）。
 * - 一个客户的项目要全看：业务员改自己的项目，同一客户下同事的项目也得算进来，所以包在 看全部() 里；软删的客户 / 项目不算。
 * - 只改变了的：算出来和库里一样的不写（不碰 updatedAt）。没有项目的算出 null，库里有值就清成 null。
 * - Prisma 6.16 嵌套 include 里带 orderBy 超过 1000 个父行会崩：这里只用平铺的 findMany（不 include），全量按 id 游标分页。
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 字典定义 } from "./dict-kinds";
import { 企业版只用项目 } from "./project-only";
import { 算客户状态, 客户状态id } from "./cust-status-auto";

type 库 = Prisma.TransactionClient;

/** 一批最多几个客户（SQLite IN 参数别太长） */
const 一批 = 500;

/** 开没开自动算：企业版 + 项目模式。事务外面读 */
export const 客户状态自动 = 企业版只用项目;

/** 序号 → 字典里这一项现在的名字；表里没有就用默认名 */
export async function 客户状态名们(db: 库 = prisma): Promise<string[]> {
  const 默认 = 字典定义.custStatus.默认;
  const ids = 默认.map((_, i) => 客户状态id(i));
  const 行们 = await db.entDictItem.findMany({ where: { kind: "custStatus", id: { in: ids } }, select: { id: true, name: true } });
  const 名 = new Map(行们.map((r) => [r.id, r.name]));
  return 默认.map((n, i) => 名.get(客户状态id(i)) ?? n);
}

/**
 * 按项目重算这几个客户的状态，返回改了几个。不看开关（调用方自己挡）；在事务里传 tx。
 * 名们 = 客户状态名们() 读好的（全量重算一遍只读一次字典），不传现读
 */
export async function 重算客户状态(db: 库, customerIds: Iterable<string | null | undefined>, 名们?: string[]): Promise<number> {
  const ids = [...new Set([...customerIds].filter((x): x is string => !!x))];
  if (!ids.length) return 0;
  return 看全部(async () => {
    const 名 = 名们 ?? (await 客户状态名们(db));
    let 改了 = 0;
    for (let i = 0; i < ids.length; i += 一批) {
      const 这批 = ids.slice(i, i + 一批);
      // 事务里一条一条来，不并发
      const 客户们 = await db.customer.findMany({ where: { id: { in: 这批 }, deletedAt: null }, select: { id: true, custStatus: true } });
      const 项目们 = await db.project.findMany({ where: { customerId: { in: 这批 }, deletedAt: null }, select: { customerId: true, phase: true, node: true, result: true } });
      const 按客户 = new Map<string, typeof 项目们>();
      for (const p of 项目们) {
        if (!p.customerId) continue;
        const 列 = 按客户.get(p.customerId);
        if (列) 列.push(p);
        else 按客户.set(p.customerId, [p]);
      }
      // 算出来同一个值的并成一条 updateMany
      const 要改 = new Map<string | null, string[]>();
      for (const c of 客户们) {
        const 序 = 算客户状态(按客户.get(c.id) ?? []);
        const 值 = 序 == null ? null : 名[序];
        if (值 === c.custStatus) continue;
        const 列 = 要改.get(值);
        if (列) 列.push(c.id);
        else 要改.set(值, [c.id]);
      }
      for (const [值, 们] of 要改) {
        改了 += (await db.customer.updateMany({ where: { id: { in: 们 } }, data: { custStatus: 值 } })).count;
      }
    }
    return 改了;
  });
}

/** 写入口用：开着才算（开 = 事务外面读好的 客户状态自动()），关着什么都不做 */
export async function 跟着项目重算(db: 库, 开: boolean, customerIds: Iterable<string | null | undefined>): Promise<number> {
  return 开 ? 重算客户状态(db, customerIds) : 0;
}

/** 不在事务里的写入口用：自己读开关、开着才算 */
export async function 项目变了重算(customerIds: Iterable<string | null | undefined>): Promise<number> {
  if (!(await 客户状态自动())) return 0;
  return 重算客户状态(prisma, customerIds);
}

/**
 * 全量重算：按 id 游标一页页取客户（只取 id），每页一个事务重算，返回改了几个。
 * 关着返回 0、不改。老数据第一次上、或字典改名之后补一遍用；没接到启动上（会把没有项目、导入时带了状态的客户清成空）
 */
export async function 全量重算客户状态(): Promise<number> {
  if (!(await 客户状态自动())) return 0;
  const 名 = await 客户状态名们();
  let 改了 = 0;
  let 游标: string | undefined;
  for (;;) {
    const 页 = await 看全部(() => prisma.customer.findMany({
      where: { deletedAt: null, ...(游标 ? { id: { gt: 游标 } } : {}) },
      select: { id: true }, orderBy: { id: "asc" }, take: 一批,
    }));
    if (!页.length) break;
    改了 += await prisma.$transaction((tx) => 重算客户状态(tx, 页.map((c) => c.id), 名));
    游标 = 页[页.length - 1].id;
    if (页.length < 一批) break;
  }
  return 改了;
}

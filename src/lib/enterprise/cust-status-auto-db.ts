/**
 * 企业版客户状态按项目自动算：读写库这一半（规则在 cust-status-auto.ts）。
 *
 * - 只在 企业版只用项目()（CRM_ENTERPRISE=1 且项目模式开着）时算；关着一格不建不改。
 *   开关在事务外面读（事务里只用 tx），读好的真假传进 跟着项目重算(tx, 开, …)。
 * - 存的是字典 custStatus 第 i 项「现在的名字」：按固定 id dict-custStatus-<i> 去字典表取，表里还没这一项（字典没初始化过）用默认名。
 *   只读字典、不补默认行（企业字典() 第一次读会写库，这里不碰）。
 * - 一个客户的项目要全看：业务员改自己的项目，同一客户下同事的项目也得算进来，所以包在 看全部() 里；软删的客户 / 项目不算。
 * - 只改变了的：算出来和库里一样的不写（不碰 updatedAt）。没有项目的算出 null，库里有值就清成 null（名下只剩仅记录用的例外：不写，见下）。
 * - Prisma 6.16 嵌套 include 里带 orderBy 超过 1000 个父行会崩：这里只用平铺的 findMany（不 include），全量按 id 游标分页。
 * - 重复咨询第一步（客户 11-22 / 11-23 定稿）：「终判无效 · 重复线索」的线索不参与计算（重复线索不算），批量重算、详情现算两处都排；
 *   全量重算调的是批量重算，跟着排。在推项目优先在纯函数里（cust-status-auto.ts）
 * - 仅记录用（X-147）：项目带上 source，纯函数里排掉；名下只剩仅记录用的（只剩仅记录用）不写，库里有值照留（不按「没有项目」清成 null）
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 字典定义 } from "./dict-kinds";
import { 企业版只用项目 } from "./project-only";
import { 企业版 } from "./switch";
import { 算客户状态, 只剩仅记录用, 客户状态id, type 算状态的项目 } from "./cust-status-auto";

type 库 = Prisma.TransactionClient;
type 读库 = Pick<Prisma.TransactionClient, "entDictItem" | "entLeadVerify">;

/** 一批最多几个客户（SQLite IN 参数别太长） */
const 一批 = 500;

/** 无效原因「重复线索」：字典 invalid 默认第 5 项的 id 和原名（dict-kinds.ts 默认 的序号，id 不随排序、改名变） */
export const 重复线索id = "dict-invalid-5";
export const 重复线索原名 = "重复线索";

/**
 * 认哪些无效原因是「重复线索」：这一项现在的名字 + 原名。无效原因在库里存的是名字（dict.ts 回填的是 值），
 * 管理员改过名，老记录还是旧名，所以两个都认（客户 11-22「改过名也照认」）
 */
export async function 重复线索名们(db: Pick<读库, "entDictItem"> = prisma): Promise<string[]> {
  const 现 = (await db.entDictItem.findUnique({ where: { id: 重复线索id }, select: { name: true } }))?.name?.trim();
  return [...new Set([重复线索原名, ...(现 ? [现] : [])])];
}

/**
 * 这几条项目里不参与客户状态计算的：项目结局还是「线索流失」、线索验证终判「无效线索」、无效原因是重复线索（重复线索名们）。
 * 不看有没有「老客户重复咨询」标记（客户 11-22：只看无效原因）；结局改回进行中的不在 流失的 里，自然重新参与
 */
export async function 重复线索不算(db: Pick<读库, "entLeadVerify">, 流失的: readonly string[], 名们: readonly string[]): Promise<Set<string>> {
  const 出 = new Set<string>();
  for (let i = 0; i < 流失的.length; i += 一批) {
    const 行 = await db.entLeadVerify.findMany({
      where: { projectId: { in: 流失的.slice(i, i + 一批) }, finalResult: "无效线索", invalidReason: { in: [...名们] } },
      select: { projectId: true },
    });
    for (const r of 行) 出.add(r.projectId);
  }
  return 出;
}

/** 项目行标上 不算（重复线索不算）：只查结局是线索流失的那几条 */
async function 标不算<T extends { id: string; result: string | null }>(db: 读库, 项目们: T[], 名们?: readonly string[]): Promise<(T & 算状态的项目)[]> {
  const 流失的 = 项目们.filter((p) => p.result === "线索流失").map((p) => p.id);
  if (!流失的.length) return 项目们 as (T & 算状态的项目)[];
  const 不算 = await 重复线索不算(db, 流失的, 名们 ?? (await 重复线索名们(db)));
  return 项目们.map((p) => (不算.has(p.id) ? { ...p, 不算: true } : p)) as (T & 算状态的项目)[];
}

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
 * 名们 = 客户状态名们() 读好的（全量重算一遍只读一次字典），不传现读。
 * 不清空（进出公海重算用）：算出来是 null、库里现在有值的不写，留着库里的值；别的照常写
 */
export async function 重算客户状态(db: 库, customerIds: Iterable<string | null | undefined>, 名们?: string[], 选项?: { 不清空?: boolean }): Promise<number> {
  const ids = [...new Set([...customerIds].filter((x): x is string => !!x))];
  if (!ids.length) return 0;
  return 看全部(async () => {
    const 名 = 名们 ?? (await 客户状态名们(db));
    const 重复名 = await 重复线索名们(db);
    let 改了 = 0;
    for (let i = 0; i < ids.length; i += 一批) {
      const 这批 = ids.slice(i, i + 一批);
      // 事务里一条一条来，不并发
      const 客户们 = await db.customer.findMany({ where: { id: { in: 这批 }, deletedAt: null }, select: { id: true, custStatus: true } });
      const 项目们 = await 标不算(db, await db.project.findMany({ where: { customerId: { in: 这批 }, deletedAt: null }, select: { id: true, customerId: true, phase: true, node: true, result: true, pooledAt: true, source: true } }), 重复名);
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
        const 列们 = 按客户.get(c.id) ?? [];
        // 只剩仅记录用的：当没有项目，但不清库里已有的值（X-147）
        if (只剩仅记录用(列们)) continue;
        const 序 = 算客户状态(列们);
        const 值 = 序 == null ? null : 名[序];
        if (值 === c.custStatus) continue;
        if (值 === null && 选项?.不清空) continue;
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

/**
 * 详情页那枚章显示用（11-03 C1-4）：库里存着就用存的；没存（种子、导入的老数据没跑过重算）按名下项目现算一个，只显示、不写库
 * （只读角色打开详情也不能写）。还是 null = 真没有项目，章上才写「暂无项目」
 */
export async function 显示用客户状态(customerId: string, 存的: string | null): Promise<string | null> {
  if (存的) return 存的;
  return 看全部(async () => {
    const 项目们 = await 标不算(prisma, await prisma.project.findMany({ where: { customerId, deletedAt: null }, select: { id: true, phase: true, node: true, result: true, pooledAt: true, source: true } }));
    const 序 = 算客户状态(项目们);
    return 序 == null ? null : (await 客户状态名们())[序];
  });
}

/** 写入口用：开着才算（开 = 事务外面读好的 客户状态自动()），关着什么都不做 */
export async function 跟着项目重算(db: 库, 开: boolean, customerIds: Iterable<string | null | undefined>): Promise<number> {
  return 开 ? 重算客户状态(db, customerIds) : 0;
}

/**
 * 项目进出公海的写入口用（11-25）：领取、分配、放回、超时回收、撤销、离职 / 三态进公海……项目 pooledAt 变了，
 * 「在推项目优先」认的在推（没结局、不在公海）跟着变，客户状态要在同一笔事务里重算落库（B37「随领取和项目变动自然落库」、M-状态-01）。
 * 开关不另读：企业版项目模式锁死开着（business-config.ts 企业版锁定），企业版() 就等于 客户状态自动()；
 * 这几处多在事务里的底层帮手（带走公海项目、客户名下在推项目进公海……），拿不到事务外读好的开关，所以同步判。
 * 批量的调用方攒齐客户一次调（重算客户状态 500 位一批），别逐个项目调
 */
export async function 进出公海重算(db: 库, customerIds: Iterable<string | null | undefined>): Promise<number> {
  // 算出来是 null（名下一个算数的项目都没有）、库里有值的不清空（导入带的、零项目存的「成交」），同 全量重算客户状态 不把导入带了状态的清空；
  // 只有结局项目的照常落库（B37「随领取自然落库」；M-状态-01 那 566 家存潜在、只有一条流失线索的，领取时落成流失，复审 11-25）
  return 企业版() ? 重算客户状态(db, customerIds, undefined, { 不清空: true }) : 0;
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

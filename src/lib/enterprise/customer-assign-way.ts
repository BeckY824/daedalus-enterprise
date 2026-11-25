/**
 * 客户档案上的「客户分配」（Customer.assignWay，字典 custAssign：自持 / 非自持 / 公海领取，V-客户分配）系统自动写（11-17）：
 * - 市场成员把客户交给销售（市场转一位：分配线索指定 / 自动、客户页和向导新建项目、市场转客户、公海项目带市场客户）→ 非自持，只补空；
 * - 客户出客户公海归销售（领取、总管理 / 销售管理分配公海、客户整包出公海）→ 公海领取，覆盖原值
 *   （客户答复 Q1：退回过、现在的负责人不是第一次分到的人记公海领取——这一格记的是现在这位负责人是怎么拿到的）；
 * - 销售自己建档、记在自己名下 → 自持，只补空。
 * 写的是字典里这一项现在的叫法（客户分配叫法），被停用了就不写。项目上的「分配方式」（Project.assignMode）不在这里动：
 * 客户 11-17 答复 Q3，项目按项目自己的实际来源填，不跟客户走。
 * 撤销（P-撤销-01 按原样回滚）：补的还成空、公海领取还回原值，都只在这一格还是我们写进去的那个值时才还
 */
import type { Prisma } from "@/generated/prisma";
import { 客户分配叫法, 是客户分配项, 客户分配序号 } from "./dict";
import { 企业版 } from "./switch";
import { 读组织 } from "./org";
import { 读市场成员们 } from "./market-db";
import { 是销售角色 } from "./assign-line";

type 库 = Pick<Prisma.TransactionClient, "customer" | "entDictItem">;

/**
 * 出公海前各归谁（撤销领取 / 分配按它还）；分 = 出公海时「客户分配」被盖成公海领取之前的值，没盖过就没有这一项；
 * 状 = 动手前库里存的客户状态（撤销时还回它，cust-status-auto-db.ts 还原客户状态；老撤销条没有这一项，撤销照旧重算）。
 * 放进公海的撤销条也用这个形状（值 是空串，只带 状）
 */
export type 出公海原值 = { id: string; 值: string; 分?: string | null; 状?: string | null };

/**
 * 新建客户记不记「自持」：企业版、建在自己名下、是销售（销售 / 销售管理，且不算市场：市场管理、渠运、按部门认的市场成员都不算，
 * 同新建线索默认个人自持那一句，X-93）。事务外调（读组织）
 */
export async function 建档记自持(me: { id: string }, 负责人: string): Promise<boolean> {
  if (!企业版() || 负责人 !== me.id) return false;
  const org = await 读组织();
  return 是销售角色(org.成员.get(me.id)?.角色们 ?? [], (await 读市场成员们(org)).has(me.id));
}

/** 客户分配为空才补（非自持、自持）：补上了回 true。不是企业版 / 这一项停用了不写 */
export async function 补客户分配(db: 库, customerId: string, i: 客户分配序号): Promise<boolean> {
  if (!企业版()) return false;
  const 叫法 = await 客户分配叫法(i, db);
  if (!叫法) return false;
  const r = await db.customer.updateMany({ where: { id: customerId, OR: [{ assignWay: null }, { assignWay: "" }] }, data: { assignWay: 叫法 } });
  return r.count > 0;
}

/**
 * 客户出客户公海归销售：写「公海领取」，原来有值也盖掉。回写之前的值（撤销按它还）；没写（不是企业版、停用了、本来就是它）回 undefined
 */
export async function 写公海领取(db: 库, customerId: string): Promise<{ 原: string | null } | undefined> {
  if (!企业版()) return undefined;
  const 叫法 = await 客户分配叫法(客户分配序号.公海领取, db);
  if (!叫法) return undefined;
  const c = await db.customer.findUnique({ where: { id: customerId }, select: { assignWay: true } });
  if (!c || c.assignWay === 叫法) return undefined;
  await db.customer.update({ where: { id: customerId }, data: { assignWay: 叫法 } });
  return { 原: c.assignWay || null };
}

/** 撤销市场转给销售：这几位补上的「非自持」还成空（这一格被人改过的不动） */
export async function 还补的客户分配(db: 库, customerIds: unknown, 只在: string[]): Promise<void> {
  if (!企业版() || !Array.isArray(customerIds)) return;
  const ids = customerIds.filter((x): x is string => typeof x === "string" && 只在.includes(x));
  if (!ids.length) return;
  const 叫法 = await 客户分配叫法(客户分配序号.非自持, db);
  if (!叫法) return;
  await db.customer.updateMany({ where: { id: { in: ids }, assignWay: 叫法 }, data: { assignWay: null } });
}

/**
 * 撤销公海领取 / 分配：「公海领取」还回领之前的值。原值是浏览器带回来的：只收空或字典「客户分配」里有的一项；
 * 没带（老页面）、带的不认得、这一格已被人改过都不动
 */
export async function 还公海领取前的客户分配(db: 库, customerId: string, 原: unknown): Promise<void> {
  if (!企业版() || 原 === undefined) return;
  if (原 !== null && (typeof 原 !== "string" || (原 !== "" && !(await 是客户分配项(原, db))))) return;
  const 叫法 = await 客户分配叫法(客户分配序号.公海领取, db);
  if (!叫法) return;
  await db.customer.updateMany({ where: { id: customerId, assignWay: 叫法 }, data: { assignWay: 原 || null } });
}

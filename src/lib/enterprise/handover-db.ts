/**
 * 企业版「交接中」（2026-10-26，测试清单 D10：转出去的数据，交接完成前接手人看不到）。
 *
 * 两种来源（规则开关「交接要接手人确认」11-13 拿掉了：企业版办离职 11-03 起原地不动、早就不读它，客户原话「不要留一个看起来能用其实不生效的开关」）：
 *   离职交接 —— 11-13 起「项目 → 离职交接」里交一位客户 / 交一个项目 / 全部交给都只记一行待确认（客户原话「离职交接也必须接手人点确认才生效」，
 *               不做开关），接手人确认了才转（lib/enterprise/offboard-handover.ts 确认离职交接）；离职交接不作废（人已停用，作废了没人管），
 *               挂满 7 天在离职交接页标「已等 N 天」提醒发起人。办离职时发起的老行（way = 转交 / 公海）照旧能确认 / 撤回 / 拒收，
 *               确认时按当时重新分拣、转过去
 *   转让客户 —— 负责人本人转自己的客户（申请移交，P-转-16）：客户先不换负责人，按原负责人一人一行记待确认；接手人确认了才换，
 *               名下联系人、沟通记录、项目、没做完的活照转让客户的老规矩一起走（带走并记下）
 * 确认之前数据还归原负责人，接手人的列表里自然没有；接手人只在「等你确认的交接」里看到个数和客户名。
 * 状态：待确认 → 已确认（接手人）/ 已撤回（发起人、管理员；成员重新启用也会撤）/ 已拒收（接手人）/
 *       已作废（系统：负责人本人的申请移交挂满 7 天没人处理，handover-expire.ts，11-10）。
 * 离职交接撤回或拒收后成员仍是停用的，数据留在他名下：要换接手人就再办一次离职，或先恢复成员
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 权限组织 } from "./org";
import { 是总管理 } from "./permissions";

/** 撤回别人发起的交接、看全部还没确认的交接：总管理（不是企业版：账号管理员） */
export async function 能撤回别人的交接(我: { id: string; role: string }): Promise<boolean> {
  return 是总管理(我, await 权限组织());
}

export type 交接种类 = "离职" | "转让";
export type 交接状态 = "待确认" | "已确认" | "已撤回" | "已拒收" | "已作废";
export const 待确认: 交接状态 = "待确认";
export const 已作废: 交接状态 = "已作废";

export function 读ids(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

type 库 = Pick<Prisma.TransactionClient, "entHandover">;

/**
 * 这几位里正在转让交接中的（同一位客户不能同时交给两个人）。交接那张表看全部：别人发起的交接也要数上；
 * 报出来的只留调用人看得到的那几位（2026-10-28：函数自己挡，不靠入口）——客户表限定着查一遍。
 * 在 看全部 里调（发起转让交接，候选已经按限定取过）= 调用方明说不限，照原样全报
 */
export async function 交接中的客户(ids: string[], db: Pick<Prisma.TransactionClient, "entHandover" | "customer"> = prisma): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const 要 = new Set(ids);
  const 行 = await 看全部(() => db.entHandover.findMany({ where: { kind: "转让", status: 待确认 }, select: { customerIds: true } }));
  const 中 = [...new Set(行.flatMap((r) => 读ids(r.customerIds)).filter((id) => 要.has(id)))];
  if (!中.length) return new Set();
  return new Set((await db.customer.findMany({ where: { id: { in: 中 } }, select: { id: true } })).map((c) => c.id));
}

/** 这位成员有没有还没确认的离职交接（任意一笔） */
export function 离职交接中(userId: string, db: 库 = prisma) {
  return 看全部(() => db.entHandover.findFirst({ where: { kind: "离职", fromUserId: userId, status: 待确认 } }));
}

/**
 * 离职交接一行管哪些（11-13 客户：离职交接也要接手人确认才生效）：
 *   客户 —— 单条交客户（customerIds 那几位，和跟着它们走的项目、待办）
 *   项目 —— 单条交项目（projectIds 那几个，挂在别人客户上的）
 *   全部 —— 一键全部交给、和办离职时发起的老行（way = 转交 / 公海）：确认时整包重新分拣，他名下的都算在里面
 * 老行 customerIds 有清点的，界面和三态只认清点的那几位（原口径不变）；新的「全部」一律按「还在他名下」认
 */
export type 离职范围 = "客户" | "项目" | "全部";
export function 离职范围of(way: string | null | undefined): 离职范围 {
  return way === "客户" ? "客户" : way === "项目" ? "项目" : "全部";
}

/**
 * 一行离职交接盖住哪些客户：列了 = 这几位；null = 他名下的都算（全部）；项目行不盖客户（空集合）。
 * 老行（转交 / 公海）列了清点的按清点的，没列的按全部
 */
export function 离职盖住的客户(h: { way: string | null; customerIds: string }): Set<string> | null {
  const 范围 = 离职范围of(h.way);
  if (范围 === "项目") return new Set();
  if (范围 === "客户") return new Set(读ids(h.customerIds));
  if (h.way === "全部") return null;
  const 列 = 读ids(h.customerIds);
  return 列.length ? new Set(列) : null;
}

/** 一行离职交接盖住哪些项目（挂在别人客户上的那种）：项目行 = 列的那几个；全部 = null（他名下的都算）；客户行 = 空 */
export function 离职盖住的项目(h: { way: string | null; projectIds: string }): Set<string> | null {
  const 范围 = 离职范围of(h.way);
  if (范围 === "项目") return new Set(读ids(h.projectIds));
  if (范围 === "客户") return new Set();
  return null;
}

/**
 * 把一行从待确认改成别的状态：带着 status 条件改，两个人同时点（接手人确认、发起人撤回）只成一个。改成了返回 true。
 * 谁能了结函数自己挡（2026-10-28，不靠入口）：确认、拒收只有接手人；撤回只有发起人或总管理（11-01 起只认业务角色）。
 * 不是这几位的一律改不成、返回 false（和「已经被别人了结」同一个说法）。
 * 撤回才读组织表；撤回不在事务里调（SQLite 只有一个连接，事务里再读会卡住）
 */
export async function 了结(db: 库, id: string, 状态: Exclude<交接状态, "待确认" | "已作废">, 我: { id: string; role: string }): Promise<boolean> {
  const 谁能 = 状态 === "已撤回" ? ((await 能撤回别人的交接(我)) ? {} : { byUserId: 我.id }) : { toUserId: 我.id };
  const r = await db.entHandover.updateMany({
    where: { id, status: 待确认, ...谁能 },
    data: { status: 状态, doneAt: new Date(), doneById: 我.id },
  });
  return r.count === 1;
}

/** 离职交接 counts（发起时清点的个数）拼成一句「N 位客户、M 个项目…」：确认框、通知、提示、留痕都用这一句；一样都没有 = 空 */
export function 离职段(个数: Record<string, number>): string {
  const 量词: [string, string][] = [["客户", "位客户"], ["项目", "个项目"], ["计划和待办", "条待办和计划"], ["线索", "条线索"], ["渠道", "个渠道"], ["主渠道", "个主渠道"]];
  return 量词.filter(([k]) => (个数[k] ?? 0) > 0).map(([k, 词]) => `${个数[k]} ${词}`).join("、");
}

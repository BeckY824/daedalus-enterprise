/**
 * 新建客户（没开项目：只建客户，客户自带一个潜客培育项目，M-公海-14）时，市场成员选的「项目分配方式」（11-18 用户）：
 * 「新建客户页给市场成员加一格项目分配方式，可选指定分配 / 自动分配 / 暂不分配，行为和建档向导一样；市场成员默认自动分配」。
 *
 * - 谁能用：企业版、市场成员（业务角色市场管理 / 渠道运营，或按部门 / 逐人认定的，同 assign-line.ts 算市场）；
 *   能选哪几种 = 新客户分配可选 ∩ 我能用的分配方式（谁能用照 assign-use.ts、自动分配要「线索分配」规则开着）。别人交了服务端拒
 * - 指定分配：负责人 = 选的那位，客户和潜客培育一起给他。市场首次分给销售（算市场转客户）= 先建在自己名下，
 *   同一笔事务里走 转客户给销售（市场转一位：换负责人记录、客户分配补「非自持」），先核接手人的持有上限（同建档向导）；
 *   接手人只能是参与状态正常的销售 / 销售管理（指定问题，同建档向导，11-18 第 8 题 B）；选自己 = 记在自己名下、分配方式记指定分配
 * - 自动分配：建在自己名下，建好走 建好再分 → 向导自动分配（分出去写分配记录）。市场成员按岗位（按区域分配）的按分配方向分：
 *   人改过就按改的（存 Project.assignDir），没改按 客户区域 → 客户的号 → 本人事业部 现算（客户默认分配方向）；
 *   按部门认的市场成员按潜客培育项目的业务线分（跟客户业务线）
 * - 暂不分配：负责人 = 自己，潜客培育记暂不分配（self-assign-mode.ts 本来就这么记，这里照选的写）
 * 项目分配方式这一格和客户档案上的「客户分配」（custAssign：自持 / 非自持 / 公海领取）是两回事，不互相写。服务端用，别在客户端 import
 */
import type { Prisma } from "@/generated/prisma";
import type { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 不能当负责人 } from "@/lib/owners";
import { 企业版 } from "@/lib/enterprise/switch";
import { 读组织 } from "@/lib/enterprise/org";
import { 读市场成员们 } from "@/lib/enterprise/market-db";
import { 算市场, 新客户分配可选, 是项目线, type 项目线 } from "@/lib/enterprise/assign-line";
import { 是分配方式序号 } from "@/lib/enterprise/dict";
import { 按区域分配of, 认分配方向, type 分配方向 } from "@/lib/enterprise/customer-region";
import { 客户默认分配方向 } from "@/lib/enterprise/assign-direction-db";
import type { 线 } from "@/lib/enterprise/lead-assign";
import { 指定问题 } from "@/lib/enterprise/assign-eta";
import { 算市场转客户, 转客户给销售 } from "@/lib/enterprise/market-transfer";
import { 持有上限起点, 写前核上限 } from "./db";
import type { 组织规则 } from "./org-rules";
import { 定分配方式, 建好再分, type 定好的分配 } from "./after-create-assign";

type 我 = Awaited<ReturnType<typeof requireUser>>;

/** 新建客户交上来的那一格：分配方式（序号 0 / 1 / 3）、分配方向（只在按区域的市场成员选自动分配、人改过时交内贸 / 外贸） */
export type 新客户分配交 = { 分配方式?: unknown; 分配方向?: unknown };

export type 认好的新客户分配 = {
  分配: 定好的分配;
  /** 客户、潜客培育项目最后归谁：指定分配 = 选的那位；另两种 = 自己 */
  负责人: string;
  /** 指定给销售、算市场首次分给销售：先建在自己名下，同一笔事务里走 转客户给销售（市场转一位） */
  转客户: boolean;
  /** 市场成员（按岗位）选自动分配：按分配方向分 */
  按区域: boolean;
  /** 按区域时人手动改的方向；没改 = null（建好后按默认顺序现算） */
  手选方向: 线 | null;
};

/** 建客户之前认一遍（事务外）：不是市场成员、选项不在可选里、指定的人不能接，都回 error */
export async function 认新客户分配(me: 我, 交: unknown, 选的负责人: string | null | undefined): Promise<认好的新客户分配 | { error: string }> {
  if (!企业版()) return { error: "企业版才有项目分配方式" };
  const org = await 读组织();
  if (!算市场(org.成员.get(me.id)?.角色们 ?? [], (await 读市场成员们(org)).has(me.id))) return { error: "只有市场成员新建客户时能选项目分配方式" };
  const 序 = 交 && typeof 交 === "object" ? (交 as 新客户分配交).分配方式 : undefined;
  if (!是分配方式序号(序) || !新客户分配可选.includes(序)) return { error: "新建客户的项目分配方式只能选指定分配、自动分配或暂不分配" };
  const 负责人 = 序 === 0 ? String(选的负责人 ?? "") : me.id;
  if (!负责人) return { error: "选了指定分配，请选客户负责人" };
  // 这人能不能用这种（谁能用、字典停用、自动分配要规则开着），同建档向导
  const 分配 = await 定分配方式(me, { 分配方式: 序, ownerId: 负责人 });
  if ("error" in 分配) return 分配;
  if (负责人 !== me.id) {
    const 问题 = (await 不能当负责人(负责人)) ?? (await 指定问题(org, 负责人));
    if (问题) return { error: 问题 };
  }
  const 按区域 = 序 === 1 && 按区域分配of(org, me.id);
  let 手选方向: 线 | null = null;
  if (按区域) {
    const 向 = 认分配方向((交 as 新客户分配交).分配方向);
    if (!向.ok) return { error: 向.error };
    手选方向 = 向.线 ?? null;
  }
  return { 分配, 负责人, 转客户: 负责人 !== me.id && 算市场转客户(org, { salesOwnerId: me.id, pool: null }, 负责人), 按区域, 手选方向 };
}

/** 指定给别人超了持有上限：「超了上限，」后面那半句 */
const 新客户超上限尾 = "客户没有建；先推进或放回一些，或者换一位负责人";

/**
 * 建客户那笔事务里、潜客培育项目建好之后调：项目记选的分配方式；自动分配记业务线（按部门认的跟客户业务线）/ 手选方向；
 * 指定给销售算市场转客户的，核接手人持有上限（新建的潜客培育算 1 个，超了抛 整批超上限、整笔回滚）后走 转客户给销售。
 * 规则：转客户时要（核上限），别的传 null
 */
export async function 落新客户分配(
  tx: Prisma.TransactionClient,
  a: 认好的新客户分配,
  x: { me: { id: string }; customerId: string; projectId: string; 客户线: string | null; 规则: 组织规则 | null },
): Promise<void> {
  // 自动分配记哪条线：按区域的 = 手选方向（没改的建好后现算再补）；按部门认的 = 客户业务线
  const 记线 = a.分配.i !== 1 ? null : a.按区域 ? a.手选方向 : 是项目线(x.客户线) ? x.客户线 : null;
  const 手选 = a.分配.i === 1 && a.按区域 ? a.手选方向 : null;
  await tx.project.update({ where: { id: x.projectId }, data: { assignMode: a.分配.名, ...(记线 ? { bizLine: 记线 } : {}), ...(手选 ? { assignDir: 手选 } : {}) } });
  if (!a.转客户) return;
  await 写前核上限(tx, x.规则 ? await 持有上限起点(tx, x.规则, a.负责人) : null, 1, "分配", 新客户超上限尾);
  // 转走后这位客户我就看不到了：放开范围（同建档向导、客户页新建项目）
  await 看全部(() => 转客户给销售(tx, x.customerId, x.me.id, a.负责人, x.me.id, a.分配.名));
}

/**
 * 事务提交以后：自动分配 / 暂不分配走 建好再分（自动分配分出去写分配记录、没分出去留待分配并提醒；暂不分配回那句提示）。
 * 按区域没改方向的：按 客户区域 → 客户的号 → 本人事业部 现算，算出线来补进潜客培育的业务线（空着才补）。指定分配回 null（调用方发通知、记分配数）
 */
export async function 新客户建好再分(
  me: 我, a: 认好的新客户分配, x: { customerId: string; projectId: string; 项目名: string; 客户线: string | null },
): Promise<{ 提示: string; 转走: boolean } | null> {
  if (a.分配.i === 0) return null;
  let 业务线: 项目线 | null = 是项目线(x.客户线) ? x.客户线 : null;
  let 方向: 分配方向 | undefined;
  if (a.按区域) {
    方向 = a.手选方向 ? { 线: a.手选方向, 来源: "手动" } : await 客户默认分配方向(await 读组织(), x.customerId, me.id, x.projectId);
    业务线 = 方向.线;
    if (方向.线 && !a.手选方向) await prisma.project.updateMany({ where: { id: x.projectId, bizLine: null }, data: { bizLine: 方向.线 } });
  }
  return 建好再分(me, a.分配, x.projectId, x.项目名, 业务线, null, 方向);
}

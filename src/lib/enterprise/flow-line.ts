/**
 * 流转线写库（32G）：规则见 flow-line-core.ts 开头。写入点都在事务里调这里，同一笔事务读组织（读组织于 tx，不等别的连接）：
 *   - 新增：新建定线（建档向导、客户页新增项目、潜客培育、线索转项目、查重领取建项目、导入建项目）
 *   - 换负责人：换人定线（assign-actions.ts 分项目给、公海分配、项目改负责人、客户转让带项目、离职交接）
 * 项目用 Prisma 写（看全部：谁分出去的都要写上）；客户用裸 SQL 写，不碰客户的 updatedAt（客户编辑框按它做乐观锁，换线不该让人保存撞车）
 */
import type { Prisma } from "@/generated/prisma";
import type { PrismaClient } from "@/generated/prisma";
import { 读组织于 } from "./org";
import type { 组织 } from "./org-core";
import { 线部门key, 规整线部门, type 线部门 } from "./assign-line";
import { 换人后的线, 新建线of } from "./flow-line-core";
import { 企业版 } from "./switch";
import { 看全部 } from "@/lib/team-scope";
import { prisma } from "@/lib/prisma";
import type { 线 } from "./lead-assign";

type 库 = Prisma.TransactionClient | PrismaClient;

/** 线部门设置（同 assign-eta.ts 读线部门，但从给定的库读：事务里不等全局连接） */
export async function 读线部门于(db: Pick<库, "setting">): Promise<线部门> {
  const v = (await db.setting.findUnique({ where: { key: 线部门key }, select: { value: true } }))?.value;
  let x: unknown = null;
  try {
    x = v ? JSON.parse(v) : null;
  } catch {
    x = null;
  }
  return 规整线部门(x);
}

/** 组织 + 线部门，从给定的库读 */
export async function 读线组织(db: 库): Promise<{ org: 组织; 设: 线部门 }> {
  const org = await 读组织于(db);
  return { org, 设: await 读线部门于(db) };
}

const 一批 = 500;

/** 把这些项目（和它们的客户）、另给的客户的流转线写成 线 */
export async function 写流转线(db: 库, 线: 线, 们: { 项目?: readonly string[]; 客户?: readonly string[] }): Promise<void> {
  if (!企业版()) return;
  const 项目 = [...new Set(们.项目 ?? [])];
  const 客户 = new Set(们.客户 ?? []);
  await 看全部(async () => {
    for (let i = 0; i < 项目.length; i += 一批) {
      const 批 = 项目.slice(i, i + 一批);
      await db.project.updateMany({ where: { id: { in: 批 } }, data: { flowLine: 线 } });
      for (const p of await db.project.findMany({ where: { id: { in: 批 } }, select: { customerId: true } })) 客户.add(p.customerId);
    }
    const 客户们 = [...客户];
    for (let i = 0; i < 客户们.length; i += 一批) {
      await db.$executeRawUnsafe(
        `UPDATE "Customer" SET "flowLine" = ? WHERE id IN (SELECT value FROM json_each(?)) AND ("flowLine" IS NULL OR "flowLine" <> ?)`,
        线, JSON.stringify(客户们.slice(i, i + 一批)), 线,
      );
    }
  });
}

/**
 * 换负责人时定线（规则见 flow-line-core.ts 换人后的线）：要改就写项目和它们的客户（另给的客户一起写），回写成的线；不改回 undefined。
 * org / 设 调用方手上有就传，省一次读
 */
export async function 换人定线(
  db: 库, 们: { 项目?: readonly string[]; 客户?: readonly string[] },
  a: { 操作人: string | null; 接手人: string; 方向?: 线 | null; 自动?: boolean }, 已读?: { org: 组织; 设: 线部门 },
): Promise<线 | undefined> {
  if (!企业版() || (!们.项目?.length && !们.客户?.length)) return undefined;
  const { org, 设 } = 已读 ?? (await 读线组织(db));
  const 线 = 换人后的线(org, 设, a);
  if (线) await 写流转线(db, 线, 们);
  return 线;
}

/**
 * 新增时定线：新增人所在事业部写到这个项目（和它的客户）上；判不出不写（空着，之后分配 / 管理指定再写）。
 * 建的时候负责人就直接给了别人：管理 / 市场建的按「指定」认（换人后的线：写接收人的线；市场的之后 direct-assign.ts 再按方向写一次），
 * 销售建的照旧按自己
 */
export async function 新建定线(db: 库, projectId: string, 建的人: string, 负责人?: string | null, 已读?: { org: 组织; 设: 线部门 }): Promise<线 | null> {
  if (!企业版()) return null;
  const { org, 设 } = 已读 ?? (await 读线组织(db));
  const 线 = (负责人 && 负责人 !== 建的人 ? 换人后的线(org, 设, { 操作人: 建的人, 接手人: 负责人 }) : undefined) ?? 新建线of(org, 设, 建的人);
  if (线) await 写流转线(db, 线, { 项目: [projectId] });
  return 线;
}

/**
 * 新建落库以后（事务提交了）定线：建档向导、只建客户、客户页新增项目、新建客户带的潜客培育项目都在这里补，
 * 要排在 建好再分 之前（自动分配那一刻按方向再写一次，盖掉这条）。出错只打日志，不连累已经建好的
 */
export async function 新建后定线(projectId: string | null | undefined, 建的人: string): Promise<void> {
  if (!企业版() || !projectId) return;
  try {
    const p = await 看全部(() => prisma.project.findUnique({ where: { id: projectId }, select: { ownerId: true } }));
    if (p) await 新建定线(prisma, projectId, 建的人, p.ownerId);
  } catch (e) {
    console.warn("[流转线] 新建定线没写上：", e instanceof Error ? e.message : e);
  }
}

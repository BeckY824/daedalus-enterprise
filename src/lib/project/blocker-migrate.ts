/**
 * 卡点 11-01 改版的老数据一次性改过来（迁移只加表加列，数据改动放这里、记一笔只做一次，照 enterprise/customer-v2-db.ts）：
 *   状态：看板 → 待接受；待接受 → 待接受、清掉指认；处理中 → 处理中、原经手人记成第一位认领人；已解决 → 原经手人记成已完成的认领人（规矩在 改版后）
 *   标题：没有的取描述前 20 字
 *   阻碍原因：老卡点不挂（B9 定稿：老阻碍主体不归类、不生成待审核原因）；obstacle 原样留着，详情显示「原阻碍主体：X」，统计进「未分类（老数据）」
 * 每条卡点一个事务；已经有认领行的不再动状态（新流程发的、或上次跑到一半的），所以重跑不会多出行。
 * 不是企业版什么都不做
 */
import { prisma } from "../prisma";
import { 查完再写 } from "../check-then-write";
import { 看已删 } from "../enterprise/soft-delete-core";
import { 看全部 } from "../team-scope";
import { getSetting, setSetting } from "../settings";
import { 企业版 } from "@/lib/enterprise/switch";
import { 改版后, 标题of } from "./blocker-rules";
import { 备好原因 } from "./blocker";

export const 卡点改版记号键 = "entBlocker.v2Migrated";
const g = globalThis as unknown as { __entBlockerV2?: Promise<number> };

/** 改一遍，返回动了几条。已经改过（记号在）什么都不做 */
export async function 卡点改版(): Promise<number> {
  if (!企业版()) return 0;
  if (await getSetting<boolean>(卡点改版记号键)) return 0;
  await 备好原因();
  const ids = await 看已删(() => 看全部(() => prisma.entBlocker.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } })));
  let 动了 = 0;
  for (const { id } of ids) {
    const 改了 = await 查完再写((tx) => 看已删(() => 看全部(async () => {
      const b = await tx.entBlocker.findUnique({ where: { id }, include: { _count: { select: { claims: true } } } });
      if (!b) return false;
      let 动 = false;
      if (b._count.claims === 0 && (b.assigneeId || (b.status !== "待接受" && b.status !== "已解决"))) {
        const 新 = 改版后(b.status, b.assigneeId);
        if (新.认领) await tx.entBlockerClaim.create({ data: { blockerId: b.id, userId: 新.认领.userId, done: 新.认领.done, doneAt: 新.认领.done ? b.resolvedAt ?? b.updatedAt : null, createdAt: b.createdAt } });
        await tx.entBlocker.update({ where: { id: b.id }, data: { status: 新.status, assigneeId: null } });
        await tx.entBlockerLog.create({ data: { blockerId: b.id, userId: b.creatorId, action: "migrate", fromUserId: b.assigneeId, toUserId: 新.认领?.userId ?? null, note: `${b.status} → ${新.status}` } });
        动 = true;
      }
      if (!b.title) {
        await tx.entBlocker.update({ where: { id: b.id }, data: { title: 标题of("", b.description) } });
        动 = true;
      }
      return 动;
    })));
    if (改了) 动了++;
  }
  await setSetting(卡点改版记号键, true);
  return 动了;
}

/** 服务启动时排着跑（instrumentation.ts）；同一进程只跑一次，出错下次启动再试 */
export function 卡点改版一次(): Promise<number> {
  g.__entBlockerV2 ??= 卡点改版().catch((e) => {
    g.__entBlockerV2 = undefined;
    console.error("[卡点] 11-01 改版老数据出错，下次再试", e);
    return 0;
  });
  return g.__entBlockerV2;
}

/** 测试用：忘掉这个进程跑过 */
export function 忘掉卡点改版(): void {
  g.__entBlockerV2 = undefined;
}

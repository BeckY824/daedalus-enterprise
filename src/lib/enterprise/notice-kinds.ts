/**
 * 通知按种类分先后（11-21 批次 33 批 1 · B01）。纯函数，飞书推送队列用。
 *
 * 飞书出队先后：超时未跟进（含超时转出给原负责人那条）> 指定回复提醒 > 跟进到期 / 逾期、客户即将回收 > 其余知会类（快轮到、分配…）
 *
 * 种类字面量和各来源的常量一致：超时未跟进 = reply-overdue.ts 超时通知种类，快轮到 = assign-eta.ts 快轮到kind（tests/ent-feishu-queue.test.ts 钉着）
 */

/** 飞书推送出队先后：数小的先出 */
const 先后表: Record<string, number> = {
  超时未跟进: 0,
  指定回复: 1,
  跟进到期: 2,
  跟进逾期: 2,
  三态: 2,
  将回收: 2,
};

export const 知会类先后 = 3;

export function 推送先后(kind: string): number {
  return 先后表[kind] ?? 知会类先后;
}

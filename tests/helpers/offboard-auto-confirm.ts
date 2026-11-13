/**
 * 11-13 起「项目 → 离职交接」交了只是发起（记一行待确认），接手人确认了才转（客户原话「离职交接也必须接手人点确认才生效」）。
 * 好多老用例测的是「交过去之后数据怎么走」（项目跟着走、记历史负责人、持有上限、备注留行…），不关心中间那一步确认：
 * 这里的三个动作 = 真的发起 + 接手人马上确认（lib 那一层 确认离职交接，同客户页「确认接手」实际做的转法），一次做完，返回和原来一样的形状。
 *   - 发起没成：原样返回
 *   - 确认超持有上限：回那句话，这笔交接按撤回收掉（等于原来「一个都没交」），后面再交不会被「在等确认」挡住
 * 只用在测转法的老用例里；确认这一步本身（不换负责人、拒收、撤回、重复发起、通知）在 tests/ent-offboard-confirm.test.ts 测
 */
import { prisma } from "@/lib/prisma";
import { 整批或不做 } from "@/lib/project/db";
import { 确认离职交接 } from "@/lib/enterprise/offboard-handover";
import * as 真 from "@/app/(app)/projects/handover/actions";

type 结果 = Awaited<ReturnType<typeof 真.交接客户>>;

async function 接手人确认(r: 结果): Promise<结果> {
  if (!r.ok || !r.交接) return r;
  const h = await prisma.entHandover.findUniqueOrThrow({ where: { id: r.交接 } });
  const 接手 = await prisma.user.findUniqueOrThrow({ where: { id: h.toUserId }, select: { id: true, role: true } });
  const 确 = await 整批或不做(() => 确认离职交接(接手, h));
  if (!确.ok) {
    await prisma.entHandover.update({ where: { id: h.id }, data: { status: "已撤回", doneAt: new Date() } });
    return { ok: false, error: 确.超 };
  }
  return r;
}

export const 交接客户 = async (...a: Parameters<typeof 真.交接客户>) => 接手人确认(await 真.交接客户(...a));
export const 交接项目 = async (...a: Parameters<typeof 真.交接项目>) => 接手人确认(await 真.交接项目(...a));
export const 交接全部 = async (...a: Parameters<typeof 真.交接全部>) => 接手人确认(await 真.交接全部(...a));

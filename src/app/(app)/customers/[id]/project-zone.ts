import type { SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 在推项目条件 } from "@/lib/project/active";
import { 能看项目 } from "@/lib/enterprise/permissions";
import { 权限组织 } from "@/lib/enterprise/org";
import { 读项目详情 } from "../../projects/[id]/load";
import type { 项目区数据 } from "./ProjectZone";
import { 默认页签 } from "@/lib/project/customer-detail-href";
// 页签上写的当前节点（有结局写结局，异常写「异常 · 节点」），和客户列表「当前节点」一列同一句
import { 节点字 } from "@/lib/project/customer-list-projects";

type 列表项目 = { id: string; name: string; node: string; result: string | null; pooledAt: Date | null };


/**
 * 客户详情的项目区（11-12 客户详情合并第 2 批）：
 *   - 页签 = 这位客户名下我能看的项目（列表已经过限定层、去掉了我回避的公海项目；这里再按 能看项目 挡一遍，同项目详情页）
 *   - 锁数 = 看不到的同事在推项目个数（只给个数，P-看-12）
 *   - 当前 = 选中那个项目的详情数据，和项目详情页同一个取数（projects/[id]/load.ts），权限 props 一个算法
 *   - 不数锁：受限客户详情（restricted.ts，只负责项目的人）连同事在推项目的个数也不给，锁数恒 0
 */
export async function 读项目区(me: SessionUser, customerId: string, 列表: readonly 列表项目[], 要的: string | null, 选项?: { 不数锁?: boolean }): Promise<项目区数据> {
  const org = await 权限组织();
  const 行 = 列表.length
    ? await prisma.project.findMany({
        where: { id: { in: 列表.map((p) => p.id) } },
        select: { id: true, ownerId: true, creatorId: true, pooledAt: true, bizLine: true, members: { where: { inviteStatus: "JOINED" }, select: { userId: true } } },
      })
    : [];
  const 能看 = new Set(行.filter((r) => 能看项目(me, { ...r, 已加入: r.members.map((m) => m.userId) }, org)).map((r) => r.id));
  const 可看 = 列表.filter((p) => 能看.has(p.id));

  // 先读要的那个；读不到（看不了、不是这位客户的、删了）就换默认的那个，再不行再往下找，不报「没有找到」
  const 顺序 = [
    ...(要的 && 可看.some((p) => p.id === 要的) ? [要的] : []),
    ...(() => { const d = 默认页签(可看); return d && d.id !== 要的 ? [d.id] : []; })(),
    ...可看.map((p) => p.id),
  ];
  // 锁数和下面读当前项目详情并行（审查 #4）；读详情里的负责人候选、组织、组织规则是请求内缓存，和客户页同一份
  const 锁数P = 选项?.不数锁 ? Promise.resolve(0) : 看全部(() => prisma.project.count({ where: { customerId, ...在推项目条件, deletedAt: null, id: { notIn: 可看.map((p) => p.id) } } }));
  锁数P.catch(() => undefined); // 下面读详情先抛错时别留一个没人接的 rejection；结果照样在后面 await
  let 当前: 项目区数据["当前"] = null;
  const 读不了 = new Set<string>();
  for (const id of [...new Set(顺序)]) {
    const r = await 读项目详情(me, id);
    if (r.种 === "有" && r.customerId === customerId) { 当前 = r.props; break; }
    读不了.add(id);
  }
  const 页签们 = 可看.filter((p) => !读不了.has(p.id));
  const 锁数 = await 锁数P;
  return { customerId, 页签们: 页签们.map((p) => ({ id: p.id, name: p.name, 节点: 节点字(p) })), 锁数, 当前 };
}

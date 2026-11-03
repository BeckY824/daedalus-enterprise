import { prisma } from "./prisma";
import { 可担任负责人 } from "./constants";
import { 无负责人占位邮箱 } from "./pool";
import { 权限组织 } from "./enterprise/org";
import { 能当负责人, 不能当负责人话, 公海分不给话, type 谁 } from "./enterprise/permissions";

/**
 * 「谁能被指派为负责人」的候选名单。
 *
 * 默认口径是排除系统管理员（见 constants.ts 里 可担任负责人 的说明）——
 * 管理员只做系统维护，业绩排行榜也不算他们的。
 *
 * 但这条规则在「整个工作区只有一个人，而那个人是管理员」时会把产品卡死：
 * 负责人是必填项，下拉却是空的，新注册的人连第一条客户都建不出来。
 * 托管版每个新工作区一开始都正好是这个状态。
 *
 * 所以这里留一个回退：没有任何非管理员可选时，列出全部在职成员。
 * 「管理员不当负责人」是一种偏好，不是不变量；没有别人时它必须让路。
 *
 * 回退是「**整个工作区一个非管理员都没有**」时才发生的，不是「这次没查到」。
 * 多人工作区里管理员照样不进候选、也不进排行榜——他自己给自己派客户就上榜的话，
 * 排行榜和「管理员不做销售」这个口径又对不上了。
 * 单人工作区不存在这个矛盾：那个人就是销售本人，指派、AI 匹配、排行榜都得认他，
 * 否则他在自己的系统里既选不到自己、也从来看不见自己的业绩（见 负责人口径）。
 */
export async function 负责人候选() {
  const 选项 = { select: { id: true, name: true, email: true }, orderBy: { name: "asc" as const } };
  return prisma.user.findMany({ where: await 负责人口径(), ...选项 });
}

/** 公海「分配给…」的下拉（11-03 B2-7）：负责人候选里分得过去的——不是系统管理员时只剩同业务线的。不是企业版 = 负责人候选 */
export async function 公海分配候选(me: 谁) {
  const [们, org] = await Promise.all([负责人候选(), 权限组织()]);
  return org ? 们.filter((u) => 公海分不给话(me, org, u.id) === null) : 们;
}

/**
 * 同一条规则的 where 形态，给需要自己挑字段的查询用（比如排行榜要连商机一起取）。
 *
 * 判断的是「这个工作区里**有没有**非管理员」，不是「这一条查询有没有命中非管理员」——
 * 后者会让一个多人工作区里的管理员因为重名之类的巧合被悄悄放进来。
 */
export async function 负责人口径() {
  // 企业版按业务角色（11-03 完成度 D3-9）：有角色、不是只读管理员；不看账号角色，也没有「没别人就列全部」的回退
  const org = await 权限组织();
  if (org) return { active: true, id: { in: [...org.成员.keys()].filter((id) => 能当负责人(org, id)) } };
  const 有别人 = await prisma.user.count({ where: 可担任负责人 });
  return 有别人 > 0 ? 可担任负责人 : { active: true };
}

/**
 * 按名字在候选名单里找人。AI 建议卡里的负责人是**名字**，落库要 id。
 *
 * 走的是和下拉一模一样的名单——否则会出现「下拉里能选到我，AI 却说没有叫我这个名字的在职销售」：
 * 单人工作区（桌面端、新注册的托管版工作区）里那个人是管理员，严格口径把他排除在外，
 * 于是首页让 AI 记一笔带负责人的东西就一直失败。
 *
 * 返回命中的全部人，重名怎么报错由调用方决定——绝不替人猜。
 */
export async function 按名字找负责人(名字: string) {
  const n = 名字.trim();
  return (await 负责人候选()).filter((u) => u.name === n);
}

/**
 * 一个人的工作区：负责人这件事不必问。
 *
 * 桌面端就是一人公司，或者一个销售自己记账——库里只有他一个人。
 * 让他从一个只有自己的下拉里选一次自己，是在问一个只有一个答案的问题；
 * 更糟的是它还是必填的，等于每建一条记录都要多点两下。
 *
 * 返回候选名单里**唯一**那个人的 id；有第二个人就返回 null——
 * 那时候归属是真问题，必须让人自己选，不能替他挑一个。
 */
export async function 唯一负责人(): Promise<string | null> {
  const 候选 = await 负责人候选();
  return 候选.length === 1 ? 候选[0].id : null;
}

/** 历史记录筛选不是指派：管理员及留有跟进的停用成员都必须可选。 */
export async function 跟进筛选成员() {
  return prisma.user.findMany({
    // 占位账号（导入时没有负责人的沟通挂在它上面）不是成员，不进筛选
    where: { email: { not: 无负责人占位邮箱 }, OR: [{ active: true }, { followUps: { some: {} } }] },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

/**
 * 服务端指派负责人时的同一道闸（11-03 完成度 D3-9 / C3-1）：企业版没设业务角色、只读管理员不能当负责人。
 * 返回拒绝的话；能当或不是企业版 = null。在职另由各入口查
 */
export async function 不能当负责人(userId: string): Promise<string | null> {
  const org = await 权限组织();
  return org ? 不能当负责人话(org, userId) : null;
}
/** 公海分配（客户、项目）服务端那道：同 公海分配候选，分不过去的那一句；能分 = null */
export async function 公海分不给(me: 谁, userId: string): Promise<string | null> {
  const org = await 权限组织();
  return org ? 公海分不给话(me, org, userId) : null;
}

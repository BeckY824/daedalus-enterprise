/**
 * 市场成员经号码查重领公海客户（员工反馈 F-016，客户 11-19 口径）：
 *   「市场成员通过号码查重验证来咨询的项目/客户已在公海中，可以进行该公海项目/客户的领取，
 *    但领取时有以下两个必要限制：1.必须写沟通记录；2.只能自动分配」
 *
 * 只开这一个入口：新建线索 / 新建客户向导、首页查重框、首页 AI 建档卡片查重撞上「公海待捞」时。公海页的「领取」对市场成员照旧不开（P-公海-01）。
 * 两条路（查重领取口径.新建线索项目 切，集中在这一处）：
 *   - 新建线索项目（现行，用户 11-19：「客户来源以首次永不变更，项目来源以每次新建的为主……项目对接人以录入为主」）：
 *     客户整体出公海、名下公海里的旧项目照「领客户带走名下公海项目」一起走；另建一条线索项目（起点节点、渠道 = 这次选的、
 *     对接人 = 选的那位客户联系人、创建人 = 市场成员、分配方式 = 自动分配），沟通记在它上面，按市场分给销售进线索验证；
 *     不补潜客培育（新项目就是在推项目）。客户的渠道、联系人一律不改，不新建联系人。
 *     为什么不领旧项目：公海客户最近那条项目多半是历史沟通分析回填的或已结束，回填项目渠道统计不算，领旧项目这次咨询在渠道页上看不到
 *   - 只领旧项目（关掉开关退回这条）：名下在线索公海的项目取最近进公海的一条；没有就补潜客培育那一条；都没有取名下最近建的在推项目
 *   「多建一条线索」还等客户确认；不同意就把开关关掉，两条路的测试都在 tests/ent-dedupe-claim.test.ts
 * 动作本身在 customers/pool-actions.ts 查重领取（要和公海领取共用 公海客户出手 那一个事务）；这里放它要的几样：
 *   - 谁能走：市场成员（是市场成员of：渠道运营 / 市场管理、不兼销售、没设只看某人）
 *   - 原负责人回避（P-公海-04）：用户 11-19「仅对创建人豁免，对其他人有效」——客户创建人例外，别人照常回避
 *   - 挑谁：照新线索自动分配（assign-actions.ts 自动分给，市场成员发起那一支）：按客户区域 → 电话 → 本人事业部定内贸 / 外贸（P-转-26），
 *     候选 = 自动分配池（销售；内贸含销售管理；义乌档口整组不进，P-转-27），参与状态、配额、本月已分最少优先（P-转-29）
 *   - 沟通写进领到的那条项目（P-沟通-03），和领取同一个事务
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 看全部 } from "@/lib/team-scope";
import { 企业版 } from "./switch";
import { 是市场成员of, type 组织 } from "./org-core";
import { 自动分配池, 读线部门, 读挑人底子, 补记销售管理起算 } from "./assign-eta";
import { 两条线 } from "./assign-line";
import { 计不计数, 月份, type 线 } from "./lead-assign";
import { 方向分配理由, type 分配方向 } from "./customer-region";
import { 客户默认分配方向 } from "./assign-direction-db";
import { 本套名, 字典of, 第一个节点 } from "@/lib/project/nodes";
import { 重复咨询来源 } from "@/lib/project/system-created";
import { 记沟通编号 } from "@/lib/project/followup-meta";
import { 记沟通标记 } from "@/lib/project/stage-gates";
import { 项目名上限, type 规整好的沟通 } from "@/lib/project/wizard";
import { 新项目默认值 } from "@/lib/project/proj-fields";
import { 默认币种 } from "@/lib/currency";
import { 号键 } from "@/lib/phone";
import { 号键SQL } from "@/lib/phone-dedupe";
import { getBusiness } from "@/lib/business";
import { 权限组织 } from "./org";
import { 全公司查号, 首条撞的, 我回避的, type 验好的号 } from "./contact-dedupe";

type 库 = Prisma.TransactionClient | typeof prisma;

/**
 * 两条路的开关（见文件头）。新建线索项目 = true：另建一条线索项目挂这次的渠道、对接人、沟通（用户 11-19 口径）；
 * false：退回只领旧项目（领最近进公海的那条 / 补潜客培育）。「多建一条线索」待客户确认，不同意就改成 false。
 * 写成对象（不是 const 布尔）：测试两条路都要跑
 */
export const 查重领取口径 = { 新建线索项目: true };

/** 查重领取只给市场成员（他们平时不能领公海、不能给公海客户记沟通，P-公海-01）；别人撞上公海照旧「去领取」去公海页 */
export function 能查重领取(org: 组织 | null, userId: string): boolean {
  return !!org && 企业版() && 是市场成员of(org, userId);
}

export const 不是市场成员查重领取话 = "查重领取只给市场成员（渠道运营、市场管理）；你可以去公海页领取";
export const 没撞上公海话 = "这个号码现在没撞上公海里的客户（可能刚被别人领走），按最新的查重结果来";

/** 事务里发现对不上（被人先领走、项目刚被动过）：抛出来整笔回滚，调用方接住说人话 */
export class 查重领取作废 extends Error {}
/** 事务里复核：挑的人刚被别的分配分满了 / 不再是排第一的：整笔回滚，调用方换人重挑 */
export class 查重领取换人 extends Error {
  constructor(readonly 满: boolean) { super(满 ? "分满了" : "换人"); }
}

/**
 * 公海客户的原负责人 = 最近一次把它放进公海的人（P-公海-04、M-公海-03）：客户挂占位账号的，认最近一条换到占位账号的记录的 from
 *（不限种类，同 owner-log-db.ts 公海客户原负责人是，向导里「原负责人是我」和这里一个口径）；负责人还是真人的（部署前进公海的老数据）就是他。认不出 = null。
 * 整个包 看全部：公海回避会把「我放进公海的客户」的换负责人记录藏掉（team-scope 里跟着客户走），限定读读成 null 就等于放行原负责人领回
 */
export async function 公海客户的原负责人(db: 库, customerId: string): Promise<string | null> {
  return 看全部(async () => {
    const c = await db.customer.findUnique({ where: { id: customerId }, select: { salesOwnerId: true, salesOwner: { select: { email: true } } } });
    if (!c) return null;
    if (c.salesOwner?.email !== 无负责人占位邮箱) return c.salesOwnerId || null;
    const r = await db.customerOwnerLog.findFirst({
      where: { customerId, toOwnerId: c.salesOwnerId },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      select: { fromOwnerId: true },
    });
    return r?.fromOwnerId ?? null;
  });
}

/** 客户创建人（CustomerCreator）；没记 = null */
export async function 客户创建人(db: 库, customerId: string): Promise<string | null> {
  return (await 看全部(() => db.customerCreator.findUnique({ where: { customerId }, select: { userId: true } })))?.userId ?? null;
}

/**
 * 原负责人回避（P-公海-04）在查重领取里怎么算：用户 11-19「仅对创建人豁免，对其他人有效」。
 * 原负责人是客户创建人 = 不回避（他发起领取能领、自动分配也能挑到他）；别的原负责人照常回避
 */
export function 要回避(原负责人: string | null, 创建人: string | null): boolean {
  return !!原负责人 && 原负责人 !== 创建人;
}

/**
 * 发起领取的这位是不是「原负责人领不回」（P-公海-04）：和查重向导的「原负责人是我」同一个判断（contact-dedupe.ts 我回避的：
 * 负责人还是我、换到占位账号的最近一条是我放的、公海回避名单里有它），再按用户 11-19「仅对创建人豁免」放过客户创建人。
 * 这样向导里「原负责人是我」和「市场可领」不会同时为真
 */
export async function 发起人领不回(db: 库, 挑: { id: string; salesOwnerId: string | null }, meId: string): Promise<boolean> {
  if (!(await 我回避的(db, 挑, meId))) return false;
  return (await 客户创建人(db, 挑.id)) !== meId;
}

/**
 * 查重撞上「公海待捞」时这位能不能就地领（查号码的 市场可领、AI 建档卡片的 公海号）：同 查重领取 进门那几道——
 * 项目模式、市场成员、首条撞的还在客户公海、原负责人回避只豁免客户创建人。只给界面摆不摆键，领的时候 查重领取 再判一遍
 */
export async function 查重可领(meId: string, 号: 验好的号): Promise<boolean> {
  if ((await getBusiness()).projectMode !== true) return false;
  if (!能查重领取(await 权限组织(), meId)) return false;
  const 挑 = await 首条撞的(prisma, await 全公司查号(prisma, 号.类型, 号.值, 号.键));
  if (!挑?.pool) return false;
  return !(await 发起人领不回(prisma, 挑, meId));
}

/** 名下在线索公海里的项目：取最近进公海的一条（同一刻按建得晚的、id 大的）。多条时只认这一条挂沟通、记分配，别的照「领客户带走公海里的项目」一起归接手人 */
export async function 最近的公海项目(db: 库, customerId: string): Promise<{ id: string; name: string } | null> {
  return 看全部(() => db.project.findFirst({
    where: { customerId, pooledAt: { not: null } },
    orderBy: [{ pooledAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: { id: true, name: true },
  }));
}

/** 出公海以后挂沟通的退路：客户名下归接手人、在推（没结局、不在公海）的最近建的一条 */
export async function 最近的在推项目(tx: Prisma.TransactionClient, customerId: string, ownerId: string): Promise<string | null> {
  return (await tx.project.findFirst({ where: { customerId, ownerId, pooledAt: null, result: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } }))?.id ?? null;
}

export type 查重领取候选 = {
  人们: string[];
  向: 分配方向;
  底: Awaited<ReturnType<typeof 读挑人底子>>;
  查满: boolean;
  月: string;
  /** 读挑人底子 的补位参数（判无效待补）：重读底子时照传；null = 这次不用待补 */
  补位: { 线: 线 | null } | null;
};

/**
 * 自动分配的候选（照 自动分给 市场成员按区域那一支）：方向按 客户区域 → 项目所在地 → 客户的号 → 发起人本人事业部，
 * 都判不出两条线都算；回避 = 不挑的人（原负责人回避，见 要回避）。
 * 用补位 = 这次算本月已分（新建线索项目、或没有公海项目可挂），判无效待补的人优先（invalid-makeup.ts）；只领旧的公海项目那条不算数、不用
 */
export async function 查重领取候选们(org: 组织, 发起人: string, customerId: string, projectId: string | null, 回避: readonly string[], 用补位 = false): Promise<查重领取候选> {
  const 向 = await 客户默认分配方向(org, customerId, 发起人, projectId);
  const 设 = await 读线部门();
  const 池 = 向.线 ? 自动分配池(org, null, 向.线, 设) : [...new Set(两条线.flatMap((l) => 自动分配池(org, null, l, 设)))];
  const 人们 = 池.filter((id) => !回避.includes(id));
  await 补记销售管理起算(org, 人们);
  const 月 = 月份();
  const 补位 = 用补位 ? { 线: 向.线 } : null;
  const 底 = await 读挑人底子(人们, 月, 补位);
  return { 人们, 向, 底, 查满: 计不计数("营销", 底.企划算数), 月, 补位 };
}

export const 查重领取理由 = (c: 查重领取候选, 原因: string) => `${原因}；${方向分配理由(c.向)}`;

/**
 * 挑不到人时那一句（照 P-转-38 定时分配分不出去的说法：说清原因，不领、不动）
 */
export function 挑不到话(为什么: string): string {
  return `没有自动分出去：${为什么}。这次没领，客户还在公海，沟通也没记；请找销售管理处理`;
}

/**
 * 在领到的项目上记那条沟通（事务里，查重领取用）：记的人 = 市场成员，挂这条项目当时的节点；下一步是负责人的格，不写（同组员记，11-19）。
 * 不过 记项目沟通 那道「谁能记」：这一笔就是 F-016 开的例外，事务里刚把项目给了接手人
 */
export async function 查重领取记沟通(tx: Prisma.TransactionClient, 记的人: string, projectId: string, 好: 规整好的沟通, now: Date): Promise<string> {
  return 看全部(async () => {
    const p = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, customerId: true, contactId: true, node: true, phase: true, pooledAt: true, result: true } });
    if (!p || p.pooledAt || p.result) throw new 查重领取作废("要挂沟通的项目刚被人动过（结束了或回了公海），这次没领");
    const 跟进 = await tx.followUp.create({
      data: { type: 好.type, method: 好.method, initiator: 好.initiator, content: 好.content, occurredAt: 好.occurredAt, title: "", status: "已完成", customerId: p.customerId, contactId: p.contactId, ownerId: 记的人 },
    });
    await tx.followUpProject.create({ data: { followUpId: 跟进.id, projectId: p.id, node: 本套名(p.node, 字典of(企业版())) } });
    await 记沟通编号(tx, 跟进.id, p.id, null, now);
    await 记沟通标记(tx, 跟进.id, p.id, p.phase, false);
    const c = await tx.customer.findUnique({ where: { id: p.customerId }, select: { lastFollowAt: true } });
    if (!c?.lastFollowAt || c.lastFollowAt < 好.occurredAt) await tx.customer.update({ where: { id: p.customerId }, data: { lastFollowAt: 好.occurredAt } });
    return 跟进.id;
  });
}

/**
 * 号码撞上的那位联系人（新建线索项目的对接人默认是他）：联系人自己的电话 / 邮箱 / 微信对得上的，或号码子表里挂在联系人身上的；
 * 撞的是客户本身的号（客户电话、没挂联系人的号码行）= 主要联系人；都没有 = null。回收站里的联系人不算
 */
export async function 撞上的联系人(db: 库, customerId: string, 号: 验好的号): Promise<string | null> {
  return 看全部(async () => {
    const kind = 号.类型 === "手机号" ? "phone" : 号.类型 === "邮箱" ? "email" : 号.类型 === "微信" ? "wechat" : 号.类型 === "旺旺ID" ? "wangwang" : null;
    if (kind && 号.键) {
      const m = await db.contactMethod.findFirst({ where: { customerId, kind, numberKey: 号.键, contactId: { not: null }, contact: { deletedAt: null } }, select: { contactId: true }, orderBy: { createdAt: "asc" } });
      if (m?.contactId) return m.contactId;
    }
    if (号.类型 === "手机号") {
      const 键 = 号键(号.值);
      const 键们 = /^\d{11}$/.test(键) ? [键, `86${键}`] : [键];
      const r = await db.$queryRawUnsafe<{ id: string }[]>(
        `SELECT "id" FROM "Contact" WHERE "customerId" = ? AND "deletedAt" IS NULL AND ${号键SQL('"phone"')} IN (${键们.map(() => "?").join(", ")}) ORDER BY "isPrimary" DESC, "createdAt" ASC LIMIT 1`, customerId, ...键们);
      if (r[0]) return r[0].id;
    } else if (号.类型 === "邮箱" || 号.类型 === "微信") {
      const 列 = 号.类型 === "邮箱" ? "email" : "wechat";
      const r = await db.$queryRawUnsafe<{ id: string }[]>(
        `SELECT "id" FROM "Contact" WHERE "customerId" = ? AND "deletedAt" IS NULL AND lower(trim("${列}")) = ? ORDER BY "isPrimary" DESC, "createdAt" ASC LIMIT 1`, customerId, 号.键);
      if (r[0]) return r[0].id;
    }
    return (await db.contact.findFirst({ where: { customerId, deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { id: true } }))?.id ?? null;
  });
}

/** 领取框里录的对接人：原id = 选的客户名下已有的那位（号码撞上的那位先带出来，可换）；原id 空 = 「新的人」，名字必填、职务可空 */
export type 录的对接人 = { 原id?: string | null; 名字?: string | null; 职务?: string | null };
export const 对接人名上限 = 100;
/** 认好的：挂客户名下已有的那位（不改他的信息）；或在客户下新建一位（不设主联系人） */
export type 认好的对接人 = { 挂: string } | { 建: { name: string; position: string | null } };

/**
 * 认对接人（用户 11-19「客户联系人不变，项目对接人以录入为主」；导入的规矩「认人锁手机号」）：
 *   - 选的是客户名下已有的联系人（带原id）：直接挂他——不拿名字重新认人、不强制有名字（号码撞上的那位没名字照样挂）、他原有的信息一律不改
 *   - 选「新的人」：名字必填，在这位客户下新建一位联系人（不设主联系人），只挂到这条新项目上
 * 带出来的那位要还在这位客户名下（回收站的不算）；事务里 落对接人 再核一遍。客户的主联系人不换
 */
export async function 认对接人(db: 库, customerId: string, 录: unknown): Promise<认好的对接人 | { error: string }> {
  const r = (录 && typeof 录 === "object" ? 录 : {}) as Partial<录的对接人>;
  const 原id = typeof r.原id === "string" && r.原id ? r.原id : null;
  if (原id) {
    const 在 = await 看全部(() => db.contact.findFirst({ where: { id: 原id, customerId, deletedAt: null }, select: { id: true } }));
    return 在 ? { 挂: 在.id } : { error: "选的对接人已经不在这位客户名下了，关掉重新打开" };
  }
  const 名字 = typeof r.名字 === "string" ? r.名字.trim() : "";
  if (!名字) return { error: "请填写这次的对接人：选客户原有的联系人，或填新的人的名字" };
  if (名字.length > 对接人名上限) return { error: `对接人名字最多 ${对接人名上限} 个字` };
  const 职务 = typeof r.职务 === "string" && r.职务.trim() ? r.职务.trim().slice(0, 对接人名上限) : null;
  return { 建: { name: 名字, position: 职务 } };
}

/**
 * 事务里落对接人：挂的先在事务里再核一遍还在这位客户名下（事务外认完到这一刻被删 / 被移走：抛 查重领取作废 整笔回滚）；
 * 建的在客户下新建（同受限详情新增联系人：不设主联系人、挂客户行、记谁建的）
 */
export async function 落对接人(tx: Prisma.TransactionClient, customerId: string, 认: 认好的对接人, 建的人: string): Promise<string> {
  if ("挂" in 认) {
    const 在 = await tx.contact.findFirst({ where: { id: 认.挂, customerId, deletedAt: null }, select: { id: true } });
    if (!在) throw new 查重领取作废("选的对接人刚被删了或不在这位客户名下了，这次没领；关掉重新打开");
    return 在.id;
  }
  const c = await tx.contact.create({ data: { ...认.建, isPrimary: false, customerId, createdById: 建的人 }, select: { id: true } });
  await tx.contactCustomer.create({ data: { contactId: c.id, customerId } });
  return c.id;
}

/**
 * 新建线索项目那条路（查重领取口径.新建线索项目）：事务里给这位刚出公海的客户另建一条线索项目，直接建在接手人名下。
 * 起点节点（同新建线索，第一个节点）、项目来源 = 这次选的渠道（客户来源不动，P-删-03 项目来源各记各的）、对接人 = 选的客户联系人（不新建、不改联系人）、
 * 创建人 = 市场成员、分配方式 = 自动分配；业务线 = 这次的分配方向，判不出按接手人的线、再没有内贸（同 补潜客培育，X-86 A1）。记第一行节点变更。
 * 项目来源标记（Project.source）= 老客户重复咨询（重复咨询第一步：撞上公海客户另建的这条同样打标，客户 11-22）。
 * 「市场分给销售进线索验证」由调用方接着推（同新线索自动分配）。
 * 出口 C（repeat-inquiry.ts）也用它建：接手人 = 客户负责人、分配方式 = 指定分配、线 = 跟负责人走（调用方算好传进来）
 */
export async function 查重领取建线索项目(
  tx: Prisma.TransactionClient,
  a: { customerId: string; 客户名: string; 接手人: string; 创建人: string; 渠道: string; 对接人: string | null; 线: "内贸" | "外贸" | null; 分配方式: string },
): Promise<string> {
  const 接手人线 = a.线 ?? (await tx.entMember.findUnique({ where: { userId: a.接手人 }, select: { line: true } }))?.line ?? null;
  const p = await tx.project.create({
    data: {
      name: a.客户名.trim().slice(0, 项目名上限) || "新线索", customerId: a.customerId, contactId: a.对接人,
      ownerId: a.接手人, creatorId: a.创建人, amount: 0, currency: 默认币种, bizLine: 接手人线 === "外贸" ? "外贸" : "内贸",
      phase: 第一个节点.phase, node: 第一个节点.node,
      ...新项目默认值(true, { 分配方式: a.分配方式, 项目来源: a.渠道 }),
      source: 重复咨询来源,
    },
  });
  await tx.projectNodeLog.create({ data: { projectId: p.id, userId: a.创建人, toPhase: 第一个节点.phase, toNode: 第一个节点.node } });
  return p.id;
}

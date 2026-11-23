/**
 * 重复咨询第一步 · 出口 C（客户 11-22 定稿《重复咨询-最终方案》，11-23 确认）：
 * 市场成员（渠道运营、市场管理）查号码撞上同事名下的客户，可以「在客户负责人名下新建线索」——不新建客户、不动号码，
 * 客户的来源、联系人、负责人、旧项目都不改；新线索：客户 = 撞上的那位，负责人 = 客户负责人，创建人 = 市场成员，项目来源 = 这次选的渠道，
 * 从起点节点起，分配方式记「指定分配」、计入负责人本月已分，带「老客户重复咨询」标记（Project.source = 重复咨询来源），
 * 市场分给销售进线索验证；这次的沟通记在新线索上、记录人是市场成员。
 *
 * 这里放判定（出口C可用）和事务里那几步要的小件；动作本身在 customers/repeat-inquiry-actions.ts（建档向导、首页查重框、首页 AI 新线索卡共用）。
 *
 * 谁能用、什么时候出按钮（第一步，客户 11-22 方案第 5 节）：
 *   - 发起人是市场成员（是市场成员of：渠道运营 / 市场管理、不兼销售、没设只看某人；同查重领取）
 *   - 号码首条撞上的客户不在公海、有负责人、负责人不是我
 *   - 客户不在转让交接中（等接手人确认时客户归谁未定）
 * 落给谁（两条路，客户 E-213 第一节 2、3 问取 A，E-218 二②要一个确定规则）：
 *   - 客户负责人「能接指定分配」（在职的销售 / 销售管理，规则「线索分配」开着时参与状态还要正常，assign-eta.ts 指定问题，P-转-01）：
 *     建在他名下，记「指定分配」（主路径）
 *   - 接不了（账号停用 / 离职、暂停或禁止参与分配、渠道运营 / 市场管理 / 项目组员 / 总管理等不是销售的、没设业务角色）：交销售——
 *     系统按自动分配挑人（同查重领取：查重领取候选们 + 挑接手人，按客户区域 → 电话 → 本人事业部定内贸 / 外贸，P-转-26，
 *     本月已分最少的先给），同一个事务里线索直接建在挑中的销售名下，记「自动分配」、计入本月已分、进线索验证；任何时刻都不落在市场成员名下。
 *     是系统分、不是市场成员自己选分配方式：不过「分配方式谁能用」（挡分配方式），规则「线索分配」关着 = 没有自动分配，算挑不到。
 *     挑不到人（规则关着、这条线没人、都暂停 / 禁止、都满额）= 整笔不建、沟通也不记，回「这条线没有能接的销售，请找销售管理」：
 *     现有的「新线索待分配」要建的人占着负责人一格（await-assign.ts，ownerId 不能空），占着就看得到客户名、能指派，
 *     不能用；没有「负责人空着等人领」的状态。
 *     客户不动：客户负责人、来源、联系人、旧项目都不改；带标记的线索之后不管经哪个入口分配，都不算「市场转客户」（market-transfer.ts 重复咨询不转客户）
 * 两条路都不收、不认任何选人：负责人由系统按上面写，界面上没有选人框，动作的参数里也没有负责人（交了也不认）
 * 新线索的内贸 / 外贸线跟负责人走（E-213 复核：接手人和线索的线对不上时分配会拒，lead-assign.ts 接手问题）：
 *   负责人本人事业部（成员业务线 → 所在部门）→ 判不出按这位客户的分配方向（客户区域 → 项目所在地 → 电话 → 发起人事业部）→ 再判不出内贸
 * 三态动静照现状（客户 11-22 拍板 3）：建新线索、进线索验证、终判、市场成员记的那条沟通都算客户动静；额度只有那条沟通会回满。这里不另写
 */
import type { Project } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getBusiness } from "@/lib/business";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 看全部 } from "@/lib/team-scope";
import { 看已删 } from "./soft-delete-core";
import { 客户编号文字 } from "@/lib/customer-no";
import { 重复线索名们 } from "./cust-status-auto-db";
import { 企业版 } from "./switch";
import { 权限组织 } from "./org";
import { 是市场成员of, type 组织 } from "./org-core";
import { 不能当负责人话 } from "./permissions";
import { 指定问题, 读线部门 } from "./assign-eta";
import { 本人事业部 } from "./customer-region";
import { 客户默认分配方向 } from "./assign-direction-db";
import { 交接中的客户 } from "./handover-db";
import { 全公司查号, 首条撞的, type 验好的号 } from "./contact-dedupe";
import { 挑接手人, type 线 } from "./lead-assign";
import { 规则开着 } from "./rules";
import { 查重领取候选们, 候选挑不到为什么, type 查重领取候选 } from "./dedupe-claim";

export const 出口C按钮 = (负责人名: string) => `在 ${负责人名} 名下新建线索`;
export const 不是市场成员出口C话 = "在同事名下新建线索只给市场成员（渠道运营、市场管理）";
export const 出口C作废话 = "这个号码现在撞上的客户不在原来那位负责人名下了（可能刚进公海或换了负责人），这次没建，按最新的查重结果来";
export const 交接中话 = "这位客户正在转让交接中，等接手人确认后再录";
/** 持有上限的那句不带别人名下的数（市场成员看不到同事的持有数）：只说原因和怎么办 */
export const 负责人到上限话 = (负责人名: string) => `${负责人名}名下线索 / 商机阶段的项目已到持有上限，这次没建；可以写进现有项目，或找销售管理`;

/** 成功的话：只说转给了负责人跟进，不带项目名、客户名（同事的客户，市场成员看不到它的名称） */
export const 出口C已转话 = (负责人名: string) => `已转给该客户负责人 ${负责人名} 跟进（在其名下新建了一条线索），这次的沟通已记在上面；你在项目列表里能看到进度`;
/**
 * 防重命中（同一客户、同一人几分钟内已建过）：这次不新建、这次填的沟通也不记——几分钟内同一人再交多半是两个标签页 / 连点，
 * 追加会把同一条沟通记两遍、再拨一次三态；真有新内容让负责人在线索上记（市场成员对同事的线索只看进度）
 */
export const 出口C已转过话 = (负责人名: string, 分钟: number, 交销售 = false) =>
  交销售
    ? `${分钟} 分钟内你已经为这位客户新建过一条交销售的线索，这次没有新建，这次填的沟通也没有记；有新的情况请在项目列表里找到那条线索，告诉跟进的销售`
    : `${分钟} 分钟内你已经把这位客户转给负责人 ${负责人名} 跟进过了，这次没有新建线索，这次填的沟通也没有记；有新的情况请告诉 ${负责人名}`;
/** 交销售挑不到人：整笔不建（见文件头），只说原因、不带别人的数 */
export const 出口C没人接话 = (为什么: string) => `这条线没有能接的销售（${为什么}），这次没建，沟通也没记；请找销售管理`;
/** 交销售那条路成了：只说按区域自动分给了谁，客户还在原负责人名下 */
export const 出口C交销售已分话 = (接手人: string, 负责人名: string) =>
  `已按客户区域自动分配给 ${接手人} 跟进（新建了一条线索），这次的沟通已记在上面；客户仍在 ${负责人名} 名下。你在项目列表里能看到进度`;
/**
 * 新线索的项目名：「重复咨询-客户编号」，不带客户名称和联系方式（负责人之后可以自己改名）；
 * 同一位客户第 2 次起加序「-2」「-3」（客户 E-218，不加日期）。序号 = Project.repeatSeq（按字段取，不解析名字）；没编号的老数据「重复咨询」「重复咨询-2」
 */
export const 出口C项目名 = (customerNo: number | null | undefined, 序 = 1) => {
  const 号 = 客户编号文字(customerNo);
  const 尾 = 序 > 1 ? `-${序}` : "";
  return 号 ? `重复咨询-${号}${尾}` : `重复咨询${尾}`;
};
/** 防重复提交：同一客户、同一发起人这么多分钟内已经由出口 C 建过一条，就认那一条、不再建、不再计数（两个标签页同时交） */
export const 出口C防重分钟 = 10;

/** 事务里发现对不上（客户刚进公海、换了负责人、对接人刚被删）：抛出来整笔回滚，调用方接住说人话 */
export class 出口C作废 extends Error {}

export type 出口C目标 = {
  客户: NonNullable<Awaited<ReturnType<typeof 首条撞的>>>;
  /** 客户现负责人（不管能不能接，交的时候按它核客户还在不在他名下） */
  负责人: string;
  负责人名: string;
  /** 负责人接不了指定分配：新线索交销售（按区域自动分配），客户不动 */
  交销售: boolean;
};

/** 发起人这一关：企业版项目模式、市场成员 */
export async function 出口C发起人问题(org: 组织 | null, meId: string): Promise<string | null> {
  if (!企业版() || (await getBusiness()).projectMode !== true) return "在同事名下新建线索只在企业版项目模式里有";
  if (!org || !是市场成员of(org, meId)) return 不是市场成员出口C话;
  return null;
}

/**
 * 客户负责人这一关：在职真人（不是公海占位）、能接指定分配（指定问题：销售 / 销售管理，参与状态正常）、能当负责人。
 * true = 能接（走主路径）；false = 接不了（停用 / 离职、暂停 / 禁止、不是销售……），走交销售
 */
export async function 负责人能接(org: 组织, ownerId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: ownerId }, select: { active: true, email: true } });
  if (!u || !u.active || u.email === 无负责人占位邮箱) return false;
  return !(await 指定问题(org, ownerId)) && !不能当负责人话(org, ownerId);
}

/**
 * 这个号码现在能不能走出口 C：能 = 撞上的客户和它的负责人；不能 = 为什么（给按钮用时只看能不能，交的时候说原因）。
 * 只认号码不认 id（同查重领取）：每次都按号码重查首条撞的那位
 */
export async function 出口C可用(org: 组织 | null, meId: string, 号: 验好的号): Promise<{ ok: true; 目标: 出口C目标 } | { ok: false; error: string }> {
  const 发起 = await 出口C发起人问题(org, meId);
  if (发起) return { ok: false, error: 发起 };
  const 挑 = await 首条撞的(prisma, await 全公司查号(prisma, 号.类型, 号.值, 号.键));
  if (!挑 || 挑.pool || !挑.salesOwnerId || 挑.salesOwnerId === meId) return { ok: false, error: 出口C作废话 };
  if ((await 交接中的客户([挑.id])).size) return { ok: false, error: 交接中话 };
  const 交销售 = !(await 负责人能接(org!, 挑.salesOwnerId));
  const 负责人名 = 挑.salesOwner?.name ?? (await prisma.user.findUnique({ where: { id: 挑.salesOwnerId }, select: { name: true } }))?.name ?? "负责人";
  return { ok: true, 目标: { 客户: 挑, 负责人: 挑.salesOwnerId, 负责人名, 交销售 } };
}

/**
 * 交销售的候选（事务外读好；同查重领取：查重领取候选们，方向按 客户区域 → 电话 → 发起人事业部）：客户现负责人回避（他就是接不了才交销售）。
 * 现在就挑不到人（规则「线索分配」关着、这条线没人、都暂停 / 禁止、都满额）= 回那句话：框打开就说、交的时候整笔不建
 */
export async function 交销售候选(org: 组织, 发起人: string, customerId: string, 负责人: string): Promise<{ ok: true; 候: 查重领取候选 } | { ok: false; error: string }> {
  if (!(await 规则开着("线索分配"))) return { ok: false, error: 出口C没人接话("规则「线索分配」没开，没有自动分配") };
  const 候 = await 查重领取候选们(org, 发起人, customerId, null, [负责人], true);
  if (!挑接手人(候.底.排位(), new Set(候.底.不参与), 候.查满, 候.底.不限额)) return { ok: false, error: 出口C没人接话(候选挑不到为什么(候, 候.底)) };
  return { ok: true, 候 };
}

/** 按钮上要的：客户负责人名字；交销售 = 负责人接不了，按钮写「新建线索交销售」 */
export type 出口C按钮 = { 负责人名: string; 交销售?: true };

/** 查号码 / AI 卡摆不摆按钮：能走 = 负责人名字（交销售那条路带 交销售）；不能 = null（不出按钮，照旧挂靠 / 出口 A）。出任何错都当不能，不挡查重 */
export async function 出口C按钮给不给(meId: string, 号: 验好的号): Promise<出口C按钮 | null> {
  try {
    const r = await 出口C可用(await 权限组织(), meId, 号);
    return r.ok ? { 负责人名: r.目标.负责人名, ...(r.目标.交销售 ? { 交销售: true as const } : {}) } : null;
  } catch (e) {
    console.warn("[出口C] 判定出错，不出按钮：", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * 新线索的线（跟负责人走，见文件头）：负责人本人事业部 → 这位客户的分配方向 → 内贸。
 * 负责人设了业务线就一定是它（本人事业部先看成员业务线），分配时 接手问题 不会因为线对不上拒
 */
export async function 出口C的线(org: 组织, 负责人: string, customerId: string, 发起人: string): Promise<线> {
  const 本人 = 本人事业部(org, await 读线部门(), 负责人);
  if (本人) return 本人;
  const 向 = await 客户默认分配方向(org, customerId, 发起人, null);
  return 向.线 ?? "内贸";
}

/**
 * 项目详情「这位客户其他在推的项目」：我看得到的给名字（点得进，同详情顶上项目切换条一个口径），看不到的只给个数（P-看-12 / X-49：写项目名 = 越权暴露）。
 * 重复线索名 = 字典里「重复线索」现在的叫法（管理员改过名，判无效框的提示跟着变）
 */
export type 其他在推 = { 看得到: { id: string; name: string }[]; 看不到: number; 重复线索名: string };

/**
 * 带「老客户重复咨询」标记的线索，详情里现算这位客户名下别的在推项目（没结局、不在公海、不在回收站、不是这一条），给负责人判是不是同一需求。
 * 不加「原项目」列（客户 11-22 方案：现算，不用迁移）。看得到 = 限定读查得到的（按当前请求的身份），总数用看全部数
 */
export async function 客户其他在推项目(projectId: string, customerId: string): Promise<其他在推> {
  const where = { customerId, id: { not: projectId }, result: null, pooledAt: null, deletedAt: null };
  const [全, 看得到, 名们] = await Promise.all([
    看全部(() => prisma.project.count({ where })),
    prisma.project.findMany({ where, select: { id: true, name: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    看全部(() => 重复线索名们()),
  ]);
  return { 看得到, 看不到: Math.max(0, 全 - 看得到.length), 重复线索名: 名们[名们.length - 1] };
}

/**
 * 项目详情「原始客户编号」那一行（只读，迁移 163，客户 E-218）：建这条线索时撞上的那位客户的编号 + 第几次重复咨询。
 * 读只读字段 repeatOfCustomerId / repeatSeq，不读项目名（负责人改了名照样对）；客户编号现读（客户进了回收站也读得到），没编号的写「—」
 */
export type 重复咨询来源行 = { 客户编号: string; 第几次: number | null };
export async function 重复咨询原始客户(p: Pick<Project, "repeatOfCustomerId" | "repeatSeq">): Promise<重复咨询来源行 | null> {
  if (!p.repeatOfCustomerId) return null;
  const c = await 看全部(() => 看已删(() => prisma.customer.findUnique({ where: { id: p.repeatOfCustomerId! }, select: { customerNo: true } })));
  return { 客户编号: 客户编号文字(c?.customerNo) ?? "—", 第几次: p.repeatSeq };
}

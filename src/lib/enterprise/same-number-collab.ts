/**
 * 企业版「同号再次录入 → 组员协同」（2026-11-03）。
 *
 * 客户已经有负责人在跟，另一个人（市场或销售）又录了同一个号码：这是信号，来源不一样时信号更强。以前只拦下、这次录的东西全丢了。现在：
 * - 不新建，负责人不变；这次录的内容写进现有项目的沟通记录，记清谁、什么来源、哪个入口
 * - 添加人收到组员邀请（INVITED，等对方同意）。系统发的，不走「只有负责人能邀请」，invitedById 留空 + 留痕写明因撞号发出
 * - 通知负责人（站内铃铛 + 现有飞书通道）；项目详情顶上一条醒目提醒（同号提醒们，SameNumberBanner）
 * - 给添加人一句明确反馈，看不到这位客户时只说负责人名字
 * 公海客户、负责人是占位账号、负责人停用：不走这里，入口照原来的查重走。只读管理员写不了，同样不走。
 *
 * 不加字段：沟通记录挂项目时节点写 同号节点，不是真实节点——节点必填和阶段门槛按节点名认，所以这条替负责人满足不了必填；
 * 也不记有效沟通标记、不动客户最近跟进，不替负责人续回收时钟。
 *
 * 号码比对只用 contact-dedupe（全公司查号 / 首条撞的），入口一律调这里，不自己判。
 * 幂等：同人、同客户、同号 10 分钟内只记一次（重复点、两处入口先后撞到都算一次）。写在同一个事务里；通知、留痕在事务外，不抛。
 */
import type { Prisma } from "@/generated/prisma";
import { prisma, defaultClient } from "@/lib/prisma";
import { 看全部, 看得到, 读的我, 只读身份中, 只读错误 } from "@/lib/team-scope";
import { 查完再写 } from "@/lib/check-then-write";
import { recordAudit } from "@/lib/audit";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 记沟通编号 } from "@/lib/project/followup-meta";
import { 企业版 } from "./switch";
import { 全公司查号, 首条撞的, type 验好的号 } from "./contact-dedupe";
import { notify } from "./notify";

export const 同号标题 = "同号再次录入";
const 重点标题 = "同号再次录入（来源不同）";
/** 挂项目时的节点：不是真实节点，详情沟通时间线上正好显示成标签 */
export const 同号节点 = "同号再次录入";
const 幂等窗 = 10 * 60_000;
const 内容上限 = 2000;

export type 录入信息 = {
  /** 哪个入口：手工建档 / 新建线索 / AI建档 */
  入口: string;
  /** 这次选的渠道，算来源 */
  渠道id?: string | null;
  /** 没有渠道时的来源文字（线索的来源格） */
  来源?: string | null;
  /** 这次带的跟进、沟通内容或备注 */
  内容?: string | null;
};

export type 邀请结果 = "发了" | "已在组里" | "等回复" | "不用";

export type 协同结果 =
  | { 走: false; 原因: string }
  | { 走: true; 客户id: string; 项目id: string | null; 负责人名: string; 反馈: string; 已记过: boolean; 邀请: 邀请结果; followUpId: string };

type 人 = { id: string; name: string };
type 库 = Prisma.TransactionClient | typeof prisma;

const 活项目 = (customerId: string): Prisma.ProjectWhereInput => ({
  customerId,
  result: null,
  pooledAt: null,
  awaitAssignAt: null,
  deletedAt: null,
});

/** 该客户最近活跃的未结束项目；项目负责人也得是在职真人（Project.ownerId 没建关联，另查一次） */
async function 挑项目(db: 库, customerId: string) {
  const 们 = await db.project.findMany({
    where: 活项目(customerId),
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { id: true, ownerId: true, channel: { select: { name: true } } },
  });
  if (!们.length) return null;
  const 人们 = await db.user.findMany({
    where: { id: { in: [...new Set(们.map((p) => p.ownerId))] }, active: true, email: { not: 无负责人占位邮箱 } },
    select: { id: true, name: true, email: true },
  });
  for (const p of 们) {
    const u = 人们.find((x) => x.id === p.ownerId);
    if (u) return { ...p, 负责人名: u.name || u.email };
  }
  return null;
}

/** 这个号码能不能走协同：撞到首条、不在公海、负责人是在职真人。选该客户最近活跃的未结束项目 */
async function 找目标(号: 验好的号) {
  return 看全部(async () => {
    const ids = await 全公司查号(prisma, 号.类型, 号.值, 号.键);
    if (!ids.length) return { 走: false as const, 原因: "没撞号" };
    const 首条 = await 首条撞的(prisma, ids);
    if (!首条) return { 走: false as const, 原因: "没撞号" };
    if (首条.pool) return { 走: false as const, 原因: "在公海" };
    if (!首条.salesOwnerId) return { 走: false as const, 原因: "没有负责人" };
    const 负责人 = await prisma.user.findUnique({ where: { id: 首条.salesOwnerId }, select: { id: true, name: true, email: true, active: true } });
    if (!负责人 || 负责人.email === 无负责人占位邮箱) return { 走: false as const, 原因: "负责人是占位账号" };
    if (!负责人.active) return { 走: false as const, 原因: "负责人已停用" };
    const 项目 = await 挑项目(prisma, 首条.id);
    return { 走: true as const, 首条, 负责人名: 项目?.负责人名 ?? (负责人.name || 负责人.email), 项目 };
  });
}

/** 向导要不要摆「把记录写进现有项目」：和真写时同一套判断，只读管理员不摆 */
export async function 同号可协同(号: 验好的号): Promise<boolean> {
  if (!企业版()) return false;
  if (await 只读身份中(defaultClient)) return false;
  return (await 找目标(号)).走;
}

/** 这次的来源文字：选了渠道用渠道名，否则用来源格；「其他」这种不算来源 */
async function 这次来源(db: 库, 录入: Pick<录入信息, "渠道id" | "来源">): Promise<string> {
  if (录入.渠道id) {
    const c = await db.channel.findUnique({ where: { id: 录入.渠道id }, select: { name: true } });
    if (c?.name) return c.name;
  }
  return (录入.来源 ?? "").trim();
}

/** 现有来源：项目的渠道、客户的渠道、当初线索的来源 */
async function 现有来源们(db: 库, customerId: string, 项目渠道: string | null | undefined): Promise<string[]> {
  const [客户, 线索] = await Promise.all([
    db.customer.findUnique({ where: { id: customerId }, select: { channel: { select: { name: true } } } }),
    db.lead.findFirst({ where: { customerId }, select: { source: true } }),
  ]);
  const 们 = [项目渠道, 客户?.channel?.name, 线索?.source].map((s) => (s ?? "").trim()).filter((s) => s && s !== "其他");
  return [...new Set(们)];
}

function 拼内容(号: 验好的号, 谁: string, 入口: string, 来源: string, 现有: string[], 内容: string | null | undefined) {
  const 不同 = !!来源 && 来源 !== "其他" && 现有.length > 0 && !现有.includes(来源);
  const 行们 = [`同号再次录入：${谁} 录入（${号.类型} ${号.值}，来源：${来源 || "未填"}，入口：${入口}）`];
  if (不同) 行们.push(`现有来源：${现有.join("、")}，来源不同，重点关注`);
  const 正文 = (内容 ?? "").trim().slice(0, 内容上限);
  if (正文) 行们.push(正文);
  return { 不同, 标题: 不同 ? 重点标题 : 同号标题, 内容: 行们.join("\n") };
}

function 拼反馈(负责人名: string, 自己负责: boolean, 有项目: boolean, 邀请: 邀请结果, 客户名: string | null): string {
  const 位置 = 客户名 ? `「${客户名}」` : "";
  if (自己负责) return `这个号码已在你自己的${有项目 ? "项目" : "客户"}${位置}里，已把记录写进去`;
  if (!有项目) return `这个号码已在 ${负责人名} 名下的客户${位置}里，已把你的记录写进客户沟通记录并通知了 ${负责人名}`;
  const 尾 = 邀请 === "发了" ? "并发了组员邀请" : 邀请 === "等回复" ? "，组员邀请已发过，同意后可进组" : "（你已在项目组）";
  return `这个号码已在 ${负责人名} 的项目${位置}里，已把你的记录写进去${尾}`;
}

/**
 * 主函数：人工录入撞号时调。走 = 记录、邀请、通知都办了（或 10 分钟内已办过），入口把 反馈 给添加人、不再新建；
 * 不走 = 什么都没写，入口照原来的查重提示走。
 */
export async function 同号再次录入(我: 人, 号: 验好的号, 录入: 录入信息): Promise<协同结果> {
  if (!企业版()) return { 走: false, 原因: "没开企业版" };
  if (await 只读身份中(defaultClient)) return { 走: false, 原因: "只读身份" };
  const 目标 = await 找目标(号);
  if (!目标.走) return { 走: false, 原因: 目标.原因 };
  const { 首条, 负责人名, 项目 } = 目标;
  const 来源 = await 看全部(() => 这次来源(prisma, 录入));
  const 现有 = await 看全部(() => 现有来源们(prisma, 首条.id, 项目?.channel?.name));
  const 拼 = 拼内容(号, 我.name, 录入.入口, 来源, 现有, 录入.内容);
  const now = new Date();

  // 组员还没同意时看不到这位客户和项目，整段按全部看；写的只有下面这几行
  let 记: { followUpId: string; 已记过: boolean; 邀请: 邀请结果; 成员状态: string | null };
  try {
    记 = await 看全部(() =>
      查完再写(async (tx) => {
        const 已有 = await tx.followUp.findFirst({
          where: { customerId: 首条.id, ownerId: 我.id, title: { startsWith: 同号标题 }, content: { contains: 号.值 }, occurredAt: { gte: new Date(now.getTime() - 幂等窗) }, deletedAt: null },
          select: { id: true },
        });
        const 成员 = 项目 ? await tx.projectMember.findUnique({ where: { projectId_userId: { projectId: 项目.id, userId: 我.id } }, select: { id: true, inviteStatus: true } }) : null;
        const 现状: 邀请结果 = !项目 || 项目.ownerId === 我.id ? "不用" : 成员?.inviteStatus === "JOINED" ? "已在组里" : 成员?.inviteStatus === "INVITED" ? "等回复" : "发了";
        if (已有) return { followUpId: 已有.id, 已记过: true, 邀请: 现状, 成员状态: 成员?.inviteStatus ?? null };

        const f = await tx.followUp.create({
          data: { type: "OTHER", title: 拼.标题, content: 拼.内容, status: "已完成", occurredAt: now, customerId: 首条.id, ownerId: 我.id },
          select: { id: true },
        });
        if (项目) {
          await tx.followUpProject.create({ data: { followUpId: f.id, projectId: 项目.id, node: 同号节点 } });
          await 记沟通编号(tx, f.id, 项目.id, null, now);
        }
        if (项目 && 现状 === "发了") {
          // 拒绝过的再邀一次（加组员 同样的规矩）：这次撞号是新信号
          if (成员) await tx.projectMember.update({ where: { id: 成员.id }, data: { inviteStatus: "INVITED", invitedById: null } });
          else await tx.projectMember.create({ data: { projectId: 项目.id, userId: 我.id, roleId: null, inviteStatus: "INVITED", invitedById: null } });
        }
        return { followUpId: f.id, 已记过: false, 邀请: 现状, 成员状态: 成员?.inviteStatus ?? null };
      }),
    );
  } catch (e) {
    if (e instanceof 只读错误) return { 走: false, 原因: "只读身份" };
    throw e;
  }

  const 自己负责 = 首条.salesOwnerId === 我.id || (!!项目 && 项目.ownerId === 我.id);
  const 看得见 = 看得到(首条, await 读的我(defaultClient)) || 记.成员状态 === "JOINED" || 自己负责;
  const 反馈 = 拼反馈(负责人名, 自己负责, !!项目, 记.邀请, 看得见 ? 首条.name : null);

  if (!记.已记过) {
    const 链接 = 项目 ? `/projects/${项目.id}` : `/customers/${首条.id}`;
    await notify([项目?.ownerId, 首条.salesOwnerId].filter((u) => u !== 我.id), {
      kind: "撞号",
      title: `${我.name} 再次录入了同一号码${拼.不同 ? "（来源不同）" : ""}：${首条.name}`,
      body: 拼.内容,
      link: 链接,
      key: `same-number:${记.followUpId}`,
    });
    if (记.邀请 === "发了") {
      await notify([我.id], {
        kind: "项目邀请",
        title: `你录入的号码已在 ${负责人名} 的项目里，系统邀请你加入项目组`,
        body: "同意以后才看得到这个项目。",
        link: "/projects",
        key: `same-number-invite:${记.followUpId}`,
      });
    }
    await recordAudit({
      user: 我,
      action: "create",
      entity: "FollowUp",
      entityId: 记.followUpId,
      summary: `${拼.标题}：${我.name} 录入「${首条.name}」的号码，记录写入${项目 ? "现有项目" : "客户沟通记录"}${记.邀请 === "发了" ? "；系统因撞号发出组员邀请" : ""}`,
      detail: { 客户: 首条.id, 项目: 项目?.id ?? null, 入口: 录入.入口, 来源, 现有来源: 现有, 来源不同: 拼.不同, 邀请: 记.邀请 },
    });
  }

  return { 走: true, 客户id: 首条.id, 项目id: 项目?.id ?? null, 负责人名, 反馈, 已记过: 记.已记过, 邀请: 记.邀请, followUpId: 记.followUpId };
}

/**
 * 导入、同步撞号：只在已有项目写一条醒目备注和来源，不发邀请、不通知（批量动作，一发就刷屏）。
 * 在导入的事务里调。公海、占位、停用、没有项目都不写；同客户、同号、同来源只记一次（同步跑多少轮都一条）。回写下的沟通 id，撤回要用
 */
export async function 同号只记备注(
  tx: Prisma.TransactionClient,
  参数: { customerId: string; 操作人: string; 号: 验好的号; 入口: string; 渠道id?: string | null; 来源?: string | null },
): Promise<string | null> {
  if (!企业版()) return null;
  const { customerId, 操作人, 号, 入口 } = 参数;
  const 客户 = await tx.customer.findUnique({
    where: { id: customerId },
    select: { pool: { select: { customerId: true } }, salesOwner: { select: { active: true, email: true } } },
  });
  if (!客户 || 客户.pool || !客户.salesOwner?.active || 客户.salesOwner.email === 无负责人占位邮箱) return null;
  const 项目 = await 挑项目(tx, customerId);
  if (!项目) return null;
  const 行上来源 = await 这次来源(tx, 参数);
  const 真来源 = 行上来源 === "其他" ? "" : 行上来源;
  const 来源 = 真来源 || 入口;
  const 谁 = (await tx.user.findUnique({ where: { id: 操作人 }, select: { name: true } }))?.name ?? "导入";
  // 行上没写来源时只记是哪个系统来的，不算「来源不同」
  const 拼 = 拼内容(号, 谁, `${入口}导入`, 来源, 真来源 ? await 现有来源们(tx, customerId, 项目.channel?.name) : [], null);
  const 已有 = await tx.followUp.findFirst({
    where: { customerId, title: { startsWith: 同号标题 }, AND: [{ content: { contains: 号.值 } }, { content: { contains: `来源：${来源}，` } }], deletedAt: null },
    select: { id: true },
  });
  if (已有) return null;
  const f = await tx.followUp.create({
    data: { type: "OTHER", title: 拼.标题, content: 拼.内容, status: "已完成", customerId, ownerId: 操作人 },
    select: { id: true },
  });
  await tx.followUpProject.create({ data: { followUpId: f.id, projectId: 项目.id, node: 同号节点 } });
  return f.id;
}

export type 同号提醒 = { id: string; 谁: string; 何时: Date; 重点: boolean; 摘要: string };

/** 项目详情顶上那条提醒要的：最近几次同号再次录入（首行写着谁、什么号、什么来源；第二行是来源不同的说明） */
export async function 同号提醒们(projectId: string): Promise<同号提醒[]> {
  const 们 = await 看全部(() =>
    prisma.followUpProject.findMany({
      where: { projectId, node: 同号节点, followUp: { deletedAt: null } },
      select: { followUp: { select: { id: true, title: true, content: true, occurredAt: true, owner: { select: { name: true } } } } },
      orderBy: { followUp: { occurredAt: "desc" } },
      take: 5,
    }),
  );
  return 们.map(({ followUp: f }) => {
    const 重点 = f.title === 重点标题;
    const [首行 = "", 次行 = ""] = f.content.split("\n");
    return { id: f.id, 谁: f.owner.name, 何时: f.occurredAt, 重点, 摘要: 重点 ? `${首行}；${次行}` : 首行 };
  });
}

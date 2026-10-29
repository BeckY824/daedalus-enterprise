/**
 * 企业版导入 · 正式写入：试跑存下的待写（批次的 plan）→ 客户 / 线索 / 联系人 / 商机 / 跟进 + 对照表。
 * 首次全量和之后的增量同步走这一个；写的就是报告里看到的那一份，不重新清洗。
 *
 * 分段、可续：一次调用最多写 段长（默认 20 秒，ENT_IMPORT_SEGMENT_MS），写到哪记在批次的 cursor 上，再调一次接着写。
 * 每 每趟条数 条一个小事务（查完再写），游标和计数跟着同一个事务走：断在半路，重来不会多写一份。
 * 一趟里有一条出错就退回一条一条写，把出错那条记成「没写进去」，别的照写。
 * 两个地方同时续同一批（双击、两个窗口）：游标对不上的那边让出来，不重复写。
 *
 * 每一条怎么落：
 *   - 对照表里有（以前导过）→ 三方比对：原系统新值 / 我们这边现值 / 上次写进去的。
 *     原系统没改的格子不动；我们这边没改过的照原系统改；两边都改了、改得不一样 → 不覆盖，记一笔冲突等人定。
 *     我们这边已经删了 → 也记一笔冲突（本地已删），不重建
 *   - 本批同号的后一条（并入）→ 不另建，只记一条对照指向前一条写出来的那位
 *   - 没导过、我们这边有同号客户 → 连上它，只补空着的格子（客户状态、备注、外贸档案），负责人和跟进状态不动
 *   - 否则新建；赢单 / 输单带上结单日期（看板按它算月份），跟进写完给客户补「最近跟进」
 * 负责人对不上在职的业务员（离职、被改成管理员）：退回上次的负责人 → 默认负责人 → 导入的人
 *
 * P8（10-29）：客户简称 / 地址四格 / 分配方式、联系人性别 / 生日 / 爱好 / 地址照三方比对，但只在表里给了才比（空的不算冲突）；
 * 来源对上的渠道只补空、归属没定的才挂，不记冲突；客户 / 联系人的号同时记进 ContactMethod 子表（照 P5 记号码）
 */
import { revalidatePath } from "next/cache";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "../prisma";
import { recordAudit, type Actor } from "../audit";
import { 查完再写 } from "../check-then-write";
import { 写外贸档案 } from "../customer-extra-db";
import { 同号条件, 分机留存起 } from "../phone-dedupe";
import { 看全部 } from "../team-scope";
import { 记号码, 号码库类型, type 验好的号 } from "../enterprise/contact-dedupe";
import { 验号码 } from "../enterprise/contact-format";
import { 客户附加列, 客户新列, 联系人新列 } from "./clean";
import { 来源名, type 来源, type 实体, type 映射, type 待写 } from "./types";
import { 读项目, 建项目, 改项目, 是项目 } from "./project-target";
import { 线索建项目 } from "../project/from-lead";

type Tx = Prisma.TransactionClient;
export type 标量 = string | number | boolean | null;
export type 值表 = Record<string, 标量>;
type 结果 = "新建" | "更新" | "跳过" | "冲突";

/** 每类拿来比对、记进对照表的格子（落库的列名；客户的外贸几格、商机的结单日期在附表里） */
export const 比对字段: Record<实体, readonly string[]> = {
  customer: ["name", "phone", "salesOwnerId", "followStatus", "custStatus", "remark", ...客户附加列, ...客户新列, "channelId"],
  lead: ["name", "contact", "phone", "email", "industry", "source", "status", "ownerId", "remark"],
  contact: ["name", "position", "phone", "email", "wechat", "isPrimary", "remark", "customerId", ...联系人新列],
  opportunity: ["name", "amount", "stage", "status", "probability", "expectedDealAt", "closedAt", "ownerId", "remark", "customerId"],
  followup: ["type", "title", "content", "status", "occurredAt", "ownerId", "customerId", "opportunityId", "projectId"],
};
const 负责人列: Record<实体, string> = { customer: "salesOwnerId", lead: "ownerId", contact: "", opportunity: "ownerId", followup: "ownerId" };
/** 同号连上已有客户时只补这几格（渠道还要归属没定才补，见 可挂渠道） */
const 补空格 = ["custStatus", "remark", ...客户附加列, ...客户新列, "channelId"] as const;
/**
 * 企业版的新几格和渠道（P8）：原系统认得出才带这一格（清洗时逐格留空），没带 = 这次不碰，不算原系统清空了、也不算冲突。
 * 渠道只补空：我们这边已经挂了渠道 / 定了归属的不动、不记冲突（归属固化）
 */
const 只补的格 = new Set<string>([...客户新列, ...联系人新列, "channelId"]);

const 段长 = () => Number(process.env.ENT_IMPORT_SEGMENT_MS) || 20_000;
const 每趟条数 = 25;
/** note 里最多留多少条「没写进去」的明细 */
const 失败上限 = 200;

export type 失败明细 = { 实体: 实体; 外部ID: string; 行号?: number; 出处?: string; 原因: string };
export type 写入结果 = {
  状态: string;
  完了: boolean;
  总数: number;
  写到: number;
  新建: number;
  更新: number;
  跳过: number;
  冲突: number;
  失败: number;
};

/** 这一条写不进去（给人看的原因） */
export class 写不进 extends Error {}
/** 别的地方正在写这一批：游标被挪过了 */
class 让位 extends Error {}

export type 现场 = {
  批次Id: string;
  源: 来源;
  m: 映射;
  /** 在职、不是管理员的成员 */
  可任: Set<string>;
  兜底负责人: string;
  分机起: Date | null;
  现在: string;
  /** 企业版只用项目：商机行建成项目、跟进挂项目（映射.项目） */
  项目?: boolean;
};

const J = (v: unknown) => JSON.stringify(v);
function 解<T>(s: string | null | undefined, 缺: T): T {
  if (!s) return 缺;
  try {
    return JSON.parse(s) as T;
  } catch {
    return 缺;
  }
}

/** 比对前规整："" / undefined → null，日期 → ISO */
export function 规(v: unknown): 标量 {
  if (v === undefined || v === null || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  return v as 标量;
}
const 同 = (a: 标量, b: 标量) => a === b;
const 空 = (v: unknown) => 规(v) === null;
const 日 = (v: 标量): Date | null => (v ? new Date(String(v)) : null);
const 串 = (v: 标量): string | null => (v === null ? null : String(v));

function 计数(): Record<结果, number> {
  return { 新建: 0, 更新: 0, 跳过: 0, 冲突: 0 };
}

/* ───────────────────────── 读现值 / 写 ───────────────────────── */

/** 我们这边这条记录现在的样子（比对字段那几格）；删了 = null */
export async function 读现值(tx: Tx, e: 实体, id: string): Promise<值表 | null> {
  if (e === "customer") {
    const c = await tx.customer.findUnique({
      where: { id },
      select: {
        name: true,
        phone: true,
        salesOwnerId: true,
        followStatus: true,
        custStatus: true,
        remark: true,
        extra: true,
        shortName: true,
        addrCountry: true,
        addrProvince: true,
        addrCity: true,
        addrDistrict: true,
        assignWay: true,
        channelId: true,
      },
    });
    if (!c) return null;
    const { extra, ...主 } = c;
    return 规整({ ...主, ...Object.fromEntries(客户附加列.map((k) => [k, extra?.[k] ?? null])) });
  }
  if (e === "lead") {
    const l = await tx.lead.findUnique({
      where: { id },
      select: { name: true, contact: true, phone: true, email: true, industry: true, source: true, status: true, ownerId: true, remark: true },
    });
    return l ? 规整(l) : null;
  }
  if (e === "contact") {
    const c = await tx.contact.findUnique({
      where: { id },
      select: {
        name: true,
        position: true,
        phone: true,
        email: true,
        wechat: true,
        isPrimary: true,
        remark: true,
        customerId: true,
        gender: true,
        birthday: true,
        hobby: true,
        address: true,
      },
    });
    return c ? 规整(c) : null;
  }
  if (e === "opportunity") {
    const o = await tx.opportunity.findUnique({
      where: { id },
      select: {
        name: true,
        amount: true,
        stage: true,
        status: true,
        probability: true,
        expectedDealAt: true,
        ownerId: true,
        remark: true,
        customerId: true,
        closed: { select: { closedAt: true } },
      },
    });
    if (!o) return 读项目(tx, id);
    const { closed, ...主 } = o;
    return 规整({ ...主, closedAt: o.status === "OPEN" ? null : (closed?.closedAt ?? null) });
  }
  const f = await tx.followUp.findUnique({
    where: { id },
    select: {
      type: true,
      title: true,
      content: true,
      status: true,
      occurredAt: true,
      ownerId: true,
      customerId: true,
      opportunityId: true,
      projectNode: { select: { projectId: true } },
    },
  });
  if (!f) return null;
  const { projectNode, ...主 } = f;
  return 规整({ ...主, projectId: projectNode?.projectId ?? null });
}

function 规整(o: Record<string, unknown>): 值表 {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, 规(v)]));
}

function 拣(v: 值表, 键: readonly string[]): 值表 {
  return Object.fromEntries(键.filter((k) => k in v).map((k) => [k, v[k]]));
}

/* ───────────────────────── 渠道 / 号码子表（P8） ───────────────────────── */

/** 这位客户的归属还没定：渠道、业绩归属、推荐人都空着，才能照原系统的来源挂上渠道 */
async function 可挂渠道(tx: Tx, id: string): Promise<boolean> {
  const c = await tx.customer.findUnique({
    where: { id },
    select: { channelId: true, attributionChannelId: true, attributionCustomerId: true, referrerCustomerId: true },
  });
  return !!c && !c.channelId && !c.attributionChannelId && !c.attributionCustomerId && !c.referrerCustomerId;
}

/**
 * 挂渠道 = 渠道直接推荐（同建档向导选渠道）：渠道、业绩归属渠道都是它，渠道负责人跟着渠道走。
 * null = 三格一起清掉（撤回补上的渠道）
 */
async function 渠道格(tx: Tx, cid: string | null) {
  if (!cid) return { channelId: null, attributionChannelId: null, channelOwnerId: null };
  const ch = await tx.channel.findUnique({ where: { id: cid }, select: { channelOwnerId: true } });
  if (!ch) throw new 写不进("要挂的渠道不在了");
  return { channelId: cid, attributionChannelId: cid, channelOwnerId: ch.channelOwnerId };
}

type 号格 = "手机号" | "邮箱" | "微信";
/** 联系人主表上的号 → 子表里的类型 */
const 联系人号格: readonly (readonly ["phone" | "email" | "wechat", 号格])[] = [
  ["phone", "手机号"],
  ["email", "邮箱"],
  ["wechat", "微信"],
];

/** 一格号码验成子表那一行；空的、验不过的（座机、格式不对）不进子表，主表照存原样 */
function 验成(类型: 号格, 原: unknown): 验好的号 | null {
  if (原 === null || 原 === undefined || 原 === "") return null;
  const r = 验号码(类型, String(原));
  return r.ok && r.键 ? { 类型: r.类型, 值: r.值, 键: r.键 } : null;
}

/** 客户本人的号（主表 phone，导入只认手机号）：这一行是不是它 */
async function 是本人号(tx: Tx, customerId: string, kind: string, 键: string): Promise<boolean> {
  if (kind !== 号码库类型.手机号) return false;
  const c = await tx.customer.findUnique({ where: { id: customerId }, select: { phone: true } });
  return !!c && 验成("手机号", c.phone)?.键 === 键;
}

/** 客户的号记进子表（建档 / 建回时）：同 P5 建档，挂在客户本人上（contactId 空） */
export async function 记客户号(tx: Tx, customerId: string, phone: unknown): Promise<void> {
  const 号 = 验成("手机号", phone);
  if (号) await 记号码(tx, { 刚建的: customerId }, null, 号);
}

/** 联系人的电话 / 邮箱 / 微信记进子表、挂上这位联系人（同号已有一行就挂上它，不另加） */
export async function 记联系人号(tx: Tx, customerId: string, contactId: string, v: Record<string, unknown>): Promise<void> {
  for (const [列, 类型] of 联系人号格) {
    const 号 = 验成(类型, v[列]);
    // 导入、撤回都是调用方明说不限范围的（看全部）
    if (号) await 看全部(() => 记号码(tx, { 已有: customerId }, contactId, 号));
  }
}

/** 联系人名下这一类的旧号摘掉：和客户本人号是同一行的只摘掉联系人，别的整行删 */
async function 摘号(tx: Tx, customerId: string, contactId: string, kind: string, 键: string): Promise<void> {
  const 行 = await tx.contactMethod.findFirst({ where: { customerId, contactId, kind, numberKey: 键 }, select: { id: true } });
  if (!行) return;
  if (await 是本人号(tx, customerId, kind, 键)) await tx.contactMethod.update({ where: { id: 行.id }, data: { contactId: null } });
  else await tx.contactMethod.delete({ where: { id: 行.id } });
}

/** 联系人要删之前（撤回）：名下的号全摘掉，不在客户上留一行没人认的号 */
export async function 摘联系人号(tx: Tx, contactId: string): Promise<void> {
  const 们 = await tx.contactMethod.findMany({ where: { contactId }, select: { customerId: true, kind: true, numberKey: true } });
  for (const m of 们) await 摘号(tx, m.customerId, contactId, m.kind, m.numberKey);
}

/** 新建一条，返回 id。值已经过 落值（负责人认过、父记录换成我们的 id、日期是 ISO）。项目 = 商机行建成项目 */
export async function 建(tx: Tx, e: 实体, v: 值表, 现在: string, 项目?: boolean): Promise<string> {
  if (e === "customer") {
    const c = await tx.customer.create({
      data: {
        name: String(v.name),
        phone: 串(v.phone) ?? "",
        salesOwnerId: String(v.salesOwnerId),
        followStatus: 串(v.followStatus) ?? "待跟进",
        custStatus: 串(v.custStatus ?? null),
        remark: 串(v.remark),
        ...Object.fromEntries(客户新列.map((k) => [k, 串(v[k] ?? null)])),
        ...(v.channelId ? await 渠道格(tx, String(v.channelId)) : {}),
      },
      select: { id: true },
    });
    // 刚建出来的不用推版本（同大批导入）
    await 写外贸档案(tx, c.id, Object.fromEntries(客户附加列.filter((k) => !空(v[k])).map((k) => [k, String(v[k])])), false);
    // 号记进联系方式子表（同 P5 建档：客户本人的号 contactId 空）；座机 / 格式不对的不进
    await 记客户号(tx, c.id, v.phone);
    return c.id;
  }
  if (e === "lead") {
    const l = await tx.lead.create({
      data: {
        name: String(v.name),
        contact: 串(v.contact),
        phone: 串(v.phone),
        email: 串(v.email),
        industry: 串(v.industry),
        source: 串(v.source) ?? "其他",
        status: 串(v.status) ?? "待跟进",
        ownerId: 串(v.ownerId),
        remark: 串(v.remark),
      },
      select: { id: true },
    });
    return l.id;
  }
  if (e === "contact") {
    const c = await tx.contact.create({
      data: {
        name: String(v.name),
        position: 串(v.position),
        phone: 串(v.phone),
        email: 串(v.email),
        wechat: 串(v.wechat),
        isPrimary: v.isPrimary === true,
        remark: 串(v.remark),
        customerId: String(v.customerId),
        ...Object.fromEntries(联系人新列.map((k) => [k, 串(v[k] ?? null)])),
      },
      select: { id: true },
    });
    await 记联系人号(tx, String(v.customerId), c.id, v);
    return c.id;
  }
  if (e === "opportunity" && 项目) return 建项目(tx, v, 现在);
  if (e === "opportunity") {
    const status = 串(v.status) ?? "OPEN";
    const o = await tx.opportunity.create({
      data: {
        name: String(v.name),
        amount: Number(v.amount ?? 0),
        stage: String(v.stage),
        status,
        probability: Number(v.probability ?? 0),
        expectedDealAt: 日(v.expectedDealAt),
        remark: 串(v.remark),
        customerId: String(v.customerId),
        ownerId: String(v.ownerId),
        activityAt: new Date(现在),
      },
      select: { id: true },
    });
    // 结单日期用原系统的（看板「本月赢单」按它算），不是导入这一天
    if (status !== "OPEN") await tx.opportunityClose.create({ data: { opportunityId: o.id, closedAt: 日(v.closedAt) ?? new Date(现在) } });
    return o.id;
  }
  const f = await tx.followUp.create({
    data: {
      type: String(v.type),
      title: String(v.title),
      content: String(v.content ?? ""),
      status: 串(v.status) ?? "已完成",
      occurredAt: 日(v.occurredAt) ?? new Date(现在),
      ownerId: String(v.ownerId),
      customerId: String(v.customerId),
      opportunityId: 串(v.opportunityId),
    },
    select: { id: true },
  });
  if (v.projectId) await 挂项目(tx, f.id, String(v.projectId));
  return f.id;
}

/** 跟进挂到项目当前所在的节点上（同项目页「记一笔沟通」） */
async function 挂项目(tx: Tx, followUpId: string, projectId: string): Promise<void> {
  const p = await tx.project.findUnique({ where: { id: projectId }, select: { node: true } });
  if (p) await tx.followUpProject.create({ data: { followUpId, projectId, node: p.node } });
}

/** 改已有记录的这几格。现值 = 改之前读到的（商机结单要看原来的状态） */
export async function 改(tx: Tx, e: 实体, id: string, 改动: 值表, 现值: 值表, 现在: string): Promise<void> {
  const 有 = (k: string) => k in 改动;
  if (e === "customer") {
    const data: Prisma.CustomerUncheckedUpdateInput = {};
    if (有("name")) data.name = String(改动.name);
    if (有("phone")) data.phone = 串(改动.phone) ?? "";
    if (有("salesOwnerId")) data.salesOwnerId = String(改动.salesOwnerId);
    if (有("followStatus")) data.followStatus = 串(改动.followStatus) ?? "待跟进";
    if (有("custStatus")) data.custStatus = 串(改动.custStatus);
    if (有("remark")) data.remark = 串(改动.remark);
    for (const k of 客户新列) if (有(k)) data[k] = 串(改动[k]);
    if (有("channelId")) Object.assign(data, await 渠道格(tx, 串(改动.channelId)));
    const 主改 = Object.keys(data).length > 0;
    if (主改) await tx.customer.update({ where: { id }, data });
    if (有("phone") && 串(改动.phone) !== 串(现值.phone ?? null)) {
      // 换了号：子表里客户本人的旧号删掉（联系人也挂着的那行留给联系人），新号记上
      const 旧 = 验成("手机号", 现值.phone);
      if (旧) await tx.contactMethod.deleteMany({ where: { customerId: id, contactId: null, kind: 号码库类型.手机号, numberKey: 旧.键 } });
      const 新 = 验成("手机号", 改动.phone);
      if (新) await 看全部(() => 记号码(tx, { 已有: id }, null, 新));
    }
    const 档案 = Object.fromEntries(客户附加列.filter(有).map((k) => [k, 串(改动[k])]));
    // 主表改过了 updatedAt 已经往前走；只改档案时让它推一下版本（撤销靠 updatedAt 认人改过没有）
    await 写外贸档案(tx, id, 档案, !主改);
    return;
  }
  if (e === "lead") {
    const data: Prisma.LeadUncheckedUpdateInput = {};
    for (const k of ["name", "source", "status"] as const) if (有(k)) data[k] = String(改动[k]);
    for (const k of ["contact", "phone", "email", "industry", "ownerId", "remark"] as const) if (有(k)) data[k] = 串(改动[k]);
    await tx.lead.update({ where: { id }, data });
    return;
  }
  if (e === "contact") {
    const data: Prisma.ContactUncheckedUpdateInput = {};
    for (const k of ["name", "customerId"] as const) if (有(k)) data[k] = String(改动[k]);
    for (const k of ["position", "phone", "email", "wechat", "remark", ...联系人新列] as const) if (有(k)) data[k] = 串(改动[k]);
    if (有("isPrimary")) data.isPrimary = 改动.isPrimary === true;
    await tx.contact.update({ where: { id }, data });
    // 号改了：子表里这位名下的旧号摘掉、新号挂上（改所属客户的不搬号：导入同步不会改联系人的所属客户）
    const customerId = String(现值.customerId);
    for (const [列, 类型] of 联系人号格) {
      if (!有(列) || 串(改动[列]) === 串(现值[列] ?? null)) continue;
      const 旧 = 验成(类型, 现值[列]);
      if (旧) await 摘号(tx, customerId, id, 号码库类型[类型], 旧.键);
      const 新 = 验成(类型, 改动[列]);
      if (新) await 看全部(() => 记号码(tx, { 已有: customerId }, id, 新));
    }
    return;
  }
  if (e === "opportunity" && (await 是项目(tx, id))) return 改项目(tx, id, 改动, 现值, 现在);
  if (e === "opportunity") {
    const data: Prisma.OpportunityUncheckedUpdateInput = {};
    for (const k of ["name", "stage", "status", "ownerId", "customerId"] as const) if (有(k)) data[k] = String(改动[k]);
    if (有("amount")) data.amount = Number(改动.amount ?? 0);
    if (有("probability")) data.probability = Number(改动.probability ?? 0);
    if (有("expectedDealAt")) data.expectedDealAt = 日(改动.expectedDealAt);
    if (有("remark")) data.remark = 串(改动.remark);
    if (Object.keys(data).length) await tx.opportunity.update({ where: { id }, data });
    // 结单那张附表照商机页 记结单 的规矩走
    const 原状态 = 串(现值.status) ?? "OPEN";
    const 新状态 = 有("status") ? (串(改动.status) ?? "OPEN") : 原状态;
    if (原状态 === "WON" && 新状态 !== "WON") await tx.contractWin.deleteMany({ where: { opportunityId: id } });
    if (新状态 === "OPEN") {
      if (原状态 !== "OPEN") await tx.opportunityClose.deleteMany({ where: { opportunityId: id } });
    } else if (新状态 !== 原状态 || 有("closedAt")) {
      const closedAt = 日(有("closedAt") ? 改动.closedAt : 现值.closedAt) ?? new Date(现在);
      await tx.opportunityClose.upsert({ where: { opportunityId: id }, create: { opportunityId: id, closedAt }, update: { closedAt } });
    }
    return;
  }
  const data: Prisma.FollowUpUncheckedUpdateInput = {};
  for (const k of ["type", "title", "content", "status", "ownerId", "customerId"] as const) if (有(k)) data[k] = String(改动[k] ?? "");
  if (有("occurredAt")) data.occurredAt = 日(改动.occurredAt) ?? new Date(现在);
  if (有("opportunityId")) data.opportunityId = 串(改动.opportunityId);
  await tx.followUp.update({ where: { id }, data });
  if (有("projectId") && 串(改动.projectId) !== 串(现值.projectId ?? null)) {
    await tx.followUpProject.deleteMany({ where: { followUpId: id } });
    if (改动.projectId) await 挂项目(tx, id, String(改动.projectId));
  }
}

/* ───────────────────────── 一条 ───────────────────────── */

export const 引用键 = (源: 来源, entity: string, externalId: string) => ({ source_entity_externalId: { source: 源, entity, externalId } });

/** 父记录：本批的外部 ID → 对照表；我们这边的 id → 还在不在 */
async function 认父(tx: Tx, 源: 来源, e: "customer" | "opportunity", 父: { 外部ID: string } | { 本地ID: string }): Promise<string | null> {
  const id = "本地ID" in 父 ? 父.本地ID : (await tx.entExternalRef.findUnique({ where: 引用键(源, e, 父.外部ID), select: { targetId: true } }))?.targetId;
  if (!id) return null;
  const 在 =
    e === "customer"
      ? await tx.customer.findUnique({ where: { id }, select: { id: true } })
      : ((await tx.opportunity.findUnique({ where: { id }, select: { customerId: true } })) ?? (await tx.project.findUnique({ where: { id }, select: { customerId: true } })));
  return 在 ? id : null;
}

/**
 * 待写 → 这次要落的值（比对字段那几格，规整过）。
 * 上次 / 现值 用来补原系统没给的：负责人对不上退回上次的；结单日期、跟进时间没给就沿用，免得每次同步都改成「今天」
 */
export async function 落值(tx: Tx, 现: 现场, w: 待写, 上次: 值表 | null, 现值: 值表 | null): Promise<值表> {
  const v: 值表 = { ...w.值 };
  const 主 = 负责人列[w.实体];
  if (主 && !现.可任.has(String(v[主] ?? ""))) {
    const 退 = [上次?.[主], 现.m.默认负责人Id].find((x): x is string => typeof x === "string" && 现.可任.has(x));
    v[主] = 退 ?? 现.兜底负责人;
  }
  if (w.父客户) {
    const id = await 认父(tx, 现.源, "customer", w.父客户);
    if (!id) throw new 写不进("所属客户不在了（没写进去，或我们这边已删）");
    v.customerId = id;
  }
  if (w.实体 === "followup") {
    // 商机找不到不算错：清洗时已经提醒过，跟进照挂在客户下面
    let oid = w.父商机 ? await 认父(tx, 现.源, "opportunity", w.父商机) : null;
    // 父商机建成了项目：跟进挂项目（商机那格留空）；项目和跟进不是同一位客户就不挂
    const 项 = oid ? await tx.project.findUnique({ where: { id: oid }, select: { customerId: true } }) : null;
    if (oid) {
      const o = 项 ?? (await tx.opportunity.findUnique({ where: { id: oid }, select: { customerId: true } }));
      if (o?.customerId !== v.customerId) oid = null;
    }
    v.opportunityId = 项 ? null : oid;
    v.projectId = 项 ? oid : null;
    if (空(v.occurredAt)) v.occurredAt = 上次?.occurredAt ?? 现值?.occurredAt ?? 现.现在;
  }
  if (w.实体 === "opportunity") {
    if (v.status === "OPEN") v.closedAt = null;
    else if (空(v.closedAt)) v.closedAt = 上次?.closedAt ?? 现值?.closedAt ?? 现.现在;
  }
  if (w.实体 === "customer" && 空(v.phone)) v.phone = "";
  // 试跑之后渠道被删了：这次不挂（来源文字照存在外贸档案里）
  if (w.实体 === "customer" && v.channelId && !(await tx.channel.findUnique({ where: { id: String(v.channelId) }, select: { id: true } }))) delete v.channelId;
  return 规整(拣(v, 比对字段[w.实体]));
}

async function 写一条(tx: Tx, 现: 现场, w: 待写): Promise<结果> {
  const ref = await tx.entExternalRef.findUnique({ where: 引用键(现.源, w.实体, w.外部ID) });
  if (w.并入) {
    const 主 = await tx.entExternalRef.findUnique({ where: 引用键(现.源, w.实体, w.并入), select: { targetId: true } });
    if (!主) throw new 写不进(`要并进的「${w.并入}」没写进去`);
    if (!ref) return 并入(tx, 现, w, 主.targetId);
    if (ref.targetId === 主.targetId) {
      // 指纹没变就不碰：不然 updatedAt 一动，再导一遍也算「改了库」
      if (ref.fingerprint !== w.指纹) await tx.entExternalRef.update({ where: { id: ref.id }, data: { fingerprint: w.指纹, raw: J(w.原始) } });
      return "跳过";
    }
  }
  if (ref) return 对照(tx, 现, w, ref);
  if (w.实体 === "customer") {
    const 定 = w.目标?.方式 === "同号" && (await tx.customer.findUnique({ where: { id: w.目标.本地ID }, select: { id: true } }));
    const 目标 = 定 ? w.目标!.本地ID : await 再认同号(tx, 现, String(w.值.phone ?? ""));
    if (目标) return 补空(tx, 现, w, 目标);
  }
  return 新建(tx, 现, w);
}

/** 试跑之后、或别的窗口刚建了这个号：写之前在事务里再认一次。只认唯一的那位，多位同号照新建（试跑报告里提醒过人工合并） */
async function 再认同号(tx: Tx, 现: 现场, phone: string): Promise<string | null> {
  if (!phone) return null;
  const 有 = await tx.customer.findMany({ where: await 同号条件(tx, phone, 现.分机起), select: { id: true }, take: 2 });
  return 有.length === 1 ? 有[0].id : null;
}

async function 新建(tx: Tx, 现: 现场, w: 待写): Promise<结果> {
  const v = await 落值(tx, 现, w, null, null);
  const id = await 建(tx, w.实体, v, 现.现在, 现.项目);
  await tx.entExternalRef.create({
    data: { source: 现.源, entity: w.实体, externalId: w.外部ID, targetId: id, fingerprint: w.指纹, written: J(v), raw: J(w.原始), batchId: 现.批次Id },
  });
  await tx.entImportRow.create({ data: { batchId: 现.批次Id, entity: w.实体, externalId: w.外部ID, targetId: id, kind: "create", written: J(v) } });
  if (w.实体 === "lead" && 现.项目) await 线索落项目(tx, 现, w, id, v);
  return "新建";
}

/** 线索顺手建出来的那几条在导入记录里的 externalId：加前缀，和原系统真的客户 / 联系人 / 商机行的对照键不撞 */
export const 线索带出 = (外部ID: string) => `线索:${外部ID}`;

/**
 * 企业版只用项目：「新线索」页只列线索阶段的项目，老 Lead 表那边看不见（10-28）。
 * 导进来的线索照旧建一行 Lead（对照表连着它，之后同步改的是它），再照线索转化那样建成线索阶段的项目（lib/project/from-lead.ts 线索建项目）：
 *   - 客户：唯一的同号客户就挂它；没有就按线索名新建一位（院校、渠道这些不填，撤回时不会被当成「补过档案」拦住）
 *   - 联系人：新建的客户、线索上有联系人名字才建一位主要联系人，项目挂上它
 *   - 没有首条沟通（原系统没给），项目不带下一步时间；来源线索记这条 Lead
 * 已转化 / 已放弃的线索不建项目（转化过的原系统里另有客户和商机，会照客户、商机行导进来）。
 * 建出来的客户、联系人、项目各记一行导入记录（externalId 加前缀），整批撤回时倒着一起退掉。
 * Lead 行不标已转化、不连客户：标了撤回会被「已经转成客户了」拦住。
 */
async function 线索落项目(tx: Tx, 现: 现场, w: 待写, leadId: string, v: 值表): Promise<void> {
  if (v.status === "已转化" || v.status === "已放弃") return;
  const 负责人 = 串(v.ownerId) ?? 现.兜底负责人;
  const 记 = async (e: 实体, id: string) =>
    tx.entImportRow.create({
      data: { batchId: 现.批次Id, entity: e, externalId: 线索带出(w.外部ID), targetId: id, kind: "create", written: J(await 读现值(tx, e, id)) },
    });
  let customerId = await 再认同号(tx, 现, String(v.phone ?? ""));
  let 联系人Id: string | null = null;
  if (!customerId) {
    customerId = await 建(tx, "customer", { name: v.name, phone: v.phone, salesOwnerId: 负责人, followStatus: null, remark: null }, 现.现在);
    await 记("customer", customerId);
    if (!空(v.contact)) {
      联系人Id = await 建(tx, "contact", { name: v.contact, position: null, phone: v.phone, email: v.email, wechat: null, isPrimary: true, remark: null, customerId }, 现.现在);
      await 记("contact", 联系人Id);
    }
  }
  const 项目Id = await 线索建项目(tx, { 线索名: String(v.name), leadId, customerId, ownerId: 负责人, creatorId: 负责人, 联系人Id });
  await 记("opportunity", 项目Id);
}

/** 连上我们这边早就有的同号客户：只补空着的格子；对照表记原系统这次的值，之后同步照三方比对 */
async function 补空(tx: Tx, 现: 现场, w: 待写, 目标: string): Promise<结果> {
  const 现值 = (await 读现值(tx, "customer", 目标))!;
  const v = await 落值(tx, 现, w, null, 现值);
  const 补: 值表 = {};
  const before: 值表 = {};
  const 挂得上 = !空(v.channelId) && (await 可挂渠道(tx, 目标));
  for (const k of 补空格) {
    if (k === "channelId" && !挂得上) continue;
    if (空(现值[k]) && !空(v[k])) {
      补[k] = v[k];
      before[k] = 现值[k];
    }
  }
  if (Object.keys(补).length) await 改(tx, "customer", 目标, 补, 现值, 现.现在);
  await tx.entExternalRef.create({
    data: { source: 现.源, entity: w.实体, externalId: w.外部ID, targetId: 目标, fingerprint: w.指纹, written: J(v), raw: J(w.原始), batchId: 现.批次Id },
  });
  await tx.entImportRow.create({
    data: { batchId: 现.批次Id, entity: w.实体, externalId: w.外部ID, targetId: 目标, kind: "update", before: J(before), written: J(补) },
  });
  return Object.keys(补).length ? "更新" : "跳过";
}

/**
 * 本批同号的后一条：不写记录，只记一条对照指向前一条那位，子记录挂它也能挂上。
 * 对照里记它自己这次的值：之后它在原系统里改了，和那位的现值三方比对，不一样就记冲突，不会和前一条来回覆盖
 */
async function 并入(tx: Tx, 现: 现场, w: 待写, 目标: string): Promise<结果> {
  const v = await 落值(tx, 现, w, null, await 读现值(tx, w.实体, 目标));
  await tx.entExternalRef.create({
    data: { source: 现.源, entity: w.实体, externalId: w.外部ID, targetId: 目标, fingerprint: w.指纹, written: J(v), raw: J(w.原始), batchId: 现.批次Id },
  });
  await tx.entImportRow.create({ data: { batchId: 现.批次Id, entity: w.实体, externalId: w.外部ID, targetId: 目标, kind: "update", before: J({}), written: J({}) } });
  return "跳过";
}

type 引用行 = Prisma.EntExternalRefGetPayload<object>;

/** 以前导过：三方比对，只改原系统改了、我们这边没动过的格子；两边都改了记冲突 */
async function 对照(tx: Tx, 现: 现场, w: 待写, ref: 引用行): Promise<结果> {
  if (ref.fingerprint === w.指纹) return "跳过";
  const 上次 = 解<值表>(ref.written, {});
  const 现值 = await 读现值(tx, w.实体, ref.targetId);
  const 记对照 = (written: 值表) =>
    tx.entExternalRef.update({ where: { id: ref.id }, data: { fingerprint: w.指纹, written: J(written), raw: J(w.原始), batchId: 现.批次Id } });
  const 记一行 = (before: 值表, written: 值表) =>
    tx.entImportRow.create({
      data: { batchId: 现.批次Id, entity: w.实体, externalId: w.外部ID, targetId: ref.targetId, kind: "update", before: J(before), written: J(written), refBefore: J(ref) },
    });

  if (!现值) {
    await 记冲突(tx, 现, w, ref.targetId, {}, true);
    await 记对照(上次);
    await 记一行({}, {});
    return "冲突";
  }

  const v = await 落值(tx, 现, w, 上次, 现值);
  const 改动: 值表 = {};
  const before: 值表 = {};
  const 冲: Record<string, { 原系统: 标量; 我们: 标量; 上次: 标量 }> = {};
  const 新上次: 值表 = { ...上次 };
  for (const k of 比对字段[w.实体]) {
    // 新几格 / 渠道：原系统这次没带就不碰（逐格留空，空值不算冲突）
    if (只补的格.has(k) && !(k in v)) continue;
    const n = 规(v[k]);
    const l = 规(上次[k]);
    const c = 规(现值[k]);
    if (同(n, l)) continue; // 原系统没改
    if (k === "channelId") {
      // 渠道只补空：我们这边空着、归属也没定才挂；挂了别的渠道不动、不记冲突（归属固化）
      if (c === null && n !== null && (await 可挂渠道(tx, ref.targetId))) {
        改动[k] = n;
        before[k] = c;
      }
      新上次[k] = n;
      continue;
    }
    if (同(c, l)) {
      // 我们这边没动过：照原系统改
      改动[k] = n;
      before[k] = c;
      新上次[k] = n;
    } else if (同(c, n)) 新上次[k] = n; // 两边改成一样的了
    else 冲[k] = { 原系统: n, 我们: c, 上次: l };
  }
  if (Object.keys(改动).length) await 改(tx, w.实体, ref.targetId, 改动, 现值, 现.现在);
  const 有冲突 = Object.keys(冲).length > 0;
  if (有冲突) await 记冲突(tx, 现, w, ref.targetId, 冲, false);
  await 记对照(新上次);
  await 记一行(before, 改动);
  return 有冲突 ? "冲突" : Object.keys(改动).length ? "更新" : "跳过";
}

/** 一条原系统记录最多一笔待定的冲突：已有就换成这次的，不越记越多 */
async function 记冲突(tx: Tx, 现: 现场, w: 待写, targetId: string, fields: object, localDeleted: boolean): Promise<void> {
  const data = { targetId, batchId: 现.批次Id, fields: J(fields), incoming: J(w), localDeleted };
  const 有 = await tx.entConflict.findFirst({ where: { source: 现.源, entity: w.实体, externalId: w.外部ID, status: "待定" }, select: { id: true } });
  if (有) await tx.entConflict.update({ where: { id: 有.id }, data });
  else await tx.entConflict.create({ data: { source: 现.源, entity: w.实体, externalId: w.外部ID, ...data } });
}

/* ───────────────────────── 一批 ───────────────────────── */

const 计数列: Record<结果, "created" | "updated" | "skipped" | "conflicts"> = { 新建: "created", 更新: "updated", 跳过: "skipped", 冲突: "conflicts" };

/** 写之前备好的：谁能当负责人、负责人都对不上时给谁 */
export async function 开现场(批次Id: string, 源: 来源, m: 映射, 用户: Actor): Promise<现场> {
  const 成员 = await prisma.user.findMany({ where: { active: true, role: { not: "ADMIN" } }, select: { id: true } });
  const 可任 = new Set(成员.map((u) => u.id));
  return {
    批次Id,
    源,
    m,
    可任,
    兜底负责人: 可任.has(用户.id) ? 用户.id : (成员[0]?.id ?? 用户.id),
    分机起: await 分机留存起(),
    现在: new Date().toISOString(),
    项目: !!m.项目,
  };
}

/**
 * 把一批写进去（或接着写）。preview / applying 才写；写完一趟时间到了就返回，完了 = false 时再调一次。
 * 用户 = 点「正式导入」的人（同步时是开同步的那位），记进操作日志
 */
export async function 写一批(批次Id: string, 用户: Actor, opts: { 段长毫秒?: number } = {}): Promise<写入结果> {
  const 开始 = Date.now();
  const 批 = await prisma.entImportBatch.findUnique({ where: { id: 批次Id } });
  if (!批) throw new Error("找不到这一批");
  if (批.status === "preview") await prisma.entImportBatch.updateMany({ where: { id: 批次Id, status: "preview" }, data: { status: "applying" } });
  else if (批.status !== "applying") return 结果(批次Id);

  const 计划 = 解<待写[]>(批.plan, []);
  const m = 解<映射 | null>(批.mapping, null);
  if (!m) throw new Error("这一批没有字段映射，请重新试跑");
  const 现 = await 开现场(批次Id, 批.source as 来源, m, 用户);
  const 失败们 = 解<失败明细[]>(批.note, []);

  // 每次调用至少写一趟，再看时间：段长再短也不会原地踏步
  const 截止 = 开始 + (opts.段长毫秒 ?? 段长());
  let 游标 = 批.cursor;
  try {
    while (游标 < 计划.length && (游标 === 批.cursor || Date.now() < 截止)) {
      const 段 = 计划.slice(游标, 游标 + 每趟条数);
      try {
        await 一趟(现, 段, 游标);
      } catch (e) {
        if (e instanceof 让位) throw e;
        // 这一趟有一条出错：退回一条一条写，出错的那条记下来，别的照写
        for (let i = 0; i < 段.length; i++) {
          try {
            await 一趟(现, [段[i]], 游标 + i);
          } catch (e1) {
            if (e1 instanceof 让位) throw e1;
            const w = 段[i];
            if (失败们.length < 失败上限) 失败们.push({ 实体: w.实体, 外部ID: w.外部ID, 行号: w.行号, 出处: w.出处, 原因: 原因(e1) });
            const n = await prisma.entImportBatch.updateMany({
              where: { id: 批次Id, cursor: 游标 + i, status: "applying" },
              data: { cursor: { increment: 1 }, failed: { increment: 1 }, note: J(失败们) },
            });
            if (n.count !== 1) throw new 让位();
          }
        }
      }
      游标 += 段.length;
    }
  } catch (e) {
    if (!(e instanceof 让位)) throw e;
    return 结果(批次Id);
  }

  if (游标 >= 计划.length) await 收尾(批次Id, 用户);
  return 结果(批次Id);
}

/** 一个小事务写几条：游标和计数一起进，对不上（别处在写、或已撤回）就整趟让出来 */
async function 一趟(现: 现场, 段: 待写[], 起: number): Promise<void> {
  await 查完再写((tx) =>
    看全部(async () => {
      const 数 = 计数();
      for (const w of 段) 数[await 写一条(tx, 现, w)]++;
      const data: Prisma.EntImportBatchUpdateManyMutationInput = { cursor: { increment: 段.length } };
      for (const k of Object.keys(数) as 结果[]) if (数[k]) data[计数列[k]] = { increment: 数[k] };
      const n = await tx.entImportBatch.updateMany({ where: { id: 现.批次Id, cursor: 起, status: "applying" }, data });
      if (n.count !== 1) throw new 让位();
    }),
  );
}

export type 预演计数 = { 新建: number; 更新: number; 跳过: number; 冲突: number; 失败: number };
/** 计划再多就不演，数字按清洗分类给 */
export const 预演上限 = 2000;
/**
 * 预演从第一条写起就占着库的写锁，别处这时要写最多等 busy_timeout（5 秒）就报错。
 * 演到这个时间还没完就停下整个回滚，报告退回按清洗分类给数
 */
export const 预演限时毫秒 = 3000;
class 预演完了 extends Error {
  constructor(readonly 数: Record<实体, 预演计数>) {
    super("预演完了");
  }
}
export class 演太久 extends Error {
  constructor(秒: number, 已演: number, 共: number) {
    super(`演了 ${秒} 秒才到第 ${已演} / ${共} 条，怕挡住别人写库先停了`);
  }
}

/**
 * 试跑时把整份计划按正式导入的写法真写一遍再整个回滚，数出每类会新建 / 更新 / 跳过 / 冲突 / 写不进几条。
 * 光看清洗分类猜不准：「更新」写的时候可能是冲突（我们这边也改过）、也可能是跳过（补空没空可补），
 * 报告给的数就得和写完的数一条不差。每条包一个保存点，出错的那条单独退掉，和正式导入「出错退回一条一条写」一样。
 * 计划太大（> 预演上限）不跑，返回 null；演过 预演限时毫秒 还没完就回滚、抛 演太久。都是免得试跑把库锁太久
 */
export async function 预演(
  源: 来源,
  m: 映射,
  计划: 待写[],
  用户: Actor,
  限时 = 预演限时毫秒,
): Promise<Record<实体, 预演计数> | null> {
  if (计划.length > 预演上限) return null;
  const 底 = await 开现场("", 源, m, 用户);
  const 起 = Date.now();
  try {
    await prisma.$transaction(
      (tx) =>
        看全部(async () => {
          const 批 = await tx.entImportBatch.create({ data: { source: 源, status: "applying", userId: 用户.id }, select: { id: true } });
          const 现 = { ...底, 批次Id: 批.id };
          const 数 = {} as Record<实体, 预演计数>;
          for (const [i, w] of 计划.entries()) {
            if (Date.now() - 起 > 限时) throw new 演太久(限时 / 1000, i, 计划.length);
            const 格 = (数[w.实体] ??= { 新建: 0, 更新: 0, 跳过: 0, 冲突: 0, 失败: 0 });
            await tx.$executeRawUnsafe("SAVEPOINT ent_pre");
            try {
              格[await 写一条(tx, 现, w)]++;
            } catch {
              await tx.$executeRawUnsafe("ROLLBACK TO ent_pre");
              格.失败++;
            }
            await tx.$executeRawUnsafe("RELEASE ent_pre");
          }
          throw new 预演完了(数);
        }),
      { maxWait: 10_000, timeout: 限时 + 10_000 },
    );
  } catch (e) {
    if (e instanceof 预演完了) return e.数;
    throw e;
  }
  return null;
}

function 原因(e: unknown): string {
  if (e instanceof 写不进) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  // Prisma 的报错很长，留最后一行就够认出是什么
  return `写库出错：${msg.trim().split("\n").pop()?.slice(0, 200) ?? ""}`;
}

/** 写完：给碰过的客户补「最近跟进」，批次记 done，记操作日志 */
async function 收尾(批次Id: string, 用户: Actor): Promise<void> {
  const 跟进 = await prisma.entImportRow.findMany({ where: { batchId: 批次Id, entity: "followup" }, select: { targetId: true } });
  const ids = [...new Set(跟进.map((r) => r.targetId))];
  await 看全部(async () => {
    for (let i = 0; i < ids.length; i += 500) {
      const 组 = await prisma.followUp.groupBy({ by: ["customerId"], where: { id: { in: ids.slice(i, i + 500) } }, _max: { occurredAt: true } });
      for (const g of 组) {
        const at = g._max.occurredAt;
        if (!at) continue;
        await prisma.customer.updateMany({ where: { id: g.customerId, OR: [{ lastFollowAt: null }, { lastFollowAt: { lt: at } }] }, data: { lastFollowAt: at } });
      }
    }
  });
  const n = await prisma.entImportBatch.updateMany({ where: { id: 批次Id, status: "applying" }, data: { status: "done", finishedAt: new Date() } });
  if (n.count !== 1) return; // 别处已经收过尾
  const 批 = (await prisma.entImportBatch.findUnique({ where: { id: 批次Id } }))!;
  const 叫法 = 批.kind === "sync" ? "同步" : "导入";
  await recordAudit({
    user: 用户,
    action: 批.kind === "sync" ? "ent-sync" : "ent-import",
    entity: "EntImportBatch",
    entityId: 批次Id,
    summary: `从${来源名[批.source as 来源] ?? 批.source}${叫法}：新建 ${批.created} 条，更新 ${批.updated} 条，跳过 ${批.skipped} 条，${批.conflicts} 条冲突待定，${批.failed} 条没写进去`,
    detail: { batchId: 批次Id, source: 批.source, kind: 批.kind, created: 批.created, updated: 批.updated, skipped: 批.skipped, conflicts: 批.conflicts, failed: 批.failed },
  });
  for (const p of ["/customers", "/leads", "/opportunities", "/projects", "/dashboard"]) revalidatePath(p);
}

async function 结果(批次Id: string): Promise<写入结果> {
  const b = (await prisma.entImportBatch.findUnique({ where: { id: 批次Id } }))!;
  return {
    状态: b.status,
    完了: b.status === "done",
    总数: b.total,
    写到: b.cursor,
    新建: b.created,
    更新: b.updated,
    跳过: b.skipped,
    冲突: b.conflicts,
    失败: b.failed,
  };
}

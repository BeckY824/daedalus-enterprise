/**
 * 项目模式的建档向导（2026-10-23，D-31）：查重 → 联系人 → 客户 → 项目 → 首条跟进，最后一步才落库，一笔事务。
 * 客户那部分整个交给 saveCustomer（查重、校验、外贸档案都是那一份），这里只管后面四样：
 * 先把交上来的规整好、该拦的先拦，再给 saveCustomer 一个「接着建」，在建客户的同一个事务里写下去。
 * 中途哪一步失败整笔回滚：客户、联系人、项目、跟进一行不留（tests/project-wizard.test.ts）。
 */
import type { Prisma } from "@/generated/prisma";
import { hasVisibleText } from "../form-validation";
import { parseDateInput } from "../date-input";
import { FOLLOW_TYPES } from "../constants";
import { 是币种, 默认币种 } from "../currency";
import { dayjs } from "../utils";
import { 第一个节点, 企业版字典, 节点序号 } from "./nodes";
import { 有效线索节点, 建档不能过线索验证, 记沟通标记 } from "./stage-gates";
import { 登记接着建, type 接着建 } from "./hook";
import { 记沟通编号 } from "./followup-meta";
import { 下一步文字上限 } from "./project-fields";
import { 是占位值 } from "./required";
import { 新项目默认值 } from "./proj-fields";
import { 企业版 } from "@/lib/enterprise/switch";
import { 认业务线, 业务线不认得, type 项目线 } from "@/lib/enterprise/assign-line";
import { 新项目所在地, type 新项目所在地输入 } from "./profile-rules";
import type { 客户地址 } from "@/lib/enterprise/customer-v2";

export const 项目名上限 = 60;
export const 备注上限 = 500;

/** address：联系人所在区域 / 地址（一格文字，11-04 首页录入把国家城市放这）；向导界面不传 = 不存 */
export type 向导联系人 = { name: string; position?: string | null; phone?: string | null; email?: string | null; wechat?: string | null; address?: string | null };
export const 联系人地址上限 = 100;
/** 分配方式：企业版才有，默认五项的序号（lib/enterprise/dict.ts 分配方式序号），只在 projects/actions.ts 建档向导里认 */
export type 向导项目 = { name: string; ownerId?: string | null; amount?: number | null; currency?: string | null; remark?: string | null; 分配方式?: number | null;
  /** 项目来源（企业版，迁移 077）：这个项目从哪个渠道来。建档向导没选 = 跟客户来源（项目来源默认）；建好有值就锁、空着的可补一次（P-删-03，lib/project/db.ts 改项目）。团队版不传、不认 */
  channelId?: string | null;
  /**
   * 业务线（企业版，11-01 清单 A1，16:1x 拍板三选一）：内贸 / 外贸 / 暂不分配；企业版新建必填（projects/actions.ts 建档向导、
   * 客户页 给客户建项目 里拦）。自动分配只在这条线勾的部门里挑人，暂不分配不进自动分配。团队版不传、不认
   */
  业务线?: string | null;
  /**
   * 项目所在地（企业版，11-02）：新建时可选填四格 + 详细地址，规整同编辑项目（profile-rules.ts 新项目所在地）；
   * 不填 = 照旧不存。界面上按它给业务线建议（assign-line.ts 所在地预填），人确认了才算。团队版不传、不认
   */
  所在地?: 新项目所在地输入 | null };
/** 下一步时间：企业版开了超时回收时线索、商机阶段必填（lib/project/timeout.ts），没开可不填 */
/**
 * 阶段：企业版记沟通必选（lib/project/stage-gates.ts 的 记沟通阶段问题），团队版不传、不看。
 * 明确回复：11-05 起不再问（有效沟通改看线索验证的必填项），老草稿、老调用方传了也不认
 */
export type 向导跟进 = { type: string;
  /** 企业版沟通方式（10-31）：服务端先过 认跟进方式（dict.ts）定好方式和类型，这里只照带；别的版本不传 */
  method?: string | null;
  /** 企业版发起主体（11-01，迁移 105）：认跟进方式 里定好（没选补「我方发起」），这里只照带；别的版本不传 */
  initiator?: string | null;
  content: string; occurredAt: string; 下一步时间?: string | null; 阶段?: string; 明确回复?: boolean | null;
  /** 下一步计划（一句话，10-29）：项目详情记沟通必填；企业版开了超时回收时新建也必填（11-05，和下一步时间一起） */
  下一步?: string | null;
  /** 企业版建档向导：项目建在线索阶段的哪个节点（跟进节点，必选）；团队版不传，一律潜客培育 */
  节点?: string | null;
  /**
   * 客户页选了关联项目时（10-31）：标题、另选的联系人、状态、时长（分钟）、参与人一次建好。
   * 原来是记完再用 saveFollowUp 补改，普通成员不能改沟通了（M-权限-09）就不走那条。项目详情不传 = 照旧（空标题、已完成、项目的联系人）
   */
  额外?: { title?: string | null; contactId?: string | null; status?: string | null; durationMinutes?: number | null; participants?: string | null } | null };

export type 规整好的 = {
  联系人: { name: string; position: string | null; phone: string | null; email: string | null; wechat: string | null; address?: string | null };
  项目: { name: string; ownerId: string; amount: number; currency: string; remark: string | null };
  跟进: 规整好的沟通;
  /** 企业版建档（10-26）：项目落在哪个线索节点；团队版没有 */
  企业?: {
    节点: string; 项目来源?: string | null;
    /** 业务线（11-01 A1）：手动选的内贸 / 外贸 / 暂不分配；没选 = null（建档向导再拦必填） */
    业务线?: 项目线 | null;
    /** 项目所在地（11-02）：规整好的四格 + 详细地址；没填全是 null */
    所在地?: 客户地址 & { location: string | null };
    /** 分配方式的叫法（11-01 迁移 106，存 Project.assignMode）；调用方定好分配方式后填 */
    分配方式名?: string;
  };
};

/**
 * 项目来源默认值（企业版建档向导）：这个项目自己选了渠道就用它；没选（空 / 没传）就带客户的来源。
 * 客户来源记的是客户第一次从哪来，项目来源各记各的——老客户再来一单可以是别的渠道，所以建档时能另选；建好之后有值就锁（P-删-03）
 */
export function 项目来源默认(项目选的: string | null | undefined, 客户来源: string | null | undefined): string | null {
  return 文字(项目选的) || 文字(客户来源) || null;
}

export type 规整好的沟通 = { type: string; method: string | null; initiator: string | null; content: string; occurredAt: Date; nextStepAt: Date | null; nextStepText: string | null };

export const 要下一步时间 = "开了超时回收：线索、商机阶段的项目记沟通要填下一步时间";
export const 要下一步文字 = "请写下一步做什么";

/** 首条跟进记的是一次沟通；待办、提醒要带时间，进了项目页再排 */
const 首条能记的 = FOLLOW_TYPES.filter((t) => t.value !== "TASK" && t.value !== "REMIND").map((t) => t.value as string);

const 文字 = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const 可空 = (v: unknown) => 文字(v) || null;

/** 企业版建档名字填了占位（未知、待定、暂未确认…）的提示，向导前端同一句 */
export const 占位名提示 = (叫: string) => `${叫}不能填「未知」「待定」这类占位，请填真实的`;

/** 项目那几格（名称、负责人、金额、币种、备注）规整一遍：向导第四步和项目详情里「编辑」共用。负责人没选 = 默认那位 */
export function 规整项目(p: 向导项目, 默认负责人: string): 规整好的["项目"] | { error: string } {
  if (!hasVisibleText(p.name)) return { error: "请填写项目名称" };
  if (文字(p.name).length > 项目名上限) return { error: `项目名称请控制在 ${项目名上限} 字以内` };
  const amount = p.amount ?? 0;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return { error: "项目金额不能为负数" };
  const currency = p.currency || 默认币种;
  if (!是币种(currency)) return { error: `币种「${currency}」认不出来` };
  if (文字(p.remark).length > 备注上限) return { error: `项目备注请控制在 ${备注上限} 字以内` };
  return { name: 文字(p.name), ownerId: p.ownerId || 默认负责人, amount, currency, remark: 可空(p.remark) };
}

/**
 * 一条项目沟通规整一遍：向导的首条跟进、项目详情里「记一条」共用。
 * 要下一步 = 开了超时回收、项目在线索 / 商机阶段（调用方判断）；下一步时间填了就得是今天或以后。
 * 要下一步文字 = 项目详情「记一条」（10-29）：下一步做什么必填一句话，时间照旧按要下一步
 */
export function 规整沟通(
  f: 向导跟进,
  opt: { 要下一步: boolean; now?: Date; 叫法?: string; 要下一步文字?: boolean },
): 规整好的沟通 | { error: string } {
  const now = opt.now ?? new Date(), 叫 = opt.叫法 ?? "";
  if (!首条能记的.includes(f.type)) return { error: `${叫}跟进的类型「${f.type}」不能选` };
  if (!hasVisibleText(f.content)) return { error: `请填写${叫}跟进的沟通内容` };
  const occurredAt = parseDateInput(f.occurredAt);
  if (!occurredAt) return { error: `${叫}跟进的时间格式不正确` };
  if (occurredAt.getTime() > now.getTime() + 60_000) return { error: `${叫}跟进的时间不能在未来` };
  let nextStepAt: Date | null = null;
  if (文字(f.下一步时间)) {
    nextStepAt = parseDateInput(f.下一步时间);
    if (!nextStepAt) return { error: "下一步时间格式不正确" };
    if (dayjs(nextStepAt).format("YYYY-MM-DD") < dayjs(now).format("YYYY-MM-DD")) return { error: "下一步时间不能早于今天" };
  } else if (opt.要下一步) return { error: 要下一步时间 };
  const nextStepText = 文字(f.下一步) || null;
  if (!nextStepText && opt.要下一步文字) return { error: 要下一步文字 };
  if (nextStepText && nextStepText.length > 下一步文字上限) return { error: `下一步请控制在 ${下一步文字上限} 字以内` };
  return { type: f.type, method: 可空(f.method), initiator: 可空(f.initiator), content: 文字(f.content), occurredAt, nextStepAt, nextStepText };
}

/** 后四步交上来的规整一遍。负责人没选 = 自己；在不在职由调用方查库。要下一步 = 开了超时回收（项目建在线索阶段） */
export function 规整向导(
  me: { id: string },
  input: { 联系人?: 向导联系人; 项目?: 向导项目; 跟进?: 向导跟进 },
  now = new Date(),
  要下一步 = false,
  企业 = false,
): 规整好的 | { error: string } {
  const c = input.联系人, p = input.项目, f = input.跟进;
  if (!c || !p || !f) return { error: "建档信息不完整，请从头再走一遍" };
  if (!hasVisibleText(c.name)) return { error: "请填写联系人姓名" };
  const 电话 = 可空(c.phone);
  if (电话?.includes("*")) return { error: "联系人电话里不能有 *" };
  const 联系人地址 = 可空(c.address);
  if (联系人地址 && 联系人地址.length > 联系人地址上限) return { error: `联系人地址最多 ${联系人地址上限} 个字` };

  const 项目 = 规整项目(p, me.id);
  if ("error" in 项目) return 项目;

  // 企业版开了超时回收：下一步时间、下一步计划两格都必填（11-05）
  const 跟进 = 规整沟通(f, { 要下一步, now, 叫法: "首条", 要下一步文字: 要下一步 && 企业 });
  if ("error" in 跟进) return 跟进;

  // 企业版新建线索（10-26）：负责人必选（不默认自己）、跟进节点必选；渠道必选在 建档向导 里查库
  let 企业档: 规整好的["企业"];
  if (企业) {
    // 占位值不算填了（11-03 A2-2）：「未知」「待定」「暂未确认」这类建出来详情也算缺
    if (是占位值(c.name)) return { error: 占位名提示("联系人姓名") };
    if (是占位值(p.name)) return { error: 占位名提示("项目名称") };
    if (!文字(p.ownerId)) return { error: "请选项目负责人" };
    const 节点 = 文字(f.节点);
    if (!企业版字典.节点们.线索.includes(节点)) return { error: "请选当前进程（线索阶段的哪一步）" };
    // 11-05 去掉「客户明确回复了吗」：过了线索验证要看线索验证的必填项，新建时还填不了，所以只能落在它及之前
    if (节点序号({ phase: "线索", node: 节点 }, 企业版字典) > 节点序号({ phase: "线索", node: 有效线索节点 }, 企业版字典)) return { error: 建档不能过线索验证 };
    企业档 = { 节点 };
    const 线 = 认业务线(p.业务线);
    if (线 === undefined) return { error: 业务线不认得 };
    企业档.业务线 = 线;
    const 地 = 新项目所在地(p.所在地);
    if (!地.ok) return { error: 地.error };
    企业档.所在地 = 地.值;
  }

  return {
    联系人: { name: 文字(c.name), position: 可空(c.position), phone: 电话, email: 可空(c.email), wechat: 可空(c.wechat), ...(联系人地址 ? { address: 联系人地址 } : {}) },
    项目,
    跟进,
    ...(企业档 ? { 企业: 企业档 } : {}),
  };
}

export type 建好的 = { contactId: string; projectId: string; followUpId: string };

/**
 * 给 saveCustomer 的「接着建」：主要联系人、建档人、项目（落在潜客培育，记第一行节点变更）、首条跟进挂上项目。
 * 只用 tx；建好的 id 写进 出参，事务提交了才算数
 */
export function 向导接着建(me: { id: string }, 好: 规整好的, 出参: Partial<建好的>): 接着建 {
  return 登记接着建(async (tx: Prisma.TransactionClient, customerId: string) => {
    const 联系人 = await tx.contact.create({ data: { ...好.联系人, isPrimary: true, customerId } });
    await tx.customerCreator.create({ data: { customerId, userId: me.id } });
    // 企业版建档选了跟进节点就落在那，团队版一律潜客培育
    const 落 = { phase: 第一个节点.phase, node: 好.企业?.节点 ?? 第一个节点.node };
    const 项目 = await tx.project.create({
      data: {
        ...好.项目, customerId, contactId: 联系人.id, creatorId: me.id,
        phase: 落.phase, node: 落.node, nextStepAt: 好.跟进.nextStepAt, nextStepText: 好.跟进.nextStepText,
        // 项目来源只有企业版建档才写（建档向导里查过库）；团队版一律空，渠道统计回落到客户来源
        ...(好.企业?.项目来源 ? { channelId: 好.企业.项目来源 } : {}),
        // 业务线、分配方式（11-01）：只有企业版建档才写
        ...(好.企业?.业务线 ? { bizLine: 好.企业.业务线 } : {}),
        // 项目所在地（11-02）：企业版建档填了才有值，没填五格都是 null
        ...(好.企业?.所在地 ?? {}),
        ...(好.企业?.分配方式名 ? { assignMode: 好.企业.分配方式名 } : {}),
        // 合同状态（迁移 101）：企业版新项目落「起草中」
        ...新项目默认值(企业版()),
      },
    });
    await tx.projectNodeLog.create({ data: { projectId: 项目.id, userId: me.id, toPhase: 落.phase, toNode: 落.node } });
    const 跟进 = await tx.followUp.create({
      data: { type: 好.跟进.type, method: 好.跟进.method, initiator: 好.跟进.initiator, content: 好.跟进.content, occurredAt: 好.跟进.occurredAt, title: "", status: "已完成", customerId, contactId: 联系人.id, ownerId: me.id },
    });
    await tx.followUpProject.create({ data: { followUpId: 跟进.id, projectId: 项目.id, node: 落.node } });
    await 记沟通编号(tx, 跟进.id, 项目.id, 好.跟进.nextStepAt);
    if (好.企业) await 记沟通标记(tx, 跟进.id, 项目.id, 落.phase, false);
    await tx.customer.update({ where: { id: customerId }, data: { lastFollowAt: 好.跟进.occurredAt } });
    Object.assign(出参, { contactId: 联系人.id, projectId: 项目.id, followUpId: 跟进.id });
  });
}

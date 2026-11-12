"use server";

import { 新建只给自己 } from "@/lib/enterprise/import-perm";
import { 负责人显示名 } from "@/lib/pool";
import { 软删开着, 软删客户, 回收站保留天数, 删除挡 } from "@/lib/enterprise/soft-delete";
import { businessDayjs } from "@/lib/business-clock";
import { hasVisibleText } from "@/lib/form-validation";

import { scheduleValue, parseSignDate } from "@/lib/schedule-date";

import { 不在了 } from "@/lib/not-there";
import { 查完再写 } from "@/lib/check-then-write";
import { 钉住老签约 } from "@/lib/contract-owner";
import { revalidatePath } from "next/cache";
import { prisma, defaultClient } from "@/lib/prisma";
import { 看全部, 看得到, 读的我, 同事的客户, 只读话, 虚线只读挡, type 谁 } from "@/lib/team-scope";
import { 同事撞号说法, type 查重种类 } from "@/lib/sync/dedupe";
import { 离职负责人找谁, 离职负责人说法 } from "@/lib/enterprise/departed-owner";
import { 问同事 } from "@/lib/sync/dedupe-client";
import { requireUser } from "@/lib/auth";
import { 可选客户 } from "@/lib/options";
import { resolveAttribution, wouldCreateCycle } from "@/lib/attribution";
import { 认渠道触点, 渠道触点们 } from "@/lib/enterprise/touchpoint";
import {
  conflictingFields,
  diffKeys,
  labelsOf,
  customerFieldLabels,
  REFERRER_KEYS,
  ATTRIBUTION_KEYS,
} from "@/lib/concurrency";
import { FOLLOW_STATUSES, DECISION_STATUSES, OPP_STAGES } from "@/lib/constants";
import { 客户存了推项目 } from "@/lib/project/auto-advance";
import { recordAudit, describeCustomerChanges } from "@/lib/audit";
import { 唯一负责人, 不能当负责人 } from "@/lib/owners";
import { getBusiness } from "@/lib/business";
import { 写签约金额, 带币种, 商机币种, 签约币种, 签约金额, 签约合计 } from "@/lib/money-db";
import { 金额 as 显示金额, 是币种, 规整币种 } from "@/lib/currency";
import { statusLabel, 签约叫 } from "@/lib/business-config";
import { 查电话, 规整手机号, 认回打码号 } from "@/lib/phone";
import { 同号条件, 分机留存起 } from "@/lib/phone-dedupe";
import { 同邮箱条件, 同微信条件, 同阿里条件, 邮箱键 } from "@/lib/email-dedupe";
import type { 带走数, 转走项目预览 } from "@/lib/carry-over";
import { 带走并记下, 带走并记下在事务里, 还项目, 带过来对不上, 数转走的项目, 数进手的持有项目, type 带走的 } from "@/lib/carry-over-db";
import { 还待分配状态 } from "@/lib/enterprise/market-transfer";
import { 记换负责人, 是我刚换的, 删被撤的换负责人记录 } from "@/lib/owner-log-db";
import { 撤回项目公海 } from "@/lib/enterprise/pool-undo";
import { 企业版 } from "@/lib/enterprise/switch";
import { 落到渠道 } from "@/lib/enterprise/channel-main";
import { 是主渠道入口 } from "@/lib/enterprise/channel-main-core";
import { 能转让客户, 能改客户, 没设业务角色, 只读角色, 只读角色话, 是系统管理员, 转自己客户要申请 } from "@/lib/enterprise/permissions";
import { 有同事在推的客户, 同事在推不能删话 } from "@/lib/enterprise/colleague-projects";
import { 权限组织 } from "@/lib/enterprise/org";
import { 补潜客培育, 要补潜客培育 } from "@/lib/project/nurture";
import { 只用项目挡老入口 } from "@/lib/enterprise/project-only";
import { 算市场转客户 } from "@/lib/enterprise/market-transfer";
import { 交接中的客户 } from "@/lib/enterprise/handover-db";
import { 选的原因, 可选项 } from "@/lib/enterprise/dict";
import { 验号码 } from "@/lib/enterprise/contact-format";
import { 企业号码查重, 全公司查号, 撞号结论, 记号码 } from "@/lib/enterprise/contact-dedupe";
import { 号码撞上, 客户名查重, 名撞说法, type 名撞结论 } from "@/lib/enterprise/dupe-ledger";
import { setOppStatus } from "../opportunities/actions";
import { 认得 } from "@/lib/project/hook";
import { 客户的项目数, 持有上限起点, 写前核上限, 整批或不做 } from "@/lib/project/db";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import type { 组织规则 } from "@/lib/project/org-rules";
import { 客户有验证中线索 } from "@/lib/project/lead-verify-guard";
import { 外贸键, 外贸字段名, 外贸至少一种, 规整外贸格, 规整外贸档案, 规整阿里ID, 认国家, type 外贸档案 } from "@/lib/customer-extra";
import { 写外贸档案 } from "@/lib/customer-extra-db";
import { 挡字段, 客户列字段, type 字段名 } from "@/lib/enterprise/field-perm";
import { 认企业级别, 规整地址, 规整详细地址, 简称上限, type 客户地址 } from "@/lib/enterprise/customer-v2";
import { 认业务线, 业务线不认得, 客户业务线必填 } from "@/lib/enterprise/assign-line";
import type { Prisma } from "@/generated/prisma";
import { 客户状态自动 } from "@/lib/enterprise/cust-status-auto-db";
import { 交接通知, 分给你通知, 改负责人通知, 同事待分配随客户通知 } from "@/lib/enterprise/notice-sources";
import { 同号再次录入 } from "@/lib/enterprise/same-number-collab";
import { 是占位号, 占位号提示 } from "@/lib/placeholder-phone";


/** 状态不在取值表里就给那句报错，合法给 null。建客户、批量改、撤销、行内改四处共用，报错文案一字不改 */
const 不合法 = (名: string, 表: readonly string[], v: unknown) => (表.includes(v as string) ? null : `${名}「${v}」不是合法取值`);
const 跟进不对 = (v: unknown) => 不合法("跟进状态", FOLLOW_STATUSES, v);
const 决策不对 = (v: unknown) => 不合法("决策状态", DECISION_STATUSES, v);

/**
 * 企业版客户状态（字典 custStatus）。交来的得是启用中的一项；库里原值哪怕后来停用了，原样交回也认。
 * 没交（undefined）：新建给字典第一项，编辑保留原值。空串 / null = 清空。只在 企业版() 下调
 */
async function 定客户状态(交: string | null | undefined, 原: string | null, 新建: boolean): Promise<{ 值: string | null } | { error: string }> {
  const 项 = await 可选项("custStatus");
  if (交 === undefined) return { 值: 新建 ? 项[0] ?? null : 原 };
  const v = (交 ?? "").trim();
  if (!v) return { 值: null };
  if (v === 原 || 项.includes(v)) return { 值: v };
  return { error: `客户状态「${v}」不在可选范围内，请刷新后重选` };
}

/** 是不是一位在职成员。各处下拉只列在职的；把客户交给停用的人等于丢进黑洞 */
async function 在职(id: string): Promise<boolean> {
  return Boolean((await prisma.user.findUnique({ where: { id }, select: { active: true } }))?.active);
}
export type CustomerInput = {
  id?: string;
  /**
   * 打开编辑框那一刻记录的版本号（即当时的 updatedAt）。
   * 保存时作为并发闸门：期间被别人改过就对不上，拒绝覆盖。新建时不需要。
   */
  updatedAt?: string | null;
  /**
   * 打开编辑框那一刻看到的一整份值。
   * 版本号对不上时靠它区分「对方改了什么」和「我改了什么」——
   * 两边没交集就直接合并，不该打扰用户。缺省时退回「一律拦下」的保守行为。
   */
  base?: CustomerSnapshot | null;
  name: string;
  phone: string;
  school: string | null;
  grade: string | null;
  major: string | null;
  followStatus: string;
  decisionStatus: string;
  /**
   * 客户状态（企业版，2026-10-28，取自字典 custStatus）。undefined = 不碰（新建时企业版给字典第一项）；
   * 开关关着一律不看、不写；项目模式开着按项目自动算，交来的不认（10-30）
   */
  custStatus?: string | null;
  expectedSignAt: Date | string | null;
  remark: string | null;
  /** 一个人的工作区里界面上不问这一项，留空由服务端填成那唯一的人 */
  salesOwnerId?: string | null;
  /** 推荐人二选一：外部渠道 或 已有学员 */
  channelId: string | null;
  referrerCustomerId: string | null;
  /**
   * 显式指定渠道负责人。undefined = 不碰（跟着推荐链走）；null = 清空后按推荐链重算；
   * 字符串 = 手工钉死为这个人。用于登记错误的单个订正，不影响任何其他学员。
   */
  channelOwnerId?: string | null;
  /**
   * 企业版渠道触点（P-渠道-08，迁移 116，lib/enterprise/touchpoint.ts）：公司资源 / 客户介绍，这两类主渠道留空、由触点承载。
   * 主渠道和触点至少填一个；触点 = 客户介绍时 referrerCustomerId 是介绍人客户（P-渠道-09）。不给 = 不碰；开关关着一律不看
   */
  touchpoint?: string | null;
  /** 外贸档案（2026-10-05，外贸模版的表单才交）：国家、WhatsApp、微信、邮箱、来源。不给 = 不碰 */
  extra?: Partial<Record<keyof 外贸档案, string | null>>;
  /**
   * 企业版建档向导选了号码类型的那个号码（2026-10-26，lib/enterprise/contact-format.ts）。
   * 只在 企业版() 下、新建时认：按类型验格式、全公司查重；记进联系方式子表 ContactMethod，老列照写（手机号当电话存，邮箱 / 微信存进 CustomerExtra）。
   * 开关关着、编辑时一律不看
   */
  企业号码?: { 类型: string; 值: string } | null;
  /**
   * 企业版客户改版（2026-10-29，定稿 P5 第 22、23 条，迁移 072）：简称、地址、分配方式。不给 = 不碰；开关关着一律不看。
   * 级别（S / A / B / C）和官网照旧走 extra.level / extra.website（存在 CustomerExtra），企业版下级别按 认企业级别 验
   */
  企业资料?: Partial<企业客户资料> | null;
};

/** 企业版客户主表上新加的几格（迁移 072；客户类型 customerType 是 2026-10-29 P13 迁移 092，取自字典 custType） */
export type 企业客户资料 = 客户地址 & { shortName: string | null; assignWay: string | null; customerType: string | null;
  /** 客户属性（迁移 104，2026-10-31 F-客户-04）：字典 custAttr，客户看板按它分列 */
  customerAttr: string | null;
  /** 业务线（迁移 106，2026-11-01 清单 A1）：内贸 / 外贸 / 暂不分配，手动选；新开项目默认跟它 */
  bizLine: string | null;
  /** 地址第五格「客户地址」（迁移 091，P14 第 7 条）：公司详细地址，国内国外都收 */
  addrDetail: string | null };

/** 编辑框里可改的那部分字段，用作并发比对的基准快照 */
export type CustomerSnapshot = Pick<
  CustomerInput,
  | "name" | "phone" | "school" | "grade" | "major"
  | "followStatus" | "decisionStatus" | "custStatus" | "expectedSignAt" | "remark"
  | "salesOwnerId" | "channelId" | "referrerCustomerId"
> & { channelOwnerId?: string | null; touchpoint?: string | null } & Partial<企业客户资料>;

/**
 * 撞号时给界面的那位。业务员撞到同事名下、自己看不到的（团队版两档权限）：**只给负责人 + 客户名**，
 * id / 学校 / 录入时间都是 null——10-04 拍板只给负责人，10-19 跨成员查重时用户改成「只露同事名 + 客户名」，
 * 够他知道「这号是谁在跟、跟的是哪位」，打不开、也看不到客户的其它资料
 */
export type DuplicateHit = {
  id: string | null;
  name: string | null;
  school: string | null;
  salesOwnerName: string;
  createdAt: string | null;
  /** 企业版：负责人已离职（11-03 C4-5），该找谁（他在职的直属上级，没有就「系统管理员」） */
  负责人已离职找?: string;
} | null;

type 撞到的 = { name: string; salesOwnerId: string | null; channelOwnerId: string | null; pool: unknown; salesOwner: { name: string } | null };
const 撞到的字段 = { name: true, salesOwnerId: true, channelOwnerId: true, pool: { select: { customerId: true } }, salesOwner: { select: { name: true } } } as const;

/** 保存时撞号那句话：看得到的说是谁；业务员撞同事的只说负责人（同 DuplicateHit）。依据 =「手机号 138…」或「邮箱 a@b.com」 */
async function 撞号说法(依据: string, dup: 撞到的, 我: 谁 | null, 客户: string): Promise<string> {
  // 负责人已离职（11-03 C4-5）：不叫人去找他，指他的直属上级
  const 找谁 = await 离职负责人找谁(dup.salesOwnerId);
  if (看得到(dup, 我)) return `${依据} 已存在（${dup.name}），请勿重复录入${找谁 ? `；${离职负责人说法(找谁)}` : ""}`;
  if (找谁) return `${依据} 已是${dup.name ? `${客户}「${dup.name}」` : `同事名下的${客户}`}，请勿重复录入；${离职负责人说法(找谁)}`;
  return 同事撞号说法(依据, 负责人显示名(dup.salesOwner?.name ?? "同事"), dup.name, 客户);
}

/** 按手机号查重。手机号唯一性最可靠，姓名可能重名。和保存那一步一样先规整：「138 0000 1111」就是 13800001111 */
export async function checkDuplicate(phone: string, excludeId?: string): Promise<DuplicateHit> {
  await requireUser();
  const 号 = 规整手机号(phone);
  if (!号) return null;
  const 起 = await 分机留存起();
  // 看全部：团队版业务员录到同事已有的号码，也要提醒「这号有人在跟」——但只给负责人，不露是哪位（见 DuplicateHit）
  const hit = await 看全部(async () => prisma.customer.findFirst({
    where: { AND: [await 同号条件(prisma, 号, 起), ...(excludeId ? [{ id: { not: excludeId } }] : [])] },
    select: { id: true, school: true, createdAt: true, ...撞到的字段 },
  }));
  if (!hit) {
    // 范围同步下同事名下的客户本机没有：问一下服务端（2026-10-19 跨成员查重，lib/sync/dedupe-client.ts）。断网 / 没开团队版当没撞
    const 撞 = await 问同事("phone", 号, excludeId);
    return 撞 ? { id: null, name: 撞.客户名 || null, school: null, salesOwnerName: 撞.同事, createdAt: null } : null;
  }
  const 看得见 = 看得到(hit, await 读的我(defaultClient));
  const 找谁 = await 离职负责人找谁(hit.salesOwnerId);
  return {
    id: 看得见 ? hit.id : null,
    name: hit.name,
    school: 看得见 ? hit.school : null,
    salesOwnerName: 负责人显示名(hit.salesOwner?.name ?? "同事"),
    createdAt: 看得见 ? hit.createdAt.toISOString() : null,
    ...(找谁 ? { 负责人已离职找: 找谁 } : {}),
  };
}

/** 冲突时回传给界面，由界面负责按本地时区渲染时间 */
export type SaveConflict = {
  /** 库中这条记录当前的版本时间 */
  currentUpdatedAt: string;
  /** 真正撞车的字段：双方都改了同一项（中文名） */
  fields: string[];
  /** 对方这期间改过的全部字段，供用户判断要不要放弃自己的改动（中文名） */
  theirFields: string[];
};

export type SaveCustomerResult =
  /** 交接中 / 交接已在路上：编辑里负责人本人换负责人 = 申请移交（X-20、P-转-16，不看「交接要确认」开关），负责人先不换，等接手人确认 */
  | { ok: true; id: string; 带走?: 带走数; 交接中?: number; 交接已在路上?: number; 申请移交?: boolean }
  /** 同号协同 = 没新建，这次录的已写进现有项目（error 是给添加人的反馈，不是出错）。
   *  撞号 = 企业版新建时客户名 / 号码撞上已有客户（P-挂靠-01）：露出负责人、台账 id，向导摆「申请挂靠」 */
  | { ok: false; error: string; conflict?: SaveConflict; 同号协同?: true; 撞号?: 名撞结论 };

/**
 * 第二个参数只给项目模式的建档向导用：新建时在建客户的同一个事务里接着建联系人、项目、首条跟进，
 * 它抛错整笔回滚、一行不留。只认 lib/project/hook.ts 登记过的；编辑不调
 */
/**
 * 企业版客户名称、备注长度上限（11-02）：名称 200、备注 2000。只看新建和这次改动了的——导进来的老数据里有超长的（3702 最长名称 130 字），
 * 没动它就照存，不因为改了别的格被挡
 */
const 客户名称上限 = 200;
const 客户备注上限 = 2000;
function 企业版客户太长(叫法: string, 交: { name?: string | null; remark?: string | null }, 原: { name: string; remark: string | null } | null): string | null {
  if (!企业版()) return null;
  const 名 = 交.name?.trim() ?? "";
  if (交.name != null && 名 !== (原?.name ?? "") && 名.length > 客户名称上限) return `${叫法}名称最多 ${客户名称上限} 个字`;
  const 备 = 交.remark?.trim() ?? "";
  if (交.remark != null && 备 !== (原?.remark ?? "") && 备.length > 客户备注上限) return `备注最多 ${客户备注上限} 个字`;
  return null;
}

/**
 * 企业版主表新几格（迁移 072）：简称、地址、分配方式、客户类型、客户属性、业务线。没交的格不进结果（不写、不比对）。
 * 字典格（分配方式 custAssign、客户类型 custType 迁移 092、客户属性 custAttr 迁移 104）：得是字典里启用中的一项，
 * 原值停用了（10-31 换过一套）原样交回也认
 */
async function 规整企业资料(
  交: Partial<企业客户资料>,
  改前: { assignWay: string | null; customerType: string | null; customerAttr: string | null } | null,
): Promise<{ ok: true; 值: Partial<企业客户资料> } | { ok: false; error: string }> {
  let 企资料: Partial<企业客户资料> = {};
  if (交.shortName !== undefined) {
    const 简 = (交.shortName ?? "").trim().replace(/\s+/g, " ") || null;
    if (简 && 简.length > 简称上限) return { ok: false, error: `客户简称最多 ${简称上限} 个字` };
    企资料.shortName = 简;
  }
  if ((["addrCountry", "addrProvince", "addrCity", "addrDistrict"] as const).some((k) => 交[k] !== undefined)) {
    const 址 = 规整地址(交);
    if (!址.ok) return { ok: false, error: 址.error };
    企资料 = { ...企资料, ...址.值 };
  }
  if (交.addrDetail !== undefined) {
    const 详 = 规整详细地址(交.addrDetail);
    if (!详.ok) return { ok: false, error: 详.error };
    企资料.addrDetail = 详.值;
  }
  for (const [格, 字典, 叫法] of [["assignWay", "custAssign", "客户分配"], ["customerType", "custType", "客户类型"], ["customerAttr", "custAttr", "客户属性"]] as const) {
    const 交的 = 交[格];
    if (交的 === undefined) continue;
    const v = (交的 ?? "").trim() || null;
    if (v && v !== 改前?.[格] && !(await 可选项(字典)).includes(v)) return { ok: false, error: `${叫法}「${v}」不在可选范围内，请刷新后重选` };
    企资料[格] = v;
  }
  // 业务线（迁移 106）：只认内贸 / 外贸 / 暂不分配；空的在 saveCustomer 里拦（M-必填-13）
  if (交.bizLine !== undefined) {
    const 线 = 认业务线(交.bizLine);
    if (线 === undefined) return { ok: false, error: 业务线不认得 };
    企资料.bizLine = 线;
  }
  return { ok: true, 值: 企资料 };
}

export async function saveCustomer(input: CustomerInput, 接着?: unknown): Promise<SaveCustomerResult> {
  const me = await requireUser();
  // 名字只有空格不收（第二轮 r2-data：原来存出一条没有名字的）
  if (!hasVisibleText(input.name)) return { ok: false, error: "请填写姓名" };
  const b = await getBusiness();
  const labels = customerFieldLabels(b);

  const 改前 = input.id ? await prisma.customer.findUnique({ where: { id: input.id } }) : null;
  if (input.id && !改前) return { ok: false, error: `这条${b.customer}已经不在了（可能已删除），无法保存` };
  const 太长 = 企业版客户太长(b.customer, { name: input.name, remark: input.remark }, 改前);
  if (太长) return { ok: false, error: 太长 };
  // 团队互看：同事的客户读得到、改不了（lib/team-scope.ts），先说人话
  if (input.id && await 同事的客户(defaultClient, input.id)) return { ok: false, error: await 只读话(defaultClient) };
  const 改挡 = await 改客户挡(me, input.id);
  if (改挡) return { ok: false, error: 改挡 };
  // 编辑里换了负责人：同转让（只转自己的；管理、总管理随便转）
  if (改前 && input.salesOwnerId && input.salesOwnerId !== 改前.salesOwnerId) {
    const 转挡 = await 转让挡(me, [改前.id]);
    if (转挡) return { ok: false, error: 转挡 };
  }
  // 来源选的是「只有主渠道」的占位（没有子渠道的主渠道）：先落成子渠道名留空的那条渠道，后面一律按真的渠道 id 走（channel-main.ts 落到渠道）
  if (企业版() && 是主渠道入口(input.channelId)) {
    const 落 = await 落到渠道(input.channelId, me);
    if (!落.ok) return { ok: false, error: 落.error };
    input = { ...input, channelId: 落.id };
  }
  /*
    编辑之前先把老签约的「签约那一刻是谁的」钉住（排查 X1）。不只换负责人：改来源渠道 / 推荐人也会重算渠道负责人（复查 R）。
    没有缺的时候它只是一次很轻的查询，所以编辑一律先调，不去猜这次会不会动到归属
  */
  if (改前) await 钉住老签约();

  /*
    企业版建档选了号码类型的（2026-10-26，测试清单 B2–B8）：先按类型验格式，再全公司查重（客户、联系人、旺旺号都比），
    撞了照对方系统的提示原文挡下。选的是手机号就当电话用（下面电话那套照走）；选别的类型的，这位可以没有电话。
    开关关着这段整个不走：交了 企业号码 也不看，电话照旧必填
  */
  const 企号 = 企业版() && !改前 && input.企业号码 ? 验号码(input.企业号码.类型, input.企业号码.值) : null;
  if (企号 && !企号.ok) return { ok: false, error: 企号.提示 };
  if (企号) {
    const 结论 = await 企业号码查重(prisma, 企号, me.id, await 读的我(defaultClient));
    if (结论.状态 !== "首次录入") {
      const 协同 = await 同号再次录入(me, 企号, { 入口: "手工建档", 渠道id: input.channelId, 内容: input.remark });
      // 撞了有人在跟的：记撞号台账（P-挂靠-01），向导查重时记过的 10 分钟内并成一行
      const 撞 = 结论.状态 === "重复" ? await 号码撞上(me.id, await 读的我(defaultClient), 企号, 协同.走 ? "写进现有项目" : "拦截") : null;
      if (协同.走) return { ok: false, error: 协同.反馈, 同号协同: true };
      return { ok: false, error: 结论.提示, ...(撞 ? { 撞号: { 撞 } } : {}) };
    }
  }
  const 企号别的 = 企号?.ok === true && 企号.类型 !== "手机号";
  const 交的电话 = 企号?.ok && 企号.类型 === "手机号" ? 企号.值 : input.phone;

  /*
    电话：和导入、表单同一条规矩（lib/phone.ts）。新建必填；编辑时原来有号码的不许清空，
    原来就没有的可以继续空着。**原样没动的号码不重新规整**——库里老数据的写法
    不该因为人改了一下备注就被悄悄换掉，留痕里平白多一条「手机号」。
  */
  // 共享区表单交回的是打码的样子：认回原号，当没改（排查 A2）
  /*
    外贸：电话空着、填了 WhatsApp 的，WhatsApp 号就当电话认人（二审：海外客户常常只有 WhatsApp，和导入同一条规矩）
  */
  const 填的电话 = !String(交的电话 ?? "").trim() && b.template === "trade" && typeof input.extra?.whatsapp === "string" && !input.extra.whatsapp.includes("*")
    ? input.extra.whatsapp
    : 交的电话;
  const 原号 = String(认回打码号(填的电话, 改前?.phone) ?? "").trim();
  /*
    外贸：电话、WhatsApp 都没有的，按邮箱认人（2026-10-07 拍板，lib/email-dedupe.ts）。没交 extra 的（别的入口）当邮箱没动，用库里那格
  */
  /*
    邮箱也没有、只有微信号的，按微信号认（2026-10-19 客户反馈「只知道微信号怎么办」，同 lib/email-dedupe.ts）
  */
  const 外贸 = b.template === "trade";
  const 改前档 = 改前 && 外贸 ? await prisma.customerExtra.findUnique({ where: { customerId: 改前.id }, select: { email: true, wechat: true, alibabaId: true } }) : null;
  const 改前邮箱 = 改前档?.email ?? "";
  const 改前微信 = 改前档?.wechat ?? "";
  const 改前阿里 = 改前档?.alibabaId ?? "";
  const 交的 = (k: "email" | "wechat" | "alibabaId", 原: string) =>
    !外贸 ? "" : input.extra && k in input.extra && input.extra[k] !== undefined ? String(input.extra[k] ?? "").trim() : 原;
  const 交的邮箱 = 交的("email", 改前邮箱);
  const 交的微信 = 交的("wechat", 改前微信);
  // 阿里国际站 ID（2026-10-21）：电话、WhatsApp、邮箱、微信都没有的，按它认。交来的按存的样子规整（去「Buyer ID:」前缀），比的才对得上
  const 交的阿里 = (() => { const r = 规整阿里ID(交的("alibabaId", 改前阿里)); return r.ok ? r.v ?? "" : ""; })();
  const 按邮箱认 = 外贸 && !原号 && Boolean(交的邮箱);
  const 按微信认 = 外贸 && !原号 && !交的邮箱 && Boolean(交的微信);
  const 按阿里认 = 外贸 && !原号 && !交的邮箱 && !交的微信 && Boolean(交的阿里);
  const 电话 = 改前 && 原号 === 改前.phone ? { ok: true as const, phone: 改前.phone } : 查电话(原号, { 必填: 改前 ? Boolean(改前.phone) : !按邮箱认 && !按微信认 && !按阿里认 && !企号别的 });
  if (!电话.ok) return { ok: false, error: 外贸 && !改前 && !原号 ? 外贸至少一种 : 电话.error };
  const phone = 电话.phone;
  // 按邮箱 / 微信认的那位（没有电话）把两样都清空，就再也认不出是谁了：不许，和「原来有号码的不许清空」同一条
  if (外贸 && 改前 && !phone && (改前邮箱 || 改前微信 || 改前阿里) && !交的邮箱 && !交的微信 && !交的阿里) {
    return { ok: false, error: 改前邮箱
      ? "这位没有电话，是按邮箱认的：邮箱不能清空（或者先补上电话 / WhatsApp / 微信）"
      : 改前微信
        ? "这位没有电话，是按微信认的：微信不能清空（或者先补上电话 / WhatsApp / 邮箱）"
        : "这位没有电话，是按阿里 ID 认的：阿里 ID 不能清空（或者先补上电话 / WhatsApp / 邮箱 / 微信）" };
  }

  // 企业版老表单没选号码类型（不带 企业号码）：填的号挨个问一遍，撞到有人在跟的同样进项目组协同，别的落回下面的查重
  if (企业版() && !改前 && !input.企业号码) {
    const 这些号 = [验号码("手机号", phone ?? ""), 验号码("邮箱", 交的邮箱), 验号码("微信", 交的微信), 验号码("旺旺ID", 交的阿里)];
    for (const 号 of 这些号) {
      if (!号.ok) continue;
      const 协同 = await 同号再次录入(me, 号, { 入口: "手工建档", 渠道id: input.channelId, 内容: input.remark });
      if (协同.走) return { ok: false, error: 协同.反馈, 同号协同: true };
    }
  }

  // 服务端再查一次重：表单上的提示只是给人看的，不能作为约束。
  // 空电话不查：两个都没留电话的人不是同一个人（原来这里会拿 "" 去比，没电话的人一个都存不了）
  /*
    编辑时号码原样没动的不查（R-067，2026-10-04）：查重改成按号键比之后，老库里本来就重了的两份
    （「138 0000 1111」和「13800001111」）会互相挡着，谁都改不了备注。号码没动就没有新添重复
  */
  // 看全部：业务员把自己客户的号改成同事客户的号，原来这里只看得到自己的、查不出来，悄悄存成两份同号档案
  const 撞别人 = async (条件: () => Promise<Prisma.CustomerWhereInput>, 说法: string) => {
    const dup = await 看全部(async () => prisma.customer.findFirst({
      where: { AND: [await 条件(), ...(input.id ? [{ id: { not: input.id } }] : [])] },
      select: 撞到的字段,
    }));
    return dup ? 撞号说法(说法, dup, await 读的我(defaultClient), b.customer) : null;
  };
  if (phone && !(改前 && phone === 改前.phone)) {
    const 撞 = await 撞别人(async () => 同号条件(prisma, phone, await 分机留存起()), `手机号 ${phone}`);
    if (撞) return { ok: false, error: 撞 };
  }
  // 按邮箱认的：邮箱没动的不查（同上面号码没动不查）。有电话的不拿邮箱挡——同一公司几位联系人共用 info@ 常见
  const 查邮箱 = 按邮箱认 && !phone && !(改前 && 邮箱键(交的邮箱) === 邮箱键(改前邮箱));
  if (查邮箱) {
    const 撞 = await 撞别人(() => 同邮箱条件(prisma, 交的邮箱), `邮箱 ${交的邮箱}`);
    if (撞) return { ok: false, error: 撞 };
  }
  // 按微信认的：同上，微信号没动的不查；有电话或邮箱的不拿微信挡
  const 查微信 = 按微信认 && !phone && !(改前 && 邮箱键(交的微信) === 邮箱键(改前微信));
  if (查微信) {
    const 撞 = await 撞别人(() => 同微信条件(prisma, 交的微信), `微信 ${交的微信}`);
    if (撞) return { ok: false, error: 撞 };
  }
  // 按阿里 ID 认的：同上，没动的不查；有电话、邮箱或微信的不拿阿里 ID 挡
  const 查阿里 = 按阿里认 && !phone && !(改前 && 邮箱键(交的阿里) === 邮箱键(改前阿里));
  if (查阿里) {
    const 撞 = await 撞别人(() => 同阿里条件(prisma, 交的阿里), `阿里 ID ${交的阿里}`);
    if (撞) return { ok: false, error: 撞 };
  }

  /*
    跨成员查重（2026-10-19 用户拍板）：范围同步下业务员电脑上只有本人 + 公海，同事名下的号码上面查不到。
    本机没撞的再问一下服务端（号码 / 邮箱 / 微信号的哈希，规则同上面：有电话只按电话）；断网、没开团队版当没撞
  */
  const 问的: [查重种类, string, string] | null = phone && !(改前 && phone === 改前.phone) ? ["phone", phone, `手机号 ${phone}`]
    : 查邮箱 ? ["email", 交的邮箱, `邮箱 ${交的邮箱}`]
    : 查微信 ? ["wechat", 交的微信, `微信 ${交的微信}`]
    : 查阿里 ? ["alibaba", 交的阿里, `阿里 ID ${交的阿里}`]
    : null;
  if (问的) {
    const 撞 = await 问同事(问的[0], 问的[1], input.id);
    if (撞) return { ok: false, error: 同事撞号说法(问的[2], 撞.同事, 撞.客户名, b.customer) };
  }

  /*
    企业版新建按客户名（和公司）查重（2026-11-10，P-挂靠-01 / X-48）：和号码同一套，撞上有人在跟的客户拦下、露出负责人、记撞号台账；
    撞的是自己名下的只说「你名下已有」；公海、没负责人的不提示。第一期不做强录。编辑不查（改名不算新建）
  */
  if (企业版() && !改前) {
    const 名撞 = await 客户名查重(me.id, await 读的我(defaultClient), input.name, input.school);
    if (名撞) return { ok: false, error: 名撞说法(名撞, b.customer), 撞号: 名撞 };
  }

  // 推荐链不能成环。只挡「推荐人是自己」不够：A→B→A 两步就能绕过去
  if (input.id && input.referrerCustomerId) {
    if (input.referrerCustomerId === input.id) {
      return { ok: false, error: "推荐人不能是本人" };
    }
    if (await wouldCreateCycle(input.id, input.referrerCustomerId)) {
      return {
        ok: false,
        error: `该${b.customer}已经在这位推荐人的上游，这样设置会让推荐链成环，归属无法计算`,
      };
    }
  }

  const 状态错 = 跟进不对(input.followStatus) ?? 决策不对(input.decisionStatus);
  if (状态错) return { ok: false, error: 状态错 };
  /*
    客户状态跟着项目自动算（10-30，lib/enterprise/cust-status-auto-db.ts，企业版 + 项目模式）：表单交来的不认。
    新建先空着（建档向导建好项目后同一笔事务里算），编辑不进 data（不写、不比对、不留痕）
  */
  const 状态自动 = 企业版() && (await 客户状态自动());
  const 企客状态 = 状态自动 ? (改前 ? null : { 值: null }) : 企业版() ? await 定客户状态(input.custStatus, 改前?.custStatus ?? null, !改前) : null;
  if (企客状态 && "error" in 企客状态) return { ok: false, error: 企客状态.error };
  /*
    企业版来源只认渠道（2026-10-28）：原来有渠道的不许清空；换了渠道，新渠道得是启用中的。
    新建走建档向导，那边已经必选渠道；别的入口（AI 建档、找客）没渠道的照旧放行
  */
  if (企业版() && 改前 && 改前.channelId && !input.channelId && !input.referrerCustomerId) {
    return { ok: false, error: "请选择渠道" };
  }
  /*
    渠道触点（P-渠道-08）：只认公司资源 / 客户介绍；不交 = 照原样。原来有渠道或触点的，编辑后两样都空拦下（主渠道和触点至少填一个）。
    新建的「至少一个」由表单和建档向导管，别的入口（AI 建档、找客）照旧放行
  */
  const 交的触点 = 企业版() && input.touchpoint !== undefined ? 认渠道触点(input.touchpoint) : undefined;
  if (企业版() && input.touchpoint !== undefined && 交的触点 === undefined) {
    return { ok: false, error: `渠道触点只能是 ${渠道触点们.join(" / ")}` };
  }
  /*
    触点也是来源（P-删-03，11-10）：公司资源 / 客户介绍这两类的来源记在触点上，和主渠道一样建好就锁——
    原来空着的可以补一次，有值的不许换、不许清（系统管理员也一样）；不交 = 照原样
  */
  if (企业版() && 改前?.touchpoint && 交的触点 !== undefined && 交的触点 !== 改前.touchpoint) {
    return { ok: false, error: "客户来源（渠道触点）记的是第一次的来源，建好之后不能改" };
  }
  const 存后触点 = 交的触点 !== undefined ? 交的触点 : (改前?.touchpoint ?? null);
  /*
    交了推荐人的，主渠道由推荐链顶算（同上面「请选择渠道」那条）；算完换掉 / 清空来源的由后面来源锁的最后一道拦
  */
  if (企业版() && 改前 && (改前.channelId || 改前.touchpoint) && !input.channelId && !存后触点 && !input.referrerCustomerId) {
    return { ok: false, error: "请选择渠道或渠道触点" };
  }
  /*
    客户来源 = 第一次的渠道（定稿 P5 第 22 条：「客户来源只记第一个渠道，之后不变」）：原来有渠道的，换成别的渠道不收。
    后来又从别的渠道来的，记在项目的来源上（P6），客户这一格不跟着变
  */
  if (企业版() && 改前?.channelId && input.channelId && input.channelId !== 改前.channelId) {
    return { ok: false, error: "客户来源记的是第一次带来的渠道，建好之后不能改" };
  }
  if (企业版() && input.channelId && input.channelId !== 改前?.channelId) {
    const 渠道 = await prisma.channel.findUnique({ where: { id: input.channelId }, select: { active: true } });
    if (!渠道?.active) return { ok: false, error: "这个渠道不存在或已停用，请换一个" };
  }
  /*
    共享试用区里 WhatsApp 和电话一样是打了码给人看的：交回来还带着 * 就是没动它，不碰这一格（同电话的 认回打码号）
  */
  const 交的档案原 = input.extra && typeof input.extra.whatsapp === "string" && input.extra.whatsapp.includes("*") ? { ...input.extra, whatsapp: undefined } : input.extra;
  // WhatsApp 填占位假号（P-全局-06）：拦下、叫人填真实号码；库里原样没动的老号照存
  const 交的瓦 = typeof 交的档案原?.whatsapp === "string" ? 交的档案原.whatsapp.trim() : "";
  if (交的瓦 && 是占位号(交的瓦)) {
    const 原瓦 = 改前 ? (await prisma.customerExtra.findUnique({ where: { customerId: 改前.id }, select: { whatsapp: true } }))?.whatsapp : null;
    if (交的瓦 !== String(原瓦 ?? "").trim()) return { ok: false, error: 占位号提示("WhatsApp") };
  }
  /*
    企业版客户级别只剩 S / A / B / C（定稿 P5 第 23 条）：还是存 CustomerExtra.level，但不走外贸那套 A–D 的校验，
    先在这里按企业版的四档认好，再并回档案
  */
  const 企级别 = 企业版() && 交的档案原 && 交的档案原.level !== undefined ? 认企业级别(交的档案原.level) : undefined;
  if (企业版() && 交的档案原 && 交的档案原.level !== undefined && 企级别 === undefined) return { ok: false, error: "客户级别只能是 S / A / B / C" };
  const 交的档案 = 企业版() && 交的档案原 && 交的档案原.level !== undefined ? { ...交的档案原, level: undefined } : 交的档案原;
  const 档案原 = 规整外贸档案(交的档案 ? { ...交的档案, ...(交的档案.country !== undefined ? { country: 认国家(交的档案.country) } : {}) } : null);
  if (!档案原.ok) return { ok: false, error: 档案原.error };
  const 档案 = 企级别 !== undefined ? { ...档案原, data: { ...档案原.data, level: 企级别 } } : 档案原;

  const 企资料结果 = 企业版() && input.企业资料 ? await 规整企业资料(input.企业资料, 改前) : null;
  if (企资料结果 && !企资料结果.ok) return { ok: false, error: 企资料结果.error };
  const 企资料 = 企资料结果?.值 ?? {};
  /*
    客户业务线必填（M-必填-13，11-11）：新建一律要有（向导按首个项目的业务线带过来，见 projects/actions.ts）；
    编辑只在交了这一格时看——交上来是空的就拦（清空、或老客户本来空着在编辑框里保存，都要补上）。
    没交这一格的（就地改别的格、列表行打开的编辑框、别的入口）不看：存量空着的不因此存不了别的格
  */
  if (企业版() && !企资料.bizLine && (!改前 || input.企业资料?.bizLine !== undefined)) return { ok: false, error: 客户业务线必填 };

  /**
   * 归属字段什么时候重算。
   *
   * 新建：按推荐链算。
   * 更新：**只在推荐链的输入（来源渠道 / 推荐人）变了才重算**，否则原样保留。
   * 原来每次保存都重算——去掉渠道级联之后，只要有人改一下备注，这里就会从
   * （已经换了人的）渠道重新算一遍，学员照样静默换主，等于级联从后门溜回来。
   * 规则和渠道那边一致：没动他的推荐链，他的归属就不动。
   */
  /*
    有推荐人时，channelId 是从推荐链顶端继承的派生值（attribution.ts），只比推荐人；
    表单在「已有客户」那一档不回传渠道，拿 null 去比库里的链顶渠道，会把没动的人判成「变了」。
  */
  const 推荐链变了 =
    !改前 ||
    (input.referrerCustomerId
      ? 改前.referrerCustomerId !== input.referrerCustomerId
      : 改前.referrerCustomerId !== null || 改前.channelId !== input.channelId);
  const attribution = 推荐链变了
    ? await resolveAttribution({ channelId: input.channelId, referrerCustomerId: input.referrerCustomerId })
    : {
        channelId: 改前!.channelId,
        attributionChannelId: 改前!.attributionChannelId,
        attributionCustomerId: 改前!.attributionCustomerId,
        channelOwnerId: 改前!.channelOwnerId,
      };
  /*
    有触点、没交渠道的（公司资源 / 客户介绍，P-渠道-08）：主渠道留空，不从介绍人那边继承渠道；介绍人、渠道负责人照推荐链算
  */
  if (企业版() && 存后触点 && !input.channelId && 推荐链变了) attribution.channelId = null;
  /*
    来源锁的最后一道（P-删-03，11-10）：上面只比了交来的 channelId；换推荐人时 channelId 是推荐链顶端算出来的，
    原来有来源的客户换个推荐人（或推荐链顶没渠道）就会把来源换掉 / 清空。算完再比一次，有值就不许变（系统管理员也一样）
  */
  if (企业版() && 改前?.channelId && attribution.channelId !== 改前.channelId) {
    return { ok: false, error: "客户来源记的是第一次带来的渠道，建好之后不能改" };
  }
  // 显式指定压过推荐链：登记错误的单个订正走这里。null 表示清掉手工值、按推荐链重算
  if (input.channelOwnerId !== undefined) {
    if (input.channelOwnerId) {
      if (!(await 在职(input.channelOwnerId))) return { ok: false, error: "渠道负责人不存在或已停用" };
      attribution.channelOwnerId = input.channelOwnerId;
    } else {
      const 重算 = await resolveAttribution({ channelId: input.channelId, referrerCustomerId: input.referrerCustomerId });
      attribution.channelOwnerId = 重算.channelOwnerId;
    }
  }

  // 企业版普通销售新建的客户只能记在自己名下（10-27 会议，lib/enterprise/import-perm.ts），不看表单传来的
  const salesOwnerId = !input.id && (await 新建只给自己(me)) ? me.id : input.salesOwnerId || (await 唯一负责人());
  if (!salesOwnerId) return { ok: false, error: "请选择销售负责人" };
  // 换了负责人才查（老客户挂在没角色的人名下，改别的字段不拦）。11-03 完成度 D3-9
  if (salesOwnerId !== 改前?.salesOwnerId) {
    const 不行 = await 不能当负责人(salesOwnerId);
    if (不行) return { ok: false, error: 不行 };
  }

  const sign = parseSignDate(input.expectedSignAt, 改前 ?? undefined);
  if (!sign) return { ok: false, error: "日期格式不对或日期不存在" };
  const data = {
    name: input.name.trim(),
    phone,
    school: input.school?.trim() || null,
    grade: input.grade || null,
    major: input.major?.trim() || null,
    followStatus: input.followStatus,
    decisionStatus: input.decisionStatus,
    // 开关关着这一格不进 data：不写、也不参与比对和留痕
    ...(企客状态 ? { custStatus: 企客状态.值 } : {}),
    ...企资料,
    expectedSignAt: sign.at,
    expectedSignOn: sign.on,
    remark: input.remark?.trim() || null,
    salesOwnerId,
    referrerCustomerId: input.referrerCustomerId,
    ...attribution,
    // 开关关着、没交这一格不进 data：不写、也不参与比对和留痕
    ...(交的触点 !== undefined ? { touchpoint: 交的触点 } : {}),
  };

  // 企业版字段权限（规则没开不读库）：编辑时动了「只能看」的字段就拒；新建不拦，电话是必填的
  if (改前) {
    const 同 = (a: unknown, b: unknown) => (a instanceof Date ? a.getTime() : a ?? "") === (b instanceof Date ? b.getTime() : b ?? "");
    const 动了 = Object.entries(客户列字段).flatMap(([列, 名]): 字段名[] =>
      列 in data && !同((data as Record<string, unknown>)[列], (改前 as Record<string, unknown>)[列]) ? [名] : []);
    if (档案.data.whatsapp !== undefined) {
      const 原 = await prisma.customerExtra.findUnique({ where: { customerId: 改前.id }, select: { whatsapp: true } });
      if (!同(档案.data.whatsapp, 原?.whatsapp)) 动了.push("电话");
    }
    const 挡 = await 挡字段(me.id, 动了);
    if (挡) return { ok: false, error: 挡 };
  }
  /*
    编辑里负责人本人转自己的（申请移交，X-20、P-转-16）：不看「交接要确认」开关；上级、系统管理员直接转（P-转-01 ②③④）。
    负责人这一格先按原样存，别的格照存；存完再发起交接，接手人确认后才换（带走 / 通知都在确认那一步）。
    市场成员的客户转给销售不走确认（P-转-17），当场换、只发分给你通知
  */
  const 换人 = !!(改前 && input.id && salesOwnerId !== 改前.salesOwnerId);
  if (换人 && input.id) {
    const 验 = await 验证中挡([input.id], salesOwnerId);
    if (验) return { ok: false, error: 验 };
  }
  const 走法 = 换人 && input.id ? await 转让走交接(me, salesOwnerId, [input.id]) : null;
  const 交接给 = 走法 ? salesOwnerId : null;
  if (交接给 && 改前?.salesOwnerId) data.salesOwnerId = 改前.salesOwnerId;
  const 发起交接 = async () => (交接给 && input.id ? 交接结果(await 发起转让交接(me, [input.id], 交接给, 0, null, 走法 === "申请")) : {});
  if (!交接给 && 换人 && input.id) {
    const 中 = await 移交中挡([input.id], salesOwnerId);
    if (中) return { ok: false, error: 中 };
    const 超 = await 接待分配超上限([input.id], salesOwnerId);
    if (超) return { ok: false, error: 超 };
  }

  if (!input.id) {
    /*
      上面那次查重和建档之间有缝：两个窗口同时点「保存」，两边都查不到对方、都建进去，同号两份档案。
      建档这一步在事务里再查一次（2026-10-04 J-104，lib/check-then-write.ts）。
      看全部：团队版业务员录到同事已有的号码也要挡，和线索转客户同一条（上面那次查重只看得到自己的）
    */
    const 起 = await 分机留存起();
    const 建了 = await 查完再写(async (tx) => {
      if (phone) {
        const dup = await 看全部(async () => tx.customer.findFirst({ where: await 同号条件(tx, phone, 起), select: 撞到的字段 }));
        if (dup) return { 撞号: dup } as const;
      } else if (查邮箱) {
        const dup = await 看全部(async () => tx.customer.findFirst({ where: await 同邮箱条件(tx, 交的邮箱), select: 撞到的字段 }));
        if (dup) return { 撞号: dup } as const;
      }
      // 企业版选了号码类型的：事务里再全公司比一次（同上，两个窗口同时建）
      if (企号) {
        const ids = await 全公司查号(tx, 企号.类型, 企号.值, 企号.键);
        if (ids.length) return { 企撞: ids } as const;
      }
      const created = await tx.customer.create({ data });
      await 写外贸档案(tx, created.id, { ...档案.data, ...(企号?.类型 === "邮箱" ? { email: 企号.值 } : 企号?.类型 === "微信" ? { wechat: 企号.值 } : {}) }, false);
      if (企号) await 记号码(tx, { 刚建的: created.id }, null, 企号);
      if (认得(接着)) await 接着(tx, created.id);
      // M-公海-14：企业版项目模式下新客户至少带 1 个潜客培育项目（向导已建了项目的不补；老数据不补）
      if (要补潜客培育(企业版(), b.projectMode)) await 补潜客培育(tx, { customerId: created.id, 客户名: created.name, ownerId: created.salesOwnerId, creatorId: me.id });
      return { created } as const;
    });
    if ("企撞" in 建了 && 建了.企撞) return { ok: false, error: (await 撞号结论(prisma, 建了.企撞, me.id, await 读的我(defaultClient))).提示 };
    if ("撞号" in 建了 && 建了.撞号) return { ok: false, error: await 撞号说法(phone ? `手机号 ${phone}` : `邮箱 ${交的邮箱}`, 建了.撞号, await 读的我(defaultClient), b.customer) };
    const { created } = 建了;
    await recordAudit({
      user: me, action: "create", entity: "Customer", entityId: created.id,
      summary: `新建${b.customer}「${created.name}」`,
    });
    // 建好就归了别人：告诉接手人。建档向导那条路（带 接着）它自己发，带上项目名，这里不重复
    if (!认得(接着)) await 分给你通知(me, created.salesOwnerId, [created.id]);
    revalidateCustomer();
    return { ok: true, id: created.id };
  }

  /** 记录这次改了哪几项、前后各是什么 */
  const 记一笔 = async (keys: string[], before: Record<string, unknown>, 合并 = false) => {
    if (!keys.length) return;
    await recordAudit({
      user: me, action: "update", entity: "Customer", entityId: input.id!,
      summary: `修改${b.customer}「${data.name}」：${keys.map((k) => labels[k] ?? k).join("、")}` +
        (合并 ? "（已自动合并较新的改动）" : ""),
      detail: describeCustomerChanges(keys, before, data as Record<string, unknown>, labels),
    });
  };

  /**
   * 乐观锁：把打开表单那一刻的 updatedAt 也放进 where。
   * 期间有人改过这条记录，updatedAt 已经变了，匹配不到、影响 0 行，
   * 于是这次提交被拒绝而不是把对方的改动整体盖掉。
   * 用 updateMany 而不是「先查再比再写」，是为了让判断和写入落在同一条语句里，
   * 中间没有可以被插进来的窗口。
   */
  const expected = input.updatedAt ? new Date(input.updatedAt) : null;
  if (!expected || Number.isNaN(expected.getTime())) {
    return { ok: false, error: "缺少记录版本信息，请刷新页面后重新编辑" };
  }

  /**
   * 版本号必须严格递增。
   * updatedAt 只精确到毫秒，两次保存恰好落在同一毫秒时它不会变，
   * 旧版本号会再次匹配成功，闸门就形同虚设了。
   * 用 max(now, 旧版本+1) 显式往前推一格，杜绝这种情况——
   * 闸门匹配成功即说明当前值就是 expected，所以这个新值一定更大。
   */
  const bump = (from: Date) => new Date(Math.max(Date.now(), from.getTime() + 1));

  // 留痕要对比前后值；改前 在上面算归属时已经取过一份
  const first = await prisma.customer.updateMany({
    where: { id: input.id, updatedAt: expected },
    data: { ...data, updatedAt: bump(expected) },
  });
  if (first.count === 1) {
    const 改前行 = 改前 as unknown as Record<string, unknown>;
    await 记一笔(diffKeys(改前行, data as Record<string, unknown>), 改前行);
    await 改外贸档案(me, input.id, data.name, 档案.data, b.customer);
    const 带 = 改前 && 改前.salesOwnerId !== data.salesOwnerId
      ? await 带走并记下([{ customerId: input.id, 旧: 改前.salesOwnerId }], data.salesOwnerId, me.id)
      : undefined;
    const 带走 = 带?.数;
    if (改前 && 改前.salesOwnerId !== data.salesOwnerId && !带走?.没转成) await 分给你通知(me, data.salesOwnerId, [input.id], undefined, 带?.留下);
    revalidateCustomer(input.id);
    await 客户存了推项目(me, input.id);
    return { ok: true, id: input.id, 带走, ...(await 发起交接()) };
  }

  /**
   * 闸门没过，说明这期间有人动过这条记录。但「动过」不等于「撞车」——
   * 对方可能改的是别的字段，甚至只是给这个学员录了条跟进。
   * 拿 base 快照算清楚双方各改了什么，没交集就直接合并，别打扰用户。
   *
   * 循环是因为合并本身也要过闸门：极端情况下刚读完又被人改了，
   * 重来一次即可，几轮拿不下就老实报冲突。
   */
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await prisma.customer.findUnique({ where: { id: input.id } });
    if (!current) {
      return { ok: false, error: `这条${b.customer}已经不在了（可能已删除），无法保存` };
    }
    const currentRow = current as unknown as Record<string, unknown>;

    // 没有 base 就退回保守行为：只要库里现值和提交值对不上就拦
    if (!input.base) {
      const fields = conflictingFields(currentRow, data, b);
      return {
        ok: false,
        error: `这条${b.customer}在你打开编辑框之后又变过了，本次保存已取消`,
        conflict: { currentUpdatedAt: current.updatedAt.toISOString(), fields, theirFields: fields },
      };
    }

    // 共享区打开表单时看到的号码是打了码的：快照里的也认回原号，不然一碰上并发就误报「你们都改了手机号」（排查 A2）
    const baseRow = { ...input.base, phone: 认回打码号(input.base.phone, 改前?.phone) } as unknown as Record<string, unknown>;
    const theirs = diffKeys(baseRow, currentRow);
    const 改了推荐链 = diffKeys(baseRow, data).some((k) => (REFERRER_KEYS as readonly string[]).includes(k));
    /*
      渠道负责人是派生值：没动推荐链、也没单独订正时，data 里那一格是从库里现值抄来的（上面「原样保留」那支），
      拿它和 base 比会把同事刚改的值算成「我改的」，于是我只改备注也被判「两边都动了：渠道负责人」。
      只有我真动了它（显式订正 / 改推荐链连带重算）才算我的（2026-10-04 L-048）
    */
    const mine = diffKeys(baseRow, data).filter(
      (k) => k !== "channelOwnerId" || input.channelOwnerId !== undefined || 改了推荐链,
    );
    const overlap = mine.filter((k) => theirs.includes(k));

    if (overlap.length) {
      return {
        ok: false,
        error: `这条${b.customer}在你打开编辑框之后又变过了，本次保存已取消`,
        conflict: {
          currentUpdatedAt: current.updatedAt.toISOString(),
          fields: labelsOf(overlap, b),
          theirFields: labelsOf(theirs, b),
        },
      };
    }

    // 我什么都没改，写下去也是原样，直接当成功（外贸档案在旁表，不过这道闸，照改）
    if (!mine.length) {
      await 改外贸档案(me, input.id, data.name, 档案.data, b.customer);
      await 客户存了推项目(me, input.id);
      return { ok: true, id: input.id, ...(await 发起交接()) };
    }

    // 只写我改动的那几个字段，对方改的原样保留
    const patch: Record<string, unknown> = {};
    for (const k of mine) patch[k] = (data as Record<string, unknown>)[k];
    if (mine.includes("expectedSignAt")) patch.expectedSignOn = data.expectedSignOn;
    // 推荐人一变，归属三件套要跟着走，不能只写推荐人本身
    if (mine.some((k) => (REFERRER_KEYS as readonly string[]).includes(k))) {
      for (const k of ATTRIBUTION_KEYS) patch[k] = (data as Record<string, unknown>)[k];
    }
    // 单独订正的渠道负责人不在 base 快照里，diffKeys 看不见它，要显式带上
    if (input.channelOwnerId !== undefined) patch.channelOwnerId = data.channelOwnerId;

    const merged = await prisma.customer.updateMany({
      where: { id: input.id, updatedAt: current.updatedAt },
      data: { ...patch, updatedAt: bump(current.updatedAt) },
    });
    if (merged.count === 1) {
      await 记一笔(mine, currentRow, true);
      await 改外贸档案(me, input.id, data.name, 档案.data, b.customer);
      const 带 = mine.includes("salesOwnerId")
        ? await 带走并记下([{ customerId: input.id, 旧: current.salesOwnerId }], data.salesOwnerId, me.id)
        : undefined;
      const 带走 = 带?.数;
      if (mine.includes("salesOwnerId") && current.salesOwnerId !== data.salesOwnerId && !带走?.没转成) await 分给你通知(me, data.salesOwnerId, [input.id], undefined, 带?.留下);
      revalidateCustomer(input.id);
      await 客户存了推项目(me, input.id);
      return { ok: true, id: input.id, 带走, ...(await 发起交接()) };
    }
  }

  return {
    ok: false,
    error: `这条${b.customer}正在被频繁修改，本次保存已取消，请刷新后重试`,
  };
}

/**
 * 编辑客户时外贸档案那几格：和库里现值比，只写变了的、留一条痕。
 * 在旁表里，不进客户那道版本号闸门——五格各自独立，两个人同时改不同的格互不影响；改同一格后写的为准
 */
async function 改外贸档案(me: { id: string; name: string }, id: string, 名: string, 改: Partial<外贸档案>, 叫: string) {
  if (!Object.keys(改).length) return;
  /*
    看全部（二审）：这一步在客户主表存完之后——业务员同一次把负责人改成了同事，这时他已经看不到这位客户，
    限定层下读档案拿到空、再按空补齐写回去，其余几格就被清掉了；推 updatedAt 也会因为看不到而报错。
    能走到这里说明保存前他看得到这位、这次改动是他做的
  */
  const 原 = await 看全部(() => prisma.customerExtra.findUnique({ where: { customerId: id } }));
  const 变了 = (Object.keys(改) as (keyof 外贸档案)[]).filter((k) => (原?.[k] ?? null) !== (改[k] ?? null));
  if (!变了.length) return;
  await 看全部(() => 写外贸档案(prisma, id, Object.fromEntries(变了.map((k) => [k, 改[k] ?? null]))));
  await recordAudit({
    user: me, action: "update", entity: "Customer", entityId: id,
    summary: `修改${叫}「${名}」：${变了.map((k) => 外贸字段名[k]).join("、")}`,
    detail: 变了.map((k) => ({ 字段: 外贸字段名[k], 原值: 原?.[k] ?? "（空）", 新值: 改[k] ?? "（空）" })),
  });
}

function revalidateCustomer(id?: string) {
  revalidatePath("/customers");
  if (id) revalidatePath(`/customers/${id}`);
  revalidatePath("/dashboard");
}

/** 管 = 企业版系统管理员（P-判定-03）：同事负责的项目也一起删，不挡 */
async function 删除依赖错误(db: Prisma.TransactionClient, ids: string[], 客户叫法: string, 管 = false): Promise<string | null> {
  const visible = await db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, salesOwnerId: true } });
  if (!visible.length) return null;
  // 企业版 P-删-10：转让交接等接手人确认的客户不能删（不然接手人确认时客户已在回收站）；系统管理员也一样，先撤回交接
  if (软删开着()) {
    const 中 = await 交接中的客户(visible.map((c) => c.id), db);
    if (中.size) {
      const 名 = visible.filter((c) => 中.has(c.id)).map((c) => `「${c.name}」`).join("、");
      return `${名}正在转让交接中（等接手人确认），不能删；要删先撤回交接${visible.length > 1 ? "，整批已阻止" : ""}`;
    }
  }
  // 企业版 P-删-05（11-05）：名下有同事负责、还没结束的项目先挡；结束了的跟着客户进回收站
  if (软删开着() && !管) {
    const 有 = await 有同事在推的客户(db, visible);
    if (有.size) return 同事在推不能删话(visible.filter((c) => 有.has(c.id)).map((c) => c.name), 客户叫法);
  }
  // 项目模式（2026-10-23）：级联会把项目连同节点变更一起删掉，挂着项目的客户先拦；没开过项目模式的工作区这里查出来永远是空。
  // 企业版删客户是进回收站（P9）：项目跟着客户一起进、一起回来，不拦
  const 项目数 = 软删开着() ? new Map<string, number>() : await 看全部(() => 客户的项目数(visible.map((c) => c.id), db));
  if (项目数.size) {
    const 说 = visible.filter((c) => 项目数.has(c.id)).map((c) => `「${c.name}」名下还有 ${项目数.get(c.id)} 个项目`);
    return 说.length === 1 && visible.length === 1
      ? `${说[0]}，先删项目再删${客户叫法}`
      : `${说.join("；")}，整批已阻止。先删项目再删${客户叫法}`;
  }
  // 已授权的父档案可能被不可见的下游引用；检查依赖但只返回所选父档案姓名。
  const blocked = await 看全部(() => db.customer.findMany({
    where: { id: { in: visible.map(c => c.id) }, OR: [{ referrals: { some: {} } }, { attributedCustomers: { some: {} } }] },
    select: { id: true },
  }));
  if (!blocked.length) return null;
  const idsBlocked = new Set(blocked.map(c => c.id));
  return `以下${客户叫法}仍是其他档案的推荐来源或业绩归属，删除会断开推荐链，整批已阻止：${visible.filter(c => idsBlocked.has(c.id)).map(c => c.name).join("、")}。请先调整下游档案的推荐人或业绩归属，再删除。`;
}

/** 企业版系统管理员删客户不看同事的项目（P-删-05 例外，P-判定-03） */
async function 删同事项目也行(me: { id: string; role?: string | null }): Promise<boolean> {
  return 企业版() && 是系统管理员(me, await 权限组织());
}

/** 要删的客户各自的负责人（看不到的不在里面，后面照旧按范围挡） */
async function 客户负责人们(ids: string[]): Promise<(string | null)[]> {
  return (await prisma.customer.findMany({ where: { id: { in: ids } }, select: { salesOwnerId: true } })).map((c) => c.salesOwnerId);
}

/** 先提示阻塞对象，避免让人走完不可恢复确认后才被拦。执行时仍在事务内再查。 */
export async function 客户删除预检(ids: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireUser();
  // 企业版：系统管理员；销售、销管、渠运删自己负责的（V3.5.1）
  const 挡 = await 删除挡(me, await 客户负责人们(ids));
  if (挡) return { ok: false, error: 挡 };
  const b = await getBusiness();
  // 虚线下属的客户：在「确认删除…不能恢复」之前就说清楚，不等删完报「已经在别处删掉了」
  const 虚线 = await 虚线只读挡(defaultClient, ids);
  if (虚线) return { ok: false, error: 虚线 };
  const error = await 删除依赖错误(prisma, ids, b.customer, await 删同事项目也行(me));
  return error ? { ok: false, error } : { ok: true };
}

class 客户删除阻塞 extends Error {}

export async function deleteCustomers(
  ids: string[],
): Promise<{ ok: true; deleted: number; 留下联系人: number } | { ok: false; error: string }> {
  const me = await requireUser();
  // 企业版：系统管理员；销售、销管、渠运删自己负责的（V3.5.1）
  const 挡 = await 删除挡(me, await 客户负责人们(ids));
  if (挡) return { ok: false, error: 挡 };
  const b = await getBusiness();
  if (!ids.length) return { ok: true, deleted: 0, 留下联系人: 0 };
  const 虚线 = await 虚线只读挡(defaultClient, ids);
  if (虚线) return { ok: false, error: 虚线 };

  /**
   * 被别人当作推荐人或渠道归属对象的学员不能删。
   * Prisma 在自引用关系上默认 SetNull，直接删会把下游的推荐链和业绩归属
   * 静默置空——数据看着还在，归属已经没了，且不会有任何报错。
   */
  const 管 = await 删同事项目也行(me);
  const dependencyError = await 删除依赖错误(prisma, ids, b.customer, 管);
  if (dependencyError) return { ok: false, error: dependencyError };

  // 删之前留个名字，删完就查不到了
  const 待删 = await prisma.customer.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, phone: true },
  });
  /*
    两个窗口几乎同时删同一位（或两批选中的有重叠）：两边都先读到了同一批联系人，后提交的那边在
    「搬进未归属」时撞上同一个 id（P2002），或删的时候那位已经没了——原来直接抛，界面上点了没反应（2026-10-04 第 2 期 2a）。
    整个事务回滚，什么都没写；按还在的那几位重来一次。一位都不在了就说一句
  */
  if (!待删.length) return { ok: false, error: `${ids.length > 1 ? "这几" : "这"}位${b.customer}已经在别处删掉了，刷新看看` };
  const 清点 = await 删除前清点(待删.map((c) => c.id));
  // 企业版（P9）：进回收站。联系人、项目、沟通记录记同一个时刻一起进，线索不动；30 天内能恢复
  if (软删开着()) {
    const 删了 = await prisma.$transaction(async (tx) => {
      const dependencyError = await 删除依赖错误(tx, 待删.map((c) => c.id), b.customer, 管);
      if (dependencyError) throw new 客户删除阻塞(dependencyError);
      return 软删客户(tx, 待删.map((c) => c.id));
    }).catch((e) => {
      if (e instanceof 客户删除阻塞) return e;
      throw e;
    });
    if (删了 instanceof 客户删除阻塞) return { ok: false, error: 删了.message };
    if (!删了) return { ok: false, error: `${ids.length > 1 ? "这几" : "这"}位${b.customer}已经在别处删掉了，刷新看看` };
    await recordAudit({
      user: me, action: "delete", entity: "Customer",
      entityId: 待删.length === 1 ? 待删[0].id : null,
      summary: `删除 ${删了} 名${b.customer}（进回收站，${回收站保留天数} 天内可恢复）：${待删.map((c) => c.name).join("、")}`,
      detail: { 客户: 待删, 一起进回收站的: 清点 },
    });
    revalidateCustomer();
    revalidatePath("/contacts");
    revalidatePath("/projects");
    return { ok: true, deleted: 删了, 留下联系人: 0 };
  }
  let 联系人: Awaited<ReturnType<typeof 搬走并删>>["联系人"] = [];
  let res: { count: number } = { count: 0 };
  for (let 第几次 = 0; ; 第几次++) {
    const 还在 = 第几次 === 0 ? 待删.map((c) => c.id) : (await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((c) => c.id);
    if (!还在.length) return { ok: false, error: `${ids.length > 1 ? "这几" : "这"}位${b.customer}已经在别处删掉了，刷新看看` };
    try {
      ({ 联系人, res } = await 搬走并删(还在, me.id, b.customer));
      break;
    } catch (e) {
      if (e instanceof 客户删除阻塞) return { ok: false, error: e.message };
      const code = (e as { code?: string } | null)?.code;
      if (第几次 >= 2 || (code !== "P2002" && code !== "P2025")) throw e;
    }
  }
  // 另一边的事务先提交了：这边进事务时那几位已经没了，什么都没删——照实说，不报「删了 0 位」
  if (!res.count) return { ok: false, error: `${ids.length > 1 ? "这几" : "这"}位${b.customer}已经在别处删掉了，刷新看看` };
  await recordAudit({
    user: me, action: "delete", entity: "Customer",
    entityId: 待删.length === 1 ? 待删[0].id : null,
    summary: `删除 ${res.count} 名${b.customer}：${待删.map((c) => c.name).join("、")}` +
      (联系人.length ? `（${联系人.length} 位联系人留在联系人页，未归属）` : ""),
    detail: { 客户: 待删, 一起删掉的: 清点 },
  });
  revalidateCustomer();
  revalidatePath("/contacts");
  return { ok: true, deleted: res.count, 留下联系人: 联系人.length };
}

/**
 * 联系人搬进未归属、线索退回、删客户——一个事务。
 * 联系人不跟着删，搬进「未归属」（2026-10-02 排查 B1，和 0.46.14「只移出」同一个道理：
 * 人还是那个人，客户这条档案没了不等于这个人没了）。外键是级联删的，所以先搬再删、在同一个事务里。
 * 跟进记录随客户一起删，所以不记 followUpIds。
 */
async function 搬走并删(ids: string[], ownerId: string, 客户叫法: string) {
  return prisma.$transaction(async (tx) => {
    const dependencyError = await 删除依赖错误(tx, ids, 客户叫法);
    if (dependencyError) throw new 客户删除阻塞(dependencyError);
    const 联系人 = await tx.contact.findMany({
      where: { customerId: { in: ids } },
      include: { customer: { select: { name: true } } },
    });
    for (const c of 联系人) {
      await tx.unassignedContact.create({
        data: {
          id: c.id, name: c.name, position: c.position, phone: c.phone, email: c.email, wechat: c.wechat, remark: c.remark,
          fromCustomerId: c.customerId, fromCustomerName: c.customer.name, createdAt: c.createdAt,
          wasPrimary: c.isPrimary,
          ownerId,
        },
      });
    }
    /*
      从线索转来的客户删了，线索退回「跟进中」、转化时间清掉（2026-10-04 L-014）。
      外键会把 customerId 置空，但状态原来还挂「已转化」：列表上又出现「转客户」按钮，两样说法打架，
      编辑框的状态下拉也对不上；再转一次还会覆盖转化时间。退到「跟进中」：转过一次说明是跟过的，不是待跟进。
    */
    await tx.lead.updateMany({
      where: { customerId: { in: ids } },
      data: { customerId: null, status: "跟进中", convertedAt: null },
    });
    const res = await tx.customer.deleteMany({ where: { id: { in: ids } } });
    return { 联系人, res };
  });
}

/** 删客户之前数一数：会一起删掉什么、什么会留下来。确认框照着它说，不再只写「跟进、待办与签约」 */
export type 删除清点 = {
  跟进: number;
  计划和待办: number;
  签约: number;
  /** 按币种分开（2026-10-03，不换汇） */
  签约金额: { 币种: string; 合计: number }[];
  /** 联系人不删，搬进未归属 */
  联系人: number;
  /** 从线索转来的：线索还在，退回「跟进中」（L-014） */
  线索: number;
  /** 企业版（P9）：删了进回收站、30 天内能恢复，联系人和项目跟着一起进，线索不动 */
  进回收站: boolean;
  /** 一起进回收站的项目（只在 进回收站 时数） */
  项目: number;
};

export async function 删除前清点(ids: string[]): Promise<删除清点> {
  await requireUser();
  const 在 = { customerId: { in: ids } };
  const 软 = 软删开着();
  const [跟进, 计划, 待办, 签约, 联系人, 线索, 项目] = await Promise.all([
    prisma.followUp.count({ where: 在 }),
    prisma.followPlan.count({ where: 在 }),
    prisma.task.count({ where: 在 }),
    prisma.contract.findMany({ where: 在, select: { amount: true, ...带币种.签约 } }),
    prisma.contact.count({ where: 在 }),
    prisma.lead.count({ where: 在 }),
    软 ? prisma.project.count({ where: 在 }) : 0,
  ]);
  return {
    跟进, 计划和待办: 计划 + 待办,
    签约: 签约.length, 签约金额: 签约合计(签约),
    联系人, 线索, 进回收站: 软, 项目,
  };
}

/**
 * 批量操作只改一个字段，且是操作人明确勾了这些行、明确选了值，
 * 所以「最后写的赢」在语义上是对的，不套单条编辑那个版本号闸门——
 * 套了会让批量操作动不动就整批失败，反而没人敢用。
 *
 * 但不能静默：要如实回报实际改了几条。原本无论选中几条、
 * 实际命中几条，一律提示「已变更」，选错页、行已被别人删掉都看不出来。
 */
export type BulkResult =
  | {
      ok: true;
      /** 真正被改动的条数 */
      updated: number;
      /** 改负责人时跟着走的没做完的活（排查 B3） */
      带走?: 带走数;
      /** 跟着走的是哪几条：撤销只还这几条（T-018，见 撤销改负责人） */
      带过来?: 带走的;
      /**
       * 真被改动的那几条原来是什么值，给「撤销」用（排查 D1）。原来批量改完不能撤，
       * 留痕里也只记了新值，事后连手工恢复都做不到
       */
      原值?: { id: string; 值: string }[];
      /** 本来就是这个值、无需改动的条数 */
      unchanged: number;
      /** 选中但库里已经没有的条数（被别人删了，含进回收站的） */
      missing: number;
      /** 选中、库里还在，但这次没转的条数（慢的一页：已被别人转走，限定层看不到了）；没有就不带 */
      没转?: number;
      /**
       * 企业版「交接中」（规则「交接要接手人确认」，D10）：这么多位发起了交接、等接手人确认，负责人还没换（updated 不算它们）；
       * 交接已在路上 = 本来就在另一笔交接里、这次没再发起的。规则关着永远不带
       */
      交接中?: number;
      交接已在路上?: number;
      /** 负责人本人转自己的客户 = 申请移交（X-20）：界面按「申请移交」说，不说「交接」 */
      申请移交?: boolean;
    }
  | { ok: false; error: string };

/**
 * 转之前先列出会一起转走的项目（企业版 D-36）：批量分配、改负责人、公海领取 / 分配之前界面先问这一下，
 * 有项目才弹确认框。只读，不改任何东西。不是企业版一律回 0 个 = 不弹，和原来一样直接转
 */
export async function 转走项目预览of(ids: string[], 新负责人?: string): Promise<转走项目预览> {
  const me = await requireUser();
  if (!企业版()) return { 项目数: 0, 项目: [] };
  // 不传 = 转给自己（公海领取）
  const 新 = 新负责人 ?? me.id;
  if (!Array.isArray(ids) || typeof 新 !== "string" || !新) return { 项目数: 0, 项目: [] };
  return 数转走的项目(ids.filter((x) => typeof x === "string"), 新);
}

/** 企业版转了不归自己管的客户（界面不摆，直接调接口才到这） */
const 只有管理能转让话 = "只能转出自己的或直属下属的客户；别的找系统管理员转";

/**
 * 企业版谁能转这批客户（V3.5.1）：逐个按 能转让客户——负责人本人、实线直属一级上级、条线总管理（条线内）、系统管理员；
 * 公海里的给能管公海的。看全部查：限定层会把看不到的滤掉，查漏了就放过去了
 */
async function 转让挡(me: Awaited<ReturnType<typeof requireUser>>, ids: string[]): Promise<string | null> {
  if (!企业版()) return null;
  const org = await 权限组织();
  const 们 = await 看全部(() => prisma.customer.findMany({ where: { id: { in: ids } }, select: { salesOwnerId: true, pool: { select: { customerId: true } } } }));
  return 们.every((c) => 能转让客户(me, { salesOwnerId: c.salesOwnerId, 在公海: !!c.pool }, org)) ? null : 只有管理能转让话;
}

const 只有负责人改客户话 = "只有负责人或系统管理员能改客户资料（上级、条线总管理只能看、转让）";
const 公海先领话 = "公海里的客户先领取或分配，再改";

/**
 * 企业版公海里的客户不走转让（P-公海-04）：先领取或分配，不然客户有了负责人却还在公海，原负责人回避失效。
 * 一批里混着公海客户整批拒，同 虚线只读挡、转让挡
 */
async function 公海挡(ids: string[]): Promise<string | null> {
  if (!企业版()) return null;
  return (await defaultClient.customerPool.count({ where: { customerId: { in: ids } } })) ? 公海先领话 : null;
}

/**
 * 企业版改客户详情挡（11-02，permissions.ts 能改客户）：负责人本人（销售、销售管理）才能改；公海里的谁都不能改；
 * 没设业务角色的一律拒。规则「按组织看客户」关着时限定层不拦，这里照样拦。新建（id 空）只挡没设业务角色的
 */
async function 改客户挡(me: Awaited<ReturnType<typeof requireUser>>, id?: string | null): Promise<string | null> {
  if (!企业版()) return null;
  const org = await 权限组织();
  if (!org || 没设业务角色(org, me.id)) return "你还没有业务角色，不能改数据，请找总管理设置";
  // 只读管理员新建也拦（11-03 D3-7 ④）：改已有的下面 能改客户 就不给，限定层也拦
  if (!id) return 只读角色(me, org) ? 只读角色话 : null;
  const c = await defaultClient.customer.findUnique({ where: { id }, select: { salesOwnerId: true, pool: { select: { customerId: true } } } });
  if (!c) return null; // 不在了：后面照原样报「已删除」
  if (c.pool) return 公海先领话;
  return 能改客户(me, { salesOwnerId: c.salesOwnerId, 在公海: false }, org) ? null : 只有负责人改客户话;
}

/** 批量改销售负责人 */
export async function assignSalesOwner(ids: string[], salesOwnerId: string, 原因?: string | null): Promise<BulkResult> {
  const me = await requireUser();
  const b = await getBusiness();
  if (!ids.length) return { ok: true, updated: 0, unchanged: 0, missing: 0 };
  // 企业版转让原因（10-27，字典「转让原因」，可不选）：停用了的不收；非企业版忽略
  const 选 = await 选的原因("transfer", 原因);
  if (!选.ok) return 选;
  const reason = salesOwnerId === me.id ? null : 选.值;

  if (!(await 在职(salesOwnerId))) return { ok: false, error: "该成员不存在或已停用，请选择一位在职成员" };
  // 没设角色的人、只读管理员不能接（交接也一样，原来能交接给管理员，11-03 完成度 C3-1）
  const 不行 = await 不能当负责人(salesOwnerId);
  if (不行) return { ok: false, error: 不行 };
  // 虚线下属的客户限定层会静静滤掉，结果报成「已不存在」：先说真原因
  const 虚线 = await 虚线只读挡(defaultClient, ids);
  if (虚线) return { ok: false, error: 虚线 };
  // 企业版转让 / 重新分配：管理、总管理（11-02：「这些都是管理来做。就是销售的上级」）；负责人只转自己的（同 能转让项目）。虚线 / 市场那句更具体，排它后面
  const 不让 = await 转让挡(me, ids);
  if (不让) return { ok: false, error: 不让 };
  const 在公海 = await 公海挡(ids);
  if (在公海) return { ok: false, error: 在公海 };
  const 验 = await 验证中挡(ids, salesOwnerId);
  if (验) return { ok: false, error: 验 };
  const 挡 = await 挡字段(me.id, ["销售负责人"]);
  if (挡) return { ok: false, error: 挡 };

  // 本来就归他的不算「改动」，分开统计才对得上操作人看到的选中条数
  const already = await prisma.customer.count({ where: { id: { in: ids }, salesOwnerId } });
  // 负责人本人转自己的 = 申请移交（X-20、P-转-16），先不换负责人，等接手人确认（转给自己 = 自己就是接手人，不用确认）；不看「交接要确认」开关，同单条。
  // 上级、条线总管理、系统管理员直接转（P-转-01）；市场成员的客户分给销售不走确认（P-转-17），当场转、只通知
  const 走法 = await 转让走交接(me, salesOwnerId, ids);
  if (走法) return 发起转让交接(me, ids, salesOwnerId, already, reason, 走法 === "申请");
  // 当场换：正在移交 / 交接中的不能再转（X-38 → P-转-05），上级、系统管理员也一样，先撤回或等对方拒收
  const 中 = await 移交中挡(ids, salesOwnerId);
  if (中) return { ok: false, error: 中 };
  await 钉住老签约();
  // 改负责人、名下的活跟着走、核持有上限（接待分配），一个事务做完（M-公海-18，11-11）：超了整批回滚，一个都没转
  const 写 = await 接待分配写(ids, salesOwnerId, me.id);
  if (!写.ok) return { ok: false, error: 写.超 };
  const { res, 换成了, 带: { 数: 带走, 记下: 带过来, 没转成, 留下, 同事待分配 } } = 写.值;
  // 转客户带走了同事的项目（待分配的、在推的）：事务提交了才告诉这位同事（P-转-19）
  if (同事待分配.length) await 同事待分配随客户通知(me.id, salesOwnerId, 同事待分配);
  // 改完又被别人改走的不算转成：不通知、不计数、不进撤销（撤销会把别人的改动盖掉）
  const 转成了 = 换成了.filter((c) => !没转成.includes(c.id));
  await 改负责人通知(me, 转成了.map((c) => ({ customerId: c.id, 旧: c.salesOwnerId })), salesOwnerId);
  await 分给你通知(me, salesOwnerId, 转成了.map((c) => c.id), undefined, 留下);

  if (res.count) {
    await recordAudit({
      user: me, action: "assign", entity: "Customer",
      summary: `把 ${转成了.length} 名${b.customer}的销售负责人改为「${(await prisma.user.findUnique({ where: { id: salesOwnerId }, select: { name: true } }))?.name ?? salesOwnerId}」${reason ? `（${reason}）` : ""}${没转成.length ? `（${没转成.length} 名刚被别人改了负责人，没转）` : ""}`,
      // 原值也记下：撤销提示条过了 6 秒，还能照着这里手工改回去（排查 D1）
      detail: { ids, salesOwnerId, 原负责人: 转成了.map((c) => ({ id: c.id, salesOwnerId: c.salesOwnerId })), ...(没转成.length ? { 没转成 } : {}), ...(reason ? { 转让原因: reason } : {}) },
    });
  }
  revalidateCustomer();
  return {
    ok: true, updated: 转成了.length, unchanged: already, ...(await 没转和不存在(ids, res.count + already)), 带走, 带过来,
    原值: 转成了.map((c) => ({ id: c.id, 值: c.salesOwnerId })),
  };
}

/**
 * 选中的里面，算过的（改了的 + 本来就是的）以外还剩几条，分两种报：库里真没有了 = 不存在；
 * 还在，只是限定层看不到了 = 慢的一页，刚被别人转走，这次没转。要放开范围数，不然两种就混成一类
 */
async function 没转和不存在(ids: string[], 算过: number): Promise<{ missing: number; 没转?: number }> {
  const 还在 = await 看全部(() => prisma.customer.count({ where: { id: { in: ids } } }));
  const 没转 = Math.max(0, 还在 - 算过);
  return { missing: ids.length - 还在, ...(没转 ? { 没转 } : {}) };
}

/**
 * 直接转客户（不走交接）会随客户带给新负责人的同事待分配项目（= 接待分配，转过去清待分配就算持有；P-转-07）：
 * 加上手上已有的超了持有上限就不转，回一句说清谁、上限、现有几个、这次要分配几个（M-公海-18，11-09）。
 * 原负责人自己的项目、同事在推的跟着客户走照旧不拦（超上限 的说明），所以只数同事待分配的、写之前数（写前核上限）；走交接的到确认那一步再核。
 * 11-11 起数和写在同一个事务里：两次分配同时进来，后到的那次数的时候先到的已经写完，不会两次都过
 */
async function 接待分配核上限(tx: Pick<Prisma.TransactionClient, "customer" | "project" | "customerOwnerLog" | "user">, 规则: 组织规则, ids: string[], 新: string): Promise<void> {
  const 起 = await 持有上限起点(tx, 规则, 新);
  if (!起) return;
  await 写前核上限(tx, 起, await 数进手的持有项目(ids, 新, { 同事待分配: true }, tx), "分配");
}

/**
 * 批量直接转客户的写入（assignSalesOwner）：一个事务里核接待分配的持有上限、改负责人、名下的活和项目跟着走；超了抛 整批超上限 整批回滚。
 * 限定着改（企业版虚线上级只能看、团队版同事互看）：看得到的客户里有改不动的，那几位没换人，下面的项目和活也不能跟着走
 */
async function 接待分配写(ids: string[], salesOwnerId: string, 操作人: string) {
  const 规则 = await 生效组织规则();
  const org = 企业版() ? await 权限组织() : null;
  return 整批或不做(() => 查完再写(async (tx) => {
    // 先记下每位原来归谁：他们没做完的活要跟着走（排查 B3）
    const 换人的 = await tx.customer.findMany({ where: { id: { in: ids }, salesOwnerId: { not: salesOwnerId } }, select: { id: true, salesOwnerId: true } });
    await 接待分配核上限(tx, 规则, 换人的.map((c) => c.id), salesOwnerId);
    const res = await tx.customer.updateMany({ where: { id: { in: 换人的.map((c) => c.id) }, salesOwnerId: { not: salesOwnerId } }, data: { salesOwnerId } });
    const 换成了 = res.count === 换人的.length ? 换人的 : await 看全部(async () => {
      const 已换 = new Set((await tx.customer.findMany({ where: { id: { in: 换人的.map((c) => c.id) }, salesOwnerId }, select: { id: true } })).map((c) => c.id));
      return 换人的.filter((c) => 已换.has(c.id));
    });
    const 带 = await 带走并记下在事务里(tx, 换成了.map((c) => ({ customerId: c.id, 旧: c.salesOwnerId })), salesOwnerId, 操作人, "assign", org);
    return { res, 换成了, 带 };
  }, { timeout: 30_000 }));
}

/**
 * 单条改负责人（编辑页保存、就地改）：仍在写之前、事务外按此刻的数据核一遍接待分配，超了回那句话。
 * 这两条路改负责人走乐观锁 + 合并重试、带活另开事务，没并进同一个事务（并发合计超限的窗口还在，留后续）
 */
async function 接待分配超上限(ids: string[], 新: string): Promise<string | null> {
  const 规则 = await 生效组织规则();
  const r = await 整批或不做(() => 接待分配核上限(prisma, 规则, ids, 新));
  return r.ok ? null : r.超;
}

/**
 * 换负责人怎么走（批量转让、编辑页、就地改同一句，11-09）：
 *   null —— 当场换：转给自己（自己就是接手人）、不是企业版、市场成员的客户全给销售（P-转-17，X-46 ⑤ 也不走申请）
 *   "申请" —— 负责人本人转自己的客户（P-转-01 ①、X-20，客户 11-09 回执 X4）：申请移交，接手人确认后生效，「交接要确认」关着也走。
 *             一批里混着自己的和下属的，整批走申请（同 P-转-17「混了就整批确认」）；只有系统管理员转自己的按 ③ 直接转（条线总管理转自己的也走申请）
 * 单条（客户编辑页、就地改）和批量转让同一套（P-转-16，11-10）：不看「交接要确认」开关，负责人本人的走申请，别的（上级、条线总管理、系统管理员）直接转。
 * 开关「交接要确认」只剩离职交接还读（settings/actions.ts），这里不再读
 */
async function 转让走交接(me: { id: string; role: string }, to: string, ids: string[]): Promise<"申请" | null> {
  if (to === me.id || !企业版()) return null;
  if (await 都是市场转销售(ids, to)) return null;
  if (转自己客户要申请(me, await 权限组织())) {
    const 自己的 = await prisma.customer.count({ where: { id: { in: ids }, salesOwnerId: me.id, pool: { is: null } } });
    if (自己的) return "申请";
  }
  return null;
}

/**
 * 当场换负责人前：这几位有正在移交 / 交接中的（别人发起的也算）就整批拒（X-38 → P-转-05：交接中的不能再转让）。
 * 走交接那条路不用这个：发起转让交接 自己跳过已在路上的
 */
async function 移交中挡(ids: string[], to: string): Promise<string | null> {
  if (!企业版()) return null;
  // 本来就归接手人的不算换人，不拦
  const 要换 = (await prisma.customer.findMany({ where: { id: { in: ids }, salesOwnerId: { not: to } }, select: { id: true } })).map((c) => c.id);
  const 中 = await 交接中的客户(要换);
  if (!中.size) return null;
  const b = await getBusiness();
  return `${中.size} 名${b.customer}正在移交（等接手人确认），不能再转；要换人先撤回，或等对方拒收${中.size < 要换.length ? "，整批已阻止" : ""}`;
}

/** 换负责人前（当场换、发起交接都问）：要换人的客户名下有验证中的线索就整批拦（X-77，同 移交中挡 只看真要换的） */
async function 验证中挡(ids: string[], to: string): Promise<string | null> {
  if (!企业版()) return null;
  const 要换 = (await prisma.customer.findMany({ where: { id: { in: ids }, salesOwnerId: { not: to } }, select: { id: true } })).map((c) => c.id);
  return 客户有验证中线索(prisma, 要换);
}

/**
 * 这批要换人的客户全在市场成员手里、接手人是销售（P-转-17）：不走确认，当场转、只通知。看客户负责人，不看谁点的。
 * 批量转让（assignSalesOwner）和单条换负责人（编辑页 saveCustomer、就地改 patchCustomer）共用这一份
 */
async function 都是市场转销售(ids: string[], 接手人: string): Promise<boolean> {
  const org = await 权限组织();
  if (!org) return false;
  const 们 = await prisma.customer.findMany({
    where: { id: { in: ids }, salesOwnerId: { not: 接手人 } },
    select: { salesOwnerId: true, pool: { select: { customerId: true } } },
  });
  return 们.length > 0 && 们.every((c) => 算市场转客户(org, c, 接手人));
}
function 交接结果(r: BulkResult): { 交接中?: number; 交接已在路上?: number; 申请移交?: boolean } {
  return r.ok ? { 交接中: r.交接中 ?? 0, 交接已在路上: r.交接已在路上 ?? 0, ...(r.申请移交 ? { 申请移交: true } : {}) } : {};
}

/**
 * 企业版「交接中」的转让（规则「交接要接手人确认」开着、转给别人，测试清单 D10「交接完成前接手人看不到」）：
 * 负责人先不换，按原负责人一人一行记待确认（EntHandover），接手人在客户页确认了才换，
 * 联系人、沟通记录、名下全部项目（含同事在推的，P-转-07）、没做完的活照老规矩一起走（customers/handover-actions.ts 确认交接）。
 * 已经在另一笔交接里的客户这次不再发起：同一位客户不能同时交给两个人（查和写在同一笔事务里，两人同时发起只成一笔）。
 * 只读的客户（虚线下属的）上面 虚线只读挡 已经整批拦了；企业版没有互看，这里看得到的就是改得动的
 */
async function 发起转让交接(me: { id: string; name: string }, ids: string[], to: string, already: number, reason: string | null, 申请 = false): Promise<BulkResult> {
  const b = await getBusiness();
  const 候选 = await prisma.customer.findMany({ where: { id: { in: ids }, salesOwnerId: { not: to } }, select: { id: true, salesOwnerId: true } });
  const { 发起, 已在 } = await 看全部(() => 查完再写(async (tx) => {
    const 已在 = await 交接中的客户(候选.map((c) => c.id), tx);
    const 按人 = new Map<string, string[]>();
    for (const c of 候选) if (!已在.has(c.id)) 按人.set(c.salesOwnerId, [...(按人.get(c.salesOwnerId) ?? []), c.id]);
    const 发起: { id: string; from: string; customerIds: string[] }[] = [];
    for (const [from, customerIds] of 按人) {
      const h = await tx.entHandover.create({
        data: { kind: "转让", fromUserId: from, toUserId: to, byUserId: me.id, customerIds: JSON.stringify(customerIds), counts: JSON.stringify({ 客户: customerIds.length }), reason },
      });
      发起.push({ id: h.id, from, customerIds });
    }
    return { 发起, 已在: 已在.size };
  }));
  const n = 发起.reduce((a, h) => a + h.customerIds.length, 0);
  // 市场转销售（P-转-10）：接手人确认前就要知道客户上还有多少活留在原负责人手里
  const org = n ? await 权限组织() : null;
  for (const h of 发起) {
    const 算市场 = !!org && 算市场转客户(org, { salesOwnerId: h.from, pool: null }, to);
    await 交接通知(me, h.id, "发起", 算市场 ? h.customerIds.map((customerId) => ({ customerId, 原: h.from })) : undefined);
  }
  if (n) {
    const 接手 = (await prisma.user.findUnique({ where: { id: to }, select: { name: true } }))?.name ?? to;
    await recordAudit({
      user: me, action: "assign", entity: "Customer",
      summary: `把 ${n} 名${b.customer}${申请 ? "申请移交" : "交接"}给「${接手}」，等对方确认后才换销售负责人${reason ? `（${reason}）` : ""}`,
      detail: { ids, salesOwnerId: to, 交接中: true, ...(申请 ? { 申请移交: true } : {}), 交接: 发起.map((h) => ({ id: h.id, 原负责人: h.from, 客户: h.customerIds })), ...(reason ? { 转让原因: reason } : {}) },
    });
  }
  revalidateCustomer();
  return { ok: true, updated: 0, unchanged: already, ...(await 没转和不存在(ids, 候选.length + already)), 交接中: n, 交接已在路上: 已在, ...(申请 ? { 申请移交: true } : {}) };
}

/**
 * 撤销批量改负责人（2026-10-04 T-018）：负责人还给原来的人，**只还这次带过来的那几条活**（带过来）。
 * 原来撤销 = 反向再转一次，带走没做完的() 分不出「这次带过来的」和「新负责人本来就有的」，
 * 乙原本挂在这位客户上的待办、在谈商机也一起转给了甲——活悄悄换了人。和公海撤销领取（pool-actions 撤销公海）一个做法：
 *   - 只撤「现在还归新负责人」的：撤销之前又被人改给了别人的不动
 *   - 原负责人已经停用的不还（还给停用的人等于丢进黑洞），留在新负责人那儿
 *   - 带过来的活也只还「还挂在新负责人名下、还没做完」的
 * 看全部（团队版，lib/team-scope.ts）：业务员把自己的客户转给同事，客户一换人他就看不到了，限定着查撤不回来。
 * 所以要撤哪几位不靠限定定：要么是还给我自己（我刚转出去的），要么是我现在看得到的（公海里的）；
 * 并且这位最近一条换负责人记录得是我把他从原负责人换给新负责人的（是我刚换的）——原值是前端传的，不能光信它。
 * 企业版按原样回滚、不半撤（P-撤销-01，4B）：这一批里有一位撤不了、或带过来的活有一条已经不是转过去时的样子
 * （被删、被人改走、做完了），整批不动、回原因让人手工改；团队版照旧能撤的撤、撤不了的跳过。
 * 写都在一个事务里，按原负责人分组成批改（原来一位客户一个事务、项目逐个查逐个改）
 */
export async function 撤销改负责人(原值: { id: string; 值: string }[], 新负责人: string, 带过来?: 带走的): Promise<BulkResult> {
  const me = await requireUser();
  const b = await getBusiness();
  const 去重 = [...new Map(原值.map((x) => [x.id, x])).values()];
  const ids = 去重.map((x) => x.id);
  if (!ids.length) return { ok: true, updated: 0, unchanged: 0, missing: 0 };
  const 严 = 企业版();
  const 看得到 = new Set((await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((c) => c.id));
  const 还归他 = new Set((await 看全部(() => prisma.customer.findMany({ where: { id: { in: ids }, salesOwnerId: 新负责人 }, select: { id: true } }))).map((c) => c.id));
  const 在职的 = new Set((await prisma.user.findMany({ where: { id: { in: 去重.map((x) => x.值) }, active: true }, select: { id: true } })).map((u) => u.id));
  // 只撤我自己刚才那一下（2026-10-28 越权排查）：原值、新负责人都是前端传的，不对上换负责人记录，业务员能把同事的客户「撤」给自己
  const 我换的 = await 是我刚换的(去重.map((x) => ({ customerId: x.id, 原: x.值, 现: 新负责人 })), me.id);
  const 能撤 = (x: { id: string; 值: string }) => 我换的.has(x.id) && 还归他.has(x.id) && (x.值 === me.id || 看得到.has(x.id));
  const 退 = 去重.filter((x) => 能撤(x) && 在职的.has(x.值));
  const 拒 = (原因: string) => ({ ok: false as const, error: `${原因}${ids.length > 1 ? "；为了不撤一半，这次一条都没改" : ""}，要改回请手工改` });
  if (严 && 退.length < ids.length) {
    const 改过 = 去重.filter((x) => !能撤(x)).length;
    const 停用 = 去重.filter((x) => 能撤(x) && !在职的.has(x.值)).length;
    return 拒([改过 ? `${改过} 位${b.customer}现在撤不了（负责人又改过，或过了撤销时限）` : "", 停用 ? `${停用} 位${b.customer}的原负责人已停用` : ""].filter(Boolean).join("；"));
  }
  if (!退.length) {
    revalidateCustomer();
    return { ok: true, updated: 0, unchanged: ids.length, missing: 0 };
  }
  await 钉住老签约();
  let 结果: { 退了: { id: string; salesOwnerId: string }[] } | { 错: string };
  try {
    结果 = await 看全部(() => 查完再写(async (tx) => {
      // 条件里再带一次新负责人：查完到这里之间被人改走了就不动（企业版：整批不动）
      const 还在 = new Set((await tx.customer.findMany({ where: { id: { in: 退.map((x) => x.id) }, salesOwnerId: 新负责人 }, select: { id: true } })).map((c) => c.id));
      const 这批 = 退.filter((x) => 还在.has(x.id));
      if (严 && 这批.length < 退.length) return { 错: `${退.length - 这批.length} 位${b.customer}的负责人刚又被改过` };
      if (严 && 带过来) {
        const 差 = await 带过来对不上(tx, 带过来, 这批.map((x) => x.id), 新负责人);
        if (差) return { 错: `一起转过去的计划、待办、商机、项目里有 ${差} 条已经被改过（换了人、做完了或删了）` };
      }
      const 组 = new Map<string, string[]>();
      for (const x of 这批) 组.set(x.值, [...(组.get(x.值) ?? []), x.id]);
      for (const [原, cs] of 组) {
        await tx.customer.updateMany({ where: { id: { in: cs }, salesOwnerId: 新负责人 }, data: { salesOwnerId: 原 } });
        // 企业版被撤的那条记录删掉、不另记（P-撤销-01），操作日志照记（下面 recordAudit）
        if (严) await 删被撤的换负责人记录(tx, cs, 原, 新负责人, me.id);
        else await 记换负责人(tx, cs.map((customerId) => ({ customerId, from: 新负责人, to: 原 })), me.id, "undo");
        if (!带过来) continue;
        const 这几位 = { in: cs };
        await tx.followPlan.updateMany({ where: { id: { in: 带过来.计划 }, customerId: 这几位, ownerId: 新负责人, done: false }, data: { ownerId: 原 } });
        await tx.task.updateMany({ where: { id: { in: 带过来.待办 }, customerId: 这几位, ownerId: 新负责人, done: false }, data: { ownerId: 原 } });
        if (严) await 还待分配状态(tx, 带过来, cs, 新负责人);
        await 还项目(tx, 带过来.项目, cs, 新负责人, 原, me.id);
        // 转客户时一起从线索公海带过来的（P-转-07）：放回线索公海；放不回去整批回滚
        if (严) {
          const 们 = await tx.project.findMany({ where: { id: { in: (带过来.公海项目 ?? []).filter((p) => typeof p === "string") }, customerId: 这几位 }, select: { id: true } });
          for (const p of 们) if (!(await 撤回项目公海(tx, p.id, 新负责人, me.id))) throw new 撤销对不上("一起从线索公海带过来的项目放不回去了");
        }
      }
      return { 退了: 这批.map((x) => ({ id: x.id, salesOwnerId: x.值 })) };
    }));
  } catch (e) {
    if (e instanceof 撤销对不上) 结果 = { 错: e.message };
    else throw e;
  }
  if ("错" in 结果) return 拒(结果.错);
  const { 退了 } = 结果;
  if (退了.length) {
    await recordAudit({
      user: me, action: "assign", entity: "Customer",
      summary: `撤销了刚才的批量分配：${退了.length} 名${b.customer}的销售负责人改回原来的人`,
      detail: { ids: 退了.map((x) => x.id), 从: 新负责人, 改回: 退了 },
    });
  }
  revalidateCustomer();
  return { ok: true, updated: 退了.length, unchanged: ids.length - 退了.length, missing: 0 };
}

/** 撤销做到一半发现对不上：抛它让事务整个回滚（查完再写 只对 SQLite 忙重试，这个原样抛出来） */
class 撤销对不上 extends Error {}

export async function bulkFollowStatus(ids: string[], followStatus: string): Promise<BulkResult> {
  const me = await requireUser();
  const b = await getBusiness();
  if (!ids.length) return { ok: true, updated: 0, unchanged: 0, missing: 0 };
  const 状态错 = 跟进不对(followStatus);
  if (状态错) return { ok: false, error: 状态错 };
  const 虚线 = await 虚线只读挡(defaultClient, ids);
  if (虚线) return { ok: false, error: 虚线 };
  const 挡 = await 挡字段(me.id, ["跟进状态"]);
  if (挡) return { ok: false, error: 挡 };
  // 企业版跟进状态是客户详情，只给负责人改（11-02）；勾了一位不归自己的就整批不改，免得改一半
  for (const id of 企业版() ? ids : []) {
    const 改挡 = await 改客户挡(me, id);
    if (改挡) return { ok: false, error: 改挡 };
  }

  const already = await prisma.customer.count({ where: { id: { in: ids }, followStatus } });
  // 先记下每位原来的状态，给撤销用（排查 D1）
  const 要改的 = await prisma.customer.findMany({
    where: { id: { in: ids }, followStatus: { not: followStatus } },
    select: { id: true, followStatus: true },
  });
  const res = await prisma.customer.updateMany({
    where: { id: { in: 要改的.map((c) => c.id) }, followStatus: { not: followStatus } },
    data: { followStatus },
  });

  if (res.count) {
    await recordAudit({
      user: me, action: "assign", entity: "Customer",
      summary: `把 ${res.count} 名${b.customer}的跟进状态改为「${statusLabel(b, followStatus)}」`,
      detail: { ids, followStatus, 原状态: 要改的.map((c) => ({ id: c.id, followStatus: c.followStatus })) },
    });
  }
  revalidateCustomer();
  return {
    ok: true, updated: res.count, unchanged: already, missing: ids.length - res.count - already,
    原值: 要改的.map((c) => ({ id: c.id, 值: c.followStatus })),
  };
}

/* ---------- 签约 ---------- */

/** 命中查重时回传，供界面弹窗让人确认是不是真要再录一笔 */
export type ContractDuplicate = {
  amount: number;
  /** 币种（2026-10-03）：弹窗里按它显示金额 */
  currency: string;
  signedAt: string;
  remark: string | null;
};

export type SaveContractResult =
  | { ok: true; 联动?: 签约联动结果 }
  | { ok: false; error: string }
  | { ok: false; duplicate: ContractDuplicate };

/**
 * 登记签约时顺手收的尾：哪几个商机一起标赢单、哪几条计划 / 待办一起完成。
 *
 * 2026-09-28 审查 S3：签约和赢单原来是两条互不相通的线——签了 ¥86,000，
 * 商机还挂在「方案报价」、照样算进在谈金额；逾期计划也还在首页催你「先处理」
 * 一个已经签下来的人。弹窗里把这几样列出来、默认勾上，人可以取消勾选。
 * 服务端**只照勾选的做**，一项不勾就一项不动。
 */
export type 签约联动 = { 赢单: string[]; 完成计划: string[]; 完成待办: string[] };
export type 签约联动结果 = { 赢单: number; 完成计划: number; 完成待办: number };

/** 登记签约弹窗要列的东西：这位客户进行中的商机、没完成的计划和待办 */
export async function listContractLinks(customerId: string): Promise<{
  商机: { id: string; name: string; amount: number; stage: string; currency: string }[];
  计划: { id: string; subject: string; plannedAt: string }[];
  待办: { id: string; title: string; dueAt: string | null }[];
}> {
  await requireUser();
  const [商机, 计划, 待办] = await Promise.all([
    prisma.opportunity.findMany({ where: { customerId, status: "OPEN" }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, amount: true, stage: true, ...带币种.商机 } }),
    prisma.followPlan.findMany({ where: { customerId, done: false }, orderBy: { plannedAt: "asc" }, select: { id: true, subject: true, plannedAt: true, plannedOn: true } }),
    prisma.task.findMany({ where: { customerId, done: false }, orderBy: { dueAt: { sort: "asc", nulls: "last" } }, select: { id: true, title: true, dueAt: true, dueOn: true } }),
  ]);
  return {
    商机: 商机.map(({ money: _m, ...o }) => ({ ...o, currency: 商机币种({ money: _m }) })),
    计划: 计划.map((x) => ({ ...x, plannedAt: scheduleValue(x.plannedAt, x.plannedOn)! })),
    待办: 待办.map((x) => ({ ...x, dueAt: scheduleValue(x.dueAt, x.dueOn) })),
  };
}

/**
 * 登记签约。
 *
 * 查重规则（业务上定的）：同一学员 + 同一金额 + 同一天，视为可能是同一笔。
 * 两个人各录一次同一笔，业绩合计会翻倍且系统不会察觉——这是最难事后发现的一类。
 * 但续费和分期本来就可能同额同日，所以只弹窗确认，不硬拦：force 传 true 就照录。
 */
export async function saveContract(input: {
  id?: string;
  customerId: string;
  amount: number;
  signedAt: Date;
  remark: string | null;
  /** 币种（2026-10-03）。不给：新登记用本位币，编辑保持原来的 */
  currency?: string | null;
  /** 用户已在弹窗里确认「确实是另一笔」 */
  force?: boolean;
  /** 一起收尾的商机 / 计划 / 待办（弹窗里勾上的）。只在新登记时生效，编辑一笔旧签约不牵动别的 */
  联动?: 签约联动;
}): Promise<SaveContractResult> {
  try {
    const me = await requireUser();
    const 老入口 = await 只用项目挡老入口("合同");
    if (老入口) return { ok: false, error: 老入口 };
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      return { ok: false, error: "签约金额必须为正数" };
    }
    if (!(input.signedAt instanceof Date) || !Number.isFinite(input.signedAt.getTime())) {
      return { ok: false, error: "日期格式不对或日期不存在" };
    }
    if (input.currency != null && !是币种(String(input.currency).toUpperCase())) return { ok: false, error: "不认识这个币种" };
    // 精确到分（外币常带小数）；Contract.amount 那一列是整数，照旧写四舍五入的值给老统计和导出用，精确值进 ContractMoney
    const 精确 = Math.round(input.amount * 100) / 100;
    if (精确 <= 0) return { ok: false as const, error: "签约金额必须大于 0" };
    const amount = Math.max(1, Math.round(精确));
    // 超过库里整数的上限（约 21 亿）：说一句，不让数据库抛（第二轮 r2-data）
    if (amount > 2_147_483_647) return { ok: false as const, error: "签约金额太大了，单笔最多 21 亿" };
  
    // 「同一天」按自然日算，不是 24 小时
    const dayStart = businessDayjs(input.signedAt).startOf("day").toDate();
    const dayEnd = businessDayjs(input.signedAt).add(1, "day").startOf("day").toDate();
    // 事务里只用 tx（lib/check-then-write.ts），本位币先在外面读好
    const 业务 = await getBusiness();
    const 本位币 = 业务.currency;
    // 外贸模版下签约界面上叫订单；原来同一个事务里另写一张 TradeOrder（订单号 / 付款方式 / 供应商），2026-10-29 连表删了，只记签约

    const data = {
      customerId: input.customerId,
      amount,
      signedAt: input.signedAt,
      remark: input.remark?.trim() || null,
    };
    const 学员 = await prisma.customer.findUnique({
      where: { id: input.customerId },
      select: { name: true, salesOwnerId: true, channelOwnerId: true },
    });

    /*
      查重和落库在同一个事务里（2026-10-04 J-104）：原来两步分开，两个窗口同时点「登记」，
      两边都查不到对方、都写进去，业绩翻倍。现在后进来的那次查的时候前一笔已经在库里了，照样弹「可能重复」
    */
    const 落库 = await 查完再写(async (tx): Promise<{ duplicate: ContractDuplicate } | { 签约id: string; 币: string; 收尾?: Awaited<ReturnType<typeof 签约收尾>> }> => {
      if (!input.force) {
        // 同额要连币种一起比：同一天 US$ 100 和 ¥ 100 不是同一笔
        const 原币 = input.id && input.currency == null ? await tx.contractMoney.findUnique({ where: { contractId: input.id }, select: { currency: true } }) : null;
        const 这笔币 = input.currency != null ? 规整币种(input.currency) : input.id ? 签约币种({ money: 原币 }) : 本位币;
        const 同日同额 = await tx.contract.findMany({
          where: {
            customerId: input.customerId,
            amount,
            signedAt: { gte: dayStart, lt: dayEnd },
            ...(input.id ? { id: { not: input.id } } : {}),
          },
          select: { amount: true, signedAt: true, remark: true, ...带币种.签约 },
        });
        const hit = 同日同额.find((c) => 签约币种(c) === 这笔币);
        if (hit) {
          return {
            duplicate: {
              amount: 签约金额(hit),
              currency: 签约币种(hit),
              signedAt: hit.signedAt.toISOString(),
              remark: hit.remark,
            },
          };
        }
      }

      let 签约id: string;
      let 币: string;
      if (input.id) {
        await tx.contract.update({ where: { id: input.id }, data });
        签约id = input.id;
        币 = input.currency ?? (await tx.contractMoney.findUnique({ where: { contractId: input.id } }))?.currency ?? "CNY";
      } else {
        // 记下签约这一刻是谁的单（排查 B2）。编辑旧签约不改它：那笔业绩当时是谁的就一直是谁的
        const c = await tx.contract.create({
          data: { ...data, owner: { create: { salesOwnerId: 学员?.salesOwnerId ?? null, channelOwnerId: 学员?.channelOwnerId ?? null } } },
        });
        签约id = c.id;
        币 = input.currency ?? 本位币;
      }
      // 编辑一笔老签约（没有 ContractMoney）也补上这一行：金额刚被重写过，精确值以这次为准
      await 写签约金额(tx, 签约id, 币, 精确);
      // 客户状态与勾选的收尾也属于这一笔签约，中途失败必须一起回滚。
      if (!input.id) await tx.customer.update({
        where: { id: input.customerId }, data: { followStatus: "已签约", decisionStatus: "已决定报名" },
      });
      const 收尾 = !input.id && input.联动
        ? await 签约收尾(tx, input.customerId, 签约id, input.联动, me, 学员?.name ?? input.customerId)
        : undefined;
      return { 签约id, 币, 收尾 };
    });
    if ("duplicate" in 落库) return { ok: false, duplicate: 落库.duplicate };
    const { 签约id, 币, 收尾 } = 落库;
  
    await recordAudit({
      user: me, action: input.id ? "update" : "create", entity: "Contract", entityId: 签约id,
      // 外贸模版下日志照旧说「订单」（界面上就这么叫），只是不再带订单号
      summary: `${input.id ? "修改" : "登记"}「${学员?.name ?? input.customerId}」的${签约叫(业务)} ${显示金额(精确, 币)}` +
        (input.force ? "（已确认不是重复录入）" : ""),
      detail: { customerId: input.customerId, amount: 精确, currency: 币, signedAt: input.signedAt, force: !!input.force },
    });
  
    // 留痕仍为旁路：只在事务提交后写，失败的签约不会留下成功日志。
    for (const 日志 of 收尾?.日志 ?? []) await recordAudit(日志);
    const 联动 = 收尾?.结果;
    if (联动) for (const path of ["/opportunities", "/opportunities/pipeline", "/follow-ups/plans", "/dashboard"]) revalidatePath(path);

    revalidateCustomer(input.customerId);
    return { ok: true, ...(联动 ? { 联动 } : {}) };
  } catch (e) {
    return 不在了(e);
  }
}

/** 同一事务中收尾；保留每类操作原来的留痕，提交后再写日志和刷新页面。 */
async function 签约收尾(
  tx: Prisma.TransactionClient, customerId: string, 签约id: string, 勾: 签约联动,
  user: { id: string; name: string }, 客户名: string,
): Promise<{ 结果: 签约联动结果; 日志: Parameters<typeof recordAudit>[0][] }> {
  const [商机, 计划, 待办] = await Promise.all([
    tx.opportunity.findMany({ where: { id: { in: 勾.赢单 ?? [] }, customerId, status: "OPEN" }, select: { id: true, name: true, amount: true, stage: true, probability: true } }),
    tx.followPlan.findMany({ where: { id: { in: 勾.完成计划 ?? [] }, customerId, done: false }, select: { id: true, subject: true } }),
    tx.task.findMany({ where: { id: { in: 勾.完成待办 ?? [] }, customerId, done: false }, select: { id: true, title: true } }),
  ]);
  const 日志: Parameters<typeof recordAudit>[0][] = [];
  const now = new Date();
  for (const o of 商机) {
    await tx.opportunity.update({ where: { id: o.id }, data: { status: "WON", stage: "赢单成交", probability: 100, activityAt: now } });
    await tx.opportunityClose.upsert({ where: { opportunityId: o.id }, create: { opportunityId: o.id, closedAt: now }, update: { closedAt: now } });
    const 记 = { contractId: 签约id, prevStage: o.stage, prevProbability: o.probability };
    await tx.contractWin.upsert({ where: { opportunityId: o.id }, create: { opportunityId: o.id, ...记 }, update: 记 });
    日志.push({ user, action: "update", entity: "Opportunity", entityId: o.id,
      summary: `商机「${o.name}」标记为赢单`, detail: { 状态: "赢单", 金额: o.amount } });
  }
  for (const p of 计划) {
    await tx.followPlan.update({ where: { id: p.id }, data: { done: true, doneAt: now } });
    日志.push({ user, action: "update", entity: "FollowPlan", entityId: p.id, summary: `完成跟进计划「${p.subject}」（${客户名}）` });
  }
  for (const t of 待办) {
    await tx.task.update({ where: { id: t.id }, data: { done: true, doneAt: now } });
    日志.push({ user, action: "update", entity: "Task", entityId: t.id, summary: `待办「${t.title}」标记为已完成` });
  }
  return { 结果: { 赢单: 商机.length, 完成计划: 计划.length, 完成待办: 待办.length }, 日志 };
}

/**
 * 删签约之前数一数：当初登记这笔时顺手标成赢单、现在还是赢单的商机有几个——删了会退回进行中（L-007）。
 * 确认框照着它说（第 2 期 2a：确认框说清会一起动什么）
 */
export async function 删签约前清点(id: string): Promise<{ 退回商机: string[] }> {
  await requireUser();
  const 赢下的 = await prisma.contractWin.findMany({
    where: { contractId: id, opportunity: { is: { status: "WON" } } },
    select: { opportunity: { select: { name: true } } },
  });
  return { 退回商机: 赢下的.map((w) => w.opportunity.name) };
}

/**
 * 删除签约记录。
 *
 * 删掉最后一笔后，学员的跟进状态会停在「已签约」但金额已归零，
 * 看板上就会长期挂着一条「已签约、金额 0」而没人提醒。
 * 退回到哪一档由界面弹窗让操作人自己选（也可以选择不动），系统不替人决定。
 */
export async function deleteContract(
  id: string,
  customerId: string,
  revertTo?: { followStatus: string; decisionStatus: string } | null,
): Promise<{ ok: true; remaining: number; 退回商机: number } | { ok: false; error: string }> {
  try {
    const me = await requireUser();
    const 老入口 = await 只用项目挡老入口("合同");
    if (老入口) return { ok: false, error: 老入口 };
    const b = await getBusiness();
  
    if (revertTo) {
      const 状态错 = 跟进不对(revertTo.followStatus) ?? 决策不对(revertTo.decisionStatus);
      if (状态错) return { ok: false, error: 状态错 };
    }
  
    // 删完就查不到金额了，先留一份
    const 待删 = await prisma.contract.findUnique({ where: { id }, select: { amount: true, signedAt: true, ...带币种.签约 } });
    // 这笔签约顺手赢下的商机（2026-10-04 L-007）。签约一删这几行跟着级联没了，先取出来
    const 赢下的 = await prisma.contractWin.findMany({ where: { contractId: id }, include: { opportunity: { select: { status: true } } } });
    // 原来外贸签约先在同一事务里明着删它那张 TradeOrder，2026-10-29 订单表删了，只删签约
    const gone = await prisma.contract.deleteMany({ where: { id, customerId } });
    if (gone.count === 0) {
      return { ok: false, error: "这条签约记录已经不在了（可能已删除）" };
    }
    /*
      退回签约前的阶段和概率（2026-10-04 L-007）。原来删签约不碰商机：签约没了、商机还挂赢单，本月赢单 / 漏斗 / 业绩一起虚高。
      只退「还是赢单」的：赢了之后离开过赢单的，ContractWin 那一行已经删了（opportunities/actions.ts 记结单）；
      这里再看一眼状态兜底——人改过的不许被盖掉。走 setOppStatus 的「还原」，留痕、结单时刻、刷新都在那里面。
      赢单前的阶段若是赢单成交（对齐之前的老数据），退到前一档，不能退出一张「进行中 + 赢单成交」的卡。
    */
    let 退回商机 = 0;
    for (const w of 赢下的) {
      if (w.opportunity.status !== "WON") continue;
      const 阶段 = w.prevStage === "赢单成交" || !OPP_STAGES.includes(w.prevStage as (typeof OPP_STAGES)[number]) ? "谈判审核" : w.prevStage;
      const r = await setOppStatus(w.opportunityId, "OPEN", { stage: 阶段, probability: w.prevProbability });
      if (r.ok) 退回商机++;
    }
  
    const remaining = await prisma.contract.count({ where: { customerId } });
    // 只在确实一笔不剩时才谈回退；还有别的签约就不该动状态
    if (revertTo && remaining === 0) {
      await prisma.customer.update({
        where: { id: customerId },
        data: { followStatus: revertTo.followStatus, decisionStatus: revertTo.decisionStatus },
      });
    }
  
    await recordAudit({
      user: me, action: "delete", entity: "Contract", entityId: id,
      summary: `删除签约 ${待删 ? 显示金额(签约金额(待删), 签约币种(待删)) : 显示金额(0)}` +
        (revertTo && remaining === 0 ? `，跟进状态退回「${statusLabel(b, revertTo.followStatus)}」` : "") +
        (remaining ? `，该${b.customer}还剩 ${remaining} 笔` : "") +
        (退回商机 ? `，${退回商机} 个当初顺手标成赢单的商机退回进行中` : ""),
      detail: { customerId, amount: 待删?.amount, signedAt: 待删?.signedAt, revertTo, remaining, 退回商机 },
    });
  
    revalidateCustomer(customerId);
    return { ok: true, remaining, 退回商机 };
  } catch (e) {
    return 不在了(e);
  }
}

/* ---------- 记录页的行内编辑 ---------- */

/** 单格改负责人：检查的这会儿负责人被别人改走了（代码体检 C2） */
const 负责人刚被改过 = "负责人刚被别人改过，这次没有改，刷新后再看";

/**
 * 记录页里能直接点着改的字段。姓名、推荐关系（要重算归属）仍走完整表单。
 * 电话、客户地址 11-04 起也能直接改（用户：改成直接可编辑，不用再点按钮）：电话照完整表单那套查重（见下面 phone 那段），
 * 所在地区四格一起交，走 patchCustomerRegion
 */
const PATCHABLE = ["school", "major", "grade", "remark", "expectedSignAt", "followStatus", "decisionStatus", "custStatus", "salesOwnerId", "channelOwnerId", "shortName", "assignWay", "customerType", "customerAttr", "phone", "addrDetail", ...外贸键] as const;
/** 只有企业版能点着改的几格（迁移 072）：开关关着不收 */
const 企业版才有的格: readonly string[] = ["shortName", "assignWay", "customerType", "customerAttr", "addrDetail"];
export type PatchableKey = (typeof PATCHABLE)[number];

/**
 * 只改一个字段。和 saveCustomer 的整表提交不同，单字段写入天然不会覆盖别人改的其它字段，
 * 所以不需要快照比对；留痕照记。
 */
export async function patchCustomer(id: string, key: PatchableKey, value: string | null): Promise<{ ok: true; 带走?: 带走数; 交接中?: number; 交接已在路上?: number; 申请移交?: boolean } | { ok: false; error: string }> {
  const me = await requireUser();
  const b = await getBusiness();
  if (!PATCHABLE.includes(key) || (企业版才有的格.includes(key) && !企业版())) return { ok: false, error: "这个字段不能在这里改" };
  // 团队互看：同事的客户读得到、改不了（lib/team-scope.ts），外贸档案那几格也一样
  if (await 同事的客户(defaultClient, id)) return { ok: false, error: await 只读话(defaultClient) };
  // 改负责人：进来先记下这一刻的负责人，下面各道检查都按它判，最后按「还是这位」条件写（代码体检 C2，仿 X-89）。
  // 读不到（删了、看不到）不在这里回，留给下面各道检查说各自的原因
  const 进来时负责人 = key === "salesOwnerId" ? (await prisma.customer.findUnique({ where: { id }, select: { salesOwnerId: true } }))?.salesOwnerId : undefined;
  // 企业版：换负责人走转让那条规矩（只转自己的；管理、总管理随便转），公海里的走领取 / 分配；别的格只有负责人能改
  const 归属挡 = key === "salesOwnerId" ? await 转让挡(me, [id]) ?? await 公海挡([id]) : await 改客户挡(me, id);
  if (归属挡) return { ok: false, error: 归属挡 };
  const 挡 = 客户列字段[key] ? await 挡字段(me.id, [客户列字段[key]]) : null;
  if (挡) return { ok: false, error: 挡 };
  // 动到归属的几格（负责人、渠道负责人、来源、推荐人）之前先钉住老签约（排查 X1 / 复查 R）
  if (["salesOwnerId", "channelOwnerId", "channelId", "referrerCustomerId"].includes(key)) await 钉住老签约();

  const v = typeof value === "string" ? value.trim() : value;
  if (key === "remark") {
    const 太长 = 企业版客户太长(b.customer, { remark: v }, await prisma.customer.findUnique({ where: { id }, select: { name: true, remark: true } }));
    if (太长) return { ok: false, error: 太长 };
  }
  /*
    外贸档案那五格（2026-10-05）在旁表 CustomerExtra 里，单独写、单独留痕
  */
  if ((外贸键 as readonly string[]).includes(key)) {
    const k = key as keyof 外贸档案;
    // 企业版客户级别只有 S / A / B / C（定稿 P5 第 23 条），不走外贸那套 A–D
    const 企级 = 企业版() && k === "level" ? 认企业级别(v) : null;
    if (企业版() && k === "level" && 企级 === undefined) return { ok: false, error: "客户级别只能是 S / A / B / C" };
    const r: { ok: true; v: string | null } | { ok: false; error: string } = 企业版() && k === "level" ? { ok: true, v: 企级 ?? null } : 规整外贸格(k, k === "country" ? 认国家(v) : v);
    if (!r.ok) return r;
    const 人 = await prisma.customer.findUnique({ where: { id }, select: { name: true, extra: true } });
    if (!人) return { ok: false, error: `这条${b.customer}已被删除` };
    const 原 = 人.extra?.[k] ?? null;
    if (原 === r.v) return { ok: true };
    await 写外贸档案(prisma, id, { [k]: r.v });
    await recordAudit({
      user: me, action: "update", entity: "Customer", entityId: id,
      summary: `修改${b.customer}「${人.name}」：${外贸字段名[k]}`,
      detail: [{ 字段: 外贸字段名[k], 原值: 原 ?? "（空）", 新值: r.v ?? "（空）" }],
    });
    revalidatePath(`/customers/${id}`);
    revalidatePath("/customers");
    await 客户存了推项目(me, id);
    return { ok: true };
  }
  const data: Record<string, unknown> = {};
  if (key === "followStatus") {
    const 错 = 跟进不对(v);
    if (错) return { ok: false, error: 错 };
    data.followStatus = v;
  } else if (key === "decisionStatus") {
    const 错 = 决策不对(v);
    if (错) return { ok: false, error: 错 };
    data.decisionStatus = v;
  } else if (key === "custStatus") {
    // 客户状态只有企业版有（字典 custStatus）；开关关着不收
    if (!企业版()) return { ok: false, error: "这个字段不能在这里改" };
    if (await 客户状态自动()) return { ok: false, error: "客户状态按项目自动算，不能手改" };
    const 原 = await prisma.customer.findUnique({ where: { id }, select: { custStatus: true } });
    if (!原) return { ok: false, error: `这条${b.customer}已被删除` };
    const r = await 定客户状态(v ?? null, 原.custStatus, false);
    if ("error" in r) return { ok: false, error: r.error };
    data.custStatus = r.值;
  } else if (key === "salesOwnerId") {
    if (typeof v !== "string" || !v || !(await 在职(v))) return { ok: false, error: "负责人不存在或已停用" };
    const 不行 = await 不能当负责人(v);
    if (不行) return { ok: false, error: 不行 };
    const 验 = await 验证中挡([id], v);
    if (验) return { ok: false, error: 验 };
    // 负责人本人转自己的（申请移交，X-20、P-转-16，不看开关）：先发起申请，负责人不换；上级、系统管理员直接转；市场成员的客户转给销售不走确认（P-转-17）
    const 走法 = await 转让走交接(me, v, [id]);
    if (走法) {
      const 现 = await prisma.customer.findUnique({ where: { id }, select: { salesOwnerId: true } });
      if (!现) return { ok: false, error: `这条${b.customer}已被删除` };
      if (现.salesOwnerId !== v) {
        const r = await 发起转让交接(me, [id], v, 0, null, 走法 === "申请");
        return r.ok ? { ok: true, ...交接结果(r) } : r;
      }
    }
    const 中 = await 移交中挡([id], v);
    if (中) return { ok: false, error: 中 };
    const 超 = await 接待分配超上限([id], v);
    if (超) return { ok: false, error: 超 };
    data.salesOwnerId = v;
  } else if (key === "channelOwnerId") {
    // 清空 = 恢复跟着推荐链走；给了人 = 手工钉死。只动这一条学员，不影响任何其他人
    if (v) {
      if (typeof v !== "string" || !(await 在职(v))) return { ok: false, error: "渠道负责人不存在或已停用" };
      data.channelOwnerId = v;
    } else {
      const cur = await prisma.customer.findUnique({ where: { id }, select: { channelId: true, referrerCustomerId: true } });
      if (!cur) return { ok: false, error: `这条${b.customer}已被删除` };
      data.channelOwnerId = (await resolveAttribution(cur)).channelOwnerId;
    }
  } else if (key === "shortName") {
    const 简 = (v ?? "").replace(/\s+/g, " ") || null;
    if (简 && 简.length > 简称上限) return { ok: false, error: `客户简称最多 ${简称上限} 个字` };
    data.shortName = 简;
  } else if (key === "assignWay") {
    const 原 = await prisma.customer.findUnique({ where: { id }, select: { assignWay: true } });
    if (!原) return { ok: false, error: `这条${b.customer}已被删除` };
    if (v && v !== 原.assignWay && !(await 可选项("custAssign")).includes(v)) return { ok: false, error: `客户分配「${v}」不在可选范围内，请刷新后重选` };
    data.assignWay = v || null;
  } else if (key === "customerType") {
    const 原 = await prisma.customer.findUnique({ where: { id }, select: { customerType: true } });
    if (!原) return { ok: false, error: `这条${b.customer}已被删除` };
    if (v && v !== 原.customerType && !(await 可选项("custType")).includes(v)) return { ok: false, error: `客户类型「${v}」不在可选范围内，请刷新后重选` };
    data.customerType = v || null;
  } else if (key === "customerAttr") {
    const 原 = await prisma.customer.findUnique({ where: { id }, select: { customerAttr: true } });
    if (!原) return { ok: false, error: `这条${b.customer}已被删除` };
    if (v && v !== 原.customerAttr && !(await 可选项("custAttr")).includes(v)) return { ok: false, error: `客户属性「${v}」不在可选范围内，请刷新后重选` };
    data.customerAttr = v || null;
  } else if (key === "phone") {
    /*
      电话：和 saveCustomer 编辑时同一条规矩——打码的样子认回原号；原样没动的不规整、不查重；
      原来有号码的不许清空；换了号先查本机（看全部，同事名下的也比），再问服务端同事那边有没有
    */
    const 原 = await prisma.customer.findUnique({ where: { id }, select: { phone: true } });
    if (!原) return { ok: false, error: `这条${b.customer}已被删除` };
    const 号 = String(认回打码号(v, 原.phone) ?? "").trim();
    if (号 === (原.phone ?? "")) return { ok: true };
    const 电话 = 查电话(号, { 必填: Boolean(原.phone) });
    if (!电话.ok) return { ok: false, error: 电话.error };
    if (电话.phone === 原.phone) return { ok: true };
    if (电话.phone) {
      const dup = await 看全部(async () => prisma.customer.findFirst({
        where: { AND: [await 同号条件(prisma, 电话.phone, await 分机留存起()), { id: { not: id } }] },
        select: 撞到的字段,
      }));
      if (dup) return { ok: false, error: await 撞号说法(`手机号 ${电话.phone}`, dup, await 读的我(defaultClient), b.customer) };
      const 撞 = await 问同事("phone", 电话.phone, id);
      if (撞) return { ok: false, error: 同事撞号说法(`手机号 ${电话.phone}`, 撞.同事, 撞.客户名, b.customer) };
    }
    data.phone = 电话.phone;
  } else if (key === "addrDetail") {
    const 详 = 规整详细地址(v);
    if (!详.ok) return { ok: false, error: 详.error };
    data.addrDetail = 详.值;
  } else if (key === "expectedSignAt") {
    const previous = await prisma.customer.findUnique({ where: { id }, select: { expectedSignAt: true, expectedSignOn: true } });
    const parsed = parseSignDate(v, previous ?? undefined);
    if (!parsed) return { ok: false, error: "日期格式不对或日期不存在" };
    data.expectedSignAt = parsed.at;
    data.expectedSignOn = parsed.on;
  } else {
    data[key] = v || null;
  }

  const before = await prisma.customer.findUnique({ where: { id }, select: { name: true, expectedSignOn: true, [key]: true } as never });
  if (!before) return { ok: false, error: `这条${b.customer}已被删除` };
  if (key === "salesOwnerId" && 进来时负责人 !== undefined) {
    /*
      两个人同时把同一位改给不同的人：原来无条件写，后到的盖先到的，两位接手人都收到「分给你」。
      按「负责人还是进来时那位」条件写；0 行 = 检查的这会儿被别人改走了：不写、不留痕、不带走活、不通知
    */
    if ((before as { salesOwnerId?: string }).salesOwnerId !== 进来时负责人) return { ok: false, error: 负责人刚被改过 };
    const 改 = await prisma.customer.updateMany({ where: { id, salesOwnerId: 进来时负责人 }, data });
    if (!改.count) {
      const 现 = await 看全部(() => prisma.customer.findUnique({ where: { id }, select: { salesOwnerId: true } }));
      if (!现) return { ok: false, error: `这条${b.customer}已被删除` };
      if (现.salesOwnerId !== 进来时负责人) return { ok: false, error: 负责人刚被改过 };
      // 负责人没变却改不到：限定层挡的（只读的客户），原来单条 update 在这里抛，照旧说只读
      return { ok: false, error: await 只读话(defaultClient) };
    }
  } else await prisma.customer.update({ where: { id }, data });
  const labels = customerFieldLabels(b);
  await recordAudit({
    user: me, action: "update", entity: "Customer", entityId: id,
    summary: `修改${b.customer}「${(before as { name: string }).name}」：${labels[key] ?? key}`,
    detail: describeCustomerChanges([key], before as Record<string, unknown>, data, labels),
  });
  // 换了销售负责人：原负责人在他身上没做完的活跟着走（排查 B3）
  const 原负责人 = (before as { salesOwnerId?: string }).salesOwnerId;
  const 带 = key === "salesOwnerId" && 原负责人 && 原负责人 !== data.salesOwnerId
    ? await 带走并记下([{ customerId: id, 旧: 原负责人 }], data.salesOwnerId as string, me.id)
    : undefined;
  const 带走 = 带?.数;
  if (key === "salesOwnerId" && 原负责人 && 原负责人 !== data.salesOwnerId && !带走?.没转成) await 分给你通知(me, data.salesOwnerId as string, [id], undefined, 带?.留下);
  revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
  await 客户存了推项目(me, id);
  return { ok: true, 带走 };
}

/**
 * 所在地区（国家地区 / 省 / 市 / 区）一起改（企业版，11-04 就地编辑）：四格是一个选择器选出来的，拆开存会存出「中国 + 别国的市」。
 * 规矩同 patchCustomer：同事的客户只读、只有负责人能改、规整同完整表单（规整地址），没变就不写，留痕只记变了的格
 */
export async function patchCustomerRegion(id: string, 址: Partial<客户地址>): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireUser();
  const b = await getBusiness();
  if (!企业版()) return { ok: false, error: "这个字段不能在这里改" };
  if (await 同事的客户(defaultClient, id)) return { ok: false, error: await 只读话(defaultClient) };
  const 挡 = await 改客户挡(me, id);
  if (挡) return { ok: false, error: 挡 };
  const r = 规整地址(址);
  if (!r.ok) return r;
  const before = await prisma.customer.findUnique({ where: { id }, select: { name: true, addrCountry: true, addrProvince: true, addrCity: true, addrDistrict: true } });
  if (!before) return { ok: false, error: `这条${b.customer}已被删除` };
  const 变了 = (Object.keys(r.值) as (keyof 客户地址)[]).filter((k) => (before[k] ?? null) !== r.值[k]);
  if (!变了.length) return { ok: true };
  await prisma.customer.update({ where: { id }, data: r.值 });
  const labels = customerFieldLabels(b);
  await recordAudit({
    user: me, action: "update", entity: "Customer", entityId: id,
    summary: `修改${b.customer}「${before.name}」：所在地区`,
    detail: describeCustomerChanges(变了, before as Record<string, unknown>, r.值, labels),
  });
  revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
  await 客户存了推项目(me, id);
  return { ok: true };
}

/**
 * 客户表单里「推荐人 → 已有客户」的候选，表单打开时才来取（2026-10-20）。
 *
 * 原来客户列表页和详情页出页时就把全部客户的 id + 名字塞进页面数据：1 万客户时
 * 光这一项就几百 KB，每次进列表都要传、要解析，可大多数时候根本没人点开这个下拉。
 * 口径照旧（lib/options.ts 的 可选客户：按名字排，团队里看不到的照旧看不到），
 * 排除自己由表单那边做（原来详情页传了 除了=自己，表单里也滤了一遍，两层是一回事）。
 */
export async function 推荐人候选(): Promise<{ id: string; name: string }[]> {
  await requireUser();
  return 可选客户();
}


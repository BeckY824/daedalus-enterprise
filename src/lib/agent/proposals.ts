/**
 * 写入提议：AI 能提，但落不了库。
 *
 * agent 的工具全部只读，唯一能碰数据的路径是「提议 → 人在卡片上确认 → 调原有的 server action」。
 *
 * 一条重要的分寸：**信息不全不是拒绝的理由**。模型只知道「新建一条线索 吴小雯」时，
 * 正确做法是给一张只填了姓名、其余留空的卡片让人补，而不是在对话里让人照格式打一遍字。
 * 所以这里把"不合法"和"还没填"分开：
 *   不合法（状态值不存在、日期给了但解析不了）→ 当场拒绝，让模型重说
 *   还没填（必填项是空的）                    → 照样出卡片，由 missingFields 拦住确认按钮
 * 校验放在纯函数里，生成时和落库时各跑一遍——卡片上的值人能改，改完的同样不可信。
 */
import { FOLLOW_TYPES, FOLLOW_TYPE_MAP, FOLLOW_METHODS, FOLLOW_STATUSES, DECISION_STATUSES, LEAD_STATUSES, GRADES, OPP_STAGES, STAGE_PROBABILITY } from "../constants";
import { DEFAULT_BUSINESS, statusLabel, 签约叫, type BusinessConfig } from "../business-config";
import { dayjs } from "../utils";
import { 是币种, 金额 } from "../currency";
import { 有效线索节点, 缺有效沟通 } from "../project/stage-gates";
import { 是项目卡, buildProjectProposal, 项目卡缺, 描述项目卡, type 项目卡, type 项目卡Kind } from "./project-proposals";

export type ProposalKind = "set_status" | "add_followup" | "add_plan" | "add_lead" | "update_customer" | "add_opportunity" | "add_contract" | "update_channel"
  /** 全页面 AI 写入的项目类卡（企业版只用项目，见 project-proposals.ts） */
  | 项目卡Kind;

/**
 * 档案里能改的字段。
 *
 * 关系字段（负责人 / 渠道 / 推荐人）这里存的是**名字不是 id**：模型只知道名字，
 * 而且把 id 交给模型意味着它可以编一个出来。名字到 id 的解析放在落库那一步做，
 * 重名时直接报错让人去改，绝不猜——猜错就是把客户挂到别人名下。
 */
export const 可改字段 = {
  name: { label: "姓名", kind: "text" },
  phone: { label: "手机号", kind: "text" },
  school: { label: "院校", kind: "text" },
  grade: { label: "年级", kind: "enum", values: GRADES },
  major: { label: "专业", kind: "text" },
  followStatus: { label: "跟进状态", kind: "enum", values: FOLLOW_STATUSES },
  decisionStatus: { label: "决策状态", kind: "enum", values: DECISION_STATUSES },
  expectedSignAt: { label: "预计签约", kind: "date" },
  remark: { label: "备注", kind: "text" },
  salesOwnerName: { label: "销售负责人", kind: "name" },
  channelName: { label: "来源渠道", kind: "name" },
  referrerName: { label: "推荐人", kind: "name" },
  /** 单独订正这一位的渠道负责人；留空 = 恢复按推荐链。改渠道本身用 propose_channel_update */
  channelOwnerName: { label: "渠道负责人", kind: "name" },
} as const;

export type 字段规格 = { label: string; kind: "text" | "enum" | "date" | "name"; values?: readonly string[] };

/**
 * 这一次请求的字段表。三个档案字段的**名字和选项跟着业务配置走**——
 * 通用版里它们是「公司 / 职位 / 行业」，教培预设下才是「院校 / 年级 / 专业」。
 * 上面那个静态表只当形状和默认值用；真正拿去校验和展示的一律是这个函数的结果，
 * 否则通用版里模型按提示词写「部门负责人」，校验拿教培的年级表一比就当场拒掉。
 */
export function 可改字段表(b: Pick<BusinessConfig, "fields" | "grades"> | null | undefined): Record<可改字段名, 字段规格> {
  const 表 = { ...(可改字段 as Record<可改字段名, 字段规格>) };
  // 半份配置也要能用：这张表会被拼进系统提示词，缺一项不该让整个 agent 崩在那一步
  const f = b?.fields ?? DEFAULT_BUSINESS.fields;
  表.school = { label: f.school, kind: "text" };
  表.grade = { label: f.grade, kind: "enum", values: b?.grades ?? DEFAULT_BUSINESS.grades };
  表.major = { label: f.major, kind: "text" };
  return 表;
}

export type 可改字段名 = keyof typeof 可改字段;
export const 可改字段名单 = Object.keys(可改字段) as 可改字段名[];
export type 一处改动 = { field: 可改字段名; value: string };

type Base = {
  /** 前端按它认卡片；同一轮对话内唯一 */
  id: string;
  /** 新建线索时没有客户，为空 */
  customerId: string;
  customerName: string;
  /** 一句话：为什么建议这么做。给人判断用，不写进库 */
  reason: string;
  /**
   * 这几个字段现在是什么值（字段名 → 现在显示成什么）。
   *
   * 只给卡片做「改之前 → 改之后」用，**不参与校验也不落库**——
   * 落库那一步会用 buildProposal 从头收一遍，这个字段在那儿直接被忽略。
   * 没有它的话，卡片上写着「跟进状态：已签约」，人无从判断这是在改还是本来就是。
   */
  现值?: Record<string, string>;
};

export type Proposal =
  | (Base & { kind: "set_status"; field: "followStatus" | "decisionStatus"; to: string })
  | (Base & { kind: "add_followup"; type: string; title: string; content: string; occurredAt: string })
  | (Base & { kind: "add_plan"; subject: string; plannedAt: string; method: string })
  | (Base & { kind: "add_lead"; name: string; contact: string; phone: string; source: string; status: string; remark: string;
      /** 下一步时间（企业版建成项目用，开了超时回收必填，YYYY-MM-DD）；别的版本不看（10-27） */ nextAt?: string }
      & 线索卡多的格 & 线索建档格)
  | (Base & { kind: "update_customer"; changes: 一处改动[] })
  | (Base & { kind: "add_opportunity"; name: string; amount: number; /** 币种（2026-10-03）。老的建议卡没有：当本位币 */ currency?: string; stage: string; probability: number; expectedDealAt: string; remark: string })
  | (Base & { kind: "add_contract"; amount: number; currency?: string; signedAt: string; remark: string })
  | (Base & { kind: "update_channel"; channelName: string; ownerName: string; phone: string; remark: string })
  | 项目卡;

/**
 * 认名片 / 微信截图出的新线索卡多的几格（2026-11-01）：企业版建成项目时国家、城市进客户地址，邮箱、微信进联系人，
 * WhatsApp 不是企业号码的一种、写进备注（dashboard/apply.ts 建成项目）。
 * 待确认 = 认得没把握、要人在卡上点一下或改一下的格子；还有就不能确认（missingFields）
 */
export type 线索卡多的格 = { country?: string; city?: string; wechat?: string; email?: string; whatsapp?: string; 待确认?: 线索待确认格[] };
export const 线索待确认叫法 = { name: "名称", contact: "联系人", phone: "电话", country: "国家", city: "城市", wechat: "微信", email: "邮箱", whatsapp: "WhatsApp" } as const;
export type 线索待确认格 = keyof typeof 线索待确认叫法;
const 线索多格上限 = { country: 40, city: 40, wechat: 60, email: 100, whatsapp: 30 } as const;

function 收线索多的格(args: Record<string, unknown>): 线索卡多的格 {
  const 出: 线索卡多的格 = {};
  for (const [k, max] of Object.entries(线索多格上限) as [keyof typeof 线索多格上限, number][]) {
    const v = str(args[k], max);
    if (v) 出[k] = v;
  }
  const 待 = Array.isArray(args.待确认) ? [...new Set(args.待确认.filter((k): k is 线索待确认格 => typeof k === "string" && Object.hasOwn(线索待确认叫法, k)))] : [];
  if (待.length) 出.待确认 = 待;
  return 出;
}

/**
 * 企业版只用项目时，新线索卡和「新建项目」对齐的几格（11-04）：分配方式 / 指定的负责人 / 进程 / 明确回复由人在卡上选，
 * 模型不给；业务线、下一步文字、国家城市填到哪模型有把握才给，没把握留空让人选。别的版本不看
 */
export type 区域去处 = "客户" | "联系人" | "项目";
export const 区域去处叫法: Record<区域去处, string> = { 客户: "客户所在区域", 联系人: "联系人所在区域", 项目: "项目所在地" };
export type 线索建档格 = { 分配方式?: number; ownerId?: string; 业务线?: string; 节点?: string; 明确回复?: boolean; 下一步?: string; 区域去处?: 区域去处[] };
const 是区域去处 = (x: unknown): x is 区域去处 => typeof x === "string" && Object.hasOwn(区域去处叫法, x);

/** 模型给 bizLine / nextStep / regionTo；卡片回传的是收好的中文键（业务线 / 下一步 / 区域去处 + 人选的四格），两种都认，再校验一遍 */
function 收线索建档格(args: Record<string, unknown>): 线索建档格 {
  const 出: 线索建档格 = {};
  const 线 = str(args.业务线 ?? args.bizLine, 10);
  if (线 === "内贸" || 线 === "外贸" || 线 === "暂不分配") 出.业务线 = 线;
  const 下 = str(args.下一步 ?? args.nextStep, 100);
  if (下) 出.下一步 = 下;
  const 原去 = args.区域去处 ?? args.regionTo;
  const 去 = Array.isArray(原去) ? [...new Set(原去.filter(是区域去处))] : [];
  if (去.length) 出.区域去处 = 去;
  if (typeof args.分配方式 === "number" && Number.isInteger(args.分配方式) && args.分配方式 >= 0 && args.分配方式 <= 9) 出.分配方式 = args.分配方式;
  const 负责 = str(args.ownerId, 60);
  if (负责) 出.ownerId = 负责;
  const 节 = str(args.节点, 30);
  if (节) 出.节点 = 节;
  if (typeof args.明确回复 === "boolean") 出.明确回复 = args.明确回复;
  return 出;
}

export type ProposalResult = { ok: true; proposal: Proposal } | { ok: false; error: string };

import { parseDateInput } from "@/lib/date-input";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** 模型爱写「2026-09-12 19:00」这类。给了但解析不了要报错；没给就留空让人挑 */
function parseWhen(v: unknown, keepCalendar = false): { ok: true; at: string } | { ok: false } {
  const s = str(v, 40);
  if (!s) return { ok: true, at: "" };
  const normalized = s.replace(/\//g, "-").replace(/[年月]/g, "-").replace(/日/g, "");
  const d = parseDateInput(normalized);
  return d ? { ok: true, at: keepCalendar && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : d.toISOString() } : { ok: false };
}

/** 跟进类型：模型可能给「电话沟通」也可能给「PHONE」，两种都收 */
function normalizeFollowType(v: unknown): string | null {
  const s = str(v, 20);
  if (!s) return null;
  if (FOLLOW_TYPE_MAP[s]) return s;
  return FOLLOW_TYPES.find((t) => t.label === s)?.value ?? null;
}

/** 枚举值：给了就必须对；没给就用默认值 */
function pickEnum(v: unknown, allowed: readonly string[], fallback: string): { ok: true; value: string } | { ok: false } {
  const s = str(v, 20);
  if (!s) return { ok: true, value: fallback };
  return allowed.includes(s) ? { ok: true, value: s } : { ok: false };
}

/** 金额：给了就必须是非负数字；没给记 0，让人在卡片上补 */
function 收金额(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,¥￥\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/** 币种：给了就必须认得（USD / usd 都收）；没给用本位币。返回 null = 给了个认不得的 */
function 收币种(v: unknown, 本位币 = "CNY"): string | null {
  const s = str(v, 10).toUpperCase();
  if (!s) return 本位币;
  return 是币种(s) ? s : null;
}

/** 成交概率：没给返回 undefined，由阶段推一个默认值 */
function 收概率(v: unknown): number | null | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n);
}

export function buildProposal(
  id: string,
  kind: ProposalKind,
  customer: { id: string; name: string },
  args: Record<string, unknown>,
  b: Pick<BusinessConfig, "sources" | "fields" | "grades"> & { currency?: string },
): ProposalResult {
  const base = { id, customerId: customer.id, customerName: customer.name, reason: str(args.reason, 120) };
  if (!base.reason) return { ok: false, error: "reason 必填：用一句话说明为什么建议这么做" };
  if (是项目卡(kind)) return buildProjectProposal(base, kind, args, b);

  if (kind === "set_status") {
    const to = str(args.to, 20);
    const isFollow = (FOLLOW_STATUSES as readonly string[]).includes(to);
    const isDecision = (DECISION_STATUSES as readonly string[]).includes(to);
    if (to && !isFollow && !isDecision) {
      return { ok: false, error: `「${to}」不是合法状态。跟进状态：${FOLLOW_STATUSES.join("/")}；决策状态：${DECISION_STATUSES.join("/")}` };
    }
    return { ok: true, proposal: { ...base, kind, field: isDecision ? "decisionStatus" : "followStatus", to } };
  }

  if (kind === "add_followup") {
    const type = normalizeFollowType(args.type) ?? "";
    if (args.type && !type) return { ok: false, error: `type 必须是这几种之一：${FOLLOW_TYPES.map((t) => t.label).join("/")}` };
    const when = parseWhen(args.occurredAt);
    if (!when.ok) return { ok: false, error: "occurredAt 解析不了，用 YYYY-MM-DD HH:mm" };
    return {
      ok: true,
      // 不给时间就算刚刚发生的——补录一次沟通，默认"现在"几乎总是对的
      proposal: { ...base, kind, type: type || "PHONE", title: str(args.title, 60), content: str(args.content, 2000), occurredAt: when.at || dayjs().toISOString() },
    };
  }

  if (kind === "add_plan") {
    const when = parseWhen(args.plannedAt, true);
    if (!when.ok) return { ok: false, error: "plannedAt 解析不了，用 YYYY-MM-DD HH:mm" };
    // 方式能选也能填（2026-10-02 用户定）：认得出就用规范的写法，认不出也照收（人在卡上自己填的、模型说的「抖音私信」）
    const m = pickEnum(args.method, FOLLOW_METHODS, "");
    const method = m.ok ? m.value : str(args.method, 20);
    return { ok: true, proposal: { ...base, kind, subject: str(args.subject, 100), plannedAt: when.at, method } };
  }

  if (kind === "update_customer") {
    const raw = args.changes;
    if (!raw || typeof raw !== "object") return { ok: false, error: "changes 必填：一个对象，键是字段名、值是要改成什么" };
    /**
     * 两种形状都要认：
     *   模型给的是 {followStatus: "已签约"}
     *   卡片回传的是 [{field:"followStatus", value:"已签约"}]——因为落库前会拿
     *   **已经建好的提议**再校验一遍（人在卡片上改过的值同样不可信）
     * 只认前一种的话，这条重新校验的路会把每张卡都判成"没有「0」这个字段"。
     */
    const 条目: [string, unknown][] = Array.isArray(raw)
      ? (raw as unknown[]).map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          return [String(o.field ?? ""), o.value];
        })
      : Object.entries(raw as Record<string, unknown>);
    const changes: 一处改动[] = [];
    for (const [k, v] of 条目) {
      if (!(k in 可改字段)) return { ok: false, error: `没有「${k}」这个字段。能改的是：${可改字段名单.join("、")}` };
      const f = k as 可改字段名;
      const spec = 可改字段表(b)[f];
      // 枚举给错当场拒，让模型重说；给空是"还没填"，照样出卡片让人补
      if (spec.kind === "enum") {
        const e = pickEnum(v, spec.values ?? [], "");
        if (!e.ok) return { ok: false, error: `${spec.label}必须是：${(spec.values ?? []).join("/")}` };
        changes.push({ field: f, value: e.value });
        continue;
      }
      if (spec.kind === "date") {
        const w = parseWhen(v, true);
        if (!w.ok) return { ok: false, error: `${spec.label}解析不了，用 YYYY-MM-DD` };
        changes.push({ field: f, value: w.at });
        continue;
      }
      changes.push({ field: f, value: str(v, 500) });
    }
    if (!changes.length) return { ok: false, error: "changes 是空的，没有要改的字段" };
    return { ok: true, proposal: { ...base, kind, changes } };
  }

  if (kind === "add_opportunity") {
    const stage = pickEnum(args.stage, OPP_STAGES, OPP_STAGES[0]);
    if (!stage.ok) return { ok: false, error: `stage 必须是：${OPP_STAGES.join("/")}` };
    const when = parseWhen(args.expectedDealAt);
    if (!when.ok) return { ok: false, error: "expectedDealAt 解析不了，用 YYYY-MM-DD" };
    const amount = 收金额(args.amount);
    if (amount === null) return { ok: false, error: "amount 要是个非负数字" };
    const currency = 收币种(args.currency, b.currency);
    if (currency === null) return { ok: false, error: "currency 要是三位币种代码，如 USD / EUR / CNY" };
    const p = 收概率(args.probability);
    if (p === null) return { ok: false, error: "probability 要在 0~100 之间" };
    return {
      ok: true,
      proposal: { ...base, kind, name: str(args.name, 60), amount, currency, stage: stage.value, probability: p ?? STAGE_PROBABILITY[stage.value] ?? 10, expectedDealAt: when.at, remark: str(args.remark, 500) },
    };
  }

  /**
   * 改渠道。单独一种卡，因为**渠道负责人不是客户身上的字段**——
   * 它挂在 Channel 上，整条推荐链继承（见 CustomerForm 的注释：
   * 「渠道归属与渠道负责人由系统按推荐链自动计算」）。
   * 模型原来找不到这个字段时会往「来源渠道」「推荐人」上硬套，
   * 把一个销售的名字填进渠道栏。给它一条正确的路，比让它猜强。
   */
  if (kind === "update_channel") {
    const 渠道 = str(args.channelName, 60);
    if (!渠道) return { ok: false, error: "channelName 必填：要改哪个渠道" };
    return {
      ok: true,
      proposal: {
        ...base,
        kind,
        channelName: 渠道,
        ownerName: str(args.ownerName, 20),
        phone: str(args.phone, 30),
        remark: str(args.remark, 500),
      },
    };
  }

  if (kind === "add_contract") {
    const when = parseWhen(args.signedAt);
    if (!when.ok) return { ok: false, error: "signedAt 解析不了，用 YYYY-MM-DD" };
    const amount = 收金额(args.amount);
    if (amount === null) return { ok: false, error: "amount 要是个非负数字" };
    const currency = 收币种(args.currency, b.currency);
    if (currency === null) return { ok: false, error: "currency 要是三位币种代码，如 USD / EUR / CNY" };
    return { ok: true, proposal: { ...base, kind, amount, currency, signedAt: when.at, remark: str(args.remark, 500) } };
  }

  // 来源能选也能填（同上）：列表外的照收，限 30 字
  const 认 = pickEnum(args.source, b.sources, "其他");
  const src = { value: 认.ok ? 认.value : str(args.source, 30) || "其他" };
  const st = pickEnum(args.status, LEAD_STATUSES, "待跟进");
  if (!st.ok) return { ok: false, error: `status 必须是：${LEAD_STATUSES.join("/")}` };
  const 下一步 = parseWhen(args.nextAt, true);
  if (!下一步.ok) return { ok: false, error: "nextAt 解析不了，用 YYYY-MM-DD" };
  return {
    ok: true,
    proposal: {
      ...base,
      kind: "add_lead",
      name: str(args.name, 60),
      contact: str(args.contact, 40),
      phone: str(args.phone, 30),
      source: src.value,
      status: st.value,
      remark: str(args.remark, 500),
      ...(下一步.at ? { nextAt: 下一步.at } : {}),
      ...收线索多的格(args),
      ...收线索建档格(args),
    },
  };
}

/**
 * 还差哪些必填项。空数组 = 可以确认。
 * 卡片用它决定「确认」按钮能不能点，服务端用它兜底——前端禁用按钮不算防线。
 */
/** 卡片上说话要跟模版走的那几样（外贸：签约叫订单、「已签约」显示成「已下单」，2026-10-06 F.3） */
type 叫法 = Pick<BusinessConfig, "statusLabels" | "template"> | null | undefined;

/**
 * 企业版只用项目时新线索卡多两样必填（2026-10-28）：建成的是线索阶段的项目，要挂渠道（dashboard/apply.ts 建成项目）；
 * 开了超时回收还要「下一步」时间（lib/project/wizard.ts 规整沟通）。不给就只认名称，和原来一样
 */
export type 建档必填 = { 只用项目: boolean; 要下一步: boolean;
  /**
   * 和「新建项目」一样的那几样（11-04）：有分配方式可选就必选、选「指定分配」要选负责人、业务线、进程、明确回复，
   * 进程排在有效线索之后要「客户明确回复了」；卡上有国家 / 城市要选填到哪。不传 = 老卡只查上面两样
   */
  企业?: { 有分配方式: boolean; 节点们: readonly string[] } };

export function missingFields(p: Proposal, b?: 叫法, 建档?: 建档必填): string[] {
  if (是项目卡(p.kind)) return 项目卡缺(p as 项目卡);
  const miss: string[] = [];
  if (p.kind === "set_status" && !p.to) miss.push("新状态");
  if (p.kind === "add_followup" && p.content.trim().length < 4) miss.push("沟通内容");
  if (p.kind === "add_plan") {
    if (!p.subject.trim()) miss.push("谈什么");
    if (!p.plannedAt) miss.push("时间");
    if (!p.method) miss.push("方式");
  }
  if (p.kind === "add_lead") {
    // 企业版和新建项目同叫法：客户名称（组织 / 公司）、联系人姓名都必填（11-04）
    const 企格 = 建档?.只用项目 ? 建档.企业 : undefined;
    if (!p.name.trim()) miss.push(企格 ? "客户名称" : "名称");
    if (企格 && !p.contact.trim()) miss.push("联系人姓名");
    if (建档?.只用项目 && !p.source.trim()) miss.push("来源（渠道）");
    if (建档?.只用项目 && 建档.要下一步 && !p.nextAt) miss.push("下一步时间");
    const 企 = 企格;
    if (企) {
      if (企.有分配方式 && typeof p.分配方式 !== "number") miss.push("分配方式");
      if ((!企.有分配方式 || p.分配方式 === 0) && !p.ownerId) miss.push("项目负责人");
      if (!p.业务线) miss.push("业务线");
      if (!p.节点 || !企.节点们.includes(p.节点)) miss.push("当前进程");
      if (typeof p.明确回复 !== "boolean") miss.push("客户明确回复了吗");
      else if (p.节点 && 企.节点们.indexOf(p.节点) > 企.节点们.indexOf(有效线索节点) && !p.明确回复) miss.push(缺有效沟通);
      if ((p.country?.trim() || p.city?.trim()) && !p.区域去处?.length) miss.push("国家 / 城市填到哪");
    }
    for (const k of p.待确认 ?? []) miss.push(`确认「${线索待确认叫法[k]}」`);
  }
  if (p.kind === "update_customer") {
    for (const c of p.changes) {
      const spec = 可改字段[c.field];
      // 姓名和负责人清空会让记录立不住；其余字段留空是合法的"清掉这一项"
      if ((c.field === "name" || c.field === "salesOwnerName") && !c.value.trim()) miss.push(spec.label);
      if (spec.kind === "enum" && !c.value) miss.push(spec.label);
    }
  }
  if (p.kind === "add_opportunity") {
    if (!p.name.trim()) miss.push("商机名称");
    if (!p.amount) miss.push("金额");
  }
  if (p.kind === "add_contract") {
    if (!p.amount) miss.push(签约叫(b) === "订单" ? "订单金额" : "签约金额");
    if (!p.signedAt) miss.push(签约叫(b) === "订单" ? "订单确认时间" : "签约日期");
  }
  if (p.kind === "update_channel" && !p.ownerName.trim() && !p.phone.trim() && !p.remark.trim()) miss.push("要改什么");
  return miss;
}

/** 卡片抬头：一句话说清这张卡会改什么 */
export function describeProposal(p: Proposal, customerNoun: string, 字段表: Record<可改字段名, 字段规格> = 可改字段 as Record<可改字段名, 字段规格>, b?: 叫法): string {
  if (p.kind === "set_status") {
    const f = p.field === "followStatus" ? "跟进状态" : "决策状态";
    // p.to 是存储值（「已签约」），说给人听要用这家的叫法（外贸「已下单」、通用「已试听」照业务配置）
    return `把${customerNoun}「${p.customerName}」的${f}改成「${p.to ? statusLabel(b, p.to) : "…"}」`;
  }
  if (p.kind === "add_followup") return `给「${p.customerName}」记一条${FOLLOW_TYPE_MAP[p.type]?.label ?? p.type}`;
  if (p.kind === "add_plan") return `给「${p.customerName}」排一次${p.method || "跟进"}`;
  if (p.kind === "update_customer") {
    const 项 = p.changes.map((c) => 字段表[c.field].label);
    return `改${customerNoun}「${p.customerName}」的${项.join("、")}`;
  }
  if (p.kind === "add_opportunity") return `给「${p.customerName}」新建商机${p.name ? `「${p.name}」` : ""}`;
  if (p.kind === "add_contract") return `给「${p.customerName}」记一笔${签约叫(b)}${p.amount ? ` ${金额(p.amount, p.currency)}` : ""}`;
  if (p.kind === "update_channel") {
    const 项 = [p.ownerName && "负责人", p.phone && "电话", p.remark && "备注"].filter(Boolean);
    return `改渠道「${p.channelName}」的${项.join("、") || "信息"}`;
  }
  if (p.kind === "add_lead") return `新建一条线索${p.name ? `「${p.name}」` : ""}`;
  return 描述项目卡(p);
}

/** 落库后写进操作日志的那句话 */
export function summarizeApplied(p: Proposal, customerNoun: string, b?: 叫法): string {
  return `确认 AI 建议：${describeProposal(p, customerNoun, undefined, b)}`;
}

/**
 * 逐项确认：只留人勾上的那几项改动。
 *
 * 建议卡上一张卡可能建议改三个字段，人只认其中两个。没勾的那一项
 * **必须整条不出现在提交里**——留着值只是把界面上的勾当装饰，
 * 服务端那边照样会写进去。
 *
 * 不是改档案的卡原样返回：它们本来就只有一件事，没有「逐项」可言。
 */
export function 只留选中的改动(p: Proposal, 勾了: number[]): Proposal {
  if (p.kind !== "update_customer") return p;
  return { ...p, changes: p.changes.filter((_, i) => 勾了.includes(i)) };
}

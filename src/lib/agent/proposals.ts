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
import { FOLLOW_TYPES, FOLLOW_TYPE_MAP, FOLLOW_METHODS, FOLLOW_STATUSES, DECISION_STATUSES, LEAD_STATUSES, GRADES } from "../constants";
import { DEFAULT_BUSINESS, statusLabel, 签约叫, type BusinessConfig } from "../business-config";
import { dayjs } from "../utils";
import { 是币种, 金额 } from "../currency";
import { 认金额, 金额字带币, 币种对不上话 } from "../money-input";
import { 有效线索节点, 建档不能过线索验证 } from "../project/stage-gates";
import { 是项目卡, buildProjectProposal, 项目卡缺, 描述项目卡, type 项目卡, type 项目卡Kind } from "./project-proposals";
import { 内置号码种类, 每人最多号码, 号码上限 } from "../enterprise/customer-v2";
import { 字典定义 } from "../enterprise/dict-kinds";
import { 认出备注里的号码 } from "../enterprise/remark-numbers";
import { 没国家认得出 } from "../enterprise/cn-place";
import { 对得上的方式 } from "../follow-method";
import { hasVisibleText } from "../form-validation";
import { 企业版 } from "../enterprise/switch";

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
/**
 * AI 改客户卡能提的字段（服务端用：拼提示词、校验）。企业版客户没有电话（E-260，客户「客户没有电话这一说法」），不列 phone；
 * 卡片展示照旧用 可改字段表（老卡上带的 phone 也叫得出名字，落库时 dashboard/apply.ts 拦）
 */
export function 档案能改的字段(): 可改字段名[] {
  return 企业版() ? 可改字段名单.filter((f) => f !== "phone") : 可改字段名单;
}
/**
 * 不指向任何工具（复审 1）：propose_contact_update 不改电话 / 邮箱 / 微信（project-tools.ts 联系人可改），也只在项目模式有；
 * AI 不改号码，叫人自己到客户详情的联系人卡上改
 */
export const 客户卡不收电话话 = "客户本身没有电话，号码在联系人上；AI 不改号码，请到客户详情的联系人卡上改";
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
  /**
   * projectId：企业版卡上选的关联项目（11-17 沟通必须挂项目，几个在推项目时人在卡上选）；模型不给。
   * method：企业版沟通方式（11-18：AI 没给类型时按个人习惯带上，和类型对得上才留）
   */
  | (Base & { kind: "add_followup"; type: string; title: string; content: string; occurredAt: string; projectId?: string; method?: string })
  | (Base & { kind: "add_plan"; subject: string; plannedAt: string; method: string })
  | (Base & { kind: "add_lead"; name: string; contact: string; phone: string; source: string; status: string; remark: string;
      /** 下一步时间（企业版建成项目用，开了超时回收必填，YYYY-MM-DD）；别的版本不看（10-27） */ nextAt?: string;
      /** 联系方式几行（类型 + 号码，企业版，11-17 员工反馈「只能填电话」）；没有 = 老卡，按 phone / 微信 / 邮箱 / WhatsApp 几格算（线索号码行） */
      联系方式?: 线索联系方式[] }
      & 线索卡多的格 & 线索建档格)
  | (Base & { kind: "update_customer"; changes: 一处改动[] })
  /** 老对话存档里的商机卡：建议工具 propose_opportunity 2026-11-11 已删，不再生成；卡片只认出来、显示成不可用（dashboard/apply.ts 也拦） */
  | (Base & { kind: "add_opportunity"; name?: string })
  | (Base & { kind: "add_contract"; amount: number; currency?: string; signedAt: string; remark: string })
  | (Base & { kind: "update_channel"; channelName: string; ownerName: string; phone: string; remark: string })
  | 项目卡;

/**
 * 认名片 / 微信截图出的新线索卡多的几格（2026-11-01）：企业版建成项目时国家、城市进客户地址，邮箱、微信进联系人，
 * WhatsApp 不是企业号码的一种、写进备注（dashboard/apply.ts 建成项目）。
 * 待确认 = 认得没把握、要人在卡上点一下或改一下的格子；还有就不能确认（missingFields）
 */
export type 线索卡多的格 = { country?: string; province?: string; city?: string; district?: string; address?: string; position?: string; wechat?: string; email?: string; whatsapp?: string; 待确认?: 线索待确认格[] };
export const 线索待确认叫法 = { name: "名称", contact: "联系人", phone: "电话", country: "国家", province: "省", city: "城市", district: "区县", address: "详细地址", position: "职位", wechat: "微信", email: "邮箱", whatsapp: "WhatsApp", 联系方式: "联系方式" } as const;
export type 线索待确认格 = keyof typeof 线索待确认叫法;
const 线索多格上限 = { country: 40, province: 40, city: 40, district: 40, address: 100, position: 40, wechat: 60, email: 100, whatsapp: 30 } as const;

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
 * 新线索卡的联系方式（11-17 员工反馈：「只能填电话，无法添加其他类型的联系方式」）：和联系人表单同一套「类型 + 号码」，
 * kind = ContactMethod.kind（customer-v2.ts 内置号码种类），顺序、叫法照号码类型字典的默认八项（V-号码类型）。
 * 确认后按类型记进联系人的联系方式子表（dashboard/apply.ts 建成项目 → 建档向导），和手工加联系人存的一样
 */
export type 线索联系方式 = { kind: string; value: string };
export const 线索号码种类: readonly { kind: string; 名: string }[] = 内置号码种类.map((x, i) => ({ kind: x.kind, 名: 字典定义.contactKind.默认[i] }));
export const 线索号码上限 = 每人最多号码;
/**
 * 给模型的那句（工具参数说明、系统提示里都用这一句）：类型按格式判断，判断不了就问；号码不进名称 / 联系人姓名（P-抬头-13）
 */
export const 线索号码说明 =
  "联系方式，可多条。用户只给了号码时按格式判断类型：含 @ 的是邮箱；纯数字长串多为手机（+ 开头的国外号、人提到 WhatsApp 的算 WhatsApp）；" +
  "字母开头、字母数字混合的多为微信号；判断不了就先问人。号码、微信号、邮箱只放这里，不要填进 name（客户名称）或 contact（联系人姓名）——不知道名字就留空";
/** 模型给的类型认法：kind 本身、字典叫法，再加几个常见说法 */
const 号码类型别名: Record<string, string> = {
  手机号: "phone", 电话: "phone", 移动电话: "phone", mobile: "phone", 固话: "landline", 固定电话: "landline", 座机号: "landline",
  微信号: "wechat", email: "email", 电子邮箱: "email", 邮件: "email", 旺旺: "wangwang", 旺旺id: "wangwang", 阿里id: "wangwang", 阿里旺旺: "wangwang", 阿里国际站: "wangwang",
  传真号: "fax", tg: "telegram",
};
export function 认号码种类名(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  const 小 = s.toLowerCase().replace(/\s+/g, "");
  const 有 = 线索号码种类.find((x) => x.kind === 小 || x.名.toLowerCase().replace(/\s+/g, "") === 小);
  return 有?.kind ?? 号码类型别名[小] ?? null;
}

/**
 * 这张卡的联系方式几行（空号去掉）。新卡用「联系方式」；老卡（11-17 之前生成的、名片认出来的）没有这格，
 * 按老格子算：电话当手机，微信、邮箱、WhatsApp 各自那一类
 */
export function 线索号码行(p: { 联系方式?: 线索联系方式[]; phone?: string; wechat?: string; email?: string; whatsapp?: string }): 线索联系方式[] {
  if (Array.isArray(p.联系方式)) return p.联系方式.filter((x) => x.value.trim());
  return ([["phone", p.phone], ["wechat", p.wechat], ["email", p.email], ["whatsapp", p.whatsapp]] as const)
    .flatMap(([kind, v]) => (v?.trim() ? [{ kind, value: v.trim() }] : []));
}

/** 模型给 numbers: [{type, value}]，卡片回传 联系方式: [{kind, value}]；类型认不出当场拒（让模型重说），空号丢掉 */
function 收联系方式(args: Record<string, unknown>): { ok: true; 行们?: 线索联系方式[] } | { ok: false; error: string } {
  const 原 = args.联系方式 ?? args.numbers;
  if (原 === undefined || 原 === null) return { ok: true };
  if (!Array.isArray(原)) return { ok: false, error: "numbers 要是数组：[{\"type\": \"微信\", \"value\": \"号码\"}]" };
  const 行们: 线索联系方式[] = [];
  for (const x of 原) {
    const o = (x ?? {}) as Record<string, unknown>;
    const value = str(o.value ?? o.号码, 号码上限);
    const 类 = o.kind ?? o.type ?? o.类型;
    const kind = 认号码种类名(类);
    if (!kind) {
      if (!value && !类) continue;
      return { ok: false, error: `号码类型「${String(类 ?? "")}」不认得，只能是：${线索号码种类.map((k) => k.名).join("/")}` };
    }
    if (value) 行们.push({ kind, value });
  }
  if (行们.length > 线索号码上限) return { ok: false, error: `联系方式最多 ${线索号码上限} 个` };
  return { ok: true, 行们 };
}

/** 邮箱、或一串号码的样子（P-抬头-13：号码、微信号、邮箱不当客户名 / 联系人姓名） */
const 像邮箱 = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const 像号码 = /^[+＋]?[\d\s\-()（）]{6,}$/;
const 号比较键 = (s: string) => s.trim().toLowerCase().replace(/^[@+＋]/, "").replace(/[\s\-()（）]/g, "");
/**
 * 名称 / 联系人填的是不是一个号（11-17 员工反馈：只给了微信号，AI 把它同时填进客户名称和电话）：
 * 和这张卡上任一个号一样（不分大小写、不看分隔符），或者本身就是邮箱、一串数字。是就当没填，让人在卡上补
 */
export function 是号码当名字(名: string, 号们: readonly 线索联系方式[]): boolean {
  const s = 名.trim();
  if (!s) return false;
  if (像邮箱.test(s) || 像号码.test(s)) return true;
  const 键 = 号比较键(s);
  return !!键 && 号们.some((x) => 号比较键(x.value) === 键);
}

/**
 * 企业版只用项目时，新线索卡和「新建项目」对齐的几格（11-04）：分配方式 / 指定的负责人 / 进程由人在卡上选（11-05 去掉明确回复），
 * 模型不给（只给原话里的「分给谁」assignTo，卡上认出唯一一位才预选，人仍确认，1E）；业务线、下一步文字、国家城市填到哪模型有把握才给，没把握留空让人选。别的版本不看
 */
export type 区域去处 = "客户" | "联系人" | "项目";
export const 区域去处叫法: Record<区域去处, string> = { 客户: "客户所在区域", 联系人: "联系人所在区域", 项目: "项目所在地" };
export type 线索建档格 = { 分配方式?: number; ownerId?: string; 业务线?: string; 节点?: string; 下一步?: string; 区域去处?: 区域去处[];
  /** 原话里说的「分给谁」（模型原样给的名字，1E）：卡上按负责人候选认出唯一一位才预选指定分配 + 那一位（assign-line.ts 认分给），落库只认 分配方式 / ownerId */
  分给?: string;
  /** 指定回复时间（11-17，选填）：卡上人选的两格，北京墙钟「YYYY-MM-DD HH:mm」（lib/project/time-fields.ts） */
  指定回复开始?: string; 指定回复结束?: string;
  /** 指定分配时间（11-17 PR3，选填）：卡上选「指定时间」时的北京墙钟；空 = 现在分配 */
  定时分配?: string;
  /** 分配方向（11-18）：市场成员选自动分配时卡上人手动选的内贸 / 外贸；没选 = 服务端按 区域 → 电话 → 本人事业部 算。模型不给 */
  分配方向?: "内贸" | "外贸" };
const 是区域去处 = (x: unknown): x is 区域去处 => typeof x === "string" && Object.hasOwn(区域去处叫法, x);

/**
 * 卡上的国家 / 省 / 城市落到哪（dashboard/apply.ts 落库、卡上显示「按客户区域自动定」共用，11-18 加急）：
 * 勾了哪几格填哪几格；老卡没这格（区域去处 undefined）有区域就只进客户地址。
 * 只写了省 / 城市没写国家的：认得出是大陆地名（cn-place.ts 像国内地名：省、地级市、名单里的县级市，「杭州」「浙江省」「义乌市」）
 * 或港澳台地名（「台北市」「湾仔区」「九龙」）就照填，规整地址 补「中国」，客户区域再按港澳台判非大陆（customer-region.ts）——
 * 原来没国家一律不填，写了城市哪都没落，市场自动分配成了「区域未知」两条线都算；认不出的（「多伦多」「胡志明市」「大阪市」，审核 11-18 P0-2）
 * 不填，免得国外城市被当成国内，分配方向退到电话 → 本人事业部，卡上显示怎么定的，人补上国家再确认。联系人地址是一格文字，照原样拼
 */
type 卡上四格 = { addrCountry: string | null; addrProvince: string | null; addrCity: string | null; addrDistrict: string | null };
export function 线索卡地址(p: 线索卡多的格 & Pick<线索建档格, "区域去处">): {
  客户: (卡上四格 & { addrDetail: string | null }) | null;
  项目: (卡上四格 & { location: string | null }) | null;
  联系人: string;
} {
  const 国 = p.country?.trim() || "", 省 = p.province?.trim() || "", 市 = p.city?.trim() || "", 区 = p.district?.trim() || "", 详 = p.address?.trim() || "";
  if (!国 && !省 && !市 && !区 && !详) return { 客户: null, 项目: null, 联系人: "" };
  const 去处 = p.区域去处 ?? ["客户"];
  const 认得 = !!国 || 没国家认得出(省, 市, 区);
  const 四格: 卡上四格 = 认得 ? { addrCountry: 国 || null, addrProvince: 省 || null, addrCity: 市 || null, addrDistrict: 区 || null } : { addrCountry: null, addrProvince: null, addrCity: null, addrDistrict: null };
  // 详细地址（客户地址 addrDetail / 项目 location）是自由文字，区域认不出也照存；四格和详细地址都没有 = 不动
  const 有 = 认得 || !!详;
  return {
    客户: 有 && 去处.includes("客户") ? { ...四格, addrDetail: 详 || null } : null,
    项目: 有 && 去处.includes("项目") ? { ...四格, location: 详 || null } : null,
    联系人: 去处.includes("联系人") ? [国, 省, 市, 区, 详].filter(Boolean).join(" ") : "",
  };
}

/**
 * 模型没给「国家 / 城市填到哪」（regionTo）、卡上又有国家 / 省 / 城市 / 区县 / 详细地址的：默认勾「客户所在区域」（11-18 客户：外国城市和中国城市一样默认勾，
 * 原来外国城市模型常不给，确认时报「还差国家 / 城市填到哪」）。人在卡上照样能改勾、全取消。只在生成卡片时补（tools.ts），卡片交回来的不补
 */
export function 默认填到客户(p: Proposal): Proposal {
  if (p.kind !== "add_lead" || p.区域去处?.length) return p;
  const 有 = [p.country, p.province, p.city, p.district, p.address].some((x) => !!x?.trim());
  return 有 ? { ...p, 区域去处: ["客户"] } : p;
}

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
  const 给 = str(args.分给 ?? args.assignTo, 30);
  if (给) 出.分给 = 给;
  // 指定回复时间：认得出的才收（北京墙钟），认不出的丢掉、让人在卡上重选
  const 回始 = str(args.指定回复开始, 20), 回终 = str(args.指定回复结束, 20);
  if (北京墙钟转时刻(回始)) 出.指定回复开始 = 回始;
  if (北京墙钟转时刻(回终)) 出.指定回复结束 = 回终;
  const 定时 = str(args.定时分配, 20);
  if (北京墙钟转时刻(定时)) 出.定时分配 = 定时;
  if (args.分配方向 === "内贸" || args.分配方向 === "外贸") 出.分配方向 = args.分配方向;
  return 出;
}

export type ProposalResult = { ok: true; proposal: Proposal } | { ok: false; error: string };

import { parseDateInput } from "@/lib/date-input";
import { 北京墙钟转时刻 } from "@/lib/project/time-fields";

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

/** 金额：给了就必须是非负数字；没给记 0，让人在卡片上补。模型交的字串用 认金额 认（和金额框、导入同一个：「¥19,800」「3万」「3w」都认，「约5万」拒） */
function 收金额(v: unknown): number | null {
  if (v === undefined || v === null || String(v).trim() === "") return 0;
  const n = typeof v === "number" ? v : 认金额(String(v));
  if (n === null || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/** 币种：给了就必须认得（USD / usd 都收）；没给用本位币。返回 null = 给了个认不得的 */
function 收币种(v: unknown, 本位币 = "CNY"): string | null {
  const s = str(v, 10).toUpperCase();
  if (!s) return 本位币;
  return 是币种(s) ? s : null;
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
    // 方式（企业版）：和类型对得上才留（卡上人换了类型，原来带的方式就不作数）。AI 没给类型时，提议工具先按个人习惯填了类型和方式（tools.ts）
    const 定类型 = type || "PHONE";
    const method = 对得上的方式(定类型, str(args.method, 20));
    return {
      ok: true,
      // 不给时间就算刚刚发生的——补录一次沟通，默认"现在"几乎总是对的
      proposal: {
        ...base, kind, type: 定类型, title: str(args.title, 60), content: str(args.content, 2000), occurredAt: when.at || dayjs().toISOString(),
        ...(method ? { method } : {}),
        ...(typeof args.projectId === "string" && args.projectId ? { projectId: args.projectId.slice(0, 64) } : {}),
      },
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
      if (!(k in 可改字段) || (k === "phone" && 企业版())) {
        // 企业版客户没有电话（E-260）：号码在联系人上，AI 不改号码、叫人到联系人卡上改（落库那一步 dashboard/apply.ts 改档案 同样拦）
        if (k === "phone") return { ok: false, error: 客户卡不收电话话 };
        return { ok: false, error: `没有「${k}」这个字段。能改的是：${档案能改的字段().join("、")}` };
      }
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

  // 老对话存档里的商机卡（工具 2026-11-11 已删）：确认时 dashboard/apply.ts 拿它重收一遍，这里直接拒
  if (kind === "add_opportunity") return { ok: false, error: "这里商机是项目的一个阶段：请到项目页把它推到商机阶段" };

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
    const 字币 = 金额字带币(args.amount);
    // currency 没给：amount 里写了记号（「$5000」「5万元」）就按记号，没写才按本位币；
    // 记号也能算本位币（港币本位交「$5000」、日元本位交「¥50万」）就按本位币，不把「$」一律当美元（审查 11-20 第二轮）
    const currency = 收币种(args.currency, 字币 ? (b.currency && 字币.可为.includes(b.currency) ? b.currency : 字币.币) : b.currency);
    if (currency === null) return { ok: false, error: "currency 要是三位币种代码，如 USD / EUR / CNY" };
    if (字币 && !字币.可为.includes(currency)) return { ok: false, error: 币种对不上话(String(args.amount).trim(), 字币.币, currency) };
    return { ok: true, proposal: { ...base, kind, amount, currency, signedAt: when.at, remark: str(args.remark, 500) } };
  }

  // 来源能选也能填（同上）：列表外的照收，限 30 字
  const 认 = pickEnum(args.source, b.sources, "其他");
  const src = { value: 认.ok ? 认.value : str(args.source, 30) || "其他" };
  const st = pickEnum(args.status, LEAD_STATUSES, "待跟进");
  if (!st.ok) return { ok: false, error: `status 必须是：${LEAD_STATUSES.join("/")}` };
  const 下一步 = parseWhen(args.nextAt, true);
  if (!下一步.ok) return { ok: false, error: "nextAt 解析不了，用 YYYY-MM-DD" };
  const 号 = 收联系方式(args);
  if (!号.ok) return 号;
  const 多的格 = 收线索多的格(args);
  // 号码、微信号、邮箱不当名字（P-抬头-13）：和卡上的号一样、或本身像个号的，名称 / 联系人当没填
  // 新格和老格（电话 / 微信 / 邮箱 / WhatsApp）一起给了：老格里多出来的并进联系方式，不丢。卡片回传前已把老格清掉（ProposalCard）
  const 老号们 = 线索号码行({ phone: str(args.phone, 30), ...多的格 });
  const 新号们 = 号.行们 && [...号.行们, ...老号们.filter((o) => !号.行们!.some((x) => x.kind === o.kind && x.value.trim() === o.value))];
  const 号们 = 新号们 ?? 老号们;
  const 名 = str(args.name, 60), 联系人 = str(args.contact, 40);
  return {
    ok: true,
    proposal: {
      ...base,
      kind: "add_lead",
      name: 是号码当名字(名, 号们) ? "" : 名,
      contact: 是号码当名字(联系人, 号们) ? "" : 联系人,
      phone: str(args.phone, 30),
      ...(新号们 ? { 联系方式: 新号们 } : {}),
      source: src.value,
      status: st.value,
      remark: str(args.remark, 500),
      ...(下一步.at ? { nextAt: 下一步.at } : {}),
      ...多的格,
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
   * 和「新建项目」一样的那几样（11-04）：有分配方式可选就必选、选「指定分配」要选负责人、业务线、进程，
   * 进程不能过线索验证（11-05）；卡上有国家 / 城市要选填到哪。不传 = 老卡只查上面两样
   */
  企业?: { 有分配方式: boolean; 节点们: readonly string[];
    /** 市场成员（按岗位，P-转-26）：选自动分配时业务线不用选，按客户区域定（建档向导同口径） */
    按区域?: boolean } };

export function missingFields(p: Proposal, b?: 叫法, 建档?: 建档必填): string[] {
  if (是项目卡(p.kind)) return 项目卡缺(p as 项目卡);
  const miss: string[] = [];
  if (p.kind === "set_status" && !p.to) miss.push("新状态");
  // 这里只拦空的（同 saveFollowUp）。不足 4 个字的拦不拦看组织开关「无意义沟通不能保存」（F-052，默认开）：卡上（ProposalCard 跟进无意义）按开关拦、
  // FollowMeaningLine 说一行，服务端 沟通无意义挡 再判；开关关着照存（E-259 只说不算有效沟通）。占位词照存
  if (p.kind === "add_followup" && !hasVisibleText(p.content)) miss.push("沟通内容");
  if (p.kind === "add_plan") {
    if (!p.subject.trim()) miss.push("谈什么");
    if (!p.plannedAt) miss.push("时间");
    if (!p.method) miss.push("方式");
  }
  if (p.kind === "add_lead") {
    // 企业版和新建项目同叫法：客户名称（组织 / 公司）。11-19 起企业版客户名称选填（用户「AI 录入什么都是一样的」，同新建弹窗、saveCustomer）；
    // 别的版本照旧必填
    const 企格 = 建档?.只用项目 ? 建档.企业 : undefined;
    if (!p.name.trim() && !企格) miss.push("名称");
    // 联系人姓名 11-17 起选填（员工反馈：市场录入时常常不知道）；联系方式任一类型必填（M-必填-01），全空才拦
    // 备注里认得出的邮箱 / 微信 / 阿里国际站ID 也算（落库时 dashboard/apply.ts 同样认出来记进联系人）
    if (企格 && !线索号码行(p).length && !认出备注里的号码(p.remark || "").号们.length) miss.push("联系方式");
    // 人在卡上把号填进名称 / 联系人（P-抬头-13）：卡上先拦住；服务端 buildProposal 收的时候当没填
    if (企格 && 是号码当名字(p.name, 线索号码行(p))) miss.push("客户名称（不能填号码）");
    if (企格 && 是号码当名字(p.contact, 线索号码行(p))) miss.push("联系人姓名（不能填号码）");
    if (建档?.只用项目 && !p.source.trim()) miss.push("来源（渠道）");
    if (建档?.只用项目 && 建档.要下一步 && !p.nextAt) miss.push("下一步时间");
    // 开了超时回收下一步计划也必填（11-05，和 建档向导 的 要下一步文字 同口径）
    if (建档?.只用项目 && 建档.要下一步 && !p.下一步?.trim()) miss.push("下一步计划");
    const 企 = 企格;
    if (企) {
      if (企.有分配方式 && typeof p.分配方式 !== "number") miss.push("分配方式");
      if ((!企.有分配方式 || p.分配方式 === 0) && !p.ownerId) miss.push("项目负责人");
      // 指定分配时间（PR3）：卡上切到「指定时间」（"" = 还没选时刻）就得选上
      if ((p.分配方式 === 0 || p.分配方式 === 1) && typeof p.定时分配 === "string" && !北京墙钟转时刻(p.定时分配)) miss.push("分配时间");
      if (!p.业务线 && !(企.按区域 && p.分配方式 === 1)) miss.push("业务线");
      if (!p.节点 || !企.节点们.includes(p.节点)) miss.push("当前进程");
      if (p.节点 && 企.节点们.indexOf(p.节点) > 企.节点们.indexOf(有效线索节点)) miss.push(建档不能过线索验证);
      if ((p.country?.trim() || p.province?.trim() || p.city?.trim() || p.district?.trim() || p.address?.trim()) && !p.区域去处?.length) miss.push("国家 / 城市填到哪");
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
  if (p.kind === "add_opportunity") return `给「${p.customerName}」新建商机${typeof p.name === "string" && p.name ? `「${p.name}」` : ""}`;
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

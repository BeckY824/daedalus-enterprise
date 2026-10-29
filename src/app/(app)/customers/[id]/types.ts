import type { 可选成员 } from "@/lib/utils";
import type { ContractRow } from "./ContractForm";
import type { CustomerRow } from "../CustomerForm";

export type FollowUpRow = {
  id: string;
  type: string;
  title: string;
  content: string;
  status: string;
  duration: number | null;
  occurredAt: string;
  dueAt: string | null;
  dueHasTime?: boolean | null;
  participants: string | null;
  /** 速记解析时的原始聊天记录，只有 AI 起草过的记录才有 */
  sourceText: string | null;
  /** 稳定身份用于区分同名历史成员；旧调用方未知时保留姓名展示。 */
  ownerId?: string;
  ownerName: string;
  contactName: string | null;
  contactPosition: string | null;
  contactId: string | null;
  opportunityId: string | null;
  opportunity?: { id: string; name: string } | null;
  /** 编辑框的版本号（2026-10-04 J-105） */
  updatedAt: string;
};

export type ContactRow = {
  id: string;
  name: string;
  position: string | null;
  phone: string | null;
  email: string | null;
  wechat: string | null;
  isPrimary: boolean;
  remark: string | null;
  /** 编辑框的版本号（排查 D3） */
  updatedAt: string;
  /** 未归属联系人的原归属和移出时身份。空值表示旧记录未保留该信息。 */
  fromCustomerId?: string | null;
  wasPrimary?: boolean | null;
};

export type RecordProps = {
  /** 原始转化线索；没有关联或已删除时为空，不用推荐关系推断。 */
  sourceLead?: import("@/lib/customer-lead-origin").CustomerLeadOrigin | null;
  /** 这位在不在我左栏的「收藏的客户」里（lib/favorites.ts） */
  已收藏?: boolean;
  /**
   * 同事的客户、我只能看和加跟进（团队开了互看、我是业务员、这位不归我也不在公海，2026-10-20）。
   * 档案、状态、联系人、商机、签约、计划、待办都只显示不给改；只剩「记录跟进」。
   * 「全」= 企业版虚线下属的客户（2026-10-24）：跟进也不能记
   */
  只读?: boolean | "加跟进" | "全";
  /** 我能把这位放进公海吗：负责人本人或管理员（第 6 块） */
  能放公海?: boolean;
  /** 企业版：在公海里、我是原负责人——领取按钮灰着，悬停说「原负责人不能领回」（lib/enterprise/pool-rules.ts） */
  原负责人领不回?: boolean;
  /** 换负责人记录（企业版 D-36），时间正序；左栏「历史负责人」用，没有就不摆 */
  换负责人记录?: import("@/lib/owner-log").换负责人记录[];
  /**
   * 企业版项目模式（10-26）：这位名下的项目，新的在前。给了（哪怕空数组）就用「项目」一节替掉「商机」一节，
   * 报价记录、跟进上的关联商机也不摆——企业版只有项目一条线。不给 = 个人版、团队版，照旧
   */
  /** 企业版：客户级的旺旺 ID（只在联系方式子表里），基本资料只读摆出来；没有 = 不摆 */
  旺旺们?: string[];
  /**
   * 企业版联系人附件（2026-10-28）：联系人 id → 附件几张（没有的不在里面）。给了（哪怕空对象）联系人小卡上才摆「附件」一行；
   * 不给 = 开关关着或个人版、团队版，照旧
   */
  联系人附件数?: Record<string, number> | null;
  /** 企业版客户状态的可选项（字典 custStatus 启用中的，10-28 去遗留 A1）；不给 = 别的版本，标签行照旧 */
  客户状态选项?: string[];
  项目们?: { id: string; name: string; phase: string; node: string; result: string | null; pooledAt: Date | null; amount: number; currency: string }[] | null;
  customer: CustomerRow;
  contacts: ContactRow[];
  opportunities: {
    id: string;
    name: string;
    amount: number;
    /** 币种（2026-10-03）。老行没有就当人民币 */
    currency?: string;
    stage: string;
    status: string;
    probability: number;
    expectedDealAt: string | null;
    /** 外贸模版下叫「询盘时间」（2026-10-05）：商机是哪天来的，人能改 */
    createdAt?: string;
  }[];
  contracts: ContractRow[];
  /** 报价记录（2026-10-03）：这个客户历次报过的每一行，新的在前。没报过是空数组，左栏那一节就不出现 */
  报价记录?: import("@/lib/quote-db").报价记录行[];
  tasks: { id: string; title: string; dueAt: string | null; dueHasTime?: boolean | null; done: boolean }[];
  /** updatedAt：编辑框的版本号（J-105） */
  plan: { id: string; subject: string; plannedAt: string; plannedHasTime?: boolean | null; method: string; updatedAt: string } | null;
  followUps: FollowUpRow[];
  followUpsHasMore?: boolean;
  users: 可选成员[];
  channels: { id: string; name: string }[];
  /** 服务端是否配置了 AI。没配时 AI 面板整体不渲染 */
  aiEnabled: boolean;
};

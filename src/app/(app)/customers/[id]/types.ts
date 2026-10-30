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
  /** 企业版客户页「沟通记录」汇总时：这条属于哪个项目（null = 客户本身挂的老跟进；2026-10-29 P14） */
  项目?: { id: string; 名: string } | null;
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
  /** 企业版联系人改版（2026-10-29，定稿 P5 第 24 条，迁移 073）。老调用方没给就当没填 */
  gender?: string | null;
  /** YYYY-MM-DD */
  birthday?: string | null;
  hobby?: string | null;
  address?: string | null;
  /** 联系方式几行（类型 kind + 号码）；子表里没有的拿老三格拼（customer-v2-db.ts 的 联系人号码们）。不给 = 别的版本 */
  号码们?: { kind: string; value: string }[];
  /**
   * 企业版联系人挂多位客户（2026-10-29 P13，迁移 090）：给了 = 这位是挂到这位客户上的、主客户是别人。
   * 能改 = 主客户那一头我能改（编辑资料、换主客户只在能改时摆）；解除挂靠看的是这位客户能不能改
   */
  挂靠?: { linkId: string; note: string | null; 主客户Id: string; 主客户名: string; 主客户看得到: boolean; 能改: boolean } | null;
  /** 主客户是这位的联系人另外还挂在哪几位客户上（看不到的只给名字） */
  另挂?: { id: string; name: string; 看得到: boolean }[];
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
  /**
   * 企业版联系人附件分两格（2026-10-29，定稿 P5 待定 19）：联系人 id → 名片 / 相册各几张（没分类的老附件算相册）。
   * 给了就摆两行替掉「附件」一行
   */
  联系人分类附件数?: Record<string, { 名片: number; 相册: number }> | null;
  /** 企业版关联客户（待定 15，迁移 075）：两个方向都算。给了（哪怕空数组）才摆「关联客户」卡片 */
  关联们?: import("@/lib/enterprise/customer-v2-db").关联一行[] | null;
  /** 企业版联系人号码类型（字典 contactKind，停用的也在：老号要显示叫法） */
  号码种类?: { 名: string; kind: string; active: boolean }[];
  /** 企业版客户分配方式的可选项（字典 custAssign 启用中的） */
  分配方式选项?: string[];
  /** 企业版客户类型的可选项（字典 custType 启用中的，2026-10-29 P13 第 4 条） */
  客户类型选项?: string[];
  /** 企业版项目模式客户页「新建项目」（待定 16）：线索阶段的节点、要不要必填下一步时间。不给 = 不摆这个按钮 */
  新建项目?: { 节点们: string[]; 要下一步: boolean } | null;
  /** 企业版客户状态的可选项（字典 custStatus 启用中的，10-28 去遗留 A1）；不给 = 别的版本，标签行照旧 */
  客户状态选项?: string[];
  /** 企业版客户状态、客户类型每项的释义（下拉里一行灰字，10-30）；不给就和原来一样 */
  字典释义?: import("@/components/DictNote").客户字典释义;
  项目们?: { id: string; name: string; phase: string; node: string; result: string | null; pooledAt: Date | null; amount: number; currency: string }[] | null;
  /** 企业版项目关联（P17）：这位客户关联在哪些项目上、什么身份（只读；含当主客户、勾了身份的那几个）。不给 = 别的版本 */
  参与项目们?: import("@/lib/project/relate").参与项目行[] | null;
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
  /**
   * 企业版只用项目（P14 第 3 条）：「跟进」菜单列的项目——主客户是这位的 + 关联进来的，只含我看得到沟通内容的。
   * 下一步：项目下一步时间（待办里摆一行只读的，第 2 条）。null = 不是项目模式，「跟进」照旧就地记
   */
  跟进去处?: import("@/lib/enterprise/customer-follow-feed").跟进去处[] | null;
  /** 「跟进」菜单里「转让」用：转让原因字典 + 我是谁（同客户列表 useTransferConfirm） */
  转让原因?: { 选项: string[]; 自己: string };
  /** 企业版只用项目（P14 第 2 条）：待办卡里摆的跟进计划，这位客户所有没完成的（只读，到计划页去办）。不给 = 别的版本 */
  待办计划?: { id: string; subject: string; plannedAt: string | null; plannedHasTime?: boolean | null }[];
  users: 可选成员[];
  channels: { id: string; name: string }[];
  /** 服务端是否配置了 AI。没配时 AI 面板整体不渲染 */
  aiEnabled: boolean;
};

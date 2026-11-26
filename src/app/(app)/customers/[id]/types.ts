import type { ReactNode } from "react";
import type { 附件 } from "@/lib/attachment-rules";
import type { 可选成员 } from "@/lib/utils";
import type { ContractRow } from "./ContractForm";
import type { CustomerRow } from "../CustomerForm";
import type { 抬头节点格 } from "@/lib/enterprise/customer-title";

export type FollowUpRow = {
  id: string;
  type: string;
  /** 企业版沟通方式（10-31），没有就按类型显示 */
  method?: string | null;
  /** 企业版发起主体（11-01），老记录没有 */
  initiator?: string | null;
  /** 售后回访（11-25，交付结清项目上记的）：方式后面带「售后回访」小标 */
  afterSale?: boolean;
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
  /** 记下的时间（服务器时间） */
  createdAt?: string;
  /** 编辑框的版本号（2026-10-04 J-105） */
  updatedAt: string;
  /** 企业版客户页「沟通记录」汇总时：这条属于哪个项目（null = 客户本身挂的老跟进；2026-10-29 P14） */
  项目?: { id: string; 名: string } | null;
  /** 企业版：提交后改过（操作日志里有「改了沟通」，11-19）——列表上标「已修改」 */
  已修改?: boolean;
  /**
   * 企业版客户页「沟通记录」汇总时：这条沟通上的截图、录音（F-047）。只给挂在我看得到的项目上的沟通（同 api/attachments/access.ts 认沟通），
   * 没附件的不带这个字段；汇总里只看、看大图、下载，传和删回项目详情
   */
  附件?: 附件[];
  /**
   * 企业版客户页「沟通记录」汇总时（11-25 售后回访审查）：这条是我记的售后回访、挂在我看不到的交付结清项目上（我是客户负责人，补进来的那批）——
   * 项目页我进不去：这条在客户页能传截图 / 录音（服务端 认沟通 本人售后回访那一道），项目名不做链接
   */
  本人售后?: true;
  /** 同上那几条：本人限时改能改到几点（ISO，写入 + 30 分钟）；客户页这条摆「修改」，过了收起（服务端 本人限时改挡 照核） */
  本人可改到?: string;
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
  /**
   * 客户三态状态条（P-界面-19 ③ / 构想页 C10）：只在三态开着、客户沉睡 / 待回收 / 暂缓回收中时给；按钮服务端算好（lib/enterprise/tri-state-detail.ts）。
   * 不给 = 什么都不摆（三态关着时客户详情和原来一样）
   */
  三态条?: import("@/lib/enterprise/tri-state-detail").三态条 | null;
  /**
   * 客户名下那一行末尾的「历史变更」小方框（11-24，HistoryChanges.tsx）：页面给好条数和最近时间，点开才取明细。
   * 原来项目区「进程变更」卡、卡里的「客户状态」一段（C13）、没项目时左栏的状态留痕（A1）都挪进这个弹窗。不给 = 不摆
   */
  历史变更?: ReactNode;
  /** 摆在整页最上面的提醒条（客户详情顶上的同号再次录入醒目条，11-03 B6-9）；没有就不摆 */
  醒目条?: ReactNode;
  /** 「← 回到客户列表」那一行右端的「上一条 / 下一条」（E-332，CustomerStep.tsx，页面画好递进来）；不给 = 不摆 */
  换人箭头?: ReactNode;
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
  /** 只读 = "全" 时那一句（服务端 lib/team-scope.ts 只读话：虚线下属 / 市场成员相关 / 两样都有）。不给 = 按虚线下属说 */
  只读话?: string;
  /** 企业版「全」只读时顶上横幅的标题和说明，按这位为什么看得到算好（lib/enterprise/readonly-reason.ts）。不给 = 照 只读话 的老说法 */
  只读横幅?: { 标题: string; 说明: string };
  /** 企业版字段权限里这个人改不了的列（客户列字段的 key，11-03 D5-1）。不给 = 都能改 */
  只能看的格?: string[];
  /** 企业版只读管理员（admin，11-03 B2-1）：写入按钮都不摆（同 全只读），公海客户的「领取」也不摆；不出虚线下属那条提示 */
  管理员只读?: boolean;
  /** 企业版改客户资料挡（服务端 改客户挡 同一口径）：有就资料格不给点、不摆笔，见 read-only.ts 资料改挡上下文 */
  资料改挡?: { 话: string; 公海: boolean; /** 公海里删的入口（服务端删除挡另判，系统管理员照常能删） */ 公海删?: { 联系人: boolean; 附件: boolean } } | null;
  /** 公海客户摆不摆「领取」（11-03 D3-7 ④：没设业务角色的不摆；服务端 claim 另拦）。默认摆 */
  能领?: boolean;
  /** 企业版沟通记录能不能改（M-权限-09，11-02：负责人能改；服务端 saveFollowUp 同样拦）。默认能 */
  能改沟通?: boolean;
  /** 企业版沟通记录能不能删（系统管理员或身为负责人的管理，M-权限-09 原口径 11-09；服务端 deleteFollowUp 同样拦）。默认能 */
  能删沟通?: boolean;
  /** 我能把这位放进公海吗：负责人本人或管理员（第 6 块） */
  能放公海?: boolean;
  /** 企业版转让客户：管理、总管理，负责人转自己的（11-02；服务端 assignSalesOwner 同样拦）。默认能 */
  能转让客户?: boolean;
  /** 负责人本人转自己的走申请移交（X4）：页头按钮、框标题统一叫「客户转让」（11-12），框里写明要接手人确认、7 天不确认作废 */
  转让要申请?: boolean;
  /**
   * 客户转让框里摆「指定分配 / 自动分配」的选择：操作人是市场成员、客户是「暂不分配」的才给（客户 11-17，lib/enterprise/cust-auto-assign.ts）。
   * 页面（服务端）判好了把服务端动作 客户自动分配 递进来；不给 = 不摆，框和原来一样
   */
  自动分配?: (customerId: string, 原因: string | null, 方向?: "内贸" | "外贸") => Promise<import("../../leads/assign-actions").客户自动分配结果>;
  /** 自动分配时「分配方向」的默认值和来源（11-18，lib/enterprise/assign-direction-db.ts 客户默认分配方向）；框里可以改 */
  自动分配方向?: import("@/lib/enterprise/customer-region").分配方向;
  /**
   * 市场成员指定分配暂不分配的客户也先定方向（P-转-26，11-18）：每个方向能挑的人 + 默认方向。给了转让框「指定」那边也摆方向格、
   * 下拉只列这个方向能接的人；不给 = 照原来（服务端 assignSalesOwner 另核）
   */
  指定定向?: { 候选表: import("@/lib/enterprise/assign-direction-pick-core").指定候选表; 默认方向: import("@/lib/enterprise/customer-region").分配方向 };
  /** 转让框摆了「指定 / 自动」时，选指定的接手人只列这些人（参与状态正常，审核 11-18 追加，assign-eta 可指定的人）；没给 = 不筛 */
  自动指定候选?: string[];
  /** 企业版：在公海里、我是原负责人——领取按钮灰着，悬停说「原负责人不能领回」（lib/enterprise/pool-rules.ts） */
  原负责人领不回?: boolean;
  /**
   * 公海回收站里的无效客户（P-公海-09）：系统管理员、回收站副手（本业务线，P-公海-07）在详情页也能「恢复」，同公海列表 P-界面-44。
   * 页面把服务端动作（pool/actions 恢复有效客户）当参数递进来；不给 = 不摆，领取灰着、写原因
   */
  恢复无效?: (ids: string[]) => Promise<{ ok: true; updated: number; unchanged: number } | { ok: false; error: string }>;
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
  /** 企业版联系人「职务」下拉的候选（字典 contactTitle 启用中的，10-31）；也能手填 */
  职务选项?: string[];
  /** 企业版客户分配方式的可选项（字典 custAssign 启用中的） */
  分配方式选项?: string[];
  /** 企业版客户类型的可选项（字典 custType 启用中的，2026-10-29 P13 第 4 条） */
  客户类型选项?: string[];
  /** 企业版客户属性的可选项（字典 custAttr 启用中的，A-17） */
  客户属性选项?: string[];
  /** 企业版项目模式客户页「新建项目」（待定 16）：线索阶段的节点、要不要必填下一步时间。不给 = 不摆这个按钮 */
  新建项目?: { 节点们: string[]; 要下一步: boolean; /** 组织规则 阶段.仅记录用 开着（X-147）：为记沟通打开的新建项目多一格「仅记录用」 */ 仅记录用?: boolean; /** 超时回收.仅记录用也回收（X-147 待定 6）：关着时勾仅记录用不强制下一步 */ 仅记录用也回收?: boolean } | null;
  /** 我能不能新建项目（企业版：有业务角色、不是只读，同建档向导的拦）。不能时记沟通弹框里没项目说「请联系负责人先建项目」，不摆「新建项目」 */
  能新建项目?: boolean;
  /** 企业版客户状态的可选项（字典 custStatus 启用中的，10-28 去遗留 A1）；不给 = 别的版本，标签行照旧 */
  客户状态选项?: string[];
  /** 企业版客户状态、客户类型每项的释义（下拉里一行灰字，10-30）；不给就和原来一样 */
  字典释义?: import("@/components/DictNote").客户字典释义;
  /** 企业版客户状态 名字 → 标签颜色（cust-status-color.ts 客户状态色表）；没给按名字散 */
  客户状态色?: Record<string, string>;
  /** 企业版项目模式：客户状态按名下项目自动算（10-30），标签行那枚章只读、点不开 */
  客户状态自动?: boolean;
  项目们?: { id: string; name: string; phase: string; node: string; result: string | null; pooledAt: Date | null; amount: number; currency: string }[] | null;
  /** 企业版项目关联（P17）：这位客户关联在哪些项目上、什么身份（只读；含当主客户、勾了身份的那几个）。不给 = 别的版本 */
  参与项目们?: import("@/lib/project/relate").参与项目行[] | null;
  /**
   * 客户详情合并（11-12 第 2 批）：给了就是两层排版——左栏客户、右边项目区（带底色）；项目区画什么由客户页给（CustomerDetail.tsx）。
   * RecordView 把只有它有的几块（这位客户全部的沟通、待办卡、开新建项目框）交出去
   */
  项目区?: ((槽: 项目区槽) => ReactNode) | null;
  /**
   * 右上角「更多操作 ▾」里项目那一组对当前项目生效的那几项（11-12 用户，CustomerDetail 按当前项目算好给）：名字 + 各项给不给、灰着的原因。
   * 点了经 项目动作口 交给嵌入版 ProjectDetail 开框；没有当前项目 = null（菜单里只剩「新建项目」）
   */
  当前项目菜单?: { id?: string; 名: string; 节点?: string | null; 项们: import("../../projects/[id]/project-menu").项目菜单项[] } | null;
  项目动作口?: { current: ((key: import("../../projects/[id]/project-menu").项目动作键) => void) | null } | null;
  /**
   * 右上角「发起点评 ▾」（教练点评改版 PR1，11-21，原沟通卡头「发起主题」）：CustomerDetail 按当前页签的项目画好整颗按钮递进来，
   * 对当前项目不能发 / 没有当前项目 = null，不摆这颗（不是灰着）。
   * 递画好的按钮、不在 RecordView 里引 CoachTopics：那边连着教练主题的服务端动作，只画客户层的 RecordView（各用例单独打包它）不该带上
   */
  发起点评钮?: ReactNode | null;
  /**
   * 合并客户第一批（11-25）：三只框（合并客户、和另一位合成、项目换客户）由客户页画好递进来（MergeHost），RecordView 只经 merge-bridge 说开哪只；
   * 不在 RecordView 里引框：框里调 merge-actions，同 发起点评钮。不给 = 菜单里不摆这几项
   */
  合并口?: ReactNode | null;
  /** 摆不摆「合并客户」「和另一位合成」（page.tsx 按服务端同一把尺算：负责人本人能删客户的角色或系统管理员；公海里的合成要先领） */
  能合并?: { 客户: boolean; 联系人: boolean } | null;
  /** 打开的是已并入的 B 的旧链接（?merged=B）：顶上那句「NO.xxxxx「B」已并入这位客户」（customer-merge.ts 并入提示）；对不上 = null */
  并入话?: string | null;
  /** 项目区正在提交：「更多操作 ▾」里对当前项目的几项灰着、写「正在处理」 */
  项目忙?: boolean;
  /**
   * 左栏联系人跟当前项目页签走（D2，用户 11-12）：「关键」= 当前项目的主联系人（Project.contactId），
   * 排序 = 主联系人 → 本项目联系人（带本项目里的角色 / 立场）→ 这位客户的其他联系人。不给（没有项目可选）退回客户级 isPrimary
   */
  项目联系人?: 项目联系人 | null;
  /** 项目区页签上的项目 id（CustomerDetail 给）：时间线上点这些项目直接切页签 */
  项目页签们?: readonly string[] | null;
  /** 页头抬头里的当前节点 + 当前项目名（企业版，11-17 客户抬头 PR-5、F-040，lib/enterprise/customer-title.ts 抬头节点们）：简称、全称、类型都空才给；null / 不给 = 没有这一段 */
  抬头节点?: 抬头节点格 | null;
  customer: CustomerRow;
  contacts: ContactRow[];
  contracts: ContractRow[];
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
  /**
   * 上一次背调（11-22 页面切换提速 C3）：AI 开着时详情页渲染一并取好带下来，背调卡 / AI 面板进页不再各调一次 最近背调。
   * 不给 = 照原来进页自己取
   */
  上次背调?: import("@/lib/research/latest").最近背调结果;
};

/** 当前项目页签的联系人主次（项目详情 关联.联系人们 + contact 算出来） */
export type 项目联系人 = { 主: string | null; 本项目: { contactId: string; 角色: string[]; 立场: string | null }[] };

/** RecordView 交给项目区的几块 */
export type 项目区槽 = {
  /** 「这位客户全部」：客户页那条沟通时间线（筛选条 + 时间线，含加载更多） */
  全部沟通: ReactNode;
  全部沟通数: string;
  /** 待办卡（ProjectFold + 卡），没有就是 null */
  待办: ReactNode;
  /** 新建项目：能建项目才给（公海客户点了提示先领取，同原「新开项目」）；入口在右上角「更多操作」，空状态里那颗大按钮也用它 */
  开建项目: (() => void) | null;
  /** 全只读（虚线下属、市场成员相关、只读管理员）：项目区也不给任何写入口的提示用 */
  全只读: boolean;
  /** 右栏摆不摆「项目进程变更」卡：客户详情不摆（挪进「历史变更」弹窗，11-24）；受限客户详情没有那个入口，照摆 */
  进程变更卡?: boolean;
  /** 客户三态提醒条（有才给）：项目区里只占中栏宽、在进程卡正上方；没有项目时在项目区顶上 */
  提醒: ReactNode;
  /** 受限客户详情（只负责项目的人）：沟通卡不摆「本项目 / 这位客户全部」切换，只看本项目 */
  无全部沟通?: boolean;
  /** 受限客户详情：最后一个项目转走 / 退回公海 / 删了以后去哪（见 嵌在客户页.走后去） */
  走后去?: { 到: string; 说法: string } | null;
  /**
   * 客户页「记售后回访」（E-283 第 2 条）：这位客户名下有我能记售后回访的交付结清项目（售后项目 非空）才给，打开客户页记沟通框的售后模式
   * （只列交付结清那组、自带下次回访）。只是客户负责人、看不到那个项目的人从这里记；空状态和沟通记录卡头摆
   */
  记售后回访?: (() => void) | null;
  /** 我能记售后回访的交付结清项目 id（同上那一组）：项目区据此算出哪些没有页签 */
  售后项目ids?: string[];
  /** 记售后回访、框里只列这几个（页签上自带「记售后回访」时，另一颗只给没有页签的那几个，E-283 审查） */
  记这几个售后回访?: ((ids: string[]) => void) | null;
};

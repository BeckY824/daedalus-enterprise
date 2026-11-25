"use client";

import { 留落地话 } from "@/lib/landing-note";
import { 位置文字, 换人文字, type 放回方式 } from "@/lib/project/node-log-text";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useNavGo } from "@/lib/nav-pending";
import Link from "next/link";
import { LinkPending } from "@/components/NavProgress";
import { CommentOutlined, DownOutlined, EditOutlined, MoreOutlined, RightOutlined, SearchOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Checkbox, Dropdown, Input, Menu, Modal, Popover, Progress, Segmented, Select, Space, Tag, Timeline, Tooltip, type MenuProps, type PopoverProps } from "antd";
import DatePicker from "@/components/BusinessDatePicker";
import DictSelect from "@/components/DictSelect";
import { useMotionTheme } from "@/components/MotionTheme";
import { 少动 } from "@/lib/reduced-motion";
import { useConsequence } from "@/components/ConsequenceDialog";
import { showUndo } from "@/components/UndoBar";
import { 自动推进话of } from "@/lib/project/auto-advance-text";
import { 其他没写好, 不填项, 去不填, 未选占位 } from "@/lib/enterprise/dict-kinds";
import { 有值, 空值符, 空显 } from "@/lib/empty-value";
import { 公海规则, 原负责人不能领回提示 } from "@/lib/enterprise/pool-rules";
import { 必填叫法, 必填项们, type 必填项 } from "@/lib/project/required";
import { PageHead, CustomerLink, FOLLOW_TYPE_ICON } from "@/components/ui";
import { 跟进方式名 } from "@/lib/follow-method";
import { useBusiness } from "@/lib/business-client";
import { dayjs, fmtDateTime, smartTime, 成员选项 } from "@/lib/utils";
import { 回公海文案, 回公海颜色, 预演回收日, type 回收预演底子 } from "@/lib/enterprise/recycle-text";
import { 跟进类型们 } from "@/lib/constants";
import FollowMethodSelect, { InitiatorSelect, useFollowHabit, useFollowInitiators, useFollowMethods, 默认沟通方式, 默认发起主体 } from "@/components/FollowMethodSelect";
import { 对得上的方式, 方式对类型 } from "@/lib/follow-method";
import { 外贸精简 } from "@/lib/business-config";
import { 金额, 合计文字, 按币种合计, 默认币种 } from "@/lib/currency";
import { 阶段们, 交付还差, 交付还差话, 交付不在尾款话, 终止结局, 下一步, 节点序号, 节点总数of, 原因上限, 要写原因, 字典of, 结局叫法, 是交付, 团队版字典, type 位置, type 阶段字典 } from "@/lib/project/nodes";
import { 超时理由 } from "@/lib/project/timeout";
import { 短沟通话of } from "@/lib/enterprise/tri-state-quota";
import FollowMeaningLine from "@/components/FollowMeaningLine";
import { useFollowJudge } from "@/components/useFollowJudge";
import { 进公海理由显示 } from "@/lib/enterprise/tri-state-label";
import { 阶段与进程, type 出口叫法改动 } from "@/lib/project/stage-dict";
import { 有效线索节点, 缺有效沟通还差 } from "@/lib/project/stage-gates";
import type { 线索验证 } from "@/lib/project/lead-verify";
import LeadVerifyPanel from "./LeadVerifyPanel";
import GiveUpBanner from "./GiveUpBanner";
import type { 放弃入口 } from "@/lib/enterprise/lead-giveup-core";
import { useDetailNote, 框里原因, type 跑法, type 就地回执 } from "./detail-note";
import { FoldSplit, ProjectFold, 模块钮色, 连体箭头, 计数题 } from "./ProjectFold";
import { 卡名Provider, 客户详情卡点, 项目卡名 } from "./card-names";
import { ProjectFillRequired, 定位到模块, 定位到附件格, 附件必填格 } from "./ProjectFillRequired";
import { CustomerReadonlyCard } from "./CustomerReadonlyCard";
import { 填法表, 客户格, type 窗外去处, type 草稿们, type 已签收格 } from "@/lib/project/required-fill";
import ProjectStages from "./ProjectStages";
import ProjectStarButton from "./ProjectStarButton";
import { 两行, 等复核说法, 能项目转让, type 项目动作键 } from "./project-menu";
import AiWait from "@/components/AiWait";
import AiCost, { AiRemaining, useAiOutOfCredits } from "@/components/AiCost";
import { clearJob, runJob } from "@/lib/ai-jobs";
import { 客户页项目地址 } from "@/lib/project/customer-detail-href";
import ChannelPicker, { type 可选渠道 } from "@/components/ChannelPicker";
import AddressInput from "@/components/AddressInput";
import { 三种业务线, 建议业务线, 所在地提示 } from "@/lib/enterprise/assign-line";
import { 拼地址, 企业级别, 企业客户级别, 企业级别说明, type 客户地址 } from "@/lib/enterprise/customer-v2";
import { 级别星 } from "@/lib/enterprise/level-stars";
import ReplyWindowInput, { type 回复两格 } from "@/components/ReplyWindowInput";
import { 定时时刻格 } from "@/components/ScheduleAssignInput";
import { 改定时分配, 取消定时分配, 定时分配现在分 } from "../../leads/schedule-actions";
import { 指定回复文字, 北京墙钟转时刻, 回复晚于回收, 短时刻, 客户在谁名下话 } from "@/lib/project/time-fields";
import { 成交需求上限, 详细地址上限, 详细地址提示, 项目区域, type 项目成交钱 } from "@/lib/project/profile-rules";
import { 合同状态们, 痛点标注上限, 备货状态们, 物流单号上限, type 合同状态, type 备货状态 } from "@/lib/project/proj-fields";
import { 备注上限 } from "@/lib/project/wizard";
import { 文字格改动, 沟通正文改动, type 钱格值 } from "@/lib/project/inline-edit";
import ProjectInlineField, { type 编辑器参数 } from "./ProjectInlineField";
import { 钱编辑器, 钱格存法 } from "./money-cell";
import { 项目沟通预填, 沟通时间格式, 下一步文字上限 } from "@/lib/project/project-fields";
import { parseFollowUpDraft } from "../../customers/[id]/ai";
import { 改项目节点, 记完成节点被拦, 终止项目进程, 勾项目交付, 删除项目, 放回项目公海, 领取项目, 记项目沟通Action, 改项目沟通, 删项目沟通, 编辑项目 } from "../actions";
import type { 可选成员 } from "@/lib/utils";
import { ProjectEditModal, ProjectTeamCard, type 组员, type 角色, type 联系人 } from "./ProjectTeam";
import { BlockerList, PublishBlockerModal, 原因选择, type 卡点卡 } from "../BlockerPanel";
import { 卡点类型们, 影响等级们, 缺原因话, 清原因们, type 卡点默认 } from "@/lib/project/blocker-rules";
import type { 附件 } from "@/lib/attachment-rules";
import FollowAttachments, { 选沟通附件 as 选沟通附件框, 传沟通附件 } from "@/components/FollowAttachments";
import { ProjectCommissionCard } from "./ProjectCommission";
import { ContactAttachmentsButton } from "../../customers/[id]/ContactAttachments";
import type { 提成卡 } from "@/lib/project/commission";
import type { 项目主题们 } from "@/lib/enterprise/coach-topic-db";
import CoachTopics, { StartReviewButton } from "./CoachTopics";
import PaneToggle from "@/components/PaneToggle";
import BackToList from "@/components/BackToList";
import { ProjectAttachmentsCard, ProjectPaymentsCard, ProjectProfileCard, type 沟通附件组, type 项目画像 } from "./ProjectExtras";
import { 词们, 对得上, 沟通字段, 卡点字段, 沟通来源, 能隐藏接手前 } from "@/lib/project/detail-search";
import type { 回款 } from "@/lib/project/payment-db";
import ProjectRelate from "./ProjectRelate";
import { useFormDraft, 草稿范围 } from "@/components/FormDraft";
import { 有字 } from "@/lib/form-draft";
import { 动作出错话, 出错原话, 刷新再提交话 } from "@/lib/stale-deploy";
import type { 项目关联 } from "@/lib/project/relate";

export type 项目详情 = {
  id: string; name: string; remark: string | null; amount: number; currency: string;
  /** 这个人收藏了这个项目没有（左栏「收藏的项目」，11-02） */
  收藏了?: boolean;
  /** 这个人字段权限不是「改」的那几项（企业版，11-02）：卡片上不摆就地改的入口；服务端 改项目 照旧按字段权限拦 */
  只能看字段?: string[];
  /** null = 公海里同事客户的项目，领取后再给（page.tsx 露客户）；联系人、沟通这时也是空的 */
  customer: { id: string; name: string; school: string | null } | null;
  /** 客户那一格点了去哪（E①）：没给 = 详情；只读卡 = 只负责项目的人和实线上级；文字 = 只露名字、进不去（客户在公海、要回避） */
  客户入口?: "详情" | "只读卡" | "文字";
  /** 开只读卡时摆的客户名：实线上级的 customer 可能是 null（露客户），名字单给 */
  客户卡名?: { name: string; school: string | null } | null;
  contact: { id: string; name: string; position: string | null } | null;
  /** 企业版联系人附件（2026-10-28）：联系人那一行下面的「附件」入口；只读 = 同事的 / 虚线下属的客户，只能看。别的版本、看不到这位联系人时没有这个字段 */
  联系人附件?: { 个数: number; 只读: boolean };
  /** 线索转出来的项目：来源线索的名字（null = 那条线索已删除）和转化日；不是线索转的、或公海里还没领时是 null */
  来源线索: { name: string | null; convertedAt: string | null } | null;
  /** 企业版字典下拉（10-27）：放回公海选「回收原因」、线索流失选「无效原因」；不是企业版两个都是空的，界面照旧 */
  原因选项: { 回收: string[]; 无效: string[] };
  /** 企业版线索验证框里培育计划、无效原因的字数上限（M-节点-03，组织规则）：null = 不设；没给 = 不设 */
  字数上限?: { 培育计划: number | null; 无效原因: number | null };
  /** 企业版线索阶段：线索有效性验证（P12）的判定、待哪步、时间线 */
  线索验证?: 线索验证;
  ownerId: string; ownerName: string; creatorName: string; createdAt: string;
  /** 历史负责人（只企业版有，别的版本是空的）：把这个项目放回过公海的人，最近放回的在前，同一个人只列一次 */
  historyOwners: string[];
  phase: string; node: string; result: string | null;
  /** 异常状态时：选的异常类别名、备注（可空） */
  exceptionReason: string | null; exceptionCategory: string | null;
  /** 在项目公海里；能放公海 = 我是负责人且在线索 / 商机阶段；能领取 = 在公海里，且我不是原负责人（企业版按 pool-rules.ts） */
  pooled: boolean; 能放公海: boolean; 能领取: boolean;
  /** 看的人就是当前负责人（沟通卡头「隐藏接手前」只给他，lib/project/detail-search.ts 能隐藏接手前） */
  我是负责人?: boolean;
  /** 企业版原负责人领不回时那句话：领取按钮照样摆、灰着，悬停给这句；null = 不用灰 */
  领取不给: string | null;
  /** 在公海里时最近一次怎么进来的（ownerName 这时是原负责人）：谁放的、超时系统收 / 办停用时放 / 手动放回 */
  进公海: { 方式: 放回方式; 谁: string } | null;
  /** 在公海里、最近一次是我放回的（load.ts）；老调用方没给当不是 */
  放回的是我?: boolean;
  /** 服务端读的 企业版()：放回公海的说法跟着它走 */
  企业版: boolean;
  /** 能删这个项目：企业版系统管理员或负责人本人（销售、销管、渠运，V3.5.1；进回收站），别的版本 = 能改 */
  能删?: boolean;
  /** 能往项目组里拉人：能改的人，企业版加上已进组的项目组员（V3.5.1） */
  能加组员?: boolean;
  /** 能换组员角色、移出组员：能改内容的人；公海里的项目系统管理员也能（X-72） */
  能改组员?: boolean;
  /** 企业版组织规则里改过的出口叫法（设置 → 项目 → 阶段规则）；别的版本是空的 */
  出口叫法: 出口叫法改动;
  /** 企业版线索阶段：推过线索验证还差哪几样（显示名，11-05），空 = 齐了 */
  有效沟通差: string[];
  /** 企业版：后台开了「前两节点要沟通」、停在线索验证、这个节点上还没记过沟通（F-017，load.ts 算，只用来写提示） */
  线索验证缺沟通?: boolean;
  /** 企业版：组织规则里「线索验证」节点配的必填 key（线索验证面板写判定依据用）；没开节点推进 = 空 */
  线索验证必填?: 必填项[];
  /**
   * 企业版超时回收：nextStepAt 是最近一次沟通填的下一步时间（服务端排好的 YYYY-MM-DD）；回收日 = 哪天没人跟进就自动回公海（null = 不会）；
   * 要下一步 = 记沟通必须填下一步时间；能记沟通 = 企业版里的负责人或已进组的组员（11-17），在推（不在公海、没结局；不是企业版照原来去客户页记）
   * nextStepText = 下一步做什么（10-29 起记沟通时自己写一句话，时间可空）；老数据只有时间没有这句，就只摆时间
   */
  nextStepAt: string | null; nextStepText?: string | null; 回收日: string | null;
  /** 线索在验证中（X-78）：不参与超时回收，回收日那格写「验证中，不回收」（page.tsx） */
  验证不收?: boolean;
  /** 企业版记沟通时预演回收日的底子（page.tsx，lib/enterprise/recycle-text.ts 预演回收日）；算不准（规则关着、配了必填会自动推）= null，弹窗里不写那一句 */
  回收预演?: 回收预演底子 | null;
  /** 企业版预计成交日期（10-27 从客户挪到项目，服务端排好的 YYYY-MM-DD）；不是企业版不传 */
  expectedDealAt?: string | null; 要下一步: boolean; 能记沟通: boolean;
  /** 能记沟通的是项目组员、不是能改项目的人（11-19 客户答复）：记沟通框不摆下一步，服务端也不写项目的下一步 */
  组员记沟通?: boolean;
  /** 企业版指定回复时间（11-17）：北京墙钟「YYYY-MM-DD HH:mm」，没填 null；不是企业版不传 */
  指定回复?: 回复两格;
  /** 指定分配时间（企业版，11-17 PR3）：还没到点的定时；时间 = 北京墙钟，给谁 = 指定分配的接手人（自动分配 null），能动 = 录入人 / 能分配的人 */
  定时分配?: { 时间: string; 给谁: string | null; 能动: boolean };
  /** 超时未跟进自动转过来、客户还在别人名下（11-17，lib/enterprise/reply-overdue.ts 规则 3 的例外）：那人的名字，只给负责人本人；没有 = 不提示 */
  客户在谁名下?: string;
  /** 主动放弃（豁免，32H，lib/enterprise/lead-giveup.ts）：新分配给我、我还没记有效沟通的线索才有；可 = false 时按钮灰着、写为什么 */
  放弃?: 放弃入口;
  /** 沟通的「…」菜单（改 / 删，10-29）：能记沟通、看得到客户，且不是同事 / 虚线下属的客户；企业版改 = 身为负责人的管理（M-权限-09 原口径 11-09，管理以下含负责人本人不能改删） */
  可改沟通?: boolean;
  /** 记录人本人限时改（低-1）：服务器出页时的钟（ISO），前端按和本机钟的偏差算「还能改到几点」；有本人可改的才给 */
  服务器现在?: string;
  /** 沟通能删：系统管理员或身为负责人的管理（M-权限-09 原口径 11-09，和 可改沟通 分开） */
  可删沟通?: boolean;
  /**
   * 企业版（10-29 P6）：项目来源 = 项目自己选的渠道（没选 = 跟客户来源走，null = 客户也没有）；已立项天数从建项目那天按自然日数；
   * 渠道们 = 能改时编辑框里选项目来源用的；aiEnabled = 「记一条沟通」里给不给 AI 解析（没配模型不给）。不是企业版都不传
   */
  /** name 空 = 跟客户来源、但这位客户我看不到：只写「随客户来源」，不露渠道名（11-20 总控判定：只露有无，不露来源值） */
  项目来源?: { name: string; 跟客户: boolean } | null; channelId?: string | null; 已立项天数?: number; 渠道们?: 可选渠道[]; aiEnabled?: boolean;
  /** 数据来源（迁移 151）：历史沟通分析回填的项目是「历史分析」，显示成标签；正常建的不传、不摆这一行 */
  数据来源?: string;
  /** 老客户重复咨询（重复咨询第一步 · 出口 C 建的线索）：这位客户别的在推项目，我看得到的给名字、看不到的只给个数；重复线索名 = 字典现名（load.ts 现算） */
  重复咨询?: { 看得到: { id: string; name: string; 项目去?: string }[]; 看不到: number; 重复线索名: string };
  /** 老客户重复咨询的只读来源（迁移 163，客户 E-218）：原始客户编号、第几次。只读一行，没有编辑入口 */
  重复咨询来自?: { 客户编号: string; 第几次: number | null } | null;
  /**
   * 企业版（P11 定稿 -2 版，迁移 093）：项目级别 S / A / B / C（null = 没分级），显示成星；
   * 所在地 = 地址四格 + 详细地址，跟客户资料一样公海里同事客户的项目没领之前是 null（不摆）。不是企业版都不传
   */
  level?: string | null; 所在地?: (客户地址 & { location: string | null }) | null;
  /** 企业版项目标签（迁移 153，F-项目-14）：和级别各一列、各自填；值 = 存的选项名（null = 没填），选项 = 字典 projTag 启用着的 + 存着的那项。不是企业版不传 */
  项目标签?: { 值: string | null; 选项: string[] };
  /** 企业版业务线（内贸 / 外贸 / 暂不分配，老项目可能是 null）：只给编辑框用；不是企业版不传 */
  bizLine?: string | null;
  /** 企业版需求描述（10-31 前叫成交需求）、合同金额 + 币种、定金金额 + 币种（迁移 097）；不是企业版不传 */
  成交钱?: 项目成交钱;
  /**
   * 企业版痛点标注、合同状态（迁移 101）：不是企业版不传；某一项字段权限是「藏」就没有那个键（不摆那一行、编辑框不交）。
   * 合同状态空着是 null（写「—」，下拉能选回「—」）
   */
  项目新字段?: { painPoints?: string | null; contractStatus?: 合同状态 | null };
  /**
   * 企业版备货状态、物流状态、物流单号（迁移 154，客户 11-19）：不是企业版不传。备货状态三项固定，没填 null；
   * 物流状态 = 存的选项名 + 字典 projLogistics 启用着的（同项目标签）；物流单号一行文字；
   * 已签收 = 物流状态里算「已签收」的（客户 11-19 定稿，load.ts 备货物流格）
   */
  备货物流?: { 备货状态: 备货状态 | null; 物流状态: { 值: string | null; 选项: string[] }; 物流单号: string | null; 已签收?: 已签收格 };
  /**
   * 企业版节点必填：这个节点配了必填才有（没开 / 没配 / 有结局 / 在公海 = null）。填齐了自动往前推一格；
   * 缺着必填谁都不能手动往前推（客户 11-19 定稿，全员统一；往后退、点结局照旧）
   */
  /** 交付结清只能在尾款结算点（客户 11-19 定稿；现在受节点推进开关管，load.ts 和 db.ts 改节点 同一个判断）；不传 = 不查 */
  交付只在尾款?: boolean;
  必填: { 配了: string[]; 还差: string[]; /** 「仅上级推」下这个节点已经齐了、看的人存一下就会自动推一格（load.ts） */ 存一下就推?: boolean } | null;
  /** 企业版 D-37：负责人有直属上级、我又不是这位上级（也不是老板）时，往前推不给的那句话；null = 能推 */
  不给推: string | null;
  /** 不给推时谁能点「完成节点」：上级 / 负责人 / 销售管理或总管理（load.ts）；不传按「上级」说 */
  不给推谁能推?: string | null;
  /** 能改节点：能改的人 + 企业版负责人的直属上级（账号可能是 SALES）；只管节点这一块 */
  能改节点: boolean;
  /** 能转让（换负责人）：企业版 = 总管理、负责人的实线上级（业务线对得上，lib/enterprise/permissions.ts 能转让项目）、负责人本人转出自己的 */
  能转让?: boolean;
  /** 企业版：转给这些人以后我还看得到这个项目（没有 = 按看不到说） */
  转后还能看?: string[];
  balanceSettled: boolean; balanceSettledBy: string | null; balanceSettledAt: string | null;
  acceptancePassed: boolean; acceptancePassedBy: string | null; acceptancePassedAt: string | null;
  /** kind 不是 node 的行是换负责人（转让 / 放回公海 / 从公海领取），transfer 记从谁到谁；category 是进异常时选的类别 */
  logs: {
    id: string; at: string; who: string; from: 位置 | null; to: 位置; reason: string | null; category: string | null;
    kind: "node" | "transfer" | "pool-release" | "pool-claim"; transfer: { from: string; to: string } | null;
    /** pool-release 才有：超时系统收的、办停用时放的（who 是办的那位）、手动放回 */
    放回方式?: 放回方式;
  }[];
  /** 企业版：code 是沟通编号（只在服务端用，界面不摆），提醒按下一步时间写事实（page.tsx 时限标签），没填下一步时间不给 */
  followUps: { id: string; type: string; method?: string | null; /** 发起主体（企业版，11-01） */ initiator?: string | null; content: string; occurredAt: string; who: string; node: string; /** 打开修改时的 updatedAt：别人先改了就报版本冲突 */ 版本?: string; code?: string | null; 提醒?: { 级别: "稳" | "拿捏" | "超时"; 文字: string } | null;
    /** 企业版沟通上的截图、录音（F-跟进-07）；我记的 = 这条是我记的（记的人能往上加附件，删 = 系统管理员或身为负责人的管理，M-权限-09 原口径 11-09） */
    附件?: 附件[]; 我记的?: boolean;
    /** 企业版：这条沟通的归属人不是当前负责人（负责人可以点一下不看，11-02） */
    接手前?: boolean;
    /** 企业版记录人本人能改到几点（写入 + 30 分钟，11-19）；不是我记的、我已经记不了这个项目的不给。原本就能改的看 可改沟通 */
    本人可改到?: string;
    /** 本人限时改时下一步跟着改（这个项目最近一条、负责人自己记的）：项目上现在的下一步和这条的下一步时间；不给 = 修改框不出这两格 */
    下一步?: { 文字: string; 时间: string | null };
    /** 改过（操作日志里有「改了沟通」）：行上标「已修改」 */
    已修改?: boolean }[];
  members: 组员[];
  /** 企业版提成卡：不是企业版、我看不了（不是组长 / 组员 / 管理员 / 上级）= null，卡片不出 */
  提成: 提成卡 | null;
  /** 删项目时一起删掉的：节点留痕（含转让痕）、项目组、沟通和项目的关联 */
  删前清点: { 留痕: number; 组员: number; 沟通: number };
  /** 企业版项目画像（P11）：不是企业版、公海里没领的不给 */
  画像?: 项目画像;
  /** 企业版关联客户 / 联系人（P17）：不是企业版、公海里没领的不给 */
  关联?: 项目关联;
  /** 企业版项目附件（P11）：看得到才有；只读 = 不能改这个项目（api/attachments/access.ts 项目附件入口） */
  项目附件?: { 合同: number; 方案: number; 验收报告?: number; 其它: number; 只读: boolean };
  /** 企业版项目回款（10-31，迁移 100）：一笔一行；项目卡上写「当前回款」= 按币种加 */
  回款们?: 回款[];
};

/** 项目卡「线索验证」结果的颜色（11-01 六个叫法） */
const 行样: React.CSSProperties = { display: "flex", gap: 12, alignItems: "center", marginBottom: 8, minWidth: 0 };
/** 详情页顶上提示条和下面隔开（行内样式闸门：新加的提示条用模块常量） */
const 提示条下距: React.CSSProperties = { marginBottom: 16 };
/** 指定分配时间那一行（11-17）：窄宽度折行；写在组件外，行内样式只减不增（tests/inline-style-cap.test.ts） */
const 定时行样: React.CSSProperties = { ...行样, flexWrap: "wrap", rowGap: 4 };
const 可折行样: React.CSSProperties = { whiteSpace: "normal", overflowWrap: "anywhere" };
const 满宽: React.CSSProperties = { width: "100%" };
// 四个字的键（来源线索 / 预计成交）在 14px 下要 ~56px，48px 会折成两行（10-27）
// 多行的格子（需求描述、痛点、备注；前两个 11-04 起平时一行）：键和第一行对齐，不居中到一大段字的中间
const 多行行样: React.CSSProperties = { ...行样, alignItems: "flex-start" };
/**
 * 项目资料卡的行（设计语言 D5 · M10，#403 审查）：行距、负边距、悬停底、对齐都交给 globals.css 的 .proj-info-row，
 * 行内样式去掉 marginBottom / alignItems / gap（不然 CSS 要 !important 才压得过）；多行的那种挂 is-top 顶对齐
 */
const 现资料样 = new Map<React.CSSProperties, React.CSSProperties>([行样, 多行行样, 定时行样].map((样) => {
  const 余 = { ...样 };
  delete 余.marginBottom;
  delete 余.alignItems;
  // 字段名和值之间的 12 也交给 .proj-info-row（卡片改进要收成 8、和左栏客户资料同一列宽）
  delete 余.gap;
  return [样, 余];
}));

/** 就地改：多行文字 */
function 文字编辑器(名: string, 上限: number) {
  return function 编辑文字({ 草稿, set草稿, 忙 }: 编辑器参数<string>) {
    return <Input.TextArea aria-label={名} autoFocus autoSize={{ minRows: 2, maxRows: 10 }} maxLength={上限} showCount disabled={忙} value={草稿} onChange={(e) => set草稿(e.target.value)} />;
  };
}

/** 就地改：一行文字（物流单号）；回车存 */
function 单行编辑器(名: string, 上限: number) {
  return function 编辑一行({ 草稿, set草稿, 忙 }: 编辑器参数<string>) {
    return <Input aria-label={名} autoFocus maxLength={上限} disabled={忙} value={草稿} onChange={(e) => set草稿(e.target.value)} />;
  };
}

/** 删项目的确认框：列出一起删掉的几样，说清沟通记录本身不删 */
function 删除说明(n: 项目详情["删前清点"], 客户叫法: string, 进回收站 = false) {
  const 删 = [`${n.留痕} 条进程留痕`, n.组员 ? `项目组 ${n.组员} 人` : "", n.沟通 ? `${n.沟通} 条沟通和这个项目的关联` : ""].filter(Boolean);
  // 企业版（P9）：删了进回收站，留痕、项目组原样留着，恢复时一起回来
  if (进回收站) return (
    <div style={{ maxWidth: 320 }}>
      <div>删了进回收站，30 天内可在 设置 → 回收站 恢复。</div>
      <div>一起收起来：{删.join("、")}，恢复时原样回来；沟通记录本身留在{客户叫法}下</div>
    </div>
  );
  return (
    <div style={{ maxWidth: 280 }}>
      <div>一起删掉：{删.join("、")}</div>
      <div>沟通记录本身留在{客户叫法}下，不删。删了找不回来</div>
    </div>
  );
}

/**
 * 下拉里的去处：每个阶段的节点，加上这个阶段的「没走成」结局（订单阶段是成功交付和异常状态）。
 * 异常状态只在项目已经在订单阶段时出现，线索、商机阶段不给这个入口。
 * 往前只能一步（比现在多走超过一步的灰着），往后随便退——和 lib/project/nodes.ts 改节点问题 同一条规矩。
 * 企业版（字典跨阶段不能退）：前面阶段的节点、结局都灰着；线索、商机阶段多列一条「→ 转商机 / → 赢单」，
 * 选它 = 进下一阶段第一个节点（和直接选那个节点一样），让「线索只能流失或转商机、商机只能流失或赢单」在下拉里看得见
 */
function 去处们(当前: 位置, 不能往前 = false, 字典: 阶段字典 = 团队版字典, 交付只在尾款 = false) {
  // 配了必填、还没填齐：往前的节点灰着（靠填齐自动推），结局照旧能点（企业版交付结清只在尾款结算能点，客户 11-19 定稿，服务端 改节点问题 同一条）
  const 太远 = (到: 位置) => 节点序号(到, 字典) > 节点序号(当前, 字典) + (不能往前 && !到.result ? 0 : 1);
  const 退不回 = (s: string) => !字典.跨阶段能退 && 阶段们.indexOf(s as never) < 阶段们.indexOf(当前.phase as never);
  return 阶段们.map((s, i) => {
    const 列 = 字典.节点们[s];
    const 尾 = 列[列.length - 1];
    const 结局 = (s === "订单" ? 字典.出口们.订单 : [字典.出口们[s][1]])
      .map((o) => o.结局)
      .filter((r): r is NonNullable<typeof r> => !!r && (r !== "异常状态" || 当前.phase === "订单"));
    const 下阶段 = 阶段们[i + 1];
    const 走成 = !字典.跨阶段能退 && 下阶段 ? 字典.出口们[s][0] : null;
    return {
      label: s,
      options: [
        ...列.map((n) => {
          const 到 = { phase: s, node: n };
          return { value: JSON.stringify(到), label: n, disabled: (!当前.result && 当前.phase === s && 当前.node === n) || 太远(到) || 退不回(s) };
        }),
        // 结局落在哪个节点：没走成的停在当前节点（同阶段时），否则停在阶段最后一个节点
        ...结局.map((r) => {
          const 到 = { phase: s, node: 当前.phase === s ? 当前.node : 尾, result: r };
          return { value: JSON.stringify(到), label: `→ ${结局叫法(r, 字典)}`, disabled: 当前.result === r || 太远(到) || 退不回(s) || (交付只在尾款 && 是交付(r) && !!交付不在尾款话(当前, 到, 字典)) };
        }),
        // 走成那条（只在项目还在这个阶段时能点）：值里带个 出口 记号，免得和下一阶段第一个节点撞值；改到 之前去掉
        ...(走成 && 下阶段
          ? [(() => {
              const 到 = { phase: 下阶段, node: 字典.节点们[下阶段][0] };
              return { value: JSON.stringify({ ...到, 出口: 走成.叫法 }), label: `→ ${走成.叫法}`, disabled: 当前.phase !== s || 太远(到) };
            })()]
          : []),
      ],
    };
  });
}

/** 项目怎么进的公海、节点记录那几句（位置文字 / 换人文字）挪进 lib/project/node-log-text.ts（11-24 客户详情「历史变更」共用） */
export type { 放回方式 } from "@/lib/project/node-log-text";

/** 负责人那一行括号里：怎么进的公海 */
/**
 * 空着的字段（含导入时拿 "-" 占位的，用 有值 判）一律写「—」（11-01 会议：未填的字段都用 — 代替，原来写「待填写X / 待选择X」）；
 * 浅灰、悬停说是哪一格没填。只是显示，不存。0 算填了，由调用方用 !== null 判
 */
const 待填 = (名: string) => <span style={{ color: "var(--empty-fg)" }} title={`未填：${名}`} data-empty={名}>{空值符}</span>;
/** 这个进程配了必填、还没填的那几格：同样写「—」，悬停写「必填：X，填齐后自动往前推」（10-31 原来写「占位确认」四个字，11-01 会议改成一律 —） */
const 占位确认 = (名: string) => <span style={{ color: "var(--empty-fg)" }} title={`必填：${名}，填齐后自动往前推`} data-empty={名} data-required="">{空值符}</span>;

/**
 * 设计语言 D5 · M10-b：金额不用省略号截断——几种币用「 · 」连，放不下就在「 · 」处换到下一行，每段数字本身不拆（.proj-money-seg nowrap）
 */
function 钱字(话: string) {
  return (
    <span className="proj-money">
      {话.split(" · ").map((段, i) => <Fragment key={i}>{i > 0 && " · "}<span className="proj-money-seg">{段}</span></Fragment>)}
    </span>
  );
}
const 空色样: React.CSSProperties = { color: "var(--empty-fg)" };
/** 联系人那一格（D5 · M10-a）：名字没填的「—」和别的空值同一个色（原来墨色），职位照写 */
function 联系人字(c: { name: string | null; position?: string | null }) {
  return <span className="proj-one">{c.name?.trim() ? c.name : <span style={空色样} title="没填姓名">{空值符}</span>}{c.position ? ` · ${c.position}` : ""}</span>;
}

/** 项目级别格（企业版 P11）：星 + 档名（「★★★☆ A 重点」）；没分级写「—」（11-01 没填的统一「—」），认不出的原样给 */
function 级别格(v: string | null) {
  if (!有值(v)) return <span style={{ color: "var(--empty-fg)" }}>{空值符}</span>;
  const 档 = 企业级别(v);
  if (!档) return <span>{v}</span>;
  return (
    <span title={企业级别说明[档]}>
      <span aria-hidden style={{ color: "var(--warning-text)", letterSpacing: 1 }}>{级别星(档)}</span>
      {" "}<span style={{ color: "var(--text-muted)" }}>{企业级别说明[档].replace(/^\S+\s*/, "")}</span>
    </span>
  );
}

/**
 * 「完成节点」补填框放不下时：能翻就翻、翻了也放不下就挪进屏里（放外面，每次渲染同一个对象）。
 * antd 把这个对象原样并进浮层库的 overflow（_util/placements getOverflowOptions），shiftY 浮层库认、antd 的类型没列，只能断言
 */
const 补填框挪进屏 = { adjustX: 1, adjustY: 1, shiftY: true } as Exclude<PopoverProps["autoAdjustOverflow"], boolean | undefined>;
/*
  K5（设计语言 E2，29K⑥）：浮层库往屏里挪（shiftY）时不算挂在按钮下面那 4px 间距，挪完外框下沿总比屏幕低 3–4px、页面能多滚这一截。
  把间距从「偏移」挪进外框（globals.css .pd-fill-pop 上边留白），偏移归零，挪的时候整块都算进去
*/
const 补填框不偏移: PopoverProps["align"] = { offset: [0, 0] };

/**
 * 公海提示条那句（项目页、客户页项目区同一个）：能领说领了怎样；领不了说为什么。
 * 「是你放回去的」只对真放回的那位说（放回的是我）：原来领不了又没给原因的一律这么说，管理员看别人退回的项目也被说成「你放回去的」（11-20 c2 实操）
 */
function 公海告示话(p: Pick<项目详情, "能领取" | "领取不给" | "放回的是我">): string {
  if (p.能领取) return "领取了你就是负责人，可以接着推进程";
  if (p.领取不给 === 原负责人不能领回提示) return `你是原负责人，${原负责人不能领回提示}，等同事领取`;
  if (p.领取不给) return p.领取不给;
  return p.放回的是我 ? "是你放回去的，等同事领取" : "你的账号不能领公海项目，等能领的同事领取";
}

function 进公海说法(进: 项目详情["进公海"], 原负责人: string): string {
  if (!进) return "";
  if (进.方式 === "超时") return " · 超时没跟进，系统自动收回";
  if (进.方式 === "停用") return ` · 成员停用，${进.谁} 放回`;
  return 进.谁 === 原负责人 ? " · 自己放回的" : ` · ${进.谁} 放回的`;
}

/**
 * 页头那行：项目负责人、项目创建人各写各的（11-02，原来的「X 建于」看不出 X 是什么人）；负责人空着写「—」（11-11：没填的一律「—」）。只在页头写，项目卡不再摆一遍。
 * 在公海里时 ownerName 是原负责人：不写成负责人是 X，也不把系统收回说成 X 放回的（QA #14）
 */
function 负责人说法(p: 项目详情): string {
  const 负责人 = (p.pooled ? "" : p.ownerName) || 空值符;
  const 公海 = p.pooled ? `（在公海里${p.ownerName ? `，原负责人 ${p.ownerName}` : ""}${进公海说法(p.进公海, p.ownerName)}）` : "";
  return `${负责人}${公海}`;
}
function 项目人说法(p: 项目详情): string {
  return `项目负责人：${负责人说法(p)} · 项目创建人：${p.creatorName || 空值符}`;
}

/**
 * 项目详情：顶上是节点进度和「下一步」，中间改节点 / 点结局、勾尾款结清和验收通过，下面是节点变更和挂在这个项目上的沟通。
 * 只有负责人、老板、主管能改；其他人看得到、按钮灰着
 */
/** 企业版卡点：项目详情上的卡点列表、发卡点要的默认值和阻碍原因下拉；不是企业版不给（null） */
export type 项目卡点 = { 们: 卡点卡[]; 能发: boolean; 默认: 卡点默认; 原因们: string[] };

/** 「项目画像」模块壳的落点 id（F-017「去填」需求状态滚过去）：独立页、嵌在客户页两处画像卡挂同一个 */
const 画像落点 = "project-profile-fold";
/**
 * 弹框里一格的标签（D4 · M7-b / M9-a）：* 在前、说明挪到格子下面（fm-help）
 */
function 格标签({ 名, 必填 }: { 名: string; 必填?: boolean }) {
  return <div className="fm-label">{必填 && <span className="fm-req" aria-hidden>*</span>}{名}</div>;
}
/** 必填键 → 右栏就地改那一格的名字（ProjectInlineField 名），一样的不列 */
const 右栏格名: Record<string, string> = { 项目级别: "级别", 主联系人: "联系人", 合同已生效: "合同状态", 已备货: "备货状态", 已签收: "物流状态", 预计成交日期: "预计成交", 项目所在地: "区域" };
/** 缺项小块点「去客户」的几项落在客户资料哪一格（customers/[id] RecordView 的 data-field / #field-xxx） */
const 客户资料格: Record<string, string> = { 国家: "addrCountry", 客户等级: "level", 来源: "source", 联系方式: "numbers", ...客户格 };
/** 企业版「来源」缺项的就地说法：客户页上没有来源那一格，渠道 / 渠道触点是建客户时选的（CustomerForm 企业来源必填） */
const 企业来源话 = "客户来源在建客户时选定（渠道或渠道触点），建好后不能改；空着的请联系系统管理员";
const 无效原因前缀 = "无效原因：";

// 规则 E：红只给已经过了的，当天橙，还早的不上色
const 提醒色 = { 稳: undefined, 拿捏: "gold", 超时: "red" } as const;


/**
 * 节点卡「更多」里的去处（10-30 P0-8 / P2）：按 往前 / 退回 / 结束 分组，每项写明会跳过哪几步。
 * 能不能点还是 去处们 那一套（往前只能一步、企业版不能退回前面的阶段）；紧挨着的下一步就是主按钮，菜单里不重复。
 * 已经有结局（流失 / 异常 / 成功交付）的：改回某个进程、或换个结局
 */
/** 企业版节点卡上「完成节点」「改回进程 / 改到别的进程」开的框 → 框的标题（别的具名按钮 11-01 回到各自的卡上，不再开框） */
const 头部框叫法 = {
  推进: "改进程",
  完成: "完成节点",
} as const;
type 头部框 = keyof typeof 头部框叫法;

function 更多去处(当前: 位置, 组们: ReturnType<typeof 去处们>, 字典: 阶段字典): NonNullable<MenuProps["items"]> {
  const 序 = 节点序号(当前, 字典);
  const 全路 = 阶段们.flatMap((s) => 字典.节点们[s].map((n) => ({ phase: s as string, node: n })));
  const 叫 = (到: 位置) => (到.phase === 当前.phase ? 到.node : `${到.phase}·${到.node}`);
  const 项们 = 组们.flatMap((g) => g.options.map((o) => {
    const v = JSON.parse(o.value) as 位置 & { 出口?: string };
    return { key: o.value, 到: { phase: v.phase, node: v.node, ...(v.result ? { result: v.result } : {}) } as 位置, 出口: v.出口, disabled: o.disabled };
  }));
  const 结束注 = (r: string) => (r === "异常状态" ? "标成异常，处理好了改回进程就恢复" : "项目到此结束，以后可以改回进程");
  const 结束们 = 项们.filter((x) => x.到.result && !x.disabled && x.到.result !== 当前.result)
    .map((x) => ({ key: x.key, label: 两行(结局叫法(x.到.result!, 字典), 结束注(x.到.result!)) }));
  const 组 = (key: string, label: string, children: NonNullable<MenuProps["items"]>) => (children.length ? [{ type: "group" as const, key, label, children }] : []);
  if (当前.result) {
    const 回 = 项们.filter((x) => !x.到.result && !x.出口 && !x.disabled).map((x) => ({ key: x.key, label: 两行(叫(x.到)) }));
    return [...组("back", "改回进程", 回), ...组("end", "结束", 结束们)];
  }
  // 走成那条（转商机 / 赢单）和下一阶段第一个节点是同一个去处：留有名字的那条
  const 走成到 = new Set(项们.filter((x) => x.出口).map((x) => `${x.到.phase}|${x.到.node}`));
  const 节点们 = 项们.filter((x) => !x.到.result && !(!x.出口 && 走成到.has(`${x.到.phase}|${x.到.node}`)));
  const 往前 = 节点们
    .map((x) => ({ ...x, n: 节点序号(x.到, 字典) }))
    .filter((x) => x.n > 序 + 1 && x.n <= 序 + 4)
    .map((x) => {
      const 跳 = 全路.slice(序 + 1, x.n).map(叫);
      return { key: x.key, disabled: x.disabled, label: 两行(x.出口 ?? 叫(x.到), `会跳过 ${跳.join("、")}${x.disabled ? "（只能一步步推）" : ""}`) };
    });
  const 退回 = 节点们
    .map((x) => ({ ...x, n: 节点序号(x.到, 字典) }))
    .filter((x) => x.n < 序 && !x.disabled)
    .sort((a, b) => b.n - a.n)
    .map((x) => ({ key: x.key, label: 两行(叫(x.到), `退回 ${序 - x.n} 步`) }));
  return [...组("forward", "往前", 往前), ...组("back", "退回", 退回), ...组("end", "结束", 结束们)];
}

/** 项目详情的数据（projects/[id]/load.ts 读出来，项目详情页和客户详情的项目区都按这一份画） */
export type 项目详情Props = {
  p: 项目详情;
  能改: boolean;
  候选: 可选成员[];
  在职: 可选成员[];
  联系人们: 联系人[];
  角色们: 角色[];
  /** 在用的异常类别（进异常状态时选） */
  类别们: { id: string; name: string }[];
  卡点?: 项目卡点 | null;
  /** 企业版教练主题（11-17）：看得到才给；没有主题、我也发不了 = null，沟通卡里不出这一块 */
  教练主题?: 项目主题们 | null;
};

/**
 * 嵌在客户详情里（11-12 客户详情合并第 2 批，定稿 UI 客户详情-定稿UI-20261112.html 的项目区）：
 * 不画页头；项目切换在进程卡卡头（客户页给）；中栏 阶段 → 沟通 → 待办 → 卡点，右栏项目资料各卡。
 * 这个项目的「领取」「项目转让」「项目退回公海」「删除项目」在客户页右上角「更多操作 ▾」里（11-12 用户），点了经 动作口 递回这里开框
 * 沟通卡标题旁「本项目 / 这位客户全部」，全部 = 客户页那条时间线（客户页给）；待办是客户页那张卡（客户页给）
 */
export type 嵌在客户页 = {
  /** 项目切换（客户页给，11-12 方案一）：摆在进程卡卡头左边，「完成节点」在同一行右边；进程卡不再摆三个阶段页签 */
  页签行: ReactNode;
  /** 客户三态提醒条（客户页给，有才摆）：只占中栏宽、在进程卡正上方 */
  提醒?: ReactNode;
  /** 客户页「更多操作 ▾」点了哪项：这里把处理函数挂给客户页（卸载时挂 null），客户页调它 */
  挂动作?: (做: ((key: 项目动作键) => void) | null) => void;
  /** 正在提交时告诉客户页：「更多操作 ▾」里的项跟着灰（卸载时报 false） */
  报忙?: (忙: boolean) => void;
  全部沟通: ReactNode;
  全部沟通数: string;
  待办: ReactNode;
  /** 项目退回公海 / 转走后自己看不到了：回客户详情（不带 ?project），不回项目列表 */
  客户页: string;
  /**
   * 右栏摆不摆「项目进程变更」卡：客户详情不摆（11-24 挪进客户名下那一行的「历史变更」弹窗，客户状态那段也在弹窗里）；
   * 受限客户详情（只负责项目的人）没有「历史变更」入口，照摆
   */
  进程变更卡?: boolean;
  /** 受限客户详情（只负责项目的人）：不给「这位客户全部」，沟通卡只看本项目 */
  无全部沟通?: boolean;
  /**
   * 受限客户详情：这是他在这位客户下最后一个项目时给。转让 / 退回公海 / 删除成功、自己看不到这个项目了，
   * 回客户页会 404，改去这里（客户列表）并提示一句
   */
  走后去?: { 到: string; 说法: string } | null;
};

export default function ProjectDetail({
  p, 能改, 候选, 在职, 联系人们, 角色们, 类别们, 卡点 = null, 教练主题 = null, 嵌入,
}: 项目详情Props & { 嵌入?: 嵌在客户页 }) {
  // 无意义沟通（F-052）：沟通列表里就地改内容那一行要的判定，一页取一次（FollowMeaningLine 读共用那份）
  useFollowJudge(p.企业版);
  const router = useRouter();
  /** 去别的页 / 详情：等新页时顶上的条亮（lib/nav-pending.ts） */
  const 去页 = useNavGo();
  // 不弹顶部提示（原型 g.save / g.notice）：页面上做的事成没成写在正文底部的就地小条；弹框里的原因写在框里（跑 的 报错）
  const [就地, 回执条] = useDetailNote();
  const b = useBusiness();
  const [忙, set忙] = useState(false);
  /** 后果框（PR5a）：判无效（dt.invalid）、删回款（dt.pay） */
  const [问后果, 后果框] = useConsequence();
  /** 项目资料卡一行的 class / style：挂 .proj-info-row */
  const 资料行 = (样: React.CSSProperties = 行样) => ({ className: 样 === 多行行样 ? "proj-info-row is-top" : "proj-info-row", style: 现资料样.get(样) });
  /** 资料行的字段名挂 .proj-info-k（宽度、省略交给 globals.css，卡片改进统一成 68 列，和左栏客户资料同一列宽） */
  const 键 = { className: "proj-info-k" };
  /** 删沟通没删成：原因写在那条沟通下面（就地，不弹顶部提示） */
  const [删沟通错, set删沟通错] = useState<{ id: string; 话: string } | null>(null);
  const [异常框, set异常框] = useState<位置 | null>(null);
  const [没成框, set没成框] = useState<位置 | null>(null);
  /** 异常框 / 没成框是「终止进程」开的（M-节点-04）：确定时走 终止项目进程 */
  const [终止中, set终止中] = useState(false);
  const [无效原因, set无效原因] = useState<string | null>(null);
  const [放回框, set放回框] = useState(false);
  const [回收原因, set回收原因] = useState<string | null>(null);
  const [原因, set原因] = useState("");
  const [类别, set类别] = useState<string | null>(null);
  const [编辑开着, set编辑开着] = useState(false);
  // 企业版线索验证弹窗（11-01）：项目卡「线索验证」那一行点开，从初判到判定都在框里做
  const [验证开着, set验证开着] = useState(false);
  const [记一条开着, set记一条开着] = useState(false);
  const [发卡点于, set发卡点于] = useState<string | null>(null);
  /** 沟通的「…」菜单：正在改哪一条 / 删除问句开在哪一条上 */
  const [改沟通于, set改沟通于] = useState<项目详情["followUps"][number] | null>(null);
  const [删问于, set删问于] = useState<string | null>(null);
  /** 记录人本人 30 分钟内能改（11-19）：到点就收起「修改」，服务端照样拒 */
  const { 能改: 本人能改, 钟差 } = useOwnEditWindow(p.followUps.map((f) => f.本人可改到), p.服务器现在);
  const 能改这条 = (f: 项目详情["followUps"][number]) => !!p.可改沟通 || 本人能改(f.本人可改到);
  /** 转让项目（10-30，原名「转给…」；U-项目-07 起点了确认就转、不再等 6 秒撤销）：弹窗开着、选了谁 */
  const [转给框, set转给框] = useState(false);
  const [转给谁, set转给谁] = useState<string | null>(null);
  /** 企业版 C-06：原负责人没做完的待办一起转给接手人（默认勾，可以手动关掉；pool-rules.ts）。不是企业版不摆这个勾、不传 */
  const 带待办勾出 = p.企业版 && 公海规则.换负责人带待办;
  const [转给带待办, set转给带待办] = useState<boolean>(公海规则.带待办默认勾);
  /** 异常框 / 没成框 / 放回框 / 转让框（同一时刻只开一个）没做成的原因：写在框里、框不关（g.save，不弹顶部提示）；换框、关框就清 */
  const 开着的框 = 异常框 ? "异常" : 没成框 ? "没成" : 放回框 ? "放回" : 转给框 ? "转给" : null;
  const [框错原, set框错原] = useState<{ 框: string | null; 话: string } | null>(null);
  /** 只认记下它的那个框：换了框、关了再开（下一次 跑 先清），旧原因不跟过去 */
  const 框错 = 框错原 && 框错原.框 === 开着的框 ? 框错原.话 : null;
  const 框报错 = { 报错: (话: string | null) => set框错原(话 ? { 框: 开着的框, 话 } : null) };
  /** 企业版瀑布流（U-项目-01/04）：沟通默认展开、卡点与任务默认收起；搜索词非空时两块都摊开、只列搜得到的 */
  const [沟通开, set沟通开] = useState(true);
  const [卡点开, set卡点开] = useState(false);
  const [搜, set搜] = useState("");
  /** 嵌在客户页：沟通卡看「本项目」还是「这位客户全部」（定稿 D1：默认本项目） */
  const [看全部沟通, set看全部沟通] = useState(false);
  /** 负责人点了「隐藏接手前」（11-02）：只是不显示，默认显示全部 */
  const [只看接手后, set只看接手后] = useState(false);
  /** 企业版页头具名按钮开的那个框（10-31 R6），一次只开一个 */
  const [头部框, set头部框] = useState<头部框 | null>(null);
  const 必填草稿 = useRef<Record<string, 草稿们>>({});
  const 当前: 位置 = { phase: p.phase, node: p.node, result: p.result };
  const 字典 = 字典of(p.企业版, p.出口叫法);
  const 节点总数 = 节点总数of(字典);
  const 下 = 下一步(当前, 字典);
  // 企业版验收两种都行（M-必填-11）：勾了验收通过，或项目附件「验收报告」里传了一份
  const 差 = 交付还差({ ...p, 有验收报告: p.企业版 && (p.项目附件?.验收报告 ?? 0) > 0 });
  // 订单走成的结局：团队版 成功交付、企业版 交付结清（10-31 改名）；叫法按字典（后台改了就用改的）
  const 交付结局 = 字典.出口们.订单[0].结局 ?? "成功交付";
  const 交付叫法 = 结局叫法(交付结局, 字典);
  const 交付了 = 是交付(p.result);
  // 企业版交付结清只能在尾款结算点（客户 11-19 定稿）：不在那一步 = 那句话（交付卡按钮不摆），服务端 改节点问题 同一条
  const 交付不在尾款 = p.企业版 && p.交付只在尾款 && !交付了 ? 交付不在尾款话(当前, null, 字典) : null;
  const 异常 = p.result === "异常状态";
  const 可改 = 能改 && !p.pooled;
  // 企业版 11-01：只有负责人能改内容，总管理、上级、组员都只能看
  const 改不了话 = p.企业版 ? "只有项目负责人能改，其他人只能看" : "只有项目负责人、老板或主管能改";
  const 不能改 = p.pooled ? "这个项目在线索公海里，领取了才能改" : 能改 ? undefined : 改不了话;
  const 节点可改 = p.能改节点 && !p.pooled;
  const 节点不能改 = p.能改节点 ? (p.pooled ? 不能改 : undefined) : 不能改;
  // 企业版：线索阶段线索验证的必填项还没填齐（没配就看需求状态），推不过「线索验证」（服务端 lib/project/stage-gates.ts 同一条）
  const 没有效沟通 = p.企业版 && p.phase === "线索" && !p.result && p.有效沟通差.length > 0;
  // F-017：「前两节点要沟通」开着、线索验证上还没沟通，服务端推的时候还会再拦一次，灰按钮的话一并写上（开关关着不写）
  const 沟通半句 = p.线索验证缺沟通 ? `，并在「${有效线索节点}」记一条沟通` : "";
  const 缺有效沟通话 = 没有效沟通 ? 缺有效沟通还差(p.有效沟通差) + 沟通半句 : null;
  const 卡有效沟通 = 没有效沟通 && !!下 && 节点序号(下, 字典) > 节点序号({ phase: "线索", node: 有效线索节点 }, 字典);
  // F-017：要推过线索验证的缺项只在下一步要越过线索验证时出（卡有效沟通：停在线索验证或更后）；潜客培育往下推到线索验证不拦，不出（客户 11-19 第 31a 题）。
  // 需求状态在右栏「项目画像」卡上（不在「项目资料」卡里），缺项说明写明位置
  const 缺需求 = p.有效沟通差.includes(必填叫法("需求"));
  // 企业版线索阶段不显示交付（QA #5）：只有订单阶段才有尾款、验收
  const 显示交付 = !p.企业版 || p.phase === "订单";
  // 线索在等复核：服务端这时不给改进程、点结局、放回公海（lib/project/lead-verify-guard.ts），界面直接灰着说清在等谁
  const 等复核文字 = 等复核说法(p);
  const 等复核 = !!等复核文字;
  // 「下一步」灰着的原因写在按钮下面（规则：灰按钮要写为什么），不靠悬停
  const 动不了 = (节点可改 ? undefined : 节点不能改 ?? 改不了话) ?? 等复核文字;
  // 往前推另外的关：直属上级才推 / 需求状态补全期（p.不给推）、线索验证缺有效沟通
  const 往前不了 = p.不给推 ?? (卡有效沟通 ? 缺有效沟通话! : undefined);
  // 配了必填：缺着必填谁都不能往前推（客户 11-19 定稿，全员统一）；填齐了（占位值不算）照样能推（M-节点-05/09）
  const 缺必填 = p.必填?.还差.length ? `还差必填：${p.必填.还差.map(必填叫法).join("、")}；补齐再推` : undefined;
  const 推不了 = 动不了 ?? 往前不了 ?? 缺必填
    ?? (下 ? undefined : p.result ? "先改回某个进程再往前推" : "这是最后一个进程了，接下来点结局");
  const 下一步字 = 下 ? `下一步：${下.phase === p.phase ? 下.node : `${下.phase}·${下.node}`}` : "下一步";

  // 卡片就地改（11-02）：只开企业版；字段权限不是「改」的那几项不摆入口（服务端 改项目 同一张表）。入口灰不灰不看 忙，存的时候各格自己转圈
  const 能就地改 = 可改 && p.企业版;
  const 字段能改 = (名: string) => 能就地改 && !p.只能看字段?.includes(名);
  const 备货物流 = p.备货物流;
  /** 存项目卡的一格：同一个 编辑项目（权限、字段权限、留痕都在里面）；失败把原因交回格子，留在编辑态 */
  const 存项目项 = async (patch: Parameters<typeof 编辑项目>[1]): Promise<string | null> => {
    const r = await 编辑项目(p.id, patch);
    if (!r.ok) return r.error ?? "没存上，请稍后再试";
    if (r.自动推到?.length) 就地.success(`必填齐了，自动推进到 ${r.自动推到.join(" → ")}`);
    router.refresh();
    return null;
  };
  /** 钱格就地改：框里敲了认不出的字（AmountInput 交 NaN）不交，框不收、就地说为什么（money-cell.tsx） */
  const 存钱格 = 钱格存法(存项目项);
  /** 存沟通正文：版本冲突（别人刚改过）失败时也刷新，拿到新版本，草稿还在，再点保存就行 */
  const 存沟通正文 = async (f: 项目详情["followUps"][number], content: string): Promise<string | null> => {
    const 交 = 沟通正文改动(f, content);
    if ("error" in 交) return 交.error ?? "请填写这次沟通的内容";
    const r = await 改项目沟通(p.id, f.id, 交.改动);
    router.refresh();
    return r.ok ? null : r.error ?? "没存上，请稍后再试";
  };

  /**
   * 跑一个改动：成了回执写在正文底部的就地小条（成了 那句；必填齐了自动推进几步也写），页面刷新；
   * 没成的原因交给 选.报错（弹框里做的事：写在框里、框不关），没给就写在就地小条上（role=alert）。不弹顶部提示（g.save）
   */
  const 跑: 跑法 = async (f, 成了, 选) => {
    const 报 = (话: string) => (选?.报错 ? 选.报错(话) : 就地.error(话));
    选?.报错?.(null);
    set忙(true);
    try {
      const r = await f();
      if (!r.ok) 报(r.error ?? "没改成，请稍后再试");
      else {
        // 企业版节点必填：这次保存把必填填齐了，项目自动往前推了几步
        const 推 = r.自动推到?.length ? `必填齐了，自动推进到 ${r.自动推到.join(" → ")}` : null;
        // 成了但有一句要说的（改项目沟通 下一步没同步）：用提醒调，不当「成了」一闪而过
        if (r.提示) 就地.warning([成了, 推, r.提示].filter(Boolean).join("；"));
        else if (成了 || 推) 就地.success([成了, 推].filter(Boolean).join("；"));
        router.refresh();
      }
      return r.ok;
    } catch (e) {
      // 发版后老页面交的（lib/stale-deploy.ts）：换成「系统刚更新了，请刷新页面后再提交」
      报(动作出错话(e, "没改成，请稍后再试"));
      return false;
    } finally {
      set忙(false);
    }
  };

  /** 删项目上的一条沟通：企业版软删进回收站；不给撤销（11-09），找回走回收站 */
  /** 删成了、正在原地收起的那一条（dt.talkdel） */
  const [删走, set删走] = useState<string | null>(null);
  const 动效 = useMotionTheme();
  const 删沟通 = async (id: string) => {
    set删沟通错(null);
    set忙(true);
    let r: Awaited<ReturnType<typeof 删项目沟通>>;
    try {
      r = await 删项目沟通(p.id, id);
    } catch (e) {
      r = { ok: false, error: 动作出错话(e, "没删成，请稍后再试") };
    } finally {
      set忙(false);
    }
    // 没删成：确认条留着，原因写在这一条下面；删成了这一条原地收起再刷新，不弹顶部提示（确认条已说了进回收站、谁能恢复）
    if (!r.ok) {
      set删沟通错({ id, 话: r.error ?? "没删成，请稍后再试" });
      return r;
    }
    set删问于(null);
    set删走(id);
    // 收起放完再刷新；刷新回来这一条就不在了（删走 留着无妨，id 不会再出现）
    window.setTimeout(() => router.refresh(), 少动() ? 0 : 动效.时长.base * 1000);
  };

  /** 终止 = true：异常框 / 没成框 点确定走 终止项目进程（M-节点-04，审计写「终止进程」）；成了 = 改成了以后的提示 */
  const 改到 = (到: 位置, 附: { 终止?: boolean; 成了?: string; 可撤?: boolean; 入口?: "完成节点" } = {}) => {
    // 被缺必填拦下时服务端记哪个入口（必填拦截记录）：完成节点 / 别的改进程
    const 入口 = 附.入口 ?? "改进程";
    set终止中(!!附.终止);
    if (到.result === "异常状态") {
      set原因("");
      set类别(null);
      set异常框(到);
      return;
    }
    if (p.企业版 && 到.result === "线索流失" && p.原因选项.无效.length > 0) return void 判无效(到, !!附.终止);
    if (p.企业版 && 要写原因(到.result)) {
      set原因("");
      set无效原因(null);
      set没成框(到);
      return;
    }
    if (是交付(到.result) && 差.length) {
      就地.warning(交付还差话(差, 交付叫法, p.企业版));
      return;
    }
    // 完成节点往前推一步（dt.stage，P-界面-40「推进节点可撤销」）：不弹顶部提示，底部撤销条，撤销 = 改回原来那个节点
    /*
      撤销回到服务端回的「改之前」（原），不按页面上可能过时的那份；带「期望现在在哪」= 刚推到的这一格，推完又被人改过就不撤（说一句）；
      完成节点清掉的下一步一起带回（11-20 审查）。老服务端没回 原 时照旧按页面那份
    */
    if (附.可撤) {
      const 页上: 位置 = { phase: p.phase, node: p.node, result: p.result ?? null };
      const 回: { r?: Awaited<ReturnType<typeof 改项目节点>> } = {};
      void 跑(async () => (回.r = await 改项目节点(p.id, 到, null, null, 入口))).then((ok) => {
        if (!ok) return;
        const 原 = 回.r && "原" in 回.r && 回.r.原 ? 回.r.原 : null;
        const 回到: 位置 = 原 ? { phase: 原.phase, node: 原.node, result: 原.result } : 页上;
        showUndo({
          话: 附.成了 ?? `已改到 ${位置文字(到, 字典)}`,
          撤销: async () => {
            const r = await 改项目节点(p.id, 回到, null, { 期望在: 到, ...(原 ? { 下一步: { 文字: 原.下一步文字, 时间: 原.下一步时间 } } : {}) });
            router.refresh();
            return r;
          },
        });
      });
      return;
    }
    void 跑(() => 改项目节点(p.id, 到, null, null, 入口), 附.成了 ?? `已改到 ${位置文字(到, 字典)}`);
  };

  /**
   * 判无效（dt.invalid，P-界面-42）：一个后果框——后果分条、无效原因点选（字典 invalid，「其他」原地写、必填），
   * 不再先问一道「终止进程？」。服务端按 选的原因("invalid") 核，挡了原因写在框里、框不关
   */
  const 判无效 = async (到: 位置, 终止: boolean) => {
    const 叫 = 结局叫法("线索流失", 字典);
    await 问后果({
      题: `判「${p.name}」无效`,
      后果: [
        { 标: "会发生", 话: `项目停在「${叫}」，到此结束`, 级: "警" },
        { 标: "能改回", 话: "以后可用「改回进程」捡回来" },
      ],
      原因: { 选项: p.原因选项.无效, 叫: "无效原因（必选）" },
      是: "判无效",
      做: async (因) => {
        const r = await (终止 ? 终止项目进程(p.id, { 无效原因: 因 ?? null }) : 改项目节点(p.id, 到, { 无效原因: 因 ?? null }));
        if (!r.ok) return r;
        router.refresh();
      },
    });
  };

  /** 结束类（结局）的去处要二次确认（10-30 P2）；异常、要写原因的本来就有自己的框，成功交付没勾齐的 改到 会直接提示 */
  const 结束确认 = (到: 位置) => {
    if (!到.result || 到.result === "异常状态" || (p.企业版 && 要写原因(到.result)) || (是交付(到.result) && 差.length)) return 改到(到);
    // 后果框（PR5a，P-界面-40）：结局是一件事到此结束，写清能改回
    void 问后果({
      题: `改到「${结局叫法(到.result, 字典)}」？`,
      后果: [
        { 标: "会发生", 话: 是交付(到.result) ? `项目算${交付叫法}、到此结束` : "项目到此结束", 级: "警" },
        { 标: "能改回", 话: 是交付(到.result) ? "以后要改可以把进程改回去" : "以后要捡回来可以把进程改回去" },
      ],
      是: "确定",
      危: false,
      做: () => 改到(到),
    });
  };
  const 不能往前 = !!缺必填 || !!p.不给推 || 卡有效沟通;
  const 更多去处项 = 节点可改 && !等复核 ? 更多去处(当前, 去处们(当前, 不能往前, 字典, p.企业版 && !!p.交付只在尾款), 字典) : [];

  /**
   * 企业版「完成节点」（M-节点-05/06/09）：一次往前一个节点；本阶段最后一个节点完成 = 进下一阶段第一个节点（线索→已转商机、商机→商机赢单，
   * 同一条记录，字段都在）；订单最后一个节点完成 = 交付结清。有结局的不给完成（先改回进程）
   */
  const 完成到: 位置 | null = p.result ? null : 下 ?? { phase: p.phase, node: p.node, result: 交付结局 };
  const 完成到字 = !完成到 ? "" : 完成到.result
    ? 交付叫法
    : 完成到.phase !== p.phase ? `${字典.出口们[p.phase as (typeof 阶段们)[number]]?.[0]?.叫法 ?? "进下一阶段"}，进到 ${完成到.phase}·${完成到.node}` : `下一节点：${完成到.node}`;
  /**
   * dt.stage：必填齐了（没配也算）、推的不是结局 → 点「完成节点」一步推，推完给撤销条；
   * 还差必填 → 开框就地补齐再推（和看板拖动缺必填同一个 ProjectFillRequired）；谁都不能缺着推（客户 11-19 定稿）
   */
  const 要先补齐 = !!p.必填?.还差?.length || !!完成到?.result;
  /** 「完成节点」为什么点不了（缺必填不算：点了在框里列出来）；undefined = 能点 */
  const 完成不了 = 动不了 ?? (p.result ? "项目已经有结局，先改回某个进程" : 下 ? 往前不了 : undefined);
  /** 「完成节点」灰着正是因为 不给推（不是等复核、改不了节点这些先拦下的）→ 必填齐了那句写明该谁点 */
  const 灰在不给推 = !!p.不给推 && 完成不了 === p.不给推;
  const 谁能推 = p.不给推谁能推 || "上级";
  /*
    设计语言 D4 · M6-a：缺项小块。节点缺 = 这个节点配的必填还差的；验证缺 = 要推过线索验证还要的（卡有效沟通时才算，条件不变）。
    两边合成一份去重，判「有效」也要的打 •
  */
  const 节点缺 = p.必填 && !p.result ? p.必填.还差 : [];
  const 显示验证缺 = 卡有效沟通 && !p.线索验证?.我能 && !(p.必填 && p.node === 有效线索节点);
  const 叫法到键 = (叫: string) => 必填项们.find((x) => 必填叫法(x.key) === 叫)?.key ?? 叫;
  const 缺项们: { 键: string; 叫: string; 判有效: boolean }[] = [];
  for (const 键 of [...节点缺, ...(显示验证缺 ? p.有效沟通差.map(叫法到键) : [])]) {
    if (缺项们.some((x) => x.键 === 键)) continue;
    缺项们.push({ 键, 叫: 必填叫法(键), 判有效: 没有效沟通 && p.有效沟通差.includes(必填叫法(键)) });
  }
  const 判有效数 = 缺项们.filter((x) => x.判有效).length;
  /*
    必填齐了那句。存一下就推（仅上级推下停在已齐的节点）只给 能管项目 的人（load.ts 能改）：他们改项目字段、画像、勾交付、传附件、记回款、记沟通都会按必填推一格，
    值没变的保存不算（改项目 / 改项目画像 变了为空直接回）；组员记沟通不推，但组员看不到这句。
    下一格换阶段不自动推（db.ts 自动推得到）：写明要点「完成节点」进下一阶段；
    「完成节点」灰着、灰因正是 p.不给推（仅上级推、补全期、负责人可推下的组员）：不叫他点，写明该谁点（load.ts 不给推谁能推）；
    灰因是别的（等复核、改不了节点、缺有效沟通，写在按钮下）：谁点都不行，这里只说齐了
  */
  const 齐话 = p.必填?.存一下就推 ? "已经填齐：改任一项（项目资料、画像都算，值没变不算）保存、或记一条沟通，就会自动推到下一步"
    : p.企业版 && 完成到 && !完成到.result && 完成到.phase !== p.phase
      ? (!完成不了 ? `必填齐了，点「完成节点」进${完成到.phase}` : 灰在不给推 ? `必填齐了，进${完成到.phase}要${谁能推}点「完成节点」` : "这个节点的必填都齐了")
      : !完成不了 ? "这个节点的必填都齐了，可以点「完成节点」往前推"
        : 灰在不给推 ? `这个节点的必填都齐了，往前推要${谁能推}点「完成节点」` : "这个节点的必填都齐了";
  const 能去填 = 可改 && !等复核;
  /**
   * 点缺项小块（每一块都要有反应，PR #402 审查）：
   * 1. 完成节点框开得了、又是这个节点缺的 → 开框、落到那一格（M-节点-09 同一套填法）
   * 2. 线索验证那两项 → 线索验证框
   * 3. 窗外的（lib/project/required-fill.ts 填法表）：沟通 → 新建沟通框；附件 / 回款 → 滚到那张卡；客户资料 → 客户页那一格（客户页项目区就地展开、滚过去）
   * 4. 窗里的 → 右栏那一格进编辑；画像的 → 画像卡
   * 都落不了（没权限、卡不在这页）→ 资料卡底部就地小条写「在哪里填」，不会点了没反应
   */
  const 去填 = (键: string) => {
    const 叫 = 必填叫法(键);
    const 说在哪 = (话: string) => 就地.info(`「${叫}」：${话}`);
    // 附件类（项目方案、合同附件、验收报告，F-042）：直接滚到「项目附件」里那一格亮一下，不开完成节点框（框里这一项也只是一颗「去项目附件」）
    if (附件必填格[键] && 定位到附件格(键)) return;
    if (节点可改 && !完成不了 && !忙 && 要先补齐 && 节点缺.includes(键)) {
      set头部框("完成");
      /*
        框开出来后焦点落到点的那一项：框挂上时自己会把焦点给第一格（下一帧），这里等框出来、再晚一帧挪过去，免得又被抢回第一格。
        窗外那几项（国家、来源……）行里只有「去客户页」链接或一句说明：落到链接上，没有链接就落在那一行（#402 实操：点「国家」落到了「所属联系人」）
      */
      const 落 = (剩: number) => {
        const 格 = document.querySelector<HTMLElement>(`.pd-fill-pop [data-required="${键}"]`);
        if (!格) { if (剩 > 0) window.setTimeout(() => 落(剩 - 1), 60); return; }
        window.requestAnimationFrame(() => {
          格.scrollIntoView({ block: "nearest" });
          (格.querySelector<HTMLElement>("input:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]") ?? 格).focus({ preventScroll: true });
        });
      };
      window.setTimeout(() => 落(10), 60);
      return;
    }
    if ((键 === "有效沟通" || 键 === "线索验证结果") && p.线索验证?.我能) { set验证开着(true); return; }
    const 法 = (填法表 as Record<string, (typeof 填法表)[keyof typeof 填法表] | undefined>)[键];
    if (法?.控件 === "窗外") {
      const 去 = 法.去;
      if (去 === "沟通" && p.能记沟通) { set记一条开着(true); return; }
      if ((去 === "附件" || 去 === "回款") && document.getElementById(去 === "附件" ? "project-attachments-fold" : "project-payments-fold")) {
        定位到模块(去 === "附件" ? "project-attachments-fold" : "project-payments-fold");
        return;
      }
      if (去 === "线索验证" && p.线索验证) { set验证开着(true); return; }
      // 企业版客户页没有「来源」那一格（客户来源 = 建客户时选的渠道 / 渠道触点），就地说，不跳页（#402 复审）
      if (p.企业版 && 键 === "来源") return 说在哪(企业来源话);
      if (去 === "客户" && 客户资料格[键]) {
        const 找格 = () => document.querySelector<HTMLElement>(`.rec-rail [data-field="${客户资料格[键]}"]`);
        const 落 = (格: HTMLElement) => {
          格.scrollIntoView({ block: "center", behavior: "smooth" });
          if (格.getAttribute("role") === "button") 格.focus({ preventScroll: true });
        };
        // 客户页项目区：资料卡就在左栏，没填的收在「展开没填的」里，先展开再找
        if (嵌入) {
          const 格 = 找格();
          if (格) return 落(格);
          const 展开 = document.querySelector<HTMLElement>('.rec-rail .rec-sec-more[aria-expanded="false"]:not(.rec-contact-rest-btn)');
          if (展开) {
            展开.click();
            window.setTimeout(() => { const g = 找格(); if (g) 落(g); else 说在哪(法.原因); }, 60);
            return;
          }
        } else if (p.customer && (p.客户入口 ?? "详情") === "详情") {
          去页.push(`/customers/${p.customer.id}#field-${客户资料格[键]}`);
          return;
        }
      }
      return 说在哪(法.原因);
    }
    const 格 = document.querySelector<HTMLElement>(`[data-inline-field="${右栏格名[键] ?? 键}"]`);
    if (格) {
      格.scrollIntoView({ block: "center", behavior: "smooth" });
      格.querySelector<HTMLElement>(".proj-inline-pen")?.click();
      return;
    }
    if ((法?.控件 === "画像单选" || 法?.控件 === "画像多选" || 键 === "需求") && document.getElementById(画像落点)) {
      定位到模块(画像落点);
      // 画像是「看 → 点了改」（D5 · M11）：滚过去后直接打开那一行的下拉
      const 项名 = 法 && (法.控件 === "画像单选" || 法.控件 === "画像多选") ? p.画像?.项们.find((x) => (法.控件 === "画像多选" ? x.多选 : x.键 === 法.键))?.名 : undefined;
      if (项名) window.setTimeout(() => document.querySelector<HTMLElement>(`#${画像落点} [data-inline-field="${项名}"] .proj-inline-pen`)?.click(), 120);
      return;
    }
    说在哪(法?.控件 === "勾" ? "在右栏「交付」卡上勾" : "在右栏项目资料里填");
  };
  const 完成 = () => {
    if (!完成到) return;
    if (完成到.result) return 结束确认(完成到);
    // 跨阶段（线索→商机、商机→订单）企业版退不回去（nodes.ts 改节点问题），撤销必然被拦：不给撤销条，只写就地回执
    const 跨阶段 = 完成到.phase !== p.phase;
    // [待客户定 A] 跨阶段先确认（后果框，同 结束确认 的分级：回不来的那条标红，确认键用主色——往前推不是危险的事）
    if (跨阶段 && p.企业版) {
      const 到 = 完成到;
      void 问后果({
        题: "推过去就回不了上一阶段，确定？",
        后果: [
          { 标: "会发生", 话: 完成到字, 级: "警" },
          { 标: "回不来", 话: `进了${到.phase}就不能再退回${p.phase}`, 级: "危" },
        ],
        是: `进${到.phase}`,
        危: false,
        做: () => 改到(到, { 成了: 完成到字, 入口: "完成节点" }),
      });
      return;
    }
    改到(完成到, { 成了: 跨阶段 ? `${完成到字}` : `已推进到 ${完成到.node}`, 可撤: !跨阶段, 入口: "完成节点" });
  };
  /** 「终止进程」（M-节点-04）：按所在阶段落到 线索流失 / 丢单 / 异常状态；先确认，再到写原因 / 选类别的框 */
  const 终止到 = p.企业版 && !p.result ? 终止结局(当前, 字典) : null;
  const 开终止 = () => {
    if (!终止到) return;
    // 判无效一个框写清后果和原因，不再先问「终止进程？」（dt.invalid）
    if (终止到 === "线索流失" && p.原因选项.无效.length > 0) return void 判无效({ phase: p.phase, node: p.node, result: 终止到 }, true);
    const 叫 = 结局叫法(终止到, 字典);
    void 问后果({
      题: "终止进程？",
      后果: 终止到 === "异常状态"
        ? [
          { 标: "会发生", 话: `项目停在「${位.阶段}·${位.进程}」，标成「${叫}」`, 级: "警" },
          { 标: "之后", 话: "下一步选异常类别" },
          { 标: "能改回", 话: "处理好了把进程改回去就恢复" },
        ]
        : [
          { 标: "会发生", 话: `项目停在「${位.阶段}·${位.进程}」，落到「${叫}」、到此结束`, 级: "警" },
          { 标: "之后", 话: "下一步写原因" },
          { 标: "能改回", 话: "以后要捡回来可以把进程改回去" },
        ],
      是: "继续",
      做: () => 改到({ phase: p.phase, node: p.node, result: 终止到 }, { 终止: true }),
    });
  };

  /** 转让项目（U-项目-07）：弹窗里点「确认转让」就换负责人，不再等 6 秒撤销；下一步、卡点、沟通都跟着项目走（11-03 A2-3）；你可能就看不到这个项目了，回项目列表 */
  /** 转走 / 退回公海 / 删掉、自己看不到这个项目了：回客户页（嵌在客户页）或项目列表；受限详情里没别的项目了回客户列表 */
  const 走开 = () => {
    if (嵌入?.走后去) {
      // 这一下就跳去客户列表（受限详情里最后一个项目走了），本页没地方写：带一句过去，客户列表落地后在原处说（lib/landing-note.ts、LandingNote）
      留落地话(嵌入.走后去.到, 嵌入.走后去.说法);
      去页.push(嵌入.走后去.到);
    } else 去页.push(嵌入?.客户页 ?? "/projects");
  };
  const 确认转给 = async (新: string) => {
    const 名 = 候选.find((m) => m.id === 新)?.name ?? "TA";
    const ok = await 跑(() => 编辑项目(p.id, { name: p.name, ownerId: 新, amount: p.amount, currency: p.currency, remark: p.remark ?? "", contactId: p.contact?.id ?? null }, 带待办勾出 ? 转给带待办 : undefined), `已转给 ${名}`, 框报错);
    if (!ok) return;
    set转给框(false);
    // 转完自己还看得到（总管理、上级）就留在这页，看不到才回列表
    if (!p.转后还能看?.includes(新)) 走开();
  };
  const 转给名 = 转给谁 ? (候选.find((m) => m.id === 转给谁)?.name ?? "TA") : null;

  // 线索流失（企业版、字典里有启用的无效原因）：选一个或写一句，至少一样；合成「无效原因：X」+ 补充说明记进节点变更
  const 选无效原因 = 没成框?.result === "线索流失" && p.原因选项.无效.length > 0;
  const 没成备注 = 选无效原因 && 无效原因 ? [`${无效原因前缀}${无效原因}`, 原因.trim()].filter(Boolean).join("\n") : 原因.trim();

  /** 后果框里点「删除」：没删成把原因交回框里（框不关）；删成了离开这页，项目不在列表里就是回执 */
  const 删 = async () => {
    set忙(true);
    try {
      const r = await 删除项目(p.id);
      if (!r.ok) return r;
      走开();
    } finally {
      set忙(false);
    }
  };

  // 各张卡先摆成常量：企业版两栏、别的版本照原来一栏，摆法不同、卡是同一份
  /**
   * 企业版节点卡阶段页签那一行右边的一组控件（M-节点-04 / U-项目-06）：左边绿底白字「完成节点」+ ▼（终止进程），
   * 右边实心「新增沟通」（开记沟通的框，只记沟通、不动节点）。有结局的项目左边换成「改回进程」。
   * 11-01 会议 §13：▼ 里「改到别的进程」去掉（服务端那条路不动，改回进程框照旧用）
   * 看的不是所在阶段、或推不了，按钮灰掉、悬停写原因（灰按钮收不到鼠标，提示挂在外面那层 span 上）
   */
  const 位 = 阶段与进程(p, 字典);
  const 关头部框 = () => set头部框(null);
  /** 框里点了要换到别的框（推进 → 结局确认）：先关这个，焦点回到页头。「管理沟通」框 M-权限-09 去掉了，改、删在每条沟通的「…」里 */
  const 换框 = (f: () => void) => () => { set头部框(null); f(); };
  /** 「完成节点」框里填不了的必填：关框，打开或滚到能填的地方 */
  const 去补必填 = (去: 窗外去处, 项?: string) => {
    set头部框(null);
    if (去 === "沟通") set记一条开着(true);
    else if (去 === "线索验证") set验证开着(true);
    else if (去 === "附件") { if (!项 || !定位到附件格(项)) 定位到模块("project-attachments-fold"); }
    else if (去 === "回款") 定位到模块("project-payments-fold");
  };
  /** dt.stage 补填小框（挂在「完成节点」上的 Popover 里）：M-节点-05/09 先查这个节点的必填（占位值不算填了），缺了当场填（11-03 一窗填完），
   * 齐了写能推到哪。缺着谁都推不了（客户 11-19 定稿）。Esc 收起；打开时焦点落到第一格 */
  const 完成补填框 = () => (
    <div
      className="pd-fill-pop-body"
      role="dialog"
      aria-label={`完成节点 · ${p.name}`}
      ref={(el) => { if (el && !el.contains(document.activeElement)) window.requestAnimationFrame(() => el.querySelector<HTMLElement>("[data-required] input:not([disabled]), [data-required] textarea:not([disabled]), button:not([disabled])")?.focus({ preventScroll: true })); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); 关头部框(); } }}
    >
      <div className="pd-fill-pop-t">完成节点 · {p.name}</div>
      <ProjectFillRequired
        p={p}
        联系人们={联系人们}
        能就地改={能就地改}
        改不了话={改不了话}
        现在在={`${位.阶段} · ${位.进程}`}
        能推进={!!完成到 && !完成不了}
        完成不了={完成不了}
        完成到字={完成到字}
        交付还差={完成到?.result && 是交付(完成到.result) ? 差 : undefined}
        忙={忙}
        on完成={换框(完成)}
        on关={关头部框}
        on去={去补必填}
        读草稿={() => 必填草稿.current[p.id]}
        留草稿={(草稿) => { 必填草稿.current[p.id] = 草稿; }}
      />
    </div>
  );
  const 进程钮 = (不在当前: string | undefined) => {
    const 灰着 = (原因: string | undefined, 钮: ReactNode, 点了?: () => void) => (原因 ? <Tooltip title={原因}><span className="proj-stage-tip" onClick={点了}>{钮}</span></Tooltip> : 钮);
    const 完成灰 = 不在当前 ?? 完成不了;
    /*
      灰着正是因为推过线索验证还缺几样（卡有效沟通，不是没权限、等复核）：点灰按钮 = 被拦一次，记下来（必填拦截记录，客户 11-23「点完成缺必填只提示不留记录是黑箱」）。
      样子不变（照旧灰着、悬停写原因）；灰按钮本身不收点击，globals.css 让它不接鼠标、点击落到外面这层 span
    */
    const 点灰完成 = 完成灰 && !不在当前 && !p.不给推 && 卡有效沟通 && 完成灰 === 缺有效沟通话 && 节点可改 ? () => void 记完成节点被拦(p.id) : undefined;
    const 菜单: NonNullable<MenuProps["items"]> = [
      ...(终止到 ? [{ key: "stop", danger: true, disabled: !!(不在当前 ?? 动不了), label: 两行("终止进程", 不在当前 ?? 动不了 ?? `落到「${结局叫法(终止到, 字典)}」`) }] : []),
    ];
    return (
      <>
        {节点可改 && (p.result
          ? 灰着(不在当前 ?? 动不了, <Button disabled={忙 || !!(不在当前 ?? 动不了)} onClick={() => set头部框("推进")}>改回进程</Button>)
          : (
            <Space.Compact className="split-btn split-success">
              {灰着(完成灰, 要先补齐 ? (
                // dt.stage：还差必填 → 从「完成节点」下面长出补填小框（不再开大框），就地补齐再推。
                // 内容推迟到弹出时才画（content 给函数）：补填框用到的几样在下面才定义。点外面、Esc 收起，填过的留草稿
                <Popover
                  open={头部框 === "完成"}
                  trigger="click"
                  placement="bottomRight"
                  // 下面放不下：先试翻到按钮上面，还放不下就整块往上挪到屏里（11-20 c2 实操：375 宽缺得多时底下按钮比屏幕低、要滚一下才看得到）。
                  // 默认只翻不挪，翻上去也放不下就照旧挂在下面伸出屏外；挪的时候按浮层外框算，外框底下留的安全区见 globals.css .pd-fill-pop
                  autoAdjustOverflow={补填框挪进屏}
                  align={补填框不偏移}
                  arrow={false}
                  destroyOnHidden
                  classNames={{ root: "pd-fill-pop" }}
                  onOpenChange={(v) => {
                    set头部框(v ? "完成" : null);
                    // 还差必填、补填框弹出来 = 被拦一次（必填拦截记录，服务端自己再算一遍还差什么）；只留痕，不等它
                    if (v && p.企业版 && p.必填?.还差?.length) void 记完成节点被拦(p.id);
                  }}
                  content={完成补填框}
                >
                  <Button className="proj-done-btn" disabled={忙 || !!完成灰} aria-haspopup="dialog" aria-expanded={头部框 === "完成"}>完成节点</Button>
                </Popover>
              ) : <Button className="proj-done-btn" disabled={忙 || !!完成灰} onClick={() => 完成()}>完成节点</Button>, 点灰完成)}
              {菜单.length > 0 && (
                <Dropdown trigger={["click"]} placement="bottomRight" disabled={忙} menu={{ items: 菜单, onClick: ({ key }) => { if (key === "stop") 开终止(); } }}>
                  <Button className="proj-done-btn split-caret" icon={连体箭头} aria-label="终止进程" />
                </Dropdown>
              )}
            </Space.Compact>
          ))}
        {/* 嵌在客户页：新建沟通只留沟通卡头那颗主按钮（总控 11-12 定，用户原话「新建沟通放沟通模块最上方右侧」），⌘N 的 data-cmd-new 也挂那颗 */}
        {p.能记沟通 && !嵌入 && <Button type="primary" data-cmd-new disabled={忙} onClick={() => set记一条开着(true)}>新增沟通</Button>}
      </>
    );
  };

  const 显示回收日 = p.企业版 && !!p.回收日 && !p.pooled && !p.result;
  const 顶块 = (
    <>
      {/* 企业版（F-项目-19）：「阶段」「进程」两格和下面的阶段页签重复，不摆，只留回收日；别的版本照旧 */}
      {(!p.企业版 || 显示回收日) && <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
        {/* P11：阶段（线索/商机/订单）和进程（节点）分两格摆，不拼成一串；成功交付、异常状态的阶段算订单 */}
        <div className="proj-where">
          {!p.企业版 && <><div>
            <div className="proj-where-label">阶段</div>
            <div className="proj-where-value">{位.阶段}</div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="proj-where-label">进程</div>
            <div className="proj-where-value">
              <span className="proj-where-node" title={位.进程}>{位.进程}</span>
              {位.结局 && <Tag style={{ marginLeft: 8 }} color={异常 ? "error" : 交付了 ? "success" : "default"}>{位.结局}</Tag>}
            </div>
          </div></>}
          {/* 企业版：哪天回公海写在阶段、进程旁边（10-30 P0-1），3 天内橙、当天红 */}
          {显示回收日 && p.回收日 && (() => {
            const 回 = 回公海文案(p.回收日);
            return (
              <div style={{ minWidth: 0 }}>
                <div className="proj-where-label">回收日</div>
                {p.验证不收
                  ? <div data-testid="proj-recycle-verifying" style={{ lineHeight: "28px", color: "var(--text-muted)" }}>验证中，不回收</div>
                  : <div style={{ lineHeight: "28px", color: 回公海颜色[回.级别], fontWeight: 回.级别 === "常" ? undefined : 600 }}>{回.文字}</div>}
              </div>
            );
          })()}
        </div>
        {/* 只留「下一步」一个主按钮（10-30 P0-8）；改到别的进程、点结局收进「更多」。灰着的原因写在按钮下面。
            企业版「推进进程」（框里就是这两个按钮）摆在下面阶段页签那一行，推不了的原因也跟到那里（10-31） */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, maxWidth: 320, marginLeft: "auto" }}>
          {!p.企业版 && <Space wrap>
            {更多去处项.length > 0 && (
              <Dropdown trigger={["click"]} placement="bottomRight" disabled={忙} menu={{ items: 更多去处项, onClick: ({ key }) => 结束确认(JSON.parse(key) as 位置) }}>
                <Button aria-label="改到别的进程或结局">更多 <DownOutlined /></Button>
              </Dropdown>
            )}
            <Button type="primary" disabled={忙 || !!推不了} onClick={() => 下 && 改到(下)}>
              {下一步字}
            </Button>
          </Space>}
          {推不了 && !p.企业版 && <div style={{ color: "var(--text-muted)", fontSize: "var(--dt-aux, 12px)", textAlign: "right" }}>{推不了}</div>}
        </div>
      </div>}
    </>
  );
  const 节点卡 = (
    // 嵌在客户页：进程卡挂 .cd-proc，卡片改进下项目切换那一行就是这张卡的 48 高卡头（globals.css）
    <Card className={嵌入 ? "cd-proc" : undefined} style={p.企业版 ? undefined : { marginBottom: 16 }}>
      {!嵌入 && 顶块}
      {/* 企业版：三个阶段页签 + 完成节点 ▼ / 新增沟通（M-节点-04）；别的版本照旧一条进度条 */}
      {p.企业版 ? (
        <ProjectStages
          key={位.阶段}
          字典={字典}
          所在阶段={位.阶段}
          所在进程={位.进程}
          结局={位.结局}
          结局色={异常 ? "error" : 交付了 ? "success" : "default"}
          成功交付={交付了}
          动作={节点可改 || (p.能记沟通 && !嵌入) ? 进程钮 : undefined}
          提示={p.result && 节点可改 ? undefined : 完成不了}
          卡头={嵌入?.页签行}
          不摆阶段页签={!!嵌入}
        />
      ) : null}
      {嵌入 && 顶块}
      {p.企业版 ? null : (
        <Progress
          style={{ marginTop: 12, marginBottom: 0 }}
          percent={Math.round(((交付了 ? 节点总数 : 节点序号(当前, 字典)) / 节点总数) * 100)}
          showInfo={false}
          status={异常 ? "exception" : 交付了 ? "success" : "active"}
          aria-label={`第 ${节点序号(当前, 字典) + 1} 个进程，共 ${节点总数} 个`}
        />
      )}
      {/* 线索验证 11-01 挪到项目卡「线索验证」那一行的弹窗里；轮到我判时这里留一句，点了一样开那个框 */}
      {p.线索验证?.我能 && (
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }} data-testid="lead-verify-nudge">
          <span style={{ color: "var(--text-muted)" }}>{p.线索验证.待 ? "这条线索轮到你处理" : "这条线索等你判定"}</span>
          <Button size="small" onClick={() => set验证开着(true)}>打开线索验证</Button>
        </div>
      )}
      {/*
        设计语言 D4 · M6-a（D36）：原来两段灰字（「要推过线索验证，还要填：…」「这个节点还差必填：…」）列的项还不一样，合成一块「还差 N 项」+ 缺项小块：
        带 • 的是判「有效」也要的；小块保留括号别名、「暂无」「-」不算填了照留；点一块直接去填（完成节点框里那一格 / 右栏那一格 / 画像卡 / 线索验证框）
      */}
      {缺项们.length > 0 && (
        <div className="proj-miss" data-testid={显示验证缺 ? "lead-gate-hint" : "node-required-miss"}>
          <div className="proj-miss-t">{节点缺.length ? `完成这个节点还差 ${缺项们.length} 项` : `要推过线索验证还差 ${缺项们.length} 项`}</div>
          <div className="proj-miss-chips">
            {缺项们.map((x) => (
              能去填 ? (
                <button key={x.键} type="button" className="proj-miss-chip" data-miss={x.键} onClick={() => 去填(x.键)}>
                  {x.判有效 && <i className="proj-miss-dot" aria-label="判「有效」也要" />}{x.叫}
                </button>
              ) : (
                <span key={x.键} className="proj-miss-chip" data-miss={x.键}>{x.判有效 && <i className="proj-miss-dot" aria-label="判「有效」也要" />}{x.叫}</span>
              )
            ))}
          </div>
          <div className="proj-miss-help">
            {[
              判有效数 > 0 && 节点缺.length > 0 ? `带 • 的 ${判有效数} 项也是判「有效」要的` : "",
              缺需求 && !能去填 ? "需求状态在「项目画像」里选" : "",
              能去填 ? "点一项直接去填" : "",
              "「暂无」「-」这类占位不算填了",
            ].filter(Boolean).join("；")}{显示验证缺 ? 沟通半句 : ""}
          </div>
        </div>
      )}
      {p.必填 && !p.result && !p.必填.还差.length && (
        <div className="proj-miss is-ok">
          <div className="proj-miss-t">{齐话}</div>
        </div>
      )}
    </Card>
  );
  const 项目卡 = (
    <Card
      // 设计语言 D5 · M10：行距 34、悬停整行浅底 + 行尾铅笔、改的时候标签顶对齐、卡头图标点击区 28 / 44（globals.css .proj-info）
      className="proj-info"
      // 卡片改进（11-23 原型）：嵌在客户页时右栏卡头只写「项目资料」（项目名已经在进程卡卡头的胶囊里）
      title={嵌入 ? "项目资料" : "项目"}
      // U-项目-05：企业版改项目的入口挪到项目卡右上角一个笔（页头不再摆「编辑项目」），点开还是同一个编辑框；别的版本照旧「编辑」
      extra={嵌入 ? (
        // 嵌在客户页：项目收藏星挪到这张卡头（审查 #2，页签行 1024 宽已经很挤），只管当前页签这个项目；编辑笔照旧在最右
        <span className="cd-card-acts">
          <ProjectStarButton projectId={p.id} 初值={p.收藏了 ?? false} />
          {可改 && <Tooltip title="编辑项目"><Button type="text" size="small" icon={<EditOutlined />} aria-label="编辑项目" disabled={忙} onClick={() => set编辑开着(true)} /></Tooltip>}
        </span>
      ) : 可改 && (p.企业版
        ? <Tooltip title="编辑项目"><Button type="text" size="small" icon={<EditOutlined />} aria-label="编辑项目" disabled={忙} onClick={() => set编辑开着(true)} /></Tooltip>
        : <Button type="link" size="small" disabled={忙} onClick={() => set编辑开着(true)}>编辑</Button>)}
    >
      {p.线索验证 && (
        <div {...资料行()}>
          <span {...键}>线索验证</span>
          <Button type="text" size="small" style={{ paddingInline: 4, marginInlineStart: -4, height: "auto" }} onClick={() => set验证开着(true)} aria-label={`线索验证：${p.线索验证.叫法}，点开查看和操作`} data-testid="lead-verify-row">
            {/* 11-01 会议 §6：结果写成纯字、不套灰框（和下面各行的写法一致） */}
            <span style={{ marginInlineEnd: 4 }} data-testid="lead-verify-result">{p.线索验证.叫法}</span>
            {p.线索验证.我能 && <span style={{ color: "var(--brand)" }}>去处理</span>}
            <RightOutlined aria-hidden style={{ fontSize: 10, color: "var(--text-muted)" }} />
          </Button>
        </div>
      )}
      <div {...资料行()}><span {...键}>{b.customer}</span>{p.客户入口 === "只读卡" && p.客户卡名 ? <CustomerReadonlyCard projectId={p.id} name={p.客户卡名.name} company={p.客户卡名.school} /> : p.customer ? <CustomerLink id={p.客户入口 === "文字" ? null : p.customer.id} name={p.customer.name} company={p.customer.school} /> : <span style={{ color: "var(--text-muted)" }}>{p.pooled ? "领取后可见" : "无权查看"}</span>}</div>
      {p.来源线索 && (
        <div {...资料行()}><span {...键}>来源线索</span><span className="proj-one">{p.来源线索.name ?? <span style={{ color: "var(--text-muted)" }}>已删除的线索</span>}{p.来源线索.convertedAt && <span style={{ color: "var(--text-muted)" }}>（{p.来源线索.convertedAt} 转入）</span>}</span></div>
      )}
      {/* 联系人名字、职位可能很长：在 1024 宽的项目卡里折行，不顶出卡片 */}
      {/* 11-04：企业版就地改联系人（下拉选本客户的联系人，可清空）；不是企业版照旧只读。
          可清空的就地下拉第一项都是「—」：误点了能选回没填（11-04 用户） */}
      {p.企业版 && 能就地改 && p.customer ? (
        <div {...资料行()}>
          <span {...键}>联系人</span>
          <ProjectInlineField<string | null>
            名="联系人"
            值={p.contact?.id ?? null}
            能改
            显示={(id) => {
              const c = id === (p.contact?.id ?? null) ? p.contact : 联系人们.find((x) => x.id === id) ?? null;
              if (!c) return 待填("联系人");
              return 联系人字(c);
            }}
            存={(v) => 存项目项({ contactId: v })}
            编辑器={({ 草稿, 提交, 忙 }) => (
              <Select aria-label="联系人" autoFocus defaultOpen allowClear disabled={忙} placeholder="选联系人" style={{ width: "100%" }} value={草稿 ?? undefined} options={[不填项, ...联系人们.map((c) => ({ value: c.id, label: c.position ? `${空显(c.name)} · ${c.position}` : 空显(c.name) }))]} onChange={(v?: string) => 提交(去不填(v))} />
            )}
          />
        </div>
      ) : (
        // D5 遗留：企业版只能看的人也摆这一行，没挂联系人写「—」
        p.企业版
          ? <div {...资料行()}><span {...键}>联系人</span>{p.contact ? 联系人字(p.contact) : 待填("联系人")}</div>
          : p.contact && <div {...资料行()}><span {...键}>联系人</span><span className="proj-one">{空显(p.contact.name)}{p.contact.position ? ` · ${p.contact.position}` : ""}</span></div>
      )}
      {p.contact && p.联系人附件 && <div {...资料行()}><span {...键}>附件</span><ContactAttachmentsButton contactId={p.contact.id} 名字={p.contact.name} 起始个数={p.联系人附件.个数} 只读={p.联系人附件.只读} /></div>}
      {p.企业版 && p.level !== undefined && (
        <div {...资料行()}>
          <span {...键}>级别</span>
          <ProjectInlineField<string | null>
            名="级别"
            值={p.level}
            能改={能就地改}
            显示={级别格}
            存={(v) => 存项目项({ level: v })}
            编辑器={({ 草稿, 提交, 忙 }) => (
              <Select aria-label="级别" autoFocus defaultOpen allowClear disabled={忙} placeholder={未选占位} style={{ width: "100%" }} value={草稿 ?? undefined} options={[不填项, ...企业客户级别.map((x) => ({ value: x, label: 企业级别说明[x] }))]} onChange={(v?: string) => 提交(去不填(v))} />
            )}
          />
        </div>
      )}
      {/* 项目标签（F-项目-14）：和级别各一格、各自填，互不带动 */}
      {p.企业版 && p.项目标签 && (
        <div {...资料行()}>
          <span {...键}>项目标签</span>
          <ProjectInlineField<string | null>
            名="项目标签"
            值={p.项目标签.值}
            能改={能就地改}
            显示={(v) => (有值(v) ? <span className="proj-one" title={v}>{v}</span> : p.必填?.还差.includes("项目标签") ? 占位确认("项目标签") : 待填("项目标签"))}
            存={(v) => 存项目项({ projTag: v })}
            编辑器={({ 草稿, 提交, 忙 }) => (
              <Select aria-label="项目标签" autoFocus defaultOpen allowClear disabled={忙} placeholder={未选占位} style={满宽} value={草稿 ?? undefined} options={[不填项, ...p.项目标签!.选项.map((x) => ({ value: x, label: x }))]} onChange={(v?: string) => 提交(去不填(v))} />
            )}
          />
        </div>
      )}
      <div {...资料行()}>
        <span {...键}>金额</span>
        <ProjectInlineField<钱格值>
          名="金额"
          值={{ 数: p.amount || null, 币: p.currency }}
          能改={字段能改("商机金额")}
          回车存
          // 必填占位只对库里那个值说话：刚改过（乐观值）就直接显示新值
          显示={(v) => (v.数 === (p.amount || null) && p.必填?.还差.includes("金额") ? 占位确认("金额") : v.数 ? 钱字(金额(v.数, v.币)) : 待填("金额"))}
          存={(v) => 存钱格("金额", v)}
          编辑器={钱编辑器("金额")}
        />
      </div>
      {p.企业版 && p.成交钱 && (
        <>
          <div {...资料行()}>
            <span {...键}>定金金额</span>
            <ProjectInlineField<钱格值>
              名="定金金额"
              值={{ 数: p.成交钱.depositAmount, 币: p.成交钱.depositCurrency ?? 默认币种 }}
              能改={字段能改("商机金额")}
              回车存
              显示={(v) => (v.数 !== null ? 钱字(金额(v.数, v.币)) : 待填("定金金额"))}
              存={(v) => 存钱格("定金金额", v)}
              编辑器={钱编辑器("定金金额")}
            />
          </div>
          <div {...资料行()}>
            <span {...键}>合同金额</span>
            <ProjectInlineField<钱格值>
              名="合同金额"
              值={{ 数: p.成交钱.contractAmount, 币: p.成交钱.contractCurrency ?? 默认币种 }}
              能改={字段能改("商机金额")}
              回车存
              显示={(v) => (v.数 !== null ? 钱字(金额(v.数, v.币)) : 待填("合同金额"))}
              存={(v) => 存钱格("合同金额", v)}
              编辑器={钱编辑器("合同金额")}
            />
          </div>
          {p.项目新字段?.contractStatus !== undefined && (
            <div {...资料行()}>
              <span {...键}>合同状态</span>
              <ProjectInlineField<string | null>
                名="合同状态"
                值={p.项目新字段.contractStatus}
                能改={字段能改("合同状态")}
                显示={(v) => (v ? <span>{v}</span> : 待填("合同状态"))}
                存={(v) => 存项目项({ contractStatus: v })}
                编辑器={({ 草稿, 提交, 忙 }) => (
                  <Select aria-label="合同状态" autoFocus defaultOpen allowClear disabled={忙} placeholder={未选占位} style={{ width: "100%" }} value={草稿 ?? undefined} options={[不填项, ...合同状态们.map((x) => ({ value: x, label: x }))]} onChange={(v?: string) => 提交(去不填(v))} />
                )}
              />
            </div>
          )}
          {p.回款们 && <div {...资料行()}><span {...键}>当前回款</span>{p.回款们.length ? 钱字(合计文字(按币种合计(p.回款们, (x) => x.amount, (x) => x.currency))) : <span className="proj-one">{待填("当前回款")}</span>}</div>}
          <div {...资料行(多行行样)}>
            <span {...键}>需求描述</span>
            <ProjectInlineField<string>
              名="需求描述"
              规整={(v) => v.trim()}
              值={p.成交钱.dealDemand ?? ""}
              能改={字段能改("商机金额")}
              多行
              一行显示
              显示={(v) => (有值(v) ? <span className="proj-one" data-tip={v}>{v}</span> : 待填("需求描述"))}
              存={(v) => 存项目项({ dealDemand: 文字格改动(v) })}
              编辑器={文字编辑器("需求描述", 成交需求上限)}
            />
          </div>
          {p.项目新字段 && "painPoints" in p.项目新字段 && (
            <div {...资料行(多行行样)}>
              <span {...键}>痛点标注</span>
              <ProjectInlineField<string>
                名="痛点标注"
                规整={(v) => v.trim()}
                值={p.项目新字段.painPoints ?? ""}
                能改={字段能改("痛点标注")}
                多行
                一行显示
                显示={(v) => (有值(v) ? <span className="proj-one" data-tip={v}>{v}</span> : (p.必填?.还差.includes("痛点标注") ? 占位确认("痛点标注") : 待填("痛点标注")))}
                存={(v) => 存项目项({ painPoints: 文字格改动(v) })}
                编辑器={文字编辑器("痛点标注", 痛点标注上限)}
              />
            </div>
          )}
        </>
      )}
      {p.企业版 && (
        <div {...资料行()}>
          <span {...键}>预计成交</span>
          <ProjectInlineField<string | null>
            名="预计成交"
            值={p.expectedDealAt ?? null}
            能改={字段能改("预计签约")}
            显示={(v) => (有值(v) ? v : (p.必填?.还差.includes("预计成交日期") ? 占位确认("预计成交日期") : 待填("预计成交日期")))}
            存={(v) => 存项目项({ expectedDealAt: v })}
            编辑器={({ 草稿, 提交, 忙 }) => (
              <DatePicker aria-label="预计成交" autoFocus disabled={忙} style={{ width: "100%" }} value={草稿 ? dayjs(草稿) : null} onChange={(d) => 提交(d ? d.format("YYYY-MM-DD") : null)} />
            )}
          />
        </div>
      )}
      {/* 指定回复时间（11-17）：客户要求的联系时间点 / 时间段，两格选填；没填「—」 */}
      {p.指定回复 && (
        <div {...资料行()}>
          <span {...键}>指定回复</span>
          <ProjectInlineField<回复两格>
            名="指定回复"
            值={p.指定回复}
            能改={字段能改("指定回复时间")}
            显示={(v) => {
              if (!v.开始 && !v.结束) return 待填("指定回复时间");
              const 警 = 回复晚于回收(北京墙钟转时刻(v.开始), 北京墙钟转时刻(v.结束), p.回收日);
              return <span className="proj-one" data-tip={警 ?? undefined} style={警 ? { color: "var(--warning-text)" } : undefined}>{指定回复文字(北京墙钟转时刻(v.开始), 北京墙钟转时刻(v.结束))}{警 ? " ⚠" : ""}</span>;
            }}
            存={(v) => 存项目项({ 指定回复开始: v.开始, 指定回复结束: v.结束 })}
            编辑器={({ 草稿, set草稿, 忙 }) => <ReplyWindowInput autoFocus disabled={忙} value={草稿} onChange={set草稿} />}
          />
        </div>
      )}
      {/* 指定分配时间（11-17 PR3）：还在待分配、到点由后台分；录入人和能分配的人能改时间、改成现在分配、取消定时 */}
      {p.定时分配 && (
        <div {...资料行(定时行样)} data-testid="project-schedule-row">
          <span {...键}>定时分配</span>
          <ProjectInlineField<string>
            名="定时分配"
            值={p.定时分配.时间}
            能改={p.定时分配.能动 && !忙}
            显示={(v) => {
              // 卡窄（右栏约 210px）：时间、分给谁可以折行，不截断
              const 话 = `${短时刻(北京墙钟转时刻(v)) ?? v} ${p.定时分配?.给谁 ? `分给 ${p.定时分配.给谁}` : "自动分配"}`;
              return <span title={`${话}（北京时间）`} style={可折行样}>{话}</span>;
            }}
            存={async (v) => {
              const r = await 改定时分配(p.id, { 时间: v });
              if (!r.ok) return r.error;
              router.refresh();
              return null;
            }}
            编辑器={({ 草稿, 提交 }) => <定时时刻格 autoFocus value={草稿} onChange={(v) => { if (v) 提交(v); }} />}
          />
          {p.定时分配.能动 && (
            <Space size={4}>
              <Button size="small" type="link" disabled={忙} onClick={() => void 跑(() => 定时分配现在分(p.id), "已分配")}>现在分配</Button>
              <Button size="small" type="link" disabled={忙} onClick={() => void 跑(() => 取消定时分配(p.id), "已取消定时，留在新线索待分配")}>取消定时</Button>
            </Space>
          )}
        </div>
      )}
      {/* 嵌在客户页没有项目页头（审查 #2）：页头副标题里的负责人、创建人、创建时间挪到这张卡上 */}
      {嵌入 && (
        <>
          <div {...资料行()} data-testid="project-owner-row"><span {...键}>负责人</span><span className="proj-one" title={负责人说法(p)}>{负责人说法(p)}</span></div>
          <div {...资料行()} data-testid="project-creator-row"><span {...键}>创建人</span><span className="proj-one">{p.creatorName || 空值符}</span></div>
          <div {...资料行()} data-testid="project-created-row"><span {...键}>创建于</span><span className="proj-one">{fmtDateTime(p.createdAt)}</span></div>
        </>
      )}
      {p.企业版 && p.数据来源 && <div {...资料行()} data-testid="project-data-source-row"><span {...键}>数据来源</span><span className="proj-one"><Tag bordered={false} color="purple">{p.数据来源}</Tag></span></div>}
      {p.企业版 && p.重复咨询来自 && (
        <div {...资料行()} data-testid="project-repeat-origin-row">
          <span {...键}>原始客户编号</span>
          <span className="proj-one">{p.重复咨询来自.客户编号}{p.重复咨询来自.第几次 ? <span className="muted">（第 {p.重复咨询来自.第几次} 次重复咨询）</span> : null}</span>
        </div>
      )}
      {p.企业版 && p.重复咨询 && (
        <div {...资料行()} data-testid="project-repeat-others-row">
          <span {...键}>其他在推项目</span>
          <span className="proj-one" title={[p.重复咨询.看得到.map((x) => x.name).join("、"), p.重复咨询.看不到 > 0 ? `另有 ${p.重复咨询.看不到} 个你看不到的` : ""].filter(Boolean).join("；") || undefined}>
            {p.重复咨询.看得到.length === 0 && p.重复咨询.看不到 === 0 ? "—" : (
              <>
                {p.重复咨询.看得到.map((x, i) => <span key={x.id}>{i > 0 && "、"}<Link href={x.项目去 ?? `/projects/${x.id}`}>{x.name}<LinkPending /></Link></span>)}
                {p.重复咨询.看不到 > 0 && <span className="muted">{p.重复咨询.看得到.length > 0 && "；"}另有 {p.重复咨询.看不到} 个你看不到的</span>}
              </>
            )}
          </span>
        </div>
      )}
      {p.企业版 && p.已立项天数 !== undefined && <div {...资料行()}><span {...键}>已立项</span>{p.已立项天数 === 0 ? "今天立项" : `${p.已立项天数} 天`}</div>}
      {p.企业版 && p.项目来源 !== undefined && (
        <div {...资料行()}>
          <span {...键}>项目来源</span>
          {/*
            项目来源（P-删-03，11-10 起同客户来源）：项目自己的来源有值就锁，这里只读；空着（跟客户来源走）的可以就地补一次，
            补了就锁、不给清空。服务端 改项目 同样拒换、拒清空，这里只是辅助。显示等 refresh 带回服务端拼好的名字
          */}
          <ProjectInlineField<string | null>
            名="项目来源"
            值={p.channelId ?? null}
            能改={能就地改 && !!p.渠道们 && !p.channelId}
            显示={() => <span className="proj-one">{p.项目来源 ? p.项目来源.name ? <>{p.项目来源.name}{p.项目来源.跟客户 && <span style={{ color: "var(--text-muted)" }}>（同{b.customer}来源）</span>}</> : <span className="muted">随{b.customer}来源</span> : 待填("项目来源")}</span>}
            存={(v) => 存项目项({ channelId: v })}
            编辑器={({ 草稿, 提交, 忙 }) => (
              <ChannelPicker aria-label="项目来源" channels={p.渠道们 ?? []} value={草稿} disabled={忙} allowClear={false} placeholder="补一次项目来源，补了就不能改" style={{ width: "100%" }} onChange={(v) => { if (v) 提交(v); }} />
            )}
          />
        </div>
      )}
      {p.企业版 && p.bizLine !== undefined && (
        <div {...资料行()}>
          <span {...键}>业务线</span>
          {/* 11-04 就地改：三选一，不能清空（新建必填）；改线不换负责人 */}
          <ProjectInlineField<string | null>
            名="业务线"
            值={p.bizLine}
            能改={能就地改}
            显示={(v) => v || 待填("业务线")}
            存={(v) => 存项目项({ 业务线: v })}
            编辑器={({ 草稿, 提交, 忙 }) => (
              <Select aria-label="业务线" autoFocus defaultOpen disabled={忙} placeholder="选业务线" style={{ width: "100%" }} value={草稿 ?? undefined} options={三种业务线.map((x) => ({ value: x, label: x }))} onChange={(v: string) => 提交(v)} />
            )}
          />
        </div>
      )}
      {p.企业版 && p.所在地 && (
        <>
          {/* 11-04 就地改：区域四格 + 详细地址一起改、一起存（和新建项目同一个地址组件）；地址看像别的业务线时提示一句，不自动改线 */}
          <div {...资料行()}>
            <span {...键}>区域</span>
            <ProjectInlineField<客户地址 & { location: string | null }>
              名="区域"
              值={p.所在地}
              能改={能就地改}
              规整={(v) => ({ ...v, location: v.location?.trim() || null })}
              显示={(v) => (
                <span className="proj-one">
                  {项目区域(v) || 待填("区域")}
                  {(拼地址(v) || v.location) && <span style={{ color: "var(--text-muted)" }}>{项目区域(v) ? " · " : ""}{[拼地址(v), v.location].filter(Boolean).join(" ")}</span>}
                </span>
              )}
              存={(v) => 存项目项({ addrCountry: v.addrCountry, addrProvince: v.addrProvince, addrCity: v.addrCity, addrDistrict: v.addrDistrict, location: v.location })}
              编辑器={({ 草稿, set草稿, 忙 }) => {
                const 提示 = p.bizLine !== undefined ? 所在地提示(建议业务线(草稿), p.bizLine) : null;
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                    <AddressInput value={草稿} disabled={忙} onChange={(a) => set草稿({ ...草稿, ...a })} />
                    <Input aria-label="详细地址" disabled={忙} maxLength={详细地址上限} placeholder={详细地址提示} value={草稿.location ?? ""} onChange={(e) => set草稿({ ...草稿, location: e.target.value })} />
                    {提示 && !提示.同 && <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{提示.话}</span>}
                  </div>
                );
              }}
            />
          </div>
        </>
      )}
      {p.historyOwners.length > 0 && (
        <div {...资料行()}><span {...键}>历史</span><span className="proj-one" title={`历史负责人（把这个项目放回过公海的人）：${p.historyOwners.join("、")}`}>{p.historyOwners.join("、")}</span></div>
      )}
      {(p.nextStepText || p.nextStepAt) && !p.pooled && (
        <div {...资料行()}>
          <span {...键}>下一步</span>
          <span className="proj-one">
            {p.nextStepText}
            {p.nextStepText && p.nextStepAt && <span style={{ color: "var(--text-muted)" }}> · </span>}
            {p.nextStepAt && <span style={p.nextStepText ? { color: "var(--text-muted)", whiteSpace: "nowrap" } : undefined}>{p.nextStepAt}</span>}
          </span>
        </div>
      )}
      {能就地改 ? (
        <div {...资料行(多行行样)}>
          <span {...键}>备注</span>
          <ProjectInlineField<string>
            名="备注"
            规整={(v) => v.trim()}
            值={p.remark ?? ""}
            能改
            多行
            显示={(v) => <span style={{ minWidth: 0, overflowWrap: "anywhere", whiteSpace: "pre-wrap", color: "var(--text-muted)" }}>{v || 待填("备注")}</span>}
            存={(v) => 存项目项({ remark: 文字格改动(v) })}
            编辑器={文字编辑器("备注", 备注上限)}
          />
        </div>
      ) : p.remark && <div style={{ marginTop: 8, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--text-muted)" }}>{p.remark}</div>}
    </Card>
  );
  // 客户详情嵌入版的叫法（11-12，card-names.tsx）：右栏卡名补「项目」、卡点写「当前卡点」；项目详情页原样
  const 卡名 = (名: string) => (嵌入 ? 项目卡名(名) : 名);
  // 异常 / 没走成的弹窗里说「记在哪」：客户详情里右栏没有进程变更卡（11-24 挪进客户名下那一行的「历史变更」），说历史变更；独立页、受限客户详情照旧
  const 变更记在 = 嵌入 && !嵌入.进程变更卡 ? "历史变更" : "进程变更";
  const 卡点名 = 嵌入 ? 客户详情卡点 : "卡点";
  /** 交付卡备货 / 物流三行：和项目资料同一套字段行（标签 68 列、值离卡左 92） */
  const 交付行 = 资料行();
  const 交付卡 = 显示交付 && (
    <Card title={卡名("交付")}>
      {/* 备货状态（生产备货）、物流状态 + 物流单号（物流运输）：迁移 154，客户 11-19。交付卡只在订单阶段出现，这三格跟着它；
          缺着的必填在「完成节点」框里也能当场填 */}
      {p.企业版 && 备货物流 && (
        <div className="proj-stock-rows">
          <div {...交付行}>
            <span {...键}>备货状态</span>
            <ProjectInlineField<string | null>
              名="备货状态"
              值={备货物流.备货状态}
              能改={能就地改}
              显示={(v) => (有值(v) ? <span className="proj-one" title={v}>{v}</span> : (p.必填?.还差.includes("备货状态") || p.必填?.还差.includes("已备货")) ? 占位确认("备货状态") : 待填("备货状态"))}
              存={(v) => 存项目项({ stockStatus: v })}
              编辑器={({ 草稿, 提交, 忙 }) => (
                <Select aria-label="备货状态" autoFocus defaultOpen allowClear disabled={忙} placeholder={未选占位} style={满宽} value={草稿 ?? undefined} options={[不填项, ...备货状态们.map((x) => ({ value: x, label: x }))]} onChange={(v?: string) => 提交(去不填(v))} />
              )}
            />
          </div>
          <div {...交付行}>
            <span {...键}>物流状态</span>
            <ProjectInlineField<string | null>
              名="物流状态"
              值={备货物流.物流状态.值}
              能改={能就地改}
              显示={(v) => (有值(v) ? <span className="proj-one" title={v}>{v}</span> : (p.必填?.还差.includes("物流状态") || p.必填?.还差.includes("已签收")) ? 占位确认("物流状态") : 待填("物流状态"))}
              存={(v) => 存项目项({ logisticsStatus: v })}
              编辑器={({ 草稿, 提交, 忙 }) => (
                <Select aria-label="物流状态" autoFocus defaultOpen allowClear disabled={忙} placeholder={未选占位} style={满宽} value={草稿 ?? undefined} options={[不填项, ...备货物流.物流状态.选项.map((x) => ({ value: x, label: x }))]} onChange={(v?: string) => 提交(去不填(v))} />
              )}
            />
          </div>
          <div {...交付行}>
            <span {...键}>物流单号</span>
            <ProjectInlineField<string>
              名="物流单号"
              规整={(v) => v.trim()}
              值={备货物流.物流单号 ?? ""}
              能改={能就地改}
              回车存
              显示={(v) => (有值(v) ? <span className="proj-one" title={v}>{v}</span> : p.必填?.还差.includes("物流单号") ? 占位确认("物流单号") : 待填("物流单号"))}
              存={(v) => 存项目项({ trackingNo: 文字格改动(v) })}
              编辑器={单行编辑器("物流单号", 物流单号上限)}
            />
          </div>
        </div>
      )}
      {(["balanceSettled", "acceptancePassed"] as const).map((k) => {
        const 勾了 = p[k];
        const 谁 = k === "balanceSettled" ? p.balanceSettledBy : p.acceptancePassedBy;
        const 何时 = k === "balanceSettled" ? p.balanceSettledAt : p.acceptancePassedAt;
        return (
          <div key={k} style={{ marginBottom: 8 }}>
            <Checkbox
              checked={勾了}
              disabled={!可改 || 忙 || (勾了 && 交付了)}
              title={不能改 ?? (勾了 && 交付了 ? `已经${交付叫法}了；要取消先把进程改回去` : undefined)}
              onChange={(e) => void 跑(() => 勾项目交付(p.id, k, e.target.checked))}
            >
              {k === "balanceSettled" ? "尾款结清" : "验收通过"}
            </Checkbox>
            {勾了 && 谁 && <span style={{ color: "var(--text-muted)", marginLeft: 4 }}>{谁} · {fmtDateTime(何时)}</span>}
          </div>
        );
      })}
      <div style={{ color: "var(--text-muted)", marginTop: 4 }}>
        {交付了 ? `已经${交付叫法}` : p.企业版
          ? (交付不在尾款 ?? (差.length ? 交付还差话(差, 交付叫法, true) : `可以点${交付叫法}`))
          : 差.length ? `两项都勾上才能点${交付叫法}（还差${差.join("、")}）` : `两项都勾上了，可以点${交付叫法}`}
      </div>
      {/* 企业版交付结清只在尾款结算这一步摆按钮（客户 11-19 定稿）；别的节点上面那行写清要先推到哪 */}
      {!交付了 && !交付不在尾款 && (
        <Button
          style={{ marginTop: 8 }}
          disabled={!可改 || 忙 || 差.length > 0}
          title={不能改 ?? (差.length ? `还差${差.join("、")}` : undefined)}
          onClick={() => 结束确认({ phase: "订单", node: p.phase === "订单" ? p.node : 字典.节点们.订单[字典.节点们.订单.length - 1], result: 交付结局 })}
        >
          {交付叫法}
        </Button>
      )}
    </Card>
  );
  const 项目组卡 = <ProjectTeamCard projectId={p.id} 组员们={p.members} 角色们={角色们} 在职={在职} 能改={可改 || !!p.能改组员} 能加={!!p.能加组员 || 可改} 忙={忙} 跑={跑} 企业版={p.企业版} 组长={p.ownerName} />;
  const 提成区 = p.提成 && <ProjectCommissionCard key={`${p.提成.项目底价}-${p.提成.实际?.固定于 ?? ""}`} projectId={p.id} t={p.提成} 忙={忙} 跑={跑}  />;
  const 变更卡 = (
    // 设计语言 D5 · M11-a：折叠的卡都写条数（卡片改进：条数灰字，ProjectFold 计数题）
    <Card title={计数题(卡名("进程变更"), p.logs.length)}>
      <Timeline
        items={p.logs.map((l) => ({
          color: l.kind !== "node" ? "gray" : l.to.result === "异常状态" ? "red" : 是交付(l.to.result) ? "green" : "blue",
          content: (
            <div>
              <div>{l.kind !== "node" ? 换人文字(l) : l.from ? `${位置文字(l.from, 字典)} → ${位置文字(l.to, 字典)}` : `建档，落在 ${位置文字(l.to, 字典)}`}</div>
              {l.category && <div style={{ color: "var(--danger-text)" }}>异常类别：{l.category}</div>}
              {/* 企业版换节点清掉的下一步（db.ts 原下一步备注）单独一行淡色，不当原因 */}
              {l.kind === "node" && l.reason && l.reason !== 超时理由 && (l.reason.startsWith("原下一步：")
                ? <div style={{ color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>{l.reason}</div>
                : <div style={{ color: "var(--danger-text)", whiteSpace: "pre-wrap" }}>{l.category ? "备注" : "原因"}：{l.reason}</div>)}
              {/* 换人那几行：企业版记的回收原因 / 分配方式（10-27）原样淡色显示；超时、停用上一行已经说了 */}
              {l.kind !== "node" && l.reason && l.reason !== 超时理由 && (l.放回方式 ?? "手动") === "手动" && <div style={{ color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>{进公海理由显示(l.reason)}</div>}
              <div style={{ color: "var(--text-muted)", fontSize: "var(--dt-aux, 12px)" }}>{l.reason === 超时理由 ? "系统" : l.who} · {fmtDateTime(l.at)}</div>
            </div>
          ),
        }))}
      />
    </Card>
  );
  // 企业版瀑布流（U-项目-01/04）：沟通、卡点与任务各是一块，卡头最右那颗点了展开 / 收起（ProjectFold，11-01），
  // 块里定高、自己滚；上面一个搜索框，搜沟通和卡点，有词时两块都摊开、只列对得上的。别的版本不折叠、不搜
  const 搜词 = p.企业版 ? 词们(搜) : [];
  const 搜着 = 搜词.length > 0;
  const 能隐藏 = 能隐藏接手前(p);
  const 隐藏中 = 能隐藏 && 只看接手后;
  // 只管这张卡列哪几条：发卡点、附件块那边照旧用 p.followUps
  const 显示的沟通 = 隐藏中 ? p.followUps.filter((f) => !f.接手前) : p.followUps;
  const 列沟通 = 搜着 ? 显示的沟通.filter((f) => 对得上(搜词, 沟通字段(f))) : 显示的沟通;
  const 列卡点 = 卡点 ? (搜着 ? 卡点.们.filter((k) => 对得上(搜词, 卡点字段(k))) : 卡点.们) : [];
  const 沟通数字 = 搜着 ? `搜到 ${列沟通.length}` : `${显示的沟通.length}`;
  /** 沟通卡身（项目页和嵌在客户页共用）：普通函数，别写成组件，免得每次渲染换组件丢状态 */
  const 沟通身 = () => (
        <div id="project-follow-body" className={p.企业版 ? "proj-mod-body" : undefined}>
        {/* 教练主题（11-17）：没关的钉在最上面，不混进下面这一串沟通（看全部沟通那条时间线里也不混） */}
        <CoachTopics 数据={教练主题} projectId={p.id} />
        {p.followUps.length === 0 && <div style={{ color: "var(--text-muted)" }}>{p.customer ? "还没有挂在这个项目上的沟通" : p.pooled ? "领取后可见" : "无权查看"}</div>}
        {搜着 && p.followUps.length > 0 && 列沟通.length === 0 && <div style={{ color: "var(--text-muted)" }}>没有对得上「{搜.trim()}」的沟通</div>}
        {!搜着 && 隐藏中 && 列沟通.length === 0 && <div style={{ color: "var(--text-muted)" }}>接手后还没有沟通；接手前的 {p.followUps.length} 条已隐藏</div>}
        {列沟通.map((f) => (
          // data-paste-scope：焦点在这条沟通里（含改沟通内容的文本框）粘截图，落进这条的附件（FollowAttachments）
          <div key={f.id} id={`follow-${f.id}`} data-paste-scope="" className={`proj-follow-row${删走 === f.id ? " pd-follow-leave" : ""}`} style={{ marginBottom: 12 }}>
            {/*
              设计语言 D4 · M7-a：开头一颗方式图标（没写方式的不再是「···」）；谁 · 方式 · 发起写成一行灰字，只留阶段一个小块；
              时间和列表同一套（今天 13:13 / 昨天 / 3 天前 / 11 月 18 日，悬停看完整时刻）
            */}
            <div className="proj-fu-m">
              {/* 左边这一段（谁 · 方式 · 发起、阶段、提醒）窄了自己折行让位，右边时间和 ⋮ 不折（#402 实操：1024 宽时间和 ⋮ 掉到第二行） */}
              <span className="proj-fu-l">
                <span className="proj-fu-i" aria-hidden>{f.type === "OTHER" ? <CommentOutlined /> : (FOLLOW_TYPE_ICON[f.type] ?? <CommentOutlined />)}</span>
                <span className="proj-fu-who">{f.who}</span>
                <span aria-hidden>·</span><span>{跟进方式名(f, "其他方式")}</span>
                {f.initiator && <><span aria-hidden>·</span><span>{f.initiator}</span></>}
                <Tag variant="filled" className="proj-fu-stage">{f.node}</Tag>
                {f.提醒 && <Tag color={提醒色[f.提醒.级别]}>{f.提醒.文字}</Tag>}
              </span>
              <span className="proj-fu-t" title={fmtDateTime(f.occurredAt)}>{smartTime(f.occurredAt)}</span>
              {f.已修改 && <span data-testid="follow-edited" title="这条沟通提交后改过，改了什么见操作日志" className="proj-fu-edited">已修改</span>}
              {(能改这条(f) || p.可删沟通 || 卡点?.能发) && (
                // 「…」放在这一行最右（时间已经靠右顶过来，这里不再 auto）：发卡点、修改、删除（10-30 发卡点从行上收进来）；删除 = 这一条下面长出确认条（dt.talkdel），见 删沟通条
                <span className="proj-fu-kb">
                    <Dropdown
                      trigger={["click"]}
                      placement="bottomRight"
                      disabled={忙}
                      menu={{
                        items: [
                          ...(卡点?.能发 ? [{ key: "blocker", label: "新建卡点" }] : []),
                          // 本人限时改的写清改到几点（原本就能改的不写）
                          ...(能改这条(f) ? [{ key: "edit", label: !p.可改沟通 && f.本人可改到 ? `修改（${dayjs(f.本人可改到).format("HH:mm")} 前可改）` : "修改" }] : []),
                          // ⋮ 里「删除」前一道分隔线（D4 · M7-c），和上面的常用动作隔开
                          ...(p.可删沟通 ? [...(卡点?.能发 || 能改这条(f) ? [{ type: "divider" as const }] : []), { key: "delete", label: "删除", danger: true }] : []),
                        ],
                        // 键盘回车选中菜单项时 rc-menu 不拦回车的默认动作：不拦的话这一下回车会落到刚弹出来的确认条按钮上，直接删掉（#402 复审）
                        onClick: ({ key, domEvent }) => {
                          domEvent.preventDefault();
                          if (key === "blocker") set发卡点于(f.id);
                          else if (key === "edit") set改沟通于(f);
                          else set删问于(f.id);
                        },
                      }}
                    >
                      <Button type="text" size="small" icon={<MoreOutlined />} aria-label="这条沟通的更多操作" />
                    </Dropdown>
                </span>
              )}
            </div>
            <div style={{ marginTop: 4 }}>
              <ProjectInlineField<string>
                名="沟通内容"
                规整={(v) => v.trim()}
                值={f.content}
                能改={p.企业版 && 能改这条(f)}
                多行
                显示={(v) => <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{v}</div>}
                存={(v) => 存沟通正文(f, v)}
                编辑器={({ 草稿, set草稿, 忙 }) => (<>
                  <Input.TextArea aria-label="沟通内容" autoFocus autoSize={{ minRows: 3, maxRows: 14 }} disabled={忙} value={草稿} onChange={(e) => set草稿(e.target.value)} />
                  {/* 无意义沟通（F-052）：内容改了才说（没动的照存）；判定一页共用（ProjectDetail 顶上取） */}
                  {草稿.trim() !== f.content.trim() && <FollowMeaningLine 内容={草稿} 类型={f.type} />}
                </>)}
              />
            </div>
            {f.附件 && <FollowAttachments followUpId={f.id} 附件={f.附件} 能传={!!p.可改沟通 || (p.能记沟通 && !!f.我记的)} 能删={!!p.可删沟通} on变了={() => router.refresh()} />}
            {删问于 === f.id && <删沟通条 忙={忙} 取消={() => { set删问于(null); set删沟通错(null); }} 删={() => void 删沟通(f.id)} />}
            {删沟通错?.id === f.id && <div role="alert" className="cd-task-err">{删沟通错.话}</div>}
          </div>
        ))}
        </div>
  );
  /** 嵌在客户页的沟通卡头：标题 + 计数 +「本项目 / 这位客户全部」，右边主按钮「新建沟通」（默认记到这个项目上） */
  const 沟通范围钮 = 嵌入 && !嵌入.无全部沟通 && (
    <span className="cd-seg" role="group" aria-label="沟通记录看哪些">
      <button type="button" className={看全部沟通 ? undefined : "on"} aria-pressed={!看全部沟通} onClick={() => set看全部沟通(false)}>本项目</button>
      <button type="button" className={看全部沟通 ? "on" : undefined} aria-pressed={看全部沟通} onClick={() => { set看全部沟通(true); set搜(""); }}>这位客户全部</button>
    </span>
  );
  const 沟通卡 = 嵌入 ? (
    <Card
      className="cd-comm"
      title={<span className="cd-comm-t">{计数题("沟通记录", 看全部沟通 ? 嵌入.全部沟通数 : 沟通数字)}</span>}
      extra={(
        <Space size={8} className="proj-follow-acts">
          {能隐藏 && !看全部沟通 && <Button size="small" aria-pressed={隐藏中} title="隐藏归属人不是你的沟通，只是不显示，不删数据" onClick={() => set只看接手后(!只看接手后)} data-testid="follow-hide-before">{隐藏中 ? "显示全部" : "隐藏接手前"}</Button>}
          {/* 11-12：「AI 录入」不再单摆，进「新建沟通」弹窗顶上切「手动录入 | AI 录入」。连体按钮：左半新建沟通（⌘N 落这颗）、右半收起 / 展开这块；不能记沟通只剩右半。
              原来这里的「发起主题」挪到客户页右上角「发起点评 ▾」（教练点评改版 PR1，11-21），卡头只剩「隐藏接手前」和「新建沟通」 */}
          <FoldSplit 色={模块钮色.沟通} 主={p.能记沟通 ? { 字: "新建沟通", onClick: () => set记一条开着(true), disabled: 忙, testid: "follow-card-new", 主快捷: true } : null} />
        </Space>
      )}
    >
      {沟通范围钮 && <div className="cd-comm-bar">{沟通范围钮}</div>}
      {看全部沟通 ? 嵌入.全部沟通 : 沟通身()}
    </Card>
  ) : (
    <Card
      // 客户页「跟进」菜单跳过来的落点（/projects/<id>#project-follow，P14 第 3 条）
      // 企业版的落点 id 在外面那层模块壳上（ProjectFold）
      {...(p.企业版 ? { title: 计数题("沟通", 沟通数字) } : { id: "project-follow", title: "沟通" })}
      extra={
        p.企业版 ? (
          // 企业版：「新增沟通」在这块卡头（「AI 录入」11-12 收进弹窗顶上的切换；11-01 页头只留转让、退回公海）；11-01 会议 §5：右侧写「新增沟通」、走弹窗。
          // 11-01 会议 §5：企业版删掉「去客户页看看」。窄的时候按钮折行，不把标题挤没（globals.css .proj-follow-acts）
          <Space size={8} wrap className="proj-follow-acts">
            {能隐藏 && <Button size="small" aria-pressed={隐藏中} title="隐藏归属人不是你的沟通，只是不显示，不删数据" onClick={() => set只看接手后(!只看接手后)} data-testid="follow-hide-before">{隐藏中 ? "显示全部" : "隐藏接手前"}</Button>}
            {/* 独立项目页（看不到客户的实线 / 虚线上级留在这页，能发点评）：「发起点评 ▾」留在沟通卡头，不挪到页头（这页页头 11-01 只留转让、退回公海） */}
            <StartReviewButton 数据={教练主题} projectId={p.id} size="small" />
            <FoldSplit 色={模块钮色.沟通} 主={p.能记沟通 ? { 字: "新增沟通", onClick: () => set记一条开着(true), disabled: 忙, testid: "follow-card-new" } : null} />
          </Space>
        ) : p.能记沟通 ? <Button type="link" size="small" disabled={忙} onClick={() => set记一条开着(true)}>记一条</Button>
          // 别的版本照旧给「去客户页记一条」
          : p.customer && <Link href={`/customers/${p.customer.id}`}>去{b.customer}页记一条<LinkPending /></Link>
      }
    >
      {沟通身()}
    </Card>
  );
  // 企业版原叫「卡点与任务」（U-项目-01）；这一版只有卡点、没有任务数据，界面上就叫「卡点」
  const 卡点区 = 卡点 && (
    <Card
      title={p.企业版 ? 计数题(卡点名, 搜着 ? `搜到 ${列卡点.length}` : 卡点.们.length) : `卡点（${卡点.们.length}）`}
      // 发卡点挂在最近一条沟通上（沟通行的「…」里也能挑别的那条）；企业版 11-01 从页头回到这块卡头，没沟通时灰着、悬停说为什么
      extra={p.企业版 ? (
        // 11-12 连体按钮：左半「新建卡点」（11-12 用户看 3702 由「发卡点」改名；没沟通时灰着、悬停说为什么），右半收起 / 展开；不能发只剩右半
        <FoldSplit 色={模块钮色.卡点} 主={卡点.能发 ? { 字: "新建卡点", onClick: () => p.followUps[0] && set发卡点于(p.followUps[0].id), disabled: 忙, 原因: p.followUps.length ? undefined : "先记一条沟通" } : null} />
      ) : 卡点.能发 && (
        <Space size={8}>
          {!p.followUps.length && <span style={{ color: "var(--text-muted)", fontSize: "var(--dt-aux, 12px)" }}>先记一条沟通</span>}
          <Button type="primary" size="small" disabled={!p.followUps.length} onClick={() => p.followUps[0] && set发卡点于(p.followUps[0].id)}>新建卡点</Button>
        </Space>
      )}
    >
      <div id="project-blockers-body" className={p.企业版 ? "proj-mod-body" : undefined}>
        {/* 搜着时（不管有没有卡点）空态都写「没有对得上…」，不说「还没有卡点」（D4 · M7-d） */}
        <BlockerList 们={列卡点} 空={搜着 ? `没有对得上「${搜.trim()}」的卡点` : "还没有卡点"} />
      </div>
    </Card>
  );

  const 画像卡 = p.画像 && <ProjectProfileCard projectId={p.id} 画像={p.画像} 能改={可改} />;
  // 项目附件合成一块（F-项目-18）：项目方案、合同附件（这两格各自框起来带提示，F-042）、验收报告、其它附件各一格（节点必填「合同附件」「项目方案」「验收报告」各看自己那一格；没分格的老附件算在「其它」里），
  // 最后一格把挂在各条沟通上的截图、录音收过来，写明来自哪条沟通，点了跳到那条（在这里只看、下载，传和删回那条沟通上）
  const 沟通附件们: 沟通附件组[] = p.followUps
    .filter((f) => f.附件?.length)
    .map((f) => ({ followUpId: f.id, 来源: 沟通来源(f), 附件: f.附件 ?? [] }));
  const 去看沟通 = (id: string) => {
    set搜("");
    set沟通开(true);
    // 等沟通块摊开、行挂上再滚过去
    setTimeout(() => document.getElementById(`follow-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
  };
  const 附件卡 = p.项目附件 && (
    <ProjectAttachmentsCard
      key={p.id}
      projectId={p.id}
      起始个数={p.项目附件}
      只读={p.项目附件.只读}
      沟通们={沟通附件们}
      去看={去看沟通}
    />
  );
  const 回款卡 = p.回款们 && <ProjectPaymentsCard key={p.id} projectId={p.id} 回款们={p.回款们} 能改={可改} 默认={p.成交钱?.contractCurrency ?? p.currency} 合同={p.成交钱 ? { 数: p.成交钱.contractAmount, 币: p.成交钱.contractCurrency ?? 默认币种 } : null} />;

  const 领取钮 = (
    <>
      {p.能领取 && <Button size={嵌入 ? "small" : undefined} type="primary" disabled={忙} onClick={() => void 跑(() => 领取项目(p.id), "已领取，你是这个项目的负责人了")}>领取</Button>}
      {/* 企业版原负责人：按钮摆着、灰着，悬停说为什么（接口也拦，lib/project/db.ts 领取公海项目） */}
      {!p.能领取 && p.领取不给 && <Tooltip title={p.领取不给}><Button size={嵌入 ? "small" : undefined} type="primary" disabled>领取</Button></Tooltip>}
    </>
  );
  // 企业版换负责人单独一个按钮（10-30），弹窗说清转了会怎样、点「确认转让」才转（U-项目-07）
  // 11-01：转让按 能转让 给（总管理、上级能转不能改；负责人本人能改不能自己转），和 lib/project/db.ts 改项目 同一个判断
  const 转给钮 = 能项目转让(p, 候选) && (
    <Button size={嵌入 ? "small" : undefined} title={嵌入 ? "只转当前页签的项目，客户不动" : undefined} disabled={忙} onClick={() => { set转给谁(null); set转给带待办(公海规则.带待办默认勾); set转给框(true); }}>项目转让</Button>
  );
  const 放回问 = () => {
    // 企业版：放回前可选一个「回收原因」（字典，不选也行）；别的版本照旧一个确认
    if (p.企业版) { set回收原因(null); set放回框(true); return; }
    // 后果框：没退成原因写在框里、框不关；退成了框关、页面刷新成公海态，不再弹顶部提示
    void 问后果({
      题: "把项目退回公海？",
      后果: [
        { 标: "只退它", 话: "只退这个项目，客户不动" },
        { 标: "领不回", 话: "退回去以后谁都能领，你自己不能再领回来", 级: "危" },
      ],
      是: "项目退回公海",
      做: async () => {
        const r = await 放回项目公海(p.id);
        if (!r.ok) return r;
        router.refresh();
      },
    });
  };
  // 后果框：删前清点写在框里；没删成原因写在框里、框不关
  const 删问 = () => void 问后果({ 题: "删除这个项目？", 后果: [{ 标: "会删掉", 话: 删除说明(p.删前清点, b.customer, p.企业版), 级: "危" }], 是: "删除", 做: 删 });
  // 嵌在客户页：右上角「更多操作 ▾」点了哪项经 动作口 递到这里，和原来那几颗按钮的 onClick 一样（忙着的时候按钮是灰的，这里同样不理）
  const 挂动作 = 嵌入?.挂动作;
  const 报忙 = 嵌入?.报忙;
  useEffect(() => { 报忙?.(忙); }, [报忙, 忙]);
  useEffect(() => () => 报忙?.(false), [报忙]);
  const 做动作 = (key: 项目动作键) => {
    // 忙着时客户页菜单那几项已经灰了（报忙）；这里只防菜单关之前那一下连点
    if (忙) return;
    if (key === "claim") { if (p.能领取) void 跑(() => 领取项目(p.id), "已领取，你是这个项目的负责人了"); }
    else if (key === "transfer") { set转给谁(null); set转给带待办(公海规则.带待办默认勾); set转给框(true); }
    else if (key === "pool") { if (!等复核) 放回问(); }
    else 删问();
  };
  const 做动作ref = useRef(做动作);
  useEffect(() => { 做动作ref.current = 做动作; });
  useEffect(() => {
    if (!挂动作) return;
    挂动作((key) => 做动作ref.current(key));
    return () => 挂动作(null);
  }, [挂动作]);

  // 企业版页头（11-01 用户：「和客户页一样，仅留转让项目，退回公海。其余的放回各模块。」）：记一条沟通 / AI 录入回沟通卡头，发卡点回卡点卡头，
  // 关联 + 回关联卡，邀请回项目组卡，改分配回提成卡，项目画像、附件就在各自卡上改 / 传，线索判定一直在节点卡里。
  // 公海里的项目这里是「领取」。「删除项目」企业版只摆给总管理（QA #3，进回收站；服务端 删项目 也只放总管理），收在「更多」里。
  // ⌘N 点的是页头主按钮（领取），没有就点节点卡上的「新增沟通」（data-cmd-new，components/CommandBar.tsx）
  // 嵌在客户页时这几颗挪到项目区第一行右端（小一号、不折行），只作用于当前页签这个项目
  const 钮号 = 嵌入 ? "small" as const : undefined;
  const 放回钮 = p.能放公海 && (等复核
    ? <Tooltip title={`${等复核文字}，暂时不能退回公海`}><Button size={钮号} disabled>项目退回公海</Button></Tooltip>
    : <Button size={钮号} disabled={忙} onClick={放回问} title={嵌入 ? "只退回当前页签的项目，客户不动" : undefined}>项目退回公海</Button>);
  const 删钮 = p.能删 && (
    <Dropdown trigger={["click"]} placement="bottomRight" disabled={忙} menu={{ items: [{ key: "delete", danger: true, label: "删除项目" }], onClick: () => 删问() }}>
      <Button size={钮号} icon={<MoreOutlined />} aria-label="项目的更多操作">{嵌入 ? null : "更多"}</Button>
    </Dropdown>
  );
  const 企业版页头钮 = (p.能领取 || !!p.领取不给 || !!转给钮 || p.能放公海 || !!p.能删) && (
    <Space wrap>
      {领取钮}
      {转给钮}
      {放回钮}
      {删钮}
    </Space>
  );

  const 页头 = (
    <PageHead
      title={p.name}
      titleAside={<ProjectStarButton projectId={p.id} 初值={p.收藏了 ?? false} />}
      subtitle={`${项目人说法(p)} · 创建于 ${fmtDateTime(p.createdAt)}`}
      extra={p.企业版 ? 企业版页头钮 || undefined : (
        <Space wrap>
          {领取钮}
          {转给钮}
          {/* 放回公海、删除项目少用、后果重：收进「更多」（10-30） */}
          {(p.能放公海 || (p.能删 ?? 能改)) && (
            <Dropdown
              trigger={["click"]}
              placement="bottomRight"
              disabled={忙}
              menu={{
                items: [
                  ...(p.能放公海 ? [{ key: "pool", disabled: 等复核, label: 两行("放回公海", 等复核 ? `${等复核文字}，暂时不能放回` : undefined) }] : []),
                  ...((p.能删 ?? 能改) ? [{ key: "delete", danger: true, label: "删除项目" }] : []),
                ],
                onClick: ({ key }) => (key === "pool" ? 放回问() : 删问()),
              }}
            >
              <Button icon={<MoreOutlined />} aria-label="项目的更多操作">更多</Button>
            </Dropdown>
          )}
        </Space>
      )}
    />
  );

  /** 企业版每块卡包一层模块壳（ProjectFold）：卡头最右一颗收起 / 展开，各块自己记开合 */
  const 折 = (名: string, 卡: ReactNode, id?: string, 默认开 = true) => (卡 ? <ProjectFold id={id} 名={名} 默认开={默认开}>{卡}</ProjectFold> : null);
  const 头部框内容 = (() => {
    switch (头部框) {
      case "推进":
        return (
          <div className="proj-modal-sec">
            <div><span className="proj-where-label">现在在</span> {位.阶段} · {位.进程}{位.结局 ? ` · ${位.结局}` : ""}</div>
            <div>
              <Button type="primary" disabled={忙 || !!推不了} onClick={换框(() => 下 && 改到(下))}>{下一步字}</Button>
              {推不了 && <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: "var(--dt-aux, 12px)" }}>{推不了}</div>}
            </div>
            {更多去处项.length > 0 && (
              <div>
                <div className="proj-where-label">改到别的进程或结局</div>
                <Menu className="proj-modal-menu" selectable={false} items={更多去处项} onClick={({ key }) => { set头部框(null); 结束确认(JSON.parse(key) as 位置); }} />
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  })();

  /** 各种弹窗：项目页和嵌在客户页共用 */
  const 弹窗们 = (
    <>
      {/* 不给放弃（没有入口：已记有效沟通、开关关了、不是负责人…）：只管从通知带 ?giveup=1 来的那一下，弹一句为什么、去掉参数；
          平时什么都不画。放这里不放告示里：嵌在客户页时告示块只在公海 / 异常 / 客户在别人名下 / 有入口时才画（3703 实操 11-21） */}
      {!p.放弃 && <GiveUpBanner projectId={p.id} />}
      {p.线索验证 && (
        <Modal open={验证开着} title="线索验证" footer={null} width={560} onCancel={() => set验证开着(false)} destroyOnHidden>
          <LeadVerifyPanel projectId={p.id} 项目名={p.name} v={p.线索验证} 无效原因选项={p.原因选项.无效} 字数上限={p.字数上限} 跑={跑} 忙={忙} 缺有效沟通话={缺有效沟通话} 不给推={p.不给推} 线索验证必填={p.线索验证必填 ?? []}
            重复线索名={p.重复咨询?.重复线索名}
            有效还差={没有效沟通 ? p.有效沟通差 : []}
            沟通半句={沟通半句}
            on去填={能去填 ? (叫) => { set验证开着(false); window.setTimeout(() => 去填(叫法到键(叫)), 80); } : undefined}
          />
        </Modal>
      )}
      {可改 && 编辑开着 && (
        <ProjectEditModal
          open
          onClose={() => set编辑开着(false)}
          跑={跑}
          p={{ id: p.id, name: p.name, ownerId: p.ownerId, amount: p.amount, currency: p.currency, remark: p.remark, contactId: p.contact?.id ?? null, ...(p.企业版 ? { expectedDealAt: p.expectedDealAt ?? null, channelId: p.channelId ?? null, level: p.level ?? null, ...(p.项目标签 ? { 项目标签: p.项目标签 } : {}), bizLine: p.bizLine ?? null, 所在地: p.所在地 ?? null, ...(p.成交钱 ? { 成交钱: p.成交钱 } : {}), ...(p.项目新字段 ? { 项目新字段: p.项目新字段 } : {}), ...(p.备货物流 && 显示交付 ? { 备货物流: p.备货物流 } : {}) } : {}) }}
          候选={候选}
          联系人们={联系人们}
          渠道们={p.企业版 ? p.渠道们 : undefined}
          改负责人={!p.企业版}
        />
      )}

      {卡点?.能发 && 发卡点于 && <PublishBlockerModal followUpId={发卡点于} 默认={卡点.默认} 原因们={卡点.原因们} 沟通们={p.followUps} onClose={() => set发卡点于(null)} />}

      {/* 本人限时改的框打开后到点不收，框里说一句「过了 30 分钟」、清掉草稿、保存灰掉（低-1）；原本就能改的不限时 */}
      {改沟通于 && (p.可改沟通 || !!改沟通于.本人可改到) && <EditFollowModal projectId={p.id} f={改沟通于} 外贸={外贸精简(b)} 要下一步={!!p.要下一步} 限时到={p.可改沟通 ? undefined : 改沟通于.本人可改到} 钟差={钟差} onClose={() => set改沟通于(null)} 跑={跑} />}

      {头部框 && 头部框 !== "完成" && (
        <Modal open title={`${头部框叫法[头部框]} · ${p.name}`} footer={null} width={520} onCancel={关头部框}>
          {头部框内容}
        </Modal>
      )}

      {后果框}
      {p.能记沟通 && 记一条开着 && <RecordFollowModal p={p} 外贸={外贸精简(b)} 卡点默认={卡点?.能发 ? 卡点.默认 : null} 卡点原因们={卡点?.原因们 ?? []} onClose={() => set记一条开着(false)} 跑={跑} 回执={就地} 回处={嵌入 && p.customer ? 客户页项目地址(p.customer.id, p.id) : undefined} />}

      <Modal
        open={!!异常框}
        title={终止中 ? "终止进程：进异常状态" : "进异常状态"}
        okText="确定"
        okButtonProps={{ danger: true, disabled: !类别, loading: 忙 }}
        onCancel={() => set异常框(null)}
        onOk={async () => {
          if (!异常框 || !类别) return;
          const 附 = { categoryId: 类别, 备注: 原因 };
          const ok = await 跑(() => (终止中 ? 终止项目进程(p.id, 附) : 改项目节点(p.id, 异常框, 附)), 终止中 ? "已终止进程，标成异常状态" : "已标成异常状态", 框报错);
          if (ok) set异常框(null);
        }}
      >
        <div style={{ marginBottom: 8, color: "var(--text-muted)" }}>选一个异常类别，看板上这张卡会标红；处理好了把进程改回去就算恢复，类别和备注留在{变更记在}里。</div>
        <Select
          style={{ width: "100%", marginBottom: 12 }}
          placeholder={类别们.length ? "选异常类别" : "没有在用的异常类别，请管理员在设置里加"}
          value={类别}
          onChange={(v: string) => set类别(v)}
          options={类别们.map((c) => ({ value: c.id, label: c.name }))}
          aria-label="异常类别"
        />
        <Input.TextArea rows={4} maxLength={原因上限} showCount value={原因} onChange={(e) => set原因(e.target.value)} placeholder="备注（可不写）" />
        {!!异常框 && <框里原因 话={框错} />}
      </Modal>

      <Modal
        open={!!没成框}
        title={没成框 ? `${终止中 ? "终止进程" : "定结果"}：${结局叫法(没成框.result ?? "", 字典)}` : ""}
        okText="确定"
        okButtonProps={{ danger: true, disabled: !没成备注 || !!其他没写好(无效原因), loading: 忙 }}
        onCancel={() => set没成框(null)}
        onOk={async () => {
          if (!没成框 || !没成备注 || 其他没写好(无效原因)) return;
          const ok = await 跑(
            () => (终止中 ? 终止项目进程(p.id, { 备注: 没成备注 }) : 改项目节点(p.id, 没成框, { 备注: 没成备注 })),
            终止中 ? `已终止进程：${结局叫法(没成框.result ?? "", 字典)}` : `已改到 ${位置文字(没成框, 字典)}`,
            框报错,
          );
          if (ok) set没成框(null);
        }}
      >
        <div style={{ marginBottom: 8, color: "var(--text-muted)" }}>{选无效原因 ? `选一个无效原因，或写一句为什么没成（至少一样），会记在${变更记在}里；以后捡回来把进程改回去就行。` : `写一句为什么没成，会记在${变更记在}里；以后捡回来把进程改回去就行。`}</div>
        {选无效原因 && (
          <DictSelect style={{ width: "100%", marginBottom: 8 }} placeholder="无效原因" aria-label="无效原因" value={无效原因} onChange={set无效原因} options={p.原因选项.无效} />
        )}
        <Input.TextArea rows={4} maxLength={原因上限 - (无效原因 ? 无效原因.length + 无效原因前缀.length + 1 : 0)} showCount value={原因} onChange={(e) => set原因(e.target.value)} placeholder={选无效原因 ? "补充说明" : "原因（必填）"} aria-label="原因" />
        {!!没成框 && <框里原因 话={框错} />}
      </Modal>

      <Modal
        open={放回框}
        title="把项目退回公海？"
        okText="项目退回公海"
        okButtonProps={{ loading: 忙, disabled: !!其他没写好(回收原因) }}
        onCancel={() => set放回框(false)}
        onOk={async () => {
          const ok = await 跑(() => 放回项目公海(p.id, 回收原因), undefined, 框报错);
          // 企业版放回后原负责人看不到这个项目了（C-01，lib/project/pool-owner.ts 原负责人回避），回项目列表
          if (ok) { set放回框(false); 走开(); }
        }}
      >
        <div style={{ marginBottom: 8, color: "var(--text-muted)" }}>只退这个项目：退回去以后同事都能领，你作为原负责人不能再领回来，也看不到它了；你会记成这个项目的历史负责人，你在这个项目上没做完的待办会自动关闭。客户和客户负责人不动。</div>
        <DictSelect style={{ width: "100%" }} placeholder="回收原因（可不选）" aria-label="回收原因" value={回收原因} onChange={set回收原因} options={p.原因选项.回收} />
        {放回框 && <框里原因 话={框错} />}
      </Modal>

      <Modal
        open={转给框}
        title="项目转让"
        okText="确认转让"
        okButtonProps={{ disabled: !转给谁, loading: 忙 }}
        onCancel={() => set转给框(false)}
        onOk={() => 转给谁 && 确认转给(转给谁)}
      >
        <Select
          showSearch
          optionFilterProp="label"
          style={{ width: "100%", marginBottom: 8 }}
          placeholder="选接手的人"
          aria-label="转给谁"
          value={转给谁}
          onChange={(v: string) => set转给谁(v)}
          options={成员选项(候选).filter((o) => o.value !== p.ownerId)}
        />
        {带待办勾出 && (
          <Checkbox style={{ marginBottom: 8 }} checked={转给带待办} onChange={(e) => set转给带待办(e.target.checked)}>
            原负责人没做完的待办一起转给新负责人
          </Checkbox>
        )}
        <div style={{ color: "var(--text-muted)" }}>
          {转给名 ? `确认转给 ${转给名}？${转给谁 && p.转后还能看?.includes(转给谁) ? "转了以后你还能看这个项目" : "转了以后你看不到这个项目"}，下一步、卡点、沟通记录都跟着项目交给 ${转给名}；转了不能撤销。` : "选好接手的人，再点「确认转让」。"}
        </div>
        {转给框 && <框里原因 话={框错} />}
      </Modal>
    </>
  );
  const 告示 = (
    <>
      {p.pooled && (
        <Alert type="info" showIcon style={{ marginBottom: 16 }} title="这个项目在线索公海里" description={公海告示话(p)} />
      )}

      {p.客户在谁名下 && (
        <Alert type="warning" showIcon style={提示条下距} data-testid="proj-customer-held" title={客户在谁名下话(p.客户在谁名下)} description={`这条线索是系统转给你的（超时未跟进自动转，或同事主动放弃），客户不在你名下；跟进前先和 ${p.客户在谁名下} 通个气，别两个人同时跟同一位客户`} />
      )}

      {/* 给放弃（有入口）：提示条在告示里。不给放弃的那一下（从通知带 ?giveup=1 来，弹一句为什么）挂在 弹窗们 里 */}
      {p.放弃 && <GiveUpBanner projectId={p.id} 入口={p.放弃} 打开判无效={p.线索验证 ? () => set验证开着(true) : undefined} />}

      {异常 && (
        <Alert
          type="error" showIcon style={{ marginBottom: 16 }}
          title={`这个项目在异常状态${p.exceptionCategory ? `：${p.exceptionCategory}` : ""}`}
          description={p.exceptionReason ? <span style={{ whiteSpace: "pre-wrap" }}>{p.exceptionReason}</span> : undefined}
        />
      )}

    </>
  );
  const 搜索框 = (
    <div className="proj-search">
      <Input
        allowClear
        prefix={<SearchOutlined aria-hidden />}
        // 「这位客户全部」时框淡着点不了：占位字直接写为什么（D4 · M7-d），不让人以为坏了
        placeholder={看全部沟通 ? "切回「本项目」才能搜" : "搜这个项目的沟通、卡点"}
        aria-label="搜这个项目的沟通、卡点"
        value={搜}
        onChange={(e) => set搜(e.target.value)}
      />
    </div>
  );
  if (嵌入) {
    return (
      /* 客户详情的项目区（定稿 UI .zone）：中栏干活，右栏看资料。1280 也是两栏，窄到放不下右栏落到中栏下面（globals.css .rec-zone）。
         11-12：提醒条 / 告示 / 两栏都是 .cd-zb 这张网格的直接子项——提醒条只占中栏一格，告示横跨两栏（项目切换在进程卡卡头里），
         进程卡和右栏「项目资料」同在下一行，顶边自然对齐；排布要调只改 globals.css 的 .cd-zb 那几条 */
      <section className="rec-zone" aria-label={`项目：${p.name}`} data-project={p.id}>
        <div className="cd-zb">
          {嵌入.提醒 && <div className="cd-alert">{嵌入.提醒}</div>}
          {(p.pooled || 异常 || p.客户在谁名下 || p.放弃) && <div className="cd-notice">{告示}</div>}
          <div className="cd-mid">
            {节点卡}
            {/* 「这位客户全部」是客户页那条时间线，不归这个搜索框管：切过去时清掉词（审查 #6）；搜索框原地变淡、点不了，不再藏起来让下面的卡往上跳（dt.scope） */}
            <div className={`cd-search-wrap${看全部沟通 ? " is-off" : ""}`} inert={看全部沟通} aria-hidden={看全部沟通 || undefined}>{搜索框}</div>
            <ProjectFold id="project-follow" 名="沟通记录" 开={沟通开} set开={set沟通开} 锁开={搜着} 控制="project-follow-body" 连体>{沟通卡}</ProjectFold>
            {嵌入.待办}
            {卡点区 && <ProjectFold id="project-blockers" 名={卡点名} 开={卡点开} set开={set卡点开} 锁开={搜着} 控制="project-blockers-body" 连体>{卡点区}</ProjectFold>}
          </div>
          {/* 11-12：右栏管的是当前项目，卡名没带「项目」的补上（card-names.tsx）；卡自己写标题的（回款、提成、关联…）从 卡名Provider 取 */}
          <卡名Provider value={项目卡名}>
            <aside className="cd-side" aria-label="项目资料">
              {折("项目资料", 项目卡)}
              {折("项目画像", 画像卡, 画像落点)}
              {折("项目附件", 附件卡, "project-attachments-fold")}
              {折(卡名("回款"), 回款卡, "project-payments-fold", false)}
              {显示交付 && 折(卡名("交付"), 交付卡, undefined, false)}
              {折("项目组", 项目组卡, undefined, false)}
              {折(卡名("提成"), 提成区, undefined, false)}
              {嵌入.进程变更卡 && 折(卡名("进程变更"), 变更卡, undefined, false)}
              {p.关联 && 折(卡名("关联客户"), <ProjectRelate projectId={p.id} 关联={p.关联} 能改={可改} 只="客户" />, undefined, false)}
              {p.关联 && 折(卡名("关联联系人"), <ProjectRelate projectId={p.id} 关联={p.关联} 能改={可改} 只="联系人" />, undefined, false)}
            </aside>
          </卡名Provider>
        </div>
        {回执条}
        {弹窗们}
      </section>
    );
  }

  const 正文 = (
    <div className={p.企业版 ? "proj-wrap" : undefined} style={{ maxWidth: p.企业版 ? 1200 : 960 }}>
      {p.企业版 ? (
        /* 企业版（P11）：项目名单在中栏（@pane/projects/(detail)/layout.tsx，components/ProjectRoster.tsx）。
           它收起或收成抽屉时，标题最左边补一颗侧栏图标把它叫回来，和客户详情页同一颗（components/PaneToggle.tsx） */
        <>
        {/* 回到进来前那张列表（员工反馈 1A，components/BackToList.tsx）；企业版没有项目列表入口，没记过回客户列表 */}
        <div className="back-to-list-row"><BackToList /></div>
        <div className="proj-head">
          <PaneToggle 栏="roster" 位置="主区" 名="项目列表" />
          {页头}
        </div>
        </>
      ) : (
        页头
      )}

      {告示}

      {p.企业版 ? (
        <>
          {/* 企业版两栏（10-27 会后排版）：左边干活——节点、沟通、卡点；右边看资料——项目、交付、项目组、提成、节点变更。
              容器窄了（有 AI 侧栏、窗口小）退成一栏，干活的在上（globals.css .proj-2col） */}
          <div className="proj-2col">
            {/* 左栏整列上下瀑布流（U-项目-01）：当前进程（固定在最上、不折叠）→ 搜索 → 沟通（默认开）→ 卡点与任务（默认收）→ 项目附件 → 回款 */}
            <div className="proj-main">
              {节点卡}
              {搜索框}
              {/* 沟通、卡点跟着搜索：有词时都摊开、收起钮灰着 */}
              <ProjectFold id="project-follow" 名="沟通" 开={沟通开} set开={set沟通开} 锁开={搜着} 控制="project-follow-body" 连体>{沟通卡}</ProjectFold>
              {卡点区 && <ProjectFold id="project-blockers" 名="卡点" 开={卡点开} set开={set卡点开} 锁开={搜着} 控制="project-blockers-body" 连体>{卡点区}</ProjectFold>}
              {折("项目附件", 附件卡, "project-attachments-fold")}
              {折("回款", 回款卡, "project-payments-fold")}
            </div>
            <aside className="proj-side" aria-label="项目资料">
              {折("项目", 项目卡)}
              {折("项目画像", 画像卡, 画像落点)}
              {p.关联 && 折("关联客户", <ProjectRelate projectId={p.id} 关联={p.关联} 能改={可改} 只="客户" />)}
              {p.关联 && 折("关联联系人", <ProjectRelate projectId={p.id} 关联={p.关联} 能改={可改} 只="联系人" />)}
              {折("交付", 交付卡)}
              {折("项目组", 项目组卡)}
              {折("提成", 提成区)}
              {折("进程变更", 变更卡)}
            </aside>
          </div>
        </>
      ) : (
        <>
          {节点卡}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 16 }}>
            {项目卡}
            {交付卡}
          </div>

          <div style={{ marginBottom: 16 }}>{项目组卡}</div>

          {提成区 && <div style={{ marginBottom: 16 }}>{提成区}</div>}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
            {变更卡}
            {沟通卡}
            {卡点区}
          </div>
        </>
      )}

      {回执条}
      {弹窗们}
    </div>
  );
  // 就地改的格子（ProjectInlineField）打了没存的字按这个项目留草稿（components/FormDraft.tsx）
  return <草稿范围 value={`项目:${p.id}`}>{正文}</草稿范围>;
}

/**
 * 记录人本人限时改（11-19）：给每条的「能改到几点」，返回判一条现在还能不能改，和 钟差（服务器钟 − 本机钟，毫秒）。
 * 服务端渲染和首帧一律当不能改（钟不一样，免得水合对不上），挂上以后按「本机钟 + 钟差」判（低-1：本机钟不准也按服务器的 30 分钟收），
 * 最早那个到点时重渲一次把「修改」收起。钟差按拿到页面那一刻量（服务器现在 没给 = 0），刷新页面重量
 */
function useOwnEditWindow(到点们: readonly (string | undefined)[], 服务器现在?: string): { 能改: (到?: string) => boolean; 钟差: number } {
  const [量过, set量过] = useState<{ 现在: number; 差: number; 按: string | undefined } | null>(null);
  const 键 = 到点们.filter(Boolean).join("|");
  useEffect(() => {
    // 首帧挂上（或换了一页数据）就量一次钟差；之后只在下一个还没过的点到了再量
    if (量过 === null || 量过.按 !== 服务器现在) {
      const t = setTimeout(() => { const 差 = 服务器现在 ? Date.parse(服务器现在) - Date.now() : 0; set量过({ 现在: Date.now() + 差, 差, 按: 服务器现在 }); }, 0);
      return () => clearTimeout(t);
    }
    const 下一个 = 键 ? 键.split("|").map((x) => Date.parse(x)).filter((t) => t > 量过.现在).sort((a, b) => a - b)[0] : undefined;
    if (下一个 === undefined) return;
    const t = setTimeout(() => set量过({ ...量过, 现在: Date.now() + 量过.差 }), Math.min(下一个 - (Date.now() + 量过.差) + 200, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [键, 量过, 服务器现在]);
  return { 能改: (到) => !!到 && 量过 !== null && 量过.现在 <= Date.parse(到), 钟差: 量过?.差 ?? 0 };
}

/** 本人限时改的框开着到点（低-1） */
const 本人改过时提示 = "已经超过提交后 30 分钟，这条不能再改了；没保存的改动已清掉";

/**
 * 改项目上的一条沟通（「…」→ 修改，10-29）：沟通方式、时间、内容三格，别的（阶段、下一步）不在这里改。
 * 打开时的 updatedAt 一起交回去，别人先改了就报版本冲突，不悄悄盖掉
 */
function EditFollowModal({ projectId, f, 外贸, 要下一步 = false, 限时到, 钟差 = 0, onClose, 跑 }: {
  projectId: string;
  f: 项目详情["followUps"][number];
  外贸: boolean;
  /** 线索 / 商机阶段开了超时回收：下一步时间必填（同记的时候）；只在 f.下一步 给了、人动了下一步时用 */
  要下一步?: boolean;
  /** 本人限时改能改到几点（ISO）；原本就能改的不给 = 不限时 */
  限时到?: string;
  /** 服务器钟 − 本机钟（毫秒，useOwnEditWindow 量的） */
  钟差?: number;
  onClose: () => void;
  跑: 跑法;
}) {
  const 能选类型 = 跟进类型们(外贸).filter((t) => t.value !== "TASK" && t.value !== "REMIND");
  // 老数据可能是待办 / 提醒类型：下拉里补上它自己，不改类型就原样存回
  const 类型们 = 能选类型.some((t) => t.value === f.type) ? 能选类型 : [...能选类型, ...跟进类型们(外贸).filter((t) => t.value === f.type)];
  const [type, setType] = useState(f.type);
  const 判定 = useFollowJudge();
  const [method, setMethod] = useState<string | null>(f.method ?? null);
  // 发起主体（11-01）：原来填了的改时也得有；老记录没填的不逼着补，空着交上去服务端原样留
  const 主体们 = useFollowInitiators();
  const [发起, set发起] = useState<string | null>(f.initiator ?? null);
  // 沟通时间：弹窗只到分钟。人没动就原样交回 ISO（低-2：带秒的不被截、不多记一格「沟通时间」）
  const 原时间 = dayjs(f.occurredAt).format(沟通时间格式);
  const [occurredAt, setOccurredAt] = useState(原时间);
  const [content, setContent] = useState(f.content);
  // 下一步跟着改（11-19，f.下一步 给了才有）：和记的时候一样，下一步计划必填、时间按 要下一步
  // 服务端只在这条记的时候写过下一步才给 f.下一步（审核中-1）；人没动这两格就不交、不校验，不覆盖项目上的下一步
  const 改下一步 = !!f.下一步;
  const [下一步文字, set下一步文字] = useState(f.下一步?.文字 ?? "");
  const [下一步时间, set下一步时间] = useState<string | null>(f.下一步?.时间 ?? null);
  const 动了下一步 = 改下一步 && (下一步文字 !== (f.下一步?.文字 ?? "") || 下一步时间 !== (f.下一步?.时间 ?? null));
  const [交中, set交中] = useState(false);
  /** 没存上的原因（版本冲突、没权限……）：写在框里、框不关，不弹顶部提示 */
  const [交错, set交错] = useState<string | null>(null);
  /** 本人限时改到点了（低-1）：框里说一句、草稿清掉、保存灰掉 */
  const [过时了, set过时了] = useState(false);
  // 改了没交的留草稿（components/FormDraft.tsx）：刷新、发版后重开这条接着改；只存改过的格子
  const 稿 = useFormDraft({
    键: `改项目沟通:${f.id}`,
    值: { type, method, 发起, occurredAt, content, ...(改下一步 ? { 下一步文字, 下一步时间 } : {}) },
    带回: (v) => {
      if (改下一步 && typeof v.下一步文字 === "string") set下一步文字(v.下一步文字);
      if (改下一步 && v.下一步时间 !== undefined) set下一步时间(v.下一步时间 ?? null);
      if (typeof v.type === "string") setType(v.type);
      if (v.method !== undefined) setMethod(v.method ?? null);
      if (v.发起 !== undefined) set发起(v.发起 ?? null);
      if (typeof v.occurredAt === "string") setOccurredAt(v.occurredAt);
      if (typeof v.content === "string") setContent(v.content);
    },
  });
  const 丢稿 = 稿.丢掉;
  useEffect(() => {
    if (!限时到) return;
    const 剩 = Date.parse(限时到) - (Date.now() + 钟差);
    const t = setTimeout(() => { set过时了(true); set交错(本人改过时提示); 丢稿(); }, Math.max(0, Math.min(剩 + 200, 2 ** 31 - 1)));
    return () => clearTimeout(t);
  }, [限时到, 钟差, 丢稿]);
  const 差 = 过时了 ? 本人改过时提示 : !content.trim() ? "请填写这次沟通的内容" : 主体们 && f.initiator && !发起 ? "请选发起主体"
    : 动了下一步 && !下一步文字.trim() ? "请写下一步计划" : 动了下一步 && 要下一步 && !下一步时间 ? "请填下一步时间" : "";
  /*
    设计语言 E1（D03，同 D4 新建沟通框）：「保存」一直能点（限时到点了除外）；点了还缺的在各自格子下面报红、焦点跳到第一处，
    每格带标签、* 在前（原来保存灰着、原因是底下一行灰字）
  */
  const [试过, set试过] = useState(false);
  const 错们: [格: string, 话: string | null][] = [
    ["发起主体", 主体们 && f.initiator && !发起 ? "请选发起主体" : null],
    ["沟通内容", !content.trim() ? "请填写这次沟通的内容" : null],
    ["下一步计划", 动了下一步 && !下一步文字.trim() ? "请写下一步计划" : null],
    ["下一步时间", 动了下一步 && 要下一步 && !下一步时间 ? "请填下一步时间" : null],
  ];
  const 格错 = (格: string) => (试过 ? 错们.find(([k]) => k === 格)?.[1] ?? null : null);
  const 错行 = (格: string) => 格错(格) && <div className="fm-err" role="alert">{格错(格)}</div>;
  const 交 = async () => {
    if (!过时了 && 错们.some(([, 话]) => 话)) {
      set试过(true);
      const 第一处 = 错们.find(([, 话]) => 话)![0];
      window.setTimeout(() => document.querySelector<HTMLElement>(`.follow-edit-modal [data-fk="${第一处}"] :is(textarea, input:not([type=hidden]), [tabindex="0"])`)?.focus(), 0);
      return;
    }
    set交中(true);
    const ok = await 跑(() => 改项目沟通(projectId, f.id, { type, method: 对得上的方式(type, method), initiator: 发起, content, occurredAt: occurredAt === 原时间 ? f.occurredAt : occurredAt, 版本: f.版本, ...(动了下一步 ? { 下一步: 下一步文字, 下一步时间 } : {}) }), "已保存修改", { 报错: (话) => set交错(话 === 刷新再提交话 ? `${话}（改的字刷新后还在）` : 话) });
    set交中(false);
    if (ok) {
      稿.存好了();
      onClose();
    }
  };
  return (
    <Modal open title="修改这条沟通" okText="保存" mask={{ closable: false }} className="follow-edit-modal" okButtonProps={{ disabled: 过时了, loading: 交中, title: (过时了 && 差) || undefined }} onCancel={() => { 稿.丢掉(); onClose(); }} onOk={() => void 交()}>
      {稿.提示}
      <div style={{ display: "grid", gap: 12 }}>
        <div className="follow-pick-row">
          <div data-fk="沟通方式">
            <格标签 名="沟通方式" 必填 />
            <FollowMethodSelect aria-label="沟通方式" style={满宽} type={type} method={method} 类型们={类型们} onChange={(v) => { setType(v.type); setMethod(v.method); }} />
          </div>
          {主体们 && (
            <div data-fk="发起主体">
              <格标签 名="发起主体" 必填={!!f.initiator} />
              <InitiatorSelect 们={主体们} style={满宽} status={格错("发起主体") ? "error" : undefined} value={发起} onChange={set发起} />
              {错行("发起主体")}
            </div>
          )}
        </div>
        <div>
          <格标签 名="沟通时间" />
          <DatePicker
            aria-label="沟通时间"
            showTime={{ format: "HH:mm" }}
            format={沟通时间格式}
            allowClear={false}
            style={{ width: "100%" }}
            value={dayjs(occurredAt, 沟通时间格式)}
            disabledDate={(x) => x.isAfter(dayjs(), "day")}
            onChange={(v) => v && setOccurredAt(v.format(沟通时间格式))}
          />
        </div>
        <div data-fk="沟通内容">
          <格标签 名="沟通内容" 必填 />
          <Input.TextArea aria-label="沟通内容" rows={4} status={格错("沟通内容") ? "error" : undefined} value={content} onChange={(e) => setContent(e.target.value)} placeholder="这次聊了什么" />
          {错行("沟通内容")}
          {/* 无意义沟通（F-052）：内容改了才说（服务端也只在内容改了时拦） */}
          {!格错("沟通内容") && content.trim() !== f.content.trim() && <FollowMeaningLine 内容={content} 类型={type} 判定={判定} />}
        </div>
        {改下一步 && (<>
          <div data-fk="下一步计划">
            <格标签 名="下一步计划" 必填 />
            <Input aria-label="下一步计划" status={格错("下一步计划") ? "error" : undefined} value={下一步文字} onChange={(e) => set下一步文字(e.target.value)} maxLength={下一步文字上限} showCount placeholder="比如：周五前发报价单给对方采购" />
            {错行("下一步计划")}
          </div>
          <div data-fk="下一步时间">
            <格标签 名="下一步时间" 必填={要下一步} />
            <DatePicker aria-label="下一步时间" className="proj-fu-full" status={格错("下一步时间") ? "error" : undefined} value={下一步时间 ? dayjs(下一步时间) : null} disabledDate={(x) => x.isBefore(dayjs(), "day")} onChange={(v) => set下一步时间(v ? v.format("YYYY-MM-DD") : null)} />
            {错行("下一步时间")}
            <div className="fm-help">{要下一步 ? "" : "可不填；"}改了会同步到项目上的下一步</div>
          </div>
        </>)}
        <框里原因 话={交错} />
      </div>
    </Modal>
  );
}

/**
 * 在项目上记一条沟通：方式、时间、内容，加下一步做什么（必填一句话，10-29）和下一步时间（开了超时回收、线索 / 商机阶段必填，别的时候可空）。
 * 记了会挂在客户上（客户页也看得到）和项目当时的节点上；下一步时间只提醒、不改回收日（11-18），回收日只按节点天数从这条沟通起算
 *
 * F-跟进-06：主区只摆 沟通方式、发起主体（11-01 答复 #2 挪出来、必填）、沟通内容、（卡点）、下一步、下一步时间；沟通时间、项目阶段、AI 预填收进默认折叠的「更多」，
 * 字段和校验一个不少。11-05 客户确认去掉「客户明确回复了吗」（线索验证改看必填项）。
 * F-跟进-08：沟通内容和下一步之间一块卡点（类型 / 影响 / 阻碍原因）；类型「暂无卡点」= 不生成（11-01 答复 #5），选了别的类型阻碍原因必填（11-19），记下后照发卡点那一套生成一个。
 * F-跟进-07（企业版）：可先挑截图、录音，记下之后挂到这条沟通上
 */
/** 记一条沟通弹窗顶上的「手动录入 | AI 录入」，记在这台浏览器上（存不了就每次手动） */
type 录入模式 = "手动" | "AI";
const 录入模式键 = "daedalus.follow.mode";
function 读录入模式(): 录入模式 {
  try { return localStorage.getItem(录入模式键) === "AI" ? "AI" : "手动"; } catch { return "手动"; }
}
function 存录入模式(v: 录入模式) {
  try { if (v === "AI") localStorage.setItem(录入模式键, "AI"); else localStorage.removeItem(录入模式键); } catch { /* 无痕、禁用：只这一次 */ }
}

function RecordFollowModal({ p, 外贸, 卡点默认, 卡点原因们 = [], onClose, 跑, 回执, 回处 }: {
  p: 项目详情;
  外贸: boolean;
  /** 能发卡点才给（企业版）；null = 不摆卡点那一块 */
  卡点默认?: 卡点默认 | null;
  /** 阻碍原因下拉（设置里启用的）；也能现打新的，发出去进待审核 */
  卡点原因们?: string[];
  onClose: () => void;
  跑: 跑法;
  /** 记完框就关：回执（短沟通、卡点生成 / 没生成、附件没传上）写在详情正文底部的就地小条 */
  回执: 就地回执;
  /** AI 任务列表里点这条回哪：嵌在客户页时就是这一页（客户页 + ?project，跳转优化 PR-A：不经过 /projects/<id> 再跳）；不给 = /projects/<id> */
  回处?: string;
}) {
  const 能选类型 = 跟进类型们(外贸).filter((t) => t.value !== "TASK" && t.value !== "REMIND");
  /** D4 · M7-b：「保存」一直能点、格子下报红 */
  const [type, setType] = useState<string>(能选类型[0]?.value ?? "PHONE");
  const [method, setMethod] = useState<string | null>(null);
  const 判定 = useFollowJudge();
  // 11-01 客户答复 #2：沟通方式默认「微信沟通」、发起主体默认「我方发起」，都必填；字典里停用了就不默认、让人选
  const 方式们 = useFollowMethods();
  const 主体们 = useFollowInitiators();
  const 人改过方式 = useRef(false);
  const [选的发起, set发起] = useState<string | null>(null);
  const 发起 = 选的发起 ?? (主体们?.includes(默认发起主体) ? 默认发起主体 : null);
  /*
    11-17 客户答复「建议记录个人使用习惯」：先按这个人最近 20 条沟通里用得最多的方式（lib/follow-habit.ts）；没有记录才照上面的默认。
    人改过 / 带回了草稿（草稿里有方式）就不动。等习惯问回来再定，免得先闪一下微信再跳
  */
  const 习惯 = useFollowHabit();
  useEffect(() => {
    if (人改过方式.current || 习惯 === undefined) return;
    const 能用习惯 = 习惯 && (方式们 ? !!习惯.method && 方式们.includes(习惯.method) : 能选类型.some((t) => t.value === 习惯.type));
    if (习惯 && 能用习惯) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 习惯是问服务端回来的，回来了才定默认；人改过 / 带回了草稿就不动
      setType(习惯.type);
      setMethod(习惯.method);
      return;
    }
    if (!方式们?.includes(默认沟通方式)) return;
    setType(方式对类型(默认沟通方式));
    setMethod(默认沟通方式);
    // 能选类型 每次渲染新算，内容只跟 外贸 走
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [方式们, 习惯]);
  const [occurredAt, setOccurredAt] = useState(() => dayjs().format(沟通时间格式));
  const [content, setContent] = useState("");
  const [下一步文字, set下一步文字] = useState("");
  // P-界面-34（原型 dt.follow）：下一步时间默认 3 天后，可改可清；和客户页记沟通、建档向导同一个默认
  const [下一步时间, set下一步时间] = useState<string | null>(() => dayjs().add(3, "day").format("YYYY-MM-DD"));
  const [交中, set交中] = useState(false);
  /** 没记上的原因：写在「记下」上面、框不关 */
  const [交错, set交错] = useState<string | null>(null);
  const [更多开, set更多开] = useState(false);
  const [卡点类型, set卡点类型] = useState<string>("暂无卡点");
  const [卡点影响, set卡点影响] = useState<string | null>(null);
  // 11-19：卡点只留类型、影响、阻碍原因（选了类型必填）；标题、卡在哪儿去掉
  const [卡点原因, set卡点原因] = useState<string[]>([]);
  const [附件们, set附件们] = useState<File[]>([]);
  const router = useRouter();
  // ---- AI 录入（10-29 P6）：粘原话 → 复用客户页「跟进速记」那条解析（parseFollowUpDraft，同一个模型、同一份额度）→ 只往格子里预填，
  // 人核对后点「记下」才写库；解析本身不写任何业务表。企业版、配了模型、看得到客户才给
  const 给AI = !!(p.企业版 && p.aiEnabled && p.customer);
  const AI已用完 = useAiOutOfCredits();
  /** AI 那一段灰着的原因（有权限但这会儿用不了）；没权限（给AI = false）整个切换都不摆 */
  const AI灰 = AI已用完 ? "AI 次数已用完，可刷新余额或在设置填自己的模型 Key" : undefined;
  // 11-12 用户：弹窗顶上「手动录入 | AI 录入」，默认手动、记住上次选的；切来切去格子里写的都留着（同一个表单、同一份状态）
  const [选的模式, set选的模式] = useState<录入模式>(读录入模式);
  const 模式: 录入模式 = 给AI && !AI灰 ? 选的模式 : "手动";
  const 换模式 = (v: 录入模式) => { set选的模式(v); 存录入模式(v); };
  const [原话, set原话] = useState("");
  const [解析, set解析] = useState<{ 起: number; 结果?: string; 出错?: string } | null>(null);
  const 解析中 = Boolean(解析 && !解析.结果 && !解析.出错);
  const 任务键 = `project-followup-parse:${p.id}`;
  /** 解析途中弹窗关了 / 又点了一次：旧的那轮回来不许再往格子里填 */
  const 这一次 = useRef(0);
  const 关 = () => {
    这一次.current++;
    clearJob(任务键);
    onClose();
  };
  const AI解析 = async () => {
    if (!p.customer || AI已用完) return;
    if (原话.trim().length < 5) {
      set解析({ 起: Date.now(), 出错: "先把沟通过程随手写几句" });
      return;
    }
    const 轮 = ++这一次.current;
    const 起 = Date.now();
    set解析({ 起 });
    const 请求 = parseFollowUpDraft({ customerId: p.customer.id, text: 原话 });
    runJob<null>(任务键, () => 请求.then((r) => (r.ok ? { ok: true as const, value: null } : { ok: false as const, error: r.error })), undefined, { 名: "解析项目沟通", 去: 回处 ?? `/projects/${p.id}` });
    let r: Awaited<typeof 请求>;
    try {
      r = await 请求;
    } catch (e) {
      r = { ok: false, error: 出错原话(e, "解析失败，请重试") };
    }
    if (轮 !== 这一次.current) return;
    if (!r.ok) {
      set解析({ 起, 出错: r.error });
      return;
    }
    const 填 = 项目沟通预填(r.draft, 能选类型.map((t) => t.value));
    // AI 认不出方式（回 OTHER）：留着现在的（个人习惯 / 默认），不改成「其他」
    if (填.type && 填.type !== "OTHER") { setType(填.type); setMethod(null); 人改过方式.current = true; }
    if (填.content) setContent(填.content);
    if (填.occurredAt) setOccurredAt(填.occurredAt);
    if (填.下一步) set下一步文字(填.下一步);
    if (填.下一步时间) set下一步时间(填.下一步时间);
    const 摘要 = [填.type && "方式", 填.occurredAt && "时间", 填.content && "内容", 填.下一步 && "下一步", 填.下一步时间 && "下一步时间"].filter(Boolean);
    set解析({ 起, 结果: 摘要.length ? `已预填：${摘要.join(" · ")}，核对无误再保存` : "没认出能填的，手动填吧" });
  };
  /*
    打了没交的留草稿（11-17，components/FormDraft.tsx）：刷新、发版后重开「记一条沟通」接着填；截图录音存不进来，带回时说要重选。
    记上了、点了取消就删
  */
  const 稿 = useFormDraft({
    键: `项目沟通:${p.id}`,
    值: { type, method, 发起: 选的发起, occurredAt, content, 下一步文字, 下一步时间, 卡点类型, 卡点影响, 卡点原因, 原话 },
    附件数: 附件们.length,
    // 只认打的字：沟通方式的默认值是晚一步才到的（字典读回来才设），光它变了不算填过
    算填过: (改) => 有字([改.content, 改.下一步文字, 改.卡点类型 === "暂无卡点" ? [] : 改.卡点原因, 改.原话]),
    带回: (v) => {
      if (typeof v.type === "string") { setType(v.type); 人改过方式.current = true; }
      if (v.method !== undefined) setMethod(v.method ?? null);
      if (v.发起 !== undefined) set发起(v.发起 ?? null);
      if (typeof v.occurredAt === "string") setOccurredAt(v.occurredAt);
      if (typeof v.content === "string") setContent(v.content);
      if (typeof v.下一步文字 === "string") set下一步文字(v.下一步文字);
      if (v.下一步时间 !== undefined) set下一步时间(v.下一步时间 ?? null);
      if (typeof v.卡点类型 === "string") set卡点类型(v.卡点类型);
      if (v.卡点影响 !== undefined) set卡点影响(v.卡点影响 ?? null);
      if (Array.isArray(v.卡点原因)) set卡点原因(清原因们(v.卡点原因));
      if (typeof v.原话 === "string") set原话(v.原话);
    },
  });
  /*
    设计语言 D4 · M7-b（D03）：「保存」一直能点；点了还缺的在各自格子下面报红、焦点跳到第一处（原来「记下」灰着、原因是右下一行小灰字）。
    顺序 = 框里从上到下；填上了红字当场消失
  */
  const 错们: [格: string, 话: string | null][] = [
    ["发起主体", 主体们 && !发起 ? "请选发起主体" : null],
    ["沟通内容", !content.trim() ? "请填写这次沟通的内容" : null],
    ["卡点原因", 卡点默认 && 卡点类型 !== "暂无卡点" && !卡点原因.length ? 缺原因话 : null],
    ["下一步计划", !p.组员记沟通 && !下一步文字.trim() ? "请写下一步计划" : null],
    ["下一步时间", !p.组员记沟通 && p.要下一步 && !下一步时间 ? "请填下一步时间" : null],
  ];
  const 差 = 错们.find(([, 话]) => 话)?.[1] ?? "";
  const [试过, set试过] = useState(false);
  const 格错 = (格: string) => (试过 ? 错们.find(([k]) => k === 格)?.[1] ?? null : null);
  const 错行 = (格: string) => 格错(格) && <div className="fm-err" role="alert">{格错(格)}</div>;
  // 选了下一步时间就预演回收日（10-30 P0-2）：和服务端同一个算法，算不准（没底子）就不写
  const 预演 = 预演回收日(p.回收预演, dayjs(occurredAt, 沟通时间格式).format("YYYY-MM-DD"), 下一步时间);

  const 交 = async () => {
    if (差) {
      set试过(true);
      // 焦点跳到第一处没填好的格子（等红字画出来再找）
      const 第一处 = 错们.find(([, 话]) => 话)![0];
      window.setTimeout(() => document.querySelector<HTMLElement>(`.follow-modal [data-fk="${第一处}"] :is(textarea, input:not([type=hidden]), [tabindex="0"])`)?.focus(), 0);
      return;
    }
    set交中(true);
    const 回: { r: Awaited<ReturnType<typeof 记项目沟通Action>> | null } = { r: null };
    const 卡点 = 卡点默认 ? { type: 卡点类型, impact: 卡点影响, reasons: 卡点原因 } : undefined;
    // 没记上的原因写在框里、框不关（g.save，不弹顶部提示）
    // 发版后老页面交的（lib/stale-deploy.ts）：填的字一直在存草稿，刷新后点开接着填；截图录音存不进来，说一句
    const 报错 = (话: string | null) => set交错(话 === 刷新再提交话 ? `${话}（${附件们.length ? "填的字刷新后还在，截图 / 录音要重新选" : "填的内容刷新后还在"}）` : 话);
    const ok = await 跑(async () => (回.r = await 记项目沟通Action(p.id, { type, method: 对得上的方式(type, method), initiator: 发起, content, occurredAt, ...(p.组员记沟通 ? {} : { 下一步: 下一步文字, 下一步时间 }), ...(p.企业版 ? { 阶段: p.phase } : {}) }, 卡点)), undefined, { 报错 });
    const r = 回.r;
    if (ok && r?.ok) {
      稿.存好了();
      // 本人撤销沟通去掉了（P-沟通-01，11-09），回执里不摆「撤销」。框关了，回执合成一句写在详情底部（一条盖一条，所以合起来说）：
      // 客户三态（C12）这条不算有效沟通时换成一句轻提示（照常保存，不拦）；卡点生成 / 没生成；附件没传上的（出错，role=alert）
      const 短 = 短沟通话of(r);
      const 话们: string[] = [短 ?? "已记下这条沟通"];
      let 调: "success" | "warning" | "error" = 短 ? "warning" : "success";
      if ("卡点" in r && r.卡点) 话们.push(`已生成卡点 ${r.卡点}`);
      if ("卡点没发" in r && r.卡点没发) { 话们.push(`卡点没生成：${r.卡点没发}`); 调 = "warning"; }
      if (附件们.length && r.followUpId) {
        const 错 = await 传沟通附件(r.followUpId, 附件们);
        if (错.length) { 话们.push(...错); 调 = "error"; }
        router.refresh();
      }
      /*
        这条沟通顺带按必填把节点推了一格（画像等早就齐了、这次记沟通才推，#370）：不悄悄推，说推到哪（11-20）。
        P-界面-40「推进节点可撤销」：同阶段内（自动推本来就不跨阶段）、我能改节点 → 底部撤销条，撤销 = 改回记之前那个节点（同「完成节点」的撤销）；
        撤不了的写进回执。沟通本身不撤（P-沟通-01）
      */
      /*
        撤销回到服务端回的推之前那一格（推前），不按页面上可能过时的那份；带「期望现在在哪」= 刚推到的那一格，推完又被人改过就不撤；
        推进清掉的下一步（这次没写下一步时清的是旧的）一起带回。没回推前（老服务端）：按页面那份回，话里写明下一步要重写（11-20 审查）
      */
      const 推话 = 自动推进话of(r);
      const 推前 = "推前" in r && r.推前 ? r.推前 : null;
      const 回到: 位置 = 推前 ? { phase: 推前.phase, node: 推前.node, result: null } : { phase: p.phase, node: p.node, result: p.result ?? null };
      const 推到 = "自动推到" in r && r.自动推到?.length ? r.自动推到[r.自动推到.length - 1] : null;
      const 期望在: 位置 | null = 推到 ? { phase: 回到.phase, node: 推到, result: null } : null;
      const 能撤 = !!推话 && !!期望在 && p.能改节点 && !p.pooled && !p.result;
      if (推话 && !能撤) 话们.push(推话);
      回执[调](话们.join("；"));
      if (推话 && 能撤 && 期望在) {
        showUndo({
          话: 推前 ? 推话 : `${推话}（撤销后下一步要重写）`,
          撤销: async () => {
            const u = await 改项目节点(p.id, 回到, null, { 期望在, ...(推前 ? { 下一步: { 文字: 推前.下一步文字, 时间: 推前.下一步时间 } } : {}) });
            router.refresh();
            return u;
          },
        });
      }
    }
    set交中(false);
    if (ok) 关();
  };

  return (
    <Modal
      open
      // 设计语言 D4 · M7-b（D14）：标题和卡头同一个词「新建沟通」，提交键「保存」（原「记一条沟通」「记下」）
      title="新建沟通"
      okText="保存"
      rootClassName="follow-modal"
      okButtonProps={{ loading: 交中 }}
      footer={(按钮) => (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          {交错 && <span className="pd-modal-err pd-modal-err-inline" role="alert">{交错}</span>}
          <span>{按钮}</span>
        </div>
      )}
      // 写了字就别让点到框外把草稿关掉（10-29 实点：点日历时手一偏，整段没了）
      mask={{ closable: !content.trim() && !下一步文字.trim() && !原话.trim() && (卡点类型 === "暂无卡点" || !卡点原因.length) && !附件们.length }}
      // 点了取消 / Esc / X：人明说不要了，草稿一起删
      onCancel={() => { 稿.丢掉(); 关(); }}
      onOk={() => void 交()}
    >
      {稿.提示}
      <div style={{ display: "grid", gap: 12 }}>
        {给AI && (
          <div className="follow-mode">
            <Segmented<录入模式>
              aria-label="录入方式"
              value={模式}
              onChange={换模式}
              // 解析途中不许切走：回来的结果要往格子里填，得让人看得见是 AI 填的
              disabled={解析中}
              options={[
                { value: "手动", label: "手动录入" },
                { value: "AI", disabled: !!AI灰, label: AI灰 ? <Tooltip title={AI灰}><span>AI 录入</span></Tooltip> : "AI 录入" },
              ]}
            />
            {AI灰 && <span className="follow-mode-why">{AI灰}</span>}
          </div>
        )}
        {模式 === "AI" && (
          <div className="follow-ai">
            <Input.TextArea
              aria-label="沟通原话"
              autoFocus
              value={原话}
              onChange={(e) => set原话(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 6 }}
              maxLength={5000}
              placeholder="把这次沟通随手倒出来，或粘贴聊天记录、语音转的文字，AI 帮你预填沟通内容、下一步等格子"
            />
            <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {解析 ? <AiWait 在做="从这段话里认出沟通方式、内容和下一步时间" 起={解析.起} 结果={解析.结果} 出错={解析.出错} />
                  : <span style={{ color: "var(--text-muted)", fontSize: "var(--dt-aux, 12px)" }}>只是预填下面的格子，核对无误再保存</span>}
              </div>
              <Button size="small" type="primary" ghost icon={<ThunderboltOutlined />} disabled={解析中 || AI已用完} onClick={() => void AI解析()}>
                {解析?.结果 ? "重新解析" : "AI 解析填表"}
                <AiCost />
              </Button>
            </div>
            <AiRemaining />
          </div>
        )}
        {/* 11-01 客户答复 #2：沟通方式、发起主体都必填，摆在表面不收进「更多」 */}
        <div className="follow-pick-row">
          <div data-fk="沟通方式">
            <格标签 名="沟通方式" 必填 />
            <FollowMethodSelect aria-label="沟通方式" style={{ width: "100%" }} type={type} method={method} 类型们={能选类型} onChange={(v) => { setType(v.type); setMethod(v.method); 人改过方式.current = true; }} />
          </div>
          {主体们 && (
            <div data-fk="发起主体">
              <格标签 名="发起主体" 必填 />
              <InitiatorSelect 们={主体们} style={{ width: "100%" }} status={格错("发起主体") ? "error" : undefined} value={发起} onChange={set发起} />
              {错行("发起主体")}
            </div>
          )}
        </div>
        <div data-fk="沟通内容">
          <格标签 名="沟通内容" 必填 />
          <Input.TextArea aria-label="沟通内容" rows={4} status={格错("沟通内容") ? "error" : undefined} value={content} onChange={(e) => setContent(e.target.value)} placeholder="这次聊了什么" />
          {错行("沟通内容")}
          {/* 无意义沟通（F-052）：边写边说一行，判为无意义的服务端不存 */}
          {!格错("沟通内容") && <FollowMeaningLine 内容={content} 类型={type} 判定={判定} />}
        </div>
        {卡点默认 && (
          <div className="follow-blocker" data-fk="卡点原因">
            <格标签 名="卡点" />
            {/* 11-19：「暂无卡点」只摆类型一格，不带出影响、原因；选了类型才出影响（默认值照旧）和阻碍原因（必填，能直接打字新增） */}
            <div className="follow-blocker-row">
              <Select aria-label="卡点类型" value={卡点类型} onChange={(v: string) => { set卡点类型(v); if (v === "暂无卡点") { set卡点原因([]); set卡点影响(null); } }} options={卡点类型们.map((v) => ({ value: v, label: v }))} />
              {卡点类型 !== "暂无卡点" && <Select aria-label="卡点影响" allowClear value={卡点影响} onChange={(v) => set卡点影响(v ?? null)} placeholder={`卡点影响（默认${卡点默认.默认影响}）`} options={影响等级们.map((v) => ({ value: v, label: v }))} />}
            </div>
            {卡点类型 !== "暂无卡点" && <div style={{ marginTop: 8 }}><原因选择 原因们={卡点原因们} 值={卡点原因} on改={set卡点原因} 错={!!格错("卡点原因")} /></div>}
            {错行("卡点原因")}
            {/* 括号里的说明挪到格子下面（M7-b · D03） */}
            <div className="fm-help">选「暂无卡点」不生成；选了其他类型，保存时生成一个卡点</div>
          </div>
        )}
        {!p.组员记沟通 && (<>
        <div data-fk="下一步计划">
          <格标签 名="下一步计划" 必填 />
          <Input
            aria-label="下一步计划"
            status={格错("下一步计划") ? "error" : undefined}
            value={下一步文字}
            onChange={(e) => set下一步文字(e.target.value)}
            maxLength={下一步文字上限}
            showCount
            placeholder="比如：周五前发报价单给对方采购"
          />
          {错行("下一步计划")}
        </div>
        <div data-fk="下一步时间">
          <格标签 名="下一步时间" 必填={p.要下一步} />
          <DatePicker
            aria-label="下一步时间"
            status={格错("下一步时间") ? "error" : undefined}
            style={{ width: "100%" }}
            value={下一步时间 ? dayjs(下一步时间) : null}
            disabledDate={(x) => x.isBefore(dayjs(), "day")}
            onChange={(v) => set下一步时间(v ? v.format("YYYY-MM-DD") : null)}
          />
          <Space size={4} wrap style={{ marginTop: 6 }}>
            {([["明天", 1], ["3 天后", 3], ["1 周后", 7]] as const).map(([名, 天]) => {
              const 日 = dayjs().add(天, "day").format("YYYY-MM-DD");
              return <Button key={名} size="small" type={下一步时间 === 日 ? "primary" : "default"} ghost={下一步时间 === 日} aria-pressed={下一步时间 === 日} onClick={() => set下一步时间(日)}>{名}</Button>;
            })}
          </Space>
          {错行("下一步时间")}
          {!p.要下一步 && <div className="fm-help">可不填</div>}
          {预演 ? (
            <div style={{ marginTop: 4, fontSize: "var(--dt-aux, 12px)", color: 回公海颜色[回公海文案(预演).级别] ?? "var(--text-muted)" }}>记完这条 → 回收日变为 {dayjs(预演).format("MM-DD")}</div>
          ) : p.要下一步 && <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: "var(--dt-aux, 12px)" }}>到那天还没人跟进，项目会自动回到线索公海</div>}
        </div>
        </>)}
        {p.企业版 && (
          <div>
            <格标签 名="截图 / 录音" />
            <选沟通附件框 文件们={附件们} on改={set附件们} />
            <div className="fm-help">可不传，保存后挂在这条沟通上；也可以直接粘贴截图</div>
          </div>
        )}
        <div>
          <Button type="link" size="small" style={{ paddingInline: 0 }} icon={<DownOutlined rotate={更多开 ? 180 : 0} />} aria-expanded={更多开} onClick={() => set更多开((v) => !v)}>
            更多{p.企业版 ? "：沟通时间、项目阶段" : "：沟通时间"}
          </Button>
        </div>
        {更多开 && (
          <div className="follow-more">
            <div>
              <格标签 名="沟通时间" />
              <DatePicker
                aria-label="沟通时间"
                showTime={{ format: "HH:mm" }}
                format={沟通时间格式}
                allowClear={false}
                style={{ width: "100%" }}
                value={dayjs(occurredAt, 沟通时间格式)}
                disabledDate={(x) => x.isAfter(dayjs(), "day")}
                onChange={(v) => v && setOccurredAt(v.format(沟通时间格式))}
              />
            </div>
            {p.企业版 && (
              <div>
                <格标签 名="项目阶段" />
                <Select aria-label="项目阶段" style={{ width: "100%" }} value={p.phase} disabled options={[{ value: p.phase, label: p.phase }]} />
                <div className="fm-help">记在项目现在的阶段上</div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * 删沟通的确认条（原型 dt.talkdel，P-界面-40 就地确认）：长在这一条下面，写清进回收站、谁能恢复——
 * 删的人自己多半恢复不了（只有系统管理员和回收站副手能恢复），原来那句「30 天内可恢复」对他不成立。
 * 打开焦点落在「确认删除」上，Esc = 取消；删的时候键转圈、不收第二下
 */
/**
 * 设计语言 D4 · M7-c（P-界面-40）：原地确认 3 秒没动就自己收起；删的时候不收。
 * 停表：鼠标停在条上（移开重新数 3 秒）；键盘焦点在条里（Tab / 回车从 ⋮ 菜单进来，autoFocus 落在「确认删除」上——
 * 读屏、键盘用户要多久就给多久，WCAG 2.2.1；PR #402 审查）。触屏点一下不算悬停，不重新计时。
 * 鼠标点开时 autoFocus 那一下不算键盘焦点（:focus-visible 不中），照样 3 秒收起
 */
function useAutoCollapse(条: React.RefObject<HTMLDivElement | null>, 取消: () => void, 忙: boolean) {
  const [悬停, set悬停] = useState(false);
  const [键盘在里, set键盘在里] = useState(false);
  const 取消们 = useRef(取消);
  useEffect(() => { 取消们.current = 取消; }, [取消]);
  useEffect(() => {
    if (忙 || 悬停 || 键盘在里) return;
    const t = window.setTimeout(() => 取消们.current(), 3000);
    return () => window.clearTimeout(t);
  }, [忙, 悬停, 键盘在里]);
  return {
    onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType === "mouse") set悬停(true); },
    onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType === "mouse") set悬停(false); },
    onFocus: (e: React.FocusEvent) => { if ((e.target as HTMLElement).matches(":focus-visible")) set键盘在里(true); },
    onBlur: (e: React.FocusEvent) => { if (!条.current?.contains(e.relatedTarget as Node | null)) set键盘在里(false); },
  };
}

// 名字要英文开头：hooks 规则只认大写开头的组件（下面 删沟通条 = 它）
function FollowDeleteBand({ 忙, 取消, 删 }: { 忙: boolean; 取消: () => void; 删: () => void }) {
  /**
   * 弹出来焦点先落在「取消」（#402 复审）：多按一下回车只会收起，不会误删；要删得再 Tab 到「确认删除」。
   * 收起（取消、Esc、到点自己收）后焦点还给这一条的 ⋮，不掉到 body（焦点原来在条里或已经掉了才还，不抢别处的）
   */
  const 条 = useRef<HTMLDivElement>(null);
  const 收 = () => {
    const 行 = 条.current?.closest(".proj-follow-row");
    const a = document.activeElement;
    const 要还 = !a || a === document.body || !!条.current?.contains(a);
    取消();
    if (要还) window.setTimeout(() => 行?.querySelector<HTMLElement>('[aria-label="这条沟通的更多操作"]')?.focus(), 0);
  };
  // 3 秒自己收起（D4 · M7-c）
  const 停住 = useAutoCollapse(条, 收, 忙);
  return (
    <div
      ref={条}
      className="pd-del-band"
      role="group"
      aria-label="确认删除这条沟通"
      {...停住}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); 收(); } }}
    >
      <span className="pd-del-band-t">删了进回收站 30 天，系统管理员或回收站副手能恢复</span>
      <span className="pd-del-band-a">
        <Button size="small" autoFocus onClick={收} disabled={忙}>取消</Button>
        <Button size="small" type="primary" danger loading={忙} onClick={删}>确认删除</Button>
      </span>
    </div>
  );
}
const 删沟通条 = FollowDeleteBand;

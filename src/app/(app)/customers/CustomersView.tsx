"use client";

import LandingNote from "@/components/LandingNote";
import { 有值, 空显, 空值符 } from "@/lib/empty-value";
import CopyValue from "@/components/CopyValue";
import Heat from "@/components/Heat";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, useRef, type CSSProperties, type ReactNode } from "react";
import { 少动 } from "@/lib/reduced-motion";
import { useMotionTheme } from "@/components/MotionTheme";
import { 量变形起点, 放变形 } from "../projects/view-morph";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useNavGo } from "@/lib/nav-pending";
import { 要跟Context } from "@/components/FollowDue";
import { Button, Space, Dropdown, Tag, Segmented, Tooltip, type MenuProps, type SelectProps } from "antd";
import { 客户状态色of } from "@/lib/enterprise/cust-status-color";
import {
  CalendarOutlined,
  DownloadOutlined,
  UploadOutlined,
  UserSwitchOutlined,
  TagsOutlined,
  DeleteOutlined,
  MoreOutlined,
  InboxOutlined,
  UserAddOutlined,
  SwapOutlined,
  CheckOutlined,
} from "@ant-design/icons";
import { FOLLOW_STATUSES, DECISION_STATUSES } from "@/lib/constants";
import { 合计文字 } from "@/lib/currency";
import { smartTime, fmtDate, 成员选项, 成员选项带部门, 可选成员 } from "@/lib/utils";
import ListSearch from "@/components/ListSearch";
import { RowLink, FollowStatusTag, PageHead, UserCell, DecisionStatusTag } from "@/components/ui";
import DataList, { type 列 } from "@/components/DataList";
import type { CustomerRow } from "./CustomerForm";
import { 完整导出 } from "./export-client";
import { 签约各币 } from "./export-table";
import { assignSalesOwner, bulkFollowStatus, 撤销改负责人, type BulkResult } from "./actions";
import { useDeleteCustomers } from "./useDeleteCustomers";
import { useTransferConfirm } from "./useTransferConfirm";
import { usePoolReturnConfirm } from "./usePoolReturnConfirm";
import { 转走项目预览of } from "./actions";
import { showUndo } from "@/components/UndoBar";
import { 问后果, 预取弹框 } from "@/components/dialog-host";
import { 带走说法, 批量结果说法 } from "@/lib/carry-over";
import { useBusiness } from "@/lib/business-client";
import { statusLabel, 外贸精简, 签约叫 } from "@/lib/business-config";
import { WhatsApp网址, 官网网址, 官网短写, 客户等级, 客户等级说明, type 客户等级 as 等级 } from "@/lib/customer-extra";
import { 级别选项, 拼地址 } from "@/lib/enterprise/customer-v2";
import { 主渠道显示名, 渠道显示名 } from "@/lib/enterprise/channel-main-core";
import { 字典定义 } from "@/lib/enterprise/dict-kinds";
import LevelLetter from "@/components/LevelLetter";
import { useLocalPref } from "@/lib/local-pref";
import { useNarrow } from "@/lib/roster";
import LocalTime from "@/components/LocalTime";
import { 未分级, 久未跟进天数们 } from "./query-shared";
import IdleDaysFilter from "@/components/IdleDaysFilter";
import { useUrlFilters } from "@/lib/url-filters";
import { 客户范围名, 客户范围说明, type 客户范围 } from "@/lib/enterprise/customer-scope";
import { 列表不问归属 } from "@/lib/solo";
import { 公海标签, type 客户页签归属 } from "@/lib/pool";
import { 放进公海, 领取, 分配公海, 撤销公海, type 公海结果 } from "./pool-actions";
import { 原负责人不能领回提示 } from "@/lib/enterprise/pool-rules";
import ResetFilters from "@/components/ResetFilters";
import CreatedRangeFilter from "@/components/CreatedRangeFilter";
import PhoneFilter from "@/components/PhoneFilter";
import { useCustomFilters } from "@/components/CustomFilters";
import CurrencySelect from "@/components/CurrencySelect";
import { 释义下拉, type 客户字典释义 } from "@/components/DictNote";
import dynamic from "next/dynamic";
import type { 建档数据 } from "../projects/new/ProjectWizard";
import type { 批量客户预看, 批量客户自动分配行 } from "../leads/assign-actions";
import type { 自动结果 } from "./TransferDialog";
import { useViewAs } from "@/components/ViewAsContext";
import { 视图外部话 } from "@/lib/enterprise/view-as-words";
import { 归档档位们 } from "@/lib/enterprise/archive-tier";
import { 三态筛选值们, 三态标字, 三态标说明, 三态显示名, 进公海理由显示, type 三态标 } from "@/lib/enterprise/tri-state-label";
import { 字典of, 阶段们, 后售培育名, type 阶段, type 出口叫法改动 } from "@/lib/project/stage-dict";
import type { 客户项目概况 } from "@/lib/project/customer-list-projects";
import type { 仅项目列表行 } from "@/lib/enterprise/project-only-list-rows";
import ProjectOnlyBlock from "./ProjectOnlyBlock";
import { 换客户页看法, 市场视图名 } from "@/lib/customers-view-pref";
import NewMenuButton from "@/components/NewMenuButton";
import { 取客户页表单料, type 客户页表单料 } from "./form-data-action";
import { 看板工具位 } from "./board-slot";
import { 客户编号显示 } from "@/lib/customer-no";
import { 客户抬头, 客户显名, type 抬头节点格 } from "@/lib/enterprise/customer-title";
import { 出错原话 } from "@/lib/stale-deploy";
import { 切我分出去的去掉, 触点显示名, type 来源筛选组 } from "@/lib/enterprise/customer-source-filter";
import FilterSelect from "@/components/FilterSelect";

/** 「新增客户」弹窗（10-31 P5，整套建档向导）：点了才要，单拆一包，不压客户列表首屏 JS（速度闸门 850 KB） */
// 客户看板（U-客户-06）只在切到「看板」时用，连同分页条单独一块，别压在客户列表首屏（速度闸门）
const CustomerBoard = dynamic(() => import("./CustomerBoard"));
const 建档弹窗 = dynamic(() => import("../projects/new/ProjectWizard").then(m => m.建档弹窗), { ssr: false });
/** 页头「新建 ▾ → 新建项目」（11-12）：和项目页「新增项目」同一条路（先选新老客户），点了才加载、才挂上，不压客户列表首屏 JS */
/** 「新建 ▾ → 新建项目」那条路的懒加载块：展开菜单时先拿起来（预取），点下去等它到了再挂、按钮转圈 */
const 取新建项目流程 = () => import("../projects/NewProjectFlow");
const 新建项目流程 = dynamic(取新建项目流程, { ssr: false });
/*
  下面三块也是点了才用（速度闸门 11-15：改版后客户列表首屏 JS 870 KB、线 850）：
  客户表单（新建 / 编辑，连 Form、单选、自动补全、渠道级联）、导入抽屉（上传、步骤条、进度条）、批量转让框。
  不 SSR、第一次要开时才挂；表单随「表单料」一起取（展开「新建 ▾」、行菜单时预取），转让框和确认框在勾选时预取
*/
const 取客户表单 = () => import("./CustomerForm");
const CustomerForm = dynamic(取客户表单, { ssr: false });
const ImportDrawer = dynamic(() => import("./ImportDrawer"), { ssr: false });
const 取转让框 = () => import("./TransferDialog");
const TransferDialog = dynamic(取转让框, { ssr: false });
/** 勾了人、批量条一出来就去拿转让框和确认框的代码：点下去时多半已经到了 */
function PrefetchOnPick() {
  useEffect(() => {
    void 取转让框().catch(() => {});
    预取弹框();
  }, []);
  return null;
}

/**
 * 批量操作的结果文案。
 * 原本无论实际改了几条都提示「已变更」——选错页、行被别人删掉都看不出来。
 * 只有真改了才说改了几条；没改动和已消失的分开讲，否则人对不上自己勾了几条。
 */
/** 筛选下拉顶上一行：这一项筛的是什么（交互方案 P2，10-30）。每个值各自的含义在选项下面一行灰字（components/DictNote.tsx） */
function 下拉说明(话: string) {
  return <div className="muted" style={{ padding: "4px 12px 6px", fontSize: "var(--fs-note)", borderBottom: "1px solid var(--line)", marginBottom: 4 }}>{话}</div>;
}

type Option = { id: string; name: string };

type Props = {
  rows: CustomerRow[];
  total: number;
  page: number;
  requestedPage?: string;
  pageSize: number;
  金额排序?: string;
  /** 按客户等级排（2026-10-16）：level-asc / level-desc */
  等级排序?: string;
  /** 按创建时间排（11-11）：created-asc / created-desc；空 = 默认（新的在前） */
  创建排序?: string;
  /** 按最近跟进排（员工反馈 1I，11-16，企业版）：follow-asc = 最久没跟进的在前（从没跟进过的最前）/ follow-desc */
  跟进排序?: string;
  /** 摆不摆「手机号」筛选：电话藏着的人（字段权限 Y27）不摆，服务端也不认。不给 = 摆 */
  能按号码筛?: boolean;
  排序币种?: string;
  /** 部门：企业版按组织架构带上（负责人筛选同名的带部门，L-新6）；不是企业版不带 */
  users: (可选成员 & { 部门?: string | null })[];
  /** 老板（管理员）：公海里的客户能直接「分配给…」某位同事（2026-10-20）。业务员不摆 */
  能分配公海?: boolean;
  /** 企业版负责人转出自己的客户（11-02）：批量分配摆给他，选了别人的服务端 assignSalesOwner 拦 */
  能转出自己的?: boolean;
  /** 企业版只有老板和总管理员能导入导出（10-27 会议），别人不摆按钮；不是企业版一律 true */
  能导入导出?: boolean;
  /** 企业版普通销售新建客户负责人只能是自己（10-27 会议） */
  负责人只能自己?: boolean;
  /** 企业版没设业务角色、只读管理员（11-03 D3-7 ④）：「新建」「领取」都不摆，服务端另拦；不是企业版一律 true */
  能新建和领取?: boolean;
  /** 公海「分配给…」的下拉（11-03 B2-7）：只列能当负责人的，不是系统管理员再收到同业务线；没给 = 用 users */
  公海分给?: 可选成员[];
  /** 新建 / 编辑表单的渠道候选：只在进来就开表单（?new=1）时随首屏给，平时点开才取（form-data-action.ts，11-15） */
  channels?: Option[];
  /** 进来就把新建表单打开（首页空库那张「开始」卡的落点） */
  直接新建?: boolean;
  /** 企业版项目模式：「新建客户」弹建档向导框（U-新建-01）要的数据；null = 项目模式没开，走老的新建客户框 */
  建档?: 建档数据 | null;
  /** 企业版项目模式、首屏没带 建档（平时都不带，11-15）：「新建客户」点开时再取（form-data-action.ts）；false = 不走向导 */
  建档要取?: boolean;
  /** 企业版没开项目模式：我能处理、名下还有客户没交走的离职成员几位（11-03 B7-2），null 不摆；0 = 摆入口不带数 */
  待交接?: number | null;
  /** 进来就把导入抽屉开在「粘一段文本」那一栏。主线入口，见 dashboard/HomeChat.tsx */
  直接粘贴?: boolean;
  /**
   * 「数据」页那张「新增学员」卡点进来的：只看这个月建的。
   * 它不进筛选栏（筛选栏摆的是每天都在用的那几个），但**必须让人看见自己在看一个子集**——
   * 所以工具栏第一格是一枚带叉的标记，点叉就回到全部。
   */
  本月新增?: boolean;
  /** 渠道页「直接推荐」点进来时是哪个渠道的名字；null = 不是从那儿来的 */
  直接推荐?: string | null;
  /**
   * 从导入抽屉点「完成」过来的：只看刚导进来的这一批（审查 D10）。
   * 和「只看本月新增」一样是一枚带叉的标记，点叉回到全部
   */
  本批?: { 几位: number } | null;
  /**
   * 公海里一共几位（「公海」页签上的那个数）。null = 正在看一个子集（上面三种），不摆页签。
   * 2026-10-13：公海和自己的客户分两个页签摆，原来混在一张表里、只靠负责人下拉第一项「公海」切
   */
  公海数?: number | null;
  /** 不在公海里的一共几位（第一个页签上的数）。和 公海数 加起来 = 左栏「客户」角标 */
  客户数?: number | null;
  /** 第一个页签叫「我的 / 团队」客户：团队业务员、一个人用 = 我的；团队老板 = 团队（lib/pool.ts） */
  客户页签?: 客户页签归属;
  /** 「客户」页签搜不到时，同样的条件在公海里有几位（0 = 没有，不提） */
  公海里匹配?: number;
  /** 接上模型了没有。没接上时导入抽屉里「粘一段文本」那条路只说明原因，不给按钮 */
  aiEnabled?: boolean;
  /**
   * 库里还有人在用、但业务配置里已经删掉的职位（第 2 期 2b）。筛选下拉原来只列现在的选项，
   * 删掉一项后那些老客户还在、显示也对，就是筛不出来
   */
  旧职位?: string[];
  /** 库里用着的国家（外贸模版的国家筛选，2026-10-05） */
  国家们?: string[];
  filters: {
    keyword: string;
    grade: string;
    followStatus: string;
    decisionStatus: string;
    salesOwnerId: string;
    channelOwnerId: string;
    /**
     * 三种子集（数据页「本月新增」、渠道页「直接推荐」、导入「看这一批」）也放进条件里：
     * 原来只在地址栏上，一翻页、一搜索、一改筛选就丢了，第 2 页成了全库的第 2 页（2026-10-02 排查）
     */
    createdWithin: string;
    directOf: string;
    batch: string;
    /** 「1」= 「公海」页签；空 = 「客户」页签（不含公海）。子集里不分页签 */
    pool: string;
    /** 外贸档案的国家 / 来源（2026-10-05） */
    country: string;
    source: string;
    /** 客户等级（2026-10-16）：A–D 或「未分级」 */
    level: string;
    /** 团队版部门（1b，2026-10-23） */
    dept: string;
    /** 客户状态（企业版才有这一格） */
    custStatus?: string;
    /** 客户类型（企业版才有这一格，字典 custType，P13） */
    customerType?: string;
    /** 归档档位（企业版才有这一格，M-导入-23）：A1 / A2 / B / C / D / E */
    archiveTier?: string;
    /** 客户来源（企业版，11-06）：Customer.channelId */
    channelId?: string;
    /** 创建（入库）时间段（11-11）：YYYY-MM-DD，两头都算，北京日 */
    createdFrom?: string;
    createdTo?: string;
    /** 「手机号」筛选（11-11）：只比号码 */
    phone?: string;
    /** 「全部阶段」「全部进程」（企业版项目模式，11-12 第 3 批）：名下有一个我能看的项目在这个阶段 / 进程上；不给 = 不摆这两个筛选 */
    phase?: string;
    node?: string;
    /** 「全部回收状态」（客户三态开着才给，P-界面-19 ①）：沉睡 / 待回收 / 暂缓回收中 / 不计时；不给 = 不摆这个筛选 */
    triState?: string;
    /** 「超过 N 天没跟进」（员工反馈 1I，企业版才有这一格）：天数 */
    idleDays?: string;
    /** 「范围」（客户 11-18 第 12 题）：mine / joined / visible，服务端补过默认；不按范围筛时没有 */
    scope?: string;
  };
  /** 这一页每位客户的回收状态标（客户三态开着才给，活跃的不在里面）；不给 = 不摆「状态」一列 */
  三态标?: Record<string, 三态标>;
  /** 这一页每位客户的「项目数」「当前节点」（企业版项目模式，11-12 第 3 批；只算我能看的项目）。不给 = 不摆这两列 */
  项目概况?: Record<string, 客户项目概况>;
  /** 「最近跟进」后面那一句（员工反馈 2I，企业版）：客户 id → 最近跟进那一条的内容；没有 / 看不到那一条的不在里面，只摆时间 */
  最近一句?: Record<string, string>;
  /**
   * 抬头里的当前节点（企业版，11-17 客户抬头 PR-5，lib/enterprise/customer-title.ts 抬头节点们）：只有简称、全称、类型都空的客户才有，
   * 名下最近有动静的项目（含公海、不按看的人算）；不给 / 不在里面 = 没有这一段
   */
  抬头节点?: Record<string, 抬头节点格>;
  /**
   * 「仅项目」一小块（只负责项目的人，第 1 页、没筛别的才有，page.tsx 给）：和 rows 分开，不进 total、不能勾、没有行菜单。
   * 其他角色不给。看板（服务端的、本地的）都不摆
   */
  仅项目行?: 仅项目列表行[];
  /**
   * 企业版「待我复核」（审核 11-18 节点 P2-3，P-线索-02）：列表视图顶上摆，和项目列表、首页同一份；看板视图里项目列表自己带。
   * 页面（服务端）画好 <VerifyInbox> 递进来：这里不引它，免得客户列表连带引 projects/actions
   */
  待复核?: ReactNode;
  /** 「仅项目」超过上限（50 位）：块上写「前 50 位」，更多去看板 */
  仅项目超了?: boolean;
  /** 进程下拉里结局的叫法（组织规则里改过的出口叫法，同项目页） */
  出口叫法?: 出口叫法改动 | null;
  /** 企业版项目模式：「列表 / 看板」的看板是按节点分列的项目看板（11-12 第 3 批，换一屏由服务端画）；按客户属性分列的看板不摆 */
  项目看板?: boolean;
  /** 看板视图（C17 / C18）：服务端画好的项目看板（工具行 + 收件箱 + 按节点分列），换掉表格；页头和筛选行照列表 */
  看板体?: ReactNode;
  /** 市场成员、市场管理（X-107）：「列表 / 看板」叫「客户列表 / 我分出去的」，看板那一边是原项目页给他们的那套（服务端画） */
  市场视图?: boolean;
  /** 阶段 / 进程筛选命中的客户太多（服务端没点名、当一位都没中）：表格上面提示再加筛选条件 */
  阶段太多?: boolean;
  /**
   * 「范围」筛选（客户 11-18 第 12 题，lib/enterprise/customer-scope.ts）：我负责的 / 我参与的 / 我可见的（只给有管理范围的）。
   * 值 = 这次按哪一项筛（服务端补过默认），默认 = 这个人的默认（选它不算「筛了」），选项 = 能选哪几项。不给 = 不摆（团队版、项目模式关着、子集）
   */
  客户范围?: { 值: 客户范围; 默认: 客户范围; 选项: 客户范围[] };
  /** 客户来源筛选的选项（企业版）；含已停用的渠道 */
  /** 「客户来源」下拉：「未填」、渠道触点一组、渠道一组（lib/enterprise/customer-source-filter.ts 客户来源筛选项） */
  渠道筛选项?: 来源筛选组[];
  /** 团队有两个以上一级部门时的部门下拉（带缩进）；空 = 不摆 */
  部门选项?: { value: string; label: string }[];
  /** 能删客户：企业版有能删的角色（系统管理员；销售、销管、渠运删自己负责的，V3.5.1）；别的版本 true。false 时行菜单、批量工具条都不摆删除 */
  能删?: boolean;
  /** 企业版这一页里我删不了的（不是我负责的、在公海的；系统管理员一律空）：行菜单不摆删除，批量勾到了先说清 */
  删不了ids?: string[];
  /** 这一页里我放不回公海的（P-公海-05，同服务端 能放回客户公海：不是能转让这位的、已在公海的）：勾的里一位都放不了时批量条不摆「放回公海」；
   *  有放得了的照摆，放不了的服务端跳过、提示几位没放 */
  放不了ids?: string[];
  /** 公海里不是我这条业务线的（P-公海-07）：不摆「分配给…」 */
  公海别线ids?: string[];
  /** 企业版虚线下属的客户（这一页里的）：只能看——不摆编辑 / 删除、不让勾批量（10-25 实测 F4）。团队版一律空 */
  只读ids?: string[];
  /** 企业版这一页公海里原负责人是我的：领取按钮灰着、悬停说「原负责人不能领回」（lib/enterprise/pool-rules.ts）。别的版本一律空 */
  原负责人领不回ids?: string[];
  /** 企业版批量转给别人时可选的转让原因（字典「转让原因」）；选项空 = 不问（别的版本） */
  转让原因?: { 选项: string[]; 自己: string };
  /**
   * 批量转让框里的「指定分配 / 自动分配」（客户 11-17，同客户详情的单个转让框）：页面判了是市场成员（市场管理、渠道运营）、
   * 规则「线索分配」开着、自动分配他能用，才递这两个服务端动作进来；不递 = 框和原来一样。
   * 摆不摆还要看勾的里有没有「暂不分配」的客户：框打开时 预看 问一次，判定同单个那份（lib/enterprise/cust-auto-assign.ts）
   */
  自动分配预看?: (customerIds: string[]) => Promise<批量客户预看>;
  批量自动分配客户?: (customerIds: string[], 原因: string | null) => Promise<{ ok: true; 结果: 批量客户自动分配行[] } | { ok: false; error: string }>;
  /**
   * 企业版（10-28 去遗留）：跟进状态、决策状态、冷热、签约金额、院校·专业、推荐人、渠道归属、渠道负责人都不摆，
   * 换成「客户状态」一列一个筛选（字典 custStatus）。别的版本 false，列和筛选一格不变
   */
  企业版?: boolean;
  /** 企业版客户状态的可选项（字典 custStatus 启用中的）；别的版本空 */
  客户状态选项?: string[];
  /** 企业版客户状态 名字 → 标签颜色（cust-status-color.ts 客户状态色表）；没给按名字散 */
  客户状态色?: Record<string, string>;
  /** 企业版项目模式：客户状态按项目自动算（10-30），表单里只读 */
  客户状态自动?: boolean;
  /** 企业版分配方式的可选项（字典 custAssign 启用中的，定稿 P5 第 30 条）；别的版本空 */
  分配方式选项?: string[];
  /** 企业版客户类型的可选项（字典 custType 启用中的，2026-10-29 P13 第 4 条）；别的版本空 */
  客户类型选项?: string[];
  /** 企业版客户属性的可选项（字典 custAttr 启用中的，A-17）；别的版本空 */
  客户属性选项?: string[];
  /** 企业版客户属性整份字典（含停用，按字典顺序）：看板分列、旧值排位置用（U-客户-06）；别的版本空 = 不摆看板 */
  客户属性字典?: { name: string; active: boolean }[];
  /** 企业版客户状态、客户类型每项的释义（名字 → 一行灰字，10-30）；别的版本不给 */
  字典释义?: 客户字典释义;
};

/**
 * 学员列表——全站列表页的母版（批 2）。
 *
 * 表格、筛选栏的收放、分页、列设置、批量工具条都在 `components/DataList.tsx` 里，
 * 这一页只写四样：列、筛选、空状态的第一步、主动作。线索 / 渠道 / 联系人 /
 * 商机 / 跟进照抄这四样就行（批 3）。
 *
 * 默认只摆六列：学员、院校·专业、跟进状态、预计签约、负责人、最近跟进。
 * 原来十四列全摆出来，1440 屏上要横着拖两屏才看得完，而每天真正要扫的就这六样；
 * 其余的收进「列」里，勾了记在这台机器上。
 */

/** 只用来认「水合完了没有」（见 已水合） */
const 无订阅 = () => () => {};

export default function CustomersView({
  rows, total, page, requestedPage, pageSize, users, 能分配公海 = false, 能转出自己的 = false, 能导入导出 = true, 能删 = true, 负责人只能自己 = false, 能新建和领取 = true, 公海分给, channels, 渠道筛选项 = [], filters, 直接新建, 直接粘贴, 本月新增, 直接推荐 = null, 本批, 公海数 = null, 客户数 = null, 客户页签 = "我的", 公海里匹配 = 0, aiEnabled, 旧职位 = [], 国家们 = [], 部门选项 = [], 只读ids = [], 删不了ids = [], 放不了ids = [], 公海别线ids = [], 原负责人领不回ids = [], 转让原因, 自动分配预看, 批量自动分配客户, 金额排序 = "", 等级排序 = "", 创建排序 = "", 跟进排序 = "", 能按号码筛 = true, 排序币种, 企业版: 企业 = false, 客户状态选项 = [], 客户状态色, 客户状态自动 = false, 分配方式选项 = [], 客户类型选项 = [], 客户属性选项 = [], 客户属性字典 = [], 字典释义, 建档 = null, 建档要取 = false, 待交接 = null, 项目概况, 最近一句, 抬头节点, 仅项目行 = [], 仅项目超了 = false, 待复核, 三态标, 出口叫法, 项目看板 = false, 看板体, 市场视图 = false, 阶段太多 = false, 客户范围,
}: Props) {
  const router = useRouter();
  const 要跟 = useContext(要跟Context);
  const 要跟数 = 要跟.逾期 + 要跟.今天;
  /** 看板卡进详情：等新页时顶上的条亮、点的那张卡先高亮（lib/nav-pending.ts，跳转优化 PR-A 审查补） */
  const 去页 = useNavGo();
  const [去的卡, set去的卡] = useState<string | null>(null);
  const 只读的 = new Set(只读ids);
  const 删不了 = new Set(删不了ids);
  const 放不了 = new Set(放不了ids);
  const 公海别线 = new Set(公海别线ids);
  const 领不回 = new Set(原负责人领不回ids);
  const 分给们 = 公海分给 ?? users;
  // 服务端已取有效页的数据；只修正地址，避免二次请求与开发模式流式重定向错误。
  useEffect(() => {
    if (requestedPage === undefined || requestedPage === String(page)) return;
    const url = new URL(window.location.href);
    // 翻页中的旧 props 不能把新目标地址改回旧页。
    if (url.searchParams.get("page") !== requestedPage) return;
    url.searchParams.set("page", String(page));
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [page, requestedPage]);

  /**
   * 列表顶上一行就地提示（原型 g.save / g.notice：不弹顶部 message）：批量没改成、公海没动、表单没打开、删不了……
   * 错的 role=alert，别的 role=status；过几秒收（换一句重新计时）
   */
  const [列表话, set列表话] = useState<{ 话: string; 错?: boolean } | null>(null);
  const 说 = useCallback((话: string, 错 = false) => set列表话({ 话, 错 }), []);
  useEffect(() => {
    if (!列表话) return;
    const t = setTimeout(() => set列表话(null), 列表话.错 ? 8000 : 6000);
    return () => clearTimeout(t);
  }, [列表话]);
  /** 导出完 / 没导出成：写在导出键旁边一行，过几秒收 */
  const [导出话, set导出话] = useState<{ 话: string; 错?: boolean } | null>(null);
  useEffect(() => {
    if (!导出话) return;
    const t = setTimeout(() => set导出话(null), 8000);
    return () => clearTimeout(t);
  }, [导出话]);
  const 视图中 = useViewAs();
  const { 问删除 } = useDeleteCustomers((话) => 说(话, true));
  /** 确认框、按钮读屏名里叫这一行（11-19 企业版全称选填：空着兜简称 / 客户编号） */
  const 叫 = (r: CustomerRow) => (企业 ? 客户显名(r) : r.name);
  const { 先问转走的项目 } = useTransferConfirm(转让原因);
  const { 问放回公海 } = usePoolReturnConfirm();
  /** 批量转让框（原型 cu.transfer：选人、一起转走的项目、原因合成一个框）：开着时记住勾的是谁 */
  const [转让框, set转让框] = useState<{ ids: string[]; 清空: () => void } | null>(null);
  /** 转让框是懒块：第一次开才挂，挂上以后不卸（关的动画照放） */
  const [转让框挂过, set转让框挂过] = useState(false);
  const 取转走 = useCallback((人id: string) => 转走项目预览of(转让框?.ids ?? [], 人id), [转让框]);
  /**
   * 批量转让框的自动分配（客户 11-17）：页面递了两个动作才有。预看 = 勾的里几位能自动分、别的为什么不行；
   * 做 = 一位一位自动分，结果框里原地列（分给了谁、几位没分成）。分出去了就清勾选、刷新列表；没有撤销条（同单个转让框的自动分配）。
   * 跟着 转让框 记住：框开着这段 自动 不变，免得框里反复去预看
   */
  const 转让框自动 = useMemo(() => {
    if (!转让框 || !自动分配预看 || !批量自动分配客户) return undefined;
    const { ids, 清空: 清 } = 转让框;
    return {
      预看: async () => {
        const r = await 自动分配预看(ids);
        return r.ok ? { 可: r.可.length, 不可: r.不可.map((x) => ({ name: x.name, error: x.error })), ...(r.可指定 ? { 可指定: r.可指定 } : {}), ...(r.定向 ? { 定向: r.定向 } : {}) } : null;
      },
      做: async (原因: string | null): Promise<自动结果> => {
        const r = await 批量自动分配客户(ids, 原因);
        if (!r.ok) return r;
        const 分成 = r.结果.flatMap((x) => (x.ok ? [{ name: x.name, 接手人: x.接手人 }] : []));
        const 没成 = r.结果.flatMap((x) => (x.ok ? [] : [{ name: x.name, error: x.error }]));
        if (分成.length) {
          清();
          router.refresh();
        }
        return { ok: true, 分成, 没成 };
      },
    };
  }, [转让框, 自动分配预看, 批量自动分配客户, router]);

  /**
   * 批量改完给一次撤销（排查 D1）。原来点一下就写库、没有退路，选错一页就是一批数据改错。
   * 撤销 = 按原值分组再调一次同一个批量动作（改状态）；改负责人不能这样撤——反向再转一次会把新负责人本来就有的活
   * 一起带走，传 整批退回 走 撤销改负责人，只还这次带过来的（2026-10-04 T-018）
   */
  function 可撤销提示(res: Extract<BulkResult, { ok: true }>, 文案: string, 退回: (ids: string[], 值: string) => Promise<BulkResult>, 整批退回?: () => Promise<BulkResult>) {
    const 原值 = res.原值 ?? [];
    // 没改动的（都已是这个值）：没有可撤的，也不弹顶部提示——列表刷新就是反馈（11-15 原型 g.save）
    if (!原值.length) return;
    // 底部撤销条（PR5a showUndo）：事情已经做了，撤销 = 反着做一遍；撤销被挡时条上写原因
    showUndo({
      话: 文案,
      毫秒: 6000,
      撤销: async () => {
        if (整批退回) {
          const r = await 整批退回();
          router.refresh();
          if (!r.ok) return { ok: false, error: `没能全部改回去：${r.error}` };
          if (r.unchanged) return { ok: false, error: `已撤销 ${r.updated} 条；${r.unchanged} 条没改回（刚被人改过，或原负责人已停用）` };
          return;
        }
        const 组 = new Map<string, string[]>();
        for (const x of 原值) 组.set(x.值, [...(组.get(x.值) ?? []), x.id]);
        for (const [值, ids] of 组) {
          const r = await 退回(ids, 值);
          if (!r.ok) {
            router.refresh();
            return { ok: false, error: `没能全部改回去：${r.error}` };
          }
        }
        router.refresh();
      },
    });
  }
  /**
   * 公海两个动作的提示条：说清动了几位、几位没动为什么，带一次撤销（和批量改同一个做法）。
   * 「领取」撤销 = 还给原来的人、放回公海；「放进」撤销 = 拿回来；「分配」（老板）撤销同领取，按分到的那位认
   */
  function 公海提示(res: 公海结果, 动作: "放进" | "领取" | "分配", ids: string[]) {
    router.refresh();
    if (!res.ok) return void 说(res.error, true);
    const 名 = 动作 === "放进" ? "放回公海" : 动作 === "分配" ? `分给「${res.给谁?.name ?? "同事"}」` : "领取";
    if (!res.updated) {
      return void 说(动作 === "放进" ? "选中的已经都在公海里了" : 动作 === "分配" ? "选中的已经被领走了，没有可分的" : "选中的已经被领走了，没有可领的");
    }
    const 另 = [
      res.unchanged && (动作 === "放进" ? `${res.unchanged} 位本来就在公海` : `${res.unchanged} 位已被别人领走或不在公海`),
      res.没权限 && `${res.没权限} 位你放不了，没放（只有负责人、直属上级或总管理能放）`,
      res.有订单 && `${res.有订单} 位名下有没结束的订单阶段项目，没放${res.订单项目 ? `（${res.订单项目}）` : ""}`,
      res.交接中 && `${res.交接中} 位正在转让交接中，没放`,
      res.同事在推 && `${res.同事在推} 位名下有同事负责、还没结束的项目，没放${res.同事项目 ? `（${res.同事项目}）` : ""}`,
      res.联系方式不全 && `${res.联系方式不全} 位联系方式空着或有号码不对，没放（改好再放）`,
      res.验证中 && `${res.验证中} 位名下有线索在验证中（等复核或等确认），没放（处理完再放）`,
    ].filter(Boolean);
    const 文案 = 动作 === "分配" ? `已把 ${res.updated} 位${名}${另.length ? `；${另.join("，")}` : ""}${带走说法(res.带走)}` : `已${名} ${res.updated} 位${另.length ? `；${另.join("，")}` : ""}${带走说法(res.带走)}`;
    // 撤销放进只撤这次真放进去的（服务端回 放了）：没放的（本来就在公海、被拦下的）交上去会被报成「没撤成」（复审 M1）
    const 原 = 动作 === "放进" ? (res.放了 ?? ids).map((id) => ({ id, 值: "" })) : (res.原负责人 ?? []);
    // 底部撤销条跟着走（换页也在，原型 cu.return「撤销条跟着」）：已经做了，撤销 = 撤销公海 反着做
    showUndo({
      话: 文案,
      毫秒: 6000,
      撤销: async () => {
        const r = await 撤销公海(动作, 原, res.ok ? res.带过来 : undefined, res.ok ? res.给谁?.id : undefined, res.ok ? res.公海项目 : undefined);
        router.refresh();
        if (!r.ok) return r; // 原因原样给撤销条（它自己加「撤销不了：」），不再叠「没能撤销：」（复审 11-26 M-b）
        // 批量里撤成、已撤回、没撤成混着时服务端拼好了整句（「已撤销 N 位；M 位刚才已经撤回公海了；…」），撤销条原样写；
        // 有没撤成的（有没撤成）撤销条按出错样式留久一点
        return { ok: true, 提示: r.提示, 有没撤成: r.有没撤成 };
      },
    });
  }
  /**
   * 退回公海在后果框里做（原型 cu.return）：没退成、一位都没退的，原因写在框里、框不关；退了的走 公海提示（撤销条）
   */
  async function 退回做(ids: string[], 原因?: string | null) {
    const res = await 放进公海(ids, 原因);
    if (!res.ok) return res;
    if (!res.updated) {
      router.refresh();
      return { ok: false, error: "选中的没有能退回的：" + ([
        res.unchanged && `${res.unchanged} 位本来就在公海`,
        res.没权限 && `${res.没权限} 位你放不了`,
        res.有订单 && `${res.有订单} 位名下有没结束的订单阶段项目`,
        res.交接中 && `${res.交接中} 位正在转让交接中`,
        res.同事在推 && `${res.同事在推} 位名下有同事负责、还没结束的项目`,
        res.联系方式不全 && `${res.联系方式不全} 位联系方式空着或有号码不对（改好再放）`,
        res.验证中 && `${res.验证中} 位名下有线索在验证中（处理完再放）`,
      ].filter(Boolean).join("，") || "都已不在你名下") };
    }
    公海提示(res, "放进", ids);
  }
  const b = useBusiness();
  // 项目模式开着：新建一律走建档向导（客户、联系人、项目、首条沟通一次建好）
  /**
   * 企业版项目模式（统一公海 P7，2026-10-29）：公海挪去 /pool 一页看，这里不摆「客户 / 公海」页签。
   * 「新建客户」照旧在（项目模式下走建档向导）。?pool=1 的老链接服务端直接转去 /pool
   */
  const 统一公海 = 企业 && b.projectMode === true;
  const 新建 = () => {
    if (b.projectMode && 有建档) return void 要表单料().then((d) => d?.建档 && set建档开着(true));
    void 要表单料().then((d) => {
      if (!d) return;
      setEditing(null);
      setFormOpen(true);
    });
  };

  const { f, setF, apply, 翻页, reset, pending } = useUrlFilters("/customers", { ...filters, sort: 金额排序 || 等级排序 || 创建排序 || 跟进排序, sortCurrency: 排序币种 ?? b.currency }, pageSize);
  /**
   * 「空库」是「一条都没有 **且** 没在筛」。筛出 0 条不算——
   * 那时筛选栏必须留着，否则人看不见自己筛了什么，也点不到重置。
   * 按 filters（服务端那次查询用的条件）判而不是 f（输入框里的草稿）。
   */
  /*
    公海里还有人也不算空库：「客户」页签空了（比如一个人用、全被自动放进了公海），页签和筛选栏得留着，
    不然人看到的是「新建第一位」，以为客户全没了
  */
  /*
    「范围」停在这个人的默认（服务端补进 filters.scope 的那一项）不算在筛，和下面「筛了」同一口径；
    不然企业版项目模式 filters.scope 永远有值，空库永远判不出来（筛选栏、导出照摆，空态成了「没有符合条件的」）
  */
  const 空库 = total === 0 && !公海数 && !本月新增 && !直接推荐 && !本批 && !Object.entries(filters).some(([k, v]) => v && !(k === "scope" && v === 客户范围?.默认));
  /** 在看三种子集之一：公海里的和自己的一起列，不摆页签（query.ts 在看子集） */
  const 子集 = Boolean(本月新增 || 直接推荐 || 本批);
  /** 「公海」页签（按服务端这次查询的条件判，不按草稿） */
  const 公海页 = filters.pool === "1";
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  /**
   * 企业版客户页「列表 / 看板」（U-客户-06，10-31 会议）：看板按客户属性（字典 custAttr）分列，交互同项目页。
   * 公海页签、子集里不摆看板；看板分的是这一页取回来的客户（分页照旧在看板下面）
   */
  // 企业版项目模式的看板换成按节点分列的项目看板（第 3 批，服务端另画，见 项目看板），按客户属性分列的这块不摆
  const 能看板 = 企业 && !项目看板 && 客户属性字典.length > 0 && !公海页;
  const [存的看法, set看法] = useLocalPref<"列表" | "看板">("customers-view", "列表");
  const 看法 = 能看板 ? 存的看法 : "列表";
  const [导出中, set导出中] = useState(false);
  const [导出进度, set导出进度] = useState("");
  const 导出取消 = useRef<AbortController | null>(null);
  // 离开客户页不打断导出：请求接着跑，下完照样存 ZIP、弹提示（D8-3：原先一卸载就 abort，几万条时「点了导出没东西」）。
  // 关标签页、刷新会真断，导出中先拦一下
  useEffect(() => {
    if (!导出中) return;
    const 拦 = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", 拦);
    return () => window.removeEventListener("beforeunload", 拦);
  }, [导出中]);
  /** 走建档向导：首屏带了数据，或项目模式点开时再取 */
  const 有建档 = Boolean(建档) || 建档要取;
  /**
   * 表单那两份料（渠道候选、建档向导数据）：首屏带了就用（?new=1），没带就点开（或展开「新建 ▾」预取）时取一次，
   * 取回来记着，这一页再开不再取（11-15 列表页瘦身，form-data-action.ts）
   */
  const [表单料, set表单料] = useState<客户页表单料 | null>(channels || 建档 ? { channels: channels ?? [], 建档: 建档 ?? null } : null);
  const [表单料取中, set表单料取中] = useState(false);
  const 表单料请求 = useRef<Promise<客户页表单料 | null> | null>(null);
  const 要表单料 = (出错提示 = true): Promise<客户页表单料 | null> => {
    // 表单代码和料一起取（表单是懒块）：取不到代码就当没打开
    if (表单料) return 取客户表单().then(() => 表单料, () => { if (出错提示) 说("没打开，请重试", true); return null; });
    if (!表单料请求.current) {
      set表单料取中(true);
      表单料请求.current = Promise.all([取客户页表单料(), 取客户表单()])
        .then(([d]) => { set表单料(d); return d; })
        .catch(() => { 表单料请求.current = null; return null; })
        .finally(() => set表单料取中(false));
    }
    return 表单料请求.current.then((d) => {
      if (!d && 出错提示) 说("没打开，请重试", true);
      return d;
    });
  };
  const [formOpen, setFormOpen] = useState(Boolean(直接新建) && !有建档);
  /** 行菜单「编辑」点了、表单料还在取：记着是哪一行（那一行的「更多」按钮转圈），取完才开表单；取的时候再点不理 */
  const [编辑取中, set编辑取中] = useState<string | null>(null);
  const 编辑取中锁 = useRef(false);
  const 去编辑 = (r: CustomerRow) => {
    if (表单料) {
      setEditing(r);
      setFormOpen(true);
      // 表单是懒块：料首屏就带了时，这里顺手把代码拿起来（已到就是空转）
      void 取客户表单().catch(() => {});
      return;
    }
    // 同一下连点两次时 state 还没更新，用 ref 拦
    if (编辑取中锁.current) return;
    编辑取中锁.current = true;
    set编辑取中(r.id);
    void 要表单料()
      .then((d) => {
        if (!d) return;
        setEditing(r);
        setFormOpen(true);
      })
      .finally(() => {
        编辑取中锁.current = false;
        set编辑取中(null);
      });
  };
  /** 「新增客户」向导框（U-新建-01）：和项目页「新增项目」同一个向导，弹在本页 */
  const [建档开着, set建档开着] = useState(Boolean(直接新建 && 建档));
  const [导入开着, set导入开着] = useState(Boolean(直接粘贴) && 能导入导出 && !企业);
  /** 导入抽屉是懒块：第一次开才挂，挂上以后不卸（关抽屉的动画、抽屉里的进度都留着） */
  const [导入挂过, set导入挂过] = useState(导入开着);
  /** 企业版不用客户页这个旧导入抽屉（11-03）：导入走设置 →「企业版导入」，首页那张「开始」卡同一个去处 */
  const 去导入 = () => {
    if (企业) return router.push("/settings?tab=enterprise");
    set导入挂过(true);
    set导入开着(true);
  };
  /** ?new=1 / ?import=paste 进来就开：等水合完再开。服务端先画一个开着的弹窗，会和客户端那一版对不上（跟进页同一写法） */
  const 已水合 = useSyncExternalStore(无订阅, () => true, () => false);
  /*
    ?new=1 / ?import=paste 是「一次性」的：读完就从地址上抹掉（2026-10-02 排查桌面端 D5）。
    桌面端的壳会记住最后停在哪一页（带着 query），不抹的话第一天点过「手动录一位」，
    之后每次打开应用、每次刷新都会自己弹出新建框。首页的 ?q= 也是这么抹的。
  */
  useEffect(() => {
    if (!直接新建 && !直接粘贴) return;
    const q = new URLSearchParams(window.location.search);
    q.delete("new");
    q.delete("import");
    router.replace(q.size ? `/customers?${q}` : "/customers", { scroll: false });
    // 只在进来那一下
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 一共筛着几个。0 的时候「重置」看不见——没筛过的页面上它是个哑按钮（位置留着，见 ResetFilters）。页签不算筛选。
   * 排序币种（sortCurrency）也不算（设计语言 L-A · L-新1，3703 复现）：f 里一直带着它（没给就是默认币种），原来被算成 1 项，
   * 刚进列表「重置」就亮着、点了列表纹丝不动；它只管「按金额排」时折算成哪种币，不收窄列表
   */
  const 筛了 = Object.entries(f).filter(([k, v]) => k !== "pool" && k !== "sortCurrency" && v && !(k === "scope" && v === 客户范围?.默认)).length;
  /** 重置留在当前页签：在「公海」里点重置，回到的是全部公海，不是跳回「客户」 */
  const 重置 = () => (f.pool && !子集 ? apply({ ...(Object.fromEntries(Object.keys(f).map((k) => [k, ""])) as typeof f), pool: "1" })
    // 市场角色：地址不带 scope 时服务端画「我分出去的」→ 重置要留着默认范围，回到列表（#395 审查必修）
    : 市场视图 ? apply({ ...(Object.fromEntries(Object.keys(f).map((k) => [k, ""])) as typeof f), scope: 客户范围?.默认 || "visible" })
    : reset());
  /**
   * 只有一个人的库：负责人列、负责人筛选、渠道负责人、批量分配都不摆（审查 D2 / M3）。
   * 13 寸窗口下负责人那一列正好把「最近跟进」挤出视野，而它每一格都是同一个名字。
   * 正筛着某个负责人（从数据页点名字进来的）时照摆，不然人看不见自己筛了什么
   */
  const 不问归属 =
    !f.salesOwnerId && !f.channelOwnerId && !f.pool &&
    列表不问归属(users, rows.flatMap((r) => [r.salesOwnerName, r.channelOwnerName]));

  /** 外贸模版（2026-10-05 外贸客户建议），见 lib/business-config.ts 外贸精简 */
  const 外贸 = 外贸精简(b);

  /** 进程下拉（同项目页 ProjectsView）：选了阶段只列这一阶段的节点 + 结局，没选按阶段分组 */
  const 阶段字典 = 字典of(企业, 出口叫法);
  const 进程组 = (s: 阶段) => ({
    label: s,
    options: [
      // 后售培育（P-界面-63）：紧跟潜客培育多一项，同项目页（服务端 阶段进程条件 翻成条件）
      ...阶段字典.节点们[s].flatMap((n) => [{ value: n, label: n }, ...(企业 && n === "潜客培育" ? [{ value: 后售培育名, label: 后售培育名 }] : [])]),
      ...阶段字典.出口们[s].flatMap((o) => (o.结局 ? [{ value: o.结局, label: o.叫法 }] : [])),
    ],
  });
  const 进程选项: SelectProps["options"] = f.phase && (阶段们 as readonly string[]).includes(f.phase) ? 进程组(f.phase as 阶段).options : 阶段们.map(进程组);
  /**
   * 排序按钮（E-332）：和表头点排序用同一个地址栏参数 sort（amount / level / created / follow × asc / desc），
   * 选了 = apply({ sort })，表头的箭头、刷新后保持都跟着地址栏走；金额排序多带 sortCurrency，同表头
   */
  const [排序单开着, set排序单开着] = useState(false);
  const 排序字段们 = [
    { 键: "amount", 名: `${签约叫(b)}金额` },
    { 键: "level", 名: "客户等级" },
    { 键: "created", 名: "创建时间" },
    { 键: "follow", 名: "最近跟进" },
  ];
  const 当前排序 = f.sort || "";
  const 当前排序字段 = 排序字段们.find((x) => 当前排序.startsWith(`${x.键}-`));
  const 当前排序方向: "asc" | "desc" | null = 当前排序.endsWith("-asc") ? "asc" : 当前排序.endsWith("-desc") ? "desc" : null;
  const 选排序 = (键: string, 方向: "asc" | "desc") =>
    apply({ sort: 键 ? `${键}-${方向}` : "", ...(键 === "amount" ? { sortCurrency: f.sortCurrency || b.currency } : {}) });
  const 排序菜单项: MenuProps["items"] = [
    ...排序字段们.map((x) => ({ key: x.键, label: x.名, icon: 当前排序字段?.键 === x.键 ? <CheckOutlined /> : <span className="cust-sort-gap" /> })),
    { type: "divider" as const },
    { key: "dir-asc", label: "升序", disabled: !当前排序字段, icon: 当前排序方向 === "asc" ? <CheckOutlined /> : <span className="cust-sort-gap" /> },
    { key: "dir-desc", label: "降序", disabled: !当前排序字段, icon: 当前排序方向 === "desc" ? <CheckOutlined /> : <span className="cust-sort-gap" /> },
    { type: "divider" as const },
    { key: "default", label: "默认排序", disabled: !当前排序字段 },
  ];
  /** 筛选项（11-06 可自定义）：默认外露 = 系统原来摆在外面的；顺序也是原来的顺序 */
  const { 外露: 筛选外露, 更多按钮: 更多筛选按钮 } = useCustomFilters("customers", [
    ...(企业
      ? [{
          键: "custStatus", 名: "客户状态", 宽: 140, 默认外露: true, 有值: !!f.custStatus,
          渲染: (style: CSSProperties) => (
            <FilterSelect style={style} allowClear aria-label="客户状态"
              /* 手机宽（390）这一格只有约 120 宽，「全部客户状态」会被截成「全部客户…」：手机上换成短写「全部状态」，
                 悬停看全写、读屏照 aria-label「客户状态」（globals.css .ph-short / .ph-full） */
              placeholder={<><span className="ph-full">全部客户状态</span><span className="ph-short" title="全部客户状态">全部状态</span></>}
              popupRender={(menu) => <>{下拉说明(字典定义.custStatus.说明)}{menu}</>} popupMatchSelectWidth={false}
              // 释义收成一行（L-新7）：原来每项两三行，一屏只露 4 项；放不下省略号、悬停看全
              {...释义下拉(字典释义?.状态, undefined, true)}
              value={f.custStatus || undefined} onChange={(v) => apply({ custStatus: v ?? "" })}
              options={[...new Set([...客户状态选项, ...(f.custStatus ? [f.custStatus] : [])])].map((s) => ({ value: s, label: s }))} />
          ),
        }]
      : [{
          键: "followStatus", 名: "跟进状态", 宽: 140, 默认外露: true, 有值: !!f.followStatus,
          渲染: (style: CSSProperties) => (
            <FilterSelect style={style} placeholder="全部跟进状态" allowClear
              value={f.followStatus || undefined} onChange={(v) => apply({ followStatus: v ?? "" })}
              options={FOLLOW_STATUSES.map((s) => ({ value: s, label: statusLabel(b, s) }))} />
          ),
        }]),
    // 外贸：国家是第一眼要分的（时差、市场、报价口径），摆在外面；只给库里真有的国家
    ...(外贸 && !企业 && (国家们.length > 0 || f.country)
      ? [{
          键: "country", 名: "国家", 宽: 130, 默认外露: true, 有值: !!f.country,
          渲染: (style: CSSProperties) => (
            <FilterSelect style={style} placeholder="全部国家" allowClear
              value={f.country || undefined} onChange={(v) => apply({ country: v ?? "" })}
              options={[...new Set([...国家们, ...(f.country ? [f.country] : [])])].map((x) => ({ value: x, label: x }))} />
          ),
        }]
      : []),
    // 客户等级（2026-10-16）：和国家一样摆在外面——按等级挑今天先跟谁
    ...(外贸 && !企业
      ? [{
          键: "level", 名: "客户等级", 宽: 120, 默认外露: true, 有值: !!f.level,
          渲染: (style: CSSProperties) => (
            <FilterSelect style={style} placeholder="全部等级" allowClear aria-label="客户等级"
              value={f.level || undefined} onChange={(v) => apply({ level: v ?? "" })}
              options={[...客户等级.map((x) => ({ value: x, label: 客户等级说明[x] })), { value: 未分级, label: 未分级 }]} />
          ),
        }]
      : []),
    // 团队版部门（1b）：总管理、管理员默认看全公司，按部门挑着看。选上级部门连下级一起
    // 地址栏里的部门删掉了：列表不按它筛（query.ts 部门条件），下拉也显示「全部部门」，两边对得上
    ...(部门选项.length > 0
      ? [{
          键: "dept", 名: "部门", 宽: 140, 默认外露: true, 有值: 部门选项.some((o) => o.value === f.dept),
          渲染: (style: CSSProperties) => (
            <FilterSelect style={style} placeholder="全部部门" allowClear aria-label="部门"
              value={部门选项.some((o) => o.value === f.dept) ? f.dept : undefined} onChange={(v) => apply({ dept: v ?? "" })}
              options={部门选项} />
          ),
        }]
      : []),
    // 公海原来是这个下拉的第一项，2026-10-13 起由页签代替。「公海」页签上不摆（除非地址上正筛着某人，不然看不见自己筛了什么）
    ...(!不问归属 && (!f.pool || 子集 || f.salesOwnerId)
      ? [{
          键: "salesOwnerId", 名: "负责人", 宽: 150, 默认外露: true, 有值: !!f.salesOwnerId,
          渲染: (style: CSSProperties) => (
            <FilterSelect style={style} placeholder="全部负责人" allowClear aria-label="负责人"
              value={f.salesOwnerId || undefined}
              onChange={(v) => apply({ salesOwnerId: v ?? "" })}
              // 同名的带部门（L-新6）：两位同名同事原来只能靠登录名分；部门是看的人认得的
              options={成员选项带部门(users)} />
          ),
        }]
      : []),
    /*
      阶段、进程（11-12 客户详情合并第 3 批，定稿 UI 筛选行）：名下有一个我能看的项目在这一阶段 / 进程上的客户。
      下拉同项目页（选了阶段，进程只列这一阶段的）。照定稿摆在外面、排在负责人后面；筛选行一行放不下时这两个先自动收进「更多筛选」
      （挤：components/CustomFilters.tsx），筛选行始终一行
    */
    ...(filters.phase !== undefined
      ? [{
          键: "phase", 名: "阶段", 宽: 110, 默认外露: true, 挤: true, 有值: !!f.phase,
          渲染: (style: CSSProperties) => (
            <FilterSelect style={style} aria-label="阶段" placeholder="全部阶段" allowClear value={f.phase || undefined}
              onChange={(v?: string) => apply({ phase: v ?? "", node: "" })} options={阶段们.map((x) => ({ value: x, label: x }))} />
          ),
        }, {
          键: "node", 名: "进程", 宽: 130, 默认外露: true, 挤: true, 有值: !!f.node,
          渲染: (style: CSSProperties) => (
            <FilterSelect style={style} aria-label="进程" placeholder="全部进程" allowClear value={f.node || undefined} popupMatchSelectWidth={false}
              onChange={(v?: string | null) => apply({ node: v ?? "" })} options={进程选项} />
          ),
        }]
      : []),
    /*
      「全部回收状态」（客户三态开着才有，P-界面-19 ①，构想页 C2）：按钟上的状态筛，负责人是市场成员的是「不计时」。
      照构想页摆在外面、排在进程后面；筛选行一行放不下时和阶段、进程一样先自动收进「更多筛选」（挤），筛选行始终一行
    */
    ...(filters.triState !== undefined
      ? [{
          键: "triState", 名: "回收状态", 宽: 130, 默认外露: true, 挤: true, 有值: !!f.triState,
          渲染: (style: CSSProperties) => (
            <FilterSelect style={style} aria-label="回收状态" placeholder="全部回收状态" allowClear value={f.triState || undefined}
              onChange={(v?: string) => apply({ triState: v ?? "" })} options={三态筛选值们.map((x) => ({ value: x, label: 三态显示名(x) }))} />
          ),
        }]
      : []),
    {
      键: "grade", 名: b.fields.grade, 宽: 130, 默认外露: false, 有值: !!f.grade,
      渲染: (style: CSSProperties) => (
        <FilterSelect style={style} placeholder={`全部${b.fields.grade}`} allowClear
          value={f.grade || undefined} onChange={(v) => apply({ grade: v ?? "" })}
          options={[...b.grades.map((g) => ({ value: g, label: g })), ...旧职位.map((g) => ({ value: g, label: `${g}（已不在选项里）` }))]} />
      ),
    },
    // 企业版级别默认收着：摆外面 1024 宽会把筛选行挤成两行；列表里「级别」一列默认摆着
    ...(企业
      ? [{
          键: "level", 名: "级别", 宽: 120, 默认外露: false, 有值: !!f.level,
          渲染: (style: CSSProperties) => (
            <FilterSelect style={style} placeholder="全部级别" allowClear aria-label="客户级别"
              value={f.level || undefined} onChange={(v) => apply({ level: v ?? "" })}
              options={[...级别选项(), { value: 未分级, label: 未分级 }]} />
          ),
        }, {
          键: "customerType", 名: "客户类型", 宽: 140, 默认外露: false, 有值: !!f.customerType,
          渲染: (style: CSSProperties) => (
            <FilterSelect style={style} placeholder="全部客户类型" allowClear aria-label="客户类型"
              popupRender={(menu) => <>{下拉说明(字典定义.custType.说明)}{menu}</>}
              popupMatchSelectWidth={false}
              {...释义下拉(字典释义?.类型)}
              value={f.customerType || undefined} onChange={(v) => apply({ customerType: v ?? "" })}
              options={[...new Set([...客户类型选项, ...(有值(f.customerType) ? [f.customerType] : [])])].map((x) => ({ value: x, label: x }))} />
          ),
        }, {
          // 归档档位（M-导入-23 / X-63）：归档导入来的客户按档位看；默认收着
          键: "archiveTier", 名: "归档档位", 宽: 130, 默认外露: false, 有值: !!f.archiveTier,
          渲染: (style: CSSProperties) => (
            <FilterSelect style={style} placeholder="全部归档档位" allowClear aria-label="归档档位"
              value={f.archiveTier || undefined} onChange={(v) => apply({ archiveTier: v ?? "" })}
              options={归档档位们.map((x) => ({ value: x, label: x }))} />
          ),
        }, {
          // 客户来源（11-06）：建档时选的渠道（Customer.channelId），停用的渠道也能筛，老客户还挂着
          // F-049（11-25）：多「未填」（主渠道和渠道触点都空）、按渠道触点（公司资源、客户介绍），值还在 channelId 这一个参数里
          // 框 160（F-049 审查）：钉到外面时「全部客户来源」、选中后的「客户介绍（触点）」都留足；窄屏照 globals.css 收缩规则
          键: "channelId", 名: "客户来源", 宽: 160, 默认外露: false, 有值: !!f.channelId,
          渲染: (style: CSSProperties) => (
            <FilterSelect style={style} placeholder="全部客户来源" allowClear aria-label="客户来源" showSearch
              popupMatchSelectWidth={false} classNames={{ popup: { root: "src-filter-pop" } }}
              value={f.channelId || undefined} onChange={(v) => apply({ channelId: v ?? "" })}
              options={渠道筛选项} />
          ),
        }, {
          // 国家（员工反馈 1C，11-16）：按客户地址里的国家（列表「国家」一列那一格），只给看得到的客户里真有的；默认收着（1024 宽筛选行放不下），
          // 要常用的在「更多筛选」里自己摆出来（useCustomFilters 记在本机）
          键: "country", 名: "国家", 宽: 140, 默认外露: false, 有值: !!f.country,
          渲染: (style: CSSProperties) => (
            <FilterSelect style={style} placeholder="全部国家" allowClear aria-label="国家"
              popupMatchSelectWidth={false}
              value={f.country || undefined} onChange={(v) => apply({ country: v ?? "" })}
              options={[...new Set([...国家们.filter((x) => 有值(x)), ...(f.country ? [f.country] : [])])].map((x) => ({ value: x, label: x }))} />
          ),
        }, {
          /*
            超过 N 天没跟进（员工反馈 1I，11-16）：自动提醒（客户三态）打开前的临时替代——挑出这么多天没记过沟通的客户。
            从没跟进过的按建档时间算；只收窄本来看得到的（query.ts 久未跟进条件）。选上时没在按别的排，就顺手按最近跟进正序（最久没跟进的在前）
          */
          键: "idleDays", 名: "久未跟进", 宽: 160, 默认外露: false, 有值: !!f.idleDays,
          渲染: (style: CSSProperties) => (
            // 常用天数直接选，「自定义天数…」填 1–3650 天（原话「可统一设定时间」，components/IdleDaysFilter.tsx）
            <IdleDaysFilter style={style} value={f.idleDays ?? ""} 天数们={久未跟进天数们}
              改={(v) => apply({ idleDays: v, ...(v && !f.sort ? { sort: "follow-asc" } : {}) })} />
          ),
        }]
      : []),
    // 手机号（11-11 使用方：「没有手机号……的筛选选项」）：只比号码，和搜索框里像号码的那一半同一套（去空格、横杠、括号、+86；输后几位也行），
    // 客户电话、WhatsApp、联系人的手机号都比；默认收着，地址栏 phone=
    ...(能按号码筛 ? [{
      键: "phone", 名: "手机号", 宽: 160, 默认外露: false, 有值: !!f.phone,
      渲染: (style: CSSProperties) => (
        <PhoneFilter style={style} value={f.phone ?? ""} 改={(v) => apply({ phone: v })} />
      ),
    }] : []),
    // 创建时间（11-11 使用方要统计上半年的客资）：默认收在「更多筛选」里，地址栏 createdFrom / createdTo，导出跟着同一份条件
    {
      键: "created", 名: "创建时间", 宽: 240, 默认外露: false, 有值: !!(f.createdFrom || f.createdTo),
      渲染: (style: CSSProperties) => (
        <CreatedRangeFilter style={style} from={f.createdFrom ?? ""} to={f.createdTo ?? ""} 改={(v) => apply(v)} />
      ),
    },
    ...(!企业
      ? [{
          键: "decisionStatus", 名: "决策状态", 宽: 140, 默认外露: false, 有值: !!f.decisionStatus,
          渲染: (style: CSSProperties) => (
            <FilterSelect style={style} placeholder="全部决策状态" allowClear
              value={f.decisionStatus || undefined} onChange={(v) => apply({ decisionStatus: v ?? "" })}
              options={DECISION_STATUSES.map((s) => ({ value: s, label: statusLabel(b, s) }))} />
          ),
        }]
      : []),
    ...(外贸
      ? [{
          键: "source", 名: "来源", 宽: 130, 默认外露: false, 有值: !!f.source,
          渲染: (style: CSSProperties) => (
            <FilterSelect style={style} placeholder="全部来源" allowClear
              value={f.source || undefined} onChange={(v) => apply({ source: v ?? "" })}
              options={[...new Set([...b.sources, ...(f.source ? [f.source] : [])])].map((x) => ({ value: x, label: x }))} />
          ),
        }]
      : []),
    ...(!不问归属 && !外贸 && !企业
      ? [{
          键: "channelOwnerId", 名: "渠道负责人", 宽: 150, 默认外露: false, 有值: !!f.channelOwnerId,
          渲染: (style: CSSProperties) => (
            <FilterSelect style={style} placeholder="全部渠道负责人" allowClear
              value={f.channelOwnerId || undefined} onChange={(v) => apply({ channelOwnerId: v ?? "" })}
              options={成员选项(users)} />
          ),
        }]
      : []),
  ]);
  // 单格没填（含导入占位的 "-"）一律写「—」（11-01 用户定，lib/empty-value.ts）
  const 空 = <span className="muted">{空值符}</span>;
  const 外贸列: 列<CustomerRow>[] = [
    /* 客户等级（2026-10-16）：A 在前；点表头在全部筛选结果里排，没分级的总在最后 */
    {
      title: "等级", key: "level", width: 76,
      sorter: true,
      sortOrder: 等级排序 === "level-asc" ? "ascend" : 等级排序 === "level-desc" ? "descend" : null,
      render: (_: unknown, r) => (r.extra?.level ? <span className={`cust-level cust-level-${r.extra.level}`} title={客户等级说明[r.extra.level as 等级] ?? r.extra.level}>{r.extra.level}</span> : 空),
    },
    /* 国家下面一行小字是对方此刻几点（2026-10-16）：挑这会儿能联系谁，不用再去算时差 */
    {
      title: "国家", key: "country", width: 120,
      render: (_: unknown, r) => 有值(r.extra?.country)
        ? <span className="country-cell"><span>{r.extra.country}</span><LocalTime country={r.extra.country} 简短 className="muted country-cell-t" /></span>
        : 空,
    },
    {
      title: "WhatsApp", key: "whatsapp", width: 150,
      // 点号码直接打开对话（wa.me）。停在链接上不跳进这位的记录页（行点击会进记录页）
      render: (_: unknown, r) => {
        const 网址 = WhatsApp网址(r.extra?.whatsapp);
        return 网址 ? <a href={网址} target="_blank" rel="noreferrer" className="nowrap" onClick={(e) => e.stopPropagation()} title="在 WhatsApp 里打开对话">{r.extra?.whatsapp}</a> : 空;
      },
    },
    {
      title: "邮箱", key: "email", width: 190,
      render: (_: unknown, r) => (有值(r.extra?.email) ? <CopyValue 种类="邮箱" 叫法="邮箱" value={r.extra.email} style={{ maxWidth: 170 }} /> : 空),
    },
    { title: "微信", key: "wechat", width: 120, 默认: false, render: (_: unknown, r) => (有值(r.extra?.wechat) ? r.extra.wechat : 空) },
    { title: "阿里国际站 ID", key: "alibabaId", width: 150, 默认: false, render: (_: unknown, r) => (有值(r.extra?.alibabaId) ? <span style={{ display: "inline-block", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }} title={r.extra.alibabaId}>{r.extra.alibabaId}</span> : 空) },
    { title: "来源", key: "source", width: 110, 默认: false, render: (_: unknown, r) => (有值(r.extra?.source) ? r.extra.source : 空) },
    {
      title: "官网", key: "website", width: 170, 默认: false,
      render: (_: unknown, r) => {
        const 网址 = 官网网址(r.extra?.website);
        return 网址 ? <a href={网址} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ display: "inline-block", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }} title={网址}>{官网短写(r.extra?.website)}</a> : 空;
      },
    },
  ];

  /**
   * 企业版客户改版（定稿 P5 第 22、23 条）：外贸那几列（国家、WhatsApp、邮箱、微信、阿里 ID、来源）不摆，
   * 换成级别 S/A/B/C（排序同一个 level 键，S 在 A 前）、地址、官网、分配方式；后三列收在「列」里。
   * P13（2026-10-29）：级别画成星；10-31 会议 F-客户-01 改回只显示字母（components/LevelLetter.tsx）；加「客户类型」一列，
   * 字典项可以改成很长的字，超出 96 宽省略、悬停看全；默认收在「列」里，列表还是六列（1024 宽排得下）
   */
  /*
    客户三态开着（企业版多「回收状态」一列）：默认列在 1280 / 1366 宽（左栏 220）不出表格内部横向滚动，各列收到一行刚好放下常见内容，
    更长的照「一行 + 省略号 + 悬停」。量法和各列为什么是这个数见 tests/ent-cust-list-columns.ui.test.ts「三态开着：默认列不横向滚」。
    三态关着列宽照旧（只有「项目数」放宽到表头三个字放得下）。这一页有公海里的客户时「负责人」不收（「公海（原 X）」要放得下）
  */
  const 三态挤 = 企业 && !!三态标;
  const 宽 = (常: number, 三态开: number) => (三态挤 ? 三态开 : 常);
  // D20：筛选行「只看…」胶囊同筛选控件一个高（32，.list-chip），不再各写各的内边距
  // L-新8：号码不再被省略号截掉——「联系电话」列宽按这一页最长的号码给（数字、+、空格按 0.62em，中文 1em；
  // 加格子左右留白 16 + 复制键 22），150 起、260 封顶，再长的才省略、悬停看全
  const 电话宽 = Math.min(260, Math.max(150, Math.ceil(Math.max(0, ...rows.map((r) => [...(r.phone ?? "")].reduce((w, c) => w + (/[\u3000-\u9fff\uff00-\uffef]/.test(c) ? 14 : 8.7), 0)))) + 16 + 22 + 6));
  /** 这一页有公海里的：操作列多一颗「领取」、加宽到 132，手机宽照旧钉右 */
  const 有领取 = !不问归属 && rows.some((r) => r.pool);
  const 企业列: 列<CustomerRow>[] = [
    {
      title: "级别", key: "level", width: 宽(76, 60),
      sorter: true,
      sortOrder: 等级排序 === "level-asc" ? "ascend" : 等级排序 === "level-desc" ? "descend" : null,
      render: (_: unknown, r) => <LevelLetter level={r.extra?.level} 空={空} />,
    },
    {
      title: "客户类型", key: "customerType", width: 96, 默认: false,
      render: (_: unknown, r) => (有值(r.customerType) ? <span className="clamp-1" style={{ display: "block" }} title={r.customerType}>{r.customerType}</span> : 空),
    },
    ...(企业 ? [{
      title: "客户属性", key: "customerAttr", width: 112, 默认: false,
      render: (_: unknown, r: CustomerRow) => (有值(r.customerAttr) ? <span className="clamp-1" style={{ display: "block" }} title={r.customerAttr}>{r.customerAttr}</span> : 空),
    }] : []),
    /*
      国家（11-04 用户：客户列表加国家列）：原来这一页有人填了才摆，翻一页这一列就时有时无（员工反馈 1C，11-16）——
      改成固定摆，没填的写「—」（X-08 空值都采用「—」）。客户名里带的「｜国家」（M-导入-54 补名字）不拆，另问业务方
    */
    {
      title: "国家", key: "addrCountry", width: 宽(96, 68),
      render: (_: unknown, r: CustomerRow) => (有值(r.addrCountry) ? <span className="clamp-1" style={{ display: "block" }} title={r.addrCountry ?? ""}>{r.addrCountry}</span> : 空),
    },
    { title: "地址", key: "address", width: 180, 默认: false, render: (_: unknown, r) => { const t = 拼地址(r); return t ? <span title={t}>{t}</span> : 空; } },
    {
      title: "官网", key: "website", width: 170, 默认: false,
      render: (_: unknown, r) => {
        const 网址 = 官网网址(r.extra?.website);
        return 网址 ? <a href={网址} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={网址}>{官网短写(r.extra?.website)}</a> : 空;
      },
    },
    { title: "客户分配", key: "assignWay", width: 100, 默认: false, render: (_: unknown, r) => (有值(r.assignWay) ? r.assignWay : 空) },
    // 客户来源（11-05 用户：「列」的可选列里加「客户来源」；P-渠道-01 列里只显示主渠道，悬停看「主|子」全称；没主渠道写触点）= 建档时选的渠道（Customer.channelId，建好就锁），默认收着；渠道名可能很长，一行省略、悬停看全
    {
      title: "客户来源", key: "channelName", width: 120, 默认: false,
      // 主渠道空、只挂触点（P-渠道-08 公司资源 / 客户介绍）：写「公司资源（触点）」，和「客户来源」筛选下拉一个写法（F-049）
      render: (_: unknown, r) => {
        const [字, 全] = 有值(r.channelName) ? [主渠道显示名(r.channelName), 渠道显示名(r.channelName)] : 有值(r.touchpoint) ? [触点显示名(r.touchpoint), 触点显示名(r.touchpoint)] : [];
        return 字 ? <span className="clamp-1" style={{ display: "block" }} title={全}>{字}</span> : 空;
      },
    },
  ];

  const 列表: 列<CustomerRow>[] = [
    {
      title: b.customer,
      key: "name",
      dataIndex: "name",
      /*
        企业版显示抬头（11-17 客户抬头 PR-5，出口 1）：区域|简称 / 全称 / 类型 / 当前节点，全空写当前项目名、没项目名写编号|节点（F-040，lib/enterprise/customer-title.ts）。
        一行、放不下省略号，悬停看全文（P-抬头-11，同 11-04 全站一行省略，.fulltext 现在就是一行；TruncTip 量到截了才出，title 兜底）
      */
      width: 企业 ? 宽(200, 136) : 160,
      常驻: true,
      render: (v, r) => {
        if (!企业) return <RowLink href={`/customers/${r.id}`} className="link-strong">{v}</RowLink>;
        const 抬头 = 客户抬头(r, 抬头节点?.[r.id]);
        return <RowLink href={`/customers/${r.id}`} className="link-strong fulltext cust-title" style={{ display: "block" }} title={抬头}>{抬头}</RowLink>;
      },
    },
    /*
      客户编号（11-17 客户抬头 PR-1）：以后列表上显示的抬头可以重名，唯一性只靠编号，所以企业版常驻一列、紧跟客户名，不进「列」的可选项。
      104 宽：过了 99999 的「NO.123456」16px 字也一行放全（三态开着也不收）；存量回填前没有编号的写短号（#+ id 末 6 位，lib/customer-no.ts 客户编号显示）
    */
    ...(企业 ? [{
      title: "编号", 列名: "客户编号", key: "customerNo", width: 104, 常驻: true,
      render: (_: unknown, r: CustomerRow) => <span className="cust-no">{客户编号显示(r)}</span>,
    }] satisfies 列<CustomerRow>[] : []),
    /*
      号码全显 + 一键复制（29Q，11-20 客户管理员：展会大量现场加的客户要逐个加微信）：服务端给的是什么就显示什么——
      号码脱敏器（销售教练、字段权限里电话「看不到」的角色）和公海里的客户（page.tsx 列表行，用户 11-20 定「不显示」）在服务端就打好了码，
      带 * 的 CopyValue 不给复制键。
      默认显示、紧跟客户名 / 编号（#381 实操，客户口径「号码可以全部显示」）：摆在最后 1280 宽要横滚才看得到，等于没默认显示。
      存过列设置的老用户：只有主动藏过（存了 -phone）的照旧收着，其余（存过别的列、没提过号码）一律显示（PR #384 审查）
    */
    { title: "联系电话", key: "phone", dataIndex: "phone", width: 电话宽, render: (v: string | null) => (v ? <CopyValue 叫法="电话" value={v} /> : 空) },
    /*
      「当前节点」「项目数」（11-12 客户详情合并第 3 批，定稿 UI 表格）：只算我能看的项目。
      当前节点 = 点进这位客户默认停的那个项目页签的节点（lib/project/customer-list-projects.ts）；没有我能看的项目写「—」，项目数写 0。
      一行放不下省略号，悬停看全（全站 TruncTip）
    */
    ...(项目概况 ? [{
      title: "当前节点", key: "projectNode", width: 宽(112, 80),
      render: (_: unknown, r: CustomerRow) => {
        const x = 项目概况[r.id];
        return x?.当前节点
          ? <Tag className="clamp-1 cust-node-tag" color={x.当前阶段 === "订单" ? "blue" : undefined}>{x.当前节点}</Tag>
          : 空;
      },
    }, {
      // 72：表头三个字连左右内边距放得下（64 在大一号的字体下被截成「项…」）
      // 三态开着默认收进「列」（PR #384，用户定方案 A「收起项目数」）：给默认显示的「联系电话」腾位置，1280 宽内部横滚压在 80 以内、1366 不横滚。
      // 只认三态开着之后在「列」里主动勾出来的：列设置存的是全部可见列，三态开着动过任何一列的老设置都带着 projectCount，那不算主动。
      // 所以三态开着换一个存键「+projectCount」，老设置里的 projectCount 不算（留着不删，三态关了照旧生效）；勾上就一直显示，取消又收起。三态关着不变
      title: "项目数", key: "projectCount", width: 72, ...(三态挤 ? { 默认: false, 存键: "+projectCount" } : {}),
      render: (_: unknown, r: CustomerRow) => <span className="nowrap">{项目概况[r.id]?.项目数 ?? 0}</span>,
    }] satisfies 列<CustomerRow>[] : []),
    /*
      「回收状态」（客户三态开着才有，P-界面-19 ①，构想页 C2）：活跃不标；沉睡 / 待回收（带几天后进公海）/ 暂缓回收中各一个小标签，
      负责人是市场成员的写「不计时」。一行放不下省略号，悬停看说明。
      表头不叫「状态」：企业版另有一列「客户状态」（字典 custStatus，按项目自动算的客户阶段），两回事
    */
    ...(三态标 ? [{
      title: "回收状态", key: "triState", width: 136,
      render: (_: unknown, r: CustomerRow) => {
        const x = 三态标[r.id];
        return x ? <span className={`tri-tag tri-${x.态}`} title={三态标说明(x)}>{三态标字(x)}</span> : null;
      },
    }] satisfies 列<CustomerRow>[] : []),
    // 企业版不摆院校·专业（10-28 去遗留 B2）
    ...(企业 ? [] : [{
      // 院校和专业永远一起看。分成两列只是把同一件事拆开占两倍宽
      title: `${b.fields.school}·${b.fields.major}`,
      key: "schoolMajor",
      列名: `${b.fields.school}·${b.fields.major}`,
      width: 230,
      render: (_, r) =>
        有值(r.school) || 有值(r.major) ? (
          <span>
            {空显(r.school)}
            {有值(r.major) && <span className="muted"> · {r.major}</span>}
          </span>
        ) : (
          空
        ),
    } satisfies 列<CustomerRow>]),
    // 企业版：跟进状态换成客户状态（字典 custStatus，10-28 去遗留 A1）
    企业
      ? { title: "客户状态", key: "custStatus", dataIndex: "custStatus", width: 宽(110, 76), render: (v: string | null) => (有值(v) ? <Tag color={客户状态色of(客户状态色, v)} style={{ margin: 0 }}>{v}</Tag> : 空) }
      : { title: "跟进状态", key: "followStatus", dataIndex: "followStatus", width: 110, render: (v: string) => <FollowStatusTag status={v} /> },
    // 外贸不摆预计签约（2026-10-05 外贸客户：「没有意义」——采购时间点看商机的询盘时间）
    // 三态开着默认收进「列」（11-17 客户抬头 PR-1）：给常驻的「编号」腾位置，1280 宽照旧不出表格内部横滚；要看的人在「列」里勾回来
    ...(外贸 ? [] : [{
      title: "预计签约", key: "expectedSignAt", dataIndex: "expectedSignAt", width: 宽(116, 100), ...(三态挤 ? { 默认: false } : {}),
      render: (v: string | null) => <span className="muted nowrap">{有值(v) ? fmtDate(v) : 空值符}</span>,
    }]),
    /*
      外贸档案的列（2026-10-05 外贸客户：「增加列：国家，Whatsapp，Wechat，邮箱」）。
      国家、WhatsApp、邮箱默认摆；微信、来源收在「列」里
    */
    ...(企业 ? 企业列 : 外贸 ? 外贸列 : []),
    ...(不问归属 ? [] : [{
      // 这一页有公海里的（「公海（原 X）」标签）照旧 140，三态开着也不收
      title: "负责人", 列名: "负责人", key: "salesOwnerName", dataIndex: "salesOwnerName", width: rows.some((r) => r.pool) ? 140 : 宽(140, 92),
      // 在公海里：写「公海（原 X）」——原负责人还挂着，但谁都能领
      render: (v: string, r: CustomerRow) => r.pool
        ? <Tag className="pool-tag" title={`${公海标签(v)} · ${r.pool.reason === "手动" ? "手动放回公海" : 进公海理由显示(r.pool.reason)}`}>{公海标签(v)}</Tag>
        : <UserCell name={v} size={24} />,
    }]),
    // 三列各收一点，1366 宽时默认列和公海列都不用左右拖（10-27）；负责人不收，「公海（原 X）」要放得下
    {
      title: "最近跟进", key: "lastFollowAt", dataIndex: "lastFollowAt", width: 宽(180, 92),
      // 企业版点表头在全部筛选结果里排（1I，11-16）：正序 = 最久没跟进的在前，从没跟进过的最前
      ...(企业 ? { sorter: true, sortOrder: 跟进排序 === "follow-asc" ? "ascend" as const : 跟进排序 === "follow-desc" ? "descend" as const : null } : {}),
      // 冷热在前：扫一眼这一列就知道谁凉了，日期留着给要细看的人
      // 企业版不摆冷热：它按跟进状态算，企业版不用跟进状态（10-28 去遗留 A1）
      // 企业版时间后面接最近那一条的一句（员工反馈 2I，11-17）：和时间一起一行，放不下省略号、悬停看全文（TruncTip）；列宽不动，1280 照旧不横滚
      render: (v, r) => 企业 ? (
        <span className="clamp-1 follow-cell">
          <span className="muted">{smartTime(v)}</span>
          {最近一句?.[r.id] ? <span className="follow-note"> · {最近一句[r.id]}</span> : null}
        </span>
      ) : (
        <span className="heat-cell">
          <Heat at={v} status={r.followStatus} />
          <span className="muted nowrap">{smartTime(v)}</span>
        </span>
      ),
    },

    // 创建（入库）时间（11-11）：默认收在「列」里；点表头在全部筛选结果里排（服务端 sort=created-asc / created-desc），不点就是默认的新的在前
    {
      title: "创建时间", key: "createdAt", dataIndex: "createdAt", width: 104, 默认: false,
      sorter: true,
      sortOrder: 创建排序 === "created-asc" ? "ascend" : 创建排序 === "created-desc" ? "descend" : null,
      render: (v: string) => <span className="muted nowrap">{fmtDate(v)}</span>,
    },
    { title: b.fields.grade, key: "grade", dataIndex: "grade", width: 90, 默认: false, render: (v) => v ?? <span className="muted">—</span> },
    // 企业版不摆决策状态、签约金额（10-28 去遗留 A1 / A4）
    ...(企业 ? [] : [{ title: "决策状态", key: "decisionStatus", dataIndex: "decisionStatus", width: 128, 默认: false, render: (v: string) => <DecisionStatusTag status={v} /> },
    {
      title: <span title={`按 ${f.sortCurrency || b.currency} 金额在全部筛选结果中排序，其他币种不相加`}>{签约叫(b)}金额</span>, 列名: `${签约叫(b)}金额`, key: "signedAmount", dataIndex: "signedAmount", width: 120, 默认: false,
      sorter: true,
      sortOrder: 金额排序 === "amount-asc" ? "ascend" : 金额排序 === "amount-desc" ? "descend" : null,
      render: (v: number, r: CustomerRow) => (v > 0 ? <span style={{ fontWeight: 500 }}>{合计文字(签约各币(r))}</span> : <span className="muted">—</span>),
    } satisfies 列<CustomerRow>]),
    // 推荐人、渠道归属、渠道负责人：外贸不摆（推荐分佣链是教培那一套，外贸看来源）；企业版也不摆（10-28 去遗留 B2）
    ...(外贸 || 企业 ? [] : [
      { title: "推荐人", key: "referrerName", dataIndex: "referrerName", width: 120, 默认: false, render: (v: string | null) => v ?? <span className="muted">自然流量</span> },
      {
        title: "渠道归属", key: "attributionName", dataIndex: "attributionName", width: 120, 默认: false,
        render: (v: string | null) => (v ? <Tag style={{ margin: 0 }}>{v}</Tag> : <span className="muted">—</span>),
      },
    ]),
    ...(不问归属 || 外贸 || 企业 ? [] : [{
      title: "渠道负责人", key: "channelOwnerName", dataIndex: "channelOwnerName", width: 130, 默认: false,
      render: (v: string | null) => (v ? <UserCell name={v} size={24} /> : <span className="muted">—</span>),
    }]),
    {
      // 这一页有公海里的才多一个「领取」、才加宽：表格本来就比 13 寸窗口宽一点，不为用不上的按钮再挤
      // 一行只摆一个字按钮（领取），分配、编辑、删除收进「⋯」（交互规则 D，2026-10-30）；领不了的原因写在按钮下面，不靠悬停
      // 手机不钉（#381 实操）：只一颗「⋯」（56 宽）时手机宽不钉右，让出中间给号码列整列横滚进来（DataList 手机不钉）；
      // 这一页有公海行、多出「领取」（132 宽）时照旧钉右：领取是要一眼看得见的主按钮
      title: "", key: "action", width: 有领取 ? 132 : 56, 常驻: true, fixed: "right", 手机不钉: !有领取,
      render: (_, r) => {
        // 虚线下属的客户：编辑、删除点了也会被拦，不摆按钮，直接说只能看
        if (只读的.has(r.id)) return <span className="muted nowrap">只能看</span>;
        const 公海里 = r.pool && !不问归属;
        const 菜单: NonNullable<MenuProps["items"]> = [
          // 老板直接分给某位同事（2026-10-20）：规矩同领取，只是领的人换成选中的那位
          ...(公海里 && 能分配公海 && !公海别线.has(r.id) && 成员选项(分给们).length ? [{
            key: "assign", label: "分配给同事",
            children: 成员选项(分给们).map((o) => ({ key: `assign:${o.value}`, label: o.label, onClick: async () => 公海提示(await 分配公海([r.id], o.value), "分配", [r.id]) })),
          }] : []),
          { key: "edit", label: "编辑", onClick: () => 去编辑(r) },
          // 先数清会一起删掉什么再问（排查 B1，见 useDeleteCustomers）；点了照旧弹后果确认框（P-界面-40）
          // L-新2：删除是危险项——红字、上面一道分隔线，和编辑隔开
          ...(能删 && !删不了.has(r.id) ? [
            { type: "divider" as const, key: "delete-sep" },
            { key: "delete", label: "删除", danger: true, onClick: () => void 问删除([{ id: r.id, name: 叫(r) }]) },
          ] : []),
        ];
        return (
          <div>
            <Space size={2}>
              {公海里 && 能新建和领取 && (
                <Button className="row-act" aria-label={`领取 ${叫(r)}`} disabled={领不回.has(r.id)} size="small"
                  onClick={async () => 公海提示(await 领取([r.id]), "领取", [r.id])}>领取</Button>
              )}
              {/* 菜单画在 body 上，但 React 事件照组件树冒泡到这一行：不拦住，点完就跟着进了记录页 */}
              {/* 展开时先把表单料拿起来（同「新建 ▾」），点「编辑」多半不用再等；还在取时这一行的按钮转圈、各行菜单都点不了（防连点） */}
              <Dropdown trigger={["click"]} disabled={!!编辑取中} onOpenChange={(开) => { if (开) { void 要表单料(false); 预取弹框(); } }} menu={{ items: 菜单, onClick: ({ domEvent }) => domEvent.stopPropagation() }}>
                <Button className="row-act" aria-label={`更多操作 ${叫(r)}`} type="text" size="small" icon={<MoreOutlined />} loading={编辑取中 === r.id} />
              </Dropdown>
            </Space>
            {公海里 && 能新建和领取 && 领不回.has(r.id) && <div className="muted" style={{ fontSize: 12, lineHeight: "16px" }}>{原负责人不能领回提示}</div>}
          </div>
        );
      },
    },
  ];

  /*
    列表 ⇄ 看板原地变形（原型 cu.view「改后」，同 ov.view / pr.view，projects/view-morph.ts）：
    项目看板是服务端换一屏画的（cookie），点下去滑块先到，量下每一行（tr[data-row-key] = 客户）的位置；新样子到了那一帧，
    这位客户的卡片（data-morph-key = 客户）从他那一行的位置滑过去，反过来一样，对不上的淡入。看板那半边懒加载、第一次可能晚几帧才挂上：
    没对上就再等几帧（最多 12 帧），还没有就算了，照常直接换。减弱动态不量不动
  */
  const 变形包 = useRef<HTMLDivElement>(null);
  const 变形起点 = useRef<Map<string, DOMRect> | null>(null);
  const { 时长: 动效时长 } = useMotionTheme();
  const 项目看法: "列表" | "看板" = 看板体 !== undefined ? "看板" : "列表";
  const [换项目看法到, set换项目看法到] = useState<"列表" | "看板" | null>(null);
  // 新样子到了：清掉（随 props 调整 state 的写法），以后别的原因换了样子不算变形
  if (换项目看法到 !== null && 换项目看法到 === 项目看法) set换项目看法到(null);
  const 换项目看法 = (v: "列表" | "看板") => {
    变形起点.current = 少动() ? null : 量变形起点(变形包.current);
    set换项目看法到(v);
    换客户页看法(v === "看板" ? "board" : "list", router);
  };
  useLayoutEffect(() => {
    const 起 = 变形起点.current;
    变形起点.current = null;
    if (!起?.size) return;
    let 帧 = 0;
    let id = 0;
    const 试 = () => { if (!放变形(变形包.current, 起, 动效时长.morph) && ++帧 < 12) id = requestAnimationFrame(试); };
    试();
    return () => cancelAnimationFrame(id);
  }, [项目看法, 动效时长]);
  /*
    「列表 / 看板」（11-12 用户：「列表｜看板 放到和筛选栏一行，最左边」）：筛选行第一格，列表、看板两个视图同一个位置，切换时不跳；
    原来摆在页头右上（按客户属性分列的看板）或标题下面单独一行（项目看板、市场角色）。不缩、不被挤进「更多筛选」（globals.css .list-view-seg）。
    三种：企业版项目模式 = 按节点分列的项目看板（记在 cookie 里、服务端换一屏画，projects/board-page.tsx）；
    市场角色 = 「客户列表 / 我分出去的」（另一边是原项目页给他们的那套）；企业版没开项目模式 = 按客户属性分列的看板（记在这台电脑）
  */
  const 看法切换 = 项目看板
    ? (!空库 || 市场视图) && !子集 && (市场视图
      ? <Segmented<string> aria-label="客户列表 / 我分出去的" options={[...市场视图名]} value={市场视图名[0]} onChange={(v) => v === 市场视图名[1] && 换客户页看法("board", router, 切我分出去的去掉(f.channelId))} />
      : <Segmented<"列表" | "看板"> aria-label="列表 / 看板" options={["列表", "看板"]} value={换项目看法到 ?? 项目看法} onChange={换项目看法} />)
    : 能看板 && !空库 && <Segmented<"列表" | "看板"> aria-label="列表 / 看板" options={["列表", "看板"]} value={看法} onChange={set看法} />;
  /** 「新建 ▾ → 新建项目」点一次挂一份（换 key 重挂 = 重新打开选新老客户的框）；0 = 还没点过、不加载 */
  const [新建项目次, set新建项目次] = useState(0);
  /** 点了「新建项目」、懒加载块还没到：按钮转圈、点不了（到了才挂，挂上就开框） */
  const [项目流程载入, set项目流程载入] = useState(false);
  const 点新建项目 = () => {
    set项目流程载入(true);
    // 新客户那条路用建档向导数据（表单料），和懒加载块一起等
    void Promise.all([取新建项目流程(), 要表单料(false)])
      .then(([, d]) => { if (d) set新建项目次((n) => n + 1); else 说("没打开，请重试", true); }, () => { 说("没打开，请重试", true); })
      .finally(() => set项目流程载入(false));
  };
  const 新建项 = [
    ...(能新建和领取 ? [{ key: "customer", label: `新建${b.customer}`, onClick: 新建 }] : []),
    // 企业版项目模式：原来只在看板上方「+ 新增项目」（先选新老客户，ProjectsView），11-12 收进页头「新建 ▾」，列表、看板两边都有。
    // 谁看得到照服务端：建档向导（不能新建项目话）、给老客户建项目（没设业务角色 / 只读角色）都按 能新建和领取 拒，这里同一条，免得摆一颗点了必被拒的
    ...(项目看板 && 能新建和领取 ? [{ key: "project", label: "新建项目", onClick: 点新建项目 }] : []),
  ];
  const [工具位, set工具位] = useState<HTMLDivElement | null>(null);
  /** 导出：按服务端这次查询用的条件导全部（filters），不是当前这一页，也不是输入框里还没搜的草稿 */
  const 导出做 = async () => {
    const controller = new AbortController();
    导出取消.current = controller;
    set导出中(true);
    set导出话(null);
    try {
      const r = await 完整导出(filters, b, set导出进度, controller.signal);
      set导出话({ 话: `已完整导出 ${r.客户} 位${b.customer}、${r.跟进} 条跟进，ZIP内附分批Excel和核对清单` });
    } catch (error) {
      if (!controller.signal.aborted) set导出话({ 话: 出错原话(error, "导出失败，请重试"), 错: true });
    } finally {
      导出取消.current = null;
      set导出中(false);
      set导出进度("");
    }
  };
  /*
    「导出」悬停说清导什么、导多少（设计语言 L-A · L-新4）：点了直接按当前范围和筛选导全部，原来事先一个字不说。
    不加确认框（P-界面-40「能一次做完的不加确认」）；条数 = 列表上面的总数（同一份 filters，仅项目那一小块本来不进导出）
  */
  const 导出范围名 = 客户范围 && filters.scope ? 客户范围名[filters.scope as 客户范围] : undefined;
  const 导出说明 = `按当前${[导出范围名 && `范围「${导出范围名}」`, 筛了 > 0 && "筛选"].filter(Boolean).join("和") || "条件"}导出 ${total.toLocaleString("zh-CN")} 位${b.customer}（含跟进记录）`;
  /** 导出中旁边那颗「取消导出」：只有它 abort（离开页面不打断导出，D8-3）；摆在页头下一行 */
  const 取消导出钮 = <Button size="small" onClick={() => 导出取消.current?.abort()}>取消导出</Button>;
  // F-056：按钮只在收成图标时才挂悬停提示（宽屏字还在，再出一遍是重复）；服务端先按宽屏不挂，水合后按真实宽度。断点同 globals.css：导入 / 离职交接 ≤1199，跟进计划 ≤1439
  const 图标收了 = useNarrow("(min-width: 768px) and (max-width: 1199px)");
  const 跟进收了 = useNarrow("(max-width: 1439px)");
  // F-056：左栏「客户」红数是今天到期 + 逾期的跟进计划、待办条数；客户列表里看不到这些条，在页头给个入口去跟进计划页（数到了且为 0 不占位；数晚到时先放同宽隐形占位，避免硬刷新页头跳）
  const 跟进计划钮 = 要跟.未到 ? (
    <span key="followplans" aria-hidden className="cust-head-follow-ph">
      <Button tabIndex={-1} className="cust-head-follow" icon={<CalendarOutlined />}><span className="cust-head-follow-t">跟进计划</span><span className="cust-head-follow-n">00</span></Button>
    </span>
  ) : 要跟数 > 0 && (
    <Link key="followplans" href="/follow-ups/plans?scope=mine">
      <Tooltip title={跟进收了 ? `跟进计划和待办：要跟 ${要跟数} 条${要跟.逾期 > 0 ? `（含逾期 ${要跟.逾期} 条）` : ""}` : undefined}>
        <Button className="cust-head-follow" icon={<CalendarOutlined />} aria-label={`跟进计划和待办，要跟 ${要跟数} 条${要跟.逾期 > 0 ? `（逾期 ${要跟.逾期}）` : ""}`}><span className="cust-head-follow-t">跟进计划</span><span className={要跟.逾期 > 0 ? "cust-head-follow-n" : "cust-head-follow-n is-calm"}>{要跟数 > 99 ? "99+" : 要跟数}</span></Button>
      </Tooltip>
    </Link>
  );
  /** 离职交接（C15）：页头右端。谁看得见、数怎么数照原来的入口（离职交接入口），不是这页自己数 */
  const 离职交接钮 = 待交接 != null && <Link key="handover" href="/projects/handover"><Tooltip title={图标收了 ? (待交接 ? `离职交接 ${待交接}` : "离职交接") : undefined}><Button className="cust-head-ho" icon={<UserSwitchOutlined />} aria-label={待交接 ? `离职交接 ${待交接}` : "离职交接"}><span className="cust-head-ho-t">离职交接</span>{待交接 ? <span className="cust-head-ho-n">{待交接}</span> : null}</Button></Tooltip></Link>;
  /** 「新建 ▾」（11-12 用户：「右上角改为新建，然后可以选择新建项目或者新建客户」）：只能建一样时直接是那一样，一样都不能不摆 */
  const 新建钮 = <NewMenuButton key="new" 项={新建项} 载入中={项目流程载入 || 表单料取中} 预取={() => { void 取新建项目流程().catch(() => {}); void 要表单料(false); }} />;

  return (
    <>
      {转让框挂过 && <TransferDialog
        open={!!转让框}
        onClose={() => set转让框(null)}
        题={`把 ${转让框?.ids.length ?? 0} 位${b.customer}转给`}
        人们={成员选项(users)}
        取转走={取转走}
        // 要不要接手人确认（P-转-16）：不在这里猜，看 取转走 回来的「要确认」（服务端 转让走交接 同一个判定）
        原因选项={转让原因?.选项}
        自己={转让原因?.自己}
        自动={转让框自动}
        做={async (人id, 原因, 方向) => {
          if (!转让框) return;
          const ids = 转让框.ids;
          const 名 = 成员选项(users).find((o) => o.value === 人id)?.label ?? "";
          const res = await assignSalesOwner(ids, 人id, 原因, 方向);
          // 权限被挡、交接中……：原因写在框里，框不关，不提示成功
          if (!res.ok) return res;
          // 企业版「交接中」（D10）：一位都没发起 = 没成，原因写在框里
          if (res.交接中 === 0) {
            router.refresh();
            const 已在 = (res.交接已在路上 ? `${res.交接已在路上} 名已在移交中（等对方确认）` : "") + (res.没转 ? `；${res.没转} 名刚被别人改了负责人` : "") + (res.missing ? `；${res.missing} 名已不存在` : "");
            return { ok: false, error: `没有发起新的交接${已在 ? `：${已在}` : "：选中的都已归 " + 名}` };
          }
          转让框.清空();
          router.refresh();
          // 发起了交接：负责人还没换，等接手人确认——没有可撤销的；页顶「移交申请中」横幅就是反馈，可在那撤回
          if (res.交接中 !== undefined) return;
          可撤销提示(res, 批量结果说法(res, `已转给 ${名}`), assignSalesOwner, () => 撤销改负责人(res.原值 ?? [], 人id, res.带过来));
        }}
      />}
      <PageHead
        title={b.customer}
        subtitle="全部档案与跟进"
        /*
          「客户 / 公海」两个页签（2026-10-13：老板、业务员、一个人用的都要「公海和自己的分开看」）。
          摆在标题旁边，不进筛选行：1024 宽时筛选行本来就刚好一行，再塞一个会把「列」挤到第二行（e2e/window-sizes.spec.ts）。
          页签记在地址上（pool=1），翻页、搜索、筛选都留在这一页签里。
          一个人用、公海里也没人时不摆——那时公海就是个空抽屉；空库不摆；子集（筛选行上那三种标记）里不摆：那几个数本来就含公海
        */
        titleAside={客户范围 ? (
          /*
            「范围」（客户 11-18 第 12 题「把客户的页签直接加一个筛选项」）：企业版项目模式没有「客户 / 公海」页签（公海在 /pool），
            这一格就摆在原来页签的位置——标题旁边、不进筛选行（1024 宽筛选行本来就刚好一行），也不会被收进「更多筛选」。
            没有空值：「重置」回到这个人的默认；选中项记在地址栏 scope，换一项回第一页重查
          */
          <Segmented<客户范围>
            className="cust-scope"
            aria-label="范围"
            value={(f.scope as 客户范围 | undefined) || 客户范围.值}
            onChange={(v) => apply({ scope: v })}
            options={客户范围.选项.map((k) => ({ value: k, label: <span title={客户范围说明[k]}>{客户范围名[k]}</span> }))}
          />
        ) : !统一公海 && !空库 && !子集 && (users.length > 1 || (公海数 ?? 0) > 0 || f.pool) ? (
          <Segmented
            aria-label={`${b.customer} / 公海`}
            value={f.pool ? "公海" : "客户"}
            // 换到公海清掉负责人：公海里的负责人是「原负责人」，带过去筛出来的是另一回事（和原来下拉里选「公海」一样）
            onChange={(v) => apply(v === "公海" ? { pool: "1", salesOwnerId: "" } : { pool: "" })}
            options={[
              { value: "客户", label: `${客户页签}${b.customer} ${客户数 ?? 0}` },
              { value: "公海", label: `公海 ${公海数 ?? 0}` },
            ]}
          />
        ) : undefined}
        extra={
          /*
            设计语言 L-A · L-新3 / D31：主按钮「新建 ▾」固定最右，离职交接排在它左边（谁看得见不变，P-界面-18 / P-转-06）；
            导入、导出是次动作排最左，图标分开（D35：导入 = 往上传、导出 = 往下载，原来两个都是方框加箭头）。
            手机宽导入、导出只留图标（字靠 aria-label / 悬停），四颗一排放得下，首屏多露几行（D06）。
            导出中 / 导完那句不再塞在这排按钮中间（L-新13：导完那句约 40 字，把按钮往左推约 440），写在页头下一行
          */
          <Space wrap>
            {能导入导出 && (
              <Tooltip key="import" title={视图中 ? 视图外部话 : 图标收了 ? "导入" : undefined}>
                <Button className="cust-head-io" aria-label="导入" icon={<UploadOutlined />} disabled={视图中} onClick={去导入}>导入</Button>
              </Tooltip>
            )}
            {能导入导出 && !空库 && (
              <Tooltip key="export" title={视图中 ? 视图外部话 : 导出说明}>
                <Button className="cust-head-io" aria-label="导出" icon={<DownloadOutlined />} loading={导出中} disabled={视图中} onClick={导出做}>导出</Button>
              </Tooltip>
            )}
            {跟进计划钮}
            {离职交接钮}
            {新建钮}
          </Space>
        }
      />
      {/* 导出中 / 导完（L-新13）：页头下一行，进度 + 「取消导出」、导完那句 8 秒后收；页头按钮不跟着挪 */}
      {能导入导出 && 导出中 && (
        <div role="status" className="cu-said cu-said-row cust-export-row">
          <span>{导出进度}</span>
          {取消导出钮}
        </div>
      )}
      {!导出中 && 导出话 && <div role={导出话.错 ? "alert" : "status"} className={导出话.错 ? "cu-said cu-said-row cu-said-err" : "cu-said cu-said-row"}>{导出话.话}</div>}

      {/* 市场角色空库也摆（另一边「我分出去的」不看客户多少）：空库时筛选行整条不画（DataList），只这一种情况照原来单独一行 */}
      {空库 && 看法切换 && <div className="cust-view-seg">{看法切换}</div>}

      {/* 从别处跳回来时带的一句（比如嵌在客户页的项目详情里最后一个项目走了，回到这里）：写在原处，不弹顶部提示 */}
      <LandingNote 路径="/customers" />
      {列表话 && <div role={列表话.错 ? "alert" : "status"} className={列表话.错 ? "cu-said cu-said-row cu-said-err" : "cu-said cu-said-row"}>{列表话.话}</div>}
      {阶段太多 && <div role="status" className="cust-too-many">结果太多，请再加筛选条件</div>}
      {/* 看板视图：看板（ProjectsView 客户页）的分配、「→ 还有 N 列」画进筛选行右端那一格（board-slot.ts），不在看板上面另占一行 */}
      <看板工具位.Provider value={看板体 !== undefined ? 工具位 : undefined}>
      <div ref={变形包} className="cu-morph-wrap">
      <DataList<CustomerRow>
        浮起操作条
        页="customers"
        // 进详情再回来、刷新：勾选和横滚位置还原（29R）
        回来还原
        // 企业版每格一行、放不下省略号悬停看全（11-01 会议 §11）
        单行={企业}
        不可勾={只读的.size ? (r) => 只读的.has(r.id) : undefined}
        空库={空库}
        没对上={
          公海里匹配 > 0 ? (
            <div className="list-none">
              {f.keyword ? `没有对得上「${f.keyword}」的${b.customer}；` : `没有对得上这些筛选的${b.customer}；`}
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => (统一公海
                ? router.push(f.keyword ? `/pool?${new URLSearchParams({ keyword: f.keyword })}` : "/pool")
                : apply({ pool: "1", salesOwnerId: "" }))}>
                公海里有 {公海里匹配} 位匹配 ›
              </Button>
            </div>
          ) : 公海页 && !Object.entries(filters).some(([k, v]) => k !== "pool" && v) ? (
            <div className="list-none">公海里现在没有{b.customer}</div>
          ) : (
            // D21 空态句式：搜索时「没有对得上「词」的客户」，只是筛了写「没有对得上这些筛选的客户」，后面指回「重置」；13 muted、不带句号
            <div className="list-none">{f.keyword ? `没有对得上「${f.keyword}」的${b.customer}` : `没有对得上这些筛选的${b.customer}`}，换个条件或点「重置」看全部</div>
          )
        }
        列={列表}
        行={rows}
        加载中={pending}
        行链接={(r) => `/customers/${r.id}`}
        空态={{
          title: `还没有${b.customer}`,
          hint: 企业
            ? `${b.customer}是这套系统的中心：沟通记录和项目都挂在他身上。`
            : 外贸
            ? `${b.customer}是这套系统的中心：跟进记录、商机、订单都挂在他身上。`
            : `${b.customer}是这套系统的中心：跟进记录、商机、签约都挂在他身上，推荐归属也按他这条线往上算。`,
          primary: 能新建和领取 ? { label: `新建第一位${b.customer}`, onClick: 新建 } : undefined,
          secondary: 能导入导出 && !视图中 ? [{ label: "从 Excel 导入", onClick: 去导入 }] : [],
        }}
        筛选={
          /*
            默认摆出来的只有每天都在用的：搜一句、状态、负责人；其余收进「更多筛选」，用户可以自己挑哪些摆外面（筛选项定义在上面）。
            收着的正筛着几个要写在按钮上：收起来不等于可以不告诉人，否则人会对着一张筛过的表当成全部。
          */
          <>
          {看法切换 && <div className="list-view-seg">{看法切换}</div>}
          <Space wrap size={[10, 10]}>
            {子集 && f.pool && (
              <Tag closable onClose={() => apply({ pool: "" })} color="processing" className="list-chip">
                只看公海里的
              </Tag>
            )}
            {/* 从「数据」页那张卡走进来的：说清这是一个子集，并给一条回到全部的路 */}
            {本月新增 && (
              <Tag closable onClose={() => apply({ createdWithin: "" })} color="processing" className="list-chip">
                只看本月新增
              </Tag>
            )}
            {直接推荐 && (
              <Tag closable onClose={() => apply({ directOf: "" })} color="processing" className="list-chip">
                只看「{直接推荐}」直接带来的 · {total} 位
              </Tag>
            )}
            {本批 && (
              <Tag closable onClose={() => apply({ batch: "" })} color="processing" className="list-chip">
                只看刚导入的这一批 · {本批.几位} 位
              </Tag>
            )}
            <ListSearch
              // 项目模式也搜我能看的项目名（2F，query.ts 项目名另比）；多个词用空格隔开、都要对上
              placeholder={(外贸 ? `姓名 / 电话 / ${b.fields.school} / 联系人 / 邮箱 / 官网` : `姓名 / 电话 / ${b.fields.school} / ${b.fields.major} / 备注`) + (统一公海 ? " / 项目名" : "")}
              value={f.keyword}
              onChange={(v) => setF({ ...f, keyword: v })}
              onSearch={(v) => apply({ keyword: v })}
            />
            {筛选外露}
            {更多筛选按钮}
            {/* 没有「搜索」按钮：下拉改了就生效，关键词回车或清空就生效。
                一个要再点一下才算数的筛选栏，会让人以为自己已经筛了其实没有。
                「重置」只在真筛了东西的时候看得见；位置一直留着，筛的那一下表格不往下跳（M17） */}
            <ResetFilters 显示={筛了 > 0} onClick={重置} />
          </Space>
          {看板体 !== undefined && <div className="list-bar-end" ref={set工具位} />}
          </>
        }
        排序钮={看板体 === undefined ? (
              <Dropdown trigger={["click"]} open={排序单开着}
                onOpenChange={(开, info) => { if (!开 && info.source === "menu") return; set排序单开着(开); }}
                menu={{
                  className: "cust-sort-menu",
                  items: 排序菜单项,
                  onClick: ({ key }) => {
                    const k = String(key);
                    if (k === "dir-asc" || k === "dir-desc") { if (当前排序字段) 选排序(当前排序字段.键, k === "dir-asc" ? "asc" : "desc"); return; }
                    if (k === "default") { 选排序("", "desc"); set排序单开着(false); return; }
                    选排序(k, 当前排序方向 ?? "desc");
                  },
                }}>
                <Button icon={<SwapOutlined rotate={90} />} aria-label="排序" title="排序" className="cust-sort-btn"><span className="cust-sort-txt">排序</span></Button>
              </Dropdown>
            ) : undefined}
        批量={(selected, 清空, 选中行) => {
          const 全领不回 = 选中行.some((r) => r.pool) && 选中行.filter((r) => r.pool).every((r) => 领不回.has(r.id));
          return (
          <>
            <PrefetchOnPick />
            {/* 公海页签的老板：「分配给…」= 从公海直接分出去（出公海、记领取时间）；批量分配只换负责人、人还在公海里，这里不摆 */}
            {!不问归属 && 公海页 && 能分配公海 && <Dropdown
              menu={{
                items: 成员选项(分给们).map((o) => ({
                  key: o.value,
                  label: o.label,
                  onClick: async () => {
                    const ids = 选中行.filter((r) => r.pool).map((r) => r.id);
                    if (!(await 先问转走的项目(ids, o.value))) return;
                    公海提示(await 分配公海(ids, o.value), "分配", ids); 清空();
                  },
                })),
              }}
            >
              <Button size="small" icon={<UserSwitchOutlined />}>分配给同事</Button>
            </Dropdown>}
            {/* 企业版批量分配（转让）：管理、总管理；负责人只转自己的（11-02，服务端 assignSalesOwner 同样拦） */}
            {!不问归属 && !(公海页 && 能分配公海) && (!企业 || 能分配公海 || (能转出自己的 && !公海页)) &&
              // 按钮文字写全（P-界面-43）；选人、一起转走的项目、原因在同一个框里（原型 cu.transfer）
              <Button size="small" icon={<UserSwitchOutlined />}
                onClick={() => { set转让框挂过(true); set转让框({ ids: [...selected], 清空 }); }}>
                转让给同事
              </Button>}
            {/* 「公海」页签只有领取，「客户」页签只有放进公海；子集里两种混着，看勾的是什么 */}
            {!不问归属 && (公海页 || (子集 && 选中行.some((r) => r.pool)) ? (能新建和领取 &&
              <>
                <Button size="small" icon={<UserAddOutlined />}
                  // 勾的全是自己当原负责人的公海客户：领不了，灰着，原因写在旁边
                  disabled={全领不回}
                  onClick={async () => {
                    const ids = 选中行.filter((r) => r.pool).map((r) => r.id);
                    if (!(await 先问转走的项目(ids))) return;
                    公海提示(await 领取(ids), "领取", ids); 清空();
                  }}>
                  领取
                </Button>
                {全领不回 && <span className="muted" style={{ fontSize: 12 }}>{原负责人不能领回提示}</span>}
              </>
            ) : (选中行.some((r) => !r.pool && !放不了.has(r.id)) &&
              <Button size="small" icon={<InboxOutlined />}
                // 一批转出去先问一声（交互规则 B），放完照旧 6 秒内能撤；企业版还要选退回原因、写明联系人和项目一起退（U-客户-04）
                onClick={async () => {
                  if (企业) {
                    const ids = [...selected];
                    // 确认框和工具条按钮统一叫「退回公海」（11-12 用户定 D3）
                    // 退回这件事在框里做：没退成原因写在框里；退了 → 清勾、撤销条（6 秒）
                    const 问 = await 问放回公海(`把 ${ids.length} 位退回公海`, true, "退回公海", (原因) => 退回做(ids, 原因));
                    if (问) 清空();
                    return;
                  }
                  const ids = [...selected];
                  if (await 问后果({
                    题: `把 ${ids.length} 位放回公海`,
                    后果: [{ 标: "谁都能领", 级: "警", 话: "放回后谁都能领" }, { 标: "可撤", 话: "6 秒内可以撤销" }],
                    是: "放回公海",
                    做: () => 退回做(ids),
                  })) 清空();
                }}>
                {/* 企业版统一叫「退回公海」（11-12 D3：工具条按钮、确认框一个说法） */}
                {企业 ? "退回公海" : "放回公海"}
              </Button>
            ))}
            {/* 批量改跟进状态：企业版不用跟进状态，不摆（10-28 去遗留 A1） */}
            {!企业 && <Dropdown
              menu={{
                items: FOLLOW_STATUSES.map((s) => ({
                  key: s,
                  label: statusLabel(b, s),
                  onClick: async () => {
                    const res = await bulkFollowStatus(selected, s);
                    清空();
                    router.refresh();
                    if (!res.ok) return void 说(res.error, true);
                    可撤销提示(res, 批量结果说法(res, `已改为「${statusLabel(b, s)}」`), bulkFollowStatus);
                  },
                })),
              }}
            >
              <Button size="small" icon={<TagsOutlined />}>批量状态</Button>
            </Dropdown>}
            {能删 && <Button
              size="small"
              icon={<DeleteOutlined />}
              // 写出是谁、会一起删掉什么（排查 B1）：人得对得上自己勾的是哪几位
              // 勾的全是删不了的：灰着；混着的不再整批拦下，框里写明跳过谁、删其余的（原型 cu.bulkdel）
              disabled={selected.every((id) => 删不了.has(id))}
              title={selected.every((id) => 删不了.has(id)) ? "勾的都不是你负责的，删不了" : undefined}
              onClick={() => {
                const 名 = (id: string) => { const r = 选中行.find((x) => x.id === id); return { id, name: r ? 叫(r) : "" }; };
                void 问删除(selected.filter((id) => !删不了.has(id)).map(名), 清空, selected.filter((id) => 删不了.has(id)).map(名));
              }}
            >
              删除
            </Button>}
          </>
          );
        }}
        排序={(key, order) => {
          if (key === "signedAmount") apply({ sort: order === "ascend" ? "amount-asc" : order === "descend" ? "amount-desc" : "", sortCurrency: f.sortCurrency || b.currency });
          if (key === "level") apply({ sort: order === "ascend" ? "level-asc" : order === "descend" ? "level-desc" : "" });
          if (key === "createdAt") apply({ sort: order === "ascend" ? "created-asc" : order === "descend" ? "created-desc" : "" });
          if (key === "lastFollowAt") apply({ sort: order === "ascend" ? "follow-asc" : order === "descend" ? "follow-desc" : "" });
        }}
        替表格={看板体 !== undefined ? 看板体 : 看法 === "看板" ? <CustomerBoard 行们={rows} 字典={客户属性字典} 加载中={pending} 页={page} 每页={pageSize} 总数={total} 翻页={翻页} 去={(id) => { set去的卡(id); 去页.push(`/customers/${id}`); }} 去的={去页.pending ? 去的卡 : null} 抬头节点={抬头节点} /> : undefined}
        汇总={<>{看板体 === undefined && 看法 !== "看板" && 待复核}{看板体 === undefined && 看法 !== "看板" && <ProjectOnlyBlock 行们={仅项目行} 超了={仅项目超了} />}{金额排序 && <Space wrap style={{ marginBottom: 12 }}><span>金额按</span><CurrencySelect aria-label="金额排序币种" value={f.sortCurrency || b.currency} onChange={v => apply({ sortCurrency: v })}/><span>在全部筛选结果中{金额排序 === "amount-asc" ? "升序" : "降序"}排列；其他币种不相加</span></Space>}</>}
        分页={{
          当前页: page,
          每页: pageSize,
          总数: total,
          翻页,
        }}
      />
      </div>
      </看板工具位.Provider>

      {/* 新建客户：一个弹窗填完，项目默认关、有项目就打开（P-界面-36） */}
      {表单料?.建档 && <建档弹窗 open={建档开着 && 已水合} 标题="新增客户" 项目="关" 数据={表单料.建档} onClose={() => set建档开着(false)} />}
      {/* 「新建 ▾ → 新建项目」：新客户走同一个建档向导（数据用上面那份，不再取），老客户挑一位接新建项目框 */}
      {新建项目次 > 0 && <新建项目流程 key={新建项目次} users={users} 节点们={阶段字典.节点们.线索} 要下一步={!!表单料?.建档?.要下一步} 建档={表单料?.建档 ?? null} />}

      {/* 料到了才挂（表单拿 channels 当初值，挂上以后不再跟 props） */}
      {表单料 && <CustomerForm
        open={formOpen && 已水合}
        editing={editing}
        users={users}
        channels={表单料.channels}
        负责人只能自己={负责人只能自己}
        企业版={企业}
        客户状态选项={客户状态选项}
        客户状态色={客户状态色}
        客户状态自动={客户状态自动}
        分配方式选项={分配方式选项}
        客户类型选项={客户类型选项}
        客户属性选项={客户属性选项}
        字典释义={字典释义}
        onClose={(saved) => {
          setFormOpen(false);
          setEditing(null);
          if (saved) router.refresh();
        }}
      />}

      {能导入导出 && !企业 && 导入挂过 && <ImportDrawer
        open={导入开着 && 已水合}
        b={b}
        aiEnabled={Boolean(aiEnabled)}
        初始来路={直接粘贴 ? "文本" : undefined}
        onClose={() => set导入开着(false)}
        onDone={() => router.refresh()}
        看这一批={(id) => router.push(`/customers?batch=${id}`)}
        有别的成员={users.length > 1}
      />}
    </>
  );
}

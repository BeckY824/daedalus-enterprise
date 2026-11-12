"use client";

import { 有值, 空显, 空值符 } from "@/lib/empty-value";
import CopyValue from "@/components/CopyValue";
import Heat from "@/components/Heat";
import { useEffect, useState, useSyncExternalStore, useRef, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Select, Space, Dropdown, App, Tag, Segmented, type MenuProps, type SelectProps } from "antd";
import { 客户状态色of } from "@/lib/enterprise/cust-status-color";
import {
  PlusOutlined,
  ExportOutlined,
  ImportOutlined,
  UserSwitchOutlined,
  TagsOutlined,
  DeleteOutlined,
  MoreOutlined,
  InboxOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import { FOLLOW_STATUSES, DECISION_STATUSES } from "@/lib/constants";
import { 合计文字 } from "@/lib/currency";
import { maskPhone, smartTime, fmtDate, 成员选项, 可选成员 } from "@/lib/utils";
import ListSearch from "@/components/ListSearch";
import { RowLink, FollowStatusTag, PageHead, UserCell, DecisionStatusTag } from "@/components/ui";
import DataList, { type 列 } from "@/components/DataList";
import CustomerForm, { type CustomerRow } from "./CustomerForm";
import { 完整导出 } from "./export-client";
import { 签约各币 } from "./export-table";
import ImportDrawer from "./ImportDrawer";
import { assignSalesOwner, bulkFollowStatus, 撤销改负责人, type BulkResult } from "./actions";
import { useDeleteCustomers } from "./useDeleteCustomers";
import { useTransferConfirm } from "./useTransferConfirm";
import { usePoolReturnConfirm } from "./usePoolReturnConfirm";
import { 带走说法, 批量结果说法 } from "@/lib/carry-over";
import { useBusiness } from "@/lib/business-client";
import { statusLabel, 外贸精简, 签约叫 } from "@/lib/business-config";
import { WhatsApp网址, 官网网址, 官网短写, 客户等级, 客户等级说明, type 客户等级 as 等级 } from "@/lib/customer-extra";
import { 级别选项, 拼地址 } from "@/lib/enterprise/customer-v2";
import { 主渠道显示名, 渠道显示名 } from "@/lib/enterprise/channel-main-core";
import { 字典定义 } from "@/lib/enterprise/dict-kinds";
import LevelLetter from "@/components/LevelLetter";
import { useLocalPref } from "@/lib/local-pref";
import LocalTime from "@/components/LocalTime";
import { 未分级 } from "./query-shared";
import { useUrlFilters } from "@/lib/url-filters";
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
import { useViewAs } from "@/components/ViewAsContext";
import { 视图外部话 } from "@/lib/enterprise/view-as-words";
import { 归档档位们 } from "@/lib/enterprise/archive-tier";
import { 三态筛选值们, 三态标字, 三态标说明, 三态显示名, type 三态标 } from "@/lib/enterprise/tri-state-label";
import { 字典of, 阶段们, type 阶段, type 出口叫法改动 } from "@/lib/project/stage-dict";
import type { 客户项目概况 } from "@/lib/project/customer-list-projects";
import { 换客户页看法, 市场视图名 } from "@/lib/customers-view-pref";

/** 「新增客户」弹窗（10-31 P5，整套建档向导）：点了才要，单拆一包，不压客户列表首屏 JS（速度闸门 850 KB） */
// 客户看板（U-客户-06）只在切到「看板」时用，连同分页条单独一块，别压在客户列表首屏（速度闸门）
const CustomerBoard = dynamic(() => import("./CustomerBoard"));
const 建档弹窗 = dynamic(() => import("../projects/new/ProjectWizard").then(m => m.建档弹窗), { ssr: false });

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
  /** 摆不摆「手机号」筛选：电话藏着的人（字段权限 Y27）不摆，服务端也不认。不给 = 摆 */
  能按号码筛?: boolean;
  排序币种?: string;
  users: 可选成员[];
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
  channels: Option[];
  /** 进来就把新建表单打开（首页空库那张「开始」卡的落点） */
  直接新建?: boolean;
  /** 企业版项目模式：「新建客户」弹建档向导框（U-新建-01）要的数据；null = 照旧（项目模式跳 /projects/new） */
  建档?: 建档数据 | null;
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
  };
  /** 这一页每位客户的回收状态标（客户三态开着才给，活跃的不在里面）；不给 = 不摆「状态」一列 */
  三态标?: Record<string, 三态标>;
  /** 这一页每位客户的「项目数」「当前节点」（企业版项目模式，11-12 第 3 批；只算我能看的项目）。不给 = 不摆这两列 */
  项目概况?: Record<string, 客户项目概况>;
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
  /** 客户来源筛选的选项（企业版）；含已停用的渠道 */
  渠道筛选项?: { value: string; label: string }[];
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
  rows, total, page, requestedPage, pageSize, users, 能分配公海 = false, 能转出自己的 = false, 能导入导出 = true, 能删 = true, 负责人只能自己 = false, 能新建和领取 = true, 公海分给, channels, 渠道筛选项 = [], filters, 直接新建, 直接粘贴, 本月新增, 直接推荐 = null, 本批, 公海数 = null, 客户数 = null, 客户页签 = "我的", 公海里匹配 = 0, aiEnabled, 旧职位 = [], 国家们 = [], 部门选项 = [], 只读ids = [], 删不了ids = [], 放不了ids = [], 公海别线ids = [], 原负责人领不回ids = [], 转让原因, 金额排序 = "", 等级排序 = "", 创建排序 = "", 能按号码筛 = true, 排序币种, 企业版: 企业 = false, 客户状态选项 = [], 客户状态色, 客户状态自动 = false, 分配方式选项 = [], 客户类型选项 = [], 客户属性选项 = [], 客户属性字典 = [], 字典释义, 建档 = null, 待交接 = null, 项目概况, 三态标, 出口叫法, 项目看板 = false, 看板体, 市场视图 = false, 阶段太多 = false,
}: Props) {
  const router = useRouter();
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

  const { message, modal } = App.useApp();
  const 视图中 = useViewAs();
  const { 问删除 } = useDeleteCustomers();
  const { 先问转走的项目, 问转让原因 } = useTransferConfirm(转让原因);
  const { 问放回公海 } = usePoolReturnConfirm();

  /**
   * 批量改完给一次撤销（排查 D1）。原来点一下就写库、没有退路，选错一页就是一批数据改错。
   * 撤销 = 按原值分组再调一次同一个批量动作（改状态）；改负责人不能这样撤——反向再转一次会把新负责人本来就有的活
   * 一起带走，传 整批退回 走 撤销改负责人，只还这次带过来的（2026-10-04 T-018）
   */
  function 可撤销提示(res: Extract<BulkResult, { ok: true }>, 文案: string, 退回: (ids: string[], 值: string) => Promise<BulkResult>, 整批退回?: () => Promise<BulkResult>) {
    const 原值 = res.原值 ?? [];
    if (!原值.length) return void message.success(文案);
    const key = `bulk-${原值[0].id}-${原值.length}`;
    message.success({
      key,
      duration: 6,
      content: (
        <span>
          {文案}
          <Button
            type="link"
            size="small"
            onClick={async () => {
              message.destroy(key);
              if (整批退回) {
                const r = await 整批退回();
                router.refresh();
                if (!r.ok) return void message.error(`没能全部改回去：${r.error}`);
                return void (r.unchanged
                  ? message.warning(`已撤销 ${r.updated} 条；${r.unchanged} 条没改回（刚被人改过，或原负责人已停用）`)
                  : message.success(`已撤销，${r.updated} 条改回原样`));
              }
              const 组 = new Map<string, string[]>();
              for (const x of 原值) 组.set(x.值, [...(组.get(x.值) ?? []), x.id]);
              for (const [值, ids] of 组) {
                const r = await 退回(ids, 值);
                if (!r.ok) {
                  router.refresh();
                  return void message.error(`没能全部改回去：${r.error}`);
                }
              }
              router.refresh();
              message.success(`已撤销，${原值.length} 条改回原样`);
            }}
          >
            撤销
          </Button>
        </span>
      ),
    });
  }
  /**
   * 公海两个动作的提示条：说清动了几位、几位没动为什么，带一次撤销（和批量改同一个做法）。
   * 「领取」撤销 = 还给原来的人、放回公海；「放进」撤销 = 拿回来；「分配」（老板）撤销同领取，按分到的那位认
   */
  function 公海提示(res: 公海结果, 动作: "放进" | "领取" | "分配", ids: string[]) {
    router.refresh();
    if (!res.ok) return void message.error(res.error);
    const 名 = 动作 === "放进" ? "放回公海" : 动作 === "分配" ? `分给「${res.给谁?.name ?? "同事"}」` : "领取";
    if (!res.updated) {
      return void message.info(动作 === "放进" ? "选中的已经都在公海里了" : 动作 === "分配" ? "选中的已经被领走了，没有可分的" : "选中的已经被领走了，没有可领的");
    }
    const 另 = [
      res.unchanged && (动作 === "放进" ? `${res.unchanged} 位本来就在公海` : `${res.unchanged} 位已被别人领走或不在公海`),
      res.没权限 && `${res.没权限} 位你放不了，没放（只有负责人、直属上级或总管理能放）`,
      res.有订单 && `${res.有订单} 位名下有没结束的订单阶段项目，没放${res.订单项目 ? `（${res.订单项目}）` : ""}`,
      res.交接中 && `${res.交接中} 位正在转让交接中，没放`,
      res.同事在推 && `${res.同事在推} 位名下有同事负责、还没结束的项目，没放${res.同事项目 ? `（${res.同事项目}）` : ""}`,
      res.联系方式不全 && `${res.联系方式不全} 位联系方式空着或有号码不对，没放（改好再放）`,
    ].filter(Boolean);
    const 文案 = 动作 === "分配" ? `已把 ${res.updated} 位${名}${另.length ? `；${另.join("，")}` : ""}${带走说法(res.带走)}` : `已${名} ${res.updated} 位${另.length ? `；${另.join("，")}` : ""}${带走说法(res.带走)}`;
    const 原 = 动作 === "放进" ? ids.map((id) => ({ id, 值: "" })) : (res.原负责人 ?? []);
    const key = `pool-${动作}-${ids[0]}-${ids.length}`;
    message.success({
      key,
      duration: 6,
      content: (
        <span>
          {文案}
          <Button
            type="link"
            size="small"
            onClick={async () => {
              message.destroy(key);
              const r = await 撤销公海(动作, 原, res.ok ? res.带过来 : undefined, res.ok ? res.给谁?.id : undefined, res.ok ? res.公海项目 : undefined);
              router.refresh();
              if (!r.ok) return void message.error(`没能撤销：${r.error}`);
              message.success(`已撤销，${r.updated} 位改回原样`);
            }}
          >
            撤销
          </Button>
        </span>
      ),
    });
  }
  const b = useBusiness();
  // 项目模式开着：新建一律走建档向导（客户、联系人、项目、首条沟通一次建好）
  /**
   * 企业版项目模式（统一公海 P7，2026-10-29）：公海挪去 /pool 一页看，这里不摆「客户 / 公海」页签。
   * 「新建客户」照旧在（项目模式下走建档向导）。?pool=1 的老链接服务端直接转去 /pool
   */
  const 统一公海 = 企业 && b.projectMode === true;
  const 新建 = () => {
    if (b.projectMode && 建档) return set建档开着(true);
    if (b.projectMode) return router.push("/projects/new");
    setEditing(null);
    setFormOpen(true);
  };

  const { f, setF, apply, 翻页, reset, pending } = useUrlFilters("/customers", { ...filters, sort: 金额排序 || 等级排序 || 创建排序, sortCurrency: 排序币种 ?? b.currency }, pageSize);
  /**
   * 「空库」是「一条都没有 **且** 没在筛」。筛出 0 条不算——
   * 那时筛选栏必须留着，否则人看不见自己筛了什么，也点不到重置。
   * 按 filters（服务端那次查询用的条件）判而不是 f（输入框里的草稿）。
   */
  /*
    公海里还有人也不算空库：「客户」页签空了（比如一个人用、全被自动放进了公海），页签和筛选栏得留着，
    不然人看到的是「新建第一位」，以为客户全没了
  */
  const 空库 = total === 0 && !公海数 && !本月新增 && !直接推荐 && !本批 && !Object.values(filters).some((v) => v);
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
  const [formOpen, setFormOpen] = useState(Boolean(直接新建) && !建档);
  /** 「新增客户」向导框（U-新建-01）：和 /projects/new 同一个向导，弹在本页 */
  const [建档开着, set建档开着] = useState(Boolean(直接新建 && 建档));
  const [导入开着, set导入开着] = useState(Boolean(直接粘贴) && 能导入导出 && !企业);
  /** 企业版不用客户页这个旧导入抽屉（11-03）：导入走设置 →「企业版导入」，首页那张「开始」卡同一个去处 */
  const 去导入 = () => (企业 ? router.push("/settings?tab=enterprise") : set导入开着(true));
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

  /** 一共筛着几个。0 的时候「重置」看不见——没筛过的页面上它是个哑按钮（位置留着，见 ResetFilters）。页签不算筛选 */
  const 筛了 = Object.entries(f).filter(([k, v]) => k !== "pool" && v).length;
  /** 重置留在当前页签：在「公海」里点重置，回到的是全部公海，不是跳回「客户」 */
  const 重置 = () => (f.pool && !子集 ? apply({ ...(Object.fromEntries(Object.keys(f).map((k) => [k, ""])) as typeof f), pool: "1" }) : reset());
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
      ...阶段字典.节点们[s].map((n) => ({ value: n, label: n })),
      ...阶段字典.出口们[s].flatMap((o) => (o.结局 ? [{ value: o.结局, label: o.叫法 }] : [])),
    ],
  });
  const 进程选项: SelectProps["options"] = f.phase && (阶段们 as readonly string[]).includes(f.phase) ? 进程组(f.phase as 阶段).options : 阶段们.map(进程组);
  /** 筛选项（11-06 可自定义）：默认外露 = 系统原来摆在外面的；顺序也是原来的顺序 */
  const { 外露: 筛选外露, 更多按钮: 更多筛选按钮 } = useCustomFilters("customers", [
    ...(企业
      ? [{
          键: "custStatus", 名: "客户状态", 宽: 140, 默认外露: true, 有值: !!f.custStatus,
          渲染: (style: CSSProperties) => (
            <Select style={style} placeholder="全部客户状态" allowClear aria-label="客户状态"
              popupRender={(menu) => <>{下拉说明(字典定义.custStatus.说明)}{menu}</>} popupMatchSelectWidth={false}
              {...释义下拉(字典释义?.状态)}
              value={f.custStatus || undefined} onChange={(v) => apply({ custStatus: v ?? "" })}
              options={[...new Set([...客户状态选项, ...(f.custStatus ? [f.custStatus] : [])])].map((s) => ({ value: s, label: s }))} />
          ),
        }]
      : [{
          键: "followStatus", 名: "跟进状态", 宽: 140, 默认外露: true, 有值: !!f.followStatus,
          渲染: (style: CSSProperties) => (
            <Select style={style} placeholder="全部跟进状态" allowClear
              value={f.followStatus || undefined} onChange={(v) => apply({ followStatus: v ?? "" })}
              options={FOLLOW_STATUSES.map((s) => ({ value: s, label: statusLabel(b, s) }))} />
          ),
        }]),
    // 外贸：国家是第一眼要分的（时差、市场、报价口径），摆在外面；只给库里真有的国家
    ...(外贸 && !企业 && (国家们.length > 0 || f.country)
      ? [{
          键: "country", 名: "国家", 宽: 130, 默认外露: true, 有值: !!f.country,
          渲染: (style: CSSProperties) => (
            <Select style={style} placeholder="全部国家" allowClear showSearch
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
            <Select style={style} placeholder="全部等级" allowClear aria-label="客户等级"
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
            <Select style={style} placeholder="全部部门" allowClear aria-label="部门"
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
            <Select style={style} placeholder="全部负责人" allowClear
              value={f.salesOwnerId || undefined}
              onChange={(v) => apply({ salesOwnerId: v ?? "" })}
              options={成员选项(users)} />
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
            <Select style={style} aria-label="阶段" placeholder="全部阶段" allowClear value={f.phase || undefined}
              onChange={(v?: string) => apply({ phase: v ?? "", node: "" })} options={阶段们.map((x) => ({ value: x, label: x }))} />
          ),
        }, {
          键: "node", 名: "进程", 宽: 130, 默认外露: true, 挤: true, 有值: !!f.node,
          渲染: (style: CSSProperties) => (
            <Select style={style} aria-label="进程" placeholder="全部进程" allowClear value={f.node || undefined} popupMatchSelectWidth={false}
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
            <Select style={style} aria-label="回收状态" placeholder="全部回收状态" allowClear value={f.triState || undefined}
              onChange={(v?: string) => apply({ triState: v ?? "" })} options={三态筛选值们.map((x) => ({ value: x, label: 三态显示名(x) }))} />
          ),
        }]
      : []),
    {
      键: "grade", 名: b.fields.grade, 宽: 130, 默认外露: false, 有值: !!f.grade,
      渲染: (style: CSSProperties) => (
        <Select style={style} placeholder={`全部${b.fields.grade}`} allowClear
          value={f.grade || undefined} onChange={(v) => apply({ grade: v ?? "" })}
          options={[...b.grades.map((g) => ({ value: g, label: g })), ...旧职位.map((g) => ({ value: g, label: `${g}（已不在选项里）` }))]} />
      ),
    },
    // 企业版级别默认收着：摆外面 1024 宽会把筛选行挤成两行；列表里「级别」一列默认摆着
    ...(企业
      ? [{
          键: "level", 名: "级别", 宽: 120, 默认外露: false, 有值: !!f.level,
          渲染: (style: CSSProperties) => (
            <Select style={style} placeholder="全部级别" allowClear aria-label="客户级别"
              value={f.level || undefined} onChange={(v) => apply({ level: v ?? "" })}
              options={[...级别选项(), { value: 未分级, label: 未分级 }]} />
          ),
        }, {
          键: "customerType", 名: "客户类型", 宽: 140, 默认外露: false, 有值: !!f.customerType,
          渲染: (style: CSSProperties) => (
            <Select style={style} placeholder="全部客户类型" allowClear aria-label="客户类型"
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
            <Select style={style} placeholder="全部归档档位" allowClear aria-label="归档档位"
              value={f.archiveTier || undefined} onChange={(v) => apply({ archiveTier: v ?? "" })}
              options={归档档位们.map((x) => ({ value: x, label: x }))} />
          ),
        }, {
          // 客户来源（11-06）：建档时选的渠道（Customer.channelId），停用的渠道也能筛，老客户还挂着
          键: "channelId", 名: "客户来源", 宽: 150, 默认外露: false, 有值: !!f.channelId,
          渲染: (style: CSSProperties) => (
            <Select style={style} placeholder="全部客户来源" allowClear aria-label="客户来源" showSearch={{ optionFilterProp: "label" }}
              popupMatchSelectWidth={false}
              value={f.channelId || undefined} onChange={(v) => apply({ channelId: v ?? "" })}
              options={渠道筛选项} />
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
            <Select style={style} placeholder="全部决策状态" allowClear
              value={f.decisionStatus || undefined} onChange={(v) => apply({ decisionStatus: v ?? "" })}
              options={DECISION_STATUSES.map((s) => ({ value: s, label: statusLabel(b, s) }))} />
          ),
        }]
      : []),
    ...(外贸
      ? [{
          键: "source", 名: "来源", 宽: 130, 默认外露: false, 有值: !!f.source,
          渲染: (style: CSSProperties) => (
            <Select style={style} placeholder="全部来源" allowClear showSearch
              value={f.source || undefined} onChange={(v) => apply({ source: v ?? "" })}
              options={[...new Set([...b.sources, ...(f.source ? [f.source] : [])])].map((x) => ({ value: x, label: x }))} />
          ),
        }]
      : []),
    ...(!不问归属 && !外贸 && !企业
      ? [{
          键: "channelOwnerId", 名: "渠道负责人", 宽: 150, 默认外露: false, 有值: !!f.channelOwnerId,
          渲染: (style: CSSProperties) => (
            <Select style={style} placeholder="全部渠道负责人" allowClear
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
    // 国家（11-04 用户：客户列表加国家列，有值才显示）：这一页里有人填了客户所在国家才摆这一列
    ...(rows.some((r) => 有值(r.addrCountry)) ? [{
      title: "国家", key: "addrCountry", width: 宽(96, 68),
      render: (_: unknown, r: CustomerRow) => (有值(r.addrCountry) ? <span className="clamp-1" style={{ display: "block" }} title={r.addrCountry ?? ""}>{r.addrCountry}</span> : 空),
    }] : []),
    { title: "地址", key: "address", width: 180, 默认: false, render: (_: unknown, r) => { const t = 拼地址(r); return t ? <span title={t}>{t}</span> : 空; } },
    {
      title: "官网", key: "website", width: 170, 默认: false,
      render: (_: unknown, r) => {
        const 网址 = 官网网址(r.extra?.website);
        return 网址 ? <a href={网址} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={网址}>{官网短写(r.extra?.website)}</a> : 空;
      },
    },
    { title: "客户分配", key: "assignWay", width: 100, 默认: false, render: (_: unknown, r) => (有值(r.assignWay) ? r.assignWay : 空) },
    // 客户来源（11-05 用户：「列」的可选列里加「客户来源」；P-渠道-01 列里只显示主渠道，悬停看「主|子」全称）= 建档时选的渠道（Customer.channelId，建好就锁），默认收着；渠道名可能很长，一行省略、悬停看全
    {
      title: "客户来源", key: "channelName", width: 120, 默认: false,
      render: (_: unknown, r) => (有值(r.channelName) ? <span className="clamp-1" style={{ display: "block" }} title={渠道显示名(r.channelName)}>{主渠道显示名(r.channelName)}</span> : 空),
    },
  ];

  const 列表: 列<CustomerRow>[] = [
    {
      title: b.customer,
      key: "name",
      dataIndex: "name",
      // 企业版公司名常常很长：原来一行截断、悬停看全（P13）；10-30 用户要「显示完整」，改成整段折行，列放宽到 200 少折几行
      width: 企业 ? 宽(200, 136) : 160,
      常驻: true,
      render: (v, r) => 企业
        ? <RowLink href={`/customers/${r.id}`} className="link-strong fulltext" style={{ display: "block" }} title={v}>{v}</RowLink>
        : <RowLink href={`/customers/${r.id}`} className="link-strong">{v}</RowLink>,
    },
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
      title: "项目数", key: "projectCount", width: 72,
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
    ...(外贸 ? [] : [{
      title: "预计签约", key: "expectedSignAt", dataIndex: "expectedSignAt", width: 宽(116, 100),
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
        ? <Tag className="pool-tag" title={`${公海标签(v)} · ${r.pool.reason === "手动" ? "手动放回公海" : r.pool.reason}`}>{公海标签(v)}</Tag>
        : <UserCell name={v} size={24} />,
    }]),
    // 三列各收一点，1366 宽时默认列和公海列都不用左右拖（10-27）；负责人不收，「公海（原 X）」要放得下
    {
      title: "最近跟进", key: "lastFollowAt", dataIndex: "lastFollowAt", width: 宽(180, 92),
      // 冷热在前：扫一眼这一列就知道谁凉了，日期留着给要细看的人
      // 企业版不摆冷热：它按跟进状态算，企业版不用跟进状态（10-28 去遗留 A1）
      render: (v, r) => (
        <span className="heat-cell">
          {!企业 && <Heat at={v} status={r.followStatus} />}
          <span className="muted nowrap">{smartTime(v)}</span>
        </span>
      ),
    },

    // 这一列一律打码显示，不给复制键：v 没打码时复制了就比屏幕上看到的多（电话、邮箱复制键见 CopyValue）
    { title: "联系电话", key: "phone", dataIndex: "phone", width: 140, 默认: false, render: (v) => <span className="nowrap">{maskPhone(v)}</span> },
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
      title: "", key: "action", width: !不问归属 && rows.some((r) => r.pool) ? 132 : 56, 常驻: true, fixed: "right",
      render: (_, r) => {
        // 虚线下属的客户：编辑、删除点了也会被拦，不摆按钮，直接说只能看
        if (只读的.has(r.id)) return <span className="muted nowrap">只能看</span>;
        const 公海里 = r.pool && !不问归属;
        const 菜单: NonNullable<MenuProps["items"]> = [
          // 老板直接分给某位同事（2026-10-20）：规矩同领取，只是领的人换成选中的那位
          ...(公海里 && 能分配公海 && !公海别线.has(r.id) && 成员选项(分给们).length ? [{
            key: "assign", label: "分配给…",
            children: 成员选项(分给们).map((o) => ({ key: `assign:${o.value}`, label: o.label, onClick: async () => 公海提示(await 分配公海([r.id], o.value), "分配", [r.id]) })),
          }] : []),
          { key: "edit", label: "编辑", onClick: () => { setEditing(r); setFormOpen(true); } },
          // 先数清会一起删掉什么再问（排查 B1，见 useDeleteCustomers）
          ...(能删 && !删不了.has(r.id) ? [{ key: "delete", label: "删除", onClick: () => void 问删除([{ id: r.id, name: r.name }]) }] : []),
        ];
        return (
          <div>
            <Space size={2}>
              {公海里 && 能新建和领取 && (
                <Button className="row-act" aria-label={`领取 ${r.name}`} disabled={领不回.has(r.id)} size="small"
                  onClick={async () => 公海提示(await 领取([r.id]), "领取", [r.id])}>领取</Button>
              )}
              {/* 菜单画在 body 上，但 React 事件照组件树冒泡到这一行：不拦住，点完就跟着进了记录页 */}
              <Dropdown trigger={["click"]} menu={{ items: 菜单, onClick: ({ domEvent }) => domEvent.stopPropagation() }}>
                <Button className="row-act" aria-label={`更多操作 ${r.name}`} type="text" size="small" icon={<MoreOutlined />} />
              </Dropdown>
            </Space>
            {公海里 && 能新建和领取 && 领不回.has(r.id) && <div className="muted" style={{ fontSize: 12, lineHeight: "16px" }}>{原负责人不能领回提示}</div>}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHead
        title={b.customer}
        subtitle="全部档案与跟进"
        /*
          「客户 / 公海」两个页签（2026-10-13：老板、业务员、一个人用的都要「公海和自己的分开看」）。
          摆在标题旁边，不进筛选行：1024 宽时筛选行本来就刚好一行，再塞一个会把「列」挤到第二行（e2e/window-sizes.spec.ts）。
          页签记在地址上（pool=1），翻页、搜索、筛选都留在这一页签里。
          一个人用、公海里也没人时不摆——那时公海就是个空抽屉；空库不摆；子集（筛选行上那三种标记）里不摆：那几个数本来就含公海
        */
        titleAside={!统一公海 && !空库 && !子集 && (users.length > 1 || (公海数 ?? 0) > 0 || f.pool) ? (
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
          /* 主动作在页头右上角，全站六张列表页同一个位置（设计稿 11/PAGE）。
             导出是次动作，排在它左边，空库时没什么可导，不出现 */
          <Space wrap>
            {能看板 && !空库 && !统一公海 && <Segmented<"列表" | "看板"> aria-label="列表 / 看板" options={["列表", "看板"]} value={看法} onChange={set看法} />}
            {/* 导入和导出都是次动作，排在主动作左边。导入空库时也要在——
                第一次进来的人手上那份 Excel 正是他不想一条条录的原因 */}
            {能导入导出 && <Button icon={<ImportOutlined />} disabled={视图中} title={视图中 ? 视图外部话 : undefined} onClick={去导入}>导入</Button>}
            {能导入导出 && !空库 && (<>
              <Button
                icon={<ExportOutlined />}
                loading={导出中}
                disabled={视图中}
                title={视图中 ? 视图外部话 : undefined}
                onClick={async () => {
                  // 按服务端这次查询用的条件导全部（filters），不是当前这一页，也不是输入框里还没搜的草稿
                  const controller = new AbortController();
                  导出取消.current = controller;
                  set导出中(true);
                  try {
                    const r = await 完整导出(filters, b, set导出进度, controller.signal);
                    message.success(`已完整导出 ${r.客户} 位${b.customer}、${r.跟进} 条跟进，ZIP内附分批Excel和核对清单`);
                  } catch (error) {
                    if (!controller.signal.aborted) message.error(error instanceof Error ? error.message : "导出失败，请重试");
                  } finally {
                    导出取消.current = null;
                    set导出中(false);
                    set导出进度("");
                  }
                }}
              >
                导出
              </Button>
              {导出中 && <Space><span role="status" style={{ fontSize: 12 }}>{导出进度}</span><Button size="small" onClick={() => 导出取消.current?.abort()}>取消导出</Button></Space>}
            </>)}
            {能新建和领取 && <Button type="primary" icon={<PlusOutlined />} onClick={新建}>
              新建{b.customer}
            </Button>}
            {/* 离职交接（C15）：页头最右端。谁看得见、数怎么数照原来的入口（离职交接入口），不是这页自己数 */}
            {待交接 != null && <Link href="/projects/handover"><Button>{待交接 ? `离职交接 ${待交接}` : "离职交接"}</Button></Link>}
          </Space>
        }
      />

      {/* 企业版（统一公海）的「列表 / 看板」单独一行：1024 宽开着 AI 栏时，右上那组和标题旁都放不下它（排版闸门） */}
      {统一公海 && 能看板 && !空库 && (
        <div className="cust-view-seg">
          <Segmented<"列表" | "看板"> aria-label="列表 / 看板" options={["列表", "看板"]} value={看法} onChange={set看法} />
        </div>
      )}
      {/* 企业版项目模式：「看板」是按节点分列的项目看板（定稿 UI board()，11-12 第 3 批），记在 cookie 里、服务端换一屏画（projects/board-page.tsx） */}
      {/* 市场角色空库也摆：另一边「我分出去的」不看客户多少 */}
      {项目看板 && (!空库 || 市场视图) && !子集 && (
        <div className="cust-view-seg">
          {市场视图
            ? <Segmented<string> aria-label="客户列表 / 我分出去的" options={[...市场视图名]} value={市场视图名[0]} onChange={(v) => v === 市场视图名[1] && 换客户页看法("board", router)} />
            : <Segmented<"列表" | "看板"> aria-label="列表 / 看板" options={["列表", "看板"]} value={看板体 !== undefined ? "看板" : "列表"} onChange={(v) => 换客户页看法(v === "看板" ? "board" : "list", router)} />}
        </div>
      )}

      {阶段太多 && <div role="status" className="cust-too-many">结果太多，请再加筛选条件</div>}
      <DataList<CustomerRow>
        页="customers"
        // 企业版每格一行、放不下省略号悬停看全（11-01 会议 §11）
        单行={企业}
        不可勾={只读的.size ? (r) => 只读的.has(r.id) : undefined}
        空库={空库}
        没对上={
          公海里匹配 > 0 ? (
            <div className="list-none">
              这里没有符合条件的；
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => (统一公海
                ? router.push(f.keyword ? `/pool?${new URLSearchParams({ keyword: f.keyword })}` : "/pool")
                : apply({ pool: "1", salesOwnerId: "" }))}>
                公海里有 {公海里匹配} 位匹配 ›
              </Button>
            </div>
          ) : 公海页 && !Object.entries(filters).some(([k, v]) => k !== "pool" && v) ? (
            <div className="list-none">公海里现在没有{b.customer}</div>
          ) : undefined
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
          <Space wrap size={[10, 10]}>
            {子集 && f.pool && (
              <Tag closable onClose={() => apply({ pool: "" })} color="processing" style={{ margin: 0, padding: "3px 10px" }}>
                只看公海里的
              </Tag>
            )}
            {/* 从「数据」页那张卡走进来的：说清这是一个子集，并给一条回到全部的路 */}
            {本月新增 && (
              <Tag closable onClose={() => apply({ createdWithin: "" })} color="processing" style={{ margin: 0, padding: "3px 10px" }}>
                只看本月新增
              </Tag>
            )}
            {直接推荐 && (
              <Tag closable onClose={() => apply({ directOf: "" })} color="processing" style={{ margin: 0, padding: "3px 10px" }}>
                只看「{直接推荐}」直接带来的 · {total} 位
              </Tag>
            )}
            {本批 && (
              <Tag closable onClose={() => apply({ batch: "" })} color="processing" style={{ margin: 0, padding: "3px 10px" }}>
                只看刚导入的这一批 · {本批.几位} 位
              </Tag>
            )}
            <ListSearch
              placeholder={外贸 ? `姓名 / 电话 / ${b.fields.school} / 联系人 / 邮箱 / 官网` : `姓名 / 电话 / ${b.fields.school} / ${b.fields.major} / 备注`}
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
        }
        批量={(selected, 清空, 选中行) => {
          const 全领不回 = 选中行.some((r) => r.pool) && 选中行.filter((r) => r.pool).every((r) => 领不回.has(r.id));
          return (
          <>
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
              <Button size="small" icon={<UserSwitchOutlined />}>分配给…</Button>
            </Dropdown>}
            {/* 企业版批量分配（转让）：管理、总管理；负责人只转自己的（11-02，服务端 assignSalesOwner 同样拦） */}
            {!不问归属 && !(公海页 && 能分配公海) && (!企业 || 能分配公海 || (能转出自己的 && !公海页)) && <Dropdown
              menu={{
                // 同样走 成员选项：批量分配比单条更需要认清人，转错了是一批数据
                items: 成员选项(users).map((o) => ({
                  key: o.value,
                  label: o.label,
                  onClick: async () => {
                    if (!(await 先问转走的项目(selected, o.value))) return;
                    const 原因 = await 问转让原因(o.label, o.value);
                    if (原因 === false) return;
                    const res = await assignSalesOwner(selected, o.value, 原因);
                    清空();
                    router.refresh();
                    if (!res.ok) return void message.error(res.error);
                    // 企业版「交接中」（D10）：负责人还没换，等接手人确认，没有可撤销的
                    if (res.交接中 !== undefined) {
                      const 已在 = (res.交接已在路上 ? `；${res.交接已在路上} 名已在移交中（等对方确认），没再发起` : "") + (res.没转 ? `；${res.没转} 名刚被别人改了负责人，没转` : "") + (res.missing ? `；${res.missing} 名已不存在（可能已删除）` : "");
                      return void (res.交接中
                        ? message.success(res.申请移交
                          // 负责人本人转自己的 = 申请移交（X4）：对方确认才生效
                          ? `已发起客户转让：${res.交接中} 名等「${o.label}」确认后生效，确认前仍在原负责人名下${已在}`
                          : `已发起交接：${res.交接中} 名等 ${o.label} 确认，确认前仍在原负责人名下${已在}`)
                        : message.info(`没有发起新的交接${已在 || "：选中的都已归 " + o.label}`));
                    }
                    可撤销提示(res, 批量结果说法(res, `已转给 ${o.label}`), assignSalesOwner, () => 撤销改负责人(res.原值 ?? [], o.value, res.带过来));
                  },
                })),
              }}
            >
              <Button size="small" icon={<UserSwitchOutlined />}>批量分配</Button>
            </Dropdown>}
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
                    const 问 = await 问放回公海(`把 ${ids.length} 位退回公海？`, true, "退回公海");
                    if (!问) return;
                    公海提示(await 放进公海(ids, 问.原因), "放进", ids); 清空();
                    return;
                  }
                  modal.confirm({
                    title: `把 ${selected.length} 位放回公海？`,
                    content: "放回后谁都能领；6 秒内可以撤销。",
                    okText: "放回公海",
                    cancelText: "取消",
                    onOk: async () => { 公海提示(await 放进公海(selected), "放进", selected); 清空(); },
                  });
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
                    if (!res.ok) return void message.error(res.error);
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
              onClick={() => {
                const 不行 = selected.filter((id) => 删不了.has(id)).length;
                if (不行) return void message.warning(`勾的里有 ${不行} 位不是你负责的，删不了；只勾自己负责的再删`);
                void 问删除(
                  selected.map((id) => ({ id, name: 选中行.find((r) => r.id === id)?.name ?? "" })),
                  清空,
                );
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
        }}
        替表格={看板体 !== undefined ? 看板体 : 看法 === "看板" ? <CustomerBoard 行们={rows} 字典={客户属性字典} 加载中={pending} 页={page} 每页={pageSize} 总数={total} 翻页={翻页} 去={(id) => router.push(`/customers/${id}`)} /> : undefined}
        汇总={金额排序 && <Space wrap style={{ marginBottom: 12 }}><span>金额按</span><CurrencySelect aria-label="金额排序币种" value={f.sortCurrency || b.currency} onChange={v => apply({ sortCurrency: v })}/><span>在全部筛选结果中{金额排序 === "amount-asc" ? "升序" : "降序"}排列；其他币种不相加</span></Space>}
        分页={{
          当前页: page,
          每页: pageSize,
          总数: total,
          翻页,
        }}
      />

      {建档 && <建档弹窗 open={建档开着 && 已水合} 标题="新增客户" 数据={建档} onClose={() => set建档开着(false)} />}

      <CustomerForm
        open={formOpen && 已水合}
        editing={editing}
        users={users}
        channels={channels}
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
      />

      {能导入导出 && !企业 && <ImportDrawer
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

"use client";

import { 是空值, 有值, 去空, 空显, 空值符 } from "@/lib/empty-value";
import { useFollowHistory } from "./useFollowHistory";
import { loadCustomerFeed } from "./follow-history-actions";
import { CustomerResearchCard, CustomerResearchTag } from "./useCustomerResearch";


import { Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { 只读上下文, 只能看的格上下文, 资料改挡上下文 } from "./read-only";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LinkPending } from "@/components/NavProgress";
import { Alert, Button, Card, Drawer, Dropdown, Input, Modal, Space, Tag, Avatar, Checkbox, Tooltip, Select, Typography, type MenuProps } from "antd";
import { 客户状态色of } from "@/lib/enterprise/cust-status-color";
import { 原负责人不能领回提示, 公海客户先领取话, 无效客户不能领短话 } from "@/lib/enterprise/pool-rules";
import { 号码保护of } from "@/lib/enterprise/contact-guard";
import {
  DownOutlined,
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  DollarOutlined,
  InboxOutlined,
  UserAddOutlined,
  LockOutlined,
  UnlockOutlined,
  CloseOutlined,
  ThunderboltOutlined as AiOutlined,
} from "@ant-design/icons";
import { motion, AnimatePresence } from "motion/react";
import CopyValue from "@/components/CopyValue";
import InlineConfirm from "@/components/InlineConfirm";
import { useConsequence } from "@/components/ConsequenceDialog";
import TransferBox, { type 转让结果 } from "./TransferBox";
import { showUndo } from "@/components/UndoBar";
import { 跟进类型们, FOLLOW_TYPE_MAP, FOLLOW_STATUSES, DECISION_STATUSES, FOLLOW_RECORD_STATUS_COLOR } from "@/lib/constants";
import { 跟进方式名, 筛选方式名 } from "@/lib/follow-method";
import { 成员选项, dayjs, duration, fmtDate, fmtDateTime, initial, avatarColor, AVATAR_TEXT, 独自一人 } from "@/lib/utils";
import { RowLink, FollowStatusTag, DecisionStatusTag, FOLLOW_TYPE_ICON } from "@/components/ui";
import { useBusiness } from "@/lib/business-client";
import { statusLabel, 外贸订单, 外贸精简, 签约叫 } from "@/lib/business-config";
import { 国家候选, WhatsApp网址, 官网网址, 客户等级, 客户等级说明, type 客户等级 as 客户等级值 } from "@/lib/customer-extra";
import LocalTime from "@/components/LocalTime";
import CompletePlanModal, { type 要完成的计划 } from "./CompletePlanModal";
import FollowUpForm from "./FollowUpForm";
import TaskForm from "./TaskForm";
import PlanForm from "./PlanForm";
import { 刚加的排前 } from "@/lib/fresh-first";
import { 客户页项目地址 } from "@/lib/project/customer-detail-href";
import ContactForm from "./ContactForm";
import ContactAttachments from "./ContactAttachments";
import FollowAttachments from "@/components/FollowAttachments";
import ContactLinks from "./ContactLinks";
import ContractForm, { type ContractRow } from "./ContractForm";
import CustomerForm from "../CustomerForm";
import InlineField from "./InlineField";
import RegionInlineField from "./RegionInlineField";
import AiPanel from "./AiPanel";
import { 登记智能总结 } from "@/lib/ai-float";
import LinkedCustomers from "./LinkedCustomers";
import { FoldSplit, ProjectFold, 模块钮色, 计数题, type 连体主钮, type 连体色 } from "../../projects/[id]/ProjectFold";
import { 客户详情左栏, 客户详情待办 } from "../../projects/[id]/card-names";
import { 沟通都不能记话 } from "@/lib/project/follow-needs-project-text";
import NewProjectEntry from "./NewProjectEntry";
import { 两行, 更多操作菜单 } from "../../projects/[id]/project-menu";
import { 客户页摆法, 级别选项, 企业级别, 拼地址, 地址叫法, 简称上限 } from "@/lib/enterprise/customer-v2";
import LevelLetter from "@/components/LevelLetter";
import StarButton from "./StarButton";
import AiCost, { useAiOutOfCredits } from "@/components/AiCost";
import { toggleTask, deleteTask, deleteFollowUp, completePlan, saveFollowUp, 撤销记一笔 } from "./actions";
import { ContactRemoveInline } from "./useContactRemoval";
import { useTransferConfirm } from "../useTransferConfirm";
import { usePoolReturnConfirm } from "../usePoolReturnConfirm";
import { 历史负责人们, 换负责人一句 } from "@/lib/owner-log";
import { useWidth } from "@/lib/roster";
import PaneToggle from "@/components/PaneToggle";
import BackToList from "@/components/BackToList";
import { 登记详情名 } from "@/lib/page-rows";
import Heat, { 冷热说法, 要看冷热 } from "@/components/Heat";
import { deleteContract, 删签约前清点, assignSalesOwner, 撤销改负责人, 转走项目预览of } from "../actions";
import type { RecordProps, FollowUpRow, ContactRow } from "./types";
import TriStateBar from "./TriStateBar";
import { 短沟通话of } from "@/lib/enterprise/tri-state-quota";
import { 自动推进话of } from "@/lib/project/auto-advance-text";
import { 进公海理由显示 } from "@/lib/enterprise/tri-state-label";
import { useMotionTheme } from "@/components/MotionTheme";
import { 截止说法, 已过期 } from "@/lib/deadline";
import { 金额, 金额或空, 合计文字 } from "@/lib/currency";
import { 公海标签 } from "@/lib/pool";
import { 带走说法 } from "@/lib/carry-over";
import { 移交作废天数 } from "@/lib/enterprise/handover-expire-days";
import { 少动, 滚法 } from "@/lib/reduced-motion";
import { 放进公海, 领取, 撤销公海, 退回原因选项 } from "../pool-actions";
import { useDeleteCustomers } from "../useDeleteCustomers";
import { 释义下拉宽 } from "@/components/DictNote";
import { 客户编号显示 } from "@/lib/customer-no";
import { 客户抬头, 客户显名 } from "@/lib/enterprise/customer-title";
import { 详情背调电话 } from "@/lib/enterprise/primary-contact-phone";
import { 动作出错话, 出错原话 } from "@/lib/stale-deploy";
import { useFormDraft } from "@/components/FormDraft";

/**
 * 记录页（v0.4）：三栏。
 *   左：档案——点一下就能改，不弹窗
 *   中：一条时间线，跟进与签约按时间合成一条流；顶部是速记框，粘一段就能记
 *   右：AI 面板常驻——打开谁，它已经读完了谁；下面是计划与待办
 * 没有页签。联系人 / 商机 / 签约都是档案的一部分，放左栏。
 */

/**
 * 删掉最后一笔签约后跟进状态退到哪一档：退单和录错是两回事，由操作的人选。
 * 标签**运行时拼**，不写死——状态的显示名跟着业务配置走（通用版里「与家人商议」叫「内部讨论」）。
 */
const REVERT_CHOICES = [
  { value: "意向较高", decision: "与家人商议", 说明: "谈崩了，还想再争取" },
  { value: "跟进中", decision: "了解中", 说明: "录错了，回到普通跟进" },
  { value: "已流失", decision: "暂不考虑", 说明: "确定不报了" },
] as const;

type Entry =
  | { kind: "follow"; at: string; f: FollowUpRow }
  | { kind: "contract"; at: string; c: ContractRow };

/** 负责人下拉的选项：现任不在候选里（管理员、已停用）时补进去，标上「（不在候选里）」，别显示成一串 id */
/** 联系方式那一行的叫法：字典里有就用字典的名字；自定义种类存成 custom:<叫法>，停用了也照样显示 */
/** 企业版联系人卡上的号码保护（10-31）：只展示，不能点；为什么开 / 关鼠标停上去看。
 *  11-24 起单独一行（字段名「号码保护」+ 值「已开启 / 已关闭」），标签里只写状态：原来「号码保护：已开启」跟在号码后面、
 *  放不下挪到值那一列下一行，1280 / 1366 卡宽 232、值那一列约 120，整枚标签 121 宽（Linux 字体更宽）伸出卡、收内边距打省略号也只剩「已开…」 */
function 号码保护标签({ c, 客户 }: { c: ContactRow; 客户: Parameters<typeof 号码保护of>[1] }) {
  const { 状态, 原因 } = 号码保护of(c, 客户);
  // 已开启照旧 color="green"；设计语言 D3 · M4-b（D10）加锁，
  // 绿压成灰底由 globals.css 里的 .rec-contact-guard.ant-tag-green 管（绿只给「完成」）
  return (
    <Tag className="rec-contact-guard" color={状态 === "已开启" ? "green" : undefined} icon={状态 === "已开启" ? <LockOutlined /> : <UnlockOutlined />} title={原因} style={{ margin: 0, fontSize: 12, lineHeight: "18px", padding: "0 5px" }}>
      {状态}
    </Tag>
  );
}

function 号码叫法(种类: { 名: string; kind: string }[] | undefined, kind: string) {
  return 种类?.find((x) => x.kind === kind)?.名 ?? (kind.startsWith("custom:") ? kind.slice(7) : kind);
}

function 带上现任(users: { id: string; name: string; email: string }[], 现任: string | null, 现任名: string | null | undefined) {
  const 选项 = 成员选项(users);
  if (现任 && !users.some((u) => u.id === 现任)) 选项.unshift({ value: 现任, label: `${现任名 ?? "（已删除的成员）"}（不在候选里）` });
  return 选项;
}

/** 正文窄于它 AI 栏收进抽屉、窄于它单栏。和 globals.css 里 .rec-page 的几条容器查询是同一对数，改一处要改两处 */
const AI栏门槛 = 1090;
const 单栏门槛 = 630;

/** 企业版客户页头按钮开的框（10-31 改版 R6）→ 框的标题 */
const 客户头部框叫法 = {
  转让: "客户转让",
  管理联系人: "管理联系人",
  关联客户: "关联客户",
  管理关联: "管理关联",
} as const;
type 客户头部框 = keyof typeof 客户头部框叫法;

/** 只能看的格默认空：放模块里，免得每次渲染一个新数组让下面的格子跟着重渲 */
const 无格: string[] = [];

export default function RecordView({
  customer,
  sourceLead = null,
  contacts,
  contracts,
  项目们 = null,
  参与项目们 = null,
  旺旺们 = [],
  联系人附件数 = null,
  tasks,
  plan,
  followUps,
  followUpsHasMore = false,
  users,
  channels,
  aiEnabled,
  上次背调,
  已收藏 = false,
  能放公海 = false,
  能转让客户 = true,
  转让要申请 = false,
  自动分配,
  自动分配方向,
  指定定向,
  自动指定候选,
  原负责人领不回 = false,
  恢复无效,
  只读: 只读档 = false,
  只读话: 全只读话 = "这是虚线下属的客户：只能看，不能改、不能转",
  只读横幅,
  只能看的格 = 无格,
  管理员只读 = false,
  资料改挡 = null,
  能领 = true,
  能改沟通 = true,
  能删沟通 = true,
  换负责人记录 = [],
  客户状态选项 = [],
  客户状态色,
  客户状态自动 = false,
  联系人分类附件数 = null,
  关联们 = null,
  号码种类,
  职务选项,
  分配方式选项 = [],
  客户类型选项 = [],
  客户属性选项 = [],
  字典释义,
  新建项目 = null,
  能新建项目 = true,
  跟进去处 = null,
  转让原因,
  待办计划 = [],
  醒目条 = null,
  项目区 = null,
  项目联系人 = null,
  项目页签们 = null,
  抬头节点 = null,
  三态条 = null,
  历史变更 = null,
  当前项目菜单 = null,
  发起点评钮 = null,
  项目动作口 = null,
  项目忙 = false,
}: RecordProps) {
  // 「加跟进」= 团队版互看同事的客户；「全」= 企业版虚线下属的客户，跟进也不能记
  const 只读 = !!只读档 || 管理员只读;
  const 全只读 = 只读档 === "全" || 管理员只读;
  // 市场成员相关的客户（10-31）也是「全」只读，但不是虚线下属：黄条、提示照服务端那句说（11-03 D3-5）
  const 虚线的 = !全只读话.includes("市场成员");
  const { 曲线, 时长, 间隔 } = useMotionTheme();
  const router = useRouter();
  const AI已用完 = useAiOutOfCredits();
  const b = useBusiness();
  // 企业版只用项目（P14 第 6 条）：时间线是各项目沟通记录的汇总，翻页走汇总那条查询
  const history = useFollowHistory(customer.id, followUps, followUpsHasMore, 跟进去处 !== null ? loadCustomerFeed : undefined);
  const { 先问转走的项目 } = useTransferConfirm(转让原因);
  const { 问放回公海 } = usePoolReturnConfirm();
  /** 后果框（PR5a）：企业版客户退回公海（dt.pool：后果分条、原因点选、其他原地写） */
  const [问后果, 后果框] = useConsequence();
  const revertChoice = useRef<string>(REVERT_CHOICES[0].value);
  /*
    企业版项目模式（10-27 会议：前台冗余优化，先做一版、对方终稿到了再调）：
    基本资料只摆填了的，没填的收进「展开更多」；联系人每人一张小卡，电话 / 邮箱 / 微信各一行完整显示、点了能拨能发；
    推荐关系、签约不摆（纪要：「客户页仅保留 基础信息、联系人、关联项目 三类核心内容」；数据都还在，个人版、团队版不变）
  */
  const 企业 = 项目们 !== null;
  const 页头名 = 企业 ? 客户抬头(customer, 抬头节点) : customer.name;
  /** 提示、弹框标题、头像、AI 面板和背调标签上叫这位（11-19 企业版全称选填：空着兜简称 / 客户编号，不出空引号）；背调认对象照旧只看全称 */
  const 叫这位 = 企业 ? 客户显名(customer) : customer.name;
  /** 客户页留哪几块（定稿 P5 待定 14）：企业版项目模式下记录输入、待办移到项目，转让、背调、下次跟进不放，旧字段不摆 */
  const 摆法 = 客户页摆法(企业);
  const [建项目开着, set建项目开着] = useState(false);
  /** 「新增项目」那张表要的数据第一次打开时才取：取着的时候「开项目」键转圈 */
  const [取建档中, set取建档中] = useState(false);
  /** 企业版页头具名按钮开的框（10-31 改版 R6） */
  const [头部框, set头部框] = useState<客户头部框 | null>(null);
  /** 「客户转让」一个框（dt.transfer） */
  const [转让开, set转让开] = useState(false);
  /** 企业版只用项目：跟进去项目里记，客户页不就地记（第 1、3 条）。跟进去处 = null 是别的版本，照旧 */
  const 去项目跟进 = 摆法.跟进去项目 && 跟进去处 !== null;
  /** 记跟进默认挂的项目：没结束、不在公海的，最近动过的排前面（page.tsx 按 updatedAt 倒序给） */
  const 在推项目 = 项目们?.filter((p) => !p.result && !p.pooledAt) ?? null;
  // 当主客户的项目上勾过的项目身份（P17）：摆在「项目」那一节每行的小字里
  const 主项目身份 = new Map((参与项目们 ?? []).filter((x) => x.主).map((x) => [x.projectId, x.身份]));
  /*
    左栏联系人跟当前项目页签走（11-12 第 2 批 D2）：「关键」= 当前项目的主联系人，排在最前；接着本项目联系人（带角色 / 立场）；再是这位客户的其他联系人。
    没有项目可选（项目联系人 = null）退回客户级「主要联系人」
  */
  const 本项目联系人 = new Map((项目联系人?.本项目 ?? []).map((x, i) => [x.contactId, { ...x, 序: i }]));
  const 是关键 = (c: ContactRow) => (项目联系人 ? c.id === 项目联系人.主 : c.isPrimary);
  const 联系人档 = (c: ContactRow) => (!项目联系人 ? 0 : c.id === 项目联系人.主 ? 0 : 本项目联系人.has(c.id) ? 1 : 2);
  const 排好的联系人 = 项目联系人
    ? [...contacts].sort((a, c) => 联系人档(a) - 联系人档(c) || (本项目联系人.get(a.id)?.序 ?? 0) - (本项目联系人.get(c.id)?.序 ?? 0))
    : contacts;
  /** 「这位客户的其他联系人」那行小标题摆在第一位「其他」前面；本项目一个联系人都没挂就不摆（全是其他，用不着分） */
  const 其他起点 = 项目联系人 && 排好的联系人.some((c) => 联系人档(c) < 2) ? 排好的联系人.find((c) => 联系人档(c) === 2)?.id ?? null : null;
  // 时间线「项目：X」：是项目区页签里的项目就直接切到那个页签的沟通卡（同一页软跳、保住 #project-follow），别的照旧去 /projects/<id> 让服务端判（审查 #3）
  const 页签集 = new Set(项目页签们 ?? []);
  /**
   * 这位作为关联客户参与的项目：服务端已算好项目页会跳去的地址（page.tsx 补项目去，跳转优化 PR-A），时间线、待办里那行点了直接去，
   * 不经过 /projects/<id> 再 replace 那段空正文。拿不准的服务端给的就是 /projects/<id>，和原来一样
   */
  const 参与去 = new Map((参与项目们 ?? []).flatMap((x) => (!x.主 && x.项目去 ? [[x.projectId, x.项目去] as const] : [])));
  const 别家项目地址 = (id: string, hash = "#project-follow") => { const 到 = 参与去.get(id); return 到 ? `${到}${hash}` : `/projects/${encodeURIComponent(id)}${hash}`; };
  const 时间线项目地址 = (id: string) => (页签集.has(id) ? 客户页项目地址(customer.id, id, "#project-follow") : 别家项目地址(id));
  const [资料全开, set资料全开] = useState(false);
  /*
    外贸模版（2026-10-05 外贸客户建议）：签约就是订单——左栏「签约」那一节叫「订单」（订单号那几格 2026-10-29 随订单表删了）；
    不摆预计签约、推荐关系、渠道负责人；档案里多国家 / WhatsApp / 微信 / 邮箱 / 来源
  */
  const 外贸 = 外贸精简(b);
  const 是订单 = 外贸订单(b);
  const 叫 = 签约叫(b);
  const 档 = customer.extra;
  /** 切回通用模版后，填过的外贸档案照样摆出来（二审：搜得到却看不出为什么，像数据丢了） */
  const 摆档案 = 外贸 || (!!档 && Object.values(档).some(Boolean));
  const wa = WhatsApp网址(档?.whatsapp);
  /** 有 WhatsApp 号：记跟进、排计划、完成小框的方式都默认 WhatsApp（2026-10-17 PR26 手测，和手机上一样） */
  const 有WhatsApp = !!档?.whatsapp?.trim();
  const 官网 = 官网网址(档?.website);
  /** 企业版：这一格摆不摆。填了的总摆；没填的点「展开更多」才摆，摆出来照样点一下就能填 */
  // 导入时拿 "-" 占位的也算没填（11-01，lib/empty-value.ts）：收进「展开更多」、计进没填几项
  const 摆 = (v: unknown) => !企业 || 资料全开 || !是空值(v);
  /** 企业版：档案那组（国家、邮箱、微信……）展开后没填过也摆，好补 */
  const 摆档案组 = 摆档案 || (企业 && 资料全开);
  // 企业版不摆渠道负责人（10-28 去遗留 A3：来源只问渠道，不按推荐链分负责人）
  const 摆渠道负责人 = !外贸 && !企业 && !独自一人(users, customer.channelOwnerId);
  /** 企业版收起了几格没填的：数给「展开更多 N 项」 */
  const 地址文字 = 拼地址(customer);
  const 级别值 = 企业级别(档?.level);
  const 没填几项 = 企业
    ? (摆法.旧字段
        ? [
            customer.school, customer.major, customer.grade,
            档?.country, 档?.whatsapp, 档?.email, 档?.wechat, 档?.alibabaId, 档?.source, 档?.level, 档?.website,
            ...(摆渠道负责人 ? [customer.channelOwnerId] : []),
            ...(!外贸 ? [customer.expectedSignAt] : []),
            customer.remark,
          ]
        // 简称固定摆第二行、「公司」格不摆（11-17 客户抬头 PR-1b），都不算进「展开更多」
        : [级别值, customer.customerType, customer.customerAttr, 地址文字, 档?.website, customer.assignWay, customer.remark]
      ).filter((v) => 是空值(v)).length
    : 0;
  /**
   * 右栏「背调」查谁（lib/research/subject.ts）：公司那一栏 + 国家 / 官网 / 电话 / WhatsApp。
   * 企业版客户没有电话（E-260）：电话取主联系人的第一个号（主表电话格空着取号码几行里第一个号码类），口径同 primary-contact-phone.ts
   */
  const 背调电话 = 企业 ? 详情背调电话(contacts) || null : customer.phone;
  const 背调档案 = useMemo(
    () => ({ company: customer.school, country: 档?.country, website: 档?.website, phone: 背调电话, whatsapp: 档?.whatsapp }),
    [customer.school, 背调电话, 档?.country, 档?.website, 档?.whatsapp],
  );
  /** 下次跟进过了几天（按日历天；今天到期不算过） */
  /** 已签约按币种分开写（「US$ 3,200 · ¥ 18,000」）——不同币种不能加在一起。老调用方没给 signedTotals 就按人民币 */
  const 已签约文字 = 合计文字(customer.signedTotals ?? [{ 币种: "CNY", 合计: customer.signedAmount }]);
  const 计划过期天 = plan ? Math.max(0, dayjs().startOf("day").diff(dayjs(plan.plannedAt).startOf("day"), "day")) : 0;
  // 右边的全局 AI 面板据此知道「他」「这位」是谁（lib/ai-context-page.ts 的客户详情那支）
  useEffect(() => {
    登记详情名(叫这位);
    return () => 登记详情名(null);
  }, [叫这位]);

  const [filter, setFilter] = useState<string>("全部");
  const [memo, setMemo] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);
  // 速记框打了没记的字留草稿（复盘第 1 类，25C）：按客户分，刷新、发版后带回；记上了（直接记、AI 解析后存上）就删
  const 速记稿 = useFormDraft({ 键: `客户速记:${customer.id}`, 值: { memo }, 带回: (v) => { if (v.memo !== undefined) setMemo(v.memo); } });

  const [followOpen, setFollowOpen] = useState(false);
  const [followInit, setFollowInit] = useState<{ record: FollowUpRow | null; aiText?: string }>({ record: null });
  const [taskOpen, setTaskOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  /*
    从到点提醒点进来（desktop/reminders.js 带 ?focus=plan:… / task:…）：把那一条滚到眼前、闪一下，
    人不用在一页里自己找「刚才叫我的是哪件事」。闪完把参数去掉，刷新不会再闪一遍
  */
  useEffect(() => {
    const 参 = new URLSearchParams(window.location.search);
    /* 首页背调卡上点「记一条跟进」带过来的（?do=followup）：进来就打开跟进表单，打开后把参数去掉，刷新不会再弹 */
    if (参.get("do") === "followup") {
      window.history.replaceState(null, "", window.location.pathname);
      // 等这一页画完再弹：表单要量弹窗位置，挂载同一拍里打开会先闪一下
      // 企业版只用项目：跟进记在项目里，这里同「跟进」按钮一样跳到项目（P14 第 3 条）
      const t = setTimeout(() => 点跟进首次.current(), 0);
      return () => clearTimeout(t);
    }
    const 要 = 参.get("focus");
    if (!要) return;
    const el = document.querySelector<HTMLElement>(`[data-focus="${CSS.escape(要)}"]`);
    // 只改地址、不重新取页面：router.replace 会让服务端按「没有 focus」重画，计划条随即换回最早那条，
    // 人刚看到叫他的那条闪一下就被换走了（整套 e2e 抓到过新旧两份同在页面上）。原生 replaceState 接进 Next 路由，不重画
    window.history.replaceState(null, "", window.location.pathname);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: 滚法() });
    el.classList.add("rec-tl-item-flash");
    const t = setTimeout(() => el.classList.remove("rec-tl-item-flash"), 1600);
    return () => clearTimeout(t);
    // 只在进来那一下看
  }, []);
  /** 进来那一下用的「点跟进」（?do=followup）：只在第一次画完时调，拿第一次的就够 */
  const 点跟进首次 = useRef(点跟进);
  /** 这次打开计划表单是「排下一次」（新建，默认一周后），不是改眼前这条（审查 M10） */
  const [排新计划, set排新计划] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  // 刚加的联系人（11-03 C1-8）：这一页上排最前、底色闪一下淡掉（只动底色不位移，减弱动态下照样不晃）
  const [刚加的联系人, set刚加的联系人] = useState<string | null>(null);
  /** 企业版左栏联系人（设计语言 D3 · M4-a 方案 A）：先摊开前 3 位，其余收在「展开其余 N 位」后面 */
  const [其余联系人开, set其余联系人开] = useState(false);
  /** 手机上「历史负责人」点「变更记录」开的底部面板（设计语言 D3 · M3-c） */
  const [变更记录开, set变更记录开] = useState(false);
  const [editingContact, setEditingContact] = useState<ContactRow | null>(null);
  const [custOpen, setCustOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<ContractRow | null>(null);
  /**
   * 两条断点（见 globals.css 里 .rec 上面那段）：
   * 1440 以下名单收成抽屉，1180 以下 AI 也收成抽屉。
   * 收起来的东西必须有一个看得见的开关，否则就是没了。名单的开关是页头最左边那颗（PaneToggle）。
   */
  /**
   * AI 栏收不收看正文实际多宽，不看视口：右边的全局面板开着时视口断点会误判（见 lib/roster.ts）。
   * 1090 = 资料 240 + AI 栏 340 + 两道间距 + 时间线至少 480。原来是 908（视口 1180 减左栏和留白，那时还没有名单），
   * 时间线只剩不到 300：1512 宽的 15 寸、1920 开着面板，「直接记」都折到第二行，最要紧的一栏最窄（2026-10-03 五档窗口走查）。
   * 收起来的 AI 栏在头部「AI」按钮里，一点就开。630 以下单栏。
   *
   * 量到之前（服务端渲染的那一帧、刚进页还没量）不猜：AI 栏和「AI」按钮都渲染，由 globals.css 里
   * .rec-page 的容器查询按正文实际宽度只露一个，排版也是容器查询排的。原来按视口猜（≤1673 算窄），
   * 服务端那帧不知道视口一律当宽、也不知道名单露没露着 / 右边面板开没开，第一帧三栏、一量缩成两栏，整页跳一下（2026-10-29）。
   */
  const recRef = useRef<HTMLDivElement>(null);
  const 正文宽 = useWidth(recRef);
  const 量到 = 正文宽 !== null;
  const AI在抽屉里 = 量到 && 正文宽 < AI栏门槛;
  const 单栏 = 量到 && 正文宽 < 单栏门槛;
  const [AI抽屉开着, setAI抽屉开着] = useState(false);
  /*
    企业版客户页的「AI」改叫浮窗（dt.ai）后，「生成智能总结」（扣 1 次额度）不能丢：登记给浮窗，
    浮窗里点「总结这位客户」就开这个原抽屉——同一个 AiPanel、同一次扣减和确认（lib/ai-float.ts）
  */
  const 有项目区 = !!项目区;
  useEffect(() => (有项目区 && aiEnabled ? 登记智能总结(() => setAI抽屉开着(true)) : undefined), [有项目区, aiEnabled]);

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [
      ...history.rows.filter((f) => filter === "全部" || filter === f.type).map((f) => ({ kind: "follow" as const, at: f.occurredAt, f })),
      // 企业版「沟通记录」只汇总跟进（P14 第 6 条），签约不混进来
      ...(!摆法.沟通汇总 && (filter === "全部" || filter === "CONTRACT") ? contracts.map((c) => ({ kind: "contract" as const, at: c.signedAt, c })) : []),
    ];
    return list.sort((a, b2) => dayjs(b2.at).valueOf() - dayjs(a.at).valueOf());
  }, [history.rows, contracts, filter, 摆法.沟通汇总]);

  const openTasks = tasks.filter((t) => !t.done);
  /** 企业版待办卡多摆的两样（P14 第 2 条）：没完成的跟进计划、进行中项目的下一步（10-29 起有一句「做什么」+ 可空的时间；老数据只有时间） */
  const 计划行 = 去项目跟进 ? 待办计划 : [];
  const 下一步行 = 去项目跟进 ? (跟进去处 ?? []).filter((p) => !p.结束 && (p.下一步 || p.下一步文字)) : [];
  const 待办数 = openTasks.length + 计划行.length + 下一步行.length;

  /**
   * 待办勾完成：这一条原地留几秒（划线），提示里给「撤销」，然后再收起（交互审查 S7-③）。
   * 原来一勾就从记录页消失，记录页又不列已完成的，误勾了只能去「跟进 → 计划 → 已完成」里找。
   *
   *   勾选态 —— 先按人点的来（乐观），服务端的 done 跟上来以后这一条自己退掉
   *   留着   —— 勾完成的那几条，到点收起；撤销了（服务端又是未完成）也自己退掉
   * 撤销 = 取消完成，走同一个 toggleTask；在留着的那几秒里把勾点掉也是撤销。
   */
  const [勾选态, set勾选态] = useState<Record<string, boolean>>({});
  const [留着, set留着] = useState<string[]>([]);
  const 收起计时 = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const m = 收起计时.current;
    return () => m.forEach((t) => clearTimeout(t));
  }, []);
  // 服务端的待办换了一版（router.refresh 回来）就对一下账，在渲染里改，不放 effect
  const [上次的待办, set上次的待办] = useState(tasks);
  if (上次的待办 !== tasks) {
    set上次的待办(tasks);
    const 服务端 = new Map(tasks.map((t) => [t.id, t.done]));
    const 剩态 = Object.entries(勾选态).filter(([id, v]) => 服务端.has(id) && 服务端.get(id) !== v);
    if (剩态.length !== Object.keys(勾选态).length) set勾选态(Object.fromEntries(剩态));
    const 剩留 = 留着.filter((id) => 服务端.get(id) !== false);
    if (剩留.length !== 留着.length) set留着(剩留);
  }
  const 已完成 = (t: { id: string; done: boolean }) => 勾选态[t.id] ?? t.done;
  // 服务端按「未完成在前、再按截止」排，刚勾完的那条会跳到末尾；这里只按截止排，它就还在原处
  const 待办行 = tasks
    .filter((t) => !已完成(t) || 留着.includes(t.id))
    .sort((a, b2) => (a.dueAt ?? "").localeCompare(b2.dueAt ?? ""));
  /** 留几秒。和提示条一样长：提示收了，这一条也收 */
  const 留秒 = 5;

  /** 待办被挡的原因：就地写在那一行下面（不弹顶部提示），过几秒自己收 */
  const [待办错, set待办错] = useState<Record<string, string>>({});
  const 报待办错 = (id: string, 话: string) => {
    set待办错((s) => ({ ...s, [id]: 话 }));
    setTimeout(() => set待办错((s) => { const { [id]: _丢, ...剩 } = s; return 剩; }), 5000);
  };
  async function 勾待办(t: (typeof tasks)[number], 完成: boolean) {
    const 计时 = 收起计时.current.get(t.id);
    if (计时) clearTimeout(计时);
    收起计时.current.delete(t.id);
    set勾选态((s) => ({ ...s, [t.id]: 完成 }));
    if (完成) set留着((s) => (s.includes(t.id) ? s : [...s, t.id]));
    // 被服务端挡了（权限、这条已经不在了）回 ok:false，不是抛错：照样当没改成，不提示成功（PR10a）；原因就地写在这一行
    const r = await toggleTask(t.id, 完成).catch(() => ({ ok: false as const, error: "没改成，再试一次" }));
    if (!r.ok) {
      // 勾选回到服务端的样子：勾完成没成 → 不划线、不收起；撤销没成 → 还是已完成，照常过几秒收起
      set勾选态((s) => {
        const { [t.id]: _丢, ...剩 } = s;
        return 剩;
      });
      if (完成) set留着((s) => s.filter((x) => x !== t.id));
      else 排收起(t.id);
      报待办错(t.id, r.error || "没改成，再试一次");
      router.refresh();
      return;
    }
    router.refresh();
    if (!完成) return;
    // 勾完成一步做完（P-界面-40）：底部撤销条，撤销 = 改回未完成
    showUndo({
      话: `「${t.title}」已完成`,
      毫秒: 留秒 * 1000,
      撤销: async () => {
        const u = await toggleTask(t.id, false).catch(() => ({ ok: false as const, error: "没改回来，再试一次" }));
        if (u.ok) {
          set勾选态((s) => ({ ...s, [t.id]: false }));
          set留着((s) => s.filter((x) => x !== t.id));
        }
        router.refresh();
        return u;
      },
    });
    排收起(t.id);
  }
  /** 勾完成的那条留 留秒 秒再收起 */
  function 排收起(id: string) {
    收起计时.current.set(
      id,
      setTimeout(() => {
        收起计时.current.delete(id);
        set留着((s) => s.filter((x) => x !== id));
      }, 留秒 * 1000),
    );
  }
  /**
   * 完成眼前这条计划（审查 M10）。提示里带「撤销」和「排下一次」：
   * 原来点完「下次跟进」那块直接变成「尚未安排」，点错了改不回来，做完了也没人问下一次什么时候
   */
  /** 点了「下次跟进」上的完成：先弹小框记一笔（2026-10-16 外贸基础，CompletePlanModal） */
  const [在完成, set在完成] = useState<要完成的计划 | null>(null);
  /**
   * 页头下面那一行就地提示（不弹顶部 message）：领取没成、只能看、公海客户先领取、刷新没跟上、删沟通没成……
   * 错的 role=alert，别的 role=status；过几秒收
   */
  const [就地话, set就地话] = useState<{ 话: string; 错?: boolean } | null>(null);
  const 说就地 = (话: string, 错 = false) => set就地话({ 话, 错 });
  // 删除前预检被挡：原因写在页头下面那一行（不弹顶部提示）
  const { 问删除 } = useDeleteCustomers((话) => 说就地(话, true));
  // 过几秒收（换了一句就重新计时）
  useEffect(() => {
    if (!就地话) return;
    const t = setTimeout(() => set就地话(null), 6000);
    return () => clearTimeout(t);
  }, [就地话]);
  // 项目「完成节点」框里窗外项点「去客户页」带着 #field-xxx 来（11-03 A6-1）：没填的格收在「展开更多」里，先展开再滚到那一格；
  // 这一页上找不到那一格（这一版客户页不摆、旧链接）就在页头下面说一句，不让人对着整页找（#402 复审）
  useEffect(() => {
    const m = /^#field-(\w+)$/.exec(window.location.hash);
    if (!m) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 地址栏的 hash 只有到了浏览器里才读得到，只在进页时跑一次
    set资料全开(true);
    const t = window.setTimeout(() => {
      const 格 = document.querySelector<HTMLElement>(`[data-field="${m[1]}"]`);
      if (!格) return void set就地话({ 话: "这一页上没有要补的那一格，回项目页看缺项上写的在哪里填" });
      格.scrollIntoView({ block: "center", behavior: "smooth" });
      格.focus();
    }, 80);
    return () => window.clearTimeout(t);
  }, []);
  /** 速记框下面一行：没记上的原因、记上了顺带的提示（领取了 / 不算有效沟通） */
  const [速记话, set速记话] = useState<{ 话: string; 错?: boolean } | null>(null);
  /** 「加载更早的跟进」没成：原因写在按钮下面 */
  const [加载错, set加载错] = useState<string | null>(null);

  /** 计划完成后的就地说法（不弹顶部提示）：成了在「下次跟进」那块写一句 + 「排下一次」文字链接；没成写原因。过几秒收 */
  const [计划话, set计划话] = useState<{ 话: string; 错?: boolean } | null>(null);

  /** 刚完成的那条：刷新回来前「下次跟进」那块先当它没了（摆那句话 + 「排下一次」），撤销了再摆回来 */
  const [刚完成, set刚完成] = useState<string | null>(null);
  const 说计划 = (x: { 话: string; 错?: boolean }) => set计划话(x);
  useEffect(() => {
    if (!计划话) return;
    const t = setTimeout(() => set计划话(null), 8000);
    return () => clearTimeout(t);
  }, [计划话]);
  const 现计划 = plan && plan.id !== 刚完成 ? plan : null;
  async function 完成计划(p: Pick<NonNullable<typeof plan>, "id" | "subject">, 顺带?: string, 已完成 = false) {
    if (!已完成) {
      const result = await completePlan(p.id).catch(() => ({ ok: false as const, error: "计划完成失败，请稍后重试" }));
      if (!result.ok) return void 说计划({ 话: result.error, 错: true });
    }
    router.refresh();
    void window.desktopReminders?.刷新();
    const 话 = 顺带 ?? `「${p.subject}」已完成`;
    set刚完成(p.id);
    说计划({ 话 });
    // 撤销走底部撤销条（撤销 = 改回未完成）；「排下一次」先用「下次跟进」那块里的文字链接（UndoBar 第二个动作合并后再换）
    showUndo({
      话,
      毫秒: 6000,
      撤销: async () => {
        const result = await completePlan(p.id, false).catch(() => ({ ok: false as const, error: "计划恢复失败，请稍后重试" }));
        if (result.ok) { set计划话(null); set刚完成(null); }
        void window.desktopReminders?.刷新();
        router.refresh();
        return result;
      },
    });
  }

  // 历史页编辑/删除也推进客户版本；翻页本身不使AI缓存失效。
  const fingerprint = `${customer.updatedAt}:${followUps.length}:${followUps[0]?.occurredAt ?? ""}:${followUps[0]?.id ?? ""}`;

  /** 公海（第 6 块）：放进 / 领取这一位，提示条上带一次撤销（和列表上同一个做法） */
  async function 公海动作(动作: "放进" | "领取") {
    if (企业 && 动作 === "放进") return 企业退回公海();
    if (动作 === "领取" && !(await 先问转走的项目([customer.id]))) return;
    // 企业版放回前确认：联系人、项目一起退 + 必选退回原因（U-客户-04 / M-公海-09）；别的版本不问
    const 问 = 动作 === "放进" ? await (企业 ? 问放回公海("把这位客户退回公海？", 企业, "客户退回公海") : 问放回公海("把这位客户放回公海？", 企业)) : null;
    if (问 === false) return;
    const res = 动作 === "放进" ? await 放进公海([customer.id], 问?.原因) : await 领取([customer.id]);
    // 原负责人放进公海后自己就看不到这位了（11-03），留在详情页刷新是 404：回列表，提示条上的撤销还在
    if (企业 && 动作 === "放进" && res.ok && res.updated) router.push("/customers");
    else router.refresh();
    if (!res.ok) return void 说就地(res.error, true);
    if (!res.updated) return void 说就地(动作 === "放进" ? "已经在公海里了" : "已经被别人领走了");
    const 原 = 动作 === "领取" ? (res.原负责人 ?? []) : [{ id: customer.id, 值: "" }];
    // 成了走底部撤销条（PR5a showUndo）：撤销 = 反着做一遍；撤不了原因写在条上
    showUndo({
      话: 动作 === "放进" ? "已放回公海，谁都能领" : `已领取，负责人改成你${带走说法(res.带走)}`,
      毫秒: 6000,
      撤销: async () => {
        const r = await 撤销公海(动作, 原, res.ok ? res.带过来 : undefined, undefined, res.ok ? res.公海项目 : undefined);
        router.refresh();
        return r;
      },
    });
  }

  /**
   * 组员能记（11-17 客户定，限本项目的组员）：只能看的客户上有我已进组的在推项目，就照样开记沟通框——
   * 只新记沟通（框里不给待办 / 提醒、不顺带待办 / 计划，只读 = true），关联项目只列这几个；改、删已有的照旧不给
   */
  const 组员可记 = 全只读 && !管理员只读 && 去项目跟进 && (跟进去处 ?? []).some((p) => !p.结束 && p.能记 === true);
  function openFollow(record: FollowUpRow | null, aiText?: string) {
    if (全只读 && !(组员可记 && !record?.id)) return void 说就地(管理员只读 ? "管理员只能看，不能改任何数据" : 全只读话);
    setFollowInit({ record, aiText });
    setFollowOpen(true);
  }

  /** 公海回收站里的无效客户恢复成有效（系统管理员、回收站副手；同公海列表行上的「恢复」）：成了刷新，标和灰着的领取一起没了，没成原因写在页头下面 */
  const [恢复中, set恢复中] = useState(false);
  async function 恢复这位() {
    if (!恢复无效 || 恢复中) return;
    set恢复中(true);
    try {
      const r = await 恢复无效([customer.id]);
      if (!r.ok) return void 说就地(r.error, true);
      if (!r.updated) return void 说就地("已经恢复过了，刷新看看");
      说就地("已恢复成有效客户，还在公海里，能领取了");
      router.refresh();
    } catch {
      说就地("没恢复上，刷新后再试", true);
    } finally {
      set恢复中(false);
    }
  }

  const 能建项目 = !!(摆法.新建项目 && 新建项目 && !只读 && 能新建项目);
  /** 公海里的客户先领取再建项目（11-05）：按钮照摆，点了说先领取，服务端也拦；标了无效的领不了，说先恢复 */
  function 开建项目() {
    if (customer.pool) return void 说就地(customer.pool.无效 ? 无效客户不能领短话 : 公海客户先领取话);
    set建项目开着(true);
  }
  /**
   * 沟通必须挂项目（11-17）：首页 AI 记沟通卡上「去建项目」带 ?建项目=1 进来——能建项目就直接打开新建项目，参数用完去掉（刷新不再弹）。
   * 不用 useSearchParams：这页的界面测试桩里没有它
   */
  useEffect(() => {
    let q: URLSearchParams;
    try { q = new URLSearchParams(window.location.search); } catch { return; }
    if (q.get("建项目") !== "1") return;
    // 等首屏画完再去参数、开表（不在 effect 里同步改状态；开发模式 effect 跑两遍时第一遍的定时器被清掉，参数还在）
    const t = window.setTimeout(() => {
      q.delete("建项目");
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${q.size ? `?${q}` : ""}${window.location.hash}`);
      if (能建项目) 开建项目();
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在进页面时看一次
  }, []);
  /**
   * 「新建沟通」（11-01 会议 §5：客户详情也不跳转，弹窗填）：企业版只用项目时，这位客户有没结束的项目（主客户的 + 关联进来的）
   * 就开记跟进的弹窗，「关联项目」默认选最近动过的那个，保存走项目那条（记项目沟通Action，同项目详情）；
   * 一个在推的项目都没有就开新开项目弹窗（自动带上这位）。别的版本照旧就地记一笔
   */
  const 记沟通项目 = 去项目跟进
    // X-143：只列我能记的（和项目详情记沟通同一条判断：负责人、11-17 起加已进组的组员）。老数据 / 夹具没这一项的照旧列；只读客户上只认明说能记的
    ? (跟进去处 ?? []).filter((p) => !p.结束 && (组员可记 ? p.能记 === true : p.能记 !== false)).map((p) => ({ id: p.id, name: p.主 ? p.名 : `${p.名}（关联）` }))
    : 在推项目;
  const 跟进按钮字 = "记一条沟通";
  function 点跟进() {
    // 只读的客户（虚线下属、市场成员相关）：先说只能看，别说「还没有在推的项目」——项目可能有，只是他看不到（11-03 D3-3）
    if (全只读 && !组员可记) return void 说就地(全只读话);
    // 沟通必须挂项目（11-17，取代 P-界面-35）：没有能记的在推项目也打开，弹框里说先建项目、给「新建项目」（不自动建项目）；写好的内容留在框里
    openFollow(null);
  }

  /**
   * 企业版「客户退回公海」（dt.pool，P-界面-40 后果框 + P-界面-42 原因）：一个框写清后果、原因点选（其他原地写、必填）；
   * 没成原因写在框里不关框。成了回列表（原负责人放进去后自己就看不到这位了，11-03），底部撤销条跟着到列表、6 秒内可撤
   */
  async function 企业退回公海() {
    let 选项: string[] = [];
    try { 选项 = await 退回原因选项(); } catch { 选项 = []; }
    let 结果: Awaited<ReturnType<typeof 放进公海>> | null = null;
    const 成了 = await 问后果({
      题: `把「${叫这位}」退回公海`,
      后果: [
        { 标: "一起退", 话: "名下联系人、项目一起进公海，同事领了客户就一起归他", 级: "警" },
        { 标: "看不到", 话: "你不能再领回来，也看不到它了", 级: "危" },
        { 标: "能撤销", 话: "6 秒内可以撤销" },
      ],
      ...(选项.length ? { 原因: { 选项, 叫: "退回原因（必选）" } } : {}),
      是: "退回公海",
      做: async (原因) => {
        const r = await 放进公海([customer.id], 原因 ?? null);
        if (!r.ok) return r;
        if (!r.updated) return { ok: false, error: "已经在公海里了，刷新看看" };
        结果 = r;
      },
    });
    const r = 结果 as Awaited<ReturnType<typeof 放进公海>> | null;
    if (!成了 || !r || !r.ok) return;
    showUndo({
      话: `已把「${叫这位}」退回公海`,
      毫秒: 6000,
      撤销: async () => {
        const u = await 撤销公海("放进", [{ id: customer.id, 值: "" }], r.带过来, undefined, r.公海项目);
        router.refresh();
        return u;
      },
    });
    router.push("/customers");
  }

  /**
   * 「客户转让」（dt.transfer）：选人、一起转走的项目、原因在同一个框里（TransferBox），assignSalesOwner（权限、虚线只读、交接要确认都在服务端挡）。
   * 回 ok:false = 框里写原因不关框；申请移交回一句话、框里原地说；直接转的给底部撤销条
   */
  async function 发转让(o: { value: string; label: string }, 原因: string | null, 方向?: "内贸" | "外贸"): Promise<转让结果> {
    const res = await assignSalesOwner([customer.id], o.value, 原因, 方向);
    router.refresh();
    if (!res.ok) return { ok: false, error: res.error };
    // 企业版「交接中」（D10）：负责人还没换，等接手人确认，没有可撤销的——框里原地说一句
    if (res.交接中 !== undefined) {
      if (res.交接中) return { ok: true, 话: res.申请移交 ? `已发起客户转让，等「${o.label}」确认后生效，确认前仍在你名下` : `已发起交接：等 ${o.label} 确认，确认前仍在原负责人名下` };
      return { ok: false, error: res.交接已在路上 ? `这位${b.customer}已在移交中（等对方确认），没再发起` : res.没转 ? `这位${b.customer}刚被别人改了负责人，没转` : res.missing ? `这位${b.customer}已不存在（可能已删除）` : `没有发起新的交接：已归 ${o.label}` };
    }
    if (!res.updated) return { ok: false, error: res.带走?.没转成 || res.没转 ? `这位${b.customer}刚被别人改了负责人，没转` : res.missing ? `这位${b.customer}已不存在（可能已删除）` : `本来就归 ${o.label}` };
    // 直接转（实线上级、条线总管理、系统管理员，P-转-16）：底部撤销条，撤销 = 改回原负责人；撤不了原因写在条上
    showUndo({
      话: `已转给 ${o.label}${带走说法(res.带走)}`,
      撤销: async () => {
        const r = await 撤销改负责人(res.原值 ?? [], o.value, res.带过来);
        router.refresh();
        if (r.ok && !r.updated) return { ok: false, error: "负责人已经又改过了" };
        return r;
      },
    });
    return { ok: true };
  }
  const 取转走预览 = useCallback((接手人: string) => 转走项目预览of([customer.id], 接手人), [customer.id]);
  /**
   * 客户转让框选「自动分配」（客户 11-17：市场成员给暂不分配的客户）：服务端挑人、整客户给挑中的销售，只通知接手人；
   * 成了框里原地说分给了谁（「已自动分配给 X」），没挑到人原因写在框里、什么都没动。
   * 页面判了能用才递 自动分配 进来；没递 = 框里不摆选择。取预览：还没挑人，接手人传空串，按「还没挑」数会一起转走的项目（同批量自动分配）
   */
  const 转让框自动 = useMemo(() => 自动分配 ? {
    默认方向: 自动分配方向 ?? null,
    可指定: 自动指定候选,
    做: async (原因: string | null, 方向?: "内贸" | "外贸"): Promise<转让结果> => {
      const r = await 自动分配(customer.id, 原因, 方向);
      router.refresh();
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, 话: `已自动分配给 ${r.接手人}${r.为什么 ? `（${r.为什么}）` : ""}` };
    },
    取预览: () => 转走项目预览of([customer.id], ""),
  } : undefined, [自动分配, 自动分配方向, 自动指定候选, customer.id, router]);
  /** 转给谁：在职成员里去掉现任 */
  const 转让候选 = 成员选项(users).filter((o) => o.value !== customer.salesOwnerId);
  const 能转让 = 去项目跟进 && !只读 && 能转让客户 && !customer.pool && 转让候选.length > 0;
  const 能退回公海 = 去项目跟进 && !只读 && !独自一人(users) && 能放公海 && !customer.pool;
  const 开客户转让 = () => set转让开(true);
  /** 「更多操作 ▾」里客户那一组（原「客户操作 ▾」，11-12 用户）：客户转让、客户退回公海，给不给照原来两颗按钮 */
  const 客户操作项: NonNullable<MenuProps["items"]> = [
    ...(能转让 ? [{ key: "cust-transfer", label: 两行("客户转让", "客户换负责人，名下项目一起走"), onClick: 开客户转让 }] : []),
    ...(能退回公海 ? [{ key: "cust-pool", label: <span title="客户和你自己的项目一起进公海">客户退回公海</span>, onClick: () => void 公海动作("放进") }] : []),
  ];
  /**
   * 「更多操作 ▾」里项目那一组（原「项目操作 ▾」，11-12 用户）：只在项目区（客户详情合并）里有。小标题「项目 · 名字（节点）」（D2 · M1-b），再是新建项目、当前项目的几项；
   * 删除项目不在这组，单独放整个菜单最后（见 更多操作项）。灰着的项下面一行小字写原因（和项目页头灰按钮悬停那句一样）。没有当前项目小标题只写「项目」、只剩「新建项目」
   */
  /* 客户三态状态条（C10）：只在沉睡 / 待回收 / 暂缓回收中时服务端才给；三态关着、活跃时什么都不摆。
     有项目区时交给项目区摆（中栏宽、进程卡正上方），没有就照旧在客户名下面通栏 */
  const 提醒条 = 三态条 ? <TriStateBar 条={三态条} customerId={customer.id} 开客户转让={能转让 ? 开客户转让 : null} /> : null;
  const 项目菜单项们 = 项目区 ? 当前项目菜单?.项们 ?? [] : [];
  const 点项目项 = (key: (typeof 项目菜单项们)[number]["key"]) => 项目动作口?.current?.(key);
  const 更多操作项 = 更多操作菜单({
    项目: !项目区 ? null : {
      当前名: 当前项目菜单 && 项目菜单项们.length > 0 ? 当前项目菜单.名 : null,
      当前节点: 当前项目菜单?.节点 ?? null,
      能建: 能建项目, 开建: 开建项目, 项们: 项目菜单项们, 忙: 项目忙, 点: 点项目项,
    },
    客户: 客户操作项,
  });
  /** 右上角「发起点评 ▾」（教练点评改版 PR1，11-21）：只在项目区（客户详情合并）里、对当前页签的项目能发才摆 */
  const 摆发起点评 = !!(项目区 && 发起点评钮);
  /** 「管理联系人」框里列谁：和联系人卡上露编辑 / 删除的是同一拨（见 联系人操作） */
  const 可管联系人 = 只读 ? [] : contacts.filter((c) => !c.挂靠 || c.挂靠.能改);
  /** 先关框、再开下一个（表单、确认框），不叠两层（同项目详情） */
  const 换框 = (f: () => void) => () => { set头部框(null); f(); };

  /** 速记框的两个出口：交给 AI 解析，或者不解析直接记一笔「其他记录」 */
  async function quickSave() {
    const text = memo.trim();
    if (!text) return;
    setQuickSaving(true);
    const res = await saveFollowUp({
      customerId: customer.id,
      type: "OTHER",
      title: "",
      content: text,
      status: "已完成",
      occurredAt: new Date().toISOString(),
      // 沟通必须挂项目（11-17）：不替人挑，服务端按「能记的在推项目只有一个就挂它，几个要选、没有就拦」定；拦下时原文留在速记框里
      projectId: 在推项目?.length === 1 ? 在推项目[0].id : null,
    });
    setQuickSaving(false);
    if (!res.ok) return void set速记话({ 话: res.error, 错: true });
    速记稿.存好了();
    setMemo("");
    // 记上了：领取了 / 不算有效沟通（客户三态 C12，照常保存不拦）写在速记框下面一行，不弹顶部提示
    const 领了 = "领取了" in res && res.领取了 ? "已领取并记下跟进，这位现在归你跟进" : "";
    const 短 = 短沟通话of(res);
    // 顺带把名下项目按必填推了一格：一起说（不悄悄推，11-20）
    const 推 = 自动推进话of(res);
    set速记话(领了 || 短 || 推 ? { 话: [领了, 短, 推].filter(Boolean).join("；") } : null);
    router.refresh();
  }

  /** 推荐关系那一节：个人版 / 团队版摆在基本资料下面，企业版不摆 */
  const 推荐节 = !外贸 && (
          <div className="rec-sec">
            <div className="rec-sec-t">
              <span>推荐关系</span>
            </div>
            <div className="rec-field" style={{ cursor: "default" }}>
              <div className="rec-field-k">推荐人</div>
              <div className="rec-field-v">{customer.referrerName ?? <span style={{ color: "var(--text-muted)" }}>自然流量</span>}</div>
            </div>
            <Tooltip title="推荐链往上第二代，不足两代取链条最顶端" placement="left">
              <div className="rec-field" style={{ cursor: "default" }}>
                <div className="rec-field-k">渠道归属</div>
                <div className="rec-field-v">{空显(customer.attributionName)}</div>
              </div>
            </Tooltip>
          </div>
  );

  /** 换负责人那几次（新的在前）：电脑上悬停「历史负责人」看，手机上点「变更记录」在底部面板里看 */
  const 换负责人条们 = [...换负责人记录].reverse().map((r, i) => (
    <div key={i} className="rec-hist-row">
      <span className="rec-hist-t">{fmtDateTime(r.at)}</span> {换负责人一句(r)}
    </div>
  ));
  /** 联系人右边的编辑 / 删除：两种摆法共用 */
  // 挂来的联系人（企业版 P13）：资料归主客户，主客户那头我能改才给编辑；删除不给，拿掉走卡上的「解除挂靠」
  /*
    公海里的客户（D5 遗留）：服务端改联系人、挂靠、联系人附件都过 客户事项挡，公海里一律「先领取再改」——
    联系人那几处也和资料格一样不摆入口（编辑笔、移出、⋯、附件上传、卡头「＋ 新增」），免得有笔却存不了（同 D3 资料改挡）。
    删是另一把尺（#403 审查）：删联系人、删联系人附件服务端走 删除挡，公海里系统管理员照常能删——「删除」和附件里的删单独按 公海删 摆
  */
  const 联系人只读 = 只读 || !!资料改挡?.公海;
  const 公海删 = !只读 && 资料改挡?.公海 ? 资料改挡.公海删 : undefined;
  const 能编联系人 = (c: ContactRow) => !联系人只读 && (!c.挂靠 || c.挂靠.能改);
  /** 摆不摆「移出 / 删除」：能编的照旧两颗都给；公海里只按删除挡给「删除」一颗（移出走 客户事项挡，公海里拒） */
  const 能删联系人 = (c: ContactRow) => !c.挂靠 && !去项目跟进 && (能编联系人(c) || !!公海删?.联系人);
  const 编辑联系人钮 = (c: ContactRow) => (
    <Button type="text" size="small" className="rec-contact-edit" icon={<EditOutlined />} aria-label={`编辑联系人 ${空显(c.name)}`} onClick={() => { setEditingContact(c); setContactOpen(true); }} />
  );
  const 联系人操作 = (c: ContactRow) => (能编联系人(c) || 能删联系人(c)) && (
    <span className="rec-mini-acts">
      {能编联系人(c) && 编辑联系人钮(c)}
      {/* 企业版项目模式去掉「管理联系人」后，删联系人不再给入口（U-客户-03）；编辑照旧给有权限的人 */}
      {/* 只移出 / 彻底删 各自原地确认（P-界面-40；2026-10-01 用户反馈：删完联系人页里也没了） */}
      {能删联系人(c) && <ContactRemoveInline c={c} 只删={!能编联系人(c)} />}
    </span>
  );

  /**
   * 企业版联系人一组的头（设计语言 D3 · M4-a 方案 A）：头像、名字、关键 / 挂靠，右端编辑和「⋯」常显（M4-c）。
   * 名字没填写「—」，淡色常规字重（M4-b）；头像里的「—」同样淡色（D1 实操遗留）
   */
  const 联系人头 = (c: ContactRow, 更多: ReactNode) => {
    const 无名 = !c.name?.trim();
    return (
      <div className="rec-contact-h">
        <Avatar size={24} className={无名 ? "rec-contact-av is-empty" : "rec-contact-av"} style={{ background: avatarColor(c.name), ...(无名 ? {} : { color: AVATAR_TEXT }), fontSize: 12, flex: "none" }}>{initial(空显(c.name))}</Avatar>
        {/* 姓名可以空（11-17 AI 新线索卡联系人姓名选填）：没填显示「—」 */}
        <span className={`rec-contact-n${无名 ? " is-empty" : ""}`} title={无名 ? "没填姓名" : c.name}>{空显(c.name)}</span>
        {是关键(c) && <Tag className="tag-key" style={{ margin: 0, fontSize: 12, lineHeight: "18px", padding: "0 5px" }}>关键</Tag>}
        {c.挂靠 && <Tag style={{ margin: 0, fontSize: 12, lineHeight: "18px", padding: "0 5px" }}>挂靠</Tag>}
        {(能编联系人(c) || 更多 || 能删联系人(c)) && (
          <span className="rec-contact-acts">
            {能编联系人(c) && 编辑联系人钮(c)}
            {更多}
            {能删联系人(c) && <ContactRemoveInline c={c} 只删={!能编联系人(c)} />}
          </span>
        )}
      </div>
    );
  };
  /** 企业版联系人一组的行：职务、本项目、各号码、号码保护（紧跟号码那几行，没号码时跟在「联系方式」后面）、性别生日爱好地址、名片、相册；挂靠那几行由 ContactLinks 接在后面 */
  const 联系人身 = (c: ContactRow) => {
    /* 号码保护单独一行、和其他字段同一种格式（11-24：原来跟在第一个号码后面，1280 卡宽放不下，见 号码保护标签）；每张卡一枚，出现条件同原来（这组行只在企业版摆） */
    const 保护行 = (
      <div className="rec-contact-line">
        <span className="rec-contact-k">号码保护</span>
        <span className="rec-contact-v"><号码保护标签 c={c} 客户={customer} /></span>
      </div>
    );
    const 号码行 = (k: string, v: ReactNode, key?: string) => (
      /* 号码本身一整串不拆，比整格还宽才在里面断 */
      <div key={key} className="rec-contact-line rec-contact-num">
        <span className="rec-contact-k" title={k}>{k}</span>
        <span className="rec-contact-nv">
          <span className="rec-contact-v">{v}</span>
        </span>
      </div>
    );
    const 老号: { k: string; v: ReactNode }[] = [
      ...(c.phone ? [{ k: "电话", v: <CopyValue 叫法="电话" value={c.phone} /> }] : []),
      ...(c.email ? [{ k: "邮箱", v: <CopyValue 种类="邮箱" 叫法="邮箱" value={c.email} /> }] : []),
      ...(c.wechat ? [{ k: "微信", v: c.wechat }] : []),
    ];
    return (
      <>
        {c.position && <div className="rec-contact-line"><span className="rec-contact-k">职务</span><span className="rec-contact-v" title={c.position}>{c.position}</span></div>}
        {/* 本项目里的角色 / 立场（项目关联联系人里勾的），一行，放不下省略、悬停看全 */}
        {本项目联系人.has(c.id) && (本项目联系人.get(c.id)!.角色.length > 0 || 本项目联系人.get(c.id)!.立场) && (
          <div className="rec-contact-line" data-testid="contact-project-role">
            <span className="rec-contact-k">本项目</span>
            <span className="rec-contact-v">{[...本项目联系人.get(c.id)!.角色, ...(本项目联系人.get(c.id)!.立场 ? [本项目联系人.get(c.id)!.立场!] : [])].join(" · ")}</span>
          </div>
        )}
        {c.号码们 && 号码种类 ? (
          /* 改版后（定稿 P5 第 24 条）：联系方式几行（类型 + 号码），一人可以好几个；性别、生日、爱好、地址填了才摆 */
          <>
            {c.号码们.map((m, i) =>
              号码行(号码叫法(号码种类, m.kind), m.kind === "phone" || m.kind === "landline" ? <CopyValue 叫法={号码叫法(号码种类, m.kind)} value={m.value} /> : m.kind === "email" ? <CopyValue 种类="邮箱" 叫法={号码叫法(号码种类, m.kind)} value={m.value} /> : m.value, `${m.kind}-${i}`),
            )}
            {c.号码们.length === 0 && 号码行("联系方式", <span className="rec-field-empty" title="没留联系方式">{空值符}</span>)}
            {保护行}
            {c.gender && <div className="rec-contact-line"><span className="rec-contact-k">性别</span><span className="rec-contact-v">{c.gender}</span></div>}
            {c.birthday && <div className="rec-contact-line"><span className="rec-contact-k">生日</span><span className="rec-contact-v">{c.birthday}</span></div>}
            {c.hobby && <div className="rec-contact-line"><span className="rec-contact-k">爱好</span><span className="rec-contact-v">{c.hobby}</span></div>}
            {c.address && <div className="rec-contact-line"><span className="rec-contact-k">地址</span><span className="rec-contact-v">{c.address}</span></div>}
          </>
        ) : (
          <>
            {老号.length > 0 ? 老号.map((x) => 号码行(x.k, x.v, x.k)) : 号码行("联系方式", <span className="rec-field-empty" title="没留联系方式">{空值符}</span>)}
            {保护行}
          </>
        )}
        {/* 名片、相册分两格（待定 19）；没给分格的个数时照旧一格 */}
        {联系人分类附件数
          ? (["名片", "相册"] as const).map((分类) => (
              <ContactAttachments key={分类} contactId={c.id} 名字={c.name} 起始个数={联系人分类附件数[c.id]?.[分类] ?? 0} 只读={联系人只读} 能删={公海删?.附件} 分类={分类} />
            ))
          : 联系人附件数 && <ContactAttachments contactId={c.id} 名字={c.name} 起始个数={联系人附件数[c.id] ?? 0} 只读={联系人只读} 能删={公海删?.附件} />}
      </>
    );
  };
  /*
    企业版左栏联系人（设计语言 D3 · M4-a 方案 A，用户 11-21 选）：每人一组行列表，组间一条细线；先摊开前 3 位，
    其余收在「展开其余 N 位 / 收起其余 N 位」后面（原来 11-12 起第一位摊开、其余手风琴、整块限高自己滚）。
    顺序和分组不变：关键 → 本项目 → 这位客户的其他联系人（P-界面-16）；刚新建的那位排在其余里最前（看得见）。
    「挂到别的客户 / 换主客户」收进「⋯」（M4-c），挂靠那几行、就地填的格子由 ContactLinks 接在组里
  */
  const 首位联系人 = 排好的联系人[0];
  const 企业联系人序 = 首位联系人 ? [首位联系人, ...刚加的排前(排好的联系人.slice(1), 刚加的联系人)] : [];
  const 先露几位 = 3;
  const 收着几位 = Math.max(0, 企业联系人序.length - 先露几位);
  const 一组 = (c: ContactRow) => (
    <Fragment key={c.id}>
      {c.id === 其他起点 && <div className="rec-contact-sub">这位客户的其他联系人</div>}
      <div className={`rec-contact rec-cg${c.id === 刚加的联系人 ? " rec-tl-item-flash" : ""}`} data-contact={c.id}>
        <ContactLinks customerId={customer.id} c={c} 只读={联系人只读} 头={(更多) => 联系人头(c, 更多)}>
          {联系人身(c)}
        </ContactLinks>
      </div>
    </Fragment>
  );
  const 企业联系人们 = 首位联系人 && (
    <>
      {企业联系人序.slice(0, 先露几位).map(一组)}
      {收着几位 > 0 && (
        <>
          {其余联系人开 && <div id="contact-rest" data-testid="contact-rest">{企业联系人序.slice(先露几位).map(一组)}</div>}
          <Button type="link" size="small" className="rec-sec-more rec-contact-rest-btn" aria-expanded={其余联系人开} aria-controls={其余联系人开 ? "contact-rest" : undefined} onClick={() => set其余联系人开(!其余联系人开)}>
            {其余联系人开 ? `收起其余 ${收着几位} 位` : `展开其余 ${收着几位} 位`}
          </Button>
        </>
      )}
    </>
  );

  /* 待办两处都留（P14 第 2 条）：这位客户的任务；企业版再摆没完成的跟进计划、各项目的下一步（只读，点了去办）。
     企业版项目模式摆在中栏沟通记录下面（11-01 用户：「待办模块放到沟通记录下方，而不是整体下方」）；其余照旧在右栏 */
  const 待办身 = (
    <>
      {待办行.length === 0 && 计划行.length === 0 && 下一步行.length === 0 && <Typography.Text type="secondary" style={{ fontSize: 13 }}>还没有待办</Typography.Text>}
      {计划行.map((p) => (
        <div key={`plan-${p.id}`} data-focus={`plan:${p.id}`} className="rec-task">
          <span className="rec-task-k">计划</span>
          <Link className="rec-task-t" href="/follow-ups/plans" title="到「跟进计划」里办">{p.subject}</Link>
          <span className="rec-task-due" title={p.plannedAt ? fmtDateTime(p.plannedAt) : undefined} style={{ color: 已过期(p.plannedAt) ? "var(--danger)" : undefined }}>
            {p.plannedAt ? 截止说法(p.plannedAt) : ""}
          </span>
        </div>
      ))}
      {下一步行.map((p) => (
        <div key={`next-${p.id}`} className="rec-task">
          <span className="rec-task-k">项目</span>
          <Link className="rec-task-t" href={p.主 ? 客户页项目地址(customer.id, p.id, "#project-follow") : 别家项目地址(p.id)} title={`项目「${p.名}」的下一步计划${p.下一步文字 ? `：${p.下一步文字}` : ""}`}>
            {p.下一步文字 ? `${p.名} · ${p.下一步文字}` : p.名}
            <LinkPending />
          </Link>
          {p.下一步 && (
            <span className="rec-task-due" title={fmtDateTime(p.下一步)} style={{ color: 已过期(p.下一步) ? "var(--danger)" : undefined }}>
              {截止说法(p.下一步)}
            </span>
          )}
        </div>
      ))}
      {/* 收起只淡出、不收高度：减弱动态时不许有位移，淡出在两种设置下都一样 */}
      <AnimatePresence initial={false}>
        {待办行.map((t) => (
          <motion.div
            key={t.id}
            data-focus={`task:${t.id}`}
            className={`rec-task${已完成(t) ? " is-done" : ""}`}
            exit={{ opacity: 0 }}
            transition={{ duration: 时长.base, ease: 曲线.ease }}
          >
            <Checkbox checked={已完成(t)} disabled={只读} onChange={(e) => void 勾待办(t, e.target.checked)} aria-label={`完成 ${t.title}`} />
            <span className="rec-task-t">{t.title}</span>
            {/* 「逾期 2 天」而不是「2 天前」（审查 D1）：欠着没做的事，不是发生过的事 */}
            <span className="rec-task-due" title={t.dueAt ? fmtDateTime(t.dueAt) : undefined} style={{ color: !已完成(t) && 已过期(t.dueAt) ? "var(--danger)" : undefined }}>
              {t.dueAt ? 截止说法(t.dueAt) : ""}
            </span>
            {/* 就地确认：一条待办删了还能再建，一句话说得完，不值得弹框（见 components/InlineConfirm.tsx） */}
            {!只读 && (
              <InlineConfirm
                问="删除这条？"
                做={async () => {
                  // 被挡（权限）回 ok:false：不提示成功、条目留着（PR10a），原因就地写在这一行；删成了这一行收起，不再弹提示
                  const r = await deleteTask(t.id).catch((出错) => ({ ok: false as const, error: 动作出错话(出错, "没删掉，请重试") }));
                  if (!r.ok) {
                    报待办错(t.id, r.error || "没删掉，请重试");
                    router.refresh();
                    return r;
                  }
                  router.refresh();
                }}
              >
                <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label="删除待办" />
              </InlineConfirm>
            )}
            {待办错[t.id] && <div role="alert" className="cd-task-err">{待办错[t.id]}</div>}
          </motion.div>
        ))}
      </AnimatePresence>
    </>
  );
  const 待办卡 = 摆法.待办 && !去项目跟进 ? (
    <div className="rec-card rec-side-card" aria-label="待办">
      <div className="rec-side-t">
        <span>待办 {待办数 > 0 && 待办数}</span>
        {!只读 && (
          <Button type="link" size="small" style={{ padding: 0, height: "auto", fontWeight: 400 }} icon={<PlusOutlined />} onClick={() => setTaskOpen(true)}>
            新建待办
          </Button>
        )}
      </div>
      {待办身}
    </div>
  ) : null;
  /* 项目模式（11-01 用户：「客户详情页各个模块都要分开，和项目详情页一致」）：每块一张卡、包 ProjectFold，
     卡头左边标题+计数、右边新增按钮、最右收起。普通函数调用，别写成 <节/>，否则每次渲染换组件、收起状态会丢 */
  /* 11-12 用户「模块内的按钮格式保持一致，都以完成节点为参照」：中栏模块给 连体，主动作和收起并成一颗连体按钮（FoldSplit） */
  const 节 = (名: string, 数: number | string | undefined, 加: ReactNode, 身: ReactNode, 连体?: { 主: 连体主钮 | null; 色: 连体色 }, id?: string) =>
    去项目跟进 ? (
      <ProjectFold key={名} id={id} 名={名} 连体={!!连体}>
        <Card className="rec-mod" title={数 === undefined ? 名 : 计数题(名, 数)} extra={连体 ? <Space size={8}>{加}<FoldSplit 主={连体.主} 色={连体.色} /></Space> : 加 || undefined}>
          {身}
        </Card>
      </ProjectFold>
    ) : (
      <div key={名} className="rec-sec">
        <div className="rec-sec-t">
          <span>{名}{数 !== undefined && <> {数 !== 0 && 数}</>}</span>
          {加}
        </div>
        {身}
      </div>
    );
  /* 第一屏记录的进场（J-213）：页面接管那一下，已经显出来的记录逐条从下面 6px 落到位，只挪位置、不碰透明度——
     服务端渲染出来就是不透明的，不会再「记录区先空几秒」（11-11）。间隔照时间线 70ms、八条以后一起，最晚一条 0.88 秒落定。
     用浏览器自己的 Element.animate、translate 属性：和 motion 的 layout（写 transform）互不覆盖；开了「减弱动态」不动 */
  const 时间线框 = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const 框 = 时间线框.current;
    if (!框 || typeof 框.animate !== "function" || 少动()) return;
    // 曲线直接取样式表里的 --ease（Element.animate 认的是 CSS 写法；老浏览器上 @supports 退回的 cubic-bezier 也跟着走）
    const 曲 = getComputedStyle(document.documentElement).getPropertyValue("--ease").trim() || "ease-out";
    const 动 = [...框.querySelectorAll<HTMLElement>(":scope > .rec-tl-item")].map((el, i) =>
      el.animate([{ translate: "0 6px" }, { translate: "0 0" }], { duration: 时长.morph * 1000, delay: Math.min(i, 8) * 间隔 * 1000, easing: 曲, fill: "backwards" }),
    );
    return () => 动.forEach((a) => a.cancel());
    // 只在第一屏跑一次：之后换主题、换筛选不重放（新出现的那几条走 motion 的淡入）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* 沟通记录的筛选条和时间线：项目模式装进「沟通记录」卡，其余照旧摊在中栏 */
  const 筛选条 = (
    <div className="rec-filters">
      {["全部", ...跟进类型们(外贸).map((t) => t.value), ...(摆法.沟通汇总 ? [] : ["CONTRACT"])].map((k) => {
        // 「其他」这一档既有选了其他方式的、也有没填方式的（显示「—」）：和看板筛选同一个叫法，不叫「其他记录」（11-17）
        const label = k === "全部" ? "全部" : k === "CONTRACT" ? 叫 : k === "OTHER" ? 筛选方式名(k) : FOLLOW_TYPE_MAP[k]?.label ?? k;
        return (
          <button type="button" key={k} className={`rec-chip${filter === k ? " rec-chip-on" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {label}
          </button>
        );
      })}
    </div>
  );
  const 时间线 = (
    <div className="rec-tl" ref={时间线框}>
      {entries.length === 0 && (
        <div style={{ padding: "36px 0", textAlign: "center", color: "var(--text-muted)" }}>
          {filter !== "CONTRACT" && history.hasMore ? "已加载的记录中暂无此类型，可继续加载更早的跟进。" : filter === "全部" ? (摆法.沟通汇总 ? 去项目跟进 ? "还没有沟通记录。点右上「新建沟通」记一条" : `还没有沟通记录。点上方「${跟进按钮字}」记一条` : "还没有任何记录。上面随手记一笔，或粘一段聊天记录让 AI 整理。") : "这个类型下还没有记录"}
        </div>
      )}
      {/* 淡入只给之后新出现的（换筛选、加载更多、新记一条）：打开页面时第一屏的记录不做淡入（11-11）。
          原来第一屏也逐条淡入，服务端渲染出来的是透明的，要等页面接管（真页面 4～6 秒）才显出来，
          卡头、筛选先到、记录区空一大块；现在和卡头同时出现。第一屏的进场改成上面 useLayoutEffect 里那段只挪位置的 */}
      <AnimatePresence initial={false}>
        {entries.map((e, i) =>
          e.kind === "contract" ? (
            <motion.div key={`c-${e.c.id}`} className="rec-tl-item" layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: Math.min(i, 8) * 间隔, duration: 时长.base, ease: 曲线.ease }}>
              <div className="rec-tl-dot" style={{ background: "var(--success)" }}>
                <DollarOutlined />
              </div>
              <div className="rec-tl-body">
                <div className="rec-tl-contract">
                  <div className="rec-tl-head">
                    <span className="rec-tl-type">{叫} <span className="rec-nowrap">{金额(e.c.amount, e.c.currency)}</span></span>
                    {e.c.remark && <span className="rec-tl-title" title={e.c.remark}>· {e.c.remark}</span>}
                    <span className="rec-tl-time">{fmtDate(e.c.signedAt)}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <FollowItem key={e.f.id} f={e.f} 不挂商机={!!项目们} showOwner={!e.f.ownerId || !独自一人(users, e.f.ownerId)} index={i} onEdit={() => openFollow(e.f)} onDelete={() => deleteFollow(e.f)} 可改={!只读 && !摆法.沟通汇总 && 能改沟通} 可删={!只读 && !摆法.沟通汇总 && 能删沟通} 汇总={摆法.沟通汇总} 项目地址={时间线项目地址} />
          ),
        )}
      </AnimatePresence>
      {filter !== "CONTRACT" && history.hasMore && (
        <div style={{ padding: 16, textAlign: "center" }}>
          <Button loading={history.loading} onClick={() => { set加载错(null); void history.loadMore().catch(error => set加载错(出错原话(error, "历史跟进加载失败，请重试"))); }}>{摆法.沟通汇总 ? "加载更多" : "加载更早的跟进"}</Button>
          {加载错 && <div role="alert" className="cd-task-err">{加载错}</div>}
          <div className="muted" style={{ marginTop: 8 }}>已加载 {history.rows.length} 条{摆法.沟通汇总 ? "" : "跟进"} · 筛选作用于已加载记录</div>
        </div>
      )}
      {filter !== "CONTRACT" && history.paged && <div style={{ textAlign: "center", paddingBottom: 12 }}><Button type="link" onClick={() => { history.reset(); router.refresh(); }}>重新加载历史</Button></div>}
    </div>
  );
  /* 企业版项目模式待办挪去页底、背调挪去左栏，右栏只剩 AI；AI 关着或收进抽屉时右栏是空的，
     不留一条空栏，正文两栏（CSS .rec-no-right） */
  const 有右栏 = (aiEnabled && !AI在抽屉里) || !去项目跟进 || (!plan && 摆法.下次跟进);

  return (
    /* ui-v2：16a 客户详情的排版（左栏加宽、联系人两行、备注折叠、筛选一行），样式在 globals.css 末尾 16a 那块 */
    <div className="rec-page ui-v2">
      {后果框}
      {醒目条}
      {/*
        「← 回到客户列表（第 N 页）」（员工反馈 1A，11-16）：原来按设计稿 12/PAGE「切人不再返回列表」不摆，靠窄名单换人；
        员工是按列表一页一页盘点的，窄名单（最近跟进 50 位）不是那一页。回的是进来前那张列表的原地址（筛选、页码、页签），
        滚动位置由外壳滚回去（components/ListReturn.tsx）。单占一行在页头上面，不和名字、右上角按钮抢宽度
      */}
      <div className="back-to-list-row"><BackToList /></div>
      <div className="rec-head">
        {/* 名单不在时（窗口太窄收成抽屉，或者人自己点了收起），最左边补一颗侧栏图标把它叫回来（components/PaneToggle.tsx） */}
        <PaneToggle 栏="roster" 位置="主区" />
        {/* 头像圆片 + 名字 + 星（2026-10-02 照毛玻璃原型）：一眼认出这是谁，星是「放到左栏，下次一点就到」 */}
        <span className="rec-head-av" aria-hidden="true" style={{ background: avatarColor(叫这位), color: AVATAR_TEXT }}>
          {initial(叫这位)}
        </span>
        <div className="rec-head-id">
          <div className="rec-head-line">
            {/* 企业版页头显示抬头（11-17 客户抬头 PR-5，出口 2，lib/enterprise/customer-title.ts）：和客户列表第一列同一个算法；一行、放不下省略号、悬停看全文 */}
            <h1 className="rec-head-name" style={{ margin: 0 }} title={页头名}>{页头名}</h1>
            <StarButton customerId={customer.id} 初值={已收藏} />
          </div>
          {/* 副标题是这个人的三个定位：年级 · 专业 · 谁在跟。没填的那项不占位 */}
          <div className="rec-head-sub">
            {/* 企业版项目模式：年级 / 专业那两格不摆了（定稿 P5 第 22 条），换成简称。
                企业版最前面是客户编号（11-17 客户抬头 PR-1：抬头可以重名，靠编号认人；回填前没有编号的写短号） */}
            {(企业 ? [客户编号显示(customer)] : ([] as (string | null | undefined)[]))
              .concat(摆法.旧字段 ? [customer.grade, customer.major] : [customer.shortName])
              .concat(!独自一人(users, customer.salesOwnerId) ? [customer.salesOwnerName] : [])
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <span className="rec-head-sp" style={{ flex: 1 }} />
        {/* 教练点评改版 PR1（11-21，原 11-12「AI / 项目操作 / 客户操作」三颗）：右端从左到右「发起点评 ▾」「更多操作 ▾」，「更多操作」永远在最右。
            「发起点评 ▾」= 写点评（原沟通卡头「发起主题」那只框）/ 录音点评（还没开放，灰着）；能发的人才摆（P-教练-11/12/13）。
            「更多操作 ▾」= 原「项目操作」+「客户操作」：项目一组、客户一组、删除项目单独放最后；每项给不给、灰不灰、确认流程和原来同一套判断，一项都没有整颗不摆。
            原来的「AI」按钮去掉：电脑上 AI 从右下角浮标、⌘J 进，浮窗在客户页空屏有「总结这位客户」（开下面那只原 AI 抽屉）；
            手机没有浮窗，浮标点开的铺满屏 AiDock 也摆「总结这位客户」（components/AiDock.tsx），智能总结不丢入口。
            手机（< 768）：名字一行，下面两颗各占一半（globals.css .rec-head-acts） */}
        {去项目跟进 && (摆发起点评 || 更多操作项.length > 0) && (
          <span className="rec-head-acts">
            {摆发起点评 && 发起点评钮}
            {更多操作项.length > 0 && (
              <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items: 更多操作项, className: "rec-head-menu" }}>
                <Button data-testid="rec-more-ops">更多操作 <DownOutlined /></Button>
              </Dropdown>
            )}
          </span>
        )}
        {aiEnabled && (!量到 || AI在抽屉里) && !去项目跟进 && (
          <Button size="small" className={量到 ? undefined : "rec-ai-guess-btn"} icon={<AiOutlined />} onClick={() => setAI抽屉开着(true)} style={{ marginRight: 8 }}>
            AI
          </Button>
        )}
        {!去项目跟进 && !全只读 && <Space.Compact>
          <Button type="primary" onClick={() => openFollow(null)}>
            记录跟进
          </Button>
          <Dropdown
            menu={{
              items: [
                ...跟进类型们(外贸).filter((t) => !只读 || (t.value !== "TASK" && t.value !== "REMIND")).map((t) => ({ key: t.value, label: t.label, onClick: () => openFollow({ type: t.value } as FollowUpRow) })),
                // 同事的客户（互看）：只能记跟进，编辑、删除、放公海都不摆
                ...(只读 ? [] : [
                { type: "divider" as const },
                { key: "edit", icon: <EditOutlined />, label: `编辑${b.customer}资料`, onClick: () => setCustOpen(true) },
                { key: "delete", icon: <DeleteOutlined />, danger: true, label: `删除这位${b.customer}`, onClick: () => void 问删除([{ id: customer.id, name: 叫这位 }], () => router.push("/customers")) },
                // 公海（第 6 块）：多人时、我是负责人或管理员、还不在公海里
                ...(!独自一人(users) && 能放公海 && !customer.pool
                  ? [{ key: "pool", icon: <InboxOutlined />, label: "放回公海", onClick: () => void 公海动作("放进") }]
                  : []),
                ]),
              ],
            }}
          >
            <Button type="primary" icon={<DownOutlined />} aria-label="客户更多操作" />
          </Dropdown>
        </Space.Compact>}
      </div>

      {/* 客户三态状态条（C10）：只在沉睡 / 待回收 / 暂缓回收中时服务端才给；三态关着、活跃时什么都不摆 */}
      {/* 有项目区时挪进项目区：只占中栏宽、在进程卡正上方（11-12 用户），见 提醒条 */}
      {!项目区 && 提醒条}

      {/*
        企业版页头按钮（10-31 改版 R6 → 10-31 会议 U-客户-03 精简 → 11-12 客户详情合并第 2 批 → 11-12 用户「右上角只保存三个按钮」）：
        客户名这一行右端只留「AI」「项目操作 ▾」「客户操作 ▾」，原来的客户转让 / 退回公海、项目转让 / 退回公海 / 删除、「＋ 新建项目」都收进两个菜单。
        → 11-21 教练点评改版 PR1：改成「发起点评 ▾」「更多操作 ▾」（两个菜单合成一个），AI 按钮去掉，见上面页头那段。
        编辑资料、添加 / 管理联系人、删除客户、新建待办都不摆在这排：资料就地改（没权限的人改不了，M-权限-10），
        「新建沟通」在沟通记录卡头，「新建待办」在待办卡头，删除客户属权限限制不再给入口。原来名字下面单独那一排（.rec-acts）去掉
      */}

      {/*
        标签行：跟进状态、决策状态、预计签约（设计稿 12/PAGE 里紧跟在名字下面那一行）。
        这三样原来压在左栏档案卡里，要先把视线移到侧边才看得到这个人现在是什么状态——
        而它恰恰是打开一条记录时第一个要知道的事。两个状态点一下就能改，
        预计签约只读（在档案里改），所以它不长得像按钮。
      */}
      <div className="rec-tags">
        {/* 企业版不摆这两枚（2026-10-28）：这是桌面端那条跟进漏斗，企业版客户走到哪一步看项目的阶段 */}
        {!企业 && (
          <>
            <StatusPicker customerId={customer.id} field="followStatus" value={customer.followStatus} options={FOLLOW_STATUSES.map((s) => ({ value: s, label: statusLabel(b, s) }))}>
              <FollowStatusTag status={customer.followStatus} />
            </StatusPicker>
            <StatusPicker customerId={customer.id} field="decisionStatus" value={customer.decisionStatus} options={DECISION_STATUSES.map((s) => ({ value: s, label: statusLabel(b, s) }))}>
              <DecisionStatusTag status={customer.decisionStatus} />
            </StatusPicker>
          </>
        )}
        {/* 企业版：客户状态一枚章（字典 custStatus，10-28 去遗留 A1），点一下就能改；原值停用了也照样在选项里 */}
        {/* 项目模式按名下项目自动算（10-30）：章只读，不套 StatusPicker */}
        {企业 && (客户状态自动 ? (
          <Tooltip title="按这位客户名下的项目自动算">
            <Tag color={customer.custStatus ? 客户状态色of(客户状态色, customer.custStatus) : undefined} style={{ margin: 0 }} aria-label="客户状态">{customer.custStatus ?? "暂无项目"}</Tag>
          </Tooltip>
        ) : (
          <StatusPicker customerId={customer.id} field="custStatus" value={customer.custStatus ?? ""} 释义={字典释义?.状态}
            options={[...new Set([...客户状态选项, ...(customer.custStatus ? [customer.custStatus] : [])])].map((s) => ({ value: s, label: s }))}>
            <Tag color={customer.custStatus ? 客户状态色of(客户状态色, customer.custStatus) : undefined} style={{ margin: 0 }} aria-label="客户状态">{customer.custStatus ?? "未设客户状态"}</Tag>
          </StatusPicker>
        ))}
        {/* 来源（照毛玻璃原型的那枚「来源：WhatsApp」）：渠道或推荐人。自然流量不摆——没有来源就不占位 */}
        {/* 企业版只认渠道（10-28 去遗留 A3）：写渠道名，没挂渠道就不摆，不写推荐人 */}
        {企业
          ? customer.channelName && <span className="rec-tags-n" title="客户来源记第一次带来的渠道，建好之后不改">客户来源：{customer.channelName}</span>
          : 外贸
          ? 档?.source && <span className="rec-tags-n">来源：{档.source}</span>
          : customer.referrerName && <span className="rec-tags-n">来源：{customer.referrerName}</span>}
        {/* 客户等级（2026-10-16）：一枚字母章，放在国家前面——先看这位要花多少力气 */}
        {摆法.新字段
          ? 级别值 && <LevelLetter level={级别值} />
          : 外贸 && 档?.level && <span className={`cust-level cust-level-${档.level}`} title={`客户等级：${客户等级说明[档.level as 客户等级值] ?? 档.level}`}>{档.level}</span>}
        {外贸 && 摆法.旧字段 && 档?.country && <span className="rec-tags-n">{档.country}</span>}
        {/* 对方此刻几点（2026-10-16）：按国家首都的时区；和本机同一钟点时不显示 */}
        {外贸 && 摆法.旧字段 && 档?.country && <LocalTime country={档.country} className="rec-tags-n" />}
        {/* WhatsApp 点一下打开对话（wa.me）：外贸客户的主沟通渠道，抄号码再去手机上搜太绕 */}
        {wa && 摆法.旧字段 && (
          <a className="rec-tags-n" href={wa} target="_blank" rel="noreferrer" title={`在 WhatsApp 里打开和 ${档?.whatsapp} 的对话`}>
            WhatsApp ↗
          </a>
        )}
        {(外贸 || 摆法.新字段) && 官网 && (
          <a className="rec-tags-n" href={官网} target="_blank" rel="noreferrer" title={`打开 ${官网}`}>
            官网 ↗
          </a>
        )}
        {/* 在公海里（第 6 块）：标签写原负责人，旁边就是「领取」——看到就能接手 */}
        {customer.pool && (
          <span className="rec-tags-n rec-pool">
            <Tag className="pool-tag" title={customer.pool.reason === "手动" ? "手动放回公海" : 进公海理由显示(customer.pool.reason)}>{公海标签(customer.salesOwnerName)}</Tag>
            {/* 公海回收站（标了无效，P-公海-09）：和公海列表那一格同一个红色「无效」标；领不了（M-权限-03）——能恢复的人摆「恢复」，别人领取灰着、原因写在旁边 */}
            {customer.pool.无效 && <Tag color="red" title="无效客户：全员看得到、查重查得到，领不了；系统管理员、回收站副手能恢复">无效</Tag>}
            {customer.pool.无效
              ? (恢复无效
                ? <Button size="small" type="link" loading={恢复中} onClick={() => void 恢复这位()}>恢复</Button>
                : 管理员只读 || !能领 ? null
                : <Tooltip title={无效客户不能领短话}><Button size="small" type="link" icon={<UserAddOutlined />} disabled aria-describedby="rec-pool-why">领取</Button></Tooltip>)
              : 管理员只读 || !能领 ? null : 原负责人领不回
              ? <Tooltip title={原负责人不能领回提示}><Button size="small" type="link" icon={<UserAddOutlined />} disabled>领取</Button></Tooltip>
              : <Button size="small" type="link" icon={<UserAddOutlined />} onClick={() => void 公海动作("领取")}>领取</Button>}
          </span>
        )}
        {customer.pool?.无效 && !恢复无效 && !管理员只读 && 能领 && <span id="rec-pool-why" className="rec-tags-n" title={无效客户不能领短话}>{无效客户不能领短话}</span>}
        {/* 一个数都没有就不出现：「预计签约 —」占着一行却什么也没说 */}
        {/* 企业版不摆（10-28 去遗留 A4）：成交看项目，不看签约 */}
        {!企业 && (customer.signedAmount > 0 || (customer.expectedSignAt && !外贸)) && (
          <span className="rec-tags-n">
            {customer.signedAmount > 0 ? `${是订单 ? "已下单" : "已签约"} ${已签约文字}` : "预计签约"}
            {/* 已签约后面跟的是实际签约日（最近一笔；contracts 按签约日倒序）。原来跟的是预计签约日，
                9 月 28 日签的约读起来像 10 月 5 日签的（2026-09-28 审查 M2） */}
            {customer.signedAmount > 0
              ? contracts[0] && ` · ${fmtDate(contracts[0].signedAt)}`
              : customer.expectedSignAt && ` · ${fmtDate(customer.expectedSignAt)}`}
          </span>
        )}
        {/* 冷热按跟进状态算，企业版不用跟进状态，不摆（10-28 去遗留 A1） */}
        {!企业 && 要看冷热(customer.followStatus) && (
          <span className={`rec-heat${计划过期天 > 0 ? " is-over" : ""}`}>
            <Heat at={customer.lastFollowAt} />
            {/* 排了计划又过了期，比「几天没跟」更要紧：那是答应过的事 */}
            {计划过期天 > 0 ? `下次跟进已过 ${计划过期天} 天` : 冷热说法(customer.lastFollowAt)}
          </span>
        )}
        {/* 「历史变更」小方框（11-24）：这一行末尾，放不下随这一行折到下一行；点开是弹窗（HistoryChanges.tsx） */}
        {历史变更}
      </div>
      {就地话 && <div role={就地话.错 ? "alert" : "status"} className={就地话.错 ? "cd-task-err rec-said" : "rec-plan-said rec-said"}>{就地话.话}</div>}

      {只读 && !管理员只读 && (
        <Alert
          className="rec-readonly"
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={全只读 ? (只读横幅?.标题 ?? `${虚线的 ? "虚线下属 " : ""}${customer.salesOwnerName} 的${b.customer} · 只能看`) : `同事 ${customer.salesOwnerName} 的${b.customer} · 只能看和加跟进`}
          description={全只读 ? (只读横幅?.说明 ?? `${全只读话}。要改请找${虚线的 ? "他的直属上级" : "负责人"}或总管理`) : "团队开了「同事之间互相看得到客户」。改资料、删除、转交、排计划请找负责人或" + (企业 ? "总管理" : "老板")}
        />
      )}

      <只读上下文.Provider value={只读}>
      <只能看的格上下文.Provider value={只能看的格}>
      <资料改挡上下文.Provider value={只读 ? null : 资料改挡}>
      <div ref={recRef} className={项目区 ? `rec rec-cd${单栏 ? " rec-1col" : ""}` : `rec${AI在抽屉里 ? " rec-2col" : ""}${单栏 ? " rec-1col" : ""}${有右栏 ? "" : " rec-no-right"}`}>
        {/* ================= 左栏：档案 ================= */}
        <aside className={`rec-rail rec-card${去项目跟进 ? " rec-rail-blocks" : ""}`}>
          {/* 名字和头像不在这儿重画一遍：页头上已经有了（设计稿 12/PAGE 的「基本资料」卡第一行就是电话）。
              11-04 用户：所有字段点了直接改，不再摆「编辑全部」。电话也就地改：查重、打码号认回都在服务端；
              点号码右边的小键复制，点别处才进编辑 */}
          {节(去项目跟进 ? 客户详情左栏.资料 : "基本资料", undefined, undefined, <>
            {/* 公海里的客户资料格都不给点（改客户挡），原因写在卡里头一行，不用点了才知道 */}
            {!只读 && 资料改挡?.公海 && <div className="rec-empty" role="note" data-testid="pool-edit-note">{资料改挡.话}</div>}
            {/* 企业版项目模式（11-17 客户抬头 PR-1b）：第一行全称、第二行简称，没填简称写「—」；原来的「公司」格不摆（库里照留）。
                全称也点着就地改（员工反馈：负责人改不了全称——企业版页头没有「编辑客户资料」，完整表单进不去）：
                不按名字查重（同完整表单编辑，见 patchCustomer）；11-19 起企业版全称选填、能清空（空着写「—」，页头照抬头兜底）。一行放不下省略号、悬停看全（TruncTip） */}
            {摆法.新字段 && <InlineField 空时横线={企业} customerId={customer.id} field="name" label="全称" value={customer.name} 可清空={企业} />}
            {摆法.新字段 && <InlineField 空时横线={企业} customerId={customer.id} field="shortName" label="简称" value={customer.shortName ?? null} placeholder={`最多 ${简称上限} 个字`} 可清空 />}
            {/* 企业版客户没有电话（E-260，客户「客户没有电话这一说法」）：电话格、客户本身号码几行都不摆，号码一律在下面的联系人上 */}
            {!企业 && 摆(customer.phone) && (
              <InlineField customerId={customer.id} field="phone" label="电话" value={customer.phone} />
            )}
            {sourceLead && <div className="rec-field" style={{cursor:"default"}} data-testid="customer-lead-origin">
              <div className="rec-field-k">来源线索</div>
              <div className="rec-field-v" style={{overflowWrap:"anywhere"}}>
                <div>{sourceLead.name} · {sourceLead.source}</div>
                <div style={{color:"var(--text-muted)",fontSize:12}}>编号 {sourceLead.id} · 转化时间 {sourceLead.convertedAt ? fmtDateTime(sourceLead.convertedAt) : "未记录"}</div>
              </div>
            </div>}
            {/* 企业版项目模式（定稿 P5 第 22、23、29、30 条）：级别 S/A/B/C、地址、官网、分配方式（简称挪到第二行、公司不摆：11-17 PR-1b）；
                行业、职位、国家、WhatsApp、邮箱、微信、阿里 ID、旧等级、预计签约不摆（库里照留）。地址分省市区，就地一起改 */}
            {!摆法.新字段 && 摆(customer.school) && <InlineField 空时横线={企业} customerId={customer.id} field="school" label={b.fields.school} value={customer.school} />}
            {摆法.旧字段 && 摆(customer.major) && <InlineField 空时横线={企业} customerId={customer.id} field="major" label={b.fields.major} value={customer.major} />}
            {摆法.旧字段 && 摆(customer.grade) && <InlineField 空时横线={企业} customerId={customer.id} field="grade" label={b.fields.grade} value={customer.grade} kind="combo" options={b.grades.map((g) => ({ value: g, label: g }))} />}
            {摆法.新字段 && (
              <>
                {摆(级别值) && <InlineField 空时横线={企业} customerId={customer.id} field="level" label="客户级别" value={级别值} kind="select" options={级别选项()} placeholder={空值符} 可清空 />}
                {摆(customer.customerType) && (
                  <InlineField 空时横线={企业} customerId={customer.id} field="customerType" label="客户类型" value={去空(customer.customerType)} kind="select"
                    options={[...new Set([...客户类型选项, ...(有值(customer.customerType) ? [customer.customerType] : [])])].map((x) => ({ value: x, label: x }))} placeholder={空值符} 可清空
                    释义={字典释义?.类型} />
                )}
                {摆(customer.customerAttr) && (
                  <InlineField 空时横线={企业} customerId={customer.id} field="customerAttr" label="客户属性" value={去空(customer.customerAttr)} kind="select"
                    options={[...new Set([...客户属性选项, ...(有值(customer.customerAttr) ? [customer.customerAttr] : [])])].map((x) => ({ value: x, label: x }))} placeholder={空值符} 可清空 />
                )}
                {/* 地址五格（P14 第 7 条）：前四格拼成一行「所在地区」，第五格「客户地址」（公司详细地址）单独一行；都就地改 */}
                {摆(地址文字) && <RegionInlineField 空时横线={企业} customerId={customer.id} value={{ addrCountry: customer.addrCountry ?? null, addrProvince: customer.addrProvince ?? null, addrCity: customer.addrCity ?? null, addrDistrict: customer.addrDistrict ?? null }} />}
                {摆(customer.addrDetail) && <InlineField 空时横线={企业} customerId={customer.id} field="addrDetail" label={地址叫法.addrDetail} value={customer.addrDetail ?? null} />}
                {摆(档?.website) && <InlineField 空时横线={企业} customerId={customer.id} field="website" label="官网" value={档?.website ?? null} placeholder="如 www.example.com" />}
                {摆(customer.assignWay) && (
                  <InlineField 空时横线={企业} customerId={customer.id} field="assignWay" label="客户分配" value={去空(customer.assignWay)} kind="select"
                    options={[...new Set([...分配方式选项, ...(有值(customer.assignWay) ? [customer.assignWay] : [])])].map((x) => ({ value: x, label: x }))} placeholder={空值符} 可清空 />
                )}
                {/* 归档档位（M-导入-23）：只由归档导入写，只读；空的（不是归档导入来的）不摆，资料全开也不摆 */}
                {有值(customer.archiveTier) && (
                  <div className="rec-field" style={{ cursor: "default" }} data-testid="customer-archive-tier" title="归档导入时带进来的档位，只能看">
                    <div className="rec-field-k">归档档位</div>
                    <div className="rec-field-v">{customer.archiveTier}</div>
                  </div>
                )}
              </>
            )}
            {摆法.旧字段 && 摆档案组 && (
              <>
                {摆(档?.country) && <InlineField 空时横线={企业} customerId={customer.id} field="country" label="国家" value={档?.country ?? null} kind="combo" options={国家候选.flatMap((g) => g.国家).map((x) => ({ value: x, label: x }))} />}
                {摆(档?.whatsapp) && <InlineField 空时横线={企业} customerId={customer.id} field="whatsapp" label="WhatsApp" value={档?.whatsapp ?? null} />}
                {摆(档?.email) && <InlineField 空时横线={企业} customerId={customer.id} field="email" label="邮箱" value={档?.email ?? null} 显示={企业 ? (v) => <CopyValue 种类="邮箱" 叫法="邮箱" value={v} /> : undefined} />}
                {摆(档?.wechat) && <InlineField 空时横线={企业} customerId={customer.id} field="wechat" label="微信" value={档?.wechat ?? null} />}
                {摆(档?.alibabaId) && <InlineField 空时横线={企业} customerId={customer.id} field="alibabaId" label="阿里 ID" value={档?.alibabaId ?? null} />}
                {摆(档?.source) && <InlineField 空时横线={企业} customerId={customer.id} field="source" label="来源" value={档?.source ?? null} kind="combo" options={b.sources.map((x) => ({ value: x, label: x }))} />}
                {摆(档?.level) && <InlineField 空时横线={企业} customerId={customer.id} field="level" label="客户等级" value={档?.level ?? null} kind="select" options={客户等级.map((x) => ({ value: x, label: 客户等级说明[x] }))} placeholder={空值符} 可清空 />}
                {摆(档?.website) && <InlineField 空时横线={企业} customerId={customer.id} field="website" label="官网" value={档?.website ?? null} placeholder="如 www.example.com" />}
              </>
            )}
            {/* 企业版：建档第一步选了阿里国际站ID（类型值、库里 kind 还叫旺旺）时，它只在联系方式子表里（客户表、档案都没有这一格），只读摆出来 */}
            {企业 && 旺旺们.length > 0 && (
              <div className="rec-field" style={{ cursor: "default" }}>
                <div className="rec-field-k">阿里国际站ID</div>
                <div className="rec-field-v" style={{ overflowWrap: "anywhere" }}>{旺旺们.join("、")}</div>
              </div>
            )}
            {/* 选项里带上现任：负责人是管理员或已停用时不在候选里，原来下拉直接显示一串 id（排查 D8）。
                一个人用（桌面端）时这两格不摆：下拉里只有自己，摆着只是让人多想一下（和客户表单同一个 独自一人 规则） */}
            {/* 企业版项目模式：客户页不转让（待定 14 红框），负责人只读；要换人在客户列表里整客户转让（连项目一起） */}
            {!独自一人(users, customer.salesOwnerId) && !摆法.转让 && (
              <div className="rec-field" style={{ cursor: "default" }} title={去项目跟进 ? "要换负责人：点上方「客户转让」" : "要换负责人：在客户列表里勾上这位，点「转让」"}>
                <div className="rec-field-k">销售负责人</div>
                <div className="rec-field-v">{customer.salesOwnerName ?? (企业 ? <span className="rec-field-empty" title="未分配">{空值符}</span> : <span className="rec-field-empty">未分配</span>)}</div>
              </div>
            )}
            {!独自一人(users, customer.salesOwnerId) && 摆法.转让 && (
              <InlineField 空时横线={企业} customerId={customer.id} field="salesOwnerId" label="销售负责人" value={customer.salesOwnerId} kind="select" options={带上现任(users, customer.salesOwnerId, customer.salesOwnerName)} />
            )}
            {/* 历史负责人（企业版 D-36）：换过负责人才摆；悬停看每次谁转的、从谁到谁、什么时候。停用的人名字照旧显示 */}
            {历史负责人们(换负责人记录, customer.salesOwnerName).length > 0 && (
              <Tooltip title={<div style={{ maxHeight: 260, overflowY: "auto" }}>{换负责人条们}</div>}>
                <div className="rec-field" style={{ cursor: "default" }}>
                  <div className="rec-field-k">历史负责人</div>
                  {/* 设计语言 D3 · M3-a：人名不拆到两行，只在「、」处折；手机没有悬停，点「变更记录」开底部面板（M3-c，D12） */}
                  <div className="rec-field-v rec-names">
                    {历史负责人们(换负责人记录, customer.salesOwnerName).map((n, i) => (
                      <Fragment key={i}>{i > 0 && "、"}<span className="rec-nm">{n}</span></Fragment>
                    ))}
                    <Button type="link" size="small" className="rec-hist-btn" onClick={() => set变更记录开(true)}>变更记录</Button>
                  </div>
                </div>
              </Tooltip>
            )}
            {/* 渠道负责人默认跟着推荐链；这里改的是这一位的单独订正，清空即恢复按推荐链 */}
            {摆渠道负责人 && 摆(customer.channelOwnerId) && (
              <InlineField 空时横线={企业} customerId={customer.id} field="channelOwnerId" label="渠道负责人" value={customer.channelOwnerId} kind="select" options={带上现任(users, customer.channelOwnerId, customer.channelOwnerName)} placeholder="按推荐链自动确定" 可清空 />
            )}
            {!外贸 && 摆法.旧字段 && 摆(customer.expectedSignAt) && <InlineField 空时横线={企业} customerId={customer.id} field="expectedSignAt" label="预计签约" value={customer.expectedSignAt} kind="date" placeholder={空值符} />}
            {/* 企业版不摆签约金额（10-28 去遗留 A4） */}
            {!企业 && 摆(customer.signedAmount > 0 ? 1 : null) && (
              <div className="rec-field" style={{ cursor: "default" }}>
                <div className="rec-field-k">{叫}金额</div>
                <div className="rec-field-v">{customer.signedAmount > 0 ? 已签约文字 : <span className="rec-field-empty">{是订单 ? "还没有订单" : "未签约"}</span>}</div>
              </div>
            )}
            {摆(customer.remark) && <InlineField 空时横线={企业} customerId={customer.id} field="remark" label="备注" value={customer.remark} kind="textarea" placeholder="点击写备注" />}
            {没填几项 > 0 && (
              <Button type="link" size="small" className="rec-sec-more" onClick={() => set资料全开(!资料全开)} aria-expanded={资料全开}>
                {资料全开 ? "收起没填的" : `展开没填的 ${没填几项} 项`}
              </Button>
            )}
          </>)}

          {!企业 && 推荐节}

          {/* 11-12 用户：去掉「全部 ›」（原来跳 /contacts?keyword=客户名），卡头只留一颗「＋」新增联系人（同一个 ContactForm、同样的只读判断）；
             企业版项目模式原来不给加（U-客户-03），这次用户点名要加回来 */}
          {节(去项目跟进 ? 客户详情左栏.联系人 : "联系人", contacts.length, !联系人只读 && (
                企业
                  /* 设计语言 D3 · M4-b（D09）：卡头动作「＋ 新增」图标 + 字，和关联组织的「＋ 关联」同一款 */
                  ? <Button type="text" size="small" className="rec-sec-add rec-head-act" icon={<PlusOutlined />} aria-label="新增联系人" onClick={() => { setEditingContact(null); setContactOpen(true); }}>新增</Button>
                  : (
                    <Tooltip title="新增联系人">
                      <Button type="text" size="small" className="rec-sec-add" icon={<PlusOutlined />} aria-label="新增联系人" onClick={() => { setEditingContact(null); setContactOpen(true); }} />
                    </Tooltip>
                  )
              ), <>
            {contacts.length === 0 && <div className="rec-empty">还没有联系人</div>}
            {企业 ? 企业联系人们 : 刚加的排前(排好的联系人, 刚加的联系人).map((c) => (
              <Fragment key={c.id}>
              <div className={`rec-mini${c.id === 刚加的联系人 ? " rec-tl-item-flash" : ""}`}>
                <Avatar size={26} style={{ background: avatarColor(c.name), color: AVATAR_TEXT, fontSize: 12 }}>{initial(c.name)}</Avatar>
                {/* 截断成「母亲…」之后，鼠标停上去得看得到全名 */}
                <span className="rec-mini-n" title={c.name}>
                  {c.name}
                  {是关键(c) && <Tag className="tag-key" style={{ marginLeft: 6, fontSize: 12, lineHeight: "18px", padding: "0 5px" }}>关键</Tag>}
                </span>
                <span className="rec-mini-m">{c.position ?? c.phone ?? ""}</span>
                {/* 编辑 / 删除平时不占位（审查 M4）：原来两颗图标常驻，三个字的名字被挤成「周明远…」。
                    悬停或键盘焦点进来时盖在右边那段说明上出现，和时间线每条的做法一样 */}
                {联系人操作(c)}
              </div>
              {/* 企业版没开项目模式时联系人还是一行一个：附件那一行摆在名字底下 */}
              {联系人附件数 && <ContactAttachments contactId={c.id} 名字={c.name} 起始个数={联系人附件数[c.id] ?? 0} 只读={联系人只读} 能删={公海删?.附件} />}
              </Fragment>
            ))}
          </>, undefined, "cust-contacts")}

          {/* 企业版项目模式（10-26）：客户名下的项目替掉商机——用户：「去除掉商机，不要演用个人版的老模型」。
              「开项目」给这位客户再建一个项目（待定 16）：客户自动带上 */}
          {/* 两层排版：项目在右边项目区的页签里，左栏不再列 */}
          {项目们 && !项目区 ? 节("项目", 项目们.length, (
                <Space size={4}>
                  {摆法.新建项目 && 新建项目 && !只读 && !去项目跟进 && <Button type="text" size="small" icon={<PlusOutlined />} loading={取建档中} onClick={开建项目}>开项目</Button>}
                  <Link href="/projects">全部 ›</Link>
                </Space>
              ), <>
              {/* 企业版项目不跟客户走（11-01）：只读的客户名下可能有同事负责、他看不到的项目，别说「还没有」（11-03 D3-3） */}
              {项目们.length === 0 && <div className="rec-empty">{全只读 ? "没有你能看的项目" : "还没有项目"}</div>}
              {项目们.map((p) => (
                <RowLink key={p.id} href={`/projects/${encodeURIComponent(p.id)}`} className="rec-mini rec-mini-2">
                  <span className="rec-mini-n" title={p.name}>{p.name}</span>
                  <span className="rec-mini-sub">
                    <Tag style={{ margin: 0 }}>{p.phase}</Tag>
                    <span className="rec-mini-m" title={p.result ?? p.node}>{p.result === "异常状态" ? `异常 · ${p.node}` : p.result ?? p.node}</span>
                    <span className="rec-mini-m rec-mini-money">{金额或空(p.amount, p.currency, true)}</span>
                    {主项目身份.get(p.id)?.length ? <span className="rec-mini-m" title={`项目身份：${主项目身份.get(p.id)!.join("、")}`}>{主项目身份.get(p.id)!.join("、")}</span> : null}
                  </span>
                </RowLink>
              ))}
            </>) : null}
          {/* 企业版项目关联（P17）：这位作为关联客户（不是主客户）参与的项目和身份。只读，身份在项目页「关联客户」里改 */}
          {参与项目们 && 参与项目们.some((x) => !x.主) && 节("参与的项目", 参与项目们.filter((x) => !x.主).length, null, <>
              {参与项目们.filter((x) => !x.主).map((x) => (
                <RowLink key={x.projectId} href={x.项目去 ?? `/projects/${encodeURIComponent(x.projectId)}`} className="rec-mini rec-mini-2">
                  <span className="rec-mini-n" title={x.名}>{x.名}</span>
                  <span className="rec-mini-sub">
                    {x.身份.length ? x.身份.map((t) => <Tag key={t} style={{ margin: 0 }}>{t}</Tag>) : <span className="rec-mini-m">没勾身份</span>}
                  </span>
                </RowLink>
              ))}
            </>)}
          {摆法.关联客户 && 关联们 && (去项目跟进 ? (
            <ProjectFold 名={客户详情左栏.关联}>
              <LinkedCustomers customerId={customer.id} 关联们={关联们} 只读={只读} 卡 组织 />
            </ProjectFold>
          ) : <LinkedCustomers customerId={customer.id} 关联们={关联们} 只读={只读} />)}
          {/* 企业版项目模式：客户背调挪到左栏，只摆状态标签，点开弹详情（U-客户-03；AI 改进后再挪显眼处） */}
          {去项目跟进 && 摆法.背调卡 && aiEnabled && (
            <ProjectFold 名="客户背调">
              <CustomerResearchTag customerId={customer.id} customerName={customer.name} 显示名={叫这位} 档案={背调档案} on记跟进={点跟进} 卡 上次初值={上次背调} />
            </ProjectFold>
          )}
          {!企业 && (
          <div className="rec-sec">
            <div className="rec-sec-t">
              <span>{叫} {contracts.length > 0 && contracts.length}</span>
              {!只读 && <Button type="link" size="small" style={{ padding: 0, height: "auto" }} onClick={() => { setEditingContract(null); setContractOpen(true); }}>{是订单 ? "新建订单" : "登记签约"}</Button>}
            </div>
            {contracts.length === 0 && <div className="rec-empty">{是订单 ? "还没有订单。商机点「转为订单」，或在这里新建" : "还没有签约"}</div>}
            {/* 外贸叫「订单」，其余叫「签约」：同一行样式（订单号 / 付款方式 / 供应商那几格随订单表 2026-10-29 删了，写在备注里） */}
            {contracts.map((c) => (
              <div key={c.id} className="rec-mini">
                <DollarOutlined style={{ color: "var(--success)" }} />
                <span className="rec-mini-n rec-mini-amt">{金额(c.amount, c.currency)}</span>
                <span className="rec-mini-m">{fmtDate(c.signedAt)}</span>
                {!只读 && <span className="rec-mini-acts">
                  <Button type="text" size="small" icon={<EditOutlined />} aria-label={是订单 ? "编辑这张订单" : "编辑这笔签约"} onClick={() => { setEditingContract(c); setContractOpen(true); }} />
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={是订单 ? "删除这张订单" : "删除这笔签约"} onClick={() => void confirmDeleteContract(c)} />
                </span>}
              </div>
            ))}
          </div>
          )}
        </aside>

        {项目区?.({
          全部沟通: <div className="proj-mod-body">{筛选条}{时间线}</div>,
          全部沟通数: `${history.rows.length}${history.hasMore ? "+" : ""}`,
          待办: 摆法.待办 ? 节(客户详情待办, 待办数, null, <div className="proj-mod-body" aria-label={客户详情待办}>{待办身}</div>, { 主: 只读 ? null : { 字: "新建待办", onClick: () => setTaskOpen(true) }, 色: 模块钮色.待办 }) : null,
          开建项目: 能建项目 ? 开建项目 : null,
          全只读,
          提醒: 提醒条,
        })}

        {/* ================= 中栏：时间线 ================= */}
        {!项目区 && <section className={去项目跟进 ? "rec-col rec-col-blocks rec-sum" : `rec-col rec-card${摆法.沟通汇总 ? " rec-sum" : ""}`}>
          {/* 虚线下属的客户：跟进也记不了，速记框不摆，免得写完才被拦（10-25 实测 F4）。顶上那条黄条已说清只能看 */}
          {/* 企业版项目模式：记录输入挪到项目页（定稿 P5 待定 14 黄框），客户页只看时间线 */}
          {!全只读 && 摆法.记录输入 && <div className="rec-composer">
            {速记稿.提示}
            <Input.TextArea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 8 }}
              maxLength={5000}
              placeholder={customer.pool ? `公海${b.customer}：记一笔跟进就领取过来、归你跟进…` : 企业 ? "粘贴聊天记录或会议要点" : aiEnabled ? `记一笔，或直接粘贴和${b.customer}的微信聊天记录…` : "记一笔…"}
            />
            <div className="rec-composer-bar">
              <span className="rec-composer-hint">
                {aiEnabled ? "「AI 解析」会把它整理成沟通记录并留存原文；「直接记」原样存为一条记录" : "Enter 换行，写完点「直接记」"}
              </span>
              {aiEnabled && (
                <Button size="small" type="primary" ghost icon={<ThunderboltOutlined />} disabled={memo.trim().length < 5 || AI已用完} onClick={() => openFollow(null, memo)}>
                  AI 解析
                  <AiCost />
                </Button>
              )}
              <Button size="small" loading={quickSaving} disabled={!memo.trim()} onClick={() => void quickSave()}>
                直接记
              </Button>
            </div>
            {速记话 && <div role={速记话.错 ? "alert" : "status"} className={速记话.错 ? "cd-task-err" : "rec-plan-said"}>{速记话.话}</div>}
          </div>}

          {现计划 && 摆法.下次跟进 && 计划话?.错 && <div role="alert" className="cd-task-err">{计划话.话}</div>}
          {现计划 && plan && 摆法.下次跟进 && (
            <div className="rec-plan" data-focus={`plan:${plan.id}`}>
              <span className="rec-plan-k">下次跟进</span>
              <span className="rec-plan-v">
                {plan.subject} · {plan.method}
              </span>
              {/* 截止时间和计划页、待办同一种说法（审查 D1）；具体几点在悬停里 */}
              <span className={`rec-plan-m${已过期(plan.plannedAt) ? " is-over" : ""}`} title={fmtDateTime(plan.plannedAt)}>
                {截止说法(plan.plannedAt)}
              </span>
              {!只读 && (
                <>
                  <Button size="small" type="text" onClick={() => { set排新计划(false); setPlanOpen(true); }}>
                    改
                  </Button>
                  <Button size="small" type="text" icon={<CheckCircleOutlined />} onClick={() => set在完成({ id: plan.id, subject: plan.subject, method: plan.method, customerId: customer.id, 有WhatsApp })}>
                    完成
                  </Button>
                </>
              )}
            </div>
          )}

          {/* 企业版只用项目（P14 第 6 条）：只读的「沟通记录」，各项目的跟进汇总在这里，每条标出属于哪个项目 */}
          {/* 10-31 照图 04：模块标题放卡里、和别的模块标题一样大；原来那句「汇总各项目的沟通；点右上…」去掉——
              按钮已经挪到名字下面，每条也标了项目 */}
          {/* 「新建沟通」从页头挪到这里（U-客户-03）：有项目开弹窗记、没有就开项目。窄屏 AI 收进抽屉时，入口也摆在这 */}
          {去项目跟进 ? (
            <>
              {/* 「新建沟通」在卡头（U-客户-03）：有在推项目就开弹窗记（11-01 会议 §5，不跳转），没有就开新开项目弹窗。窄屏 AI 收进抽屉时，入口也摆在这 */}
              {摆法.沟通汇总 && 节("沟通记录", `${history.rows.length}${history.hasMore ? "+" : ""}`, (
                <Space size={8}>
                  {aiEnabled && AI在抽屉里 && (
                    <Button size="small" icon={<AiOutlined />} onClick={() => setAI抽屉开着(true)}>
                      AI
                    </Button>
                  )}
                </Space>
              ), <div className="proj-mod-body">{筛选条}{时间线}</div>, { 主: { 字: "新建沟通", onClick: 点跟进 }, 色: 模块钮色.沟通 })}
              {/* 待办单独一块（11-01 用户：「你看待办板块你就和沟通记录放一起了」），摆在沟通记录下面 */}
              {摆法.待办 && 节(去项目跟进 ? 客户详情待办 : "待办", 待办数, null, <div className="proj-mod-body" aria-label={去项目跟进 ? 客户详情待办 : "待办"}>{待办身}</div>, { 主: 只读 ? null : { 字: "新建待办", onClick: () => setTaskOpen(true) }, 色: 模块钮色.待办 })}
            </>
          ) : (
            <>
          {摆法.沟通汇总 && (
            <div className="rec-sec-t rec-tl-cap">
              <span>沟通记录</span>
            </div>
          )}
              {筛选条}
              {时间线}
            </>
          )}
        </section>}

        {/* ================= 右栏：AI + 计划/待办 ================= */}
        {!项目区 && 有右栏 && (
        <aside className="rec-right rec-rail">
          <Space orientation="vertical" size={14} style={{ width: "100%" }}>
            {aiEnabled && !AI在抽屉里 && (
              <div className={量到 ? "rec-card" : "rec-card rec-ai-guess-col"}>
                <AiPanel customerId={customer.id} customerName={customer.name} 显示名={叫这位} 档案={背调档案} fingerprint={fingerprint} signed={customer.followStatus === "已签约" && !外贸 && !企业} hasRecords={followUps.length > 0} on记跟进={点跟进} 简报叫={企业 ? "智能总结" : "简报"} 不背调={!摆法.背调} 背调另放={摆法.背调卡} 上次背调={上次背调} />
              </div>
            )}

            {/* 企业版：客户背调单独一张卡（P14 第 5 条），不挂在 AI 面板、「跟进」菜单里；AI 收进抽屉时它照样在右栏。
                背调是 AI 的活，同 AI 面板一样只在开了 AI 时摆 */}
            {摆法.背调卡 && aiEnabled && !去项目跟进 && <CustomerResearchCard customerId={customer.id} customerName={customer.name} 显示名={叫这位} 档案={背调档案} on记跟进={点跟进} 上次初值={上次背调} />}

            {!去项目跟进 && 待办卡}

            {/* 企业版项目模式不排「下次跟进」（定稿 P5 待定 14 红框）：下一步时间记在项目上 */}
            {!现计划 && 摆法.下次跟进 && (
              <div className="rec-card rec-side-card">
                <div className="rec-side-t">
                  <span>下次跟进</span>
                </div>
                {计划话 && !计划话.错 ? (
                  <div role="status" className="rec-plan-said">
                    {计划话.话}
                    {!只读 && <Button type="link" size="small" onClick={() => { set计划话(null); set排新计划(true); setPlanOpen(true); }}>排下一次</Button>}
                  </div>
                ) : <Typography.Text type="secondary" style={{ fontSize: 13 }}>尚未安排</Typography.Text>}
                {!只读 && (
                  <Button block style={{ marginTop: 10 }} onClick={() => setPlanOpen(true)}>
                    制定跟进计划
                  </Button>
                )}
              </div>
            )}
          </Space>
        </aside>
        )}
      </div>
      </资料改挡上下文.Provider>
      </只能看的格上下文.Provider>
      </只读上下文.Provider>

      {/* 1180 以下 AI 收进抽屉。面板本身一个字都不用改——它的状态挂在
          进程内任务表上（lib/ai-jobs），不在组件 state 里，关掉再开还在那儿 */}
      {aiEnabled && (!!项目区 || !量到 || AI在抽屉里) && (
        <Drawer placement="right" styles={{ wrapper: { width: 380 } }} open={AI抽屉开着} onClose={() => setAI抽屉开着(false)} title={`AI · ${叫这位}`}>
          <AiPanel customerId={customer.id} customerName={customer.name} 显示名={叫这位} 档案={背调档案} fingerprint={fingerprint} signed={customer.followStatus === "已签约" && !外贸 && !企业} hasRecords={followUps.length > 0} on记跟进={点跟进} 简报叫={企业 ? "智能总结" : "简报"} 不背调={!摆法.背调} 背调另放={摆法.背调卡} 上次背调={上次背调} />
        </Drawer>
      )}

      {/* 弹窗：新建/编辑跟进仍用完整表单（字段多），其余小表单也保留 */}
      <FollowUpForm
        open={followOpen}
        onClose={() => setFollowOpen(false)}
        onSaved={() => {
          setFollowOpen(false);
          速记稿.存好了();
          setMemo("");
          if (followInit.record?.id) void history.refreshRow(followInit.record.id).catch(() => 说就地("跟进已保存，请刷新页面核对最新内容"));
          router.refresh();
        }}
        customerId={customer.id}
        有WhatsApp={有WhatsApp}
        record={followInit.record}
        initialAiText={followInit.aiText}
        /* 到期了（今天或更早）的那条计划：记完这一笔默认顺手完成它（审查 M9） */
        待收口计划={plan && !dayjs(plan.plannedAt).isAfter(dayjs().endOf("day")) ? plan : null}
        完成了计划={(p, 已完成) => void 完成计划(p, `跟进已记录，计划「${p.subject}」一并完成`, 已完成)}
        contacts={contacts}
        opportunities={[]}
        projects={记沟通项目}
        新建项目={去项目跟进 ? (能建项目 ? 开建项目 : null) : undefined}
        没项目说法={去项目跟进 && (跟进去处 ?? []).some((p) => p.主 && !p.结束) ? 沟通都不能记话 : undefined}
        aiEnabled={aiEnabled}
        只读={只读}
      />
      <CompletePlanModal
        plan={在完成}
        onClose={() => set在完成(null)}
        onDone={(r) => {
          const p = 在完成;
          set在完成(null);
          if (!p) return;
          if (r.kind === "skip") return void 完成计划(p);
          router.refresh();
          void window.desktopReminders?.刷新();
          // 记下的这笔不算有效沟通之类的那句（框里说过一次，框收得快）：页头下面就地再说一遍
          if (r.提示) 说就地(r.提示);
          // 记一笔并完成：「下次跟进」那块就地说一句，底部撤销条可撤（撤销 = 删掉刚记的那笔和刚排的下一条、计划回到待办）
          const 话 = r.next ? `已记一笔，「${p.subject}」完成；下次 ${dayjs(r.next).format("M 月 D 日")}` : `已记一笔，「${p.subject}」完成`;
          if (!r.next) { set刚完成(p.id); 说计划({ 话 }); }
          showUndo({
            话,
            毫秒: 6000,
            撤销: async () => {
              const u = await 撤销记一笔({ customerId: p.customerId, 跟进id: r.跟进id, 计划id: p.id, 下次计划id: r.下次计划id })
                .catch((出错) => ({ ok: false as const, error: 动作出错话(出错, "没撤销成，请稍后重试") }));
              if (u.ok) { set计划话(null); set刚完成(null); }
              void window.desktopReminders?.刷新();
              router.refresh();
              return u;
            },
          });
        }}
      />
      <TaskForm open={taskOpen} onClose={() => setTaskOpen(false)} onSaved={() => { setTaskOpen(false); router.refresh(); }} customerId={customer.id} />
      <PlanForm
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        onSaved={() => { setPlanOpen(false); router.refresh(); }}
        customerId={customer.id}
        有WhatsApp={有WhatsApp}
        record={排新计划 ? null : plan}
        默认天数={排新计划 ? 7 : 3}
      />
      <Drawer
        placement="bottom"
        open={变更记录开}
        onClose={() => set变更记录开(false)}
        closable={false}
        styles={{ wrapper: { height: "auto", maxHeight: "80dvh" }, body: { padding: "0 16px 16px" } }}
        rootClassName="pane-sheet hist-sheet"
      >
        <div className="sheet-grab" aria-hidden="true" />
        <div className="hist-sheet-h">
          <b>负责人变更记录</b>
          <Button type="text" className="sheet-x" icon={<CloseOutlined />} aria-label="关闭负责人变更记录" onClick={() => set变更记录开(false)} />
        </div>
        {换负责人条们}
      </Drawer>
      <ContactForm open={contactOpen} onClose={() => setContactOpen(false)} onSaved={(新加的) => { setContactOpen(false); if (新加的) set刚加的联系人(新加的); router.refresh(); }} customerId={customer.id} record={editingContact} 号码种类={企业 ? 号码种类 : undefined} 职务选项={企业 ? 职务选项 : undefined} />
      <ContractForm
        open={contractOpen}
        customerId={customer.id}
        editing={editingContract}
        onClose={(saved) => {
          setContractOpen(false);
          setEditingContract(null);
          if (saved) router.refresh();
        }}
      />
      <CustomerForm
        open={custOpen}
        editing={customer}
        users={users}
        channels={channels}
        企业版={企业}
        客户状态选项={客户状态选项}
        客户状态色={客户状态色}
        客户状态自动={客户状态自动}
        分配方式选项={分配方式选项}
        客户类型选项={客户类型选项}
        客户属性选项={客户属性选项}
        字典释义={字典释义}
        onClose={(saved) => {
          setCustOpen(false);
          if (saved) router.refresh();
        }}
      />
      <TransferBox open={转让开} 客户名={叫这位} 候选={转让候选} 定向={指定定向} 要申请={转让要申请} 作废天数={移交作废天数} 原因选项={转让原因?.选项 ?? []} 取预览={取转走预览} 做={发转让} 自动={转让框自动} onClose={() => set转让开(false)} />
      {头部框 && (
        <Modal open title={`${头部框 === "关联客户" && 去项目跟进 ? 客户详情左栏.关联 : 客户头部框叫法[头部框]} · ${叫这位}`} footer={null} width={头部框 === "转让" ? 480 : 640} onCancel={() => set头部框(null)}>
          {头部框 === "管理联系人" && (
            <div className="proj-modal-list">
              {可管联系人.map((c) => (
                <div key={c.id} className="proj-modal-row">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span>{c.name}</span>
                      {c.isPrimary && <Tag style={{ marginInlineEnd: 0 }}>主要</Tag>}
                      {c.挂靠 && <Tag style={{ marginInlineEnd: 0 }}>挂靠</Tag>}
                    </div>
                    {(c.position || c.phone) && (
                      <div className="proj-modal-clip" style={{ color: "var(--text-muted)", fontSize: "var(--dt-aux, 12px)" }}>
                        {[c.position, c.phone].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                  <Space size={4}>
                    <Button size="small" onClick={换框(() => { setEditingContact(c); setContactOpen(true); })}>编辑</Button>
                    {/* 挂来的不给删，拿掉走卡上的「解除挂靠」；只移出 / 彻底删 各自原地确认（同卡上那颗） */}
                    {!c.挂靠 && !去项目跟进 && <ContactRemoveInline c={c} 文字 />}
                  </Space>
                </div>
              ))}
            </div>
          )}
          {(头部框 === "关联客户" || 头部框 === "管理关联") && 关联们 && (
            <LinkedCustomers customerId={customer.id} 关联们={关联们} 只读={只读} 起手={头部框 === "关联客户"} 组织={去项目跟进} />
          )}
        </Modal>
      )}
      {/* 客户页「新增项目」（原型 cr.old）：同一张新建表，客户定死是这一位，只填项目和首条沟通 */}
      {新建项目 && (
        <NewProjectEntry
          open={建项目开着}
          onClose={() => set建项目开着(false)}
          onError={(话) => 说就地(话, true)}
          on取中={set取建档中}
          customer={{ id: customer.id, name: customer.name, shortName: customer.shortName, customerNo: customer.customerNo, salesOwnerId: customer.salesOwnerId }}
          联系人们={contacts.filter((c) => !c.挂靠).map((c) => ({ id: c.id, name: c.name, isPrimary: c.isPrimary }))}
        />
      )}
    </div>
  );

  /**
   * 删一条跟进记录。**确认在那一行上就地问**（见 FollowItem 里的 InlineConfirm），
   * 所以这里不再弹框——原来那个框只有一句「删除这条跟进记录？」，
   * 盖半屏问一句话，代价比它防住的误点还大。
   */
  async function deleteFollow(f: FollowUpRow) {
    const r = await deleteFollowUp(f.id, customer.id);
    router.refresh();
    // 没删掉：问句留着（InlineConfirm 见 {ok:false} 不收），原因写在页头下面那行
    if (!r.ok) { 说就地(r.error, true); return r; }
    history.remove(f.id);
    // 删了不给撤销（11-09 删 restoreFollowUp）：企业版进回收站，总管理能恢复；这一条从时间线消失就是反馈，不再弹顶部提示
    return r;
  }

  async function confirmDeleteContract(r: ContractRow) {
    const 是最后一笔 = contracts.length === 1;
    const 退回 = (await 删签约前清点(r.id).catch(() => null))?.退回商机 ?? [];
    // 登记时顺手标成赢单的商机会退回进行中（L-007）：删之前在后果里说清（第 2 期 2a）
    // 删签约 / 订单（P-界面-40 后果框）：后果分条写清金额和连带；没成原因写在框里不关框；成了这一笔从列表消失，不再弹顶部提示
    revertChoice.current = REVERT_CHOICES[0].value;
    await 问后果({
      题: 是订单 ? "删除这张订单" : "删除这条签约记录",
      危: true,
      后果: [
        { 标: "金额", 话: <b className="num" style={{ overflowWrap: "anywhere" }}>{金额(r.amount, r.currency)}</b> },
        是最后一笔
          ? { 标: "会发生", 话: `这是该${b.customer}唯一一笔${叫}，删除后${叫}金额归零，跟进状态跟着退回（下面选）`, 级: "警" as const }
          : { 标: "会发生", 话: "删除后统计数据会同步变化", 级: "警" as const },
        ...(退回.length ? [{ 标: "一起退", 话: `${是订单 ? "转成这张订单的商机" : "登记这笔时一起标成赢单的商机"}${退回.map((n) => `「${n}」`).join("")}会退回进行中`, 级: "警" as const }] : []),
      ],
      补充: 是最后一笔 ? (
        <div>
          <div style={{ marginBottom: 6, fontSize: 13 }}>跟进状态退回到：</div>
          <Select
            style={{ width: "100%" }}
            aria-label="跟进状态退回到"
            defaultValue={revertChoice.current}
            onChange={(v) => (revertChoice.current = v)}
            options={[
              ...REVERT_CHOICES.map((c) => ({
                value: c.value,
                label: `${statusLabel(b, c.value)} · ${statusLabel(b, c.decision)}（${c.说明}）`,
              })),
              { value: "", label: `保持「${statusLabel(b, "已签约")}」不变（我知道自己在做什么）` },
            ]}
          />
        </div>
      ) : undefined,
      是: "删除",
      做: async () => {
        const picked = REVERT_CHOICES.find((c) => c.value === revertChoice.current);
        const res = await deleteContract(r.id, customer.id, 是最后一笔 && picked ? { followStatus: picked.value, decisionStatus: picked.decision } : null);
        router.refresh();
        if (!res.ok) return res;
      },
    });
  }
}

/** 状态标签：点一下弹出下拉直接改，改完 Tag 过渡到新颜色 */
function StatusPicker({
  customerId,
  field,
  value,
  options,
  children,
  释义,
}: {
  customerId: string;
  field: "followStatus" | "decisionStatus" | "custStatus";
  value: string;
  options: { value: string; label: string }[];
  children: React.ReactNode;
  /** 菜单里每项下面一行灰字（企业版客户状态，10-30）：名字 → 释义；不给就是一行名字 */
  释义?: Record<string, string>;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  /** 没改成：原因就地写在这枚状态章后面，几秒后收（不弹顶部提示） */
  const [错, set错] = useState<string | null>(null);
  // 同事的客户（互看）、字段权限里这一格只能看（11-03 D5-1）：状态章只显示
  const 整页只读 = useContext(只读上下文);
  const 权限挡 = useContext(只能看的格上下文).includes(field);
  if (整页只读 || 权限挡) return <span style={{ display: "inline-flex" }}>{children}</span>;
  return (
    <Dropdown
      trigger={["click"]}
      menu={{
        selectedKeys: [value],
        items: options.map((o) => ({ key: o.value, label: 释义?.[o.value] ? <div><div>{o.label}</div><div className="muted" style={{ fontSize: 12, lineHeight: 1.4, whiteSpace: "normal" }}>{释义[o.value]}</div></div> : o.label })),
        // 有释义时菜单限宽，长释义折行（Windows 1024 宽也不出屏）
        ...(释义 ? { style: { maxWidth: 释义下拉宽 } } : {}),
        onClick: async ({ key }) => {
          if (key === value) return;
          setSaving(true);
          const { patchCustomer } = await import("../actions");
          const res = await patchCustomer(customerId, field, key);
          setSaving(false);
          if (!res.ok) { set错(res.error); setTimeout(() => set错(null), 5000); }
          else { set错(null); router.refresh(); }
        },
      }}
    >
      <motion.span style={{ cursor: "pointer", display: "inline-flex", opacity: saving ? 0.5 : 1 }} whileTap={{ scale: 0.96 }} layout>
        {children}
        {错 && <span role="alert" className="cd-task-err rec-tag-err">{错}</span>}
      </motion.span>
    </Dropdown>
  );
}

/** 时间线上「项目：X」默认去项目详情的沟通卡（服务端再判跳不跳） */
const 项目页地址 = (id: string) => `/projects/${encodeURIComponent(id)}#project-follow`;

function FollowItem({ f, showOwner, index, onEdit, onDelete, 可改 = true, 可删 = 可改, 不挂商机 = false, 汇总 = false, 项目地址 = 项目页地址 }: { f: FollowUpRow; showOwner: boolean; index: number; onEdit: () => void; onDelete: () => void; 可改?: boolean; 可删?: boolean; 不挂商机?: boolean; 汇总?: boolean; 项目地址?: (projectId: string) => string }) {
  const { 曲线, 时长, 间隔 } = useMotionTheme();
  const meta = FOLLOW_TYPE_MAP[f.type] ?? FOLLOW_TYPE_MAP.OTHER;
  const [srcOpen, setSrcOpen] = useState(false);
  const 原文 = f.sourceText && (
    <div style={{ marginTop: 2 }}>
      <Typography.Link style={{ fontSize: 12, color: "var(--text-muted)" }} onClick={() => setSrcOpen((v) => !v)}>
        {srcOpen ? "收起原文" : "查看原文"}
      </Typography.Link>
      <AnimatePresence>
        {srcOpen && (
          <motion.pre
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            style={{
              marginTop: 6, marginBottom: 0, padding: "10px 12px", background: "var(--workbench)", border: "1px solid var(--line-soft)",
              borderRadius: 10, fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word",
              fontFamily: "inherit", color: "var(--ink-soft)", maxHeight: 320, overflow: "auto",
            }}
          >
            {f.sourceText}
          </motion.pre>
        )}
      </AnimatePresence>
    </div>
  );
  const 时间 = (
    // 今年的不写年份（审查 D5）：标题改成一行省略之后，每省一截时间就多露几个字的标题。全的在悬停里
    <span className="rec-tl-time" title={fmtDateTime(f.occurredAt)}>
      {dayjs(f.occurredAt).isSame(dayjs(), "year") ? dayjs(f.occurredAt).format("M 月 D 日 HH:mm") : fmtDateTime(f.occurredAt)}
    </span>
  );
  // 企业版客户页的「沟通记录」（只读汇总，10-31 照图 04）：灰底方式 + 时间一行，下面内容、蓝色「项目：名」、灰字记录人，条与条之间一道线。
  // 不摆图标块，也没有编辑 / 删除（去项目里管）
  if (汇总) return (
    <motion.div id={`fu-${f.id}`} className="rec-tl-item rec-sum-item" layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: Math.min(index, 8) * 间隔, duration: 时长.base, ease: 曲线.ease }}>
      <div className="rec-tl-body">
        <div className="rec-tl-head">
          <span className="rec-sum-type">{跟进方式名(f)}</span>
          {时间}
          {f.status !== "已完成" && (
            <Tag color={FOLLOW_RECORD_STATUS_COLOR[f.status] ?? "default"} style={{ margin: 0 }}>
              {f.status}
            </Tag>
          )}
        </div>
        {f.title?.trim() && <div className="rec-sum-title">{f.title}</div>}
        <div className="rec-tl-content">{f.content}</div>
        {原文}
        {/* 沟通上的截图、录音（F-047）：市场成员看分出去的客户只剩这条汇总时间线，截图也摆在这里；只看、看大图、下载，传和删去项目详情 */}
        {f.附件?.length ? <FollowAttachments followUpId={f.id} 附件={f.附件} 能传={false} 能删={false} /> : null}
        {f.项目 && <div><RowLink href={项目地址(f.项目.id)} className="rec-sum-proj" title={`项目：${f.项目.名}`}>项目：{f.项目.名}</RowLink></div>}
        <div className="rec-tl-meta">
          {f.ownerName && <span>{f.ownerName}</span>}
          {f.已修改 && <span title="这条沟通提交后改过，改了什么见操作日志">已修改</span>}
          {f.duration ? <span>时长 {duration(f.duration)}</span> : null}
          {(f.contactName || f.contactId) && <span>{空显(f.contactName)}{f.contactPosition ? `（${f.contactPosition}）` : ""}</span>}
          {f.participants && <span>参与人：{f.participants}</span>}
          {f.dueAt && <span>截止 {fmtDateTime(f.dueAt)}</span>}
        </div>
      </div>
    </motion.div>
  );
  return (
    <motion.div id={`fu-${f.id}`} className="rec-tl-item" layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: Math.min(index, 8) * 间隔, duration: 时长.base, ease: 曲线.ease }}>
      <div className="rec-tl-dot" style={{ background: meta.color }}>
        {FOLLOW_TYPE_ICON[f.type]}
      </div>
      <div className="rec-tl-body">
        <div className="rec-tl-head">
          <span className="rec-tl-type">{跟进方式名(f)}</span>
          {f.title?.trim() && <span className="rec-tl-title" title={f.title}>· {f.title}</span>}
          {/* 商机页 10-28 删了（/opportunities 只剩转项目的跳转）：只标出是哪个商机，不再做成链接 */}
          {f.opportunity && !不挂商机 && <span className="rec-tl-order" title={`关联商机：${f.opportunity.name}`}>关联商机：{f.opportunity.name}</span>}
          {/* 企业版沟通记录（P14 第 6 条）：每条标出是哪个项目的，点了去项目详情的「沟通」卡记 */}
          {f.项目 && <RowLink href={项目地址(f.项目.id)} className="rec-tl-order rec-tl-proj" title={`项目：${f.项目.名}`}>项目：{f.项目.名}</RowLink>}
          {f.status !== "已完成" && (
            <Tag color={FOLLOW_RECORD_STATUS_COLOR[f.status] ?? "default"} style={{ margin: 0 }}>
              {f.status}
            </Tag>
          )}
          {/* 时间和编辑/删除包在一起：图标得跟着时间走，不能按整个头部居中 */}
          <span className="rec-tl-when">
            {时间}
            {(可改 || 可删) && <span className="rec-tl-acts">
              {可改 && <Button type="text" size="small" icon={<EditOutlined />} onClick={onEdit} aria-label="编辑跟进" />}
              {/* 就地确认，不弹框：一条跟进记录，删了还能再写一条——
                  后果一句话说得完的事，不值得一个盖住半屏的框（见 components/InlineConfirm.tsx） */}
              {/* 带提醒时间、还没做的「提醒 / 任务」顺带建了一条待办，删它待办也一起走（第 2 期 2a：说清会一起删什么） */}
              {可删 && <InlineConfirm 问={(f.type === "TASK" || f.type === "REMIND") && f.dueAt && f.status !== "已完成" ? "连同它的待办一起删？" : "删除这条？"} 做={onDelete}>
                <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label="删除跟进" />
              </InlineConfirm>}
            </span>}
          </span>
        </div>
        <div className="rec-tl-content">{f.content}</div>
        {原文}
        <div className="rec-tl-meta">
          {f.duration ? <span>时长 {duration(f.duration)}</span> : null}
          {(f.contactName || f.contactId) && <span>{空显(f.contactName)}{f.contactPosition ? `（${f.contactPosition}）` : ""}</span>}
          {f.participants && <span>参与人：{f.participants}</span>}
          {f.dueAt && <span>截止 {fmtDateTime(f.dueAt)}</span>}
          {showOwner && <span style={{ marginLeft: "auto" }}>{f.ownerName}</span>}
        </div>
      </div>
    </motion.div>
  );
}

"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useShellNavGo } from "@/lib/nav-pending";
import Link from "next/link";
import { LinkPending } from "@/components/NavProgress";
import { Alert, AutoComplete, Button, Input, InputNumber, Modal, Select, Space, Switch, Tag } from "antd";
import { CheckOutlined, MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import CopyValue from "@/components/CopyValue";
import DatePicker from "@/components/BusinessDatePicker";
import { PageHead } from "@/components/ui";
import { useBusiness } from "@/lib/business-client";
import { useMe, 默认负责人 } from "@/lib/me-client";
import { 草稿全名, 读草稿, 存草稿, 清草稿, 有内容, 带回话 } from "@/lib/form-draft";
import { 跟进类型们 } from "@/lib/constants";
import FollowMethodSelect, { useHabitDefault } from "@/components/FollowMethodSelect";
import { 对得上的方式 } from "@/lib/follow-method";
import { 币种选项, 默认币种 } from "@/lib/currency";
import { 金额格式 } from "@/lib/money-input";
import { 成员选项, 独自一人, dayjs, type 可选成员 } from "@/lib/utils";
import { 外贸精简 } from "@/lib/business-config";
import { 项目名上限, 备注上限, 占位名提示 } from "@/lib/project/wizard";
import { 仅记录用节点 } from "@/lib/project/system-created";
import { 显示节点名, 企业版字典 } from "@/lib/project/stage-dict";
import { 是占位值 } from "@/lib/project/required";
import { 有效线索节点, 建档不能过线索验证 } from "@/lib/project/stage-gates";
import { 下一步文字上限 } from "@/lib/project/project-fields";
import { checkDuplicate, 推荐人候选, type DuplicateHit } from "../../customers/actions";
import { 渠道触点们, 客户介绍触点, 新建来源还差 } from "@/lib/enterprise/touchpoint";
import { 查号码, 查客户名, type 查号码结果 } from "../../customers/number-actions";
import type { 名撞结论 } from "@/lib/enterprise/dupe-ledger";
import AttachEntry, { 负责人说法, 我名下入口 } from "./AttachEntry";
import RescueKey from "../../customers/RescueKey";
import DedupeClaimKey from "../../customers/DedupeClaimKey";
import RepeatInquiryKey from "../../customers/RepeatInquiryKey";
import { 向导能选类型, 带进联系人, 号码类型叫法, 查重提示, type 联系人三格 } from "@/lib/enterprise/contact-format";
import { 每人最多号码, 内置号码种类, 号码上限, 联系人姓名问题 } from "@/lib/enterprise/customer-v2";
import { 线索号码种类 } from "@/lib/agent/proposals";
import ChannelPicker, { type 可选渠道 } from "@/components/ChannelPicker";
import WizardCustomerAddress, { 向导客户地址值, type 向导客户地址 } from "./WizardCustomerAddress";
import SameNumberEntry from "./SameNumberEntry";
import { 原负责人不能领回提示 } from "@/lib/enterprise/pool-rules";
import { 建档向导, 建档只建客户 } from "../actions";
import { 搜客户, type 可挑客户 } from "../../customers/[id]/pick";
import { 给客户建项目, 建项目带走的项目, 新项目分配数据 } from "../../customers/[id]/project-actions";
import { useCarryConfirm } from "../../customers/useCarryConfirm";
import { 指定选项, 方向可指定 } from "@/lib/enterprise/designate-options";
import type { 指定候选表 } from "@/lib/enterprise/assign-direction-pick-core";
import { 三种业务线, 两条线, 分配说明, 业务线必填, 客户业务线必填, 建议业务线, 所在地预填, 所在地提示, 新客户分配方式们, 新客户默认分配方式 } from "@/lib/enterprise/assign-line";
import { 区域分配说明, 默认分配方向, 方向来源说明 } from "@/lib/enterprise/customer-region";
import type { 线 } from "@/lib/enterprise/lead-assign";
import AddressInput, { 空地址 } from "@/components/AddressInput";
import { 详细地址上限, 详细地址提示 } from "@/lib/project/profile-rules";
import type { 客户地址 } from "@/lib/enterprise/customer-v2";
import { 没业务角色不能新建话 } from "@/lib/enterprise/permissions";
import { 动作出错话 } from "@/lib/stale-deploy";
import { 格里该聚焦的 } from "@/lib/form-validation";
import { 滚法 } from "@/lib/reduced-motion";
import ReplyWindowInput from "@/components/ReplyWindowInput";
import { 回复晚于回收, 北京墙钟转时刻, 认定时分配, 分配晚于回复 } from "@/lib/project/time-fields";
import ScheduleAssignInput from "@/components/ScheduleAssignInput";
import { 选沟通附件, 传沟通附件 } from "@/components/FollowAttachments";
import { 全称提示, 全称像人名, 像人名提示, 名称框提示 } from "@/lib/enterprise/fullname-hint";

const 草稿键 = "项目建档向导";
const 时间格式 = "YYYY-MM-DD HH:mm";

/** 向导第一行下面多加的一行号码：kind = ContactMethod.kind（customer-v2.ts 内置号码种类） */
type 多的号 = { kind?: string; value: string };
/** 第一行号码类型 → 多加一行默认的 kind（跟第一行同类） */
const 第一行的kind = (t?: string) => 内置号码种类.find((x) => x.验 && x.验 === t)?.kind;
type 稿 = {
  /** 第一步那个号码。企业版下是选的那种号码（手机号 / 邮箱 / 微信 / 阿里国际站ID，类型值还是「旺旺ID」），不一定是电话 */
  phone: string;
  /** 企业版第一步选的号码类型（lib/enterprise/contact-format.ts）；开关关着没有这格 */
  号码类型?: string;
  /**
   * 企业版：第一行下面多加的号码（员工反馈「客户会留多个电话或者微信号」），类型 + 号码，连第一行最多 每人最多号码 行。
   * 类型和 AI 新线索卡、联系人表单同一套（号码类型字典默认八种，kind 存库写法）。第一行是查重用的主号，建好和这几行一样记在主要联系人身上（E-260 客户本身没有号码）；
   * 这几行当 联系人.号码们 交给服务端记在主要联系人身上：手机、邮箱、微信、阿里国际站ID 同第一行全公司查重，其余只验格式。老草稿里没有
   */
  更多号码?: 多的号[];
  联系人: { name: string; position: string; phone: string; email: string; wechat: string };
  /** 企业版：上一次查重带进联系人那几格的值（人没动过的，再查一个号时跟着换）；开关关着没有这格 */
  带过?: Partial<联系人三格>;
  /** 客户负责人：没开项目时才用（P-界面-33 默认自己、可改）；开了项目客户归谁由服务端定（P-转-03） */
  客户负责人?: string;
  /**
   * 没开项目（只建客户）时市场成员选的「项目分配方式」（11-18）：客户自带的潜客培育项目怎么分，0 指定 / 1 自动 / 3 暂不分配；
   * 方向 = 按区域的市场成员选自动分配时人改的内贸 / 外贸（没改 = 不交，服务端按默认算）。和带项目时的 项目.分配方式 分开记；老草稿里没有
   */
  只建分配?: { 方式?: number; 方向?: 线 | null };
  /** 渠道 / 触点：企业版新建线索至少选一个（P-渠道-08，老草稿里没有）；介绍人：触点 = 客户介绍时挂的已有客户（P-渠道-09） */
  客户: { name: string; school: string; remark: string; 渠道?: string; 触点?: string; 介绍人?: string;
    /** 客户地址三格（企业版，审核 11-18 P1-2，WizardCustomerAddress.tsx）；老草稿里没有 */
    地址?: Partial<向导客户地址> };
  /** 分配方式：企业版才有（默认五项的序号，0 指定 / 1 自动 / 2 公海捞取 / 3 暂不分配 / 4 个人自持）；老草稿里没有 */
  /** 渠道 = 项目来源（企业版，迁移 077）：没另选（空）= 跟客户的渠道；老草稿里没有 */
  /** 业务线（企业版，11-01 A1）：内贸 / 外贸 / 暂不分配，企业版必填；老草稿里没有 = 没填 */
  /** 所在地（企业版，11-02，选填）：项目自己的四格 + 详细地址；业务线手选 = 人动过业务线下拉，所在地的建议就不再覆盖（只在界面用，不交） */
  项目: {
    name: string; ownerId: string; amount: number | null; currency: string; remark: string; 分配方式?: number; 渠道?: string | null; 业务线?: string | null;
    所在地?: 客户地址 & { location?: string | null }; 业务线手选?: boolean;
    /** 指定回复时间（企业版，11-17，选填）：北京墙钟「YYYY-MM-DD HH:mm」，开始 / 结束填一个也行；老草稿里没有 */
    指定回复开始?: string | null; 指定回复结束?: string | null;
    /** 指定分配时间（企业版，11-17 PR3）：null / 没有 = 现在分配；字符串 = 指定时间（北京墙钟，"" = 还没选时刻）。只在指定分配、自动分配时认 */
    定时分配?: string | null;
    /** 分配方向（企业版，11-18）：市场成员选自动分配时人手动选的内贸 / 外贸；没选 = 按默认（不交，服务端同顺序算）。老草稿里没有 */
    分配方向?: 线 | null;
  };
  /** 下一步时间（YYYY-MM-DD）：开了超时回收时才有这格、必填；老草稿里没有这格 */
  /** 节点：企业版首条沟通必选（跟进节点 = 项目落在线索阶段哪一步，最多到线索验证）；下一步 = 下一步计划（文字，企业版；开了超时回收时必填，11-05）；团队版没有 */
  跟进: { type: string; method?: string | null; content: string; occurredAt: string; 下一步时间?: string | null; 节点?: string; 下一步?: string | null };
};

/** 企业版新建线索（10-26）：负责人、渠道必选；只留联系方式、首次沟通记录、跟进节点、下一步这几格预设 */
/** 分配方式们：这个人能用、还启用着的分配方式（10-27 A7：五种都生效，只有「指定分配」要选负责人） */
/** 默认分配方式：按业务角色（11-01 会议 §1 / §3：市场 → 自动分配，销售 → 个人自持，其他 → 暂不分配）；是销售：选自动分配要再确认（A9） */
export type 企业建档 = { 渠道们: 可选渠道[]; 节点们: readonly string[]; 分配方式们: { i: number; 名: string }[]; 默认分配方式?: number | null; 是销售?: boolean; 没角色?: boolean;
  /** 市场成员（按岗位：市场管理、渠道运营）：选自动分配时业务线换成「分配方向」，默认按客户区域 → 电话 → 本人事业部（P-转-26，11-18） */
  按区域?: boolean;
  /** 本人事业部（分配方向的第三步默认，after-create-assign 新建分配方式数据） */
  本人线?: 线 | null;
  /** 企业版普通销售（10-27 会议）：新建客户负责人只能是自己，没开项目时「客户负责人」不摆（wizard-data.ts） */
  客户只给自己?: boolean;
  /** 市场成员（市场管理、渠运、按部门 / 逐人认的，X-93）：没开项目时摆「项目分配方式」（11-18，new-cust-assign.ts） */
  是市场?: boolean;
  /** 指定分配的负责人下拉只列这些人（审核 11-18 追加，after-create-assign 新建分配方式数据 → assign-eta 可指定的人）；没给 = 不筛 */
  可指定?: string[];
  /** 市场成员指定分配按方向筛（P-转-26，11-20）：业务线选了内贸 / 外贸，负责人下拉再只留这个方向能挑的人；没给 = 不按方向筛 */
  指定候选表?: 指定候选表 | null;
  /** 新建项目的回收日预估（wizard-data.ts 回收预估）：起点日 + 各进程天数（内贸 / 外贸）；超时回收关着 = null */
  回收预估?: { 起点日: string; 内贸: Record<string, number>; 外贸: Record<string, number> } | null } | null;
/** 向导要的服务端数据（wizard-data.ts 建档向导数据）：页面和弹窗共用 */
export type 建档数据 = { users: 可选成员[]; 要下一步: boolean; 企业: 企业建档 };
/** 弹窗里摆向导（U-新建-01，10-31 会议）：不摆页头，「存草稿离开」改成关弹窗，建好了先关再跳 */
type 弹窗模式 = { 关: () => void } | null;

/**
 * 客户页「新增项目」（原型 cr.old，11-15 起和「新增项目」同一张表）：客户已经定了是这一位——客户段收成一行、不能换，
 * 项目名默认带客户名，负责人默认客户负责人（在候选里才带），首条沟通挂哪位联系人可选；建好落回这位客户页、停在新项目（landed 亮一下）
 */
export type 预选客户 = {
  联系人们?: { id: string; name: string; isPrimary: boolean }[]; 项目名?: string; 默认负责人?: string | null;
  /** 记沟通没项目、点「新建项目 / 去建项目」进来的（X-147，组织规则 阶段.仅记录用 开着才给）：多一格「仅记录用」默认勾着，勾着时进程定在潜客培育 */
  仅记录用?: boolean;
  /** 组织规则 超时回收.仅记录用也回收 开着（X-147 待定 6）：勾着仅记录用时下一步照普通项目必填；关着 = 勾着时不强制（它不会被收） */
  仅记录用也回收?: boolean;
};

/** 项目开关（P-界面-36）：客户页「新建客户」默认关；「新增项目」默认开；新线索、团队版「新建项目」开着并锁住（原整页 11-15 删了，现在都是弹窗） */
export type 项目开关 = "关" | "开" | "锁开";

/** 下一步时间快捷（P-界面-34：默认 3 天后，可改） */
const 下一步快捷 = [{ 叫: "明天", 天: 1 }, { 叫: "3 天后", 天: 3 }, { 叫: "1 周后", 天: 7 }] as const;
const 几天后 = (天: number) => dayjs().add(天, "day").format("YYYY-MM-DD");

/** 销售选自动分配的后果（A9）：就地黄条一句，原型 cr.revised 去掉「也收不回来」 */
const 销售自动分后果 = "分出去后你将看不到这个项目";

/** 企业版：这次选了「指定时间」分配（PR3）的那个值；现在分配 / 分配方式不是指定、自动 = null */
const 定时值 = (d: 稿, 企业: 企业建档): string | null =>
  企业 && (d.项目.分配方式 === 0 || d.项目.分配方式 === 1) && typeof d.项目.定时分配 === "string" ? d.项目.定时分配 : null;
/** 市场成员选了自动分配（P-转-26，用户 11-17）：业务线不用选、不交，服务端按客户区域定内贸 / 外贸 */
const 区域定线中 = (d: 稿, 带项目: boolean, 企业: 企业建档) => 带项目 && !!企业?.按区域 && d.项目.分配方式 === 1;

/** 企业版：这次要不要选负责人。只有「指定分配」要；没有可选的分配方式（老配置）照旧选负责人 */
const 要选负责人 = (d: 稿, 企业: 企业建档) => !!企业 && (!企业.分配方式们.length || d.项目.分配方式 === 0);
/**
 * 没开项目（只建客户）时给市场成员摆的「项目分配方式」能选哪几种（11-18）：指定 / 自动 / 暂不分配 ∩ 他能用的；
 * 不是市场成员、一样都用不了 = 空（不摆这一格，照原来客户负责人默认自己、可改）
 */
const 只建分配们 = (企业: 企业建档) => (企业?.是市场 ? 新客户分配方式们(企业.分配方式们) : []);
/** 这次只建客户交不交项目分配方式：没开项目、摆了这一格 */
const 摆只建分配 = (带项目: boolean, 企业: 企业建档) => !带项目 && 只建分配们(企业).length > 0;
function 空稿(ownerId: string, currency: string, 首类型: string): 稿 {
  return {
    phone: "",
    联系人: { name: "", position: "", phone: "", email: "", wechat: "" },
    客户: { name: "", school: "", remark: "" },
    项目: { name: "", ownerId, amount: null, currency, remark: "" },
    跟进: { type: 首类型, content: "", occurredAt: dayjs().format(时间格式) },
  };
}

/** 企业版查重认的是「类型 + 号码」：换了类型要重查 */
const 查过键 = (d: 稿, 企: boolean) => (企 ? `${d.号码类型 ?? ""}|${d.phone.trim()}` : d.phone.trim());

/** 一张表上的格子（P-界面-36）：校验出错时按它就地标红、滚过去 */
type 格 = "号码类型" | "号码" | "更多号码" | "联系人" | "客户名" | "来源" | "业务线" | "项目分配" | "项目名" | "分配方式" | "负责人" | "分配时间" | "内容" | "节点" | "下一步时间" | "下一步计划";
type 差项 = { 格: 格; 话: string };

/**
 * 整张表还差什么（一个弹窗填完，P-界面-36）；空 = 能建。按钮不变灰，点了才把这些就地标红（原型 cr.validate）。
 * 没开项目：只看客户和首条沟通；企业版客户业务线必填（M-必填-13），开了项目跟项目的业务线走
 */
function 还差们(d: 稿, 带项目: boolean, 要下一步: boolean, 企业: 企业建档 = null, 老 = false, 号待查 = false): 差项[] {
  const 差: 差项[] = [];
  const 记 = (格: 格, 话: string) => void 差.push({ 格, 话 });
  // 挑了老客户（原型 cr.old）：客户那几格不用填，只看项目和首条沟通
  if (!老) 客户还差(d, 企业, 记, 号待查);
  if (企业 && !d.项目.业务线 && !区域定线中(d, 带项目, 企业)) 记("业务线", 带项目 ? 业务线必填 : 客户业务线必填);
  if (!老 && 摆只建分配(带项目, 企业) && d.只建分配?.方式 === undefined) 记("项目分配", "请选项目分配方式");
  项目沟通还差(d, 带项目, 要下一步, 企业, 记);
  return 差;
}

/**
 * 号待查 = 号码填了、这个号还没查过（失焦那一下的查重还在路上，或还没离开输入框）：查过是首次录入就会照 带进联系人 把号码带进联系人那几格，
 * 缺项按带进去之后的联系人算——不然填完号码直接点「保存」，联系人那条按旧的空格子报缺、焦点落到联系人姓名（3703 补点 ad2883cd）。
 * 查过了（撞了 / 格式不对就没带）按联系人那几格的现状算
 */
function 客户还差(d: 稿, 企业: 企业建档, 记: (格: 格, 话: string) => void, 号待查 = false) {
  const 企 = !!企业;
  if (企 && !d.号码类型) 记("号码类型", "请选择号码类型");
  if (!d.phone.trim()) 记("号码", 企 ? "请填号码" : "请填电话");
  // 多加的号码：填了号没选类型的就地说是第几个（空行不管，交的时候丢掉）
  const 没类型 = 企 ? (d.更多号码 ?? []).findIndex((x) => x.value.trim() && !x.kind) : -1;
  if (没类型 >= 0) 记("更多号码", `第 ${没类型 + 2} 个号码请选择号码类型`);
  // 企业版：「未知」「待定」「暂未确认」这类占位不算填了（11-03 A2-2，服务端同一句）
  // 企业版客户名称选填（11-19 用户「客户名称设为不必填」，服务端 saveCustomer 同一条）；填了占位词照拦
  if (!d.客户.name.trim()) { if (!企) 记("客户名", "请填写名称"); }
  else if (企 && 是占位值(d.客户.name)) 记("客户名", 占位名提示("客户名称"));
  // 联系人姓名：企业版选填（11-17「联系人姓名不一定知道」），和联系方式至少一项（联系人电话 / 第一行带进的号 / 多加的号码，同服务端 联系人姓名问题）
  const 人 = 企 && 号待查 && d.phone.trim() ? { ...d.联系人, ...带进联系人(d.联系人, d.带过, d.号码类型 ?? "", d.phone.trim()).改 } : d.联系人;
  const 姓名问题 = 联系人姓名问题(企, 人.name, [人.phone, 人.email, 人.wechat, ...(企 ? (d.更多号码 ?? []).map((x) => x.value) : [])]);
  if (姓名问题) 记("联系人", 姓名问题);
  else if (企 && 是占位值(d.联系人.name)) 记("联系人", 占位名提示("联系人姓名"));
  const 来源 = 企业 ? 新建来源还差(d.客户.渠道, d.客户.触点) : "";
  if (来源) 记("来源", 来源);
}

function 项目沟通还差(d: 稿, 带项目: boolean, 要下一步: boolean, 企业: 企业建档, 记: (格: 格, 话: string) => void) {
  const 企 = !!企业;
  if (带项目) {
    if (!d.项目.name.trim()) 记("项目名", "请填写项目名称");
    else if (企 && 是占位值(d.项目.name)) 记("项目名", 占位名提示("项目名称"));
    else if (d.项目.name.trim().length > 项目名上限) 记("项目名", `项目名称请控制在 ${项目名上限} 字以内`);
    if (企业 && 企业.分配方式们.length && d.项目.分配方式 === undefined) 记("分配方式", "请选分配方式");
    if (要选负责人(d, 企业) && !d.项目.ownerId) 记("负责人", "请选项目负责人");
    const 定时 = 定时值(d, 企业);
    if (定时 !== null) {
      const 认 = 认定时分配(定时);
      if (!认.ok) 记("分配时间", 认.error);
    }
  }
  if (!d.跟进.content.trim()) 记("内容", "请填写这次沟通的内容");
  if (带项目 && 企业) {
    if (!d.跟进.节点 || !企业.节点们.includes(d.跟进.节点)) 记("节点", "请选当前进程（线索阶段的哪一步）");
    else if (企业.节点们.indexOf(d.跟进.节点) > 企业.节点们.indexOf(有效线索节点)) 记("节点", 建档不能过线索验证);
  }
  // 超时回收是项目的钟：没开项目不要求下一步（填了记成客户上的跟进计划）
  if (带项目 && 要下一步 && !d.跟进.下一步时间) 记("下一步时间", "请填下一步时间");
  if (带项目 && 要下一步 && 企业 && !d.跟进.下一步?.trim()) 记("下一步计划", "请写下一步计划");
}

/**
 * 新建弹窗（P-界面-36，11-15 用户：「之前是填入手机号客户名……不用分5步」）：客户、项目、首条沟通一个表单分三段。
 * 项目是开关：有项目就打开、下面填项目信息，没项目只建客户（首条沟通算客户沟通）；新线索进来开着并锁住。
 * 号码、客户名离开输入框自动查重，也可手动点；中途关掉不落库，填过的每格存本机草稿（一人一份），下次接着填；建好一笔落库，失败整笔不留
 */
/** 交给 saveCustomer 的 企业资料：业务线（只建客户才交，undefined = 不交）+ 客户地址三格（填了才交）；都没有 = 不带这一格 */
function 向导企业资料(业务线: string | null | undefined, 地址: 向导客户地址 | null): { 企业资料?: { bizLine?: string | null } & Partial<向导客户地址> } {
  const 资料 = { ...(业务线 !== undefined ? { bizLine: 业务线 } : {}), ...(地址 ?? {}) };
  return Object.keys(资料).length ? { 企业资料: 资料 } : {};
}

export default function ProjectWizard({ users, 要下一步, 企业 = null, 新线索 = false, 弹窗 = null, 开关 = "锁开", 老客户起手 = null, 预选 = null }: { users: 可选成员[]; 要下一步: boolean; 企业?: 企业建档; 新线索?: boolean; 弹窗?: 弹窗模式; 开关?: 项目开关; /** 「新增项目」选老客户、在选框里已经挑好的那一位（原型 pr.old）：客户段一打开就收成这一位 */ 老客户起手?: 可挑客户 | null; /** 客户页「新增项目」：老客户起手 那一位定死（原型 cr.old） */ 预选?: 预选客户 | null }) {
  // 草稿在本机 localStorage 里，服务端渲染时读不到；挂上之后再按草稿起头，免得两边对不上
  const 挂上了 = useSyncExternalStore(不订阅, () => true, () => false);
  const 我 = useMe();
  // 挑好老客户进来的：草稿按这位客户各存一份，别把新客户那份没填完的项目、沟通带到这位客户上
  const 全名 = 草稿全名(我?.id, 老客户起手 ? `${草稿键}:${老客户起手.id}` : 草稿键);
  if (!挂上了) return null;
  const 旧 = 读草稿(全名) as { 稿?: 稿 } | null;
  return <WizardBody key={全名} users={users} 要下一步={要下一步} 企业={企业} 新线索={新线索} 弹窗={弹窗} 开关={开关} 全名={全名} 旧={旧?.稿 && 有内容(旧.稿) ? 旧.稿 : null} 老起手={老客户起手} 预选={老客户起手 ? 预选 : null} />;
}

const 不订阅 = () => () => {};

/** 介绍人客户下拉（P-渠道-09）：选了「客户介绍」才挂上，挂上才取客户名单（和客户表单同一个 推荐人候选） */
function ReferrerPicker({ value, 叫法, onChange }: { value?: string; 叫法: string; onChange: (v: string | undefined) => void }) {
  const [候选, set候选] = useState<{ id: string; name: string }[] | null>(null);
  const [出错, set出错] = useState(false);
  useEffect(() => {
    let 作废 = false;
    推荐人候选().then((r) => { if (!作废) set候选(r); }, () => { if (!作废) set出错(true); });
    return () => { 作废 = true; };
  }, []);
  return (
    <Select
      aria-label={`介绍人${叫法}`}
      className="cr-full"
      showSearch
      allowClear
      placeholder={`选择介绍他来的已有${叫法}（可不选）`}
      optionFilterProp="label"
      value={value || undefined}
      loading={候选 === null && !出错}
      notFoundContent={出错 ? `${叫法}名单没取到，关掉这格重选一次触点再试` : 候选 === null ? "正在取…" : undefined}
      options={(候选 ?? []).map((c) => ({ value: c.id, label: c.name }))}
      onChange={(v?: string) => onChange(v || undefined)}
    />
  );
}

/**
 * 「新增客户」「新增项目」弹窗（U-新建-01、P-界面-36）：三个入口同一个表单、同一套查重（含联系人查重），按入口定标题和项目开关。
 * 草稿照旧每改一格存本机，关掉不弹提示（角落那行「已存草稿」看得见），下次点开接着填
 */
/** afterClose：关的动画走完以后（框接框的那条路用它把焦点放回「新建」，projects/NewProjectFlow.tsx）。项目：不给 = 开（新增项目那条路） */
export function 建档弹窗(props: { open: boolean; 标题: string; 数据: 建档数据; onClose: () => void; afterClose?: () => void; 项目?: 项目开关; 老客户?: 可挑客户 | null; 预选?: 预选客户 | null }) {
  return <WizardModal {...props} />;
}

// 要用 hook（当前用户），组件名得是大写英文开头（react-hooks 规则）
function WizardModal({ open, 标题, 数据, onClose, afterClose, 项目 = "开", 老客户 = null, 预选 = null }: { open: boolean; 标题: string; 数据: 建档数据; onClose: () => void; afterClose?: () => void; 项目?: 项目开关; 老客户?: 可挑客户 | null; 预选?: 预选客户 | null }) {
  return (
    <Modal open={open} title={标题} footer={null} width={760} onCancel={onClose} afterClose={afterClose} destroyOnHidden mask={{ closable: false }}>
      <ProjectWizard users={数据.users} 要下一步={数据.要下一步} 企业={数据.企业} 弹窗={{ 关: onClose }} 开关={项目} 老客户起手={老客户} 预选={预选} />
    </Modal>
  );
}

/** 下拉撑满格子（FollowMethodSelect 只收 style） */
const 满宽 = { width: "100%" };

/** 建好后按钮上的 ✓ 停一下再走（原型 cr.submit：原地转圈 → ✓ → 落到新客户页） */
const 落定停留 = 600;
/** 建完有一句结果（已分给谁）时多停一会儿，读得完再关框 */
const 读一句停留 = 1600;

/**
 * 要下一步 = 企业版开了超时回收：带项目时首条沟通要填下一步时间（项目建在线索阶段）。
 * 能填下一步 = 企业版：没开超时回收也摆这一格、选填，默认 3 天后（P-界面-34）
 * 企业版 = 先选号码类型、按类型验格式、全公司查重（2026-10-26，customers/number-actions.ts）
 */
function WizardBody({ users, 要下一步, 企业, 新线索, 弹窗, 开关, 全名, 旧, 老起手 = null, 预选 = null }: { users: 可选成员[]; 要下一步: boolean; 企业: 企业建档; 新线索: boolean; 弹窗: 弹窗模式; 开关: 项目开关; 全名: string; 旧: 稿 | null; 老起手?: 可挑客户 | null; 预选?: 预选客户 | null }) {
  const 企业版 = !!企业;
  const 能填下一步 = 企业版 || 要下一步;
  const router = useRouter();
  /** 建完落到新客户 / 新项目：等新页时顶上的条亮（lib/nav-pending.ts，跳转优化 PR-A）。
      用壳里那份：弹窗先关、向导卸了，等待条照样挂到新页提交（审查补） */
  const 去页 = useShellNavGo();
  const b = useBusiness();
  const 我 = useMe();
  const 能选类型 = 跟进类型们(外贸精简(b)).filter((t) => t.value !== "TASK" && t.value !== "REMIND");
  // 不在候选里的「我」（老板、管理员不做销售）默认还是记在我名下（服务端也这么填）：下拉里补上我自己，不然那一格露出内部编号
  const 负责人选项 = 我 && !users.some((u) => u.id === 我.id) ? [...成员选项(users), { value: 我.id, label: 我.name }] : 成员选项(users);
  // 负责人默认当前登录的人（P-界面-33，可改）；跟进节点默认线索第一步；号码类型默认手机号（最常见）；下一步时间默认 3 天后（P-界面-34）
  const 新稿 = (): 稿 => {
    const n = 空稿(企业 ? 我?.id ?? "" : 默认负责人(我, users) ?? 我?.id ?? "", b.currency || 默认币种, 能选类型[0]?.value ?? "PHONE");
    const 跟进 = 能填下一步 ? { ...n.跟进, 下一步时间: 几天后(3) } : n.跟进;
    // 分配方式按业务角色给默认值（服务端算好，能用的才给）；没给的、只有一种能用就直接选上
    const 默认 = 企业?.默认分配方式;
    const 分 = 默认 !== undefined && 默认 !== null && 企业?.分配方式们.some((x) => x.i === 默认) ? 默认 : 企业?.分配方式们.length === 1 ? 企业.分配方式们[0].i : undefined;
    // 挑好老客户进来的（cr.old / pr.old）：项目名默认带客户名（客户页给的简称优先，能改）；客户页给了默认负责人、又在候选里，就带上
    const 起名 = 老起手 ? (预选?.项目名 || 老起手.name).slice(0, 项目名上限) : "";
    const 起负责 = 预选?.默认负责人 && users.some((u) => u.id === 预选.默认负责人) ? 预选.默认负责人 : null;
    const 项目 = { ...n.项目, ...(起名 ? { name: 起名 } : {}), ...(起负责 ? { ownerId: 起负责 } : {}) };
    // 没开项目时的项目分配方式（市场成员，11-18）：默认自动分配，用不了退回暂不分配（原来建给自己记的）
    const 只建 = 只建分配们(企业);
    const 只建默认 = 只建.length ? 新客户默认分配方式(只建.map((x) => x.i)) : undefined;
    return 企业
      ? { ...n, 号码类型: "手机号", 客户负责人: 我?.id, 项目: { ...项目, 分配方式: 分 }, 跟进: { ...跟进, 节点: 企业.节点们[0] }, ...(只建默认 !== undefined ? { 只建分配: { 方式: 只建默认 } } : {}) }
      : { ...n, 客户负责人: 我?.id, 项目, 跟进 };
  };

  const 锁 = 开关 === "锁开";
  const [带项目, set带项目] = useState(开关 !== "关");
  // 上次没填完的接着填
  const [d, setD] = useState<稿>(() => (旧 ? { ...新稿(), ...旧 } : 新稿()));
  // 首条沟通的方式按个人习惯默认（11-18，同记沟通框）：带回了草稿的以草稿为准，人改过的不盖；填默认不算打字，不存草稿
  const 人改了方式 = useHabitDefault(!旧, (x) => setD((o) => ({ ...o, 跟进: { ...o.跟进, type: x.type, method: x.method } })));
  const [已查, set已查] = useState<string | null>(null);
  const [撞, set撞] = useState<DuplicateHit>(null);
  // 企业版「查重」回来的那句（格式不对 / 首次录入 / 撞了哪种）
  const [企查, set企查] = useState<查号码结果 | null>(null);
  // 查重领取成了（F-016）那一句：有它时撞号面板只剩它（不重查、不摆挂靠 / 协同），下次查号、改号码清掉
  const [领成话, set领成话] = useState("");
  const [查中, set查中] = useState(false);
  // 企业版客户名查重（P-挂靠-01）：离开客户名那格就查；撞了就地摆出负责人和申请挂靠，改了名字再查
  const [名查, set名查] = useState<{ 名: string; 撞: 名撞结论 | null; 提示: string } | null>(null);
  const [名查中, set名查中] = useState(false);
  // 老客户新增项目（原型 cr.old）：弹窗里客户名直接搜到老客户，挑中后客户段收成一行，下面接着填项目和沟通（企业版，走 给客户建项目）
  const 能挑老客户 = 企业版 && !!弹窗;
  const [老客户, set老客户] = useState<可挑客户 | null>(能挑老客户 ? 老起手 : null);
  const [候选, set候选] = useState<可挑客户[]>([]);
  /** 客户页「新增项目」：客户定死（不摆「换」）；首条沟通挂哪位联系人（默认主要联系人） */
  const 锁客户 = !!预选 && !!老客户 && 老客户.id === 老起手?.id;
  /** 仅记录用（X-147）：只有客户页为记沟通打开、锁着这位客户时才有这一格；默认勾着，建的人可以取消（取消 = 普通项目，进程照常选） */
  const 记录用可选 = 企业版 && 锁客户 && 预选?.仅记录用 === true;
  const [仅记录用勾, set仅记录用勾] = useState(true);
  const 记录用中 = 记录用可选 && 仅记录用勾;
  /** 下一步（时间 + 计划）必填：开了超时回收要填；勾着仅记录用、它不回收时不强制（X-147 待定 6，服务端 给客户建项目 同一条） */
  const 下一步必填 = 要下一步 && !(记录用中 && 预选?.仅记录用也回收 !== true);
  const 联系人们 = 锁客户 ? 预选?.联系人们 ?? [] : [];
  const [联系人Id, set联系人Id] = useState<string | undefined>(() => (联系人们.find((c) => c.isPrimary) ?? 联系人们[0])?.id);
  // P-转-07：这次走 X-18、客户名下有同事的项目，会一起转走的先列出来（同分配弹窗、原客户页「新增项目」）
  const 问一起转 = useCarryConfirm();
  const [交中, set交中] = useState(false);
  const [建好了, set建好了] = useState(false);
  // 设计语言 E1（D14）：提交键统一叫「保存」（建好 → 保存、建好并分出去 → 保存并分出去、已建好 → 已保存）
  // 原型 cr.submit / g.save：建好了在「建好」按钮里打勾，不弹顶部提示；没建成 / 没查成的原因就地写（role=alert）：
  // 查重的写在客户那节头下面，建档的写在底栏上面。下一次点的时候清掉
  const [查错, set查错] = useState("");
  const [交错, set交错] = useState("");
  /**
   * 建完的那句结果（自动分给谁 / 没分出去为什么 / 同号已写进现有项目），不弹顶部提示：写在底栏上面（role=status）。
   * 分出去了（转走）停一会儿再关框；没分出去、同号协同要人读完：「建好」换成「知道了」，点了才关框、跳页
   */
  const [建后话, set建后话] = useState<{ 话: string; 警: boolean } | null>(null);
  const [知道了, set知道了] = useState<(() => void) | null>(null);
  /** 「知道了」那颗键上的字：客户转走、我看不到这位客户了写「回客户列表」 */
  const [知道了字, set知道了字] = useState("知道了");
  /** 有结果那句：转走的停 1.6 秒（读得完一句）再走；要读原因的等人点「知道了」 */
  const 读完再走 = async (提示: string | null | undefined, 转走: boolean, 走: () => void, 等点?: string) => {
    if (!提示) {
      await new Promise((ok) => setTimeout(ok, 落定停留));
      return 走();
    }
    set建后话({ 话: 提示, 警: !转走 });
    // 等点：这一句后果重（我看不到这位客户了），读完点了才走，不按时间自己走
    if (等点) set知道了字(等点);
    if (!转走 || 等点) return void set知道了(() => 走);
    await new Promise((ok) => setTimeout(ok, 读一句停留));
    走();
  };
  /**
   * 建好之后凭票传首条沟通的附件：全传上回 null，有没传上的回一句（建好照旧，读完点「知道了」再走）。
   * 转走了（指定给别人 / 自动分配 / 进公海）：录入人已不是负责人、补不了（时间线不让传、项目页要负责人或记的人），叫他找负责人；
   * 前一句提示里写着分给了谁。还在我名下的照旧「到这条沟通上补传」
   */
  const 传首条附件 = async (r: object): Promise<string | null> => {
    if (!附件们.length) return null;
    const 票 = "附件票" in r ? (r as { 附件票?: { followUpId: string; 票: string } }).附件票 : undefined;
    const 找谁 = "转走" in r && r.转走 ? "请让负责人在这条沟通上补传" : "到这条沟通上补传";
    if (!票) return `建好了，截图 / 附件没传上：没拿到上传凭据，${找谁}`;
    set建后话({ 话: `建好了，正在传 ${附件们.length} 个截图 / 附件…`, 警: false });
    const 错 = await 传沟通附件(票.followUpId, 附件们, 票.票);
    if (!错.length) return null;
    return 错.length === 附件们.length
      ? `建好了，截图 / 附件没传上（${错[0]}），${找谁}`
      : `建好了，${附件们.length} 个截图 / 附件传上 ${附件们.length - 错.length} 个，${错.length} 个没传上（${错[0]}），${找谁}`;
  };
  const [显错, set显错] = useState(false);
  /**
   * 首条沟通的截图 / 附件（11-18，选填）：和记沟通框同一个挑选块，先挑好；建档交 要传附件，建好凭回来的票逐个传，挂在这条首条沟通上
   * （lib/enterprise/first-follow-ticket.ts：建好就分走了也传得上）。文件进不了本机草稿，关掉弹窗就没了（同记沟通框）
   */
  const [附件们, set附件们] = useState<File[]>([]);
  const [已存, set已存] = useState(!!旧);
  const [接着填, set接着填] = useState(!!旧);

  const 改 = <K extends keyof 稿>(k: K, v: Partial<稿[K]> | 稿[K]) => {
    setD((o) => {
      const n = { ...o, [k]: typeof v === "object" && v !== null ? { ...(o[k] as object), ...v } : v } as 稿;
      存草稿(全名, { 稿: n });
      return n;
    });
    set已存(true);
  };

  /** 查号码：能建 = 返回最新的稿（企业版首次录入会把号码带进联系人那一格）；撞了 / 格式不对 / 没查成 = null */
  const 查号 = async (稿面: 稿 = d): Promise<稿 | null> => {
    const 号 = 稿面.phone.trim();
    if (!号 || (企业版 && !稿面.号码类型)) return null;
    set查中(true);
    set查错("");
    try {
      if (企业版) {
        const r = await 查号码(稿面.号码类型 ?? "", 号);
        set企查(r);
        set领成话("");
        set已查(查过键(稿面, true));
        if (!(r.ok && r.状态 === "首次录入")) return null;
        // 查过的号码顺手填进联系人那一格：空着的、或者还是上次查重带进去的（人没改过）换成这次的
        const t = 带进联系人(稿面.联系人, 稿面.带过, 稿面.号码类型 ?? "", r.值);
        const n = { ...稿面, 联系人: { ...稿面.联系人, ...t.改 }, 带过: t.带过 };
        setD(n);
        存草稿(全名, { 稿: n });
        return n;
      }
      const hit = await checkDuplicate(号);
      set撞(hit);
      set已查(号);
      if (hit) return null;
      const n = 稿面.联系人.phone ? 稿面 : { ...稿面, 联系人: { ...稿面.联系人, phone: 号 } };
      if (n !== 稿面) { setD(n); 存草稿(全名, { 稿: n }); }
      return n;
    } catch (出错) {
      set查错(动作出错话(出错, "查重没查成，请稍后再试"));
      return null;
    } finally {
      set查中(false);
    }
  };

  /** 企业版客户名查重：没撞 = true；不是企业版不查 */
  const 查名 = async (名 = d.客户.name.trim()): Promise<boolean> => {
    if (!企业版) return true;
    // 名称选填（11-19）：没填就没有名字可查，算没撞（号码那一半照查）
    if (!名) return true;
    set名查中(true);
    set查错("");
    try {
      const r = await 查客户名(名, undefined);
      if (!r.ok) { set查错(r.error); return false; }
      set名查({ 名, 撞: r.撞 ?? null, 提示: r.撞 ? r.提示 : "" });
      return !r.撞;
    } catch (出错) {
      set查错(动作出错话(出错, "查重没查成，请稍后再试"));
      return false;
    } finally {
      set名查中(false);
    }
  };

  const 号查过 = 已查 === 查过键(d, 企业版) && !!d.phone.trim();
  const 号拦 = 号查过 && (企业版 ? !!企查 && !(企查.ok && 企查.状态 === "首次录入") : !!撞);
  const 名对上 = !!名查 && 名查.名 === d.客户.name.trim();
  const 名拦 = 企业版 && 名对上 && !!名查?.撞;
  const 差们 = 还差们(d, 带项目, 下一步必填, 企业, !!老客户, !号查过);
  // 客户名一边打一边搜老客户（停 300ms 再问，晚回来的旧结果丢掉）
  const 搜词 = 能挑老客户 && !老客户 ? d.客户.name.trim() : "";
  useEffect(() => {
    if (!搜词) return;
    let 作废 = false;
    const t = setTimeout(() => { 搜客户(搜词).then((r) => { if (!作废) set候选(r); }, () => {}); }, 300);
    return () => { 作废 = true; clearTimeout(t); };
  }, [搜词]);
  // 业务线默认带这位客户的（A1，和客户页「新增项目」同一个取数）；看不到 / 没开 = null 不带
  // 老客户的区域（P-转-26）：市场成员选自动分配时业务线那格只读显示按区域定的线；客户没填地址 = null，看项目所在地
  // 渠道 = 这位客户的来源渠道：项目渠道默认带它，建时可另选（P-删-03，审核 11-18 P1-1）
  const [老客户区域, set老客户区域] = useState<{ id: string; 线: 线 | null; 电话线: 线 | null; 渠道: string | null; 后售?: boolean } | null>(null);
  const 带客户业务线 = (c: 可挑客户) => {
    新项目分配数据(c.id).then((r) => {
      if (r?.客户业务线 && !d.项目.业务线) 改("项目", { 业务线: r.客户业务线 });
      set老客户区域(r ? { id: c.id, 线: r.客户有地址 ? r.客户区域线 : null, 电话线: r.客户电话线 ?? null, 渠道: r.客户渠道 ?? null, ...(r.客户有交付结清 ? { 后售: true } : {}) } : null);
    }, () => {});
  };
  const 挑老 = (id: string) => {
    const c = 候选.find((x) => x.id === id);
    if (!c) return;
    set老客户(c);
    set带项目(true);
    set名查(null);
    带客户业务线(c);
  };
  // 从选框里挑好老客户进来的（pr.old）：一打开就按挑中那一位带业务线（项目开关是「开」，带项目本来就开着）
  const 起手带过 = useRef(false);
  useEffect(() => {
    if (起手带过.current || !能挑老客户 || !老起手) return;
    起手带过.current = true;
    带客户业务线(老起手);
    // 只认打开那一下
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const 错 = (g: 格) => (显错 ? 差们.find((x) => x.格 === g)?.话 : undefined);
  const 红 = (g: 格) => (错(g) ? ("error" as const) : undefined);
  // 销售选自动分配：分出去后就看不到这个项目了（A9）。就地黄条说后果、按钮写明「并分出去」，不再叠一层确认框（原型 cr.auto）
  const 自动分出去 = 带项目 && !!企业?.是销售 && d.项目.分配方式 === 1;

  // 设计语言 E1（D03）：滚过去，焦点也跳到这一格（等红字画出来再挪；不让 focus 自己跳着滚，滚动照上面这一下）
  //「号码类型」和号码拼在「联系方式」一格里（没有自己的 data-ge），滚到那一格、焦点落在标红的类型框上
  const 滚到 = (g: 格) => {
    const 选 = `[data-ge="${g === "号码类型" ? "号码" : g}"]`;
    document.querySelector(选)?.scrollIntoView({ block: "center", behavior: 滚法() });
    window.setTimeout(() => 格里该聚焦的(document.querySelector(选))?.focus({ preventScroll: true }), 0);
  };

  // 手动「查重」：号码、客户名都查一遍
  const 手动查重 = () => {
    void 查号();
    if (企业版 && d.客户.name.trim()) void 查名();
  };

  // 点「建好」：按钮不变灰；缺的格就地标红、滚到第一格。号码、客户名没查过的先查（离开输入框就查了，这里兜底）
  const 点建好 = async () => {
    if (交中 || 建好了) return;
    set显错(true);
    if (企业?.没角色) return;
    if (差们.length) return 滚到(差们[0].格);
    if (老客户) return void 给老客户建(老客户);
    let 稿面: 稿 | null = d;
    if (!号查过) 稿面 = await 查号(d);
    else if (号拦) 稿面 = null;
    if (!稿面) return 滚到("号码");
    if (企业版 && !(名对上 ? !名查?.撞 : await 查名())) return 滚到("客户名");
    void 提交(稿面);
  };

  /** 老客户新增项目：走客户页「新增项目」同一个服务端动作（限定层、同事只读、公海先领取、业务角色都在那里判） */
  const 给老客户建 = async (客: 可挑客户) => {
    set交中(true);
    set交错("");
    const 负责人 = 企业 && !要选负责人(d, 企业) ? 我?.id ?? "" : d.项目.ownerId;
    try {
      const 这次 = { 分配方式: d.项目.分配方式 ?? null, 业务线: 区域定线中(d, 带项目, 企业) ? null : d.项目.业务线 ?? null };
      // 指定时间分配（PR3）：现在不转，到点才分，这会儿不问一起转
      const 定时 = 定时值(d, 企业);
      if (定时 === null && !(await 问一起转(() => 建项目带走的项目(客.id, { ownerId: 负责人 || null, ...这次 })))) return void set交错("没建：一起转的项目还没确认");
      const r = await 给客户建项目({
        customerId: 客.id,
        ...(联系人Id ? { 联系人Id } : {}),
        项目: {
          name: d.项目.name, ownerId: 负责人 || null, 分配方式: d.项目.分配方式 ?? null, 业务线: 这次.业务线,
          // 项目渠道另选了才交；没选服务端带客户来源（P-删-03 建时可选）
          ...(d.项目.渠道 ? { channelId: d.项目.渠道 } : {}),
          ...(区域定线中(d, 带项目, 企业) && d.项目.分配方向 ? { 分配方向: d.项目.分配方向 } : {}),
          ...(d.项目.所在地 ? { 所在地: d.项目.所在地 } : {}),
          指定回复开始: d.项目.指定回复开始 ?? null, 指定回复结束: d.项目.指定回复结束 ?? null,
          ...(定时 ? { 定时分配: 定时 } : {}),
        },
        跟进: { ...d.跟进, ...(记录用中 ? { 节点: 仅记录用节点 } : {}), method: 对得上的方式(d.跟进.type, d.跟进.method) },
        ...(记录用中 ? { 仅记录用: true } : {}),
        ...(附件们.length ? { 要传附件: true } : {}),
      });
      if (!r.ok) return void set交错(r.error);
      清草稿(全名);
      set建好了(true);
      const 看不到 = !!r.看不到客户了;
      const 附件话 = await 传首条附件(r);
      const 话 = [看不到 ? r.提示 ?? `${b.customer}已转出` : r.提示, 附件话].filter(Boolean).join("；") || null;
      await 读完再走(话, !!r.转走 && !附件话, () => {
        弹窗?.关();
        // 客户转给了销售、我看不到了：回客户列表（留着刷新就是 404）；项目分走了：留在原页刷新；
        // 不然落到这位客户、停在新项目（landed：新项目卡亮 2 秒，原型 cr.submit）；本来就在这位客户页上的换地址不加历史
        if (看不到) return void 去页.push("/customers");
        if (r.转走) return void router.refresh();
        const 去 = `/customers/${encodeURIComponent(客.id)}?project=${encodeURIComponent(r.projectId)}&landed=1`;
        if (锁客户) 去页.replace(去, { scroll: false });
        else 去页.push(去);
      }, 看不到 ? `回${b.customer}列表` : undefined);
    } catch (出错) {
      set交错(动作出错话(出错, "没建成，请稍后再试；填过的还在"));
    } finally {
      set交中(false);
    }
  };

  const 提交 = async (稿面: 稿) => {
    set交中(true);
    set交错("");
    // 企业版不是「指定分配」的：先建在我名下（服务端也这么改），建好再按分配方式转走
    const 负责人 = 企业 && !要选负责人(稿面, 企业) ? 我?.id ?? "" : 稿面.项目.ownerId;
    const { 渠道: 项目渠道, 业务线手选: _手选, ...项目稿 } = 稿面.项目;
    // 只建客户 + 市场成员：项目分配方式；分配方向人改过才交（只在按区域的自动分配），没改服务端按同一顺序算
    const 只建方式 = 稿面.只建分配?.方式;
    const 只建交 = 企业 && 摆只建分配(带项目, 企业) && 只建方式 !== undefined
      ? { 分配方式: 只建方式, ...(只建方式 === 1 && 企业.按区域 && 稿面.只建分配?.方向 ? { 分配方向: 稿面.只建分配.方向 } : {}) }
      : null;
    void _手选;
    const 客户 = {
      // 企业版：选的不是手机号的，电话空着，号码按 企业号码 交（saveCustomer 按类型存、再查一次重）
      name: 稿面.客户.name, phone: 企业版 && 稿面.号码类型 !== "手机号" ? "" : 稿面.phone,
      ...(企业版 ? { 企业号码: { 类型: 稿面.号码类型 ?? "", 值: 稿面.phone } } : {}),
      school: 稿面.客户.school || null, grade: null, major: null,
      followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: 稿面.客户.remark || null,
      // 带项目：团队版客户记在项目负责人名下，企业版客户归谁由 建档向导 定（P-转-03、X-18）；
      // 只建客户：客户负责人默认自己、可改（P-界面-33），企业版普通销售只能是自己（saveCustomer 同样落到自己）
      // 市场成员选了项目分配方式（11-18）：指定分配 = 客户负责人那一格选的那位，自动 / 暂不分配 = 自己（服务端同样落到自己）
      salesOwnerId: 带项目 ? 负责人 || null : 只建交 && 只建交.分配方式 !== 0 ? 我?.id || null : 稿面.客户负责人 || 我?.id || null,
      ...(只建交 ? { 项目分配: 只建交 } : {}),
      channelId: 企业 ? 稿面.客户.渠道 || null : null,
      // 渠道触点（P-渠道-08）：选了客户介绍才带介绍人（P-渠道-09）
      referrerCustomerId: 企业 && 稿面.客户.触点 === 客户介绍触点 ? 稿面.客户.介绍人 || null : null,
      ...(企业 ? { touchpoint: 稿面.客户.触点 || null } : {}),
      // 只建客户：客户业务线必填（M-必填-13），开了项目由服务端跟项目的业务线走。
      // 客户地址三格填了就交（saveCustomer 规整地址；分配方向先看它，审核 11-18 P1-2）
      ...(企业 ? 向导企业资料(带项目 ? undefined : (稿面.项目.业务线 ?? null), 向导客户地址值(稿面.客户.地址)) : {}),
    };
    const 跟进 = 企业
      ? { ...稿面.跟进, method: 对得上的方式(稿面.跟进.type, 稿面.跟进.method), ...(带项目 ? {} : { 节点: undefined }) }
      : { type: 稿面.跟进.type, content: 稿面.跟进.content, occurredAt: 稿面.跟进.occurredAt, 下一步时间: 能填下一步 ? 稿面.跟进.下一步时间 : null };
    // 企业版：第一行下面多加的号码跟着主要联系人交（空行丢掉）；没加就不带这一格，和原来一样
    const 更多 = 企业版 ? (稿面.更多号码 ?? []).filter((x) => x.value.trim()).map((x) => ({ kind: x.kind ?? "", value: x.value })) : [];
    const 联系人 = 更多.length ? { ...稿面.联系人, 号码们: 更多 } : 稿面.联系人;
    try {
      const r = 带项目
        ? await 建档向导({
          客户,
          联系人,
          项目: {
            ...项目稿, 定时分配: 定时值(稿面, 企业), amount: 稿面.项目.amount ?? 0, ownerId: 负责人 || null, 分配方式: 企业 ? 稿面.项目.分配方式 ?? null : undefined,
            // 业务线（11-01 清单 A1，手动选）：企业版总是传（没选 = null）；团队版不传
            // 市场成员选自动分配：不交，服务端按客户区域定（P-转-26）
            业务线: 企业 ? (区域定线中(稿面, 带项目, 企业) ? null : 稿面.项目.业务线 ?? null) : undefined,
            // 分配方向（11-18）：人改过才交，没改服务端按同一顺序算默认
            分配方向: 企业 && 区域定线中(稿面, 带项目, 企业) ? 稿面.项目.分配方向 ?? null : undefined,
            // 项目来源：没另选就跟客户的渠道（服务端 项目来源默认 同一个规矩）；团队版不传
            ...(企业 ? { channelId: 项目渠道 || 稿面.客户.渠道 || null } : {}),
          },
          跟进,
          ...(附件们.length ? { 要传附件: true } : {}),
        })
        : await 建档只建客户({ 客户, 联系人, 跟进, ...(附件们.length ? { 要传附件: true } : {}) });
      if (!r.ok && "同号协同" in r) {
        // 同号再次录入：没新建，记录已写进现有项目（查重之后才有人录同号时走到这）。那句写在底栏上面，点「知道了」再关框
        清草稿(全名);
        set建后话({ 话: r.error, 警: false });
        set知道了(() => () => {
          弹窗?.关();
          if (弹窗) router.refresh();
          else router.push(新线索 || 企业版 ? "/leads" : "/projects");
        });
        return;
      }
      // 填的这段时间有人录了同名客户（saveCustomer 按名字挡）：就地摆出负责人和申请挂靠
      const 名撞 = !r.ok && "撞号" in r ? (r.撞号 as 名撞结论 | undefined) : undefined;
      if (!r.ok && 名撞 && ("我名下" in 名撞 || 名撞.撞.键类型 === "客户名" || 名撞.撞.键类型 === "公司名")) {
        set名查({ 名: 稿面.客户.name.trim(), 撞: 名撞, 提示: r.error });
        滚到("客户名");
        return;
      }
      if (!r.ok) {
        set交错(r.error);
        return;
      }
      清草稿(全名);
      set建好了(true);
      const 转走 = "转走" in r && !!r.转走;
      // 首条沟通的截图 / 附件：带项目的挂在新项目的首条沟通上；只建客户的首条沟通挂在潜客培育项目上，同样凭票传（企业版才摆挑选）
      const 附件话 = await 传首条附件(r);
      const 话 = ["提示" in r ? r.提示 : null, 附件话].filter(Boolean).join("；") || null;
      await 读完再走(话, 转走 && !附件话, () => {
        弹窗?.关();
        // 分走了 / 进了公海，项目不在我名下：回线索列表（弹窗里建的：留在原页刷新）
        if (转走) return void (弹窗 ? router.refresh() : router.push(新线索 ? "/leads" : "/projects"));
        // 弹窗里建的落到新客户页（企业版停在这个项目的页签，客户详情合并 11-12）；整页建档照旧进项目详情
        if (!r.projectId) return void 去页.push(`/customers/${r.customerId}`);
        // 整页建的：服务端给了项目页会跳去的地址（r.去）就直接去，不经过 /projects/<id> 的重定向
        去页.push(弹窗 && 企业版 ? `/customers/${r.customerId}?project=${r.projectId}` : ("去" in r && r.去) || `/projects/${r.projectId}`);
      });
    } catch (出错) {
      set交错(动作出错话(出错, "没建成，请稍后再试；填过的还在"));
    } finally {
      set交中(false);
    }
  };

  // 草稿每改一格就存了（存草稿），这里只是走开。弹窗关掉不弹提示（角落「已存草稿」看得见，原型 cr.draft）
  const 离开 = () => {
    if (弹窗) return 弹窗.关();
    // 整页向导（现在只剩测试里用，app 里都是弹窗）：草稿存了看得见（角落「✓ 已存草稿」），走开不弹提示（原型 cr.draft）
    router.push(新线索 || 企业版 ? "/leads" : "/projects");
  };

  const 重来 = () => {
    清草稿(全名);
    setD(新稿());
    set已查(null);
    set撞(null);
    set企查(null);
    set领成话("");
    set名查(null);
    set显错(false);
    set已存(false);
    set接着填(false);
  };

  // 所在地给的业务线建议（11-02）：只提示，提交 = 人确认了
  const 线提示 = 企业 && 带项目 ? 所在地提示(建议业务线(d.项目.所在地), d.项目.业务线) : null;
  // 指定回复时间晚于预计回收日（开了超时回收：起点日 + 所选进程的天数；下一步时间只提醒、不改回收日，11-18）：黄条提示，不拦
  const 预估天数 = 企业?.回收预估 && d.跟进.节点 ? (d.项目.业务线 === "外贸" ? 企业.回收预估.外贸 : 企业.回收预估.内贸)[d.跟进.节点] : 0;
  const 回复警 = 企业?.回收预估 && 带项目 && 预估天数 > 0
    ? 回复晚于回收(北京墙钟转时刻(d.项目.指定回复开始), 北京墙钟转时刻(d.项目.指定回复结束), dayjs(企业.回收预估.起点日).add(预估天数, "day").format("YYYY-MM-DD"))
    : null;
  // 指定分配时间晚于指定回复时间（PR3）：黄条提示，不拦
  const 定时 = 带项目 ? 定时值(d, 企业) : null;
  const 分配警 = 定时 ? 分配晚于回复(北京墙钟转时刻(定时), 北京墙钟转时刻(d.项目.指定回复开始), 北京墙钟转时刻(d.项目.指定回复结束)) : null;
  const 一格 = (g: 格 | null, label: string, el: React.ReactNode, 必填 = false, 宽 = false, 注?: React.ReactNode) => (
    <label className={宽 ? "cr-field cr-wide" : "cr-field"} data-ge={g ?? undefined}>
      <span className="cr-label">{必填 && <span className="cr-req">* </span>}{label}</span>
      {el}
      {g && 错(g) ? <span className="cr-err" role="alert">{错(g)}</span> : 注 ? <span className="cr-note">{注}</span> : null}
    </label>
  );
  const 有回复时间 = !!(d.项目.指定回复开始 || d.项目.指定回复结束);
  const 回复格 = 企业 && 一格(null, "指定回复时间", (
    <ReplyWindowInput
      value={{ 开始: d.项目.指定回复开始 ?? null, 结束: d.项目.指定回复结束 ?? null }}
      onChange={(v) => {
        改("项目", { 指定回复开始: v.开始, 指定回复结束: v.结束 });
        // 回复时间记在项目上：没开项目时填了就打开（11-18）
        if (!带项目 && (v.开始 || v.结束)) set带项目(true);
      }}
    />
  ), false, true, 带项目 ? "选填，按北京时间：指定什么时候回复客户" : 有回复时间 ? "回复时间记在项目上：没开项目不存，填了会打开「有项目」" : "选填，按北京时间；记在项目上，填了会打开「有项目」");
  // 市场成员选自动分配（P-转-26，11-18）：业务线换成可改的「分配方向」，默认按 客户区域 → 项目所在地 → 电话 → 本人事业部；
  // 老客户的区域、电话由服务端算好（新项目分配数据），新客户按这一屏填的号现算；人改过就按改的
  const 老的 = 老客户 && 老客户区域?.id === 老客户.id ? 老客户区域 : null;
  // 后售培育（P-界面-63）：挑的老客户名下有交付结清的，「当前进程」的潜客培育那一项写后售培育；value 照旧潜客培育（存的不变）
  const 后售中 = !!老的?.后售;
  /** 项目渠道的默认：老客户 = 这位客户的来源渠道（服务端取），新客户 = 这一屏选的渠道 */
  const 客户渠道 = 老客户 ? (老的?.渠道 ?? null) : (d.客户.渠道 || null);
  const 方向默认 = 默认分配方向({
    客户线: 老的?.线 ?? null, 项目: d.项目.所在地 ?? null, 电话线: 老的?.电话线 ?? null,
    // 新客户：这一屏填的客户地址（审核 11-18 P1-2）先于项目所在地
    客户: 老客户 ? null : 向导客户地址值(d.客户.地址),
    号们: 老客户 ? [] : [
      d.号码类型 === "手机号" || !d.号码类型 ? d.phone : null, d.联系人.phone, ...(d.更多号码 ?? []).filter((x) => x.kind === "phone").map((x) => x.value),
      // 只留了 WhatsApp 的，电话那步按国际号读（审核 11-18 P1-6，服务端同一个 电话定线）
      ...(d.更多号码 ?? []).filter((x) => x.kind === "whatsapp" && x.value?.trim()).map((x) => ({ whatsapp: x.value })),
    ],
    本人线: 企业?.本人线 ?? null,
  });
  /*
    没开项目（只建客户）+ 市场成员：「项目分配方式」（11-18）——客户自带的潜客培育项目怎么分，和客户档案上的「客户分配」不是一回事。
    指定分配 = 下面客户负责人选谁给谁；自动分配 = 建好按分配方向（按岗位的市场成员）/ 客户业务线分出去；暂不分配 = 记在自己名下
  */
  const 只建摆 = 摆只建分配(带项目, 企业);
  const 只建方式 = 只建摆 ? d.只建分配?.方式 : undefined;
  const 只建说明 = 只建方式 === 0 ? `${b.customer}和潜客培育项目一起给下面选的负责人`
    : 只建方式 === 1 ? (企业?.按区域 ? 区域分配说明 : 分配说明[1]) : 只建方式 !== undefined ? 分配说明[只建方式] : "自动建的潜客培育项目怎么分";
  const 只建分配格 = 只建摆 && 一格("项目分配", "项目分配方式", (
    <Select
      className="cr-full"
      aria-label="项目分配方式"
      data-testid="cust-assign-mode"
      status={红("项目分配")}
      value={只建方式}
      placeholder="选分配方式"
      options={只建分配们(企业).map((x) => ({ value: x.i, label: x.名 }))}
      onChange={(v: number) => 改("只建分配", { 方式: v })}
    />
  ), true, false, 只建说明);
  // 分配方向（同建档向导）：没开项目没有项目所在地，客户也不填地址，默认按这一屏填的号 → 本人事业部；人改过就按改的
  const 只建方向默认 = 默认分配方向({
    号们: [d.号码类型 === "手机号" || !d.号码类型 ? d.phone : null, d.联系人.phone, ...(d.更多号码 ?? []).filter((x) => x.kind === "phone").map((x) => x.value)],
    本人线: 企业?.本人线 ?? null,
  });
  const 只建手选 = d.只建分配?.方向 ?? null;
  const 只建方向格 = 只建摆 && 只建方式 === 1 && !!企业?.按区域 && 一格(null, "分配方向", (
    <Select
      className="cr-full"
      aria-label="分配方向"
      data-testid="cust-assign-direction"
      value={只建手选 ?? 只建方向默认.线 ?? undefined}
      placeholder="内贸 / 外贸"
      options={两条线.map((x) => ({ value: x, label: x }))}
      onChange={(v) => 改("只建分配", { 方向: v ?? null })}
    />
  ), false, false, <span data-testid="cust-assign-direction-why" className={只建手选 || 只建方向默认.线 ? undefined : "cr-warn"}>{只建手选 && 只建手选 !== 只建方向默认.线 ? `你改成了${只建手选}（默认${只建方向默认.线 ? 方向来源说明(只建方向默认) : "不限"}）` : 方向来源说明(只建方向默认)}；中国大陆 → 内贸销售，其余（含港澳台）→ 外贸销售，可以改</span>);
  const 业务线格 = 企业 && (区域定线中(d, 带项目, 企业) ? 一格("业务线", "分配方向", (
    <Select
      className="cr-full"
      aria-label="分配方向"
      data-testid="wizard-direction"
      value={d.项目.分配方向 ?? 方向默认.线 ?? undefined}
      placeholder="内贸 / 外贸"
      options={两条线.map((x) => ({ value: x, label: x }))}
      onChange={(v) => 改("项目", { 分配方向: v ?? null })}
    />
  ), false, false, <span data-testid="wizard-direction-why" className={d.项目.分配方向 || 方向默认.线 ? undefined : "cr-warn"}>{d.项目.分配方向 && d.项目.分配方向 !== 方向默认.线 ? `你改成了${d.项目.分配方向}（默认${方向默认.线 ? 方向来源说明(方向默认) : "不限"}）` : 方向来源说明(方向默认)}；中国大陆 → 内贸销售，其余（含港澳台）→ 外贸销售，可以改</span>) : 一格("业务线", "业务线", (
    <Select
      className="cr-full"
      aria-label="业务线"
      data-testid="wizard-bizline"
      status={红("业务线")}
      value={d.项目.业务线 || undefined}
      placeholder="内贸 / 外贸 / 暂不分配"
      options={三种业务线.map((x) => ({ value: x, label: x }))}
      onChange={(v) => 改("项目", { 业务线: v ?? null, 业务线手选: true })}
    />
  ), true, false, 带项目
    ? <>{线提示 && <span data-testid="wizard-bizline-hint" className={线提示.同 ? undefined : "cr-warn"}>{线提示.话}；</span>}自动分配只分给这条线的销售；暂不分配 = 留在新线索等人指派。客户没另选时也记成这条线</>
    : `${b.customer}的业务线；以后开项目时默认带上`));
  const 未完 = 显错 && 差们.length > 0;
  /*
    企业版：第一行号码下面能再加几行（类型 + 号码，照联系人表单「加一个联系方式」，连第一行最多 每人最多号码 行）。
    类型同 AI 新线索卡（号码类型字典默认八种）。这几行不在这里查重：交的时候服务端按联系人表单那套验格式，
    手机、邮箱、微信、阿里国际站ID 和第一行同一套全公司查重，其余只验格式，都记在主要联系人身上
  */
  const 更多号码 = d.更多号码 ?? [];
  // 不走 改：它把对象格合并进去，数组会被摊成对象
  const 改更多 = (变: (们: 多的号[]) => 多的号[]) => {
    setD((o) => {
      const n = { ...o, 更多号码: 变(o.更多号码 ?? []) };
      存草稿(全名, { 稿: n });
      return n;
    });
    set已存(true);
  };
  const 更多号码格 = (
    <div className="cr-wide cr-more-nums" data-ge="更多号码" data-testid="wizard-more-numbers">
      {更多号码.map((x, i) => (
        <Space.Compact key={i} className="cr-full">
          <Select
            className="cr-type"
            aria-label={`第 ${i + 2} 个号码类型`}
            placeholder="号码类型"
            status={错("更多号码") && x.value.trim() && !x.kind ? "error" : undefined}
            value={x.kind}
            options={线索号码种类.map((k) => ({ value: k.kind, label: k.名 }))}
            onChange={(v) => 改更多((们) => 们.map((y, j) => (j === i ? { ...y, kind: v } : y)))}
          />
          <Input
            aria-label={`第 ${i + 2} 个号码`}
            value={x.value}
            placeholder="号码或账号"
            maxLength={号码上限}
            onChange={(e) => { const value = e.target.value; 改更多((们) => 们.map((y, j) => (j === i ? { ...y, value } : y))); }}
          />
          <Button icon={<MinusCircleOutlined />} aria-label={`去掉第 ${i + 2} 个号码`} onClick={() => 改更多((们) => 们.filter((_, j) => j !== i))} />
        </Space.Compact>
      ))}
      {更多号码.length + 1 < 每人最多号码 && (
        <Button type="dashed" block icon={<PlusOutlined />} onClick={() => 改更多((们) => (们.length + 1 < 每人最多号码 ? [...们, { kind: 第一行的kind(d.号码类型), value: "" }] : 们))}>
          加一个号码
        </Button>
      )}
      {错("更多号码") && <span className="cr-err" role="alert">{错("更多号码")}</span>}
    </div>
  );

  return (
    <div className="cr-sheet">
      {!弹窗 && (
        <PageHead
          title={新线索 || 企业版 ? "新线索" : "新建项目"}
          subtitle={新线索 || 企业版 ? "建好后是一个线索阶段的项目" : `一次建好${b.customer}、联系人、项目和第一次沟通；中途离开会存成草稿`}
        />
      )}
      {接着填 && (
        // 全站同一句（lib/form-draft.ts 带回话）：已带回 + 清空
        <Alert type="info" showIcon className="cr-alert" title={带回话(0)} action={<Button size="small" onClick={重来}>清空</Button>} />
      )}
      {企业?.没角色 && <Alert type="warning" showIcon className="cr-alert" title={没业务角色不能新建话} data-testid="wizard-no-role" />}

      <section className="cr-sec" aria-label={b.customer}>
        <div className="cr-sec-head">
          <b>{b.customer}</b>
          <span className="cr-sp" />
          {老客户
            ? (锁客户 ? null : <Button size="small" type="link" onClick={() => set老客户(null)}>换</Button>)
            : <Button size="small" type="link" loading={查中 || 名查中} disabled={!!企业?.没角色} onClick={手动查重}>查重</Button>}
        </div>
        {查错 && <div role="alert" className="cd-task-err">{查错}</div>}
        {老客户 ? (
          <div className="cr-old cr-rise" data-testid="wizard-old-customer">
            <Tag color="green">已有{b.customer}</Tag>
            <span className="cr-old-name" title={[老客户.name, 老客户.附注].filter(Boolean).join(" · ")}>{老客户.name}{老客户.附注 ? ` · ${老客户.附注}` : ""}</span>
          </div>
        ) : <div className="cr-grid">
          {企业版 ? 一格("号码", "联系方式", (
            <Space.Compact className="cr-full">
              <Select
                className="cr-type"
                aria-label="号码类型"
                placeholder="号码类型"
                status={红("号码类型")}
                value={d.号码类型}
                options={向导能选类型.map((t) => ({ value: t, label: 号码类型叫法(t) }))}
                onChange={(v) => {
                  改("号码类型", v);
                  set企查(null);
                  set领成话("");
                  // 换了类型：号码已经填了就照新类型再查一次
                  if (d.phone.trim()) void 查号({ ...d, 号码类型: v });
                }}
              />
              <Input
                aria-label="号码"
                value={d.phone}
                status={红("号码")}
                placeholder="离开输入框自动查重"
                onChange={(e) => {
                  改("phone", e.target.value);
                  set企查(null);
                  set领成话("");
                }}
                onBlur={() => { if (d.phone.trim() && !号查过) void 查号(); }}
                onPressEnter={() => void 查号()}
              />
            </Space.Compact>
          ), true, true) : 一格("号码", `${b.customer}电话`, (
            <Input
              aria-label={`${b.customer}电话`}
              value={d.phone}
              status={红("号码")}
              placeholder="离开输入框自动查重"
              onChange={(e) => {
                改("phone", e.target.value);
                set撞(null);
              }}
              onBlur={() => { if (d.phone.trim() && !号查过) void 查号(); }}
              onPressEnter={() => void 查号()}
            />
          ), true, true)}
          {企业版 && 企查 && 号查过 && (
            <div className="cr-wide">
              {企查.ok && 企查.状态 === "首次录入" ? <Alert type="success" showIcon title={去符号(企查.提示)} description={企查.归属地 ? `归属地：${企查.归属地}` : undefined} />
                : !企查.ok ? <Alert type="warning" showIcon title={去符号(企查.提示)} />
                // 查重领取成了（F-016）：面板收成只剩「已领取」那句。不重查——客户已在销售名下，重查是「重复」，会记撞号台账、摆挂靠 / 同号协同，
                // 把市场成员引去挂靠自己刚交出去的客户。下次查号清掉。出口 C 建成了（重复咨询第一步）同样只剩那一句
                : 领成话 ? <Alert type="success" showIcon title={<span role="status" data-testid="dedupe-claim-done">{领成话}</span>} />
                : <撞号面板 查={企查} users={users} 类型={d.号码类型 ?? ""} 捞回了={set企查} 渠道={d.客户.渠道 || null} 触点={d.客户.触点 || null} 领成了={set领成话} 附件们={附件们} 协同={企查.可协同 ? <SameNumberEntry 类型={d.号码类型} 值={企查.值} 渠道们={企业?.渠道们 ?? []} 默认渠道={d.客户.渠道 || null} 情况={企查.协同} /> : null} />}
            </div>
          )}
          {!企业版 && 号查过 && (
            <div className="cr-wide">
              {撞 ? (
                <Alert
                  type="error"
                  showIcon
                  title={`已有${b.customer}用这个号码，不能重复建档`}
                  description={
                    撞.id ? (
                      <span>
                        <Link href={`/customers/${撞.id}`}>{撞.name}<LinkPending /></Link>
                        {撞.school ? ` · ${撞.school}` : ""} · 在 {撞.salesOwnerName} 名下。{撞.负责人已离职找 ? `负责人已离职，请联系 ${撞.负责人已离职找}` : `要给这位${b.customer}开新项目，请找 ${撞.salesOwnerName} 或老板`}
                      </span>
                    ) : (
                      <span>{撞.负责人已离职找
                        ? `${撞.salesOwnerName}（已离职）名下已经有这个号码${撞.name ? `（${撞.name}）` : ""}；负责人已离职，请联系 ${撞.负责人已离职找}`
                        : `同事 ${撞.salesOwnerName} 名下已经有这个号码${撞.name ? `（${撞.name}）` : ""}；要接手请找 ${撞.salesOwnerName} 或老板`}</span>
                    )
                  }
                />
              ) : <Alert type="success" showIcon title="没人录过这个号码" />}
            </div>
          )}
          {企业版 && 更多号码格}
          {一格("客户名", `${b.customer}名称`, 能挑老客户 ? (
            <AutoComplete
              className="cr-full"
              value={d.客户.name}
              status={红("客户名") ?? (名拦 ? "error" : undefined)}
              options={搜词 ? [
                ...候选.map((c) => ({ value: `old:${c.id}`, label: <span className="cr-pick"><Tag color="green">已有{b.customer}</Tag>{c.name}{c.附注 ? ` · ${c.附注}` : ""}</span> })),
                { value: "new", label: <span className="cr-pick">＋ 新{b.customer}「{搜词}」</span> },
              ] : []}
              onChange={(v: string) => { if (!v.startsWith("old:") && v !== "new") 改("客户", { name: v }); }}
              onSelect={(v: string) => { if (v.startsWith("old:")) 挑老(v.slice(4)); }}
              onBlur={() => { const 名 = d.客户.name.trim(); if (名 && 名查?.名 !== 名) void 查名(名); }}
            >
              <Input aria-label={`${b.customer}名称`} placeholder={企业版 ? `${名称框提示}；已有的直接搜到` : "公司或个人；已有的直接搜到"} />
            </AutoComplete>
          ) : (
            <Input
              aria-label={`${b.customer}名称`}
              value={d.客户.name}
              status={红("客户名") ?? (名拦 ? "error" : undefined)}
              placeholder={企业版 ? 名称框提示 : "公司或个人"}
              onChange={(e) => 改("客户", { name: e.target.value })}
              onBlur={() => { const 名 = d.客户.name.trim(); if (企业版 && 名 && 名查?.名 !== 名) void 查名(名); }}
            />
          ), !企业版, false, 企业版 && 名对上 && !名查?.撞
            // 灰字（PR-7 摘来）：没填 → 列表上怎么显示；像人名 → 提醒写单位名称，都不拦（P-抬头-13 / 16）
            ? 全称像人名(d.客户.name)
              ? <span className="fullname-hint" data-testid="fullname-hint" title={`没有同名${b.customer}；${像人名提示}`}><span className="cr-ok">没有同名{b.customer}</span>；{像人名提示}</span>
              : <span className="cr-ok">没有同名{b.customer}</span>
            : 企业版 && 全称提示(d.客户.name) ? <span className="fullname-hint" data-testid="fullname-hint" title={全称提示(d.客户.name) ?? undefined}>{全称提示(d.客户.name)}</span> : undefined)}
          {名拦 && 名查 && 名查.撞 && (
            <Alert
              data-testid="wizard-name-dupe"
              type="error"
              showIcon
              className="cr-wide cr-wrap"
              title={名查.提示}
              description={"我名下" in 名查.撞 ? <div className="cr-gap"><我名下入口 客户id={名查.撞.我名下.客户id} /></div> : <AttachEntry key={名查.撞.撞.撞号id ?? 名查.名} 露出={名查.撞.撞} />}
            />
          )}
          {一格("联系人", "联系人姓名", <Input aria-label="联系人姓名" status={红("联系人")} value={d.联系人.name} onChange={(e) => 改("联系人", { name: e.target.value })} />, !企业)}
          {一格(null, "联系人电话", <Input aria-label="联系人电话" value={d.联系人.phone} onChange={(e) => 改("联系人", { phone: e.target.value })} />)}
          {!企业 && 一格(null, "职位", <Input aria-label="职位" value={d.联系人.position} onChange={(e) => 改("联系人", { position: e.target.value })} />)}
          {!企业 && 一格(null, "邮箱", <Input aria-label="邮箱" value={d.联系人.email} onChange={(e) => 改("联系人", { email: e.target.value })} />)}
          {!企业 && 一格(null, "微信", <Input aria-label="微信" value={d.联系人.wechat} onChange={(e) => 改("联系人", { wechat: e.target.value })} />)}
          {/* P16：先选渠道名称再选具体来源（一个级联到底），也能直接打字搜全称。渠道和触点至少一个（P-渠道-08） */}
          {企业 && 一格("来源", "渠道", (
            <ChannelPicker
              aria-label="渠道"
              层级="两级"
              channels={企业.渠道们}
              value={d.客户.渠道 || null}
              allowClear={!!d.客户.触点}
              placeholder="这条线索从哪个渠道、哪个来源来"
              onChange={(v) => 改("客户", { 渠道: v ?? undefined })}
            />
          ), !d.客户.触点)}
          {/* 渠道触点（P-渠道-08，和客户表单同一格）：公司资源 / 客户介绍来的主渠道留空、选这里；选了触点就不卡渠道 */}
          {企业 && 一格(null, "渠道触点", (
            <Select
              aria-label="渠道触点"
              className="cr-full"
              allowClear
              placeholder="公司资源 / 客户介绍"
              value={d.客户.触点 || undefined}
              options={渠道触点们.map((x) => ({ value: x, label: x }))}
              onChange={(v?: string) => 改("客户", { 触点: v || undefined, ...(v === 客户介绍触点 ? {} : { 介绍人: undefined }) })}
            />
          ))}
          {/* 介绍人客户（P-渠道-09）：只在触点 = 客户介绍时出现，挂一个已有客户 */}
          {企业 && d.客户.触点 === 客户介绍触点 && 一格(null, `介绍人${b.customer}`, (
            <ReferrerPicker value={d.客户.介绍人} 叫法={b.customer} onChange={(v) => 改("客户", { 介绍人: v })} />
          ))}
          {/* 客户地址三格（审核 11-18 P1-2，照新建客户页）：国家地区、省、市 */}
          {企业 && <WizardCustomerAddress value={d.客户.地址} onChange={(v) => 改("客户", { 地址: v })} />}
          {!带项目 && 业务线格}
          {只建分配格}
          {/* 客户负责人默认自己、可改（P-界面-33）；企业版普通销售只能是自己，不摆。市场成员摆了项目分配方式的：只在指定分配时选（选的就是客户负责人） */}
          {(只建摆 ? 只建方式 === 0 : !带项目 && !企业?.客户只给自己 && !独自一人(users, d.客户负责人)) && 一格(null, `${b.customer}负责人`, (
            <Select aria-label={`${b.customer}负责人`} className="cr-full" value={d.客户负责人 || 我?.id} options={只建摆 && 只建方式 === 0 ? 指定选项(负责人选项, 企业?.可指定, 我?.id, d.客户负责人) : 负责人选项} onChange={(v) => 改("客户负责人", v)} showSearch optionFilterProp="label" />
          ), 只建摆, false, 只建摆 ? `${b.customer}和自动建的潜客培育项目一起给他` : undefined)}
          {只建方向格}
          {!企业 && 一格(null, b.fields.school, <Input aria-label={b.fields.school} value={d.客户.school} onChange={(e) => 改("客户", { school: e.target.value })} />)}
          {!企业 && 一格(null, "备注", <Input.TextArea aria-label={`${b.customer}备注`} rows={2} value={d.客户.remark} onChange={(e) => 改("客户", { remark: e.target.value })} />, false, true)}
        </div>}
      </section>

      <section className="cr-sec" aria-label="项目">
        <div className="cr-sec-head">
          <b>项目</b>
          <Switch size="small" aria-label="有项目" checked={带项目} disabled={锁 || !!老客户} onChange={(v) => set带项目(v)} />
          <span className="cr-hint">{老客户 ? `给已有${b.customer}新增项目` : 锁 ? "新线索建好就是一个线索阶段的项目" : 带项目 ? "下面填项目信息；关掉就不建项目" : "有项目就打开，下面填项目信息"}</span>
        </div>
        {/* 项目开关关着也摆「指定回复时间」（11-18 员工反馈）：字段挂在项目上，填了就打开「有项目」（先有项目的规矩不变）；分配时间照旧只在项目里、选了指定 / 自动分配才有 */}
        {企业 && !带项目 && <div className="cr-grid">{回复格}</div>}
        {带项目 && (
          <div className="cr-grid cr-rise">
            {一格("项目名", "项目名称", <Input aria-label="项目名称" status={红("项目名")} value={d.项目.name} maxLength={项目名上限} showCount onChange={(e) => 改("项目", { name: e.target.value })} />, true)}
            {/* 项目来源（迁移 077）：默认带客户的渠道；老客户这一单从别的渠道来就在这改。清掉 = 回到跟客户。
                挑了老客户也摆（P-删-03「建时可选」，审核 11-18 P1-1），客户的渠道取 新项目分配数据 的 客户渠道 */}
            {企业 && 一格(null, "项目渠道", (
              <ChannelPicker
                aria-label="项目渠道"
                层级="两级"
                channels={企业.渠道们}
                value={d.项目.渠道 || 客户渠道 || null}
                allowClear={!!d.项目.渠道 && d.项目.渠道 !== 客户渠道}
                placeholder="这个项目从哪个渠道来"
                onChange={(v) => 改("项目", { 渠道: v === 客户渠道 ? null : v })}
              />
            ), false, false, d.项目.渠道 && d.项目.渠道 !== 客户渠道 ? "和客户的渠道不同：渠道统计里这个项目算在这里" : 客户渠道 ? "默认跟客户的渠道" : 老客户 ? "客户没有来源渠道：项目来源可以空着" : "客户只选了渠道触点：项目来源可以空着")}
            {企业 && 企业.分配方式们.length > 0 && 一格("分配方式", "分配方式", (
              <Select
                className="cr-full"
                aria-label="分配方式"
                status={红("分配方式")}
                value={d.项目.分配方式}
                placeholder="选分配方式"
                options={企业.分配方式们.map((x) => ({ value: x.i, label: x.名 }))}
                onChange={(v) => 改("项目", { 分配方式: v })}
              />
            ), true, false, d.项目.分配方式 !== undefined && !自动分出去 ? (区域定线中(d, 带项目, 企业) ? 区域分配说明 : 分配说明[d.项目.分配方式] || undefined) : undefined)}
            {(企业 ? 要选负责人(d, 企业) : !独自一人(users, d.项目.ownerId)) && 一格("负责人", "项目负责人", (
              <Select className="cr-full" aria-label="项目负责人" status={红("负责人")} value={d.项目.ownerId || undefined} placeholder="选项目负责人" options={企业 && d.项目.分配方式 === 0 ? 指定选项(负责人选项, 方向可指定(企业.可指定, 企业.指定候选表, d.项目.业务线), 我?.id, d.项目.ownerId) : 负责人选项} onChange={(v) => 改("项目", { ownerId: v })} showSearch optionFilterProp="label" />
            ), !!企业)}
            {/* 指定分配时间（11-17 PR3）：指定分配、自动分配才有；选了指定时间 = 到点前留在新线索待分配，到点后台分 */}
            {企业 && (d.项目.分配方式 === 0 || d.项目.分配方式 === 1) && 一格("分配时间", "分配时间", (
              <ScheduleAssignInput status={红("分配时间")} value={d.项目.定时分配 ?? null} onChange={(v) => 改("项目", { 定时分配: v })} />
            ), false, false, typeof d.项目.定时分配 === "string" ? "按北京时间，最远 30 天；到点前留在新线索待分配" : undefined)}
            {联系人们.length > 0 && 一格(null, "联系人", (
              <Select className="cr-full" aria-label="联系人" value={联系人Id} options={联系人们.map((c) => ({ value: c.id, label: c.isPrimary ? `${c.name}（主要）` : c.name }))} onChange={(v) => set联系人Id(v)} />
            ), false, false, "首条沟通记在这位联系人上")}
            {自动分出去 && <Alert type="warning" showIcon className="cr-wide" data-testid="wizard-auto-warn" title={销售自动分后果} />}
            {业务线格}
            {/* 项目所在地（11-02，选填）：项目自己的，不是客户地址；填了按所在地建议业务线（没手动选过就预填，人确认） */}
            {企业 && 一格(null, "项目所在地", (
              <AddressInput
                value={d.项目.所在地 ?? 空地址}
                onChange={(a) => {
                  const 预填 = 所在地预填(建议业务线(a), d.项目.业务线, !!d.项目.业务线手选);
                  改("项目", { 所在地: { ...a, location: d.项目.所在地?.location ?? null }, ...(预填 ? { 业务线: 预填 } : {}) });
                }}
              />
            ), false, true)}
            {企业 && 一格(null, "详细地址", (
              <Input
                aria-label="详细地址"
                placeholder={详细地址提示}
                maxLength={详细地址上限}
                value={d.项目.所在地?.location ?? ""}
                onChange={(e) => 改("项目", { 所在地: { ...(d.项目.所在地 ?? 空地址), location: e.target.value } })}
              />
            ), false, true)}
            {/* 指定回复时间（11-17，选填）：客户要求联系的时间点 / 时间段，按北京时间；只填开始 = 那个时间前后，只填结束 = 那之前 */}
            {回复格}
            {回复警 && <Alert type="warning" showIcon className="cr-wide" data-testid="wizard-reply-warn" title={回复警} />}
            {分配警 && <Alert type="warning" showIcon className="cr-wide" data-testid="wizard-schedule-warn" title={分配警} />}
            {!企业 && 一格(null, "金额", (
              <Space.Compact className="cr-full">
                <Select className="cr-cur" aria-label="币种" value={d.项目.currency} options={币种选项()} onChange={(v) => 改("项目", { currency: v })} showSearch optionFilterProp="label" />
                <InputNumber<number> className="cr-full" aria-label="金额" min={0} value={d.项目.amount} formatter={金额格式} onChange={(v) => 改("项目", { amount: v })} />
              </Space.Compact>
            ))}
            {!企业 && 一格(null, "项目备注", <Input.TextArea aria-label="项目备注" rows={2} maxLength={备注上限} value={d.项目.remark} onChange={(e) => 改("项目", { remark: e.target.value })} />, false, true)}
          </div>
        )}
      </section>

      <section className="cr-sec" aria-label="首条沟通">
        <div className="cr-sec-head">
          <b>首条沟通</b>
          {/* 团队版（用户 11-15「没有开项目，就只能算客户沟通」）；企业版沟通必须挂项目（11-17）：记在新客户自带的潜客培育项目上（M-公海-14） */}
          {!带项目 && <span className="cr-hint" data-testid="wizard-follow-where">{企业 ? `没开项目，记在自动建的「${显示节点名("潜客培育", 后售中, 企业版字典)}」项目上` : `没开项目，记成${b.customer}沟通`}</span>}
        </div>
        <div className="cr-grid">
          {一格(null, "沟通方式", (
            <FollowMethodSelect style={满宽} aria-label="沟通方式" type={d.跟进.type} method={d.跟进.method} 类型们={能选类型} onChange={(v) => { 人改了方式(); 改("跟进", v); }} />
          ), true)}
          {一格(null, "时间", (
            <DatePicker
              showTime={{ format: "HH:mm" }}
              format={时间格式}
              allowClear={false}
              className="cr-full"
              aria-label="沟通时间"
              value={dayjs(d.跟进.occurredAt, 时间格式)}
              disabledDate={(x) => x.isAfter(dayjs(), "day")}
              onChange={(v) => v && 改("跟进", { occurredAt: v.format(时间格式) })}
            />
          ), true)}
          {一格("内容", "沟通内容", <Input.TextArea aria-label="沟通内容" status={红("内容")} rows={3} placeholder="这次聊了什么" value={d.跟进.content} onChange={(e) => 改("跟进", { content: e.target.value })} />, true, true)}
          {企业 && 带项目 && 一格("节点", "当前进程", (
            <Select className="cr-full" aria-label="当前进程" status={红("节点")} disabled={记录用中} value={记录用中 ? 仅记录用节点 : d.跟进.节点} options={企业.节点们.slice(0, 企业.节点们.indexOf(有效线索节点) + 1 || undefined).map((n) => ({ value: n, label: 显示节点名(n, 后售中, 企业版字典) }))} onChange={(v) => 改("跟进", { 节点: v })} />
          ), true, false, 记录用中 ? `仅记录用的项目停在「${显示节点名(仅记录用节点, 后售中, 企业版字典)}」` : `项目建在这一步，最多到「${有效线索节点}」`)}
          {记录用可选 && 一格(null, "仅记录用", (
            <Switch size="small" aria-label="仅记录用" checked={仅记录用勾} onChange={set仅记录用勾} />
          ), false, false, 仅记录用勾 ? `为记这条沟通建的：停在${显示节点名(仅记录用节点, 后售中, 企业版字典)}，不算在推、不进新建数和转化率；以后推进出${显示节点名(仅记录用节点, 后售中, 企业版字典)}就照常算` : "不勾 = 普通项目，照常统计")}
          {能填下一步 && 一格("下一步时间", "下一步时间", (
            <>
              <DatePicker
                className="cr-full"
                aria-label="下一步时间"
                status={红("下一步时间")}
                value={d.跟进.下一步时间 ? dayjs(d.跟进.下一步时间) : null}
                disabledDate={(x) => x.isBefore(dayjs(), "day")}
                onChange={(v) => 改("跟进", { 下一步时间: v ? v.format("YYYY-MM-DD") : null })}
                placeholder="选一天"
              />
              <span className="cr-chips">
                {下一步快捷.map((k) => (
                  <Tag.CheckableTag key={k.叫} checked={d.跟进.下一步时间 === 几天后(k.天)} onChange={() => 改("跟进", { 下一步时间: 几天后(k.天) })}>{k.叫}</Tag.CheckableTag>
                ))}
              </span>
            </>
          ), 带项目 && 下一步必填, false, !带项目 ? (企业 ? `记成「潜客培育」项目的下一步` : `记成${b.customer}的一条跟进计划`) : 下一步必填 ? "到期只提醒，不会因此回收；在当前这步停满规定天数没跟进，项目才回公海" : 要下一步 && 记录用中 ? "仅记录用的项目不超时回收，可不填；填了到期只提醒" : undefined)}
          {企业 && 能填下一步 && 一格("下一步计划", "下一步计划", (
            <Input
              aria-label="下一步计划"
              data-testid="wizard-next-step"
              status={红("下一步计划")}
              maxLength={下一步文字上限}
              placeholder="下一步打算做什么，例如：发报价单"
              value={d.跟进.下一步 ?? ""}
              onChange={(e) => 改("跟进", { 下一步: e.target.value })}
            />
          ), 带项目 && 下一步必填)}
          {/*
            截图 / 附件（11-18，选填）：和记沟通框同一个挑选块（选文件、Ctrl/⌘V 粘贴截图，类型、大小照沟通附件）；建好凭票挂到这条首条沟通上。
            不用 一格 的 <label>：点文件名会把文件选择框也点开。没开项目（只建客户）：首条沟通挂在潜客培育项目上，附件挂同一条沟通
          */}
          {企业 && (
            <div className="cr-field cr-wide" data-testid="wizard-attachments">
              <span className="cr-label">截图 / 附件</span>
              <选沟通附件 文件们={附件们} on改={set附件们} />
              <span className="cr-note">选填，截图、录音都行；建好后挂在这条首条沟通上，也可以直接粘贴截图</span>
            </div>
          )}
        </div>
      </section>

      {交错 && <div role="alert" className="csq-err">{交错}</div>}
      {建后话 && <div role="status" className="pj-wiz-after" data-warn={建后话.警 || undefined}>{建后话.话}</div>}
      <div className="cr-foot">
        <span className="cr-saved" aria-live="polite">{已存 && !建好了 ? "✓ 已存草稿" : ""}</span>
        <span className="cr-sp" />
        {未完 && <span className="cr-miss" role="status">还差 {差们.length} 项</span>}
        <Button onClick={离开} disabled={交中 || 建好了 || !!知道了}>{弹窗 ? "取消" : "存草稿离开"}</Button>
        {知道了 ? (
          <Button type="primary" autoFocus onClick={知道了}>{知道了字}</Button>
        ) : (
          <Button type="primary" loading={交中 && !建好了} icon={建好了 ? <CheckOutlined /> : undefined} onClick={() => void 点建好()}>
            {建好了 ? "已保存" : 自动分出去 ? "保存并分出去" : "保存"}
          </Button>
        )}
      </div>
    </div>
  );
}


/** 对方系统原样的查重提示带着开头的符号（✅⛔📒 这类）；界面上不摆符号（规则 E），字照旧 */
function 去符号(s: string): string {
  return s.replace(/^[\p{Extended_Pictographic}\uFE0F]+/u, "");
}

/**
 * 企业版查重撞了（P0-7）：把撞到的那条摆出来，并给出口，而不是只说「已存在」。
 * 看不到的客户不给名字（撞号结论 按 看得到 收），写「领取后可见」；在公海的给「去领取」，在同事名下的给「联系负责人」
 */
function 撞号面板({ 查, users, 类型, 捞回了, 渠道, 触点, 领成了, 附件们, 协同 }: {
  查: Extract<查号码结果, { ok: true }>; users: 可选成员[]; 类型: string; 捞回了: (查: 查号码结果) => void;
  渠道?: string | null; 触点?: string | null; 领成了?: (话: string) => void; 附件们?: File[]; 协同?: React.ReactNode;
}) {
  const 撞 = 查.撞;
  const 在公海 = 查.状态 === "公海待捞";
  // 只在回收站里撞上（11-05 X-10）：没有「领取」「负责人」可说，给「从回收站捞回」（客户 11-05：只有查重触发时可以捞回）
  if (查.状态 === "回收站里有") {
    return <Alert type="error" showIcon title={去符号(查.提示)} description={<div><div>{撞?.name ? `${撞.name} · ` : ""}在回收站里</div><Space size={8} style={{ marginTop: 8 }}><RescueKey 类型={类型} 值={查.值} 捞回了={捞回了} /></Space>{协同}</div>} />;
  }
  // 市场成员撞上公海（F-016）：就地「领取并记沟通」，领了自动分给销售；公海页他领不了，不给「去领取」。
  // 是自己退回公海的也给（服务端只在他是客户创建人时说 市场可领，用户 11-19「仅对创建人豁免」）
  const 市场领 = 在公海 && !!查.市场可领;
  // 自己退回公海的：企业版原负责人看不到也领不回，「打开它」「去领取」都走不通，不摆（11-03 B7-3）
  const 我退的 = 在公海 && !!查.原负责人是我 && !市场领;
  const 负责人 = 撞?.salesOwnerName ?? "";
  // 负责人已离职（11-03 C4-5）：不叫人找他，指他的直属上级（没有就系统管理员）
  const 离职找 = 撞?.负责人已离职找 ?? "";
  // 同名同事不止一位时不猜是谁，只写名字。
  // 企业版登录名放在 email 列里、多半不是邮箱（11-03 A2-6）：像邮箱的才给复制键，不然只写名字
  const 同名 = users.filter((u) => u.name === 负责人);
  const 邮箱 = 同名.length === 1 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(同名[0].email ?? "") ? 同名[0].email : "";
  return (
    <Alert
      type={在公海 ? "warning" : "error"}
      showIcon
      title={去符号(查.提示)}
      description={
        <div>
          <div>
            {撞?.name ?? "领取后可见"}
            {撞?.school ? ` · ${撞.school}` : ""}
            {" · "}
            {在公海 ? "在公海" : 查.状态 === "我的通讯录已有" ? "在你名下" : 查.挂靠 ? `负责人：${负责人说法({ ...查.挂靠.负责人, 离职找: undefined })}` : `负责人：${负责人}${离职找 ? "（已离职）" : ""}`}
            {/* 市场成员撞上客户：这位客户在推的项目个数（含 0，只给个数），服务端不是市场成员不带 */}
            {查.在推个数 != null ? ` · ${查重提示.在推个数(查.在推个数)}` : ""}
            {查.归属地 ? ` · 归属地：${查.归属地}` : ""}
          </div>
          <Space size={8} style={{ marginTop: 8 }} wrap>
            {撞?.id && !我退的 && <Link href={`/customers/${撞.id}`}><Button size="small">打开它</Button><LinkPending /></Link>}
            {我退的 && <span style={{ color: "var(--text-muted)" }}>是你退回公海的，{原负责人不能领回提示}</span>}
            {市场领 && (
              <DedupeClaimKey
                类型={类型} 值={查.值} 客户id={撞?.id} 渠道={{ id: 渠道 }} 触点={触点}
                带来的附件={附件们}
                领了={领成了}
              />
            )}
            {在公海 && !我退的 && !市场领 && <Link href={撞?.name ? `/pool?keyword=${encodeURIComponent(撞.name)}` : "/pool"}><Button size="small">去领取</Button></Link>}
            {查.状态 === "重复" && 离职找 && <span style={{ color: "var(--text-muted)" }}>负责人已离职，请联系 {离职找}</span>}
            {/* 重复咨询第一步（出口 C）：市场成员撞上同事名下、负责人能接指定分配的客户，在负责人名下新建线索；建成了面板只剩那一句（同查重领取） */}
            {查.状态 === "重复" && 查.出口C && (
              <RepeatInquiryKey 类型={类型} 值={查.值} 负责人名={查.出口C.负责人名} 交销售={!!查.出口C.交销售} 渠道={{ id: 渠道 }} 触点={触点} 建了={领成了} />
            )}
            {查.状态 === "重复" && 负责人 && !离职找 && (邮箱
              ? <CopyValue 种类="邮箱" 叫法="负责人邮箱" value={邮箱} 文字={`联系负责人：${负责人}`} style={{ color: "var(--text-muted)" }} />
              : <span style={{ color: "var(--text-muted)" }}>联系负责人：{负责人}</span>)}
          </Space>
          {查.状态 === "重复" && 查.挂靠 && <AttachEntry key={查.挂靠.撞号id ?? 查.值} 露出={查.挂靠} 不给打开 />}
          {协同}
        </div>
      }
    />
  );
}

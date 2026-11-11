"use client";

import DatePicker from "@/components/BusinessDatePicker";

import { isCalendarDate } from "@/lib/schedule-date";
import { requiredText } from "@/lib/form-validation";

import OptionInput from "@/components/OptionInput";
import { useEffect, useState } from "react";
import { Alert, App, AutoComplete, Button, Col, Divider, Form, Input, Modal, Radio, Row, Select, Space, Spin, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { FOLLOW_STATUSES, DECISION_STATUSES } from "@/lib/constants";
import { dayjs, 成员选项, 独自一人, 可选成员 } from "@/lib/utils";
import { useMe, 默认负责人 } from "@/lib/me-client";
import { useTransferConfirm } from "./useTransferConfirm";
import { saveCustomer, checkDuplicate, 推荐人候选, type DuplicateHit, type SaveConflict } from "./actions";
import { saveChannel } from "../channels/actions";
import { useBusiness } from "@/lib/business-client";
import { statusLabel, 外贸精简 } from "@/lib/business-config";
import { 国家候选, 改过的档案, 客户等级, 客户等级说明, 规整官网, type 外贸档案 } from "@/lib/customer-extra";
import { 查电话 } from "@/lib/phone";
import { 推荐方式 } from "@/lib/referrer-kind";
import { 带走说法 } from "@/lib/carry-over";
import { 聚焦首项 } from "@/lib/modal-focus";
import { 去空, 有值 } from "@/lib/empty-value";
import { useFormGuard } from "@/lib/form-guard";
import { 字段是公司, 字段是行业 } from "@/lib/lead-convert";
import { 客户状态色of } from "@/lib/enterprise/cust-status-color";
import { 级别选项, 企业级别, 国内叫法, 是国内, 地址每格上限, 地址叫法, 详细地址上限, 简称上限 } from "@/lib/enterprise/customer-v2";
import { 三种业务线 } from "@/lib/enterprise/assign-line";
import { 释义下拉, type 客户字典释义 } from "@/components/DictNote";
import ChannelPicker, { type 可选渠道 } from "@/components/ChannelPicker";
import { 渠道触点们, 客户介绍触点 } from "@/lib/enterprise/touchpoint";

export type CustomerRow = {
  id: string;
  name: string;
  phone: string;
  school: string | null;
  grade: string | null;
  major: string | null;
  followStatus: string;
  decisionStatus: string;
  /** 客户状态（企业版才有，字典 custStatus）。老调用方没给就当没有 */
  custStatus?: string | null;
  /** 企业版客户改版（定稿 P5，迁移 072）：简称、地址四格、分配方式。老调用方没给就当没填 */
  shortName?: string | null;
  addrCountry?: string | null;
  addrProvince?: string | null;
  addrCity?: string | null;
  addrDistrict?: string | null;
  /** 地址第五格「客户地址」（迁移 091，P14 第 7 条）：公司详细地址 */
  addrDetail?: string | null;
  assignWay?: string | null;
  /** 客户类型（企业版，字典 custType，2026-10-29 P13 第 4 条，迁移 092）。老调用方没给就当没填 */
  customerType?: string | null;
  /** 客户属性（企业版，字典 custAttr，10-31 会议 A-17，迁移 104）：客户是哪一类主体，客户看板按它分列 */
  customerAttr?: string | null;
  /** 业务线（企业版，迁移 106，11-01 清单 A1）：内贸 / 外贸 / 暂不分配，手动选；列表行没带 = undefined，不交、不清 */
  bizLine?: string | null;
  /** 归档档位（企业版，迁移 114，M-导入-23）：A1 / A2 / B / C / D / E，只由归档导入写，详情页只读；空 = 不是归档导入来的 */
  archiveTier?: string | null;
  /** 渠道触点（企业版，迁移 116，P-渠道-08）：公司资源 / 客户介绍，这两类主渠道留空；列表行没带 = undefined，不交、不清 */
  touchpoint?: string | null;
  expectedSignAt: string | null;
  lastFollowAt: string | null;
  remark: string | null;
  /** 直接推荐人 */
  referrerCustomerId: string | null;
  channelId: string | null;
  /** 保留停用渠道的可读名称，不把历史归属当作新候选 */
  channelName?: string | null;
  referrerName: string | null;
  /** 渠道归属（往上两代）由系统计算；渠道负责人默认跟着推荐链，但可以单独订正 */
  attributionName: string | null;
  channelOwnerId: string | null;
  channelOwnerName: string | null;
  salesOwnerId: string;
  salesOwnerName: string;
  /** 各笔签约金额直接相加——**只拿来排序和判断签没签过**，显示用 signedTotals（不同币种不能加在一起） */
  signedAmount: number;
  /** 已签约按币种合计（2026-10-03）。老调用方没给就当没有 */
  signedTotals?: { 币种: string; 合计: number }[];
  /** 在公海里（2026-10-03 第 6 块）。老调用方没给就当不在 */
  pool?: { reason: string } | null;
  /** 外贸档案：国家、WhatsApp、微信、邮箱、来源（2026-10-05）。老调用方没给就当都没填 */
  extra?: 外贸档案 | null;
  /** 这条记录的版本号，保存时回传做并发校验 */
  updatedAt: string;
};

/** 渠道候选：企业版选渠道要按「主渠道 → 子渠道」两级点，多带属性、主渠道名、启用（lib/options.ts 的 可选渠道） */
type Option = { id: string; name: string; attr?: string | null; platform?: string | null; active?: boolean };

type FormProps = {
  open: boolean;
  editing: CustomerRow | null;
  users: 可选成员[];
  /** 外部渠道（如老师、中介） */
  channels: Option[];
  onClose: (saved: boolean) => void;
  /** 企业版普通销售：新建的客户负责人只能是自己（10-27 会议；服务端 saveCustomer 同样强制） */
  负责人只能自己?: boolean;
  /**
   * 企业版（10-28 去遗留）：推荐人三选一换成一格必填的「渠道」，不摆渠道负责人；
   * 跟进状态 / 决策状态换成「客户状态」。别的版本 false，表单一格不变
   */
  企业版?: boolean;
  /** 企业版客户状态的可选项（字典 custStatus 启用中的） */
  客户状态选项?: string[];
  /** 企业版客户状态 名字 → 标签颜色（cust-status-color.ts）；没给按名字散 */
  客户状态色?: Record<string, string>;
  /** 企业版项目模式：客户状态按名下项目自动算（10-30，cust-status-auto.ts），这里只读、不交 */
  客户状态自动?: boolean;
  /** 企业版分配方式的可选项（字典 custAssign 启用中的，定稿 P5 第 30 条） */
  分配方式选项?: string[];
  /** 企业版客户类型的可选项（字典 custType 启用中的，P13 第 4 条） */
  客户类型选项?: string[];
  /** 企业版客户属性的可选项（字典 custAttr 启用中的，A-17） */
  客户属性选项?: string[];
  /** 企业版客户状态、客户类型每项的释义（下拉里一行灰字，10-30）；不给就和原来一样 */
  字典释义?: 客户字典释义;
};

/**
 * 「推荐人 → 已有客户」的候选：表单打开才去取，不再跟着列表页 / 详情页的页面数据一起下来（2026-10-20）。
 *
 * 取回来之前下拉不能是空的——空着会让人以为「没有可选的人」：
 *   - 原来就有推荐人的（编辑），先把那一位摆上，选中的名字立刻显示，不会闪成一串 id
 *   - 其余时候转圈写「正在取」；取失败写明白、给重试，不留一个「暂无数据」
 * 每次打开都重新取（内层按 key 重新挂载）：刚建的客户下回打开就在，和原来页面重取数据一样。
 * 外贸模版不摆推荐人，也就不取。
 */
function useReferrerCandidates(要: boolean, 现有: Option | null) {
  const [列表, set列表] = useState<Option[] | null>(null);
  const [出错, set出错] = useState(false);
  const [第几回, set第几回] = useState(0);
  useEffect(() => {
    if (!要) return;
    let 作废 = false;
    推荐人候选().then(
      (r) => { if (!作废) set列表(r); },
      () => { if (!作废) set出错(true); },
    );
    return () => { 作废 = true; };
  }, [要, 第几回]);
  const 已取 = 列表 ?? [];
  return {
    候选: 现有 && !已取.some((c) => c.id === 现有.id) ? [现有, ...已取] : 已取,
    加载中: 要 && 列表 === null && !出错,
    出错: 列表 === null && 出错,
    重试: () => { set出错(false); set第几回((n) => n + 1); },
  };
}

/**
 * 外层只负责挂载时机：用 key 让每次打开都重新挂载内层，
 * 表单初值与推荐人类型随之自然重置，不必在 effect 里同步 state。
 */
export default function CustomerForm(props: FormProps) {
  if (!props.open) return null;
  return <CustomerFormInner key={props.editing?.id ?? "new"} {...props} />;
}

function CustomerFormInner({
  open,
  editing,
  users,
  channels,
  onClose,
  负责人只能自己 = false,
  企业版: 企业 = false,
  客户状态选项 = [],
  客户状态色,
  客户状态自动 = false,
  分配方式选项 = [],
  客户类型选项 = [],
  客户属性选项 = [],
  字典释义,
}: FormProps) {
  /** 客户状态还能不能手选：企业版、且没开按项目自动算 */
  const 手选状态 = 企业 && !客户状态自动;
  const b = useBusiness();
  /** 外贸模版：多问国家 / WhatsApp / 微信 / 邮箱 / 来源，不问推荐人、渠道负责人、预计签约（2026-10-05 外贸客户建议） */
  const 外贸 = 外贸精简(b);
  /**
   * 外贸档案那一整块（国家、WhatsApp、邮箱、微信、阿里 ID、来源、A–D 等级）只在非企业版的外贸模版摆。
   * 企业版客户改版（定稿 P5 第 22、23 条）：这些不摆（库里照留），换成简称、级别 S/A/B/C、地址、官网、分配方式
   */
  const 外贸档 = 外贸 && !企业;
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const 我 = useMe();
  const { 先问转走的项目 } = useTransferConfirm();
  const [saving, setSaving] = useState(false);
  // 点外面不关、关前问一句、新建的草稿留在本机（2026-10-19 客户反馈，lib/form-guard.tsx）
  const 守 = useFormGuard({ open, form, 草稿键: editing ? null : "新建客户", 关: () => onClose(false), 忙: saving, afterOpenChange: 聚焦首项 });
  const [dup, setDup] = useState<DuplicateHit | null>(null);
  /** 保存时发现别人已经改过这条记录 */
  const [conflict, setConflict] = useState<SaveConflict | null>(null);
  // 先看推荐人再看渠道：转介绍的人 channelId 也有值（排查 A1，见 lib/referrer-kind.ts）
  const [referrerType, setReferrerType] = useState<"channel" | "customer" | "none">(推荐方式(editing));
  /** 企业版渠道触点（P-渠道-08）：选了客户介绍才出「介绍人客户」（P-渠道-09），那时才取客户名单 */
  const 触点 = Form.useWatch("touchpoint", form) as string | null | undefined;
  const 选了客户介绍 = 企业 && 触点 === 客户介绍触点;
  const 推荐人 = useReferrerCandidates(
    (!外贸 && !企业) || 选了客户介绍,
    editing?.referrerCustomerId ? { id: editing.referrerCustomerId, name: editing.referrerName ?? editing.referrerCustomerId } : null,
  );
  /**
   * 渠道下拉的选项。以 props 为初值，但就地新建的渠道要立刻出现在这里——
   * 服务端的 revalidatePath 要等本弹窗关闭、页面重取数据才生效，等不及。
   */
  const [channelOptions, setChannelOptions] = useState<Option[]>(channels);
  /**
   * 负责人候选里不含管理员。但历史数据、或某人从销售改成管理员之后，
   * 已存在的记录仍可能挂在一个不在候选里的人名下——不补回去的话，
   * 下拉会显示空白，一保存就把负责人静默换成别人。
   */
  /** 新建必填；编辑时只有原来就有号码的才必填（和 saveCustomer 同一条，见 lib/phone.ts） */
  const 电话必填 = !editing || Boolean(editing.phone);
  /**
   * 企业版主渠道和触点至少填一个（P-渠道-08）：新建、原来挂着渠道或触点的都要；选了触点，渠道就可以空着（公司资源 / 客户介绍主渠道留空）。
   * 编辑时两样原来都没有的（老线索转来）不拦，改备注不该被拦。和 saveCustomer 同一条
   */
  const 企业来源必填 = (!editing || Boolean(editing.channelId) || Boolean(editing.touchpoint)) && !触点;
  /**
   * 外贸：电话 / WhatsApp / 邮箱 / 微信至少填一个（2026-10-19 客户反馈「联系电话没星号却是必填；只知道微信号怎么办」）；
   * 2026-10-21 加阿里国际站 ID，成了五选一（客户反馈：国际站来的询盘很多只有买家 ID）。
   * 几格旁边标同一个记号，不再只红电话一格。原来就有电话的那位改资料时，电话不许清空，照旧标红星
   */
  const 四选一 = 外贸档 && !editing?.phone;
  const 填了 = (k: "whatsapp" | "email" | "wechat" | "alibabaId") => String(form.getFieldValue(["extra", k]) ?? "").trim() !== "";
  const 锁给自己 = !editing && 负责人只能自己 && 我 ? 我 : null;
  const 负责人选项 = 锁给自己
    ? 成员选项(users).filter((o) => o.value === 锁给自己.id).concat(users.some((u) => u.id === 锁给自己.id) ? [] : [{ value: 锁给自己.id, label: 锁给自己.name }])
    : 成员选项(users);
  if (editing && !users.some((u) => u.id === editing.salesOwnerId)) {
    负责人选项.push({ value: editing.salesOwnerId, label: `${editing.salesOwnerName}（已不再担任负责人）` });
  }

  const 渠道选项 = channelOptions.map(c => ({ value: c.id, label: c.name }));
  const 推荐人选项 = 推荐人.候选.filter((c) => c.id !== editing?.id).map((c) => ({ value: c.id, label: c.name }));
  const 推荐人状态 = 推荐人.加载中 ? (
    <Space size={8} style={{ padding: "6px 12px" }}><Spin size="small" />正在取{b.customer}名单…</Space>
  ) : 推荐人.出错 ? (
    <Space size={4} style={{ padding: "2px 12px" }}>
      {b.customer}名单没取到
      <Button type="link" size="small" onMouseDown={(e) => e.preventDefault()} onClick={推荐人.重试}>重试</Button>
    </Space>
  ) : null;
  if (editing?.channelId && !channelOptions.some(c => c.id === editing.channelId)) {
    渠道选项.push({ value: editing.channelId, label: `${editing.channelName ?? editing.referrerName ?? "原渠道"}（已停用）` });
  }
  /**
   * 企业版客户来源按两级选（P-渠道-01 附.5：先选主渠道再选子渠道，同建档向导）。
   * 原来挂着的渠道已停用、或是「历史渠道」组的（候选里没有）：照样带上，锁着只显示
   */
  const 企业渠道们: 可选渠道[] = channelOptions.map((c) => ({ id: c.id, name: c.name, attr: c.attr ?? null, platform: c.platform ?? null, active: c.active ?? true }));
  if (editing?.channelId && !channelOptions.some((c) => c.id === editing.channelId)) {
    企业渠道们.push({ id: editing.channelId, name: editing.channelName ?? editing.referrerName ?? "原渠道", attr: null, platform: null, active: false });
  }
  const 渠道负责人选项 = 成员选项(users);
  if (editing?.channelOwnerId && !渠道负责人选项.some(u => u.value === editing.channelOwnerId)) {
    渠道负责人选项.push({ value: editing.channelOwnerId, label: `${editing.channelOwnerName ?? "原负责人"}（不在当前候选中）` });
  }

  /** 企业版地址：国家是中国（或空着）就问省 / 市 / 区县，国外只问城市 */
  const 地址国家 = Form.useWatch("addrCountry", form) as string | undefined;
  const 国内址 = !地址国家 || 是国内(地址国家);
  /** 企业版客户来源建好就锁（原来没挂渠道的老客户还能补一次） */
  const 来源锁着 = 企业 && Boolean(editing?.channelId);
  /** 渠道触点同样是来源（P-删-03）：原来有值的锁住，空的能补一次；服务端 saveCustomer 同一条 */
  const 触点锁着 = 企业 && Boolean(editing?.touchpoint);

  /** 就地新建渠道的子弹窗 */
  const [channelModal, setChannelModal] = useState(false);
  /** 渠道下拉的开合。受控是因为点「新建」时必须先收起它——它的层级在子弹窗之上，不收会挡住表单 */
  const [channelOpen, setChannelOpen] = useState(false);

  /** 手机号失焦时查重，避免同一个人被重复录入 */
  async function onPhoneBlur(e: React.FocusEvent<HTMLInputElement>) {
    const phone = e.target.value.trim();
    if (!phone) return setDup(null);
    setDup(await checkDuplicate(phone, editing?.id));
  }

  async function onOk() {
    // 校验没过 antd 自己把错标在格子下面；Modal 不接 onOk 的拒绝，不吞掉就是一条未处理的报错（10-07 外贸 e2e 盯控制台抓到）
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    // 编辑时换了销售负责人：客户名下的项目跟着走（企业版同事负责的留下，P-转-07），先列出来问一句（D-36）；取消 = 留在表单里
    if (editing && v.salesOwnerId && v.salesOwnerId !== editing.salesOwnerId && !(await 先问转走的项目([editing.id], v.salesOwnerId))) return;
    setSaving(true);
    try {
      const res = await saveCustomer({
        id: editing?.id,
        updatedAt: editing?.updatedAt,
        // 打开表单那一刻的值。服务端靠它区分「对方改的」和「我改的」，
        // 只有双方改到同一字段才算冲突，否则自动合并
        base: editing
          ? {
              name: editing.name,
              phone: editing.phone,
              school: editing.school,
              grade: editing.grade,
              major: editing.major,
              followStatus: editing.followStatus,
              decisionStatus: editing.decisionStatus,
              expectedSignAt: editing.expectedSignAt,
              remark: editing.remark,
              salesOwnerId: editing.salesOwnerId,
              channelId: editing.channelId,
              referrerCustomerId: editing.referrerCustomerId,
              channelOwnerId: editing.channelOwnerId,
              // 自动算的客户状态不交、也不进比对基准：项目一动它就变，别算成「别人改了」
              ...(企业 ? { ...(手选状态 ? { custStatus: editing.custStatus ?? null } : {}), ...企业资料基准(editing) } : {}),
              ...(企业 && editing.touchpoint !== undefined ? { touchpoint: editing.touchpoint ?? null } : {}),
            }
          : null,
        name: v.name,
        phone: v.phone ?? "",
        school: v.school ?? null,
        // 企业版不摆职位、行业（定稿 P5 第 22 条）：照原样交回，别因为表单里没有就清掉
        grade: 企业 ? (editing?.grade ?? null) : (v.grade ?? null),
        major: 企业 ? (editing?.major ?? null) : (v.major ?? null),
        // 企业版不摆跟进 / 决策状态：照原样交回（新建给默认值），改的是客户状态
        followStatus: 企业 ? (editing?.followStatus ?? "待跟进") : v.followStatus,
        decisionStatus: 企业 ? (editing?.decisionStatus ?? "了解中") : v.decisionStatus,
        ...(手选状态 ? { custStatus: v.custStatus ?? null } : {}),
        /*
          外贸模版不摆这三格：照原样交回去，别因为表单里没有就清掉（切回通用模版时它们还在）。
          没摆的格子 validateFields 不给值，所以从 editing 取
        */
        expectedSignAt: 外贸 || 企业 || (editing && !form.isFieldTouched("expectedSignAt")) ? editing?.expectedSignAt ?? null : v.expectedSignAt ? v.expectedSignAt.format("YYYY-MM-DD") : null,
        remark: v.remark ?? null,
        salesOwnerId: v.salesOwnerId,
        /*
          企业版只问渠道：没换渠道就把原来的推荐链原样交回（转介绍来的人 channelId 也有值，别把推荐人清掉）；
          换了渠道就是直接挂这个渠道，推荐人清空
        */
        channelId: 企业 ? (v.channelId ?? null) : 外贸 ? (editing?.channelId ?? null) : referrerType === "channel" ? (v.channelId ?? null) : null,
        /*
          企业版触点 = 客户介绍（P-渠道-09）：交表单上选的介绍人客户；别的照旧——没换渠道就把原来的推荐链原样交回
        */
        referrerCustomerId: 企业
          ? (v.touchpoint === 客户介绍触点 ? (v.referrerCustomerId ?? null) : editing && v.channelId === editing.channelId ? editing.referrerCustomerId : null)
          : 外贸 ? (editing?.referrerCustomerId ?? null) : referrerType === "customer" ? (v.referrerCustomerId ?? null) : null,
        /*
          外贸档案只交改过的那几格（2026-10-05 复查）：开着框的这会儿同事在记录页改了国家，我只改名字就保存，
          原来五格全交、把他改的国家冲回旧值
        */
        ...(外贸档 ? { extra: 改过的档案(v.extra, editing?.extra) } : {}),
        /*
          企业版只摆级别、官网两格档案：只交改过的那格（改过的档案 会把没摆的外贸几格当成清空，不能用）；
          简称、地址、分配方式走 企业资料
        */
        ...(企业 ? 企业档案改动(v.extra, editing?.extra) : {}),
        ...(企业
          ? {
              企业资料: {
                shortName: v.shortName ?? null,
                addrCountry: v.addrCountry ?? null,
                addrProvince: 国内址 ? (v.addrProvince ?? null) : null,
                addrCity: v.addrCity ?? null,
                addrDistrict: 国内址 ? (v.addrDistrict ?? null) : null,
                addrDetail: v.addrDetail ?? null,
                assignWay: v.assignWay ?? null,
                customerType: v.customerType ?? null,
                customerAttr: v.customerAttr ?? null,
                // 业务线：新建、或打开时带着这一格的才交（列表行没带这格时不交，免得把库里的清掉）
                ...(!editing || editing.bizLine !== undefined || v.bizLine ? { bizLine: v.bizLine ?? null } : {}),
              },
            }
          : {}),
        // 渠道触点（P-渠道-08）：新建、或打开时带着这一格的才交（列表行没带时不交，免得把库里的清掉）
        ...(企业 && (!editing || editing.touchpoint !== undefined || v.touchpoint) ? { touchpoint: v.touchpoint ?? null } : {}),
        /*
          新建不传（按推荐链算）。编辑时**只有人动过这一格才传**：选了就钉死，清空就 null（恢复按推荐链）。
          原来每次都传——这一格的初值就是现在的渠道负责人，于是换了推荐渠道，负责人还被当成「手工指定」钉在旧的人身上（排查 A4）
        */
        ...(editing && form.isFieldTouched("channelOwnerId") ? { channelOwnerId: v.channelOwnerId ?? null } : {}),
      });
      if (!res.ok) {
        // 并发冲突要留在原地把话说清楚，用一闪而过的 toast 说不明白
        if (res.conflict) {
          setConflict(res.conflict);
          return;
        }
        message.error(res.error);
        return;
      }
      // 换了负责人时，原负责人没做完的活一起转了过去，说一声（排查 B3）
      const 带走 = 带走说法(res.带走);
      // 企业版「交接中」（11-09）：换负责人同转让，别的格存了，负责人等接手人确认后才换
      if (res.交接中) message.success(res.申请移交 ? "已保存；已申请移交，等接手人确认后生效，确认前仍在你名下" : "已保存；已发起交接，等接手人确认，确认前仍在原负责人名下");
      else if (res.交接已在路上) message.info("已保存；这位已在另一笔交接里，负责人没再发起交接");
      else if (res.带走?.没转成) message.warning("已保存，但负责人刚被别人改了，这次没转");
      else message.success(editing ? (带走 ? `已保存${带走}一起转给了新负责人` : "已保存") : `${b.customer}已创建`);
      守.存好了();
      onClose(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <Modal
      {...守.弹窗}
      open={open}
      title={editing ? `编辑${b.customer}` : `新建${b.customer}`}
      onOk={onOk}
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
      width={760}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        style={{ marginTop: 8 }}
        onValuesChange={守.改了}
        initialValues={
          editing
            ? {
                ...editing,
                expectedSignAt: editing.expectedSignAt ? dayjs(editing.expectedSignAt) : null,
                // 老库落过的「暂不确认」这类占位当没填（11-11），框里空着、不进选项
                customerType: 去空(editing.customerType),
                // 企业版级别只认 S/A/B/C：库里还没改过来的 D 显示成 C
                ...(企业 ? { extra: { ...editing.extra, level: 企业级别(editing.extra?.level) ?? undefined } } : {}),
              }
            : { followStatus: "待跟进", decisionStatus: "了解中", salesOwnerId: 锁给自己 ? 锁给自己.id : 默认负责人(我, users), ...(手选状态 ? { custStatus: 客户状态选项[0] } : {}) }
        }
      >
        {conflict && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            // 不说「有人」「对方」：桌面端一个人开两个窗口也会撞上（2026-10-02 按桌面端 / 网页端复核）
            title="这一项在你编辑期间也被改过，你的改动没有保存"
            description={
              <>
                <div>
                  这条记录在 {dayjs(conflict.currentUpdatedAt).format("MM-DD HH:mm:ss")} 又被改过，
                  两边都动了：<b>{conflict.fields.join("、")}</b>。
                  {conflict.theirFields.length > conflict.fields.length && (
                    <> 那一次另外还改了：{conflict.theirFields
                      .filter((f) => !conflict.fields.includes(f))
                      .join("、")}。</>
                  )}
                </div>
                <div style={{ marginTop: 8 }}>
                  两次改到同一项，系统不替你决定留哪一个。请关闭后刷新，
                  看清现在是什么，再决定要不要改回来。
                </div>
              </>
            }
          />
        )}

        {dup && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            // 撞的是客户表（checkDuplicate 只查 customer），照实说、用工作区的叫法。
            // 原来写「系统中已有这条线索」，团队里撞号常见，人会去线索页找（2026-10-04 J-038）
            title={`已有${b.customer}用这个号码`}
            description={
              dup.id ? (
                <span>
                  {dup.name}
                  {dup.school ? ` · ${dup.school}` : ""} · 销售负责人 {dup.salesOwnerName}{dup.负责人已离职找 ? "（已离职）" : ""}
                  {dup.createdAt ? ` · 录入于 ${dayjs(dup.createdAt).format("YYYY-MM-DD")}` : ""}
                  {/* 负责人已离职（11-03 C4-5）：指他的直属上级 */}
                  {dup.负责人已离职找 ? ` · 负责人已离职，请联系 ${dup.负责人已离职找}` : ""}
                </span>
              ) : (
                // 业务员撞到同事名下、自己看不到的：只露同事名 + 客户名（10-19 拍板；同事的客户本机没有时由服务端查重给出）
                <span>
                  {dup.负责人已离职找
                    ? `${dup.salesOwnerName}（已离职）名下已经有这个号码${dup.name ? `（${dup.name}）` : ""}，请勿重复录入；负责人已离职，请联系 ${dup.负责人已离职找}`
                    : `同事 ${dup.salesOwnerName} 名下已经有这个号码${dup.name ? `（${dup.name}）` : ""}，请勿重复录入；要接手请找 ${dup.salesOwnerName} 或老板`}
                </span>
              )
            }
          />
        )}

        <Row gutter={16}>
          <Col span={8}>
            {/* 跟业务配置的叫法走（2026-10-04 L-003）：改成「学员」后这里原来还写着「客户姓名」 */}
            {/* 企业版客户是单位：这一格叫「客户全称」，旁边另有一格简称（定稿 P5 第 22 条） */}
            <Form.Item label={企业 ? "客户全称" : `${b.customer}姓名`} name="name" rules={[requiredText(企业 ? "请输入客户全称" : "请输入姓名")]}>
              <Input placeholder={企业 ? "营业执照上的全称" : "如：张三"} maxLength={企业 ? 200 : undefined} />
            </Form.Item>
          </Col>
          <Col span={8}>
            {/* 和导入、服务端同一条规矩（lib/phone.ts）：收海外号和座机；
                只有新建、或原来就有号码的才必填——原来没电话的人改个备注不该被它卡住 */}
            <Form.Item
              label={四选一 ? <>联系电话<认人记号 /></> : "联系电话"}
              name="phone"
              required={电话必填 && !四选一}
              dependencies={外贸档 ? [["extra", "whatsapp"], ["extra", "email"], ["extra", "wechat"], ["extra", "alibabaId"]] : undefined}
              extra={四选一 ? <span className="cf-any-hint"><认人记号 /> {四选一说法}</span> : undefined}
              rules={[
                {
                  validator: (_, v: string | undefined) => {
                    // 外贸：电话空着、填了 WhatsApp 就行（服务端拿 WhatsApp 当电话，二审）
                    if (外贸档 && !v?.trim() && 填了("whatsapp")) return Promise.resolve();
                    // 外贸：电话、WhatsApp 都没有，有邮箱也行——按邮箱认人（2026-10-07，lib/email-dedupe.ts）；邮箱也没有、有微信也行（2026-10-19）
                    // 原来有号码的照旧不许清空（服务端同一条），所以只管新建和原来就没电话的
                    // 再没有，有阿里国际站 ID 也行（2026-10-21）
                    if (外贸档 && !v?.trim() && !editing?.phone && (填了("email") || 填了("wechat") || 填了("alibabaId"))) return Promise.resolve();
                    if (外贸档 && !v?.trim() && 电话必填) return Promise.reject(new Error(四选一说法));
                    // 共享试用区里号码是打了码给人看的：没动它就放行，服务端会认回原号（排查 A2）
                    if (editing && v && v.includes("*") && v === editing.phone) return Promise.resolve();
                    const r = 查电话(v, { 必填: 电话必填 });
                    return r.ok ? Promise.resolve() : Promise.reject(new Error(r.error));
                  },
                },
              ]}
            >
              <Input placeholder={电话必填 ? "13800001111" : "没有可以先空着"} onBlur={onPhoneBlur} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label={b.fields.school} name="school">
              <Input placeholder={字段是公司(b.fields.school) ? "如：星辰科技" : undefined} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          {企业 ? (<>
          <Col span={8}>
            <Form.Item label="简称" name="shortName" rules={[{ max: 简称上限, message: `简称最多 ${简称上限} 个字` }]}>
              <Input placeholder="列表、项目里显示用，选填" maxLength={简称上限} />
            </Form.Item>
          </Col>
          <Col span={8}>
            {/* 级别 S/A/B/C（定稿 P5 第 23 条，原来的 D 并进 C）：还是存 extra.level */}
            <Form.Item label="客户级别" name={["extra", "level"]}>
              <Select allowClear placeholder="没分级" options={级别选项()} />
            </Form.Item>
          </Col>
          <Col span={8}>
            {/* 客户类型（P13 第 4 条）：选项在设置 → 字典「客户类型」，能改能停用；原值停用了也照样显示 */}
            <Form.Item label="客户类型" name="customerType">
              <Select allowClear placeholder="选填" {...释义下拉(字典释义?.类型)}
                options={[...new Set([...客户类型选项, ...(有值(editing?.customerType) ? [editing.customerType] : [])])].map((s) => ({ value: s, label: s }))} />
            </Form.Item>
          </Col>
          <Col span={8}>
            {/* 客户属性（A-17）：选项在设置 → 字典「客户属性」；原值停用了也照样显示 */}
            <Form.Item label="客户属性" name="customerAttr">
              <Select allowClear placeholder="选填"
                options={[...new Set([...客户属性选项, ...(editing?.customerAttr ? [editing.customerAttr] : [])])].map((s) => ({ value: s, label: s, title: s }))} />
            </Form.Item>
          </Col>
          <Col span={8}>
            {/* 业务线（11-01 清单 A1）：内贸 / 外贸 / 暂不分配手动选，新开项目默认跟它；自动分配按项目上的业务线走 */}
            <Form.Item label="业务线" name="bizLine">
              <Select allowClear placeholder="内贸 / 外贸 / 暂不分配" data-testid="customer-bizline" options={三种业务线.map((x) => ({ value: x, label: x }))} />
            </Form.Item>
          </Col>
          </>) : (<>
          <Col span={8}>
            <Form.Item label={b.fields.major} name="major">
              {/* 叫「行业」（或「所属行业」这类，2026-10-04 L-016 同一个认法）时给候选，也能直接填；教培的「专业」千变万化，照旧手填 */}
              {字段是行业(b.fields.major) ? <OptionInput options={b.industries} placeholder="选一个，或直接填" /> : <Input />}
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label={b.fields.grade} name="grade">
              {/*
                能选也能填。库里这一列是自由文本，那张下拉表只是建议——
                人手上的职位千奇百怪（结构工程师、班主任、采购总监），
                封死下拉的结果是他根本录不进来，只能空着。
                跟进状态 / 决策状态不这么做：那两个被盯盘和报表吃着，必须封闭。
              */}
              <AutoComplete
                allowClear
                placeholder="选一个，或直接填"
                options={b.grades.map((g) => ({ value: g }))}
                filterOption={(输入, o) => String(o?.value ?? "").toLowerCase().includes(输入.toLowerCase())}
              />
            </Form.Item>
          </Col>
          </>)}
          {/* 只有一个人时不问归属，见 lib/utils.ts 的 独自一人 */}
          {!独自一人(users, editing?.salesOwnerId) && (
            <Col span={8}>
              <Form.Item
                label="销售负责人"
                name="salesOwnerId"
                rules={[{ required: true, message: "请选择销售负责人" }]}
                extra={锁给自己 ? "新建的只能记在自己名下" : 外贸 ? "负责谈单、下单" : "负责谈单签约"}
              >
                <Select placeholder="请选择" options={负责人选项} disabled={Boolean(锁给自己)} />
              </Form.Item>
            </Col>
          )}
        </Row>

        {/*
          外贸档案（2026-10-05 外贸客户建议：「增加列：国家，Whatsapp，Wechat，邮箱」，来源是补的——外贸不摆渠道）。
          国家、来源能选也能填；WhatsApp 和电话常常是同一个号，旁边一键抄过来
        */}
        {企业 && (
          <>
            {/*
              地址（待定 17；P14 第 7 条定的五格叫法：国家地区、省、市、区 / 县级市、客户地址）：
              国内到省 / 市 / 区县，国外只要国家 + 城市；国家空着、填了省市的当国内。第五格「客户地址」国内国外都摆
            */}
            <Row gutter={16}>
              <Col span={国内址 ? 6 : 8}>
                <Form.Item label={地址叫法.addrCountry} name="addrCountry" rules={[{ max: 地址每格上限, message: `最多 ${地址每格上限} 个字` }]}>
                  <AutoComplete
                    allowClear
                    placeholder={国内叫法}
                    options={[{ value: 国内叫法 }, ...国家候选.map((g) => ({ label: g.组, options: g.国家.filter((x) => x !== 国内叫法).map((x) => ({ value: x })) }))]}
                    filterOption={(输入, o) => String((o as { value?: string } | undefined)?.value ?? "").toLowerCase().includes(输入.toLowerCase())}
                  />
                </Form.Item>
              </Col>
              {国内址 && (
                <Col span={6}>
                  <Form.Item label={地址叫法.addrProvince} name="addrProvince" rules={[{ max: 地址每格上限, message: `最多 ${地址每格上限} 个字` }]}>
                    <Input placeholder="如 广东省" />
                  </Form.Item>
                </Col>
              )}
              <Col span={国内址 ? 6 : 16}>
                <Form.Item label={地址叫法.addrCity} name="addrCity" rules={[{ max: 地址每格上限, message: `最多 ${地址每格上限} 个字` }]}>
                  <Input placeholder={国内址 ? "如 深圳市" : "如 Los Angeles"} />
                </Form.Item>
              </Col>
              {国内址 && (
                <Col span={6}>
                  <Form.Item label={地址叫法.addrDistrict} name="addrDistrict" rules={[{ max: 地址每格上限, message: `最多 ${地址每格上限} 个字` }]}>
                    <Input placeholder="如 南山区" />
                  </Form.Item>
                </Col>
              )}
            </Row>
            <Form.Item label={地址叫法.addrDetail} name="addrDetail" rules={[{ max: 详细地址上限, message: `最多 ${详细地址上限} 个字` }]}>
              <Input placeholder={国内址 ? "公司详细地址，如 科技园南区 8 栋 501" : "Street address, building, suite"} />
            </Form.Item>
            <Row gutter={16}>
              <Col span={16}>
                <Form.Item
                  label="官网"
                  name={["extra", "website"]}
                  rules={[{ validator: (_, v?: string) => { const r = 规整官网(v); return r.ok ? Promise.resolve() : Promise.reject(new Error(r.error)); } }]}
                >
                  <Input placeholder="如 www.example.com" />
                </Form.Item>
              </Col>
              <Col span={8}>
                {/* 分配方式（定稿 P5 第 30 条）：选项在设置 → 字典「分配方式」，能改能加；原值停用了也照样显示 */}
                <Form.Item label="客户分配" name="assignWay">
                  <Select allowClear placeholder="选填"
                    options={[...new Set([...分配方式选项, ...(editing?.assignWay ? [editing.assignWay] : [])])].map((s) => ({ value: s, label: s }))} />
                </Form.Item>
              </Col>
            </Row>
          </>
        )}

        {外贸档 && (
          <>
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item label="国家" name={["extra", "country"]}>
                  <AutoComplete
                    allowClear
                    placeholder="选一个，或直接填"
                    options={国家候选.map((g) => ({ label: g.组, options: g.国家.map((x) => ({ value: x })) }))}
                    filterOption={(输入, o) => String((o as { value?: string } | undefined)?.value ?? "").toLowerCase().includes(输入.toLowerCase())}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  label={
                    <Space size={8}>
                      <span>WhatsApp{四选一 && <认人记号 />}</span>
                      <Button
                        type="link"
                        size="small"
                        style={{ padding: 0, height: "auto" }}
                        // 共享试用区电话是打了码给人看的：抄过来存不进去，干脆不让抄
                        disabled={String(editing?.phone ?? "").includes("*")}
                        onClick={() => form.setFieldValue(["extra", "whatsapp"], form.getFieldValue("phone") ?? "")}
                      >
                        同电话
                      </Button>
                    </Space>
                  }
                  name={["extra", "whatsapp"]}
                  // 共享试用区里打了码的原样放行（服务端认得出没动过）
                  rules={[{ validator: (_, v?: string) => (!v || (editing?.extra?.whatsapp && v === editing.extra.whatsapp) || /^[+\d\s\-()（）]*$/.test(v) ? Promise.resolve() : Promise.reject(new Error("只能是数字，可以带 + 和空格"))) }]}
                >
                  <Input placeholder="如 +971 50 123 4567" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  label={四选一 ? <>邮箱<认人记号 /></> : "邮箱"}
                  name={["extra", "email"]}
                  dependencies={[["phone"], ["extra", "whatsapp"], ["extra", "wechat"], ["extra", "alibabaId"]]}
                  rules={[
                    { type: "email", message: "邮箱格式不对" },
                    {
                      // 没有电话、按邮箱认的那位：邮箱清空（又没有微信）就认不出是谁了（服务端同一条）
                      validator: (_, v?: string) =>
                        editing && !editing.phone && editing.extra?.email && !v?.trim() && !String(form.getFieldValue("phone") ?? "").trim() && !填了("whatsapp") && !填了("wechat") && !填了("alibabaId")
                          ? Promise.reject(new Error("这位没有电话，是按邮箱认的，邮箱不能清空"))
                          : Promise.resolve(),
                    },
                  ]}
                >
                  <Input placeholder="如 buyer@company.com" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item
                  label={四选一 ? <>微信<认人记号 /></> : "微信"}
                  name={["extra", "wechat"]}
                  dependencies={[["phone"], ["extra", "whatsapp"], ["extra", "email"], ["extra", "alibabaId"]]}
                  rules={[
                    {
                      // 没有电话、没有邮箱、按微信认的那位：微信清空就认不出是谁了（服务端同一条，2026-10-19）
                      validator: (_, v?: string) =>
                        editing && !editing.phone && !editing.extra?.email && editing.extra?.wechat && !v?.trim() && !String(form.getFieldValue("phone") ?? "").trim() && !填了("whatsapp") && !填了("email") && !填了("alibabaId")
                          ? Promise.reject(new Error("这位没有电话，是按微信认的，微信不能清空"))
                          : Promise.resolve(),
                    },
                  ]}
                >
                  <Input placeholder={四选一 ? "只知道微信号也行" : "选填"} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="来源" name={["extra", "source"]}>
                  <OptionInput options={b.sources} placeholder="选一个，或直接填" />
                </Form.Item>
              </Col>
              {/* 客户等级（2026-10-16 外贸基础）：只分 A/B/C/D 四档，空着 = 没分级 */}
              <Col span={8}>
                <Form.Item label="客户等级" name={["extra", "level"]}>
                  <Select allowClear placeholder="没分级" options={客户等级.map((x) => ({ value: x, label: 客户等级说明[x] }))} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              {/* 阿里国际站买家 ID（2026-10-21）：国际站询盘常常只有它，算一种联系方式；电话 / WhatsApp / 邮箱 / 微信都没有时按它认人 */}
              <Col span={8}>
                <Form.Item
                  label={四选一 ? <>阿里国际站 ID<认人记号 /></> : "阿里国际站 ID"}
                  name={["extra", "alibabaId"]}
                  dependencies={[["phone"], ["extra", "whatsapp"], ["extra", "email"], ["extra", "wechat"]]}
                  rules={[
                    {
                      // 什么都没有、只按阿里 ID 认的那位：清空就认不出是谁了（服务端同一条）
                      validator: (_, v?: string) =>
                        editing && !editing.phone && !editing.extra?.email && !editing.extra?.wechat && editing.extra?.alibabaId && !v?.trim() && !String(form.getFieldValue("phone") ?? "").trim() && !填了("whatsapp") && !填了("email") && !填了("wechat")
                          ? Promise.reject(new Error("这位没有电话，是按阿里 ID 认的，阿里 ID 不能清空"))
                          : Promise.resolve(),
                    },
                  ]}
                >
                  <Input placeholder={四选一 ? "只有国际站买家 ID 也行" : "选填"} maxLength={80} />
                </Form.Item>
              </Col>
              <Col span={16}>
                <Form.Item
                  label="官网"
                  name={["extra", "website"]}
                  rules={[{ validator: (_, v?: string) => { const r = 规整官网(v); return r.ok ? Promise.resolve() : Promise.reject(new Error(r.error)); } }]}
                >
                  <Input placeholder="如 www.example.com" />
                </Form.Item>
              </Col>
            </Row>
          </>
        )}

        {/* 企业版：只问一格必填的渠道（启用中的；原来挂着已停用的照样显示），不摆推荐人三选一、渠道负责人（10-28 去遗留 A3） */}
        {企业 && (
          /* 客户来源只记第一次带来的渠道（定稿 P5 第 22 条）：建好之后锁住，服务端 saveCustomer 同一条 */
          <Form.Item
            label="客户来源"
            name="channelId"
            dependencies={["touchpoint"]}
            rules={[{ required: 企业来源必填, message: "请选择渠道或渠道触点" }]}
            extra={来源锁着 ? "客户来源记的是第一次带来的渠道，建好之后不改；后来又从别的渠道来的，记在项目上" : undefined}
          >
            {/* A2-8：一个渠道都没有，不摆空下拉（ChannelPicker 自己写「请系统管理员先添加渠道」）；先选主渠道再选子渠道，也能打字搜全称 */}
            <ChannelPicker aria-label="客户来源" channels={企业渠道们} disabled={来源锁着} placeholder="先选主渠道，再选子渠道" />
          </Form.Item>
        )}
        {/* 渠道触点（P-渠道-08）：公司资源 / 客户介绍来的客户主渠道留空、选这里；渠道和触点至少填一个 */}
        {企业 && (
          <Form.Item
            label="渠道触点"
            name="touchpoint"
            extra={触点锁着 ? "渠道触点记的是第一次的来源，建好之后不改" : "公司分配的资源、客户介绍来的客户不选主渠道，在这里标"}
          >
            <Select
              aria-label="渠道触点"
              disabled={触点锁着}
              allowClear={!触点锁着}
              placeholder="公司资源 / 客户介绍"
              options={渠道触点们.map((x) => ({ value: x, label: x }))}
              onChange={() => void form.validateFields(["channelId"]).catch(() => undefined)}
            />
          </Form.Item>
        )}
        {/* 介绍人客户（P-渠道-09）：只在触点 = 客户介绍时出现，挂一个已有客户 */}
        {选了客户介绍 && (
          <Form.Item label={`介绍人${b.customer}`} name="referrerCustomerId">
            <Select
              aria-label={`介绍人${b.customer}`}
              showSearch
              allowClear
              placeholder={`选择介绍他来的已有${b.customer}`}
              optionFilterProp="label"
              options={推荐人选项}
              loading={推荐人.加载中}
              notFoundContent={推荐人状态 ?? undefined}
              popupRender={(menu) => (
                <>
                  {menu}
                  {推荐人选项.length > 0 && 推荐人状态}
                </>
              )}
            />
          </Form.Item>
        )}

        {/* 推荐人：决定渠道归属与渠道负责人，两者由系统按规则自动计算。外贸模版不摆（推荐分佣链是教培那一套） */}
        {!外贸 && !企业 && (<>
        <Form.Item label="推荐人" style={{ marginBottom: 12 }}>
          <Radio.Group
            value={referrerType}
            onChange={(e) => setReferrerType(e.target.value)}
            optionType="button"
            buttonStyle="solid"
            size="small"
          >
            <Radio value="none">无（自然流量）</Radio>
            <Radio value="channel">外部渠道</Radio>
            <Radio value="customer">已有{b.customer}</Radio>
          </Radio.Group>
        </Form.Item>

        {referrerType === "channel" && (
          <Form.Item name="channelId" rules={[{ required: true, message: "请选择推荐渠道" }]}>
            <Select
              showSearch
              placeholder="选择外部渠道，如：小红"
              optionFilterProp="label"
              options={渠道选项}
              open={channelOpen}
              onOpenChange={setChannelOpen}
              /**
               * 渠道往往是录学员的当场才第一次听说的。没有这个入口，
               * 用户就得放弃当前这一条、跑去渠道管理建完再回来重填。
               */
              popupRender={(menu) => (
                <>
                  {menu}
                  <Divider style={{ margin: "6px 0" }} />
                  <Button
                    type="link"
                    icon={<PlusOutlined />}
                    style={{ paddingInline: 12 }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setChannelOpen(false);
                      setChannelModal(true);
                    }}
                  >
                    新建外部渠道
                  </Button>
                </>
              )}
            />
          </Form.Item>
        )}

        {referrerType === "customer" && (
          <Form.Item name="referrerCustomerId" rules={[{ required: true, message: `请选择推荐${b.customer}` }]}>
            <Select
              showSearch
              placeholder={`选择已有${b.customer}`}
              optionFilterProp="label"
              options={推荐人选项}
              loading={推荐人.加载中}
              // 取着 / 没取到：不出「暂无数据」。下拉里没项时状态顶替空白；编辑时原推荐人那一项在上面，状态就写在它底下
              notFoundContent={推荐人状态 ?? undefined}
              popupRender={(menu) => (
                <>
                  {menu}
                  {推荐人选项.length > 0 && 推荐人状态}
                </>
              )}
            />
          </Form.Item>
        )}

        {/* 渠道负责人：默认跟着推荐链算；只有登记错误才需要在这里单独指定，
            指定后不再随渠道变动，也不影响任何其他学员 */}
        {/* 一个人用时不摆：推荐链和手选都只能是自己（2026-10-02 按桌面端复核） */}
        {editing && !独自一人(users, editing.channelOwnerId) && (
          <Form.Item
            name="channelOwnerId"
            label="渠道负责人"
            style={{ marginBottom: 12 }}
            extra="留空则按推荐链自动确定。只改这一位，不影响同渠道的其他人"
          >
            <Select allowClear placeholder={editing.channelOwnerName ? `${editing.channelOwnerName}（按推荐链）` : "按推荐链自动确定"} options={渠道负责人选项} />
          </Form.Item>
        )}
        {referrerType !== "none" && (
          <Typography.Text type="secondary" style={{ display: "block", marginBottom: 16, fontSize: 13 }}>
            渠道归属由系统按推荐链自动计算，保存后可在详情页查看
          </Typography.Text>
        )}
        </>)}

        <Row gutter={16}>
          {企业 ? (
            <Col span={8}>
              {/* 企业版：跟进状态、决策状态换成客户状态（字典 custStatus，10-28 去遗留 A1）；原值停用了也照样显示 */}
              {/* 项目模式按名下项目自动算（10-30）：只摆一枚章，不让选 */}
              {客户状态自动 ? (
                <Form.Item label="客户状态" tooltip="按这位客户名下的项目自动算，不能手改">
                  {editing?.custStatus
                    ? <Tag color={客户状态色of(客户状态色, editing.custStatus)} style={{ margin: 0 }} aria-label="客户状态">{editing.custStatus}</Tag>
                    : <Typography.Text type="secondary">建了项目后自动算</Typography.Text>}
                </Form.Item>
              ) : (
                <Form.Item label="客户状态" name="custStatus">
                  <Select allowClear placeholder="选择客户状态" {...释义下拉(字典释义?.状态)}
                    options={[...new Set([...客户状态选项, ...(editing?.custStatus ? [editing.custStatus] : [])])].map((s) => ({ value: s, label: s }))} />
                </Form.Item>
              )}
            </Col>
          ) : (<>
          <Col span={8}>
            <Form.Item label="跟进状态" name="followStatus" rules={[{ required: true }]}>
              <Select options={FOLLOW_STATUSES.map((s) => ({ value: s, label: statusLabel(b, s) }))} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label={`${b.customer}决策状态`} name="decisionStatus" rules={[{ required: true }]}>
              <Select options={DECISION_STATUSES.map((s) => ({ value: s, label: statusLabel(b, s) }))} />
            </Form.Item>
          </Col>
          </>)}
          {!外贸 && !企业 && (
            <Col span={8}>
              <Form.Item label="预计签约时间" name="expectedSignAt" extra={editing?.expectedSignAt && !isCalendarDate(editing.expectedSignAt) ? "旧记录未保存原日历日，请核对日期；重新选日期后会保存原日历日。" : undefined}>
                <DatePicker style={{ width: "100%" }} placeholder="选择日期" />
              </Form.Item>
            </Col>
          )}
        </Row>

        <Form.Item label="备注" name="remark">
          {/* 企业版上限同 actions.ts 企业版客户太长（11-02） */}
          <Input.TextArea rows={3} placeholder={`${b.customer}背景、意向、注意事项…`} maxLength={企业 ? 2000 : undefined} showCount={企业} />
        </Form.Item>

        <Space />
      </Form>
    </Modal>

    <QuickChannelModal
      open={channelModal}
      users={users}
      onClose={(created) => {
        setChannelModal(false);
        if (!created) return;
        setChannelOptions((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, "zh")));
        // 建完就替用户选上——不然还得再点开下拉找一遍，等于没省事
        form.setFieldValue("channelId", created.id);
        void form.validateFields(["channelId"]).catch(() => undefined);
      }}
    />
    </>
  );
}

/**
 * 「新建学员」里就地建渠道用的小弹窗。字段与「渠道管理」保持一致：
 * 渠道负责人是必填项，它决定这条推荐链上所有学员归谁，不能省。
 */
function QuickChannelModal({
  open,
  users,
  onClose,
}: {
  open: boolean;
  users: 可选成员[];
  onClose: (created: Option | null) => void;
}) {
  const b = useBusiness();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const 守 = useFormGuard({ open, form, 关: () => onClose(null), 忙: saving, afterOpenChange: 聚焦首项 });

  async function onOk() {
    // 校验没过 antd 自己把错标在格子下面；Modal 不接 onOk 的拒绝，不吞掉就是一条未处理的报错（10-07 外贸 e2e 盯控制台抓到）
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    setSaving(true);
    try {
      const res = await saveChannel({
        name: v.name,
        phone: v.phone ?? null,
        remark: v.remark ?? null,
        channelOwnerId: v.channelOwnerId,
      });
      if (!res.ok) {
        // 重名是这里最常见的失败，留在原地让用户改名字，别关掉弹窗
        message.error(res.error);
        return;
      }
      message.success(`渠道「${v.name}」已创建`);
      onClose({ id: res.id, name: v.name.trim() });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      {...守.弹窗}
      open={open}
      title="新建外部渠道"
      onOk={onOk}
      confirmLoading={saving}
      okText="创建"
      cancelText="取消"
      width={460}
      destroyOnHidden
      // 盖在「新建学员」上层，否则会被它的遮罩挡住
      zIndex={1100}
    >
      {/* name 前缀不能省：这个表单和「新建学员」同时在 DOM 里，
          字段名又都叫 name/phone/remark，不加前缀 label 会绑到学员那几个框上 */}
      <Form form={form} name="quickChannel" layout="vertical" style={{ marginTop: 8 }} onValuesChange={守.改了}>
        <Form.Item label="渠道姓名" name="name" rules={[requiredText("请输入渠道姓名")]}>
          <Input placeholder="如：小红" />
        </Form.Item>
        <Form.Item label="联系电话" name="phone">
          <Input placeholder="选填" />
        </Form.Item>
        {/* 一个人用时不问：不传，服务端填成那唯一的人（saveChannel 的 唯一负责人） */}
        {!独自一人(users) && (
          <Form.Item
            label="渠道负责人"
            name="channelOwnerId"
            rules={[{ required: true, message: "请选择渠道负责人" }]}
            extra={`该渠道带来的${b.customer}及其下游转介绍，渠道负责人都归此人`}
          >
            <Select placeholder="请选择" options={成员选项(users)} />
          </Form.Item>
        )}
        <Form.Item label="备注" name="remark">
          <Input.TextArea rows={2} placeholder="选填" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

const 四选一说法 = "电话 / WhatsApp / 邮箱 / 微信 / 阿里 ID 至少填一个";

/** 外贸新建客户：电话、WhatsApp、邮箱、微信、阿里 ID 几格旁边同一个记号，填一格就行（2026-10-19；10-21 加阿里 ID） */
/** 读屏不念这个记号：规矩在电话格下面那行字里念一次就够，四个格子的名字还是「微信」「邮箱」本身 */
function 认人记号() {
  return (
    <span className="cf-any-mark" title={四选一说法} aria-hidden>
      ◆
    </span>
  );
}

/** 企业版并发比对的基准：简称、地址五格、分配方式、客户类型（打开表单那一刻的值） */
function 企业资料基准(e: CustomerRow) {
  return {
    shortName: e.shortName ?? null,
    addrCountry: e.addrCountry ?? null,
    addrProvince: e.addrProvince ?? null,
    addrCity: e.addrCity ?? null,
    addrDistrict: e.addrDistrict ?? null,
    addrDetail: e.addrDetail ?? null,
    assignWay: e.assignWay ?? null,
    customerType: e.customerType ?? null,
    customerAttr: e.customerAttr ?? null,
    ...(e.bizLine !== undefined ? { bizLine: e.bizLine ?? null } : {}),
  };
}

/** 企业版档案只比级别、官网两格，改了哪格交哪格；都没改 = 不交 extra（不碰档案） */
export function 企业档案改动(
  新: { level?: string | null; website?: string | null } | undefined,
  旧: 外贸档案 | null | undefined,
): { extra?: { level?: string | null; website?: string | null } } {
  const 改: { level?: string | null; website?: string | null } = {};
  const 新级 = 新?.level || null;
  if (新级 !== 企业级别(旧?.level)) 改.level = 新级;
  const 新网 = (新?.website ?? "").trim() || null;
  if (新网 !== ((旧?.website ?? "").trim() || null)) 改.website = 新网;
  return Object.keys(改).length ? { extra: 改 } : {};
}

"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { App, Alert, Button, Input, InputNumber, Modal, Select, Space, Switch, Tag } from "antd";
import { CheckOutlined } from "@ant-design/icons";
import CopyValue from "@/components/CopyValue";
import DatePicker from "@/components/BusinessDatePicker";
import { PageHead } from "@/components/ui";
import { useBusiness } from "@/lib/business-client";
import { useMe, 默认负责人 } from "@/lib/me-client";
import { 草稿全名, 读草稿, 存草稿, 清草稿, 有内容 } from "@/lib/form-guard";
import { 跟进类型们 } from "@/lib/constants";
import FollowMethodSelect from "@/components/FollowMethodSelect";
import { 对得上的方式 } from "@/lib/follow-method";
import { 币种选项, 默认币种 } from "@/lib/currency";
import { 金额格式 } from "@/lib/money-input";
import { 成员选项, 独自一人, dayjs, type 可选成员 } from "@/lib/utils";
import { 外贸精简 } from "@/lib/business-config";
import { 项目名上限, 备注上限, 占位名提示 } from "@/lib/project/wizard";
import { 是占位值 } from "@/lib/project/required";
import { 有效线索节点, 建档不能过线索验证 } from "@/lib/project/stage-gates";
import { 下一步文字上限 } from "@/lib/project/project-fields";
import { checkDuplicate, 推荐人候选, type DuplicateHit } from "../../customers/actions";
import { 渠道触点们, 客户介绍触点, 新建来源还差 } from "@/lib/enterprise/touchpoint";
import { 查号码, 查客户名, type 查号码结果 } from "../../customers/number-actions";
import type { 名撞结论 } from "@/lib/enterprise/dupe-ledger";
import AttachEntry, { 负责人说法, 我名下入口 } from "./AttachEntry";
import RescueKey from "../../customers/RescueKey";
import { 向导能选类型, 带进联系人, 号码类型叫法, type 联系人三格 } from "@/lib/enterprise/contact-format";
import ChannelPicker, { type 可选渠道 } from "@/components/ChannelPicker";
import SameNumberEntry from "./SameNumberEntry";
import { 原负责人不能领回提示 } from "@/lib/enterprise/pool-rules";
import { 建档向导, 建档只建客户 } from "../actions";
import { 三种业务线, 分配说明, 业务线必填, 客户业务线必填, 建议业务线, 所在地预填, 所在地提示 } from "@/lib/enterprise/assign-line";
import AddressInput, { 空地址 } from "@/components/AddressInput";
import { 详细地址上限, 详细地址提示 } from "@/lib/project/profile-rules";
import type { 客户地址 } from "@/lib/enterprise/customer-v2";
import { 没业务角色不能新建话 } from "@/lib/enterprise/permissions";

const 草稿键 = "项目建档向导";
const 时间格式 = "YYYY-MM-DD HH:mm";

type 稿 = {
  /** 第一步那个号码。企业版下是选的那种号码（手机号 / 邮箱 / 微信 / 阿里国际站ID，类型值还是「旺旺ID」），不一定是电话 */
  phone: string;
  /** 企业版第一步选的号码类型（lib/enterprise/contact-format.ts）；开关关着没有这格 */
  号码类型?: string;
  联系人: { name: string; position: string; phone: string; email: string; wechat: string };
  /** 企业版：上一次查重带进联系人那几格的值（人没动过的，再查一个号时跟着换）；开关关着没有这格 */
  带过?: Partial<联系人三格>;
  /** 客户负责人：没开项目时才用（P-界面-33 默认自己、可改）；开了项目客户归谁由服务端定（P-转-03） */
  客户负责人?: string;
  /** 渠道 / 触点：企业版新建线索至少选一个（P-渠道-08，老草稿里没有）；介绍人：触点 = 客户介绍时挂的已有客户（P-渠道-09） */
  客户: { name: string; school: string; remark: string; 渠道?: string; 触点?: string; 介绍人?: string };
  /** 分配方式：企业版才有（默认五项的序号，0 指定 / 1 自动 / 2 公海捞取 / 3 暂不分配 / 4 个人自持）；老草稿里没有 */
  /** 渠道 = 项目来源（企业版，迁移 077）：没另选（空）= 跟客户的渠道；老草稿里没有 */
  /** 业务线（企业版，11-01 A1）：内贸 / 外贸 / 暂不分配，企业版必填；老草稿里没有 = 没填 */
  /** 所在地（企业版，11-02，选填）：项目自己的四格 + 详细地址；业务线手选 = 人动过业务线下拉，所在地的建议就不再覆盖（只在界面用，不交） */
  项目: {
    name: string; ownerId: string; amount: number | null; currency: string; remark: string; 分配方式?: number; 渠道?: string | null; 业务线?: string | null;
    所在地?: 客户地址 & { location?: string | null }; 业务线手选?: boolean;
  };
  /** 下一步时间（YYYY-MM-DD）：开了超时回收时才有这格、必填；老草稿里没有这格 */
  /** 节点：企业版首条沟通必选（跟进节点 = 项目落在线索阶段哪一步，最多到线索验证）；下一步 = 下一步计划（文字，企业版；开了超时回收时必填，11-05）；团队版没有 */
  跟进: { type: string; method?: string | null; content: string; occurredAt: string; 下一步时间?: string | null; 节点?: string; 下一步?: string | null };
};

/** 企业版新建线索（10-26）：负责人、渠道必选；只留联系方式、首次沟通记录、跟进节点、下一步这几格预设 */
/** 分配方式们：这个人能用、还启用着的分配方式（10-27 A7：五种都生效，只有「指定分配」要选负责人） */
/** 默认分配方式：按业务角色（11-01 会议 §1 / §3：市场 → 自动分配，销售 → 个人自持，其他 → 暂不分配）；是销售：选自动分配要再确认（A9） */
export type 企业建档 = { 渠道们: 可选渠道[]; 节点们: readonly string[]; 分配方式们: { i: number; 名: string }[]; 默认分配方式?: number | null; 是销售?: boolean; 没角色?: boolean;
  /** 企业版普通销售（10-27 会议）：新建客户负责人只能是自己，没开项目时「客户负责人」不摆（wizard-data.ts） */
  客户只给自己?: boolean } | null;
/** 向导要的服务端数据（wizard-data.ts 建档向导数据）：页面和弹窗共用 */
export type 建档数据 = { users: 可选成员[]; 要下一步: boolean; 企业: 企业建档 };
/** 弹窗里摆向导（U-新建-01，10-31 会议）：不摆页头，「存草稿离开」改成关弹窗，建好了先关再跳 */
type 弹窗模式 = { 关: () => void } | null;

/** 项目开关（P-界面-36）：客户页「新建客户」默认关；「新增项目」默认开；新线索、团队版「新建项目」开着并锁住（原整页 11-15 删了，现在都是弹窗） */
export type 项目开关 = "关" | "开" | "锁开";

/** 下一步时间快捷（P-界面-34：默认 3 天后，可改） */
const 下一步快捷 = [{ 叫: "明天", 天: 1 }, { 叫: "3 天后", 天: 3 }, { 叫: "1 周后", 天: 7 }] as const;
const 几天后 = (天: number) => dayjs().add(天, "day").format("YYYY-MM-DD");

/** 销售选自动分配的后果（A9）：就地黄条一句，原型 cr.revised 去掉「也收不回来」 */
const 销售自动分后果 = "分出去后你将看不到这个项目";

/** 企业版：这次要不要选负责人。只有「指定分配」要；没有可选的分配方式（老配置）照旧选负责人 */
const 要选负责人 = (d: 稿, 企业: 企业建档) => !!企业 && (!企业.分配方式们.length || d.项目.分配方式 === 0);
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
type 格 = "号码类型" | "号码" | "联系人" | "客户名" | "来源" | "业务线" | "项目名" | "分配方式" | "负责人" | "内容" | "节点" | "下一步时间" | "下一步计划";
type 差项 = { 格: 格; 话: string };

/**
 * 整张表还差什么（一个弹窗填完，P-界面-36）；空 = 能建。按钮不变灰，点了才把这些就地标红（原型 cr.validate）。
 * 没开项目：只看客户和首条沟通；企业版客户业务线必填（M-必填-13），开了项目跟项目的业务线走
 */
function 还差们(d: 稿, 带项目: boolean, 要下一步: boolean, 企业: 企业建档 = null): 差项[] {
  const 企 = !!企业;
  const 差: 差项[] = [];
  const 记 = (格: 格, 话: string) => void 差.push({ 格, 话 });
  if (企 && !d.号码类型) 记("号码类型", "请选择号码类型");
  if (!d.phone.trim()) 记("号码", 企 ? "请填号码" : "请填电话");
  // 企业版：「未知」「待定」「暂未确认」这类占位不算填了（11-03 A2-2，服务端同一句）
  if (!d.客户.name.trim()) 记("客户名", "请填写名称");
  else if (企 && 是占位值(d.客户.name)) 记("客户名", 占位名提示("客户名称"));
  if (!d.联系人.name.trim()) 记("联系人", "请填写联系人姓名");
  else if (企 && 是占位值(d.联系人.name)) 记("联系人", 占位名提示("联系人姓名"));
  const 来源 = 企业 ? 新建来源还差(d.客户.渠道, d.客户.触点) : "";
  if (来源) 记("来源", 来源);
  if (企业 && !d.项目.业务线) 记("业务线", 带项目 ? 业务线必填 : 客户业务线必填);
  if (带项目) {
    if (!d.项目.name.trim()) 记("项目名", "请填写项目名称");
    else if (企 && 是占位值(d.项目.name)) 记("项目名", 占位名提示("项目名称"));
    else if (d.项目.name.trim().length > 项目名上限) 记("项目名", `项目名称请控制在 ${项目名上限} 字以内`);
    if (企业 && 企业.分配方式们.length && d.项目.分配方式 === undefined) 记("分配方式", "请选分配方式");
    if (要选负责人(d, 企业) && !d.项目.ownerId) 记("负责人", "请选项目负责人");
  }
  if (!d.跟进.content.trim()) 记("内容", "请填写这次沟通的内容");
  if (带项目 && 企业) {
    if (!d.跟进.节点 || !企业.节点们.includes(d.跟进.节点)) 记("节点", "请选当前进程（线索阶段的哪一步）");
    else if (企业.节点们.indexOf(d.跟进.节点) > 企业.节点们.indexOf(有效线索节点)) 记("节点", 建档不能过线索验证);
  }
  // 超时回收是项目的钟：没开项目不要求下一步（填了记成客户上的跟进计划）
  if (带项目 && 要下一步 && !d.跟进.下一步时间) 记("下一步时间", "请填下一步时间：过了那天还没有新的沟通，项目会自动回到公海");
  if (带项目 && 要下一步 && 企业 && !d.跟进.下一步?.trim()) 记("下一步计划", "请写下一步计划");
  return 差;
}

/**
 * 新建弹窗（P-界面-36，11-15 用户：「之前是填入手机号客户名……不用分5步」）：客户、项目、首条沟通一个表单分三段。
 * 项目是开关：有项目就打开、下面填项目信息，没项目只建客户（首条沟通算客户沟通）；新线索进来开着并锁住。
 * 号码、客户名离开输入框自动查重，也可手动点；中途关掉不落库，填过的每格存本机草稿（一人一份），下次接着填；建好一笔落库，失败整笔不留
 */
export default function ProjectWizard({ users, 要下一步, 企业 = null, 新线索 = false, 弹窗 = null, 开关 = "锁开" }: { users: 可选成员[]; 要下一步: boolean; 企业?: 企业建档; 新线索?: boolean; 弹窗?: 弹窗模式; 开关?: 项目开关 }) {
  // 草稿在本机 localStorage 里，服务端渲染时读不到；挂上之后再按草稿起头，免得两边对不上
  const 挂上了 = useSyncExternalStore(不订阅, () => true, () => false);
  const 我 = useMe();
  const 全名 = 草稿全名(我?.id, 草稿键);
  if (!挂上了) return null;
  const 旧 = 读草稿(全名) as { 稿?: 稿 } | null;
  return <WizardBody key={全名} users={users} 要下一步={要下一步} 企业={企业} 新线索={新线索} 弹窗={弹窗} 开关={开关} 全名={全名} 旧={旧?.稿 && 有内容(旧.稿) ? 旧.稿 : null} />;
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
export function 建档弹窗(props: { open: boolean; 标题: string; 数据: 建档数据; onClose: () => void; afterClose?: () => void; 项目?: 项目开关 }) {
  return <WizardModal {...props} />;
}

// 要用 hook（当前用户），组件名得是大写英文开头（react-hooks 规则）
function WizardModal({ open, 标题, 数据, onClose, afterClose, 项目 = "开" }: { open: boolean; 标题: string; 数据: 建档数据; onClose: () => void; afterClose?: () => void; 项目?: 项目开关 }) {
  return (
    <Modal open={open} title={标题} footer={null} width={760} onCancel={onClose} afterClose={afterClose} destroyOnHidden mask={{ closable: false }}>
      <ProjectWizard users={数据.users} 要下一步={数据.要下一步} 企业={数据.企业} 弹窗={{ 关: onClose }} 开关={项目} />
    </Modal>
  );
}

/** 下拉撑满格子（FollowMethodSelect 只收 style） */
const 满宽 = { width: "100%" };

/** 建好后按钮上的 ✓ 停一下再走（原型 cr.submit：原地转圈 → ✓ → 落到新客户页） */
const 落定停留 = 600;

/**
 * 要下一步 = 企业版开了超时回收：带项目时首条沟通要填下一步时间（项目建在线索阶段）。
 * 能填下一步 = 企业版：没开超时回收也摆这一格、选填，默认 3 天后（P-界面-34）
 * 企业版 = 先选号码类型、按类型验格式、全公司查重（2026-10-26，customers/number-actions.ts）
 */
function WizardBody({ users, 要下一步, 企业, 新线索, 弹窗, 开关, 全名, 旧 }: { users: 可选成员[]; 要下一步: boolean; 企业: 企业建档; 新线索: boolean; 弹窗: 弹窗模式; 开关: 项目开关; 全名: string; 旧: 稿 | null }) {
  const 企业版 = !!企业;
  const 能填下一步 = 企业版 || 要下一步;
  const router = useRouter();
  const { message } = App.useApp();
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
    return 企业 ? { ...n, 号码类型: "手机号", 客户负责人: 我?.id, 项目: { ...n.项目, 分配方式: 分 }, 跟进: { ...跟进, 节点: 企业.节点们[0] } } : { ...n, 客户负责人: 我?.id, 跟进 };
  };

  const 锁 = 开关 === "锁开";
  const [带项目, set带项目] = useState(开关 !== "关");
  // 上次没填完的接着填
  const [d, setD] = useState<稿>(() => (旧 ? { ...新稿(), ...旧 } : 新稿()));
  const [已查, set已查] = useState<string | null>(null);
  const [撞, set撞] = useState<DuplicateHit>(null);
  // 企业版「查重」回来的那句（格式不对 / 首次录入 / 撞了哪种）
  const [企查, set企查] = useState<查号码结果 | null>(null);
  const [查中, set查中] = useState(false);
  // 企业版客户名查重（P-挂靠-01）：离开客户名那格就查；撞了就地摆出负责人和申请挂靠，改了名字再查
  const [名查, set名查] = useState<{ 名: string; 撞: 名撞结论 | null; 提示: string } | null>(null);
  const [名查中, set名查中] = useState(false);
  const [交中, set交中] = useState(false);
  const [建好了, set建好了] = useState(false);
  const [显错, set显错] = useState(false);
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
    try {
      if (企业版) {
        const r = await 查号码(稿面.号码类型 ?? "", 号);
        set企查(r);
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
    } catch {
      message.error("查重没查成，请稍后再试");
      return null;
    } finally {
      set查中(false);
    }
  };

  /** 企业版客户名查重：没撞 = true；不是企业版不查 */
  const 查名 = async (名 = d.客户.name.trim()): Promise<boolean> => {
    if (!企业版) return true;
    if (!名) return false;
    set名查中(true);
    try {
      const r = await 查客户名(名);
      if (!r.ok) { message.error(r.error); return false; }
      set名查({ 名, 撞: r.撞 ?? null, 提示: r.撞 ? r.提示 : "" });
      return !r.撞;
    } catch {
      message.error("查重没查成，请稍后再试");
      return false;
    } finally {
      set名查中(false);
    }
  };

  const 号查过 = 已查 === 查过键(d, 企业版) && !!d.phone.trim();
  const 号拦 = 号查过 && (企业版 ? !!企查 && !(企查.ok && 企查.状态 === "首次录入") : !!撞);
  const 名对上 = !!名查 && 名查.名 === d.客户.name.trim();
  const 名拦 = 企业版 && 名对上 && !!名查?.撞;
  const 差们 = 还差们(d, 带项目, 要下一步, 企业);
  const 错 = (g: 格) => (显错 ? 差们.find((x) => x.格 === g)?.话 : undefined);
  const 红 = (g: 格) => (错(g) ? ("error" as const) : undefined);
  // 销售选自动分配：分出去后就看不到这个项目了（A9）。就地黄条说后果、按钮写明「并分出去」，不再叠一层确认框（原型 cr.auto）
  const 自动分出去 = 带项目 && !!企业?.是销售 && d.项目.分配方式 === 1;

  const 滚到 = (g: 格) => {
    document.querySelector(`[data-ge="${g}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
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
    let 稿面: 稿 | null = d;
    if (!号查过) 稿面 = await 查号(d);
    else if (号拦) 稿面 = null;
    if (!稿面) return 滚到("号码");
    if (企业版 && !(名对上 ? !名查?.撞 : await 查名())) return 滚到("客户名");
    void 提交(稿面);
  };

  const 提交 = async (稿面: 稿) => {
    set交中(true);
    // 企业版不是「指定分配」的：先建在我名下（服务端也这么改），建好再按分配方式转走
    const 负责人 = 企业 && !要选负责人(稿面, 企业) ? 我?.id ?? "" : 稿面.项目.ownerId;
    const { 渠道: 项目渠道, 业务线手选: _手选, ...项目稿 } = 稿面.项目;
    void _手选;
    const 客户 = {
      // 企业版：选的不是手机号的，电话空着，号码按 企业号码 交（saveCustomer 按类型存、再查一次重）
      name: 稿面.客户.name, phone: 企业版 && 稿面.号码类型 !== "手机号" ? "" : 稿面.phone,
      ...(企业版 ? { 企业号码: { 类型: 稿面.号码类型 ?? "", 值: 稿面.phone } } : {}),
      school: 稿面.客户.school || null, grade: null, major: null,
      followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: 稿面.客户.remark || null,
      // 带项目：团队版客户记在项目负责人名下，企业版客户归谁由 建档向导 定（P-转-03、X-18）；
      // 只建客户：客户负责人默认自己、可改（P-界面-33），企业版普通销售只能是自己（saveCustomer 同样落到自己）
      salesOwnerId: 带项目 ? 负责人 || null : 稿面.客户负责人 || 我?.id || null,
      channelId: 企业 ? 稿面.客户.渠道 || null : null,
      // 渠道触点（P-渠道-08）：选了客户介绍才带介绍人（P-渠道-09）
      referrerCustomerId: 企业 && 稿面.客户.触点 === 客户介绍触点 ? 稿面.客户.介绍人 || null : null,
      ...(企业 ? { touchpoint: 稿面.客户.触点 || null } : {}),
      // 只建客户：客户业务线必填（M-必填-13），开了项目由服务端跟项目的业务线走
      ...(企业 && !带项目 ? { 企业资料: { bizLine: 稿面.项目.业务线 ?? null } } : {}),
    };
    const 跟进 = 企业
      ? { ...稿面.跟进, method: 对得上的方式(稿面.跟进.type, 稿面.跟进.method), ...(带项目 ? {} : { 节点: undefined }) }
      : { type: 稿面.跟进.type, content: 稿面.跟进.content, occurredAt: 稿面.跟进.occurredAt, 下一步时间: 能填下一步 ? 稿面.跟进.下一步时间 : null };
    try {
      const r = 带项目
        ? await 建档向导({
          客户,
          联系人: 稿面.联系人,
          项目: {
            ...项目稿, amount: 稿面.项目.amount ?? 0, ownerId: 负责人 || null, 分配方式: 企业 ? 稿面.项目.分配方式 ?? null : undefined,
            // 业务线（11-01 清单 A1，手动选）：企业版总是传（没选 = null）；团队版不传
            业务线: 企业 ? 稿面.项目.业务线 ?? null : undefined,
            // 项目来源：没另选就跟客户的渠道（服务端 项目来源默认 同一个规矩）；团队版不传
            ...(企业 ? { channelId: 项目渠道 || 稿面.客户.渠道 || null } : {}),
          },
          跟进,
        })
        : await 建档只建客户({ 客户, 联系人: 稿面.联系人, 跟进 });
      if (!r.ok && "同号协同" in r) {
        // 同号再次录入：没新建，记录已写进现有项目（查重之后才有人录同号时走到这）
        清草稿(全名);
        message.info(r.error);
        弹窗?.关();
        if (弹窗) router.refresh();
        else router.push(新线索 || 企业版 ? "/leads" : "/projects");
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
        message.error(r.error);
        return;
      }
      清草稿(全名);
      set建好了(true);
      message.success(带项目 ? `已建好项目「${稿面.项目.name.trim()}」` : `已建好${b.customer}「${稿面.客户.name.trim()}」`);
      const 转走 = "转走" in r && !!r.转走;
      if ("提示" in r && r.提示) (转走 ? message.info : message.warning)(r.提示);
      await new Promise((ok) => setTimeout(ok, 落定停留));
      弹窗?.关();
      // 分走了 / 进了公海，项目不在我名下：回线索列表（弹窗里建的：留在原页刷新）
      if (转走) return void (弹窗 ? router.refresh() : router.push(新线索 ? "/leads" : "/projects"));
      // 弹窗里建的落到新客户页（企业版停在这个项目的页签，客户详情合并 11-12）；整页建档照旧进项目详情
      if (!r.projectId) return void router.push(`/customers/${r.customerId}`);
      router.push(弹窗 && 企业版 ? `/customers/${r.customerId}?project=${r.projectId}` : `/projects/${r.projectId}`);
    } catch {
      message.error("没建成，请稍后再试；填过的还在");
    } finally {
      set交中(false);
    }
  };

  // 草稿每改一格就存了（存草稿），这里只是走开。弹窗关掉不弹提示（角落「已存草稿」看得见，原型 cr.draft）
  const 离开 = () => {
    if (弹窗) return 弹窗.关();
    if (有内容(d)) message.info(`草稿存在这台电脑的浏览器里，下次点「${新线索 || 企业版 ? "新线索" : "新建项目"}」会接着填`);
    router.push(新线索 || 企业版 ? "/leads" : "/projects");
  };

  const 重来 = () => {
    清草稿(全名);
    setD(新稿());
    set已查(null);
    set撞(null);
    set企查(null);
    set名查(null);
    set显错(false);
    set已存(false);
    set接着填(false);
  };

  // 所在地给的业务线建议（11-02）：只提示，提交 = 人确认了
  const 线提示 = 企业 && 带项目 ? 所在地提示(建议业务线(d.项目.所在地), d.项目.业务线) : null;
  const 一格 = (g: 格 | null, label: string, el: React.ReactNode, 必填 = false, 宽 = false, 注?: React.ReactNode) => (
    <label className={宽 ? "cr-field cr-wide" : "cr-field"} data-ge={g ?? undefined}>
      <span className="cr-label">{必填 && <span className="cr-req">* </span>}{label}</span>
      {el}
      {g && 错(g) ? <span className="cr-err" role="alert">{错(g)}</span> : 注 ? <span className="cr-note">{注}</span> : null}
    </label>
  );
  const 业务线格 = 企业 && 一格("业务线", "业务线", (
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
    : `${b.customer}的业务线；以后开项目时默认带上`);
  const 未完 = 显错 && 差们.length > 0;

  return (
    <div className="cr-sheet">
      {!弹窗 && (
        <PageHead
          title={新线索 || 企业版 ? "新线索" : "新建项目"}
          subtitle={新线索 || 企业版 ? "建好后是一个线索阶段的项目" : `一次建好${b.customer}、联系人、项目和第一次沟通；中途离开会存成草稿`}
        />
      )}
      {接着填 && (
        <Alert type="info" showIcon className="cr-alert" title="接着上次没填完的" action={<Button size="small" onClick={重来}>清空重来</Button>} />
      )}
      {企业?.没角色 && <Alert type="warning" showIcon className="cr-alert" title={没业务角色不能新建话} data-testid="wizard-no-role" />}

      <section className="cr-sec" aria-label={b.customer}>
        <div className="cr-sec-head">
          <b>{b.customer}</b>
          <span className="cr-sp" />
          <Button size="small" type="link" loading={查中 || 名查中} disabled={!!企业?.没角色} onClick={手动查重}>查重</Button>
        </div>
        <div className="cr-grid">
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
                : <撞号面板 查={企查} users={users} 类型={d.号码类型 ?? ""} 捞回了={set企查} 协同={企查.可协同 ? <SameNumberEntry 类型={d.号码类型} 值={企查.值} 渠道们={企业?.渠道们 ?? []} 默认渠道={d.客户.渠道 || null} 情况={企查.协同} /> : null} />}
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
                        <Link href={`/customers/${撞.id}`}>{撞.name}</Link>
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
          {一格("客户名", `${b.customer}名称`, (
            <Input
              aria-label={`${b.customer}名称`}
              value={d.客户.name}
              status={红("客户名") ?? (名拦 ? "error" : undefined)}
              placeholder="公司或个人"
              onChange={(e) => 改("客户", { name: e.target.value })}
              onBlur={() => { const 名 = d.客户.name.trim(); if (企业版 && 名 && 名查?.名 !== 名) void 查名(名); }}
            />
          ), true, false, 企业版 && 名对上 && !名查?.撞 ? <span className="cr-ok">没有同名{b.customer}</span> : undefined)}
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
          {一格("联系人", "联系人姓名", <Input aria-label="联系人姓名" status={红("联系人")} value={d.联系人.name} onChange={(e) => 改("联系人", { name: e.target.value })} />, true)}
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
          {!带项目 && 业务线格}
          {/* 客户负责人默认自己、可改（P-界面-33）；企业版普通销售只能是自己，不摆 */}
          {!带项目 && !企业?.客户只给自己 && !独自一人(users, d.客户负责人) && 一格(null, `${b.customer}负责人`, (
            <Select aria-label={`${b.customer}负责人`} className="cr-full" value={d.客户负责人 || 我?.id} options={负责人选项} onChange={(v) => 改("客户负责人", v)} showSearch optionFilterProp="label" />
          ))}
          {!企业 && 一格(null, b.fields.school, <Input aria-label={b.fields.school} value={d.客户.school} onChange={(e) => 改("客户", { school: e.target.value })} />)}
          {!企业 && 一格(null, "备注", <Input.TextArea aria-label={`${b.customer}备注`} rows={2} value={d.客户.remark} onChange={(e) => 改("客户", { remark: e.target.value })} />, false, true)}
        </div>
      </section>

      <section className="cr-sec" aria-label="项目">
        <div className="cr-sec-head">
          <b>项目</b>
          <Switch size="small" aria-label="有项目" checked={带项目} disabled={锁} onChange={(v) => set带项目(v)} />
          <span className="cr-hint">{锁 ? "新线索建好就是一个线索阶段的项目" : 带项目 ? "下面填项目信息；关掉就不建项目" : "有项目就打开，下面填项目信息"}</span>
        </div>
        {带项目 && (
          <div className="cr-grid cr-rise">
            {一格("项目名", "项目名称", <Input aria-label="项目名称" status={红("项目名")} value={d.项目.name} maxLength={项目名上限} showCount onChange={(e) => 改("项目", { name: e.target.value })} />, true)}
            {/* 项目来源（迁移 077）：默认带客户的渠道；老客户这一单从别的渠道来就在这改。清掉 = 回到跟客户 */}
            {企业 && 一格(null, "项目渠道", (
              <ChannelPicker
                aria-label="项目渠道"
                层级="两级"
                channels={企业.渠道们}
                value={d.项目.渠道 || d.客户.渠道 || null}
                allowClear={!!d.项目.渠道 && d.项目.渠道 !== d.客户.渠道}
                placeholder="这个项目从哪个渠道来"
                onChange={(v) => 改("项目", { 渠道: v === d.客户.渠道 ? null : v })}
              />
            ), false, false, d.项目.渠道 && d.项目.渠道 !== d.客户.渠道 ? "和客户的渠道不同：渠道统计里这个项目算在这里" : d.客户.渠道 ? "默认跟客户的渠道" : "客户只选了渠道触点：项目来源可以空着")}
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
            ), true, false, d.项目.分配方式 !== undefined && !自动分出去 ? 分配说明[d.项目.分配方式] || undefined : undefined)}
            {(企业 ? 要选负责人(d, 企业) : !独自一人(users, d.项目.ownerId)) && 一格("负责人", "项目负责人", (
              <Select className="cr-full" aria-label="项目负责人" status={红("负责人")} value={d.项目.ownerId || undefined} placeholder="选项目负责人" options={负责人选项} onChange={(v) => 改("项目", { ownerId: v })} showSearch optionFilterProp="label" />
            ), !!企业)}
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
          {/* 用户 11-15「没有开项目，就只能算客户沟通」 */}
          {!带项目 && <span className="cr-hint">没开项目，记成{b.customer}沟通</span>}
        </div>
        <div className="cr-grid">
          {一格(null, "沟通方式", (
            <FollowMethodSelect style={满宽} aria-label="沟通方式" type={d.跟进.type} method={d.跟进.method} 类型们={能选类型} onChange={(v) => 改("跟进", v)} />
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
            <Select className="cr-full" aria-label="当前进程" status={红("节点")} value={d.跟进.节点} options={企业.节点们.slice(0, 企业.节点们.indexOf(有效线索节点) + 1 || undefined).map((n) => ({ value: n, label: n }))} onChange={(v) => 改("跟进", { 节点: v })} />
          ), true, false, `项目建在这一步，最多到「${有效线索节点}」`)}
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
          ), 带项目 && 要下一步, false, !带项目 ? `记成${b.customer}的一条跟进计划` : 要下一步 ? "过了那天还没有新的沟通，或在当前这步停满规定天数，项目都会自动回到公海" : undefined)}
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
          ), 带项目 && 要下一步)}
        </div>
      </section>

      <div className="cr-foot">
        <span className="cr-saved" aria-live="polite">{已存 && !建好了 ? "✓ 已存草稿" : ""}</span>
        <span className="cr-sp" />
        {未完 && <span className="cr-miss" role="status">还差 {差们.length} 项</span>}
        <Button onClick={离开} disabled={交中 || 建好了}>{弹窗 ? "取消" : "存草稿离开"}</Button>
        <Button type="primary" loading={交中 && !建好了} icon={建好了 ? <CheckOutlined /> : undefined} onClick={() => void 点建好()}>
          {建好了 ? "已建好" : 自动分出去 ? "建好并分出去" : "建好"}
        </Button>
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
function 撞号面板({ 查, users, 类型, 捞回了, 协同 }: { 查: Extract<查号码结果, { ok: true }>; users: 可选成员[]; 类型: string; 捞回了: (查: 查号码结果) => void; 协同?: React.ReactNode }) {
  const 撞 = 查.撞;
  const 在公海 = 查.状态 === "公海待捞";
  // 只在回收站里撞上（11-05 X-10）：没有「领取」「负责人」可说，给「从回收站捞回」（客户 11-05：只有查重触发时可以捞回）
  if (查.状态 === "回收站里有") {
    return <Alert type="error" showIcon title={去符号(查.提示)} description={<div><div>{撞?.name ? `${撞.name} · ` : ""}在回收站里</div><Space size={8} style={{ marginTop: 8 }}><RescueKey 类型={类型} 值={查.值} 捞回了={捞回了} /></Space>{协同}</div>} />;
  }
  // 自己退回公海的：企业版原负责人看不到也领不回，「打开它」「去领取」都走不通，不摆（11-03 B7-3）
  const 我退的 = 在公海 && !!查.原负责人是我;
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
            {查.归属地 ? ` · 归属地：${查.归属地}` : ""}
          </div>
          <Space size={8} style={{ marginTop: 8 }} wrap>
            {撞?.id && !我退的 && <Link href={`/customers/${撞.id}`}><Button size="small">打开它</Button></Link>}
            {我退的 && <span style={{ color: "var(--text-muted)" }}>是你退回公海的，{原负责人不能领回提示}</span>}
            {在公海 && !我退的 && <Link href={撞?.name ? `/pool?keyword=${encodeURIComponent(撞.name)}` : "/pool"}><Button size="small">去领取</Button></Link>}
            {查.状态 === "重复" && 离职找 && <span style={{ color: "var(--text-muted)" }}>负责人已离职，请联系 {离职找}</span>}
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

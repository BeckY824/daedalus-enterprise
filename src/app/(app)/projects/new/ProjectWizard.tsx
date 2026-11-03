"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { App, Alert, Button, Input, InputNumber, Modal, Radio, Select, Space, Steps } from "antd";
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
import { 有效线索节点, 缺有效沟通 } from "@/lib/project/stage-gates";
import { checkDuplicate, type DuplicateHit } from "../../customers/actions";
import { 查号码, type 查号码结果 } from "../../customers/number-actions";
import { 向导能选类型, 带进联系人, 号码类型叫法, type 联系人三格 } from "@/lib/enterprise/contact-format";
import ChannelPicker, { type 可选渠道 } from "@/components/ChannelPicker";
import SameNumberEntry from "./SameNumberEntry";
import { 原负责人不能领回提示 } from "@/lib/enterprise/pool-rules";
import { 建档向导 } from "../actions";
import { 三种业务线, 业务线必填, 销售自动分确认, 建议业务线, 所在地预填, 所在地提示 } from "@/lib/enterprise/assign-line";
import AddressInput, { 空地址 } from "@/components/AddressInput";
import { 详细地址上限, 详细地址提示 } from "@/lib/project/profile-rules";
import type { 客户地址 } from "@/lib/enterprise/customer-v2";

const 草稿键 = "项目建档向导";
const 步骤们 = ["查重", "联系人", "客户", "项目", "首条沟通"] as const;
const 时间格式 = "YYYY-MM-DD HH:mm";

type 稿 = {
  /** 第一步那个号码。企业版下是选的那种号码（手机号 / 邮箱 / 微信 / 阿里国际站ID，类型值还是「旺旺ID」），不一定是电话 */
  phone: string;
  /** 企业版第一步选的号码类型（lib/enterprise/contact-format.ts）；开关关着没有这格 */
  号码类型?: string;
  联系人: { name: string; position: string; phone: string; email: string; wechat: string };
  /** 企业版：上一次查重带进联系人那几格的值（人没动过的，再查一个号时跟着换）；开关关着没有这格 */
  带过?: Partial<联系人三格>;
  /** 渠道：企业版新建线索必选（老草稿里没有） */
  客户: { name: string; school: string; remark: string; 渠道?: string };
  /** 分配方式：企业版才有（默认五项的序号，0 指定 / 1 自动 / 2 公海捞取 / 3 暂不分配 / 4 个人自持）；老草稿里没有 */
  /** 渠道 = 项目来源（企业版，迁移 077）：没另选（空）= 跟客户的渠道；老草稿里没有 */
  /** 业务线（企业版，11-01 A1）：内贸 / 外贸 / 暂不分配，企业版必填；老草稿里没有 = 没填 */
  /** 所在地（企业版，11-02，选填）：项目自己的四格 + 详细地址；业务线手选 = 人动过业务线下拉，所在地的建议就不再覆盖（只在界面用，不交） */
  项目: {
    name: string; ownerId: string; amount: number | null; currency: string; remark: string; 分配方式?: number; 渠道?: string | null; 业务线?: string | null;
    所在地?: 客户地址 & { location?: string | null }; 业务线手选?: boolean;
  };
  /** 下一步时间（YYYY-MM-DD）：开了超时回收时才有这格、必填；老草稿里没有这格 */
  /** 节点、明确回复：企业版首条沟通必选（跟进节点 = 项目落在线索阶段哪一步）；团队版没有 */
  跟进: { type: string; method?: string | null; content: string; occurredAt: string; 下一步时间?: string | null; 节点?: string; 明确回复?: boolean | null };
};

/** 企业版新建线索（10-26）：负责人、渠道必选；只留联系方式、首次沟通记录、跟进节点、客户是否明确回复这几格预设 */
/** 分配方式们：这个人能用、还启用着的分配方式（10-27 A7：五种都生效，只有「指定分配」要选负责人） */
/** 默认分配方式：按业务角色（11-01 会议 §1 / §3：市场 → 自动分配，销售 → 个人自持，其他 → 暂不分配）；是销售：选自动分配要再确认（A9） */
export type 企业建档 = { 渠道们: 可选渠道[]; 节点们: readonly string[]; 分配方式们: { i: number; 名: string }[]; 默认分配方式?: number | null; 是销售?: boolean } | null;
/** 向导要的服务端数据（wizard-data.ts 建档向导数据）：页面和弹窗共用 */
export type 建档数据 = { users: 可选成员[]; 要下一步: boolean; 企业: 企业建档 };
/** 弹窗里摆向导（U-新建-01，10-31 会议）：不摆页头，「存草稿离开」改成关弹窗，建好了先关再跳 */
type 弹窗模式 = { 关: () => void } | null;

/** 企业版：这次要不要选负责人。只有「指定分配」要；没有可选的分配方式（老配置）照旧选负责人 */
const 要选负责人 = (d: 稿, 企业: 企业建档) => !!企业 && (!企业.分配方式们.length || d.项目.分配方式 === 0);
const 分配说明: Record<number, string> = {
  1: "建好后按业务线自动分给那条线正常参与的销售；业务线选了暂不分配或没人可分 = 留在新线索待分配",
  2: "建好后放进项目公海，等人捞取",
  3: "建好后留在新线索待分配，等市场管理、销售管理或总管理员分",
  4: "记在你名下，自己跟进",
};

function 空稿(ownerId: string, currency: string, 首类型: string): 稿 {
  return {
    phone: "",
    联系人: { name: "", position: "", phone: "", email: "", wechat: "" },
    客户: { name: "", school: "", remark: "" },
    项目: { name: "", ownerId, amount: null, currency, remark: "" },
    跟进: { type: 首类型, content: "", occurredAt: dayjs().format(时间格式) },
  };
}

/** 每一步往下走之前要填好的；返回一句人话，空串 = 能走 */
/** 企业版查重认的是「类型 + 号码」：换了类型要重查 */
const 查过键 = (d: 稿, 企: boolean) => (企 ? `${d.号码类型 ?? ""}|${d.phone.trim()}` : d.phone.trim());

function 这步还差(步: number, d: 稿, 已查: string | null, 要下一步: boolean, 企业: 企业建档 = null): string {
  const 企 = !!企业;
  if (步 === 0 && 企) return !d.号码类型 ? "请选择号码类型" : !d.phone.trim() ? "先填号码再查" : 已查 !== 查过键(d, 企) ? "点「查重」看看这个号码有没有人录过" : "";
  if (步 === 0) return !d.phone.trim() ? "先填电话再查" : 已查 !== d.phone.trim() ? "点「查重」看看这个号码有没有人录过" : "";
  // 企业版：「未知」「待定」「暂未确认」这类占位不算填了（11-03 A2-2，服务端同一句）
  if (步 === 1) return !d.联系人.name.trim() ? "请填写联系人姓名" : 企 && 是占位值(d.联系人.name) ? 占位名提示("联系人姓名") : "";
  if (步 === 2) return !d.客户.name.trim() ? "请填写名称" : 企 && 是占位值(d.客户.name) ? 占位名提示("客户名称") : 企业 && !d.客户.渠道 ? "请选渠道" : "";
  if (步 === 3) return !d.项目.name.trim() ? "请填写项目名称" : 企 && 是占位值(d.项目.name) ? 占位名提示("项目名称") : d.项目.name.trim().length > 项目名上限 ? `项目名称请控制在 ${项目名上限} 字以内` : 企业 && 企业.分配方式们.length && d.项目.分配方式 === undefined ? "请选分配方式" : 企业 && !d.项目.业务线 ? 业务线必填 : 要选负责人(d, 企业) && !d.项目.ownerId ? "请选项目负责人" : "";
  if (!d.跟进.content.trim()) return "请填写这次沟通的内容";
  if (企业) {
    if (!d.跟进.节点 || !企业.节点们.includes(d.跟进.节点)) return "请选当前进程（线索阶段的哪一步）";
    if (typeof d.跟进.明确回复 !== "boolean") return "请选：客户明确回复了吗";
    if (企业.节点们.indexOf(d.跟进.节点) > 企业.节点们.indexOf(有效线索节点) && !d.跟进.明确回复) return 缺有效沟通;
  }
  return 要下一步 && !d.跟进.下一步时间 ? "请填下一步时间：过了那天还没有新的沟通，项目会自动回到公海" : "";
}

/**
 * 建档向导（团队版项目模式 1a，2026-10-23）：查重 → 联系人 → 客户 → 项目 → 首条沟通。
 * 中途关掉不落库，填过的存在本机草稿里（一人一份），下次进来接着填；最后一步一笔建好，失败整笔不留
 */
export default function ProjectWizard({ users, 要下一步, 企业 = null, 新线索 = false, 弹窗 = null }: { users: 可选成员[]; 要下一步: boolean; 企业?: 企业建档; 新线索?: boolean; 弹窗?: 弹窗模式 }) {
  // 草稿在本机 localStorage 里，服务端渲染时读不到；挂上之后再按草稿起头，免得两边对不上
  const 挂上了 = useSyncExternalStore(不订阅, () => true, () => false);
  const 我 = useMe();
  const 全名 = 草稿全名(我?.id, 草稿键);
  if (!挂上了) return null;
  const 旧 = 读草稿(全名) as { 稿?: 稿; 步?: number } | null;
  return <WizardBody key={全名} users={users} 要下一步={要下一步} 企业={企业} 新线索={新线索} 弹窗={弹窗} 全名={全名} 旧={旧?.稿 && 有内容(旧.稿) ? { 稿: 旧.稿, 步: Number(旧.步) || 0 } : null} />;
}

const 不订阅 = () => () => {};

/**
 * 「新增客户」「新增项目」弹窗（U-新建-01，10-31 会议）：和 /projects/new 同一个向导、同一套查重（含联系人查重），只是摆在弹窗里。
 * 草稿照旧每改一格存本机，关了下次点开接着填
 */
export function 建档弹窗(props: { open: boolean; 标题: string; 数据: 建档数据; onClose: () => void }) {
  return <WizardModal {...props} />;
}

// 要用 hook（提示、当前用户），组件名得是大写英文开头（react-hooks 规则）
function WizardModal({ open, 标题, 数据, onClose }: { open: boolean; 标题: string; 数据: 建档数据; onClose: () => void }) {
  const { message } = App.useApp();
  const 我 = useMe();
  // 右上 X / Esc 关：和「存草稿关闭」一样说一句草稿留着（11-03 A1-3：直接关掉，人以为填的都没了）
  const 关 = () => {
    if (有内容((读草稿(草稿全名(我?.id, 草稿键)) as { 稿?: unknown } | null)?.稿)) message.info("草稿存在这台电脑的浏览器里，下次打开会接着填");
    onClose();
  };
  return (
    <Modal open={open} title={标题} footer={null} width={760} onCancel={关} destroyOnHidden mask={{ closable: false }}>
      <ProjectWizard users={数据.users} 要下一步={数据.要下一步} 企业={数据.企业} 弹窗={{ 关: onClose }} />
    </Modal>
  );
}

/**
 * 要下一步 = 企业版开了超时回收：首条沟通要填下一步时间（项目建在线索阶段）。
 * 能填下一步 = 企业版：没开超时回收也摆这一格、选填（10-26 验收 #4，向导里原来看不到下一步时间）
 * 企业版 = 第一步先选号码类型、按类型验格式、全公司查重（2026-10-26，customers/number-actions.ts）；关着第一步和原来一模一样
 */
function WizardBody({ users, 要下一步, 企业, 新线索, 弹窗, 全名, 旧 }: { users: 可选成员[]; 要下一步: boolean; 企业: 企业建档; 新线索: boolean; 弹窗: 弹窗模式; 全名: string; 旧: { 稿: 稿; 步: number } | null }) {
  const 企业版 = !!企业;
  const 能填下一步 = 企业版;
  const router = useRouter();
  const { message, modal } = App.useApp();
  const b = useBusiness();
  const 我 = useMe();
  const 能选类型 = 跟进类型们(外贸精简(b)).filter((t) => t.value !== "TASK" && t.value !== "REMIND");
  // 不在候选里的「我」（老板、管理员不做销售）默认还是记在我名下（服务端也这么填）：下拉里补上我自己，不然那一格露出内部编号
  const 负责人选项 = 我 && !users.some((u) => u.id === 我.id) ? [...成员选项(users), { value: 我.id, label: 我.name }] : 成员选项(users);
  // 企业版负责人不默认自己：必须选（10-26）；跟进节点默认线索第一步；号码类型默认手机号（最常见）
  const 新稿 = (): 稿 => {
    const n = 空稿(企业 ? "" : 默认负责人(我, users) ?? 我?.id ?? "", b.currency || 默认币种, 能选类型[0]?.value ?? "PHONE");
    // 分配方式按业务角色给默认值（服务端算好，能用的才给）；没给的、只有一种能用就直接选上
    const 默认 = 企业?.默认分配方式;
    const 分 = 默认 !== undefined && 默认 !== null && 企业?.分配方式们.some((x) => x.i === 默认) ? 默认 : 企业?.分配方式们.length === 1 ? 企业.分配方式们[0].i : undefined;
    return 企业 ? { ...n, 号码类型: "手机号", 项目: { ...n.项目, 分配方式: 分 }, 跟进: { ...n.跟进, 节点: 企业.节点们[0], 明确回复: null } } : n;
  };

  // 上次没填完的接着填
  const [步, set步] = useState(() => (旧 ? Math.min(Math.max(0, 旧.步), 步骤们.length - 1) : 0));
  const [d, setD] = useState<稿>(() => (旧 ? { ...新稿(), ...旧.稿 } : 新稿()));
  // 走过第一步的草稿，号码当已经查过（当时没撞）；这期间被别人录了，最后一步 saveCustomer 还会再拦一次
  const [已查, set已查] = useState<string | null>(() => (旧 && 旧.步 > 0 && 旧.稿.phone ? 查过键(旧.稿, 企业版) : null));
  const [撞, set撞] = useState<DuplicateHit>(null);
  // 企业版「查重」回来的那句（格式不对 / 首次录入 / 撞了哪种）
  const [企查, set企查] = useState<查号码结果 | null>(null);
  const [查中, set查中] = useState(false);
  const [交中, set交中] = useState(false);
  const [接着填, set接着填] = useState(!!旧);

  const 改 = <K extends keyof 稿>(k: K, v: Partial<稿[K]> | 稿[K]) => {
    setD((o) => {
      const n = { ...o, [k]: typeof v === "object" && v !== null ? { ...(o[k] as object), ...v } : v } as 稿;
      存草稿(全名, { 稿: n, 步 });
      return n;
    });
  };
  const 去 = (n: number) => {
    set步(n);
    存草稿(全名, { 稿: d, 步: n });
  };

  const 查重 = async () => {
    const 号 = d.phone.trim();
    if (!号) return;
    set查中(true);
    try {
      if (企业版) {
        if (!d.号码类型) return;
        const r = await 查号码(d.号码类型, 号);
        set企查(r);
        set已查(查过键(d, true));
        if (r.ok && r.状态 === "首次录入") {
          // 查过的号码顺手填进联系人那一格：空着的、或者还是上次查重带进去的（人没改过）换成这次的
          const 类型 = d.号码类型;
          setD((o) => {
            const t = 带进联系人(o.联系人, o.带过, 类型, r.值);
            const n = { ...o, 联系人: { ...o.联系人, ...t.改 }, 带过: t.带过 };
            存草稿(全名, { 稿: n, 步 });
            return n;
          });
        }
        return;
      }
      const hit = await checkDuplicate(号);
      set撞(hit);
      set已查(号);
      if (!hit && !d.联系人.phone) 改("联系人", { phone: 号 });
    } catch {
      message.error("查重没查成，请稍后再试");
    } finally {
      set查中(false);
    }
  };

  const 差 = 这步还差(步, d, 已查, 要下一步, 企业);
  const 企拦 = 企业版 && !!企查 && 已查 === 查过键(d, true) && !(企查.ok && 企查.状态 === "首次录入");
  const 拦着 = 步 === 0 && (!!撞 || 企拦);

  // 销售选自动分配：分出去后就看不到这个项目了，先确认一次（A9）
  const 点建好 = () => {
    if (企业?.是销售 && d.项目.分配方式 === 1) {
      modal.confirm({ title: "按自动分配建", content: 销售自动分确认, okText: "确定，分出去", cancelText: "再想想", onOk: () => void 提交() });
      return;
    }
    void 提交();
  };

  const 提交 = async () => {
    set交中(true);
    // 企业版不是「指定分配」的：先建在我名下（服务端也这么改），建好再按分配方式转走
    const 负责人 = 企业 && !要选负责人(d, 企业) ? 我?.id ?? "" : d.项目.ownerId;
    const { 渠道: 项目渠道, 业务线手选, ...项目稿 } = d.项目;
    try {
      const r = await 建档向导({
        客户: {
          // 企业版：选的不是手机号的，电话空着，号码按 企业号码 交（saveCustomer 按类型存、再查一次重）
          name: d.客户.name, phone: 企业版 && d.号码类型 !== "手机号" ? "" : d.phone,
          ...(企业版 ? { 企业号码: { 类型: d.号码类型 ?? "", 值: d.phone } } : {}),
          school: d.客户.school || null, grade: null, major: null,
          followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: d.客户.remark || null,
          // 客户也记在项目负责人名下：负责人打开项目时得看得到这位客户
          salesOwnerId: 负责人 || null, channelId: 企业 ? d.客户.渠道 || null : null, referrerCustomerId: null,
        },
        联系人: d.联系人,
        项目: {
          ...项目稿, amount: d.项目.amount ?? 0, ownerId: 负责人 || null, 分配方式: 企业 ? d.项目.分配方式 ?? null : undefined,
          // 业务线（11-01 清单 A1，手动选）：企业版总是传（没选 = null）；团队版不传
          业务线: 企业 ? d.项目.业务线 ?? null : undefined,
          // 项目来源：没另选就跟客户的渠道（服务端 项目来源默认 同一个规矩）；团队版不传
          ...(企业 ? { channelId: 项目渠道 || d.客户.渠道 || null } : {}),
        },
        跟进: 企业 ? { ...d.跟进, method: 对得上的方式(d.跟进.type, d.跟进.method) } : { type: d.跟进.type, content: d.跟进.content, occurredAt: d.跟进.occurredAt, 下一步时间: d.跟进.下一步时间 },
      });
      if (!r.ok && "同号协同" in r) {
        // 同号再次录入：没新建，记录已写进现有项目（查重之后才有人录同号时走到这）
        清草稿(全名);
        message.info(r.error);
        弹窗?.关();
        if (弹窗) router.refresh();
        else router.push(新线索 || 企业版 ? "/leads" : "/projects");
        return;
      }
      if (!r.ok) {
        message.error(r.error);
        return;
      }
      清草稿(全名);
      message.success(`已建好项目「${d.项目.name.trim()}」`);
      if ("提示" in r && r.提示) (r.转走 ? message.info : message.warning)(r.提示);
      弹窗?.关();
      // 分走了 / 进了公海，项目不在我名下：回线索列表（弹窗里建的：留在原页刷新）
      if (弹窗 && "转走" in r && r.转走) router.refresh();
      else router.push("转走" in r && r.转走 ? (新线索 ? "/leads" : "/projects") : `/projects/${r.projectId}`);
    } catch {
      message.error("没建成，请稍后再试；填过的还在");
    } finally {
      set交中(false);
    }
  };

  // 草稿每改一格就存了（存草稿），这里只是走开并说清在哪找回
  const 离开 = () => {
    if (弹窗) {
      if (有内容(d)) message.info("草稿存在这台电脑的浏览器里，下次打开会接着填");
      return 弹窗.关();
    }
    if (有内容(d)) message.info(`草稿存在这台电脑的浏览器里，下次点「${新线索 || 企业版 ? "新线索" : "新建项目"}」会接着填`);
    router.push(新线索 || 企业版 ? "/leads" : "/projects");
  };

  const 重来 = () => {
    清草稿(全名);
    setD(新稿());
    set步(0);
    set已查(null);
    set撞(null);
    set企查(null);
    set接着填(false);
  };

  // 所在地给的业务线建议（11-02）：只提示，提交 = 人确认了
  const 线提示 = 企业 ? 所在地提示(建议业务线(d.项目.所在地), d.项目.业务线) : null;
  const 一行 = (label: string, el: React.ReactNode, 必填 = false) => (
    <label className="wiz-row" style={{ display: "block", marginBottom: 16 }}>
      <div style={{ marginBottom: 6, color: "var(--text-muted)" }}>{必填 && <span style={{ color: "var(--danger)" }}>* </span>}{label}</div>
      {el}
    </label>
  );

  return (
    <div style={{ maxWidth: 720 }}>
      {!弹窗 && (
        <PageHead
          title={新线索 || 企业版 ? "新线索" : "新建项目"}
          subtitle={新线索 || 企业版 ? "建好后是一个线索阶段的项目" : `一次建好${b.customer}、联系人、项目和第一次沟通；中途离开会存成草稿`}
        />
      )}
      {接着填 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="接着上次没填完的"
          action={<Button size="small" onClick={重来}>清空重来</Button>}
        />
      )}
      <Steps current={步} size="small" style={{ marginBottom: 企业 ? 8 : 24 }} items={步骤们.map((t) => ({ title: t }))} />
      {企业 && <div style={{ marginBottom: 24, color: "var(--text-muted)", fontSize: 12 }}>{/* 11-03 A2-5：勾了不会自动换进程，进程按「当前进程」选的落 */}项目建在「当前进程」选的那一步；要建在「{有效线索节点}」之后，首条沟通得选「客户明确回复了」。</div>}

      {步 === 0 && 企业版 && (
        <>
          {一行("联系方式", (
            <Space.Compact style={{ width: "100%" }}>
              <Select
                style={{ width: 150, flexShrink: 0 }}
                placeholder="号码类型"
                value={d.号码类型}
                options={向导能选类型.map((t) => ({ value: t, label: 号码类型叫法(t) }))}
                onChange={(v) => {
                  改("号码类型", v);
                  set企查(null);
                }}
              />
              <Input
                value={d.phone}
                placeholder="先查一下这个号码有没有人录过"
                onChange={(e) => {
                  改("phone", e.target.value);
                  set企查(null);
                }}
                onPressEnter={() => void 查重()}
              />
              <Button loading={查中} disabled={!d.号码类型} onClick={() => void 查重()}>查重</Button>
            </Space.Compact>
          ), true)}
          {企查 && 已查 === 查过键(d, true) && (
            企查.ok && 企查.状态 === "首次录入" ? <Alert type="success" showIcon title={去符号(企查.提示)} description={企查.归属地 ? `归属地：${企查.归属地}` : undefined} />
            : !企查.ok ? <Alert type="warning" showIcon title={去符号(企查.提示)} />
            : <撞号面板 查={企查} users={users} 协同={企查.可协同 ? <SameNumberEntry 类型={d.号码类型} 值={企查.值} 渠道们={企业?.渠道们 ?? []} 默认渠道={d.客户.渠道 || null} 情况={企查.协同} /> : null} />
          )}
        </>
      )}

      {步 === 0 && !企业版 && (
        <>
          {一行(`${b.customer}电话`, (
            <Space.Compact style={{ width: "100%" }}>
              <Input
                value={d.phone}
                placeholder="先查一下这个号码有没有人录过"
                onChange={(e) => {
                  改("phone", e.target.value);
                  set撞(null);
                }}
                onPressEnter={() => void 查重()}
              />
              <Button loading={查中} onClick={() => void 查重()}>查重</Button>
            </Space.Compact>
          ), true)}
          {撞 && (
            <Alert
              type="error"
              showIcon
              title={`已有${b.customer}用这个号码，不能重复建档`}
              description={
                撞.id ? (
                  <span>
                    <Link href={`/customers/${撞.id}`}>{撞.name}</Link>
                    {撞.school ? ` · ${撞.school}` : ""} · 在 {撞.salesOwnerName} 名下。要给这位{b.customer}开新项目，请找 {撞.salesOwnerName} 或老板
                  </span>
                ) : (
                  <span>同事 {撞.salesOwnerName} 名下已经有这个号码{撞.name ? `（${撞.name}）` : ""}；要接手请找 {撞.salesOwnerName} 或老板</span>
                )
              }
            />
          )}
          {!撞 && 已查 === d.phone.trim() && d.phone.trim() && <Alert type="success" showIcon title="没人录过这个号码，可以往下走" />}
        </>
      )}

      {步 === 1 && (
        <>
          {一行("联系人姓名", <Input value={d.联系人.name} onChange={(e) => 改("联系人", { name: e.target.value })} />, true)}
          {!企业 && 一行("职位", <Input value={d.联系人.position} onChange={(e) => 改("联系人", { position: e.target.value })} />)}
          {一行("联系人电话", <Input value={d.联系人.phone} onChange={(e) => 改("联系人", { phone: e.target.value })} />)}
          {!企业 && 一行("邮箱", <Input value={d.联系人.email} onChange={(e) => 改("联系人", { email: e.target.value })} />)}
          {!企业 && 一行("微信", <Input value={d.联系人.wechat} onChange={(e) => 改("联系人", { wechat: e.target.value })} />)}
        </>
      )}

      {步 === 2 && (
        <>
          {一行(`${b.customer}名称`, <Input value={d.客户.name} onChange={(e) => 改("客户", { name: e.target.value })} />, true)}
          {企业 && 一行("渠道", (
            <>
              {/* P16：先选渠道名称再选具体来源（一个级联到底），选了来源渠道就定了；也能直接打字搜全称 */}
              <ChannelPicker
                aria-label="渠道"
                层级="两级"
                channels={企业.渠道们}
                value={d.客户.渠道 || null}
                allowClear={false}
                placeholder="这条线索从哪个渠道、哪个来源来"
                onChange={(v) => 改("客户", { 渠道: v ?? undefined })}
              />
              {企业.渠道们.length === 0 && <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>还没有渠道：先去 <Link href="/channels">渠道页</Link> 加一个</div>}
            </>
          ), true)}
          {!企业 && 一行(b.fields.school, <Input value={d.客户.school} onChange={(e) => 改("客户", { school: e.target.value })} />)}
          {!企业 && 一行("备注", <Input.TextArea rows={3} value={d.客户.remark} onChange={(e) => 改("客户", { remark: e.target.value })} />)}
        </>
      )}

      {步 === 3 && (
        <>
          {一行("项目名称", <Input value={d.项目.name} maxLength={项目名上限} showCount onChange={(e) => 改("项目", { name: e.target.value })} />, true)}
          {/* 项目来源（迁移 077）：默认带上一步客户的渠道；老客户这一单从别的渠道来就在这改。清掉 = 回到跟客户 */}
          {企业 && 一行("渠道", (
            <>
              <ChannelPicker
                aria-label="渠道"
                层级="两级"
                style={{ width: "100%" }}
                channels={企业.渠道们}
                value={d.项目.渠道 || d.客户.渠道 || null}
                allowClear={!!d.项目.渠道 && d.项目.渠道 !== d.客户.渠道}
                placeholder="这个项目从哪个渠道来"
                onChange={(v) => 改("项目", { 渠道: v === d.客户.渠道 ? null : v })}
              />
              <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>
                {d.项目.渠道 && d.项目.渠道 !== d.客户.渠道 ? "和客户的渠道不同：渠道统计里这个项目算在这里" : "默认跟客户的渠道；这一单从别的渠道来就改"}
              </div>
            </>
          ))}
          {企业 && 企业.分配方式们.length > 0 && 一行("分配方式", (
            <>
              <Select
                style={{ width: "100%" }}
                aria-label="分配方式"
                value={d.项目.分配方式}
                placeholder="选分配方式"
                options={企业.分配方式们.map((x) => ({ value: x.i, label: x.名 }))}
                onChange={(v) => 改("项目", { 分配方式: v })}
              />
              {d.项目.分配方式 !== undefined && 分配说明[d.项目.分配方式] && <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>{分配说明[d.项目.分配方式]}</div>}
            </>
          ), true)}
          {/* 项目所在地（11-02，选填）：项目自己的，不是客户地址；填了按所在地建议业务线（没手动选过就预填，人确认） */}
          {企业 && 一行("项目所在地", (
            <AddressInput
              value={d.项目.所在地 ?? 空地址}
              onChange={(a) => {
                const 预填 = 所在地预填(建议业务线(a), d.项目.业务线, !!d.项目.业务线手选);
                改("项目", { 所在地: { ...a, location: d.项目.所在地?.location ?? null }, ...(预填 ? { 业务线: 预填 } : {}) });
              }}
            />
          ))}
          {企业 && 一行("详细地址", (
            <Input
              aria-label="详细地址"
              placeholder={详细地址提示}
              maxLength={详细地址上限}
              value={d.项目.所在地?.location ?? ""}
              onChange={(e) => 改("项目", { 所在地: { ...(d.项目.所在地 ?? 空地址), location: e.target.value } })}
            />
          ))}
          {企业 && 一行("业务线", (
            <>
              <Select
                style={{ width: "100%" }}
                aria-label="业务线"
                data-testid="wizard-bizline"
                value={d.项目.业务线 || undefined}
                placeholder="内贸 / 外贸 / 暂不分配"
                options={三种业务线.map((x) => ({ value: x, label: x }))}
                onChange={(v) => 改("项目", { 业务线: v ?? null, 业务线手选: true })}
              />
              {线提示 && <div data-testid="wizard-bizline-hint" style={{ marginTop: 4, fontSize: 12, color: 线提示.同 ? "var(--text-muted)" : "var(--warning-text)" }}>{线提示.话}</div>}
              <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>
                自动分配只分给这条线的销售；暂不分配 = 不自动分，留在新线索等人指派。客户没另选时也记成这条线
              </div>
            </>
          ), true)}
          {(企业 ? 要选负责人(d, 企业) : !独自一人(users, d.项目.ownerId)) && 一行("负责人", (
            <Select style={{ width: "100%" }} value={d.项目.ownerId || undefined} placeholder="选项目负责人" options={负责人选项} onChange={(v) => 改("项目", { ownerId: v })} />
          ), !!企业)}
          {!企业 && 一行("金额", (
            <Space.Compact style={{ width: "100%" }}>
              <Select style={{ width: 140 }} value={d.项目.currency} options={币种选项()} onChange={(v) => 改("项目", { currency: v })} showSearch optionFilterProp="label" />
              <InputNumber<number>
                style={{ width: "100%" }}
                min={0}
                value={d.项目.amount}
                formatter={金额格式}
                onChange={(v) => 改("项目", { amount: v })}
              />
            </Space.Compact>
          ))}
          {!企业 && 一行("备注", <Input.TextArea rows={3} maxLength={备注上限} value={d.项目.remark} onChange={(e) => 改("项目", { remark: e.target.value })} />)}
        </>
      )}

      {步 === 4 && (
        <>
          {一行("沟通方式", (
            <FollowMethodSelect style={{ width: "100%" }} aria-label="沟通方式" type={d.跟进.type} method={d.跟进.method} 类型们={能选类型} onChange={(v) => 改("跟进", v)} />
          ), true)}
          {一行("时间", (
            <DatePicker
              showTime={{ format: "HH:mm" }}
              format={时间格式}
              allowClear={false}
              style={{ width: "100%" }}
              value={dayjs(d.跟进.occurredAt, 时间格式)}
              disabledDate={(x) => x.isAfter(dayjs(), "day")}
              onChange={(v) => v && 改("跟进", { occurredAt: v.format(时间格式) })}
            />
          ), true)}
          {一行("沟通内容", <Input.TextArea rows={4} value={d.跟进.content} onChange={(e) => 改("跟进", { content: e.target.value })} />, true)}
          {企业 && 一行("当前进程", (
            <Select style={{ width: "100%" }} value={d.跟进.节点} options={企业.节点们.map((n) => ({ value: n, label: n }))} onChange={(v) => 改("跟进", { 节点: v })} />
          ), true)}
          {企业 && 一行("客户明确回复了吗", (
            <Radio.Group value={d.跟进.明确回复 ?? undefined} onChange={(e) => 改("跟进", { 明确回复: e.target.value as boolean })}>
              <Radio value={true}>客户明确回复了</Radio>
              <Radio value={false}>没有明确回复</Radio>
            </Radio.Group>
          ), true)}
          {(要下一步 || 能填下一步) && 一行("下一步时间", (
            <>
              <DatePicker
                style={{ width: "100%" }}
                value={d.跟进.下一步时间 ? dayjs(d.跟进.下一步时间) : null}
                disabledDate={(x) => x.isBefore(dayjs(), "day")}
                onChange={(v) => 改("跟进", { 下一步时间: v ? v.format("YYYY-MM-DD") : null })}
                placeholder="选一天"
              />
              <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>{要下一步 ? "过了那天还没有新的沟通，或在当前这步停满规定天数，项目都会自动回到公海，哪个先到按哪个" : "选填：打算哪天再沟通，项目上会显示"}</div>
            </>
          ), 要下一步)}
        </>
      )}

      <Space style={{ marginTop: 8 }}>
        {步 > 0 && <Button onClick={() => 去(步 - 1)}>上一步</Button>}
        {步 < 步骤们.length - 1 ? (
          <Button type="primary" disabled={!!差 || 拦着} title={差 || undefined} onClick={() => 去(步 + 1)}>下一步</Button>
        ) : (
          <Button type="primary" disabled={!!差} title={差 || undefined} loading={交中} onClick={点建好}>建好项目</Button>
        )}
        <Button onClick={离开}>{弹窗 ? "存草稿关闭" : "存草稿离开"}</Button>
      </Space>
      {差 && !拦着 && <div style={{ marginTop: 8, color: "var(--text-muted)" }}>{差}</div>}
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
function 撞号面板({ 查, users, 协同 }: { 查: Extract<查号码结果, { ok: true }>; users: 可选成员[]; 协同?: React.ReactNode }) {
  const 撞 = 查.撞;
  const 在公海 = 查.状态 === "公海待捞";
  // 自己退回公海的：企业版原负责人看不到也领不回，「打开它」「去领取」都走不通，不摆（11-03 B7-3）
  const 我退的 = 在公海 && !!查.原负责人是我;
  const 负责人 = 撞?.salesOwnerName ?? "";
  // 同名同事不止一位时不猜是谁，只写名字。
  // 企业版登录名放在 email 列里、多半不是邮箱（11-03 A2-6）：像邮箱的才给 mailto，不然只写名字
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
            {在公海 ? "在公海" : 查.状态 === "我的通讯录已有" ? "在你名下" : `负责人：${负责人}`}
            {查.归属地 ? ` · 归属地：${查.归属地}` : ""}
          </div>
          <Space size={8} style={{ marginTop: 8 }} wrap>
            {撞?.id && !我退的 && <Link href={`/customers/${撞.id}`}><Button size="small">打开它</Button></Link>}
            {我退的 && <span style={{ color: "var(--text-muted)" }}>是你退回公海的，{原负责人不能领回提示}</span>}
            {在公海 && !我退的 && <Link href={撞?.name ? `/pool?keyword=${encodeURIComponent(撞.name)}` : "/pool"}><Button size="small">去领取</Button></Link>}
            {查.状态 === "重复" && 负责人 && (邮箱
              ? <Button size="small" href={`mailto:${邮箱}`}>联系负责人：{负责人}</Button>
              : <span style={{ color: "var(--text-muted)" }}>联系负责人：{负责人}</span>)}
          </Space>
          {协同}
        </div>
      }
    />
  );
}

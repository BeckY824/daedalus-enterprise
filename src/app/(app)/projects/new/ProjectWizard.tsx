"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { App, Alert, Button, Input, InputNumber, Radio, Select, Space, Steps } from "antd";
import DatePicker from "@/components/BusinessDatePicker";
import { PageHead } from "@/components/ui";
import { useBusiness } from "@/lib/business-client";
import { useMe, 默认负责人 } from "@/lib/me-client";
import { 草稿全名, 读草稿, 存草稿, 清草稿, 有内容 } from "@/lib/form-guard";
import { 跟进类型们 } from "@/lib/constants";
import { 币种选项, 默认币种 } from "@/lib/currency";
import { 金额格式 } from "@/lib/money-input";
import { 成员选项, 独自一人, dayjs, type 可选成员 } from "@/lib/utils";
import { 外贸精简 } from "@/lib/business-config";
import { 项目名上限, 备注上限 } from "@/lib/project/wizard";
import { 有效线索节点, 缺有效沟通 } from "@/lib/project/stage-gates";
import { checkDuplicate, type DuplicateHit } from "../../customers/actions";
import { 查号码, type 查号码结果 } from "../../customers/number-actions";
import { 向导能选类型, 带进联系人, 号码类型叫法, type 联系人三格 } from "@/lib/enterprise/contact-format";
import ChannelPicker, { type 可选渠道 } from "@/components/ChannelPicker";
import { 建档向导 } from "../actions";

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
  /** 分配方式：企业版才有（默认五项的序号，0 指定 / 1 自动 / 2 公海捞取 / 3 暂不分配 / 4 自拓自持）；老草稿里没有 */
  /** 渠道 = 项目来源（企业版，迁移 077）：没另选（空）= 跟客户的渠道；老草稿里没有 */
  项目: { name: string; ownerId: string; amount: number | null; currency: string; remark: string; 分配方式?: number; 渠道?: string | null };
  /** 下一步时间（YYYY-MM-DD）：开了超时回收时才有这格、必填；老草稿里没有这格 */
  /** 节点、明确回复：企业版首条沟通必选（跟进节点 = 项目落在线索阶段哪一步）；团队版没有 */
  跟进: { type: string; content: string; occurredAt: string; 下一步时间?: string | null; 节点?: string; 明确回复?: boolean | null };
};

/** 企业版新建线索（10-26）：负责人、渠道必选；只留联系方式、首次沟通记录、跟进节点、客户是否明确回复这几格预设 */
/** 分配方式们：这个人能用、还启用着的分配方式（10-27 A7：五种都生效，只有「指定分配」要选负责人） */
export type 企业建档 = { 渠道们: 可选渠道[]; 节点们: readonly string[]; 分配方式们: { i: number; 名: string }[] } | null;

/** 企业版：这次要不要选负责人。只有「指定分配」要；没有可选的分配方式（老配置）照旧选负责人 */
const 要选负责人 = (d: 稿, 企业: 企业建档) => !!企业 && (!企业.分配方式们.length || d.项目.分配方式 === 0);
const 分配说明: Record<number, string> = {
  1: "建好后按自动分配规则分给销售，项目不在你名下",
  2: "建好后放进项目公海，等人捞取",
  3: "先记在你名下，之后再分配",
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
  if (步 === 0 && 企) return !d.号码类型 ? "🔀请选择号码类型" : !d.phone.trim() ? "先填号码再查" : 已查 !== 查过键(d, 企) ? "点「查重」看看这个号码有没有人录过" : "";
  if (步 === 0) return !d.phone.trim() ? "先填电话再查" : 已查 !== d.phone.trim() ? "点「查重」看看这个号码有没有人录过" : "";
  if (步 === 1) return d.联系人.name.trim() ? "" : "请填写联系人姓名";
  if (步 === 2) return !d.客户.name.trim() ? "请填写名称" : 企业 && !d.客户.渠道 ? "请选渠道" : "";
  if (步 === 3) return !d.项目.name.trim() ? "请填写项目名称" : d.项目.name.trim().length > 项目名上限 ? `项目名称请控制在 ${项目名上限} 字以内` : 企业 && 企业.分配方式们.length && d.项目.分配方式 === undefined ? "请选分配方式" : 要选负责人(d, 企业) && !d.项目.ownerId ? "请选项目负责人" : "";
  if (!d.跟进.content.trim()) return "请填写这次沟通的内容";
  if (企业) {
    if (!d.跟进.节点 || !企业.节点们.includes(d.跟进.节点)) return "请选当前进程（线索阶段的哪一步）";
    if (typeof d.跟进.明确回复 !== "boolean") return "请选客户是否明确回复";
    if (企业.节点们.indexOf(d.跟进.节点) > 企业.节点们.indexOf(有效线索节点) && !d.跟进.明确回复) return 缺有效沟通;
  }
  return 要下一步 && !d.跟进.下一步时间 ? "请填下一步时间：到那天还没跟进，项目会自动回到项目公海" : "";
}

/**
 * 建档向导（团队版项目模式 1a，2026-10-23）：查重 → 联系人 → 客户 → 项目 → 首条沟通。
 * 中途关掉不落库，填过的存在本机草稿里（一人一份），下次进来接着填；最后一步一笔建好，失败整笔不留
 */
export default function ProjectWizard({ users, 要下一步, 企业 = null, 新线索 = false }: { users: 可选成员[]; 要下一步: boolean; 企业?: 企业建档; 新线索?: boolean }) {
  // 草稿在本机 localStorage 里，服务端渲染时读不到；挂上之后再按草稿起头，免得两边对不上
  const 挂上了 = useSyncExternalStore(不订阅, () => true, () => false);
  const 我 = useMe();
  const 全名 = 草稿全名(我?.id, 草稿键);
  if (!挂上了) return null;
  const 旧 = 读草稿(全名) as { 稿?: 稿; 步?: number } | null;
  return <WizardBody key={全名} users={users} 要下一步={要下一步} 企业={企业} 新线索={新线索} 全名={全名} 旧={旧?.稿 && 有内容(旧.稿) ? { 稿: 旧.稿, 步: Number(旧.步) || 0 } : null} />;
}

const 不订阅 = () => () => {};

/**
 * 要下一步 = 企业版开了超时回收：首条沟通要填下一步时间（项目建在线索阶段）。
 * 能填下一步 = 企业版：没开超时回收也摆这一格、选填（10-26 验收 #4，向导里原来看不到下一步时间）
 * 企业版 = 第一步先选号码类型、按类型验格式、全公司查重（2026-10-26，customers/number-actions.ts）；关着第一步和原来一模一样
 */
function WizardBody({ users, 要下一步, 企业, 新线索, 全名, 旧 }: { users: 可选成员[]; 要下一步: boolean; 企业: 企业建档; 新线索: boolean; 全名: string; 旧: { 稿: 稿; 步: number } | null }) {
  const 企业版 = !!企业;
  const 能填下一步 = 企业版;
  const router = useRouter();
  const { message } = App.useApp();
  const b = useBusiness();
  const 我 = useMe();
  const 能选类型 = 跟进类型们(外贸精简(b)).filter((t) => t.value !== "TASK" && t.value !== "REMIND");
  // 不在候选里的「我」（老板、管理员不做销售）默认还是记在我名下（服务端也这么填）：下拉里补上我自己，不然那一格露出内部编号
  const 负责人选项 = 我 && !users.some((u) => u.id === 我.id) ? [...成员选项(users), { value: 我.id, label: 我.name }] : 成员选项(users);
  // 企业版负责人不默认自己：必须选（10-26）；跟进节点默认线索第一步；号码类型默认手机号（最常见）
  const 新稿 = (): 稿 => {
    const n = 空稿(企业 ? "" : 默认负责人(我, users) ?? 我?.id ?? "", b.currency || 默认币种, 能选类型[0]?.value ?? "PHONE");
    // 分配方式只有一种能用就直接选上
    const 分 = 企业?.分配方式们.length === 1 ? 企业.分配方式们[0].i : undefined;
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

  const 提交 = async () => {
    set交中(true);
    // 企业版不是「指定分配」的：先建在我名下（服务端也这么改），建好再按分配方式转走
    const 负责人 = 企业 && !要选负责人(d, 企业) ? 我?.id ?? "" : d.项目.ownerId;
    const { 渠道: 项目渠道, ...项目稿 } = d.项目;
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
          // 项目来源：没另选就跟客户的渠道（服务端 项目来源默认 同一个规矩）；团队版不传
          ...(企业 ? { channelId: 项目渠道 || d.客户.渠道 || null } : {}),
        },
        跟进: 企业 ? d.跟进 : { type: d.跟进.type, content: d.跟进.content, occurredAt: d.跟进.occurredAt, 下一步时间: d.跟进.下一步时间 },
      });
      if (!r.ok) {
        message.error(r.error);
        return;
      }
      清草稿(全名);
      message.success(`已建好项目「${d.项目.name.trim()}」`);
      if ("提示" in r && r.提示) (r.转走 ? message.info : message.warning)(r.提示);
      // 分走了 / 进了公海，项目不在我名下：回线索列表
      router.push("转走" in r && r.转走 ? (新线索 ? "/leads" : "/projects") : `/projects/${r.projectId}`);
    } catch {
      message.error("没建成，请稍后再试；填过的还在");
    } finally {
      set交中(false);
    }
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

  const 一行 = (label: string, el: React.ReactNode, 必填 = false) => (
    <label className="wiz-row" style={{ display: "block", marginBottom: 16 }}>
      <div style={{ marginBottom: 6, color: "var(--text-muted)" }}>{必填 && <span style={{ color: "var(--danger)" }}>* </span>}{label}</div>
      {el}
    </label>
  );

  return (
    <div style={{ maxWidth: 720 }}>
      <PageHead title={新线索 ? "新建新线索" : "新建项目"} subtitle={`一次建好${b.customer}、联系人、项目和第一次沟通；中途离开会存成草稿`} />
      {接着填 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="接着上次没填完的"
          action={<Button size="small" onClick={重来}>清空重来</Button>}
        />
      )}
      <Steps current={步} size="small" style={{ marginBottom: 24 }} items={步骤们.map((t) => ({ title: t }))} />

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
            企查.ok && 企查.状态 === "首次录入" ? <Alert type="success" showIcon title={企查.提示} description={企查.归属地 ? `归属地：${企查.归属地}` : undefined} />
            : !企查.ok ? <Alert type="warning" showIcon title={企查.提示} />
            : (
              <Alert
                type="error"
                showIcon
                title={企查.提示}
                description={企查.撞?.id || 企查.归属地 ? (
                  <span>
                    {企查.撞?.id && <><Link href={`/customers/${企查.撞.id}`}>{企查.撞.name}</Link>{企查.撞.school ? ` · ${企查.撞.school}` : ""} · 在 {企查.撞.salesOwnerName} 名下</>}
                    {企查.撞?.id && 企查.归属地 ? " · " : ""}
                    {企查.归属地 ? `归属地：${企查.归属地}` : ""}
                  </span>
                ) : undefined}
              />
            )
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
          {企业 && 一行("项目来源", (
            <>
              <ChannelPicker
                aria-label="项目来源"
                层级="两级"
                style={{ width: "100%" }}
                channels={企业.渠道们}
                value={d.项目.渠道 || d.客户.渠道 || null}
                allowClear={!!d.项目.渠道 && d.项目.渠道 !== d.客户.渠道}
                placeholder="这个项目从哪个渠道来"
                onChange={(v) => 改("项目", { 渠道: v === d.客户.渠道 ? null : v })}
              />
              <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>
                {d.项目.渠道 && d.项目.渠道 !== d.客户.渠道 ? "和客户来源不同：渠道统计里这个项目算在这里" : "默认跟客户的渠道；这一单从别的渠道来就改"}
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
            <Select style={{ width: "100%" }} value={d.跟进.type} options={能选类型.map((t) => ({ value: t.value, label: t.label }))} onChange={(v) => 改("跟进", { type: v })} />
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
          {企业 && 一行("客户是否明确回复", (
            <Radio.Group value={d.跟进.明确回复 ?? undefined} onChange={(e) => 改("跟进", { 明确回复: e.target.value as boolean })}>
              <Radio value={true}>明确回复了</Radio>
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
              <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>{要下一步 ? "到那天还没人跟进，项目会自动回到项目公海" : "选填：打算哪天再跟进，项目上会显示"}</div>
            </>
          ), 要下一步)}
        </>
      )}

      <Space style={{ marginTop: 8 }}>
        {步 > 0 && <Button onClick={() => 去(步 - 1)}>上一步</Button>}
        {步 < 步骤们.length - 1 ? (
          <Button type="primary" disabled={!!差 || 拦着} title={差 || undefined} onClick={() => 去(步 + 1)}>下一步</Button>
        ) : (
          <Button type="primary" disabled={!!差} title={差 || undefined} loading={交中} onClick={() => void 提交()}>建好项目</Button>
        )}
        <Button type="text" onClick={() => router.push("/projects")}>先不建了</Button>
      </Space>
      {差 && !拦着 && <div style={{ marginTop: 8, color: "var(--text-muted)" }}>{差}</div>}
    </div>
  );
}

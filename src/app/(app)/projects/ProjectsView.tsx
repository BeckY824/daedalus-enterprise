"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useHoverPrefetch } from "@/lib/prefetch-full";
import Link from "next/link";
import { App, Button, Dropdown, Modal, Select, Space, Segmented, Tag, type SelectProps } from "antd";
import { CloseOutlined, DownOutlined, PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { PageHead, CustomerLink, UserCell } from "@/components/ui";
import DataList, { type 列 } from "@/components/DataList";
import ListSearch from "@/components/ListSearch";
import ResetFilters from "@/components/ResetFilters";
import { useBusiness } from "@/lib/business-client";
import { useLocalPref } from "@/lib/local-pref";
import { useUrlFilters } from "@/lib/url-filters";
import { 列表不问归属ID } from "@/lib/solo";
import { dayjs, fmtDate, 成员选项, type 可选成员 } from "@/lib/utils";
import { useMe, 默认负责人 as 我当负责人 } from "@/lib/me-client";
import CustomerSearchSelect from "@/components/CustomerSearchSelect";
import { 金额, 合计文字 } from "@/lib/currency";
import { 主题颜色 } from "@/lib/chart-theme";
import { categorical } from "@/lib/palette";
import { 认首页卡, 首页卡口径 } from "@/lib/project/home-cards";
import { 按预计成交排 } from "@/lib/project/project-fields";
import { 企业级别, 企业级别说明 } from "@/lib/enterprise/customer-v2";
import { 级别星 } from "@/lib/enterprise/level-stars";
import { 回公海文案 } from "@/lib/enterprise/recycle-text";
import { 看板显示列, type 项目行, type 看板一列 } from "@/lib/project/board";
import type { 看板列 } from "@/lib/project/nodes";
import type { 满额提醒 } from "@/lib/enterprise/lead-full-notice";
import { 字典of, 结局叫法, 阶段与进程, 阶段们, 是交付, type 阶段, type 阶段字典, type 出口叫法改动 } from "@/lib/project/stage-dict";
import InviteInbox, { type 邀请行 } from "./InviteInbox";
import VerifyInbox, { type 待复核行 } from "./VerifyInbox";
import { MyBlockersBoard, type 卡点卡 } from "./BlockerPanel";
import { 自动分配线索, 批量自动分配, type 自动分配结果 } from "../leads/assign-actions";
import { AssignLeadModal, AssignedOutButton } from "../leads/AssignLead";
import LeadFullNotices from "../leads/LeadFullNotices";
import NewProjectModal from "../customers/[id]/NewProjectModal";
import { 取客户近况 } from "../customers/[id]/pick";

/** 看板五列的颜色：三个阶段沿用商机管道的蓝绿黄，成功交付（企业版叫 交付结清）粉、没成灰 */
const 列色: Record<看板列, string> = {
  线索: 主题颜色(categorical.blue),
  商机: 主题颜色(categorical.green),
  订单: 主题颜色(categorical.yellow),
  成功交付: 主题颜色(categorical.pink),
  没成: "var(--line-strong)",
};

const 空列说法: Record<看板列, string> = {
  线索: "还没有在培育的线索",
  商机: "还没有在谈的商机",
  订单: "还没有在交付的订单",
  成功交付: "还没有交付完的项目",
  没成: "没有流失或丢掉的项目",
};

/** 异常的悬停说明：类别 + 备注 */
function 异常说明(r: 项目行) {
  return [r.exceptionCategory, r.exceptionReason].filter(Boolean).join("：") || undefined;
}

/** 进程那一格：有结局写结局（按字典的叫法，后台改了出口叫法就用改的），异常标红；阶段单独一列（P11），这里只写进程 */
function 节点文字(r: 项目行, 字典: 阶段字典) {
  if (r.result === "异常状态") return <Tag color="error" title={异常说明(r)}>异常 · {r.exceptionCategory ?? r.node}</Tag>;
  if (r.result) return <Tag>{结局叫法(r.result, 字典)}</Tag>;
  const 进程 = 阶段与进程(r, 字典).进程;
  return <span className="clamp" title={进程}>{进程}</span>;
}

/**
 * 项目页（团队版项目模式 1a）：列表和看板两种看法，同一批行、同一组筛选。
 * 看板列头写项目数和按币种分开的金额合计；异常状态的项目留在订单列、左边框标红。
 *
 * 阶段 = "线索"：企业版「新线索」页（/leads）。只列线索阶段的项目、只有列表，
 * 新建照样走项目向导（落在潜客培育）；转商机之后它就只在「项目」页里了（10-26 用户定的三大阶段）。
 */
export default function ProjectsView({
  行, 列: 看板, 取到上限, users, filters, 企业版 = false, 出口叫法, 要下一步 = false, 邀请们 = [], 待复核们 = [], 卡点们 = [], 阶段, 线索分配开着 = false, 能自动分配 = false, 满额提醒: 提醒们 = [],
}: {
  行: 项目行[];
  列: 看板一列[];
  取到上限: boolean;
  users: 可选成员[];
  /** f：企业版首页指标卡点进来的筛选（lib/project/home-cards.ts），页头标出来、能清掉 */
  filters: { keyword: string; ownerId: string; pool: string; recycled: string; f: string; phase: string; node: string };
  /** 服务端的 企业版()：结局叫法跟着字典 */
  企业版?: boolean;
  /** 企业版组织规则里改过的出口叫法 */
  出口叫法?: 出口叫法改动;
  /** 企业版开了超时回收：「给老客户开项目」的首条沟通要填下一步时间 */
  要下一步?: boolean;
  /** 企业版：等我回的项目组邀请（别的版本是空的） */
  邀请们?: 邀请行[];
  /** 企业版线索验证：等我复核 / 终验 / 认领的线索（别的版本是空的） */
  待复核们?: 待复核行[];
  /** 企业版：「我的卡点」看板（指给我的、我项目上等人认领的；别的版本是空的） */
  卡点们?: 卡点卡[];
  /** 企业版「新线索」页：只看线索阶段 */
  阶段?: "线索";
  /** 企业版「线索分配和配额」开着：页头摆「我分出去的」 */
  线索分配开着?: boolean;
  /** 我能分配（老板、总管理员、市场管理）：每行「分配」「自动分配」、勾选后批量自动分配；服务端还会再查一遍 */
  能自动分配?: boolean;
  /** 自动分配因都已满额没分出去的提醒 */
  满额提醒?: 满额提醒[];
}) {
  const router = useRouter();
  const 预取 = useHoverPrefetch();
  const { message, modal } = App.useApp();
  const 字典 = 字典of(企业版, 出口叫法);
  // 看板列的 key 两套都叫「成功交付」，列头写这套的叫法（企业版 交付结清）
  const 列名 = (列: 看板列) => (列 === "成功交付" ? 结局叫法(字典.出口们.订单[0].结局 ?? 列, 字典) : 列);
  const b = useBusiness();
  const 新线索 = 阶段 === "线索";
  // 分配只在新线索页：线索阶段的项目按配额分给销售（老的 Lead 分配搬过来，见 leads/assign-actions.ts 的 项目 选项）
  const 可分 = 新线索 && 能自动分配;
  const [分配中, set分配中] = useState<项目行 | null>(null);
  const [挑老客户, set挑老客户] = useState(false);
  const [存的看法, set看法] = useLocalPref<"列表" | "看板">("projects-view", "看板");
  const 看法 = 新线索 ? "列表" : 存的看法;
  const { f, setF, apply, reset, pending } = useUrlFilters(新线索 ? "/leads" : "/projects", filters);
  const 不问归属 = !f.ownerId && 列表不问归属ID(users, 行.map((r) => r.ownerId));
  const 在筛 = Object.values(filters).some(Boolean);
  // 企业版看板：空列默认藏起来（U-项目-08，lib/project/board.ts 看板显示列），点「显示空列」再摆回来；全空时不藏
  const [显示空列, set显示空列] = useState(false);
  const { 列: 摆的列, 藏了 } = 企业版 ? 看板显示列(看板, 显示空列) : { 列: 看板, 藏了: 0 };
  const 空列名 = 看板.filter((c) => c.数 === 0).map((c) => 列名(c.列)).join("、");
  const 能藏 = 企业版 && 空列名 !== "" && 看板.some((c) => c.数 > 0);
  // 企业版新客户一律走「新线索」向导（先查重）；老客户再开一单走页头下拉里的「给老客户开项目」
  const 新建 = () => router.push(新线索 || 企业版 ? "/leads/new" : "/projects/new");
  // 从首页指标卡点进来：页头标题右边挂一枚能关掉的标签，说清现在只看哪一批
  const 卡 = 认首页卡(filters.f);
  const 卡标 = 卡 ? (
    <Tag className="proj-card-filter" closable title={首页卡口径[卡].说明} onClose={(e) => { e.preventDefault(); apply({ f: "" }); }} closeIcon={<CloseOutlined aria-label={`清掉「${首页卡口径[卡].名}」筛选`} />}>
      {首页卡口径[卡].名}
    </Tag>
  ) : undefined;
  // 公海里同事客户的项目不给客户名（page.tsx 露客户），领取后再看
  const 领了再看 = "领取后可见";

  const 分给了 = (r: Extract<自动分配结果, { ok: true }>) => `已分给 ${r.接手人}（本月已分 ${r.已分} / 配额 ${r.配额 ?? "不限"}）`;

  async function 自动分(r: 项目行) {
    try {
      const res = await 自动分配线索(r.id, { 项目: true });
      if (!res.ok) return void message.error(res.error);
      message.success(`「${r.name}」${分给了(res)}：${res.为什么}`, 5);
      router.refresh();
    } catch {
      message.error("没分成，请稍后再试");
    }
  }

  async function 批量自动分(ids: string[], 清空: () => void) {
    let res: Awaited<ReturnType<typeof 批量自动分配>>;
    try {
      res = await 批量自动分配(ids, { 项目: true });
    } catch {
      return void message.error("没分成，请稍后再试");
    }
    if (!res.ok) return void message.error(res.error);
    清空();
    router.refresh();
    const 成 = res.结果.filter((x) => x.ok).length;
    modal.info({
      title: `自动分配：${成} 条分出去了${成 < res.结果.length ? `，${res.结果.length - 成} 条没分` : ""}`,
      width: 560,
      okText: "知道了",
      content: (
        <ul className="lead-auto-assign-list" data-testid="lead-auto-assign-result">
          {res.结果.map((x) => (
            <li key={x.leadId}>
              <span className="lead-auto-assign-name" title={x.name}>{x.name}</span>
              {x.ok ? <span>{分给了(x)}</span> : <span className="muted">没分：{x.error}</span>}
            </li>
          ))}
        </ul>
      ),
    });
  }

  const 无 = <span style={{ color: "var(--text-muted)" }}>—</span>;
  // 企业版默认只摆 7 列（项目、客户、进程、下一步时间、金额、负责人、回公海日），其余收在「列」里（默认: false）；1366 宽不横向滚
  const 收起 = 企业版 ? { 默认: false } : {};
  const 列表: 列<项目行>[] = [
    // 常驻：第一列是「这一行是谁」，钉左边、表格按列宽排；不钉的话长客户名、长负责人名把它和「进程」挤成两个字一行
    // 项目名整段显示、放不下折行（10-30 用户：「要显示完整」，原来两行截断）
    { title: "项目", dataIndex: "name", width: 170, 常驻: true, render: (v: string) => <span className="fulltext" title={v}>{v}</span> },
    { title: b.customer, key: "customer", width: 160, render: (_, r) => (r.customerName == null ? <span style={{ color: "var(--text-muted)" }}>{领了再看}</span> : <CustomerLink id={r.customerId} name={r.customerName} />) },
    // P11：阶段、进程分两列；新线索页全是线索阶段，不摆阶段列
    ...(新线索 ? [] : [{ title: "阶段", key: "phase", width: 72, ...收起, render: (_: unknown, r: 项目行) => 阶段与进程(r, 字典).阶段 }]),
    { title: "进程", key: "node", width: 130, render: (_, r) => <>{节点文字(r, 字典)}{!企业版 && r.即将回收 && <> <将收标 日={r.即将回收} /></>}</> },
    ...(企业版 ? [{ title: "下一步时间", key: "nextStepAt", width: 100, render: (_: unknown, r: 项目行) => (r.下一步时间 ? dayjs(r.下一步时间).format("MM-DD") : 无) }] : []),
    { title: "金额", key: "amount", width: 110, align: "right", render: (_, r) => 金额(r.amount, r.currency) },
    // 企业版项目公海：被收回过几次（放回、超时回收都算）
    // 企业版（10-29 P6）：预计成交日期（能排，没填的总在最后）、已立项几天、渠道（项目没选跟客户的渠道走）
    // P11 定稿 -2 版：项目级别显示成实心星（S 4 颗 … C 1 颗），悬停看档名；没分级的是 —
    ...(企业版 ? [
      { title: "级别", key: "level", width: 72, 默认: false, render: (_: unknown, r: 项目行) => { const 档 = 企业级别(r.level); return 档 ? <span title={企业级别说明[档]} aria-label={企业级别说明[档]} style={{ color: "var(--warning-text)", whiteSpace: "nowrap" }}>{级别星(档, false)}</span> : 无; } },
      { title: "预计成交", key: "expectedDealAt", width: 110, 默认: false, sorter: (a: 项目行, b: 项目行, 序?: string | null) => 按预计成交排(a.expectedDealAt, b.expectedDealAt, 序 === "descend"), render: (_: unknown, r: 项目行) => r.expectedDealAt ?? 无 },
      { title: "已立项", key: "age", width: 80, 默认: false, align: "right" as const, render: (_: unknown, r: 项目行) => (r.已立项天数 === undefined ? null : `${r.已立项天数} 天`) },
      { title: "渠道", key: "source", width: 130, 默认: false, render: (_: unknown, r: 项目行) => (r.项目来源 ? <span className="fulltext" title={r.项目来源}>{r.项目来源}</span> : 无) },
    ] : []),
    ...(企业版 && filters.pool === "1" ? [{ title: "收回次数", key: "recycled", width: 90, 默认: false, align: "right" as const, render: (_: unknown, r: 项目行) => r.收回次数 ?? 0 }] : []),
    ...(不问归属 ? [] : [{ title: "负责人", key: "owner", width: 110, render: (_: unknown, r: 项目行) => (r.pooled ? <Tag title={`原负责人 ${r.ownerName}`}>在公海</Tag> : <UserCell name={r.ownerName} />) }]),
    // 回公海日：明天（或今天）就回的直接写「明天回公海（11-06）」，再往后只写日期；不会收的（已结束、在订单阶段、在公海）是 —
    ...(企业版 ? [{ title: "回公海日", key: "recycleAt", width: 150, render: (_: unknown, r: 项目行) => (r.即将回收 ? <将收标 日={r.即将回收} /> : r.回收日 ? dayjs(r.回收日).format("MM-DD") : 无) }] : []),
    { title: "最近更新", key: "updatedAt", width: 100, ...收起, render: (_, r) => fmtDate(r.updatedAt) },
    // 已线索流失的不再分（服务端也拦）；两颗带字的键（规则 D）
    ...(可分 ? [{
      title: "", key: "act", width: 150, fixed: "right" as const,
      render: (_: unknown, r: 项目行) => (r.result ? null : (
        <Space size={2}>
          <Button aria-label={`分配 ${r.name}`} type="link" size="small" onClick={() => set分配中(r)}>分配</Button>
          <Button aria-label={`自动分配 ${r.name}`} type="link" size="small" onClick={() => void 自动分(r)}>自动分配</Button>
        </Space>
      )),
    }] : []),
  ];

  // 进程下拉：选了阶段只列这一阶段的节点 + 没走成的出口（线索流失 / 丢单 / 异常状态；成功交付也算结局列上）；没选阶段按阶段分组。
  // 新线索页只有线索阶段。值：节点名 / 结局值（服务端 阶段进程条件 认），显示用字典的叫法
  const 进程组 = (s: 阶段) => ({
    label: s,
    options: [
      ...字典.节点们[s].map((n) => ({ value: n, label: n })),
      ...字典.出口们[s].flatMap((o) => (o.结局 ? [{ value: o.结局, label: o.叫法 }] : [])),
    ],
  });
  const 进程选项: SelectProps["options"] = 新线索 ? 进程组("线索").options : f.phase ? 进程组(f.phase as 阶段).options : 阶段们.map(进程组);
  const 筛选 = (
    <Space wrap size={[10, 10]}>
      <ListSearch
        width={240}
        placeholder={`项目名称 / ${b.customer}`}
        value={f.keyword}
        onChange={(v) => setF({ ...f, keyword: v })}
        onSearch={(v) => apply({ keyword: v })}
      />
      {!不问归属 && (
        <Select
          style={{ width: 126 }}
          placeholder="全部成员"
          allowClear
          value={f.ownerId || undefined}
          onChange={(v) => apply({ ownerId: v ?? "" })}
          options={成员选项(users)}
        />
      )}
      {!新线索 && (
        <Select
          style={{ width: 110 }}
          aria-label="阶段"
          value={f.phase || ""}
          onChange={(v: string) => apply({ phase: v, node: "" })}
          options={[{ value: "", label: "全部阶段" }, ...阶段们.map((s) => ({ value: s, label: s }))]}
        />
      )}
      <Select
        style={{ width: 130 }}
        aria-label="进程"
        placeholder="全部进程"
        allowClear
        value={f.node || undefined}
        onChange={(v?: string | null) => apply({ node: v ?? "" })}
        options={进程选项}
        popupMatchSelectWidth={false}
      />
      {/* 企业版公海只有一处（左栏「公海」，/pool）：这里不再摆「项目公海」筛选，只给一条去那儿的路 */}
      {!企业版 && (
        <Select
          style={{ width: 120 }}
          aria-label="项目公海"
          value={f.pool || ""}
          onChange={(v: string) => apply({ pool: v, recycled: "" })}
          options={[{ value: "", label: "全部项目" }, { value: "1", label: "项目公海" }]}
        />
      )}
      <ResetFilters 显示={Object.values(f).some(Boolean)} onClick={reset} />
      {企业版 && <Link href="/pool" onMouseEnter={() => 预取.进("/pool")} onMouseLeave={预取.出}>去公海看</Link>}
      {/* 企业版项目首页只留看板、列表（U-项目-08）：「新线索列表」「沟通记录」入口去掉，/leads、/follow-ups 路由还在，⌘K 搜得到 */}
    </Space>
  );

  return (
    <div>
      <PageHead
        title={新线索 ? "新线索" : "项目"}
        titleAside={卡标}
        subtitle={
          取到上限
            ? `只显示最近改过的 500 个${新线索 ? "新线索" : "项目"}，用搜索找更早的`
            : 新线索
              ? "项目的线索阶段：潜客培育 → 线索验证 → 线索推进，以转商机或线索流失结束；转了商机到「项目」里接着走"
              : "从线索到交付，一个项目一条线"
        }
        extra={
          // 窄屏（手机、Windows 1024）按钮多了换行，不撑出页宽
          <Space wrap>
            {新线索 && 线索分配开着 && <AssignedOutButton />}
            {!新线索 && <Segmented<"列表" | "看板"> options={["看板", "列表"]} value={看法} onChange={set看法} />}
            {企业版 ? (
              // 一个主按钮：新线索页叫「新线索」；项目首页叫「新增项目」（U-项目-08 去掉「新线索」入口、U-新建-01 留新建项目）。
              // 都走同一个向导（新客户要先查重）；老客户再开一单收在旁边的下拉里，每项带一行说明
              <Space.Compact>
                <Button type="primary" icon={<PlusOutlined />} onClick={新建}>{新线索 ? "新线索" : "新增项目"}</Button>
                <Dropdown
                  trigger={["click"]}
                  placement="bottomRight"
                  menu={{
                    items: [
                      { key: "new", label: <两行 名={新线索 ? "新线索" : `新${b.customer}开项目`} 说={`新${b.customer}要先查重`} />, onClick: 新建 },
                      { key: "old", label: <两行 名="给老客户开项目" 说={`老${b.customer}直接选${b.customer}`} />, onClick: () => set挑老客户(true) },
                    ],
                  }}
                >
                  <Button type="primary" icon={<DownOutlined />} aria-label="新建方式" />
                </Dropdown>
              </Space.Compact>
            ) : (
              <Button type="primary" icon={<PlusOutlined />} onClick={新建}>{新线索 ? "新线索" : "新建项目"}</Button>
            )}
          </Space>
        }
      />

      <InviteInbox 邀请们={邀请们} />
      <VerifyInbox 们={待复核们} />
      <MyBlockersBoard 们={卡点们} />
      {新线索 && <LeadFullNotices 提醒={提醒们} />}

      {看法 === "列表" ? (
        <DataList<项目行>
          // 企业版默认只摆 7 列（1366 宽不横滚），换个键让已存的旧列设置回到新默认
          页={企业版 ? (新线索 ? "ent-leads-v2" : "ent-projects") : "projects"}
          列={列表}
          行={行}
          空库={行.length === 0 && !在筛}
          加载中={pending}
          行链接={(r) => `/projects/${r.id}`}
          空态={
            新线索
              ? {
                  title: "还没有新线索",
                  hint: `新线索就是还在线索阶段的项目。新建时会一起建好${b.customer}、联系人和第一次沟通，从潜客培育开始。`,
                  primary: { label: "新线索", onClick: 新建 },
                }
              : {
                  title: "还没有项目",
                  hint: `项目是跟一位${b.customer}做的一件事：从线索培育一路走到交付。新建时会一起建好${b.customer}、联系人和第一次沟通。`,
                  primary: { label: 企业版 ? "新增项目" : "新建第一个项目", onClick: 新建 },
                }
          }
          筛选={筛选}
          批量={可分 ? (选中, 清空) => (
            <Button size="small" icon={<ThunderboltOutlined />} onClick={() => void 批量自动分(选中, 清空)}>自动分配</Button>
          ) : undefined}
        />
      ) : (
        <>
          <div style={{ marginBottom: 12 }}>{筛选}</div>
          {/* 企业版空列默认藏起来（U-项目-08）：说清藏了哪几列，点一下摆回来 */}
          {能藏 && (
            <div className="pipe-hidden">
              {显示空列 ? (
                <Button type="link" size="small" onClick={() => set显示空列(false)}>藏起空列</Button>
              ) : (
                <>
                  <span className="pipe-hidden-t" title={空列名}>{藏了} 列没有项目，已藏起：{空列名}</span>
                  <Button type="link" size="small" onClick={() => set显示空列(true)}>显示空列</Button>
                </>
              )}
            </div>
          )}
          <div className="pipe-wrap">
            <div className="pipe">
              {摆的列.map((c) => {
                const sum = 合计文字(c.合计, b.currency);
                return (
                  <div key={c.列} className="pipe-col" aria-label={`${列名(c.列)}，${c.数} 个项目`}>
                    <div className="pipe-h">
                      <span className="pipe-dot" style={{ background: 列色[c.列] }} />
                      <b>{列名(c.列)}</b>
                      <span className="pipe-n">{c.数}</span>
                      <span className="pipe-sum" title={sum}>{sum}</span>
                    </div>
                    <div className="pipe-bar" style={{ background: 列色[c.列] }} />
                    {c.行.length === 0 && <div className="pipe-empty">{在筛 ? "这一列没有对上的" : 空列说法[c.列]}</div>}
                    {c.行.map((r) => {
                      const 异常 = r.result === "异常状态";
                      return (
                        <div
                          key={r.id}
                          className="pipe-card"
                          style={{ borderLeftColor: 异常 ? "var(--danger)" : 列色[c.列] }}
                          tabIndex={0}
                          role="link"
                          title={异常 && 异常说明(r) ? `异常：${异常说明(r)}` : `${r.customerName ?? 领了再看} · ${r.node}`}
                          aria-label={`${r.name}，${r.customerName ?? 领了再看}，${异常 ? "异常 · " : ""}${r.node}，${金额(r.amount, r.currency)}${r.pooled ? "，在公海" : ""}${r.即将回收 ? `，${回公海文案(r.即将回收).短文字}` : ""}`}
                          onClick={() => router.push(`/projects/${r.id}`)}
                          onMouseEnter={() => 预取.进(`/projects/${r.id}`)}
                          onMouseLeave={预取.出}
                          onFocus={() => 预取.进(`/projects/${r.id}`)}
                          onBlur={预取.出}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              router.push(`/projects/${r.id}`);
                            }
                          }}
                        >
                          <div className="pipe-card-t fulltext" title={r.name}>{r.name}</div>
                          <div className="pipe-card-m">
                            <span className="pipe-card-o" style={r.customerName == null ? { color: "var(--text-muted)" } : undefined}>{r.customerName ?? 领了再看}</span>
                          </div>
                          <div className="pipe-card-m">
                            <span className="pipe-card-o" style={异常 ? { color: "var(--danger-text)" } : undefined}>
                              {异常 ? `异常 · ${r.exceptionCategory ? `${r.exceptionCategory} · ` : ""}` : r.result && !是交付(r.result) ? `${结局叫法(r.result, 字典)} · ` : ""}{r.node}
                            </span>
                            <span className="pipe-card-a">{金额(r.amount, r.currency)}</span>
                          </div>
                          {r.pooled ? (
                            <div className="pipe-card-m"><span className="pipe-card-o"><Tag style={{ marginInlineEnd: 0 }}>在公海</Tag></span></div>
                          ) : (
                            (!不问归属 || r.即将回收) && (
                              <div className="pipe-card-m">
                                <span className="pipe-card-o">{不问归属 ? null : r.ownerName}</span>
                                {r.即将回收 && <将收标 日={r.即将回收} />}
                              </div>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
      {企业版 && <OldCustomerProject 开={挑老客户} 关={() => set挑老客户(false)} users={users} 节点们={字典.节点们.线索} 要下一步={要下一步} />}
      {可分 && <AssignLeadModal lead={分配中 && { id: 分配中.id, name: 分配中.name, ownerId: 分配中.ownerId, 项目: true }} 关={() => set分配中(null)} />}
    </div>
  );
}

/** 企业版超时回收：快到回收日的项目标一下（10-27）。标签直接写哪天，不用悬停；文字和项目详情同一套（recycle-text.ts） */
function 将收标({ 日 }: { 日: string }) {
  const { 短文字, 级别 } = 回公海文案(日);
  return <Tag color={级别 === "当天" || 级别 === "已过" ? "error" : "warning"} style={{ marginInlineEnd: 0, flexShrink: 0 }}>{短文字}</Tag>;
}

/** 下拉菜单里的一项：名字 + 一行小字说明 */
function 两行({ 名, 说 }: { 名: string; 说: string }) {
  return (
    <div style={{ lineHeight: 1.4, padding: "2px 0" }}>
      <div>{名}</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{说}</div>
    </div>
  );
}

/**
 * 「给老客户开项目」：先挑一位已有的客户，再接客户页同一个新建项目框（customers/[id]/NewProjectModal.tsx）。
 * 能挑到谁走 搜客户 的可见范围，建项目的权限以服务端 给客户建项目 为准
 */
function OldCustomerProject({ 开, 关, users, 节点们, 要下一步 }: { 开: boolean; 关: () => void; users: 可选成员[]; 节点们: readonly string[]; 要下一步: boolean }) {
  const { message } = App.useApp();
  const b = useBusiness();
  const me = useMe();
  const [选, set选] = useState<string | undefined>();
  const [取中, set取中] = useState(false);
  const [客户, set客户] = useState<{ id: string; name: string; 联系人们: { id: string; name: string; isPrimary: boolean }[] } | null>(null);

  async function 下一步() {
    if (!选) return;
    set取中(true);
    try {
      const c = await 取客户近况(选);
      if (!c) {
        message.error(`没找到这位${b.customer}，或你看不到`);
        return;
      }
      // 近况里不带谁是主要联系人，新建框默认选第一个
      set客户({ id: c.id, name: c.name, 联系人们: c.contacts.map((x) => ({ id: x.id, name: x.name, isPrimary: false })) });
      set选(undefined);
      关();
    } catch {
      message.error(`${b.customer}没取到，请重试`);
    } finally {
      set取中(false);
    }
  }

  return (
    <>
      <Modal
        open={开}
        title="给老客户开项目"
        okText="下一步"
        okButtonProps={{ disabled: !选, loading: 取中 }}
        onOk={() => void 下一步()}
        onCancel={() => {
          set选(undefined);
          关();
        }}
        destroyOnHidden
      >
        <CustomerSearchSelect value={选} onChange={set选} placeholder="搜名称 / 公司 / 电话" style={{ width: "100%" }} />
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
          选一位已有的{b.customer}，接着填项目和首条沟通。新{b.customer}请用「新线索」，要先查重。
        </div>
      </Modal>
      {客户 && (
        <NewProjectModal
          open
          onClose={() => set客户(null)}
          customerId={客户.id}
          customerName={客户.name}
          默认负责人={我当负责人(me, users) ?? null}
          users={users}
          联系人们={客户.联系人们}
          节点们={节点们}
          要下一步={要下一步}
        />
      )}
    </>
  );
}

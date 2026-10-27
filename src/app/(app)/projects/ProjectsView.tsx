"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useHoverPrefetch } from "@/lib/prefetch-full";
import { App, Button, Select, Space, Segmented, Tag } from "antd";
import { PlusOutlined, ThunderboltOutlined, UserSwitchOutlined } from "@ant-design/icons";
import { PageHead, CustomerLink, UserCell } from "@/components/ui";
import DataList, { type 列 } from "@/components/DataList";
import ListSearch from "@/components/ListSearch";
import ResetFilters from "@/components/ResetFilters";
import { useBusiness } from "@/lib/business-client";
import { useLocalPref } from "@/lib/local-pref";
import { useUrlFilters } from "@/lib/url-filters";
import { 列表不问归属ID } from "@/lib/solo";
import { fmtDate, 成员选项, type 可选成员 } from "@/lib/utils";
import { 金额, 合计文字 } from "@/lib/currency";
import { 主题颜色 } from "@/lib/chart-theme";
import { categorical } from "@/lib/palette";
import { 收回次数筛们 } from "@/lib/project/recycle-count";
import type { 项目行, 看板一列 } from "@/lib/project/board";
import type { 看板列 } from "@/lib/project/nodes";
import type { 满额提醒 } from "@/lib/enterprise/lead-full-notice";
import { 字典of, 结局叫法, type 阶段字典, type 出口叫法改动 } from "@/lib/project/stage-dict";
import InviteInbox, { type 邀请行 } from "./InviteInbox";
import { MyBlockersBoard, type 卡点卡 } from "./BlockerPanel";
import { 自动分配线索, 批量自动分配, type 自动分配结果 } from "../leads/assign-actions";
import { AssignLeadModal, AssignedOutButton } from "../leads/AssignLead";
import LeadFullNotices from "../leads/LeadFullNotices";

/** 看板五列的颜色：三个阶段沿用商机管道的蓝绿黄，成功交付粉、没成灰 */
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

/** 节点那一格：有结局写结局（按字典的叫法，后台改了出口叫法就用改的），异常标红 */
function 节点文字(r: 项目行, 字典: 阶段字典) {
  if (r.result === "异常状态") return <Tag color="error" title={异常说明(r)}>异常 · {r.exceptionCategory ?? r.node}</Tag>;
  if (r.result) return <Tag>{结局叫法(r.result, 字典)}</Tag>;
  return <span>{r.phase} · {r.node}</span>;
}

/**
 * 项目页（团队版项目模式 1a）：列表和看板两种看法，同一批行、同一组筛选。
 * 看板列头写项目数和按币种分开的金额合计；异常状态的项目留在订单列、左边框标红。
 *
 * 阶段 = "线索"：企业版「新线索」页（/leads）。只列线索阶段的项目、只有列表，
 * 新建照样走项目向导（落在潜客培育）；转商机之后它就只在「项目」页里了（10-26 用户定的三大阶段）。
 */
export default function ProjectsView({
  行, 列: 看板, 取到上限, users, filters, 企业版 = false, 出口叫法, 邀请们 = [], 卡点们 = [], 阶段, 线索分配开着 = false, 能自动分配 = false, 满额提醒: 提醒们 = [],
}: {
  行: 项目行[];
  列: 看板一列[];
  取到上限: boolean;
  users: 可选成员[];
  filters: { keyword: string; ownerId: string; pool: string; recycled: string };
  /** 服务端的 企业版()：结局叫法跟着字典 */
  企业版?: boolean;
  /** 企业版组织规则里改过的出口叫法 */
  出口叫法?: 出口叫法改动;
  /** 企业版：等我回的项目组邀请（别的版本是空的） */
  邀请们?: 邀请行[];
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
  const b = useBusiness();
  const 新线索 = 阶段 === "线索";
  // 分配只在新线索页：线索阶段的项目按配额分给销售（老的 Lead 分配搬过来，见 leads/assign-actions.ts 的 项目 选项）
  const 可分 = 新线索 && 能自动分配;
  const [分配中, set分配中] = useState<项目行 | null>(null);
  const [存的看法, set看法] = useLocalPref<"列表" | "看板">("projects-view", "看板");
  const 看法 = 新线索 ? "列表" : 存的看法;
  const { f, setF, apply, reset, pending } = useUrlFilters(新线索 ? "/leads" : "/projects", filters);
  const 不问归属 = !f.ownerId && 列表不问归属ID(users, 行.map((r) => r.ownerId));
  const 在筛 = Object.values(filters).some(Boolean);
  const 新建 = () => router.push(新线索 ? "/leads/new" : "/projects/new");
  // 公海里同事客户的项目不给客户名（page.tsx 露客户），领取后再看
  const 领了再看 = `领取后显示${b.customer}`;

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

  const 列表: 列<项目行>[] = [
    { title: "项目", dataIndex: "name", width: 180, render: (v: string) => <span className="clamp" title={v}>{v}</span> },
    { title: b.customer, key: "customer", width: 170, render: (_, r) => (r.customerName == null ? <span style={{ color: "var(--text-muted)" }}>{领了再看}</span> : <CustomerLink id={r.customerId} name={r.customerName} />) },
    { title: "节点", key: "node", width: 150, render: (_, r) => <>{节点文字(r, 字典)}{r.即将回收 && <> <将收标 日={r.即将回收} /></>}</> },
    { title: "金额", key: "amount", width: 120, align: "right", render: (_, r) => 金额(r.amount, r.currency) },
    // 企业版项目公海：被收回过几次（放回、超时回收都算）
    ...(企业版 && filters.pool === "1" ? [{ title: "收回次数", key: "recycled", width: 90, align: "right" as const, render: (_: unknown, r: 项目行) => r.收回次数 ?? 0 }] : []),
    ...(不问归属 ? [] : [{ title: "负责人", key: "owner", width: 110, render: (_: unknown, r: 项目行) => (r.pooled ? <Tag title={`原负责人 ${r.ownerName}`}>公海</Tag> : <UserCell name={r.ownerName} />) }]),
    { title: "最近更新", key: "updatedAt", width: 100, render: (_, r) => fmtDate(r.updatedAt) },
    // 已线索流失的不再分（服务端也拦）
    ...(可分 ? [{
      title: "", key: "act", width: 90, fixed: "right" as const,
      render: (_: unknown, r: 项目行) => (r.result ? null : (
        <Space size={2}>
          <Button aria-label={`分配 ${r.name}`} title="分配给…" type="text" size="small" icon={<UserSwitchOutlined />} onClick={() => set分配中(r)} />
          <Button aria-label={`自动分配 ${r.name}`} title="自动分配" type="text" size="small" icon={<ThunderboltOutlined />} onClick={() => void 自动分(r)} />
        </Space>
      )),
    }] : []),
  ];

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
      <Select
        style={{ width: 120 }}
        aria-label="项目公海"
        value={f.pool || ""}
        onChange={(v: string) => apply({ pool: v, recycled: "" })}
        options={[{ value: "", label: "全部项目" }, { value: "1", label: "项目公海" }]}
      />
      {企业版 && f.pool === "1" && (
        <Select
          style={{ width: 150 }}
          aria-label="收回次数"
          value={f.recycled || ""}
          onChange={(v: string) => apply({ recycled: v })}
          options={[...收回次数筛们]}
        />
      )}
      <ResetFilters 显示={Object.values(f).some(Boolean)} onClick={reset} />
    </Space>
  );

  return (
    <div>
      <PageHead
        title={新线索 ? "新线索" : "项目"}
        subtitle={
          取到上限
            ? `只显示最近改过的 500 个${新线索 ? "新线索" : "项目"}，用搜索找更早的`
            : 新线索
              ? "项目的线索阶段：潜客培育 → 线索验证 → 线索推进，以转商机或线索流失结束；转了商机到「项目」里接着走"
              : "从线索到交付，一个项目一条线"
        }
        extra={
          <Space>
            {新线索 && 线索分配开着 && <AssignedOutButton />}
            {!新线索 && <Segmented<"列表" | "看板"> options={["看板", "列表"]} value={看法} onChange={set看法} />}
            <Button type="primary" icon={<PlusOutlined />} onClick={新建}>{新线索 ? "新建新线索" : "新建项目"}</Button>
          </Space>
        }
      />

      <InviteInbox 邀请们={邀请们} />
      <MyBlockersBoard 们={卡点们} />
      {新线索 && <LeadFullNotices 提醒={提醒们} />}

      {看法 === "列表" ? (
        <DataList<项目行>
          页={新线索 ? "ent-leads" : "projects"}
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
                  primary: { label: "新建第一条新线索", onClick: 新建 },
                }
              : {
                  title: "还没有项目",
                  hint: `项目是跟一位${b.customer}做的一件事：从线索培育一路走到交付。新建时会一起建好${b.customer}、联系人和第一次沟通。`,
                  primary: { label: "新建第一个项目", onClick: 新建 },
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
          <div className="pipe-wrap">
            <div className="pipe">
              {看板.map((c) => {
                const sum = 合计文字(c.合计, b.currency);
                return (
                  <div key={c.列} className="pipe-col" aria-label={`${c.列}，${c.数} 个项目`}>
                    <div className="pipe-h">
                      <span className="pipe-dot" style={{ background: 列色[c.列] }} />
                      <b>{c.列}</b>
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
                          aria-label={`${r.name}，${r.customerName ?? 领了再看}，${异常 ? "异常 · " : ""}${r.node}，${金额(r.amount, r.currency)}${r.pooled ? "，在项目公海里" : ""}${r.即将回收 ? "，即将回收" : ""}`}
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
                          <div className="pipe-card-t">{r.name}</div>
                          <div className="pipe-card-m">
                            <span className="pipe-card-o" style={r.customerName == null ? { color: "var(--text-muted)" } : undefined}>{r.customerName ?? 领了再看}</span>
                          </div>
                          <div className="pipe-card-m">
                            <span className="pipe-card-o" style={异常 ? { color: "var(--danger-text)" } : undefined}>
                              {异常 ? `异常 · ${r.exceptionCategory ? `${r.exceptionCategory} · ` : ""}` : r.result && r.result !== "成功交付" ? `${结局叫法(r.result, 字典)} · ` : ""}{r.node}
                            </span>
                            <span className="pipe-card-a">{金额(r.amount, r.currency)}</span>
                          </div>
                          {r.pooled ? (
                            <div className="pipe-card-m"><span className="pipe-card-o"><Tag style={{ marginInlineEnd: 0 }}>公海</Tag></span></div>
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
      {可分 && <AssignLeadModal lead={分配中 && { id: 分配中.id, name: 分配中.name, ownerId: 分配中.ownerId, 项目: true }} 关={() => set分配中(null)} />}
    </div>
  );
}

/** 企业版超时回收：明天（或今天）没人跟进就回到项目公海（10-27） */
function 将收标({ 日 }: { 日: string }) {
  return <Tag color="warning" style={{ marginInlineEnd: 0, flexShrink: 0 }} title={`${日} 前没人跟进，会自动回到项目公海`}>即将回收</Tag>;
}

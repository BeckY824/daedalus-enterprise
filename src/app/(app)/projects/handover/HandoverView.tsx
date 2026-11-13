"use client";

import { 空值符 } from "@/lib/empty-value";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { App, Button, Card, Empty, Modal, Select, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PageHead, UserCell } from "@/components/ui";
import { useBusiness } from "@/lib/business-client";
import type { 离职待交接, 交接客户, 交接项目, 等确认 } from "@/lib/enterprise/offboard-handover";
import { deactivateUser } from "../../settings/actions";
import { 撤回交接, 改接手人 } from "../../customers/handover-actions";
import { 交接客户 as 交客户, 交接项目 as 交项目, 交接全部 } from "./actions";

type 人 = { id: string; name: string };

/**
 * 离职交接看板（11-03 B7-2）：一位离职成员一张卡，卡里列他名下还没交走的客户（项目模式再列不跟着客户走的项目），
 * 每行选接手人点「交」，或卡顶「全部交给」一个人（线索、渠道一起走）。接手人候选同公海分配（B2-7）。
 * 11-13 起交了只是发起：接手人确认前这一行显示「等 X 确认」（满 7 天带「已等 N 天」），不能再交，发起人 / 总管理可改接手人、撤回。
 * 名字、客户名都可能很长：表格固定列宽、单元格省略号，1024 宽也不横向溢出
 */
export default function HandoverView({ 人们, 候选, 项目模式, 系统管理员, 下属, 三态开 = false }: {
  人们: 离职待交接[];
  候选: 人[];
  项目模式: boolean;
  系统管理员: boolean;
  下属: 人[];
  /** 客户三态开着：上面多一张「待交接」表（M-公海-52）；关着不出，页面和原来一样 */
  三态开?: boolean;
}) {
  const b = useBusiness();
  return (
    <div>
      <PageHead
        title="离职交接"
        subtitle={`已离职成员名下还没交走的${b.customer}${项目模式 ? "和项目" : ""}：${系统管理员 ? "系统管理员看全部" : "你是他们的直属上级"}，给每条选接手人，或一键全部交给一个人；接手人确认后才转过去`}
      />
      {下属.length > 0 && <OffboardReport 下属={下属} />}
      {三态开 && <TriPending 人们={人们} />}
      {人们.length ? (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          {人们.map((p) => <PersonCard key={p.id} p={p} 候选={候选} 项目模式={项目模式} />)}
        </Space>
      ) : (
        <Card><Empty description="没有待交接的离职成员" /></Card>
      )}
    </div>
  );
}

const 省略 = { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

/** 离职交接不作废（人已停用，作废了没人管）：等满这么多天在看板上标「已等 N 天」提醒发起人（同申请移交的 7 天） */
const 久等天数 = 7;

/** 「等 X 确认」那一句；满 7 天带「已等 N 天」。悬停看全：哪天发起、等了几天 */
function 等确认说(w: 等确认): { 字: string; 全: string; 久: boolean } {
  const 久 = w.挂起天数 >= 久等天数;
  const 字 = `等 ${w.接手人 ?? "接手人"} 确认${久 ? ` · 已等 ${w.挂起天数} 天` : ""}`;
  return { 字, 全: `${w.起日} 交给 ${w.接手人 ?? "接手人"}，${w.挂起天数 ? `已等 ${w.挂起天数} 天` : "今天发起"}；接手人确认后才转过去`, 久 };
}

function PickTaker({ 候选, 不要, value, onChange, placeholder = "选接手人", style, className }: {
  候选: 人[]; 不要: string; value?: string; onChange: (v: string) => void; placeholder?: string; style?: React.CSSProperties; className?: string;
}) {
  return (
    <Select
      showSearch
      optionFilterProp="label"
      placeholder={placeholder}
      className={className}
      value={value || undefined}
      onChange={onChange}
      style={{ minWidth: 0, ...style }}
      popupMatchSelectWidth={false}
      options={候选.filter((u) => u.id !== 不要).map((u) => ({ value: u.id, label: u.name }))}
    />
  );
}

function PersonCard({ p, 候选, 项目模式 }: { p: 离职待交接; 候选: 人[]; 项目模式: boolean }) {
  const b = useBusiness();
  const router = useRouter();
  const { message, modal } = App.useApp();
  const [选了, set选了] = useState<Record<string, string>>({});
  const [全部给, set全部给] = useState("");
  const [忙, set忙] = useState<string | null>(null);
  const [改, set改] = useState<等确认 | null>(null);
  const [新, set新] = useState<string | undefined>();
  const 名 = (id: string) => 候选.find((u) => u.id === id)?.name ?? "";

  async function 做(key: string, f: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, 成了 = "") {
    if (忙) return;
    set忙(key);
    try {
      const r = await f();
      if (r.ok) { message.success(r.message ?? 成了); router.refresh(); } else message.error(r.error);
    } catch {
      message.error("没交成，刷新再试");
    } finally {
      set忙(null);
    }
  }

  const 交这行 = (kind: "c" | "p", id: string) => {
    const to = 选了[`${kind}:${id}`];
    if (!to) { message.error("先选接手人"); return; }
    return 做(`${kind}:${id}`, () => (kind === "c" ? 交客户(p.id, id, to) : 交项目(p.id, id, to)));
  };

  const 撤回 = (w: 等确认) => modal.confirm({
    title: "撤回这笔交接？",
    content: `「${w.接手人 ?? "接手人"}」不用再确认，数据留在「${p.name}」名下，之后可以重新交。`,
    okText: "撤回", okButtonProps: { danger: true }, cancelText: "取消",
    onOk: () => 做(`w:${w.id}`, () => 撤回交接(w.id), "已撤回"),
  });
  const 改成 = async () => {
    if (!改 || !新) return;
    const w = 改;
    await 做(`w:${w.id}`, () => 改接手人(w.id, 新), "已改接手人，等对方确认");
    set改(null);
  };

  /** 等确认那一格：「等 X 确认」一行放不下省略号、悬停看全，后面改接手人、撤回（我能撤回的才有） */
  const 等着 = (w: 等确认) => {
    const t = 等确认说(w);
    return (
      <div className="ofb-wait">
        <Typography.Text type={t.久 ? "warning" : "secondary"} title={t.全} className="ofb-wait-t">{t.字}</Typography.Text>
        {w.我能撤回 && (
          <>
            <Button size="small" type="link" className="ofb-wait-btn" disabled={!!忙} onClick={() => { set新(undefined); set改(w); }}>改人</Button>
            <Button size="small" type="link" className="ofb-wait-btn" loading={忙 === `w:${w.id}`} disabled={!!忙 && 忙 !== `w:${w.id}`} onClick={() => 撤回(w)}>撤回</Button>
          </>
        )}
      </div>
    );
  };

  const 接手列 = <T extends { id: string; 交接中?: 等确认 }>(kind: "c" | "p"): ColumnsType<T>[number] => ({
    title: "接手人",
    key: "to",
    width: 280,
    render: (_: unknown, r: T) => r.交接中 ? 等着(r.交接中) : (
      <div style={{ display: "flex", gap: 8, minWidth: 0 }}>
        <PickTaker 候选={候选} 不要={p.id} value={选了[`${kind}:${r.id}`]} onChange={(v) => set选了((m) => ({ ...m, [`${kind}:${r.id}`]: v }))} style={{ flex: 1 }} />
        <Button disabled={p.交接中 || !选了[`${kind}:${r.id}`]} loading={忙 === `${kind}:${r.id}`} onClick={() => 交这行(kind, r.id)}>交</Button>
      </div>
    ),
  });

  const 客户列: ColumnsType<交接客户> = [
    { title: b.customer, dataIndex: "name", ellipsis: true, render: (v: string, r) => <Link href={`/customers/${r.id}`} title={v} style={省略}>{v}</Link> },
    ...(项目模式 ? [{ title: "项目", dataIndex: "项目数", width: 72, render: (n: number) => (n ? `${n} 个` : "—") }] : []),
    接手列<交接客户>("c"),
  ];
  const 项目列: ColumnsType<交接项目> = [
    { title: "项目", dataIndex: "name", ellipsis: true, render: (v: string, r) => <Link href={`/projects/${r.id}`} title={v} style={省略}>{v}</Link> },
    { title: b.customer, dataIndex: "客户", ellipsis: true, width: "28%", render: (v: string) => <span title={v} style={省略}>{v}</span> },
    接手列<交接项目>("p"),
  ];

  const 其余 = [
    p.其余.线索 && `${p.其余.线索} 条线索`,
    p.其余.渠道 && `${p.其余.渠道} 个渠道`,
    p.其余.主渠道 && `${p.其余.主渠道} 个主渠道`,
    p.其余.待办 && `${p.其余.待办} 条挂在别人${b.customer}上的待办`,
  ].filter(Boolean).join("、");

  const 一键 = () => {
    if (!全部给) { message.error("先选接手人"); return; }
    const 段 = [
      p.客户.length && `${p.客户.length} 位${b.customer}`,
      p.项目.length && `${p.项目.length} 个项目`,
      其余,
    ].filter(Boolean).join("、");
    modal.confirm({
      title: `把「${p.name}」名下的全部交给「${名(全部给)}」`,
      content: `${段 || "名下剩下的"}，连同进行中的商机、没做完的计划和待办，一起交给 TA；TA 确认后才转过去，确认前还在「${p.name}」名下。已经签下的业绩、有结局的项目还算在「${p.name}」头上。`,
      okText: "全部交给",
      cancelText: "取消",
      onOk: () => 做("all", () => 交接全部(p.id, 全部给)),
    });
  };

  return (
    <Card
      size="small"
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, maxWidth: 260 }}><UserCell name={p.name} size={24} /></div>
          <Tag style={{ marginInlineEnd: 0 }}>已离职</Tag>
          {p.交接中 && <Tag color="orange" style={{ marginInlineEnd: 0 }}>交接中</Tag>}
          <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400, minWidth: 0, maxWidth: 240, ...省略 }} title={p.上级 ?? undefined}>
            直属上级：{p.上级 ?? 空值符}
          </Typography.Text>
        </div>
      }
    >
      {p.整包 ? (
        // 全部交给在等确认：整张卡不能再交，这里改接手人、撤回
        <div className="ofb-all-wait">
          <Typography.Text className="ofb-all-wait-l">已全部交给</Typography.Text>
          <div className="ofb-all-wait-c">{等着(p.整包)}</div>
        </div>
      ) : p.交接中 ? (
        <Typography.Paragraph type="warning" style={{ fontSize: 13 }}>
          TA 还有一笔离职交接在等接手人确认：先在{b.customer}页「交接中」里撤回，再在这里交。
        </Typography.Paragraph>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <Typography.Text style={{ fontSize: 13 }}>全部交给</Typography.Text>
          <PickTaker 候选={候选} 不要={p.id} value={全部给} onChange={set全部给} style={{ width: 220 }} />
          <Button type="primary" disabled={p.单条等确认 > 0 || !全部给} loading={忙 === "all"} onClick={一键}>全部交给</Button>
          {p.单条等确认 > 0
            ? <Typography.Text type="secondary" className="ofb-hint">还有 {p.单条等确认} 笔在等接手人确认，确认或撤回后才能全部交给</Typography.Text>
            : 其余 && <Typography.Text type="secondary" style={{ fontSize: 12 }}>另有 {其余}，「全部交给」时一起走</Typography.Text>}
        </div>
      )}
      {p.客户.length > 0 && (
        <Table<交接客户>
          size="small"
          rowKey="id"
          tableLayout="fixed"
          columns={客户列}
          dataSource={p.客户}
          pagination={p.客户.length > 20 ? { pageSize: 20, size: "small", showSizeChanger: false } : false}
          title={() => `${b.customer}（${p.客户.length}）${项目模式 ? "：交出去时 TA 负责的项目一起走，同事负责的不动（待分配的也走）" : ""}`}
          style={{ marginBottom: p.项目.length ? 12 : 0 }}
        />
      )}
      {p.项目.length > 0 && (
        <Table<交接项目>
          size="small"
          rowKey="id"
          tableLayout="fixed"
          columns={项目列}
          dataSource={p.项目}
          pagination={p.项目.length > 20 ? { pageSize: 20, size: "small", showSizeChanger: false } : false}
          title={() => `TA 负责、${b.customer}不在 TA 名下的项目（${p.项目.length}）`}
        />
      )}
      <Modal open={!!改} title="改接手人" okText="改" cancelText="取消" onCancel={() => set改(null)} onOk={改成}
        okButtonProps={{ disabled: !新, loading: !!改 && 忙 === `w:${改.id}` }} destroyOnHidden>
        <p>这笔交接改给另一位，等新接手人确认；原接手人「{改?.接手人 ?? ""}」不用再确认。</p>
        <PickTaker 候选={候选.filter((u) => u.id !== 改?.接手人id)} 不要={p.id} value={新} onChange={set新} placeholder="选新接手人" className="ofb-full" />
      </Modal>
    </Card>
  );
}

/** 上级给直属下属办离职（设置页只给系统管理员，11-03 D3-1）：只停用，名下原地不动，停完就出现在下面 */
function OffboardReport({ 下属 }: { 下属: 人[] }) {
  const router = useRouter();
  const { message, modal } = App.useApp();
  const [谁, set谁] = useState("");
  const 名 = 下属.find((u) => u.id === 谁)?.name ?? "";
  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <Typography.Text style={{ fontSize: 13 }}>给直属下属办离职</Typography.Text>
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="选成员"
          value={谁 || undefined}
          onChange={set谁}
          style={{ width: 220 }}
          popupMatchSelectWidth={false}
          options={下属.map((u) => ({ value: u.id, label: u.name }))}
        />
        <Button
          danger
          disabled={!谁}
          onClick={() => modal.confirm({
            title: `停用成员「${名}」`,
            content: "停用后 TA 登录不了；名下的客户、项目等原地不动（负责人还是 TA），停完在下面交给接手人。重新启用的话，没交走的还在 TA 名下。",
            okText: "确认停用",
            okButtonProps: { danger: true },
            cancelText: "取消",
            async onOk() {
              const r = await deactivateUser(谁, "").catch(() => null);
              if (r?.ok) { message.success("已停用，在下面把 TA 名下的交给接手人"); set谁(""); router.refresh(); }
              else message.error(r && !r.ok ? r.error : "停用没成功，刷新再试");
            },
          })}
        >
          办离职
        </Button>
      </div>
    </Card>
  );
}

type 待交接行 = {
  id: string; name: string; 挂起天数: number; 挂起工作日: number; 超期: boolean; 原负责人: string; 原直属上级: string | null;
  /** 来源：停用账号名下被三态标了待交接 / 离职交接在等接手人确认；两种都占的只列一行 */
  状态: string; 状态说明: string;
};

/** 一位客户两种来源合成一行：挂起按先挂起的那个算（天数大的），超期任一超了就算 */
function 成行(p: 离职待交接, c: 离职待交接["客户"][number]): 待交接行 | null {
  const 标 = c.待交接日 && c.挂起天数 !== undefined ? { 天: c.挂起天数, 工作日: c.挂起工作日 ?? 0, 超期: !!c.超期 } : null;
  const 挂 = c.交接中 ? { 天: c.交接中.挂起天数, 工作日: c.交接中.挂起工作日, 超期: c.交接中.超期 } : null;
  if (!标 && !挂) return null;
  const 长 = 标 && 挂 ? (挂.天 >= 标.天 ? 挂 : 标) : (挂 ?? 标)!;
  const 等谁 = c.交接中 ? `交接中 · 等${c.交接中.接手人 ?? "接手人"}确认` : "";
  return {
    id: c.id, name: c.name, 挂起天数: 长.天, 挂起工作日: 长.工作日, 超期: !!(标?.超期 || 挂?.超期), 原负责人: p.name, 原直属上级: p.上级,
    状态: 等谁 || "停用待交接",
    状态说明: 标 && 挂
      ? `离职交接 ${c.交接中!.起日} 发起，在等接手人确认；此前 ${c.待交接日} 已被标待交接。挂起天数按先挂起的算`
      : 挂 ? `离职交接 ${c.交接中!.起日} 发起，在等接手人确认` : `账号已停用，${c.待交接日} 到了回收节点被标待交接`,
  };
}

/**
 * 「待交接」（M-公海-49 / 50 / 52：客户定的三态上线前置）：两种来源合成一张表——
 *   停用账号名下、被三态夜扫标了「待交接」的客户（T12）；离职交接还在等接手人确认的客户（T6，挂起天数从发起那天算）。
 * 四列必须有：待交接（客户）、挂起天数、原负责人、原直属上级；另加一列状态区分来源。挂起超过 15 个工作日或 30 个自然日（先到者）的行标红。
 * 只读：交给谁照旧在下面各人的卡片里交（用户 11-12 定）。久挂的排前面；一个都没有就不摆
 */
function TriPending({ 人们 }: { 人们: 离职待交接[] }) {
  const b = useBusiness();
  const 行们: 待交接行[] = 人们
    .flatMap((p) => p.客户.flatMap((c) => { const r = 成行(p, c); return r ? [r] : []; }))
    .sort((a, b2) => b2.挂起天数 - a.挂起天数 || (a.name < b2.name ? -1 : a.name > b2.name ? 1 : 0));
  if (!行们.length) return null;
  const 超期数 = 行们.filter((r) => r.超期).length;
  const 列: ColumnsType<待交接行> = [
    { title: "待交接", dataIndex: "name", ellipsis: true, render: (v: string, r) => <Link href={`/customers/${r.id}`} title={v} style={省略}>{v}</Link> },
    { title: "状态", dataIndex: "状态", width: "18%", ellipsis: true, render: (v: string, r) => <span title={r.状态说明} style={省略}>{v}</span> },
    {
      // 超期的行除了底色，格子里也写「超期」（不靠颜色认），放最前免得窄屏被省略掉
      title: "挂起天数", key: "days", width: 204, ellipsis: true,
      render: (_: unknown, r) => {
        const 字 = `${r.超期 ? "超期 · " : ""}${r.挂起天数} 天 · ${r.挂起工作日} 个工作日`;
        return (
          <span className={r.超期 ? "tri-overdue-n" : undefined} style={省略} title={r.超期 ? `${字}：已超过 15 个工作日或 30 个自然日（哪条先到算哪条）` : 字}>
            {字}
          </span>
        );
      },
    },
    { title: "原负责人", dataIndex: "原负责人", width: "16%", ellipsis: true, render: (v: string) => <span title={`${v}（已停用）`} style={省略}>{v}（已停用）</span> },
    { title: "原直属上级", dataIndex: "原直属上级", width: "16%", ellipsis: true, render: (v: string | null) => <span title={v ?? undefined} style={省略}>{v ?? 空值符}</span> },
  ];
  return (
    <Card size="small" className="tri-pending" title={`待交接（${行们.length}）${超期数 ? ` · 超期 ${超期数}` : ""}`}>
      <Typography.Paragraph type="secondary" className="tri-pending-p">
        已停用账号名下、到了回收节点被标「待交接」的{b.customer}，和离职交接还在等接手人确认的{b.customer}。挂起超过 15 个工作日或 30 个自然日（哪条先到算哪条）的标红；交给谁在下面各人的卡片里交。
      </Typography.Paragraph>
      <Table<待交接行>
        size="small"
        rowKey="id"
        tableLayout="fixed"
        columns={列}
        dataSource={行们}
        rowClassName={(r) => (r.超期 ? "tri-overdue" : "")}
        pagination={行们.length > 20 ? { pageSize: 20, size: "small", showSizeChanger: false } : false}
      />
    </Card>
  );
}

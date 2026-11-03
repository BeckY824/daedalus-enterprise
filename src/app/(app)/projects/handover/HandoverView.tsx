"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { App, Button, Card, Empty, Select, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PageHead, UserCell } from "@/components/ui";
import { useBusiness } from "@/lib/business-client";
import type { 离职待交接, 交接客户, 交接项目 } from "@/lib/enterprise/offboard-handover";
import { deactivateUser } from "../../settings/actions";
import { 交接客户 as 交客户, 交接项目 as 交项目, 交接全部 } from "./actions";

type 人 = { id: string; name: string };

/**
 * 离职交接看板（11-03 B7-2）：一位离职成员一张卡，卡里列他名下还没交走的客户（项目模式再列不跟着客户走的项目），
 * 每行选接手人点「交」，或卡顶「全部交给」一个人（线索、渠道一起走）。接手人候选同公海分配（B2-7）。
 * 名字、客户名都可能很长：表格固定列宽、单元格省略号，1024 宽也不横向溢出
 */
export default function HandoverView({ 人们, 候选, 项目模式, 系统管理员, 下属 }: {
  人们: 离职待交接[];
  候选: 人[];
  项目模式: boolean;
  系统管理员: boolean;
  下属: 人[];
}) {
  const b = useBusiness();
  return (
    <div>
      <PageHead
        title="离职交接"
        subtitle={`已离职成员名下还没交走的${b.customer}${项目模式 ? "和项目" : ""}：${系统管理员 ? "系统管理员看全部" : "你是他们的直属上级"}，给每条选接手人，或一键全部交给一个人`}
      />
      {下属.length > 0 && <OffboardReport 下属={下属} />}
      {人们.length ? (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          {人们.map((p) => <PersonCard key={p.id} p={p} 候选={候选} 项目模式={项目模式} />)}
        </Space>
      ) : (
        <Card><Empty description="没有待交接的离职成员" /></Card>
      )}
    </div>
  );
}

const 省略 = { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

function PickTaker({ 候选, 不要, value, onChange, placeholder = "选接手人", style }: {
  候选: 人[]; 不要: string; value?: string; onChange: (v: string) => void; placeholder?: string; style?: React.CSSProperties;
}) {
  return (
    <Select
      showSearch
      optionFilterProp="label"
      placeholder={placeholder}
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
  const 名 = (id: string) => 候选.find((u) => u.id === id)?.name ?? "";

  async function 做(key: string, f: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) {
    if (忙) return;
    set忙(key);
    try {
      const r = await f();
      if (r.ok) { message.success(r.message); router.refresh(); } else message.error(r.error);
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

  const 接手列 = <T extends { id: string }>(kind: "c" | "p"): ColumnsType<T>[number] => ({
    title: "接手人",
    key: "to",
    width: 280,
    render: (_: unknown, r: T) => (
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
      content: `${段 || "名下剩下的"}，连同进行中的商机、没做完的计划和待办，一起交给 TA。已经签下的业绩、有结局的项目还算在「${p.name}」头上。`,
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
            直属上级：{p.上级 ?? "没填"}
          </Typography.Text>
        </div>
      }
    >
      {p.交接中 && (
        <Typography.Paragraph type="warning" style={{ fontSize: 13 }}>
          TA 还有一笔离职交接在等接手人确认：先在{b.customer}页「交接中」里撤回，再在这里交。
        </Typography.Paragraph>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <Typography.Text style={{ fontSize: 13 }}>全部交给</Typography.Text>
        <PickTaker 候选={候选} 不要={p.id} value={全部给} onChange={set全部给} style={{ width: 220 }} />
        <Button type="primary" disabled={p.交接中 || !全部给} loading={忙 === "all"} onClick={一键}>全部交给</Button>
        {其余 && <Typography.Text type="secondary" style={{ fontSize: 12 }}>另有 {其余}，「全部交给」时一起走</Typography.Text>}
      </div>
      {p.客户.length > 0 && (
        <Table<交接客户>
          size="small"
          rowKey="id"
          tableLayout="fixed"
          columns={客户列}
          dataSource={p.客户}
          pagination={p.客户.length > 20 ? { pageSize: 20, size: "small", showSizeChanger: false } : false}
          title={() => `${b.customer}（${p.客户.length}）${项目模式 ? "：交出去时上面的项目一起走" : ""}`}
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

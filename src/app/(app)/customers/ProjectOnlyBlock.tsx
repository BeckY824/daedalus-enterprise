"use client";

import { useRouter } from "next/navigation";
import { Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { RowLink } from "@/components/ui";
import { 有值 } from "@/lib/empty-value";
import type { 仅项目列表行 } from "@/lib/enterprise/project-only-list-rows";

const 一行 = (t: string | null | undefined) => (有值(t) ? <span title={t!}>{t}</span> : null);

/**
 * 客户列表第 1 页顶上的「仅项目」一小块（只负责项目的人：客户不归他、名下有他自己的项目；lib/enterprise/project-only-list-rows.ts）。
 * 和下面的客户表格分开：不能勾、没有行菜单、不进总数和导出；负责人、级别、客户状态、最近跟进几格空着（这些他看不到）。
 * 一行、省略号、悬停看全（dl-one-line + title，全站 TruncTip）；列宽按百分比，1024 / 1280 / 1366 都不横滚。点一行进受限客户详情
 */
export default function ProjectOnlyBlock({ 行们 }: { 行们: 仅项目列表行[] }) {
  const router = useRouter();
  if (!行们.length) return null;
  const 列: ColumnsType<仅项目列表行> = [
    {
      title: "客户", key: "name", ellipsis: true,
      render: (_: unknown, r) => (
        <span className="cust-ponly-name">
          <Tag className="cust-ponly-tag" title="这位客户不归你，你只负责其中的项目：客户资料只能看">仅项目</Tag>
          <RowLink href={`/customers/${r.id}`} className="link-strong" title={r.name}>{r.name}</RowLink>
        </span>
      ),
    },
    { title: "客户类型", key: "customerType", width: "11%", render: (_: unknown, r) => 一行(r.customerType) },
    { title: "地区", key: "region", width: "12%", render: (_: unknown, r) => 一行(r.地区) },
    {
      title: "当前节点", key: "projectNode", width: "12%",
      render: (_: unknown, r) => (r.当前节点 ? <Tag className="clamp-1 cust-node-tag" color={r.当前阶段 === "订单" ? "blue" : undefined} title={r.当前节点}>{r.当前节点}</Tag> : null),
    },
    { title: "项目数", key: "projectCount", width: "8%", render: (_: unknown, r) => r.项目数 },
    // 这几格他看不到，空着（不写「—」：不是「没有」，是不给看）
    { title: "负责人", key: "owner", width: "9%", render: () => null },
    { title: "级别", key: "level", width: "7%", render: () => null },
    { title: "客户状态", key: "custStatus", width: "10%", render: () => null },
    { title: "最近跟进", key: "lastFollowAt", width: "10%", render: () => null },
  ];
  return (
    <section className="cust-ponly dl-one-line" aria-label="仅项目的客户" data-testid="project-only-block">
      <div className="cust-ponly-h">
        <span>仅项目</span>
        <span className="muted">客户不归你、你负责其中的项目（{行们.length} 位，不计入下面的总数）</span>
      </div>
      <Table<仅项目列表行>
        rowKey="id"
        size="small"
        tableLayout="fixed"
        dataSource={行们}
        columns={列}
        pagination={false}
        onRow={(r) => ({
          onClick: (e) => {
            if ((e.target as HTMLElement).closest("a, button")) return;
            router.push(`/customers/${r.id}`);
          },
          style: { cursor: "pointer" },
        })}
      />
    </section>
  );
}

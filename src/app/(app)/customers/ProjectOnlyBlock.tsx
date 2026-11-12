"use client";

import { useRouter } from "next/navigation";
import { Tag } from "antd";
import { RowLink } from "@/components/ui";
import { 有值 } from "@/lib/empty-value";
import type { 仅项目列表行 } from "@/lib/enterprise/project-only-list-rows";

/** 一格：一行、放不下省略号、悬停看全文 */
const 格 = (t: string | number | null | undefined) => {
  const 字 = t == null ? null : String(t);
  return <span className="cust-ponly-c" role="cell" title={有值(字) ? 字! : undefined}>{有值(字) ? 字 : null}</span>;
};
/** 列头：和下面的格同一套网格列（globals.css .cust-ponly-r） */
const 列头 = ["客户", "客户类型", "地区", "当前节点", "项目数", "负责人", "级别", "客户状态", "最近跟进"];

/**
 * 客户列表第 1 页顶上的「仅项目」一小块（只负责项目的人：客户不归他、名下有他自己的项目；lib/enterprise/project-only-list-rows.ts）。
 * 行少（最多 50 位）、没有筛选 / 分页 / 勾选 / 列设置，不是又一个表格：一个简单列表，列宽按百分比（1024 / 1280 / 1366 都不横滚）。
 * 和下面的客户表格分开：不能勾、没有行菜单、不进总数和导出；负责人、级别、客户状态、最近跟进几格空着（这些他看不到）。点一行进受限客户详情
 */
export default function ProjectOnlyBlock({ 行们, 超了 = false }: { 行们: 仅项目列表行[]; 超了?: boolean }) {
  const router = useRouter();
  if (!行们.length) return null;
  return (
    <section className="cust-ponly" aria-label="仅项目的客户" data-testid="project-only-block">
      <div className="cust-ponly-h">
        <span>仅项目</span>
        <span className="muted">
          {超了
            ? `客户不归你、你负责其中的项目（前 ${行们.length} 位，更多请在看板里看；不计入下面的总数）`
            : `客户不归你、你负责其中的项目（${行们.length} 位，不计入下面的总数）`}
        </span>
      </div>
      <div className="cust-ponly-list" role="table" aria-label="仅项目的客户">
        <div className="cust-ponly-r cust-ponly-head" role="row">
          {列头.map((t) => <span key={t} className="cust-ponly-c" role="columnheader">{t}</span>)}
        </div>
        {行们.map((r) => (
          <div
            key={r.id}
            className="cust-ponly-r cust-ponly-row"
            role="row"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a, button")) return;
              router.push(`/customers/${r.id}`);
            }}
          >
            <span className="cust-ponly-c cust-ponly-name" role="cell">
              <Tag className="cust-ponly-tag" title="这位客户不归你，你只负责其中的项目：客户资料只能看">仅项目</Tag>
              <RowLink href={`/customers/${r.id}`} className="link-strong" title={r.name}>{r.name}</RowLink>
            </span>
            {格(r.customerType)}
            {格(r.地区)}
            <span className="cust-ponly-c" role="cell">
              {r.当前节点 ? <Tag className="clamp-1 cust-node-tag" color={r.当前阶段 === "订单" ? "blue" : undefined} title={r.当前节点}>{r.当前节点}</Tag> : null}
            </span>
            {格(r.项目数)}
            {/* 这几格他看不到，空着（不写「—」：不是「没有」，是不给看） */}
            {格(null)}{格(null)}{格(null)}{格(null)}
          </div>
        ))}
      </div>
    </section>
  );
}

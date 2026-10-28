"use client";

import { Select, Space } from "antd";
import { RowLink, PageHead, CustomerLink } from "@/components/ui";
import DataList, { type 列 } from "@/components/DataList";
import { useUrlFilters } from "@/lib/url-filters";
import { 成员选项, fmtDate, type 可选成员 } from "@/lib/utils";
import { 金额, 合计文字 } from "@/lib/currency";
import type { 订单行 } from "@/lib/order-db";
import { 订单比较, 一览顺序, 算汇总, type 订单分页 } from "@/lib/orders-paging";

/** 行名（登记给 AI 面板的那个）用客户名：问「Acme 那单」时 list_orders 按 customerName 查得到 */
type Row = 订单行;

/**
 * 订单一览（轻量版，2026-10-05 外贸客户建议）：客户要的列就是这几样——
 * 客户名称、订单号、付款方式、供应商名称、订单确认时间，再加金额和业务员。新确认的在前。
 * 12 个节点那一版 2026-10-28 随订单节点开关一起删了。
 *
 * 给了 分页（企业版单子多时，lib/orders-paging.ts）：rows 只是服务端排好的这一页，合计用服务端在全部上算的那份，
 * 翻页、排序走网址。没给：rows 是全部，照原来在浏览器里排、分页、算合计。
 */
export default function OrdersView({ rows, users, filters, 分页 }: { rows: 订单行[]; users: 可选成员[]; filters: { ownerId: string }; 分页?: 订单分页 }) {
  const { f, apply, 翻页, pending } = useUrlFilters("/orders", { ...filters, sort: 分页?.sort ?? "" }, 分页?.每页);
  const 行: Row[] = rows;

  const 汇总 = 分页?.汇总 ?? 算汇总(rows);
  /** 能排序的列：不分页时照原来在浏览器里排；分页时交给服务端，表头只显示现在按什么排 */
  const 排 = (k: keyof typeof 订单比较): Pick<列<Row>, "sorter" | "sortOrder"> =>
    分页 ? { sorter: true, sortOrder: 分页.sort === `${k}-asc` ? "ascend" : 分页.sort === `${k}-desc` ? "descend" : null } : { sorter: 订单比较[k] };

  const 轻列: 列<Row>[] = [
    {
      title: "订单号", key: "no", dataIndex: "no", width: 150, 常驻: true,
      render: (v: string, r) => <RowLink href={`/orders/${r.id}`} className="link-strong">{v}</RowLink>,
    },
    { title: "客户", key: "customerName", dataIndex: "customerName", width: 180, render: (v: string, r) => <CustomerLink id={r.customerId} name={v} company={r.customerCompany} logo={false} /> },
    { title: "金额", key: "amount", dataIndex: "amount", width: 130, render: (v: number, r) => <span style={{ fontWeight: 600 }}>{金额(v, r.currency)}</span> },
    { title: "付款方式", key: "payment", dataIndex: "payment", width: 130, render: (v: string | null) => v ?? <span className="muted">—</span> },
    { title: "供应商", key: "supplier", dataIndex: "supplier", width: 160, render: (v: string | null) => v ?? <span className="muted">—</span> },
    {
      title: "订单确认时间", key: "confirmedAt", dataIndex: "confirmedAt", width: 130,
      ...排("confirmed"),
      render: (v: string) => <span className="nowrap">{fmtDate(v)}</span>,
    },
    { title: "业务员", key: "ownerName", dataIndex: "ownerName", width: 100, 默认: users.length > 1 },
  ];

  return (
    <>
      <PageHead title="订单" subtitle="客户确认的每一单。订单执行的进展记在跟进里，挂上这张订单" />
      <DataList<Row>
        页="orders"
        列={轻列}
        行={分页 ? 行 : 一览顺序(行)}
        行链接={(r) => `/orders/${r.id}`}
        空库={汇总.单 === 0 && !f.ownerId}
        空态={{
          title: "还没有订单",
          hint: "商机点「转为订单」，金额和币种会带过来；也可以在客户页的「订单」里新建。之后每次跟进时挂上订单号，订单执行的过程就都在这张订单里。",
          demo: false,
        }}
        筛选={
          users.length > 1 ? (
            <Space>
              <Select
                style={{ width: 140 }}
                placeholder="全部业务员"
                allowClear
                value={f.ownerId || undefined}
                onChange={(v) => apply({ ownerId: v ?? "" })}
                options={成员选项(users)}
              />
            </Space>
          ) : undefined
        }
        汇总={
          汇总.单 > 0 ? (
            <div className="list-sum">全部筛选结果 · 共 {汇总.单} 单 · {合计文字(汇总.金额)}</div>
          ) : undefined
        }
        {...(分页 ? {
          分页: { 当前页: 分页.页, 每页: 分页.每页, 总数: 分页.总数, 翻页 },
          排序: (key: string, order: "ascend" | "descend" | null) => {
            if (key === "confirmedAt") apply({ sort: order === "ascend" ? "confirmed-asc" : order === "descend" ? "confirmed-desc" : "" });
          },
          加载中: pending,
        } : {})}
      />
    </>
  );
}

"use client";

import { Pagination, Tag } from "antd";
import LevelLetter from "@/components/LevelLetter";
import { 客户看板分列 } from "@/lib/enterprise/cust-attr";
import type { CustomerRow } from "./CustomerForm";

/**
 * 客户看板（U-客户-06）：一列一个客户属性（lib/enterprise/cust-attr.ts 客户看板分列），没填的进「未设置」、没人时不摆。
 * 列多（10 项起），沿用项目看板的 .pipe：等宽排、放不下折行，不横滚；有空列时空列收成 88 宽的窄条把地方让给有客户的列。
 * 卡片：客户名（整段显示，同项目看板 10-30）、级别字母、客户状态、负责人
 */
export default function CustomerBoard({ 行们, 字典, 加载中, 页, 每页, 总数, 翻页, 去 }: {
  行们: CustomerRow[];
  字典: { name: string; active: boolean }[];
  加载中: boolean;
  页: number;
  每页: number;
  总数: number;
  翻页: (页: number, 每页: number) => void;
  去: (id: string) => void;
}) {
  const 列们 = 客户看板分列(行们, (r) => r.customerAttr, 字典);
  const 有空列 = 列们.some((c) => c.行们.length === 0) && 列们.some((c) => c.行们.length > 0);
  return (
    <div className="pipe-wrap cust-board" aria-busy={加载中}>
      <div className="pipe" style={有空列 ? { display: "flex", flexWrap: "wrap", gap: "var(--s3)", alignItems: "start" } : undefined}>
        {列们.map((c) => {
          const 收 = 有空列 && c.行们.length === 0;
          return (
            <div key={c.key ?? "\u0000未设置"} className="pipe-col" aria-label={`${c.名}${c.停用 ? "（已停用）" : ""}，${c.行们.length} 位客户`}
              style={有空列 ? (收 ? { flex: "0 0 88px" } : { flex: "1 1 184px", minWidth: 0 }) : undefined}>
              <div className="pipe-h">
                <b className="clamp-1" title={c.名}>{c.名}</b>
                <span className="pipe-n">{c.行们.length}</span>
                {c.停用 && !收 && <Tag style={{ marginInlineEnd: 0 }}>停用</Tag>}
              </div>
              <div className="pipe-bar" style={{ background: c.key === null ? "var(--line-strong)" : "var(--brand)" }} />
              {c.行们.map((r) => (
                <div key={r.id} className="pipe-card" tabIndex={0} role="link" title={r.name} aria-label={`${r.name}，${r.salesOwnerName}`}
                  onClick={() => 去(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      去(r.id);
                    }
                  }}
                >
                  <div className="pipe-card-t fulltext">{r.name}</div>
                  <div className="pipe-card-m">
                    <span className="pipe-card-o cust-board-meta">
                      <LevelLetter level={r.extra?.level} 空={null} />
                      {r.custStatus && <span className="clamp-1" title={r.custStatus}>{r.custStatus}</span>}
                    </span>
                    <span className="pipe-card-o clamp-1" title={r.salesOwnerName}>{r.pool ? "公海" : r.salesOwnerName}</span>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {总数 > 每页 && (
        <div className="cust-board-page">
          <Pagination size="small" current={页} pageSize={每页} total={总数} showSizeChanger={false} onChange={(p) => 翻页(p, 每页)}
            showTotal={(t) => `共 ${t} 位，看板分的是这一页的 ${行们.length} 位`} />
        </div>
      )}
    </div>
  );
}

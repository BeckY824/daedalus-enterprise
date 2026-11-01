"use client";

import { Pagination, Tag } from "antd";
import LevelLetter from "@/components/LevelLetter";
import { 客户看板分列 } from "@/lib/enterprise/cust-attr";
import { 有值, 空显 } from "@/lib/empty-value";
import type { CustomerRow } from "./CustomerForm";

/**
 * 客户看板（U-客户-06）：一列一个客户属性（lib/enterprise/cust-attr.ts 客户看板分列），没填的（含导入占位的 "-"）进「—」那一列、没人时不摆（11-01）。
 * 列多（10 项起），沿用项目看板的 .pipe：列宽固定（一屏约 4 列），放不下在看板框里左右滑；0 位客户的属性列照常摆、写空态（11-01）。
 * 卡片：客户名（整段显示，同项目看板 10-30）、级别字母、客户状态、负责人；客户状态、负责人没填写「—」（lib/empty-value.ts）
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
  return (
    <div className="pipe-wrap cust-board" aria-busy={加载中}>
      <div className="pipe">
        {列们.map((c) => {
          return (
            <div key={c.key ?? "\u0000未设置"} className="pipe-col" aria-label={`${c.key === null ? "没填客户属性" : c.名}${c.停用 ? "（已停用）" : ""}，${c.行们.length} 位客户`}>
              <div className="pipe-h">
                <b className="clamp-1" title={c.名}>{c.名}</b>
                <span className="pipe-n">{c.行们.length}</span>
                {c.停用 && <Tag style={{ marginInlineEnd: 0 }}>停用</Tag>}
              </div>
              <div className="pipe-bar" style={{ background: c.key === null ? "var(--line-strong)" : "var(--brand)" }} />
              {c.行们.length === 0 && <div className="pipe-empty">这一类还没有客户</div>}
              {c.行们.map((r) => (
                <div key={r.id} className="pipe-card" tabIndex={0} role="link" title={r.name} aria-label={`${r.name}，${空显(r.salesOwnerName)}`}
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
                      {有值(r.custStatus) ? <span className="clamp-1" title={r.custStatus}>{r.custStatus}</span> : <span className="muted">{空显(null)}</span>}
                    </span>
                    <span className="pipe-card-o clamp-1" title={r.salesOwnerName}>{r.pool ? "公海" : 空显(r.salesOwnerName)}</span>
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

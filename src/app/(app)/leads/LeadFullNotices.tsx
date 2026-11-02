"use client";
/**
 * 企业版「都已满额」提醒（A8）：自动分配因能接的人都分满了没分出去，市场管理、总管理员在首页、线索页顶部看到这一条，
 * 看过自己关。数据和发提醒在 lib/enterprise/lead-full-notice.ts；没有提醒什么都不画。
 * 11-01（A10）同一处也摆「待分配」：新建线索选了自动分配没分出去，留在新线索等手动分
 */
import { useState } from "react";
import { Alert, Space } from "antd";
import { smartTime } from "@/lib/utils";
import type { 满额提醒 } from "@/lib/enterprise/lead-full-notice";
import { 关满额提醒 } from "./assign-actions";

/** 线索名太多时只列前几条，后面写「等 N 条」 */
const 列几条 = 5;

const 列名 = (x: 满额提醒) => `${x.线索.slice(0, 列几条).join("、")}${x.条数 > 列几条 ? ` 等 ${x.条数} 条` : ""}`;

export default function LeadFullNotices({ 提醒, style }: { 提醒: 满额提醒[]; style?: React.CSSProperties }) {
  const [关了, set关了] = useState<Set<string>>(new Set());
  const 还在 = 提醒.filter((x) => !关了.has(x.id));
  if (!还在.length) return null;
  return (
    <Space orientation="vertical" style={{ width: "100%", marginBottom: 16, ...style }}>
      {还在.map((x) => (
        <Alert
          key={x.id}
          type="warning"
          showIcon
          closable={{
            "aria-label": x.原因 === "待分配" ? "关闭这条待分配提醒" : "关闭这条满额提醒",
            onClose: () => {
              set关了((s) => new Set(s).add(x.id));
              void 关满额提醒(x.id);
            },
          }}
          title={x.原因 === "待分配" ? `待分配：${x.条数} 条新线索没自动分出去` : `自动分配：${x.条数} 条线索因都已满额没分出去`}
          description={x.原因 === "待分配"
            ? `${列名(x)}（${x.谁点的} ${smartTime(x.at)} 建的）。${x.为什么 ? `${x.为什么}。` : ""}线索留在新线索、没有负责人：去新线索手动分`
            : `${列名(x)}（${x.谁点的} ${smartTime(x.at)} 点的）。线索留在原处：找销售的上级调配额，或者手动分`}
        />
      ))}
    </Space>
  );
}

"use client";
import { useState, type ReactNode } from "react";
import { Alert, Button, Modal, Skeleton } from "antd";
import { CustomerLink } from "@/components/ui";
import type { 客户只读卡 } from "@/lib/enterprise/customer-readonly-card";
import { 打开客户只读卡Action } from "./readonly-card-actions";

const 灰字 = { color: "var(--text-muted)" } as const;

function 行({ 名, 值 }: { 名: string; 值: ReactNode }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0 12px", padding: "3px 0", minWidth: 0 }}>
      <span style={{ ...灰字, flex: "0 0 auto", minWidth: 64 }}>{名}</span>
      <span style={{ flex: "1 1 160px", minWidth: 0, overflowWrap: "anywhere" }}>{值}</span>
    </div>
  );
}

/** 卡里面那一块；挂靠批准后的只读卡（projects/attach）也用它，那边联系方式按申请人自己的项目给，说法另传 */
export function 卡内容({ 卡, 没给的说法 = "不在这位负责人的项目上，联系方式不显示" }: { 卡: 客户只读卡; 没给的说法?: string }) {
  const c = 卡.客户;
  const 资料: [string, string | null][] = [
    ["客户", c.name], ["简称", c.shortName], ["公司", c.school], ["客户类型", c.customerType], ["客户属性", c.customerAttr],
    ["所在地区", c.地区 || null], ["客户地址", c.addrDetail], ["官网", c.website],
  ];
  return (
    <div data-testid="customer-readonly-card" style={{ minWidth: 0 }}>
      {资料.filter(([, v]) => v?.trim()).map(([名, v]) => <行 key={名} 名={名} 值={v} />)}
      <div style={{ fontWeight: 500, margin: "12px 0 4px" }}>联系人</div>
      {!卡.联系人.length && <div style={灰字}>还没有联系人</div>}
      {卡.联系人.map((x, i) => (
        <div key={i} style={{ padding: "6px 0", borderTop: "1px solid var(--line)", minWidth: 0 }}>
          <div style={{ overflowWrap: "anywhere" }}>{x.name}{x.position && <span style={{ ...灰字, marginInlineStart: 8 }}>{x.position}</span>}</div>
          {x.号码们.map((m, j) => <行 key={j} 名={m.叫法} 值={m.value} />)}
          {!x.号码们.length && <div style={{ ...灰字, fontSize: "var(--fs-note)" }}>{x.给联系方式 ? "没留联系方式" : 没给的说法}</div>}
        </div>
      ))}
    </div>
  );
}

/** 项目详情「客户」那一格：只负责项目的人点客户名，弹只读卡（不是客户详情，也没有别的入口） */
export function CustomerReadonlyCard({ projectId, name, company }: { projectId: string; name: string; company?: string | null }) {
  const [开着, set开着] = useState(false);
  const [卡, set卡] = useState<客户只读卡 | null>(null);
  const [错, set错] = useState<string | null>(null);
  const 打开 = async () => {
    set开着(true);
    set卡(null);
    set错(null);
    const r = await 打开客户只读卡Action(projectId).catch(() => ({ ok: false as const, error: "没打开，网络可能断了，再点一次" }));
    if (r.ok) set卡(r.卡);
    else set错(r.error);
  };
  return (
    <>
      <CustomerLink id={null} name={name} company={company} 点={() => void 打开()} />
      <Modal open={开着} title="客户资料（只读）" footer={<Button onClick={() => set开着(false)}>关闭</Button>} onCancel={() => set开着(false)} destroyOnHidden>
        {错 ? <Alert type="warning" showIcon title={错} /> : 卡 ? <卡内容 卡={卡} /> : <Skeleton active paragraph={{ rows: 4 }} />}
      </Modal>
    </>
  );
}

"use client";

/**
 * 客户页「关联客户」卡片（企业版项目模式，2026-10-29，定稿 P5 待定 15）：手动挑一位 + 一句说明，两边客户页都看得到同一行。
 * 另一位我看不到（不在我的范围）：只露名字不给链接。改说明、取消都在这一行上就地做；动作在 link-actions.ts
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { App, Button, Input, Select, Space } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import InlineConfirm from "@/components/InlineConfirm";
import { 关联说明上限 } from "@/lib/enterprise/customer-v2";
import type { 关联一行 } from "@/lib/enterprise/customer-v2-db";
import { 搜客户, type 可挑客户 } from "./pick";
import { 关联客户, 改关联说明, 取消关联 } from "./link-actions";

/**
 * 起手：页头「关联客户」开的框里挂上时直接打开挑人那一行（10-31 R6）。
 * 不摆加：企业版客户页头已有「关联客户」，卡上不再摆「+」（10-31）
 */
export default function LinkedCustomers({ customerId, 关联们, 只读, 起手 = false, 不摆加 = false }: { customerId: string; 关联们: 关联一行[]; 只读: boolean; 起手?: boolean; 不摆加?: boolean }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [加着, set加着] = useState(false);
  const [候选, set候选] = useState<可挑客户[]>([]);
  const [搜着, set搜着] = useState(false);
  const [挑中, set挑中] = useState<string | undefined>();
  const [说明, set说明] = useState("");
  const [存着, set存着] = useState(false);
  /** 正在改说明的那一行 */
  const [改的, set改的] = useState<{ id: string; note: string } | null>(null);
  const 搜次 = useRef(0);
  const 计时 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const 已关联 = new Set(关联们.map((x) => x.otherId));

  function 搜(词: string) {
    const 次 = ++搜次.current;
    set搜着(true);
    void 搜客户(词)
      .then((rows) => {
        if (次 === 搜次.current) set候选(rows.filter((r) => r.id !== customerId && !已关联.has(r.id)));
      })
      .finally(() => {
        if (次 === 搜次.current) set搜着(false);
      });
  }

  function 开加() {
    set加着(true);
    set挑中(undefined);
    set说明("");
    搜("");
  }

  const 开过 = useRef(false);
  useEffect(() => {
    if (!起手 || 只读 || 开过.current) return;
    开过.current = true;
    开加();
  });

  async function 跑(做: () => Promise<{ ok: true } | { ok: false; error: string }>, 成了: string) {
    set存着(true);
    try {
      const r = await 做();
      if (!r.ok) return void message.error(r.error);
      message.success(成了);
      router.refresh();
      return true;
    } finally {
      set存着(false);
    }
  }

  return (
    <div className="rec-sec">
      <div className="rec-sec-t">
        <span>关联客户 {关联们.length > 0 && 关联们.length}</span>
        {!只读 && !加着 && !不摆加 && (
          <Button type="text" size="small" icon={<PlusOutlined />} onClick={开加} aria-label="关联一位客户" />
        )}
      </div>
      {关联们.length === 0 && !加着 && <div className="rec-empty">还没有关联客户</div>}
      {关联们.map((x) =>
        改的?.id === x.id ? (
          <Space.Compact key={x.id} style={{ display: "flex", marginBottom: 6 }}>
            <Input
              size="small"
              autoFocus
              value={改的.note}
              maxLength={关联说明上限}
              placeholder="一句话说明关系，如 同一集团"
              onChange={(e) => set改的({ id: x.id, note: e.target.value })}
              onPressEnter={() => void 跑(() => 改关联说明(x.id, customerId, 改的.note), "说明改好了").then((ok) => ok && set改的(null))}
              aria-label="关系说明"
            />
            <Button size="small" type="primary" loading={存着} onClick={() => void 跑(() => 改关联说明(x.id, customerId, 改的.note), "说明改好了").then((ok) => ok && set改的(null))}>存</Button>
            <Button size="small" onClick={() => set改的(null)}>取消</Button>
          </Space.Compact>
        ) : (
          <div key={x.id} className="rec-mini rec-mini-2">
            <span className="rec-mini-n" title={x.otherName}>
              {x.看得到 ? <Link href={`/customers/${encodeURIComponent(x.otherId)}`}>{x.otherName}</Link> : x.otherName}
            </span>
            <span className="rec-mini-sub">
              <span className="rec-mini-m" title={x.note ?? undefined}>{x.note ?? (x.看得到 ? "" : "不在你的范围，只显示名字")}</span>
            </span>
            {!只读 && (
              <span className="rec-mini-acts">
                <Button type="text" size="small" icon={<EditOutlined />} aria-label={`改和 ${x.otherName} 的关系说明`} onClick={() => set改的({ id: x.id, note: x.note ?? "" })} />
                <InlineConfirm 问="取消这条关联？" 做={async () => void (await 跑(() => 取消关联(x.id, customerId), "关联已取消"))}>
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={`取消和 ${x.otherName} 的关联`} />
                </InlineConfirm>
              </span>
            )}
          </div>
        ),
      )}
      {加着 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
          <Select
            showSearch
            size="small"
            autoFocus
            placeholder="搜客户名称 / 公司 / 电话"
            value={挑中}
            onChange={set挑中}
            filterOption={false}
            loading={搜着}
            notFoundContent={搜着 ? "搜索中…" : "没搜到（已关联的不再列出）"}
            onSearch={(v) => {
              if (计时.current) clearTimeout(计时.current);
              计时.current = setTimeout(() => 搜(v), 250);
            }}
            options={候选.map((c) => ({ value: c.id, label: c.附注 ? `${c.name}（${c.附注}）` : c.name }))}
            aria-label="挑一位要关联的客户"
          />
          <Input size="small" value={说明} maxLength={关联说明上限} placeholder="一句话说明关系（选填），如 同一集团" onChange={(e) => set说明(e.target.value)} aria-label="关系说明" />
          <Space size={6}>
            <Button
              size="small"
              type="primary"
              disabled={!挑中}
              loading={存着}
              onClick={() => void 跑(() => 关联客户(customerId, 挑中!, 说明), "关联好了").then((ok) => ok && set加着(false))}
            >
              关联
            </Button>
            <Button size="small" onClick={() => set加着(false)}>取消</Button>
          </Space>
        </div>
      )}
    </div>
  );
}

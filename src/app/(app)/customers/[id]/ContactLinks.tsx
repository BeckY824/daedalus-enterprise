"use client";

/**
 * 客户页联系人卡上的「挂靠」一段（企业版，2026-10-29 P13 第 1 条，迁移 090）：
 *   - 挂来的（主客户是别人）：一行「主客户 某某」+ 说明；能就地改说明、解除挂靠，主客户那头我能改时还能「改到这位名下」
 *   - 自家的：另外挂在哪几位客户上摆一行；能「挂到别的客户」「换主客户」
 * 看不到的客户只露名字不给链接。动作在 contact-link-actions.ts；挑客户照 LinkedCustomers 的写法（pick.ts 的 搜客户）
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { App, Button, Input, Select, Space } from "antd";
import InlineConfirm from "@/components/InlineConfirm";
import { 挂靠说明上限 } from "@/lib/enterprise/customer-v2";
import { 搜客户, type 可挑客户 } from "./pick";
import { 挂到客户, 改挂靠说明, 解除挂靠, 换主客户 } from "./contact-link-actions";
import type { ContactRow } from "./types";

type 结果 = { ok: true } | { ok: false; error: string };

const 客户链接 = (x: { id: string; name: string; 看得到: boolean }) =>
  x.看得到 ? <Link href={`/customers/${encodeURIComponent(x.id)}`}>{x.name}</Link> : <span title="不在你的范围，只显示名字">{x.name}</span>;

export default function ContactLinks({ customerId, c, 只读 }: { customerId: string; c: ContactRow; 只读: boolean }) {
  const { message } = App.useApp();
  const router = useRouter();
  /** 正在做的那件：挂到别的客户 / 换主客户 / 改说明 */
  const [做着, set做着] = useState<"挂" | "换" | "说明" | null>(null);
  const [候选, set候选] = useState<可挑客户[]>([]);
  const [搜着, set搜着] = useState(false);
  const [挑中, set挑中] = useState<string | undefined>();
  const [说明, set说明] = useState("");
  const [存着, set存着] = useState(false);
  const 搜次 = useRef(0);
  const 计时 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const 挂 = c.挂靠 ?? null;
  // 已经挂着的不再列出（含这位客户自己）
  const 挂着的 = new Set([customerId, ...(c.另挂 ?? []).map((x) => x.id), ...(挂 ? [挂.主客户Id] : [])]);

  function 搜(词: string) {
    const 次 = ++搜次.current;
    set搜着(true);
    void 搜客户(词)
      .then((rows) => {
        if (次 === 搜次.current) set候选(rows.filter((r) => !挂着的.has(r.id)));
      })
      .finally(() => {
        if (次 === 搜次.current) set搜着(false);
      });
  }

  function 开(件: "挂" | "换" | "说明") {
    set做着(件);
    set挑中(undefined);
    set说明(件 === "说明" ? (挂?.note ?? "") : "");
    if (件 !== "说明") 搜("");
  }

  async function 跑(做: () => Promise<结果>, 成了: string) {
    set存着(true);
    try {
      const r = await 做();
      if (!r.ok) return void message.error(r.error);
      message.success(成了);
      set做着(null);
      router.refresh();
    } finally {
      set存着(false);
    }
  }

  const 另挂 = c.另挂 ?? [];
  return (
    <>
      {挂 && (
        <div className="rec-contact-line">
          <span className="rec-contact-k">主客户</span>
          {客户链接({ id: 挂.主客户Id, name: 挂.主客户名, 看得到: 挂.主客户看得到 })}
          {挂.note && <span className="rec-contact-note">· {挂.note}</span>}
        </div>
      )}
      {另挂.length > 0 && (
        <div className="rec-contact-line">
          <span className="rec-contact-k">也挂在</span>
          {另挂.map((x, i) => (
            <span key={x.id}>
              {i > 0 && "、"}
              {客户链接(x)}
            </span>
          ))}
        </div>
      )}
      {!只读 && 做着 === null && (
        <div className="rec-contact-line rec-contact-links">
          {挂 ? (
            <>
              <Button type="link" size="small" onClick={() => 开("说明")}>{挂.note ? "改说明" : "加说明"}</Button>
              {挂.能改 && (
                <InlineConfirm 问={`把主客户改成这位？原主客户「${挂.主客户名}」那边仍挂着`} 是="改" 做={() => 跑(() => 换主客户(c.id, customerId), "主客户改好了")}>
                  <Button type="link" size="small">改到这位名下</Button>
                </InlineConfirm>
              )}
              <InlineConfirm 问="从这位客户上解除？联系人本身不删" 是="解除" 做={() => 跑(() => 解除挂靠(挂.linkId), "已解除挂靠")}>
                <Button type="link" size="small" danger>解除挂靠</Button>
              </InlineConfirm>
            </>
          ) : (
            <>
              <Button type="link" size="small" onClick={() => 开("挂")}>挂到别的客户</Button>
              <Button type="link" size="small" onClick={() => 开("换")}>换主客户</Button>
            </>
          )}
        </div>
      )}
      {做着 === "说明" && 挂 && (
        <Space.Compact className="rec-contact-form" style={{ display: "flex" }}>
          <Input
            size="small"
            autoFocus
            value={说明}
            maxLength={挂靠说明上限}
            placeholder="在这位客户这边的职位 / 关系，如 采购对接"
            onChange={(e) => set说明(e.target.value)}
            onPressEnter={() => void 跑(() => 改挂靠说明(挂.linkId, 说明), "说明改好了")}
            aria-label="职位 / 关系说明"
          />
          <Button size="small" type="primary" loading={存着} onClick={() => void 跑(() => 改挂靠说明(挂.linkId, 说明), "说明改好了")}>存</Button>
          <Button size="small" onClick={() => set做着(null)}>取消</Button>
        </Space.Compact>
      )}
      {(做着 === "挂" || 做着 === "换") && (
        <div className="rec-contact-form" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Select
            showSearch
            size="small"
            autoFocus
            placeholder="搜客户名称 / 公司 / 电话"
            value={挑中}
            onChange={set挑中}
            filterOption={false}
            loading={搜着}
            notFoundContent={搜着 ? "搜索中…" : "没搜到（已挂着的不再列出）"}
            onSearch={(v) => {
              if (计时.current) clearTimeout(计时.current);
              计时.current = setTimeout(() => 搜(v), 250);
            }}
            options={候选.map((x) => ({ value: x.id, label: x.附注 ? `${x.name}（${x.附注}）` : x.name }))}
            aria-label={做着 === "挂" ? `挑一位客户，把 ${c.name} 挂上去` : `挑 ${c.name} 的新主客户`}
          />
          {做着 === "挂" ? (
            <Input size="small" value={说明} maxLength={挂靠说明上限} placeholder="在那位客户那边的职位 / 关系（选填）" onChange={(e) => set说明(e.target.value)} aria-label="职位 / 关系说明" />
          ) : (
            <div className="rec-field-empty" style={{ fontSize: "var(--fs-note)" }}>号码跟着去新主客户，这位客户这边改成挂着</div>
          )}
          <Space size={6}>
            <Button
              size="small"
              type="primary"
              disabled={!挑中}
              loading={存着}
              onClick={() => void (做着 === "挂" ? 跑(() => 挂到客户(c.id, 挑中!, 说明), "挂好了") : 跑(() => 换主客户(c.id, 挑中!), "主客户换好了"))}
            >
              {做着 === "挂" ? "挂上" : "换"}
            </Button>
            <Button size="small" onClick={() => set做着(null)}>取消</Button>
          </Space>
        </div>
      )}
    </>
  );
}

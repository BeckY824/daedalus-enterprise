"use client";

/**
 * 客户页联系人卡上的「挂靠」一段（企业版，2026-10-29 P13 第 1 条，迁移 090）：
 *   - 挂来的（主客户是别人）：一行「主客户 某某」+ 说明；能就地改说明、解除挂靠，主客户那头我能改时还能「改到这位名下」
 *   - 自家的：另外挂在哪几位客户上摆一行；能「挂到别的客户」「换主客户」
 * 看不到的客户只露名字不给链接。动作在 contact-link-actions.ts；挑客户照 LinkedCustomers 的写法（pick.ts 的 搜客户）
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LinkPending } from "@/components/NavProgress";
import { Button, Dropdown, Input, Select, Space, type MenuProps } from "antd";
import { MoreOutlined } from "@ant-design/icons";
import InlineConfirm from "@/components/InlineConfirm";
import { 挂靠说明上限 } from "@/lib/enterprise/customer-v2";
import { 搜客户, type 可挑客户 } from "./pick";
import { 挂到客户, 改挂靠说明, 解除挂靠, 换主客户 } from "./contact-link-actions";
import type { ContactRow } from "./types";

type 结果 = { ok: true } | { ok: false; error: string };

const 客户链接 = (x: { id: string; name: string; 看得到: boolean }) =>
  x.看得到 ? <Link href={`/customers/${encodeURIComponent(x.id)}`}>{x.name}<LinkPending /></Link> : <span title="不在你的范围，只显示名字">{x.name}</span>;

/**
 * 头 / children（设计语言 D3 · M4-c，客户页联系人一组）：给了 头 就把「挂到别的客户 / 换主客户 / 改说明 / 改到这位名下 / 解除挂靠」
 * 收进一颗常显的「⋯」交给 头 摆在组头右端，不再在卡上摆一排蓝链接；children 是组里那几行，挂靠的行、就地填的格子接在它们后面。
 * 「改到这位名下」「解除挂靠」点了照旧就地问一句再做（不弹框）
 */
export default function ContactLinks({ customerId, c, 只读, 头, children, 合成, 合成灰 }: {
  customerId: string; c: ContactRow; 只读: boolean; 头?: (更多: ReactNode) => ReactNode; children?: ReactNode;
  /** 「和另一位合成」（合并客户第一批，11-25）：给了才摆，点了交给客户页开框（MergeHost）；挂靠过来的不给 */
  合成?: () => void;
  /** 「和另一位合成」摆着、置灰的原因（12-02：挂靠过来的、客户只有一位联系人）：电脑悬停看（title），手机（≤767）没有悬停，灰项下面一行小字（merge.css .mrg-gray-note；merge.css 随 MergeHost 进客户页，没 合并口 就没这一项）。
   *  给了 合成 就不看这个；两个都没给（没权、只读）照旧不摆这一项。服务端合成照旧拦 */
  合成灰?: string;
}) {
  /** 做没做成就地写一行（原型 g.notice，不弹顶部提示）：错的 role=alert 留 6 秒，成了 role=status 留 3 秒 */
  const [话, set话] = useState<{ 话: string; 错?: boolean } | null>(null);
  useEffect(() => {
    if (!话) return;
    const t = setTimeout(() => set话(null), 话.错 ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [话]);
  const router = useRouter();
  /** 正在做的那件：挂到别的客户 / 换主客户 / 改说明 */
  const [做着, set做着] = useState<"挂" | "换" | "说明" | "改到" | "解除" | null>(null);
  const [候选, set候选] = useState<可挑客户[]>([]);
  const [搜着, set搜着] = useState(false);
  const [挑中, set挑中] = useState<string | undefined>();
  const [没挑, set没挑] = useState(false);
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

  function 开(件: "挂" | "换" | "说明" | "改到" | "解除") {
    set做着(件);
    if (件 === "改到" || 件 === "解除") return;
    set挑中(undefined);
    set没挑(false);
    set说明(件 === "说明" ? (挂?.note ?? "") : "");
    if (件 !== "说明") 搜("");
  }

  async function 跑(做: () => Promise<结果>, 成了: string) {
    set存着(true);
    try {
      const r = await 做();
      if (!r.ok) { set话({ 话: r.error, 错: true }); return r; }
      set话({ 话: 成了 });
      set做着(null);
      router.refresh();
    } finally {
      set存着(false);
    }
  }

  const 另挂 = c.另挂 ?? [];
  const 合成项: NonNullable<MenuProps["items"]> = 合成
    ? [{ type: "divider" as const, key: "d2" }, { key: "合成", label: "和另一位合成" }]
    : 合成灰
      ? [{ type: "divider" as const, key: "d2" }, {
          key: "合成", disabled: true,
          label: <div className="menu-2l" title={合成灰}><div>和另一位合成</div><div className="menu-2l-note mrg-gray-note">{合成灰}</div></div>,
        }]
      : [];
  const 菜单项: NonNullable<MenuProps["items"]> = 只读
    ? []
    : 挂
      ? [
          { key: "说明", label: 挂.note ? "改说明" : "加说明" },
          ...(挂.能改 ? [{ key: "改到", label: "改到这位名下" }] : []),
          { type: "divider" as const, key: "d" },
          { key: "解除", label: "解除挂靠", danger: true },
          ...合成项,
        ]
      : [
          { key: "挂", label: "挂到别的客户" },
          { key: "换", label: "换主客户" },
          ...合成项,
        ];
  const 更多 = 头 && 菜单项.length > 0 && (
    <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items: 菜单项, onClick: ({ key }) => (key === "合成" ? 合成?.() : 开(key as "挂" | "换" | "说明" | "改到" | "解除")) }}>
      <Button type="text" size="small" className="rec-contact-menu" icon={<MoreOutlined />} aria-label={`联系人 ${c.name || "—"} 的更多操作`} />
    </Dropdown>
  );
  const 问 = 做着 === "改到" && 挂 ? `把主客户改成这位？原主客户「${挂.主客户名}」那边仍挂着` : 做着 === "解除" ? "从这位客户上解除？联系人本身不删" : null;
  return (
    <>
      {头?.(更多)}
      {children}
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
      {问 && 挂 && (
        <div className="rec-contact-form rec-contact-ask" role="group" aria-label={问}>
          <span className="rec-contact-ask-t">{问}</span>
          <Space size={6}>
            <Button size="small" type="primary" danger={做着 === "解除"} loading={存着}
              onClick={() => void (做着 === "解除" ? 跑(() => 解除挂靠(挂.linkId), "已解除挂靠") : 跑(() => 换主客户(c.id, customerId), "主客户改好了"))}>
              {做着 === "解除" ? "解除" : "改"}
            </Button>
            <Button size="small" onClick={() => set做着(null)}>取消</Button>
          </Space>
        </div>
      )}
      {!头 && !只读 && 做着 === null && (
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
        /* 设计语言 D3 · M4-c（D03 / D05）：就地填，格子 32 高、上面带标签；「挂上」一直能点，没挑客户点了再标红说原因 */
        <div className="rec-contact-form rec-contact-pick">
          <label className="rec-contact-fl is-req" htmlFor={`pick-${c.id}`}>{做着 === "挂" ? "挂到哪位客户" : "新的主客户"}</label>
          <Select
            id={`pick-${c.id}`}
            showSearch
            autoFocus
            status={没挑 ? "error" : undefined}
            placeholder="搜客户名称 / 公司 / 号码"
            value={挑中}
            onChange={(v) => { set挑中(v); set没挑(false); }}
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
          {没挑 && <div className="rec-contact-err" role="alert">先挑一位客户</div>}
          {做着 === "挂" ? (
            <>
              <label className="rec-contact-fl" htmlFor={`note-${c.id}`}>在那位客户那边的职务</label>
              <Input id={`note-${c.id}`} value={说明} maxLength={挂靠说明上限} placeholder="如 采购经理（选填）" onChange={(e) => set说明(e.target.value)} />
            </>
          ) : (
            <div className="rec-field-empty" style={{ fontSize: "var(--fs-note)" }}>号码跟着去新主客户，这位客户这边改成挂着</div>
          )}
          <Space size={8}>
            <Button
              size="small"
              type="primary"
              loading={存着}
              onClick={() => {
                if (!挑中) { set没挑(true); return; }
                void (做着 === "挂" ? 跑(() => 挂到客户(c.id, 挑中, 说明), "挂好了") : 跑(() => 换主客户(c.id, 挑中), "主客户换好了"));
              }}
            >
              {做着 === "挂" ? "挂上" : "换"}
            </Button>
            <Button size="small" onClick={() => { set做着(null); set没挑(false); }}>取消</Button>
          </Space>
        </div>
      )}
      {话 && <div className={话.错 ? "cd-task-err" : "rec-plan-said"} role={话.错 ? "alert" : "status"}>{话.话}</div>}
    </>
  );
}

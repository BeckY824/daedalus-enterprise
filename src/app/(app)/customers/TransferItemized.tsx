"use client";
/**
 * 客户转让框里 12-22 新增的两块（原型场景 ①「客户转让」，判定页 二-3、二-4、二-9）：
 *   逐项选 —— 上级 / 条线总管理 / 系统管理员转客户时，列出同事在推的项目（项目名、负责人、阶段，不显示金额），
 *             逐项「保留原负责人」（默认）/「随客户转」，有「全部随客户转」；
 *   原因   —— 一句话必填（客户原话摘要），下面一行自动带上最近一次跟进和重复咨询次数，发起人、时间、原因一起留痕。
 * 负责人本人转客户时服务端不给这两块（预览里没有 要说明），同事在推的项目一律不带，只写一句说明。
 * 电脑详情的 TransferBox 和列表的 TransferDialog 共用，样式沿用 .csq-chip / .cd-transfer-mut，不加新类。
 */
import { Input } from "antd";
import { 自动带上话, 转让说明上限, type 转走项目预览 } from "@/lib/carry-over";

export type 逐项选择 = Record<string, "keep" | "go">;

/** 打开 / 换了接手人：全部保留原负责人（默认） */
export function 默认选(p: 转走项目预览 | null | undefined): 逐项选择 {
  return Object.fromEntries((p?.同事在推 ?? []).map((x) => [x.id, "keep" as const]));
}

/** 交给服务端的：勾了「随客户转」的项目 id */
export function 随转的(选: 逐项选择): string[] {
  return Object.entries(选).filter(([, v]) => v === "go").map(([id]) => id);
}

const 省略: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 };

export function 逐项选块({ 预览, 选, 改, 忙 }: { 预览: 转走项目预览 | null | undefined; 选: 逐项选择; 改: (n: 逐项选择) => void; 忙: boolean }) {
  const 们 = 预览?.同事在推 ?? [];
  if (!预览?.要说明 || !们.length) return null;
  const 全转 = 们.every((p) => 选[p.id] === "go");
  return (
    <div data-testid="transfer-itemized" role="group" aria-label="同事在推的项目 · 逐项选">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <b>同事在推的项目 · 逐项选</b>
        <span style={{ flex: 1 }} />
        <button type="button" className="csq-chip" disabled={忙} data-testid="transfer-itemized-all"
          onClick={() => 改(Object.fromEntries(们.map((p) => [p.id, 全转 ? "keep" : "go"])) as 逐项选择)}>
          {全转 ? "全部保留原负责人" : "全部随客户转"}
        </button>
      </div>
      {们.map((p) => {
        const 转 = 选[p.id] === "go";
        return (
          <div key={p.id} data-testid="transfer-itemized-row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
            <div style={{ flex: 1, ...省略 }}>
              <span style={省略} title={p.项目}>{p.项目}</span>
              <div className="cd-transfer-mut" style={省略} title={`${p.负责人} · ${p.阶段}`}>{p.负责人} · {p.阶段}</div>
            </div>
            <div className="csq-chips" role="radiogroup" aria-label={p.项目} style={{ flex: "none" }}>
              <button type="button" role="radio" aria-checked={!转} className="csq-chip" disabled={忙} onClick={() => 改({ ...选, [p.id]: "keep" })}>保留原负责人</button>
              <button type="button" role="radio" aria-checked={转} className="csq-chip" disabled={忙} onClick={() => 改({ ...选, [p.id]: "go" })}>随客户转</button>
            </div>
          </div>
        );
      })}
      <div className="cd-transfer-mut">
        随客户转的，项目负责人换成接手人，已计提的提成留在原负责人名下、未计提的随项目走；保留的不动。两边的同事都会收到通知。
      </div>
    </div>
  );
}

export function 说明框({ 预览, 值, 改, 忙, onEnter }: { 预览: 转走项目预览 | null | undefined; 值: string; 改: (s: string) => void; 忙: boolean; onEnter?: () => void }) {
  if (!预览?.要说明) return null;
  return (
    <div data-testid="transfer-why">
      <label className="csq-why-h" htmlFor="transfer-why-input">转让原因（必填，写进变更历史）</label>
      <Input.TextArea
        id="transfer-why-input"
        aria-label="转让原因"
        value={值}
        maxLength={转让说明上限}
        showCount
        autoSize={{ minRows: 2, maxRows: 4 }}
        disabled={忙}
        placeholder="一句话，写客户原话摘要。例如：销售甲连续两次未跟进重复咨询"
        onChange={(e) => 改(e.target.value)}
        onPressEnter={(e) => { if (e.ctrlKey || e.metaKey) onEnter?.(); }}
      />
      {预览.最近跟进 !== undefined && <div className="cd-transfer-mut">{自动带上话(预览)}</div>}
    </div>
  );
}

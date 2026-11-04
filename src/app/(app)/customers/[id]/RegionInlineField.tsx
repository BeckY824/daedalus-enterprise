"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { App } from "antd";
import AddressInput from "@/components/AddressInput";
import { 拼地址, type 客户地址 } from "@/lib/enterprise/customer-v2";
import { 有值, 空值符 } from "@/lib/empty-value";
import { 只读上下文, 只能看的格上下文 } from "./read-only";
import { patchCustomerRegion } from "../actions";

const 同 = (a: 客户地址, b: 客户地址) => 拼地址(a) === 拼地址(b) && (a.addrCountry ?? "") === (b.addrCountry ?? "");

/**
 * 客户详情「所在地区」就地改（11-04 用户：所有字段点了直接改，不点「编辑全部」）。
 * 国家 / 省 / 市 / 区县四格一起改、一起存，和新建客户同一个地址组件；节奏和 InlineField 一样：
 * 点到这一格外面（下拉浮层不算）或回车就存，Esc 放弃。
 */
export default function RegionInlineField({ customerId, value, 空时横线 = false }: { customerId: string; value: 客户地址; 空时横线?: boolean }) {
  const router = useRouter();
  const { message } = App.useApp();
  const 权限挡 = useContext(只能看的格上下文).includes("addrCountry");
  const 只读 = useContext(只读上下文) || 权限挡;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<客户地址>(value);
  const [saving, setSaving] = useState(false);
  const 最新 = useRef(value);
  const 交过了 = useRef(false);
  const 框 = useRef<HTMLDivElement>(null);

  function 开始() {
    交过了.current = false;
    最新.current = value;
    setDraft(value);
    setEditing(true);
  }
  function 放弃() {
    交过了.current = true;
    setDraft(value);
    setEditing(false);
  }
  async function commit() {
    if (交过了.current) return;
    交过了.current = true;
    setEditing(false);
    const next = 最新.current;
    if (同(next, value)) return;
    setSaving(true);
    const res = await patchCustomerRegion(customerId, next);
    setSaving(false);
    if (!res.ok) {
      message.error(res.error);
      setDraft(value);
      return;
    }
    router.refresh();
  }

  // 点到这一格外面就存；国家下拉的浮层挂在 body 上，点它不算「外面」
  useEffect(() => {
    if (!editing) return;
    const 按下 = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || 框.current?.contains(t) || t.closest(".ant-select-dropdown")) return;
      void commit();
    };
    document.addEventListener("mousedown", 按下);
    return () => document.removeEventListener("mousedown", 按下);
    // commit 每次渲染都是新函数，读的是 ref，不用跟着重挂
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const 文字 = 拼地址(value);
  if (!editing) {
    return (
      <div
        className="rec-field"
        data-field="addrCountry"
        {...(只读
          ? { style: { cursor: "default" }, ...(权限挡 ? { title: "你的角色只能看「所在地区」，改不了（设置 → 组织架构 → 字段权限）" } : {}) }
          : { onClick: 开始, role: "button", tabIndex: 0, onKeyDown: (e: React.KeyboardEvent) => e.key === "Enter" && 开始(), "aria-label": "编辑所在地区" })}
      >
        <div className="rec-field-k">所在地区</div>
        <div className={`rec-field-v is-line${有值(文字) ? "" : " rec-field-empty"}${saving ? " rec-field-saving" : ""}`} title={!有值(文字) && 空时横线 && !只读 ? "点击填写" : undefined}>
          {有值(文字) ? 文字 : 只读 || 空时横线 ? 空值符 : "点击填写"}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={框}
      className="rec-field rec-field-editing"
      data-field="addrCountry"
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Escape") return 放弃();
        // 国家下拉里回车是选项用的：等一拍，选中的值先进草稿再存
        if (e.key === "Enter") setTimeout(() => void commit(), 0);
      }}
    >
      <div className="rec-field-k">所在地区</div>
      <div style={{ minWidth: 0 }}>
        <AddressInput
          value={draft}
          onChange={(a) => {
            const v = { ...最新.current, ...a };
            最新.current = v;
            setDraft(v);
          }}
        />
        <div className="rec-field-hint">回车或点别处保存 · Esc 放弃</div>
      </div>
    </div>
  );
}

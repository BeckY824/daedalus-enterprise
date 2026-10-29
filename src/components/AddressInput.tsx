"use client";

import { AutoComplete, Input } from "antd";
import { 国家候选 } from "@/lib/customer-extra";
import { 国内叫法, 是国内, 地址每格上限, type 客户地址 } from "@/lib/enterprise/customer-v2";

/**
 * 地址四格（企业版，和客户地址同一套：customer-v2.ts 规整地址 / 拼地址）：国家/地区 → 省 → 市 → 区县级市，都不必填。
 * 国家空着或是国内：摆省 / 市 / 区县；国外：只摆城市（省、区县存的时候也会被 规整地址 清掉）。
 * 国家能选能填：候选同客户表单（customer-extra.ts 国家候选，「中国」放最前）。
 * 受控组件（value / onChange 整套四格），项目编辑框直接用；客户表单（CustomerForm）那套 Form.Item 写法同一份候选和摆法，以后可以换成这个
 */
export const 地址国家选项 = [{ value: 国内叫法 }, ...国家候选.map((g) => ({ label: g.组, options: g.国家.filter((x) => x !== 国内叫法).map((x) => ({ value: x })) }))];
export const 地址国家过滤 = (输入: string, o?: { value?: unknown }) => String(o?.value ?? "").toLowerCase().includes(输入.toLowerCase());
/** 摆不摆省、区县：国家空着（填了省市的当国内）或是国内 */
export const 国内摆法 = (country: string | null | undefined) => !country?.trim() || 是国内(country);

export const 空地址: 客户地址 = { addrCountry: null, addrProvince: null, addrCity: null, addrDistrict: null };

export default function AddressInput({ value, onChange, disabled }: { value: 客户地址; onChange: (v: 客户地址) => void; disabled?: boolean }) {
  const 国内 = 国内摆法(value.addrCountry);
  const 改 = (k: keyof 客户地址, v: string | undefined) => onChange({ ...value, [k]: v ? v : null });
  // 四格一行，窄了折行（编辑框 520 宽也摆得下四格，每格至少 96px）；国外城市占两份
  const 格 = (份: number): React.CSSProperties => ({ flex: `${份} 1 0`, minWidth: 96 });
  return (
    <div className="addr-input" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <AutoComplete
        style={格(1)}
        aria-label="国家/地区"
        allowClear
        disabled={disabled}
        placeholder={国内叫法}
        value={value.addrCountry ?? undefined}
        options={地址国家选项}
        filterOption={(输入, o) => 地址国家过滤(输入, o as { value?: unknown } | undefined)}
        onChange={(v?: string) => 改("addrCountry", v)}
      />
      {国内 && <Input style={格(1)} aria-label="省" placeholder="省，如 广东省" maxLength={地址每格上限} disabled={disabled} value={value.addrProvince ?? ""} onChange={(e) => 改("addrProvince", e.target.value)} />}
      <Input style={格(国内 ? 1 : 2)} aria-label="市" placeholder={国内 ? "市，如 深圳市" : "城市，如 Los Angeles"} maxLength={地址每格上限} disabled={disabled} value={value.addrCity ?? ""} onChange={(e) => 改("addrCity", e.target.value)} />
      {国内 && <Input style={格(1)} aria-label="区县" placeholder="区县，如 南山区" maxLength={地址每格上限} disabled={disabled} value={value.addrDistrict ?? ""} onChange={(e) => 改("addrDistrict", e.target.value)} />}
    </div>
  );
}

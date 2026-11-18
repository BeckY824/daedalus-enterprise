"use client";

/**
 * 新建线索弹窗（建档向导）新客户的客户地址三格：国家地区、省、市（审核 11-18 P1-2：原来只有项目所在地，客户地址全空，
 * 客户列表「国家 / 地区」筛不到，分配方向只能靠项目所在地或电话猜）。
 * 写法照新建客户页（CustomerForm 地址那几格）：国家能选能填、空着或是中国摆省、国外只摆城市；存的时候走 saveCustomer 企业资料 → 规整地址，
 * 分配方向（客户区域 → 项目所在地 → 电话 → 本人事业部）先看这几格。单独成一个文件，不碰 CustomerForm
 */
import { AutoComplete, Input } from "antd";
import { 地址国家选项, 地址国家过滤, 国内摆法 } from "@/components/AddressInput";
import { 国内叫法, 地址叫法, 地址每格上限, type 客户地址 } from "@/lib/enterprise/customer-v2";

export type 向导客户地址 = Pick<客户地址, "addrCountry" | "addrProvince" | "addrCity">;

/** 交给 saveCustomer 企业资料 / 分配方向的三格：全空 = null（不交）；国外不交省（同新建客户页，国外只记国家 + 城市） */
export function 向导客户地址值(a: Partial<向导客户地址> | null | undefined): 向导客户地址 | null {
  const 格 = (x: string | null | undefined) => (x ?? "").trim() || null;
  const 国 = 格(a?.addrCountry), 省 = 格(a?.addrProvince), 市 = 格(a?.addrCity);
  if (!国 && !省 && !市) return null;
  return { addrCountry: 国, addrProvince: 国内摆法(国) ? 省 : null, addrCity: 市 };
}

export default function WizardCustomerAddress({ value, onChange }: { value: Partial<向导客户地址> | undefined; onChange: (v: 向导客户地址) => void }) {
  const 现 = { addrCountry: value?.addrCountry ?? null, addrProvince: value?.addrProvince ?? null, addrCity: value?.addrCity ?? null };
  const 国内 = 国内摆法(现.addrCountry);
  const 改 = (k: keyof 向导客户地址, v: string | undefined) => onChange({ ...现, [k]: v ? v : null });
  return (
    <>
      <label className="cr-field">
        <span className="cr-label">{地址叫法.addrCountry}</span>
        <AutoComplete
          className="cr-full"
          aria-label="客户国家地区"
          allowClear
          placeholder={国内叫法}
          value={现.addrCountry ?? undefined}
          options={地址国家选项}
          filterOption={(输入, o) => 地址国家过滤(输入, o as { value?: unknown } | undefined)}
          onChange={(v?: string) => 改("addrCountry", v)}
        />
      </label>
      {国内 && (
        <label className="cr-field">
          <span className="cr-label">{地址叫法.addrProvince}</span>
          <Input aria-label="客户省" placeholder="如 广东省" maxLength={地址每格上限} value={现.addrProvince ?? ""} onChange={(e) => 改("addrProvince", e.target.value)} />
        </label>
      )}
      <label className="cr-field">
        <span className="cr-label">{地址叫法.addrCity}</span>
        <Input aria-label="客户市" placeholder={国内 ? "如 深圳市" : "如 Los Angeles"} maxLength={地址每格上限} value={现.addrCity ?? ""} onChange={(e) => 改("addrCity", e.target.value)} />
      </label>
    </>
  );
}

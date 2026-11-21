"use client";

import { useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Select, Space } from "antd";
import { EditOutlined, MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import CopyValue from "@/components/CopyValue";
import { 空值符 } from "@/lib/empty-value";
import { 号码上限, 每人最多号码 } from "@/lib/enterprise/customer-v2";
import { saveCustomerNumbers } from "../actions";
import { 只读上下文, 只能看的格上下文, 资料改挡上下文 } from "./read-only";
import { useIsNowSkin } from "@/lib/use-skin";

type 一行 = { kind: string; value: string };
/** 号码类的几种给复制键（同联系人卡：手机、座机；客户本身的号还常有 WhatsApp、传真） */
const 带复制键 = new Set(["phone", "landline", "whatsapp", "fax"]);
type 种类 = { 名: string; kind: string; active: boolean };

/**
 * 客户资料卡上客户本身的号码（11-17）：联系方式子表里 contactId 空的那几行（导入、建档时记在客户身上的座机、WhatsApp、第二个手机……）。
 * 平时每个号一行「类型　号码」，和别的格子一样一行放不下打省略号；点一下进编辑：「类型 + 号码」几行，同联系人卡，加、改、删后点保存。
 * 电话（第一个手机）不在这里，照旧是上面「电话」那一格；电话空着时这里的第一个手机会升成电话。
 * 校验、查重、删光了拦都在服务端（saveCustomerNumbers），没存上原因写在这一块下面（role=alert），不弹顶部提示
 */
export default function CustomerNumbers({ customerId, 号码们, 号码种类 }: { customerId: string; 号码们: 一行[]; 号码种类: 种类[] }) {
  const router = useRouter();
  const 权限挡 = useContext(只能看的格上下文).includes("phone");
  const 改挡 = useContext(资料改挡上下文)?.话 ?? null;
  const 只读 = useContext(只读上下文) || 权限挡 || !!改挡;
  const 新样 = useIsNowSkin();
  const [编辑, set编辑] = useState(false);
  const [草稿, set草稿] = useState<一行[]>([]);
  const [存着, set存着] = useState(false);
  const [错, set错] = useState<string | null>(null);
  const 叫法 = (kind: string) => 号码种类.find((x) => x.kind === kind)?.名 ?? (kind.startsWith("custom:") ? kind.slice(7) : kind);
  const 默认种类 = 号码种类.find((x) => x.active)?.kind ?? "phone";
  const 原有 = new Set(号码们.map((x) => x.kind));
  const 类型选项 = 号码种类.filter((x) => x.active || 原有.has(x.kind)).map((x) => ({ value: x.kind, label: x.active ? x.名 : `${x.名}（已停用）` }));

  function 开始() {
    if (只读) return;
    set错(null);
    set草稿(号码们.length ? 号码们.map((x) => ({ ...x })) : [{ kind: 默认种类, value: "" }]);
    set编辑(true);
  }
  async function 保存() {
    set存着(true);
    set错(null);
    const r = await saveCustomerNumbers(customerId, 草稿.filter((x) => x.value.trim())).catch(() => ({ ok: false as const, error: "没存上，请稍后再试" }));
    set存着(false);
    if (!r.ok) return set错(r.error);
    set编辑(false);
    router.refresh();
  }

  if (!编辑) {
    const 行属性 = 只读
      ? { className: "rec-field cn-ro", ...(改挡 ? { title: 改挡 } : {}) }
      : { className: "rec-field", onClick: 开始, role: "button", tabIndex: 0, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter") 开始(); else if (e.key === " " && e.target === e.currentTarget) { e.preventDefault(); 开始(); } }, "aria-label": "编辑号码" };
    return (
      <div data-testid="customer-numbers">
        {号码们.length ? (
          号码们.map((m, i) => (
            <div key={`${m.kind}-${i}`} data-field="numbers" {...行属性}>
              <div className="rec-field-k">{叫法(m.kind)}</div>
              {/* 号码、邮箱是文字 + 复制键（同电话那格，省略号打在文字自己身上）；别的直接一行省略 */}
              <div className="rec-field-v is-line">
                {m.kind === "email" || 带复制键.has(m.kind) ? (
                  <span className="rec-field-link">
                    {m.kind === "email" ? <CopyValue 种类="邮箱" 叫法={叫法(m.kind)} value={m.value} /> : <CopyValue 叫法={叫法(m.kind)} value={m.value} />}
                  </span>
                ) : m.value}
              </div>
              {!只读 && 新样 && <EditOutlined className="rec-field-pen" aria-hidden />}
            </div>
          ))
        ) : (
          <div data-field="numbers" {...行属性}>
            <div className="rec-field-k">号码</div>
            <div className="rec-field-v rec-field-empty is-line" title={只读 ? undefined : "点击添加座机、WhatsApp 等号码"}>{空值符}</div>
            {!只读 && 新样 && <EditOutlined className="rec-field-pen" aria-hidden />}
          </div>
        )}
      </div>
    );
  }

  const 改 = (i: number, x: Partial<一行>) => set草稿((们) => 们.map((r, j) => (j === i ? { ...r, ...x } : r)));
  return (
    /*
      编辑态上下排（cn-editing，同备注的 is-multi）：左栏卡只有 ~220 宽，标签列占掉 70 后「类型 92 + 号码 + 去掉 32」里号码只剩 ~24，
      打的号看不见（11-20 3703 实操，1366 / 1024）。标签提到上面一行、编辑区占满卡宽；一行里放不下「类型 + 至少 150 的号码 + 去掉」时
      类型单占一行、号码和去掉换到下一行（cn-row 折行），号码框不再被挤没
    */
    <div className="rec-field rec-field-editing cn-editing" data-field="numbers" data-testid="customer-numbers">
      <div className="rec-field-k">号码</div>
      <div className="cn-edit">
        {草稿.map((r, i) => (
          <div key={i} className="cn-row">
            <Select size="middle" className="cn-kind" popupMatchSelectWidth={false} options={类型选项} value={r.kind} onChange={(v: string) => 改(i, { kind: v })} aria-label="号码类型" />
            <span className="cn-val-line">
              <Input size="middle" className="cn-val" maxLength={号码上限} value={r.value} placeholder="号码或账号" aria-label="号码"
                onChange={(e) => 改(i, { value: e.target.value })} onPressEnter={() => void 保存()} onKeyDown={(e) => e.key === "Escape" && set编辑(false)} />
              <Button icon={<MinusCircleOutlined />} onClick={() => set草稿((们) => 们.filter((_, j) => j !== i))} aria-label="去掉这一行" />
            </span>
          </div>
        ))}
        {草稿.length < 每人最多号码 && (
          <Button type="dashed" size="small" block icon={<PlusOutlined />} className="cn-add" onClick={() => set草稿((们) => [...们, { kind: 默认种类, value: "" }])}>
            加一个号码
          </Button>
        )}
        <Space size={6}>
          <Button size="small" type="primary" loading={存着} onClick={() => void 保存()}>保存</Button>
          <Button size="small" disabled={存着} onClick={() => set编辑(false)}>取消</Button>
        </Space>
        {错 && <div role="alert" className="cd-task-err rec-field-said">{错}</div>}
      </div>
    </div>
  );
}

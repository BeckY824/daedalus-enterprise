"use client";
/**
 * 企业版项目模式首页对话框里的「查重」键（10-29 首页改版 待 1：背调、查重、附件分开放）：
 * 点开一个小框，选号码类型、填号码，全公司查一遍，回一句和建档向导同一套的提示。
 * 只查不写：和向导第一步那颗「查重」同一个服务端动作（customers/number-actions.ts 查号码），
 * 格式规矩在 lib/enterprise/contact-format.ts，撞到谁照向导那样点得进去
 */
import { useImperativeHandle, useState } from "react";
import Link from "next/link";
import { Alert, App, Button, Input, Popover, Select, Space } from "antd";
import { FileSearchOutlined } from "@ant-design/icons";
import { 查号码, type 查号码结果 } from "../customers/number-actions";
import { 向导能选类型, 号码类型叫法, type 号码类型 } from "@/lib/enterprise/contact-format";

/** 不跟着「正在回答」变灰：查号码不碰这一轮对话，边等回答边查是常事 */
export default function DedupeKey({ 宽, 藏键 = false, 开: 开ref }: {
  宽: boolean;
  /** 不摆自己的键（收进「+」菜单，P15）：小框挂在一个看不见的锚上（紧挨着「+」），由 开 打开 */
  藏键?: boolean;
  开?: React.Ref<{ 打开: () => void }>;
}) {
  const { message } = App.useApp();
  const [开, set开] = useState(false);
  const [类型, set类型] = useState<号码类型>("手机号");
  const [号, set号] = useState("");
  const [查中, set查中] = useState(false);
  /** 查回来的那句；改了类型或号码就清掉，免得旧结论挂在新号码底下 */
  const [结果, set结果] = useState<查号码结果 | null>(null);
  useImperativeHandle(开ref, () => ({ 打开: () => set开(true) }), []);

  async function 查() {
    const 值 = 号.trim();
    if (!值 || 查中) return;
    set查中(true);
    try {
      set结果(await 查号码(类型, 值));
    } catch {
      message.error("查重没查成，请稍后再试");
    } finally {
      set查中(false);
    }
  }

  const 框 = (
    <div className="home-dedupe">
      <Space.Compact style={{ width: "100%" }}>
        <Select
          style={{ width: 130, flexShrink: 0 }}
          value={类型}
          aria-label="号码类型"
          options={向导能选类型.map((t) => ({ value: t, label: 号码类型叫法(t) }))}
          onChange={(v) => {
            set类型(v);
            set结果(null);
          }}
        />
        <Input
          value={号}
          autoFocus
          placeholder="填号码，看有没有人录过"
          aria-label="要查的号码"
          onChange={(e) => {
            set号(e.target.value);
            set结果(null);
          }}
          onPressEnter={() => void 查()}
        />
        <Button type="primary" loading={查中} disabled={!号.trim()} onClick={() => void 查()}>查</Button>
      </Space.Compact>
      {结果 && (
        结果.ok && 结果.状态 === "首次录入" ? <Alert type="success" showIcon title={结果.提示} description={结果.归属地 ? `归属地：${结果.归属地}` : undefined} />
        : !结果.ok ? <Alert type="warning" showIcon title={结果.提示} />
        : (
          <Alert
            type="error"
            showIcon
            title={结果.提示}
            description={结果.撞?.id || 结果.归属地 ? (
              <span>
                {结果.撞?.id && <><Link href={`/customers/${结果.撞.id}`} onClick={() => set开(false)}>{结果.撞.name}</Link>{结果.撞.school ? ` · ${结果.撞.school}` : ""} · 在 {结果.撞.salesOwnerName} 名下</>}
                {结果.撞?.id && 结果.归属地 ? " · " : ""}
                {结果.归属地 ? `归属地：${结果.归属地}` : ""}
              </span>
            ) : undefined}
          />
        )
      )}
    </div>
  );

  return (
    <Popover content={框} trigger="click" placement="topLeft" open={开} onOpenChange={set开}>
      {藏键 ? <span className="cli-anchor" aria-hidden="true" /> : <button
        type="button"
        className={`cli-tool${宽 ? " cli-tool-t" : ""}${开 ? " cli-tool-on" : ""}`}
        aria-label="查重"
        aria-expanded={开}
        title="查一个号码全公司有没有人录过（手机号、邮箱、微信、阿里国际站ID），只查不写"
      >
        <FileSearchOutlined />
        {宽 && <span>查重</span>}
      </button>}
    </Popover>
  );
}

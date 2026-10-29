"use client";

/**
 * 渠道详情抽屉（2026-10-29 渠道改版）：上面是渠道的资料和那一排统计，下面是投入记录。
 * 投入一笔一行，只有老板、总管理员、市场管理能录、能删（10-29 P16，channel-stats.ts 的 能录投入），别人只看；
 * 录完 / 删完刷新页面，列表上的「当前投入」「投入产出比」跟着变。
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Descriptions, Drawer, Empty, Form, Input, InputNumber, Popconfirm, Skeleton, Space, Tag } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import DatePicker from "@/components/BusinessDatePicker";
import CurrencySelect from "@/components/CurrencySelect";
import { UserCell } from "@/components/ui";
import { useBusiness } from "@/lib/business-client";
import { 合计文字 } from "@/lib/currency";
import { isFormValidationError } from "@/lib/form-validation";
import { dayjs, fmtDate } from "@/lib/utils";
import { 拆来源, type 渠道统计, type 产出比分布 } from "@/lib/enterprise/channel-stats";
import { addChannelInvest, deleteChannelInvest, listChannelInvests, type 投入行 } from "./actions";
import type { 渠道行 } from "./ChannelsView";

const 投入备注上限 = 200;
const 无 = <span className="muted">—</span>;

/**
 * 同名分布：同一个渠道名称下各来源的产出比平均值 / 最高值 / 最低值（列表那三列算好的，传进来跟着「投入产出比」摆）；
 * undefined = 开关关着不摆，null = 开着但一个来源都算不了
 */
export default function ChannelDrawer({ row, 同名分布, 不问归属, onClose, onEdit }: {
  row: 渠道行;
  同名分布?: ReturnType<typeof 产出比分布>;
  不问归属: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const router = useRouter();
  const { message } = App.useApp();
  const b = useBusiness();
  const [投入, set投入] = useState<投入行[] | null>(null);
  const [能录, set能录] = useState(false);
  const [不能录因, set不能录因] = useState<string | null>(null);
  const [错, set错] = useState<string | null>(null);
  const [录, set录] = useState(false);
  const [忙, set忙] = useState(false);
  const [form] = Form.useForm();
  const s: 渠道统计 | undefined = row.统计;

  const 读 = useCallback(async () => {
    const res = await listChannelInvests(row.id);
    if (!res.ok) {
      set错(res.error);
      set投入([]);
      return;
    }
    set错(null);
    set投入(res.rows);
    set能录(res.能录);
    set不能录因(res.不能录因 ?? null);
  }, [row.id]);

  useEffect(() => {
    // 换渠道时外面按 key 重新挂载，初始就是 null（骨架），这里不用再清
    let 作废 = false;
    listChannelInvests(row.id).then((res) => {
      if (作废) return;
      if (!res.ok) {
        set错(res.error);
        set投入([]);
        return;
      }
      set错(null);
      set投入(res.rows);
      set能录(res.能录);
      set不能录因(res.不能录因 ?? null);
    });
    return () => {
      作废 = true;
    };
  }, [row.id]);

  async function 存() {
    if (忙) return;
    set忙(true);
    try {
      const v = await form.validateFields();
      const res = await addChannelInvest({
        channelId: row.id,
        amount: Number(v.amount),
        currency: v.currency ?? b.currency,
        date: (v.date as Dayjs).format("YYYY-MM-DD"),
        remark: v.remark ?? null,
      });
      if (!res.ok) return void message.error(res.error);
      message.success("投入已记下");
      form.resetFields();
      set录(false);
      await 读();
      router.refresh();
    } catch (e) {
      if (!isFormValidationError(e)) message.error("保存失败，请刷新确认结果后重试");
    } finally {
      set忙(false);
    }
  }

  async function 删(id: string) {
    const res = await deleteChannelInvest(id);
    if (!res.ok) return void message.error(res.error);
    message.success("已删除");
    await 读();
    router.refresh();
  }

  const 钱 = (x: { 币种: string; 合计: number }[] | undefined) => (x && x.length ? 合计文字(x, b.currency) : "—");

  return (
    <Drawer
      open
      onClose={onClose}
      title={<span className="chan-full" title={row.name}><span>{row.name}</span>{!row.active && <Tag style={{ margin: 0, flex: "none" }}>已停用</Tag>}</span>}
      styles={{ wrapper: { width: "min(560px, 100vw)" } }}
      extra={<Button size="small" icon={<EditOutlined />} onClick={onEdit}>编辑</Button>}
      destroyOnHidden
    >
      <Descriptions
        size="small"
        column={{ xs: 1, sm: 2 }}
        items={[
          { key: "attr", label: "渠道属性", children: row.attr ?? 无 },
          { key: "platform", label: "渠道名称", children: row.platform ?? 无 },
          { key: "source", label: "来源", children: row.platform ? 拆来源(row.name, row.platform) : 无 },
          { key: "active", label: "渠道状态", children: row.active ? "启用" : "停用" },
          { key: "createdAt", label: "创建日期", children: fmtDate(row.createdAt) },
          { key: "endDate", label: "结束日期", children: row.endDate ? fmtDate(row.endDate) : 无 },
          { key: "days", label: "累计运营天数", children: `${s?.累计运营天数 ?? 0} 天` },
          ...(不问归属 ? [] : [{ key: "owner", label: "负责人", children: <UserCell name={row.channelOwnerName} size={20} /> }]),
          { key: "createdBy", label: "创建人", children: row.createdByName ?? 无 },
          ...(row.remark ? [{ key: "remark", label: "备注", span: "filled" as const, children: <span style={{ overflowWrap: "anywhere" }}>{row.remark}</span> }] : []),
        ]}
      />

      <div className="section-title" style={{ marginTop: 20 }}>统计</div>
      <Descriptions
        size="small"
        column={{ xs: 2, sm: 3 }}
        items={[
          { key: "线索", label: "关联线索", children: s?.关联线索 ?? 0 },
          { key: "有效", label: "有效线索", children: s?.有效线索 ?? 0 },
          { key: "商机", label: "关联商机", children: s?.关联商机 ?? 0 },
          { key: "订单", label: "关联订单", children: s?.关联订单 ?? 0 },
          { key: "项目", label: "关联项目", children: s?.关联项目 ?? 0 },
          { key: "比", label: "投入产出比", children: s?.产出比 ?? <span className="muted" title={s?.产出比说明 ?? undefined}>{s?.产出比说明 ?? "—"}</span> },
          ...(同名分布 !== undefined
            ? [{
                key: "分布",
                label: "同名渠道产出比",
                span: "filled" as const,
                children: 同名分布 ? (
                  <span style={{ overflowWrap: "anywhere" }}>
                    平均值 {同名分布.平均} · 最高值 {同名分布.最高} · 最低值 {同名分布.最低}
                    <span className="muted">（「{row.platform ?? row.name}」下 {同名分布.个数} 个来源能算）</span>
                  </span>
                ) : (
                  <span className="muted">「{row.platform ?? row.name}」下的来源都还算不了产出比</span>
                ),
              }]
            : []),
          { key: "成交", label: "累计成交", span: "filled", children: 钱(s?.累计成交) },
          { key: "投入", label: "当前投入", span: "filled", children: 钱(s?.当前投入) },
        ]}
      />

      <div className="section-title" style={{ marginTop: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span>投入记录</span>
        {能录 && !录 && (
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => set录(true)}>
            录一笔投入
          </Button>
        )}
      </div>
      {/* 只能看的人说一句为什么没有「录一笔投入」，免得以为按钮丢了 */}
      {!能录 && 不能录因 && 投入 !== null && <div className="muted" style={{ margin: "4px 0 8px", fontSize: 12 }}>{不能录因}</div>}

      {能录 && 录 && (
        <Form
          form={form}
          layout="vertical"
          style={{ margin: "8px 0 16px" }}
          initialValues={{ currency: b.currency, date: dayjs() }}
        >
          <Space.Compact block>
            <Form.Item name="currency" noStyle>
              <CurrencySelect aria-label="币种" />
            </Form.Item>
            <Form.Item
              name="amount"
              noStyle
              rules={[{ required: true, message: "请填写金额" }, { type: "number", min: 0.01, message: "金额要大于 0" }]}
            >
              <InputNumber aria-label="投入金额" placeholder="投入金额" min={0} precision={2} style={{ width: "100%" }} />
            </Form.Item>
          </Space.Compact>
          <Form.Item label="投入日期" name="date" rules={[{ required: true, message: "请选择日期" }]} style={{ marginTop: 12 }}>
            <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item label="备注" name="remark" rules={[{ max: 投入备注上限, message: `备注最多 ${投入备注上限} 个字` }]}>
            <Input placeholder="如：十月投流" maxLength={投入备注上限} />
          </Form.Item>
          <Space>
            <Button type="primary" loading={忙} onClick={存}>保存</Button>
            <Button onClick={() => { form.resetFields(); set录(false); }}>取消</Button>
          </Space>
        </Form>
      )}

      {错 && <div className="muted" style={{ margin: "8px 0" }}>{错}</div>}
      {投入 === null ? (
        <Skeleton active paragraph={{ rows: 2 }} title={false} />
      ) : 投入.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={能录 ? "还没录投入。录了之后列表上就算得出投入产出比" : "还没录投入"} />
      ) : (
        <ul className="chan-invest">
          {投入.map((x) => (
            <li key={x.id}>
              <div className="chan-invest-main">
                <span className="chan-num">{合计文字([{ 币种: x.currency, 合计: x.amount }], b.currency)}</span>
                <span className="muted nowrap">{fmtDate(x.date)}</span>
                {x.userName && <span className="muted chan-invest-who" title={x.userName}>{x.userName} 录</span>}
              </div>
              {x.remark && <div className="muted chan-invest-remark">{x.remark}</div>}
              {能录 && (
                <Popconfirm title="删除这笔投入？" okText="删除" okButtonProps={{ danger: true }} cancelText="取消" onConfirm={() => 删(x.id)}>
                  <Button className="chan-invest-del" aria-label="删除这笔投入" title="删除" type="text" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              )}
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

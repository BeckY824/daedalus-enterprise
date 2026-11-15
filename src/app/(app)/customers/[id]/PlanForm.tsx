"use client";

import DatePicker from "@/components/BusinessDatePicker";

import { requiredText, isFormValidationError } from "@/lib/form-validation";

import OptionInput from "@/components/OptionInput";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Form, Input, Button, Checkbox, Typography } from "antd";
import SaveButton from "@/components/SaveButton";
import { showUndo } from "@/components/UndoBar";
import { FOLLOW_METHODS } from "@/lib/constants";
import { isCalendarDate } from "@/lib/schedule-date";
import { dayjs } from "@/lib/utils";
import { savePlan, deletePlan } from "./actions";
import CustomerPick, { type 客户近况 } from "./CustomerPick";
import { 聚焦首项 } from "@/lib/modal-focus";
import { useFormGuard } from "@/lib/form-guard";

/**
 * 跟进计划表单。两处用：记录页（给了 customerId，已经知道是谁）和计划页页头的「新建计划」
 * （不给，第一格挑人，见 CustomerPick）。只有一份，和 ContactForm 同一个道理：
 * 两份表单迟早长出不同的字段和校验，而差别只有「是谁的」这一格。
 */
/** 计划时间下面的快捷（ls.pl.new） */
const 快捷天 = [["明天", 1], ["3 天后", 3], ["1 周后", 7]] as const;

export default function PlanForm({
  open,
  onClose,
  onSaved,
  customerId,
  预选客户,
  record,
  默认天数 = 3,
  有WhatsApp = false,
}: {
  open: boolean;
  onClose: () => void;
  /** 新建时带回新计划的 id：计划页要把那一行点亮 */
  onSaved: (id?: string) => void;
  /** 记录页上给定；计划页上不给，改由表单第一格挑 */
  customerId?: string;
  /** 不给 customerId 时预填的那一位（从某位客户带过来的） */
  预选客户?: { id: string; name: string } | null;
  /** updatedAt：编辑时的版本号（J-105），保存时交回去当闸门 */
  record: { id: string; subject: string; plannedAt: string; method: string; plannedHasTime?: boolean | null; updatedAt?: string } | null;
  /** 新建时计划时间默认几天后的 9 点（P-界面-34：3 天后，可改）。完成一次之后「排下一次」默认一周后（审查 M10） */
  默认天数?: number;
  /** 给定的这位档案里填了 WhatsApp 号：新建时方式默认 WhatsApp（2026-10-17 PR26 手测）。挑人时看挑中那位的 */
  有WhatsApp?: boolean;
}) {
  const [form] = Form.useForm();
  const router = useRouter();
  const hasTime = Form.useWatch("hasTime", form) ?? true;
  const 计划时间 = Form.useWatch("plannedAt", form);
  const 挑人 = !customerId;
  /** 挑中那位的近况（上次跟进、欠着的计划）。关框时清掉，下次打开不带着上一位 */
  const [近况, set近况] = useState<客户近况 | null>(null);
  /**
   * 人亲手改过「跟进方式」没有（2026-10-17 复测）。原来拿 isFieldTouched 判断，程序填进去的 WhatsApp 也算「碰过」，
   * 先挑有号的、再换没号的，方式停在 WhatsApp。onValuesChange 只在人操作时触发，程序 setFieldsValue 不算
   */
  const 人改过方式 = useRef(false);

  useEffect(() => {
    if (!open) return;
    人改过方式.current = false;
    if (record) {
      form.resetFields();
      form.setFieldsValue({ subject: record.subject, method: record.method, plannedAt: dayjs(record.plannedAt), hasTime: !isCalendarDate(record.plannedAt) });
      form.setFields([{ name: "hasTime", touched: false }, { name: "plannedAt", touched: false }]);
    } else {
      form.resetFields();
      form.setFieldsValue({
        method: 有WhatsApp ? "WhatsApp" : "电话沟通", hasTime: true,
        plannedAt: dayjs().add(默认天数, "day").hour(9).minute(0),
      });
    }
  }, [open, record, form, 默认天数, 有WhatsApp]);

  /** 挑中一位：方式人没碰过的，跟着这一位有没有 WhatsApp 号走 */
  function 换人(v: 客户近况 | null) {
    set近况(v);
    if (!record && !人改过方式.current) form.setFieldsValue({ method: v?.有WhatsApp ? "WhatsApp" : "电话沟通" });
  }

  function 关() {
    set近况(null);
    onClose();
  }
  // 点外面不关、关前问一句、新建的草稿留在本机（2026-10-19 客户反馈，lib/form-guard.tsx）。计划页上挑人的，客户不进草稿
  const 守 = useFormGuard({
    open,
    form,
    草稿键: record ? null : `新建计划:${customerId ?? "挑人"}`,
    关,
    afterOpenChange: 聚焦首项,
    不存: customerId ? [] : ["customerId"],
  });

  /*
    保存中：网慢时连点两下会建出两条一样的记录（跟进带的 AI 待办和计划也各建两份，2026-10-02 排查）。
    校验没过（validateFields 抛出）也会走 finally 放开
  */
  const [存着, set存着] = useState(false);
  /** 存好之后、对勾放完才做的事（关框 + 列表页上的撤销条）；SaveButton 的 成了 调它 */
  const 存好后 = useRef<(() => void) | null>(null);
  function 收尾() {
    const f = 存好后.current;
    存好后.current = null;
    f?.();
  }
  /** 已经存上、对勾还在放时点了取消 / Esc：当收尾（照样交给页面）；没存的照旧走离开守卫 */
  function 关或收尾() {
    if (存好后.current) 收尾();
    else 守.要关();
  }
  /**
   * 保存（原型 g.save）：保存中 / 已保存 / 没保存上都显示在保存键里，不弹顶部提示。
   * 回 { ok:false, error } = 没保存上，原因浮在键上方，框留着
   */
  async function 保存(): Promise<{ ok: boolean; error?: string }> {
    if (存着) return { ok: false, error: "正在保存，请稍等" };
    set存着(true);
    try {
      return await onOk();
    } catch (error) {
      if (isFormValidationError(error)) return { ok: false, error: "有几项没填好，看标红的" };
      return { ok: false, error: "保存失败，请刷新确认结果后重试" };
    } finally {
      set存着(false);
    }
  }

  async function onOk(): Promise<{ ok: boolean; error?: string }> {
    const v = await form.validateFields();
    const 谁 = customerId ?? (v.customerId as string);
    const res = await savePlan({
      id: record?.id,
      版本: record?.updatedAt,
      customerId: 谁,
      subject: v.subject,
      plannedAt: v.hasTime ? v.plannedAt.toISOString() : v.plannedAt.format("YYYY-MM-DD"),
      plannedHasTime: !record || record.plannedHasTime != null || form.isFieldTouched("hasTime") || form.isFieldTouched("plannedAt") ? Boolean(v.hasTime) : undefined,
      method: v.method,
    });
    // 这位客户在别处被删了、打开之后这条又变过了（J-105）之类：原因写在保存键上，框留着；页面数据刷成最新，关框重开就是新的那一版
    if (!res.ok) {
      if (record) router.refresh();
      return { ok: false, error: res.error };
    }
    void window.desktopReminders?.刷新();
    const 名 = 近况?.name;
    守.存好了();
    存好后.current = () => {
      set近况(null);
      onSaved(res.id);
      if (!挑人 || !名 || record) return;
      // 列表页上建的：人留在原地，底部撤销条给一条去他记录页的路；撤销 = 删掉刚排的这条（新建才有，改的不走这里）
      showUndo({
        话: `已给${名}排上「${String(v.subject).trim()}」`,
        撤销: () => deletePlan(res.id),
        另一个动作: { 话: `去${名}的记录页`, 做: () => router.push(`/customers/${谁}`) },
        毫秒: 6000,
      });
    };
    return { ok: true };
  }

  return (
    <Modal
      {...守.弹窗}
      onCancel={关或收尾}
      open={open}
      title={record ? "编辑跟进计划" : 挑人 ? "新建跟进计划" : "制定跟进计划"}
      footer={[
        <Button key="取消" onClick={关或收尾}>取消</Button>,
        <SaveButton key="存" 做={保存} 成了={收尾}>保存</SaveButton>,
      ]}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" style={{ marginTop: 8 }} onValuesChange={(changed) => { if ("method" in changed) 人改过方式.current = true; 守.改了(); }}>
        {挑人 && <CustomerPick 预选={预选客户} 近况={近况} on近况={换人} 给计划 />}
        <Form.Item name="subject" label="跟进主题" rules={[requiredText("请填写跟进主题")]}>
          <Input placeholder="如：跟进预算审批进度" />
        </Form.Item>
        <Form.Item name="hasTime" valuePropName="checked"><Checkbox>指定钟点并到点提醒</Checkbox></Form.Item>
        {record && record.plannedHasTime == null && !isCalendarDate(record.plannedAt) && <Typography.Paragraph type="secondary">旧记录未保存是否选了钟点；只改其他内容会保留原提醒方式，请核对后重新选择日期或钟点。</Typography.Paragraph>}
        <Form.Item
          name="plannedAt"
          label="计划时间"
          rules={[{ required: true }]}
          // ls.pl.new：三个快捷，点了换到那天 9:00（不指定钟点时只取日子）；当前那个亮着
          extra={
            <span className="plan-quick" role="group" aria-label="快捷时间">
              {快捷天.map(([叫法, n]) => {
                const 是 = 计划时间 ? dayjs(计划时间).startOf("day").diff(dayjs().startOf("day"), "day") === n : false;
                return (
                  <button
                    key={n}
                    type="button"
                    className={`plan-quick-b${是 ? " is-on" : ""}`}
                    aria-pressed={是}
                    onClick={() => {
                      form.setFieldsValue({ plannedAt: dayjs().add(n, "day").hour(9).minute(0).second(0) });
                      守.改了();
                    }}
                  >
                    {叫法}
                  </button>
                );
              })}
            </span>
          }
        >
          <DatePicker showTime={hasTime} format={hasTime ? "YYYY-MM-DD HH:mm" : "YYYY-MM-DD"} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="method" label="跟进方式">
          <OptionInput options={FOLLOW_METHODS} allowClear={false} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

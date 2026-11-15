"use client";

import DatePicker from "@/components/BusinessDatePicker";

import { requiredText } from "@/lib/form-validation";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Form, Input, Checkbox, Typography, Button } from "antd";
import SaveButton from "@/components/SaveButton";
import { isCalendarDate } from "@/lib/schedule-date";
import { dayjs } from "@/lib/utils";
import { saveTask } from "./actions";
import { 聚焦首项 } from "@/lib/modal-focus";
import { useFormGuard } from "@/lib/form-guard";

export default function TaskForm({
  open,
  onClose,
  onSaved,
  customerId,
  record = null,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  customerId: string;
  /** 给了就是编辑这一条（计划页「改」，2026-10-02 排查 3-4：原来待办建了就改不了） */
  /** updatedAt：编辑时的版本号（J-105），保存时交回去当闸门 */
  record?: { id: string; title: string; dueAt: string | null; dueHasTime?: boolean | null; updatedAt?: string } | null;
}) {
  const [form] = Form.useForm();
  const router = useRouter();
  const hasTime = Form.useWatch("hasTime", form) ?? true;
  // 保存中：网慢时连点两下会建出两条一样的待办（2026-10-02 排查）
  const [存着, set存着] = useState(false);
  // 点外面不关、关前问一句、新建的草稿留在本机（2026-10-19 客户反馈，lib/form-guard.tsx）
  const 守 = useFormGuard({ open, form, 草稿键: record ? null : `新建待办:${customerId}`, 关: onClose, 忙: 存着, afterOpenChange: 聚焦首项 });

  useEffect(() => {
    if (open) {
      form.resetFields();
      if (record) form.setFieldsValue({ title: record.title, dueAt: record.dueAt ? dayjs(record.dueAt) : null, hasTime: !record.dueAt || !isCalendarDate(record.dueAt) });
      else form.setFieldsValue({ hasTime: true, dueAt: dayjs().add(1, "day").hour(9).minute(0) });
      form.setFields([{ name: "hasTime", touched: false }, { name: "dueAt", touched: false }]);
    }
  }, [open, form, record]);

  /**
   * 保存（原型 g.save）：保存中 / 已保存 / 没存上都显示在保存键里，不弹顶部提示。
   * 回 { ok:false, error } = 没存上，原因浮在键上方；对勾放完（SaveButton 的 成了）才关框
   */
  /** 存上了、对勾还在放：这时点取消 / Esc 当「存好了关框」，照样交给页面刷新 */
  const 存上了 = useRef(false);
  function 收尾() {
    存上了.current = false;
    onSaved();
  }
  function 关或收尾() {
    if (存上了.current) 收尾();
    else 守.要关();
  }
  async function 提交(): Promise<{ ok: boolean; error?: string }> {
    /*
      和另外三个弹框一样先拦再校验（2026-10-04 J-107）：原来 set存着 在 validateFields 之后，
      校验那一下的空当里第二下点击还能进来，只靠按钮转圈挡着
    */
    if (存着) return { ok: false, error: "正在保存，请稍等" };
    set存着(true);
    // 校验没过：红字在框里
    const v = await form.validateFields().catch(() => null);
    if (!v) { set存着(false); return { ok: false, error: "有几项没填好，看标红的" }; }
    try {
      const r = await saveTask({
        id: record?.id,
        版本: record?.updatedAt,
        customerId,
        title: v.title,
        dueAt: v.dueAt ? v.hasTime ? v.dueAt.toISOString() : v.dueAt.format("YYYY-MM-DD") : null,
        dueHasTime: !record || record.dueHasTime != null || form.isFieldTouched("hasTime") || form.isFieldTouched("dueAt") ? Boolean(v.hasTime) : undefined,
      });
      if (!r.ok) {
        // 服务端那句话照说（打开之后这条又变过了 / 已经删了，J-105），原来一律「没存上，请重试」，人只会再点一次、再被拦
        if (record) router.refresh();
        return { ok: false, error: "error" in r && r.error ? r.error : "没存上，请重试" };
      }
      void window.desktopReminders?.刷新();
      守.存好了();
      存上了.current = true;
      return { ok: true };
    } catch {
      return { ok: false, error: "没存上，请重试" };
    } finally {
      set存着(false);
    }
  }

  return (
    <Modal
      {...守.弹窗}
      onCancel={关或收尾}
      open={open}
      title={record ? "改待办" : "新建待办"}
      footer={[
        <Button key="取消" onClick={关或收尾}>取消</Button>,
        <SaveButton key="存" 做={提交} 已保存={record ? "已保存" : "已创建"} 没保存="没存上" 成了={() => { if (存上了.current) 收尾(); }}>{record ? "保存" : "创建"}</SaveButton>,
      ]}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" style={{ marginTop: 8 }} onValuesChange={守.改了}>
        <Form.Item name="title" label="待办内容" rules={[requiredText("请填写待办内容")]}>
          <Input placeholder="如：跟进预算审批进度" />
        </Form.Item>
        <Form.Item name="hasTime" valuePropName="checked"><Checkbox>指定钟点并到点提醒</Checkbox></Form.Item>
        {record?.dueAt && record.dueHasTime == null && !isCalendarDate(record.dueAt) && <Typography.Paragraph type="secondary">旧记录未保存是否选了钟点；只改内容会保留原提醒方式，请核对后重新选择日期或钟点。</Typography.Paragraph>}
        <Form.Item name="dueAt" label="截止时间">
          <DatePicker showTime={hasTime} format={hasTime ? "YYYY-MM-DD HH:mm" : "YYYY-MM-DD"} style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

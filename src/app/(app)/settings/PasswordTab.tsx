"use client";

import { useSettingsNote } from "./InlineNote";
import { Table, Button, Form, Input, Alert, Typography } from "antd";
import { useConsequence } from "@/components/ConsequenceDialog";
import { useRouter } from "next/navigation";
import { dayjs } from "@/lib/utils";
import SaveButton from "@/components/SaveButton";
import { isFormValidationError } from "@/lib/form-validation";
import { changeMyPassword, 退出这台机器, type 机器 } from "./actions";

/**
 * 设置 · 登录与密码：改自己的密码；托管版还列出用这个云端账号登录着的桌面端机器，可以单独退出一台。
 * 机器是 null 时（自部署版、共享工作区）那一块整个不画。
 */
export default function PasswordTab({ 机器 }: { 机器: 机器[] | null }) {
  const router = useRouter();
  const [就地, 提示条] = useSettingsNote();
  const [问后果, 后果框] = useConsequence();
  const [pwdForm] = Form.useForm();

  /**
   * 退出一台机器。
   *
   * 问一句再退：这动作对那台机器是不可逆的（令牌吊了就是吊了，要人拿密码重登），
   * 而按钮就摆在表格行里，误点的成本比翻一次确认框高。
   */
  function onRevoke(m: 机器) {
    // PR9：modal.confirm 换成后果框（P-界面-40），后果分条写
    void 问后果({
      题: `退出「${m.名字}」`,
      后果: [
        { 标: "那台机器", 级: "警", 话: "CRM 回到登录界面，AI 立刻停" },
        { 标: "不受影响", 话: "本地数据都在那台机器上，拿账号密码重新登录就能接着用" },
      ],
      是: "退出这台",
      做: async () => {
        const res = await 退出这台机器(m.id);
        if (res.ok) {
          就地.success(`已退出「${m.名字}」`);
          router.refresh();
        }
        return res;
      },
    });
  }

  return (
    <div style={{ paddingTop: 8 }}>
      {后果框}
      {提示条}
      {/*
        改密码的代价要写在按钮旁边，不是等人发现。它会把这个账号的桌面端
        全部踢下线（见 lib/tenant/members.ts 的 改密码），而「我只是换个密码」
        的人不会预期到手上那几台机器都要重登——尤其是他并不想动的那几台。
      */}
      {机器 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16, maxWidth: 560 }}
          title="改完密码，所有地方都要重新登录"
          description="浏览器里的登录状态会作废，桌面端每一台已登录的机器也会退出（那些机器上的数据不受影响）。只想退出其中一台的话，用下面的「已登录的机器」，别动密码。"
        />
      )}
      <Form
        form={pwdForm}
        layout="vertical"
        style={{ maxWidth: 380 }}
      >
        <Form.Item name="oldPwd" label="原密码" rules={[{ required: true, message: "请输入原密码" }]}>
          <Input.Password />
        </Form.Item>
        <Form.Item
          name="newPwd"
          label="新密码"
          rules={[
            { required: true, message: "请输入新密码" },
            { min: 8, message: "至少 8 位" },
          ]}
        >
          <Input.Password />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="确认新密码"
          dependencies={["newPwd"]}
          rules={[
            { required: true, message: "请再次输入新密码" },
            ({ getFieldValue }) => ({
              validator: (_, v) =>
                !v || getFieldValue("newPwd") === v
                  ? Promise.resolve()
                  : Promise.reject(new Error("两次输入不一致")),
            }),
          ]}
        >
          <Input.Password />
        </Form.Item>
        {/* 原型 st.pwd：写明保存后其他设备会退出（企业版改密码也会让别处下线，actions.ts changeMyPassword）；按钮内转圈防连点、成没成写在按钮上 */}
        {!机器 && <p className="set-pwd-note">保存后，你在其他浏览器和设备上的登录会退出，要用新密码重新登录。</p>}
        <SaveButton
          已保存="密码已更新"
          做={async () => {
            try {
              const v = await pwdForm.validateFields();
              const res = await changeMyPassword(v.oldPwd, v.newPwd);
              if (res.ok) pwdForm.resetFields();
              return res;
            } catch (error) {
              return { ok: false, error: isFormValidationError(error) ? "先把标红的格填好" : "没保存上，请稍后再试" };
            }
          }}
        >
          保存
        </SaveButton>
      </Form>
      {机器 && (
        <div style={{ marginTop: 32, maxWidth: 620 }}>
          <Typography.Title level={5} style={{ marginBottom: 4 }}>
            已登录的机器
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
            用这个云端账号登录过桌面端的机器。丢了一台就在这里把它退出来——
            不用为此改密码，另外几台照常用着。
          </Typography.Paragraph>
          <Table<机器>
            rowKey="id"
            size="small"
            dataSource={机器}
            pagination={false}
            locale={{ emptyText: "还没有机器用这个账号登录过桌面端" }}
            columns={[
              /* 机器名是系统里取的（Windows 常见 DESKTOP-XXXXXXX、也有人起很长的名字），不省略的话
                 一个长名字把右边三列挤出 1024 宽设置页的正文（10-22 排版普查静态扫描） */
              { title: "机器", dataIndex: "名字", ellipsis: true, render: (v: string) => <b title={v}>{v}</b> },
              {
                title: "登录于",
                dataIndex: "登录于",
                width: 150,
                render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
              },
              {
                title: "最近调用 AI",
                dataIndex: "最近使用",
                width: 150,
                /* 只有走模型网关时才记，而且五分钟内只记一次（device-token.ts），
                   所以「还没有」是常态：登录了但一次 AI 都没用过。别说成「从未使用」 */
                render: (v: string | null) =>
                  v ? dayjs(v).format("YYYY-MM-DD HH:mm") : <span style={{ color: "var(--ink-soft)" }}>还没有</span>,
              },
              {
                title: "",
                width: 88,
                render: (_: unknown, r: 机器) => (
                  <Button size="small" danger type="text" onClick={() => onRevoke(r)}>
                    退出
                  </Button>
                ),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}

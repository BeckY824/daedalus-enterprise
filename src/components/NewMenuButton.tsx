"use client";

import { Button, Dropdown } from "antd";
import { DownOutlined, PlusOutlined } from "@ant-design/icons";

export type 新建项 = { key: string; label: string; onClick: () => void };

/**
 * 页头右上角的「新建」（11-12 用户：「右上角改为新建，然后可以选择新建项目或者新建客户」）：
 * 能建两样以上 = 一颗主按钮「新建 ▾」，点开（回车 / 空格也行）是一张菜单，菜单项的字就是全称；
 * 只能建一样 = 直接是那一样的主按钮（写全称，不出下拉）；一样都建不了 = 不摆
 */
export default function NewMenuButton({ 项 }: { 项: 新建项[] }) {
  if (!项.length) return null;
  if (项.length === 1) {
    const [x] = 项;
    return <Button type="primary" icon={<PlusOutlined />} onClick={x.onClick}>{x.label}</Button>;
  }
  return (
    <Dropdown trigger={["click"]} menu={{ items: 项.map((x) => ({ key: x.key, label: x.label, onClick: x.onClick })) }}>
      <Button type="primary" icon={<PlusOutlined />} aria-haspopup="menu">
        新建 <DownOutlined aria-hidden />
      </Button>
    </Dropdown>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { Button, Dropdown } from "antd";
import { DownOutlined, PlusOutlined } from "@ant-design/icons";

export type 新建项 = { key: string; label: string; onClick: () => void };

/**
 * 页头右上角的「新建」（11-12 用户：「右上角改为新建，然后可以选择新建项目或者新建客户」）：
 * 能建两样以上 = 一颗主按钮「新建 ▾」，点开（回车 / 空格也行）是一张菜单，菜单项的字就是全称；
 * 只能建一样 = 直接是那一样的主按钮（写全称，不出下拉）；一样都建不了 = 不摆。
 *
 * 键盘：回车打开后焦点进菜单（autoFocus），方向键选、回车点；点了菜单项先把焦点放回这颗按钮再开弹框——
 * 弹框（antd Modal）关掉时把焦点还给打开那一刻有焦点的元素，于是从菜单开的弹框 / 向导关了焦点回到「新建」。
 * 等待：载入中 = 弹框的代码或数据还在路上（懒加载、取建档数据），按钮转圈、点不了，防连点、不像没反应。
 * 展开时 预取()：先把要懒加载的那块拿起来，点下去就快
 */
export default function NewMenuButton({ 项, 载入中 = false, 预取 }: { 项: 新建项[]; 载入中?: boolean; 预取?: () => void }) {
  const 钮 = useRef<HTMLButtonElement>(null);
  /** 推到下一轮开框的那个定时器：卸载时清掉，不在没了的页面上开框 */
  const 定时 = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (定时.current) clearTimeout(定时.current);
  }, []);
  if (!项.length) return null;
  const 点 = (x: 新建项) => {
    钮.current?.focus();
    /*
      推到下一轮再开：菜单项是按回车的 keydown 点的，同一下回车后面还跟着 keypress——弹框要是这一轮就开了、焦点进了弹框，
      那下 keypress 会落在弹框里有焦点的按钮（右上角关闭）上，弹框一闪就关（11-12 键盘用例踩到）
    */
    if (定时.current) clearTimeout(定时.current);
    定时.current = setTimeout(() => {
      定时.current = null;
      x.onClick();
    }, 0);
  };
  if (项.length === 1) {
    const [x] = 项;
    return <Button ref={钮} type="primary" icon={<PlusOutlined />} loading={载入中} onClick={() => 点(x)}>{x.label}</Button>;
  }
  return (
    <Dropdown
      trigger={["click"]}
      autoFocus
      disabled={载入中}
      onOpenChange={(开) => { if (开) 预取?.(); }}
      menu={{ items: 项.map((x) => ({ key: x.key, label: x.label })), onClick: ({ key }) => { const x = 项.find((y) => y.key === key); if (x) 点(x); } }}
    >
      <Button ref={钮} type="primary" icon={<PlusOutlined />} aria-haspopup="menu" loading={载入中}>
        新建 <DownOutlined aria-hidden />
      </Button>
    </Dropdown>
  );
}

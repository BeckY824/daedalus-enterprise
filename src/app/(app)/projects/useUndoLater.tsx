"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { App, Button } from "antd";

/** 撤销窗口几秒（P-界面-40「一步完成、可撤销」，原型 6 秒）；antd 提示的停留秒数，不是动效时长 */
export const 撤销秒 = 6;

/**
 * 「先当它做了，6 秒后才真的交给服务端」（原型 pr.invite / pr.verify）：
 * 点下去界面马上收起这一条，底部一句提示带「撤销」；6 秒内点撤销 = 什么都没发生（服务端没收到，对方也不会看到）。
 * 离开页面时还没到点的立刻交出去，不丢。交出去失败由调用方把这一条摆回来、说原因。
 * 额外按钮（比如「补一句」）点了 = 不再等计时，交给调用方接着处理（同样不会自动提交）
 */
export function useUndoLater() {
  const { message } = App.useApp();
  const 等着 = useRef(new Map<string, { 计时: number; 交: () => void }>());
  useEffect(() => {
    const 表 = 等着.current;
    return () => {
      for (const { 计时, 交 } of 表.values()) {
        window.clearTimeout(计时);
        交();
      }
      表.clear();
    };
  }, []);
  /** 返回 撤 = 手动撤掉（同点了撤销） */
  return function 稍后交(键: string, o: { 文字: ReactNode; 交: () => void; 撤: () => void; 另一钮?: { 字: string; 点: () => void } }) {
    const 收 = () => {
      const x = 等着.current.get(键);
      if (!x) return false;
      window.clearTimeout(x.计时);
      等着.current.delete(键);
      message.destroy(键);
      return true;
    };
    const 计时 = window.setTimeout(() => {
      等着.current.delete(键);
      // 交出去了，那句带「撤销」的提示同时收掉，不留一颗点了没用的撤销
      message.destroy(键);
      o.交();
    }, 撤销秒 * 1000);
    等着.current.set(键, { 计时, 交: o.交 });
    message.open({
      key: 键,
      type: "success",
      duration: 撤销秒,
      content: (
        <span className="undo-later" data-undo={键}>
          <span>{o.文字}</span>
          {o.另一钮 && <Button type="link" size="small" onClick={() => { if (收()) o.另一钮!.点(); }}>{o.另一钮.字}</Button>}
          <Button type="link" size="small" onClick={() => { if (收()) o.撤(); }}>撤销</Button>
        </span>
      ),
    });
  };
}

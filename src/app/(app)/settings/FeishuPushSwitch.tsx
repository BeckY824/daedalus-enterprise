"use client";

import { useEffect, useState } from "react";
import { App, Switch } from "antd";
import { 读飞书推送, 设飞书推送, type 飞书推送概况 } from "../notice-actions";

/**
 * 设置 → 组织架构 → 飞书一栏 →「飞书推送」（企业版，11-01）：开了以后站内通知（铃铛里的每一条）同时用飞书应用机器人推给本人。
 * 默认关；只有业务角色是总管理员的人能开关。没绑飞书的人照旧只有站内通知。
 */
export default function FeishuPushSwitch({ 凭据齐了 }: { 凭据齐了?: boolean }) {
  const { message } = App.useApp();
  const [概况, set概况] = useState<飞书推送概况 | null>(null);
  const [忙, set忙] = useState(false);

  useEffect(() => {
    let 还在 = true;
    读飞书推送().then((r) => 还在 && set概况(r)).catch(() => {});
    return () => {
      还在 = false;
    };
  }, []);

  if (!概况) return null;
  const 改 = async (开: boolean) => {
    set忙(true);
    try {
      const r = await 设飞书推送(开);
      if (!r.ok) return void message.error(r.error);
      set概况(r.概况);
      message.success(开 ? "飞书推送已打开" : "飞书推送已关掉");
    } finally {
      set忙(false);
    }
  };
  // 上面的凭据刚保存时用卡片传来的，不用等这里重读（D9-1：凭据没填时开关灰着）
  const 缺凭据 = !(凭据齐了 ?? 概况.配了应用);
  const 打不开 = !概况.开 && 缺凭据;
  const 缺 = [缺凭据 && "还没填 App ID / Secret", !概况.配了地址 && "服务器没配 ENT_PUBLIC_URL，消息里不带链接"].filter(Boolean);

  return (
    <div style={{ marginTop: 12, display: "grid", gap: 4 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Switch size="small" checked={概况.开} loading={忙} disabled={!概况.能改 || 打不开} title={打不开 ? "先在上面填好飞书的 App ID 和 App Secret 再打开" : undefined} onChange={(v) => void 改(v)} aria-label="飞书推送" />
        <span>飞书推送</span>
      </label>
      <span className="muted">
        打开后，铃铛里的每条通知也会通过飞书应用机器人发给本人（要先用飞书登录或同步过通讯录）。
        {!概况.能改 ? "只有总管理员能改。" : 打不开 && "先在上面填好飞书的 App ID 和 App Secret 才能打开。"}
      </span>
      {概况.开 && 缺.length > 0 && <span className="muted">注意：{缺.join("；")}。</span>}
    </div>
  );
}

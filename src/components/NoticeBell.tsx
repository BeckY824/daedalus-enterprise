"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, ConfigProvider, Drawer } from "antd";
import { BellOutlined } from "@ant-design/icons";
import { AnimatePresence, motion } from "motion/react";
import { businessDayjs } from "@/lib/business-clock";
import { useSystemReducedMotion } from "@/lib/reduced-motion";
import { 时长 } from "@/lib/motion";
import { 读我的通知, 读未读通知数, 标已读, 全部标已读 } from "@/app/(app)/notice-actions";
import type { 通知行 } from "@/lib/enterprise/notify";

/**
 * 企业版站内通知的铃铛（11-01）：左栏顶上搜索框右边 / 手机顶栏。红数 = 我没读的通知；
 * 点开右侧抽屉列最近 30 条，点一条 = 标已读 + 跳到对应页面；顶上「全部已读」。
 * 未读数每分钟（页面在前台时）问一次服务端；抽屉打开时现拉列表。
 * 减弱动态：抽屉不滑、列表不淡入（lib/reduced-motion.ts）。
 * 抽屉（连同包它的 ConfigProvider）第一次点开才挂：带主题的 ConfigProvider 一挂上，antd 就按新主题把整套样式再生成一遍，
 * 每页 HTML 多 38KB，速度闸门「按组织看」的客户详情 p95 超线（11-02）
 */
/** 正文只摆开头：撞号通知的正文是整段沟通内容，上千字时一条占满抽屉（11-03 B6-7）；完整的点进去看 */
export function 通知摘要(body: string, 字数 = 120): string {
  const 收 = body.replace(/\s+/g, " ").trim();
  return 收.length > 字数 ? `${收.slice(0, 字数)}…` : 收;
}

/**
 * 铃铛里正文最多两行（CSS 截断），超过的给「展开全文」（11-03 B6-6）。抽屉 380 宽、一行约 25 个字：
 * 收空白后超过 50 字、或原文本身有换行，就当两行放不下。
 */
export function 通知要展开(body: string | null | undefined, 两行字数 = 50): boolean {
  if (!body) return false;
  const 收 = body.trim();
  return /\n/.test(收) || 收.replace(/\s+/g, " ").length > 两行字数;
}

export function 多久以前(iso: string, 现在 = Date.now()): string {
  const 秒 = Math.max(0, Math.round((现在 - new Date(iso).getTime()) / 1000));
  if (秒 < 60) return "刚刚";
  if (秒 < 3600) return `${Math.floor(秒 / 60)} 分钟前`;
  if (秒 < 86400) return `${Math.floor(秒 / 3600)} 小时前`;
  if (秒 < 86400 * 7) return `${Math.floor(秒 / 86400)} 天前`;
  return businessDayjs(iso).format("M月D日");
}

export default function NoticeBell({ 初始未读 = 0, 手机 = false }: { 初始未读?: number; 手机?: boolean }) {
  const router = useRouter();
  const 少 = useSystemReducedMotion();
  const [未读, set未读] = useState(初始未读);
  const [开着, set开着] = useState(false);
  const [挂过, set挂过] = useState(false);
  const [行们, set行们] = useState<通知行[] | null>(null);
  const [忙, set忙] = useState(false);
  const [展开的, set展开的] = useState<ReadonlySet<string>>(() => new Set());
  const 切展开 = (id: string) =>
    set展开的((原) => {
      const 新 = new Set(原);
      if (新.has(id)) 新.delete(id);
      else 新.add(id);
      return 新;
    });

  // 每分钟、切回这个标签页时问一次未读数
  useEffect(() => {
    let 还在 = true;
    const 问 = () => {
      if (document.visibilityState !== "visible") return;
      读未读通知数().then((n) => 还在 && set未读(n)).catch(() => {});
    };
    const t = window.setInterval(问, 60_000);
    document.addEventListener("visibilitychange", 问);
    return () => {
      还在 = false;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", 问);
    };
  }, []);

  const 拉 = useCallback(async () => {
    try {
      const r = await 读我的通知();
      set行们(r.行们);
      set未读(r.未读);
    } catch {
      set行们((原) => 原 ?? []);
    }
  }, []);

  const 打开 = () => {
    set挂过(true);
    set开着(true);
    void 拉();
  };

  const 点 = (r: 通知行) => {
    if (!r.read) {
      set行们((原) => 原?.map((x) => (x.id === r.id ? { ...x, read: true } : x)) ?? 原);
      set未读((n) => Math.max(0, n - 1));
      标已读(r.id).then(set未读).catch(() => {});
    }
    if (r.link) {
      set开着(false);
      router.push(r.link);
    }
  };

  const 全读 = async () => {
    set忙(true);
    try {
      await 全部标已读();
      set行们((原) => 原?.map((x) => ({ ...x, read: true })) ?? 原);
      set未读(0);
    } finally {
      set忙(false);
    }
  };

  const 说法 = 未读 > 0 ? `通知，${未读} 条未读` : "通知";
  return (
    <>
      <Badge count={未读} size="small" overflowCount={99} offset={手机 ? undefined : [-4, 4]}>
        <Button type="text" className={手机 ? undefined : "notice-bell"} icon={<BellOutlined />} aria-label={说法} title={说法} onClick={打开} />
      </Badge>
      {挂过 && (
        <ConfigProvider theme={{ token: { motion: !少 } }}>
          <Drawer
            placement="right"
            open={开着}
            onClose={() => set开着(false)}
            rootClassName="notice-drawer"
            title="通知"
            extra={
              <Button size="small" type="text" disabled={未读 === 0 || 忙} loading={忙} onClick={() => void 全读()}>
                全部已读
              </Button>
            }
            styles={{ wrapper: { width: "min(380px, 100vw)" }, body: { padding: 0 } }}
          >
            {行们 === null ? (
              <p className="notice-empty muted">正在读取…</p>
            ) : 行们.length === 0 ? (
              <p className="notice-empty muted">还没有通知</p>
            ) : (
              <ul className="notice-list" aria-label="通知列表">
                <AnimatePresence initial={false}>
                  {行们.map((r) => (
                    <motion.li key={r.id} initial={少 ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 少 ? 0 : 时长.base }}>
                      <button type="button" className={`notice-item${r.read ? "" : " unread"}`} onClick={() => 点(r)} aria-label={`${r.read ? "" : "未读，"}${r.title}`}>
                        <span className="notice-dot" aria-hidden="true" />
                        <span className="notice-main">
                          {/* 标题一行截断、正文两行截断：悬停看全文（11-03 C8-3 / B6-7，卡点编号常被截掉），同客户列表的 title 做法；
                              长的下面「展开全文」原地展开（B6-6），展开后不截、太长在框里滚 */}
                          <span className="notice-title" title={r.title}>{r.title}</span>
                          {r.body && (展开的.has(r.id) ? <span className="notice-body full">{r.body.trim()}</span> : <span className="notice-body" title={r.body}>{通知摘要(r.body)}</span>)}
                          <span className="notice-meta">
                            {r.kind} · {多久以前(r.createdAt)}
                          </span>
                        </span>
                      </button>
                      {通知要展开(r.body) && (
                        <button type="button" className="notice-more" aria-expanded={展开的.has(r.id)} onClick={() => 切展开(r.id)}>
                          {展开的.has(r.id) ? "收起" : "展开全文"}
                        </button>
                      )}
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </Drawer>
        </ConfigProvider>
      )}
    </>
  );
}

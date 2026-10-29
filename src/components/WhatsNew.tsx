"use client";
/**
 * 左栏「更新记录」：点开翻最近几十版更新了什么（全部模式）。
 * 「更新之后第一次打开自己弹一次」那半只在桌面端本地模式下有内容，企业版跑不到，已删（死代码第三批）。
 * 只在桌面端渲染（AppShell 里 desktop 才挂）。
 */
import { useRef, useState } from "react";
import { Button, Modal } from "antd";
import { HistoryOutlined } from "@ant-design/icons";
import Markdown from "@/components/Markdown";
import { 全部更新记录 } from "@/app/(app)/whats-new-actions";
import type { 一版 } from "@/lib/changelog";

/** 「2026-10-04」→「10 月 4 日」：和别处的日期说法一致，年份不重要 */
function 说日期(d: string | null): string {
  const m = d?.match(/^\d{4}-(\d{1,2})-(\d{1,2})$/);
  return m ? `${Number(m[1])} 月 ${Number(m[2])} 日` : (d ?? "");
}

function 各版({ 段 }: { 段: 一版[] }) {
  return (
    <div className="wn-list">
      {段.map((s) => (
        <section key={s.版本} className="wn-ver">
          <h3>
            {s.版本}
            {s.日期 && <span>{说日期(s.日期)}</span>}
          </h3>
          <Markdown text={s.正文} />
        </section>
      ))}
    </div>
  );
}

export default function WhatsNew() {
  const [全部开着, set全部开着] = useState(false);
  const 关全部 = () => set全部开着(false);
  const [全部, set全部] = useState<{ 现在: string; 段: 一版[] } | null>(null);
  const [全部出错, set全部出错] = useState(false);

  function 读全部() {
    set全部出错(false);
    // 连接服务器时，响应中的版本属于服务器；「现在是」必须使用这台桌面的版本。
    Promise.all([
      全部更新记录(),
      window.desktopShell?.version().catch(() => null),
    ]).then(([x, 桌面版本]) => set全部({
      现在: 桌面版本 || x.现在,
      段: x.段,
    })).catch(() => set全部出错(true));
  }

  /** 关掉后焦点回到这一行 */
  const 这一行 = useRef<HTMLButtonElement>(null);
  function 焦点回账号() {
    这一行.current?.focus({ preventScroll: true });
  }

  return (
    <>
      <button
        ref={这一行}
        type="button"
        className="rail-upd rail-wn"
        onClick={() => set全部开着(true)}
        aria-label="更新记录"
        title="每一版更新了什么"
      >
        <span className="rail-upd-ico" aria-hidden>
          <HistoryOutlined />
        </span>
        <span className="rail-upd-t">更新记录</span>
      </button>

      <Modal
        open={全部开着}
        onCancel={关全部}
        afterClose={焦点回账号}
        // 第一次打开才去读；读过就留着，关了再开不再转一圈
        afterOpenChange={(开了) => {
          if (开了 && !全部) 读全部();
        }}
        title={全部 ? `更新记录 · 现在是 ${全部.现在}` : "更新记录"}
        width={560}
        footer={null}
      >
        {全部出错 ? (
          <p className="wn-empty">
            读不出更新记录。{" "}
            <Button type="link" size="small" onClick={读全部}>
              重试
            </Button>
          </p>
        ) : !全部 ? (
          <p className="wn-empty">正在读…</p>
        ) : 全部.段.length ? (
          <各版 段={全部.段} />
        ) : (
          <p className="wn-empty">这一版没有带更新记录。</p>
        )}
      </Modal>
    </>
  );
}

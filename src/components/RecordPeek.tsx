"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { LinkPending } from "@/components/NavProgress";
import { Popover } from "antd";
import { RightOutlined } from "@ant-design/icons";
import { useNarrow } from "@/lib/roster";
import type { 提到的客户 } from "@/lib/agent/run";

/**
 * 「上次跟进」怎么写（#441 审查 3）：服务端给完整日期（YYYY-MM-DD），今年的只写月-日，不是今年的带上年份。
 * 老存档里只有月-日（11-23 之前落的库）照原样写
 */
export function 跟进日(s: string | undefined, 今年 = new Date().getFullYear()): string {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2}-\d{2})/.exec(s);
  if (!m) return s;
  return Number(m[1]) === 今年 ? m[2] : `${m[1]}-${m[2]}`;
}

/**
 * 回答里的客户名（设计语言 HC-2b，用户 11-22 选 C6-A）：一个链接，悬停出小卡，点了去客户详情。
 *
 * 小卡写负责人、跟进状态、上次跟进——都是这一轮工具已经查回来的（lib/agent/run.ts 的 提到的客户），不另查库；
 * 没有的格子写「—」。触屏（hover: none，手机走飞书网页）没有悬停：点名字直接去详情，不出小卡。
 *
 * 翻出来的历史轮次（回答时=true）只给名字和「打开」：那三格是回答那一刻的，隔几天再看早就变了，摆着会误导（#441 审查 3）。
 *
 * 键盘（#441 审查 2）：Tab 到名字上（:focus-visible，鼠标点的不算）也出小卡；Esc 关、焦点回名字。
 * 卡里有动作（「涉及」那一行的起草）时，小卡挂在名字旁边（getPopupContainer），DOM 顺序紧跟名字，
 * 再按 Tab 就进卡里、Tab 过卡尾到下一个名字，焦点离开名字和卡这一块卡就关。正文里的名字卡里只有「打开」，
 * 名字本身就是那个链接，小卡照旧挂在 body 上（正文表格格子是一行省略、overflow 藏着，挂进去会被裁掉）。
 */
export default function RecordPeek({
  客户,
  状态,
  客户叫,
  动作,
  回答时 = false,
  children,
}: {
  客户: 提到的客户;
  /** 跟进状态，按这家的叫法（调用方用 statusLabel 换好） */
  状态?: string;
  /** 这家对客户的叫法 */
  客户叫: string;
  /** 小卡底下多摆的动作（首页「涉及」那一行给「起草跟进话术」） */
  动作?: React.ReactNode;
  /** 库里翻出来的历史轮次：只给名字和「打开」 */
  回答时?: boolean;
  children: React.ReactNode;
}) {
  const 触屏 = useNarrow("(hover: none)");
  const [开, set开] = useState(false);
  const 盒 = useRef<HTMLSpanElement>(null);
  const 名 = useRef<HTMLAnchorElement>(null);
  /** Esc 关了、焦点拉回名字那一下：别又因为「名字拿到焦点」把卡弹回来 */
  const 刚关 = useRef(false);
  const 链 = (
    <Link ref={名} href={`/customers/${客户.id}`} className="md-ent" data-peek={客户.id}>
      {children}
      <LinkPending />
    </Link>
  );
  if (触屏) return 链;
  return (
    <span
      ref={盒}
      className="peek-w"
      onFocus={(e) => {
        if (e.target !== 名.current) return;
        if (刚关.current) {
          刚关.current = false;
          return;
        }
        if (e.target.matches(":focus-visible")) set开(true);
      }}
      onBlur={(e) => {
        const 去 = e.relatedTarget as Node | null;
        // 焦点还在名字或卡里（卡挂在 盒 里，或者 portal 到 body 的那张卡里）：不关
        if (去 && (盒.current?.contains(去) || (去 as Element).closest?.(".peek"))) return;
        set开(false);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !开) return;
        // 只关这一层，不让首页那句「Esc 打断正在答的」接着处理（lib/esc.ts 认 defaultPrevented）
        e.preventDefault();
        e.stopPropagation();
        set开(false);
        if (document.activeElement !== 名.current) {
          刚关.current = true;
          名.current?.focus();
        }
      }}
    >
      <Popover
        open={开}
        onOpenChange={set开}
        placement="bottomLeft"
        arrow={false}
        mouseEnterDelay={0.25}
        getPopupContainer={动作 ? () => 盒.current ?? document.body : undefined}
        content={
          <div className="peek">
            <div className="peek-n">{客户.name}</div>
            {!回答时 && (
              <dl className="peek-kv">
                <dt>负责人</dt>
                <dd>{客户.owner || "—"}</dd>
                <dt>跟进状态</dt>
                <dd>{状态 || "—"}</dd>
                <dt>上次跟进</dt>
                <dd>{跟进日(客户.lastFollowAt)}</dd>
              </dl>
            )}
            <div className="peek-f">
              {动作}
              <Link href={`/customers/${客户.id}`} className="peek-go">
                打开{客户叫} <RightOutlined />
                <LinkPending />
              </Link>
            </div>
          </div>
        }
      >
        {链}
      </Popover>
    </span>
  );
}

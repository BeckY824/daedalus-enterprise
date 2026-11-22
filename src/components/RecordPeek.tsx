"use client";

import Link from "next/link";
import { Popover } from "antd";
import { RightOutlined } from "@ant-design/icons";
import { useNarrow } from "@/lib/roster";
import type { 提到的客户 } from "@/lib/agent/run";

/**
 * 回答里的客户名（设计语言 HC-2b，用户 11-22 选 C6-A）：一个链接，悬停出小卡，点了去客户详情。
 *
 * 小卡写负责人、跟进状态、上次跟进——都是这一轮工具已经查回来的（lib/agent/run.ts 的 提到的客户），不另查库；
 * 没有的格子写「—」。触屏（hover: none，手机走飞书网页）没有悬停：点名字直接去详情，不出小卡。
 */
export default function RecordPeek({
  客户,
  状态,
  客户叫,
  动作,
  children,
}: {
  客户: 提到的客户;
  /** 跟进状态，按这家的叫法（调用方用 statusLabel 换好） */
  状态?: string;
  /** 这家对客户的叫法 */
  客户叫: string;
  /** 小卡底下多摆的动作（首页「涉及」那一行给「起草跟进话术」） */
  动作?: React.ReactNode;
  children: React.ReactNode;
}) {
  const 触屏 = useNarrow("(hover: none)");
  const 链 = (
    <Link href={`/customers/${客户.id}`} className="md-ent" data-peek={客户.id}>
      {children}
    </Link>
  );
  if (触屏) return 链;
  return (
    <Popover
      placement="bottomLeft"
      arrow={false}
      mouseEnterDelay={0.25}
      content={
        <div className="peek">
          <div className="peek-n">{客户.name}</div>
          <dl className="peek-kv">
            <dt>负责人</dt>
            <dd>{客户.owner || "—"}</dd>
            <dt>跟进状态</dt>
            <dd>{状态 || "—"}</dd>
            <dt>上次跟进</dt>
            <dd>{客户.lastFollowAt || "—"}</dd>
          </dl>
          <div className="peek-f">
            {动作}
            <Link href={`/customers/${客户.id}`} className="peek-go">
              打开{客户叫} <RightOutlined />
            </Link>
          </div>
        </div>
      }
    >
      {链}
    </Popover>
  );
}

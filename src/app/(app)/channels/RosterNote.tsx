"use client";

import Link from "next/link";
import { 名单段, 名单链接, 公海名单链接, type 名单键 } from "@/lib/enterprise/channel-stats";

/**
 * 渠道数字下的差额说明（11-11）：「项目列表里 N 条」链到项目列表，「另 M 条在公海」链到公海页的渠道名单（筛好渠道 + 同口径阶段，
 * 落地条数 = M），只能数到、两边都不列的那几条只写字。抽屉数字下面、总览表格数字的悬停提示里都用它；对得上不出东西
 */
export function RosterNote({ 总数, 名单, channelId, 键, 链 }: {
  总数: number;
  名单: { 列表: number; 公海: number } | undefined;
  channelId: string;
  /** 渠道列表、抽屉的数：按 键 的阶段链过去 */
  键?: 名单键;
  /** 看板 TOP5（11-11）：两个去处另给（带创建时间段），不按阶段 */
  链?: { 列表: string; 公海: string };
}) {
  const 段 = 名单段(总数, 名单);
  if (!段) return null;
  const 去 = 链 ?? { 列表: 名单链接(channelId, 键 ?? "关联项目"), 公海: 公海名单链接(channelId, 键 ?? "关联项目") };
  return (
    <>
      <Link href={去.列表}>项目列表里 {段.列表} 条</Link>
      {(段.公海 > 0 || 段.其余 > 0) && (
        <>
          （另{" "}
          {段.公海 > 0 && <Link href={去.公海}>{段.公海} 条在公海，到公海页看</Link>}
          {段.公海 > 0 && 段.其余 > 0 && "；"}
          {段.其余 > 0 && `${段.其余} 条你只能数到、项目列表不列`}）
        </>
      )}
    </>
  );
}

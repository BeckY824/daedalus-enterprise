"use client";
import { createContext } from "react";

/**
 * 要跟的数（逾期 + 今天到期、还没做的计划和待办），由 AppShell 从 layout 接过来往下传。
 * 左栏「跟进」（企业版挂在「客户」上）、手机顶栏铃铛都挂它——和 Dock 上的数一路对得上。
 * 跟进记录页头那颗「计划」按钮随记录页 11-15 删了，原来的 useFollowDue 没人用了，一起删
 */
export const 要跟Context = createContext<{ 逾期: number; 今天: number }>({ 逾期: 0, 今天: 0 });

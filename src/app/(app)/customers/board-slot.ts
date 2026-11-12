"use client";

import { createContext } from "react";

/**
 * 客户页看板视图在筛选行右端留的一格（11-12 用户：「看板的新建也同步，把新增项目去掉」）：
 * 看板（ProjectsView 客户页）原来在看板上面另起一行摆「分配」「我分出去的」「回到看板」和「→ 还有 N 列」，
 * 新增项目去掉以后这些挪进筛选行右端这一格，不再单独占一行。
 * undefined = 外面没给这一格（单独画看板的测试等）：看板照原来在自己上面摆；null = 给了、还没挂上
 */
export const 看板工具位 = createContext<HTMLElement | null | undefined>(undefined);

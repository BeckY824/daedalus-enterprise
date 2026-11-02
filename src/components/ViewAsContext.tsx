"use client";

import { createContext, useContext } from "react";

/**
 * 这一页是不是在切换视图（壳 AppShell 给值）：导出、上传、发飞书这些按钮据此禁用。
 * 真正的拒绝在服务端（lib/enterprise/view-as.ts 的 视图外部拦 那几个），这里只是让人别白点。没有壳的地方算没在切换。
 */
const 切换视图Context = createContext(false);

export const 切换视图Provider = 切换视图Context.Provider;

export const useViewAs = () => useContext(切换视图Context);

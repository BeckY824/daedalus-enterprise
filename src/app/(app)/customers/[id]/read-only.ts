import { createContext } from "react";

/**
 * 这一页的客户只能看（团队开了「同事之间互相看得到客户」，这位是同事的、不在公海，2026-10-20）。
 * 档案格子、状态章读它：只显示、不给点。按钮由 RecordView 自己按 只读 收起
 */
export const 只读上下文 = createContext(false);

/**
 * 企业版字段权限里这个人「只能看」（或看不到）的格子，按列名（patchCustomer 的 key）。
 * 档案格子读它：在里面的只显示、不给点（11-03 D5-1：原来照样打开编辑框，存的时候才被服务端拒）
 */
export const 只能看的格上下文 = createContext<readonly string[]>([]);

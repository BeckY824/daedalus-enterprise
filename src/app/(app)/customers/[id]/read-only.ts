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

/**
 * 企业版改客户资料挡（服务端 改客户挡 同一口径，lib/enterprise/follow-perm.ts）：不是负责人本人也不是系统管理员（总管理看别人的客户）、
 * 客户在公海里、没设业务角色、只读角色 → 资料格不做成可点、不摆笔（规范 M3-b「只读不摆笔」；PR #401 实操：原来有笔、点开能打字，存时才被拒）。
 * 话 = 服务端会回的那句，悬停看得到。负责人那格换人走转让挡（管理、总管理能转），只有 公海 时才一起挡
 */
export const 资料改挡上下文 = createContext<{ 话: string; 公海: boolean } | null>(null);

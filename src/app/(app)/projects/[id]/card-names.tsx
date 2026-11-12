"use client";

import { createContext, useContext } from "react";

/**
 * 客户详情里各模块的叫法（11-12 用户：客户详情三栏的标题要一眼看出管的是客户还是项目）。
 * 只管客户详情（RecordView 项目模式 + ProjectDetail 嵌入版）；项目详情页（/projects/[id]）不套这一层，照旧原来的名字。
 *
 *   左栏（客户的）：基本资料 → 客户资料，联系人 → 客户联系人，关联客户 → 关联组织
 *   中栏：待办是这位客户名下的（客户自己的任务 + 跟进计划 + 各项目的下一步）→ 范围「所有」；
 *         卡点只列当前项目的（ProjectDetail 的 卡点.们 是这个项目的）→ 范围「当前」；沟通记录不改
 *   右栏（当前项目的）：没带「项目」两个字的都补上
 */
export const 客户详情左栏 = { 资料: "客户资料", 联系人: "客户联系人", 关联: "关联组织" } as const;

/** 中栏的范围词：改范围（比如待办只列当前项目）只改这里，标题、收起钮、读屏名字一起变 */
export const 待办范围 = "所有";
export const 卡点范围 = "当前";
export const 客户详情待办 = `${待办范围}待办`;
export const 客户详情卡点 = `${卡点范围}卡点`;

/** 右栏卡名：没带「项目」的补上（项目资料、项目画像、项目附件、项目组本来就有） */
export const 项目卡名 = (名: string) => (名.startsWith("项目") ? 名 : `项目${名}`);

/** 卡自己写标题时取名：客户详情嵌入版里补「项目」，项目详情页原样 */
const 卡名上下文 = createContext<(名: string) => string>((名) => 名);
export const 卡名Provider = 卡名上下文.Provider;
export const useCardName = () => useContext(卡名上下文);

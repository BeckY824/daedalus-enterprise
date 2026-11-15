"use client";
import dynamic from "next/dynamic";

/**
 * 项目看板（ProjectsView，连分配线索表单、卡点、拖卡补必填、渠道级联……）的按需入口（速度闸门 11-15）。
 * board-page 画看板时用它：客户页为了「看板」视图静态引用 board-page，直接引 ProjectsView 会让客户**列表**首屏
 * 也带上这整块 JS（列表视图根本不画它）。服务端照常渲染（SSR），画了才在页里预取这块，项目页、客户页看板打开不变慢
 */
const ProjectsView = dynamic(() => import("./ProjectsView"));
export default ProjectsView;

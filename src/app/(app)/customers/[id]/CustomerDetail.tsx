"use client";

import { useCallback, useRef } from "react";
import RecordView from "./RecordView";
import { 项目菜单项们, type 项目动作键 } from "../../projects/[id]/project-menu";
import ProjectZone, { type 项目区数据 } from "./ProjectZone";
import type { RecordProps, 项目联系人 } from "./types";

/**
 * 客户详情（企业版项目模式，11-12 客户详情合并第 2 批）：客户和项目合成一页。
 * RecordView 画客户那一层（客户名一行 + 左栏客户资料），右边项目区交给 ProjectZone（当前页签的项目详情）。
 * 两边要互相递东西（客户全部沟通、待办卡给项目区；当前项目的联系人主次给左栏），在这一层接起来
 */
export default function CustomerDetail({ 项目数据: 项目区, ...记录 }: RecordProps & { 项目数据: 项目区数据 | null }) {
  // 右上角「项目操作 ▾」点了哪项 → 嵌入版 ProjectDetail 挂在这里的处理函数（开框、确认都还是它的）
  const 动作口 = useRef<((key: 项目动作键) => void) | null>(null);
  const 挂动作 = useCallback((做: ((key: 项目动作键) => void) | null) => { 动作口.current = 做; }, []);
  if (!项目区) return <RecordView {...记录} />;
  const p = 项目区.当前?.p;
  // 左栏联系人主次跟当前页签：主联系人 = Project.contactId；本项目联系人 = 项目关联联系人（看不到的那几位不在这位客户的联系人里，排不上）
  const 主次: 项目联系人 | null = p
    ? {
        主: p.contact?.id ?? null,
        本项目: (p.关联?.联系人们 ?? []).filter((x) => x.看得到).map((x) => ({ contactId: x.contactId, 角色: x.角色, 立场: x.立场 })),
      }
    : null;
  const 当前项目菜单 = 项目区.当前 ? { 名: 项目区.当前.p.name, 项们: 项目菜单项们(项目区.当前) } : null;
  return (
    <RecordView
      {...记录}
      留痕放左栏={!p}
      项目联系人={主次}
      项目页签们={项目区.页签们.map((t) => t.id)}
      当前项目菜单={当前项目菜单}
      项目动作口={动作口}
      项目区={(槽) => <ProjectZone 数据={项目区} 槽={槽} 挂动作={挂动作} />}
    />
  );
}

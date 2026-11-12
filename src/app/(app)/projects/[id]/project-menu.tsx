import { 独自一人 } from "@/lib/utils";
import type { 项目详情Props } from "./ProjectDetail";

/**
 * 客户详情右上角「项目操作 ▾」里、对当前项目生效的那几项（11-12 用户：「项目操作包括新建项目，项目转让，项目退回公海，删除项目」）。
 * 给不给、灰不灰、灰着写什么，和项目详情页头那几颗按钮是同一套判断（ProjectDetail 也从这里取），改一处两边一起变。
 * 点了做什么还在 ProjectDetail 里（弹框、确认都是它的），客户页只把 key 递过去
 */
export type 项目动作键 = "claim" | "transfer" | "pool" | "delete";
export type 项目菜单项 = { key: 项目动作键; 字: string; /** 灰着的原因；有 = 点不了 */ 灰?: string; /** 悬停说明 */ 注?: string; 危险?: boolean };

/** 线索还在等复核 / 终判：暂时不能退回公海（项目详情页头同一句） */
export const 等复核说法 = (p: 项目详情Props["p"]) =>
  p.线索验证?.待 === "市场复核" ? "等管理员复核" : p.线索验证?.待 === "总管理终判" ? "等管理员最终确认" : undefined;

/** 企业版换负责人（10-30 / 11-01）：按 能转让 给，和 lib/project/db.ts 改项目 同一个判断；公海里的、只有自己一个人时不给 */
export const 能项目转让 = (p: 项目详情Props["p"], 候选: 项目详情Props["候选"]) => !!(p.企业版 && !p.pooled && p.能转让 && !独自一人(候选, p.ownerId));

export function 项目菜单项们({ p, 候选 }: Pick<项目详情Props, "p" | "候选">): 项目菜单项[] {
  const 项们: 项目菜单项[] = [];
  if (p.能领取) 项们.push({ key: "claim", 字: "领取" });
  else if (p.领取不给) 项们.push({ key: "claim", 字: "领取", 灰: p.领取不给 });
  if (能项目转让(p, 候选)) 项们.push({ key: "transfer", 字: "项目转让", 注: "只转当前项目，客户不动" });
  if (p.能放公海) {
    const 等 = 等复核说法(p);
    项们.push({ key: "pool", 字: "项目退回公海", 注: "只退回当前项目，客户不动", 灰: 等 ? `${等}，暂时不能退回公海` : undefined });
  }
  if (p.能删) 项们.push({ key: "delete", 字: "删除项目", 危险: true });
  return 项们;
}

/** 菜单项两行：上面是名字，下面一行淡色小字说明（灰着的原因、会跳过哪几步…） */
export function 两行(名: string, 注?: string) {
  return (
    <div style={{ lineHeight: 1.4, padding: "2px 0", maxWidth: 280, whiteSpace: "normal" }}>
      <div>{名}</div>
      {注 && <div style={{ fontSize: "var(--dt-aux, 12px)", color: "var(--text-muted)" }}>{注}</div>}
    </div>
  );
}

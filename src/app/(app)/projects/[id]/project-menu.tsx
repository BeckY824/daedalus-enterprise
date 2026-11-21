import type { MenuProps } from "antd";
import { 独自一人 } from "@/lib/utils";
import type { 项目详情Props } from "./ProjectDetail";

/**
 * 客户详情右上角「更多操作 ▾」（原「项目操作 ▾」）里、对当前项目生效的那几项（11-12 用户：「项目操作包括新建项目，项目转让，项目退回公海，删除项目」）。
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

/** 项目区正在提交（领取、退回公海…）时客户页「更多操作 ▾」里项目那几项灰着写这句 */
export const 项目忙说法 = "正在处理上一步，稍等";

/** 菜单项两行：上面是名字，下面一行淡色小字说明（灰着的原因、会跳过哪几步…） */
export function 两行(名: string, 注?: string) {
  return (
    <div className="menu-2l">
      <div>{名}</div>
      {注 && <div className="menu-2l-note">{注}</div>}
    </div>
  );
}

type 菜单项们 = NonNullable<MenuProps["items"]>;
/**
 * 客户页 / 受限客户页右上角「更多操作 ▾」（教练点评改版 PR1，11-21：原「项目操作 ▾」+「客户操作 ▾」合成一颗，方案 §2）：
 *   项目 · 当前：<项目名>（小标题，一行省略、悬停看全）→ 新建项目 → 领取 / 项目转让 / 项目退回公海
 *   ────  客户（小标题）→ 客户转让 / 客户退回公海
 *   ────  删除项目（红字，单独放最后）
 * 每项给不给、灰不灰、点了走哪个确认都沿用原来两颗菜单的判断，这里只负责排；哪组一项都没有就连小标题一起不出，
 * 返回空数组 = 页头不摆这颗（销售教练、只读管理员就是这样）
 */
export function 更多操作菜单({ 项目, 客户 }: {
  /** 没有项目区（不是客户详情合并、或受限页没有项目）= null */
  项目: {
    当前名: string | null; 能建: boolean; 开建?: () => void; 项们: 项目菜单项[]; 忙: boolean;
    /** 点了当前项目的哪项；不给 = 由调用方在 Dropdown 的 menu.onClick 里按 key 接（受限页：动作口是 ref，渲染时不能传进函数） */
    点?: (key: 项目动作键) => void;
  } | null;
  客户: 菜单项们;
}): 菜单项们 {
  const 组们: 菜单项们[] = [];
  const 删们: 菜单项们 = [];
  if (项目) {
    const { 当前名, 忙, 点 } = 项目;
    const 项们: 菜单项们 = [
      ...(项目.能建 && 项目.开建 ? [{ key: "new", label: "新建项目", onClick: 项目.开建 }] : []),
      ...项目.项们.filter((x) => x.key !== "delete").map((x) => {
        const 灰 = x.灰 ?? (忙 ? 项目忙说法 : undefined);
        return { key: x.key, disabled: !!灰, label: 灰 ? 两行(x.字, 灰) : <span title={x.注}>{x.字}</span>, ...(点 ? { onClick: () => 点(x.key) } : {}) };
      }),
    ];
    for (const x of 项目.项们.filter((y) => y.key === "delete")) {
      删们.push({ key: x.key, danger: true, disabled: 忙, label: 忙 ? 两行(x.字, 项目忙说法) : x.字, ...(点 ? { onClick: () => 点(x.key) } : {}) });
    }
    if (项们.length || 删们.length) {
      const 题 = 当前名 ? `项目 · 当前：${当前名}` : "项目";
      组们.push([{ type: "group", key: "g-project", label: <span className="rec-menu-cur-t" title={题}>{题}</span>, children: 项们 }]);
    }
  }
  if (客户.length) 组们.push([{ type: "group", key: "g-customer", label: <span className="rec-menu-cur-t">客户</span>, children: 客户 }]);
  if (删们.length) 组们.push(删们);
  return 组们.flatMap((g, i) => (i ? [{ type: "divider" as const, key: `d${i}` }, ...g] : g));
}

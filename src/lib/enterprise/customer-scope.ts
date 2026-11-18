/**
 * 客户页「范围」筛选（客户 11-18 第 12 题：「把客户的页签直接加一个筛选项：我负责的、我参与的、我可见的（给管理用）」）。
 * 纯数据和纯函数，客户端组件也 import；按范围筛的条件在 customers/query.ts 客户筛选条件 / 关键词分页，谁有「我可见的」见 permissions.ts 有管理范围。
 *
 * - mine「我负责的」：客户负责人是我（P-看-03「我的客户只算自己负责的」，和设置里成员的「客户数」同一个数）；
 * - joined「我参与的」：我是这位客户名下某个项目的组员（点了同意、项目没进回收站）、客户不是我负责的；
 * - visible「我可见的」：按权限能看到的全部（原来的列表），只给有管理范围的人。
 * 销售默认「我负责的」，有管理范围的默认「我可见的」；地址栏 scope 记选中项，认不出的、没这一项的当默认。
 * 只在企业版项目模式的客户页认；子集（导入这一批、本月新增、直接推荐）不按范围筛
 */
export const 客户范围们 = ["mine", "joined", "visible"] as const;
export type 客户范围 = (typeof 客户范围们)[number];
export const 客户范围名: Record<客户范围, string> = { mine: "我负责的", joined: "我参与的", visible: "我可见的" };
export const 客户范围说明: Record<客户范围, string> = {
  mine: "负责人是我的客户",
  joined: "我加入了名下项目、但负责人不是我的客户",
  visible: "按权限我能看到的全部客户",
};

/** 这个人能选哪几项：有管理范围的三项，别人只有负责 / 参与 */
export function 客户范围选项(有管理范围: boolean): 客户范围[] {
  return 有管理范围 ? [...客户范围们] : ["mine", "joined"];
}

/** 默认：有管理范围的「我可见的」，别人「我负责的」 */
export function 默认客户范围(有管理范围: boolean): 客户范围 {
  return 有管理范围 ? "visible" : "mine";
}

/** 地址栏的 scope → 这次按哪一项筛：认得出、这个人有这一项才认，不然当默认 */
export function 生效客户范围(raw: string | null | undefined, 有管理范围: boolean): 客户范围 {
  return (客户范围选项(有管理范围) as string[]).includes(raw ?? "") ? (raw as 客户范围) : 默认客户范围(有管理范围);
}

/** 是不是「范围」这一格认的值（客户筛选条件里只认这几个，别的当没带） */
export function 是客户范围(x: unknown): x is 客户范围 {
  return typeof x === "string" && (客户范围们 as readonly string[]).includes(x);
}

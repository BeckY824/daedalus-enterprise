/**
 * 客户页 / 受限客户页右上角「更多操作 ▾」的菜单结构（教练点评改版 PR1，11-21，projects/[id]/project-menu.tsx 更多操作菜单）：
 *   项目组（小标题「项目 · 名字（节点）」，设计语言 D2 · M1-b）→ 分隔线 → 客户组（小标题「客户」）→ 分隔线 → 删除项目（单独放最后、危险色）
 *   - 哪组一项都没有就连小标题一起不出；只剩「删除项目」时不出空的项目小标题（审查 #391 第 2 条）
 *   - 一项都没有 = 空数组（页头不摆这颗）
 *   - 项目区忙：当前项目那几项、删除项目都灰着；新建项目、客户组不受影响
 * 不开浏览器，只看返回的 items 结构。
 */
import { describe, expect, it } from "vitest";
import { 更多操作菜单, 项目忙说法, type 项目菜单项 } from "@/app/(app)/projects/[id]/project-menu";

type 项 = { type?: string; key?: string; disabled?: boolean; danger?: boolean; children?: 项[] };
/** 摊成一串：组写「#key」，组里的项接着排；分隔线「—」；灰着的前面加 ⊘、危险的加 ! */
const 摊 = (items: unknown[]): string[] => (items as 项[]).flatMap((x) =>
  x.type === "divider" ? ["—"]
    : x.type === "group" ? [`#${x.key}`, ...摊(x.children ?? [])]
      : [`${x.disabled ? "⊘" : ""}${x.danger ? "!" : ""}${x.key}`]);

const 转 = { key: "transfer", 字: "项目转让" } as const satisfies 项目菜单项;
const 退 = { key: "pool", 字: "项目退回公海" } as const satisfies 项目菜单项;
const 删 = { key: "delete", 字: "删除项目", 危险: true } as const satisfies 项目菜单项;
const 客户 = [{ key: "cust-transfer", label: "客户转让" }, { key: "cust-pool", label: "客户退回公海" }];
const 项目 = (x: Partial<NonNullable<Parameters<typeof 更多操作菜单>[0]["项目"]>> = {}) =>
  ({ 当前名: "项目一", 能建: true, 开建: () => {}, 项们: [转, 退, 删], 忙: false, ...x });

describe("更多操作菜单", () => {
  it("全有：项目组 → 客户组 → 删除项目单独放最后", () => {
    expect(摊(更多操作菜单({ 项目: 项目(), 客户 }))).toEqual(["#g-project", "new", "transfer", "pool", "—", "#g-customer", "cust-transfer", "cust-pool", "—", "!delete"]);
  });

  it("只剩「删除项目」一项：不出空的项目小标题，删除项目照样单独放最后", () => {
    expect(摊(更多操作菜单({ 项目: 项目({ 能建: false, 项们: [删] }), 客户: [] }))).toEqual(["!delete"]);
    expect(摊(更多操作菜单({ 项目: 项目({ 能建: false, 项们: [删] }), 客户 }))).toEqual(["#g-customer", "cust-transfer", "cust-pool", "—", "!delete"]);
  });

  it("哪组一项都没有就不出那组；全没有 = 空数组（页头不摆这颗）", () => {
    expect(摊(更多操作菜单({ 项目: null, 客户 }))).toEqual(["#g-customer", "cust-transfer", "cust-pool"]);
    expect(摊(更多操作菜单({ 项目: 项目({ 能建: false, 项们: [] }), 客户 }))).toEqual(["#g-customer", "cust-transfer", "cust-pool"]);
    expect(摊(更多操作菜单({ 项目: 项目(), 客户: [] }))).toEqual(["#g-project", "new", "transfer", "pool", "—", "!delete"]);
    expect(更多操作菜单({ 项目: null, 客户: [] })).toEqual([]);
    expect(更多操作菜单({ 项目: 项目({ 能建: false, 项们: [] }), 客户: [] })).toEqual([]);
  });

  it("没有当前项目：小标题只写「项目」；有就写「项目 · 名字（节点）」，没节点只写名字", () => {
    const 题 = (items: unknown[]) => JSON.stringify((items[0] as { label: unknown }).label);
    expect(题(更多操作菜单({ 项目: 项目({ 当前名: null, 项们: [] }), 客户: [] }))).toContain("\"项目\"");
    expect(题(更多操作菜单({ 项目: 项目(), 客户: [] }))).toContain("\"项目 · 项目一\"");
    expect(题(更多操作菜单({ 项目: 项目({ 当前节点: "线索验证" }), 客户: [] }))).toContain("\"项目 · 项目一（线索验证）\"");
    expect(题(更多操作菜单({ 项目: 项目({ 当前节点: "线索验证" }), 客户: [] }))).not.toContain("当前：");
  });

  it("项目区忙：当前项目那几项、删除项目灰着；新建项目、客户组照常；给了 点 才挂 onClick", () => {
    const 点了: string[] = [];
    const items = 更多操作菜单({ 项目: 项目({ 忙: true, 点: (k) => 点了.push(k) }), 客户 });
    expect(摊(items)).toEqual(["#g-project", "new", "⊘transfer", "⊘pool", "—", "#g-customer", "cust-transfer", "cust-pool", "—", "⊘!delete"]);
    expect(JSON.stringify((items as 项[])[0].children)).toContain(项目忙说法);
    const 转让项 = (items as (项 & { onClick?: () => void })[])[0].children![1] as { onClick?: () => void };
    转让项.onClick?.();
    expect(点了).toEqual(["transfer"]);
    // 不给 点（受限页在 Dropdown menu.onClick 里按 key 接）：项上不挂 onClick
    const 无 = 更多操作菜单({ 项目: 项目(), 客户: [] }) as (项 & { onClick?: unknown })[];
    expect(无[0].children!.slice(1).every((x) => !("onClick" in x))).toBe(true);
  });
});

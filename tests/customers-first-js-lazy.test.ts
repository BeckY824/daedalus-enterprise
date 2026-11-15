/**
 * 客户列表首屏 JS（速度闸门 11-15：改版后 870 KB、线 850）：点了才用的弹窗 / 抽屉 / 确认框 / 项目看板只能按需加载。
 * 谁把它们改回静态 import，这里先红（闸门要等 CI 生产构建才量得出来）。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 读 = (p: string) => fs.readFileSync(path.resolve("src", p), "utf8");
/** 运行时的静态 import（`import type` 不算：编译后就没了） */
const 静态引了 = (src: string, 模块: RegExp) =>
  src.split("\n").some((l) => /^\s*import\s+(?!type\b)/.test(l) && 模块.test(l));

describe("客户列表首屏不带点了才用的块", () => {
  const 列表 = 读("app/(app)/customers/CustomersView.tsx");
  it.each(["CustomerForm", "ImportDrawer", "TransferDialog"])("CustomersView 不静态引 %s", (名) => {
    expect(静态引了(列表, new RegExp(`from "\\./${名}"`))).toBe(false);
    expect(列表).toMatch(new RegExp(`import\\("\\./${名}"\\)`));
  });
  it("转让确认（useTransferConfirm）点了才取转让框", () => {
    const src = 读("app/(app)/customers/useTransferConfirm.tsx");
    expect(静态引了(src, /from "\.\/TransferDialog"/)).toBe(false);
  });
  it("弹框宿主入口不静态引实现和后果框", () => {
    const src = 读("components/dialog-host.tsx");
    expect(静态引了(src, /dialog-host-root|ConsequenceDialog/)).toBe(false);
    expect(src).toMatch(/import\("@\/components\/dialog-host-root"\)/);
  });
  it("客户页引的 board-page 走 ProjectsView 懒入口（列表视图不带项目看板）", () => {
    const src = 读("app/(app)/projects/board-page.tsx");
    expect(静态引了(src, /from "\.\/ProjectsView"/)).toBe(false);
    expect(静态引了(src, /from "\.\/ProjectsViewLazy"/)).toBe(true);
  });
});

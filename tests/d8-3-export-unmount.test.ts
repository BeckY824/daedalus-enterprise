/**
 * D8-3：离开客户页不打断导出。原先组件一卸载就 abort，几万条时「点了导出没东西」。
 * 现在卸载不 abort（下载走 a.click()，卸载后照样存 ZIP），只在导出中拦一下关标签页 / 刷新。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/app/(app)/customers/CustomersView.tsx", import.meta.url), "utf8");

describe("D8-3 客户导出：离开页面接着下完", () => {
  it("卸载时不 abort 导出", () => {
    expect(src).not.toMatch(/useEffect\(\s*\(\)\s*=>\s*\(\)\s*=>\s*导出取消\.current\?\.abort\(\)/);
    // 只剩「取消导出」按钮那一处 abort
    expect(src.match(/导出取消\.current\?\.abort\(\)/g)?.length).toBe(1);
    expect(src).toMatch(/onClick=\{\(\) => 导出取消\.current\?\.abort\(\)\}>取消导出/);
  });

  it("导出中才拦关标签页，结束后摘掉", () => {
    expect(src).toMatch(/if \(!导出中\) return;[\s\S]{0,200}addEventListener\("beforeunload"/);
    expect(src).toMatch(/removeEventListener\("beforeunload"/);
    expect(src).toMatch(/\}, \[导出中\]\);/);
  });
});

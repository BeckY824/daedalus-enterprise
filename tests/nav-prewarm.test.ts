import { describe, it, expect } from "vitest";
import { 读预热设置, 按设置筛, 重置预热警告 } from "@/lib/nav-prewarm";

/** 企业版项目模式下左栏主组 + 新线索（AppShell 预热页 的候选，顺序同左栏） */
const 候选 = ["/dashboard", "/overview", "/channels", "/pool", "/customers", "/projects", "/leads"];

describe("左栏空闲预热：CRM_NAV_PREWARM", () => {
  it("不设 / 空 = 照旧全部预热", () => {
    expect(读预热设置(undefined)).toBe("全部");
    expect(读预热设置("")).toBe("全部");
    expect(读预热设置("  ")).toBe("全部");
    expect(按设置筛(候选, 读预热设置(undefined))).toEqual(候选);
  });

  it("all（不分大小写）= 全部", () => {
    for (const v of ["all", "ALL", " All "]) expect(读预热设置(v)).toBe("全部");
  });

  it("列表项去尾斜杠、补前导斜杠后再比", () => {
    expect(按设置筛(候选, 读预热设置("customers/, /pool//, overview"))).toEqual(["/overview", "/pool", "/customers"]);
  });

  it("一项都对不上 = 不预热，只警告一次", () => {
    重置预热警告();
    const 话们: string[] = [];
    const 记 = (话: string) => 话们.push(话);
    expect(按设置筛(候选, 读预热设置("/settings,/admin", 记))).toEqual([]);
    expect(按设置筛(候选, 读预热设置("/customrs", 记))).toEqual([]);
    expect(话们).toHaveLength(1);
    expect(话们[0]).toContain("按不预热处理");
    // 有一项对得上就不警告
    重置预热警告();
    读预热设置("/customers,/admin", 记);
    expect(话们).toHaveLength(1);
  });

  it("0 / none = 一页都不预热", () => {
    for (const v of ["0", "none", "NONE", " none "]) expect(按设置筛(候选, 读预热设置(v))).toEqual([]);
  });

  it("列表 = 只取列出的、且本来就在名单里的；顺序跟左栏走", () => {
    expect(按设置筛(候选, 读预热设置("/pool, /customers"))).toEqual(["/pool", "/customers"]);
    expect(按设置筛(候选, 读预热设置("/customers,/settings,/admin", () => {}))).toEqual(["/customers"]);
    // 没开项目模式时名单里没有 /leads，写了也不取
    expect(按设置筛(["/dashboard", "/customers"], 读预热设置("/leads", () => {}))).toEqual([]);
  });

  it("layout 每次渲染读 process.env（运行时改、重启生效，不是构建期的 NEXT_PUBLIC）", () => {
    const 原 = process.env.CRM_NAV_PREWARM;
    try {
      process.env.CRM_NAV_PREWARM = "none";
      expect(读预热设置()).toEqual([]);
      delete process.env.CRM_NAV_PREWARM;
      expect(读预热设置()).toBe("全部");
    } finally {
      if (原 === undefined) delete process.env.CRM_NAV_PREWARM;
      else process.env.CRM_NAV_PREWARM = 原;
    }
  });
});

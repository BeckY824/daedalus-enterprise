/**
 * CI 的 PR 相关单测选法（scripts/ci/related-tests.mjs，11-17 测试影响分析简化版）：
 * 改叶子文件 → 少量用例 + 静态守门、分进 8 片；改 prisma / 依赖 / 配置 / .github / hooks、删文件、改非代码资源 → 全套。
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { 依赖图用例, 按路径引用的用例, 选单测, 静态守门 } from "../scripts/ci/related-tests.mjs";

const root = path.resolve(__dirname, "..");
const 改 = (...路径们: string[]) => 路径们.map((p) => ({ 状态: "M", 路径: p }));

describe("选单测", () => {
  it("只改一个叶子文件：相关模式，用例不多，含依赖它的用例和全部静态守门，均分进 8 片", () => {
    const r = 选单测({ root, 改动: 改("src/lib/appearance.ts") });
    expect(r.模式).toBe("相关");
    const 守门 = 静态守门(root);
    expect(守门.length).toBeGreaterThan(10);
    for (const t of 守门) expect(r.用例).toContain(t);
    const 牵连 = r.用例.filter((t) => !守门.includes(t));
    expect(牵连.length).toBeGreaterThan(0);
    expect(牵连.length).toBeLessThan(20);
    expect(牵连).toEqual(expect.arrayContaining(依赖图用例(root, ["src/lib/appearance.ts"])));
    expect(r.分片).toHaveLength(8);
    expect(r.分片.flat().sort()).toEqual(r.用例);
    expect(Math.max(...r.分片.map((s) => s.length)) - Math.min(...r.分片.map((s) => s.length))).toBeLessThanOrEqual(1);
  });

  it("按路径读源码的用例也选上（动作桩按仓库内路径补全导出）", () => {
    expect(按路径引用的用例(root, ["src/app/(app)/follow-method-actions.ts"])).toContain("tests/ent-follow-method.ui.test.ts");
    expect(选单测({ root, 改动: 改("src/app/(app)/follow-method-actions.ts") }).用例).toContain("tests/ent-follow-method.ui.test.ts");
  });

  it.each([
    ["prisma/schema.prisma"],
    ["prisma/migrations/x/migration.sql"],
    ["package.json"],
    ["package-lock.json"],
    ["vitest.config.ts"],
    ["tsconfig.json"],
    ["eslint.config.mjs"],
    [".github/workflows/ci.yml"],
    ["hooks/pre-push"],
    ["tests/setup-db.ts"],
  ])("改到 %s → 全套", (p) => {
    const r = 选单测({ root, 改动: [...改("src/lib/appearance.ts"), ...改(p)] });
    expect(r.模式).toBe("全套");
    expect(r.原因).toContain(p);
  });

  it("删了或改名了代码文件 → 全套；改 src 下的样式 → 全套", () => {
    expect(选单测({ root, 改动: [{ 状态: "D", 路径: "src/lib/旧的.ts" }] }).模式).toBe("全套");
    expect(选单测({ root, 改动: [{ 状态: "R100", 路径: "src/lib/a.ts" }, { 状态: "R100", 路径: "src/lib/b.ts" }] }).模式).toBe("全套");
    expect(选单测({ root, 改动: 改("src/app/globals.css") }).模式).toBe("全套");
  });

  it("只改没人引用的文档：相关模式，只跑静态守门；有用例按路径读的文档（CHANGELOG.md）连那几个用例一起跑", () => {
    // 路径现拼：写成字面量的话，这份用例自己就「按路径引用」了它
    const r = 选单测({ root, 改动: 改(["docs", "没人引用的说明.md"].join("/")) });
    expect(r.模式).toBe("相关");
    expect(r.用例).toEqual([...静态守门(root)].sort());
    const c = 选单测({ root, 改动: 改("CHANGELOG.md") });
    expect(c.模式).toBe("相关");
    expect(c.用例.length).toBeGreaterThan(静态守门(root).length);
    expect(c.用例).toEqual(expect.arrayContaining(按路径引用的用例(root, ["CHANGELOG.md"])));
  });

  it("改被广泛引用的文件：相关模式但用例很多（PR 上仍比全套少）", () => {
    const r = 选单测({ root, 改动: 改("src/lib/prisma.ts") });
    expect(r.模式).toBe("相关");
    expect(r.用例.length).toBeGreaterThan(300);
  });
});

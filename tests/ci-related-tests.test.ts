/**
 * CI 的 PR 相关单测选法（scripts/ci/related-tests.mjs，11-17 测试影响分析简化版）：
 * 改叶子文件 → 少量用例 + 静态守门、分进 8 片；改 prisma / 依赖 / 配置 / .github / hooks、删文件、改非代码资源 → 全套。
 * 分片按耗时（11-20 批次 32A）：scripts/ci/unit-timing.json 的秒数 + 每文件开销，最慢的先放进最轻的片；全套也一样分，一个不漏、不重。
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { 依赖图用例, 按路径引用的用例, 选单测, 静态守门, 按耗时分片, 估秒, 读耗时, 全部用例, 相关每片秒数 } from "../scripts/ci/related-tests.mjs";

const root = path.resolve(__dirname, "..");
const 改 = (...路径们: string[]) => 路径们.map((p) => ({ 状态: "M", 路径: p }));

describe("选单测", () => {
  it("只改一个叶子文件：相关模式，用例不多，含依赖它的用例和全部静态守门，按耗时分进 8 片", () => {
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
    // 牵连少：按耗时表合计不到 相关每片秒数，只用第 1 片，其余空着直接通过
    const 秒 = 估秒(读耗时(root));
    expect(r.用例.reduce((n, t) => n + 秒(t), 0)).toBeLessThan(相关每片秒数);
    expect(r.分片[0]).toEqual(r.用例);
    expect(r.分片.slice(1).every((s) => s.length === 0)).toBe(true);
  });

  it("牵连多：按合计秒数开片，用到的各片按耗时差不过一个最慢用例", () => {
    const r = 选单测({ root, 改动: 改("src/lib/prisma.ts") });
    expect(r.模式).toBe("相关");
    const 秒 = 估秒(读耗时(root));
    const 合计 = r.用例.reduce((n, t) => n + 秒(t), 0);
    const 用了 = r.分片.filter((s) => s.length > 0);
    expect(r.分片).toHaveLength(8);
    expect(用了.length).toBe(Math.min(8, Math.ceil(合计 / 相关每片秒数)));
    expect(r.分片.flat().sort()).toEqual(r.用例);
    const 各片 = 用了.map((s) => s.reduce((n, t) => n + 秒(t), 0));
    expect(Math.max(...各片) - Math.min(...各片)).toBeLessThanOrEqual(Math.max(...r.用例.map(秒)) + 1e-9);
  });

  it("全套：tests/ 下每个 *.test.ts 恰好分进一片，各片按耗时表差不过一个最慢用例", () => {
    const r = 选单测({ root, 改动: 改("package.json") });
    expect(r.模式).toBe("全套");
    const 全部 = 全部用例(root);
    expect(全部.length).toBeGreaterThan(900);
    expect(r.用例).toEqual(全部);
    expect(r.分片).toHaveLength(8);
    expect(r.分片.flat().sort()).toEqual(全部);
    const 秒 = 估秒(读耗时(root));
    const 合计 = r.分片.map((s) => s.reduce((n, t) => n + 秒(t), 0));
    expect(Math.max(...合计) - Math.min(...合计)).toBeLessThanOrEqual(Math.max(...全部.map(秒)) + 1e-9);
  });

  it("按耗时分片：最慢的先放、每个放进当时最轻的片；表里没有的按中位数；同一输入同一结果", () => {
    const 表 = { "tests/a.test.ts": 100, "tests/b.test.ts": 60, "tests/c.test.ts": 40, "tests/d.test.ts": 1, "tests/e.test.ts": 2, "tests/f.test.ts": 3 };
    const 片 = 按耗时分片(Object.keys(表), 2, 表);
    // 每个 +0.8：a 100.8 | b 60.8 → c 进 b 片 101.6 → f 进 a 片 104.6 → e 进 b 片 104.4 → d 进 b 片
    expect(片).toEqual([["tests/a.test.ts", "tests/f.test.ts"], ["tests/b.test.ts", "tests/c.test.ts", "tests/d.test.ts", "tests/e.test.ts"]]);
    expect(按耗时分片([...Object.keys(表)].reverse(), 2, 表)).toEqual(片);
    // 没记的新用例：中位数（排好序取第 n/2 个，这里 40）+ 每文件开销，不是 0
    expect(估秒(表)("tests/新的.test.ts")).toBeCloseTo(估秒(表)("tests/c.test.ts"));
    // 空表 = 按个数均分；片数比用例多时多出来的片是空的
    expect(按耗时分片(["tests/x.test.ts", "tests/y.test.ts", "tests/z.test.ts"], 2).map((s) => s.length).sort()).toEqual([1, 2]);
    expect(按耗时分片(["tests/x.test.ts"], 3)).toEqual([["tests/x.test.ts"], [], []]);
  });

  it("耗时表的用例都还在 tests/ 下有一大半（表太旧就该照文件头重写）", () => {
    const 表 = Object.keys(读耗时(root));
    const 全部 = new Set(全部用例(root));
    expect(表.length).toBeGreaterThan(0);
    expect(表.filter((t) => 全部.has(t)).length / 全部.size).toBeGreaterThan(0.8);
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

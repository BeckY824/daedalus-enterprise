/**
 * 跳转优化 PR-A（11-24）：换客户 / 换项目 / 列表进详情不闪屏——路由结构上的几条规矩。
 *
 * 用户原话：「不要闪屏，目前我在客户详情页从一个客户点到另一个客户，会有刷新。这种效果可以过渡的自然一点吗？包括其余页面的也要这样。」
 * 闪的机理（Next 16 layout-router 按段的参数值做 key，LoadingBoundary 在 key 里面）：
 *   - [id] 那一层有 loading.tsx → 换一个 id 就是新挂的边界，先出骨架、旧内容立刻卸掉
 *   - 中栏名单是 [id] 的 page → 每换一位整个名单重挂、出名单骨架、服务端把名单查询重跑一遍
 *   - 壳里 <motion.div key={底下那页}> → 地址一变整块正文重挂，底下的边界都是新挂的，同样先出骨架
 *   - (app)/loading.tsx（11-24 二轮撤）→ 它也在 key 里面：换顶层段（项目看板卡 → 客户详情、通知铃、复盘看板、手机菜单换页）
 *     时同样是新挂的边界，3703 实操量到旧内容 36–59ms 就没了、先出 ~400ms 骨架。首屏骨架改由壳里一直挂着的 <槽位> Suspense 出
 * 这几处任何一处回来，旧内容就又会在点下去 30–60ms 内消失（3705 实测见 PR 描述）。真浏览器里的效果见 tests/nav-smooth.ui.test.ts、e2e-ent/nav-smooth.spec.ts
 */
import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import { createElement as h, use } from "react";
import { renderToString } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";

const 根 = path.resolve(__dirname, "../src/app/(app)");
const 读 = (p: string) => fs.readFileSync(path.join(根, p), "utf8");
const 有 = (p: string) => fs.existsSync(path.join(根, p));

function 找(dir: string, 名: string, 出: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) 找(p, 名, 出);
    else if (e.name === 名) 出.push(path.relative(根, p));
  }
  return 出;
}

describe("换 id 不出骨架", () => {
  it("带参数的那一层（[id]，正文和中栏都算）不放 loading.tsx", () => {
    const 带参 = 找(根, "loading.tsx").filter((p) => /\[[^\]]+\]/.test(p));
    expect(带参, "这些 loading 会让换一个 id 时先出骨架、旧内容立刻没了").toEqual([]);
  });

  it("客户详情、项目详情的中栏名单在 (detail)/layout 里、自带 Suspense，[id] 页本身什么都不画", () => {
    for (const 段 of ["customers", "projects"]) {
      expect(有(`@pane/${段}/[id]/page.tsx`), `@pane/${段}/[id]/page.tsx 不该再有：名单放在 page 里每换一位都重挂`).toBe(false);
      const 层 = 读(`@pane/${段}/(detail)/layout.tsx`);
      expect(层).toMatch(/<Suspense fallback=\{<CustomerRosterSkeleton[^>]*\/>\}>/);
      expect(层).toMatch(段 === "customers" ? /<学员名单 \/>/ : /<项目名单 \/>/);
      expect(读(`@pane/${段}/(detail)/[id]/page.tsx`)).toMatch(/return null;/);
    }
    // /customers 列表页没有中栏，不能被名单 layout 套住
    expect(有("@pane/customers/layout.tsx")).toBe(false);
    expect(读("@pane/customers/page.tsx")).toMatch(/无中栏/);
  });

  it("壳里正文不按地址重挂（不用 key={底下那页}），淡入走 PageFade", () => {
    const 壳 = fs.readFileSync(path.resolve(__dirname, "../src/components/AppShell.tsx"), "utf8");
    expect(壳).not.toMatch(/key=\{底下那页\}/);
    expect(壳.match(/<PageFade 页=\{底下那页\}/g)?.length, "电脑和手机两处正文都包着").toBe(2);
  });
});

describe("站内跳转不出骨架，首屏骨架由 <槽位> 出", () => {
  it("(app) 下不放 loading.tsx（设置浮层 @modal 自己那一份除外）", () => {
    const 有的 = 找(根, "loading.tsx").filter((p) => !p.startsWith("@modal/"));
    expect(有的, "这些 loading 在 Next 里按子段 key 新挂，换段时先出骨架、旧内容立刻没了；首屏骨架放进 components/SlotSkeleton.tsx 的 <槽位>").toEqual([]);
  });

  it("<槽位> 自带 Suspense、fallback 是 SlotSkeleton；正文、中栏、浮层都包着", () => {
    const 骨 = fs.readFileSync(path.resolve(__dirname, "../src/components/SlotSkeleton.tsx"), "utf8");
    expect(骨).toMatch(/<Suspense fallback=\{<SlotSkeleton \/>\}>\{children\}<\/Suspense>/);
    const 壳 = fs.readFileSync(path.resolve(__dirname, "../src/components/AppShell.tsx"), "utf8");
    // 正文：电脑、手机各一处，包在 PageFade 里（外框不重挂、Suspense 一直挂着）
    expect(壳.match(/<槽位 名="main">[^\n]*\{children\}[^\n]*<\/槽位>/g)?.length).toBe(2);
    // 中栏：电脑一处、手机两处（客户详情的名单抽屉、首页的对话列表），没有裸的 {pane}
    expect(壳.match(/<槽位 名="pane"[^>]*>\{pane\}<\/槽位>/g)?.length).toBe(3);
    expect(壳).not.toMatch(/&& pane\}|^\s*\{pane\}\s*$/m);
    expect(读("layout.tsx")).toMatch(/<槽位 名="modal">\{modal\}<\/槽位>/);
  });

  it("整页打开（服务端渲染）时页面数据没到，<槽位> 先流出骨架，不白屏", async () => {
    const { 槽位 } = await import("@/components/SlotSkeleton");
    const 永远不来 = new Promise<never>(() => {});
    const Pending = () => use(永远不来);
    expect(renderToString(h(槽位, { 名: "main", children: h(Pending) })), "正文出通用骨架").toContain('data-testid="page-skeleton"');
    expect(renderToString(h(槽位, { 名: "modal", children: h(Pending) })), "浮层什么都不画").not.toMatch(/skeleton|skel/);
  });

  it("中栏不画正文骨架、浮层什么都不画", () => {
    const 骨 = fs.readFileSync(path.resolve(__dirname, "../src/components/SlotSkeleton.tsx"), "utf8");
    expect(骨).toMatch(/if \(槽 === "modal"\) return null;/);
    expect(骨).toMatch(/if \(槽 === "pane"\) return [^;]*CustomerRosterSkeleton[^;]*: null;/);
  });
});

describe("首屏包", () => {
  it("SlotSkeleton 带进每页首屏包的骨架不连着名单组件（CustomerRoster 的 Drawer、dayjs 那一套）", async () => {
    const r = await build({
      entryPoints: [path.resolve(__dirname, "../src/components/SlotSkeleton.tsx")], bundle: true, write: false, metafile: true, format: "esm", jsx: "automatic",
      alias: { "@": path.resolve(__dirname, "../src") }, logLevel: "silent",
      // 壳本来就带的库不算（antd、react、next）；只看骨架自己拉进来的业务代码
      external: ["react", "react-dom", "next", "next/*", "antd", "@ant-design/*"],
    });
    const 进来的 = Object.keys(r.metafile!.inputs);
    expect(进来的.filter((x) => /CustomerRoster|ProjectRoster|dayjs/.test(x))).toEqual([]);
  }, 30_000);
});

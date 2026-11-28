import { describe, expect, it } from "vitest";
import { 详情地址, 该走兜底, 缓存秒, 认页面, 页面键, 版本地址, 该后台刷新, 该兜底刷新, 清旧记录, 来了新通知, 该合并跳过, 刷新合并毫秒, 记渲染版, 撤渲染版, 取渲染版 } from "@/lib/page-fresh";
import fs from "node:fs";

describe("PR-D 先出缓存、后台更新：纯函数", () => {
  it("认页面：三页认得，别的不认", () => {
    expect(认页面("/customers/abc123", "")).toEqual({ 种类: "customer", id: "abc123", 查询: "" });
    expect(认页面("/projects/p_9/", "x=1")).toEqual({ 种类: "project", id: "p_9", 查询: "" });
    expect(认页面("/customers", "tab=1&scope=mine")?.种类).toBe("customer-list");
    expect(认页面("/customers/new", "")).toBeNull();
    expect(认页面("/pool", "")).toBeNull();
    expect(认页面("/customers/a/b", "")).toBeNull();
    expect(认页面("/customers/../x", "")).toBeNull();
  });
  it("列表带关键词 / 号码 / 批次不问（重查询）", () => {
    expect(认页面("/customers", "keyword=a")).toBeNull();
    expect(认页面("/customers", "phone=1")).toBeNull();
    expect(认页面("/customers", "batch=b")).toBeNull();
  });
  it("页面键、版本地址", () => {
    const p = 认页面("/customers", "scope=mine")!;
    expect(页面键(p)).toBe("customer-list::scope=mine");
    expect(版本地址(p)).toBe("/api/page-version?kind=customer-list&qs=scope%3Dmine");
    expect(版本地址(认页面("/projects/x1", "")!)).toBe("/api/page-version?kind=project&id=x1");
  });
  it("该后台刷新：按渲染版本比——没登记 / 拿不到 / 一样不刷，不一样刷（预取 4 分钟后首次进页也刷）", () => {
    expect(该后台刷新(undefined, "b")).toBe(false);
    expect(该后台刷新("a", null)).toBe(false);
    expect(该后台刷新("a", "a")).toBe(false);
    expect(该后台刷新("a", "b")).toBe(true);
    // 预取 / 预热 4 分钟前渲染的页：登记的就是当时的版本，不论缓存多旧
    记渲染版("customer:c1:", "旧");
    expect(该后台刷新(取渲染版("customer:c1:"), "新")).toBe(true);
    // 页面换新（router.refresh 后新版本登记）后一致就不再刷；旧的卸载不会撤掉新的
    记渲染版("customer:c1:", "新");
    撤渲染版("customer:c1:", "旧");
    expect(取渲染版("customer:c1:")).toBe("新");
    expect(该后台刷新(取渲染版("customer:c1:"), "新")).toBe(false);
    撤渲染版("customer:c1:", "新");
    expect(取渲染版("customer:c1:")).toBeUndefined();
  });
  it("没纳入的页兜底：回来 >60 秒刷、<60 秒不刷、没记过不刷、到 300 秒 Next 自己重取不再刷", () => {
    const 现在 = 1_000_000;
    expect(该兜底刷新(undefined, 现在)).toBe(false);
    expect(该兜底刷新(现在 - 59_000, 现在)).toBe(false);
    expect(该兜底刷新(现在 - 60_000, 现在)).toBe(false);
    expect(该兜底刷新(现在 - 61_000, 现在)).toBe(true);
    expect(该兜底刷新(现在 - 缓存秒 * 1000, 现在)).toBe(false);
  });
  it("清旧记录：超过 5 分钟的清掉，新的留着", () => {
    const m = new Map([["/pool", 0], ["/board", 400_000]]);
    清旧记录(m, 400_000);
    expect([...m.keys()]).toEqual(["/board"]);
  });
  it("next.config：dynamic 300，static 仍 60", () => {
    const s = fs.readFileSync("next.config.ts", "utf8");
    expect(s).toMatch(new RegExp(`dynamic: ${缓存秒},\\s*static: 60,`));
  });
  it("在飞按页面键：A 在飞时切到 B，B 照样检查", () => {
    const s = fs.readFileSync("src/components/PageFreshness.tsx", "utf8");
    expect(s).toContain("new Set<string>()");
    expect(s).toContain("在飞.current.has(键)");
    expect(s).toContain("在飞.current.delete(键)");
    expect(s).not.toMatch(/在飞\.current = (true|false)/);
  });
  it("接线：三页（中栏槽位页，每次导航都重算）都下发渲染版本", () => {
    for (const f of ["@pane/customers/page.tsx", "@pane/customers/(detail)/[id]/page.tsx", "@pane/projects/(detail)/[id]/page.tsx"]) {
      const s = fs.readFileSync(`src/app/(app)/${f}`, "utf8");
      expect(s).toContain("<RenderedVersion 版={");
    }
  });
  it("接线：layout 挂了 PageFreshness；铃铛来新通知发数据失效事件；刷新前判忙", () => {
    expect(fs.readFileSync("src/app/(app)/layout.tsx", "utf8")).toContain("<PageFreshness />");
    expect(fs.readFileSync("src/components/NoticeBell.tsx", "utf8")).toContain("数据失效事件");
    expect(fs.readFileSync("src/components/PageFreshness.tsx", "utf8")).toContain("现在忙()");
  });
  it("来了新通知：看最新时间，不看未读数；第一次只记不发", () => {
    expect(来了新通知(null, 100)).toBe(false);
    expect(来了新通知(100, 100)).toBe(false);
    expect(来了新通知(100, 200)).toBe(true); // 读了几条、同时来了新的：未读数没变也触发
    expect(来了新通知(200, 100)).toBe(false);
  });
  it("刷新合并：2 秒内只刷一次", () => {
    expect(该合并跳过(0, 5000)).toBe(false);
    expect(该合并跳过(5000, 5000 + 刷新合并毫秒 - 1)).toBe(true);
    expect(该合并跳过(5000, 5000 + 刷新合并毫秒)).toBe(false);
  });
  it("接线：两份铃铛共用模块级「上次见到的最新通知」；空了刷走合并", () => {
    const b = fs.readFileSync("src/components/NoticeBell.tsx", "utf8");
    expect(b).toContain("const 上次最新通知");
    expect(b).toContain("来了新通知(上次最新通知.值, r.最新)");
    expect(fs.readFileSync("src/components/PageFreshness.tsx", "utf8")).toContain("该合并跳过(上次刷.current");
  });
  it("守卫：customers/ projects/ 下的固定子目录都不算详情页（认页面 / 骨架都判 null）", () => {
    for (const 区 of ["customers", "projects"]) {
      const 目录 = fs.readdirSync(`src/app/(app)/${区}`, { withFileTypes: true }).filter((d) => d.isDirectory() && !/^[[(@]/.test(d.name));
      expect(目录.length).toBeGreaterThan(0);
      for (const d of 目录) {
        expect(认页面(`/${区}/${d.name}`, ""), `${区}/${d.name}`).toBeNull();
        expect(详情地址(`/${区}/${d.name}`), `${区}/${d.name}`).toBeNull();
      }
    }
    for (const f of ["@pane/customers", "@pane/projects"]) {
      for (const d of fs.readdirSync(`src/app/(app)/${f}`, { withFileTypes: true }).filter((x) => x.isDirectory() && !/^[[(@]/.test(x.name))) {
        expect(认页面(`/${f.split("/")[1]}/${d.name}`, ""), `${f}/${d.name}`).toBeNull();
      }
    }
    expect(认页面("/customers/dupes", "")).toBeNull();
    expect(认页面("/projects/handover", "")).toBeNull();
    expect(认页面("/customers/c1", "")?.种类).toBe("customer");
    expect(详情地址("/projects/p1")).toEqual({ 区: "projects", 段: "p1" });
  });
  it("渲染版与现版都是 gone：走 60 秒兜底，不走版本比较", () => {
    expect(该走兜底("gone", "gone")).toBe(true);
    expect(该走兜底("gone", "x")).toBe(false);
    expect(该走兜底(undefined, "gone")).toBe(false);
    expect(该后台刷新("gone", "gone")).toBe(false);
  });
  it("接线：到过记录的键 = 路径+查询；查询变只记不刷；路径变清上次刷；铃铛挂载即问、只让看得见的那份问", () => {
    const f = fs.readFileSync("src/components/PageFreshness.tsx", "utf8");
    expect(f).toContain("`${路径}?${查询}`");
    expect(f).toContain("if (!同路径换查询) 兜底(上次, 现在)");
    expect(f).toContain("if (!同路径换查询) 上次刷.current = 0");
    const b = fs.readFileSync("src/components/NoticeBell.tsx", "utf8");
    expect(b).toMatch(/问\(true\);\s*const t = window\.setInterval\(\(\) => 问\(\), 60_000\)/);
    expect(b).toContain("getClientRects().length === 0");
    for (const x of ["@pane/customers/page.tsx", "@pane/customers/(detail)/[id]/page.tsx", "@pane/projects/(detail)/[id]/page.tsx"]) {
      expect(fs.readFileSync(`src/app/(app)/${x}`, "utf8")).toContain("<Suspense fallback={null}><RenderedVersion");
    }
  });
});

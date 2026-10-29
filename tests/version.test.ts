/**
 * 版本号：根 package.json 和 package-lock.json 对得上。
 *
 * 企业库不带桌面壳，版本号只在根目录这两份里。
 * 企业版不打 tag 发镜像（2026-10-29 删了 release.yml，私有部署直接从库里打包），所以没有 tag 那一道核对。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 读JSON = (p: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", p), "utf8"));

describe("版本号", () => {
  it("根包和锁文件对得上", () => {
    const 读 = (p: string) => 读JSON(p).version as string;
    const 根 = 读("package.json");
    expect(根).toMatch(/^\d+\.\d+\.\d+$/);
    expect(读("package-lock.json")).toBe(根);
  });

  /**
   * CHANGELOG 第一段的版本 = package.json（2026-10-04，回归核对 R-031）。
   * 桌面端「这一版更新了这些」和左栏「更新记录」都按当前版本号去 CHANGELOG 里找那一段：
   * 改了版本号忘了写 CHANGELOG（或反过来），那枚「新」就不出、更新记录标题也是错的，而且不报错
   */
  it("CHANGELOG 第一段写的就是当前版本", () => {
    const 根 = 读JSON("package.json").version as string;
    const 第一段 = fs.readFileSync(path.resolve(__dirname, "..", "CHANGELOG.md"), "utf8").match(/^## (\d+\.\d+\.\d+)/m)?.[1];
    expect(第一段, "CHANGELOG.md 第一个「## x.y.z」要和 package.json 的版本一致").toBe(根);
  });

  /**
   * 锁文件里**不能有第三方包的版本号等于应用版本号**。
   *
   * 这条钉的是 2026-09-17 那次 CI 全红：`chore: 0.28.0` / `chore: 0.29.0` 两次
   * 改版本号是把旧版本号在锁文件里全文替换，而 `node_modules/scheduler` 的真实版本
   * 恰好就是当时的应用版本 `0.27.0`，于是它跟着被改了两次。react-dom 要 `^0.27.0`，
   * 锁文件里写着 0.29.0，`npm ci` 当场拒绝——CI、镜像、桌面包三个 workflow 一起挂。
   *
   * 本地完全看不出来：`npm run dev` 和 `npm test` 用的是已经装好的 node_modules，
   * 只有干净环境的 `npm ci` 才会说话。所以把它钉在单测里，推之前就红。
   *
   * 改版本号请用 `node scripts/bump-version.mjs <新版本>`，它只动根目录 package.json 和 package-lock.json 里该动的那几处。
   * 万一哪天真有个依赖的版本号和应用版本撞上，这条会误报——那时确认它在锁文件里
   * 确实是这个版本（`npm ci --dry-run` 不报错），再把它加进下面的白名单。
   */
  it("锁文件里没有被版本号替换误伤的依赖", () => {
    const 应用版本 = 读JSON("package.json").version as string;
    const 白名单 = new Set<string>();
    for (const lock of ["package-lock.json"]) {
      const packages = 读JSON(lock).packages as Record<string, { version?: string }>;
      const 撞上的 = Object.entries(packages)
        .filter(([名]) => 名 !== "" && !白名单.has(名))
        .filter(([, v]) => v.version === 应用版本)
        .map(([名]) => 名);
      expect(
        撞上的,
        `${lock} 里这些依赖的版本号等于应用版本 ${应用版本}，多半是改版本号时被全文替换误伤了；` +
          "用 scripts/bump-version.mjs 改版本号",
      ).toEqual([]);
    }
  });
});

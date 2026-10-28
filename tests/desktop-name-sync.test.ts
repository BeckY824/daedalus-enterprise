/**
 * **在设置里改过名字的人，重启之后必须还是那个名字。**
 *
 * 桌面端的名字有两个来源：云端账号（注册时填的）和「个人资料」（自己改的）。
 * 登录那条路会把本机管理员「对成」云端账号——
 * 2026-09-18 之前那是无条件覆盖，于是改完名字、重新登录一次就被改回去了。
 *
 * 判断「改没改过」靠记账：上一次同步下来的云端名字记在 Setting 的 desktop.syncedName。
 * 企业库不再带桌面壳（启动时的 server-entry 那一半在桌面端仓库里钉），这里只钉登录那条路。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 同步名字键 } from "@/lib/desktop/synced-name";

const 根 = path.resolve(__dirname, "..");
const 登录 = fs.readFileSync(path.join(根, "src/app/login/actions.ts"), "utf8");

describe("名字只在你没改过的时候才跟着云端走", () => {
  it("记账的 key 没变，登录那条路用的是同一个常量", () => {
    expect(同步名字键).toBe("desktop.syncedName");
    expect(登录).toContain("同步名字键");
  });

  it("登录那条路同样先问过再写", () => {
    expect(登录).toMatch(/const 名字 = await 该用的名字\(admin\.name, 云端名字\)/);
    expect(登录).toMatch(/人改过 \? 本机名字 : 云端名字/);
  });
});

describe("职位同样：你改过就不动（排查 B4）", () => {
  it("登录不再无条件写回「管理员」", () => {
    expect(登录).not.toMatch(/title: "管理员" \}/);
  });
});

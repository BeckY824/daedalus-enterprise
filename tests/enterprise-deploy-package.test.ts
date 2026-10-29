/**
 * 企业版私有部署的几条硬要求，读文件就能钉住（2026-10-24 起；10-29 docker 部署包删了以后只剩这些）。
 *
 * - 私有部署 10-28 改成独立 node + systemd（部署脚本 ent-deploy.sh 在 skill 里，不在库里）。
 *   它每次从库里拷 deploy/enterprise/tools/smoke.sh 装好后验登录：这一份必须原路径留着，删了部署直接失败
 * - 首启只建 admin，名单外（界面上加的）账号不提示、不删
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { USERS, 要建的账号 } from "../prisma/seed";

const ROOT = path.resolve(__dirname, "..");
const 读 = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replaceAll("\r\n", "\n"); // Windows 检出可能是 CRLF，下面的正则按 \n 写

describe("装完的冒烟检查 smoke.sh", () => {
  it("原路径在、可执行，自己就能跑（不 source 部署包里别的脚本）", () => {
    const p = "deploy/enterprise/tools/smoke.sh";
    expect(statSync(path.join(ROOT, p)).mode & 0o111, "要有执行位").not.toBe(0);
    const 脚本 = 读(p);
    expect(脚本.startsWith("#!/usr/bin/env bash\n")).toBe(true);
    expect(脚本).not.toMatch(/^\s*(source|\.)\s+\S*lib\.sh/m);
  });
});

describe("首启建哪些账号", () => {
  it("企业版只建 admin；不是企业版照旧建整份名单", () => {
    expect(要建的账号(true).map((u) => u.email)).toEqual(["admin"]);
    expect(要建的账号(false)).toBe(USERS);
  });

  it("企业版跳过名单外账号那一段（界面上加的成员不提示、PRUNE_ACCOUNTS 也不删）", () => {
    expect(读("prisma/seed.ts")).toMatch(/const 名单外 = 企业版\(\) \? \[\] :/);
  });
});

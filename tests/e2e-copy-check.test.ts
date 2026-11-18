/**
 * 推送前提示「删掉 / 改掉的中文文案 e2e 里还在用」（hooks/e2e-copy-check.mjs，11-17 复盘第 10 类）。
 * 在临时仓库里造一次改文案的提交，看提示报得对、不乱报、出错也不挡推送。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { 中文片段 } from "../hooks/e2e-copy-check.mjs";

const 脚本 = path.resolve(__dirname, "../hooks/e2e-copy-check.mjs");
const 干净env = () => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
  return env;
};

let 库: string;
let 前: string;
let 后: string;
const git = (...a: string[]) =>
  execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: 库, env: 干净env(), encoding: "utf8" }).trim();
const 写 = (f: string, t: string) => {
  fs.mkdirSync(path.dirname(path.join(库, f)), { recursive: true });
  fs.writeFileSync(path.join(库, f), t);
};
const 跑 = (args: string[], env: NodeJS.ProcessEnv = 干净env()) => execFileSync(process.execPath, [脚本, ...args], { cwd: 库, env, encoding: "utf8" });

beforeAll(() => {
  库 = fs.mkdtempSync(path.join(os.tmpdir(), "crm-e2e-copy-"));
  git("init", "-q");
  写("src/a.tsx", 'export const A = () => <Button>保存成功啦</Button>;\nexport const B = "客户名称";\nexport const C = "跟进计划已完成";\n');
  写(
    "e2e/x.spec.ts",
    [
      'await expect(page.getByText("保存成功啦")).toBeVisible();',
      'await page.getByLabel("客户名称").fill("x");',
      "// 跟进计划已完成：注释里提到的不算",
      'await page.getByRole("button", { name: /保存成功啦/ }).click();',
    ].join("\n"),
  );
  git("add", "-A");
  git("commit", "-qm", "base");
  前 = git("rev-parse", "HEAD");
  // 改文案「保存成功啦」→「已保存」；「客户名称」挪到另一个文件（还在用）；「跟进计划已完成」删掉（e2e 只在注释里提）
  写("src/a.tsx", 'export const A = () => <Button>已保存</Button>;\n');
  写("src/b.ts", 'export const B = "客户名称";\n');
  git("add", "-A");
  git("commit", "-qm", "改文案");
  后 = git("rev-parse", "HEAD");
});

afterAll(() => {
  fs.rmSync(库, { recursive: true, force: true });
});

describe("e2e 旧文案提示", () => {
  it("改掉的文案 e2e 还在用：报出来，带 e2e 位置；挪了位置的、只在注释里提的不报", () => {
    const 出 = 跑([前, 后]);
    expect(出).toContain("「保存成功啦」 e2e/x.spec.ts:1、e2e/x.spec.ts:4");
    expect(出).not.toContain("客户名称");
    expect(出).not.toContain("跟进计划已完成");
  });

  it("钩子环境里带着别的仓库的 GIT_DIR 也照样查当前目录的仓库", () => {
    const 别处 = fs.mkdtempSync(path.join(os.tmpdir(), "crm-e2e-copy-other-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: 别处, env: 干净env() });
      expect(跑([前, 后], { ...干净env(), GIT_DIR: path.join(别处, ".git"), GIT_WORK_TREE: 别处 })).toContain("保存成功啦");
    } finally {
      fs.rmSync(别处, { recursive: true, force: true });
    }
  });

  it("没删中文文案：什么都不打", () => {
    expect(跑([后, 后])).toBe("");
  });

  it("出错只打一行、退出码 0，不挡推送", () => {
    expect(跑(["没有这个提交", 后])).toMatch(/^ {2}- e2e 旧文案提示没跑成/);
  });

  it("中文片段：至少两个汉字，可夹中文标点；注释行、行尾注释不算", () => {
    expect(中文片段('getByText("已删除，可撤销 (3)")')).toEqual(["已删除，可撤销"]);
    expect(中文片段('getByRole("button", { name: "存" })')).toEqual([]);
    expect(中文片段("// 保存成功")).toEqual([]);
    expect(中文片段(" * 保存成功")).toEqual([]);
    expect(中文片段('click("保存") // 点保存按钮')).toEqual(["保存"]);
  });
});

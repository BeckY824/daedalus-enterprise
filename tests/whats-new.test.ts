/**
 * 「更新记录」（2026-10-02）：切 CHANGELOG、并成段、网页团队版那一小节桌面端不给看、读不到时是空的。
 * 「更新后自己弹一次」那半只在桌面端本地模式下跑，企业版删了（死代码第三批），相应用例一起删。
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ id: "u", name: "甲", role: "ADMIN" }) }));

import { 切更新记录, 只留桌面端, 并成段 } from "@/lib/changelog";
import { 全部更新记录 } from "@/app/(app)/whats-new-actions";

const MD = `# 更新记录

开头的说明。

## 0.46.15（2026-10-04）

**新的**

- 一条

### 网页团队版另外

- 同事那条

## 0.46.14 (2026-10-01)

十四

## v0.46.13（2026-09-29）

十三

## 说明

不属于任何一版
`;

describe("切更新记录", () => {
  it("全角半角括号、v 前缀都认；非版本的二级标题截断；开头说明不算", () => {
    const 段 = 切更新记录(MD);
    expect(段.map((s) => [s.版本, s.日期])).toEqual([
      ["0.46.15", "2026-10-04"],
      ["0.46.14", "2026-10-01"],
      ["0.46.13", "2026-09-29"],
    ]);
    expect(段[2].正文).toBe("十三");
  });
  it("桌面端去掉「网页团队版」那一小节，别的留着", () => {
    const 正文 = 只留桌面端(切更新记录(MD)[0].正文);
    expect(正文).toContain("一条");
    expect(正文).not.toContain("同事那条");
    expect(正文).not.toContain("网页团队版");
  });
});

describe("并成段", () => {
  it("折行写的一段并成一行；加粗小标题、列表、空行不并", () => {
    const md = "**标题**\n\n第一行，\n第二行。\n\n- 一条\n- 两条\n接着写";
    expect(并成段(md)).toBe("**标题**\n\n第一行，第二行。\n\n- 一条\n- 两条\n接着写");
  });
});

describe("全部更新记录", () => {
  const 原cwd = process.cwd();
  let 目录 = "";
  beforeEach(() => {
    process.env.CRM_APP_VERSION = "0.46.15";
    目录 = fs.mkdtempSync(path.join(os.tmpdir(), "whats-new-"));
    fs.writeFileSync(path.join(目录, "CHANGELOG.md"), MD);
    process.chdir(目录);
  });
  afterAll(() => {
    process.chdir(原cwd);
    delete process.env.CRM_APP_VERSION;
  });

  it("新的在前，网页团队版那一小节不给看", async () => {
    const r = await 全部更新记录();
    expect(r.现在).toBe("0.46.15");
    expect(r.段.map((s) => s.版本)).toEqual(["0.46.15", "0.46.14", "0.46.13"]);
    expect(r.段[0].正文).not.toContain("同事那条");
  });

  it("读不到 CHANGELOG：全部是空的", async () => {
    fs.rmSync(path.join(目录, "CHANGELOG.md"));
    expect((await 全部更新记录()).段).toEqual([]);
  });
});

describe("更新内容按平台说话（R-076）", () => {
  it("Windows全部历史说明没有Mac控件/快捷键，Mac保留自己的说明", () => {
    const all = 切更新记录(fs.readFileSync(path.resolve(__dirname, "../CHANGELOG.md"), "utf8"));
    const windows = all.map(s => 只留桌面端(s.正文, "win32")).join("\n");
    const mac = all.map(s => 只留桌面端(s.正文, "darwin")).join("\n");
    expect(windows).not.toMatch(/Dock|访达|⌘|<!-- desktop:/);
    expect(windows).toContain("Ctrl+K"); expect(windows).toContain("任务栏图标上的红点");
    expect(windows).not.toContain("右键 Dock");
    expect(mac).toContain("右键 Dock"); expect(mac).toContain("⌘K"); expect(mac).not.toContain("<!-- desktop:");
  });
});

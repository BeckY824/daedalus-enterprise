/**
 * 第四轮对抗复查 · 桌面端「更新内容」（018a051）
 *
 * 红的保持红，等修。
 *   一、并成段 对真实 CHANGELOG：列表项折行写的续行（缩进两格）没并回列表项，渲染器把它当成一段独立的话，列表被拦腰切断
 *   （原来的「升级判定」两条只测桌面端本地模式下的「更新后自己弹」，企业版删了，用例一起删——死代码第三批）
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { 切更新记录, 只留桌面端, 并成段 } from "@/lib/changelog";

const 仓库CHANGELOG = fs.readFileSync(path.resolve("CHANGELOG.md"), "utf8");

describe("并成段：真实 CHANGELOG 里的列表续行", () => {
  it("列表项折了一行（下一行缩进两格接着写）：应该并回这一条，不该变成列表外的一段", () => {
    const md = "- **Dock 图标上的数字**：今天到期和已经逾期的跟进。\n  和「跟进计划」页是同一个数，0 个就不显示。\n- 第二条";
    // 渲染器（components/Markdown）一行一判：缩进的续行不是列表行，于是 flush 掉列表、单独成一段，
    // 弹框里是「一条半句 / 一段半句 / 又一个新列表」
    expect(并成段(md)).toBe("- **Dock 图标上的数字**：今天到期和已经逾期的跟进。和「跟进计划」页是同一个数，0 个就不显示。\n- 第二条");
  });

  it("「更新记录」里能翻到的 30 版，处理完以后不该还有挂在列表项下面的缩进续行", () => {
    const 前30 = 切更新记录(仓库CHANGELOG).slice(0, 30);
    const 坏的: string[] = [];
    for (const s of 前30) {
      const 行 = 并成段(只留桌面端(s.正文)).split("\n");
      for (let i = 1; i < 行.length; i++) {
        if (/^\s+\S/.test(行[i]) && !/^\s*([-*+]|\d+[.)])\s/.test(行[i])) 坏的.push(`${s.版本}：${行[i].trim().slice(0, 20)}…`);
      }
    }
    // 0.46.6（Dock 数字 / 早报 / 到点提醒那三条）、0.43.0、0.40.0（导入五步）、0.39.1、0.39.0 都有
    expect(坏的, 坏的.join("\n")).toEqual([]);
  });
});

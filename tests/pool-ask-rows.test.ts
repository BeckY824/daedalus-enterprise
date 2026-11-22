/**
 * 公海行下确认条摆在哪几行（lib/enterprise/pool-ask-rows.ts，设计语言 G-A · K4）。
 * G-A 审查：批量领成功后，领走的行（走的）照样进展开行，确认条画出来是空的，闪一条空灰行
 */
import { expect, it } from "vitest";
import { 确认条行们 } from "@/lib/enterprise/pool-ask-rows";

const 顶行 = new Set(["a", "b", "c"]);

it("正在问的排第一，其后是有没领到原因的；不在顶行（客户池并成一行）的不算", () => {
  expect(确认条行们({ 新样: true, 问着: "b", 行错: { a: "名额满了", b: "x", "k:1": "y" }, 走的: {}, 顶行 })).toEqual(["b", "a"]);
});

it("领走 / 分出去的不摆（批量领成功后不闪空灰行）", () => {
  expect(确认条行们({ 新样: true, 问着: "a", 行错: { b: "名额满了", c: "名额满了" }, 走的: { a: "已领取 ✓", b: "已领取 ✓" }, 顶行 })).toEqual(["c"]);
});

it("换皮主题不用行下确认条", () => {
  expect(确认条行们({ 新样: false, 问着: "a", 行错: { b: "x" }, 走的: {}, 顶行 })).toEqual([]);
});

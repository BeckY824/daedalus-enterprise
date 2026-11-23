/**
 * 设计语言 HC-2b：回答里的客户名变链接（lib/ai-entity-link.ts 的 找实体）。
 * 长短名、互相包含、同名不同 id、无 id 不链、每个名字只链第一次（终审 P4）
 */
import { describe, expect, it } from "vitest";
import { 找实体 } from "@/lib/ai-entity-link";

const 取 = (文本: string, 段们: ReturnType<typeof 找实体>) => 段们.map((s) => [文本.slice(s.起, s.止), s.id]);

describe("找实体", () => {
  it("从长到短：长名字先占，里面那截短名字不再单独链；短名字别处出现照链", () => {
    const 文 = "某公司上海分公司约好今天回电；某公司总部还没回。";
    const 段 = 找实体(文, [{ id: "a", name: "某公司" }, { id: "b", name: "某公司上海分公司" }]);
    expect(取(文, 段)).toEqual([["某公司上海分公司", "b"], ["某公司", "a"]]);
    expect(段[1].起).toBe(文.indexOf("某公司总部"));
  });

  it("短名字只出现在长名字里：不链短的", () => {
    const 文 = "某公司上海分公司 6 天没跟。";
    expect(取(文, 找实体(文, [{ id: "a", name: "某公司" }, { id: "b", name: "某公司上海分公司" }]))).toEqual([["某公司上海分公司", "b"]]);
  });

  it("同名不同 id 都不链；同名同 id（重复给了两次）照链", () => {
    const 文 = "张三和李四都约了周三。";
    expect(找实体(文, [{ id: "a", name: "张三" }, { id: "b", name: "张三" }, { id: "c", name: "李四" }]).map((s) => s.name)).toEqual(["李四"]);
    expect(找实体(文, [{ id: "a", name: "张三" }, { id: "a", name: "张三" }]).map((s) => s.id)).toEqual(["a"]);
  });

  it("没有 id、名字空、一个字的不链", () => {
    const 文 = "王 和 某工贸 和 某展具";
    expect(找实体(文, [{ id: "", name: "某工贸" }, { id: "x", name: "" }, { id: "y", name: "王" }, { id: "z", name: "某展具" }]).map((s) => s.name)).toEqual(["某展具"]);
  });

  it("每个名字只链第一次出现，结果按位置排", () => {
    const 文 = "某工贸：报价已发。某展具：约了回电。某工贸那边下周定。";
    const 段 = 找实体(文, [{ id: "a", name: "某工贸" }, { id: "b", name: "某展具" }]);
    expect(段.map((s) => [s.name, s.起])).toEqual([["某工贸", 0], ["某展具", 文.indexOf("某展具")]]);
  });

  it("超长名字（40 字以上）和它的前缀互相包含", () => {
    const 长 = "某某超长贸易进出口有限公司".repeat(4);
    const 文 = `${长}和${长.slice(0, 13)}都在名单里`;
    const 段 = 找实体(文, [{ id: "s", name: 长.slice(0, 13) }, { id: "l", name: 长 }]);
    expect(段.map((s) => [s.id, s.起, s.止 - s.起])).toEqual([["l", 0, 长.length], ["s", 长.length + 1, 13]]);
  });

  // #441 审查可选项：第一次出现那处 Markdown 链不上（行内代码 / 那段带 \| / 跨加粗边界）时，链后面第一处能链的
  it("第一次在行内代码里：链后面那一处", () => {
    const 文 = "查 `某工贸` 的记录：某工贸报价已发，某工贸下周定。";
    expect(找实体(文, [{ id: "a", name: "某工贸" }]).map((s) => s.起)).toEqual([文.indexOf("：某工贸") + 1]);
  });

  it("第一次那段带 \\|（表格格子里）：链后面那一处；格子里没有 \\| 的照链", () => {
    const 文 = "| 客户 | 渠道 |\n|---|---|\n| 某展具 | 华东 \\| 某工贸 |\n\n某工贸下周定。";
    const 段 = 找实体(文, [{ id: "a", name: "某工贸" }, { id: "b", name: "某展具" }]);
    expect(段.map((s) => [s.name, s.起])).toEqual([["某展具", 文.indexOf("某展具")], ["某工贸", 文.lastIndexOf("某工贸")]]);
  });

  it("被加粗记号隔开的（原文里不连着）不算出现，链后面那一处；整个在加粗里的照链", () => {
    const 文 = "**某工**贸约了周三；**某工贸**那边报价已发。";
    expect(找实体(文, [{ id: "a", name: "某工贸" }]).map((s) => s.起)).toEqual([文.indexOf("**某工贸**") + 2]);
  });

  it("被引用 [n] 隔开的不算出现；名字自带没转义的 |（正文里，不是表格行）照链", () => {
    const 文 = "某工[1]贸 回了；某工贸下周定。";
    expect(找实体(文, [{ id: "a", name: "某工贸" }]).map((s) => s.起)).toEqual([文.lastIndexOf("某工贸")]);
    const 文2 = "ABC | 上海 约了周三回电。";
    expect(找实体(文2, [{ id: "a", name: "ABC | 上海" }]).map((s) => s.起)).toEqual([0]);
  });

  it("文本里没出现的名字不出", () => {
    expect(找实体("今天没什么事", [{ id: "a", name: "某工贸" }])).toEqual([]);
  });
});

/**
 * 首页对话列表占位行（前端改版逐块确认 home.threads）：点「新建对话」或问了第一句、还没落库时，列表顶上先占一行。
 * 标题和服务端落库（threads.ts 取标题）同一个截法，占位换成真行时字不跳。
 */
import { describe, expect, it } from "vitest";
import { 占位标题, 截标题 } from "@/app/(app)/dashboard/home-look";

describe("对话列表占位行", () => {
  it("点了新建、还没问：占一行「新对话」", () => {
    expect(占位标题({ 对话id: null, 刚新建: true, 看着老对话: false })).toBe("新对话");
  });
  it("问了第一句、还没落库：标题 = 第一句截断（18 字 + …）", () => {
    expect(占位标题({ 第一句: "  Nordic   Fun 上次说要报价，帮我看看现在卡在哪，顺便起草一封跟进邮件", 对话id: null, 刚新建: false, 看着老对话: false })).toBe("Nordic Fun 上次说要报价，…");
    expect(截标题("今天该跟谁")).toBe("今天该跟谁");
  });
  it("落库了（有对话 id）、在看老对话、什么都没做：不占", () => {
    expect(占位标题({ 第一句: "今天该跟谁", 对话id: "c1", 刚新建: true, 看着老对话: false })).toBeNull();
    expect(占位标题({ 第一句: "今天该跟谁", 对话id: null, 刚新建: true, 看着老对话: true })).toBeNull();
    expect(占位标题({ 对话id: null, 刚新建: false, 看着老对话: false })).toBeNull();
  });
});

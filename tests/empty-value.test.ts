import { describe, expect, it } from "vitest";
import { 是空值, 有值, 去空, 空显, 空值符 } from "@/lib/empty-value";

/** 11-01 用户：「客户属性目前由于导入的时候没有相关值都填 -」「其余地方没有填写的信息都用 — 表示」 */
describe("空值显示（lib/empty-value.ts）", () => {
  it("没填的写法统一是「—」（U+2014）", () => {
    expect(空值符).toBe("—");
  });

  it("null / undefined / 空串 / 只有空白 / 导入占位的横线都算没填", () => {
    for (const v of [null, undefined, "", " ", "\t\n", "-", " - ", "--", "---", "－", "—", "–", "―", " — "]) {
      expect(是空值(v), JSON.stringify(v)).toBe(true);
      expect(有值(v as string | null | undefined), JSON.stringify(v)).toBe(false);
      expect(去空(v as string | null | undefined), JSON.stringify(v)).toBeNull();
      expect(空显(v as string | null | undefined), JSON.stringify(v)).toBe("—");
    }
  });

  it("带横线的真值不算没填：电话、日期、负数、型号", () => {
    for (const v of ["0571-88886666", "2026-11-01", "-1", "A-1", "a - b", "/", "0", "无"]) {
      expect(是空值(v), v).toBe(false);
      expect(有值(v), v).toBe(true);
      expect(空显(v), v).toBe(v);
    }
  });

  it("数字 0、false 是填了的；NaN 写「—」", () => {
    expect(是空值(0)).toBe(false);
    expect(是空值(false)).toBe(false);
    expect(空显(0)).toBe("0");
    expect(空显(12.5)).toBe("12.5");
    expect(空显(Number.NaN)).toBe("—");
  });

  it("去空：填了的去首尾空白，分组时 \" 工程商 \" 和 \"工程商\" 是一组", () => {
    expect(去空(" 工程商 ")).toBe("工程商");
    expect(去空("工程商")).toBe("工程商");
  });

  it("空显：填了的原样给（不去空白，显示交给样式）", () => {
    expect(空显("贸易商")).toBe("贸易商");
  });
});

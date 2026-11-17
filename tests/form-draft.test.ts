/**
 * 录入草稿的存取（lib/form-draft.ts，11-17 全站一份）：
 *   放 3 天；按人分；密码 / 密钥类格子不存；附件只记个数；改老记录只存改过的格；坏的 / 空的当没有；存不下不炸
 * 弹窗里怎么带回、怎么清，在 tests/form-draft.ui.test.ts 用真浏览器钉
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dayjs } from "@/lib/utils";
import { 草稿全名, 读一份, 读草稿, 存草稿, 清草稿, 去掉秘密, 改过的格, 有字, 带回话, 草稿放几天 } from "@/lib/form-draft";

const 库 = new Map<string, string>();
beforeEach(() => {
  库.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => 库.get(k) ?? null,
    setItem: (k: string, v: string) => void 库.set(k, v),
    removeItem: (k: string) => void 库.delete(k),
  });
});

describe("存取", () => {
  it("放 3 天，过了当没有", () => {
    expect(草稿放几天).toBe(3);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
      存草稿("k", { content: "聊了报价" });
      vi.setSystemTime(new Date("2026-11-03T23:00:00Z"));
      expect(读草稿("k")).toEqual({ content: "聊了报价" });
      vi.setSystemTime(new Date("2026-11-04T01:00:00Z"));
      expect(读草稿("k")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("按人、按表 + 记录分键", () => {
    expect(草稿全名("u1", "编辑项目:p1")).not.toBe(草稿全名("u2", "编辑项目:p1"));
    expect(草稿全名("u1", "编辑项目:p1")).not.toBe(草稿全名("u1", "编辑项目:p2"));
  });

  it("附件只记个数、表单外头的几样一起存；清掉就没了", () => {
    const 名 = 草稿全名("u1", "项目沟通:p1");
    存草稿(名, { content: "x" }, { 附件: 2, 额外: { aiText: "原话" } });
    expect(读一份(名)).toEqual({ v: { content: "x" }, 附件: 2, 额外: { aiText: "原话" } });
    清草稿(名);
    expect(读一份(名)).toBeNull();
  });

  it("日期格存进去读出来还是 dayjs", () => {
    存草稿("d", { at: dayjs("2026-11-20T10:00:00+08:00") });
    expect(dayjs.isDayjs(读草稿("d")!.at)).toBe(true);
  });

  it("坏的、不是对象的当没有；localStorage 抛错（隐私模式、配额满）不炸", () => {
    库.set("坏", "{not json");
    expect(读草稿("坏")).toBeNull();
    库.set("串", JSON.stringify({ at: Date.now(), v: "就一个串" }));
    expect(读草稿("串")).toBeNull();
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: () => { throw new Error("SecurityError"); },
    });
    expect(() => 存草稿("k", { a: "1" })).not.toThrow();
    expect(读草稿("k")).toBeNull();
    expect(() => 清草稿("k")).not.toThrow();
  });
});

describe("不存的东西", () => {
  it("密码、口令、密钥、令牌这类格子（含嵌套）一律不进草稿", () => {
    expect(去掉秘密({ name: "王", password: "p", newPassword: "q", 密码: "r", apiKey: "k", api_key: "k2", token: "t", extra: { secret: "s", wechat: "wx" } }))
      .toEqual({ name: "王", extra: { wechat: "wx" } });
    存草稿("k", { 名: "x", 口令: "y" });
    expect(库.get("k")).not.toContain("y");
  });
});

describe("改老记录只存改过的格", () => {
  it("和打开那一刻比：没动的不进来；改回原样的不进来；新出现、被清空的都算改了", () => {
    const 起 = { name: "老名字", remark: "备注", amount: 1, at: dayjs("2026-11-01") };
    expect(改过的格(起, { ...起 })).toEqual({});
    expect(改过的格(起, { ...起, name: "新名字" })).toEqual({ name: "新名字" });
    expect(改过的格(起, { ...起, remark: "" })).toEqual({ remark: "" });
    expect(改过的格(起, { ...起, at: dayjs("2026-11-01") })).toEqual({});
    expect(改过的格(起, { ...起, at: dayjs("2026-11-02") })).toHaveProperty("at");
  });

  it("有字：只认打的字（含数组、对象里的），数字、日期、空格不算", () => {
    expect(有字({ type: undefined, n: 3, at: dayjs() })).toBe(false);
    expect(有字({ a: "  " })).toBe(false);
    expect(有字({ reasons: ["价格"] })).toBe(true);
    expect(有字([undefined, "x"])).toBe(true);
  });

  it("带回那句：有附件才补一句要重选", () => {
    expect(带回话(0)).toBe("已带回上次没提交的内容");
    expect(带回话(2)).toContain("附件没留住");
  });
});

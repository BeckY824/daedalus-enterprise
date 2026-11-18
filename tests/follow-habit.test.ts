/**
 * 「记一条沟通」按个人习惯默认沟通方式（lib/follow-habit.ts，11-17 客户答复「建议记录个人使用习惯」）：
 * 最近 20 条里用得最多的；一样多取最近用过的；没有记录 → null；任务 / 提醒不算；停用了的方式不默认
 */
import { describe, expect, it } from "vitest";
import { 挑常用方式, 看最近几条, type 一条方式 } from "@/lib/follow-habit";

const 微信: 一条方式 = { type: "WECHAT", method: "微信沟通" };
const 电话: 一条方式 = { type: "PHONE", method: "电话沟通" };
const WA: 一条方式 = { type: "WHATSAPP", method: "WhatsApp" };

describe("挑常用方式（记录从新到旧）", () => {
  it("没有记录 → null（照原来的默认走）", () => {
    expect(挑常用方式([])).toBeNull();
  });

  it("用得最多的那种", () => {
    expect(挑常用方式([微信, 电话, 电话, WA, 电话, 微信])).toEqual(电话);
  });

  it("一样多：取其中最近用过的那种", () => {
    expect(挑常用方式([WA, 电话, 微信, 电话, WA])).toEqual(WA);
    expect(挑常用方式([电话, WA, WA, 电话])).toEqual(电话);
  });

  it("只看最近 20 条：更早的不算", () => {
    const 记录 = [...Array.from({ length: 看最近几条 }, (_, i) => (i % 2 ? 电话 : 微信)), WA, WA, WA, WA, WA, WA, WA, WA, WA, WA, WA];
    expect(看最近几条).toBe(20);
    // 前 20 条里微信、电话各 10 条，微信更近
    expect(挑常用方式(记录)).toEqual(微信);
  });

  it("任务、提醒不算沟通", () => {
    expect(挑常用方式([{ type: "TASK", method: null }, { type: "TASK", method: null }, { type: "REMIND", method: null }, 电话])).toEqual(电话);
    expect(挑常用方式([{ type: "TASK", method: null }])).toBeNull();
  });

  it("现在不能选的（企业字典里停用了）不默认，在剩下的里挑", () => {
    const 能选 = (x: 一条方式) => x.method !== "WhatsApp";
    expect(挑常用方式([WA, WA, WA, 电话], 能选)).toEqual(电话);
    expect(挑常用方式([WA, WA], 能选)).toBeNull();
  });

  it("老记录没有方式的按类型认（和有方式的分开算）", () => {
    const 老电话: 一条方式 = { type: "PHONE", method: null };
    expect(挑常用方式([老电话, 电话, 老电话])).toEqual(老电话);
  });
});

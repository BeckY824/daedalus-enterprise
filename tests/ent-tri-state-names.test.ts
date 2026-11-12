/**
 * 三态四个状态的叫法守卫（11-12 用户定）：只改界面叫法，状态码、地址栏 triState=、库里的值不动。
 *   活跃 → 正常跟进；沉睡 → 沉睡待定；待回收 → 即将回收；暂缓回收中 → 暂缓待收
 * 按钮「暂缓回收」是动作，名字不跟状态改（故意和「暂缓待收」不同名）
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { 三态叫法, 三态显示名, 三态标字, 三态标说明, 三态筛选值们, 换成新叫法, 暂缓回收按钮名 } from "@/lib/enterprise/tri-state-label";
import { 汇总文字 } from "@/lib/enterprise/tri-state-notice";

const 旧名 = /活跃|沉睡(?!待定)|待回收|暂缓回收中/;

describe("三态叫法", () => {
  it("状态码 → 显示名是这四个新名", () => {
    expect(三态叫法).toEqual({ 活跃: "正常跟进", 沉睡: "沉睡待定", 待回收: "即将回收", 暂缓回收中: "暂缓待收" });
    expect(["活跃", "沉睡", "待回收", "暂缓回收中", "不计时", "公海"].map(三态显示名)).toEqual(["正常跟进", "沉睡待定", "即将回收", "暂缓待收", "不计时", "公海"]);
  });

  it("筛选值（地址栏 triState=）还是旧码，旧链接能用；下拉上显示新名", () => {
    expect([...三态筛选值们]).toEqual(["沉睡", "待回收", "暂缓回收中", "不计时"]);
    expect(三态筛选值们.map(三态显示名)).toEqual(["沉睡待定", "即将回收", "暂缓待收", "不计时"]);
  });

  it("列表标签、悬停说明不再出旧名", () => {
    const 标们 = [{ 态: "沉睡" as const }, { 态: "待回收" as const, 几天后进公海: 12 }, { 态: "待回收" as const, 几天后进公海: 0 }, { 态: "待回收" as const }, { 态: "暂缓回收中" as const }];
    for (const x of 标们) {
      expect(三态标字(x)).not.toMatch(旧名);
      expect(三态标说明(x)).not.toMatch(旧名);
    }
    expect(三态标字({ 态: "待回收", 几天后进公海: 12 })).toBe("即将回收 · 12 天后进公海");
  });

  it("按钮名仍是「暂缓回收」，状态条上那颗按钮也是", () => {
    expect(暂缓回收按钮名).toBe("暂缓回收");
    const 源 = readFileSync("src/lib/enterprise/tri-state-detail.ts", "utf8");
    expect(源).toContain('动作: "暂缓回收", 字: "暂缓回收"');
  });

  it("库里老留痕的系统理由显示时换新名；「暂缓回收」动作、沉睡线 / 沉睡期不换；已是新名不重复换", () => {
    expect(换成新叫法("满 90 天没动静，进入沉睡")).toBe("满 90 天没动静，进入沉睡待定");
    expect(换成新叫法("待回收满 30 天、3 次提醒都没人处理，自动进客户公海")).toBe("即将回收满 30 天、3 次提醒都没人处理，自动进客户公海");
    expect(换成新叫法("名下有订单阶段没结束的项目，算活跃")).toBe("名下有订单阶段没结束的项目，算正常跟进");
    expect(换成新叫法("暂缓回收：月底前结项")).toBe("暂缓回收：月底前结项");
    expect(换成新叫法("沉睡线、沉睡期")).toBe("沉睡线、沉睡期");
    expect(换成新叫法("进入沉睡待定、即将回收")).toBe("进入沉睡待定、即将回收");
  });

  it("站内 / 飞书提醒汇总用新名", () => {
    const 条们 = (["进入沉睡", "沉睡周提醒", "沉睡抄上级", "待回收提醒", "被挡请裁决", "暂缓解除"] as const).map((事由, i) => ({ 客户: `c${i}`, 名: `客户${i}`, 负责人: "u", 事由 }));
    const { title, body } = 汇总文字(条们, () => "乙");
    expect(title).not.toMatch(旧名);
    expect(body).not.toMatch(旧名);
    expect(title).toContain("进入沉睡待定");
    expect(title).toContain("即将回收");
  });
});

/**
 * 渠道页「有效线索」和顶部看板同一口径（客户 11-18 第 10 题选 A）：
 * - 有效线索 = 线索验证里销售判「有效线索」的；这批项目一条都没判过（已判定 = 0）→ 界面写「—」，不写 0；判过、一条有效都没有 → 0
 * - 关联线索 = 在线索阶段、没流失的项目（扣掉已流失），另成一列，不再和有效线索合成一列
 * - 主渠道合计那一行：已判定按子渠道加起来，同样认「—」
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { 算渠道统计, 合并统计, 有效线索显示, type 统计用项目 } from "@/lib/enterprise/channel-stats";
import { 算分期统计 } from "@/lib/enterprise/channel-dash";
import { 字典of } from "@/lib/project/stage-dict";

const 今 = new Date("2026-11-18T10:00:00+08:00");
const 本月 = new Date("2026-11-05T10:00:00+08:00");
const 项 = (判定: string | null, result: string | null = null, phase = "线索"): 统计用项目 => ({ channelId: "c", phase, result, amount: 0, currency: "CNY", createdAt: 本月, 判定 });
const 渠道 = [{ id: "c", createdAt: new Date("2026-01-01"), endDate: null }];

describe("有效线索：没判过写「—」，判过才给数（同看板）", () => {
  it("一条都没判过：有效线索显示「—」（null），关联线索照数没流失的", () => {
    process.env.CRM_ENTERPRISE = "1";
    const s = 算渠道统计(渠道, [项(null), 项(null), 项(null, "线索流失")], [], 今, 字典of(true)).c;
    expect(s.关联线索).toBe(2);
    expect(s.已判定).toBe(0);
    expect(有效线索显示(s)).toBeNull();
  });
  it("判过、一条有效都没有：显示 0；初验无效、暂未判定不算已判定（同看板 已判定()）", () => {
    process.env.CRM_ENTERPRISE = "1";
    const s = 算渠道统计(渠道, [项("无效线索", "线索流失"), 项("初验无效"), 项("暂未判定")], [], 今, 字典of(true)).c;
    expect(s.已判定).toBe(1);
    expect(有效线索显示(s)).toBe(0);
  });
  it("判了有效的才算有效线索；分档（本月）和全部一样认已判定", () => {
    process.env.CRM_ENTERPRISE = "1";
    const 分 = 算分期统计(渠道, [项("有效线索"), 项("无效线索", "线索流失"), 项(null)], [], 今, 字典of(true));
    for (const 期 of ["全部", "本月"] as const) {
      expect(分[期].c.已判定).toBe(2);
      expect(有效线索显示(分[期].c)).toBe(1);
      expect(分[期].c.关联线索).toBe(2);
    }
  });
  it("主渠道合计：已判定按子渠道加；都没判过还是「—」", () => {
    process.env.CRM_ENTERPRISE = "1";
    const a = 算渠道统计(渠道, [项(null)], [], 今, 字典of(true)).c;
    const b = 算渠道统计(渠道, [项("有效线索")], [], 今, 字典of(true)).c;
    expect(有效线索显示(合并统计([a, a]))).toBeNull();
    expect(合并统计([a, b]).已判定).toBe(1);
    expect(有效线索显示(合并统计([a, b]))).toBe(1);
  });
});

describe("渠道列表、渠道详情：关联线索、有效线索各成一列，表头说清口径", () => {
  const 列表 = readFileSync(path.resolve(__dirname, "../src/app/(app)/channels/ChannelsView.tsx"), "utf8");
  const 详情 = readFileSync(path.resolve(__dirname, "../src/app/(app)/channels/ChannelDrawer.tsx"), "utf8");
  it("列表不再把两列合成一列（每行一样时也分开摆）", () => {
    expect(列表).not.toMatch(/线索一样/);
    expect(列表).toMatch(/数列<Row>\("关联线索"/);
    expect(列表).toMatch(/有效线索显示\(/);
  });
  it("表头：关联线索写明扣掉已流失；有效线索写明没判过显示「—」", () => {
    expect(列表).toMatch(/扣掉已流失/);
    expect(列表).toMatch(/没判过显示「—」/);
  });
  it("详情抽屉的有效线索也按 有效线索显示（没判过写「—」）", () => {
    expect(详情).toMatch(/有效线索显示\(/);
  });
});

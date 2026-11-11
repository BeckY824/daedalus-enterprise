/**
 * 外贸模版下商机阶段的显示名（2026-10-03）：只改叫法、存的值不动。
 *   - 通用模版原样；外贸模版五档换成 询盘 / 比价中 / 已报价 / 寄样 / 客户确认
 *   - 反查：人或 AI 说「询盘」认回「初步沟通」，认不出原样
 *   （AI 列商机那条随 list_opportunities 工具 2026-11-11 删了：企业版只用项目，那个工具一直被滤掉）
 */
import { describe, it, expect } from "vitest";

import { stageLabel, 阶段值, 外贸阶段名, BUSINESS_PRESETS, DEFAULT_BUSINESS } from "@/lib/business-config";
import { OPP_STAGES } from "@/lib/constants";

describe("阶段显示名", () => {
  it("通用原样；外贸五档都有外贸叫法、且互不相同", () => {
    for (const s of OPP_STAGES) expect(stageLabel(DEFAULT_BUSINESS, s)).toBe(s);
    const 外贸 = OPP_STAGES.map((s) => stageLabel(BUSINESS_PRESETS["外贸出口"], s));
    expect(外贸).toEqual(["询盘", "比价中", "已报价", "寄样", "客户确认"]);
    expect(Object.keys(外贸阶段名).sort()).toEqual([...OPP_STAGES].sort());
  });

  it("反查：外贸叫法认回存储值，认不出原样；通用模版不反查", () => {
    const 外 = BUSINESS_PRESETS["外贸出口"];
    expect(阶段值(外, "询盘")).toBe("初步沟通");
    expect(阶段值(外, "方案报价")).toBe("方案报价");
    expect(阶段值(DEFAULT_BUSINESS, "询盘")).toBe("询盘");
  });
});

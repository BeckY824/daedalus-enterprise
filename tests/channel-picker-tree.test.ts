/**
 * 选渠道组件的三级树（2026-10-29 渠道改版）：渠道属性 → 渠道名称 → 来源，叶子的 value 是渠道 id。
 */
import { describe, it, expect } from "vitest";
import { 渠道树, 未分属性, type 可选渠道 } from "@/components/ChannelPicker";

const 渠 = (id: string, name: string, attr: string | null, platform: string | null, active = true): 可选渠道 => ({ id, name, attr, platform, active });

describe("渠道树", () => {
  const 清单 = [
    渠("1", "抖音|官方号", "公域引流", "抖音"),
    渠("2", "抖音|达人", "公域引流", "抖音"),
    渠("3", "小红书|店铺", "公域引流", "小红书"),
    渠("4", "张先生", "客户介绍", "张先生"),
    渠("5", "林老师", null, null), // 老渠道：没有属性和渠道名称
    渠("6", "抖音|停掉的", "公域引流", "抖音", false),
  ];

  it("按属性、渠道名称分组，保持出现顺序；叶子写来源、带全称", () => {
    const 树 = 渠道树(清单);
    expect(树.map((x) => x.label)).toEqual(["公域引流", "客户介绍", 未分属性]);
    const 公域 = 树[0];
    expect(公域.children!.map((x) => x.label)).toEqual(["抖音", "小红书"]);
    expect(公域.children![0].children).toEqual([
      { value: "1", label: "官方号", 全称: "抖音|官方号" },
      { value: "2", label: "达人", 全称: "抖音|达人" },
    ]);
    // 来源和名称一样：叶子写名称本身
    expect(树[1].children![0].children![0]).toMatchObject({ value: "4", label: "张先生" });
    // 老渠道：归「未分属性」、渠道名称用全称
    expect(树[2].children![0]).toMatchObject({ label: "林老师" });
    expect(树[2].children![0].children![0]).toMatchObject({ value: "5", 全称: "林老师" });
  });

  it("停用的不列，除非正选着它", () => {
    const 叶子们 = (树: ReturnType<typeof 渠道树>) => 树.flatMap((a) => a.children!.flatMap((p) => p.children!.map((l) => l.value)));
    expect(叶子们(渠道树(清单))).not.toContain("6");
    const 选着 = 渠道树(清单, "6");
    expect(叶子们(选着)).toContain("6");
    expect(选着[0].children![0].children!.find((l) => l.value === "6")!.label).toBe("停掉的（已停用）");
  });

  it("中间层的 value 不会和渠道 id 撞", () => {
    const 树 = 渠道树([渠("公域引流", "抖音|x", "公域引流", "抖音")]);
    expect(树[0].value).not.toBe("公域引流");
    expect(树[0].children![0].value).not.toBe(树[0].children![0].children![0].value);
  });
});

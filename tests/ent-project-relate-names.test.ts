/**
 * 企业版项目关联的命名规矩（2026-10-29 P17，src/lib/project/relate-names.ts），纯函数：
 *   - 概览名称：当前进程|项目区域|项目显名|产品需求，空段跳过；进程以外三段全空 → 当前进程|项目ID（短号）；
 *     进程有结局写结局、按传进来的字典叫
 *   - 客户显名：简称 → 全称 → 短号
 *   - 显示姓名：单字姓 + 先生 / 女士，性别没填写「先生/女士」；外文名原样；不像人名 → 🔥姓名暂未核实
 *   - 引用联系人：隶属客户|显示姓名，没给客户只写显示姓名
 */
import { describe, it, expect } from "vitest";
import { 概览名称, 客户显名, 显示姓名, 姓名像人名, 引用联系人, 短号, 项目显名, 姓名未核实 } from "@/lib/project/relate-names";
import { 企业版字典, 字典of } from "@/lib/project/stage-dict";

const 项目 = { id: "cm0000000000abc123", name: "华东 二期", phase: "商机", node: "明确需求", result: null, productNeeds: null };

describe("短号、项目显名", () => {
  it("短号取 id 末 6 位转大写、带 #；空 id 给空", () => {
    expect(短号("cm0000000000abc123")).toBe("#ABC123");
    expect(短号("")).toBe("");
  });

  it("项目显名：有简称用简称，没有用全称；去掉所有空白；「潜在项目」当没名字", () => {
    expect(项目显名({ name: "华东 二期" })).toBe("华东二期");
    expect(项目显名({ name: "全称", shortName: " 简 称 " })).toBe("简称");
    expect(项目显名({ name: "潜在项目" })).toBe("");
    expect(项目显名({ name: "  " })).toBe("");
  });
});

describe("概览名称", () => {
  it("四段齐：进程|区域|显名|产品需求（多选用、连）", () => {
    expect(概览名称({ ...项目, addrCountry: "中国", addrProvince: "江苏", addrCity: "苏州", productNeeds: '["常规标品","部署服务"]' }))
      .toBe("明确需求|苏州|华东二期|常规标品、部署服务");
  });

  it("空的段跳过：没区域、没需求只剩进程|显名", () => {
    expect(概览名称(项目)).toBe("明确需求|华东二期");
    expect(概览名称({ ...项目, addrCountry: "日本" })).toBe("明确需求|日本|华东二期");
  });

  it("进程以外三段全空 → 进程|项目ID（短号）", () => {
    expect(概览名称({ ...项目, name: "潜在项目" })).toBe("明确需求|#ABC123");
    expect(概览名称({ ...项目, name: "" })).toBe("明确需求|#ABC123");
  });

  it("有结局写结局，按字典叫：企业版丢单叫「商机丢单」，后台改了叫法用改的", () => {
    expect(概览名称({ ...项目, result: "丢单" }, 企业版字典)).toBe("商机丢单|华东二期");
    expect(概览名称({ ...项目, phase: "订单", node: "尾款结算", result: "成功交付" }, 字典of(true, { 订单: ["交付完成", null] }))).toBe("交付完成|华东二期");
  });
});

describe("客户显名", () => {
  it("简称 → 全称 → 短号，都去首尾空白", () => {
    expect(客户显名({ id: "c1xyz789", name: "某某有限公司", shortName: " 某某 " })).toBe("某某");
    expect(客户显名({ id: "c1xyz789", name: " 某某有限公司 ", shortName: "  " })).toBe("某某有限公司");
    expect(客户显名({ id: "c1xyz789", name: "", shortName: null })).toBe("#XYZ789");
  });
});

describe("姓名像人名 / 显示姓名", () => {
  it("正常中文名：单字姓 + 先生 / 女士", () => {
    expect(显示姓名({ name: "张三", gender: "男" })).toBe("张先生");
    expect(显示姓名({ name: " 李 四 娘 ", gender: "女" })).toBe("李女士");
    expect(显示姓名({ name: "欧阳娜娜", gender: "女" })).toBe("欧女士");
  });

  it("性别没填或不认识 → 先生/女士，不替人猜", () => {
    expect(显示姓名({ name: "王五" })).toBe("王先生/女士");
    expect(显示姓名({ name: "王五", gender: "" })).toBe("王先生/女士");
    expect(显示姓名({ name: "王五", gender: "未知" })).toBe("王先生/女士");
  });

  it("外文名原样；少数民族名带间隔号算像", () => {
    expect(显示姓名({ name: "John  Smith", gender: "男" })).toBe("John Smith");
    expect(姓名像人名("买买提·艾力")).toBe(true);
  });

  it("不像人名的一律 🔥姓名暂未核实：空、只有姓、姓 + 称谓、占位、带数字符号、中英混写", () => {
    for (const 坏 of [null, "", "  ", "张", "张总", "王工", "李经理", "欧阳先生", "张某", "王某某", "未知", "测试", "test", "xx", "张三2", "张三@", "张San", "A"]) {
      expect(姓名像人名(坏), String(坏)).toBe(false);
      expect(显示姓名({ name: 坏, gender: "男" })).toBe(姓名未核实);
    }
  });
});

describe("引用联系人", () => {
  it("隶属客户|显示姓名；客户按 客户显名 叫", () => {
    expect(引用联系人({ name: "张三", gender: "男", customer: { id: "c1", name: "某某有限公司", shortName: "某某" } })).toBe("某某|张先生");
    expect(引用联系人({ name: "张总", gender: "男", customer: { id: "c1", name: "某某有限公司" } })).toBe(`某某有限公司|${姓名未核实}`);
  });

  it("没给客户只写显示姓名", () => {
    expect(引用联系人({ name: "李四", gender: "女" })).toBe("李女士");
    expect(引用联系人({ name: "李四", gender: "女", customer: null })).toBe("李女士");
  });
});

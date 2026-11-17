/**
 * 市场成员自动分配按客户区域定事业部（P-转-26 自动分配这一半，X-141 我方建议）：纯函数（lib/enterprise/customer-region.ts）。
 * 钉的是：国家判大陆 / 非大陆（港澳台算非大陆，「中非」这类不算中国）；国家空有省市 = 大陆；全空 = 未知；客户全空退到项目所在地；
 * 市场成员按岗位认（市场管理、渠道运营）；候选去掉销售管理（兼着销售的也去）。
 */
import { describe, it, expect } from "vitest";
import {
  客户区域of, 区域定线, 区域of, 区域线of, 按区域分配, 按区域分配of, 去掉销售管理, 区域定线说明, 区域未填提示,
} from "@/lib/enterprise/customer-region";
import { 建组织 } from "@/lib/enterprise/org-core";

const 址 = (addrCountry: string | null, addrProvince: string | null = null, addrCity: string | null = null, addrDistrict: string | null = null) =>
  ({ addrCountry, addrProvince, addrCity, addrDistrict });

describe("客户区域", () => {
  it("中国 / 中国大陆 / 英文写法（3702 库里是「中国」）→ 大陆；只填国家没填省也算大陆", () => {
    for (const 国 of ["中国", "中国大陆", "China", "CN", "PRC", "中國", "中华人民共和国"]) expect(客户区域of(址(国))).toBe("大陆");
    expect(客户区域of(址("中国", "浙江省", "杭州市"))).toBe("大陆");
  });
  it("港澳台算非大陆：国家写成港澳台，或国家是中国 / 空、省写港澳台（库里有「香港」「香港特别行政区」「台湾省」「台湾」）", () => {
    for (const 国 of ["中国香港", "香港", "中国台湾", "台湾", "澳门", "澳門", "Hong Kong", "Taiwan", "Macau"]) expect(客户区域of(址(国))).toBe("非大陆");
    for (const 省 of ["香港", "香港特别行政区", "台湾省", "台湾", "澳门特别行政区"]) {
      expect(客户区域of(址("中国", 省))).toBe("非大陆");
      expect(客户区域of(址(null, 省))).toBe("非大陆");
    }
  });
  it("外国 → 非大陆；「中非」不算中国", () => {
    for (const 国 of ["印度", "美国", "中非", "土耳其"]) expect(客户区域of(址(国))).toBe("非大陆");
  });
  it("国家空、有省 / 市 / 区县 → 大陆；四格全空 → 未知", () => {
    expect(客户区域of(址(null, "广东省"))).toBe("大陆");
    expect(客户区域of(址(null, null, "义乌市"))).toBe("大陆");
    expect(客户区域of(址(null, null, null, "南山区"))).toBe("大陆");
    expect(客户区域of(址(" ", "", null))).toBe("未知");
    expect(客户区域of(null)).toBe("未知");
  });
  it("区域 → 事业部：大陆 内贸、非大陆 外贸、未知 null", () => {
    expect(区域定线("大陆")).toBe("内贸");
    expect(区域定线("非大陆")).toBe("外贸");
    expect(区域定线("未知")).toBeNull();
  });
  it("客户地址优先；客户全空退到项目所在地；都空 = 未知", () => {
    expect(区域of(址("美国"), 址("中国", "浙江省"))).toBe("非大陆");
    expect(区域of(址(null), 址("中国", "浙江省"))).toBe("大陆");
    expect(区域线of(null, 址("中国香港"))).toBe("外贸");
    expect(区域线of(null, null)).toBeNull();
    expect(区域线of(址(null))).toBeNull();
  });
  it("界面只读说明：认出线写线，没认出写补区域的提示", () => {
    expect(区域定线说明("外贸")).toContain("按客户区域自动定：外贸");
    expect(区域定线说明(null)).toContain(区域未填提示);
  });
});

describe("谁按区域分、候选去掉谁", () => {
  const 成员行 = (userId: string, bizRole: string) => ({ userId, deptId: null, bizRole, line: null, managerId: null, dottedManagerId: null });
  const org = 建组织(
    ["市管", "渠运", "销售", "销管", "兼任", "总管"].map((id) => ({ id, role: "SALES", active: true })),
    [成员行("市管", "marketing_mgr"), 成员行("渠运", "channel_ops"), 成员行("销售", "sales"), 成员行("销管", "sales_mgr"), 成员行("兼任", "sales,sales_mgr"), 成员行("总管", "director")],
    [],
  );
  it("市场成员按岗位认：市场管理、渠道运营按区域分；销售、销售管理、总管理不按（照 P-转-08 不限）", () => {
    expect(按区域分配(["marketing_mgr"])).toBe(true);
    expect(按区域分配(["channel_ops"])).toBe(true);
    expect(按区域分配(["sales"])).toBe(false);
    expect(按区域分配of(org, "市管")).toBe(true);
    expect(按区域分配of(org, "渠运")).toBe(true);
    for (const id of ["销售", "销管", "总管", "不在的"]) expect(按区域分配of(org, id)).toBe(false);
  });
  it("候选去掉销售管理，兼着销售的销售管理也去掉", () => {
    expect(去掉销售管理(org, ["销售", "销管", "兼任"])).toEqual(["销售"]);
  });
});

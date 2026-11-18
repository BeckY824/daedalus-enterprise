/**
 * 只写了省 / 城市没写国家时认不认（11-18 加急，AI 新线索卡；审核 11-18 P0-2 / P1-4 收紧）：
 * 像国内地名 只认确定是大陆的（省、地级市名单和号码归属地数据一致，加浙江的县级市），不再按「中文 + 市 / 县 / 区」兜底；
 * 港澳台地名 认香港 / 澳门 / 台湾和它们的市、区；客户区域按它判非大陆
 */
import { describe, it, expect } from "vitest";
import { 像国内地名, 港澳台地名, 国内名单 } from "@/lib/enterprise/cn-place";
import { 城市表 } from "@/lib/enterprise/phone-region-data";
import { 客户区域of, 区域线of } from "@/lib/enterprise/customer-region";
import { 建议业务线 } from "@/lib/enterprise/assign-line";
import { 线索卡地址 } from "@/lib/agent/proposals";

describe("像国内地名", () => {
  it("省、地级市名单和 城市表 一致", () => {
    expect([...国内名单.省名].sort()).toEqual([...new Set(城市表.map((x) => x.split("|")[0]))].sort());
    expect([...国内名单.市名].sort()).toEqual([...new Set(城市表.map((x) => x.split("|")[1]))].sort());
  });
  it("认：地级市 / 带后缀 / 省 / 名单里的县级市", () => {
    for (const x of ["杭州", "杭州市", "浙江", "浙江省", "广西壮族自治区", "义乌市", "义乌", "台州市"]) expect([x, 像国内地名(x)]).toEqual([x, true]);
  });
  it("不认：外国城市（带「市」也不认，审核 11-18 P0-2）、港澳台、区县、名单外的县级市、拼音、空", () => {
    for (const x of [
      "胡志明市", "大阪市", "金边市", "首尔特别市", "达卡市", "多伦多市", "迪拜市", "海防市", "仁川广域市", "新加坡市", "巴拿马市",
      "台北市", "香港", "湾仔区", "澳门", "九龙", "高雄",
      "余杭区", "东区", "大安区", "昆山市",
      "多伦多", "卡萨布兰卡", "Toronto", "Hangzhou", "", "  ",
    ]) expect([x, 像国内地名(x)]).toEqual([x, false]);
  });
  it("县级市名单里没有和港澳台重名的", () => {
    for (const x of 国内名单.县级市) expect([x, 港澳台地名(x)]).toEqual([x, null]);
  });
});

describe("港澳台地名", () => {
  it("香港 / 澳门 / 台湾，连同市、区，繁体、带「中国」也认", () => {
    const 例: [string, string][] = [
      ["香港", "香港"], ["中国香港", "香港"], ["香港特别行政区", "香港"], ["湾仔区", "香港"], ["灣仔區", "香港"], ["九龙", "香港"], ["九龍", "香港"], ["沙田区", "香港"],
      ["澳门", "澳门"], ["澳門", "澳门"], ["氹仔", "澳门"],
      ["台湾省", "台湾"], ["臺灣", "台湾"], ["台北市", "台湾"], ["臺北市", "台湾"], ["高雄", "台湾"], ["高雄市", "台湾"], ["新竹县", "台湾"],
    ];
    for (const [x, 哪] of 例) expect([x, 港澳台地名(x)]).toEqual([x, 哪]);
  });
  it("大陆重名的、大陆地名、外国城市都不算", () => {
    for (const x of ["东区", "大埔县", "沙田", "九龙县", "台州", "台山市", "杭州", "胡志明市", "", null]) expect([x, 港澳台地名(x)]).toEqual([x, null]);
  });
});

describe("客户区域：只写了市、省空着的港澳台算非大陆（审核 11-18 P1-4）", () => {
  it("国家空 / 中国，市或区县写台北市、高雄、湾仔区、九龙、澳门 → 非大陆 → 外贸", () => {
    expect(客户区域of({ addrCity: "台北市" })).toBe("非大陆");
    expect(区域线of({ addrCountry: "中国", addrCity: "高雄市" })).toBe("外贸");
    expect(客户区域of({ addrCountry: "中国", addrCity: "湾仔区" })).toBe("非大陆");
    expect(客户区域of({ addrCountry: "中国", addrCity: "九龙" })).toBe("非大陆");
    expect(客户区域of({ addrCity: "澳门" })).toBe("非大陆");
    expect(客户区域of({ addrCountry: "中国", addrProvince: "广东", addrCity: "深圳", addrDistrict: "南山区" })).toBe("大陆");
    expect(客户区域of({ addrCountry: "中国", addrCity: "九龙县" })).toBe("大陆");
    expect(客户区域of({ addrCountry: "Taiwan" })).toBe("非大陆");
  });
  it("按地址给的业务线建议同样认", () => {
    expect(建议业务线({ addrCountry: "中国", addrCity: "湾仔区" })).toBe("外贸");
    expect(建议业务线({ addrCity: "台北市" })).toBe("外贸");
    expect(建议业务线({ addrCity: "杭州" })).toBe("内贸");
  });
});

describe("AI 卡只写城市时落不落地址（线索卡地址）", () => {
  it("外国城市带「市」：不落客户地址（区域未知，分配方向退到电话 → 本人事业部）", () => {
    for (const city of ["胡志明市", "大阪市", "金边市", "首尔特别市"]) expect([city, 线索卡地址({ city }).客户]).toEqual([city, null]);
  });
  it("大陆地名照落；港澳台照落、区域判非大陆", () => {
    expect(线索卡地址({ city: "义乌市" }).客户).toMatchObject({ addrCity: "义乌市" });
    const 台 = 线索卡地址({ city: "台北市" }).客户;
    expect(台).toMatchObject({ addrCity: "台北市" });
    expect(区域线of(台)).toBe("外贸");
  });
});

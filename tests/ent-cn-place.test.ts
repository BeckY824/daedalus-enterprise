/** 只写了省 / 城市没写国家时认不认国内（11-18 加急，AI 新线索卡）：名单和号码归属地数据一致；国外城市不认 */
import { describe, it, expect } from "vitest";
import { 像国内地名, 国内名单 } from "@/lib/enterprise/cn-place";
import { 城市表 } from "@/lib/enterprise/phone-region-data";

describe("像国内地名", () => {
  it("省、地级市名单和 城市表 一致", () => {
    expect([...国内名单.省名].sort()).toEqual([...new Set(城市表.map((x) => x.split("|")[0]))].sort());
    expect([...国内名单.市名].sort()).toEqual([...new Set(城市表.map((x) => x.split("|")[1]))].sort());
  });
  it("认：地级市 / 带后缀 / 省 / 县级市 / 港澳台", () => {
    for (const x of ["杭州", "杭州市", "浙江", "浙江省", "广西壮族自治区", "义乌市", "香港"]) expect([x, 像国内地名(x)]).toEqual([x, true]);
  });
  it("不认：国外城市、拼音、空", () => {
    for (const x of ["多伦多", "卡萨布兰卡", "Toronto", "Hangzhou", "", "  "]) expect([x, 像国内地名(x)]).toEqual([x, false]);
  });
});

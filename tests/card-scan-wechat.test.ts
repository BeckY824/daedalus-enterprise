/**
 * 首页对话框认图（2026-11-01 用户：「国家不确定，或者其他信息不确定，都要给出卡片给用户在录入的时候确认。同时录入的时候用户会给出一定的文字描述这个你也要结合上下文。」）：
 *   - card-scan/wechat.ts 认微信截图：有「微信号」那行才算；昵称拆装饰和国家；地区一行拆国家城市
 *   - card-scan/form.ts 国家反查 / 找国家：中英文、整词；「中国香港」先于「中国」
 *   - card-scan/lead-card.ts 微信成新线索卡、用话补卡（来源取最长的渠道名、展会里的地名不当国家）
 *   - agent/proposals.ts missingFields：待确认的格还在就不能确认
 * 数据都是编的
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_BUSINESS } from "@/lib/business-config";
import { missingFields } from "@/lib/agent/proposals";
import { 国家反查, 找国家 } from "@/lib/card-scan/form";
import type { 框 } from "@/lib/card-scan/parse";
import { 认微信截图, type 微信资料 } from "@/lib/card-scan/wechat";
import { 微信成新线索卡, 用话补卡, 微信卡理由 } from "@/lib/card-scan/lead-card";

/** 一行一个框，从上往下排；h 是字高 */
const 截图 = (行们: [string, number][]): 框[] => {
  let y = 0;
  return 行们.map(([text, h]) => ({ text, score: 0.95, side: 0, cx: 200, cy: (y += 40), w: text.length * h * 0.6, h }));
};
const 资料 = (补: Partial<微信资料> = {}): 微信资料 => ({ 名字: "Tom", 昵称: "Tom", 微信号: "wxid_test0001", 国家: "", 城市: "", 国家靠猜: false, 名字拆过: false, ...补 });

describe("国家反查 / 找国家", () => {
  it("一格就是一个国家：中英文、大小写不论；不是就 null", () => {
    expect(国家反查("Canada")).toBe("加拿大");
    expect(国家反查(" pakistan ")).toBe("巴基斯坦");
    expect(国家反查("加拿大")).toBe("加拿大");
    expect(国家反查("香港")).toBe("中国香港");
    expect(国家反查("Toronto")).toBeNull();
    expect(国家反查("")).toBeNull();
  });
  it("一段话里第一个国家；英文按整词（Oman 不从 Romania 里认），长的先", () => {
    expect(找国家("地区：加拿大 多伦多")).toMatchObject({ 国家: "加拿大", 位: 3, 长: 3 });
    expect(找国家("from Romania")?.国家).toBe("罗马尼亚");
    expect(找国家("中国香港的客户")).toMatchObject({ 国家: "中国香港", 长: 4 });
    expect(找国家("没有国家")).toBeNull();
  });
});

describe("认微信截图", () => {
  it("名字取微信号上面字最大那行；昵称按 | 拆，国家那段不进名字；地区拆出国家城市；状态栏、按钮不进", () => {
    const w = 认微信截图(截图([["14:03", 12], ["5G", 10], ["Tom | Canada", 30], ["昵称：Tom", 14], ["微信号：wxid_test0001", 14], ["地区：加拿大 多伦多", 14], ["发消息", 16]]));
    expect(w).toEqual({ 名字: "Tom", 昵称: "Tom | Canada", 微信号: "wxid_test0001", 国家: "加拿大", 城市: "多伦多", 国家靠猜: false, 名字拆过: true });
  });
  it("地区没写：国家从昵称猜，标靠猜；微信号在下一个框也认", () => {
    const w = 认微信截图(截图([["Ali | Pakistan", 30], ["微信号", 14], ["wxid_test0002", 14], ["发消息", 16]]));
    expect(w).toMatchObject({ 名字: "Ali", 微信号: "wxid_test0002", 国家: "巴基斯坦", 国家靠猜: true });
  });
  it("没国家线索：国家空着，不猜", () => {
    expect(认微信截图(截图([["Maria Test", 30], ["微信号：mtest88", 14]]))).toMatchObject({ 名字: "Maria Test", 国家: "", 名字拆过: false });
  });
  it("没有微信号那行、或微信号不像：不是微信截图", () => {
    expect(认微信截图(截图([["王五", 30], ["13800000000", 14]]))).toBeNull();
    expect(认微信截图(截图([["王五", 30], ["微信号：12345", 14]]))).toBeNull();
  });
});

describe("微信成新线索卡", () => {
  it("名称是人，微信号进微信格；国家城市带上；拆过的名字和猜的国家要确认", () => {
    const r = 微信成新线索卡(资料({ 昵称: "Tom | Canada", 名字拆过: true, 国家: "加拿大", 国家靠猜: true }), DEFAULT_BUSINESS, ["展会"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal).toMatchObject({ name: "Tom", contact: "", wechat: "wxid_test0001", country: "加拿大", reason: 微信卡理由, remark: "微信昵称：Tom | Canada", source: "展会" });
    expect(r.proposal.待确认).toEqual(["name", "country"]);
    expect(missingFields(r.proposal)).toEqual(["确认「名称」", "确认「国家」"]);
  });
  it("地区写清楚的：不用确认", () => {
    const r = 微信成新线索卡(资料({ 国家: "加拿大", 城市: "多伦多" }), DEFAULT_BUSINESS, []);
    expect(r.ok && r.proposal.待确认).toBeUndefined();
    expect(r.ok && missingFields(r.proposal)).toEqual([]);
  });
  it("没名字：用微信号当名称，名称待确认", () => {
    const r = 微信成新线索卡(资料({ 名字: "" }), DEFAULT_BUSINESS, []);
    expect(r.ok && r.proposal).toMatchObject({ name: "wxid_test0001", 待确认: ["name", "country"] });
  });
});

describe("用话补卡", () => {
  const 卡 = (补: Partial<微信资料> = {}) => {
    const r = 微信成新线索卡(资料(补), DEFAULT_BUSINESS, []);
    if (!r.ok) throw new Error(r.error);
    return r.proposal;
  };
  it("话里有渠道名：取最长的那个当来源；话里的国家填上、不用再确认", () => {
    const p = 用话补卡(卡(), "秋季广交会的客户，加拿大人", ["广交会", "秋季广交会"]);
    expect(p).toMatchObject({ source: "秋季广交会", country: "加拿大" });
    expect(p.待确认).toBeUndefined();
  });
  it("展会名里的地名不是国家：「香港展会」不填中国香港，国家照样待确认", () => {
    const p = 用话补卡(卡(), "香港展会客户，帮我查重并录入", []);
    expect(p.country ?? "").toBe("");
    expect(p.待确认).toEqual(["country"]);
    expect(用话补卡(卡(), "香港展会客户，巴基斯坦的", []).country).toBe("巴基斯坦");
    // 渠道名先拿掉，剩下的才找国家
    expect(用话补卡(卡(), "香港展会客户", ["香港展会"])).toMatchObject({ source: "香港展会", 待确认: ["country"] });
  });
  it("卡上已有、不用确认的国家：话里的不覆盖", () => {
    expect(用话补卡(卡({ 国家: "加拿大" }), "pakistan customer", []).country).toBe("加拿大");
  });
  it("话里没渠道：来源不动", () => {
    expect(用话补卡({ ...卡(), source: "展会" }, "帮我录入", ["广交会"]).source).toBe("展会");
  });
});

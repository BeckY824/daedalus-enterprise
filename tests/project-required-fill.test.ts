/**
 * 「完成节点」框一窗填完（lib/project/required-fill.ts）：每个必填对到哪种控件、占位值判定和服务端同一个口径、部分失败不丢、自动推进不多走一步。
 */
import { describe, it, expect, vi } from "vitest";
import { 必填项们, 还差, 占位值们, 需求未确认, type 必填项, type 必填数据 } from "@/lib/project/required";
import { 默认组织规则 } from "@/lib/project/org-rules";
import {
  填法表, 归类, 初始草稿, 草稿问题, 草稿是空的, 现值不算的话, 这项的改动, 算窗口状态, 依次保存, 存完怎么走, 按目录排,
  type 补齐项目, type 草稿值, type 窗里环境,
} from "@/lib/project/required-fill";

const 环境 = (x: Partial<窗里环境> = {}): 窗里环境 => ({ 能就地改: true, 改不了话: "只有项目负责人能改，其他人只能看", 只能看字段: [], 渠道数: 2, 有所在地: true, 有画像: true, 联系人数: 1, ...x });
const 项目 = (x: Partial<补齐项目> = {}): 补齐项目 => ({ name: "项目甲", amount: 0, currency: "USD", acceptancePassed: false, balanceSettled: false, ...x });
const 空数据 = (): 必填数据 => ({
  项目: { node: "潜客培育", contactId: null, nextStepAt: null, expectedDealAt: null, amount: 0, remark: null, acceptancePassed: false },
  客户: { phone: null, extra: null },
  联系人们: [],
  沟通节点们: [],
});

/** 把交给 action 的改动落到服务端判定用的数据上，再问 required.ts：真算填上了吗 */
function 服务端算不算(项: 必填项, 值: 草稿值): boolean {
  const 改 = 这项的改动(项, 值);
  const d = 空数据();
  const 列 = d.项目 as unknown as Record<string, unknown>;
  if (!改) return false;
  if (改.存 === "交付") 列[改.项] = true;
  else if (改.存 === "画像") {
    const { productNeeds, ...单选 } = 改.改动;
    Object.assign(列, 单选);
    if (productNeeds) d.需求类型们 = productNeeds;
  } else {
    const { painPoints, contractStatus, ...其它 } = 改.改动;
    Object.assign(列, 其它);
    if (painPoints !== undefined) d.痛点标注 = painPoints;
    if (contractStatus !== undefined) d.合同状态 = contractStatus;
  }
  const 规则 = { ...默认组织规则, 节点推进: { 开: true, 必填: { 潜客培育: [项] } } };
  return !还差(规则, d).length;
}

const 算数的值: Partial<Record<必填项, 草稿值>> = {
  主联系人: "k1", 需求: "明确需求", 需求类型: ["产品甲"], 金额: { 数: 100, 币: "USD" }, 合同金额: { 数: 100, 币: "USD" }, 定金金额: { 数: 1, 币: "CNY" },
  预计成交日期: "2026-12-01", 需求描述: "要十台", 痛点标注: "交期紧", 合同已生效: "已生效", 项目名称: "新名字", 项目来源: "ch1",
  项目所在地: { addrCountry: null, addrProvince: "广东省", addrCity: "深圳市", addrDistrict: null }, 项目级别: "A",
  验收通过: true, 尾款结清: true, 预算能力: "预算充足", 价格感知: "敏感", 决策链路: "清楚", 采购周期: "半年", 产品匹配: "匹配", 价值认同: "认同",
  决策触达: "已触达", 竞品信息: "无竞品", 部署条件: "满足", 场地现状: "已有",
};

describe("填法表", () => {
  it("目录里每个必填都有填法，窗外的都写了原因", () => {
    expect(Object.keys(填法表).sort()).toEqual(必填项们.map((x) => x.key).sort());
    for (const 法 of Object.values(填法表)) if (法.控件 === "窗外") expect(法.原因).toBeTruthy();
  });
  it("控件和页面上编辑这一项时一致", () => {
    const 控件 = (k: 必填项) => 填法表[k].控件;
    expect(控件("金额")).toBe("钱");
    expect(控件("定金金额")).toBe("钱");
    expect(控件("预计成交日期")).toBe("日期");
    expect(控件("主联系人")).toBe("联系人");
    expect(控件("项目来源")).toBe("渠道");
    expect(控件("项目所在地")).toBe("地址");
    expect(控件("合同已生效")).toBe("合同状态");
    expect(控件("需求")).toBe("画像单选");
    expect(控件("需求类型")).toBe("画像多选");
    expect(控件("尾款结清")).toBe("勾");
  });
  it("要传文件、记沟通、走判定的不假装能填，且写清去哪", () => {
    const 去 = (k: 必填项) => { const 类 = 归类(k, 环境()); return 类.类 === "去" ? 类.去 : "能填"; };
    for (const k of ["下一步时间", "下一步计划", "本节点沟通", "沟通三项"] as const) expect(去(k)).toBe("沟通");
    // 有效沟通 11-05 起 = 线索验证那一步配的其他必填项都填好，不是记一条沟通能补上的
    expect(去("有效沟通")).toBeNull();
    for (const k of ["合同附件", "项目方案"] as const) expect(去(k)).toBe("附件");
    expect(去("回款")).toBe("回款");
    expect(去("线索验证结果")).toBe("线索验证");
    for (const k of ["联系方式", "来源", "国家", "客户等级", "分配方式"] as const) expect(去(k)).toBe("客户");
    expect(去("所属客户")).toBeNull();
  });
  it("没配进来的旧 key 不崩：归到填不了", () => {
    expect(归类("早就删掉的必填", 环境())).toMatchObject({ 类: "去", 去: null });
  });
});

describe("这个人能不能当场填", () => {
  it("改不了内容（只能推节点的上级、公海）：不摆控件，写原话", () => {
    expect(归类("金额", 环境({ 能就地改: false }))).toEqual({ 类: "去", 去: null, 原因: "只有项目负责人能改，其他人只能看" });
  });
  it("字段权限只读的格子不摆控件；只卡对应那格", () => {
    const 环 = 环境({ 只能看字段: ["商机金额"] });
    for (const k of ["金额", "合同金额", "定金金额", "需求描述"] as const) expect(归类(k, 环).类).toBe("去");
    expect(归类("痛点标注", 环).类).toBe("填");
    expect(归类("预计成交日期", 环境({ 只能看字段: ["预计签约"] })).类).toBe("去");
    expect(归类("合同已生效", 环境({ 只能看字段: ["合同状态"] })).类).toBe("去");
  });
  it("缺前提的说清楚：没渠道、看不到画像 / 所在地、客户没联系人（去客户页加）", () => {
    expect(归类("项目来源", 环境({ 渠道数: 0 })).类).toBe("去");
    expect(归类("项目来源", 环境({ 渠道数: undefined })).类).toBe("去");
    expect(归类("需求", 环境({ 有画像: false })).类).toBe("去");
    expect(归类("需求类型", 环境({ 有画像: false })).类).toBe("去");
    expect(归类("项目所在地", 环境({ 有所在地: false })).类).toBe("去");
    expect(归类("主联系人", 环境({ 联系人数: 0 }))).toMatchObject({ 类: "去", 去: "客户" });
  });
});

describe("占位值：和服务端一个口径", () => {
  const 文字项: 必填项[] = ["需求描述", "痛点标注", "项目名称", "项目级别", "预算能力", "需求"];
  it.each(文字项)("%s：占位值、空白都不算", (k) => {
    for (const v of [...占位值们, 需求未确认, " 暂无 ", "0"]) {
      expect(草稿问题(k, v), v).toMatch(/占位值/);
      expect(服务端算不算(k, v), v).toBe(false);
    }
    expect(草稿问题(k, "   ")).toBeTruthy();
    expect(草稿是空的(k, "   ")).toBe(true);
    expect(服务端算不算(k, "   ")).toBe(false);
  });
  it("金额 0、负数、没填都不算；币种要有", () => {
    for (const 数 of [0, -1, null]) expect(草稿问题("金额", { 数, 币: "USD" })).toBeTruthy();
    expect(服务端算不算("金额", { 数: 0, 币: "USD" })).toBe(false);
    expect(草稿问题("金额", { 数: 5, 币: "" })).toBeTruthy();
    expect(草稿是空的("金额", { 数: null, 币: "USD" })).toBe(true);
    expect(草稿是空的("金额", { 数: 0, 币: "USD" })).toBe(false);
  });
  it("合同状态只有「已生效」算，其它状态当场说", () => {
    for (const v of ["起草中", "待对方确认", null]) expect(草稿问题("合同已生效", v)).toMatch(/已生效/);
    expect(草稿问题("合同已生效", "已生效")).toBeNull();
    expect(服务端算不算("合同已生效", "起草中")).toBe(false);
  });
  it("多选里全是占位值不算", () => {
    expect(草稿问题("需求类型", ["暂无", "-"])).toBeTruthy();
    expect(草稿问题("需求类型", [])).toBeTruthy();
    expect(服务端算不算("需求类型", ["暂无"])).toBe(false);
    expect(这项的改动("需求类型", ["暂无", "产品甲"])).toEqual({ 存: "画像", 改动: { productNeeds: ["产品甲"] } });
  });
  it("所在地：只填省市算（服务端补国内），全空不算，占位国家不算", () => {
    const 地 = (x: Partial<Record<"addrCountry" | "addrProvince" | "addrCity" | "addrDistrict", string>>) => ({ addrCountry: null, addrProvince: null, addrCity: null, addrDistrict: null, ...x });
    expect(草稿问题("项目所在地", 地({ addrProvince: "广东省" }))).toBeNull();
    expect(草稿问题("项目所在地", 地({ addrCountry: "美国" }))).toBeNull();
    expect(草稿问题("项目所在地", 地({}))).toBeTruthy();
    expect(草稿是空的("项目所在地", 地({}))).toBe(true);
    expect(草稿问题("项目所在地", 地({ addrCountry: "暂无" }))).toMatch(/占位值/);
  });
  it("没勾不算", () => {
    expect(草稿问题("尾款结清", false)).toBeTruthy();
    expect(草稿问题("尾款结清", true)).toBeNull();
  });
  it("框里说算的，交给 action 存完服务端也算（每个能当场填的必填都对一遍）", () => {
    for (const x of 必填项们) {
      if (填法表[x.key].控件 === "窗外") continue;
      const 值 = 算数的值[x.key];
      expect(值, `${x.key} 要有样例`).toBeDefined();
      expect(草稿问题(x.key, 值), x.key).toBeNull();
      // 项目所在地：补国内这一步在服务端（规整地址），这里只看省市；单独看带国家的
      if (x.key === "项目所在地") expect(服务端算不算(x.key, { addrCountry: "中国", addrProvince: "广东省", addrCity: null, addrDistrict: null })).toBe(true);
      else expect(服务端算不算(x.key, 值 as 草稿值), x.key).toBe(true);
    }
  });
});

describe("打开时格子里的值", () => {
  it("占位值、0 不带进来，旁边说一句为什么", () => {
    const p = 项目({ name: "暂无", 成交钱: { dealDemand: "-", contractAmount: 0, contractCurrency: null, depositAmount: null, depositCurrency: null }, 项目新字段: { painPoints: "暂无" } });
    expect(初始草稿("项目名称", p)).toBeNull();
    expect(初始草稿("需求描述", p)).toBeNull();
    expect(初始草稿("痛点标注", p)).toBeNull();
    expect(初始草稿("金额", p)).toEqual({ 数: null, 币: "USD" });
    expect(初始草稿("合同金额", p)).toEqual({ 数: null, 币: "USD" });
    expect(现值不算的话("项目名称", p)).toMatch(/暂无.*不算/);
    expect(现值不算的话("金额", p)).toBeNull();
  });
  it("真值带进来；币种跟现值；合同状态带现值（不是已生效会当场提示）", () => {
    const p = 项目({ amount: 12, currency: "EUR", 项目新字段: { contractStatus: "起草中" }, 画像: { 值: { budgetLevel: "预算充足", demandStatus: 需求未确认, productNeeds: ["产品甲", "暂无"] } } });
    expect(初始草稿("金额", p)).toEqual({ 数: 12, 币: "EUR" });
    expect(初始草稿("合同已生效", p)).toBe("起草中");
    expect(初始草稿("预算能力", p)).toBe("预算充足");
    expect(初始草稿("需求", p)).toBeNull();
    expect(现值不算的话("需求", p)).toMatch(需求未确认);
    expect(初始草稿("需求类型", p)).toEqual(["产品甲"]);
  });
});

describe("存的时候", () => {
  it("每项只交自己的列，走现有的三个 action", () => {
    expect(这项的改动("金额", { 数: 5, 币: "USD" })).toEqual({ 存: "项目", 改动: { amount: 5, currency: "USD" } });
    expect(这项的改动("定金金额", { 数: 5, 币: "USD" })).toEqual({ 存: "项目", 改动: { depositAmount: 5, depositCurrency: "USD" } });
    expect(这项的改动("合同金额", { 数: 5, 币: "USD" })).toEqual({ 存: "项目", 改动: { contractAmount: 5, contractCurrency: "USD" } });
    expect(这项的改动("需求描述", " 十台 ")).toEqual({ 存: "项目", 改动: { dealDemand: "十台" } });
    expect(这项的改动("项目名称", " 新名字 ")).toEqual({ 存: "项目", 改动: { name: "新名字" } });
    expect(这项的改动("需求", "明确需求")).toEqual({ 存: "画像", 改动: { demandStatus: "明确需求" } });
    expect(这项的改动("尾款结清", true)).toEqual({ 存: "交付", 项: "balanceSettled" });
    expect(这项的改动("验收通过", true)).toEqual({ 存: "交付", 项: "acceptancePassed" });
    expect(这项的改动("回款", null)).toBeNull();
  });
  it("所在地只交四格，不动 location", () => {
    const r = 这项的改动("项目所在地", { addrCountry: "美国", addrProvince: null, addrCity: "洛杉矶", addrDistrict: null });
    expect(r).toEqual({ 存: "项目", 改动: { addrCountry: "美国", addrProvince: null, addrCity: "洛杉矶", addrDistrict: null } });
  });
  it("一项失败不挡其它项；抛错也算这一项失败；哪项错对得上", async () => {
    const 存 = vi.fn(async (k: 必填项) => {
      if (k === "金额") return { ok: false, error: "金额不能超过上限" };
      if (k === "需求描述") throw new Error("断网");
      return { ok: true };
    });
    const 果 = await 依次保存(["金额", "需求描述", "预算能力"], 存);
    expect(存).toHaveBeenCalledTimes(3);
    expect(果.已存).toEqual(["预算能力"]);
    expect(果.失败.金额).toBe("金额不能超过上限");
    expect(果.失败.需求描述).toBeTruthy();
    expect(存完怎么走(果, "推")).toBe("留窗");
    expect(存完怎么走(果, "强推")).toBe("留窗");
  });
  it("按顺序一项一项存，不并发（改项目 同一行上的事务）", async () => {
    const 顺序: string[] = [];
    await 依次保存(["金额", "预算能力"], async (k) => {
      顺序.push(`开始${k}`);
      await new Promise((r) => setTimeout(r, 1));
      顺序.push(`结束${k}`);
      return { ok: true };
    });
    expect(顺序).toEqual(["开始金额", "结束金额", "开始预算能力", "结束预算能力"]);
  });
});

describe("存完下一步", () => {
  it("服务端自动推过了：不再手动推，免得多走一步", async () => {
    const 果 = await 依次保存(["金额"], async () => ({ ok: true, 自动推到: ["明确需求"] }));
    expect(果.自动推到).toEqual(["明确需求"]);
    expect(存完怎么走(果, "推")).toBe("关窗");
    expect(存完怎么走(果, "强推")).toBe("关窗");
  });
  it("全存上且没自动推（画像项、退回来的节点）：手动推", () => {
    expect(存完怎么走({ 失败: {}, 自动推到: [] }, "推")).toBe("推");
    expect(存完怎么走({ 失败: {}, 自动推到: [] }, "强推")).toBe("强推");
  });
  it("只保存：留窗", () => {
    expect(存完怎么走({ 失败: {}, 自动推到: [] }, "只存")).toBe("留窗");
  });
});

describe("保存并完成节点亮不亮", () => {
  const 草稿 = (x: Partial<Record<必填项, 草稿值>>) => (k: 必填项) => x[k];
  it("窗里都填好才亮", () => {
    const 态 = 算窗口状态(["金额", "预算能力"], 环境(), 草稿({ 金额: { 数: 5, 币: "USD" }, 预算能力: "预算充足" }), [], true);
    expect(态).toMatchObject({ 待存: ["金额", "预算能力"], 没填好: [], 窗外们: [], 能一键完成: true });
  });
  it("有没填好的不亮，填好的可以先存", () => {
    const 态 = 算窗口状态(["金额", "预算能力"], 环境(), 草稿({ 金额: { 数: 0, 币: "USD" }, 预算能力: "预算充足" }), [], true);
    expect(态).toMatchObject({ 待存: ["预算能力"], 没填好: ["金额"], 能一键完成: false });
  });
  it("有窗外项不亮（不能假装填齐）；改不了内容的人全部归窗外", () => {
    const 态 = 算窗口状态(["金额", "合同附件"], 环境(), 草稿({ 金额: { 数: 5, 币: "USD" } }), [], true);
    expect(态).toMatchObject({ 待存: ["金额"], 窗外们: ["合同附件"], 能一键完成: false });
    const 上级 = 算窗口状态(["金额"], 环境({ 能就地改: false }), 草稿({ 金额: { 数: 5, 币: "USD" } }), [], true);
    expect(上级).toMatchObject({ 待存: [], 窗外们: ["金额"], 能一键完成: false });
  });
  it("存上的不重存；被别的关挡着（完成不了）不亮", () => {
    const 重试 = 算窗口状态(["金额", "预算能力"], 环境(), 草稿({ 金额: { 数: 5, 币: "USD" }, 预算能力: "预算充足" }), ["预算能力"], true);
    expect(重试).toMatchObject({ 待存: ["金额"], 能一键完成: true });
    const 挡着 = 算窗口状态(["金额"], 环境(), 草稿({ 金额: { 数: 5, 币: "USD" } }), [], false);
    expect(挡着.能一键完成).toBe(false);
  });
  it("按目录排、去重：存上一项刷新后行不乱跳", () => {
    expect(按目录排(["预算能力", "金额", "金额"])).toEqual(按目录排(["金额", "预算能力"]));
  });
});

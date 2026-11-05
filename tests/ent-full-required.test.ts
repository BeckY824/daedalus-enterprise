/**
 * 上线前全面测试 · 必填（11-02）：按 c1 现在的开关组合（scripts c1-switches 写进去的 orgRules 原样）钉住
 *   - 13 个节点的必填矩阵：规整后（企业版字典）每个节点一项不多一项不少；新名、旧名都认
 *   - 潜客培育 11 项（11-02 加了需求状态）；每个节点缺任一项，还差 只报那一项，且有中文叫法；全齐 = 空
 *   - 60 天：线索 / 商机 9 个节点内贸、外贸、暂不分配都 60；订单阶段不收；起算日 2026-11-01
 *   - 前两节点要沟通 规整后还在
 * 纯函数，不读库
 */
import { describe, it, expect } from "vitest";
import { 规整组织规则, type 组织规则 } from "@/lib/project/org-rules";
import { 建议必填, 节点必填, 还差, 必填叫法, 必填项名们, type 必填数据, type 必填项 } from "@/lib/project/required";
import { 节点超时天数, 超时回收日 } from "@/lib/project/timeout";
import { 企业版字典, 同名们 } from "@/lib/project/stage-dict";
import { 生效的合同状态 } from "@/lib/project/proj-fields";

const 九个 = ["潜客培育", "线索验证", "线索推进", "明确需求", "共识方案", "成交推进", "签约审批", "签订合同", "首款支付"];
const 六十 = Object.fromEntries(九个.map((n) => [n, 60]));
/** c1 上 orgRules 的样子：key 是团队版老名（c1-switches 写的），必填 = 用户给的 Excel 矩阵 */
const c1原样 = {
  超时回收: { 开: true, 节点天数: 六十, 外贸节点天数: { ...六十 }, 起算日: "2026-11-01" },
  节点推进: {
    开: true,
    必填: {
      潜客培育: ["需求类型", "需求", "分配方式", "项目名称", "所属客户", "主联系人", "项目来源", "项目所在地", "沟通三项", "下一步计划", "下一步时间"],
      线索验证: ["需求描述", "有效沟通", "分配方式", "项目级别", "线索验证结果", "沟通三项", "下一步计划", "下一步时间"],
      线索推进: ["需求", "沟通三项", "下一步计划", "下一步时间"],
      明确需求: ["预算能力", "痛点标注", "沟通三项", "下一步计划", "下一步时间"],
      共识方案: ["价格感知", "采购周期", "产品匹配", "竞品信息", "项目方案", "金额", "预计成交日期", "沟通三项", "下一步计划", "下一步时间"],
      成交推进: ["决策链路", "价值认同", "决策触达", "沟通三项", "下一步计划", "下一步时间"],
      签约审批: ["部署条件", "合同已生效", "沟通三项", "下一步计划", "下一步时间"],
      签订合同: ["合同附件", "合同金额", "定金金额", "沟通三项", "下一步计划", "下一步时间"],
      首款支付: ["回款", "沟通三项", "下一步计划", "下一步时间"],
      生产备货: ["下一步计划", "下一步时间"],
      物流运输: ["下一步计划", "下一步时间"],
      安装实施: ["场地现状", "下一步计划", "下一步时间"],
      验收交付: ["验收通过", "下一步计划", "下一步时间"],
    },
  },
  阶段: { 推进权限: "负责人可推", 出口叫法: {}, 前两节点要沟通: true },
};

const 规则: 组织规则 = 规整组织规则(c1原样, 企业版字典);
const 新名 = (n: string) => 企业版字典.改名[n] ?? n;
const 企业版十三个 = [...企业版字典.节点们.线索, ...企业版字典.节点们.商机, ...企业版字典.节点们.订单].slice(0, -1);

describe("c1 必填矩阵：规整后原样", () => {
  it("13 个节点、都换成企业版名；尾款结算没配", () => {
    expect(Object.keys(规则.节点推进.必填).sort()).toEqual([...企业版十三个].sort());
    expect(规则.节点推进.必填["尾款结算"]).toBeUndefined();
    expect(规则.节点推进.开).toBe(true);
  });

  it("c1 的矩阵 = 代码里的建议必填（设置页「用建议清单」那一套）", () => {
    expect(c1原样.节点推进.必填).toEqual(建议必填);
  });

  it.each(Object.entries(c1原样.节点推进.必填))("%s：新名、旧名都读到同一份，一项不多一项不少", (老名, 项们) => {
    expect(节点必填(规则, 新名(老名))).toEqual(项们);
    for (const n of 同名们(老名)) expect(节点必填(规则, n)).toEqual(项们);
    // 矩阵里的每一项都是系统认得的必填项（规整时不认得的会被悄悄丢掉）
    for (const x of 项们) expect(必填项名们).toContain(x);
  });

  it("潜客培育正好 11 项（11-02 加需求状态）", () => {
    expect(节点必填(规则, "潜客培育")).toHaveLength(11);
  });

  it("前两节点要沟通 规整后还开着；推进权限 = 负责人可推", () => {
    expect(规则.阶段.前两节点要沟通).toBe(true);
    expect(规则.阶段.推进权限).toBe("负责人可推");
  });
});

describe("c1 超时：60 天、两套、起算日", () => {
  it("起算日 2026-11-01、开着", () => {
    expect(规则.超时回收.开).toBe(true);
    expect(规则.超时回收.起算日).toBe("2026-11-01");
  });

  it.each(九个)("%s：内贸、外贸、暂不分配、没填线都是 60 天（新名旧名都认）", (老名) => {
    for (const n of 同名们(老名)) {
      for (const 线 of ["内贸", "外贸", "暂不分配", null]) expect(节点超时天数(规则, n, 企业版字典, 线)).toBe(60);
    }
  });

  it("订单阶段不收（哪怕字典默认 7 天）", () => {
    for (const n of 企业版字典.节点们.订单) {
      expect(超时回收日(规则, { phase: "订单", node: n }, "2026-11-01T10:00:00", 企业版字典, "内贸")).toBeNull();
    }
  });
});

/** 一份每样都填齐的数据（node 由调用方给） */
function 全齐(node: string): 必填数据 {
  return {
    项目: {
      node, contactId: "c", nextStepAt: new Date("2026-11-20T10:00:00+08:00"), expectedDealAt: new Date("2026-12-20T00:00:00+08:00"), amount: 100,
      remark: null, acceptancePassed: true, demandStatus: "明确需求", assignMode: "自动分配", name: "一号项目", channelId: "ch", addrCountry: "中国",
      level: "A", dealDemand: "要两台", nextStepText: "约演示", contractAmount: 100, depositAmount: 10, balanceSettled: true,
      budgetLevel: "高", priceSense: "敏感", decisionChain: "清楚", purchaseCycle: "三个月", productFit: "匹配", valueFit: "认同",
      decisionReach: "已触达", competitor: "有", deployFit: "具备", siteStatus: "已平整",
    },
    客户: { phone: "13800000001", extra: { country: "中国", source: "展会", level: "A" }, assignWay: "自动分配" },
    有客户: true,
    联系人们: [],
    沟通节点们: [node],
    沟通们: [{ node, initiator: "我方", content: "聊了需求", method: "电话" }],
    合同附件数: 1, 回款笔数: 1, 痛点标注: "价格高", 合同状态: 生效的合同状态, 项目方案数: 1,
    需求类型们: ["整机"], 分配方式: "自动分配",
    线索验证: { verdict: "有效线索", finalResult: null, pending: null },
  };
}

/** 去掉某一项（用空值或占位值） */
function 去掉(d: 必填数据, 项: 必填项): 必填数据 {
  const x: 必填数据 = structuredClone(d);
  const p = x.项目 as Record<string, unknown>;
  const 画像: Partial<Record<必填项, string>> = {
    预算能力: "budgetLevel", 价格感知: "priceSense", 决策链路: "decisionChain", 采购周期: "purchaseCycle", 产品匹配: "productFit",
    价值认同: "valueFit", 决策触达: "decisionReach", 竞品信息: "competitor", 部署条件: "deployFit", 场地现状: "siteStatus",
  };
  if (画像[项]) { p[画像[项]!] = "暂无"; return x; }
  switch (项) {
    case "需求类型": x.需求类型们 = []; break;
    case "分配方式": x.分配方式 = null; x.客户.assignWay = null; p.assignMode = null; break;
    case "项目名称": p.name = "  "; break;
    case "所属客户": x.有客户 = false; break;
    case "主联系人": p.contactId = null; break;
    case "项目来源": p.channelId = null; break;
    case "项目所在地": p.addrCountry = "-"; break;
    case "沟通三项": x.沟通们 = [{ ...x.沟通们![0], method: null }]; break;
    case "下一步计划": p.nextStepText = "待定"; break;
    case "下一步时间": p.nextStepAt = null; break;
    case "需求描述": p.dealDemand = ""; break;
    case "有效沟通": p.demandStatus = null; break;
    case "项目级别": p.level = null; break;
    case "线索验证结果": x.线索验证 = { verdict: "有效线索", finalResult: null, pending: "等复核" }; break;
    case "需求": p.demandStatus = "暂未确认"; break;
    case "痛点标注": x.痛点标注 = "无"; break;
    case "项目方案": x.项目方案数 = 0; break;
    case "金额": p.amount = 0; break;
    case "预计成交日期": p.expectedDealAt = null; break;
    case "合同已生效": x.合同状态 = "起草中"; break;
    case "合同附件": x.合同附件数 = 0; break;
    case "合同金额": p.contractAmount = 0; break;
    case "定金金额": p.depositAmount = null; break;
    case "回款": x.回款笔数 = 0; break;
    case "验收通过": p.acceptancePassed = false; break;
    default: throw new Error(`测试没写怎么去掉：${项}`);
  }
  return x;
}

describe("c1 矩阵：每个节点缺一项只报那一项", () => {
  it.each(企业版十三个)("%s：全齐 = 空；缺任一项 = 正好报那一项、有中文叫法", (node) => {
    const 项们 = 节点必填(规则, node);
    expect(项们.length).toBeGreaterThan(0);
    expect(还差(规则, 全齐(node))).toEqual([]);
    for (const 项 of 项们) {
      expect(还差(规则, 去掉(全齐(node), 项))).toEqual([项]);
      expect(必填叫法(项).trim().length).toBeGreaterThan(0);
    }
  });

  it("项目存的是旧名（明确需求）、沟通记在新名（痛点挖掘）上：照样算齐", () => {
    const d = 全齐("明确需求");
    d.沟通们 = [{ node: "痛点挖掘", initiator: "我方", content: "聊了", method: "电话" }];
    d.沟通节点们 = ["痛点挖掘"];
    expect(还差(规则, d)).toEqual([]);
  });

  it("沟通三项拼不起来：一条缺方式、一条缺发起主体 = 不齐", () => {
    const d = 全齐("潜客培育");
    d.沟通们 = [
      { node: "潜客培育", initiator: "我方", content: "聊了", method: null },
      { node: "潜客培育", initiator: null, content: "又聊了", method: "电话" },
    ];
    expect(还差(规则, d)).toEqual(["沟通三项"]);
  });

  it("沟通三项记在别的节点上 = 当前节点不齐", () => {
    const d = 全齐("线索验证");
    d.沟通们 = [{ node: "潜客培育", initiator: "我方", content: "聊了", method: "电话" }];
    expect(还差(规则, d)).toEqual(["沟通三项"]);
  });

  it("潜客培育全空（刚建的空项目）：11 项全报，按矩阵顺序", () => {
    const d: 必填数据 = {
      项目: { node: "潜客培育", contactId: null, nextStepAt: null, expectedDealAt: null, amount: 0, remark: null, acceptancePassed: false },
      客户: { phone: null, extra: null },
      联系人们: [],
      沟通节点们: [],
    };
    expect(还差(规则, d)).toEqual(c1原样.节点推进.必填.潜客培育);
  });

  it("中文叫法：沟通三项写明三样、主联系人叫所属联系人、金额叫预计成交金额", () => {
    expect(必填叫法("沟通三项")).toContain("发起主体");
    expect(必填叫法("沟通三项")).toContain("沟通方式");
    expect(必填叫法("主联系人")).toBe("所属联系人");
    expect(必填叫法("金额")).toBe("预计成交金额");
  });
});

describe("潜客培育要选需求状态（11-02 用户定：Excel 里漏了，加上必填）", () => {
  it("「暂未确认」= 没选，拦下只报需求；选了实际状态就放行", () => {
    const d = 全齐("潜客培育");
    (d.项目 as Record<string, unknown>).demandStatus = "暂未确认";
    expect(还差(规则, d)).toEqual(["需求"]);
    expect(必填叫法("需求")).toContain("需求状态");
    expect(还差(规则, 全齐("潜客培育"))).toEqual([]);
  });
});

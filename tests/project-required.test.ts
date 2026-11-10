/**
 * 企业版节点必填（lib/project/required.ts，D-37）：没开 / 没配的节点永远不差；配了的按数据算还差哪几样。
 */
import { describe, it, expect } from "vitest";
import { 必填项们, 还差, 节点推进生效, 按必填走, 节点必填, 能配必填的节点, 建议必填, 必填项名们, 必填叫法, 有效沟通还差, type 必填数据, type 必填项 } from "@/lib/project/required";
import { 默认组织规则, 规整组织规则, type 组织规则 } from "@/lib/project/org-rules";
import { 企业版字典, 本套节点名 } from "@/lib/project/stage-dict";

const 规则 = (必填: Record<string, string[]>, 开 = true): 组织规则 => ({ ...默认组织规则, 节点推进: { 开, 必填 } });

const 空数据 = (node = "潜客培育"): 必填数据 => ({
  项目: { node, contactId: null, nextStepAt: null, expectedDealAt: null, amount: 0, remark: null, acceptancePassed: false },
  客户: { phone: null, extra: null },
  联系人们: [],
  沟通节点们: [],
});

describe("目录", () => {
  it("最后一个节点不能配；建议清单只用目录里有的、能配的节点", () => {
    expect(能配必填的节点).not.toContain("尾款结算");
    expect(能配必填的节点).toContain("验收交付");
    for (const [node, 项] of Object.entries(建议必填)) {
      expect(能配必填的节点).toContain(node);
      for (const x of 项) expect(必填项名们).toContain(x);
    }
  });
  it("建议清单 = 客户「项目阶段字段配置矩阵」（11-01）：尾款结算之前每个节点都要下一步计划 / 时间，前九个节点还要沟通三项", () => {
    expect(Object.keys(建议必填)).toEqual(["潜客培育", "线索验证", "线索推进", "明确需求", "共识方案", "成交推进", "签约审批", "签订合同", "首款支付", "生产备货", "物流运输", "安装实施", "验收交付"]);
    const 前九 = ["潜客培育", "线索验证", "线索推进", "明确需求", "共识方案", "成交推进", "签约审批", "签订合同", "首款支付"];
    for (const [n, 项] of Object.entries(建议必填)) {
      expect(项.slice(-2)).toEqual(["下一步计划", "下一步时间"]);
      expect(项.includes("沟通三项")).toBe(前九.includes(n));
      expect(new Set(项).size).toBe(项.length);
    }
    const 另外 = (n: string) => 建议必填[n].filter((x) => !["沟通三项", "下一步计划", "下一步时间"].includes(x));
    expect(另外("潜客培育")).toEqual(["需求类型", "需求", "分配方式", "项目名称", "所属客户", "主联系人", "项目来源", "项目所在地"]);
    expect(另外("线索验证")).toEqual(["需求描述", "有效沟通", "分配方式", "项目级别", "线索验证结果"]);
    expect(另外("线索推进")).toEqual(["需求"]);
    expect(另外("明确需求")).toEqual(["预算能力", "痛点标注"]);
    expect(另外("共识方案")).toEqual(["价格感知", "采购周期", "产品匹配", "竞品信息", "项目方案", "金额", "预计成交日期"]);
    expect(另外("成交推进")).toEqual(["决策链路", "价值认同", "决策触达"]);
    expect(另外("签约审批")).toEqual(["部署条件", "合同已生效"]);
    expect(另外("签订合同")).toEqual(["合同附件", "合同金额", "定金金额"]);
    expect(另外("首款支付")).toEqual(["回款"]);
    expect(另外("生产备货")).toEqual([]);
    expect(另外("物流运输")).toEqual([]);
    expect(另外("安装实施")).toEqual(["场地现状"]);
    // M-必填-11（11-08）：交付验收认「验收报告」附件，不再用「验收通过」勾
    expect(另外("验收交付")).toEqual(["验收报告"]);
    // 只要「有一条沟通」的旧项不再建议（换成沟通三项）
    expect(Object.values(建议必填).flat()).not.toContain("本节点沟通");
  });

  it("设置页「用建议清单」对到企业版节点名后，每个 key 都在能配必填的节点里、都是企业版的节点", () => {
    const 企业版节点 = [...企业版字典.节点们.线索, ...企业版字典.节点们.商机, ...企业版字典.节点们.订单];
    const 填的 = Object.fromEntries(Object.entries(建议必填).map(([n, v]) => [本套节点名(n, 企业版字典), v]));
    expect(Object.keys(填的)).toHaveLength(Object.keys(建议必填).length);
    for (const n of Object.keys(填的)) {
      expect(能配必填的节点).toContain(n);
      expect(企业版节点).toContain(n);
    }
    expect(Object.keys(填的)).toEqual(expect.arrayContaining(["痛点挖掘", "方案敲定", "合同审批", "首款到账", "交付验收"]));
    // 组织规则校验认得（存得进去、读出来不被丢）
    const 读回 = 规整组织规则({ 节点推进: { 开: true, 必填: 填的 } });
    expect(读回.节点推进.必填).toEqual(填的);
  });
});

describe("生效 / 按必填走", () => {
  it("没开：哪怕配了也当没配", () => {
    const r = 规则({ 潜客培育: ["来源"] }, false);
    expect(节点推进生效(r)).toBe(false);
    expect(按必填走(r, "潜客培育")).toBe(false);
    expect(节点必填(r, "潜客培育")).toEqual([]);
    expect(还差(r, 空数据())).toEqual([]);
  });

  it("开了但一个都没配：不生效", () => {
    expect(节点推进生效(规则({}))).toBe(false);
    expect(节点推进生效(默认组织规则)).toBe(false);
  });

  it("开了、配了：只有配了的节点按必填走", () => {
    const r = 规则({ 潜客培育: ["来源"] });
    expect(节点推进生效(r)).toBe(true);
    expect(按必填走(r, "潜客培育")).toBe(true);
    expect(按必填走(r, "线索验证")).toBe(false);
    expect(还差(r, 空数据("线索验证"))).toEqual([]);
  });
});

describe("还差", () => {
  const 全部 = 规则({ 潜客培育: [...必填项名们] });

  it("什么都没填：按配的顺序全列出来", () => {
    expect(还差(全部, 空数据())).toEqual([...必填项名们]);
  });

  it("都填了：空", () => {
    const d: 必填数据 = {
      项目: { node: "潜客培育", contactId: "c1", nextStepAt: new Date(), expectedDealAt: "2026-11-30", amount: 100, remark: "要 200 台", demandStatus: "明确需求", acceptancePassed: true, assignMode: "自动分配" },
      客户: { phone: null, extra: { country: "德国", source: "展会", level: "A" } },
      联系人们: [{ email: "a@b.com" }],
      沟通节点们: ["潜客培育"],
      合同附件数: 1,
      回款笔数: 1,
      痛点标注: "交期总拖",
      合同状态: "已生效",
      项目方案数: 1,
      验收报告数: 1,
    };
    // 11-01 矩阵加的几样
    Object.assign(d.项目, {
      name: "二期", channelId: "ch1", addrCountry: "德国", level: "A", dealDemand: "200 台", nextStepText: "约演示",
      contractAmount: 10, depositAmount: 1, balanceSettled: true,
      budgetLevel: "充足", priceSense: "价格认可", decisionChain: "已摸清", purchaseCycle: "一个月内", productFit: "完全匹配",
      valueFit: "认同", decisionReach: "已触达", competitor: "无竞品·我方独家", deployFit: "完全符合", siteStatus: "已有场地",
    });
    Object.assign(d, {
      有客户: true, 需求类型们: ["常规标品"], 分配方式: "指定分配", 有效沟通数: 1,
      沟通们: [{ node: "潜客培育", initiator: "我方", content: "电话聊了", method: "电话" }],
      线索验证: { verdict: "有效线索", finalResult: "有效线索", pending: null },
    });
    expect(还差(全部, d)).toEqual([]);
  });

  it("验收报告（M-必填-11）：「验收报告」附件传了至少一份就算，没读 / 0 份 = 差；验收通过的勾不算它", () => {
    const r = 规则({ 交付验收: ["验收报告"] });
    const 在 = (补: Partial<必填数据> = {}, 勾 = false): 必填数据 => ({ ...空数据("交付验收"), ...补, 项目: { ...空数据("交付验收").项目, acceptancePassed: 勾 } });
    expect(还差(r, 在())).toEqual(["验收报告"]);
    expect(还差(r, 在({ 验收报告数: 0 }, true))).toEqual(["验收报告"]);
    expect(还差(r, 在({ 合同附件数: 3, 项目方案数: 2 }))).toEqual(["验收报告"]);
    expect(还差(r, 在({ 验收报告数: 1 }))).toEqual([]);
    expect(还差(r, 在({ 验收报告数: 4 }))).toEqual([]);
    expect(必填叫法("验收报告")).toBe("验收报告");
  });

  it("分配方式（11-01 会议 §1）：建的时候选了才算；老项目没有 = 差；只在必填开关开着时管", () => {
    const r = 规则({ 潜客培育: ["分配方式", "需求"] });
    expect(还差(r, 空数据())).toEqual(["分配方式", "需求"]);
    for (const m of ["自动分配", "个人自持", "暂不分配", "指定分配", "公海捞取"]) {
      expect(还差(r, { ...空数据(), 项目: { ...空数据().项目, assignMode: m, demandStatus: "明确需求" } })).toEqual([]);
    }
    expect(还差(r, { ...空数据(), 项目: { ...空数据().项目, assignMode: "  ", demandStatus: "暂未确认" } })).toEqual(["分配方式", "需求"]);
    expect(还差(规则({ 潜客培育: ["分配方式"] }, false), 空数据())).toEqual([]);
  });

  it("联系方式：客户上任一样、或任一联系人的电话 / 邮箱 / 微信都算；空白不算", () => {
    const r = 规则({ 潜客培育: ["联系方式"] });
    expect(还差(r, 空数据())).toEqual(["联系方式"]);
    expect(还差(r, { ...空数据(), 客户: { phone: "  ", extra: { whatsapp: "" } } })).toEqual(["联系方式"]);
    for (const extra of [{ whatsapp: "+49" }, { wechat: "w" }, { email: "e" }, { alibabaId: "x" }]) {
      expect(还差(r, { ...空数据(), 客户: { phone: null, extra } })).toEqual([]);
    }
    expect(还差(r, { ...空数据(), 客户: { phone: "138", extra: null } })).toEqual([]);
    expect(还差(r, { ...空数据(), 联系人们: [{ phone: "" }, { wechat: "w" }] })).toEqual([]);
  });

  it("预计成交日期读项目上的（10-27 从客户挪到项目）", () => {
    const r = 规则({ 潜客培育: ["预计成交日期"] });
    expect(还差(r, 空数据())).toEqual(["预计成交日期"]);
    expect(还差(r, { ...空数据(), 项目: { ...空数据().项目, expectedDealAt: new Date("2026-12-01") } })).toEqual([]);
  });

  it("金额要大于 0；需求看需求状态（空白、暂未确认都不算，备注不算）；本节点沟通只认这个节点记的", () => {
    const r = 规则({ 线索验证: ["金额", "需求", "本节点沟通"] });
    const d = 空数据("线索验证");
    d.项目.remark = "要样品";
    d.项目.demandStatus = "   ";
    d.沟通节点们 = ["潜客培育"];
    expect(还差(r, d)).toEqual(["金额", "需求", "本节点沟通"]);
    d.项目.demandStatus = "暂未确认";
    expect(还差(r, d)).toContain("需求");
    // M-必填-03：「暂未确认」不在字典里了，说明里也不再提它
    expect(必填项们.find((x) => x.key === "需求")?.说明).not.toContain("暂未确认");
    d.项目.amount = 1;
    d.项目.demandStatus = "表面触达";
    d.沟通节点们.push("线索验证");
    expect(还差(r, d)).toEqual([]);
  });

  it("给人看的叫法（10-29）：本节点沟通叫「当前进程沟通」，需求写明看需求状态（10-31），11-01 按矩阵字段名（金额 = 预计成交金额…）；键不变", () => {
    expect(必填叫法("本节点沟通")).toBe("当前进程沟通");
    expect(必填叫法("需求")).toBe("需求（需求状态）");
    expect(必填叫法("金额")).toBe("预计成交金额");
    expect(必填叫法("回款")).toBe("当前回款");
    expect(必填叫法("主联系人")).toBe("所属联系人");
    expect(必填叫法("预算能力")).toBe("预算能力");
    expect(必填叫法("不认识的")).toBe("不认识的");
    expect(必填项名们).toContain("本节点沟通");
  });
});

describe("11-01 矩阵补的必填项", () => {
  const 有项目 = (node: string, 改: Partial<必填数据["项目"]>): 必填数据 => ({ ...空数据(node), 项目: { ...空数据(node).项目, ...改 } });

  it("沟通三项：同一条沟通上发起主体、内容、方式都有才算；缺一样、占位值、别的节点记的都不算", () => {
    const r = 规则({ 线索推进: ["沟通三项"] });
    const 带 = (沟通们: 必填数据["沟通们"]) => 还差(r, { ...空数据("线索推进"), 沟通们 });
    const 全 = { node: "线索推进", initiator: "客户", content: "问报价", method: "微信" };
    expect(带([])).toEqual(["沟通三项"]);
    expect(带([{ ...全, method: null }])).toEqual(["沟通三项"]);
    expect(带([{ ...全, initiator: "  " }])).toEqual(["沟通三项"]);
    expect(带([{ ...全, content: "暂无" }])).toEqual(["沟通三项"]);
    // 两条各缺一样，拼不起来
    expect(带([{ ...全, method: null }, { ...全, initiator: null }])).toEqual(["沟通三项"]);
    expect(带([{ ...全, node: "潜客培育" }])).toEqual(["沟通三项"]);
    expect(带([{ ...全, method: null }, 全])).toEqual([]);
  });

  it("沟通三项认企业版改名前后的节点名（项目存新名、沟通挂旧名也算）", () => {
    const r = 规则({ 痛点挖掘: ["沟通三项"] });
    expect(还差(r, { ...空数据("痛点挖掘"), 沟通们: [{ node: "明确需求", initiator: "我方", content: "聊痛点", method: "电话" }] })).toEqual([]);
  });

  it("项目画像单选：选了才算，「暂未确认」「暂无」「-」这类占位不算", () => {
    const 们 = ["预算能力", "价格感知", "决策链路", "采购周期", "产品匹配", "价值认同", "决策触达", "竞品信息", "部署条件", "场地现状"] as const;
    const 列 = { 预算能力: "budgetLevel", 价格感知: "priceSense", 决策链路: "decisionChain", 采购周期: "purchaseCycle", 产品匹配: "productFit", 价值认同: "valueFit", 决策触达: "decisionReach", 竞品信息: "competitor", 部署条件: "deployFit", 场地现状: "siteStatus" } as const;
    for (const k of 们) {
      const r = 规则({ 方案敲定: [k] });
      expect(还差(r, 空数据("方案敲定"))).toEqual([k]);
      for (const 占位 of ["暂未确认", "暂无", "-", "  "]) expect(还差(r, 有项目("方案敲定", { [列[k]]: 占位 }))).toEqual([k]);
      expect(还差(r, 有项目("方案敲定", { [列[k]]: "某个选项" }))).toEqual([]);
    }
  });

  it("文字项（下一步计划、需求描述、项目名称、项目所在地、项目级别）占位不算；项目来源要选渠道", () => {
    const r = 规则({ 潜客培育: ["下一步计划", "需求描述", "项目名称", "项目所在地", "项目级别", "项目来源"] });
    expect(还差(r, 有项目("潜客培育", { nextStepText: "待定", dealDemand: "无", name: "-", addrCountry: "未知", level: "", channelId: null })))
      .toEqual(["下一步计划", "需求描述", "项目名称", "项目所在地", "项目级别", "项目来源"]);
    expect(还差(r, 有项目("潜客培育", { nextStepText: "下周演示", dealDemand: "200 台", name: "二期", addrCountry: "中国", level: "S", channelId: "ch" }))).toEqual([]);
  });

  it("需求类型：至少一项不是占位；分配方式：项目分配记录或客户分配方式任一有值；所属客户要客户还在", () => {
    const r = 规则({ 潜客培育: ["需求类型", "分配方式", "所属客户"] });
    expect(还差(r, { ...空数据(), 需求类型们: [], 分配方式: "暂无" })).toEqual(["需求类型", "分配方式", "所属客户"]);
    expect(还差(r, { ...空数据(), 需求类型们: ["暂无"] })).toContain("需求类型");
    expect(还差(r, { ...空数据(), 需求类型们: ["常规标品"], 分配方式: "自动分配", 有客户: true })).toEqual([]);
    expect(还差(r, { ...空数据(), 需求类型们: ["常规标品"], 客户: { phone: null, extra: null, assignWay: "自持" }, 有客户: true })).toEqual([]);
  });

  it("线索验证结果：判了有效线索、没在等复核 / 认领才算；有效沟通没配别的就看需求状态", () => {
    const r = 规则({ 线索验证: ["线索验证结果", "有效沟通"] });
    const d = 空数据("线索验证");
    expect(还差(r, d)).toEqual(["线索验证结果", "有效沟通"]);
    expect(还差(r, { ...d, 线索验证: { verdict: "暂未判定", finalResult: null, pending: null } })).toEqual(["线索验证结果", "有效沟通"]);
    expect(还差(r, { ...d, 线索验证: { verdict: "初验无效", finalResult: null, pending: "市场复核" } })).toContain("线索验证结果");
    // 总管理终判有效后还等销售认领：不算
    expect(还差(r, { ...d, 线索验证: { verdict: "有效线索", finalResult: "有效线索", pending: "销售认领" } })).toContain("线索验证结果");
    const 有需求 = { ...d, 项目: { ...d.项目, demandStatus: "明确需求" } };
    expect(还差(r, { ...有需求, 线索验证: { verdict: "有效线索", finalResult: "有效线索", pending: null } })).toEqual([]);
  });

  it("有效沟通还差：线索验证配了别的必填就看那几样（不算它自己和线索验证结果），没配看需求状态，占位值不算", () => {
    const d = 空数据("线索验证");
    expect(有效沟通还差(d)).toEqual(["需求"]);
    expect(有效沟通还差({ ...d, 项目: { ...d.项目, demandStatus: "暂未确认" } })).toEqual(["需求"]);
    expect(有效沟通还差({ ...d, 项目: { ...d.项目, demandStatus: "方向明晰" } })).toEqual([]);
    const 配 = { ...d, 线索验证必填: ["金额", "有效沟通", "线索验证结果"] as 必填项[] };
    expect(有效沟通还差(配)).toEqual(["金额"]);
    expect(有效沟通还差({ ...配, 项目: { ...配.项目, amount: 5 } })).toEqual([]);
    // 只配了它自己和线索验证结果：等于没配，退回看需求状态
    expect(有效沟通还差({ ...d, 线索验证必填: ["有效沟通", "线索验证结果"] })).toEqual(["需求"]);
  });

  it("合同金额、定金金额要大于 0；尾款结清看勾", () => {
    const r = 规则({ 签订合同: ["合同金额", "定金金额", "尾款结清"] });
    expect(还差(r, 有项目("签订合同", { contractAmount: 0, depositAmount: null }))).toEqual(["合同金额", "定金金额", "尾款结清"]);
    expect(还差(r, 有项目("签订合同", { contractAmount: 100, depositAmount: 10, balanceSettled: true }))).toEqual([]);
  });

  it("老配置（只用 10-31 前的键）、老数据（不带新字段）算法不变", () => {
    const r = 规则({ 潜客培育: ["联系方式", "来源", "本节点沟通", "下一步时间"] });
    expect(还差(r, 空数据())).toEqual(["联系方式", "来源", "本节点沟通", "下一步时间"]);
    expect(还差(r, { ...有项目("潜客培育", { nextStepAt: new Date() }), 客户: { phone: "138", extra: { source: "展会" } }, 沟通节点们: ["潜客培育"] })).toEqual([]);
  });
});

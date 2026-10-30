/**
 * 企业版项目页 P11（10-29）：阶段 / 进程分开、项目画像五项（迁移 087）。所在地、级别改走编辑项目，见 ent-project-location-level.test.ts
 *
 * 钉的是：
 *   - 阶段与进程：没结局按库里 phase / node；有结局按结局认阶段（成功交付、异常状态归订单，线索流失归线索，丢单归商机），
 *     结局按字典叫法（企业版「商机丢单」、后台改的叫法），节点按 改名 对到这套
 *   - 读 / 存产品需求：存 JSON 数组、去重保序、空数组存 null；坏数据读成 []
 *   - 改项目画像（真库 + 企业字典）：单选只认启用着的项；已存的项停用了，不改它照留、别的项照改；多选同理；
 *     负责人、老板能改，同事、公海里的改不了；没变不写；不是企业版不认（所在地不再是画像的一项，传了不认）
 *   - 需求状态、产品需求 10-30 换成客户原表的取值：老库第一次读时按序号改名，需求状态多出的第五项停用，产品需求补齐八项；项目上存的原值不动
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 阶段与进程, 团队版字典, 企业版字典, 字典of, type 阶段字典 } from "@/lib/project/stage-dict";
import { 读产品需求, 存产品需求 } from "@/lib/project/profile-rules";
import { 改项目画像 } from "@/lib/project/profile";
import { 企业字典 } from "@/lib/enterprise/dict";

describe("阶段与进程：阶段、进程分两格", () => {
  it("进行中：阶段 = phase，进程 = node，没有结局", () => {
    expect(阶段与进程({ phase: "线索", node: "潜客培育", result: null })).toEqual({ 阶段: "线索", 进程: "潜客培育", 结局: null });
    expect(阶段与进程({ phase: "订单", node: "验收交付" }, 企业版字典)).toEqual({ 阶段: "订单", 进程: "验收交付", 结局: null });
  });

  it("有结局按结局认阶段，不看库里 phase：成功交付 / 异常状态归订单，线索流失归线索，丢单归商机", () => {
    // 老数据 phase 写得不对也按结局归
    expect(阶段与进程({ phase: "商机", node: "尾款结算", result: "成功交付" }).阶段).toBe("订单");
    expect(阶段与进程({ phase: "订单", node: "生产备货", result: "异常状态" }).阶段).toBe("订单");
    expect(阶段与进程({ phase: "线索", node: "线索验证", result: "线索流失" }).阶段).toBe("线索");
    expect(阶段与进程({ phase: "商机", node: "成交推进", result: "丢单" })).toEqual({ 阶段: "商机", 进程: "成交推进", 结局: "丢单" });
  });

  it("结局按这套的叫法：企业版丢单叫「商机丢单」，后台改了叫法用改的", () => {
    expect(阶段与进程({ phase: "商机", node: "成交推进", result: "丢单" }, 企业版字典).结局).toBe("商机丢单");
    const 改过 = 字典of(true, { 订单: ["交付完成", null] });
    expect(阶段与进程({ phase: "订单", node: "尾款结算", result: "成功交付" }, 改过)).toEqual({ 阶段: "订单", 进程: "尾款结算", 结局: "交付完成" });
  });

  it("认不出的结局原样给、阶段退回 phase；节点按 改名 对到这套", () => {
    expect(阶段与进程({ phase: "商机", node: "明确需求", result: "怪结局" })).toEqual({ 阶段: "商机", 进程: "明确需求", 结局: "怪结局" });
    const 换名: 阶段字典 = { ...团队版字典, 改名: { 潜客培育: "客户培育" } };
    expect(阶段与进程({ phase: "线索", node: "潜客培育" }, 换名).进程).toBe("客户培育");
  });
});

describe("读 / 存产品需求", () => {
  it("存 JSON 数组、去重保序、去空格；空数组存 null", () => {
    expect(存产品需求([" 部署服务", "常规标品", "部署服务", ""])).toBe('["部署服务","常规标品"]');
    expect(存产品需求([])).toBeNull();
  });

  it("读：坏数据、不是数组都读成 []", () => {
    expect(读产品需求('["常规标品","运维支持"]')).toEqual(["常规标品", "运维支持"]);
    expect(读产品需求(null)).toEqual([]);
    expect(读产品需求("{坏")).toEqual([]);
    expect(读产品需求('{"a":1}')).toEqual([]);
  });
});

describe("改项目画像（真库、企业字典）", () => {
  let 老板: { id: string; role: string };
  let 乙: { id: string; role: string };
  let 丙: { id: string; role: string };
  let 项目id: string;
  const 读 = () => prisma.project.findUniqueOrThrow({ where: { id: 项目id }, select: { budgetLevel: true, priceSense: true, decisionChain: true, demandStatus: true, productNeeds: true, location: true } });
  const 停用 = async (kind: Parameters<typeof 企业字典>[0], name: string) => {
    await 企业字典(kind);
    await prisma.entDictItem.update({ where: { kind_name: { kind, name } }, data: { active: false } });
  };
  const 人 = async (email: string, role: string) => ({ id: (await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } })).id, role });

  beforeEach(async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await resetDb();
    老板 = await 人("p11-boss", "ADMIN");
    乙 = await 人("p11-yi", "SALES");
    丙 = await 人("p11-bing", "SALES");
    const 客户 = await prisma.customer.create({ data: { name: "QA-画像客户", phone: "13800001087", salesOwnerId: 乙.id } });
    项目id = (await prisma.project.create({ data: { name: "QA-画像项目", customerId: 客户.id, ownerId: 乙.id, creatorId: 乙.id } })).id;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("单选：启用着的项存得进；不在字典里的拦下不写；传 null 清掉", async () => {
    expect(await 改项目画像(乙, 项目id, { budgetLevel: "预算充足", decisionChain: "多部门决策" })).toEqual({ ok: true, 变了: ["budgetLevel", "decisionChain"] });
    expect(await 改项目画像(乙, 项目id, { priceSense: "随便写的" })).toMatchObject({ ok: false, error: expect.stringContaining("不在价格感知里") });
    expect(await 改项目画像(乙, 项目id, { decisionChain: null })).toEqual({ ok: true, 变了: ["decisionChain"] });
    expect(await 读()).toMatchObject({ budgetLevel: "预算充足", priceSense: null, decisionChain: null });
  });

  it("已存的项后来停用：不改它照留，改别的项不受影响；换成停用的项拦下", async () => {
    await 改项目画像(乙, 项目id, { budgetLevel: "预算充足" });
    await 停用("projBudget", "预算充足");
    // 界面上改别的项时整卡的值都可能带上：没换的那项不再对字典
    expect(await 改项目画像(乙, 项目id, { budgetLevel: "预算充足", demandStatus: "明确需求" })).toEqual({ ok: true, 变了: ["demandStatus"] });
    expect(await 读()).toMatchObject({ budgetLevel: "预算充足", demandStatus: "明确需求" });
    await 改项目画像(乙, 项目id, { budgetLevel: "预算匹配" });
    expect(await 改项目画像(乙, 项目id, { budgetLevel: "预算充足" })).toMatchObject({ ok: false, error: expect.stringContaining("可能刚被停用") });
    expect((await 读()).budgetLevel).toBe("预算匹配");
  });

  it("多选：存成 JSON 数组；新加的得启用着，已存的停用了照留；清空存 null", async () => {
    expect(await 改项目画像(乙, 项目id, { productNeeds: ["常规标品", "硬件标品"] })).toEqual({ ok: true, 变了: ["productNeeds"] });
    expect(读产品需求((await 读()).productNeeds)).toEqual(["常规标品", "硬件标品"]);
    await 停用("projProduct", "硬件标品");
    expect(await 改项目画像(乙, 项目id, { productNeeds: ["常规标品", "硬件标品", "内容定制"] })).toMatchObject({ ok: true });
    expect(读产品需求((await 读()).productNeeds)).toEqual(["常规标品", "硬件标品", "内容定制"]);
    expect(await 改项目画像(乙, 项目id, { productNeeds: ["常规标品", "瞎编的"] })).toMatchObject({ ok: false, error: expect.stringContaining("「瞎编的」不在产品需求里") });
    expect(await 改项目画像(乙, 项目id, { productNeeds: "常规标品" as unknown as string[] })).toMatchObject({ ok: false });
    expect(await 改项目画像(乙, 项目id, { productNeeds: [] })).toEqual({ ok: true, 变了: ["productNeeds"] });
    expect((await 读()).productNeeds).toBeNull();
  });

  it("谁能改同改项目：负责人、老板能改；同事、公海里的（含放回去的原负责人）改不了，库里不动", async () => {
    expect(await 改项目画像(丙, 项目id, { budgetLevel: "预算充足" })).toMatchObject({ ok: false, error: expect.stringContaining("项目负责人") });
    expect(await 改项目画像(老板, 项目id, { budgetLevel: "预算充足" })).toEqual({ ok: true, 变了: ["budgetLevel"] });
    expect(await 改项目画像(老板, 项目id, { budgetLevel: "预算充足" })).toEqual({ ok: true, 变了: [] });
    await prisma.project.update({ where: { id: 项目id }, data: { pooledAt: new Date() } });
    expect(await 改项目画像(乙, 项目id, { budgetLevel: "预算匹配" })).toMatchObject({ ok: false, error: expect.stringContaining("公海") });
    expect((await 读()).budgetLevel).toBe("预算充足");
  });

  it("不是企业版不认；项目不在了报不在", async () => {
    expect(await 改项目画像(乙, "no-such", { budgetLevel: "预算充足" })).toMatchObject({ ok: false, error: expect.stringContaining("不在了") });
    // 所在地不再从画像这条路改：混在 patch 里也不写
    expect(await 改项目画像(乙, 项目id, { budgetLevel: "预算充足", location: "北京" } as Parameters<typeof 改项目画像>[2])).toEqual({ ok: true, 变了: ["budgetLevel"] });
    expect((await 读()).location).toBeNull();
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 改项目画像(乙, 项目id, { budgetLevel: "预算匹配" })).toMatchObject({ ok: false, error: "此版本没有项目画像" });
    expect((await 读()).budgetLevel).toBe("预算充足");
  });
});

describe("需求状态、产品需求换成原表取值（10-30）", () => {
  beforeEach(async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await resetDb();
  });
  afterEach(() => vi.unstubAllEnvs());
  const 看 = async (kind: Parameters<typeof 企业字典>[0]) => (await 企业字典(kind)).map((x) => [x.id, x.name, x.active]);
  /** 模拟老库：按老默认建好、补新记号也记过（线上 8702 / 客户服务器就是这样） */
  async function 老库(kind: string, 名们: string[]) {
    for (const [i, name] of 名们.entries()) await prisma.entDictItem.create({ data: { id: `dict-${kind}-${i}`, kind, name, sort: i } });
    await prisma.setting.create({ data: { key: `entDict.defaultAdded.${kind}`, value: String(名们.length) } });
  }

  it("新库：需求状态四项、产品需求八项", async () => {
    expect((await 看("projDemand")).map((x) => x[1])).toEqual(["表面触达", "方向明晰", "明确需求", "共识痛点"]);
    expect((await 看("projProduct")).map((x) => x[1])).toEqual(["常规标品", "硬件标品", "内容标品", "硬件定制", "内容定制", "软件定制", "区域规划", "全案设计"]);
  });

  it("需求状态老库：前四项按序号改名，订单交付停用不删，自己加的不动；再读不变", async () => {
    await 老库("projDemand", ["潜客培育", "线索验证", "线索推进", "商机跟进", "订单交付"]);
    await prisma.entDictItem.create({ data: { kind: "projDemand", name: "自己加的", sort: 5 } });
    const 期望 = [
      ["dict-projDemand-0", "表面触达", true],
      ["dict-projDemand-1", "方向明晰", true],
      ["dict-projDemand-2", "明确需求", true],
      ["dict-projDemand-3", "共识痛点", true],
      ["dict-projDemand-4", "订单交付", false],
      [expect.any(String), "自己加的", true],
    ];
    expect(await 看("projDemand")).toEqual(期望);
    expect(await 看("projDemand")).toEqual(期望);
  });

  it("需求状态老库：管理员改过名的第五项不停用", async () => {
    await 老库("projDemand", ["潜客培育", "线索验证", "线索推进", "商机跟进", "已改名"]);
    expect((await 看("projDemand"))[4]).toEqual(["dict-projDemand-4", "已改名", true]);
  });

  it("产品需求老库：后三项按序号改名，内容定制补在第五项，再补后三项；自己加的排最后；项目上存的旧值不动", async () => {
    await 老库("projProduct", ["常规标品", "内容定制", "部署服务", "运维支持"]);
    await prisma.entDictItem.create({ data: { kind: "projProduct", name: "自己加的", sort: 4 } });
    const 人 = await prisma.user.create({ data: { email: "p-dict", name: "p-dict", title: "", role: "SALES", password: "x" } });
    const 客户 = await prisma.customer.create({ data: { name: "QA-字典客户", phone: "13800001099", salesOwnerId: 人.id } });
    const 项目 = await prisma.project.create({ data: { name: "QA-字典项目", customerId: 客户.id, ownerId: 人.id, creatorId: 人.id, productNeeds: '["部署服务","内容定制"]' } });
    const 期望 = [
      ["dict-projProduct-0", "常规标品", true],
      ["dict-projProduct-1", "硬件标品", true],
      ["dict-projProduct-2", "内容标品", true],
      ["dict-projProduct-3", "硬件定制", true],
      ["dict-projProduct-4", "内容定制", true],
      ["dict-projProduct-5", "软件定制", true],
      ["dict-projProduct-6", "区域规划", true],
      ["dict-projProduct-7", "全案设计", true],
      [expect.any(String), "自己加的", true],
    ];
    expect(await 看("projProduct")).toEqual(期望);
    expect(await 看("projProduct")).toEqual(期望);
    expect(读产品需求((await prisma.project.findUniqueOrThrow({ where: { id: 项目.id } })).productNeeds)).toEqual(["部署服务", "内容定制"]);
  });
});

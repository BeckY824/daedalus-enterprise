/**
 * 企业版只用项目时的首页 AI（10-26 用户：「首页改成对话框吧」「记得把线索，商机，订单都放到项目里，是三大阶段」）。
 *
 *   list_projects：三阶段个数、默认只看进行中、result / 关键词 / 公海；公海里同事客户的项目不露客户名，按客户名也搜不出来
 *   给哪些工具：只用项目时不给 list_leads / list_opportunities / propose_opportunity，也不给合同、订单的老表工具（10-28）；项目模式才有 list_projects
 *   直连：「线索清单」「商机清单」换成 list_projects 的线索 / 商机阶段
 *   确认新线索卡：建客户 + 线索阶段的项目，不写线索表；开了超时回收要填卡上的下一步（和卡上「还差」同一句，10-28）；商机卡、签约卡拦下
 *   开关关：新线索卡照旧写线索表
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "t", role: "ADMIN", title: "" } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { dayjs } from "@/lib/utils";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { TOOLS } from "@/lib/agent/tools";
import { 这一家的工具, 换成项目, 页面说法换成项目 } from "@/lib/agent/run";
import { 认页面 } from "@/lib/ai-context-page";
import { applyProposal } from "@/app/(app)/dashboard/apply";
import { DEFAULT_BUSINESS } from "@/lib/business-config";

type 人 = { id: string; name: string };
let 老板: 人, 经理: 人, 乙: 人, 丙: 人;

async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name };
}
let 序 = 0;
async function 客户(ownerId: string, name = `客户${++序}`) {
  return (await prisma.customer.create({ data: { name, phone: `1390000${String(++序).padStart(4, "0")}`, salesOwnerId: ownerId } })).id;
}
async function 项目(ownerId: string, customerId: string, 补: Record<string, unknown> = {}) {
  return prisma.project.create({ data: { name: `项目${++序}`, customerId, ownerId, creatorId: ownerId, phase: "线索", node: "潜客培育", ...补 } });
}
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name }; };
const 查 = (args: Record<string, unknown>, me: 人) =>
  TOOLS.find((t) => t.name === "list_projects")!.run(args, { userId: me.id, userName: me.name, b: { ...DEFAULT_BUSINESS, projectMode: true }, recordOffset: 0, proposals: [] } as never);
type 行 = { 名称: string; 客户: string; 阶段: string; 结局: string; 负责人: string };
const 列 = (r: { data: unknown }) => (r.data as { 项目: 行[] }).项目;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "ADMIN");
  经理 = await 造人("mkt", "经理", "MANAGER");
  乙 = await 造人("yi", "乙", "SALES");
  丙 = await 造人("bing", "丙", "SALES");
  当(老板);
  await setSetting("business", { projectMode: true });
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("list_projects", () => {
  it("三阶段个数；默认只看进行中；result 看结局；phase 只看一个阶段", async () => {
    const c = await 客户(乙.id, "云帆科技");
    await 项目(乙.id, c);
    await 项目(乙.id, c, { phase: "商机", node: "共识方案", amount: 100000 });
    await 项目(乙.id, c, { phase: "订单", node: "生产备货" });
    await 项目(乙.id, c, { result: "线索流失" });
    await 项目(乙.id, c, { phase: "商机", node: "明确需求", result: "丢单" });

    const r = await 查({}, 老板);
    expect(r.summary).toContain("3 个项目（线索 1、商机 1、订单 1）");
    expect(列(r).every((p) => p.结局 === "进行中" && p.客户 === "云帆科技" && p.负责人 === "乙")).toBe(true);

    expect(列(await 查({ result: "线索流失" }, 老板)).map((p) => p.结局)).toEqual(["线索流失"]);
    expect(列(await 查({ result: "全部" }, 老板))).toHaveLength(5);
    expect(列(await 查({ phase: "商机" }, 老板)).map((p) => p.阶段)).toEqual(["商机"]);
    expect(列(await 查({ keyword: "云帆" }, 老板))).toHaveLength(3);
    expect(列(await 查({ ownerName: "丙" }, 老板))).toHaveLength(0);
  });

  it("公海里同事客户的项目：露项目不露客户名；按客户名搜不出来，总数也不算它", async () => {
    await setSetting(规则.按组织看客户.key, true);
    await prisma.entMember.createMany({ data: [{ userId: 经理.id, bizRole: "sales_mgr" }, { userId: 乙.id, managerId: 经理.id }, { userId: 丙.id, managerId: 经理.id }] });
    invalidateSettingsCache();
    忘掉企业版范围();
    const c = await 客户(丙.id, "海川机械");
    await 项目(丙.id, c);
    await 项目(丙.id, c, { phase: "商机", node: "明确需求", pooledAt: new Date() });

    const r = await 以谁的身份(乙.id, () => 查({ pooled: true }, 乙));
    expect(列(r)).toHaveLength(1);
    expect(列(r)[0].客户).toBe("（公海里同事的客户，看不到名字）");
    expect(列(r)[0].负责人).toBe("在公海");
    expect(JSON.stringify(r)).not.toContain("海川");

    const 搜 = await 以谁的身份(乙.id, () => 查({ keyword: "海川" }, 乙));
    expect(列(搜)).toHaveLength(0);
    expect(搜.summary).toMatch(/^0 个项目/);
  });
});

describe("给哪些工具、直连换成什么", () => {
  const 名 = (b: { projectMode?: boolean }, 只用项目: boolean) => 这一家的工具(b as never, 只用项目).TOOLS.map((t) => t.name);

  it("只用项目：有 list_projects，没有线索表、商机表那几样；新线索卡说的是建项目", () => {
    const n = 名({ projectMode: true }, true);
    expect(n).toContain("list_projects");
    for (const x of ["list_leads", "list_opportunities", "propose_opportunity", "propose_contract", "list_contracts"]) expect(n).not.toContain(x);
    expect(这一家的工具({ projectMode: true }, true).TOOL_MAP.get("propose_lead")!.description).toContain("线索」阶段的项目");
  });

  it("项目模式但不是企业版：两套都在；没开项目模式：没有 list_projects", () => {
    const 团队 = 名({ projectMode: true }, false);
    for (const x of ["list_projects", "list_leads", "list_opportunities", "propose_contract", "list_contracts"]) expect(团队).toContain(x);
    const 关 = 名({ projectMode: false }, false);
    expect(关).not.toContain("list_projects");
    expect(关).toContain("list_leads");
  });

  it("直连：线索清单 / 商机清单换成项目的阶段，关键词跟着走；别的原样", () => {
    expect(换成项目({ name: "list_leads", args: {} })).toEqual({ name: "list_projects", args: { phase: "线索" } });
    expect(换成项目({ name: "list_leads", args: { keyword: "云帆" } })).toEqual({ name: "list_projects", args: { phase: "线索", keyword: "云帆" } });
    expect(换成项目({ name: "list_opportunities", args: { customerName: "云帆" } })).toEqual({ name: "list_projects", args: { phase: "商机", keyword: "云帆" } });
    expect(换成项目({ name: "list_channels", args: {} })).toEqual({ name: "list_channels", args: {} });
  });
});

describe("确认新线索卡", () => {
  const 线索卡 = (补: Record<string, unknown> = {}) => ({
    id: "p1", kind: "add_lead" as const, customerId: "", customerName: "", reason: "测试",
    name: "星河电子", contact: "周经理", phone: "13700001234", source: "展会", status: "待跟进", remark: "要样品", ...补,
  });
  let 展会: string;
  beforeEach(async () => {
    展会 = (await prisma.channel.create({ data: { name: "展会", channelOwnerId: 老板.id } })).id;
  });

  it("只用项目：建客户 + 线索阶段的项目 + 首条跟进，不写线索表", async () => {
    当(乙);
    const r = await applyProposal(线索卡() as never);
    expect(r).toMatchObject({ ok: true });
    expect(await prisma.lead.count()).toBe(0);
    const p = await prisma.project.findFirstOrThrow({ include: { customer: true } });
    expect(p).toMatchObject({ name: "星河电子", phase: "线索", node: "潜客培育", result: null, ownerId: 乙.id });
    expect(p.customer).toMatchObject({ name: "星河电子", salesOwnerId: 乙.id, remark: "要样品", channelId: 展会 });
    expect(await prisma.contact.findFirst({ where: { customerId: p.customerId } })).toMatchObject({ name: "周经理", phone: "13700001234" });
    const 跟进 = await prisma.followUp.findFirstOrThrow({ where: { customerId: p.customerId } });
    expect(跟进.content).toBe("在首页对话里新建的线索，渠道：展会");
    expect(await prisma.entFollowUpMark.findFirstOrThrow({ where: { followUpId: 跟进.id } })).toMatchObject({ phase: "线索", replied: false });
  });

  it("只用项目：来源里只含一个渠道名也认；对不上或停用的不猜，不建", async () => {
    当(乙);
    expect(await applyProposal(线索卡({ source: "展会认识的" }) as never)).toMatchObject({ ok: true });
    await prisma.channel.update({ where: { id: 展会 }, data: { active: false } });
    for (const source of ["展会", "其他"]) {
      expect(await applyProposal(线索卡({ id: `p-${source}`, name: `星河${source}`, phone: "", source }) as never)).toEqual({
        ok: false, error: `卡上的来源「${source}」对不上启用中的渠道：请在卡上重新选来源（渠道）`,
      });
    }
    expect(await prisma.project.count()).toBe(1);
  });

  it("只用项目、开了超时回收：卡上没填下一步不建，说要填；填了就建，下一步时间记在项目上", async () => {
    await setSetting("orgRules", { ...默认组织规则, 超时回收: { 开: true, 节点天数: { 潜客培育: 3 } } });
    invalidateSettingsCache();
    const r = await applyProposal(线索卡() as never);
    expect(r).toEqual({ ok: false, error: "还差下一步时间，填好再确认" });
    expect(await prisma.project.count()).toBe(0);
    expect(await prisma.customer.count()).toBe(0);

    当(乙);
    const 明天 = dayjs().add(1, "day").format("YYYY-MM-DD");
    expect(await applyProposal(线索卡({ id: "p2", nextAt: 明天 }) as never)).toMatchObject({ ok: true });
    const 项目 = await prisma.project.findFirstOrThrow();
    expect(dayjs(项目.nextStepAt).format("YYYY-MM-DD")).toBe(明天);
    expect(await applyProposal(线索卡({ id: "p3", name: "别家", phone: "", nextAt: "不是日期" }) as never)).toEqual({ ok: false, error: "nextAt 解析不了，用 YYYY-MM-DD" });
  });

  it("只用项目：商机卡拦下", async () => {
    const c = await 客户(老板.id, "云帆科技");
    const r = await applyProposal({
      id: "p2", kind: "add_opportunity", customerId: c, customerName: "云帆科技", reason: "测试",
      name: "云帆二期", amount: 100000, stage: "初步沟通", probability: 20, expectedDealAt: "", remark: "",
    } as never);
    expect(r).toEqual({ ok: false, error: "这里商机是项目的一个阶段：请到项目页把它推到商机阶段" });
    expect(await prisma.opportunity.count()).toBe(0);
  });

  it("只用项目：签约卡拦下（10-28 老入口加闸）", async () => {
    const c = await 客户(老板.id, "云帆科技");
    const r = await applyProposal({
      id: "p3", kind: "add_contract", customerId: c, customerName: "云帆科技", reason: "测试",
      amount: 100000, signedAt: "2026-10-28", remark: "",
    } as never);
    expect(r).toEqual({ ok: false, error: "这里成交记在项目上：请到项目页把它推到成交" });
    expect(await prisma.contract.count()).toBe(0);
  });

  it("开关关：照旧写线索表", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const r = await applyProposal(线索卡() as never);
    expect(r).toMatchObject({ ok: true });
    expect(await prisma.lead.count()).toBe(1);
    expect(await prisma.project.count()).toBe(0);
  });
});

describe("页面上下文", () => {
  it("新线索页指路的 list_leads、商机页的 list_opportunities 换成按阶段查项目", () => {
    expect(页面说法换成项目("这一页的数据先用 **list_leads** 查。直接用 list_leads（keyword=那个名字）")).toBe(
      "这一页的数据先用 **list_projects（phase=线索）** 查。直接用 list_projects（phase=线索）（keyword=那个名字）",
    );
    expect(页面说法换成项目("先用 list_opportunities 查")).toBe("先用 list_projects（phase=商机） 查");
  });

  it("项目页指路 list_projects、能按名字查", () => {
    const r = 认页面("/projects", null, null, ["云帆一期"])!;
    expect(r.提示).toContain("**list_projects**");
    expect(r.范围).toMatchObject({ 工具: "list_projects", 参数: "keyword", 名字: ["云帆一期"] });
  });
});

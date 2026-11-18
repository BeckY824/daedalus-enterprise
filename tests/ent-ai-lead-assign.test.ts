/**
 * 首页新线索卡和「新建项目」同一套（11-04 用户：首页录入要和新建项目 / 新建客户一致，含必填项；国家 / 地区放进对应字段，分不清的交给用户判断）。
 *
 *   分配：销售选个人自持 → 创建人 = 负责人 = 自己；市场选暂不分配 → 负责人 = 自己、潜客培育、不标待分配（P-转-03）；
 *         市场选指定分配 → 负责人 = 那位销售、客户跟着走；市场选自动分配 → 按业务线分给那条线的销售
 *   国家 / 城市：卡上勾哪几格填哪几格（客户地址 / 联系人地址 / 项目所在地），不进备注；老卡没勾照旧只进客户
 *   必填：分配方式、指定时的负责人、业务线、进程、进程只能到线索验证（11-05 起不问明确回复）、有国家要选填到哪
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "t", role: "SALES", title: "" } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 自动分配不参与key } from "@/lib/enterprise/lead-assign";
import { 规则 } from "@/lib/enterprise/rules";
import { applyProposal } from "@/app/(app)/dashboard/apply";
import { missingFields } from "@/lib/agent/proposals";
import { 企业版字典 } from "@/lib/project/stage-dict";
import { 建档不能过线索验证 } from "@/lib/project/stage-gates";
import { 区域未填提示 } from "@/lib/enterprise/customer-region";

type 人 = { id: string; name: string };
let 老板: 人, 市场: 人, 乙: 人, 丙: 人;
async function 造人(email: string, name: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role: "SALES", password: "x" } });
  return { id: u.id, name: u.name };
}
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name }; };
let 序 = 0;
const 卡 = (补: Record<string, unknown> = {}) => ({
  id: `p${++序}`, kind: "add_lead" as const, customerId: "", customerName: "", reason: "测试",
  name: `星河电子${序}`, contact: "周经理", phone: `1380000${String(序).padStart(4, "0")}`, source: "展会", status: "待跟进", remark: "",
  业务线: "内贸", 节点: "潜客培育", ...补,
});
/** 没有手机号的卡：联系方式只留一个邮箱（分配方向不按电话判） */
const 没手机 = () => ({ phone: "", 联系方式: [{ kind: "email", value: `m${序}@x.test` }] });
const 唯一项目 = () => prisma.project.findFirstOrThrow({ include: { customer: true } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板");
  市场 = await 造人("mkt", "市场");
  乙 = await 造人("yi", "乙");
  丙 = await 造人("bing", "丙");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 市场.id, bizRole: "marketing_mgr" },
      { userId: 乙.id, bizRole: "sales", line: "内贸" },
      { userId: 丙.id, bizRole: "sales", line: "外贸" },
    ],
  });
  await setSetting("business", { projectMode: true });
  await setSetting(规则.线索分配.key, true);
  // 老板不参与自动分配：内贸只剩乙一个人
  await setSetting(自动分配不参与key, { [老板.id]: "禁止" });
  await prisma.channel.create({ data: { name: "展会", channelOwnerId: 老板.id } });
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("新线索卡：分配方式 × 角色", () => {
  it("销售 + 个人自持：创建人 = 负责人 = 自己，客户也在自己名下", async () => {
    当(乙);
    expect(await applyProposal(卡({ 分配方式: 4 }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.creatorId, p.ownerId, p.customer.salesOwnerId, p.assignMode]).toEqual([乙.id, 乙.id, 乙.id, "个人自持"]);
  });

  it("市场 + 暂不分配：负责人 = 自己、潜客培育、不标待分配（P-转-03）", async () => {
    当(市场);
    expect(await applyProposal(卡({ 分配方式: 3 }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.creatorId, p.ownerId, p.customer.salesOwnerId, p.node, p.assignMode]).toEqual([市场.id, 市场.id, 市场.id, "潜客培育", "暂不分配"]);
    expect(p.awaitAssignAt).toBeNull();
  });

  it("市场 + 指定分配：负责人 = 选的那位销售，客户跟着走，创建人还是自己", async () => {
    当(市场);
    expect(await applyProposal(卡({ 分配方式: 0, ownerId: 丙.id, 业务线: "外贸" }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.creatorId, p.ownerId, p.customer.salesOwnerId, p.assignMode]).toEqual([市场.id, 丙.id, 丙.id, "指定分配"]);
  });

  it("销售 / 总管理指定给别人：负责人 = 选的那位销售，客户留在建的人名下（P-转-03，只有市场首次分给销售才转）", async () => {
    // 11-09 起销售默认不能「指定」（只按建议留个人自持 / 暂不分配）：这里测的是客户归属，先把「指定」开给销售
    await setSetting("enterprise.assign_use", { "dict-assign-0": ["marketing_mgr", "sales_mgr", "sales", "channel_ops", "project_ops"] });
    当(乙);
    expect(await applyProposal(卡({ 分配方式: 0, ownerId: 丙.id, 业务线: "外贸" }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.creatorId, p.ownerId, p.customer.salesOwnerId, p.assignMode]).toEqual([乙.id, 丙.id, 乙.id, "指定分配"]);
    await prisma.followUpProject.deleteMany();
    await prisma.followUp.deleteMany();
    await prisma.projectNodeLog.deleteMany();
    await prisma.project.deleteMany();
    当(老板);
    expect(await applyProposal(卡({ name: "老板录的客户", phone: "13911112222", 分配方式: 0, ownerId: 丙.id, 业务线: "外贸" }) as never)).toMatchObject({ ok: true });
    const q = await 唯一项目();
    expect([q.creatorId, q.ownerId, q.customer.salesOwnerId]).toEqual([老板.id, 丙.id, 老板.id]);
  });

  it("只挂市场管理：指定分配给自己也能建，自己当负责人（客户 11-05 ⑧「市场管理是可以当负责人的」）", async () => {
    当(市场);
    expect(await applyProposal(卡({ 分配方式: 0, ownerId: 市场.id }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.creatorId, p.ownerId, p.customer.salesOwnerId, p.assignMode]).toEqual([市场.id, 市场.id, 市场.id, "指定分配"]);
  });

  it("市场 + 自动分配：按业务线分给那条线的销售（内贸 → 乙），不待分配", async () => {
    当(市场);
    expect(await applyProposal(卡({ 分配方式: 1 }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.creatorId, p.ownerId, p.customer.salesOwnerId, p.assignMode, p.awaitAssignAt]).toEqual([市场.id, 乙.id, 乙.id, "自动分配", null]);
  });

  it("销售不能用的方式（公海捞取）拦下，不建", async () => {
    当(乙);
    const r = await applyProposal(卡({ 分配方式: 2 }) as never);
    expect(r).toMatchObject({ ok: false });
    expect(await prisma.project.count()).toBe(0);
    expect(await prisma.customer.count()).toBe(0);
  });
});

describe("新线索卡：国家 / 城市填到哪", () => {
  it("勾客户：进客户地址，不进联系人、项目，也不进备注", async () => {
    当(乙);
    expect(await applyProposal(卡({ 分配方式: 4, country: "摩洛哥", city: "卡萨布兰卡", 区域去处: ["客户"] }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.customer.addrCountry, p.customer.addrCity, p.addrCountry]).toEqual(["摩洛哥", "卡萨布兰卡", null]);
    expect(p.customer.remark ?? "").not.toContain("摩洛哥");
    expect((await prisma.contact.findFirstOrThrow({ where: { customerId: p.customerId } })).address).toBeNull();
  });

  it("勾联系人 + 项目：联系人地址 = 国家 城市，项目所在地有国家城市，客户地址空着", async () => {
    当(乙);
    expect(await applyProposal(卡({ 分配方式: 4, country: "摩洛哥", city: "卡萨布兰卡", 区域去处: ["联系人", "项目"] }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.addrCountry, p.addrCity, p.customer.addrCountry]).toEqual(["摩洛哥", "卡萨布兰卡", null]);
    expect((await prisma.contact.findFirstOrThrow({ where: { customerId: p.customerId } })).address).toBe("摩洛哥 卡萨布兰卡");
  });
});

/*
  11-18 加急：市场管理在首页对话里写了城市、选自动分配，结果客户 / 项目地址全空、分配记录 line = null、分到外贸。
  原因：卡上只有城市没有国家时，apply 那两格（客户地址 / 项目所在地）不填（怕国外城市被当成国内），城市哪都没落，按区域分配就成了「未知」
*/
describe("新线索卡：市场自动分配按写进地址的区域定线（P-转-26）", () => {
  const 记录线 = async () => (await prisma.entLeadAssign.findFirstOrThrow()).line;

  it("只写了城市（杭州）、勾客户：落进客户地址（国家按国内补「中国」），分给内贸、记录 line = 内贸", async () => {
    当(市场);
    const r = await applyProposal(卡({ 分配方式: 1, city: "杭州", 区域去处: ["客户"] }) as never);
    expect(r).toMatchObject({ ok: true });
    const c = await prisma.customer.findFirstOrThrow();
    expect([c.addrCountry, c.addrCity]).toEqual(["中国", "杭州"]);
    expect((await prisma.project.findFirstOrThrow()).ownerId).toBe(乙.id);
    expect(await 记录线()).toBe("内贸");
  });

  it("只写了城市、勾项目：落进项目所在地，客户地址空，照项目所在地分给内贸", async () => {
    当(市场);
    expect(await applyProposal(卡({ 分配方式: 1, city: "杭州", 区域去处: ["项目"] }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.addrCountry, p.addrCity, p.customer.addrCity]).toEqual(["中国", "杭州", null]);
    expect(p.ownerId).toBe(乙.id);
    expect(await 记录线()).toBe("内贸");
  });

  it("省 + 市：两格都进客户地址", async () => {
    当(市场);
    expect(await applyProposal(卡({ 分配方式: 1, 业务线: undefined, province: "浙江省", city: "杭州", 区域去处: ["客户"] }) as never)).toMatchObject({ ok: true });
    const c = await prisma.customer.findFirstOrThrow();
    expect([c.addrCountry, c.addrProvince, c.addrCity]).toEqual(["中国", "浙江省", "杭州"]);
  });

  it("国外国家 + 城市：分给外贸，卡上业务线写内贸也不认（市场自动分配不看业务线）", async () => {
    当(市场);
    expect(await applyProposal(卡({ 分配方式: 1, 业务线: "内贸", country: "摩洛哥", city: "卡萨布兰卡", 区域去处: ["客户"] }) as never)).toMatchObject({ ok: true });
    expect((await prisma.project.findFirstOrThrow()).ownerId).toBe(丙.id);
    expect(await 记录线()).toBe("外贸");
  });

  it("只写了国外城市（多伦多）没国家：认不出是国内，不落客户地址（免得当成国内），提示补区域", async () => {
    当(市场);
    const r = await applyProposal(卡({ 分配方式: 1, 业务线: undefined, city: "多伦多", 区域去处: ["客户"], ...没手机() }) as never);
    expect(r).toMatchObject({ ok: true });
    expect((await prisma.customer.findFirstOrThrow()).addrCity).toBeNull();
    expect(JSON.stringify(r)).toContain(区域未填提示);
  });

  it("没写区域：分出去了，提示里带「客户没填区域……建议补区域」", async () => {
    当(市场);
    const r = await applyProposal(卡({ 分配方式: 1, 业务线: undefined, ...没手机() }) as never);
    expect(r).toMatchObject({ ok: true });
    expect(JSON.stringify(r)).toContain(区域未填提示);
    expect(await 记录线()).toBeNull();
  });
});

/*
  11-18 用户：市场分配时「分配方向」可改，默认按 区域 → 电话 → 本人事业部（卡上不改就不交，服务端按同一顺序算）
*/
describe("新线索卡：市场自动分配的分配方向", () => {
  const 记录线 = async () => (await prisma.entLeadAssign.findFirstOrThrow()).line;
  it("区域没填、大陆手机号 → 内贸（服务端没收到方向时自己算）", async () => {
    当(市场);
    const r = await applyProposal(卡({ 分配方式: 1, 业务线: undefined }) as never);
    expect(r).toMatchObject({ ok: true });
    expect(JSON.stringify(r)).not.toContain(区域未填提示);
    expect((await prisma.project.findFirstOrThrow()).ownerId).toBe(乙.id);
    expect(await 记录线()).toBe("内贸");
  });
  it("区域没填、国外号码（+1）→ 外贸", async () => {
    当(市场);
    expect(await applyProposal(卡({ 分配方式: 1, 业务线: undefined, phone: "", 联系方式: [{ kind: "phone", value: "+14155550123" }] }) as never)).toMatchObject({ ok: true });
    expect((await prisma.project.findFirstOrThrow()).ownerId).toBe(丙.id);
    expect(await 记录线()).toBe("外贸");
  });
  it("区域、手机都判不出 → 按录入人本人事业部（外贸）", async () => {
    await prisma.entMember.update({ where: { userId: 市场.id }, data: { line: "外贸" } });
    当(市场);
    expect(await applyProposal(卡({ 分配方式: 1, 业务线: undefined, ...没手机() }) as never)).toMatchObject({ ok: true });
    expect(await 记录线()).toBe("外贸");
  });
  it("区域优先于电话：摩洛哥 + 大陆手机号 → 外贸", async () => {
    当(市场);
    expect(await applyProposal(卡({ 分配方式: 1, 业务线: undefined, country: "摩洛哥", 区域去处: ["客户"] }) as never)).toMatchObject({ ok: true });
    expect(await 记录线()).toBe("外贸");
  });
  it("卡上手动改成外贸：杭州客户也按外贸分，项目记外贸", async () => {
    当(市场);
    expect(await applyProposal(卡({ 分配方式: 1, 业务线: undefined, city: "杭州", 区域去处: ["客户"], 分配方向: "外贸" }) as never)).toMatchObject({ ok: true });
    const p = await prisma.project.findFirstOrThrow();
    expect([p.ownerId, p.bizLine]).toEqual([丙.id, "外贸"]);
    expect(await 记录线()).toBe("外贸");
  });
  it("卡上乱填的方向不收（buildProposal 丢掉），按默认", async () => {
    当(市场);
    expect(await applyProposal(卡({ 分配方式: 1, 业务线: undefined, city: "杭州", 区域去处: ["客户"], 分配方向: "随便" }) as never)).toMatchObject({ ok: true });
    expect(await 记录线()).toBe("内贸");
  });
  it("销售（不按区域）交了分配方向也不认：照业务线", async () => {
    当(乙);
    expect(await applyProposal(卡({ 分配方式: 4, 分配方向: "外贸" }) as never)).toMatchObject({ ok: true });
    expect((await prisma.project.findFirstOrThrow()).bizLine).toBe("内贸");
  });
});

// 11-18 同类排查：区县、详细地址、职位、指定回复时间原来卡上 / schema 没有格，说了也落不进库
describe("新线索卡：区县 / 详细地址 / 职位 / 指定回复时间落库", () => {
  it("勾客户：区县、详细地址进客户地址；职位进联系人", async () => {
    当(乙);
    expect(await applyProposal(卡({ 分配方式: 4, country: "中国", province: "浙江省", city: "杭州", district: "西湖区", address: "文三路 1 号", position: "采购经理", 区域去处: ["客户"] }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.customer.addrProvince, p.customer.addrCity, p.customer.addrDistrict, p.customer.addrDetail]).toEqual(["浙江省", "杭州", "西湖区", "文三路 1 号"]);
    expect((await prisma.contact.findFirstOrThrow({ where: { customerId: p.customerId } })).position).toBe("采购经理");
  });
  it("勾项目：详细地址进项目 location；国外的区县按规整地址丢掉", async () => {
    当(乙);
    expect(await applyProposal(卡({ 分配方式: 4, country: "摩洛哥", city: "卡萨布兰卡", district: "某区", address: "Rue 1", 区域去处: ["项目"] }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.addrCountry, p.addrCity, p.addrDistrict, p.location]).toEqual(["摩洛哥", "卡萨布兰卡", null, "Rue 1"]);
  });
  it("只有详细地址（区域认不出）：详细地址照存，四格空", async () => {
    当(乙);
    expect(await applyProposal(卡({ 分配方式: 4, address: "某某大厦 8 楼", 区域去处: ["客户"] }) as never)).toMatchObject({ ok: true });
    const c = await prisma.customer.findFirstOrThrow();
    expect([c.addrCountry, c.addrCity, c.addrDetail]).toEqual([null, null, "某某大厦 8 楼"]);
  });
  it("模型给的指定回复时间（buildProposal 收）落到项目", async () => {
    const { buildProposal } = await import("@/lib/agent/proposals");
    const { DEFAULT_BUSINESS } = await import("@/lib/business-config");
    const r = buildProposal("x", "add_lead", { id: "", name: "" }, { name: "甲公司", reason: "r", 指定回复开始: "2030-01-02 10:00", 指定回复结束: "2030-01-02 12:00", district: "西湖区", position: "老板" }, DEFAULT_BUSINESS);
    expect(r).toMatchObject({ ok: true, proposal: { 指定回复开始: "2030-01-02 10:00", 指定回复结束: "2030-01-02 12:00", district: "西湖区", position: "老板" } });
    当(乙);
    expect(await applyProposal(卡({ 分配方式: 4, 指定回复开始: "2030-01-02 10:00", 指定回复结束: "2030-01-02 12:00" }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.replyStartAt?.toISOString(), p.replyEndAt?.toISOString()]).toEqual(["2030-01-02T02:00:00.000Z", "2030-01-02T04:00:00.000Z"]);
  });
});

describe("新线索卡：和新建项目同一套必填", () => {
  const 企 = { 只用项目: true, 要下一步: false, 企业: { 有分配方式: true, 节点们: 企业版字典.节点们.线索 } };
  const 缺 = (补: Record<string, unknown>) => missingFields(卡({ 分配方式: 4, ...补 }) as never, undefined, 企);

  it("齐了不缺", () => expect(缺({})).toEqual([]));
  // 11-17 员工反馈：联系人姓名不一定知道，改选填；联系方式全空才拦（M-必填-01）
  it("客户名称；联系人姓名选填", () => expect(缺({ name: " ", contact: "" })).toEqual(["客户名称"]));
  it("联系方式全空", () => expect(缺({ phone: "" })).toEqual(["联系方式"]));
  it("分配方式", () => expect(缺({ 分配方式: undefined })).toEqual(["分配方式"]));
  it("指定分配没选负责人", () => expect(缺({ 分配方式: 0 })).toEqual(["项目负责人"]));
  it("业务线、进程（11-05 起不问明确回复）", () => expect(缺({ 业务线: undefined, 节点: "不存在的节点", 明确回复: undefined })).toEqual(["业务线", "当前进程"]));
  it("进程只能到线索验证：过了就拦，老卡带明确回复也不放行（11-05）", () => {
    const 后 = 企业版字典.节点们.线索[企业版字典.节点们.线索.indexOf("线索验证") + 1];
    expect(后).toBeTruthy();
    expect(缺({ 节点: 后 })).toEqual([建档不能过线索验证]);
    expect(缺({ 节点: 后, 明确回复: true })).toEqual([建档不能过线索验证]);
    expect(缺({ 节点: "线索验证" })).toEqual([]);
  });
  it("开了超时回收：下一步时间、下一步计划都要（11-05）", () => {
    const 要 = { ...企, 要下一步: true };
    expect(missingFields(卡({ 分配方式: 4 }) as never, undefined, 要)).toEqual(expect.arrayContaining(["下一步时间", "下一步计划"]));
    expect(missingFields(卡({ 分配方式: 4, nextAt: "2099-01-01", 下一步: "约演示" }) as never, undefined, 要)).toEqual([]);
  });
  it("有国家 / 城市没选填到哪", () => {
    expect(缺({ country: "摩洛哥" })).toEqual(["国家 / 城市填到哪"]);
    expect(缺({ city: "多伦多" })).toEqual(["国家 / 城市填到哪"]);
    expect(缺({ country: "摩洛哥", 区域去处: ["项目"] })).toEqual([]);
  });
  it("没有分配方式可选：不问分配方式，但要选负责人", () => {
    const 无 = { ...企, 企业: { ...企.企业, 有分配方式: false } };
    expect(missingFields(卡() as never, undefined, 无)).toEqual(["项目负责人"]);
    expect(missingFields(卡({ ownerId: "u" }) as never, undefined, 无)).toEqual([]);
  });
  it("确认时服务端也拦：缺分配方式不建", async () => {
    当(乙);
    expect(await applyProposal(卡() as never)).toMatchObject({ ok: false });
    expect(await prisma.project.count()).toBe(0);
  });
});

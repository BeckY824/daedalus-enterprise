/**
 * 企业版导入 · 正式写入：试跑出 preview 批次 → 写一批。
 * 新建五类、撞了已有客户的号整条跳过（M-导入-29）、本批同号并入、重跑不重复、三方比对 / 冲突、本地已删、结单日期、负责人退回、分段续写。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 试跑, 重新试跑 } from "@/lib/enterprise-import/report";
import { 写一批 as 只写一批, 定这批业务线 } from "@/lib/enterprise-import/apply";
import { 撤回一批 } from "@/lib/enterprise-import/revert";
import { 无主入池理由 } from "@/lib/enterprise-import/project-target";
import { 公海标签, 无负责人占位名, 无负责人占位邮箱 } from "@/lib/pool";
import { 公海无负责人 } from "@/lib/project/pool-owner";
import { 入池原因文字, 客户入池类 } from "@/lib/enterprise/unified-pool";
import type { 读出的表 } from "@/lib/enterprise-import/excel";
import type { 实体, 待写 } from "@/lib/enterprise-import/types";

// 11-02 起企业版正式导入前必选业务线：老用例一律先定外贸
const 写一批: typeof 只写一批 = async (id, ...r) => {
  await 定这批业务线(id, "外贸");
  return 只写一批(id, ...r);
};

function 表(名: string, 实体: 实体, 表头: string[], 行: string[][]): 读出的表 {
  return { 名, 实体, 表头, 行, 行号: 行.map((_, i) => i + 2), 提醒: [] };
}

const 客户头 = ["记录ID", "客户名称", "手机号码", "客户负责人", "客户等级", "备注"];
const 客户表 = (行: string[][] = [
  ["C1", "杭州云帆科技有限公司", "13800000001", "张伟", "A", "老客户"],
  ["C2", "宁波海川贸易", "13800000002", "李娜", "B", ""],
]) => 表("客户.xlsx", "customer", 客户头, 行);

const 联系人表 = () => 表("联系人.xlsx", "contact", ["联系人ID", "客户ID", "姓名", "职位", "手机"], [["P1", "C1", "王经理", "采购", "13700000001"]]);
const 线索表 = () => 表("线索.xlsx", "lead", ["线索ID", "线索名称", "联系人", "电话", "负责人"], [["L1", "温州小厂", "陈总", "13600000001", "李娜"]]);
const 商机表 = (行: string[][] = [
  ["O1", "C1", "服务器采购", "需求确认", "12万", ""],
  ["O2", "C2", "外贸样品", "赢单", "3万", "2025-03-05"],
]) => 表("商机.xlsx", "opportunity", ["商机ID", "客户ID", "商机名称", "商机阶段", "商机金额", "成交日期"], 行);
const 跟进表 = () =>
  表("跟进记录.xlsx", "followup", ["跟进ID", "客户ID", "商机ID", "跟进方式", "跟进内容", "跟进时间"], [
    ["F1", "C1", "O1", "电话", "聊了报价", "2025-06-01 10:00"],
    ["F2", "C1", "", "拜访", "上门看样", "2025-07-01 15:00"],
    ["F3", "C2", "", "电话", "回访", "2025-05-01 09:00"],
  ]);

/** 表里只写日期 = 本地那天零点 */
const 本地日 = (d: string) => new Date(`${d}T00:00:00`);

const 我 = { id: "tester-id", name: "测试员" };
let 张伟 = "";
let 李娜 = "";

async function 跑(表们: 读出的表[]) {
  const { 批次Id } = await 试跑({ 来源: "excel", 用户Id: 我.id, 表: 表们, 建议器: null });
  return 批次Id;
}
async function 导(表们: 读出的表[]) {
  const id = await 跑(表们);
  return { id, r: await 写一批(id, 我) };
}
/** 11-02 起没人指定就没有默认负责人：要落默认的用例在对照表上指定一个 */
async function 导带默认(表们: 读出的表[], 默认负责人Id: string) {
  const id = await 跑(表们);
  await 重新试跑(id, { 默认负责人Id }, 我.id);
  return { id, r: await 写一批(id, 我) };
}
const 对照 = (entity: string, externalId: string) =>
  prisma.entExternalRef.findUniqueOrThrow({ where: { source_entity_externalId: { source: "excel", entity, externalId } } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  await prisma.user.create({ data: { id: 我.id, email: "t@x", name: 我.name, title: "管理员", role: "ADMIN", password: "x" } });
  张伟 = (await prisma.user.create({ data: { email: "zw@x", name: "张伟", title: "销售", role: "SALES", password: "x" } })).id;
  李娜 = (await prisma.user.create({ data: { email: "ln@x", name: "李娜", title: "销售", role: "SALES", password: "x" } })).id;
  // 11-03 起企业版负责人只认业务角色（D3-9）：两个销售设上，企业版的用例才能落到他们名下
  await prisma.entMember.createMany({ data: [{ userId: 张伟, bizRole: "sales" }, { userId: 李娜, bizRole: "sales" }] });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("首次导入", () => {
  it("五类都写进去，挂对父记录、负责人；批次 done、记操作日志", async () => {
    const { id, r } = await 导带默认([客户表(), 联系人表(), 线索表(), 商机表(), 跟进表()], 张伟);
    expect(r).toMatchObject({ 状态: "done", 完了: true, 总数: 9, 写到: 9, 新建: 9, 更新: 0, 冲突: 0, 失败: 0 });

    const c1 = await prisma.customer.findFirstOrThrow({ where: { name: "杭州云帆科技有限公司" }, include: { extra: true } });
    expect(c1).toMatchObject({ phone: "13800000001", salesOwnerId: 张伟, remark: "老客户" });
    expect(c1.extra?.level).toBe("A");
    // 最近跟进 = 原系统最新那条，不是导入这一天
    expect(c1.lastFollowAt).toEqual(new Date("2025-07-01T15:00:00"));

    const p1 = await prisma.contact.findFirstOrThrow({ where: { name: "王经理" } });
    expect(p1).toMatchObject({ customerId: c1.id, position: "采购", phone: "13700000001" });
    expect(await prisma.lead.findFirstOrThrow({ where: { name: "温州小厂" } })).toMatchObject({ ownerId: 李娜, contact: "陈总" });

    const o1 = await prisma.opportunity.findFirstOrThrow({ where: { name: "服务器采购" }, include: { closed: true } });
    expect(o1).toMatchObject({ customerId: c1.id, amount: 120000, status: "OPEN", ownerId: 张伟 });
    expect(o1.closed).toBeNull();
    const o2 = await prisma.opportunity.findFirstOrThrow({ where: { name: "外贸样品" }, include: { closed: true } });
    expect(o2).toMatchObject({ status: "WON", stage: "赢单成交" });
    expect(o2.closed?.closedAt).toEqual(本地日("2025-03-05"));

    const f1 = await prisma.followUp.findFirstOrThrow({ where: { content: "聊了报价" } });
    expect(f1).toMatchObject({ customerId: c1.id, opportunityId: o1.id, ownerId: 张伟 });
    expect(f1.occurredAt.toISOString()).toBe(new Date("2025-06-01T10:00:00").toISOString());

    expect(await prisma.entExternalRef.count()).toBe(9);
    expect(await prisma.entImportRow.count({ where: { batchId: id, kind: "create" } })).toBe(9);
    const 批 = await prisma.entImportBatch.findUniqueOrThrow({ where: { id } });
    expect(批.finishedAt).not.toBeNull();
    const 日志 = await prisma.auditLog.findFirstOrThrow({ where: { entityId: id } });
    expect(日志).toMatchObject({ action: "ent-import", entity: "EntImportBatch" });
    expect(日志.summary).toContain("新建 9 条");
  });

  it("写完再调一次不重复写；同一批同时跑两份也只写一份", async () => {
    const id = await 跑([客户表(), 商机表(), 跟进表()]);
    const [a, b] = await Promise.all([写一批(id, 我), 写一批(id, 我)]);
    expect(a.完了 || b.完了).toBe(true);
    const 再 = await 写一批(id, 我);
    expect(再).toMatchObject({ 完了: true, 新建: 7, 失败: 0 });
    expect(await prisma.customer.count()).toBe(2);
    expect(await prisma.opportunity.count()).toBe(2);
    expect(await prisma.followUp.count()).toBe(3);
    expect(await prisma.entExternalRef.count()).toBe(7);
  });

  it("分段：每趟时间到就停，记下游标，再调接着写", async () => {
    const 行 = Array.from({ length: 60 }, (_, i) => [`C${i}`, `公司${i}`, `1380000${String(i).padStart(4, "0")}`, "张伟", "", ""]);
    const id = await 跑([客户表(行)]);
    const 一 = await 写一批(id, 我, { 段长毫秒: 0 });
    // 段长 0：也至少写一趟（25 条）
    expect(一).toMatchObject({ 状态: "applying", 完了: false, 写到: 25, 新建: 25 });
    let r = 一;
    let 趟 = 0;
    while (!r.完了 && 趟++ < 10) r = await 写一批(id, 我, { 段长毫秒: 0 });
    expect(趟).toBe(2);
    expect(r).toMatchObject({ 完了: true, 写到: 60, 新建: 60 });
    expect(await prisma.customer.count()).toBe(60);
  });

  it("负责人不在职 / 是管理员：退回默认负责人；离职的人上次是负责人也不用", async () => {
    await prisma.user.update({ where: { id: 李娜 }, data: { active: false } });
    await 导带默认([客户表()], 张伟);
    const c2 = await prisma.customer.findFirstOrThrow({ where: { name: "宁波海川贸易" } });
    expect(c2.salesOwnerId).not.toBe(李娜);
    expect([张伟]).toContain(c2.salesOwnerId);
  });

  it("所属客户不在了：这一条记成没写进去，别的照写", async () => {
    const id = await 跑([客户表(), 联系人表()]);
    const 批 = await prisma.entImportBatch.findUniqueOrThrow({ where: { id } });
    const 计划: 待写[] = JSON.parse(批.plan!);
    const p = 计划.find((w) => w.实体 === "contact")!;
    p.父客户 = { 本地ID: "不存在的客户" };
    await prisma.entImportBatch.update({ where: { id }, data: { plan: JSON.stringify(计划) } });

    const r = await 写一批(id, 我);
    expect(r).toMatchObject({ 完了: true, 新建: 2, 失败: 1 });
    expect(await prisma.contact.count()).toBe(0);
    const note = JSON.parse((await prisma.entImportBatch.findUniqueOrThrow({ where: { id } })).note!);
    expect(note).toEqual([expect.objectContaining({ 实体: "contact", 外部ID: p.外部ID, 原因: expect.stringContaining("所属客户不在了") })]);
  });
});

describe("没指定默认负责人（11-02：不自动挑人，进公海）", () => {
  const 占位 = () => prisma.user.findUnique({ where: { email: 无负责人占位邮箱 } });
  const 无主客户表 = (行: string[][] = [
    ["C1", "示例空着", "13800006001", "", "", ""],
    ["C2", "示例对不上", "13800006002", "查无此人", "", ""],
    ["C3", "示例写对", "13800006003", "张伟", "", ""],
  ]) => 表("客户.xlsx", "customer", 客户头, 行);
  const 无主商机表 = () => 表("商机.xlsx", "opportunity", ["商机ID", "客户ID", "商机名称", "商机阶段"], [["O1", "C3", "示例商机", "需求确认"]]);
  const 无主线索表 = () => 表("线索.xlsx", "lead", ["线索ID", "线索名称", "联系人", "电话", "负责人"], [["L1", "示例线索", "陈总", "13600006001", ""]]);

  it("报告默认是空的；空着、对不上的客户挂占位账号并进公海，写对的不动；清单里列出；占位账号只建一个、不能登录", async () => {
    const 试 = await 试跑({ 来源: "excel", 用户Id: 我.id, 表: [无主客户表()], 建议器: null });
    expect(试.报告.映射.默认负责人.id).toBe("");
    expect(试.报告.问题.filter((q) => q.类别 === "负责人空着" || q.类别 === "负责人对不上").map((q) => [q.外部ID, q.类别])).toEqual([
      ["C1", "负责人空着"], ["C2", "负责人对不上"],
    ]);
    for (const q of 试.报告.问题.filter((x) => x.类别.startsWith("负责人"))) expect(q.说明).toMatch(/进公海/);
    expect(await 占位(), "预演写完回滚，不留占位账号").toBeNull();
    expect(试.报告.预演?.合计).toMatchObject({ 新建: 3, 失败: 0 });

    const r = await 写一批(试.批次Id, 我);
    expect(r).toMatchObject({ 新建: 3, 失败: 0 });
    const 号 = (await 占位())!;
    expect(号).toMatchObject({ name: 无负责人占位名, active: false });
    const 甲 = await prisma.customer.findFirstOrThrow({ where: { name: "示例空着" }, include: { pool: true } });
    const 乙 = await prisma.customer.findFirstOrThrow({ where: { name: "示例对不上" }, include: { pool: true } });
    const 丙 = await prisma.customer.findFirstOrThrow({ where: { name: "示例写对" }, include: { pool: true } });
    expect([甲.salesOwnerId, 乙.salesOwnerId, 丙.salesOwnerId]).toEqual([号.id, 号.id, 张伟]);
    expect(甲.pool).toMatchObject({ reason: 无主入池理由, userId: 号.id });
    expect(乙.pool).not.toBeNull();
    expect(丙.pool).toBeNull();
    // 真人（导入的人、别的业务员）名下没多东西
    expect(await prisma.customer.count({ where: { salesOwnerId: { in: [我.id, 李娜] } } })).toBe(0);
    expect(await prisma.user.count({ where: { email: 无负责人占位邮箱 } })).toBe(1);
    // 入池原因说清楚；挂占位账号的「原负责人」不露名字
    expect(入池原因文字(客户入池类(甲.pool!), 甲.pool!.reason)).toBe("导入时没有负责人");
    expect(公海标签(号.name)).toBe("公海");
  });

  it("再导一遍原样：零更新零冲突，占位账号还是一个；没默认时不会把人从公海拉出来", async () => {
    const 首 = await 导([无主客户表()]);
    const { r } = await 导([无主客户表()]);
    expect(r).toMatchObject({ 新建: 0, 更新: 0, 冲突: 0, 失败: 0 });
    expect(首.r.失败).toBe(0);
    expect(await prisma.user.count({ where: { email: 无负责人占位邮箱 } })).toBe(1);
    expect(await prisma.customerPool.count()).toBe(2);
  });

  it("已有同号客户：负责人不动，也不进公海", async () => {
    const 已有 = await prisma.customer.create({ data: { name: "早就有", phone: "13800006001", salesOwnerId: 李娜 } });
    await 导([无主客户表([["C1", "示例空着", "13800006001", "", "", ""]])]);
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: 已有.id }, include: { pool: true } });
    expect(c.salesOwnerId).toBe(李娜);
    expect(c.pool).toBeNull();
  });

  it("后来指定了默认负责人再导：落到默认、出公海；撤回这次更新：回占位、回公海", async () => {
    await 导([无主客户表()]);
    const 二 = await 导带默认([无主客户表()], 李娜);
    expect(二.r.冲突).toBe(0);
    const 读 = (name: string) => prisma.customer.findFirstOrThrow({ where: { name }, include: { pool: true } });
    expect(await 读("示例空着")).toMatchObject({ salesOwnerId: 李娜, pool: null });
    expect(await 读("示例对不上")).toMatchObject({ salesOwnerId: 李娜, pool: null });
    expect(await 读("示例写对")).toMatchObject({ salesOwnerId: 张伟, pool: null });

    await 撤回一批(二.id, 我);
    const 号 = (await 占位())!;
    const 回 = await 读("示例空着");
    expect(回.salesOwnerId).toBe(号.id);
    expect(回.pool).toMatchObject({ reason: 无主入池理由 });
  });

  it("人工改过负责人的（领走了）：再导没默认，不动；不回公海", async () => {
    await 导([无主客户表()]);
    const 甲 = await prisma.customer.findFirstOrThrow({ where: { name: "示例空着" } });
    await prisma.customer.update({ where: { id: 甲.id }, data: { salesOwnerId: 李娜 } });
    await prisma.customerPool.delete({ where: { customerId: 甲.id } });
    const { r } = await 导([无主客户表()]);
    expect(r).toMatchObject({ 冲突: 0, 失败: 0 });
    const 后 = await prisma.customer.findUniqueOrThrow({ where: { id: 甲.id }, include: { pool: true } });
    expect(后.salesOwnerId).toBe(李娜);
    expect(后.pool).toBeNull();
  });

  it("老模式（没开企业版）：跟进、商机、线索没负责人也不落真人（商机、跟进挂占位，线索空着）", async () => {
    const 跟进 = 表("跟进记录.xlsx", "followup", ["跟进ID", "客户ID", "跟进方式", "跟进内容", "跟进时间"], [["F1", "C3", "电话", "聊了", "2025-06-01 10:00"]]);
    const { r } = await 导([无主客户表(), 无主线索表(), 无主商机表(), 跟进]);
    expect(r.失败).toBe(0);
    const 号 = (await 占位())!;
    expect((await prisma.followUp.findFirstOrThrow()).ownerId).toBe(号.id);
    expect((await prisma.opportunity.findFirstOrThrow()).ownerId).toBe(号.id);
    expect((await prisma.lead.findFirstOrThrow()).ownerId).toBeNull();
  });

  describe("企业版项目模式", () => {
    beforeEach(() => void vi.stubEnv("CRM_ENTERPRISE", "1"));
    afterEach(() => void vi.unstubAllEnvs());

    it("商机行：项目进公海（ownerId 空、有进公海留痕），撤回能撤；再导不算动过", async () => {
      const { id, r } = await 导([无主客户表(), 无主商机表()]);
      expect(r.失败).toBe(0);
      const p = await prisma.project.findFirstOrThrow({ where: { name: "示例商机" }, include: { logs: true } });
      expect(p.ownerId).toBe(公海无负责人);
      expect(p.pooledAt).not.toBeNull();
      expect(p.creatorId).toBe(我.id);
      expect(p.logs.filter((l) => l.kind === "pool-release").map((l) => l.reason)).toEqual([无主入池理由]);

      const 再 = await 导([无主客户表(), 无主商机表()]);
      expect(再.r).toMatchObject({ 新建: 0, 更新: 0, 冲突: 0, 失败: 0 });
      await 撤回一批(再.id, 我);
      await 撤回一批(id, 我);
      expect(await prisma.project.count()).toBe(0);
    });

    it("后来指定默认负责人再导：商机项目落到默认、出公海", async () => {
      await 导([无主客户表(), 无主商机表()]);
      await 导带默认([无主客户表(), 无主商机表()], 李娜);
      const p = await prisma.project.findFirstOrThrow({ where: { name: "示例商机" } });
      expect(p.ownerId).toBe(李娜);
      expect(p.pooledAt).toBeNull();
    });

    it("线索行：新建的客户挂占位进公海，项目进公海", async () => {
      const { r } = await 导([无主线索表()]);
      expect(r.失败).toBe(0);
      const 号 = (await 占位())!;
      const p = await prisma.project.findFirstOrThrow({ include: { customer: { include: { pool: true } } } });
      expect(p.ownerId).toBe(公海无负责人);
      expect(p.pooledAt).not.toBeNull();
      expect(p.customer.salesOwnerId).toBe(号.id);
      expect(p.customer.pool).toMatchObject({ reason: 无主入池理由 });
    });
  });
});

describe("企业版客户类型（10-30 暂不确认）", () => {
  const 类型表 = (行: string[][]) => 表("客户.xlsx", "customer", ["记录ID", "客户名称", "手机号码", "客户负责人", "客户类型"], 行);

  it("空着 / 意向客户落暂不确认、意向客户补 B 级；我们这边定了类型的，原系统还是暂不确认不算冲突不覆盖；原系统给了真类型照三方比对改", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    try {
      await 导([类型表([["C1", "示例甲", "13800005001", "张伟", "意向客户"], ["C2", "示例乙", "13800005002", "张伟", ""]])]);
      const 甲 = await prisma.customer.findFirstOrThrow({ where: { name: "示例甲" }, include: { extra: true } });
      const 乙 = await prisma.customer.findFirstOrThrow({ where: { name: "示例乙" }, include: { extra: true } });
      expect([甲.customerType, 乙.customerType]).toEqual(["暂不确认", "暂不确认"]);
      expect([甲.extra?.level ?? null, 乙.extra?.level ?? null]).toEqual(["B", null]);

      // 改版前导过的（对照里记的是没落类型），之后我们这边定了类型：再同步原系统还是空着 → 不冲突、不动
      const ref = await 对照("customer", "C1");
      await prisma.entExternalRef.update({ where: { id: ref.id }, data: { written: JSON.stringify({ ...JSON.parse(ref.written), customerType: null }) } });
      await prisma.customer.update({ where: { id: 甲.id }, data: { customerType: "个人买家" } });
      const { r } = await 导([类型表([["C1", "示例甲", "13800005001", "张伟", ""], ["C2", "示例乙", "13800005002", "张伟", "贸易商"]])]);
      expect(r.冲突).toBe(0);
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: 甲.id } })).customerType).toBe("个人买家");
      expect(JSON.parse((await 对照("customer", "C1")).written).customerType).toBe("暂不确认");
      // 乙我们没动过：原系统改成贸易商 → 照改成中间贸易商
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: 乙.id } })).customerType).toBe("中间贸易商");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("同号", () => {
  it("我们这边早有同号客户：这一条整条跳过，不连上、不补空，老客户一格不动（M-导入-29）", async () => {
    const 老 = await prisma.customer.create({ data: { name: "云帆（老档）", phone: "13800000001", salesOwnerId: 李娜, followStatus: "跟进中" } });
    const { r } = await 导([客户表()]);
    expect(r).toMatchObject({ 新建: 1, 更新: 0, 失败: 0 });
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: 老.id }, include: { extra: true } });
    expect(c).toMatchObject({ name: "云帆（老档）", salesOwnerId: 李娜, followStatus: "跟进中", remark: null });
    expect(c.extra?.level ?? null).toBeNull();
    expect(await prisma.entExternalRef.count({ where: { entity: "customer", externalId: "C1" } })).toBe(0);
    expect(await prisma.customer.count()).toBe(2);
  });

  it("同一批里两条同号：后一条并进前一条，子记录挂得上", async () => {
    const { r } = await 导([
      客户表([
        ["C1", "杭州云帆科技有限公司", "13800000001", "张伟", "A", ""],
        ["C9", "杭州云帆科技", "13800000001", "张伟", "", ""],
      ]),
      表("联系人.xlsx", "contact", ["联系人ID", "客户ID", "姓名"], [["P9", "C9", "赵工"]]),
    ]);
    expect(r).toMatchObject({ 新建: 2, 失败: 0 });
    expect(await prisma.customer.count()).toBe(1);
    const c = await prisma.customer.findFirstOrThrow();
    expect((await 对照("customer", "C9")).targetId).toBe(c.id);
    expect((await prisma.contact.findFirstOrThrow()).customerId).toBe(c.id);
  });
});

describe("再导一次（同步）", () => {
  it("原系统没变：全跳过", async () => {
    await 导([客户表(), 商机表()]);
    const { r } = await 导([客户表(), 商机表()]);
    expect(r).toMatchObject({ 新建: 0, 更新: 0, 冲突: 0, 跳过: 4 });
  });

  it("三方比对：我们没动的格子照原系统改，两边都改了记冲突、不覆盖", async () => {
    await 导([客户表()]);
    const c1 = await prisma.customer.findFirstOrThrow({ where: { name: "杭州云帆科技有限公司" } });
    // 我们这边改了备注
    await prisma.customer.update({ where: { id: c1.id }, data: { remark: "我们改的备注" } });

    const { id, r } = await 导([
      客户表([
        ["C1", "杭州云帆科技有限公司", "13800000011", "张伟", "A", "原系统改的备注"],
        ["C2", "宁波海川贸易", "13800000002", "李娜", "B", ""],
      ]),
    ]);
    expect(r).toMatchObject({ 冲突: 1, 跳过: 1 });
    const 现 = await prisma.customer.findUniqueOrThrow({ where: { id: c1.id } });
    expect(现).toMatchObject({ phone: "13800000011", remark: "我们改的备注" });

    const 冲 = await prisma.entConflict.findFirstOrThrow();
    expect(冲).toMatchObject({ source: "excel", entity: "customer", externalId: "C1", targetId: c1.id, status: "待定", localDeleted: false, batchId: id });
    expect(JSON.parse(冲.fields)).toEqual({ remark: { 原系统: "原系统改的备注", 我们: "我们改的备注", 上次: "老客户" } });
    // 对照里手机号已经是新的，备注还是上次的（等人定）
    const ref = JSON.parse((await 对照("customer", "C1")).written);
    expect(ref).toMatchObject({ phone: "13800000011", remark: "老客户" });
    // 撤回要用：改之前的值
    const 行 = await prisma.entImportRow.findFirstOrThrow({ where: { batchId: id, externalId: "C1" } });
    expect(JSON.parse(行.before!)).toEqual({ phone: "13800000001" });
    expect(JSON.parse(行.written)).toEqual({ phone: "13800000011" });
    expect(行.refBefore).not.toBeNull();

    // 再来一次同样的：冲突不越记越多
    await 导([
      客户表([
        ["C1", "杭州云帆科技有限公司", "13800000011", "张伟", "A", "原系统又改了"],
        ["C2", "宁波海川贸易", "13800000002", "李娜", "B", ""],
      ]),
    ]);
    expect(await prisma.entConflict.count()).toBe(1);
    expect(JSON.parse((await prisma.entConflict.findFirstOrThrow()).fields).remark.原系统).toBe("原系统又改了");
  });

  it("两边改成一样的：不算冲突", async () => {
    await 导([客户表()]);
    await prisma.customer.updateMany({ where: { name: "宁波海川贸易" }, data: { remark: "一样的" } });
    const { r } = await 导([
      客户表([
        ["C1", "杭州云帆科技有限公司", "13800000001", "张伟", "A", "老客户"],
        ["C2", "宁波海川贸易", "13800000002", "李娜", "B", "一样的"],
      ]),
    ]);
    expect(r.冲突).toBe(0);
    expect(JSON.parse((await 对照("customer", "C2")).written).remark).toBe("一样的");
  });

  it("我们这边已经删了：记冲突（本地已删），不重建", async () => {
    await 导([客户表()]);
    await prisma.customer.deleteMany({ where: { name: "宁波海川贸易" } });
    const { r } = await 导([
      客户表([
        ["C1", "杭州云帆科技有限公司", "13800000001", "张伟", "A", "老客户"],
        ["C2", "宁波海川贸易", "13800000002", "李娜", "B", "改了"],
      ]),
    ]);
    expect(r).toMatchObject({ 冲突: 1, 新建: 0 });
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.entConflict.findFirstOrThrow()).toMatchObject({ externalId: "C2", localDeleted: true });
  });

  it("商机原系统改成赢单：带上结单日期；改回进行中：结单记录删掉", async () => {
    await 导([客户表(), 商机表()]);
    await 导([客户表(), 商机表([
      ["O1", "C1", "服务器采购", "赢单", "12万", "2025-08-08"],
      ["O2", "C2", "外贸样品", "赢单", "3万", "2025-03-05"],
    ])]);
    const o1 = await prisma.opportunity.findFirstOrThrow({ where: { name: "服务器采购" }, include: { closed: true } });
    expect(o1.status).toBe("WON");
    expect(o1.closed?.closedAt).toEqual(本地日("2025-08-08"));

    await 导([客户表(), 商机表([
      ["O1", "C1", "服务器采购", "需求确认", "12万", ""],
      ["O2", "C2", "外贸样品", "赢单", "3万", "2025-03-05"],
    ])]);
    const 又 = await prisma.opportunity.findFirstOrThrow({ where: { name: "服务器采购" }, include: { closed: true } });
    expect(又.status).toBe("OPEN");
    expect(又.closed).toBeNull();
  });
});

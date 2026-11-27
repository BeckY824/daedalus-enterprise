/**
 * 合并客户第二批 2a · 项目合并之后原系统再同步那条老商机（2a 审查必改 2）：
 *   合并把被并项目的老商机对照（EntExternalRef entity=opportunity）改指到留下的项目；再同步时三方比对会把留下项目的值当「我们没动过」覆盖。
 *   改法：被没撤回的项目合并单改指过的对照，整条记冲突、一格不写，冲突里写清「已随项目合并并入 X，请人工核」；撤回合并后照常比对。
 *   企业版销帮帮导出是最终数据、目前不再重导，这里防的是将来接上同步。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 试跑, 重新试跑 } from "@/lib/enterprise-import/report";
import { 写一批, 定这批业务线 } from "@/lib/enterprise-import/apply";
import { 列冲突, 定冲突 } from "@/lib/enterprise-import/resolve";
import type { 读出的表 } from "@/lib/enterprise-import/excel";
import { 执行项目合并, 撤回项目合并 } from "@/lib/enterprise/project-merge";

const 我 = { id: "tester-id", name: "测试员" };
let 张伟: { id: string; name: string; role: string };
let 李娜Id: string;

const 表 = (名: string, 实体: 读出的表["实体"], 表头: string[], 行: string[][]): 读出的表 => ({ 名, 实体, 表头, 行, 行号: 行.map((_, i) => i + 2), 提醒: [] });
const 客户表 = () =>
  表("客户.xlsx", "customer", ["记录ID", "客户名称", "手机号码", "客户负责人"], [
    ["C1", "测试甲公司", "13800000001", "张伟"],
    ["C2", "测试乙公司", "13800000002", "张伟"],
  ]);
/** O2 这一行可换：阶段、负责人、客户 */
const 商机表 = (o2: { 客户?: string; 阶段?: string; 负责人?: string } = {}) =>
  表("商机.xlsx", "opportunity", ["商机ID", "客户ID", "商机名称", "商机阶段", "商机负责人"], [
    ["O1", "C1", "留下的线索", "潜客培育", "张伟"],
    ["O2", o2.客户 ?? "C1", "被并的线索", o2.阶段 ?? "潜客培育", o2.负责人 ?? "张伟"],
  ]);

async function 导(表们: 读出的表[]) {
  const { 批次Id } = await 试跑({ 来源: "excel", 用户Id: 我.id, 表: 表们, 建议器: null });
  await 重新试跑(批次Id, { 默认负责人Id: 张伟.id }, 我.id);
  await 定这批业务线(批次Id, "外贸");
  const r = await 写一批(批次Id, 我);
  expect(r.完了).toBe(true);
  return 批次Id;
}
const 项 = (name: string) => prisma.project.findFirstOrThrow({ where: { name } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await prisma.user.create({ data: { id: 我.id, email: "t@x", name: 我.name, title: "管理员", role: "ADMIN", password: "x" } });
  const u = await prisma.user.create({ data: { email: "zw@x", name: "张伟", title: "销售", role: "SALES", password: "x" } });
  张伟 = { id: u.id, name: u.name, role: u.role };
  李娜Id = (await prisma.user.create({ data: { email: "ln@x", name: "李娜", title: "销售", role: "SALES", password: "x" } })).id;
  await prisma.entMember.createMany({ data: [{ userId: 我.id, bizRole: "director" }, { userId: 张伟.id, bizRole: "sales" }, { userId: 李娜Id, bizRole: "sales" }] });
});

afterAll(async () => {
  await 等通知推完();
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

describe("项目合并之后再同步被并项目的老商机", () => {
  it("改了阶段 / 负责人 / 客户：整条记冲突、留下的项目一格不动，说明写清；去定按过时、说同一句；撤回合并后再同步照常写到被并的项目", async () => {
    await 导([客户表(), 商机表()]);
    const a = await 项("留下的线索");
    const b = await 项("被并的线索");
    const ref = await prisma.entExternalRef.findFirstOrThrow({ where: { entity: "opportunity", externalId: "O2" } });
    expect(ref.targetId).toBe(b.id);

    const r = await 执行项目合并(prisma, a.id, b.id, 张伟, { 已核未开票: true });
    if (!r.ok) throw new Error(r.error);
    expect((await prisma.entExternalRef.findUniqueOrThrow({ where: { id: ref.id } })).targetId).toBe(a.id);
    const A前 = await 项("留下的线索");

    // 原系统再同步 O2：阶段流失、换给李娜、换到乙公司
    await 导([客户表(), 商机表({ 客户: "C2", 阶段: "流失", 负责人: "李娜" })]);
    const A后 = await 项("留下的线索");
    expect({ result: A后.result, ownerId: A后.ownerId, customerId: A后.customerId, name: A后.name, node: A后.node })
      .toEqual({ result: A前.result, ownerId: A前.ownerId, customerId: A前.customerId, name: A前.name, node: A前.node });
    expect(A后.ownerId).toBe(张伟.id);
    const 冲 = await 列冲突();
    expect(冲.总数).toBe(1);
    expect(冲.条目[0]).toMatchObject({ 实体: "opportunity", 外部ID: "O2", 说明: expect.stringContaining("已随项目合并并入「留下的线索」") });
    expect(冲.条目[0].说明).toContain("请人工核");
    expect(Object.keys(冲.条目[0].字段)).toEqual(expect.arrayContaining(["ownerId", "customerId"]));
    expect(冲.条目[0].字段).not.toHaveProperty("_说明");
    // 对照行不动（撤回后照常比对）
    expect(await prisma.entExternalRef.findUniqueOrThrow({ where: { id: ref.id } })).toMatchObject({ targetId: a.id, fingerprint: ref.fingerprint });

    // 去定（采用原系统）：不写，按过时处理，说同一句
    const 定 = await 定冲突([冲.条目[0].id], "采用原系统", 我);
    expect(定.没定).toEqual([expect.objectContaining({ 原因: expect.stringContaining("已随项目合并并入") })]);
    expect((await 项("留下的线索")).ownerId).toBe(张伟.id);

    // 撤回合并：对照指回被并的项目；再同步同样的改动照常写到被并的项目上
    const 撤 = await 撤回项目合并(prisma, r.mergeId, 张伟);
    if (!撤.ok) throw new Error(撤.error);
    expect((await prisma.entExternalRef.findUniqueOrThrow({ where: { id: ref.id } })).targetId).toBe(b.id);
    await 导([客户表(), 商机表({ 客户: "C2", 阶段: "流失", 负责人: "李娜" })]);
    const B后 = await prisma.project.findUniqueOrThrow({ where: { id: b.id } });
    expect(B后.ownerId).toBe(李娜Id);
    expect(B后.result).toBe("线索流失");
    expect((await 项("留下的线索")).ownerId).toBe(张伟.id);
    expect((await 列冲突()).总数).toBe(0);
  });
});

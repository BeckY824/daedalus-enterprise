/**
 * E-260 阶段 2a：企业版导入 / 增量导入 / 定时同步交来的客户电话落到主联系人，客户主表电话存空串（客户「客户没有电话这一说法」）。
 * 钉的是：首次导入没联系人建主联系人带号（姓名按客户名拆）、已有主联系人只补空、同号不重复、
 * 写之前认同号客户走联系人号码（不比客户电话格）、整批撤回连建的联系人和补的号一起撤、恢复再回来、
 * 同步改号补到主联系人不记冲突、号格式验不过的照原样存（电话格有号的进备注）。
 * 线索落项目没写联系人按线索名拆的用例在 ent-import-lead-project.test.ts。
 * 公司名、人名都是虚构的。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 试跑 } from "@/lib/enterprise-import/report";
import { 写一批 as 只写一批, 定这批业务线 } from "@/lib/enterprise-import/apply";
import { 撤回一批, 恢复一批 } from "@/lib/enterprise-import/revert";
import type { 读出的表 } from "@/lib/enterprise-import/excel";
import type { 实体 } from "@/lib/enterprise-import/types";

const 写一批: typeof 只写一批 = async (id, ...r) => {
  await 定这批业务线(id, "外贸");
  return 只写一批(id, ...r);
};

function 表(名: string, 实体: 实体, 表头: string[], 行: string[][]): 读出的表 {
  return { 名, 实体, 表头, 行, 行号: 行.map((_, i) => i + 2), 提醒: [] };
}
const 客户表 = (行: string[][]) => 表("客户.xlsx", "customer", ["记录ID", "客户名称", "手机号码", "客户负责人", "备注"], 行);
const 联系人表 = (行: string[][]) => 表("联系人.xlsx", "contact", ["联系人ID", "客户ID", "姓名", "手机"], 行);

const 我 = { id: "tester-id", name: "测试员" };
let 张伟 = "";

async function 跑(表们: 读出的表[]) {
  const { 批次Id } = await 试跑({ 来源: "excel", 用户Id: 我.id, 表: 表们, 建议器: null });
  return 批次Id;
}
async function 导(表们: 读出的表[]) {
  const id = await 跑(表们);
  const r = await 写一批(id, 我);
  expect(r.完了).toBe(true);
  return { id, r };
}
const 客户 = (name: string) => prisma.customer.findFirstOrThrow({ where: { name } });
const 联系人们 = (customerId: string) => prisma.contact.findMany({ where: { customerId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const 子表号 = (customerId: string) =>
  prisma.contactMethod.findMany({ where: { customerId, kind: "phone" }, select: { contactId: true, value: true }, orderBy: { value: "asc" } });

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  await prisma.user.create({ data: { id: 我.id, email: "t@x", name: 我.name, title: "管理员", role: "ADMIN", password: "x" } });
  张伟 = (await prisma.user.create({ data: { email: "zw@x", name: "张伟", title: "销售", role: "SALES", password: "x" } })).id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

describe("首次导入", () => {
  it("没有联系人：建一位主联系人带号，姓名按客户名拆（认得出人名用它、单位名留空），客户电话空串", async () => {
    await 导([客户表([["C1", "张三｜美国", "13800000001", "张伟", ""], ["C2", "虚构远帆科技有限公司", "13800000002", "张伟", ""]])]);
    const 甲 = await 客户("张三｜美国");
    expect(甲.phone).toBe("");
    const [甲主, ...甲多] = await 联系人们(甲.id);
    expect(甲多).toHaveLength(0);
    expect(甲主).toMatchObject({ name: "张三", phone: "13800000001", isPrimary: true });
    expect(await 子表号(甲.id)).toEqual([{ contactId: 甲主.id, value: "13800000001" }]);
    const 乙 = await 客户("虚构远帆科技有限公司");
    expect(乙.phone).toBe("");
    expect(await 联系人们(乙.id)).toEqual([expect.objectContaining({ name: "", phone: "13800000002", isPrimary: true })]);
  });

  it("同一批的联系人行号码和客户电话一样：不另建联系人、子表只有一行（同号不重复）", async () => {
    await 导([客户表([["C1", "虚构远帆科技有限公司", "13800000001", "张伟", ""]]), 联系人表([["P1", "C1", "虚构王经理", "13800000001"]])]);
    const 甲 = await 客户("虚构远帆科技有限公司");
    const 们 = await 联系人们(甲.id);
    expect(们.map((c) => c.name)).toEqual(["虚构王经理"]);
    expect(await 子表号(甲.id)).toEqual([{ contactId: 们[0].id, value: "13800000001" }]);
  });

  it("同一批的联系人行没写号：原系统同步来的联系人电话格不补，客户的号记进子表挂他身上，不另建一位", async () => {
    await 导([客户表([["C1", "虚构远帆科技有限公司", "13800000001", "张伟", ""]]), 联系人表([["P1", "C1", "虚构王经理", ""]])]);
    const 甲 = await 客户("虚构远帆科技有限公司");
    const 们 = await 联系人们(甲.id);
    expect(们).toHaveLength(1);
    expect(们[0].phone).toBeNull();
    expect(await 子表号(甲.id)).toEqual([{ contactId: 们[0].id, value: "13800000001" }]);
  });

  it("号格式验不过（座机）：照原样进新建的主联系人电话格、不进子表；主联系人电话格已有号的添进他备注", async () => {
    await 导([
      客户表([["C1", "虚构远帆科技有限公司", "0571-88886666", "张伟", ""], ["C2", "虚构海川贸易", "0571-88887777", "张伟", ""]]),
      联系人表([["P2", "C2", "虚构钱会计", "13700000002"]]),
    ]);
    const 甲 = await 客户("虚构远帆科技有限公司");
    const [甲主] = await 联系人们(甲.id);
    expect(甲主.phone).toMatch(/0571-?88886666/);
    expect(await 子表号(甲.id)).toEqual([]);
    const 乙 = await 客户("虚构海川贸易");
    const 钱 = await prisma.contact.findFirstOrThrow({ where: { name: "虚构钱会计" } });
    expect(钱.phone).toBe("13700000002");
    expect(钱.remark ?? "").toMatch(/电话：0571-?88887777/);
    expect(await 联系人们(乙.id)).toHaveLength(1);
  });
});

describe("增量导入 / 同步", () => {
  it("写之前认同号客户走联系人号码：试跑之后才冒出来的同号客户（号只在联系人上）照样整条跳过", async () => {
    const id = await 跑([客户表([["C1", "虚构远帆科技有限公司", "13800000001", "张伟", ""]])]);
    const 老 = await prisma.customer.create({ data: { name: "虚构老档", phone: "", salesOwnerId: 张伟 } });
    await prisma.contact.create({ data: { name: "虚构老联系人", phone: "138 0000 0001", isPrimary: true, customerId: 老.id } });
    const r = await 写一批(id, 我);
    expect(r).toMatchObject({ 完了: true, 新建: 0, 跳过: 1 });
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.contact.count()).toBe(1);
  });

  it("试跑查重也比联系人号码：号只在老客户联系人上的那一行不导", async () => {
    const 老 = await prisma.customer.create({ data: { name: "虚构老档", phone: "", salesOwnerId: 张伟 } });
    await prisma.contact.create({ data: { name: "虚构老联系人", phone: "13800000001", isPrimary: true, customerId: 老.id } });
    const { r } = await 导([客户表([["C1", "虚构远帆科技有限公司", "13800000001", "张伟", ""]])]);
    expect(r.新建).toBe(0);
    expect(await prisma.customer.count()).toBe(1);
  });

  it("原系统给了号：已有主联系人电话格空着（我们这边建的）只补空；改了号再补一个、旧号留着；不记冲突；撤回这一批连补的一起撤，恢复再回来", async () => {
    await 导([客户表([["C1", "虚构远帆科技有限公司", "", "张伟", ""]])]);
    const 甲 = await 客户("虚构远帆科技有限公司");
    expect(await 联系人们(甲.id)).toHaveLength(0);
    // 我们这边手记了一位主联系人，没号
    const 李 = await prisma.contact.create({ data: { name: "虚构李四", isPrimary: true, customerId: 甲.id } });

    const 第二批 = (await 导([客户表([["C1", "虚构远帆科技有限公司", "13800000001", "张伟", ""]])])).id;
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: 李.id } })).toMatchObject({ phone: "13800000001" });
    expect(await 子表号(甲.id)).toEqual([{ contactId: 李.id, value: "13800000001" }]);
    expect((await 客户("虚构远帆科技有限公司")).phone).toBe("");

    // 原系统改了号：电话格已有号，新号记进子表挂他身上，旧号不动；不记冲突
    const 第三批 = (await 导([客户表([["C1", "虚构远帆科技有限公司", "13800000009", "张伟", ""]])])).id;
    expect(await prisma.entConflict.count()).toBe(0);
    expect(await 子表号(甲.id)).toEqual([{ contactId: 李.id, value: "13800000001" }, { contactId: 李.id, value: "13800000009" }]);
    expect(await 联系人们(甲.id)).toHaveLength(1);

    // 原系统没改号的再同步一遍：不再补、不重复
    await 导([客户表([["C1", "虚构远帆科技有限公司", "13800000009", "张伟", "改了备注"]])]);
    expect(await 子表号(甲.id)).toHaveLength(2);

    // 从后往前撤：备注那批、第三批撤完，第三批补的新号摘掉
    const 后两批 = (await prisma.entImportBatch.findMany({ orderBy: { createdAt: "desc" }, select: { id: true }, take: 2 })).map((b) => b.id);
    expect(后两批[1]).toBe(第三批);
    for (const b of 后两批) expect((await 撤回一批(b, 我)).完了).toBe(true);
    expect(await 子表号(甲.id)).toEqual([{ contactId: 李.id, value: "13800000001" }]);
    // 第二批撤了：李四电话格退回空、子表那行一起摘
    expect(await 撤回一批(第二批, 我)).toMatchObject({ 完了: true, 还原: 1, 留下数: 0 });
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: 李.id } })).toMatchObject({ phone: null });
    expect(await 子表号(甲.id)).toEqual([]);
    // 恢复第二批：号再补回去
    expect(await 恢复一批(第二批, 我)).toMatchObject({ 完了: true, 留下数: 0 });
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: 李.id } })).toMatchObject({ phone: "13800000001" });
    expect(await 子表号(甲.id)).toEqual([{ contactId: 李.id, value: "13800000001" }]);
  });

  it("整批撤回：新建的客户连落号建的主联系人和子表的号一起撤；恢复都回来", async () => {
    const { id } = await 导([客户表([["C1", "张三｜美国", "13800000001", "张伟", ""]])]);
    expect(await prisma.contact.count()).toBe(1);
    expect(await 撤回一批(id, 我)).toMatchObject({ 完了: true, 删掉: 2, 留下数: 0 });
    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.contact.count()).toBe(0);
    expect(await prisma.contactMethod.count()).toBe(0);
    expect(await 恢复一批(id, 我)).toMatchObject({ 完了: true, 恢复: 2 });
    const 甲 = await 客户("张三｜美国");
    expect(甲.phone).toBe("");
    const [主] = await 联系人们(甲.id);
    expect(主).toMatchObject({ name: "张三", phone: "13800000001", isPrimary: true });
    expect(await 子表号(甲.id)).toEqual([{ contactId: 主.id, value: "13800000001" }]);
  });

  it("落号建的主联系人之后被人改过：撤回留下他，客户也留下", async () => {
    const { id } = await 导([客户表([["C1", "张三｜美国", "13800000001", "张伟", ""]])]);
    const 甲 = await 客户("张三｜美国");
    const [主] = await 联系人们(甲.id);
    await prisma.contact.update({ where: { id: 主.id }, data: { position: "老板" } });
    const r = await 撤回一批(id, 我);
    expect(r).toMatchObject({ 完了: true, 删掉: 0 });
    expect(r.留下数).toBe(2);
    expect(await prisma.contact.count()).toBe(1);
  });
});

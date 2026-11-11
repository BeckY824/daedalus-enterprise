/**
 * 企业版导入查重：同名不同号放行（M-导入-29 续）。
 * 旧系统里不少客户名是泛称，按名字跳过会把不同客户当成重复，所以名字撞上时再看一眼号码：
 *   - 两边都有有效号键（≥10 位）、且没有一个相同 → 不算重复，照常导入，报告里记「同名不同号放行」
 *   - 任一边没有有效号键 → 名字一样仍算重复，跳过
 *   - 号码撞上 → 仍算重复（不看名字）
 *   - 同文件内、归档导入和普通导入同一条规则；已有客户的号含联系人和联系方式子表
 * 名字、号码全是编造的
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 清洗, 空索引, 名键, 归档号索引, 撞已有客户, 查已有客户, type 本地索引 } from "@/lib/enterprise-import/clean";
import { 试跑 } from "@/lib/enterprise-import/report";
import { 写一批, 定这批业务线 } from "@/lib/enterprise-import/apply";
import type { 读出的表 } from "@/lib/enterprise-import/excel";
import type { 原始记录, 映射 } from "@/lib/enterprise-import/types";

function 映射样(客户列: Record<string, string>): 映射 {
  return {
    列: { customer: { 外部: "id", 名称: "name", 负责人: "owner", ...客户列 } },
    负责人: { 示例销售: "u-1" },
    值: { 阶段: {}, 线索状态: {}, 跟进类型: {}, 跟进状态: {} },
    默认负责人Id: "u-1",
  };
}

let 序 = 0;
function 条(字段: Record<string, string>): 原始记录 {
  序++;
  return { 实体: "customer", 外部ID: 字段.外部 ?? `N${序}`, 字段: { 负责人: "示例销售", ...字段 }, 行号: 序 + 1, 出处: "客户.xlsx" };
}

const 普通列 = { 电话: "phone", WhatsApp: "whatsapp", 座机: "landline" };
const 归档列 = { ...普通列, 归档档位: "archiveTier" };

/**
 * 我们这边已有：c-王 叫「王总」，号 13900000001；c-无号 叫「李总」，身上没有 10 位以上的号（只有短座机）；
 * c-子表 叫「张总」，客户电话空着，号只在联系人手机（13700000003）和联系方式子表座机（021-5555-0303）里
 */
function 本地有(): 本地索引 {
  const 索引 = 空索引();
  索引.客户名.set(名键("王总"), ["c-王"]);
  索引.客户名.set(名键("李总"), ["c-无号"]);
  索引.客户名.set(名键("张总"), ["c-子表"]);
  索引.客户号.set("13900000001", ["c-王"]);
  索引.客户号.set("55550101", ["c-无号"]);
  const 看得见 = new Set(["c-王", "c-无号", "c-子表"]);
  索引.归档号 = 归档号索引(看得见, [
    { v: "13900000001", customerId: "c-王" },
    { v: "5555-0101", customerId: "c-无号" },
    { v: "13700000003", customerId: "c-子表" }, // 联系人手机
    { v: "021-5555-0303", customerId: "c-子表" }, // 子表座机
  ]);
  return 索引;
}

const 跳过 = (r: ReturnType<typeof 清洗>, id: string) => r.问题.filter((q) => q.外部ID === id && q.级别 === "跳过" && q.类别 === "重名");
const 放行 = (r: ReturnType<typeof 清洗>) => r.问题.filter((q) => q.类别 === "同名不同号放行");

describe("同名不同号放行：和我们这边已有客户比", () => {
  for (const [叫法, 列] of [["普通导入", 普通列], ["归档导入", 归档列]] as const) {
    it(`${叫法}：同名、两边都有号且不同 → 照常导入，记一条放行`, () => {
      const r = 清洗([条({ 外部: "A1", 名称: "王 总", 电话: "13600000001" })], 映射样(列), 本地有());
      expect(r.待写.map((w) => w.外部ID)).toEqual(["A1"]);
      expect(r.待写[0].目标).toBeUndefined();
      expect(跳过(r, "A1")).toHaveLength(0);
      expect(放行(r)).toEqual([expect.objectContaining({ 级别: "提醒", 外部ID: "A1", 行号: expect.any(Number), 说明: expect.stringContaining("王 总") })]);
    });

    it(`${叫法}：同名、这一条没号（或只有短号）→ 跳过`, () => {
      const r = 清洗([条({ 外部: "A2", 名称: "王总" }), 条({ 外部: "A3", 名称: "王总", 座机: "5555-0909" })], 映射样(列), 本地有());
      expect(r.待写).toHaveLength(0);
      expect(跳过(r, "A2")[0].说明).toMatch(/已经有叫「王总」的客户，这一条不导（这一条没有 10 位以上的号码可比/);
      expect(跳过(r, "A3")).toHaveLength(1);
      expect(放行(r)).toHaveLength(0);
    });

    it(`${叫法}：同名、已有那家没有有效号 → 跳过`, () => {
      const r = 清洗([条({ 外部: "A4", 名称: "李总", 电话: "13600000004" })], 映射样(列), 本地有());
      expect(r.待写).toHaveLength(0);
      expect(跳过(r, "A4")[0].说明).toMatch(/已经有叫「李总」的客户.*那家没有 10 位以上的号码/);
    });
  }

  it("同名同号 → 跳过（按号报）", () => {
    const r = 清洗([条({ 外部: "B1", 名称: "王总", 电话: "+86 139-0000-0001" })], 映射样(普通列), 本地有());
    expect(r.待写).toHaveLength(0);
    expect(跳过(r, "B1")[0].说明).toMatch(/号码 .*139.*0000.*0001 和我们这边已有的客户撞了/);
  });

  it("异名同号 → 跳过（不看名字）", () => {
    const r = 清洗([条({ 外部: "B2", 名称: "全新的名字", WhatsApp: "0086 13900000001" })], 映射样(普通列), 本地有());
    expect(r.待写).toHaveLength(0);
    expect(跳过(r, "B2")[0].说明).toMatch(/号码 0086 13900000001 和我们这边已有的客户撞了/);
  });

  it("已有客户的号只在联系人 / 联系方式子表里：号不同放行，号相同跳过", () => {
    const r = 清洗(
      [
        条({ 外部: "C1", 名称: "张总", 电话: "13600000011" }),
        条({ 外部: "C2", 名称: "张总", 座机: "(021) 5555 0303" }),
        条({ 外部: "C3", 名称: "张总", 电话: "13700000003" }),
      ],
      映射样(普通列),
      本地有(),
    );
    expect(r.待写.map((w) => w.外部ID)).toEqual(["C1"]);
    expect(跳过(r, "C2")).toHaveLength(1);
    expect(跳过(r, "C3")).toHaveLength(1);
  });

  it("同名的已有客户有多家：有一家算重复就跳过并说那一家；全都不算才放行", () => {
    const 本地 = 本地有();
    本地.客户名.set(名键("王总"), ["c-王", "c-无号"]);
    const 论1 = 查已有客户(本地, "王总", ["13600000021"]);
    expect(论1).toMatchObject({ 撞: expect.stringContaining("（2 个）"), 依据: expect.stringContaining("其中一家没有 10 位以上的号码") });
    expect(撞已有客户(本地, "王总", ["13600000021"])).toMatch(/已经有叫「王总」的客户/);

    本地.客户名.set(名键("王总"), ["c-王", "c-子表"]);
    const 论2 = 查已有客户(本地, "王总", ["13600000021"]);
    expect(论2).toMatchObject({ 放行: expect.stringContaining("同名不同号放行") });
    expect(撞已有客户(本地, "王总", ["13600000021"])).toBeNull();

    const r = 清洗([条({ 外部: "D1", 名称: "王总", 电话: "13600000021" })], 映射样(普通列), 本地);
    expect(r.待写.map((w) => w.外部ID)).toEqual(["D1"]);
    expect(放行(r)).toHaveLength(1);
  });
});

describe("同名不同号放行：同一份文件里", () => {
  it("两行同名、号不同：都导入，第二行记放行，不再另出「疑似重名」", () => {
    const r = 清洗([条({ 外部: "E1", 名称: "示例 咨询", 电话: "13600000031" }), 条({ 外部: "E2", 名称: "示例咨询", 电话: "13600000032" })], 映射样(普通列), 本地有());
    expect(r.待写.map((w) => [w.外部ID, w.并入 ?? null])).toEqual([["E1", null], ["E2", null]]);
    expect(放行(r)).toEqual([expect.objectContaining({ 外部ID: "E2", 说明: expect.stringMatching(/和第 \d+ 行「示例咨询」同名/) })]);
    expect(r.问题.filter((q) => q.类别 === "疑似重名")).toHaveLength(0);
  });

  it("两行同名、第二行没号：第二行跳过", () => {
    const r = 清洗([条({ 外部: "E3", 名称: "示例客户丙", 电话: "13600000033" }), 条({ 外部: "E4", 名称: "示例客户丙" })], 映射样(普通列), 本地有());
    expect(r.待写.map((w) => w.外部ID)).toEqual(["E3"]);
    expect(跳过(r, "E4")[0].说明).toMatch(/同名，这一条没有 10 位以上的号码可比，按重复算，这一条不导/);
  });

  it("两行同名、第一行没号：第二行有号也跳过", () => {
    const r = 清洗([条({ 外部: "E5", 名称: "示例客户丁" }), 条({ 外部: "E6", 名称: "示例客户丁", 电话: "13600000036" })], 映射样(普通列), 本地有());
    expect(r.待写.map((w) => w.外部ID)).toEqual(["E5"]);
    expect(跳过(r, "E6")[0].说明).toMatch(/那一条没有 10 位以上的号码可比/);
  });

  it("两行同名、电话不同但 WhatsApp 相同：第二行跳过（号码撞上算重复）", () => {
    const r = 清洗(
      [条({ 外部: "E7", 名称: "示例客户戊", 电话: "13600000037", WhatsApp: "+44 7700 900111" }), 条({ 外部: "E8", 名称: "示例客户戊", 电话: "13600000038", WhatsApp: "+447700900111" })],
      映射样(普通列),
      本地有(),
    );
    expect(r.待写.map((w) => w.外部ID)).toEqual(["E7"]);
    expect(跳过(r, "E8")[0].说明).toMatch(/号码也相同/);
  });

  it("同名同电话：照老规矩并成一条", () => {
    const r = 清洗([条({ 外部: "E9", 名称: "示例客户己", 电话: "13600000039" }), 条({ 外部: "E10", 名称: "示例客户己", 电话: "136-0000-0039" })], 映射样(归档列), 本地有());
    expect(r.待写.find((w) => w.外部ID === "E10")?.并入).toBe("E9");
    expect(r.问题.filter((q) => q.级别 === "跳过")).toHaveLength(0);
  });
});

describe("同名不同号放行：试跑报告 → 写入（读本地索引 + apply）", () => {
  const 我 = { id: "tester-id", name: "测试员" };
  let 销售 = "";

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    await prisma.user.create({ data: { id: 我.id, email: "t@x", name: 我.name, title: "管理员", role: "ADMIN", password: "x" } });
    销售 = (await prisma.user.create({ data: { email: "s@x", name: "示例销售", title: "销售", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: 销售, bizRole: "sales" } });
  });
  afterAll(() => prisma.$disconnect());

  it("报告里放行可数、带行号；号只在联系人 / 子表里的已有客户照样比；写入后同名两家都在", async () => {
    // 已有「示例王总」：客户电话空着，号在联系人手机里；已有「示例李总」：号在联系方式子表里；已有「示例赵总」：没有号
    const 王 = await prisma.customer.create({ data: { name: "示例王总", phone: "", salesOwnerId: 销售 } });
    await prisma.contact.create({ data: { customerId: 王.id, name: "示例联系人", phone: "13700000041" } });
    const 李 = await prisma.customer.create({ data: { name: "示例李总", phone: "", salesOwnerId: 销售 } });
    await prisma.contactMethod.create({ data: { customerId: 李.id, kind: "landline", value: "02155550442", numberKey: "02155550442" } });
    await prisma.customer.create({ data: { name: "示例赵总", phone: "", salesOwnerId: 销售 } });

    const 表: 读出的表 = {
      名: "客户.xlsx", 实体: "customer", 表头: ["记录ID", "客户名称", "手机号码", "客户负责人"],
      行: [
        ["R1", "示例王总", "13600000041", "示例销售"], // 号不同 → 放行
        ["R2", "示例王总", "137 0000 0041", "示例销售"], // 撞王的联系人手机 → 跳过
        ["R3", "示例李总", "13600000042", "示例销售"], // 号不同 → 放行
        ["R4", "示例李总", "021-5555-0442", "示例销售"], // 撞李的子表座机 → 跳过
        ["R5", "示例赵总", "13600000043", "示例销售"], // 已有那家没号 → 跳过
      ],
      行号: [2, 3, 4, 5, 6], 提醒: [],
    };
    const { 批次Id, 报告 } = await 试跑({ 来源: "excel", 用户Id: 我.id, 建议器: null, 表: [表] });
    const 放行数 = 报告.问题分类.filter((c) => c.类别 === "同名不同号放行").reduce((a, c) => a + c.数, 0);
    expect(放行数).toBe(2);
    expect(报告.问题.filter((q) => q.类别 === "同名不同号放行").map((q) => q.行号).sort()).toEqual([2, 4]);
    expect(报告.问题.filter((q) => q.级别 === "跳过" && q.类别 === "重名").map((q) => q.行号).sort()).toEqual([3, 5, 6]);

    await 定这批业务线(批次Id, "内贸");
    const r = await 写一批(批次Id, 我);
    expect(r).toMatchObject({ 新建: 2, 失败: 0 });
    expect(await prisma.customer.count({ where: { name: "示例王总" } })).toBe(2);
    expect(await prisma.customer.count({ where: { name: "示例李总" } })).toBe(2);
    expect(await prisma.customer.count({ where: { name: "示例赵总" } })).toBe(1);
  });
});

/**
 * 企业版归档导入（M-导入-23 / 24）：
 *   - 「归档档位」列落 Customer.archiveTier（A1 / A2 / B / C / D / E），认不出的不落、原样进备注
 *   - 「座机」列：电话空着当电话，有电话进备注
 *   - 归档导入查重：电话 / WhatsApp / 座机任一个号、或客户名称撞了我们这边的客户 → 整条跳过、给原因；不撞照建
 *   - 普通导入（没映射归档档位，M-导入-29）查重和归档导入一样：撞了整条跳过，不再「同号连上只补空、同名只提醒」
 * 名字、号码全是编造的
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 认归档档位 } from "@/lib/enterprise/archive-tier";
import { 清洗, 空索引, 名键, 归档号键, type 本地索引 } from "@/lib/enterprise-import/clean";
import { 规则猜列 } from "@/lib/enterprise-import/mapping";
import { 试跑 } from "@/lib/enterprise-import/report";
import { 写一批, 定这批业务线 } from "@/lib/enterprise-import/apply";
import type { 读出的表 } from "@/lib/enterprise-import/excel";
import type { 原始记录, 映射 } from "@/lib/enterprise-import/types";

function 映射样(客户列: Record<string, string>, 改: Partial<映射> = {}): 映射 {
  return {
    列: { customer: { 外部: "id", 名称: "name", 负责人: "owner", ...客户列 } },
    负责人: { 示例销售: "u-1" },
    值: { 阶段: {}, 线索状态: {}, 跟进类型: {}, 跟进状态: {} },
    默认负责人Id: "u-1",
    ...改,
  };
}

let 序 = 0;
function 条(字段: Record<string, string>): 原始记录 {
  序++;
  return { 实体: "customer", 外部ID: 字段.外部 ?? `A${序}`, 字段: { 负责人: "示例销售", ...字段 }, 行号: 序 + 1, 出处: "归档.xlsx" };
}

/** 我们这边已有：一位叫「示例老客户」的客户，身上有手机、WhatsApp、座机各一个号 */
function 本地有(): 本地索引 {
  const 索引 = 空索引();
  索引.客户名.set(名键("示例老客户"), ["c-old"]);
  索引.客户号.set("13900000001", ["c-old"]);
  索引.归档号 = new Map(["13900000001", "+1 415 555 0101", "021-5555-0101"].map((v) => [归档号键(v), ["c-old"]]));
  return 索引;
}

const 归档列 = { 电话: "phone", WhatsApp: "whatsapp", 座机: "landline", 归档档位: "archiveTier" };

describe("归档档位（M-导入-23）", () => {
  it("认归档档位：去空白、全角、大小写都认；六档之外一律 null", () => {
    expect(认归档档位("A1")).toBe("A1");
    expect(认归档档位(" a2 ")).toBe("A2");
    expect(认归档档位("Ｂ")).toBe("B");
    expect(认归档档位("e")).toBe("E");
    for (const x of ["A3", "F", "A1档", "", null, undefined]) expect(认归档档位(x)).toBeNull();
  });

  it("「归档档位」「档位」认成 archiveTier，「座机」认成 landline，电话列另认", () => {
    expect(规则猜列("customer", ["客户名称", "手机", "座机", "归档档位"])).toMatchObject({ 手机: "phone", 座机: "landline", 归档档位: "archiveTier" });
    expect(规则猜列("customer", ["客户名称", "档位"]).档位).toBe("archiveTier");
  });

  it("认得出的落 archiveTier；认不出的不落、进备注、提醒一笔", () => {
    const r = 清洗([条({ 名称: "示例甲", 归档档位: "a1" }), 条({ 名称: "示例乙", 归档档位: "A3" })], 映射样({ 归档档位: "archiveTier" }));
    const [甲, 乙] = r.待写;
    expect(甲.值.archiveTier).toBe("A1");
    expect(乙.值).not.toHaveProperty("archiveTier");
    expect(String(乙.值.remark)).toContain("归档档位：A3");
    expect(r.问题).toContainEqual(expect.objectContaining({ 级别: "提醒", 类别: "格式不对", 外部ID: 乙.外部ID }));
  });

  it("座机：电话空着当电话；有电话就进备注", () => {
    const r = 清洗([条({ 名称: "示例丙", 座机: "021-5555-0202" }), 条({ 名称: "示例丁", 电话: "13900000002", 座机: "021-5555-0203" })], 映射样({ 电话: "phone", 座机: "landline" }));
    const [丙, 丁] = r.待写;
    expect(丙.值.phone).not.toBe("");
    expect(丁.值.phone).toBe("13900000002");
    expect(String(丁.值.remark)).toContain("座机：021-5555-0203");
  });
});

describe("归档导入查重（M-导入-24）", () => {
  it("归档号键：+86 / 0086 前缀、空格横杠不算；不到 10 位的不拿来撞", () => {
    expect(归档号键("+86 139 0000 0001")).toBe("13900000001");
    expect(归档号键("0086-13900000001")).toBe("13900000001");
    expect(归档号键("5555-0101")).toBe("");
    expect(归档号键("")).toBe("");
  });

  const 跳过了 = (r: ReturnType<typeof 清洗>, 外部ID: string) =>
    r.问题.filter((q) => q.外部ID === 外部ID && q.级别 === "跳过" && q.类别 === "重名");

  it("撞 WhatsApp：整条跳过、给原因，不连上", () => {
    const r = 清洗([条({ 外部: "W1", 名称: "示例新客户一", WhatsApp: "+14155550101", 归档档位: "B" })], 映射样(归档列), 本地有());
    expect(r.待写).toHaveLength(0);
    expect(跳过了(r, "W1")[0]?.说明).toMatch(/号码 \+14155550101 和我们这边已有的客户撞了.*不导/);
    expect(r.问题.filter((q) => q.外部ID === "W1"), "跳过的那条不再挂别的提醒").toHaveLength(1);
  });

  it("撞座机：整条跳过", () => {
    const r = 清洗([条({ 外部: "L1", 名称: "示例新客户二", 座机: "(021) 55550101", 归档档位: "C" })], 映射样(归档列), 本地有());
    expect(r.待写).toHaveLength(0);
    expect(跳过了(r, "L1")).toHaveLength(1);
  });

  it("撞 11 位电话（带 +86）：整条跳过，不走同号连上", () => {
    const r = 清洗([条({ 外部: "P1", 名称: "示例新客户三", 电话: "+86 139 0000 0001" })], 映射样(归档列), 本地有());
    expect(r.待写).toHaveLength(0);
    expect(跳过了(r, "P1")).toHaveLength(1);
  });

  it("撞客户名称（空白、全角不算）：整条跳过", () => {
    const r = 清洗([条({ 外部: "N1", 名称: "示例 老客户", 电话: "13900000009" })], 映射样(归档列), 本地有());
    expect(r.待写).toHaveLength(0);
    expect(跳过了(r, "N1")[0]?.说明).toContain("已经有叫「示例 老客户」的客户");
  });

  it("都不撞：照建，带上档位", () => {
    const r = 清洗([条({ 外部: "OK", 名称: "示例新客户四", 电话: "13900000008", WhatsApp: "+14155550199", 座机: "021-5555-0299", 归档档位: "A2" })], 映射样(归档列), 本地有());
    expect(r.待写).toHaveLength(1);
    expect(r.待写[0]).toMatchObject({ 外部ID: "OK", 值: { name: "示例新客户四", archiveTier: "A2" } });
    expect(r.待写[0].目标).toBeUndefined();
    expect(r.问题.filter((q) => q.级别 === "跳过")).toHaveLength(0);
  });

  it("以前导过的（有对照）不查，照常更新", () => {
    const 本地 = 本地有();
    本地.引用.set("customer|R1", "c-old");
    const r = 清洗([条({ 外部: "R1", 名称: "示例老客户", 电话: "13900000001", 归档档位: "D" })], 映射样(归档列), 本地);
    expect(r.待写[0]).toMatchObject({ 外部ID: "R1", 目标: { 本地ID: "c-old", 方式: "对照" } });
  });

  it("普通导入（没映射归档档位，M-导入-29）一样查：同号、撞 WhatsApp / 座机、同名都整条跳过，不连上、不补空", () => {
    const m = 映射样({ 电话: "phone", WhatsApp: "whatsapp", 座机: "landline" });
    const r = 清洗(
      [
        条({ 外部: "X1", 名称: "示例新客户五", 电话: "13900000001" }),
        条({ 外部: "X2", 名称: "示例　老客户", 电话: "13900000007" }),
        条({ 外部: "X3", 名称: "示例新客户六", WhatsApp: "+1 415 555 0101" }),
        条({ 外部: "X4", 名称: "示例新客户七", 座机: "021 5555 0101" }),
        条({ 外部: "X5", 名称: "示例新客户八", 电话: "13900000006" }),
      ],
      m,
      本地有(),
    );
    expect(r.待写.map((w) => w.外部ID)).toEqual(["X5"]);
    expect(r.待写[0].目标).toBeUndefined();
    for (const id of ["X1", "X2", "X3", "X4"]) expect(跳过了(r, id), id).toHaveLength(1);
    expect(跳过了(r, "X1")[0].说明).toMatch(/号码 13900000001 和我们这边已有的客户撞了，这一条不导/);
    expect(跳过了(r, "X2")[0].说明).toMatch(/已经有叫「示例\s*老客户」的客户，这一条不导/);
    expect(r.问题.some((q) => q.说明.includes("只补空") || q.说明.includes("照新建")), "不再有「连上只补空 / 同名照新建」").toBe(false);
  });

  it("名称比较：空白、全半角、大小写不算，但不是逐字（多一个字不算撞）", () => {
    const 本地 = 空索引();
    本地.客户名.set(名键("Acme 示例贸易"), ["c-x"]);
    const r = 清洗(
      [条({ 外部: "M1", 名称: "ＡＣＭＥ示例贸易" }), 条({ 外部: "M2", 名称: " acme  示例 贸易 " }), 条({ 外部: "M3", 名称: "Acme 示例贸易公司" })],
      映射样({}),
      本地,
    );
    expect(r.待写.map((w) => w.外部ID)).toEqual(["M3"]);
  });

  it("号码不到 10 位不拿来跟子表 / WhatsApp 比", () => {
    const 本地 = 空索引();
    本地.归档号 = new Map();
    const r = 清洗([条({ 外部: "S1", 名称: "示例短号", 座机: "5555-0101" })], 映射样({ 座机: "landline" }), 本地);
    expect(r.待写).toHaveLength(1);
  });

  it("同一批文件里互相重复：照老规矩——同号并成一条、提醒；都不撞我们这边", () => {
    const r = 清洗([条({ 外部: "B1", 名称: "示例批内甲", 电话: "13900000011" }), 条({ 外部: "B2", 名称: "示例批内乙", 电话: "139-0000-0011" })], 映射样({ 电话: "phone" }), 本地有());
    expect(r.待写.find((w) => w.外部ID === "B2")?.并入).toBe("B1");
    expect(r.问题.filter((q) => q.级别 === "跳过")).toHaveLength(0);
  });
});

describe("归档导入：试跑 → 写入（读本地索引 + apply）", () => {
  const 我 = { id: "tester-id", name: "测试员" };
  let 销售 = "";
  const 表 = (行: string[][]): 读出的表 => ({
    名: "归档.xlsx", 实体: "customer", 表头: ["记录ID", "客户名称", "手机号码", "WhatsApp", "座机", "归档档位", "客户负责人"], 行, 行号: 行.map((_, i) => i + 2), 提醒: [],
  });

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    await prisma.user.create({ data: { id: 我.id, email: "t@x", name: 我.name, title: "管理员", role: "ADMIN", password: "x" } });
    销售 = (await prisma.user.create({ data: { email: "s@x", name: "示例销售", title: "销售", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: 销售, bizRole: "sales" } });
  });
  afterAll(() => prisma.$disconnect());

  it("撞子表座机、客户 WhatsApp、客户名的都不导；不撞的建出来带档位；老客户一格不动", async () => {
    const 老 = await prisma.customer.create({ data: { name: "示例老客户", phone: "13900000001", salesOwnerId: 销售, extra: { create: { whatsapp: "+14155550101" } } } });
    const 另 = await prisma.customer.create({ data: { name: "示例另一家", phone: "13900000003", salesOwnerId: 销售 } });
    await prisma.contactMethod.create({ data: { customerId: 另.id, kind: "landline", value: "02155550101", numberKey: "02155550101" } });
    const { 批次Id } = await 试跑({
      来源: "excel", 用户Id: 我.id, 建议器: null,
      表: [表([
        ["A1", "示例新客户一", "", "+1 415-555-0101", "", "A1", "示例销售"],
        ["A2", "示例新客户二", "", "", "021-5555-0101", "B", "示例销售"],
        ["A3", "示例老客户", "13900000099", "", "", "C", "示例销售"],
        ["A4", "示例新客户三", "13900000004", "", "", "a2", "示例销售"],
      ])],
    });
    await 定这批业务线(批次Id, "内贸");
    const r = await 写一批(批次Id, 我);
    expect(r).toMatchObject({ 新建: 1, 失败: 0 });
    const 新 = await prisma.customer.findFirstOrThrow({ where: { name: "示例新客户三" } });
    expect(新.archiveTier).toBe("A2");
    expect(await prisma.customer.count()).toBe(3);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: 老.id } })).toMatchObject({ archiveTier: null, phone: "13900000001" });
  });

  it("普通导入（没有归档档位列）：试跑之后才冒出来的同号客户，写入时也不连、不补空，这一条不导（M-导入-29）", async () => {
    const 普通表: 读出的表 = {
      名: "客户.xlsx", 实体: "customer", 表头: ["记录ID", "客户名称", "手机号码", "备注", "客户负责人"],
      行: [["P1", "示例普通新客户", "13900000021", "原系统备注", "示例销售"]], 行号: [2], 提醒: [],
    };
    const { 批次Id } = await 试跑({ 来源: "excel", 用户Id: 我.id, 建议器: null, 表: [普通表] });
    await 定这批业务线(批次Id, "内贸");
    const 后来 = await prisma.customer.create({ data: { name: "示例后来建的", phone: "13900000021", salesOwnerId: 销售 } });
    const r = await 写一批(批次Id, 我);
    expect(r).toMatchObject({ 新建: 0, 更新: 0, 失败: 0 });
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: 后来.id } })).toMatchObject({ name: "示例后来建的", remark: null });
  });
});

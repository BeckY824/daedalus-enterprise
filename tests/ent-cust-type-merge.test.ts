/**
 * 客户抬头 PR-2（11-17，P-抬头-01）：客户属性的枚举值并进客户类型字典
 *   - 新库：客户类型默认 = 原 5 项 + 属性 10 项（号 6–15，5 号不复用），个体工商户在里面
 *   - 老库：客户属性字典里已有的每一项（含停用的旧值、自己加的）第一次读客户类型时并过来，停用的仍停用；同名合并不重复
 *   - 客户在设置页改过的（客户类型里的改名、启停，并过来之后再改的）不被覆盖；重复读 / 几个人同时读幂等
 *   - 客户身上存的客户属性、客户类型一格不碰
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 企业字典, 可选项, 字典定义 } from "@/lib/enterprise/dict";

const 原五项 = ["个人买家", "中间贸易商", "国家代理商", "专业运营商"]; // 启用的四项（经销商默认停用）
const 属性十项 = ["自用非商用", "个人投资者", "个体工商户", "商贸代理公司", "文旅商业公司", "文旅主管单位", "科教文体单位", "国企国资平台", "园区管委会", "招标代理商"];
const 号 = (k: number) => `dict-custType-${6 + k}`;

/** 已上线的老库：客户类型 5 项（按当时的默认顺序、经销商停着、几个记号都记过；补新记号停在 6） */
async function 老客户类型库(改: Record<number, { name?: string; active?: boolean }> = {}) {
  const 名 = ["个人买家", "中间贸易商", "国家代理商", "经销商", "专业运营商"];
  const 序 = [0, 1, 2, 4, 3];
  for (const [i, name] of 名.entries()) {
    await prisma.entDictItem.create({ data: { id: `dict-custType-${i}`, kind: "custType", name: 改[i]?.name ?? name, sort: 序[i], active: 改[i]?.active ?? i !== 3 } });
  }
  for (const key of ["entDict.defaultRenamed.custType", "entDict.defaultRenamed.custType.2", "entDict.defaultOrder.custType", "entDict.defaultOff.custType"]) {
    await prisma.setting.create({ data: { key, value: "true" } });
  }
  await prisma.setting.create({ data: { key: "entDict.defaultAdded.custType", value: "6" } });
}

/** 客户属性：同步脚本跑过的样子（10 项启用、id 是脚本另起的；旧值停用排在后面） */
async function 属性库(旧: string[] = [], 改: Record<number, { name?: string; active?: boolean; id?: string }> = {}) {
  for (const [k, name] of 属性十项.entries()) {
    await prisma.entDictItem.create({ data: { id: 改[k]?.id ?? `dict-custAttr-${k}-sync`, kind: "custAttr", name: 改[k]?.name ?? name, sort: k, active: 改[k]?.active ?? true } });
  }
  for (const [j, name] of 旧.entries()) {
    await prisma.entDictItem.create({ data: { id: `old-attr-${j}`, kind: "custAttr", name, sort: 10 + j, active: false } });
  }
}

const 看 = async () => (await 企业字典("custType")).map((x) => [x.name, x.active]);

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("CRM_ENTERPRISE", "1");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

describe("客户属性并进客户类型", () => {
  it("默认定义：客户类型末尾接属性 10 项，号 6–15、5 号不复用；属性默认还是同一份", () => {
    expect(字典定义.custType.默认.slice(5)).toEqual(属性十项);
    expect(字典定义.custType.默认号).toEqual([0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(字典定义.custAttr.默认).toEqual(属性十项);
    expect(字典定义.custType.默认).toContain("个体工商户");
  });

  it("新库（属性没读过）：建 15 项，属性 10 项启用、排在原五项后面，个体工商户能选", async () => {
    const 全 = await 企业字典("custType");
    expect(全.map((x) => x.name)).toEqual(["个人买家", "中间贸易商", "国家代理商", "专业运营商", "经销商", ...属性十项]);
    expect(全.slice(5).map((x) => x.id)).toEqual(属性十项.map((_, k) => 号(k)));
    expect(全.some((x) => x.id === "dict-custType-5")).toBe(false);
    expect(await 可选项("custType")).toEqual([...原五项, ...属性十项]);
  });

  it("新库、属性先读过（客户类型还一行没有）：并过来再补原五项，顺序、启停和新库一样，不多不少", async () => {
    await 企业字典("custAttr");
    expect(await 看()).toEqual([...["个人买家", "中间贸易商", "国家代理商", "专业运营商"].map((n) => [n, true]), ["经销商", false], ...属性十项.map((n) => [n, true])]);
    expect(await prisma.entDictItem.count({ where: { kind: "custType" } })).toBe(15);
  });

  it("老库：属性 10 项按默认 id 并进来、启用；停用的旧值并过来仍停用、排最后；和客户类型同名的合并不重复", async () => {
    await 老客户类型库();
    await prisma.entDictItem.create({ data: { kind: "custType", name: "示例类型", sort: 5 } });
    await 属性库(["旧一", "个人买家", "旧二"], { 9: { active: false } });
    const 期望 = [
      ["个人买家", true], ["中间贸易商", true], ["国家代理商", true], ["专业运营商", true], ["经销商", false],
      ...属性十项.map((n, k) => [n, k !== 9]),
      ["示例类型", true],
      ["旧一", false], ["旧二", false],
    ];
    expect(await 看()).toEqual(期望);
    const 全 = await 企业字典("custType");
    for (const [k, n] of 属性十项.entries()) expect(全.find((x) => x.name === n)?.id).toBe(号(k));
    expect(全.filter((x) => x.name === "个人买家")).toHaveLength(1);
    expect(全.find((x) => x.name === "个人买家")?.id).toBe("dict-custType-0");
    expect(await 可选项("custType")).toEqual([...原五项, ...属性十项.slice(0, 9), "示例类型"]);
    // 属性那边原样留着（停用属性是 PR-4 的事）
    expect(await prisma.entDictItem.count({ where: { kind: "custAttr" } })).toBe(13);
  });

  it("重复读幂等：第二、三遍不多建、不改；记号记下", async () => {
    await 老客户类型库();
    await 属性库(["旧一"]);
    const 一 = await 看();
    expect(await 看()).toEqual(一);
    expect(await 看()).toEqual(一);
    expect(await prisma.entDictItem.count({ where: { kind: "custType" } })).toBe(5 + 10 + 1);
    expect(await prisma.setting.findUnique({ where: { key: "entDict.mergedFrom.custAttr.custType" } })).not.toBeNull();
    expect((await prisma.setting.findUnique({ where: { key: "entDict.defaultAdded.custType" } }))?.value).toBe("16");
  });

  it("几个人同时第一次读：不撞、不多建", async () => {
    await 老客户类型库();
    await 属性库(["旧一", "旧二"]);
    await Promise.all(Array.from({ length: 5 }, () => 企业字典("custType")));
    const 全 = await 企业字典("custType");
    expect(全).toHaveLength(5 + 10 + 2);
    expect(new Set(全.map((x) => x.name)).size).toBe(全.length);
  });

  it("客户自己改的不被覆盖：客户类型里改过名、停过的原样；自己加过同名（停着）的不重建、仍停着", async () => {
    await 老客户类型库({ 1: { name: "批发商" }, 2: { active: false } });
    await prisma.entDictItem.create({ data: { kind: "custType", name: "个体工商户", sort: 5, active: false } });
    await 属性库();
    const 全 = await 企业字典("custType");
    expect(全.find((x) => x.id === "dict-custType-1")?.name).toBe("批发商");
    expect(全.find((x) => x.id === "dict-custType-2")).toMatchObject({ name: "国家代理商", active: false });
    expect(全.filter((x) => x.name === "个体工商户")).toEqual([expect.objectContaining({ active: false })]);
    expect(全.some((x) => x.id === 号(2))).toBe(false);
    expect(全.some((x) => x.name === "中间贸易商")).toBe(false);
    expect(全).toHaveLength(5 + 1 + 9);
  });

  it("并过来之后管理员再改名、停用：再读不改回、不补回原名", async () => {
    await 老客户类型库();
    await 属性库();
    await 企业字典("custType");
    await prisma.entDictItem.update({ where: { id: 号(8) }, data: { name: "园区" } });
    await prisma.entDictItem.update({ where: { id: 号(5) }, data: { active: false } });
    const 全 = await 企业字典("custType");
    expect(全.find((x) => x.id === 号(8))?.name).toBe("园区");
    expect(全.some((x) => x.name === "园区管委会")).toBe(false);
    expect(全.find((x) => x.id === 号(5))?.active).toBe(false);
    expect(全).toHaveLength(15);
  });

  it("属性那边管理员改过名的默认项（还占着默认 id）：改后的名字用那个默认的号并过来，不再补原名", async () => {
    await 老客户类型库();
    await 属性库([], { 9: { id: "dict-custAttr-9", name: "招标代理" } });
    const 全 = await 企业字典("custType");
    expect(全.find((x) => x.id === 号(9))?.name).toBe("招标代理");
    expect(全.some((x) => x.name === "招标代理商")).toBe(false);
    expect(全).toHaveLength(15);
  });

  it("客户身上存的值不碰：属性个体工商户、类型个人买家的那一家照旧", async () => {
    await 老客户类型库();
    await 属性库();
    const u = await prisma.user.create({ data: { email: "s@t", name: "销售", role: "SALES", password: "x" } });
    const c = await prisma.customer.create({ data: { name: "甲", phone: "13800000001", salesOwnerId: u.id, customerType: "个人买家", customerAttr: "个体工商户" } });
    await 企业字典("custType");
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c.id }, select: { customerType: true, customerAttr: true } })).toEqual({ customerType: "个人买家", customerAttr: "个体工商户" });
  });
});

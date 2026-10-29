/**
 * 企业版导入 · P8（10-29）：客户简称 / 地址四格 / 分配方式、联系人性别 / 生日 / 爱好 / 地址，
 * 「客户全称」「客户简称」两列、客户状态不进跟进状态、来源对渠道、级别只认 S/A/B/C、
 * 号码进 ContactMethod 子表、新列三方比对（空值不算冲突）、整批撤回 / 恢复带上新列和子表的号。
 * 公司名、人名都是虚构的。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 试跑 } from "@/lib/enterprise-import/report";
import { 写一批 } from "@/lib/enterprise-import/apply";
import { 撤回一批, 恢复一批 } from "@/lib/enterprise-import/revert";
import { 规则猜列, 进备注 } from "@/lib/enterprise-import/mapping";
import type { 读出的表 } from "@/lib/enterprise-import/excel";
import type { 实体 } from "@/lib/enterprise-import/types";

function 表(名: string, 实体: 实体, 表头: string[], 行: string[][]): 读出的表 {
  return { 名, 实体, 表头, 行, 行号: 行.map((_, i) => i + 2), 提醒: [] };
}

const 客户头 = ["记录ID", "客户全称", "客户简称", "手机号码", "客户负责人", "客户等级", "客户状态", "客户来源", "地址国家", "省份", "城市", "区县", "分配方式", "备注"];
const 甲行 = ["C1", "测试甲科技有限公司", "测试甲", "13800000001", "张伟", "S", "意向", "虚构渠道甲", "", "浙江省", "杭州市", "西湖区", "自持", "老客户"];
const 乙行 = ["C2", "测试乙贸易公司", "", "13800000002", "李娜", "D", "", "没有这个渠道", "美国", "加州", "洛杉矶", "", "乱写的方式", ""];
const 客户表 = (行: string[][] = [甲行, 乙行]) => 表("客户.xlsx", "customer", 客户头, 行);

const 联系人头 = ["联系人ID", "客户ID", "姓名", "职位", "手机", "邮箱", "性别", "生日", "爱好", "联系人地址"];
const 联系人表 = (行: string[][] = [["P1", "C1", "虚构王经理", "采购", "13700000001", "wang@example.test", "男", "1990-05-06", "钓鱼", "杭州市西湖区虚构路 1 号"]]) =>
  表("联系人.xlsx", "contact", 联系人头, 行);

const 我 = { id: "tester-id", name: "测试员" };
let 张伟 = "";
let 李娜 = "";
let 渠道甲 = "";

async function 跑(表们: 读出的表[]) {
  const { 批次Id } = await 试跑({ 来源: "excel", 用户Id: 我.id, 表: 表们, 建议器: null });
  return 批次Id;
}
async function 导(表们: 读出的表[]) {
  const id = await 跑(表们);
  return { id, r: await 写一批(id, 我) };
}
const 客户 = (name: string) => prisma.customer.findFirst({ where: { name }, include: { extra: true } });
const 号们 = (customerId: string) =>
  prisma.contactMethod.findMany({ where: { customerId }, select: { contactId: true, kind: true, value: true }, orderBy: [{ kind: "asc" }, { value: "asc" }] });

beforeEach(async () => {
  // 客户状态 / 分配方式的字典只在企业版读
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  await prisma.user.create({ data: { id: 我.id, email: "t@x", name: 我.name, title: "管理员", role: "ADMIN", password: "x" } });
  张伟 = (await prisma.user.create({ data: { email: "zw@x", name: "张伟", title: "销售", role: "SALES", password: "x" } })).id;
  李娜 = (await prisma.user.create({ data: { email: "ln@x", name: "李娜", title: "销售", role: "SALES", password: "x" } })).id;
  渠道甲 = (await prisma.channel.create({ data: { name: "虚构渠道甲|线上", platform: "虚构渠道甲", channelOwnerId: 张伟 } })).id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

describe("映射：客户全称 / 简称、新几格的表头", () => {
  it("「客户全称」落名称、「客户简称」落简称，地址、分配方式、联系人几格都认得", () => {
    const 列 = 规则猜列("customer", 客户头);
    expect(列).toMatchObject({
      客户全称: "name",
      客户简称: "shortName",
      客户状态: "custStatus",
      客户来源: "source",
      地址国家: "addrCountry",
      省份: "addrProvince",
      城市: "addrCity",
      区县: "addrDistrict",
      分配方式: "assignWay",
    });
    // 客户状态不会被认成跟进状态
    expect(Object.values(列)).not.toContain("followStatus");
    expect(规则猜列("contact", 联系人头)).toMatchObject({ 性别: "gender", 生日: "birthday", 爱好: "hobby", 联系人地址: "address" });
    expect(规则猜列("customer", ["客户名称", "简称"])).toEqual({ 客户名称: "name", 简称: "shortName" });
    expect(规则猜列("customer", ["没见过的列"])).toEqual({ 没见过的列: 进备注 });
  });
});

describe("新字段导进来", () => {
  it("客户：简称、国内地址、分配方式、客户状态、S 级、来源对上渠道都落对", async () => {
    const { r } = await 导([客户表()]);
    expect(r).toMatchObject({ 状态: "done", 完了: true, 新建: 2, 失败: 0 });
    const 甲 = (await 客户("测试甲科技有限公司"))!;
    expect(甲).toMatchObject({
      shortName: "测试甲",
      addrCountry: "中国",
      addrProvince: "浙江省",
      addrCity: "杭州市",
      addrDistrict: "西湖区",
      assignWay: "自持",
      custStatus: "意向",
      // 客户状态不串进跟进状态：跟进状态照默认
      followStatus: "待跟进",
      // 渠道直接推荐：三格都挂上，渠道负责人跟着渠道
      channelId: 渠道甲,
      attributionChannelId: 渠道甲,
      channelOwnerId: 张伟,
      remark: "老客户",
    });
    expect(甲.extra?.level).toBe("S");
  });

  it("客户：国外地址只留国家 + 城市，丢的省进备注；D 级并进 C；对不上的渠道、分配方式进备注，不中断", async () => {
    const { id, r } = await 导([客户表()]);
    expect(r.失败).toBe(0);
    const 乙 = (await 客户("测试乙贸易公司"))!;
    expect(乙).toMatchObject({ shortName: null, addrCountry: "美国", addrProvince: null, addrCity: "洛杉矶", addrDistrict: null, assignWay: null, channelId: null, attributionChannelId: null, custStatus: null });
    expect(乙.extra?.level).toBe("C");
    expect(乙.remark).toContain("省份：加州");
    expect(乙.remark).toContain("来源：没有这个渠道");
    expect(乙.remark).toContain("分配方式：乱写的方式");
    // 试跑报告里提醒过
    const 批 = await prisma.entImportBatch.findUniqueOrThrow({ where: { id } });
    expect(批.report).toContain("对不上我们的渠道");
  });

  it("来源写渠道全称也认；一段对上两个渠道的不猜", async () => {
    await prisma.channel.create({ data: { name: "虚构渠道乙|线上", platform: "虚构渠道乙", channelOwnerId: 李娜 } });
    await prisma.channel.create({ data: { name: "虚构渠道乙|线下", platform: "虚构渠道乙", channelOwnerId: 李娜 } });
    const 行 = (id: string, 名: string, 号: string, 来源: string) => [id, 名, "", 号, "张伟", "A", "", 来源, "", "", "", "", "", ""];
    await 导([客户表([行("C1", "测试丙有限公司", "13800000003", "虚构渠道甲|线上"), 行("C2", "测试丁有限公司", "13800000004", "虚构渠道乙")])]);
    expect((await 客户("测试丙有限公司"))?.channelId).toBe(渠道甲);
    const 丁 = (await 客户("测试丁有限公司"))!;
    expect(丁.channelId).toBeNull();
    expect(丁.remark).toContain("来源：虚构渠道乙");
  });

  it("联系人：性别、生日、爱好、地址落对；认不出的性别进备注", async () => {
    const { r } = await 导([
      客户表(),
      联系人表([
        ["P1", "C1", "虚构王经理", "采购", "13700000001", "wang@example.test", "男", "1990-05-06", "钓鱼", "杭州市西湖区虚构路 1 号"],
        ["P2", "C1", "虚构赵助理", "助理", "", "", "保密", "2月30日", "", ""],
      ]),
    ]);
    expect(r.失败).toBe(0);
    const 王 = await prisma.contact.findFirstOrThrow({ where: { name: "虚构王经理" } });
    expect(王).toMatchObject({ gender: "男", birthday: "1990-05-06", hobby: "钓鱼", address: "杭州市西湖区虚构路 1 号" });
    const 赵 = await prisma.contact.findFirstOrThrow({ where: { name: "虚构赵助理" } });
    expect(赵).toMatchObject({ gender: null, birthday: null });
    expect(赵.remark).toContain("性别：保密");
    expect(赵.remark).toContain("生日：2月30日");
  });
});

describe("号码进 ContactMethod 子表", () => {
  it("新客户的手机号记一行（不挂联系人）；联系人的手机、邮箱带上联系人；座机不进", async () => {
    await 导([
      客户表(),
      联系人表([
        ["P1", "C1", "虚构王经理", "采购", "13700000001", "Wang@Example.test", "", "", "", ""],
        ["P2", "C1", "虚构钱会计", "财务", "0571-88886666", "", "", "", "", ""],
      ]),
    ]);
    const 甲 = (await 客户("测试甲科技有限公司"))!;
    const 王 = await prisma.contact.findFirstOrThrow({ where: { name: "虚构王经理" } });
    const 钱 = await prisma.contact.findFirstOrThrow({ where: { name: "虚构钱会计" } });
    expect(钱.phone).toBe("057188886666");
    // 邮箱存原样，查重用的键是小写
    expect(await prisma.contactMethod.findFirstOrThrow({ where: { kind: "email" } })).toMatchObject({ numberKey: "wang@example.test" });
    expect(await 号们(甲.id)).toEqual([
      { contactId: 王.id, kind: "email", value: "Wang@Example.test" },
      { contactId: 王.id, kind: "phone", value: "13700000001" },
      { contactId: null, kind: "phone", value: "13800000001" },
    ]);
    const 乙 = (await 客户("测试乙贸易公司"))!;
    expect(await 号们(乙.id)).toEqual([{ contactId: null, kind: "phone", value: "13800000002" }]);
  });

  it("同步改了号：客户、联系人的旧号换成新号，不留重复", async () => {
    await 导([客户表(), 联系人表()]);
    await 导([
      客户表([["C1", ...甲行.slice(1, 3), "13800000009", ...甲行.slice(4)], 乙行]),
      联系人表([["P1", "C1", "虚构王经理", "采购", "13700000009", "wang@example.test", "男", "1990-05-06", "钓鱼", "杭州市西湖区虚构路 1 号"]]),
    ]);
    const 甲 = (await 客户("测试甲科技有限公司"))!;
    const 王 = await prisma.contact.findFirstOrThrow({ where: { name: "虚构王经理" } });
    expect(甲.phone).toBe("13800000009");
    expect(await 号们(甲.id)).toEqual([
      { contactId: 王.id, kind: "email", value: "wang@example.test" },
      { contactId: 王.id, kind: "phone", value: "13700000009" },
      { contactId: null, kind: "phone", value: "13800000009" },
    ]);
  });
});

describe("新列三方比对", () => {
  it("没给的格不动；我们没动的照原系统改；两边都改了记冲突、空值不算冲突", async () => {
    await 导([客户表(), 联系人表()]);
    const 甲 = (await 客户("测试甲科技有限公司"))!;
    // 我们这边改了简称
    await prisma.customer.update({ where: { id: 甲.id }, data: { shortName: "我们叫的简称" } });

    // 原系统：简称改了、城市改了、分配方式那格空了
    const 改行 = [...甲行];
    改行[2] = "原系统简称";
    改行[10] = "宁波市";
    改行[11] = "";
    改行[12] = "";
    const { r } = await 导([
      客户表([改行, 乙行]),
      联系人表([["P1", "C1", "虚构王经理", "采购", "13700000001", "wang@example.test", "男", "1990-05-06", "爬山", "杭州市西湖区虚构路 1 号"]]),
    ]);
    expect(r.冲突).toBe(1);
    const 现 = (await 客户("测试甲科技有限公司"))!;
    // 简称两边都改了：不覆盖、记冲突；城市我们没动，照原系统；分配方式那格空着：不清、不算冲突
    expect(现).toMatchObject({ shortName: "我们叫的简称", addrCity: "宁波市", assignWay: "自持" });
    const 冲 = await prisma.entConflict.findFirstOrThrow();
    expect(冲).toMatchObject({ entity: "customer", externalId: "C1" });
    expect(JSON.parse(冲.fields)).toEqual({ shortName: { 原系统: "原系统简称", 我们: "我们叫的简称", 上次: "测试甲" } });
    expect((await prisma.contact.findFirstOrThrow({ where: { name: "虚构王经理" } })).hobby).toBe("爬山");
  });

  it("这次表里没有新几列：一格都不动，不算冲突", async () => {
    await 导([客户表(), 联系人表()]);
    const 旧头 = ["记录ID", "客户全称", "手机号码", "客户负责人"];
    const { r } = await 导([
      表("客户.xlsx", "customer", 旧头, [
        ["C1", "测试甲科技有限公司", "13800000001", "张伟"],
        ["C2", "测试乙贸易公司", "13800000002", "李娜"],
      ]),
      表("联系人.xlsx", "contact", ["联系人ID", "客户ID", "姓名", "手机"], [["P1", "C1", "虚构王经理", "13700000001"]]),
    ]);
    expect(r.冲突).toBe(0);
    expect(await 客户("测试甲科技有限公司")).toMatchObject({ shortName: "测试甲", addrCity: "杭州市", assignWay: "自持", channelId: 渠道甲 });
    expect(await prisma.contact.findFirstOrThrow({ where: { name: "虚构王经理" } })).toMatchObject({ gender: "男", hobby: "钓鱼" });
  });

  it("渠道只补空：已挂了别的渠道 / 已有归属的不动、不算冲突；空着的照原系统挂上", async () => {
    const 渠道丙 = (await prisma.channel.create({ data: { name: "虚构渠道丙", channelOwnerId: 李娜 } })).id;
    await 导([客户表()]);
    const 甲 = (await 客户("测试甲科技有限公司"))!;
    const 乙 = (await 客户("测试乙贸易公司"))!;
    // 乙：原系统后来补上了来源
    const 乙改 = [...乙行];
    乙改[7] = "虚构渠道丙";
    // 甲：原系统换了来源，但我们这边已经挂着渠道甲
    const 甲改 = [...甲行];
    甲改[7] = "虚构渠道丙";
    const { r } = await 导([客户表([甲改, 乙改])]);
    expect(r.冲突).toBe(0);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 甲.id } })).channelId).toBe(渠道甲);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: 乙.id } })).toMatchObject({ channelId: 渠道丙, attributionChannelId: 渠道丙, channelOwnerId: 李娜 });
  });

  it("同号连上我们早有的客户：新几格只补空，已有归属的不挂渠道", async () => {
    const 甲老 = await prisma.customer.create({ data: { name: "甲（老档）", phone: "13800000001", salesOwnerId: 张伟, followStatus: "跟进中", addrCity: "我们填的城市" } });
    const 推荐人 = await prisma.customer.create({ data: { name: "虚构推荐人", phone: "13900000000", salesOwnerId: 张伟, followStatus: "跟进中" } });
    const 乙老 = await prisma.customer.create({ data: { name: "乙（老档）", phone: "13800000002", salesOwnerId: 李娜, followStatus: "跟进中", referrerCustomerId: 推荐人.id } });
    const 乙改 = [...乙行];
    乙改[7] = "虚构渠道甲";
    await 导([客户表([甲行, 乙改])]);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: 甲老.id } })).toMatchObject({
      name: "甲（老档）",
      shortName: "测试甲",
      assignWay: "自持",
      addrCity: "我们填的城市",
      channelId: 渠道甲,
    });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: 乙老.id } })).toMatchObject({ channelId: null, referrerCustomerId: 推荐人.id });
  });
});

describe("整批撤回 / 恢复带上新列和子表的号", () => {
  it("新建的撤掉：客户、联系人、子表的号一起清；恢复后新列、渠道、号都回来", async () => {
    const { id } = await 导([客户表(), 联系人表()]);
    expect(await prisma.contactMethod.count()).toBe(4);

    expect(await 撤回一批(id, 我)).toMatchObject({ 状态: "reverted", 完了: true, 删掉: 3, 留下数: 0 });
    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.contact.count()).toBe(0);
    expect(await prisma.contactMethod.count()).toBe(0);

    expect(await 恢复一批(id, 我)).toMatchObject({ 状态: "done", 完了: true, 恢复: 3 });
    const 甲 = (await 客户("测试甲科技有限公司"))!;
    expect(甲).toMatchObject({ shortName: "测试甲", addrProvince: "浙江省", assignWay: "自持", custStatus: "意向", channelId: 渠道甲, attributionChannelId: 渠道甲 });
    expect(甲.extra?.level).toBe("S");
    const 王 = await prisma.contact.findFirstOrThrow({ where: { name: "虚构王经理" } });
    expect(王).toMatchObject({ gender: "男", birthday: "1990-05-06", hobby: "钓鱼" });
    expect(await 号们(甲.id)).toEqual([
      { contactId: 王.id, kind: "email", value: "wang@example.test" },
      { contactId: 王.id, kind: "phone", value: "13700000001" },
      { contactId: null, kind: "phone", value: "13800000001" },
    ]);
    expect(await prisma.contactMethod.count()).toBe(4);

    // 再撤一次照样干净
    expect(await 撤回一批(id, 我)).toMatchObject({ 状态: "reverted", 删掉: 3 });
    expect(await prisma.contactMethod.count()).toBe(0);
  });

  it("同步改的新列：撤回这一批改回上次的值，号也换回来", async () => {
    await 导([客户表(), 联系人表()]);
    const 改行 = [...甲行];
    改行[2] = "原系统简称";
    改行[3] = "13800000009";
    改行[10] = "宁波市";
    const { id } = await 导([
      客户表([改行, 乙行]),
      联系人表([["P1", "C1", "虚构王经理", "采购", "13700000001", "wang@example.test", "女", "1990-05-06", "爬山", "杭州市西湖区虚构路 1 号"]]),
    ]);
    const 甲 = (await 客户("测试甲科技有限公司"))!;
    expect(甲).toMatchObject({ shortName: "原系统简称", addrCity: "宁波市", phone: "13800000009" });

    expect(await 撤回一批(id, 我)).toMatchObject({ 状态: "reverted", 还原: 2, 留下数: 0 });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: 甲.id } })).toMatchObject({ shortName: "测试甲", addrCity: "杭州市", phone: "13800000001" });
    expect(await prisma.contact.findFirstOrThrow({ where: { name: "虚构王经理" } })).toMatchObject({ gender: "男", hobby: "钓鱼" });
    expect((await 号们(甲.id)).filter((x) => x.contactId === null)).toEqual([{ contactId: null, kind: "phone", value: "13800000001" }]);
  });

  it("同号连上早有的客户：补的新几格、挂的渠道撤回后改回空；恢复再补上", async () => {
    const 老 = await prisma.customer.create({ data: { name: "甲（老档）", phone: "13800000001", salesOwnerId: 张伟, followStatus: "跟进中" } });
    const id = await 跑([客户表([甲行])]);
    await 写一批(id, 我);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: 老.id } })).toMatchObject({ shortName: "测试甲", channelId: 渠道甲 });

    expect(await 撤回一批(id, 我)).toMatchObject({ 还原: 1, 留下数: 0 });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: 老.id } })).toMatchObject({
      shortName: null,
      addrCountry: null,
      addrCity: null,
      assignWay: null,
      channelId: null,
      attributionChannelId: null,
    });

    await 恢复一批(id, 我);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: 老.id } })).toMatchObject({ shortName: "测试甲", assignWay: "自持", channelId: 渠道甲 });
  });
});

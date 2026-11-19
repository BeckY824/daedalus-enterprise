/**
 * 企业版项目所在地 + 项目级别（P11 定稿 -2 版，10-29，迁移 093；详细地址存 087 的 location）。
 *
 * 钉的是：
 *   - 项目区域（纯函数）：国家空 = 空串；国内取市，省是香港 / 澳门 / 台湾时取省；国外取国家（「中国香港」之类当国外，取国家）；
 *     China / 中国大陆 算国内；国内没填市就是空串（不拿省顶）
 *   - 级别星：S=4、A=3、B=2、C=1，满星 4；补齐空心、不补只给实心；没分级、认不出的空串
 *   - 规整详细地址：去空白、空 = 清掉、超长报错不截断、不是字符串报错
 *   - 项目级别和地址改成：没传 = 不动；级别只认 S/A/B/C（D、乱写拦下），空 = 清掉；
 *     地址传了哪几格就和原来拼起来过 规整地址（国外清省 / 区县，国内国家统一存「中国」，每格超长报错）
 *   - 改项目（真库）：级别、四格、详细地址存得进读得出；没变不写；坏值拦下库里不动；同事改不了；不是企业版传了也不动
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 改项目 } from "@/lib/project/db";
import { 项目区域, 规整详细地址, 详细地址上限, 项目级别和地址改成, type 项目级别和地址 } from "@/lib/project/profile-rules";
import { 级别星, 级别星数, 满星 } from "@/lib/enterprise/level-stars";
import { 地址每格上限 } from "@/lib/enterprise/customer-v2";

const 地 = (addrCountry: string | null, addrProvince: string | null = null, addrCity: string | null = null, addrDistrict: string | null = null) => ({ addrCountry, addrProvince, addrCity, addrDistrict });

describe("项目区域", () => {
  it("国家为空返回空串（省市填了也一样）", () => {
    expect(项目区域(地(null))).toBe("");
    expect(项目区域(地("  ", "广东省", "深圳市"))).toBe("");
    expect(项目区域(null)).toBe("");
    expect(项目区域(undefined)).toBe("");
  });

  it("国内取市；China / 中国大陆 也算国内", () => {
    expect(项目区域(地("中国", "广东省", "深圳市", "南山区"))).toBe("深圳市");
    expect(项目区域(地("China", "浙江省", " 杭州市 "))).toBe("杭州市");
    expect(项目区域(地("中国大陆", "北京市", "北京市"))).toBe("北京市");
    // 国内没填市：按定稿取市 = 空串，不拿省顶
    expect(项目区域(地("中国", "广东省"))).toBe("");
  });

  it("国内、省是香港 / 澳门 / 台湾时取省", () => {
    expect(项目区域(地("中国", "香港", "九龙"))).toBe("香港");
    expect(项目区域(地("中国", "澳门特别行政区", "氹仔"))).toBe("澳门特别行政区");
    expect(项目区域(地("中国", "台湾省", "台北市"))).toBe("台湾省");
    expect(项目区域(地("中国", "中国台湾", "高雄市"))).toBe("中国台湾");
  });

  it("国外取国家；国家候选里的「中国香港」是当国外存的，也取国家", () => {
    expect(项目区域(地("美国", null, "Los Angeles"))).toBe("美国");
    expect(项目区域(地(" Germany ", null, "Berlin"))).toBe("Germany");
    expect(项目区域(地("中国香港", null, "九龙"))).toBe("中国香港");
  });
});

describe("级别星", () => {
  it("映射：S=4、A=3、B=2、C=1，满星 4", () => {
    expect(级别星数).toEqual({ S: 4, A: 3, B: 2, C: 1 });
    expect(满星).toBe(4);
  });

  it("F-客户-01：去星标只给字母（第二个参数留着兼容、不起作用）；没分级、认不出的空串", () => {
    expect(级别星("S")).toBe("S");
    expect(级别星("A")).toBe("A");
    expect(级别星("C")).toBe("C");
    expect(级别星("B", false)).toBe("B");
    expect(级别星(null)).toBe("");
    expect(级别星("")).toBe("");
    expect(级别星("D")).toBe("");
    expect(级别星("toString")).toBe("");
  });
});

describe("规整详细地址", () => {
  it("去两头空格、中间空白并成一个；空 = 清掉", () => {
    expect(规整详细地址("  科技园  南区 3 栋 ")).toEqual({ ok: true, 值: "科技园 南区 3 栋" });
    expect(规整详细地址("   ")).toEqual({ ok: true, 值: null });
    expect(规整详细地址(null)).toEqual({ ok: true, 值: null });
  });

  it("超长报错不截断；不是字符串报错", () => {
    expect(规整详细地址("一".repeat(详细地址上限))).toEqual({ ok: true, 值: "一".repeat(详细地址上限) });
    expect(规整详细地址("一".repeat(详细地址上限 + 1))).toMatchObject({ ok: false, error: expect.stringContaining(String(详细地址上限)) });
    expect(规整详细地址(12)).toMatchObject({ ok: false });
  });
});

describe("项目级别和地址改成", () => {
  const 原: 项目级别和地址 = { level: "B", ...地("中国", "广东省", "深圳市", "南山区"), location: "科技园" };

  it("什么都没传 = 原样", () => {
    expect(项目级别和地址改成({}, 原)).toEqual({ ok: true, 值: 原 });
  });

  it("级别：S/A/B/C 认（小写也认）、空 = 清掉；D、乱写拦下", () => {
    expect(项目级别和地址改成({ level: "s" }, 原)).toMatchObject({ ok: true, 值: { level: "S" } });
    expect(项目级别和地址改成({ level: "" }, 原)).toMatchObject({ ok: true, 值: { level: null } });
    expect(项目级别和地址改成({ level: null }, 原)).toMatchObject({ ok: true, 值: { level: null } });
    expect(项目级别和地址改成({ level: "D" }, 原)).toMatchObject({ ok: false, error: expect.stringContaining("S / A / B / C") });
    expect(项目级别和地址改成({ level: "很重要" }, 原)).toMatchObject({ ok: false });
  });

  it("地址只传一格：和原来的拼起来整套规整", () => {
    expect(项目级别和地址改成({ addrDistrict: "福田区" }, 原)).toMatchObject({ ok: true, 值: { ...地("中国", "广东省", "深圳市", "福田区"), level: "B", location: "科技园" } });
  });

  it("换成国外：省、区县清掉，只留国家 + 城市；国内叫法统一存「中国」", () => {
    expect(项目级别和地址改成({ addrCountry: "美国", addrCity: "Los Angeles" }, 原)).toMatchObject({ ok: true, 值: 地("美国", null, "Los Angeles", null) });
    expect(项目级别和地址改成({ addrCountry: "china" }, 原)).toMatchObject({ ok: true, 值: 地("中国", "广东省", "深圳市", "南山区") });
    expect(项目级别和地址改成({ addrCountry: null, addrProvince: null, addrCity: null, addrDistrict: null }, 原)).toMatchObject({ ok: true, 值: 地(null) });
  });

  it("地址每格超长、详细地址超长都报错", () => {
    expect(项目级别和地址改成({ addrCity: "长".repeat(地址每格上限 + 1) }, 原)).toMatchObject({ ok: false, error: expect.stringContaining(String(地址每格上限)) });
    expect(项目级别和地址改成({ location: "长".repeat(详细地址上限 + 1) }, 原)).toMatchObject({ ok: false, error: expect.stringContaining("详细地址") });
  });
});

describe("改项目：级别 + 所在地（真库）", () => {
  let 乙: { id: string; role: string };
  let 丙: { id: string; role: string };
  let 项目id: string;
  const 读 = () => prisma.project.findUniqueOrThrow({ where: { id: 项目id }, select: { level: true, addrCountry: true, addrProvince: true, addrCity: true, addrDistrict: true, location: true } });
  const 人 = async (email: string, role: string) => ({ id: (await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } })).id, role });
  const 基 = { name: "QA-所在地项目", amount: 0 };

  beforeEach(async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await resetDb();
    乙 = await 人("p11l-yi", "SALES");
    丙 = await 人("p11l-bing", "SALES");
    // 11-01 权限只认业务角色：乙、丙都是销售，乙是负责人
    await prisma.entMember.createMany({ data: [{ userId: 乙.id, bizRole: "sales" }, { userId: 丙.id, bizRole: "sales" }] });
    const 客户 = await prisma.customer.create({ data: { name: "QA-所在地客户", phone: "13800001093", salesOwnerId: 乙.id } });
    项目id = (await prisma.project.create({ data: { name: 基.name, customerId: 客户.id, ownerId: 乙.id, creatorId: 乙.id } })).id;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("级别、四格、详细地址存得进读得出；再交一遍一样的不算变", async () => {
    const r = await 改项目(乙, 项目id, { ...基, level: "A", addrCountry: "中国", addrProvince: "广东省", addrCity: "深圳市", addrDistrict: "南山区", location: " 科技园 3 栋 " });
    expect(r).toMatchObject({ ok: true });
    expect(new Set(r.变了)).toEqual(new Set(["level", "addrCountry", "addrProvince", "addrCity", "addrDistrict", "location"]));
    expect(await 读()).toEqual({ level: "A", ...地("中国", "广东省", "深圳市", "南山区"), location: "科技园 3 栋" });
    expect(await 改项目(乙, 项目id, { ...基, level: "A", addrCountry: "中国", addrProvince: "广东省", addrCity: "深圳市", addrDistrict: "南山区", location: "科技园 3 栋" })).toEqual({ ok: true, 变了: [] });
    // 不传级别和地址（老的编辑框、别的入口）= 不动
    expect(await 改项目(乙, 项目id, { ...基, amount: 10 })).toMatchObject({ ok: true, 变了: ["amount"] });
    expect((await 读()).level).toBe("A");
  });

  it("换国外：省、区县清掉；级别清掉存 null", async () => {
    await 改项目(乙, 项目id, { ...基, level: "S", addrCountry: "中国", addrProvince: "广东省", addrCity: "深圳市", addrDistrict: "南山区" });
    expect(await 改项目(乙, 项目id, { ...基, level: null, addrCountry: "美国", addrProvince: "广东省", addrCity: "Los Angeles", addrDistrict: "南山区" })).toMatchObject({ ok: true });
    expect(await 读()).toEqual({ level: null, ...地("美国", null, "Los Angeles", null), location: null });
  });

  it("坏值拦下，库里不动：D 级、超长的格", async () => {
    await 改项目(乙, 项目id, { ...基, level: "B", addrCity: "杭州市" });
    expect(await 改项目(乙, 项目id, { ...基, level: "D" })).toMatchObject({ ok: false, error: expect.stringContaining("项目级别") });
    expect(await 改项目(乙, 项目id, { ...基, addrCity: "长".repeat(地址每格上限 + 1) })).toMatchObject({ ok: false });
    expect(await 改项目(乙, 项目id, { ...基, location: "长".repeat(详细地址上限 + 1) })).toMatchObject({ ok: false });
    expect(await 读()).toEqual({ level: "B", ...地("中国", null, "杭州市", null), location: null });
  });

  it("同事改不了", async () => {
    expect(await 改项目(丙, 项目id, { ...基, level: "S" })).toMatchObject({ ok: false, error: expect.stringContaining("项目负责人") });
    expect((await 读()).level).toBeNull();
  });

  it("不是企业版：传了也不动", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 改项目(乙, 项目id, { ...基, level: "S", addrCity: "杭州市", location: "某路 1 号" })).toEqual({ ok: true, 变了: [] });
    expect(await 读()).toEqual({ level: null, ...地(null), location: null });
  });
});

/**
 * 项目标签（迁移 153，F-项目-14）：和项目级别是两列、各自填、互不关联（11-08 定）。
 * 钉的是：选字典 projTag 里启用着的存得进；不在字典里的拦下；清空存 null；改标签不碰级别、改级别不碰标签；
 * 停用了还留着的那项再交一遍不拦；不是企业版传了也不动；老项目从空开始
 */
describe("改项目：项目标签（真库）", () => {
  let 乙: { id: string; role: string };
  let 项目id: string;
  const 读 = () => prisma.project.findUniqueOrThrow({ where: { id: 项目id }, select: { level: true, projTag: true } });
  const 基 = { name: "QA-标签项目", amount: 0 };

  beforeEach(async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await resetDb();
    乙 = { id: (await prisma.user.create({ data: { email: "tag-yi", name: "tag-yi", title: "", role: "SALES", password: "x" } })).id, role: "SALES" };
    await prisma.entMember.create({ data: { userId: 乙.id, bizRole: "sales" } });
    const 客户 = await prisma.customer.create({ data: { name: "QA-标签客户", phone: "13800001153", salesOwnerId: 乙.id } });
    项目id = (await prisma.project.create({ data: { name: 基.name, customerId: 客户.id, ownerId: 乙.id, creatorId: 乙.id, level: "S" } })).id;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("老项目从空开始：有级别、没标签", async () => {
    expect(await 读()).toEqual({ level: "S", projTag: null });
  });

  it("选字典里的一项存得进；改标签不碰级别，改级别不碰标签；清空存 null", async () => {
    expect(await 改项目(乙, 项目id, { projTag: " B 潜力跟进 " })).toMatchObject({ ok: true, 变了: ["projTag"] });
    expect(await 读()).toEqual({ level: "S", projTag: "B 潜力跟进" });
    expect(await 改项目(乙, 项目id, { level: "C" })).toMatchObject({ ok: true, 变了: ["level"] });
    expect(await 读()).toEqual({ level: "C", projTag: "B 潜力跟进" });
    expect(await 改项目(乙, 项目id, { projTag: "B 潜力跟进" })).toEqual({ ok: true, 变了: [] });
    expect(await 改项目(乙, 项目id, { projTag: null })).toMatchObject({ ok: true, 变了: ["projTag"] });
    expect(await 读()).toEqual({ level: "C", projTag: null });
  });

  it("不在字典里的拦下、库里不动；拿级别字母顶也不行", async () => {
    expect(await 改项目(乙, 项目id, { projTag: "D 随便" })).toMatchObject({ ok: false, error: expect.stringContaining("项目标签") });
    expect(await 改项目(乙, 项目id, { projTag: "S" })).toMatchObject({ ok: false });
    expect(await 读()).toEqual({ level: "S", projTag: null });
  });

  it("停用了还留着的那项：再交一遍不拦；换成停用的那项拦下", async () => {
    await 改项目(乙, 项目id, { projTag: "C 正常培育" });
    await prisma.entDictItem.updateMany({ where: { kind: "projTag", name: "C 正常培育" }, data: { active: false } });
    expect(await 改项目(乙, 项目id, { projTag: "C 正常培育", amount: 5 })).toMatchObject({ ok: true, 变了: ["amount"] });
    await 改项目(乙, 项目id, { projTag: "A 重点推进" });
    expect(await 改项目(乙, 项目id, { projTag: "C 正常培育" })).toMatchObject({ ok: false });
    expect((await 读()).projTag).toBe("A 重点推进");
  });

  it("不是企业版：传了也不动", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 改项目(乙, 项目id, { ...基, projTag: "A 重点推进" })).toEqual({ ok: true, 变了: [] });
    expect((await 读()).projTag).toBeNull();
  });
});

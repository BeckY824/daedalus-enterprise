/**
 * 客户抬头（11-17 客户抬头 PR-5，lib/enterprise/customer-title.ts，P-抬头-06～12）：
 *   - 答复 2.4 的 6 个原例 + 计划第 1 节 4 个边界例，逐条钉住（名字都是造的）；
 *   - 区域段取最小一级、原值不去后缀（Q4a）、国外有城市取城市；主体段简称优先；全空先判 → 编号|节点，零项目只写编号；没填按 empty-value 认；
 *   - 客户显名（relate-names 转导出）口径不变；
 *   - 抬头节点们：最近有动静、没删的项目，含公海、不按看的人算（U9），有结局写结局；一页一句、没人要查就不查
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 客户抬头, 客户显名, 区域段, 要查节点, 抬头节点们, type 抬头料 } from "@/lib/enterprise/customer-title";
import { 客户显名 as 转导出的客户显名 } from "@/lib/project/relate-names";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";

const 客 = (x: Partial<抬头料>): 抬头料 => ({ id: "c1xyz789", customerNo: 1237, ...x });

describe("答复 2.4 的 6 个原例（按简称优先核过）", () => {
  it("有县级市、有全称（没有简称）→ 县级市|全称", () => {
    expect(客户抬头(客({ addrProvince: "浙江省", addrCity: "金华市", addrDistrict: "义乌市", name: "义乌市某某贸易有限公司" }))).toBe("义乌市|义乌市某某贸易有限公司");
  });
  it("有县级市、无全称、简称「某某」→ 县级市|简称", () => {
    expect(客户抬头(客({ addrDistrict: "义乌市", name: "", shortName: "某某" }))).toBe("义乌市|某某");
  });
  it("有县级市、无全称无简称、类型 → 县级市|类型（字典原名）", () => {
    expect(客户抬头(客({ addrDistrict: "义乌市", name: "", customerType: "国家代理商" }))).toBe("义乌市|国家代理商");
  });
  it("有县级市、类型也空 → 县级市|当前节点", () => {
    expect(客户抬头(客({ addrDistrict: "义乌市", name: "" }), "痛点挖掘")).toBe("义乌市|痛点挖掘");
  });
  it("只有国家、有全称 → 国家|全称", () => {
    expect(客户抬头(客({ addrCountry: "美国", name: "某某有限公司" }))).toBe("美国|某某有限公司");
  });
  it("客户名、区域、类型全空 → 客户编号|当前节点（先判全空）", () => {
    expect(客户抬头(客({ name: "" }), "痛点挖掘")).toBe("NO.01237|痛点挖掘");
  });
});

describe("计划第 1 节 4 个边界例", () => {
  it("有县级市、有全称、也有简称 → 简称优先", () => {
    expect(客户抬头(客({ addrDistrict: "义乌市", name: "义乌市某某贸易有限公司", shortName: "某某" }))).toBe("义乌市|某某");
  });
  it("零项目客户、全空 → 只写客户编号；回填前没编号的写短号", () => {
    expect(客户抬头(客({ name: "" }))).toBe("NO.01237");
    expect(客户抬头(客({ name: "" }), null)).toBe("NO.01237");
    expect(客户抬头(客({ name: "", customerNo: null }))).toBe("#XYZ789");
  });
  it("国外：国家阿联酋、城市迪拜 → 取城市", () => {
    expect(客户抬头(客({ addrCountry: "阿拉伯联合酋长国", addrCity: "迪拜", name: "某某贸易公司" }))).toBe("迪拜|某某贸易公司");
  });
  it("区域照库里原值、不去后缀（Q4a）；只取最小一级、不叠加", () => {
    expect(客户抬头(客({ addrCountry: "中国", addrProvince: "浙江省", addrCity: "杭州市", name: "某某公司" }))).toBe("杭州市|某某公司");
    expect(客户抬头(客({ addrCountry: "中国", addrProvince: "浙江省", name: "某某公司" }))).toBe("浙江省|某某公司");
    expect(客户抬头(客({ addrDistrict: "朝阳区", addrCity: "北京市", name: "某某公司" }))).toBe("朝阳区|某某公司");
  });
});

describe("拼接与没填", () => {
  it("只有区域、没有节点 → 只写区域；只有主体 → 只写主体", () => {
    expect(客户抬头(客({ addrCity: "迪拜", name: "" }))).toBe("迪拜");
    expect(客户抬头(客({ name: "某某公司" }))).toBe("某某公司");
    expect(客户抬头(客({ customerType: "终端客户", name: "" }))).toBe("终端客户");
  });
  it("横线、空白、旧占位词都算没填；换行和连续空白收成一个空格，分隔符两边不加空格", () => {
    expect(客户抬头(客({ addrDistrict: " — ", addrCity: "  ", addrProvince: "-", addrCountry: "暂不确认", name: "  ", shortName: "－", customerType: "暂未确认" }), " 痛点挖掘 ")).toBe("NO.01237|痛点挖掘");
    expect(客户抬头(客({ addrCity: " 迪拜 ", name: "某某\n贸易   公司 " }))).toBe("迪拜|某某 贸易 公司");
  });
  it("有主体时不用节点（节点给了也不摆）", () => {
    expect(客户抬头(客({ addrCity: "迪拜", name: "某某公司" }), "痛点挖掘")).toBe("迪拜|某某公司");
  });
  it("区域段：区县 → 市 → 省 → 国家", () => {
    expect(区域段({ addrCountry: "中国", addrProvince: "浙江省", addrCity: "金华市", addrDistrict: "义乌市" })).toBe("义乌市");
    expect(区域段({ addrCountry: "中国" })).toBe("中国");
    expect(区域段({})).toBe("");
  });
  it("要查节点：简称、全称、类型都空才要（区域有没有不管）", () => {
    expect(要查节点({ name: "", shortName: null, customerType: "—" })).toBe(true);
    expect(要查节点({ name: "某某公司" })).toBe(false);
    expect(要查节点({ name: "", shortName: "某某" })).toBe(false);
    expect(要查节点({ name: "", customerType: "终端客户" })).toBe(false);
  });
  /* 存量名字（M-导入-54 补的「姓名｜国家」、「暂无名称｜…」）S-6 清理前原样当全称：抬头会把国家写两遍（全角「｜」是名字里的、半角「|」是分隔），
     怎么显示待用户定（批次 23 待用户定），这里先钉住现在的样子，改口径时一起改 */
  it("存量「某某｜国家」「暂无名称｜…」名字：现在原样当全称", () => {
    expect(客户抬头(客({ addrCountry: "美国", name: "暂无名称｜美国" }))).toBe("美国|暂无名称｜美国");
    expect(客户抬头(客({ addrCountry: "美国", addrCity: "洛杉矶", name: "某某｜美国" }))).toBe("洛杉矶|某某｜美国");
  });
});

describe("客户显名（关联客户那些地方）并进抬头文件，口径不变", () => {
  it("简称 → 全称 → 编号（没给编号 / 回填前是短号）；relate-names 转导出的是同一个", () => {
    expect(转导出的客户显名).toBe(客户显名);
    expect(客户显名({ id: "c1xyz789", name: "某某有限公司", shortName: " 某某 " })).toBe("某某");
    expect(客户显名({ id: "c1xyz789", name: " 某某有限公司 ", shortName: "  " })).toBe("某某有限公司");
    expect(客户显名({ id: "c1xyz789", name: "", shortName: null })).toBe("#XYZ789");
    expect(客户显名({ id: "c1xyz789", name: "", customerNo: 12 })).toBe("NO.00012");
  });
});

describe("抬头节点们：一页一句，含公海、不按看的人算", () => {
  let 甲: string, 乙: string;
  const 时 = (分: number) => new Date(Date.UTC(2026, 10, 1, 8, 分));
  async function 造客户(data: { name?: string; shortName?: string | null; customerType?: string | null; addrCity?: string | null; customerNo?: number }) {
    return prisma.customer.create({ data: { name: "", phone: "", salesOwnerId: 甲, ...data } });
  }
  async function 造项目(customerId: string, x: { phase?: string; node?: string; result?: string | null; updatedAt: Date; pooledAt?: Date | null; deletedAt?: Date | null; ownerId?: string }) {
    const { updatedAt, ...其余 } = x;
    const p = await prisma.project.create({ data: { name: "项目", customerId, ownerId: 其余.ownerId ?? 甲, creatorId: 其余.ownerId ?? 甲, ...其余 } });
    // updatedAt 是 @updatedAt，建的时候盖成现在，另写一遍
    await prisma.$executeRawUnsafe(`UPDATE "Project" SET "updatedAt" = ? WHERE id = ?`, updatedAt, p.id);
    return p;
  }

  afterEach(() => { vi.unstubAllEnvs(); });
  beforeEach(async () => {
    await resetDb();
    忘掉企业版范围();
    甲 = (await prisma.user.create({ data: { email: "t-jia@x", name: "甲", title: "", role: "SALES", password: "x" } })).id;
    乙 = (await prisma.user.create({ data: { email: "t-yi@x", name: "乙", title: "", role: "SALES", password: "x" } })).id;
  });

  it("最近有动静的那个：没删的、含公海；有结局写结局、异常写「异常 · 节点」；一样新取节点靠后的；零项目不给；不要查的不给", async () => {
    const 公海那位 = await 造客户({ customerNo: 1 });
    await 造项目(公海那位.id, { phase: "线索", node: "线索验证", updatedAt: 时(1) });
    await 造项目(公海那位.id, { phase: "商机", node: "方案敲定", updatedAt: 时(5), pooledAt: 时(5) });
    await 造项目(公海那位.id, { phase: "订单", node: "尾款结算", updatedAt: 时(9), deletedAt: 时(9) });
    const 有结局 = await 造客户({ customerNo: 2 });
    await 造项目(有结局.id, { phase: "商机", node: "方案敲定", result: "丢单", updatedAt: 时(3) });
    const 异常 = await 造客户({ customerNo: 3, addrCity: "迪拜" });
    await 造项目(异常.id, { phase: "订单", node: "物流运输", result: "异常状态", updatedAt: 时(3) });
    const 一样新 = await 造客户({ customerNo: 4 });
    await 造项目(一样新.id, { phase: "线索", node: "潜客培育", updatedAt: 时(2) });
    await 造项目(一样新.id, { phase: "商机", node: "痛点挖掘", updatedAt: 时(2) });
    const 零项目 = await 造客户({ customerNo: 5 });
    const 有名字 = await 造客户({ name: "某某公司", customerNo: 6 });
    await 造项目(有名字.id, { phase: "商机", node: "方案敲定", updatedAt: 时(1) });

    const 们 = [公海那位, 有结局, 异常, 一样新, 零项目, 有名字];
    const 节点 = await 抬头节点们(prisma, 们);
    expect(节点).toEqual({ [公海那位.id]: "方案敲定", [有结局.id]: "丢单", [异常.id]: "异常 · 物流运输", [一样新.id]: "痛点挖掘" });
    expect(们.map((c) => 客户抬头(c, 节点[c.id]))).toEqual(["NO.00001|方案敲定", "NO.00002|丢单", "迪拜|异常 · 物流运输", "NO.00004|痛点挖掘", "NO.00005", "某某公司"]);
  });

  it("不按看的人算：乙的项目甲看不到（限定层滤掉），甲打开时抬头节点照样取到（人人看到的抬头一样）", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    invalidateSettingsCache();
    await setSetting("enterprise.rule.org_scope", true);
    await prisma.entMember.create({ data: { userId: 甲, bizRole: "sales" } });
    await prisma.entMember.create({ data: { userId: 乙, bizRole: "sales" } });
    忘掉企业版范围();
    const c = await 造客户({ customerNo: 7 });
    await 造项目(c.id, { phase: "商机", node: "成交推进", updatedAt: 时(4), ownerId: 乙 });
    // 限定层真开着：甲经 prisma 读项目读不到乙的
    expect(await 以谁的身份(甲, () => prisma.project.count({ where: { customerId: c.id } }))).toBe(0);
    const 甲看 = await 以谁的身份(甲, () => 抬头节点们(prisma, [c]));
    const 乙看 = await 以谁的身份(乙, () => 抬头节点们(prisma, [c]));
    expect(甲看).toEqual({ [c.id]: "成交推进" });
    expect(乙看).toEqual(甲看);
  });

  it("查询条数：一页 50 位里有 0 / 1 / 50 位要查节点 → 0 / 1 / 1 句（不随行数加）", async () => {
    let 句 = 0;
    const 数着: Parameters<typeof 抬头节点们>[0] = {
      $queryRawUnsafe: <T,>(sql: string, ...v: unknown[]) => { 句++; return prisma.$queryRawUnsafe<T>(sql, ...v); },
    };
    const 要查 = await Promise.all(Array.from({ length: 50 }, (_, i) => 造客户({ customerNo: 100 + i })));
    for (const c of 要查) await 造项目(c.id, { phase: "线索", node: "线索验证", updatedAt: 时(1) });
    const 不要查 = 要查.map((c) => ({ ...c, name: "某某公司" }));

    expect(await 抬头节点们(数着, 不要查)).toEqual({});
    expect(句).toBe(0);
    句 = 0;
    const 一位 = await 抬头节点们(数着, [要查[0], ...不要查.slice(1)]);
    expect(Object.keys(一位)).toEqual([要查[0].id]);
    expect(句).toBe(1);
    句 = 0;
    const 全部 = await 抬头节点们(数着, 要查);
    expect(Object.keys(全部)).toHaveLength(50);
    expect(句).toBe(1);
    expect(await 抬头节点们(数着, [])).toEqual({});
    expect(句).toBe(1);
  });
});

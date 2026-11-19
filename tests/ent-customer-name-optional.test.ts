/**
 * 企业版客户名称选填（11-19 用户：「新增客户里面：客户名称设为不必填。这个包括 AI 录入什么都是一样的，找到所有入口进行统一」）。
 *
 *   建档：saveCustomer（新建弹窗 / 建档向导 / 只建客户都落到这里）空名照存空串、照样取客户编号；只有空格的当没填；非企业版照旧必填
 *   就地改：资料卡全称能清空（patchCustomer）
 *   AI 建档卡：名称空着不算缺项、确认后建得成；项目名跟客户起 = 全称或显名（客户编号），不落「潜在项目」、不拿联系人姓名、号码顶
 *   粘贴切人导入（首页粘一段 → 导入抽屉）：企业版没名称的行照导；跟进导出、背调「像你的老客户」叫显名
 *   全称灰字（PR-7 摘来）：没填 → 怎么显示；像人名 → 提醒，都不拦；三处名称框提示统一「单位名称，可留空」
 *   粘贴切人导入的对列（企业版）：「联系人 / 姓名」列落主要联系人、只认明确的单位名称进全称（P-抬头-13）；桌面端映射不动
 *   显示兜底：客户显名 = 简称 → 全称 → 客户编号（回填前短号），永远不空；日志不出空引号；潜客培育项目名不空；分给你通知不因名字空被吞
 *   查重：空名不参与按名字的查重——两位都没名字、号码不同的客户互不相撞；导入查重索引里空名不建键
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "tester-id", name: "测试员", email: "t", role: "ADMIN", title: "" } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { saveCustomer, patchCustomer } from "@/app/(app)/customers/actions";
import { applyProposal } from "@/app/(app)/dashboard/apply";
import { buildProposal, missingFields } from "@/lib/agent/proposals";
import { SCHEMAS } from "@/lib/agent/schemas";
import { DEFAULT_BUSINESS } from "@/lib/business-config";
import { 客户名查重 } from "@/lib/enterprise/dupe-ledger";
import { 读导入查重索引 } from "@/lib/enterprise-import/dedup";
import { 撞已有客户 } from "@/lib/enterprise-import/clean";
import { 客户显名, 客户引, 全称或显名, 客户抬头 } from "@/lib/enterprise/customer-title";
import { 分给你通知 } from "@/lib/enterprise/notice-sources";
import { 潜在项目名 } from "@/lib/project/relate-names";
import { 全称像人名, 全称提示, 没填全称提示, 像人名提示 } from "@/lib/enterprise/fullname-hint";
import { 摊开 } from "@/lib/import/plan";
import { 字段表, 猜列 } from "@/lib/import/fields";
import { 执行导入, 撤销批次 } from "@/app/(app)/customers/import-actions";
import { 清空暂存 } from "@/lib/import/staging";
import { 导出客户 } from "@/app/(app)/customers/export-action";
import { 老客户清单 } from "@/lib/research/similar";

let 销售: string;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("business", { projectMode: true });
  mocks.user = { id: "tester-id", name: "测试员", email: "t", role: "ADMIN", title: "" };
  await prisma.user.create({ data: { id: "tester-id", email: "t@t", name: "测试员", role: "ADMIN", password: "x" } });
  销售 = (await prisma.user.create({ data: { email: "s@t", name: "销售乙", role: "SALES", password: "x" } })).id;
  await prisma.entMember.createMany({ data: [{ userId: "tester-id", bizRole: "sales" }, { userId: 销售, bizRole: "sales" }] });
  await prisma.channel.create({ data: { name: "展会", channelOwnerId: "tester-id" } });
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(() => prisma.$disconnect());

const 新建 = (改: Record<string, unknown> = {}) =>
  saveCustomer({
    name: "", phone: "13800000001", school: null, grade: null, major: null,
    followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
    salesOwnerId: "tester-id", channelId: null, referrerCustomerId: null,
    ...改,
    企业资料: { bizLine: "内贸", ...((改.企业资料 as object | undefined) ?? {}) },
  } as Parameters<typeof saveCustomer>[0]);

describe("显示兜底：客户显名 / 全称或显名 / 客户引", () => {
  const 空 = { id: "cmabcdefghij123456", name: "", shortName: null, customerNo: 12 };
  it("简称 → 全称 → 客户编号，永远不空；不拿别的东西兜", () => {
    expect(客户显名({ ...空, shortName: "华东", name: "华东展具有限公司" })).toBe("华东");
    expect(客户显名({ ...空, name: "华东展具有限公司" })).toBe("华东展具有限公司");
    expect(客户显名(空)).toBe("NO.00012");
    expect(客户显名({ ...空, name: "   ", customerNo: null })).toBe("#123456");
  });
  it("项目默认名：有全称照旧用全称（不改老规矩），空着才兜简称 / 编号", () => {
    expect(全称或显名({ ...空, shortName: "华东", name: "华东展具有限公司" })).toBe("华东展具有限公司");
    expect(全称或显名({ ...空, shortName: "华东" })).toBe("华东");
    expect(全称或显名(空)).toBe("NO.00012");
  });
  it("日志引号里不空；抬头全空时是客户编号（P-抬头-09）", () => {
    expect(客户引(空)).toBe("「NO.00012」");
    expect(客户抬头(空)).toBe("NO.00012");
  });
});

describe("新建：企业版名称选填", () => {
  it("空名、只有空格都建得成，存空串、取了客户编号；日志不出空引号；潜客培育项目名不空", async () => {
    const r1 = await 新建();
    expect(r1).toMatchObject({ ok: true });
    const r2 = await 新建({ name: "   ", phone: "13800000002" });
    expect(r2).toMatchObject({ ok: true });
    const 们 = await prisma.customer.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(们.map((c) => c.name)).toEqual(["", ""]);
    expect(们.every((c) => typeof c.customerNo === "number")).toBe(true);
    const 日志 = await prisma.auditLog.findMany({ where: { entity: "Customer", action: "create" } });
    expect(日志.length).toBe(2);
    for (const l of 日志) expect(l.summary).not.toContain("「」");
    expect(日志.some((l) => l.summary.includes(客户显名(们[0])))).toBe(true);
    const 项目们 = await prisma.project.findMany();
    expect(项目们.length).toBe(2);
    for (const p of 项目们) expect(p.name.trim()).not.toBe("");
    expect(new Set(项目们.map((p) => p.name))).toEqual(new Set(们.map((c) => 客户显名(c))));
  });

  it("两位都没名字、号码不同：互不相撞（空名不按名字查重）", async () => {
    expect(await 新建({ phone: "13800000011" })).toMatchObject({ ok: true });
    expect(await 新建({ phone: "13800000012" })).toMatchObject({ ok: true });
    expect(await prisma.customer.count()).toBe(2);
    // 号码照旧查重：同号第二位挡下
    expect(await 新建({ phone: "13800000012" })).toMatchObject({ ok: false });
  });

  it("有名字的照旧按名字查重（同名挡下）", async () => {
    expect(await 新建({ name: "华东展具", phone: "13800000021", salesOwnerId: 销售 })).toMatchObject({ ok: true });
    mocks.user = { ...mocks.user, id: "tester-id" };
    const r = await 新建({ name: "华东展具", phone: "13800000022" });
    expect(r.ok).toBe(false);
  });

  it("非企业版照旧必填", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 新建({ phone: "13800000031" })).toEqual({ ok: false, error: "请填写姓名" });
  });
});

describe("就地改全称：企业版能清空", () => {
  it("清空存空串，日志里叫改前的名（原来没名的叫编号，不出「」）", async () => {
    const r = await 新建({ name: "华东展具", phone: "13800000041" });
    if (!r.ok) throw new Error(r.error);
    const id = r.id!;
    expect(await patchCustomer(id, "name", "")).toMatchObject({ ok: true });
    const c = await prisma.customer.findUniqueOrThrow({ where: { id } });
    expect(c.name).toBe("");
    const l = await prisma.auditLog.findFirstOrThrow({ where: { entity: "Customer", action: "update", entityId: id }, orderBy: { at: "desc" } });
    expect(l.summary).toContain("「华东展具」");
    // 原来就没名：给它补名，日志里按编号叫
    expect(await patchCustomer(id, "name", "华东展具二号")).toMatchObject({ ok: true });
    const l2 = await prisma.auditLog.findFirstOrThrow({ where: { entity: "Customer", action: "update", entityId: id }, orderBy: { at: "desc" } });
    expect(l2.summary).not.toContain("「」");
    expect(l2.summary).toContain(客户显名(c));
  });
});

describe("查重：空名不互撞", () => {
  it("客户名查重：空名直接不查；库里有空名客户，有名字的新客户也撞不上它们", async () => {
    await 新建({ phone: "13800000051" });
    await 新建({ phone: "13800000052", salesOwnerId: 销售 });
    expect(await 客户名查重("tester-id", null, "", null)).toBeNull();
    expect(await 客户名查重("tester-id", null, "   ", null)).toBeNull();
    expect(await 客户名查重(销售, null, "华东展具", null)).toBeNull();
  });

  it("导入查重：空名不建名字键；空名行只按号比，号不同不算撞", async () => {
    await 新建({ phone: "13800000061" });
    const 索引 = await 读导入查重索引();
    expect([...索引.客户名.keys()]).not.toContain("");
    expect(撞已有客户(索引, "", ["13800000062"])).toBeNull();
    expect(撞已有客户(索引, "", ["13800000061"])).not.toBeNull();
  });
});

describe("通知：名字空着照发，叫显名", () => {
  it("分给你通知：空名客户不再被吞掉，标题里是客户编号", async () => {
    const r = await 新建({ phone: "13800000071" });
    if (!r.ok) throw new Error(r.error);
    await 分给你通知({ id: "tester-id", name: "测试员" }, 销售, [r.id!]);
    const n = await prisma.entNotice.findMany({ where: { userId: 销售, kind: "分配" } });
    expect(n.length).toBe(1);
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: r.id! } });
    expect(n[0].title).toContain(客户显名(c));
  });
});

describe("AI 建档卡：名称选填", () => {
  const 企建档 = { 只用项目: true, 要下一步: false, 企业: { 有分配方式: true, 节点们: ["潜客培育", "线索验证"] } } as const;
  const 卡 = (补: Record<string, unknown> = {}) => ({
    id: "t1", kind: "add_lead" as const, customerId: "", customerName: "", reason: "测试",
    name: "", contact: "", phone: "", source: "展会", status: "待跟进", remark: "",
    分配方式: 4, 业务线: "内贸", 节点: "潜客培育", 联系方式: [{ kind: "phone", value: "13800000081" }], ...补,
  });

  it("工具参数不再把 name 列为必填；只给号码也能出卡", () => {
    expect(SCHEMAS.propose_lead.required).not.toContain("name");
    const r = buildProposal("x", "add_lead", { id: "", name: "" }, { reason: "测试", numbers: [{ type: "手机", value: "13800000081" }] }, DEFAULT_BUSINESS);
    expect(r.ok).toBe(true);
  });

  it("名称空着不算缺项", () => {
    expect(missingFields(卡() as never, undefined, 企建档)).toEqual([]);
  });

  it("确认后建成：客户名称空串，项目名跟客户起（全称或显名 = 客户编号），不落「潜在项目」、不带联系人名", async () => {
    expect(await applyProposal(卡({ contact: "张伟" }) as never)).toMatchObject({ ok: true });
    const c = await prisma.customer.findFirstOrThrow();
    expect(c.name).toBe("");
    expect(c.customerNo).not.toBeNull();
    const 项目们 = await prisma.project.findMany();
    expect(项目们.length).toBeGreaterThan(0);
    for (const p of 项目们) {
      expect(p.name).toBe(全称或显名(c));
      expect(p.name).not.toBe(潜在项目名);
      expect(p.name).not.toContain("张伟");
    }
    const 日志 = (await prisma.auditLog.findMany({ select: { summary: true } })).map((x) => x.summary).join("\n");
    expect(日志).not.toContain("「」");
  });

  it("填了名称：项目名照旧用卡上的名称", async () => {
    expect(await applyProposal(卡({ name: "编的展具厂" }) as never)).toMatchObject({ ok: true });
    expect((await prisma.project.findMany()).map((p) => p.name)).toContain("编的展具厂");
  });
});

describe("全称灰字（PR-7 fullname-hint 摘来，纯函数）", () => {
  it("像人名：常见姓两三个字、称呼、英文人名、老补名「姓名｜国家」", () => {
    for (const x of ["张伟", "欧阳娜娜", "王总", "李先生", "John Smith", "Mr. Brown", "张三｜美国"]) expect(全称像人名(x), x).toBe(true);
  });
  it("单位名不算：带公司 / 厂 / 贸易 / Ltd 这类字样，或不像人名的", () => {
    for (const x of ["华东展具", "杭州云帆科技有限公司", "张记五金店", "王氏贸易", "Acme Trading Co", "ACME", "云帆", "美国｜加州"]) expect(全称像人名(x), x).toBe(false);
  });
  it("提示：空 → 怎么显示；像人名 → 提醒；其余没有", () => {
    expect(全称提示("")).toBe(没填全称提示);
    expect(全称提示("   ")).toBe(没填全称提示);
    expect(全称提示("张伟")).toBe(像人名提示);
    expect(全称提示("杭州云帆科技有限公司")).toBeNull();
  });
});

describe("粘贴切人导入：企业版没名称照导", () => {
  const 排 = (名称选填?: boolean) =>
    摊开({ 表头: ["姓名", "手机号"], 数据: [["", "13800000091"]], 映射: ["name", "phone"], 字段表: 字段表(DEFAULT_BUSINESS), 名称选填 } as never);
  it("企业版：没名称的行不拦", () => expect(排(true)[0].进不了).toBeUndefined());
  it("不给（桌面端）：照旧「这一行没有姓名」", () => expect(排()[0].进不了).toBe("这一行没有姓名"));
});

describe("导出 / 背调：没名的叫显名，不出空白", () => {
  it("跟进导出的客户名：没名的叫客户编号；客户表全称列照原样留空", async () => {
    const r = await 新建({ phone: "13800000095" });
    if (!r.ok) throw new Error(r.error);
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: r.id! } });
    await prisma.followUp.create({ data: { customerId: c.id, ownerId: "tester-id", type: "NOTE", title: "", content: "聊了一次", status: "已完成", occurredAt: new Date() } });
    // 企业版导出只给总管理（lib/enterprise/import-perm.ts）
    await prisma.entMember.update({ where: { userId: "tester-id" }, data: { bizRole: "director" } });
    忘掉企业版范围();
    const 出 = await 导出客户({});
    if (!出.ok) throw new Error(出.error);
    expect(出.rows.find((x) => x.id === c.id)?.name).toBe("");
    expect(出.跟进.map((f) => f.customerName)).toContain(客户显名(c));
    for (const f of 出.跟进) expect(f.customerName.trim()).not.toBe("");
  });

  it("背调「像你的老客户」清单：没名的叫客户编号", async () => {
    const r = await 新建({ phone: "13800000096", followStatus: "已签约" });
    if (!r.ok) throw new Error(r.error);
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: r.id! } });
    await prisma.customer.update({ where: { id: c.id }, data: { followStatus: "已签约" } });
    const 清单 = await 老客户清单(DEFAULT_BUSINESS);
    expect(清单.find((x) => x.id === c.id)?.name).toBe(客户显名(c));
    for (const x of 清单) expect(x.name.trim()).not.toBe("");
  });
});

describe("粘贴切人导入的对列（企业版，P-抬头-13）", () => {
  const 企 = () => 字段表(DEFAULT_BUSINESS, true);
  it("「联系人 / 联系人姓名 / 姓名」对到联系人姓名；「客户名称 / 公司 / 全称」才对到客户全称", () => {
    expect(猜列(["联系人", "公司", "手机号"], 企())).toEqual(["contactName", "name", "phone"]);
    expect(猜列(["联系人姓名", "客户名称"], 企())).toEqual(["contactName", "name"]);
    expect(猜列(["姓名", "全称"], 企())).toEqual(["contactName", "name"]);
    expect(猜列(["公司名称"], 企())).toEqual(["name"]);
  });
  it("企业版客户全称不标必填；公司 / 单位不再落到档案那一格", () => {
    const 名 = 企().find((f) => f.名 === "name")!;
    expect(名.必填).toBeUndefined();
    expect(名.label).toBe("客户全称");
    const 档 = 企().find((f) => f.名 === "school")!;
    expect(档.别名).not.toContain("公司");
    expect(档.别名).not.toContain("单位");
  });
  it("桌面端映射不动：「联系人」「姓名」照旧是客户姓名，「公司」照旧是档案那一格，姓名照旧必填", () => {
    const 桌 = 字段表(DEFAULT_BUSINESS);
    expect(猜列(["联系人", "公司"], 桌)).toEqual(["name", "school"]);
    expect(桌.find((f) => f.名 === "name")!.必填).toBe(true);
    expect(桌.some((f) => (f.名 as string) === "contactName")).toBe(false);
  });

  it("落库：联系人列建成主要联系人、客户全称空着；撤销连联系人一起删", async () => {
    清空暂存();
    await prisma.entMember.update({ where: { userId: "tester-id" }, data: { bizRole: "director" } });
    忘掉企业版范围();
    const 表头 = ["联系人", "手机号"];
    const r = await 执行导入({ 表头, 数据: [["张伟", "13800000097"]], 映射: 猜列(表头, 企()), 重复行: "跳过" }, "a.xlsx");
    if (!r.ok) throw new Error(r.error);
    expect(r.新建).toBe(1);
    const c = await prisma.customer.findFirstOrThrow({ include: { contacts: true } });
    expect(c.name).toBe("");
    expect(c.contacts).toHaveLength(1);
    expect(c.contacts[0]).toMatchObject({ name: "张伟", phone: "13800000097", isPrimary: true });
    const 撤 = await 撤销批次(r.batchId);
    expect(撤).toMatchObject({ ok: true, 删掉: 1 });
    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.contact.count()).toBe(0);
  });
});

describe("名称框提示、像人名灰字三处同一句（11-19）", () => {
  it("提示是「单位名称，可留空」；像人名说联系人另外填在联系人里（三处都说得通，不说「下面」）", async () => {
    const { 名称框提示 } = await import("@/lib/enterprise/fullname-hint");
    expect(名称框提示).toBe("单位名称，可留空");
    expect(像人名提示).toBe("看着像联系人姓名，联系人请另外填在联系人里");
  });
});

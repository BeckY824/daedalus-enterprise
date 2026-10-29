/**
 * 企业版客户与联系人（2026-10-29，定稿 P5 第 6、22–24、29、30 条 + 待定 14–17、19）：
 *   - 纯函数：级别 S/A/B/C（D→C）、地址规整 / 拼一行、关联对、生日、号码种类与验号、老三格、客户页摆法、档案改动只交改了的
 *   - 级别 D 改 C：只改一次（设置里记号），非企业版不动
 *   - 字典：分配方式 custAssign、号码类型 contactKind 的默认
 *   - saveCustomer：级别只收 S/A/B/C、来源（第一次的渠道）不能改、简称 / 地址 / 分配方式落库
 *   - patchCustomer：级别 S、简称、分配方式；非企业版不收这两格
 *   - saveContact：性别 / 生日 / 爱好 / 地址、号码几行整组换、老三格回写、乱给的拒
 *   - 关联客户：两边都看得到、自己不能关联自己、同一对不重复、改说明、取消
 *   - 联系人附件分两格（名片 / 相册，没分类的老附件算相册）
 *   - 客户页新建项目：企业版（项目模式）才有、建在线索阶段、首条沟通挂上项目
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({ id: "tester-id", name: "测试员", email: "t", role: "ADMIN", title: "" }),
}));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, getSetting } from "@/lib/settings";
import { 可选项, 字典定义 } from "@/lib/enterprise/dict";
import {
  企业级别, 认企业级别, 规整地址, 拼地址, 关联对, 另一头, 认生日, 是附件分类,
  认号码种类, 验一行号码, 老三格, 客户页摆法, 规整详细地址, 地址叫法,
} from "@/lib/enterprise/customer-v2";
import { 级别D改C, 级别改过记号键, 号码种类表, 种类叫法, 验联系人号码们, 联系人号码们, 关联客户们 } from "@/lib/enterprise/customer-v2-db";
import { 联系人分类附件数 } from "@/lib/attachments";
import { saveCustomer, patchCustomer } from "@/app/(app)/customers/actions";
import { saveContact } from "@/app/(app)/customers/[id]/actions";
import { 关联客户, 改关联说明, 取消关联 } from "@/app/(app)/customers/[id]/link-actions";
import { 给客户建项目 } from "@/app/(app)/customers/[id]/project-actions";
import { 企业档案改动 } from "@/app/(app)/customers/CustomerForm";

let 销售: string;
let 序 = 0;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await prisma.user.create({ data: { id: "tester-id", email: "t@t", name: "测试员", role: "ADMIN", password: "x" } });
  销售 = (await prisma.user.create({ data: { email: "s@t", name: "销售", role: "SALES", password: "x" } })).id;
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

const 新建 = (改: Record<string, unknown> = {}) =>
  saveCustomer({
    name: `测试客户${++序}`, phone: `1380000${String(1000 + 序).slice(-4)}`, school: null, grade: null, major: null,
    followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
    salesOwnerId: 销售, channelId: null, referrerCustomerId: null,
    ...改,
  } as Parameters<typeof saveCustomer>[0]);

async function 新建id(改: Record<string, unknown> = {}) {
  const r = await 新建(改);
  if (!r.ok) throw new Error(r.error);
  return (await prisma.customer.findFirstOrThrow({ orderBy: { createdAt: "desc" }, select: { id: true } })).id;
}

/** 整表保存：其余照库里的，只改给的几项 */
async function 整表保存(id: string, 改: Record<string, unknown>) {
  const c = await prisma.customer.findUniqueOrThrow({ where: { id } });
  const 值 = {
    name: c.name, phone: c.phone, school: c.school, grade: c.grade, major: c.major,
    followStatus: c.followStatus, decisionStatus: c.decisionStatus, expectedSignAt: c.expectedSignAt,
    remark: c.remark, salesOwnerId: c.salesOwnerId, channelId: c.channelId, referrerCustomerId: c.referrerCustomerId,
    channelOwnerId: c.channelOwnerId, custStatus: c.custStatus,
  };
  return saveCustomer({ id, updatedAt: c.updatedAt.toISOString(), base: 值, ...值, ...改 } as Parameters<typeof saveCustomer>[0]);
}
const 级别 = async (id: string) => (await prisma.customerExtra.findUnique({ where: { customerId: id } }))?.level ?? null;

describe("纯函数", () => {
  it("级别：D 并进 C，S 原样，认不出的当没分级；表单交的 D 不收", () => {
    expect([企业级别("D"), 企业级别("d级"), 企业级别("S"), 企业级别("a"), 企业级别("E"), 企业级别(null)]).toEqual(["C", "C", "S", "A", null, null]);
    expect([认企业级别(""), 认企业级别("s"), 认企业级别("D"), 认企业级别("X")]).toEqual([null, "S", undefined, undefined]);
  });

  it("地址：国内存四格，国外只留国家 + 城市；只填省市当国内；拼一行不重复直辖市", () => {
    const 国内 = 规整地址({ addrProvince: " 广东省 ", addrCity: "深圳市", addrDistrict: "南山区" });
    expect(国内).toEqual({ ok: true, 值: { addrCountry: "中国", addrProvince: "广东省", addrCity: "深圳市", addrDistrict: "南山区" } });
    const 国外 = 规整地址({ addrCountry: "美国", addrProvince: "加州", addrCity: "洛杉矶", addrDistrict: "某区" });
    expect(国外).toEqual({ ok: true, 值: { addrCountry: "美国", addrProvince: null, addrCity: "洛杉矶", addrDistrict: null } });
    expect(规整地址({})).toEqual({ ok: true, 值: { addrCountry: null, addrProvince: null, addrCity: null, addrDistrict: null } });
    expect(规整地址({ addrCity: "长".repeat(41) }).ok).toBe(false);
    expect(拼地址({ addrCountry: "中国", addrProvince: "北京市", addrCity: "北京市", addrDistrict: "朝阳区" })).toBe("北京市 朝阳区");
    expect(拼地址({ addrCountry: "美国", addrCity: "洛杉矶" })).toBe("美国 洛杉矶");
    expect(拼地址(null)).toBe("");
  });

  it("地址五格叫法对齐（P14 第 7 条）；客户地址（详细地址）去空白、空当 null、超 100 字不收", () => {
    expect(Object.values(地址叫法)).toEqual(["国家地区", "省", "市", "区 / 县级市", "客户地址"]);
    expect(规整详细地址("  科技园南区   8 栋 ")).toEqual({ ok: true, 值: "科技园南区 8 栋" });
    expect(规整详细地址("  ")).toEqual({ ok: true, 值: null });
    expect(规整详细地址(null)).toEqual({ ok: true, 值: null });
    expect(规整详细地址("长".repeat(101)).ok).toBe(false);
  });

  it("关联对：一对只一行（小 id 在前），自己不行；另一头", () => {
    expect(关联对("b", "a")).toEqual({ customerId: "a", otherId: "b" });
    expect(关联对("a", "a")).toBeNull();
    expect(另一头({ customerId: "a", otherId: "b" }, "b")).toBe("a");
  });

  it("生日只收真实日子；附件分类只认名片 / 相册", () => {
    expect([认生日("1990-02-28"), 认生日(""), 认生日("1990-02-30"), 认生日("90-1-1")]).toEqual(["1990-02-28", null, undefined, undefined]);
    expect([是附件分类("名片"), 是附件分类("相册"), 是附件分类("合同")]).toEqual([true, true, false]);
  });

  it("号码种类按序号认（改名不改 kind），自己加的存 custom:；验号", () => {
    expect(认号码种类({ id: "dict-contactKind-0", name: "手机号" })).toMatchObject({ 名: "手机号", kind: "phone" });
    expect(认号码种类({ id: "dict-contactKind-5", name: "阿里国际站ID" }).kind).toBe("wangwang");
    expect(认号码种类({ id: "xyz", name: "钉钉" })).toEqual({ 名: "钉钉", kind: "custom:钉钉" });
    const 座机 = { 名: "座机", kind: "landline" };
    expect(验一行号码(座机, "0755-1234 5678")).toMatchObject({ ok: true, 键: "075512345678" });
    expect(验一行号码(座机, "abc").ok).toBe(false);
    expect(验一行号码(座机, "  ").ok).toBe(false);
    expect(验一行号码({ 名: "手机", kind: "phone", 验: "手机号" }, "12").ok).toBe(false);
    expect(验一行号码({ 名: "钉钉", kind: "custom:钉钉" }, " Ab C ")).toEqual({ ok: true, 值: "Ab C", 键: "abc" });
  });

  it("老三格取第一个手机 / 邮箱 / 微信；老联系人没有子表时拿老三格拼号码几行", () => {
    expect(老三格([{ kind: "landline", value: "1" }, { kind: "phone", value: "13800000001" }, { kind: "phone", value: "13800000002" }, { kind: "email", value: "a@b.c" }]))
      .toEqual({ phone: "13800000001", email: "a@b.c", wechat: null });
    expect(联系人号码们({ phone: "13800000001", email: null, wechat: "wx1" }, [])).toEqual([{ kind: "phone", value: "13800000001" }, { kind: "wechat", value: "wx1" }]);
    expect(联系人号码们({ phone: "13800000001", email: null, wechat: null }, [{ kind: "email", value: "a@b.c" }])).toEqual([{ kind: "email", value: "a@b.c" }]);
  });

  it("客户页摆法：项目模式去掉记录输入 / 待办 / 下次跟进 / 转让 / 背调 / 旧字段，加关联客户 / 新字段 / 新建项目 / 跟进去项目 / 沟通汇总 / 背调卡", () => {
    expect(客户页摆法(true)).toMatchObject({ 记录输入: false, 待办: true, 下次跟进: false, 转让: false, 背调: false, 旧字段: false, 关联客户: true, 新字段: true, 新建项目: true, 跟进去项目: true, 沟通汇总: true, 背调卡: true });
    expect(客户页摆法(false)).toMatchObject({ 记录输入: true, 待办: true, 下次跟进: true, 转让: true, 背调: true, 旧字段: true, 关联客户: false, 新字段: false, 新建项目: false, 跟进去项目: false, 沟通汇总: false, 背调卡: false });
  });

  it("档案改动只交改了的级别 / 官网，不动外贸那几格", () => {
    expect(企业档案改动({ level: "S", website: "a.com" }, { level: "A", website: "a.com", country: "美国" } as never)).toEqual({ extra: { level: "S" } });
    expect(企业档案改动({ level: "A" }, { level: "A" } as never)).toEqual({});
  });
});

describe("级别 D 改 C", () => {
  it("只改一次：改完记号，之后新的 D 不再动；小写 d 也改", async () => {
    const a = await 新建id(), b = await 新建id();
    await prisma.customerExtra.create({ data: { customerId: a, level: "D" } });
    await prisma.customerExtra.create({ data: { customerId: b, level: "d" } });
    expect(await 级别D改C()).toBe(2);
    expect([await 级别(a), await 级别(b)]).toEqual(["C", "C"]);
    expect(await getSetting(级别改过记号键)).toBe(true);
    await prisma.customerExtra.update({ where: { customerId: a }, data: { level: "D" } });
    expect(await 级别D改C()).toBe(0);
    expect(await 级别(a)).toBe("D");
  });

  it("非企业版不动", async () => {
    const a = await 新建id();
    await prisma.customerExtra.create({ data: { customerId: a, level: "D" } });
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 级别D改C()).toBe(0);
    expect(await 级别(a)).toBe("D");
  });
});

describe("字典默认", () => {
  it("分配方式、号码类型", async () => {
    expect(await 可选项("custAssign")).toEqual(["自持", "非自持", "公海领取"]);
    expect(字典定义.contactKind.默认).toEqual(["手机", "座机", "微信", "邮箱", "WhatsApp", "阿里国际站ID"]);
    const 表 = await 号码种类表();
    expect(表.map((x) => x.kind)).toEqual(["phone", "landline", "wechat", "email", "whatsapp", "wangwang"]);
    expect(种类叫法(表, "custom:钉钉")).toBe("钉钉");
    expect(种类叫法(表, "landline")).toBe("座机");
  });

  it("验联系人号码们：同类同号去重、乱给的类型拒、原来就有的类型认", async () => {
    const r = await 验联系人号码们([{ kind: "phone", value: "13800000001" }, { kind: "phone", value: "138 0000 0001" }, { kind: "email", value: "" }]);
    expect(r.ok && r.行们.map((x) => x.kind)).toEqual(["phone"]);
    expect((await 验联系人号码们([{ kind: "custom:不存在", value: "x" }])).ok).toBe(false);
    expect((await 验联系人号码们([{ kind: "custom:老的", value: "x" }], ["custom:老的"])).ok).toBe(true);
  });
});

describe("saveCustomer 企业版几格", () => {
  it("级别 S 收、D 不收；简称、地址、分配方式落库", async () => {
    const id = await 新建id({ extra: { level: "S", website: "example.com" }, 企业资料: { shortName: " 简 称 ", addrCountry: "美国", addrProvince: "加州", addrCity: "纽约", assignWay: "自持" } });
    expect(await 级别(id)).toBe("S");
    const c = await prisma.customer.findUniqueOrThrow({ where: { id } });
    expect([c.shortName, c.addrCountry, c.addrProvince, c.addrCity, c.assignWay]).toEqual(["简 称", "美国", null, "纽约", "自持"]);
    const 坏 = await 整表保存(id, { extra: { level: "D" } });
    expect(坏).toMatchObject({ ok: false, error: "客户级别只能是 S / A / B / C" });
    expect((await 整表保存(id, { 企业资料: { assignWay: "乱填" } })).ok).toBe(false);
    expect((await 整表保存(id, { 企业资料: { shortName: "长".repeat(21) } })).ok).toBe(false);
  });

  it("客户地址（详细地址，迁移 091）：国外客户也收；不交不碰；超长不收", async () => {
    const id = await 新建id({ 企业资料: { addrCountry: "美国", addrCity: "纽约", addrDetail: " 5th Ave  100 " } });
    const 详 = async () => (await prisma.customer.findUniqueOrThrow({ where: { id } })).addrDetail;
    expect(await 详()).toBe("5th Ave 100");
    expect((await 整表保存(id, { 企业资料: { shortName: "简" } })).ok).toBe(true);
    expect(await 详()).toBe("5th Ave 100");
    expect((await 整表保存(id, { 企业资料: { addrDetail: "长".repeat(101) } })).ok).toBe(false);
    expect((await 整表保存(id, { 企业资料: { addrDetail: null } })).ok).toBe(true);
    expect(await 详()).toBeNull();
  });

  it("来源只记第一次的渠道：建好之后换渠道不收", async () => {
    const 甲 = (await prisma.channel.create({ data: { name: "甲渠道", channelOwnerId: 销售 } })).id;
    const 乙 = (await prisma.channel.create({ data: { name: "乙渠道", channelOwnerId: 销售 } })).id;
    const id = await 新建id({ channelId: 甲 });
    expect(await 整表保存(id, { channelId: 乙 })).toMatchObject({ ok: false, error: "客户来源记的是第一次带来的渠道，建好之后不能改" });
    expect((await 整表保存(id, { remark: "改备注" })).ok).toBe(true);
    // 原来没渠道的，补上第一次的渠道可以
    const 空 = await 新建id();
    expect((await 整表保存(空, { channelId: 乙 })).ok).toBe(true);
  });
});

describe("patchCustomer 企业版几格", () => {
  it("级别 S、简称、分配方式；非企业版不收简称 / 分配方式", async () => {
    const id = await 新建id();
    expect((await patchCustomer(id, "level" as never, "S")).ok).toBe(true);
    expect(await 级别(id)).toBe("S");
    expect((await patchCustomer(id, "level" as never, "D")).ok).toBe(false);
    expect((await patchCustomer(id, "shortName", "小名")).ok).toBe(true);
    expect((await patchCustomer(id, "assignWay", "非自持")).ok).toBe(true);
    expect((await patchCustomer(id, "assignWay", "乱填")).ok).toBe(false);
    const c = await prisma.customer.findUniqueOrThrow({ where: { id } });
    expect([c.shortName, c.assignWay]).toEqual(["小名", "非自持"]);
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await patchCustomer(id, "shortName", "别的")).toMatchObject({ ok: false });
  });
});

describe("saveContact 企业版", () => {
  it("性别 / 生日 / 爱好 / 地址落库，号码几行整组换、老三格回写", async () => {
    const cid = await 新建id();
    const r = await saveContact({
      customerId: cid, name: "张三", isPrimary: true,
      企业: { gender: "男", birthday: "1990-05-01", hobby: "钓鱼", address: "某路 1 号", 号码们: [{ kind: "phone", value: "13900000001" }, { kind: "landline", value: "021-12345678" }, { kind: "email", value: "z@x.com" }] },
    });
    expect(r.ok).toBe(true);
    const c = await prisma.contact.findFirstOrThrow({ where: { customerId: cid }, include: { contactMethods: true } });
    expect([c.gender, c.birthday, c.hobby, c.address, c.phone, c.email, c.wechat]).toEqual(["男", "1990-05-01", "钓鱼", "某路 1 号", "13900000001", "z@x.com", null]);
    expect(c.contactMethods.map((x) => x.kind).sort()).toEqual(["email", "landline", "phone"]);

    const 再 = await saveContact({ id: c.id, customerId: cid, name: "张三", isPrimary: true, 企业: { 号码们: [{ kind: "wechat", value: "zhang_san" }] } });
    expect(再.ok).toBe(true);
    const c2 = await prisma.contact.findUniqueOrThrow({ where: { id: c.id }, include: { contactMethods: true } });
    expect(c2.contactMethods.map((x) => [x.kind, x.value])).toEqual([["wechat", "zhang_san"]]);
    expect([c2.phone, c2.email, c2.wechat, c2.gender]).toEqual([null, null, "zhang_san", "男"]);
  });

  it("乱给的性别、生日、号码不收", async () => {
    const cid = await 新建id();
    expect(await saveContact({ customerId: cid, name: "李四", isPrimary: false, 企业: { gender: "未知" } })).toMatchObject({ ok: false });
    expect(await saveContact({ customerId: cid, name: "李四", isPrimary: false, 企业: { birthday: "2001-02-30" } })).toMatchObject({ ok: false });
    expect(await saveContact({ customerId: cid, name: "李四", isPrimary: false, 企业: { 号码们: [{ kind: "landline", value: "abc" }] } })).toMatchObject({ ok: false });
    expect(await prisma.contact.count({ where: { customerId: cid } })).toBe(0);
  });

  it("非企业版交了企业几格也不写", async () => {
    const cid = await 新建id();
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect((await saveContact({ customerId: cid, name: "王五", phone: "13900000005", isPrimary: false, 企业: { gender: "女" } })).ok).toBe(true);
    const c = await prisma.contact.findFirstOrThrow({ where: { customerId: cid } });
    expect([c.gender, c.phone]).toEqual([null, "13900000005"]);
  });
});

describe("关联客户", () => {
  it("两边都看得到同一行；自己不行；同一对不重复；改说明；取消", async () => {
    const a = await 新建id(), b = await 新建id();
    expect(await 关联客户(a, a)).toMatchObject({ ok: false, error: "不能关联客户自己" });
    expect(await 关联客户(a, b, " 同一 集团 ")).toEqual({ ok: true });
    expect(await 关联客户(b, a)).toMatchObject({ ok: false });
    expect(await 关联客户(a, b, "长".repeat(41))).toMatchObject({ ok: false });

    const 从a = await 关联客户们(a), 从b = await 关联客户们(b);
    expect(从a).toHaveLength(1);
    expect(从a[0]).toMatchObject({ otherId: b, note: "同一 集团", 看得到: true });
    expect(从b[0]).toMatchObject({ id: 从a[0].id, otherId: a });

    expect(await 改关联说明(从a[0].id, b, "子公司")).toEqual({ ok: true });
    expect((await 关联客户们(a))[0].note).toBe("子公司");
    const c = await 新建id();
    expect(await 改关联说明(从a[0].id, c, "乱改")).toMatchObject({ ok: false });

    expect(await 取消关联(从a[0].id, a)).toEqual({ ok: true });
    expect(await 关联客户们(b)).toEqual([]);
  });

  it("非企业版没有关联", async () => {
    const a = await 新建id(), b = await 新建id();
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 关联客户(a, b)).toMatchObject({ ok: false });
    expect(await 关联客户们(a)).toEqual([]);
  });
});

describe("联系人附件分两格", () => {
  it("名片 / 相册各数各的，没分类的算相册", async () => {
    const cid = await 新建id();
    const 人 = (await prisma.contact.create({ data: { customerId: cid, name: "赵六" } })).id;
    const 空 = (await prisma.contact.create({ data: { customerId: cid, name: "钱七" } })).id;
    const 附 = (tag: string | null) => prisma.attachment.create({ data: { contactId: 人, name: "a.jpg", mime: "image/jpeg", size: 3, sha256: "x".repeat(64), tag } });
    await 附("名片");
    await 附("相册");
    await 附(null);
    expect(await 联系人分类附件数(prisma, [人, 空])).toEqual({ [人]: { 名片: 1, 相册: 2 } });
    expect(await 联系人分类附件数(prisma, [])).toEqual({});
  });
});

describe("客户页新建项目", () => {
  const 输入 = (customerId: string, 改: Record<string, unknown> = {}) => ({
    customerId,
    项目: { name: "新项目", ownerId: "tester-id" },
    跟进: { type: "PHONE", content: "聊了需求", occurredAt: "2026-10-28 10:00", 节点: "潜客培育", 明确回复: true },
    ...改,
  });

  it("不是企业版（没有项目模式）不给建", async () => {
    const cid = await 新建id();
    vi.stubEnv("CRM_ENTERPRISE", "");
    invalidateSettingsCache();
    expect(await 给客户建项目(输入(cid))).toMatchObject({ ok: false });
  });

  it("建在线索阶段，挂主要联系人，首条沟通挂上项目，客户最近跟进往后挪", async () => {
    const cid = await 新建id();
    const 主 = (await prisma.contact.create({ data: { customerId: cid, name: "主联系人", isPrimary: true } })).id;
    const r = await 给客户建项目(输入(cid));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = await prisma.project.findUniqueOrThrow({ where: { id: r.projectId } });
    expect([p.customerId, p.contactId, p.phase, p.node, p.ownerId]).toEqual([cid, 主, "线索", "潜客培育", "tester-id"]);
    const 挂 = await prisma.followUpProject.findMany({ where: { projectId: p.id } });
    expect(挂).toHaveLength(1);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: cid } })).lastFollowAt).not.toBeNull();

    expect(await 给客户建项目(输入(cid, { 跟进: { type: "PHONE", content: "x", occurredAt: "2026-10-28 10:00", 节点: "不存在", 明确回复: true } }))).toMatchObject({ ok: false });
    expect(await 给客户建项目(输入(cid, { 联系人Id: "nope" }))).toMatchObject({ ok: false });
  });
});

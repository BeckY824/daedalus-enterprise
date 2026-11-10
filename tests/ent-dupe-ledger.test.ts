/**
 * 企业版新建客户查重的同一套（lib/enterprise/dupe-ledger.ts，2026-11-10，P-挂靠-01 / X-48）：
 * 客户名 / 号码撞上已有客户 → 露出负责人（姓名 · 级别 · 状态）、记撞号台账、三档预警（第三档随强录推迟）、申请挂靠。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ user: null as null | { id: string; name: string; role: string; email: string } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: unknown) => f }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user, currentUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));

import { resetDb } from "./reset";
import { prisma } from "@/lib/prisma";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 忘掉企业版范围, 以谁的身份 } from "@/lib/enterprise/visibility";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 客户名查重, 名撞说法, 撞号预警, 负责人一行 } from "@/lib/enterprise/dupe-ledger";
import { 查号码, 查客户名, 申请挂靠 } from "@/app/(app)/customers/number-actions";
import { saveCustomer } from "@/app/(app)/customers/actions";

type 人 = { id: string; name: string; role: string; email: string };
async function 人(id: string, name: string, bizRole: string, 额外: { active?: boolean; managerId?: string } = {}): Promise<人> {
  const u = await prisma.user.create({ data: { id, email: `${id}@x.test`, name, title: "", role: "SALES", password: "x", active: 额外.active ?? true } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, managerId: 额外.managerId ?? null } });
  return { id: u.id, name: u.name, email: u.email, role: "SALES" };
}

function 作为<R>(u: 人, f: () => Promise<R>): Promise<R> {
  mocks.user = u;
  忘掉企业版范围();
  return 以谁的身份(u.id, f);
}
const 通知们 = (userId: string, kind: string) => prisma.entNotice.findMany({ where: { userId, kind } });
/** 台账行挪到合并窗口之外，下一次查算新的一次 */
const 挪旧 = () => prisma.entDupeHit.updateMany({ data: { createdAt: new Date(Date.now() - (撞号预警.合并分钟 + 1) * 60_000) } });

async function 现场() {
  const 主管 = await 人("mgr1", "小戊", "sales_mgr");
  const 负责人 = await 人("owner1", "小甲", "sales", { managerId: 主管.id });
  const 乙 = await 人("sales2", "小乙", "sales");
  const 丙 = await 人("sales3", "小丙", "sales");
  const 丁 = await 人("sales4", "小丁", "sales");
  const 客户 = await prisma.customer.create({ data: { name: "编的客户 甲", school: "编的公司甲", phone: "13800138000", salesOwnerId: 负责人.id } });
  return { 主管, 负责人, 乙, 丙, 丁, 客户 };
}

const 新客户 = (name: string, owner: string, 额外: Record<string, unknown> = {}) => ({
  name, phone: "", school: null, grade: null, major: null,
  followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: "",
  salesOwnerId: owner, channelId: null, referrerCustomerId: null,
  企业号码: { 类型: "微信", 值: `wx_${Math.random().toString(36).slice(2, 10)}` }, ...额外,
});

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("business", { projectMode: true } as never);
  await setSetting(规则.按组织看客户.key, true);
  mocks.user = null;
});

describe("客户名查重", () => {
  it("名字按名键比（全角、空格、大小写），露出负责人姓名 · 级别 · 状态，记一行台账", async () => {
    const x = await 现场();
    const r = await 作为(x.乙, () => 查客户名("编的客户甲"));
    expect(r.ok && r.撞 && "撞" in r.撞).toBe(true);
    if (!r.ok || !r.撞 || !("撞" in r.撞)) return;
    const 撞 = r.撞.撞;
    expect(撞.键类型).toBe("客户名");
    expect(负责人一行(撞.负责人)).toBe("小甲 · 销售成员 · 在职");
    expect(撞.客户名).toBe("编的客户 甲");
    // 业务员看不到同事的客户：不给 id
    expect(撞.客户id).toBeNull();
    expect(r.提示).toContain("申请挂靠");
    const 行 = await prisma.entDupeHit.findMany();
    expect(行).toMatchObject([{ userId: x.乙.id, keyType: "客户名", keyValue: "编的客户甲", customerId: x.客户.id, ownerId: x.负责人.id, sameGroup: false, result: "拦截", status: "无需处置", warnTier: 0 }]);
    expect(撞.撞号id).toBe(行[0].id);
  });

  it("公司名也比；全角写法照样认", async () => {
    const x = await 现场();
    const r = await 作为(x.乙, () => 客户名查重(x.乙.id, [x.乙.id], "完全不同的名字", "编的公司甲 "));
    expect(r && "撞" in r && r.撞.键类型).toBe("公司名");
    // 公司名撞的、看不到的：不露客户名
    expect(r && "撞" in r && r.撞.客户名).toBeNull();
  });

  it("公海客户、没撞的、一个字的不提示", async () => {
    const x = await 现场();
    await prisma.customer.update({ where: { id: x.客户.id }, data: { pool: { create: {} } } });
    expect((await 作为(x.乙, () => 查客户名("编的客户甲")))).toEqual({ ok: true, 撞: null });
    expect((await 作为(x.乙, () => 查客户名("另一位")))).toEqual({ ok: true, 撞: null });
    expect((await 作为(x.乙, () => 查客户名("甲")))).toEqual({ ok: true, 撞: null });
    expect(await prisma.entDupeHit.count()).toBe(0);
  });

  it("撞的是自己名下的：只说你名下已有，不记台账、不给申请挂靠", async () => {
    const x = await 现场();
    const r = await 作为(x.负责人, () => 查客户名("编的客户甲"));
    expect(r.ok && r.撞 && "我名下" in r.撞).toBe(true);
    expect(r.ok && r.撞 && 名撞说法(r.撞)).toContain("你名下已有同名客户");
    expect(await prisma.entDupeHit.count()).toBe(0);
  });

  it("负责人已离职：状态写已离职，指他的直属上级", async () => {
    const x = await 现场();
    await prisma.user.update({ where: { id: x.负责人.id }, data: { active: false } });
    const r = await 作为(x.乙, () => 客户名查重(x.乙.id, [x.乙.id], "编的客户甲"));
    expect(r && "撞" in r && r.撞.负责人).toMatchObject({ 姓名: "小甲", 状态: "已离职", 离职找: "小戊" });
  });

  it("同组（已加入那位客户的项目组）：提示同组协作 + 项目名和组员，不给撞号id、不算预警", async () => {
    const x = await 现场();
    const p = await prisma.project.create({ data: { name: "编的项目甲", customerId: x.客户.id, ownerId: x.负责人.id, creatorId: x.负责人.id, phase: "线索", node: "潜客培育" } });
    await prisma.projectMember.create({ data: { projectId: p.id, userId: x.乙.id, inviteStatus: "JOINED" } });
    for (let i = 0; i < 4; i++) {
      const r = await 作为(x.乙, () => 客户名查重(x.乙.id, [x.乙.id], "编的客户甲"));
      expect(r && "撞" in r && r.撞).toMatchObject({ 撞号id: null, 同组: { 项目: "编的项目甲", 成员: ["小甲", "小乙"] } });
      expect(r && 名撞说法(r)).toContain("同组协作");
      await 挪旧();
    }
    await 等通知推完();
    expect(await prisma.entDupeHit.count({ where: { sameGroup: true, result: "同组提示" } })).toBe(4);
    expect(await 通知们(x.负责人.id, "撞号预警")).toHaveLength(0);
  });
});

describe("saveCustomer 新建按名字挡", () => {
  it("撞了有人在跟的：不新建，回撞号（负责人 + 台账 id）", async () => {
    const x = await 现场();
    const r = await 作为(x.乙, () => saveCustomer(新客户("编的客户甲", x.乙.id) as never));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("小甲 · 销售成员 · 在职");
    expect(r.撞号 && "撞" in r.撞号 && r.撞号.撞.撞号id).toBeTruthy();
    expect(await prisma.customer.count()).toBe(1);
  });

  it("没撞的照常建；编辑改名不查", async () => {
    const x = await 现场();
    const r = await 作为(x.乙, () => saveCustomer(新客户("编的客户乙", x.乙.id) as never));
    expect(r).toMatchObject({ ok: true });
    expect(await prisma.entDupeHit.count()).toBe(0);
  });

  it("开关关着（非企业版）不按名字挡", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const x = await 现场();
    expect(await 客户名查重(x.乙.id, null, "编的客户甲")).toBeNull();
  });
});

describe("号码那一半同一套", () => {
  it("查号码撞了有人在跟的：带上挂靠（负责人级别状态 + 台账），10 分钟内再查并成一行", async () => {
    const x = await 现场();
    const r = await 作为(x.乙, () => 查号码("手机号", "13800138000"));
    expect(r.ok && r.状态).toBe("重复");
    expect(r.ok && r.挂靠).toMatchObject({ 键类型: "手机号", 负责人: { 姓名: "小甲", 级别: "销售成员", 状态: "在职" } });
    await 作为(x.乙, () => 查号码("手机号", "138 0013 8000"));
    expect(await prisma.entDupeHit.findMany()).toMatchObject([{ keyType: "手机号", keyValue: "13800138000", customerId: x.客户.id }]);
  });

  it("保存时撞号写进了现有项目：同一行改成写进现有项目", async () => {
    const x = await 现场();
    await prisma.project.create({ data: { name: "编的项目甲", customerId: x.客户.id, ownerId: x.负责人.id, creatorId: x.负责人.id, phase: "线索", node: "潜客培育" } });
    await 作为(x.乙, () => 查号码("手机号", "13800138000"));
    const r = await 作为(x.乙, () => saveCustomer(新客户("再建一次", x.乙.id, { phone: "13800138000", 企业号码: { 类型: "手机号", 值: "13800138000" } }) as never));
    expect(r).toMatchObject({ ok: false, 同号协同: true });
    expect(await prisma.entDupeHit.findMany()).toMatchObject([{ keyType: "手机号", result: "写进现有项目" }]);
  });
});

describe("三档预警", () => {
  it("第一档：同一人同一客户 7 天 3 次 → 通知负责人，只发一次", async () => {
    const x = await 现场();
    for (let i = 0; i < 4; i++) {
      await 作为(x.乙, () => 客户名查重(x.乙.id, [x.乙.id], "编的客户甲"));
      await 挪旧();
    }
    await 等通知推完();
    const 发 = await 通知们(x.负责人.id, "撞号预警");
    expect(发).toHaveLength(1);
    expect(发[0].title).toContain("小乙");
    expect(发[0].title).toContain("第 3 次");
    expect(await prisma.entDupeHit.count({ where: { warnTier: 1 } })).toBe(1);
    // 不到第二档：主管没收到
    expect(await 通知们(x.主管.id, "撞号预警")).toHaveLength(0);
  });

  it("第二档：同一客户 7 天被 3 个人撞 → 通知负责人的直属上级，只发一次", async () => {
    const x = await 现场();
    for (const u of [x.乙, x.丙, x.丁, x.乙]) {
      await 作为(u, () => 客户名查重(u.id, [u.id], "编的客户甲"));
      await 挪旧();
    }
    await 等通知推完();
    const 发 = await 通知们(x.主管.id, "撞号预警");
    expect(发).toHaveLength(1);
    expect(发[0].title).toContain("3 个人");
    expect(发[0].body).toContain("小乙、小丙、小丁");
    expect(await prisma.entDupeHit.count({ where: { warnTier: 2 } })).toBe(1);
    expect(await 通知们(x.负责人.id, "撞号预警")).toHaveLength(0);
  });

  it("7 天以前的不算", async () => {
    const x = await 现场();
    for (let i = 0; i < 3; i++) {
      await 作为(x.乙, () => 客户名查重(x.乙.id, [x.乙.id], "编的客户甲"));
      await prisma.entDupeHit.updateMany({ data: { createdAt: new Date(Date.now() - 8 * 86_400_000) } });
    }
    await 等通知推完();
    expect(await 通知们(x.负责人.id, "撞号预警")).toHaveLength(0);
  });

  it("第三档（绕过强录）第一期不开", () => {
    expect(撞号预警.第三档开着).toBe(false);
  });
});

describe("申请挂靠", () => {
  it("记上申请、改待处理、通知负责人；再点不重复发", async () => {
    const x = await 现场();
    const r = await 作为(x.乙, () => 查客户名("编的客户甲"));
    const id = r.ok && r.撞 && "撞" in r.撞 ? r.撞.撞.撞号id : null;
    expect(id).toBeTruthy();
    const a = await 作为(x.乙, () => 申请挂靠(id!));
    expect(a).toMatchObject({ ok: true, 提示: "已申请挂靠，等负责人处理" });
    expect(await prisma.entDupeHit.findUnique({ where: { id: id! } })).toMatchObject({ action: "申请挂靠", status: "待处理" });
    const b = await 作为(x.乙, () => 申请挂靠(id!));
    expect(b).toMatchObject({ ok: true, 提示: "已经申请过了，等负责人处理" });
    await 等通知推完();
    const 发 = await 通知们(x.负责人.id, "挂靠");
    expect(发).toHaveLength(1);
    expect(发[0]).toMatchObject({ link: "/projects/attach" });
    // 再查一次：露出里带已申请
    await 挪旧();
    const 再 = await 作为(x.乙, () => 客户名查重(x.乙.id, [x.乙.id], "编的客户甲"));
    expect(再 && "撞" in 再 && 再.撞.已申请).toBeUndefined(); // 新的一行，还没点
  });

  it("别人的台账行不认；没业务角色的不行", async () => {
    const x = await 现场();
    const r = await 作为(x.乙, () => 查客户名("编的客户甲"));
    const id = r.ok && r.撞 && "撞" in r.撞 ? r.撞.撞.撞号id! : "";
    expect(await 作为(x.丙, () => 申请挂靠(id))).toMatchObject({ ok: false, error: "找不到这条撞号记录" });
    await prisma.entMember.update({ where: { userId: x.乙.id }, data: { bizRole: "" } });
    expect(await 作为(x.乙, () => 申请挂靠(id))).toMatchObject({ ok: false });
    expect(await prisma.entDupeHit.count({ where: { action: "申请挂靠" } })).toBe(0);
  });

  it("负责人已离职：通知他手填的直属上级", async () => {
    const x = await 现场();
    await prisma.user.update({ where: { id: x.负责人.id }, data: { active: false } });
    const r = await 作为(x.乙, () => 查客户名("编的客户甲"));
    const id = r.ok && r.撞 && "撞" in r.撞 ? r.撞.撞.撞号id! : "";
    expect(await 作为(x.乙, () => 申请挂靠(id))).toMatchObject({ ok: true, 提示: "已申请挂靠，等负责人处理" });
    await 等通知推完();
    expect((await 通知们(x.主管.id, "挂靠"))[0]?.title).toContain("已离职同事名下的");
  });
});

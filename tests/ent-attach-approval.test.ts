/**
 * 企业版挂靠审批（lib/enterprise/attach-approval.ts，2026-11-10，P-挂靠-02 / P-看-13）：
 * 申请挂靠 → 客户负责人审批；24 小时没人处理转给负责人的实线上级；批准后客户负责人不变、申请人拿这家客户的只读卡、通知客户负责人。
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
import { 撞号预警 } from "@/lib/enterprise/dupe-ledger";
import { 挂靠超时小时, 挂靠超时转上级, 待我审批的挂靠, 我的挂靠申请 } from "@/lib/enterprise/attach-approval";
import { 查客户名, 申请挂靠 } from "@/app/(app)/customers/number-actions";
import { 批准挂靠, 拒绝挂靠, 打开挂靠只读卡 } from "@/app/(app)/projects/attach/actions";

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
const 通知们 = (userId: string, kind = "挂靠") => prisma.entNotice.findMany({ where: { userId, kind }, orderBy: { createdAt: "asc" } });
const 小时 = 3_600_000;

async function 现场(opt: { 主管?: boolean } = {}) {
  const 主管 = await 人("mgr1", "小戊", "sales_mgr");
  const 负责人 = await 人("owner1", "小甲", "sales", opt.主管 === false ? {} : { managerId: 主管.id });
  const 乙 = await 人("sales2", "小乙", "sales");
  const 丙 = await 人("sales3", "小丙", "sales");
  const 客户 = await prisma.customer.create({
    data: { name: "编的客户 甲", school: "编的公司甲", phone: "13800138000", salesOwnerId: 负责人.id },
  });
  const 联系人 = await prisma.contact.create({ data: { name: "编的联系人", position: "采购", phone: "13900139000", customerId: 客户.id } });
  return { 主管, 负责人, 乙, 丙, 客户, 联系人 };
}

/** 乙 新建客户撞上名字 → 点申请挂靠，回台账那一行的 id */
async function 申请(x: Awaited<ReturnType<typeof 现场>>, 谁 = x.乙): Promise<string> {
  const r = await 作为(谁, () => 查客户名("编的客户甲"));
  const id = r.ok && r.撞 && "撞" in r.撞 ? r.撞.撞.撞号id : null;
  if (!id) throw new Error("没撞上");
  const a = await 作为(谁, () => 申请挂靠(id));
  if (!a.ok) throw new Error(a.error);
  await 等通知推完();
  return id;
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("business", { projectMode: true } as never);
  await setSetting(规则.按组织看客户.key, true);
  mocks.user = null;
});

describe("申请挂靠 → 待审批", () => {
  it("申请那一刻定审批人 = 客户负责人；负责人的待审批里有，申请人自己的申请里是待审批", async () => {
    const x = await 现场();
    const id = await 申请(x);
    expect(await prisma.entDupeHit.findUnique({ where: { id } })).toMatchObject({ action: "申请挂靠", status: "待处理", approverId: x.负责人.id, escalatedAt: null });
    const 待批 = await 作为(x.负责人, () => 待我审批的挂靠(x.负责人));
    expect(待批).toHaveLength(1);
    expect(待批[0]).toMatchObject({ id, 申请人: "小乙", 客户名: "编的客户 甲", 转来的: false });
    expect(await 作为(x.主管, () => 待我审批的挂靠(x.主管))).toHaveLength(0);
    expect(await 作为(x.乙, () => 我的挂靠申请(x.乙))).toMatchObject([{ id, 客户名: "编的客户 甲", 状态: "待审批" }]);
    // 通知点进去是审批页
    expect((await 通知们(x.负责人.id))[0]).toMatchObject({ link: "/projects/attach" });
  });

  it("负责人已离职：审批人 = 他手填的直属上级", async () => {
    const x = await 现场();
    await prisma.user.update({ where: { id: x.负责人.id }, data: { active: false } });
    const id = await 申请(x);
    expect(await prisma.entDupeHit.findUnique({ where: { id } })).toMatchObject({ status: "待处理", approverId: x.主管.id });
  });

  it("还在等审批时再申请：不另起一条，不再通知", async () => {
    const x = await 现场();
    await 申请(x);
    await prisma.entDupeHit.updateMany({ data: { createdAt: new Date(Date.now() - (撞号预警.合并分钟 + 1) * 60_000) } });
    const r = await 作为(x.乙, () => 查客户名("编的客户甲"));
    const id2 = r.ok && r.撞 && "撞" in r.撞 ? r.撞.撞.撞号id! : "";
    expect(await 作为(x.乙, () => 申请挂靠(id2))).toMatchObject({ ok: true, 提示: "已经申请过了，等负责人处理" });
    expect(await prisma.entDupeHit.count({ where: { status: "待处理" } })).toBe(1);
    await 等通知推完();
    expect(await 通知们(x.负责人.id)).toHaveLength(1);
  });
});

describe("审批", () => {
  it("负责人批准：客户负责人不变，申请人收到结果、拿到只读卡；不给负责人自己再发", async () => {
    const x = await 现场();
    const id = await 申请(x);
    expect(await 作为(x.负责人, () => 批准挂靠(id))).toMatchObject({ ok: true });
    await 等通知推完();
    const 行 = await prisma.entDupeHit.findUnique({ where: { id } });
    expect(行).toMatchObject({ status: "已批准", decidedById: x.负责人.id });
    expect(行?.decidedAt).toBeTruthy();
    expect(await prisma.customer.findUnique({ where: { id: x.客户.id } })).toMatchObject({ salesOwnerId: x.负责人.id });
    expect(await 通知们(x.负责人.id)).toHaveLength(1); // 只有当初那条申请
    expect((await 通知们(x.乙.id))[0]?.title).toContain("已批准");
    expect(await 作为(x.乙, () => 我的挂靠申请(x.乙))).toMatchObject([{ id, 状态: "已批准" }]);

    const 卡 = await 作为(x.乙, () => 打开挂靠只读卡(id));
    expect(卡.ok).toBe(true);
    if (!卡.ok) return;
    expect(卡.卡.客户).toMatchObject({ name: "编的客户 甲", school: "编的公司甲" });
    // 不给负责人、级别、状态
    expect(JSON.stringify(卡.卡)).not.toContain("小甲");
    expect(卡.卡.客户).not.toHaveProperty("level");
    expect(卡.卡.客户).not.toHaveProperty("followStatus");
    // 联系人只给姓名、职务：申请人在这家没有自己的项目，不给联系方式
    expect(卡.卡.联系人).toEqual([{ name: "编的联系人", position: "采购", 给联系方式: false, phone: null, email: null, wechat: null, 号码们: [] }]);
    // 卡只认申请人本人；客户列表照旧看不到
    expect(await 作为(x.丙, () => 打开挂靠只读卡(id))).toMatchObject({ ok: false });
    expect(await 作为(x.乙, () => prisma.customer.findFirst({ where: { id: x.客户.id } }))).toBeNull();
  });

  it("拒绝：没有只读卡，申请人收到结果", async () => {
    const x = await 现场();
    const id = await 申请(x);
    expect(await 作为(x.负责人, () => 拒绝挂靠(id))).toMatchObject({ ok: true });
    await 等通知推完();
    expect(await prisma.entDupeHit.findUnique({ where: { id } })).toMatchObject({ status: "已拒绝", decidedById: x.负责人.id });
    expect((await 通知们(x.乙.id))[0]?.title).toContain("没批准");
    expect(await 作为(x.乙, () => 打开挂靠只读卡(id))).toMatchObject({ ok: false });
    // 已处理的不能再批
    expect(await 作为(x.负责人, () => 批准挂靠(id))).toMatchObject({ ok: false });
  });

  it("不是当前审批人不能批：别的同事、还没转过去的上级、申请人自己", async () => {
    const x = await 现场();
    const id = await 申请(x);
    for (const 谁 of [x.丙, x.主管, x.乙]) expect(await 作为(谁, () => 批准挂靠(id))).toMatchObject({ ok: false });
    expect(await prisma.entDupeHit.findUnique({ where: { id } })).toMatchObject({ status: "待处理" });
  });

  it("批准后客户进了公海：只读卡不再开", async () => {
    const x = await 现场();
    const id = await 申请(x);
    await 作为(x.负责人, () => 批准挂靠(id));
    await prisma.customerPool.create({ data: { customerId: x.客户.id, reason: "手动", userId: x.负责人.id } });
    expect(await 作为(x.乙, () => 打开挂靠只读卡(id))).toMatchObject({ ok: false });
  });

  it("批准过了再撞上再申请：说已批准，不另起一条", async () => {
    const x = await 现场();
    const id = await 申请(x);
    await 作为(x.负责人, () => 批准挂靠(id));
    await prisma.entDupeHit.updateMany({ data: { createdAt: new Date(Date.now() - (撞号预警.合并分钟 + 1) * 60_000) } });
    const r = await 作为(x.乙, () => 查客户名("编的客户甲"));
    const id2 = r.ok && r.撞 && "撞" in r.撞 ? r.撞.撞.撞号id! : "";
    const a = await 作为(x.乙, () => 申请挂靠(id2));
    expect(a.ok && a.提示).toContain("已批准");
    expect(await prisma.entDupeHit.count({ where: { status: { in: ["待处理", "已批准"] } } })).toBe(1);
  });

  it("没开企业版：不认", async () => {
    const x = await 现场();
    const id = await 申请(x);
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 作为(x.负责人, () => 批准挂靠(id))).toMatchObject({ ok: false });
  });
});

describe("24 小时没人处理转实线上级", () => {
  it("超过 24 小时：转给负责人的直属上级、通知他；只转一次；转过之后原负责人不能再批，上级批准后通知客户负责人", async () => {
    const x = await 现场();
    const id = await 申请(x);
    const 现在 = new Date();
    await prisma.entDupeHit.update({ where: { id }, data: { actionAt: new Date(现在.getTime() - (挂靠超时小时 + 1) * 小时) } });
    expect(await 挂靠超时转上级(现在)).toBe(1);
    await 等通知推完();
    const 行 = await prisma.entDupeHit.findUnique({ where: { id } });
    expect(行).toMatchObject({ status: "待处理", approverId: x.主管.id });
    expect(行?.escalatedAt).toBeTruthy();
    const 发 = await 通知们(x.主管.id);
    expect(发).toHaveLength(1);
    expect(发[0]).toMatchObject({ link: "/projects/attach" });
    expect(发[0].title).toContain("24 小时");
    expect(await 挂靠超时转上级(new Date(现在.getTime() + 小时))).toBe(0);
    expect(await 作为(x.主管, () => 待我审批的挂靠(x.主管))).toMatchObject([{ id, 转来的: true }]);
    expect(await 作为(x.负责人, () => 待我审批的挂靠(x.负责人))).toHaveLength(0);

    expect(await 作为(x.负责人, () => 批准挂靠(id))).toMatchObject({ ok: false });
    expect(await 作为(x.主管, () => 批准挂靠(id))).toMatchObject({ ok: true });
    await 等通知推完();
    expect(await prisma.customer.findUnique({ where: { id: x.客户.id } })).toMatchObject({ salesOwnerId: x.负责人.id });
    const 给负责人 = await 通知们(x.负责人.id);
    expect(给负责人).toHaveLength(2);
    expect(给负责人[1].title).toContain("小戊");
    expect(给负责人[1].title).toContain("批准");
    expect((await 作为(x.乙, () => 打开挂靠只读卡(id))).ok).toBe(true);
  });

  it("不到 24 小时不转", async () => {
    const x = await 现场();
    const id = await 申请(x);
    const 现在 = new Date();
    await prisma.entDupeHit.update({ where: { id }, data: { actionAt: new Date(现在.getTime() - (挂靠超时小时 - 1) * 小时) } });
    expect(await 挂靠超时转上级(现在)).toBe(0);
    expect(await prisma.entDupeHit.findUnique({ where: { id } })).toMatchObject({ approverId: x.负责人.id, escalatedAt: null });
  });

  it("负责人没有实线上级：审批人不变，记下转过（不再每分钟扫它）", async () => {
    const x = await 现场({ 主管: false });
    const id = await 申请(x);
    const 现在 = new Date();
    await prisma.entDupeHit.update({ where: { id }, data: { actionAt: new Date(现在.getTime() - (挂靠超时小时 + 1) * 小时) } });
    expect(await 挂靠超时转上级(现在)).toBe(0);
    const 行 = await prisma.entDupeHit.findUnique({ where: { id } });
    expect(行).toMatchObject({ status: "待处理", approverId: x.负责人.id });
    expect(行?.escalatedAt).toBeTruthy();
  });

  it("已经处理了的不转", async () => {
    const x = await 现场();
    const id = await 申请(x);
    await 作为(x.负责人, () => 拒绝挂靠(id));
    const 现在 = new Date();
    await prisma.entDupeHit.update({ where: { id }, data: { actionAt: new Date(现在.getTime() - (挂靠超时小时 + 1) * 小时) } });
    expect(await 挂靠超时转上级(现在)).toBe(0);
    expect(await 通知们(x.主管.id)).toHaveLength(0);
  });
});

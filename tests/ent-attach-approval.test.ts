/**
 * 企业版挂靠审批（lib/enterprise/attach-approval.ts，2026-11-10，P-挂靠-02 / P-看-13）：
 * 申请挂靠 → 客户现在的负责人审批（客户换负责人，审批人跟着换）；24 小时没人处理转给负责人的实线上级；批准后客户负责人不变、申请人拿这家客户的只读卡、通知客户负责人。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({ user: null as null | { id: string; name: string; role: string; email: string } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: unknown) => f }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user, currentUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
/** 撞车用：布好以后，下一次 看全部 那一读回来之后先跑它（只跑一次），模拟「扫到之后、写之前被人处理了」 */
const 撞车 = vi.hoisted(() => ({ 读完后: null as null | (() => Promise<unknown>) }));
vi.mock("@/lib/team-scope", async (原) => {
  const m = await 原<typeof import("@/lib/team-scope")>();
  return {
    ...m,
    看全部: async <T,>(f: () => Promise<T>): Promise<T> => {
      const r = await m.看全部(f);
      const 跑 = 撞车.读完后;
      if (跑) { 撞车.读完后 = null; await 跑(); }
      return r;
    },
  };
});
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));

import { resetDb } from "./reset";
import { prisma } from "@/lib/prisma";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 忘掉企业版范围, 以谁的身份 } from "@/lib/enterprise/visibility";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 撞号预警 } from "@/lib/enterprise/dupe-ledger";
import { 挂靠超时小时, 挂靠超时转上级, 补挂靠审批人, 待我审批的挂靠, 我的挂靠申请 } from "@/lib/enterprise/attach-approval";
import { 记换负责人, 删被撤的换负责人记录 } from "@/lib/owner-log-db";
import { 客户进公海清负责人 } from "@/lib/enterprise/pool-link";
import { 进公海挂靠通知 } from "@/lib/enterprise/attach-approval";
import { 放进公海 } from "@/app/(app)/customers/pool-actions";
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

  it("负责人已离职：审批人还是他（不另找兜底），不发通知；24 小时后照常转他手填的直属上级", async () => {
    const x = await 现场();
    await prisma.user.update({ where: { id: x.负责人.id }, data: { active: false } });
    const id = await 申请(x);
    expect(await prisma.entDupeHit.findUnique({ where: { id } })).toMatchObject({ status: "待处理", approverId: x.负责人.id });
    expect(await 通知们(x.负责人.id)).toHaveLength(0);
    expect(await 通知们(x.主管.id)).toHaveLength(0);
    expect(await 挂靠超时转上级(new Date(Date.now() + (挂靠超时小时 + 1) * 小时))).toBe(1);
    expect(await prisma.entDupeHit.findUnique({ where: { id } })).toMatchObject({ approverId: x.主管.id });
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
  it("超过 24 小时：转给负责人的直属上级、通知他；没满下一个 24 小时不再转；转过之后原负责人不能再批，上级批准后通知客户负责人", async () => {
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

  it("负责人没有实线上级、组织里也没有总管理：没人可转，原样不动", async () => {
    const x = await 现场({ 主管: false });
    const id = await 申请(x);
    const 现在 = new Date();
    await prisma.entDupeHit.update({ where: { id }, data: { actionAt: new Date(现在.getTime() - (挂靠超时小时 + 1) * 小时) } });
    expect(await 挂靠超时转上级(现在)).toBe(0);
    expect(await prisma.entDupeHit.findUnique({ where: { id } })).toMatchObject({ status: "待处理", approverId: x.负责人.id, escalatedAt: null });
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

describe("超时出口（11-10 新口径）：没有上级 / 上级停用给总管理；每 24 小时往上一级，到总管理为止，不作废", () => {
  /** 钟拨到这一刻（只假 Date，库照常走），按「现在」扫一遍 */
  const 到 = async (t: number) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(t));
    const n = await 挂靠超时转上级();
    await 等通知推完();
    return n;
  };
  const 行of = (id: string) => prisma.entDupeHit.findUniqueOrThrow({ where: { id } });
  const 痕们 = () => prisma.auditLog.findMany({ where: { userId: "system", entity: "EntDupeHit" }, orderBy: { at: "asc" } });
  afterEach(() => { vi.useRealTimers(); 撞车.读完后 = null; });

  it("没有上级 → 总管理（bizRole = director；只读管理员 admin 不算）", async () => {
    const x = await 现场({ 主管: false });
    await 人("admin1", "只读管理员", "admin");
    const 总 = await 人("dir1", "总管理", "director");
    const id = await 申请(x);
    const t0 = (await 行of(id)).actionAt!.getTime();
    expect(await 到(t0 + 23 * 小时)).toBe(0);
    expect(await 到(t0 + 24 * 小时 + 60_000)).toBe(1);
    expect(await 行of(id)).toMatchObject({ status: "待处理", approverId: 总.id });
    expect(await 通知们(总.id)).toHaveLength(1);
    expect(await 通知们("admin1")).toHaveLength(0);
    expect(await 作为(总, () => 待我审批的挂靠(总))).toMatchObject([{ id, 转来的: true }]);
    // 留痕：记在「系统」名下，写清从谁转给谁
    const 痕 = await 痕们();
    expect(痕).toHaveLength(1);
    expect(痕[0]).toMatchObject({ entityId: id });
    expect(JSON.parse(痕[0].detail ?? "{}")).toMatchObject({ 原审批人: x.负责人.id, 新审批人: 总.id });
    vi.useRealTimers();
    expect(await 作为(总, () => 批准挂靠(id))).toMatchObject({ ok: true });
  });

  it("上级已停用 → 总管理", async () => {
    const x = await 现场();
    const 总 = await 人("dir1", "总管理", "director");
    const id = await 申请(x);
    await prisma.user.update({ where: { id: x.主管.id }, data: { active: false } });
    const t0 = (await 行of(id)).actionAt!.getTime();
    expect(await 到(t0 + 24 * 小时 + 60_000)).toBe(1);
    expect(await 行of(id)).toMatchObject({ status: "待处理", approverId: 总.id });
    expect(await 通知们(x.主管.id)).toHaveLength(0);
  });

  it("审批人本人已停用：不等 24 小时，按没人直接往上找（他手填的上级在职给上级，否则给总管理）", async () => {
    const x = await 现场();
    const 总 = await 人("dir1", "总管理", "director");
    const id = await 申请(x);
    const t0 = (await 行of(id)).actionAt!.getTime();
    await prisma.user.update({ where: { id: x.负责人.id }, data: { active: false } });
    expect(await 到(t0 + 小时)).toBe(1);
    expect(await 行of(id)).toMatchObject({ status: "待处理", approverId: x.主管.id });
    // 接手的上级也停用了：同样不等，给总管理
    await prisma.user.update({ where: { id: x.主管.id }, data: { active: false } });
    expect(await 到(t0 + 2 * 小时)).toBe(1);
    expect(await 行of(id)).toMatchObject({ status: "待处理", approverId: 总.id });
    expect(await 到(t0 + 3 * 小时)).toBe(0);
  });

  it("逐级升级：负责人 → 直属上级 → 上级的上级 → 总管理，每级各等 24 小时；到总管理后不再动，也不作废；每级只通知一次", async () => {
    const x = await 现场();
    const 大主管 = await 人("mgr9", "小庚", "sales_mgr");
    await prisma.entMember.update({ where: { userId: x.主管.id }, data: { managerId: 大主管.id } });
    const 总 = await 人("dir1", "总管理", "director");
    const id = await 申请(x);
    const t0 = (await 行of(id)).actionAt!.getTime();
    const t1 = t0 + 24 * 小时 + 60_000;
    expect(await 到(t1)).toBe(1);
    expect(await 行of(id)).toMatchObject({ approverId: x.主管.id });
    // 重复跑、没满下一个 24 小时：不动
    expect(await 到(t1 + 60_000)).toBe(0);
    expect(await 到(t1 + 23 * 小时)).toBe(0);
    expect(await 行of(id)).toMatchObject({ approverId: x.主管.id });
    const t2 = t1 + 24 * 小时;
    expect(await 到(t2)).toBe(1);
    expect(await 行of(id)).toMatchObject({ approverId: 大主管.id });
    expect(await 到(t2 + 23 * 小时)).toBe(0);
    const t3 = t2 + 24 * 小时;
    expect(await 到(t3)).toBe(1);
    expect(await 行of(id)).toMatchObject({ status: "待处理", approverId: 总.id });
    // 到了总管理：再过多久都停在他那，仍待处理
    expect(await 到(t3 + 24 * 小时)).toBe(0);
    expect(await 到(t3 + 30 * 24 * 小时)).toBe(0);
    expect(await 行of(id)).toMatchObject({ status: "待处理", approverId: 总.id, decidedAt: null });
    expect((await 行of(id)).escalatedAt?.getTime()).toBe(t3);
    for (const u of [x.主管, 大主管, 总]) expect(await 通知们(u.id)).toHaveLength(1);
    expect(await 痕们()).toHaveLength(3);
    // 原来的审批人都批不了，只有总管理能批
    vi.useRealTimers();
    expect(await 作为(x.主管, () => 批准挂靠(id))).toMatchObject({ ok: false });
    expect(await 作为(大主管, () => 拒绝挂靠(id))).toMatchObject({ ok: false });
    expect(await 作为(总, () => 拒绝挂靠(id))).toMatchObject({ ok: true });
  });

  it("人工先处理了就不动：上级已批的不再往上转", async () => {
    const x = await 现场();
    const 总 = await 人("dir1", "总管理", "director");
    const id = await 申请(x);
    const t0 = (await 行of(id)).actionAt!.getTime();
    expect(await 到(t0 + 24 * 小时 + 60_000)).toBe(1);
    vi.useRealTimers();
    expect(await 作为(x.主管, () => 批准挂靠(id))).toMatchObject({ ok: true });
    expect(await 到(t0 + 72 * 小时)).toBe(0);
    expect(await 行of(id)).toMatchObject({ status: "已批准", approverId: x.主管.id });
    expect(await 通知们(总.id)).toHaveLength(0);
  });

  it("扫到之后、写之前被人批了（撞车）：按「状态、审批人没变」条件写，命中 0 行就跳过，不通知、不留痕", async () => {
    const x = await 现场();
    const id = await 申请(x);
    const t0 = (await 行of(id)).actionAt!.getTime();
    let 撞了 = false;
    // 扫的那一读之后的第一次 看全部 是读客户（写之前）：这时负责人点了批准
    撞车.读完后 = async () => {
      撞了 = true;
      await prisma.entDupeHit.update({ where: { id }, data: { status: "已批准", decidedById: x.负责人.id, decidedAt: new Date() } });
    };
    expect(await 到(t0 + 24 * 小时 + 60_000)).toBe(0);
    expect(撞了).toBe(true);
    expect(await 行of(id)).toMatchObject({ status: "已批准", approverId: x.负责人.id, escalatedAt: null });
    expect(await 通知们(x.主管.id)).toHaveLength(0);
    expect(await 痕们()).toHaveLength(0);
  });

  it("总管理本人停用：换给另一位在职总管理；都没有就停在原处", async () => {
    const x = await 现场({ 主管: false });
    const 总 = await 人("dir1", "总管理", "director");
    const id = await 申请(x);
    const t0 = (await 行of(id)).actionAt!.getTime();
    expect(await 到(t0 + 24 * 小时 + 60_000)).toBe(1);
    await prisma.user.update({ where: { id: 总.id }, data: { active: false } });
    expect(await 到(t0 + 25 * 小时)).toBe(0);
    expect(await 行of(id)).toMatchObject({ approverId: 总.id });
    const 总2 = await 人("dir2", "总管理二", "director");
    expect(await 到(t0 + 26 * 小时)).toBe(1);
    expect(await 行of(id)).toMatchObject({ status: "待处理", approverId: 总2.id });
  });
});

describe("审批人跟着客户现在的负责人走", () => {
  /** 换负责人的几条路都在同一个事务里改 salesOwnerId + 记换负责人；这里照那个样子换 */
  async function 换负责人(customerId: string, from: string, to: string) {
    await prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id: customerId }, data: { salesOwnerId: to } });
      await 记换负责人(tx, [{ customerId, from, to }], to, "assign");
    });
  }

  it("客户换负责人：待处理、没转过上级的申请转给新负责人；原负责人批不了，新负责人能批，超时转新负责人的上级", async () => {
    const x = await 现场();
    const 主管2 = await 人("mgr2", "小己", "sales_mgr");
    await prisma.entMember.update({ where: { userId: x.丙.id }, data: { managerId: 主管2.id } });
    const id = await 申请(x);
    await 换负责人(x.客户.id, x.负责人.id, x.丙.id);
    expect(await prisma.entDupeHit.findUnique({ where: { id } })).toMatchObject({ status: "待处理", approverId: x.丙.id });
    expect(await 作为(x.负责人, () => 待我审批的挂靠(x.负责人))).toHaveLength(0);
    expect(await 作为(x.丙, () => 待我审批的挂靠(x.丙))).toMatchObject([{ id, 负责人: "小丙", 转来的: false }]);
    expect(await 作为(x.负责人, () => 批准挂靠(id))).toMatchObject({ ok: false });
    // 24 小时没人处理：转给新负责人的实线上级，不是原负责人的
    expect(await 挂靠超时转上级(new Date(Date.now() + (挂靠超时小时 + 1) * 小时))).toBe(1);
    expect(await prisma.entDupeHit.findUnique({ where: { id } })).toMatchObject({ approverId: 主管2.id });
    expect(await 作为(主管2, () => 待我审批的挂靠(主管2))).toMatchObject([{ id, 转来的: true }]);
  });

  it("转过上级的不跟着换；撤销换负责人时审批人也还回去", async () => {
    const x = await 现场();
    const id = await 申请(x);
    await 换负责人(x.客户.id, x.负责人.id, x.丙.id);
    // 撤销（企业版删那条记录、负责人还回原来的）
    await prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id: x.客户.id }, data: { salesOwnerId: x.负责人.id } });
      await 删被撤的换负责人记录(tx, x.客户.id, x.负责人.id, x.丙.id);
    });
    expect(await prisma.entDupeHit.findUnique({ where: { id } })).toMatchObject({ approverId: x.负责人.id });
    // 转过上级之后再换负责人：审批人留在上级手里
    await 挂靠超时转上级(new Date(Date.now() + (挂靠超时小时 + 1) * 小时));
    expect(await prisma.entDupeHit.findUnique({ where: { id } })).toMatchObject({ approverId: x.主管.id });
    await 换负责人(x.客户.id, x.负责人.id, x.丙.id);
    expect(await prisma.entDupeHit.findUnique({ where: { id } })).toMatchObject({ approverId: x.主管.id });
  });

  it("已处理的申请不跟着换", async () => {
    const x = await 现场();
    const id = await 申请(x);
    await 作为(x.负责人, () => 拒绝挂靠(id));
    await 换负责人(x.客户.id, x.负责人.id, x.丙.id);
    expect(await prisma.entDupeHit.findUnique({ where: { id } })).toMatchObject({ status: "已拒绝", approverId: x.负责人.id });
  });
});

describe("客户进公海：待处理的挂靠申请直接关（P-挂靠-01 公海客户不是挂靠对象）", () => {
  it("负责人把客户放进公海：申请关成「客户已进公海」，处理人留空、记处理时刻，申请人收到「可去公海领取」；审批人不跟到占位账号上", async () => {
    const x = await 现场();
    const id = await 申请(x);
    const r = await 作为(x.负责人, () => 放进公海([x.客户.id], "客户主动终止"));
    expect(r).toMatchObject({ ok: true, updated: 1 });
    await 等通知推完();
    const 行 = await prisma.entDupeHit.findUnique({ where: { id } });
    expect(行).toMatchObject({ status: "客户已进公海", decidedById: null, approverId: x.负责人.id });
    expect(行?.decidedAt).toBeTruthy();
    const 收到 = await 通知们(x.乙.id);
    expect(收到).toHaveLength(1);
    expect(收到[0]).toMatchObject({ title: "挂靠申请已关闭：客户「编的客户 甲」已进公海", link: "/pool" });
    expect(收到[0].body).toContain("可去公海领取");
    // 谁的待审批里都没有了；申请人自己的申请里是「客户已进公海」
    expect(await 作为(x.负责人, () => 待我审批的挂靠(x.负责人))).toHaveLength(0);
    expect(await 作为(x.乙, () => 我的挂靠申请(x.乙))).toMatchObject([{ id, 状态: "客户已进公海" }]);
    // 关了的不再超时转上级；重发通知不重复
    expect(await 挂靠超时转上级(new Date(Date.now() + (挂靠超时小时 + 1) * 小时))).toBe(0);
    await 进公海挂靠通知([x.客户.id]);
    expect(await 通知们(x.乙.id)).toHaveLength(1);
  });

  it("已转给实线上级、还待处理的申请，客户进公海也关；已处理的不动", async () => {
    const x = await 现场();
    const id = await 申请(x);
    const 拒了 = await 申请(x, x.丙);
    await 作为(x.负责人, () => 拒绝挂靠(拒了));
    await 挂靠超时转上级(new Date(Date.now() + (挂靠超时小时 + 1) * 小时));
    expect(await prisma.entDupeHit.findUnique({ where: { id } })).toMatchObject({ status: "待处理", approverId: x.主管.id });
    // 离职放进公海、手动放进公海都走 客户进公海清负责人（事务里关），事务提交后调方发通知
    await prisma.customerPool.create({ data: { customerId: x.客户.id, reason: "手动", userId: x.负责人.id } });
    await prisma.$transaction((tx) => 客户进公海清负责人(tx, [{ id: x.客户.id, salesOwnerId: x.负责人.id }], x.负责人.id));
    await 进公海挂靠通知([x.客户.id]);
    await 等通知推完();
    expect(await prisma.entDupeHit.findUnique({ where: { id } })).toMatchObject({ status: "客户已进公海", decidedById: null, approverId: x.主管.id });
    expect(await prisma.entDupeHit.findUnique({ where: { id: 拒了 } })).toMatchObject({ status: "已拒绝", decidedById: x.负责人.id });
    expect(await 作为(x.主管, () => 待我审批的挂靠(x.主管))).toHaveLength(0);
    expect((await 通知们(x.乙.id)).map((n) => n.link)).toContain("/pool");
    expect((await 通知们(x.丙.id)).map((n) => n.link)).not.toContain("/pool");
  });
});

describe("存量回填（迁移 117 之前的待处理申请没有审批人）", () => {
  it("补成客户现在的负责人；转过上级的、已处理的不补；重跑不再改", async () => {
    const x = await 现场();
    const id = await 申请(x);
    await prisma.entDupeHit.update({ where: { id }, data: { approverId: null } });
    const 已转 = await prisma.entDupeHit.create({ data: { userId: x.丙.id, keyType: "客户名", keyValue: "编的客户甲", customerId: x.客户.id, ownerId: x.负责人.id, action: "申请挂靠", actionAt: new Date(), status: "待处理", escalatedAt: new Date() } });
    const 已拒 = await prisma.entDupeHit.create({ data: { userId: x.丙.id, keyType: "客户名", keyValue: "编的客户甲", customerId: x.客户.id, ownerId: x.负责人.id, action: "申请挂靠", actionAt: new Date(), status: "已拒绝" } });
    // 负责人换过：按现在的负责人补，不按撞的那一刻记下的 ownerId
    await prisma.customer.update({ where: { id: x.客户.id }, data: { salesOwnerId: x.丙.id } });
    expect(await 补挂靠审批人()).toBe(1);
    expect(await prisma.entDupeHit.findUnique({ where: { id } })).toMatchObject({ approverId: x.丙.id, escalatedAt: null });
    expect(await prisma.entDupeHit.findUnique({ where: { id: 已转.id } })).toMatchObject({ approverId: null });
    expect(await prisma.entDupeHit.findUnique({ where: { id: 已拒.id } })).toMatchObject({ approverId: null });
    expect(await 补挂靠审批人()).toBe(0);
  });

  it("每分钟那一遍顺手补：没到 24 小时的补完不转", async () => {
    const x = await 现场();
    const id = await 申请(x);
    await prisma.entDupeHit.update({ where: { id }, data: { approverId: null } });
    expect(await 挂靠超时转上级(new Date(Date.now() + 小时))).toBe(0);
    expect(await prisma.entDupeHit.findUnique({ where: { id } })).toMatchObject({ approverId: x.负责人.id, escalatedAt: null });
    expect(await 作为(x.负责人, () => 待我审批的挂靠(x.负责人))).toHaveLength(1);
  });
});

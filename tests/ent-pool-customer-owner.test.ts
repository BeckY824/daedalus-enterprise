/**
 * 客户进公海清负责人之后（M-公海-03）矩阵没盖到的口径：
 * 原负责人只认最近一次进公海时那位、部署空档旧字段也认、撤销不误删进公海那条、存量脚本幂等、
 * 进公海前钉住老签约、领客户按真正的原负责人找活。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 无负责人占位邮箱, 负责人显示名, 无负责人占位名, 公海标签 } from "@/lib/pool";
import { 放进公海, 领取, 撤销公海 } from "@/app/(app)/customers/pool-actions";
import { assignSalesOwner } from "@/app/(app)/customers/actions";
import { 公海客户原负责人是, 历史负责人of, 我放出去的公海客户 } from "@/lib/owner-log-db";
import { 历史负责人们 } from "@/lib/owner-log";
import { 补记存量公海客户 } from "@/lib/enterprise/pool-owner-backfill";
import { 停用分拣 } from "@/lib/offboard-db";
import { 旧收回提醒尾, 收回提醒尾 } from "@/lib/project/db";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };

let 甲: 人;
let 乙: 人;
let 丙: 人;

const 造人 = async (key: string, name: string): Promise<人> => {
  const email = `${key}@x`;
  const u = await prisma.user.create({ data: { email, name, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole: "sales", line: "内贸" } });
  return { id: u.id, name, email, role: "SALES", title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => {
  mocks.user = { ...u };
  return 以谁的身份(u.id, fn);
};

/** 早先转走一次：负责人本人转自己的要申请移交（X4），这里只要转成的结果，由总管理直接转 */
const 总管转 = async (c: string, to: string) => {
  const 总管 = await 造人(`dir${++序号}`, "总管理");
  await prisma.entMember.update({ where: { userId: 总管.id }, data: { bizRole: "director", line: null } });
  忘掉企业版范围();
  const r = await 以(总管, () => assignSalesOwner([c], to));
  expect(r).toMatchObject({ ok: true, updated: 1 });
};

let 序号 = 0;
const 客户 = async (ownerId: string) => {
  序号 += 1;
  return (await prisma.customer.create({
    data: { name: `公海客户${序号}`, phone: `139${String(序号).padStart(8, "0")}`, salesOwnerId: ownerId },
  })).id;
};
const 负责人of = async (c: string) => (await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId;
const 占位Id = async () => (await prisma.user.findUniqueOrThrow({ where: { email: 无负责人占位邮箱 } })).id;
const 公海回执 = (r: Awaited<ReturnType<typeof 领取>>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};
/** 部署前的老数据：进了公海，负责人还挂原负责人，没有 pool-release 记录 */
const 老数据进公海 = async (c: string, 谁: string, at = new Date("2026-10-01T08:00:00Z")) =>
  prisma.customerPool.create({ data: { customerId: c, userId: 谁, reason: "手动", at } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  甲 = await 造人("jia", "销售甲某");
  乙 = await 造人("yi", "销售乙某");
  丙 = await 造人("bing", "销售丙某");
  await setSetting(规则.按组织看客户.key, true);
  invalidateSettingsCache();
  忘掉企业版范围();
});

afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("P-公海-04 原负责人只认最近一次进公海时那位", () => {
  it("曾经负责、早就转走的人不算原负责人，领得到；最近放的人领不回", async () => {
    const c = await 客户(甲.id);
    await 总管转(c, 乙.id);
    await 以(乙, () => 放进公海([c], "客户主动终止"));
    const 原 = await 公海客户原负责人是(prisma, [甲.id, 乙.id], [c]);
    expect([...原.entries()]).toEqual([[c, 乙.id]]);
    expect(await 我放出去的公海客户([{ id: c, 在公海: true, salesOwnerId: await 负责人of(c) }], 甲.id)).toEqual([]);
    expect(await 我放出去的公海客户([{ id: c, 在公海: true, salesOwnerId: await 负责人of(c) }], 乙.id)).toEqual([c]);
    expect((await 以(乙, () => 领取([c]))).ok).toBe(false);
    expect((await 以(甲, () => 领取([c]))).ok).toBe(true);
    expect(await 负责人of(c)).toBe(甲.id);
  });

  it("进出两次：只拦最后一次放的，第一次放的人又能领", async () => {
    const c = await 客户(甲.id);
    await 以(甲, () => 放进公海([c], "客户主动终止"));
    await 以(丙, () => 领取([c]));
    await 以(丙, () => 放进公海([c], "客户主动终止"));
    const 原 = await 公海客户原负责人是(prisma, [甲.id, 丙.id], [c]);
    expect([...原.entries()]).toEqual([[c, 丙.id]]);
    expect((await 以(丙, () => 领取([c]))).ok).toBe(false);
    expect((await 以(甲, () => 领取([c]))).ok).toBe(true);
  });
});

describe("部署空档：老数据旧字段照样认", () => {
  it("负责人还是原负责人的老公海客户：他领不回、灰按钮，别人领得到；领走后他记进历史", async () => {
    const c = await 客户(甲.id);
    await 老数据进公海(c, 甲.id);
    expect(await 我放出去的公海客户([{ id: c, 在公海: true, salesOwnerId: 甲.id }], 甲.id)).toEqual([c]);
    expect((await 以(甲, () => 领取([c]))).ok).toBe(false);
    expect((await 以(丙, () => 领取([c]))).ok).toBe(true);
    expect(await 负责人of(c)).toBe(丙.id);
    const 记录 = await 历史负责人of(c);
    expect(历史负责人们(记录, "销售丙某")).toEqual(["销售甲某"]);
  });
});

describe("P-撤销-01 撤销和 pool-release", () => {
  it("撤销领取：删 占位→领取人 那条，进公海那条留着，原负责人还是领不回", async () => {
    const c = await 客户(甲.id);
    await 以(甲, () => 放进公海([c], "客户主动终止"));
    const r = 公海回执(await 以(丙, () => 领取([c])));
    expect(await prisma.customerOwnerLog.count({ where: { customerId: c } })).toBe(2);
    await 以(丙, () => 撤销公海("领取", r.原负责人 ?? [], r.带过来, undefined, r.公海项目));
    const 留下 = await prisma.customerOwnerLog.findMany({ where: { customerId: c } });
    expect(留下.map((x) => [x.kind, x.fromOwnerId, x.toOwnerId])).toEqual([["pool-release", 甲.id, await 占位Id()]]);
    expect(await 负责人of(c)).toBe(await 占位Id());
    expect((await 以(甲, () => 领取([c]))).ok).toBe(false);
  });

  it("撤销放进公海：负责人按记录还回去、那条删掉，不信前端传的值", async () => {
    const c = await 客户(甲.id);
    const r = await 以(甲, () => 放进公海([c], "客户主动终止"));
    if (!r.ok) throw new Error(r.error);
    await 以(甲, () => 撤销公海("放进", [{ id: c, 值: 丙.id }], undefined, undefined, r.公海项目));
    expect(await 负责人of(c)).toBe(甲.id);
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(0);
    expect(await prisma.customerOwnerLog.count({ where: { customerId: c } })).toBe(0);
  });
});

describe("存量公海客户补记脚本", () => {
  it("演练不写；真写后挂占位、记 pool-release（时间是当初进公海）；再跑一遍什么都不动", async () => {
    const c = await 客户(甲.id);
    const at = new Date("2026-10-01T08:00:00Z");
    await 老数据进公海(c, 甲.id, at);
    const 在推 = await prisma.project.create({ data: { name: "老规则的项目", customerId: c, ownerId: 甲.id, creatorId: 甲.id } });

    expect(await 补记存量公海客户(false)).toEqual({ 客户: 1, 没进线索公海的项目: 1 });
    expect(await 负责人of(c)).toBe(甲.id);
    expect(await prisma.customerOwnerLog.count({ where: { customerId: c } })).toBe(0);

    expect(await 补记存量公海客户(true)).toEqual({ 客户: 1, 没进线索公海的项目: 1 });
    const 占位 = await 占位Id();
    expect(await 负责人of(c)).toBe(占位);
    const 记录 = await prisma.customerOwnerLog.findMany({ where: { customerId: c } });
    expect(记录.map((x) => [x.kind, x.fromOwnerId, x.toOwnerId, x.at.toISOString()])).toEqual([["pool-release", 甲.id, 占位, at.toISOString()]]);
    // 项目不搬，只报数
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 在推.id } })).ownerId).toBe(甲.id);

    expect(await 补记存量公海客户(true)).toEqual({ 客户: 0, 没进线索公海的项目: 0 });
    expect(await prisma.customerOwnerLog.count({ where: { customerId: c } })).toBe(1);
    // 补记后原负责人照样领不回
    expect((await 以(甲, () => 领取([c]))).ok).toBe(false);
  });

  it("不在公海的、已经挂占位的不动", async () => {
    const 平常 = await 客户(甲.id);
    const 新进的 = await 客户(乙.id);
    await 以(乙, () => 放进公海([新进的], "客户主动终止"));
    expect((await 补记存量公海客户(true)).客户).toBe(0);
    expect(await 负责人of(平常)).toBe(甲.id);
    expect(await prisma.customerOwnerLog.count({ where: { customerId: 新进的 } })).toBe(1);
  });
});

describe("进公海前钉住老签约（X-03 业绩不靠公海里的负责人）", () => {
  const 老签约 = (c: string) => prisma.contract.create({ data: { customerId: c, amount: 100, signedAt: new Date("2026-09-01T00:00:00Z") } });

  it("手动放公海：老签约还算原负责人的", async () => {
    const c = await 客户(甲.id);
    const 约 = await 老签约(c);
    await 以(甲, () => 放进公海([c], "客户主动终止"));
    expect((await prisma.contractOwner.findUniqueOrThrow({ where: { contractId: 约.id } })).salesOwnerId).toBe(甲.id);
  });

  it("存量脚本：同样先钉住，演练不钉", async () => {
    const c = await 客户(甲.id);
    await 老数据进公海(c, 甲.id);
    const 约 = await 老签约(c);
    await 补记存量公海客户(false);
    expect(await prisma.contractOwner.count({ where: { contractId: 约.id } })).toBe(0);
    await 补记存量公海客户(true);
    expect((await prisma.contractOwner.findUniqueOrThrow({ where: { contractId: 约.id } })).salesOwnerId).toBe(甲.id);
  });
});

describe("领客户按真正的原负责人找活", () => {
  it("客户公海里负责人挂占位，原负责人没做完的计划还是跟着领取人走", async () => {
    const c = await 客户(甲.id);
    const 计划 = await prisma.followPlan.create({ data: { customerId: c, ownerId: 甲.id, subject: "回访", plannedAt: new Date("2026-12-01T00:00:00Z") } });
    await 以(甲, () => 放进公海([c], "客户主动终止"));
    await 以(丙, () => 领取([c]));
    expect((await prisma.followPlan.findUniqueOrThrow({ where: { id: 计划.id } })).ownerId).toBe(丙.id);
  });

  it("超时收回提醒是给原负责人的，新旧两种说法都不跟着转", async () => {
    const c = await 客户(甲.id);
    const 提醒 = (尾: string) => prisma.task.create({ data: { title: `项目超时没跟进，${尾}`, customerId: c, ownerId: 甲.id, dueAt: new Date() } });
    const 新 = await 提醒(收回提醒尾);
    const 旧 = await 提醒(旧收回提醒尾);
    const 活 = await prisma.task.create({ data: { title: "打电话", customerId: c, ownerId: 甲.id, dueAt: new Date() } });
    await 总管转(c, 丙.id);
    const 主 = async (id: string) => (await prisma.task.findUniqueOrThrow({ where: { id } })).ownerId;
    expect(await 主(新.id)).toBe(甲.id);
    expect(await 主(旧.id)).toBe(甲.id);
    expect(await 主(活.id)).toBe(丙.id);
  });
});

describe("X-03 离职交接只列不在公海的客户", () => {
  it("最近一次由他放进公海的客户算「本来在公海」，不进转交；早转走的不算他的", async () => {
    const 他放的 = await 客户(甲.id);
    await 以(甲, () => 放进公海([他放的], "客户主动终止"));
    const 早转走 = await 客户(甲.id);
    await 总管转(早转走, 乙.id);
    await 以(乙, () => 放进公海([早转走], "客户主动终止"));
    const 他的 = await 客户(甲.id);
    const 分 = await 停用分拣(prisma, 甲.id, "转交", true);
    expect(分.本来在公海).toEqual([他放的]);
    expect(分.客户).toEqual([他的]);
  });
});

describe("显示：占位账号不当人名", () => {
  it("负责人显示名把占位换成公海；公海标签不写「原 公海」", () => {
    expect(负责人显示名(无负责人占位名)).toBe("公海");
    expect(负责人显示名("销售甲某")).toBe("销售甲某");
    expect(公海标签("公海")).toBe(公海标签(无负责人占位名));
  });
});

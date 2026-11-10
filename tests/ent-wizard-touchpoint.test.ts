/**
 * 建档向导：渠道或渠道触点至少一个（P-渠道-08 / 09）。
 * 原来新建线索「渠道必填」，现在公司资源 / 客户介绍来的客户主渠道留空、选触点就能建；两样都空拦下、一行不写。
 * 向导第二步的「还差」和服务端是同一个 新建来源还差（lib/enterprise/touchpoint.ts）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "甲", email: "a@x", role: "ADMIN", title: "管理员", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 建档向导, type 建档向导输入 } from "@/app/(app)/projects/actions";
import { invalidateSettingsCache } from "@/lib/settings";
import { 新建来源还差, 渠道或触点必填 } from "@/lib/enterprise/touchpoint";

let 甲: string;

/** 和向导最后一步交的同一个样子：只选了触点时 channelId 空、项目也不另选渠道 */
function 输入(客户补: Record<string, unknown> = {}, n = 1): 建档向导输入 {
  return {
    客户: {
      name: `触点客户${n}`, phone: `1390000010${n}`, school: null, grade: null, major: null,
      followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
      salesOwnerId: 甲, channelId: null, referrerCustomerId: null, ...客户补,
    } as 建档向导输入["客户"],
    联系人: { name: "王经理", phone: `1390000020${n}` },
    项目: { name: `触点项目${n}`, amount: 0, currency: "CNY", ownerId: 甲, 业务线: "内贸", channelId: null },
    跟进: { type: "PHONE", content: "电话聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育" },
  } as 建档向导输入;
}

const 行数 = async () => ({ customer: await prisma.customer.count(), project: await prisma.project.count() });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  甲 = (await prisma.user.create({ data: { email: "jia", name: "甲", title: "", role: "ADMIN", password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: 甲, bizRole: "director" } });
  mocks.user = { ...mocks.user, id: 甲 };
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("向导第二步：渠道或触点至少一个", () => {
  it("两样都空差一句；只选渠道、只选触点都能往下走", () => {
    expect(新建来源还差(undefined, undefined)).toBe(渠道或触点必填);
    expect(新建来源还差("", null)).toBe(渠道或触点必填);
    expect(新建来源还差("c1", undefined)).toBe("");
    expect(新建来源还差(undefined, "公司资源")).toBe("");
  });
});

describe("建档向导服务端：渠道或触点至少一个（P-渠道-08）", () => {
  it("渠道、触点都空：拒，一行不写", async () => {
    expect(await 建档向导(输入())).toMatchObject({ ok: false, error: 渠道或触点必填 });
    expect(await 建档向导(输入({ touchpoint: "  " }))).toMatchObject({ ok: false, error: 渠道或触点必填 });
    expect(await 行数()).toEqual({ customer: 0, project: 0 });
  });

  it("触点不是公司资源 / 客户介绍：拒，一行不写", async () => {
    expect(await 建档向导(输入({ touchpoint: "朋友圈" }))).toMatchObject({ ok: false, error: expect.stringContaining("渠道触点只能是") });
    expect(await 行数()).toEqual({ customer: 0, project: 0 });
  });

  it("只选触点（公司资源）能走完：客户主渠道空、触点记上，项目来源也空着", async () => {
    const r = await 建档向导(输入({ touchpoint: "公司资源" }));
    expect(r).toMatchObject({ ok: true });
    if (!r.ok || !("projectId" in r)) return;
    const p = await prisma.project.findUniqueOrThrow({ where: { id: r.projectId }, include: { customer: true } });
    expect(p.customer).toMatchObject({ touchpoint: "公司资源", channelId: null });
    expect(p.channelId).toBeNull();
    expect(p).toMatchObject({ phase: "线索", node: "潜客培育" });
  });

  it("客户介绍 + 介绍人：介绍人挂上，主渠道不从介绍人那边继承", async () => {
    const 渠道 = await prisma.channel.create({ data: { name: "展会", channelOwnerId: 甲 } });
    const 介绍人 = await prisma.customer.create({ data: { name: "老客户", phone: "13900000999", salesOwnerId: 甲, channelId: 渠道.id } });
    const r = await 建档向导(输入({ touchpoint: "客户介绍", referrerCustomerId: 介绍人.id }, 2));
    expect(r).toMatchObject({ ok: true });
    const c = await prisma.customer.findFirstOrThrow({ where: { name: "触点客户2" } });
    expect(c).toMatchObject({ touchpoint: "客户介绍", referrerCustomerId: 介绍人.id, channelId: null });
  });

  it("渠道、触点都选也行（渠道照旧记客户来源、跟到项目上）", async () => {
    const 渠道 = await prisma.channel.create({ data: { name: "展会", channelOwnerId: 甲 } });
    const r = await 建档向导(输入({ channelId: 渠道.id, touchpoint: "公司资源" }, 3));
    expect(r).toMatchObject({ ok: true });
    if (!r.ok || !("projectId" in r)) return;
    const p = await prisma.project.findUniqueOrThrow({ where: { id: r.projectId }, include: { customer: true } });
    expect(p.customer).toMatchObject({ touchpoint: "公司资源", channelId: 渠道.id });
    expect(p.channelId).toBe(渠道.id);
  });
});

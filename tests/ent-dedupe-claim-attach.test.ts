/**
 * 查重领取记沟通时加截图 / 录音（员工反馈 F-054「最次得能加个图片」）：
 *   - 交了 要传附件 才回一张附件票（只认领取人 + 领取时记的那条沟通，15 分钟），不交不回；新建线索项目、只领旧项目两条路都回
 *   - 领了就分给销售、领取人不是负责人：不带票按原规矩 403，带票挂得上；旁人拿着票、票配别的沟通、过期的票不认
 * 组员对齐（总控 11-25）：已进组（JOINED）的组员给自己记的、在推项目上的沟通传附件放行（照 能往项目记沟通）；
 *   别人记的、没进组 / 拒了邀请 / 退了组（成员行删了）的、项目结束了的照旧不行；删不跟着放宽（M-权限-09）
 * 号码全是编造的
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "t", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 自动分配不参与key } from "@/lib/enterprise/lead-assign";
import { 查重领取, type 查重领取沟通 } from "@/app/(app)/customers/pool-actions";
import { 查重领取口径 } from "@/lib/enterprise/dedupe-claim";
import { 超时转生效key } from "@/lib/enterprise/reply-overdue";
import { POST as 传 } from "@/app/api/attachments/route";
import { DELETE as 删 } from "@/app/api/attachments/[id]/route";
import { 首条附件票头 } from "@/lib/attachment-rules";
import { readSecret } from "@/lib/secret";

const 附件夹 = fs.mkdtempSync(path.join(os.tmpdir(), "crm-claimatt-"));
const 原数据夹 = process.env.CRM_DATA_DIR;
process.env.CRM_DATA_DIR = 附件夹;
afterAll(async () => {
  // 跑完清库（同 beforeEach 那套 resetDb）：只填 followUpId 的附件不挂外键，留在共享 test.db 会绊倒后面从它拷库的用例
  await resetDb();
  if (原数据夹 === undefined) delete process.env.CRM_DATA_DIR;
  else process.env.CRM_DATA_DIR = 原数据夹;
  fs.rmSync(附件夹, { recursive: true, force: true });
  await prisma.$disconnect();
});

type 人 = { id: string; name: string };
let 总管: 人, 市场: 人, 甲: 人, 旁人: 人, 组员: 人;
let 渠道: string;
async function 造人(key: string, name: string, bizRole: string, line?: string): Promise<人> {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, ...(line ? { line } : {}) } });
  return { id: u.id, name };
}
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name }; 忘掉企业版范围(); };

let 序 = 0;
async function 公海客户(): Promise<{ id: string; 号: string; 王: string }> {
  序 += 1;
  const 号 = `1390001${String(序).padStart(4, "0")}`;
  const c = await prisma.customer.create({ data: { name: `公海客户${序}`, phone: 号, salesOwnerId: 总管.id, channelId: 渠道, attributionChannelId: 渠道 } });
  await prisma.customerPool.create({ data: { customerId: c.id, userId: 总管.id, reason: "手动" } });
  const 王 = await prisma.contact.create({ data: { name: "王经理", position: "采购", phone: 号, isPrimary: true, customerId: c.id } });
  return { id: c.id, 号, 王: 王.id };
}
const 沟通 = (补: Partial<查重领取沟通> = {}): 查重领取沟通 => ({ type: "PHONE", content: "客户来电咨询报价", occurredAt: "2026-11-19 10:00", ...补 });

const 字节 = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
function 传一个(followUpId: string, 票?: string, 名字 = "截图.png", 类型 = "image/png") {
  const 体 = 字节(`\x89PNG ${名字}`);
  const headers: Record<string, string> = { "Content-Length": String(体.byteLength), "Content-Type": 类型 };
  if (票) headers[首条附件票头] = 票;
  return 传(new Request(`http://x/api/attachments?followUpId=${followUpId}&name=${encodeURIComponent(名字)}`, { method: "POST", body: 体, headers }));
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  总管 = await 造人("boss", "总管某", "director");
  市场 = await 造人("mkt", "渠运某", "channel_ops");
  甲 = await 造人("jia", "销售甲某", "sales", "内贸");
  旁人 = await 造人("pang", "旁人某", "sales", "内贸");
  组员 = await 造人("zu", "组员某", "project_ops");
  await setSetting("business", { projectMode: true });
  await setSetting(规则.线索分配.key, true);
  // 只让甲参与自动分配：领了一定给甲
  await setSetting(自动分配不参与key, { [总管.id]: "禁止", [旁人.id]: "禁止" });
  await setSetting(超时转生效key, "2020-01-01T00:00:00.000Z");
  invalidateSettingsCache();
  渠道 = (await prisma.channel.create({ data: { name: "小红书|笔记", channelOwnerId: 总管.id } })).id;
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); 查重领取口径.新建线索项目 = true; });

describe("查重领取：要传附件才回票", () => {
  it("不交 要传附件：不回票", async () => {
    const c = await 公海客户();
    当(市场);
    const r = await 查重领取("手机号", c.号, 沟通(), c.id, { 渠道, 对接人: { 原id: c.王 } });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    expect(r).not.toHaveProperty("首条附件票");
  });

  it("新建线索项目：票配领取时记的那条沟通；领了分给甲、渠运不带票 403、带票挂得上；类型照原来的；旁人拿票、票配别的沟通都不认", async () => {
    const c = await 公海客户();
    当(市场);
    const r = await 查重领取("手机号", c.号, 沟通(), c.id, { 渠道, 对接人: { 原id: c.王 } }, true);
    if (!r.ok) throw new Error(r.error);
    if (!r.首条附件票) throw new Error("没回附件票");
    const { followUpId, 票 } = r.首条附件票;
    const f = await prisma.followUp.findUniqueOrThrow({ where: { id: followUpId } });
    expect(f).toMatchObject({ ownerId: 市场.id, customerId: c.id, content: "客户来电咨询报价" });
    const 挂 = await prisma.followUpProject.findUniqueOrThrow({ where: { followUpId }, select: { projectId: true, project: { select: { ownerId: true } } } });
    expect(挂.project.ownerId).toBe(甲.id);

    expect((await 传一个(followUpId)).status).toBe(403);
    const 成 = await 传一个(followUpId, 票);
    expect(成.status).toBe(200);
    const a = ((await 成.json()) as { 附件: { id: string } }).附件;
    expect(await prisma.attachment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ followUpId, userId: 市场.id });
    expect((await 传一个(followUpId, 票, "录音.m4a", "audio/mp4")).status).toBe(200);
    expect((await 传一个(followUpId, 票, "合同.pdf", "application/pdf")).status).toBe(415);

    当(旁人);
    expect((await 传一个(followUpId, 票)).status).toBe(403);
    当(市场);
    const 别的 = await prisma.followUp.create({ data: { customerId: c.id, ownerId: 市场.id, type: "PHONE", title: "", content: "另一条", status: "已完成", occurredAt: new Date() } });
    await prisma.followUpProject.create({ data: { followUpId: 别的.id, projectId: 挂.projectId, node: "潜客培育" } });
    expect((await 传一个(别的.id, 票)).status).toBe(403);
  });

  it("过期的票不认（退回原规矩 403）", async () => {
    const c = await 公海客户();
    当(市场);
    const r = await 查重领取("手机号", c.号, 沟通(), c.id, { 渠道, 对接人: { 原id: c.王 } }, true);
    if (!r.ok || !r.首条附件票) throw new Error(r.ok ? "没回附件票" : r.error);
    const 钥 = new TextEncoder().encode(readSecret());
    const 过期 = await new SignJWT({ typ: "first-follow-att", fb: 市场.id, ff: r.首条附件票.followUpId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt(1).setExpirationTime(2).sign(钥);
    expect((await 传一个(r.首条附件票.followUpId, 过期)).status).toBe(403);
  });

  it("只领旧项目那条路：票配挂在旧公海项目上的那条沟通，带票挂得上", async () => {
    查重领取口径.新建线索项目 = false;
    const c = await 公海客户();
    const p = await prisma.project.create({ data: { name: "公海项目", customerId: c.id, ownerId: "", creatorId: 总管.id, pooledAt: new Date("2026-11-10T00:00:00Z") } });
    await prisma.projectNodeLog.create({ data: { projectId: p.id, userId: 总管.id, kind: "pool-release", fromOwnerId: 总管.id, toPhase: "线索", toNode: "潜客培育", at: new Date("2026-11-10T00:00:00Z") } });
    当(市场);
    const r = await 查重领取("手机号", c.号, 沟通(), c.id, undefined, true);
    if (!r.ok || !r.首条附件票) throw new Error(r.ok ? "没回附件票" : r.error);
    expect((await prisma.followUpProject.findUniqueOrThrow({ where: { followUpId: r.首条附件票.followUpId } })).projectId).toBe(p.id);
    expect((await 传一个(r.首条附件票.followUpId)).status).toBe(403);
    expect((await 传一个(r.首条附件票.followUpId, r.首条附件票.票)).status).toBe(200);
  });

  it("没领成（挑不到人）：不回票、一条沟通都不记", async () => {
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [旁人.id]: "禁止", [甲.id]: "禁止" });
    invalidateSettingsCache();
    const c = await 公海客户();
    当(市场);
    const r = await 查重领取("手机号", c.号, 沟通(), c.id, { 渠道, 对接人: { 原id: c.王 } }, true);
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty("首条附件票");
    expect(await prisma.followUp.count({ where: { customerId: c.id } })).toBe(0);
  });
});

describe("组员对齐：已进组组员给自己记的沟通传附件（照 能往项目记沟通）", () => {
  async function 项目和沟通(组员状态: string | null, 补: { result?: string } = {}) {
    const c = await prisma.customer.create({ data: { name: "组员客户", phone: "13900029999", salesOwnerId: 甲.id } });
    const p = await prisma.project.create({ data: { name: "在推项目", customerId: c.id, ownerId: 甲.id, creatorId: 甲.id, ...(补.result ? { result: 补.result } : {}) } });
    if (组员状态) await prisma.projectMember.create({ data: { projectId: p.id, userId: 组员.id, inviteStatus: 组员状态 } });
    const 记 = async (ownerId: string) => {
      const f = await prisma.followUp.create({ data: { customerId: c.id, ownerId, type: "PHONE", title: "", content: "组员记的", status: "已完成", occurredAt: new Date() } });
      await prisma.followUpProject.create({ data: { followUpId: f.id, projectId: p.id, node: "潜客培育" } });
      return f.id;
    };
    return { 我记的: await 记(组员.id), 甲记的: await 记(甲.id) };
  }

  it("已进组：自己记的能传；甲记的不能传；自己记的也删不了（删照 M-权限-09）", async () => {
    const { 我记的, 甲记的 } = await 项目和沟通("JOINED");
    当(组员);
    const 成 = await 传一个(我记的);
    expect(成.status).toBe(200);
    const a = ((await 成.json()) as { 附件: { id: string } }).附件;
    expect((await 传一个(甲记的)).status).toBe(403);
    const 删了 = await 删(new Request(`http://x/api/attachments/${a.id}`, { method: "DELETE" }), { params: Promise.resolve({ id: a.id }) });
    expect(删了.status).toBe(403);
    expect(await prisma.attachment.count({ where: { id: a.id } })).toBe(1);
  });

  it("没进组（邀请中）、项目结束了：自己记的也传不了", async () => {
    const 邀请中 = await 项目和沟通("PENDING");
    当(组员);
    expect((await 传一个(邀请中.我记的)).status).toBe(403);
    await prisma.followUp.deleteMany();
    await prisma.projectMember.deleteMany();
    await prisma.project.deleteMany();
    await prisma.customer.deleteMany();
    const 结束 = await 项目和沟通("JOINED", { result: "赢单" });
    当(组员);
    expect((await 传一个(结束.我记的)).status).toBe(403);
  });

  it("拒了邀请（DECLINED）、退了组（成员行删了，库里没有 LEFT 状态）：自己记的也传不了", async () => {
    const 拒了 = await 项目和沟通("DECLINED");
    当(组员);
    expect((await 传一个(拒了.我记的)).status).toBe(403);
    await prisma.followUp.deleteMany();
    await prisma.projectMember.deleteMany();
    await prisma.project.deleteMany();
    await prisma.customer.deleteMany();
    const 退组 = await 项目和沟通("JOINED");
    当(组员);
    expect((await 传一个(退组.我记的)).status).toBe(200);
    await prisma.projectMember.deleteMany({ where: { userId: 组员.id } });
    当(组员);
    expect((await 传一个(退组.我记的)).status).toBe(403);
  });
});

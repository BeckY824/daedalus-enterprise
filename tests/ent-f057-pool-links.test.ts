/**
 * F-057 续（11-27 3704 实操）：公海页把「客户池并成一行」的客户名下全部项目都带给 项目链接们，
 * 一位公海客户挂约 1,480 个项目时 prisma.project.findMany({ id in 整串 }) 带着限定层的否定条件，Prisma 拆不了批 → P2029，/pool 打不开。
 * 这里造一位公海客户挂 1,500 个公海项目（乙只放了几个、其余丙放的），钉：项目链接们 / 补项目去 / 市场进不了详情的 不报错，
 * 结果和一个一个问时一致（乙放的回避给老地址，丙放的跳客户页）。人名、项目名全是编造的
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 公海规则 } from "@/lib/enterprise/pool-rules";
import { 项目链接们, 补项目去, 项目页地址 } from "@/lib/project/customer-detail-direct";
import { 市场进不了详情的 } from "@/lib/enterprise/market-view-db";
import { 能看的项目, 看不到的在推数 } from "@/app/(app)/customers/[id]/project-zone";

type 人 = { id: string; role: string; name: string; email: string; title: string; avatar: string | null };
const 时刻 = (i: number) => new Date(Date.UTC(2026, 9, 1) + i * 1000);
async function 造人(key: string, bizRole: string): Promise<人> {
  const u = await prisma.user.create({ data: { email: `${key}@test`, name: key, title: "", role: bizRole === "director" ? "ADMIN" : "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole } });
  return { id: u.id, role: u.role, name: key, email: u.email, title: "", avatar: null };
}

describe.each([5, 1500])("F-057 公海客户挂 %i 个项目", (N) => {
  let 乙: 人, 丙: 人, 老板: 人;
  let ids: string[];
  const 乙放 = (i: number) => i < 3 || i === N - 1; // 乙放的不多（回避名单走 notIn，和上千个 id 凑在一句里才超参数上限）

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    忘掉企业版范围();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    公海规则.原负责人看得到公海项目 = false;
    老板 = await 造人("boss", "director");
    乙 = await 造人("yi", "sales");
    丙 = await 造人("bing", "sales");
    await setSetting("business", { projectMode: true });
    invalidateSettingsCache();
    await prisma.customer.create({ data: { id: "bigc", name: "公海大客户", phone: "", salesOwnerId: 丙.id } });
    const 号 = Array.from({ length: N }, (_, i) => i);
    ids = 号.map((i) => `pp${i}`);
    await prisma.project.createMany({ data: 号.map((i) => ({ id: `pp${i}`, name: `公海项目${i}`, customerId: "bigc", ownerId: "", creatorId: 丙.id, pooledAt: 时刻(i) })) });
    await prisma.projectNodeLog.createMany({ data: 号.map((i) => ({ projectId: `pp${i}`, kind: "pool-release", fromOwnerId: 乙放(i) ? 乙.id : 丙.id, userId: 丙.id, toPhase: "线索", toNode: "x", at: 时刻(i) })) });
    忘掉企业版范围();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    公海规则.原负责人看得到公海项目 = false;
    忘掉企业版范围();
  });

  it("项目链接们：不报错，乙放的回避（老地址），别人放的跳客户页，和单个问一致", async () => {
    const 链 = await 以谁的身份(乙.id, () => 项目链接们(乙 as never, ids));
    expect(链.size).toBe(N);
    ids.forEach((id, i) => {
      if (乙放(i)) expect(链.get(id)).toBe(项目页地址(id));
    });
    const 跳 = ids.filter((id) => 链.get(id) !== 项目页地址(id));
    expect(跳.length).toBe(ids.filter((_, i) => !乙放(i)).length);
    for (const id of [ids[0], ids[1], ids[N - 1], ids[Math.floor(N / 2)], ids[Math.floor(N / 2) + 1]]) {
      const 单 = await 以谁的身份(乙.id, () => 项目链接们(乙 as never, [id]));
      expect(单.get(id)).toBe(链.get(id));
    }
    // 总管理（回避豁免）：全部跳客户页
    const 全 = await 以谁的身份(老板.id, () => 项目链接们(老板 as never, ids));
    expect(ids.every((id) => 全.get(id) === `/customers/bigc?project=${id}`)).toBe(true);
  });

  it("补项目去：每行都补上，和 项目链接们 一致", async () => {
    const 行们 = ids.map((id) => ({ id }));
    const 出 = await 以谁的身份(乙.id, () => 补项目去(乙 as never, 行们, (r) => r.id));
    const 链 = await 以谁的身份(乙.id, () => 项目链接们(乙 as never, ids));
    expect(出.length).toBe(N);
    expect(出.every((r) => r.项目去 === 链.get(r.id))).toBe(true);
  });

  it("市场进不了详情的：上千个 id 不报错", async () => {
    const 挡 = await 以谁的身份(乙.id, () => 市场进不了详情的(乙.id, ids));
    expect(挡 instanceof Set).toBe(true);
  });

  it("客户详情项目区（3703 实操补）：能看的项目 / 看不到的在推数 上千个 id 不报错，和单个问一致", async () => {
    const 能看 = await 以谁的身份(乙.id, () => 能看的项目(乙 as never, ids));
    for (const id of [ids[0], ids[N - 1], ids[Math.floor(N / 2)]]) {
      const 单 = await 以谁的身份(乙.id, () => 能看的项目(乙 as never, [id]));
      expect(单.has(id)).toBe(能看.has(id));
    }
    const 全 = await 以谁的身份(老板.id, () => 能看的项目(老板 as never, ids));
    expect(全.size).toBe(N);
    expect(await 以谁的身份(乙.id, () => 看不到的在推数("bigc", ids))).toBe(0);
    expect(await 以谁的身份(乙.id, () => 看不到的在推数("bigc", []))).toBe(0); // 都在公海，不算在推
  });
});

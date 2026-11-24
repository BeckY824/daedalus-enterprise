/**
 * 项目详情中栏名单（读名单项目）只列点得进详情的（11-24 我方发现：名单里列了销售点进去 404「没有找到这条记录」的同事项目）。
 * 数据层的读范围比详情 能看项目 宽的两处，名单都要照详情收窄：
 * - 管理者：下属点了同意进组、负责人是链外同事的项目（数据层按「我 + 下属」认组员）
 * - 销售按部门名认成市场成员：自己建的、已分给同事的项目（数据层按市场成员放开「建的且不在公海」，详情只认市场角色）
 * 口径：P-看-01 / P-看-02（销售看自己负责的 + 公海）、P-看-12（同客户下同事的项目看不到）。「按组织看客户」开着（c2 的组合）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 读名单项目 } from "@/lib/project/list";
import { 字典of } from "@/lib/project/stage-dict";
import { 读组织 } from "@/lib/enterprise/org";
import { 能看项目, 权限项目选, 带已加入 } from "@/lib/enterprise/permissions";

type 人 = { id: string; role: string };
let 销管: 人, 下属: 人, 链外: 人, 市场部销售: 人, 同事: 人;
let 序 = 0;

async function 项目(name: string, 负责人: 人, 建的人: 人 = 负责人) {
  序++;
  const c = (await prisma.customer.create({ data: { name: `客户${序}`, phone: `1390000${String(序).padStart(4, "0")}`, salesOwnerId: 负责人.id } })).id;
  return (await prisma.project.create({ data: { name, customerId: c, ownerId: 负责人.id, creatorId: 建的人.id } })).id;
}
const 名单 = async (谁: 人) => (await 以谁的身份(谁.id, () => 读名单项目(谁, 字典of(true)))).rows.map((r) => r.name).sort();
/** 详情页同一个判断：数据层拿得到 且 能看项目 */
const 进得去 = async (谁: 人, id: string) => {
  const p = await 以谁的身份(谁.id, () => prisma.project.findUnique({ where: { id }, select: 权限项目选 }));
  return !!p && 能看项目(谁, 带已加入(p), await 读组织());
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  序 = 0;
  const 建 = async (email: string, bizRole: string, extra: { managerId?: string; deptId?: string } = {}): Promise<人> => {
    const u = await prisma.user.create({ data: { email, name: email, title: "", role: "SALES", password: "x" } });
    await prisma.entMember.create({ data: { userId: u.id, bizRole, managerId: extra.managerId ?? null, deptId: extra.deptId ?? null } });
    return { id: u.id, role: u.role };
  };
  const 市场部 = (await prisma.entDept.create({ data: { name: "市场部" } })).id;
  await 建("boss", "director");
  销管 = await 建("mgr", "sales_mgr");
  下属 = await 建("sub", "sales", { managerId: 销管.id });
  链外 = await 建("other", "sales");
  市场部销售 = await 建("mkts", "sales", { deptId: 市场部 });
  同事 = await 建("peer", "sales");
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting(规则.按组织看客户.key, true);
  忘掉企业版范围();
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });

describe("名单 = 点得进详情的", () => {
  it("销售管理：下属进组的链外同事项目不列（详情 404）；下属本人照列、自己负责的照列", async () => {
    const 链外的 = await 项目("链外的", 链外);
    await prisma.projectMember.create({ data: { projectId: 链外的, userId: 下属.id, inviteStatus: "JOINED" } });
    await 项目("下属的", 下属);
    await 项目("自己的", 销管);
    expect(await 进得去(销管, 链外的)).toBe(false);
    expect(await 名单(销管)).toEqual(["下属的", "自己的"]);
    // 进了组的下属自己照列（P-看-08）
    expect(await 名单(下属)).toEqual(["下属的", "链外的"]);
    expect(await 进得去(下属, 链外的)).toBe(true);
  });

  it("市场部门里的销售：自己建的、已分给同事的不列（详情 404）；自己负责的照列", async () => {
    const 分出去的 = await 项目("分出去的", 同事, 市场部销售);
    await 项目("自己的", 市场部销售);
    expect(await 进得去(市场部销售, 分出去的)).toBe(false);
    expect(await 名单(市场部销售)).toEqual(["自己的"]);
    // 同事是负责人，照列
    expect(await 名单(同事)).toEqual(["分出去的"]);
  });

  it("名单里每一行都点得进详情", async () => {
    const 链外的 = await 项目("链外的", 链外);
    await prisma.projectMember.create({ data: { projectId: 链外的, userId: 下属.id, inviteStatus: "JOINED" } });
    await 项目("分出去的", 同事, 市场部销售);
    await 项目("下属的", 下属);
    for (const 谁 of [销管, 下属, 链外, 市场部销售, 同事]) {
      const 行 = (await 以谁的身份(谁.id, () => 读名单项目(谁, 字典of(true)))).rows;
      for (const r of 行) expect(await 进得去(谁, r.id), `${r.name}`).toBe(true);
    }
  });
});

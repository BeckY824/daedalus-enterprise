/**
 * 首页 AI 项目沟通卡（project_followup）：沟通记上了、卡点没发出去（小修 11-25）
 *   原来那句只进 message，卡上看不见；现在也作为 提示 交回，卡上落印下面那一行出（同客户沟通卡的 prop-done-hint）
 *   和短沟通那句（E-259）都有时用「；」接成一行；都没有不带 提示
 * 记项目沟通Action 打桩：卡点没发这条路在 11-19 先查后写之后很难用真库造出来
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BusinessConfig } from "@/lib/business-config";
import { DEFAULT_BUSINESS } from "@/lib/business-config";
import { 落印行们 } from "@/lib/agent/seal-lines";

const mocks = vi.hoisted(() => ({ 结: {} as Record<string, unknown> }));
vi.mock("@/lib/prisma", () => ({ prisma: { project: { findUnique: async () => ({ id: "pj1", phase: "商机" }) } }, defaultClient: {} }));
vi.mock("@/lib/audit", () => ({ recordAudit: async () => {} }));
vi.mock("@/app/(app)/projects/actions", () => ({
  记项目沟通Action: async () => mocks.结,
  改项目节点: async () => ({ ok: false }), 终止项目进程: async () => ({ ok: false }),
  线索初判Action: async () => ({ ok: false }), 市场复核Action: async () => ({ ok: false }), 销售终验Action: async () => ({ ok: false }),
  总管理终判Action: async () => ({ ok: false }), 销售认领Action: async () => ({ ok: false }),
}));
vi.mock("@/app/(app)/projects/blocker-actions", () => ({ 完成卡点Action: async () => ({ ok: false }) }));
vi.mock("@/app/(app)/projects/payment-actions", () => ({ 记回款: async () => ({ ok: false }), 删回款: async () => ({ ok: false }) }));
vi.mock("@/app/(app)/customers/[id]/actions", () => ({ saveContact: async () => ({ ok: false }) }));
vi.mock("@/app/(app)/customers/actions", () => ({ deleteCustomers: async () => ({ ok: false }) }));

const { 做项目卡 } = await import("@/lib/agent/apply-project");
const 我 = { id: "u1", name: "乙", role: "SALES" };
const 卡 = { id: "t", kind: "project_followup", customerId: "c1", customerName: "客户甲", reason: "人说的", targetId: "pj1", targetName: "一号项目", type: "PHONE", content: "电话聊了预算", 下一步: "下周报方案", 下一步时间: "", 要卡点: true, 卡点类型: "中度卡点", 影响等级: "", 阻碍原因: ["预算不够"] };
const 做 = () => 做项目卡(卡 as never, 我, DEFAULT_BUSINESS as BusinessConfig);

describe("项目沟通卡：卡点没发出去那句上卡", () => {
  beforeEach(() => { mocks.结 = {}; });

  it("卡点没发：message 照旧带，提示也带，卡上落印下面出一行", async () => {
    mocks.结 = { ok: true, 卡点没发: "你没有发卡点的权限" };
    const r = await 做();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.message).toContain("；沟通已记上，但卡点没发出去：你没有发卡点的权限");
    expect(r.提示).toBe("沟通已记上，但卡点没发出去：你没有发卡点的权限");
    expect(落印行们(r).map((x) => [x.testid, x.话])).toEqual([["prop-done-hint", "沟通已记上，但卡点没发出去：你没有发卡点的权限"]]);
  });

  it("卡点没发 + 短沟通（E-259）：两句用「；」接成一行", async () => {
    mocks.结 = { ok: true, 卡点没发: "原因停用了", 超时短沟通: "太短" };
    const r = await 做();
    expect(r.ok && r.提示).toMatch(/^沟通已记上，但卡点没发出去：原因停用了；这条不足 4 个字，不算有效沟通/u);
  });

  it("卡点发出去了 / 没要卡点：不带 提示", async () => {
    mocks.结 = { ok: true, 卡点: "KD-001" };
    const r = await 做();
    expect(r.ok && r.message).toContain("卡点 KD-001 已发布");
    expect(r).not.toHaveProperty("提示");
  });
});

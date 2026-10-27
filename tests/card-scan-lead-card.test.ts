/**
 * 企业版首页对话框认名片（2026-10-27）：
 *   - lib/card-scan/lead-card.ts：认出来的表单摆成一张「新建线索」卡（名称放公司、联系人放人名、别的格拼进备注；只有一个渠道才预填来源；下一步先放明天）
 *   - lib/card-scan/cloud.ts 走网页登录：不带令牌、靠登录 cookie 认；服务器上没配模型（404）就不整理，回 null 让调用方用规则拆的
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BUSINESS } from "@/lib/business-config";
import { 空名片表单, type 名片表单 } from "@/lib/card-scan/form";
import { 名片成新线索卡, 名片卡理由 } from "@/lib/card-scan/lead-card";

const 表 = (补: Partial<名片表单>): 名片表单 => ({ ...空名片表单(), ...补 });

describe("名片成新线索卡", () => {
  it("有公司：名称放公司、联系人放人名；职位邮箱微信官网国家拼进备注", () => {
    const r = 名片成新线索卡(表({
      name: "王五", school: "远航贸易", phone: "13800000000", grade: "采购经理", email: "w@x.com",
      wechat: "ww", website: "x.com", country: "德国", remark: "展会认识",
    }), DEFAULT_BUSINESS, ["展会", "官网"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal).toMatchObject({ kind: "add_lead", name: "远航贸易", contact: "王五", phone: "13800000000", status: "待跟进", reason: 名片卡理由 });
    expect(r.proposal.remark.split("\n")).toEqual(["职位：采购经理", "邮箱：w@x.com", "微信：ww", "官网：x.com", "国家：德国", "展会认识"]);
    // 好几个渠道：来源留空等人选，不猜
    expect(r.proposal.source).toBe("");
  });

  it("只有人名：名称就是人名、联系人空；没手机号用 WhatsApp，和手机号一样的不重复记", () => {
    const r = 名片成新线索卡(表({ name: "Anna", whatsapp: "+49 170 1" }), DEFAULT_BUSINESS, ["展会"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal).toMatchObject({ name: "Anna", contact: "", phone: "+49 170 1" });
    expect(r.proposal.remark).toBe("");
    // 只有一个渠道：直接填上
    expect(r.proposal.source).toBe("展会");

    const 不同 = 名片成新线索卡(表({ name: "Anna", phone: "1", whatsapp: "2" }), DEFAULT_BUSINESS, []);
    expect(不同.ok && 不同.proposal.remark).toBe("WhatsApp：2");
  });

  it("下一步时间先放明天（开了超时回收必填），人在卡上改", () => {
    const r = 名片成新线索卡(表({ name: "Anna" }), DEFAULT_BUSINESS, ["展会"], "card", new Date("2026-10-27T10:00:00Z"));
    expect(r.ok && r.proposal.nextAt).toBe("2026-10-28");
  });

  it("姓名公司都没认出：不出卡，说清楚", () => {
    expect(名片成新线索卡(表({ phone: "13800000000" }), DEFAULT_BUSINESS, ["展会"])).toEqual({ ok: false, error: expect.stringContaining("没认出姓名或公司") });
  });
});

describe("走网页登录", () => {
  beforeEach(() => { vi.resetModules(); });

  it("不带令牌：没走网页登录不用服务器；走了能用，请求不带 Authorization（靠 cookie）", async () => {
    const c = await import("@/lib/card-scan/cloud");
    expect(c.能用服务器()).toBe(false);
    c.走网页登录();
    expect(c.能用服务器()).toBe(true);
    const 头们: Record<string, string>[] = [];
    const 抓 = vi.fn(async (_u: string, init?: RequestInit) => {
      头们.push({ ...(init?.headers as Record<string, string>) });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    expect(await c.服务器预热(抓)).toBe(true);
    await c.服务器整理([], [], { 抓 });
    expect(头们).toHaveLength(2);
    for (const h of 头们) expect(h).not.toHaveProperty("Authorization");
  });

  it("服务器上没配模型（整理回 404）：回 null（用规则拆的），之后不再问", async () => {
    const c = await import("@/lib/card-scan/cloud");
    c.走网页登录();
    const 抓 = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    expect(await c.服务器整理([], [], { 抓 })).toBeNull();
    expect(await c.服务器整理([], [], { 抓 })).toBeNull();
    expect(抓).toHaveBeenCalledTimes(1);
  });

  it("超时：回 null", async () => {
    const c = await import("@/lib/card-scan/cloud");
    c.走网页登录();
    const 抓 = ((_u: string, init?: RequestInit) => new Promise<Response>((_, 拒) => init?.signal?.addEventListener("abort", () => 拒(new Error("abort"))))) as unknown as typeof fetch;
    expect(await c.服务器整理([], [], { 抓, 毫秒: 30 })).toBeNull();
  });
});

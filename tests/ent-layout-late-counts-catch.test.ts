/**
 * (app)/layout 不等的那几个数（11-26，components/LateCount.tsx）数不出来时：只少一个角标，不把整页拖成错误页。
 * 钉住：
 *   - 数角标抛错：要跟解出 { 逾期: 0, 今天: 0 }、铃铛未读解出 0，各记一笔 console.error
 *   - 客户总数（非企业版左栏灰数）抛错：解出 0，同样记一笔
 *   - Next 自己的控制流错（redirect 之类）不吞：unstable_rethrow 原样抛回去，Promise 照样拒
 * 壳（AppShell）换成一个记号组件，只看 layout 交给它的 props
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

/** 错 = 一调就拒；晚拒 = 调的时候先挂着，测试拿到壳的 props、接上处理后再拒（免得 layout 还在等别的时这个拒没人接） */
const 桩 = vi.hoisted(() => ({
  角标错: new Error("库锁着") as unknown, 客户数错: new Error("库锁着") as unknown,
  角标晚拒: null as ((e: unknown) => void) | null, 客户数晚拒: null as ((e: unknown) => void) | null,
}));
const 调 = (错: unknown, 晚: "角标晚拒" | "客户数晚拒") =>
  错 === "晚拒" ? new Promise<never>((_, 拒) => { 桩[晚] = 拒; }) : Promise.reject(错);
vi.mock("@/lib/auth", async (原) => ({
  ...(await 原<object>()),
  getCurrentUser: async () => ({ id: "u-late-1", name: "测试甲", email: "late@example.test", role: "ADMIN", title: "", workspaceId: null, accountId: null }),
}));
vi.mock("@/lib/reminders-db", async (原) => ({ ...(await 原<object>()), 数角标: () => 调(桩.角标错, "角标晚拒") }));
vi.mock("@/lib/pool-db", async (原) => ({ ...(await 原<object>()), 客户总数: () => 调(桩.客户数错, "客户数晚拒") }));
vi.mock("next/headers", async (原) => ({ ...(await 原<object>()), headers: async () => new Headers({ "user-agent": "vitest" }) }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false, listModelOptions: async () => [] }));
vi.mock("@/components/AppShell", () => ({ default: function 壳记号() { return null; } }));

import AppShell from "@/components/AppShell";
import { redirect } from "next/navigation";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";

type 壳Props = { 要跟: Promise<{ 逾期: number; 今天: number }>; 通知未读?: Promise<number>; 计数?: Record<string, Promise<number>> };

/** 在 layout 吐出的元素树里找壳那一个 */
function 找壳(n: ReactNode): 壳Props | null {
  if (!n || typeof n !== "object") return null;
  if (Array.isArray(n)) {
    for (const x of n) { const r = 找壳(x); if (r) return r; }
    return null;
  }
  const el = n as ReactElement<{ children?: ReactNode }>;
  if (el.type === AppShell) return el.props as unknown as 壳Props;
  return 找壳(el.props?.children);
}
async function 打开(): Promise<壳Props> {
  const { default: AppLayout } = await import("@/app/(app)/layout");
  const 树 = await AppLayout({ children: null, pane: null, modal: null });
  const 壳 = 找壳(树);
  if (!壳) throw new Error("layout 里没找到 AppShell");
  return 壳;
}
/** Next 的 redirect 抛的那个错（带 digest，unstable_rethrow 认它） */
function 重定向错(): unknown {
  try { redirect("/login"); } catch (e) { return e; }
  throw new Error("redirect 没抛");
}

let 错日志: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  桩.角标错 = new Error("库锁着");
  桩.客户数错 = new Error("库锁着");
  错日志 = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { 错日志.mockRestore(); vi.unstubAllEnvs(); invalidateSettingsCache(); });

describe("layout 晚到的数：数不出来按 0、记一笔；Next 控制流错原样抛", () => {
  it("企业版：数角标抛错 → 要跟 {0,0}、铃铛未读 0，console.error 记了「数角标没成」", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    const 壳 = await 打开();
    await expect(壳.要跟).resolves.toEqual({ 逾期: 0, 今天: 0 });
    expect(壳.通知未读).toBeInstanceOf(Promise);
    await expect(壳.通知未读!).resolves.toBe(0);
    expect(壳.计数).toBeUndefined();
    expect(错日志.mock.calls.some((a: unknown[]) => String(a[0]).includes("数角标没成") && a[1] === "库锁着")).toBe(true);
  });

  it("非企业版：客户总数抛错 → 左栏灰数 0，console.error 记了「客户总数没数成」", async () => {
    const 壳 = await 打开();
    await expect(壳.计数!["/customers"]).resolves.toBe(0);
    await expect(壳.要跟).resolves.toEqual({ 逾期: 0, 今天: 0 });
    expect(错日志.mock.calls.some((a: unknown[]) => String(a[0]).includes("客户总数没数成") && a[1] === "库锁着")).toBe(true);
  });

  it("Next 控制流错（redirect）不按 0 吞掉：要跟 / 铃铛未读 / 客户数的 Promise 原样拒，也不记「没成」", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    const 错 = 重定向错();
    桩.角标错 = "晚拒";
    const 壳 = await 打开();
    const 要跟 = expect(壳.要跟).rejects.toBe(错);
    const 未读 = expect(壳.通知未读!).rejects.toBe(错);
    桩.角标晚拒!(错);
    await 要跟;
    await 未读;
    vi.unstubAllEnvs();
    桩.角标错 = new Error("库锁着");
    桩.客户数错 = "晚拒";
    const 壳2 = await 打开();
    const 客户数 = expect(壳2.计数!["/customers"]).rejects.toBe(错);
    桩.客户数晚拒!(错);
    await 客户数;
    await 壳2.要跟;
    expect(错日志.mock.calls.some((a: unknown[]) => String(a[0]).includes("客户总数没数成"))).toBe(false);
    expect(错日志.mock.calls.filter((a: unknown[]) => String(a[0]).includes("数角标没成"))).toHaveLength(1);
  });
});

/**
 * 全进程只有一份的异步上下文（lib/process-als.ts，2026-10-29）。
 * 钉的是：Next 不同入口各载一份模块时，看已删() 设的上下文在另一份模块里也认得——
 * 只读通道挂在 globalThis 上全进程一份，绑的是第一次建它那份模块；ALS 若每份模块各 new 一个，
 * 设置页的回收站列表在只读通道上照样被补 deletedAt:null，永远是空表。
 */
import { describe, it, expect, vi } from "vitest";
import { 全进程上下文 } from "@/lib/process-als";

describe("全进程上下文", () => {
  it("同名拿到同一个实例，不同名各一个", () => {
    expect(全进程上下文("测试甲")).toBe(全进程上下文("测试甲"));
    expect(全进程上下文("测试甲")).not.toBe(全进程上下文("测试乙"));
  });

  it("重新载一份 soft-delete-core：一份里的 看已删() 另一份也看得见", async () => {
    const 甲 = await import("@/lib/enterprise/soft-delete-core");
    vi.resetModules();
    const 乙 = await import("@/lib/enterprise/soft-delete-core");
    expect(乙).not.toBe(甲);
    expect(乙.在看已删()).toBe(false);
    const 里面 = await 甲.看已删(async () => 乙.在看已删());
    expect(里面).toBe(true);
    expect(乙.在看已删()).toBe(false);
  });
});

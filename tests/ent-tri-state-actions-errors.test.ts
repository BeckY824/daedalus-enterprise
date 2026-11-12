/**
 * 客户三态按钮的 server action（customers/tri-state-actions.ts 接住()）：只接写库被拦（CRM_READONLY），回那一句只读提示；
 * 别的错（P2025 / P2002 / P2003、其余异常）照旧往外抛，不改写成「不在了」那几句
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const 抛 = vi.hoisted(() => ({ e: null as unknown }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ id: "u1", name: "甲" }) }));
vi.mock("@/lib/enterprise/tri-state-hold", () => {
  const 做 = async () => { throw 抛.e; };
  return { 继续持有: 做, 暂缓回收动作: 做, 让同事结束项目动作: 做 };
});

import { 三态继续持有, 三态暂缓回收, 三态让同事结束项目 } from "@/app/(app)/customers/tri-state-actions";

const 错 = (code: string, message = "x") => Object.assign(new Error(message), { code });
const 三个 = [() => 三态继续持有("c1", "理由"), () => 三态暂缓回收("c1", null), () => 三态让同事结束项目("c1")];

describe("三态按钮 action 只接只读", () => {
  beforeEach(() => { 抛.e = null; });
  it("CRM_READONLY：回原话", async () => {
    抛.e = 错("CRM_READONLY", "正在切换视图（只读）：不能改任何数据。要改请先点顶上的「退出」回到自己的身份");
    for (const f of 三个) expect(await f()).toEqual({ ok: false, error: "正在切换视图（只读）：不能改任何数据。要改请先点顶上的「退出」回到自己的身份" });
  });
  it.each(["P2025", "P2002", "P2003"])("%s：照旧抛出去", async (code) => {
    抛.e = 错(code);
    for (const f of 三个) await expect(f()).rejects.toMatchObject({ code });
  });
  it("没有 code 的异常：照旧抛", async () => {
    抛.e = new Error("别的错");
    for (const f of 三个) await expect(f()).rejects.toThrow("别的错");
  });
});

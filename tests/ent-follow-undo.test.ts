/**
 * P-沟通-01（11-09）：沟通记录本人也不能撤销——时间线、项目详情上的「撤销」键和服务端入口都去掉。
 * AI 卡片的「撤销」、完成小框的「撤销记一笔」改成单独判定（卡片刚记的能撤），继续可用。
 *
 * 钉的是：
 *   - 入口没了：撤销刚记的沟通 不再是服务端动作；FollowUndo 组件、follow-undo 前后端共用口径删掉；时间线、项目详情、记沟通的表单不再引
 *   - 卡片刚记的能撤：本人、10 分钟内；过了、别人的、没记人的都不行
 *   - 卡片撤销放行：只在 放行 里、只认那一条 id
 * 真走库的（普通成员删不了刚记的、AI 卡片撤销照常）见 ent-followup-p3.test.ts「P-沟通-01」
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 卡片刚记的能撤, 卡片撤销窗口分钟, 卡片撤销放行, 在卡片撤销里 } from "@/lib/enterprise/follow-perm";

const 根 = path.resolve(__dirname, "..");
const 读 = (p: string) => fs.readFileSync(path.join(根, p), "utf8");

describe("本人撤销沟通的入口没了", () => {
  it("撤销刚记的沟通 不再是服务端动作", () => {
    expect(读("src/app/(app)/customers/[id]/actions.ts")).not.toMatch(/export\s+async\s+function\s+撤销刚记的沟通/);
  });
  it("FollowUndo 组件、follow-undo 口径文件都删了", () => {
    expect(fs.existsSync(path.join(根, "src/components/FollowUndo.tsx"))).toBe(false);
    expect(fs.existsSync(path.join(根, "src/lib/enterprise/follow-undo.ts"))).toBe(false);
  });
  it("时间线、项目详情、记沟通表单不再摆「撤销」", () => {
    for (const p of ["src/app/(app)/customers/[id]/RecordView.tsx", "src/app/(app)/projects/[id]/ProjectDetail.tsx", "src/app/(app)/customers/[id]/FollowUpForm.tsx"]) {
      const s = 读(p);
      expect(s, p).not.toContain("UndoRecentFollow");
      expect(s, p).not.toContain("记下带撤销");
      expect(s, p).not.toContain("FollowUndo");
    }
  });
});

describe("卡片刚记的能撤（AI 卡片撤销、撤销记一笔）", () => {
  const 记下 = new Date("2026-11-09T10:00:00Z");
  const 过 = (分: number) => new Date(记下.getTime() + 分 * 60_000);
  it("本人、10 分钟内：能撤（含正好 10 分钟）", () => {
    expect(卡片撤销窗口分钟).toBe(10);
    expect(卡片刚记的能撤({ id: "u1" }, { ownerId: "u1", createdAt: 记下 }, 过(0))).toBe(true);
    expect(卡片刚记的能撤({ id: "u1" }, { ownerId: "u1", createdAt: 记下 }, 过(10))).toBe(true);
  });
  it("过了 10 分钟、别人记的、没记人的：不能撤", () => {
    expect(卡片刚记的能撤({ id: "u1" }, { ownerId: "u1", createdAt: 记下 }, 过(10.01))).toBe(false);
    expect(卡片刚记的能撤({ id: "u2" }, { ownerId: "u1", createdAt: 记下 }, 过(1))).toBe(false);
    expect(卡片刚记的能撤({ id: "u2" }, { ownerId: null, createdAt: 记下 }, 过(1))).toBe(false);
  });
  it("卡片撤销放行：只在放行里、只认那一条", async () => {
    expect(在卡片撤销里("f1")).toBe(false);
    const 里 = await 卡片撤销放行("f1", async () => [在卡片撤销里("f1"), 在卡片撤销里("f2")]);
    expect(里).toEqual([true, false]);
    expect(在卡片撤销里("f1")).toBe(false);
  });
});

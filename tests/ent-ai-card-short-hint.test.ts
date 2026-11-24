/**
 * 首页 AI 卡记沟通、内容不算有效沟通（E-259）：落印下面要说出来（lib/agent/seal-lines.ts 的 落印行们）
 *   - 有提示出一行，没提示不出；和推进都有时两行都出
 *   - 「已保存。」落印那格已经说了，不说两遍；提示已在推进里就只出推进那行
 *   - 记沟通卡（apply.ts）和项目沟通卡（apply-project.ts）都把短沟通那句作为 提示 交回卡上，卡把它记进回执
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { 落印行们 } from "@/lib/agent/seal-lines";
import { 超时短沟通话, 短沟通话 } from "@/lib/enterprise/tri-state-quota";

const 超时 = 超时短沟通话("太短").replace(/^已保存。/u, "");
const 推 = "项目「某项目」必填齐了，自动推进到 方案敲定（撤销这条沟通不会把进程退回去）";

describe("落印行们", () => {
  it("有提示：出一行提示，testid prop-done-hint", () => {
    expect(落印行们({ 提示: 超时 })).toEqual([{ 种: "提示", 话: 超时, testid: "prop-done-hint" }]);
  });

  it("没提示、没推进：一行不出", () => {
    expect(落印行们({})).toEqual([]);
    expect(落印行们({ 提示: "", 推进: "  " })).toEqual([]);
    expect(落印行们(null)).toEqual([]);
  });

  it("推进和提示都有：两行都出，推进在前", () => {
    expect(落印行们({ 推进: 推, 提示: 超时 }).map((x) => [x.种, x.话])).toEqual([["推进", 推], ["提示", 超时]]);
  });

  it("提示带着「已保存。」也去掉，不和落印的「已写入」说两遍", () => {
    expect(落印行们({ 提示: 超时短沟通话("太短") })[0].话).toBe(超时);
    expect(落印行们({ 提示: 短沟通话.太短 })[0].话.startsWith("已保存")).toBe(false);
  });

  it("提示已经在推进那句里：只出推进", () => {
    expect(落印行们({ 推进: `${推}；${超时}`, 提示: 超时 }).map((x) => x.种)).toEqual(["推进"]);
  });
});

describe("短沟通那句交到卡上", () => {
  const 读 = (p: string) => readFileSync(p, "utf8");

  it("记沟通卡：apply.ts 把 短话 作为 提示 交回（推话不重复，另走 推进）", () => {
    const s = 读("src/app/(app)/dashboard/apply.ts");
    expect(s).toMatch(/\.\.\.\(短话 \? \{ 短话 \} : \{\}\)/);
    expect(s).toMatch(/\.\.\.\(done\.短话 \? \{ 提示: done\.短话 \} : \{\}\)/);
  });

  it("项目沟通卡：apply-project.ts 把 短话 作为 提示 交回、做项目卡透传", () => {
    const s = 读("src/lib/agent/apply-project.ts");
    expect(s).toMatch(/\.\.\.\(短话 \? \{ 提示: 短话 \} : \{\}\)/);
    expect(s).toMatch(/\.\.\.\(done\.提示 \? \{ 提示: done\.提示 \} : \{\}\)/);
  });

  it("ProposalCard：回执记下 提示，落印下面按 落印行们 出行", () => {
    const s = 读("src/components/ProposalCard.tsx");
    expect(s).toMatch(/\.\.\.\(r\.提示 \? \{ 提示: r\.提示 \} : \{\}\)/);
    expect(s).toContain("落印行们(落印).map(");
    expect(s).not.toMatch(/落印\?\.推进 &&/);
  });
});

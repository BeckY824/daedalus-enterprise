/**
 * 首页 AI 卡记沟通、内容不算有效沟通（E-259）：落印下面要说出来（lib/agent/seal-lines.ts 的 落印行们）
 *   - 有提示出一行，没提示不出；和推进都有时两行都出
 *   - 「已保存。」落印那格已经说了，不说两遍；提示已在推进里就只出推进那行
 *   - 记沟通卡（apply.ts）和项目沟通卡（apply-project.ts）都把短沟通那句作为 提示 交回卡上，卡把它记进回执
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { 落印行们 } from "@/lib/agent/seal-lines";
import { 超时短沟通话, 短沟通话, 沟通卡太短, 沟通卡太短话, 有内容的沟通 } from "@/lib/enterprise/tri-state-quota";

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

describe("短沟通 / 卡点没发那句交到卡上", () => {
  const 读 = (p: string) => readFileSync(p, "utf8");

  it("记沟通卡：apply.ts 把 短话 作为 提示 交回（推话不重复，另走 推进）", () => {
    const s = 读("src/app/(app)/dashboard/apply.ts");
    expect(s).toMatch(/\.\.\.\(短话 \? \{ 短话 \} : \{\}\)/);
    expect(s).toMatch(/\.\.\.\(done\.短话 \? \{ 提示: done\.短话 \} : \{\}\)/);
  });

  it("项目沟通卡：apply-project.ts 把 短话 作为 提示 交回、做项目卡透传", () => {
    const s = 读("src/lib/agent/apply-project.ts");
    // 卡点没发出去那句也进 提示（卡上看得见，不只在 message 里）
    expect(s).toContain('const 卡上提示 = [没发话, 短话].filter(Boolean).join("；");');
    expect(s).toMatch(/\.\.\.\(卡上提示 \? \{ 提示: 卡上提示 \} : \{\}\)/);
    expect(s).toMatch(/\.\.\.\(done\.提示 \? \{ 提示: done\.提示 \} : \{\}\)/);
  });

  it("ProposalCard：回执记下 提示，落印下面按 落印行们 出行", () => {
    const s = 读("src/components/ProposalCard.tsx");
    expect(s).toMatch(/\.\.\.\(r\.提示 \? \{ 提示: r\.提示 \} : \{\}\)/);
    expect(s).toContain("落印行们(落印).map(");
    expect(s).not.toMatch(/落印\?\.推进 &&/);
  });
});

describe("记沟通卡确认前的灰字：不足 4 个字照样存（E-259）", () => {
  it("不足 4 个字 / 英文不足 2 个单词：出灰字；够了、空的不出", () => {
    for (const t of ["加微信", "嗯", "ok", "报价 3 万"]) expect(沟通卡太短(t), t).toBe(true);
    for (const t of ["加了微信", "Sent quote", "", "   ", "！！"]) expect(沟通卡太短(t), t).toBe(false);
  });

  it("口径没动：出灰字的都不算有效沟通", () => {
    for (const t of ["加微信", "嗯", "ok"]) expect(有内容的沟通(t)).toBe(false);
    expect(沟通卡太短话).toBe("不足 4 个字，不算有效沟通，不会重置跟进倒计时");
  });

  it("ProposalCard：内容框下按 沟通卡太短 出灰字", () => {
    const s = readFileSync("src/components/ProposalCard.tsx", "utf8");
    expect(s).toMatch(/\{沟通卡太短\(draft\.content\) && <div className="prop-name-hint" data-testid="prop-short-follow-hint">\{沟通卡太短话\}<\/div>\}/);
  });
});

/**
 * 首页 AI 卡记沟通、内容不算有效沟通（E-259）：落印下面要说出来（lib/agent/seal-lines.ts 的 落印行们）
 *   - 有提示出一行，没提示不出；和推进都有时两行都出
 *   - 「已保存。」落印那格已经说了，不说两遍；提示已在推进里就只出推进那行
 *   - 记沟通卡（apply.ts）和项目沟通卡（apply-project.ts）都把短沟通那句作为 提示 交回卡上，卡把它记进回执
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { 落印行们 } from "@/lib/agent/seal-lines";
import { 超时短沟通话, 短沟通话, 沟通意义提示, 判沟通无意义, 有内容的沟通 } from "@/lib/enterprise/tri-state-quota";

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

describe("记沟通卡确认前那一行：对齐 F-052，按开关两态（E-259）", () => {
  const 开 = { 拦: true, 占位词: undefined } as const;
  const 关 = { 拦: false, 占位词: undefined } as const;
  it("太短（含只有表情 / 标点）：开关开着说不能保存、还差 N 个字；关着只说不算有效沟通", () => {
    for (const t of ["加微信", "嗯", "报价 3 万", "👍", "。。。", "!!!!", "！！"]) {
      expect(判沟通无意义(t, "PHONE").无意义, t).toBe(true);
      expect(沟通意义提示(t, "PHONE", 开), t).toMatch(/^这样写会被判为无意义，不能保存：不足 4 个字，还差 \d 个字/u);
      expect(沟通意义提示(t, "PHONE", 关), t).toMatch(/^不足 4 个字，还差 \d 个字.*，不算有效沟通$/u);
    }
    expect(沟通意义提示("加微信", "PHONE", 开)).toBe("这样写会被判为无意义，不能保存：不足 4 个字，还差 1 个字");
    expect(沟通意义提示("加微信", "PHONE", 关)).toBe("不足 4 个字，还差 1 个字，不算有效沟通");
  });

  it("占位词（够 4 个字也算）：开关开 / 关都照存，只说不算有效沟通", () => {
    for (const t of ["已联系跟进", "跟进跟进", "跟进", "已联系"]) {
      expect(判沟通无意义(t, "PHONE").无意义, t).toBe(false);
      for (const 选 of [开, 关]) expect(沟通意义提示(t, "PHONE", 选), t).toBe("只有「跟进」「已联系」这类占位词，不算有效沟通");
    }
  });

  it("不出：够了的、空的", () => {
    for (const t of ["加了微信", "Sent quote", "", "   "]) for (const 选 of [开, 关]) expect(沟通意义提示(t, "PHONE", 选), t).toBeNull();
  });

  it("口径没动：出那一行的都不算有效沟通；话不提倒计时", () => {
    for (const t of ["加微信", "嗯", "ok", "👍", "已联系跟进"]) expect(有内容的沟通(t), t).toBe(false);
    for (const t of ["加微信", "已联系跟进"]) for (const 选 of [开, 关]) expect(沟通意义提示(t, "PHONE", 选)).not.toMatch(/倒计时|重置/u);
  });

  it("ProposalCard：只走 F-052 那一行（FollowMeaningLine），开关开着判为无意义的不能确认；不再有第三套灰字", () => {
    const s = readFileSync("src/components/ProposalCard.tsx", "utf8");
    expect(s).toContain("<FollowMeaningLine 内容={draft.content} 类型={draft.type} />");
    // 11-26：记沟通卡（add_followup）、AI 项目沟通卡（project_followup）都按开关拦；写了但无意义的确认键旁写「还差有效的沟通内容」
    expect(s).toMatch(/const 跟进无意义 = 判定\.拦 && \(draft\.kind === "add_followup" \? 判沟通无意义\(draft\.content, draft\.type, \{ 占位词: 判定\.占位词 \}\)\.无意义/);
    expect(s).toMatch(/draft\.kind === "project_followup" && 判沟通无意义\(并进描述\(draft\.content, draft\.卡点描述\), draft\.type, \{ 占位词: 判定\.占位词 \}\)\.无意义\);/);
    expect(s).toContain('if (跟进无意义 && !missing.includes("沟通内容")) missing.unshift("有效的沟通内容");');
    expect(s).not.toMatch(/沟通卡灰字|prop-short-follow-hint/);
  });
});

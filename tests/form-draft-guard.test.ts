/**
 * 草稿是长表单的默认行为（批次 25C，复盘第 1 类）：发版后老页面提交失败、刷新一下，已经打的字跟着页面一起丢。
 * 11-17 复盘时 33 个长文本表单里 19 个没接草稿（线索转项目、回收预警记沟通、同号再录、完成跟进计划、教练主题回复……）。
 *
 * 钉法（扫源码，不连库、不 import 业务代码）：src 里每个摆了长文本框（Input.TextArea / TextArea / textarea）的 .tsx，
 * 要接上草稿——下面三种之一：
 *   - useFormDraft(…)（components/FormDraft.tsx：useState 写的表单、就地改的格子）
 *   - useFormGuard({ …草稿键: <不是 null>… })（lib/form-guard.tsx：antd 表单弹窗）
 *   - 草稿全名(…)（自己按格存的，项目建档向导）
 * 接了的还得在交成功时清掉（调 .存好了()）。确实不该留草稿的列进 不留草稿，写清为什么。
 * 存取规矩（只存本机 localStorage、按人分、3 天、读写包 try）见 tests/form-draft.test.ts
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 不留草稿: Record<string, string> = {
  "src/components/AskBox.tsx": "只是首页问答的输入框外壳，唯一调用方 dashboard/Composer.tsx 已按对话接了草稿",
  "src/components/ProjectProposalFields.tsx": "AI 项目卡上的几格，draft 由外层 ProposalCard 持有、草稿也由它统一存",
  "src/components/research/MailPaste.tsx": "框里写明「原文不上传、不保存，关掉就没了」：询盘邮件原文不进浏览器存储；粘贴来的，丢了再粘一次",
  "src/app/(app)/customers/import-steps.tsx": "粘进来的整份名单 / 聊天记录（原处还在，丢了再粘一次）；整份带号码的名单不留在浏览器里",
  "src/app/(app)/projects/[id]/CoachRecConfirm.tsx": "录音点评确认框：草稿存在服务器的录音行上（「稍后再发」、点 × 都存，下次打开带回）；转写、要点可能带号码，不留在浏览器里",
  "src/app/(app)/projects/[id]/GiveUpDialog.tsx": "放弃（豁免）框里选「其他」时补一句原因（100 字以内、一月一次），丢了重写一句；不值得为它留草稿",
  "src/app/(app)/customers/merge-requests/MergeRequestsView.tsx": "拒绝合并申请时选填一句原因（100 字以内），丢了重写一句；不值得为它留草稿",
};

/** 交出去时框本来就清空、草稿跟着删（useFormDraft：改回空就删），不另调 存好了 */
const 清空即删: Record<string, string> = {
  "src/app/(app)/dashboard/Composer.tsx": "首页问答发出去时框清空（submit 里 setQ(\"\")），草稿跟着删",
};

const 根 = path.resolve(__dirname, "..");
const 长文本框 = /<(?:Input\.TextArea|TextArea|textarea)\b/;

function 列文件(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? 列文件(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

/** useFormGuard( 的整段参数（括号配平），看 草稿键 写的是什么 */
function 守卫调用们(s: string): string[] {
  const 出: string[] = [];
  let i = s.indexOf("useFormGuard(");
  while (i >= 0) {
    let 深 = 0;
    let j = i + "useFormGuard".length;
    for (; j < s.length; j++) {
      if (s[j] === "(") 深++;
      else if (s[j] === ")" && --深 === 0) break;
    }
    出.push(s.slice(i, j + 1));
    i = s.indexOf("useFormGuard(", j);
  }
  return 出.filter((c) => !c.startsWith("useFormGuard({ open, 关, form, 草稿键, 编辑")); // 定义处
}

function 接了草稿(s: string): boolean {
  if (/\buseFormDraft\(/.test(s) || /草稿全名\(/.test(s)) return true;
  return 守卫调用们(s).some((c) => /草稿键\s*:\s*(?!null\b)\S/.test(c));
}

const 文件们 = 列文件(path.join(根, "src"))
  // Windows 上是反斜杠：统一成正斜杠，名单才对得上
  .map((f) => path.relative(根, f).split(path.sep).join("/"))
  .filter((f) => !f.startsWith("src/lib/form-guard") && f !== "src/components/FormDraft.tsx")
  .map((f) => ({ f, s: fs.readFileSync(path.join(根, f), "utf8") }));

describe("长表单默认留草稿", () => {
  it("摆了长文本框的都接了草稿（不接的写进名单、说清为什么）", () => {
    const 没接 = 文件们.filter(({ f, s }) => 长文本框.test(s) && !接了草稿(s) && !(f in 不留草稿)).map(({ f }) => f);
    expect(没接, "这些文件有长文本框但没接草稿：接 useFormDraft / useFormGuard 的草稿键，或写进 不留草稿 名单").toEqual([]);
  });

  it("接了草稿的，交成功时清掉（调 存好了）", () => {
    const 不清 = 文件们.filter(({ s }) => (/\buseFormDraft\(/.test(s) || 守卫调用们(s).length > 0) && !/\.存好了\(\)/.test(s)).map(({ f }) => f).filter((f) => !(f in 清空即删));
    expect(不清, "这些文件接了草稿但存上之后没调 .存好了()，草稿会一直带回").toEqual([]);
  });

  it("useFormGuard 的草稿键必须写（写 null 要在同一行旁边说为什么）", () => {
    const 没写 = 文件们.flatMap(({ f, s }) => 守卫调用们(s).filter((c) => !/草稿键\s*:/.test(c)).map(() => f));
    expect(没写).toEqual([]);
    const 写了null没说 = 文件们.flatMap(({ f, s }) =>
      s.split("\n").filter((l) => /草稿键\s*:\s*null\b/.test(l) && !/\/\/|\/\*/.test(l)).map(() => f),
    );
    expect(写了null没说).toEqual([]);
  });

  it("名单里的文件还在、也确实还有长文本框（没了就从名单里删）", () => {
    for (const f of Object.keys(不留草稿)) {
      const 有 = 文件们.find((x) => x.f === f);
      expect(有, `${f} 不在了`).toBeTruthy();
      expect(长文本框.test(有!.s), `${f} 已经没有长文本框了`).toBe(true);
      expect(接了草稿(有!.s), `${f} 已经接了草稿，从名单里删掉`).toBe(false);
    }
  });

  it("复盘第 1 类点名的那几处都接上了", () => {
    const 点名 = [
      "src/app/(app)/leads/ConvertProjectModal.tsx", // 线索转项目弹窗
      "src/app/(app)/overview/BoardTodos.tsx", // 首页回收预警「记一条沟通」
      "src/app/(app)/projects/new/SameNumberEntry.tsx", // 同号再录
      "src/app/(app)/customers/[id]/CompletePlanModal.tsx", // 完成跟进计划
      "src/app/(app)/projects/[id]/CoachTopics.tsx", // 教练主题回复
    ];
    for (const f of 点名) expect(接了草稿(文件们.find((x) => x.f === f)!.s), f).toBe(true);
  });
});

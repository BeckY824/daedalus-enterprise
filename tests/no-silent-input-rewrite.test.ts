/**
 * 守卫：用户敲的号码、金额不许被悄悄改写（11-17 复盘第 4 类「输入被悄悄改写，用户不知道」）。
 *
 * 当时查出 7 处：AI 卡金额框 onChange 里直接 replace(/[^\d.]/g, "")（「1万」存成 1、「-500」存成 500），
 * 线索 / 渠道电话截出数字存下、原文悄悄塞进备注，导入把「sqin175…」里的数字截成电话……修法一律是：要么原样存，要么拦下并就地说为什么。
 * 这里钉住两种最容易再犯的写法：
 *
 * 1. 界面：输入控件的值处理属性（onChange / onInput / onBlur / normalize / parser / getValueFromEvent）里，
 *    不许用「删字」的 replace —— 正则是排除类（`[^…]`）或 `\D`、换成空串。
 *    判据只看这一种写法：trim、toLowerCase、全角转半角这类不丢信息的不管；要认数字请用 认金额（lib/money-input）/
 *    录入电话（lib/phone）这类解析函数，认不出就就地提示（见 components/AmountTextInput）。
 * 2. 服务端动作（src/app 下）：不许调 号码带着字、也不许拼「原始电话：」进备注 —— 那是「截出号码、原文悄悄塞备注」的老写法。
 *    表单录入用 录入电话（号码以外的字整格拦下）或 验客户电话；导入在 lib/ 里，报告里会说清（不在这条管）。
 *
 * 真有合理的例外，在那一行上面写 `// 允许删字：<原因>`，本守卫跳过那个属性。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 根 = path.resolve(__dirname, "..");

function* 源文件(dir: string, 后缀: RegExp): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "generated" || e.name === "node_modules") continue;
      yield* 源文件(p, 后缀);
    } else if (后缀.test(e.name)) yield p;
  }
}

/** 删字的 replace：`.replace(/[^…]…/g, "")`、`.replace(/\D/g, '')` */
const 删字 = /\.replace(?:All)?\(\s*\/(?:\[\^|\\D)(?:\\.|[^/\n])*\/[a-z]*\s*,\s*(?:""|''|``)\s*\)/;
const 值属性 = /\b(onChange|onInput|onBlur|normalize|parser|getValueFromEvent)=\{/g;

/** 从 `{` 开始取到配对的 `}`（不细管字符串里的括号：属性体里少见，误差只会让检查范围大一点） */
function 取属性体(s: string, 开: number): string {
  let 深 = 0;
  for (let i = 开; i < s.length; i++) {
    if (s[i] === "{") 深++;
    else if (s[i] === "}" && --深 === 0) return s.slice(开, i + 1);
  }
  return s.slice(开);
}

/** 一个 tsx 源码里犯规的属性：返回「行号 属性名」 */
function 找删字属性(源: string): string[] {
  const 犯: string[] = [];
  for (const m of 源.matchAll(值属性)) {
    const 体 = 取属性体(源, m.index + m[0].length - 1);
    if (!删字.test(体)) continue;
    const 行号 = 源.slice(0, m.index).split("\n").length;
    const 上一行 = 源.split("\n")[行号 - 2] ?? "";
    if (/允许删字：\S/.test(上一行)) continue;
    犯.push(`${行号} ${m[1]}`);
  }
  return 犯;
}

describe("判据自检", () => {
  it("抓得到 11-17 那两处金额框的老写法", () => {
    const 老 = `<Input value={draft.amount || ""} onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value.replace(/[^\\d.]/g, "")) || 0 })} />`;
    expect(找删字属性(老)).toEqual(["1 onChange"]);
    expect(找删字属性(`<Input onChange={(e) => {\n  set(e.target.value.replace(/\\D/g, ''));\n}} />`)).toEqual(["1 onChange"]);
    expect(找删字属性(`<InputNumber parser={(v) => v?.replace(/[^0-9]/g, "")} />`)).toEqual(["1 parser"]);
  });
  it("不丢信息的处理、onChange 外面的 replace、写明原因的例外不算", () => {
    expect(找删字属性(`<Form.Item normalize={(v?: string) => v?.trim().toLowerCase()} />`)).toEqual([]);
    expect(找删字属性(`<Input onChange={(e) => set(e.target.value.replace(/\\s+/g, " "))} />`)).toEqual([]);
    expect(找删字属性(`const k = v.replace(/[^\\d]/g, "");\n<Input onChange={(e) => set(e.target.value)} />`)).toEqual([]);
    expect(找删字属性(`// 允许删字：验证码只收数字，框边写着\n<Input onChange={(e) => set(e.target.value.replace(/\\D/g, ""))} />`)).toEqual([]);
  });
});

describe("号码、金额不悄悄改写", () => {
  it("界面：输入控件的值处理里没有删字的 replace", () => {
    const 犯: string[] = [];
    for (const f of 源文件(path.join(根, "src"), /\.tsx$/)) {
      for (const x of 找删字属性(fs.readFileSync(f, "utf8"))) 犯.push(`${path.relative(根, f)}:${x}`);
    }
    expect(犯).toEqual([]);
  });

  it("服务端动作（src/app）不截号码后把原文悄悄塞进备注", () => {
    const 犯: string[] = [];
    for (const f of 源文件(path.join(根, "src/app"), /\.(ts|tsx)$/)) {
      const s = fs.readFileSync(f, "utf8");
      if (/号码带着字\(/.test(s) || /原始电话：/.test(s)) 犯.push(path.relative(根, f));
    }
    expect(犯).toEqual([]);
  });
});

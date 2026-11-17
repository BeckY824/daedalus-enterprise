import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { 旧浏览器提示脚本, 旧浏览器提示节点, 旧浏览器提示文案, 旧浏览器提示小字 } from "@/lib/old-browser";

/** 一个够用的假 document：只记 body 上挂了什么、文字是什么 */
type 节点 = { tag: string; id?: string; textContent: string; style: { cssText: string }; kids: 节点[]; attrs: Record<string, string>;
  setAttribute(k: string, v: string): void; appendChild(n: 节点): 节点; insertBefore(n: 节点, ref: 节点 | null): 节点; firstChild: 节点 | null };

function 造节点(tag: string): 节点 {
  const n: 节点 = {
    tag, textContent: "", style: { cssText: "" }, kids: [], attrs: {},
    setAttribute(k, v) { n.attrs[k] = v; },
    appendChild(c) { n.kids.push(c); return c; },
    insertBefore(c, ref) { const i = ref ? n.kids.indexOf(ref) : -1; if (i < 0) n.kids.push(c); else n.kids.splice(i, 0, c); return c; },
    get firstChild() { return n.kids[0] ?? null; },
  };
  return n;
}

function 造环境(opts: { 有body?: boolean } = {}) {
  const body = 造节点("body");
  body.appendChild(造节点("div")); // React 那一层
  const 监听: Record<string, () => void> = {};
  const 定时: (() => void)[] = [];
  const document = {
    body: opts.有body === false ? null : body,
    createElement: 造节点,
    getElementById: (id: string) => (document.body?.kids.find((k) => k.id === id) ?? null),
    addEventListener: (ev: string, fn: () => void) => { 监听[ev] = fn; },
  };
  return { body, document, 监听, 定时, setInterval: (fn: () => void) => { 定时.push(fn); return 1; } };
}

const 后行断言会挂 = function (this: unknown, src: string) {
  if (src.includes("(?<=")) throw new SyntaxError("Invalid regular expression: invalid group specifier name");
  return new RegExp(src);
} as unknown as RegExpConstructor;

function 跑(env: ReturnType<typeof 造环境>, g: { RegExp?: unknown; Array?: unknown; structuredClone?: unknown } = {}) {
  const 参数 = {
    RegExp: "RegExp" in g ? g.RegExp : RegExp,
    Array: "Array" in g ? g.Array : Array,
    structuredClone: "structuredClone" in g ? g.structuredClone : structuredClone,
    document: env.document,
    setInterval: env.setInterval,
    location: { protocol: "https:", host: "crm.example.test" },
  };
  new Function(...Object.keys(参数), 旧浏览器提示脚本)(...Object.values(参数));
}

const 提示 = (env: ReturnType<typeof 造环境>) => env.body.kids.filter((k) => k.id === 旧浏览器提示节点);
const 全文 = (n: 节点): string => n.textContent + n.kids.map(全文).join("|");

describe("旧浏览器提示脚本", () => {
  it("脚本是 ES5：旧 Safari 也能解析（后行断言不能写成正则字面量）", () => {
    const acorn = createRequire(import.meta.url)("acorn") as { parse(s: string, o: object): unknown };
    expect(() => acorn.parse(旧浏览器提示脚本, { ecmaVersion: 5 })).not.toThrow();
    expect(旧浏览器提示脚本).not.toMatch(/\/\(\?<=/);
  });

  it("新浏览器：一个节点都不插，也不挂定时器和监听", () => {
    const env = 造环境();
    跑(env);
    expect(env.body.kids).toHaveLength(1);
    expect(env.定时).toHaveLength(0);
    expect(Object.keys(env.监听)).toHaveLength(0);
  });

  it("不支持后行断言（Safari < 16.4）：body 最前面插整页提示，文案和地址都在", () => {
    const env = 造环境();
    跑(env, { RegExp: 后行断言会挂 });
    const n = 提示(env);
    expect(n).toHaveLength(1);
    expect(env.body.firstChild).toBe(n[0]);
    expect(n[0].attrs.role).toBe("alert");
    expect(n[0].style.cssText).toContain("position:fixed");
    const 字 = 全文(n[0]);
    expect(字).toContain(旧浏览器提示文案);
    expect(字).toContain(旧浏览器提示小字);
    expect(字).toContain("https://crm.example.test");
  });

  it("缺 findLast 或 structuredClone 也判为太旧", () => {
    const a = 造环境();
    跑(a, { Array: { prototype: {} } });
    expect(提示(a)).toHaveLength(1);
    const b = 造环境();
    跑(b, { structuredClone: undefined });
    expect(提示(b)).toHaveLength(1);
  });

  it("head 里跑时 body 还没有：等 DOMContentLoaded 再挂；被冲掉后定时器补回、不重复挂", () => {
    const env = 造环境({ 有body: false });
    跑(env, { RegExp: 后行断言会挂 });
    expect(env.监听.DOMContentLoaded).toBeTypeOf("function");
    env.document.body = env.body;
    env.监听.DOMContentLoaded();
    expect(提示(env)).toHaveLength(1);
    env.定时[0]();
    expect(提示(env)).toHaveLength(1);
    env.body.kids = env.body.kids.filter((k) => k.id !== 旧浏览器提示节点); // React 整页重渲染冲掉
    env.定时[0]();
    expect(提示(env)).toHaveLength(1);
  });

  it("根 layout 的 <head> 里挂了它（登录页也走根 layout）", () => {
    const src = readFileSync(path.join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(src).toMatch(/<head>[\s\S]*__html: 旧浏览器提示脚本[\s\S]*<\/head>/);
  });
});

/**
 * 附件区粘贴截图（lib/paste-upload.ts，11-17 员工反馈「附件不支持截图」）。
 *
 * 钉这几件：
 * 1. 剪贴板里有图片文件 → 交给附件区传的那个函数（组件里就是点选上传 beforeUpload 用的 传一个），并 preventDefault
 * 2. 截图没名字 / 叫 image.png → 改名「截图-YYYYMMDD-HHmmss.png」，北京时间；一次几张后面加 -2
 * 3. 不该接的不接：附件区不能传（只读 / 视图中 / 传着，组件里不挂监听）、焦点在范围外、
 *    范围里有好几个附件区而焦点不在这个区里、输入框里粘文字、别处已处理
 * 不引 jsdom：DOM 只用到 contains / closest / querySelectorAll / tagName，拿小对象模拟
 */
import { describe, it, expect, vi } from "vitest";
import { 接粘贴, 剪贴板文件, 截图名, 粘贴范围选择器, 粘贴标记 } from "@/lib/paste-upload";

type 假元素 = {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
  父: 假元素 | null;
  属性: Record<string, string>;
  contains(x: unknown): boolean;
  closest(sel: string): 假元素 | null;
  querySelectorAll(sel: string): 假元素[];
};
const 全部: 假元素[] = [];
function 元素(tagName: string, 父: 假元素 | null = null, 属性: Record<string, string> = {}, 多?: Partial<假元素>): 假元素 {
  const el: 假元素 = {
    tagName, 父, 属性, ...多,
    contains(x) { for (let p = x as 假元素 | null; p; p = p.父) if (p === el) return true; return false; },
    closest(sel) {
      expect(sel).toBe(粘贴范围选择器);
      for (let p: 假元素 | null = el; p; p = p.父) if ("data-paste-scope" in p.属性 || p.属性.role === "dialog") return p;
      return null;
    },
    querySelectorAll(sel) {
      expect(sel).toBe(`[${粘贴标记}]`);
      return 全部.filter((x) => x !== el && el.contains(x) && 粘贴标记 in x.属性);
    },
  };
  全部.push(el);
  return el;
}

function 剪贴板({ 文件们 = [] as File[], 文字 = "", 只走items = false } = {}): DataTransfer {
  return {
    files: 只走items ? [] : 文件们,
    items: 文件们.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })),
    getData: (t: string) => (t === "text/plain" ? 文字 : ""),
  } as unknown as DataTransfer;
}
function 粘贴(target: unknown, dt: DataTransfer) {
  return { target: target as EventTarget, clipboardData: dt, defaultPrevented: false, preventDefault: vi.fn() };
}
const 截图 = () => new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" });
// 2026-11-17 06:05:09 UTC = 北京 14:05:09
const 那时 = new Date(Date.UTC(2026, 10, 17, 6, 5, 9));

describe("截图名", () => {
  it("按北京时间写，不随这台电脑的时区", () => {
    expect(截图名(那时)).toBe("截图-20261117-140509.png");
    // 伦敦 11-17 20:30 = 北京 11-18 04:30，跨天按北京
    expect(截图名(new Date(Date.UTC(2026, 10, 17, 20, 30, 0)))).toBe("截图-20261118-043000.png");
  });
});

describe("剪贴板文件", () => {
  it("image.png / 没名字的截图改名；一次几张后面加 -2；有名字的、非图片的原样", () => {
    const 无名 = new File([new Uint8Array([1])], "", { type: "image/png" });
    const 有名 = new File([new Uint8Array([1])], "报价单.pdf", { type: "application/pdf" });
    const 照片 = new File([new Uint8Array([1])], "现场.jpg", { type: "image/jpeg" });
    const 们 = 剪贴板文件(剪贴板({ 文件们: [截图(), 无名, 有名, 照片] }), 那时);
    expect(们.map((f) => f.name)).toEqual(["截图-20261117-140509.png", "截图-20261117-140509-2.png", "报价单.pdf", "现场.jpg"]);
    expect(们[0].type).toBe("image/png");
    expect(们[0].size).toBe(4);
  });
  it("files 是空的就看 items 里 kind=file 的", () => {
    expect(剪贴板文件(剪贴板({ 文件们: [截图()], 只走items: true }), 那时).map((f) => f.name)).toEqual(["截图-20261117-140509.png"]);
  });
  it("只有文字：没有文件", () => {
    expect(剪贴板文件(剪贴板({ 文字: "你好" }))).toEqual([]);
  });
});

describe("接粘贴", () => {
  it("焦点在附件区里、剪贴板里是截图：交给同一个上传函数，拦下默认粘贴", () => {
    const 面板 = 元素("DIV", null, { [粘贴标记]: "" });
    const 按钮 = 元素("SPAN", 面板);
    const 传一个 = vi.fn();
    const e = 粘贴(按钮, 剪贴板({ 文件们: [截图()] }));
    expect(接粘贴(e, 面板 as unknown as Element, (们) => 们.forEach(传一个), { 现在: 那时 })).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(传一个).toHaveBeenCalledTimes(1);
    const f = 传一个.mock.calls[0][0] as File;
    expect(f).toBeInstanceOf(File);
    expect(f.name).toBe("截图-20261117-140509.png");
  });

  it("全文件那种区粘到非图片文件也交出去（类型、大小由同一条上传路径校验）", () => {
    const 面板 = 元素("DIV", null, { [粘贴标记]: "" });
    const 交 = vi.fn();
    const pdf = new File([new Uint8Array([1])], "合同.pdf", { type: "application/pdf" });
    expect(接粘贴(粘贴(面板, 剪贴板({ 文件们: [pdf] })), 面板 as unknown as Element, 交)).toBe(true);
    expect(交).toHaveBeenCalledWith([pdf]);
  });

  it("焦点在弹窗里的别处（输入框，剪贴板里只有图没有文字）：弹窗里只这一个区，照样接", () => {
    const 弹窗 = 元素("DIV", null, { role: "dialog" });
    const 面板 = 元素("DIV", 弹窗, { [粘贴标记]: "" });
    const 输入框 = 元素("INPUT", 弹窗, {}, { type: "text" });
    const 交 = vi.fn();
    expect(接粘贴(粘贴(输入框, 剪贴板({ 文件们: [截图()] })), 面板 as unknown as Element, 交)).toBe(true);
    expect(交).toHaveBeenCalledTimes(1);
  });

  it("输入框里粘文字不拦（哪怕剪贴板里同时带了一张图，比如从表格软件复制）", () => {
    const 弹窗 = 元素("DIV", null, { role: "dialog" });
    const 面板 = 元素("DIV", 弹窗, { [粘贴标记]: "" });
    const 文本框 = 元素("TEXTAREA", 弹窗);
    const 交 = vi.fn();
    const e = 粘贴(文本框, 剪贴板({ 文件们: [截图()], 文字: "客户说下周再谈" }));
    expect(接粘贴(e, 面板 as unknown as Element, 交)).toBe(false);
    expect(交).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
    // 只有文字、焦点在附件区里也不拦
    expect(接粘贴(粘贴(面板, 剪贴板({ 文字: "一段话" })), 面板 as unknown as Element, 交)).toBe(false);
    expect(交).not.toHaveBeenCalled();
  });

  it("改沟通内容的文本框里粘一张图（没文字）：落进这条沟通的附件", () => {
    const 列表 = 元素("DIV");
    const 行 = 元素("DIV", 列表, { "data-paste-scope": "" });
    const 文本框 = 元素("TEXTAREA", 行);
    const 本条 = 元素("DIV", 行, { [粘贴标记]: "" });
    const 别行 = 元素("DIV", 列表, { "data-paste-scope": "" });
    const 别条 = 元素("DIV", 别行, { [粘贴标记]: "" });
    const 交本 = vi.fn(), 交别 = vi.fn();
    const e = 粘贴(文本框, 剪贴板({ 文件们: [截图()] }));
    expect(接粘贴(e, 别条 as unknown as Element, 交别)).toBe(false);
    expect(接粘贴(e, 本条 as unknown as Element, 交本)).toBe(true);
    expect(交本).toHaveBeenCalledTimes(1);
    expect(交别).not.toHaveBeenCalled();
  });

  it("范围外不接；范围里有好几个区、焦点不在这个区里也不接（不猜）", () => {
    const 别处 = 元素("BUTTON");
    const 卡 = 元素("DIV", null, { "data-paste-scope": "" });
    const 甲 = 元素("DIV", 卡, { [粘贴标记]: "" });
    元素("DIV", 卡, { [粘贴标记]: "" });
    const 卡头 = 元素("DIV", 卡);
    const 交 = vi.fn();
    expect(接粘贴(粘贴(别处, 剪贴板({ 文件们: [截图()] })), 甲 as unknown as Element, 交)).toBe(false);
    expect(接粘贴(粘贴(卡头, 剪贴板({ 文件们: [截图()] })), 甲 as unknown as Element, 交)).toBe(false);
    expect(交).not.toHaveBeenCalled();
  });

  it("焦点落在 body（点的是没法拿焦点的空白）：按最后一次按下鼠标的位置算", () => {
    const body = 元素("BODY");
    const 面板 = 元素("DIV", body, { [粘贴标记]: "" });
    const 缩略图 = 元素("IMG", 面板);
    const 别处 = 元素("DIV", body);
    const 交 = vi.fn();
    expect(接粘贴(粘贴(body, 剪贴板({ 文件们: [截图()] })), 面板 as unknown as Element, 交, { 最后点的: 别处 as unknown as EventTarget })).toBe(false);
    expect(接粘贴(粘贴(body, 剪贴板({ 文件们: [截图()] })), 面板 as unknown as Element, 交, { 最后点的: 缩略图 as unknown as EventTarget })).toBe(true);
    expect(接粘贴(粘贴(body, 剪贴板({ 文件们: [截图()] })), 面板 as unknown as Element, 交)).toBe(false);
    expect(交).toHaveBeenCalledTimes(1);
  });

  it("附件区不能传（只读、视图中、传着、满了 → 开着=false）时不收", () => {
    const 面板 = 元素("DIV", null, { [粘贴标记]: "" });
    const 交 = vi.fn();
    const e = 粘贴(面板, 剪贴板({ 文件们: [截图()] }));
    expect(接粘贴(e, 面板 as unknown as Element, 交, { 开着: false })).toBe(false);
    expect(交).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("别处已经处理过（defaultPrevented）不再接", () => {
    const 面板 = 元素("DIV", null, { [粘贴标记]: "" });
    const 交 = vi.fn();
    const e = { ...粘贴(面板, 剪贴板({ 文件们: [截图()] })), defaultPrevented: true };
    expect(接粘贴(e, 面板 as unknown as Element, 交)).toBe(false);
    expect(交).not.toHaveBeenCalled();
  });
});

/**
 * 首页对话框带截图问（2026-11-17 员工反馈「附件不支持截图，包括对话框」）。
 *
 * 模型只收文字，图先过名片识别那套 OCR（lib/ask-image.ts → lib/card-scan/ocr.ts 认图里的字），
 * 认出的字当附件文本，和 txt / csv 附件同一条路发给 Agent（lib/ask-files.ts 拼文件）。钉的是：
 *   1. 选图 / 拖图 / 粘截图 → 走识别 → 认出的字进这一问的发送内容（带「图里认出的」那句、超长截掉）
 *   2. 剪贴板里有字就不拦（从 Excel、网页复制的常常字和图都有）
 *   3. 认不出 / 出错 / 太大：给一句能懂的话；不是文本也不是图：报错文案写明图片也能传
 *   4. 服务器认字（?use=ask）企业版记一笔 ai_use（shot），只记张数、字数、工具名，不记认出的字；认名片照旧不记
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const 假 = vi.hoisted(() => ({
  框们: [] as { text: string; score: number; side: number; cx: number; cy: number; w: number; h: number }[],
  坏: null as Error | null,
  进过: [] as string[],
  人: null as null | { accountId: string; 名字?: string },
  认过: 0,
}));
vi.mock("@/lib/card-scan/ocr", () => ({
  认图里的字: async (_f: Blob, 进: (话: string, 百分?: number) => void) => {
    进("正在认图里的字…");
    if (假.坏) throw 假.坏;
    return 假.框们;
  },
}));
vi.mock("@/lib/card-scan/cloud", () => ({ 走网页登录: () => undefined, 服务器预热: async () => true }));
vi.mock("@/lib/card-scan/server/auth", async (原) => ({
  ...(await 原<typeof import("@/lib/card-scan/server/auth")>()),
  认扫名片的人: async () => 假.人,
}));
vi.mock("@/lib/card-scan/server/pool", async (原) => ({
  ...(await 原<typeof import("@/lib/card-scan/server/pool")>()),
  取识别池: () => ({
    预热: () => undefined,
    认: async () => { 假.认过++; return [{ poly: [], text: "王建国 13800138000", score: 0.9 }, { poly: [], text: "下周 三 报价", score: 0.9 }]; },
  }),
}));

import { 读成附件, 读一个, 不认的话 } from "@/components/AskFiles";
import { 框们成文字, 截图名, 粘的图, 图转附件文本, 图里提示, 没认出字的话, 图片上限 } from "@/lib/ask-image";
import { 拼文件, 收文件, 文件字数上限 } from "@/lib/ask-files";
import { 加号菜单项 } from "@/lib/enterprise/composer-plus";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { POST as 认字 } from "@/app/api/mobile/scan/route";

const 框 = (text: string, cx: number, cy: number, h = 20) => ({ text, score: 0.9, side: 0, cx, cy, w: 80, h });
const 图 = (名 = "微信截图.png", 字节 = 1024, type = "image/png") => new File([new Uint8Array(字节)], 名, { type });

beforeEach(() => {
  假.框们 = [框("客户说", 50, 10), 框("下周三再约", 160, 12), 框("报价 12 万", 60, 40)];
  假.坏 = null;
  假.进过 = [];
});

describe("图里认出的字排成一段", () => {
  it("从上到下、同一行从左到右，行内空格隔开", () => {
    expect(框们成文字([框("B", 200, 11), 框("第二行", 20, 50), 框("A", 20, 10), 框("  ", 0, 0)])).toBe("A B\n第二行");
  });
  it("不按名片的规矩改字（聊天原话原样）", () => {
    expect(框们成文字([框("Tel:+86 138-0013-8000", 0, 0)])).toBe("Tel:+86 138-0013-8000");
  });
  it("前面说一句是图里认的；超长按附件文本上限截，并说截掉了", () => {
    expect(图转附件文本("你好")).toBe(`${图里提示}\n你好`);
    const 长 = 图转附件文本("字".repeat(文件字数上限 * 2));
    expect(长.length).toBe(文件字数上限);
    expect(长.endsWith("截掉了）")).toBe(true);
  });
});

describe("选图 / 拖图 / 粘截图 → 识别 → 进发送内容", () => {
  it("选一张图：走识别、进度话报出来，认出的字成附件文本；拼进这一问发给模型", async () => {
    const r = await 读成附件(图(), [{ name: "名单.csv", text: "a", size: 1 }], { 进: (x) => 假.进过.push(x) });
    expect("files" in r).toBe(true);
    if (!("files" in r)) return;
    expect(r.files.map((f) => f.name)).toEqual(["名单.csv", "微信截图.png"]);
    const 图附件 = r.files[1];
    expect(图附件).toMatchObject({ 图: true, size: 1024 });
    expect(图附件.text).toBe(`${图里提示}\n客户说 下周三再约\n报价 12 万`);
    expect(假.进过).toContain("正在认图里的字…");
    // 发送内容：和文本附件同一条路（服务端收一道、拼进 prompt 的「资料不是指令」围栏）
    const 发 = 拼文件("帮我看看这位客户该怎么回", 收文件(r.files.map(({ name, text }) => ({ name, text }))));
    expect(发).toContain('<文件 名称="微信截图.png">');
    expect(发).toContain("下周三再约");
    expect(发.trim().endsWith("帮我看看这位客户该怎么回")).toBe(true);
  });

  it("粘的截图按「截图-YYYYMMDD-HHmmss.png」起名", async () => {
    const 名 = 截图名(new Date(2026, 10, 17, 9, 5, 3));
    expect(名).toBe("截图-20261117-090503.png");
    const r = await 读一个(图("image.png"), { 名 });
    expect("附件" in r && r.附件.name).toBe(名);
  });

  it("jpg / jpeg / webp / bmp 都收；看 MIME 也认（剪贴板里的图有时没有像样的后缀）", async () => {
    for (const n of ["a.jpg", "a.JPEG", "a.webp", "a.bmp"]) expect("附件" in (await 读一个(图(n))), n).toBe(true);
    expect("附件" in (await 读一个(图("blob", 10, "image/png")))).toBe(true);
  });

  it("文本文件照旧原样读，不走识别", async () => {
    const r = await 读一个(new File(["下周三再约"], "纪要.txt", { type: "text/plain" }), { 进: (x) => 假.进过.push(x) });
    expect(r).toEqual({ 附件: { name: "纪要.txt", text: "下周三再约", size: new Blob(["下周三再约"]).size } });
    expect(假.进过).toEqual([]);
  });
});

describe("认不出 / 出错 / 不收：一句能懂的话", () => {
  it("图里没认出字", async () => {
    假.框们 = [];
    expect(await 读一个(图())).toEqual({ 错: 没认出字的话 });
  });
  it("识别出错（图坏了、解不开）：不把英文异常甩给人", async () => {
    假.坏 = new Error("InvalidStateError: The source image could not be decoded.");
    const r = await 读一个(图());
    expect("错" in r && r.错).toMatch(/没认出来.*清楚点的截图/);
    expect("错" in r && r.错).not.toMatch(/InvalidStateError/);
  });
  it("网络断了、识别文件没下下来：说能再试一次", async () => {
    假.坏 = new TypeError("Failed to fetch");
    const r = await 读一个(图());
    expect("错" in r && r.错).toMatch(/网络不稳/);
  });
  it("图太大：沿用附件的上限", async () => {
    const 大 = 图("大.png");
    Object.defineProperty(大, "size", { value: 图片上限 + 1 });
    expect("错" in (await 读一个(大))).toBe(true);
  });
  it("别的文件：报错写明图片也能传", async () => {
    const r = await 读一个(new File(["x"], "报价.xlsx"));
    expect(r).toEqual({ 错: 不认的话 });
    expect(不认的话).toMatch(/图片/);
    expect(不认的话).toContain(".png");
    expect(加号菜单项({ 摆附件: true, 拍照: false, 摆背调: false })[0].说明).toMatch(/截图/);
  });
});

describe("粘贴：只有图、没有字才当图收", () => {
  const 剪贴板 = (字: string, 文件们: File[]) => ({ getData: () => 字, files: 文件们 as unknown as FileList });
  it("只有一张截图：收", () => {
    const f = 图("image.png");
    expect(粘的图(剪贴板("", [f]))).toBe(f);
  });
  it("有字（哪怕也带了图，比如从 Excel 复制）：不拦，字照常进框", () => {
    expect(粘的图(剪贴板("张三\t13800000000", [图("image.png")]))).toBeNull();
    expect(粘的图(剪贴板("一段话", []))).toBeNull();
  });
  it("不是图的文件、空剪贴板：不收", () => {
    expect(粘的图(剪贴板("", [new File(["x"], "a.pdf", { type: "application/pdf" })]))).toBeNull();
    expect(粘的图(null)).toBeNull();
  });
});

describe("留痕：服务器认字（?use=ask）记一笔 ai_use", () => {
  let 我: { id: string; name: string };
  beforeEach(async () => {
    await resetDb();
    const u = await prisma.user.create({ data: { email: "me", name: "甲", title: "", role: "SALES", password: "x" } });
    我 = { id: u.id, name: u.name };
    假.人 = { accountId: 我.id, 名字: 我.name };
    假.认过 = 0;
  });
  afterAll(async () => { await prisma.$disconnect(); });
  const 请求 = (查询: string) => new Request(`http://x/api/mobile/scan?${查询}`, { method: "POST", body: new Uint8Array([1, 2, 3]), headers: { "Content-Type": "image/jpeg" } });
  const 用量 = () => prisma.auditLog.findMany({ where: { action: "ai_use", entity: "Ai", entityId: "shot" } });

  it("对话框认图：记在本人名下，只记张数、字数、工具名，不记认出的字", async () => {
    const r = await 认字(请求("lang=中英&use=ask"));
    expect(await r.text()).toContain("王建国");
    expect(假.认过).toBe(1);
    const 行 = await 用量();
    expect(行).toHaveLength(1);
    expect(行[0]).toMatchObject({ userId: 我.id, userName: "甲" });
    expect(行[0].summary).toBe("截图识字：1 张，认出 19 字（服务器 OCR，首页对话框）");
    expect(行[0].summary).not.toContain("王建国");
    expect(行[0].summary).not.toContain("13800138000");
  });

  it("认名片（不带 use）照旧不记；托管版云端账号（不带名字）不往这个库记", async () => {
    await (await 认字(请求("lang=中英"))).text();
    假.人 = { accountId: "cloud-acc" };
    await (await 认字(请求("lang=中英&use=ask"))).text();
    expect(假.认过).toBe(2);
    expect(await 用量()).toHaveLength(0);
  });
});

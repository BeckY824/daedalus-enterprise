/**
 * 录音实测页的上传回显 /api/mic-test/echo（11-21，录音点评 PR1）。
 * 钉住：未登录 401（请求体不读）；超过 20MB 413（声明的长度超了、没声明边读边超了都拒）；
 * 每进程同时最多 2 个、第 3 个 429，占的位成功 / 出错 / 413 都还；multipart 就地切、不整份再解析；
 * 只回字节数和格式；不落盘、不进库、不记请求体。
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const 罐 = vi.hoisted(() => ({ 用户: null as null | { id: string } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => 罐.用户) }));

import { POST } from "../src/app/api/mic-test/echo/route";
import { 回显上限字节, 认格式, 切文件段, 回显处理中 } from "@/lib/mic-test-echo";

const 地址 = "https://crm.example.test/api/mic-test/echo";
const wav头 = () => {
  const b = new Uint8Array(64);
  b.set(new TextEncoder().encode("RIFF"), 0);
  b.set(new TextEncoder().encode("WAVEfmt "), 8);
  return b;
};
/** 不带长度、一块一块吐的请求体 */
function 流(块数: number, 块大小: number): { body: ReadableStream<Uint8Array>; 读了: () => number } {
  let 已 = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (已 >= 块数) return c.close();
      已 += 1;
      c.enqueue(new Uint8Array(块大小));
    },
  });
  return { body, 读了: () => 已 };
}

/** 手动放行的请求体：先挂着不吐，放() 吐一块收尾，断() 让流出错 */
function 挂着的流() {
  let 控: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      控 = c;
    },
  });
  return {
    body,
    放: () => {
      控.enqueue(wav头());
      控.close();
    },
    断: () => 控.error(new Error("连接断了")),
  };
}

/** 流式请求体要带 duplex: "half"（Node 的 fetch 要求），Next 的类型里没有这一项 */
const 流请求 = (body: ReadableStream<Uint8Array>) =>
  new NextRequest(地址, { method: "POST", body, duplex: "half" } as unknown as ConstructorParameters<typeof NextRequest>[1]);

beforeEach(() => {
  罐.用户 = null;
});
afterEach(() => {
  // 每个用例结束时位都要还清，不然后面的用例会被 429 卡住
  expect(回显处理中()).toBe(0);
});

describe("回显接口", () => {
  it("未登录：401，请求体一块都不读", async () => {
    const s = 流(10, 1024);
    const res = await POST(流请求(s.body));
    expect(res.status).toBe(401);
    expect(s.读了()).toBeLessThanOrEqual(1);
  });

  it("登录后：回字节数和格式（裸字节）", async () => {
    罐.用户 = { id: "u1" };
    const res = await POST(new NextRequest(地址, { method: "POST", body: wav头(), headers: { "content-type": "application/octet-stream" } }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ bytes: 64, format: "wav" });
    expect(j.head).toMatch(/^52 49 46 46/);
  });

  it("multipart（飞书 tt.uploadFile 那种）：另回文件那一段的字节数和格式", async () => {
    罐.用户 = { id: "u1" };
    const fd = new FormData();
    fd.append("file", new Blob([wav头()], { type: "audio/wav" }), "a.wav");
    fd.append("note", "x");
    const res = await POST(new NextRequest(地址, { method: "POST", body: fd }));
    const j = await res.json();
    expect(j.files).toEqual([expect.objectContaining({ field: "file", name: "a.wav", bytes: 64, format: "wav" })]);
    expect(j.bytes).toBeGreaterThan(64);
  });

  it("超限：声明的长度超过 20MB 直接 413", async () => {
    罐.用户 = { id: "u1" };
    const res = await POST(new NextRequest(地址, { method: "POST", body: "x", headers: { "content-length": String(回显上限字节 + 1) } }));
    expect(res.status).toBe(413);
  });

  it("超限：没声明长度、边读边数，过了 20MB 停下 413，不再往下读", async () => {
    罐.用户 = { id: "u1" };
    const 块 = 1024 * 1024;
    const s = 流(40, 块);
    const res = await POST(流请求(s.body));
    expect(res.status).toBe(413);
    expect(s.读了()).toBeLessThan(25);
  });

  it("正好 20MB 收", async () => {
    罐.用户 = { id: "u1" };
    const res = await POST(new NextRequest(地址, { method: "POST", body: new Uint8Array(回显上限字节) }));
    expect(res.status).toBe(200);
    expect((await res.json()).bytes).toBe(回显上限字节);
  });

  it("不写盘、不进库、不记请求体：接口和它用的库都不引 fs / prisma / 日志", () => {
    for (const f of ["src/app/api/mic-test/echo/route.ts", "src/lib/mic-test-echo.ts"]) {
      const 源 = readFileSync(f, "utf8");
      expect(源, f).not.toMatch(/from ["'](node:)?fs(\/promises)?["']/);
      expect(源, f).not.toMatch(/@\/lib\/prisma|@\/generated\/prisma/);
      expect(源, f).not.toMatch(/console\.(log|info|warn|error)/);
      expect(源, f).not.toMatch(/writeFile|createWriteStream/);
    }
  });
});

describe("并发上限", () => {
  it("同时 2 个在处理时第 3 个回 429（不读请求体），前两个照常 200，放完再来能收", async () => {
    罐.用户 = { id: "u1" };
    const a = 挂着的流();
    const b = 挂着的流();
    const 甲 = POST(流请求(a.body));
    const 乙 = POST(流请求(b.body));
    await vi.waitFor(() => expect(回显处理中()).toBe(2));
    const c = 流(10, 1024);
    const 丙 = await POST(流请求(c.body));
    expect(丙.status).toBe(429);
    expect(丙.headers.get("retry-after")).toBe("5");
    expect(c.读了()).toBeLessThanOrEqual(1);
    a.放();
    b.放();
    expect((await 甲).status).toBe(200);
    expect((await 乙).status).toBe(200);
    expect(回显处理中()).toBe(0);
    expect((await POST(new NextRequest(地址, { method: "POST", body: wav头() }))).status).toBe(200);
  });

  it("未登录不占位：两个挂着时未登录照样 401", async () => {
    罐.用户 = { id: "u1" };
    const a = 挂着的流();
    const b = 挂着的流();
    const 甲 = POST(流请求(a.body));
    const 乙 = POST(流请求(b.body));
    await vi.waitFor(() => expect(回显处理中()).toBe(2));
    罐.用户 = null;
    expect((await POST(new NextRequest(地址, { method: "POST", body: wav头() }))).status).toBe(401);
    a.放();
    b.放();
    await Promise.all([甲, 乙]);
  });

  it("出错（连接断了 400）、超限（边读边超 413、声明超 413）后位都还回来，再发能成功", async () => {
    罐.用户 = { id: "u1" };
    const a = 挂着的流();
    const b = 挂着的流();
    const 甲 = POST(流请求(a.body));
    const 乙 = POST(流请求(b.body));
    await vi.waitFor(() => expect(回显处理中()).toBe(2));
    a.断();
    b.断();
    expect((await 甲).status).toBe(400);
    expect((await 乙).status).toBe(400);
    expect(回显处理中()).toBe(0);
    // 两个 413 并发也还清：边读边超 + 声明超
    const [超1, 超2] = await Promise.all([
      POST(流请求(流(25, 1024 * 1024).body)),
      POST(new NextRequest(地址, { method: "POST", body: "x", headers: { "content-length": String(回显上限字节 + 1) } })),
    ]);
    expect([超1.status, 超2.status]).toEqual([413, 413]);
    expect(回显处理中()).toBe(0);
    const 再 = await Promise.all([
      POST(new NextRequest(地址, { method: "POST", body: wav头() })),
      POST(new NextRequest(地址, { method: "POST", body: wav头() })),
    ]);
    expect(再.map((r) => r.status)).toEqual([200, 200]);
  });
});

describe("切文件段（multipart 就地切）", () => {
  const 编 = (s: string) => new TextEncoder().encode(s);
  it("和 FormData 序列化的结果对得上：只要文件段，字节指回原数组、不复制", async () => {
    const fd = new FormData();
    fd.append("note", "x");
    fd.append("file", new Blob([wav头()], { type: "audio/wav" }), "录音 1.wav");
    fd.append("file2", new Blob([new Uint8Array([1, 2, 3])]), "b.bin");
    const 请求 = new Request("https://x.test", { method: "POST", body: fd });
    const 体 = new Uint8Array(await 请求.arrayBuffer());
    const 段们 = 切文件段(体, 请求.headers.get("content-type")!)!;
    expect(段们.map((d) => [d.field, d.name, d.type, d.字节.byteLength])).toEqual([
      ["file", "录音 1.wav", "audio/wav", 64],
      ["file2", "b.bin", "application/octet-stream", 3],
    ]);
    expect(认格式(段们[0].字节.subarray(0, 16))).toBe("wav");
    expect(段们[0].字节.buffer).toBe(体.buffer);
  });

  it("带引号的 boundary、序言、空文件名都认；格式不对返回 null", () => {
    const 体 = 编('序言\r\n--AB\r\nContent-Disposition: form-data; name="f"; filename=""\r\n\r\nxyz\r\n--AB--\r\n');
    expect(切文件段(体, 'multipart/form-data; boundary="AB"')).toEqual([{ field: "f", name: "", type: "", 字节: expect.anything() }]);
    expect(切文件段(体, 'multipart/form-data; boundary="AB"')![0].字节.byteLength).toBe(3);
    expect(切文件段(体, "multipart/form-data")).toBeNull();
    expect(切文件段(编("--AB\r\nContent-Disposition: form-data; name=\"f\"; filename=\"a\"\r\n\r\n没收尾"), "multipart/form-data; boundary=AB")).toBeNull();
    expect(切文件段(编("什么都不是"), "multipart/form-data; boundary=AB")).toBeNull();
  });

  it("接口：multipart 格式坏了回「multipart 解析失败」，不报错", async () => {
    罐.用户 = { id: "u1" };
    const res = await POST(new NextRequest(地址, { method: "POST", body: "乱码", headers: { "content-type": "multipart/form-data; boundary=AB" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).files).toBe("multipart 解析失败");
  });
});

describe("认格式", () => {
  const 字节 = (...xs: (number | string)[]) =>
    new Uint8Array(xs.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));
  it("手机上常见的几种都认得", () => {
    expect(认格式(字节(0, 0, 0, 0x20, "ftypM4A ", 0, 0, 0, 0))).toBe("m4a");
    expect(认格式(字节(0, 0, 0, 0x18, "ftypisom", 0, 0, 0, 0))).toBe("mp4");
    expect(认格式(字节("RIFF", 0, 0, 0, 0, "WAVE"))).toBe("wav");
    expect(认格式(字节(0x1a, 0x45, 0xdf, 0xa3))).toBe("webm");
    expect(认格式(字节("OggS"))).toBe("ogg");
    expect(认格式(字节("#!AMR\n"))).toBe("amr");
    expect(认格式(字节("ID3", 4))).toBe("mp3");
    expect(认格式(字节(0xff, 0xfb, 0x90))).toBe("mp3");
    expect(认格式(字节(0xff, 0xf1, 0x50))).toBe("aac");
    expect(认格式(字节("caff"))).toBe("caf");
    expect(认格式(字节(1, 2, 3))).toBe("未知");
    expect(认格式(new Uint8Array(0))).toBe("未知");
  });
});

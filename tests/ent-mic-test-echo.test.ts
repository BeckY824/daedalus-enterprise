/**
 * 录音实测页的上传回显 /api/mic-test/echo（11-21，录音点评 PR1）。
 * 钉住：未登录 401（请求体不读）；超过 20MB 413（声明的长度超了、没声明边读边超了都拒）；
 * 只回字节数和格式；不落盘、不进库、不记请求体。
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const 罐 = vi.hoisted(() => ({ 用户: null as null | { id: string } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => 罐.用户) }));

import { POST } from "../src/app/api/mic-test/echo/route";
import { 回显上限字节, 认格式 } from "@/lib/mic-test-echo";

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

/** 流式请求体要带 duplex: "half"（Node 的 fetch 要求），Next 的类型里没有这一项 */
const 流请求 = (body: ReadableStream<Uint8Array>) =>
  new NextRequest(地址, { method: "POST", body, duplex: "half" } as unknown as ConstructorParameters<typeof NextRequest>[1]);

beforeEach(() => {
  罐.用户 = null;
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

/**
 * 录音点评 PR4（11-22）：转写通道这一层，不碰库。钉的是：
 *   - TC3-HMAC-SHA256 签名照官方步骤（规范请求 → 待签串 → 日期 / 服务 / tc3_request 派生 → 签名），只签 content-type、host、x-tc-action
 *   - 密钥：_ENC（encryptSecret 的密文）优先、解不开 =「解不开」不退回明文；没有 _ENC 才看明文；两个都要有
 *   - 腾讯云通道（假 HTTP）：≤ 请求体上限的走 SourceType=1（base64 + DataLen），签名地址走 SourceType=0；8k 用 8k 引擎；
 *     状态 0/1/2/3 → 排队 / 转写中 / 成功 / 失败；网络断、5xx、限频 = 可重试；密钥不对、参数不对 = 不可重试；
 *     请求头、请求体里没有 SecretKey；给人看的话不带腾讯云原话（原话可能回显签名地址）
 *   - 结果解析：ResultDetail 优先；Result 逐行「[m:s.ms,m:s.ms,说话人]  文字」
 *   - scripts/ent-secret-put.mjs：写进去的是密文、程序（decryptSecret）解得开、同名再写被拒、文件 600、什么都不回显
 *   - ffmpeg（本机装了才跑）：webm(opus) → ogg 只转封装、两段 m4a 接成一个（时长相加）、双声道 44.1k wav 重新编码成单声道 m4a、
 *     切段每段不超上限且起点递增、自检认得出没装
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encryptSecret, decryptSecret } from "@/lib/settings";
import { 读凭据, TC3签名, 认错误码, 失败话, 解析结果, 腾讯云通道 } from "@/lib/enterprise/asr/tencent";
import { 通道错, 请求体上限字节, 选通道, 通道密钥状态 } from "@/lib/enterprise/asr/channel";
import { 规整, 切段, 探, ffmpeg自检, 清自检缓存, 采样档 } from "@/lib/enterprise/asr/ffmpeg";
import { 写一条, 加密 } from "../scripts/ent-secret-put.mjs";

const 假ID = "fake-test-only-id-zz";
const 假KEY = "fake-test-only-key-zz";
const 有ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
let 临时: string;
beforeAll(() => {
  临时 = fs.mkdtempSync(path.join(os.tmpdir(), "crm-asr-"));
});
afterAll(() => fs.rmSync(临时, { recursive: true, force: true }));

describe("TC3 签名", () => {
  it("照官方步骤：Authorization 的格式、签名能独立算回来；动作在规范请求里小写", () => {
    const 载荷 = JSON.stringify({ TaskId: 1 });
    const 头 = TC3签名({ 凭据: { id: 假ID, key: 假KEY }, 动作: "DescribeTaskStatus", 载荷, 时间戳: 1763800000, 主机: "asr.tencentcloudapi.com" });
    expect(头["X-TC-Action"]).toBe("DescribeTaskStatus");
    expect(头["X-TC-Version"]).toBe("2019-06-14");
    expect(头["X-TC-Timestamp"]).toBe("1763800000");
    expect(头["X-TC-Region"]).toBeUndefined();
    const 日期 = "2025-11-22"; // 1763800000 = 2025-11-22T08:26:40Z（TC3 按 UTC 日期派生）
    const 规范 = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:asr.tencentcloudapi.com\nx-tc-action:describetaskstatus\n\ncontent-type;host;x-tc-action\n${createHash("sha256").update(载荷).digest("hex")}`;
    const 待签 = `TC3-HMAC-SHA256\n1763800000\n${日期}/asr/tc3_request\n${createHash("sha256").update(规范).digest("hex")}`;
    const h = (k: Buffer | string, s: string) => createHmac("sha256", k).update(s).digest();
    const 签 = createHmac("sha256", h(h(h(`TC3${假KEY}`, 日期), "asr"), "tc3_request")).update(待签).digest("hex");
    expect(头.Authorization).toBe(`TC3-HMAC-SHA256 Credential=${假ID}/${日期}/asr/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=${签}`);
    expect(头.Authorization).not.toContain(假KEY);
    expect(TC3签名({ 凭据: { id: 假ID, key: 假KEY }, 动作: "X", 载荷: "{}", 时间戳: 1, 主机: "h", 地域: "ap-shanghai" })["X-TC-Region"]).toBe("ap-shanghai");
  });
});

describe("密钥从哪读", () => {
  it("_ENC 优先、解不开不退回明文；没有 _ENC 看明文；缺一个 = 未配置", async () => {
    expect(读凭据({}).状态).toBe("未配置");
    expect(读凭据({ ENT_TENCENT_ASR_SECRET_ID: 假ID }).状态).toBe("未配置");
    const 明 = 读凭据({ ENT_TENCENT_ASR_SECRET_ID: 假ID, ENT_TENCENT_ASR_SECRET_KEY: 假KEY });
    expect(明.状态 === "已配置" && 明.值).toEqual({ id: 假ID, key: 假KEY });
    const 密 = 读凭据({ ENT_TENCENT_ASR_SECRET_ID_ENC: encryptSecret(假ID), ENT_TENCENT_ASR_SECRET_KEY_ENC: encryptSecret(假KEY), ENT_TENCENT_ASR_SECRET_KEY: "别用这个" });
    expect(密.状态 === "已配置" && 密.值).toEqual({ id: 假ID, key: 假KEY });
    expect(读凭据({ ENT_TENCENT_ASR_SECRET_ID_ENC: "enc:v1:坏的", ENT_TENCENT_ASR_SECRET_KEY_ENC: encryptSecret(假KEY), ENT_TENCENT_ASR_SECRET_ID: 假ID }).状态).toBe("解不开");
    expect(await 通道密钥状态({ ENT_ASR_FAKE: "1" })).toBe("假通道");
    expect(await 通道密钥状态({})).toBe("未配置");
    expect(await 选通道({})).toBeNull();
    expect((await 选通道({ ENT_ASR_FAKE: "1" }))?.名).toBe("假通道");
    expect((await 选通道({ ENT_TENCENT_ASR_SECRET_ID: 假ID, ENT_TENCENT_ASR_SECRET_KEY: 假KEY }))?.名).toBe("腾讯云");
  });
});

type 记 = { url: string; 头: Record<string, string>; 体: Record<string, unknown> };
function 假HTTP(回: (动作: string, 体: Record<string, unknown>) => Response | Promise<Response>) {
  const 们: 记[] = [];
  const 取 = (async (url: string, init: RequestInit) => {
    const 头 = init.headers as Record<string, string>;
    const 体 = JSON.parse(String(init.body)) as Record<string, unknown>;
    们.push({ url, 头, 体 });
    return 回(头["X-TC-Action"], 体);
  }) as unknown as typeof fetch;
  return { 们, 取 };
}
const 回JSON = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });

describe("腾讯云通道（假 HTTP）", () => {
  const 凭据 = { id: 假ID, key: 假KEY };
  it("请求体走 SourceType=1 + DataLen，地址走 SourceType=0；8k 用 8k 引擎；请求里没有 SecretKey", async () => {
    const h = 假HTTP(() => 回JSON({ Response: { Data: { TaskId: 12345 }, RequestId: "r" } }));
    const 通 = 腾讯云通道(凭据, { ENT_TENCENT_ASR_ENDPOINT: "https://asr.example.test" }, h.取);
    expect(await 通.提交({ 档: "16k", 音频: { 方式: "请求体", 数据: Buffer.from("abc") } })).toBe("12345");
    expect(await 通.提交({ 档: "8k", 音频: { 方式: "地址", url: "https://x.test/api/coach-rec/fetch/abc?exp=1&sig=s" } })).toBe("12345");
    expect(h.们[0].url).toBe("https://asr.example.test");
    expect(h.们[0].头.Host).toBe("asr.example.test");
    expect(h.们[0].体).toMatchObject({ SourceType: 1, Data: Buffer.from("abc").toString("base64"), DataLen: 3, EngineModelType: "16k_zh_en_2.0", ChannelNum: 1, SpeakerDiarization: 1 });
    expect(h.们[1].体).toMatchObject({ SourceType: 0, Url: "https://x.test/api/coach-rec/fetch/abc?exp=1&sig=s", EngineModelType: "8k_zh_large" });
    expect(h.们[1].体).not.toHaveProperty("Data");
    for (const r of h.们) expect(JSON.stringify(r)).not.toContain(假KEY);
    expect(通.引擎("16k")).toBe("16k_zh_en_2.0");
    expect(腾讯云通道(凭据, { ENT_TENCENT_ASR_ENGINE_16K: "16k_zh" }, h.取).引擎("16k")).toBe("16k_zh");
    expect(请求体上限字节).toBeLessThan((5 * 1024 * 1024 * 3) / 4);
  });

  it("查：0 排队、1 转写中、2 成功（解析、时长）、3 失败（白话，不带原话）", async () => {
    let 状 = 0;
    const h = 假HTTP(() => 回JSON({ Response: { Data: { TaskId: 1, Status: 状, Result: "[0:0.020,0:2.380,0]  你好。\n[0:2.400,0:5.000,1]  报价下周发。\n", AudioDuration: 5.0, ErrorMsg: "failed to download audio from https://x.test/api/coach-rec/fetch/a?exp=1&sig=SECRETSIG" } } }));
    const 通 = 腾讯云通道(凭据, {}, h.取);
    expect(await 通.查("1")).toEqual({ 状态: "排队" });
    状 = 1;
    expect(await 通.查("1")).toEqual({ 状态: "转写中" });
    状 = 2;
    expect(await 通.查("1")).toEqual({ 状态: "成功", 时长毫秒: 5000, 句们: [{ 起: 20, 止: 2380, 说话人: 0, 文字: "你好。" }, { 起: 2400, 止: 5000, 说话人: 1, 文字: "报价下周发。" }] });
    状 = 3;
    const 败 = await 通.查("1");
    expect(败.状态).toBe("失败");
    expect(败.状态 === "失败" && 败.话).toContain("取不到录音文件");
    expect(JSON.stringify(败)).not.toContain("SECRETSIG");
    expect(await 通.查("不是数字")).toEqual({ 状态: "失败", 话: "任务号不对" });
  });

  it("出错：网络断、5xx、429、限频、内部错 = 可重试；密钥不对、参数不对、欠费 = 不可重试；话里不带密钥", async () => {
    const 试 = async (回: () => Response | Promise<Response>) => {
      const 通 = 腾讯云通道(凭据, {}, 假HTTP(回).取);
      try {
        await 通.提交({ 档: "16k", 音频: { 方式: "请求体", 数据: Buffer.from("a") } });
      } catch (e) {
        expect(e).toBeInstanceOf(通道错);
        expect((e as 通道错).话).not.toContain(假KEY);
        return (e as 通道错).可重试;
      }
      throw new Error("应该抛");
    };
    expect(await 试(() => { throw new TypeError("fetch failed"); })).toBe(true);
    expect(await 试(() => 回JSON({}, 502))).toBe(true);
    expect(await 试(() => 回JSON({}, 429))).toBe(true);
    expect(await 试(() => new Response("<html>", { status: 200 }))).toBe(true);
    expect(await 试(() => 回JSON({ Response: { Error: { Code: "RequestLimitExceeded", Message: "x" } } }))).toBe(true);
    expect(await 试(() => 回JSON({ Response: { Error: { Code: "InternalError", Message: "x" } } }))).toBe(true);
    expect(await 试(() => 回JSON({ Response: { Error: { Code: "AuthFailure.SignatureFailure", Message: `bad ${假KEY}` } } }))).toBe(false);
    expect(await 试(() => 回JSON({ Response: { Error: { Code: "InvalidParameterValue", Message: "x" } } }))).toBe(false);
    expect(await 试(() => 回JSON({ Response: { Error: { Code: "FailedOperation.ServiceIsolate", Message: "x" } } }))).toBe(false);
    expect(await 试(() => 回JSON({ Response: { Data: {} } }))).toBe(true); // 没回任务号
    expect(认错误码("AuthFailure.SecretIdNotFound").话).toContain("密钥");
    expect(失败话("audio decode error")).toContain("读不了");
    expect(失败话(undefined)).toBe("腾讯云没转写成功");
  });

  it("结果解析：ResultDetail 优先；Result 逐行（有说话人、没说话人、带小时）；空行、空句跳过", () => {
    expect(解析结果({ ResultDetail: [{ FinalSentence: "第一句", StartMs: 0, EndMs: 900, SpeakerId: 1 }, { FinalSentence: "  ", StartMs: 1, EndMs: 2 }], Result: "[0:0.000,0:1.000,0]  别用这个" }))
      .toEqual([{ 起: 0, 止: 900, 说话人: 1, 文字: "第一句" }]);
    expect(解析结果({ Result: "[1:02:03.500,1:02:05.000]  长录音后面\n\n[0:1.000,0:2.000,0]  \n没有时间的行" })).toEqual([
      { 起: 3723500, 止: 3725000, 说话人: null, 文字: "长录音后面" },
      { 起: 0, 止: 0, 说话人: null, 文字: "没有时间的行" },
    ]);
  });
});

describe("scripts/ent-secret-put.mjs", () => {
  it("写进去的是密文、程序解得开；同名再写被拒；文件 600；末尾没换行先补；命令行跑什么值都不回显", () => {
    const 目录 = fs.mkdtempSync(path.join(临时, "inst-"));
    const 会话密钥 = "x".repeat(48);
    fs.writeFileSync(path.join(目录, "auth-secret"), 会话密钥 + "\n", { mode: 0o600 });
    fs.writeFileSync(path.join(目录, ".secret-env"), "# 注释\n# ENT_TENCENT_ASR_SECRET_ID_ENC=\nLLM_MODEL=x", { mode: 0o644 });
    expect(写一条(目录, "ENT_TENCENT_ASR_SECRET_ID_ENC", 假ID)).toBe(0);
    expect(写一条(目录, "ENT_TENCENT_ASR_SECRET_ID_ENC", "别的")).toBe(3);
    const 内容 = fs.readFileSync(path.join(目录, ".secret-env"), "utf8");
    expect(内容).not.toContain(假ID);
    expect(内容.split("\n").filter((l) => l.startsWith("ENT_TENCENT_ASR_SECRET_ID_ENC="))).toHaveLength(1);
    expect(内容).toContain("LLM_MODEL=x\nENT_TENCENT_ASR_SECRET_ID_ENC=enc:v1:");
    expect(fs.statSync(path.join(目录, ".secret-env")).mode & 0o777).toBe(0o600);
    const 密文 = /ENT_TENCENT_ASR_SECRET_ID_ENC=(\S+)/.exec(内容)![1];
    const 原 = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = 会话密钥;
    try {
      expect(decryptSecret(密文)).toBe(假ID);
      expect(decryptSecret(加密("另一个", 会话密钥))).toBe("另一个");
    } finally {
      if (原 === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = 原;
    }
    // 真跑一次脚本：值从标准输入来，输出里没有值；变量名不对 = 2；没有会话密钥 = 4
    const 脚本 = path.resolve(__dirname, "../scripts/ent-secret-put.mjs");
    const r = spawnSync(process.execPath, [脚本, "ENT_TENCENT_ASR_SECRET_KEY_ENC", "--dir", 目录], { input: 假KEY, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).not.toContain(假KEY);
    expect(spawnSync(process.execPath, [脚本, "LLM_API_KEY", "--dir", 目录], { input: "x", encoding: "utf8" }).status).toBe(2);
    expect(spawnSync(process.execPath, [脚本, "ENT_A_ENC", "--dir", 目录], { input: "", encoding: "utf8" }).status).toBe(2);
    const 空目录 = fs.mkdtempSync(path.join(临时, "inst2-"));
    expect(spawnSync(process.execPath, [脚本, "ENT_A_ENC", "--dir", 空目录], { input: "x", encoding: "utf8", env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" } }).status).toBe(4);
  });
});

describe.skipIf(!有ffmpeg)("ffmpeg 规整、切段（本机装了 ffmpeg 才跑）", () => {
  const 生成 = (出: string, 参: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...参, 出]);
  it("自检：装了 = ok；路径不对 = 没装", async () => {
    清自检缓存();
    expect((await ffmpeg自检()).ok).toBe(true);
    清自检缓存();
    expect(await ffmpeg自检({ FFMPEG_PATH: "/nonexistent/ffmpeg", FFPROBE_PATH: "/nonexistent/ffprobe" })).toEqual({ ok: false, 话: "服务器上没装 ffmpeg / ffprobe" });
    清自检缓存();
  });

  it("webm(opus) 只转封装成 ogg；两段 m4a 接成一个、时长相加；双声道 44.1k wav 重编成单声道 m4a；8k amr 走 8k", async () => {
    const d = fs.mkdtempSync(path.join(临时, "norm-"));
    生成(path.join(d, "seg-01.webm"), ["-f", "lavfi", "-i", "sine=frequency=300:sample_rate=48000:duration=2", "-ac", "1", "-c:a", "libopus", "-b:a", "24k", "-f", "webm"]);
    const 网 = await 规整([path.join(d, "seg-01.webm")], d);
    expect(网).toMatchObject({ 格式: "ogg", 重编码: false });
    expect(Math.abs(网.时长毫秒! - 2000)).toBeLessThan(150);
    expect((await 探(网.文件)).编码).toBe("opus");

    const d2 = fs.mkdtempSync(path.join(临时, "norm2-"));
    for (const [n, 秒] of [["01", 2], ["02", 3]] as const) 生成(path.join(d2, `seg-${n}.m4a`), ["-f", "lavfi", "-i", `sine=frequency=500:sample_rate=16000:duration=${秒}`, "-ac", "1", "-c:a", "aac", "-b:a", "32k", "-f", "mp4"]);
    const 拼 = await 规整([path.join(d2, "seg-01.m4a"), path.join(d2, "seg-02.m4a")], d2);
    expect(拼).toMatchObject({ 格式: "m4a", 重编码: false, 采样率: 16000 });
    expect(Math.abs(拼.时长毫秒! - 5000)).toBeLessThan(200);
    expect(fs.existsSync(path.join(d2, "asr-concat.txt"))).toBe(false);

    const d3 = fs.mkdtempSync(path.join(临时, "norm3-"));
    生成(path.join(d3, "seg-01.wav"), ["-f", "lavfi", "-i", "sine=frequency=500:sample_rate=44100:duration=2", "-ac", "2", "-c:a", "pcm_s16le"]);
    const 立 = await 规整([path.join(d3, "seg-01.wav")], d3);
    expect(立).toMatchObject({ 格式: "m4a", 重编码: true });
    expect((await 探(立.文件)).声道).toBe(1);

    const d4 = fs.mkdtempSync(path.join(临时, "norm4-"));
    生成(path.join(d4, "seg-01.wav"), ["-f", "lavfi", "-i", "sine=frequency=500:sample_rate=8000:duration=2", "-ac", "1", "-c:a", "pcm_s16le"]);
    const 电 = await 规整([path.join(d4, "seg-01.wav")], d4);
    expect(电).toMatchObject({ 格式: "wav", 采样率: 8000 });
    expect(采样档(电.采样率)).toBe("8k");
    expect(采样档(16000)).toBe("16k");

    await expect(规整([path.join(d4, "不存在.m4a")], d4)).rejects.toThrow();
  });

  it("切段：每段不超上限、起点递增、加起来是整条", async () => {
    const d = fs.mkdtempSync(path.join(临时, "seg-"));
    const f = path.join(d, "asr.wav");
    生成(f, ["-f", "lavfi", "-i", "sine=frequency=500:sample_rate=16000:duration=20", "-ac", "1", "-c:a", "pcm_s16le"]);
    const 上限 = 200 * 1024; // 20 秒 16k wav 约 640KB → 4 段左右
    const 段们 = await 切段(f, 20_000, d, 上限);
    expect(段们.length).toBeGreaterThanOrEqual(3);
    for (const x of 段们) expect(x.字节).toBeLessThanOrEqual(上限);
    expect(段们[0].起毫秒).toBe(0);
    for (let i = 1; i < 段们.length; i++) expect(段们[i].起毫秒).toBeGreaterThan(段们[i - 1].起毫秒);
    const 末 = 段们.at(-1)!;
    expect(Math.abs(末.起毫秒 + (await 探(末.文件)).时长毫秒! - 20_000)).toBeLessThan(200);
  });
});

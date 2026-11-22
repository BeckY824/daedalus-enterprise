/**
 * 录音点评 · 腾讯云录音文件识别（11-22，录音点评 PR4，方案 §4.1、§4.3–4.5）。
 *
 * 接口：asr.tencentcloudapi.com，Version 2019-06-14，CreateRecTask（提交）+ DescribeTaskStatus（查），TC3-HMAC-SHA256 签名。
 * 没引官方 SDK（新依赖要过安装脚本和构建体积，方案 PR4 一节的退路）：签名照官方文档手写，就下面 TC3签名 一个函数。
 *
 * 密钥（方案 §4.5）：只从服务器环境读——
 *   ENT_TENCENT_ASR_SECRET_ID_ENC / ENT_TENCENT_ASR_SECRET_KEY_ENC（encryptSecret 的密文，scripts/ent-secret-put.mjs 写进 .secret-env），
 *   没有 _ENC 才看不带 _ENC 的（3703 实操时从钥匙串带进进程环境，不落文件）。可选 ENT_TENCENT_ASR_REGION。
 *   密钥、签名、请求原文不进日志、报错、审计、库；给人看的话只有 通道错.话。
 * 引擎（【未核】：方案按大模型 2.0 写的名字，c2 上「测试连接」一次就知道认不认）：
 *   16k 及以上 → ENT_TENCENT_ASR_ENGINE_16K，默认 16k_zh_en_2.0；8k（电话录音、amr）→ ENT_TENCENT_ASR_ENGINE_8K，默认 8k_zh_large。
 */
import { createHash, createHmac } from "node:crypto";
import { decryptSecret } from "@/lib/settings";
import { 通道错, type 转写通道, type 提交输入, type 查询结果, type 转写句, type 采样档 } from "./channel";

type 环境 = Record<string, string | undefined>;
type 凭据 = { id: string; key: string };

const 默认端点 = "https://asr.tencentcloudapi.com";
const 版本 = "2019-06-14";
const 服务 = "asr";
const 请求超时毫秒 = 20_000;

/**
 * 读密钥：_ENC 有值就只认它（解不开 = 「解不开」，不退回明文那个）；没有 _ENC 才看明文名。两个都要有才算已配置。
 * 回的 值 只给 腾讯云通道 用，别处只看 状态
 */
export function 读凭据(env: 环境 = process.env): { 状态: "已配置"; 值: 凭据 } | { 状态: "未配置" | "解不开" } {
  let 解不开 = false;
  const 取 = (名: string): string | null => {
    const 密文 = env[`${名}_ENC`]?.trim();
    if (密文) {
      const v = decryptSecret(密文);
      if (v === null || !v.trim()) 解不开 = true;
      return v?.trim() || null;
    }
    return env[名]?.trim() || null;
  };
  const id = 取("ENT_TENCENT_ASR_SECRET_ID");
  const key = 取("ENT_TENCENT_ASR_SECRET_KEY");
  if (解不开) return { 状态: "解不开" };
  return id && key ? { 状态: "已配置", 值: { id, key } } : { 状态: "未配置" };
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const hmac = (k: Buffer | string, s: string) => createHmac("sha256", k).update(s, "utf8").digest();

/**
 * TC3-HMAC-SHA256（腾讯云 API 3.0 签名 v3）：规范请求 → 待签串 → 派生密钥（日期 → 服务 → tc3_request）→ 签名 → Authorization 头。
 * 只签 content-type、host、x-tc-action 三个头；时间戳是秒，日期取 UTC。回要带上的全部请求头
 */
export function TC3签名(x: { 凭据: 凭据; 动作: string; 载荷: string; 时间戳: number; 主机: string; 地域?: string | null }): Record<string, string> {
  const 类型 = "application/json; charset=utf-8";
  const 签的头 = "content-type;host;x-tc-action";
  const 规范请求 = ["POST", "/", "", `content-type:${类型}\nhost:${x.主机}\nx-tc-action:${x.动作.toLowerCase()}\n`, 签的头, sha256(x.载荷)].join("\n");
  const 日期 = new Date(x.时间戳 * 1000).toISOString().slice(0, 10);
  const 范围 = `${日期}/${服务}/tc3_request`;
  const 待签 = ["TC3-HMAC-SHA256", String(x.时间戳), 范围, sha256(规范请求)].join("\n");
  const 签钥 = hmac(hmac(hmac(`TC3${x.凭据.key}`, 日期), 服务), "tc3_request");
  const 签名 = createHmac("sha256", 签钥).update(待签, "utf8").digest("hex");
  return {
    Authorization: `TC3-HMAC-SHA256 Credential=${x.凭据.id}/${范围}, SignedHeaders=${签的头}, Signature=${签名}`,
    "Content-Type": 类型,
    Host: x.主机,
    "X-TC-Action": x.动作,
    "X-TC-Timestamp": String(x.时间戳),
    "X-TC-Version": 版本,
    "X-TC-Language": "zh-CN",
    ...(x.地域 ? { "X-TC-Region": x.地域 } : {}),
  };
}

/** 腾讯云的错误码 → 给人看的话 + 能不能等一会儿重试。不带腾讯云原话（可能回显请求里的地址） */
export function 认错误码(码: string): 通道错 {
  if (码.startsWith("AuthFailure") || 码.startsWith("UnauthorizedOperation")) return new 通道错("腾讯云密钥不对、过期，或者这个账号没有语音识别权限：请系统管理员核对服务器上配的密钥", false, 码);
  if (码 === "FailedOperation.UserNotRegistered") return new 通道错("这个腾讯云账号还没开通语音识别", false, 码);
  if (码 === "FailedOperation.ServiceIsolate" || 码.includes("Arrears") || 码.includes("Isolat")) return new 通道错("腾讯云账号欠费或语音识别服务被停用", false, 码);
  if (码 === "RequestLimitExceeded" || 码.startsWith("RequestLimitExceeded") || 码 === "InternalError" || 码.startsWith("InternalError") || 码.startsWith("ResourceUnavailable") || 码 === "FailedOperation.ErrorRecognize")
    return new 通道错("腾讯云这会儿忙或者出错了，稍后会自动再试", true, 码);
  if (码.startsWith("InvalidParameter") || 码.startsWith("MissingParameter") || 码.startsWith("UnsupportedOperation"))
    return new 通道错(`腾讯云不收这次提交（参数不对，错误码 ${码}）：请系统管理员看设置里的「语音转文字」`, false, 码);
  return new 通道错(`腾讯云拒绝了这次转写（错误码 ${码}）`, false, 码);
}

/** 状态 3 的 ErrorMsg → 给人看的话（只按关键字归类，原话不给人看、不进日志：可能带着签名下载地址） */
export function 失败话(原: unknown): string {
  const s = typeof 原 === "string" ? 原.toLowerCase() : "";
  if (/download|下载|url|fetch|获取音频|拉取/.test(s)) return "腾讯云取不到录音文件（签名下载地址打不开）：系统管理员可以在设置里把「大文件怎么交」改成「切段提交」后重试";
  if (/duration|时长|too long|too short|过长|过短/.test(s)) return "录音太长或太短，腾讯云没转";
  if (/format|decode|格式|解码|audio|音频/.test(s)) return "腾讯云读不了这个录音（格式或内容有问题）";
  return "腾讯云没转写成功";
}

/** 「0:1.640」「1:02:03.5」→ 毫秒 */
const 读时刻 = (t: string): number => Math.round(t.split(":").reduce((a, x) => a * 60 + Number(x), 0) * 1000);

/**
 * 结果 → 句们。先认 ResultDetail（每句 StartMs、EndMs、SpeakerId、FinalSentence）；没有就逐行认 Result：
 * 「[0:0.020,0:2.380,0]  你好。」（第三个数是说话人，开了说话人分离才有）。行格式【未核】，认不出的行整行当文字、不带时间
 */
export function 解析结果(d: { Result?: unknown; ResultDetail?: unknown }): 转写句[] {
  if (Array.isArray(d.ResultDetail) && d.ResultDetail.length) {
    const 们: 转写句[] = [];
    for (const x of d.ResultDetail as Record<string, unknown>[]) {
      const 文字 = String(x?.FinalSentence ?? "").trim();
      if (!文字) continue;
      const 起 = Number(x.StartMs);
      const 止 = Number(x.EndMs);
      const 人 = Number(x.SpeakerId);
      们.push({ 起: Number.isFinite(起) ? 起 : 0, 止: Number.isFinite(止) ? 止 : 0, 说话人: x.SpeakerId === undefined || x.SpeakerId === null || !Number.isFinite(人) || 人 < 0 ? null : 人, 文字 });
    }
    if (们.length) return 们;
  }
  const 们: 转写句[] = [];
  for (const 行 of String(d.Result ?? "").split(/\r?\n/)) {
    const t = 行.trim();
    if (!t) continue;
    const m = /^\[([\d:.]+),([\d:.]+)(?:,(\d+))?\]\s*(.*)$/.exec(t);
    if (!m) {
      们.push({ 起: 0, 止: 0, 说话人: null, 文字: t });
      continue;
    }
    if (!m[4].trim()) continue;
    们.push({ 起: 读时刻(m[1]), 止: 读时刻(m[2]), 说话人: m[3] === undefined ? null : Number(m[3]), 文字: m[4].trim() });
  }
  return 们;
}

type 取法 = typeof fetch;

/** 腾讯云通道。取 只给测试换成假 HTTP */
export function 腾讯云通道(凭据: 凭据, env: 环境 = process.env, 取: 取法 = fetch): 转写通道 {
  const 端点 = env.ENT_TENCENT_ASR_ENDPOINT?.trim() || 默认端点;
  const 主机 = new URL(端点).host;
  const 地域 = env.ENT_TENCENT_ASR_REGION?.trim() || null;
  const 引擎名 = (档: 采样档) => (档 === "8k" ? env.ENT_TENCENT_ASR_ENGINE_8K?.trim() || "8k_zh_large" : env.ENT_TENCENT_ASR_ENGINE_16K?.trim() || "16k_zh_en_2.0");

  async function 调(动作: string, 体: Record<string, unknown>): Promise<Record<string, unknown>> {
    const 载荷 = JSON.stringify(体);
    const 头 = TC3签名({ 凭据, 动作, 载荷, 时间戳: Math.floor(Date.now() / 1000), 主机, 地域 });
    let r: Response;
    try {
      r = await 取(端点, { method: "POST", headers: 头, body: 载荷, signal: AbortSignal.timeout(请求超时毫秒) });
    } catch {
      throw new 通道错("连不上腾讯云（网络断了或超时），稍后会自动再试", true, "网络");
    }
    if (r.status >= 500 || r.status === 429) throw new 通道错(`腾讯云暂时出错（${r.status}），稍后会自动再试`, true, `HTTP${r.status}`);
    const j = (await r.json().catch(() => null)) as { Response?: Record<string, unknown> } | null;
    const R = j?.Response;
    if (!R || typeof R !== "object") throw new 通道错("腾讯云回的内容看不懂，稍后会自动再试", true, "格式");
    const 错 = R.Error as { Code?: unknown } | undefined;
    if (错) throw 认错误码(String(错.Code ?? "未知"));
    return R;
  }

  return {
    名: "腾讯云",
    引擎: 引擎名,
    async 提交(x: 提交输入): Promise<string> {
      const 音 = x.音频.方式 === "请求体"
        ? { SourceType: 1, Data: x.音频.数据.toString("base64"), DataLen: x.音频.数据.length }
        : { SourceType: 0, Url: x.音频.url };
      const R = await 调("CreateRecTask", { EngineModelType: 引擎名(x.档), ChannelNum: 1, ResTextFormat: 0, SpeakerDiarization: 1, SpeakerNumber: 0, ...音 });
      const 号 = (R.Data as { TaskId?: unknown } | undefined)?.TaskId;
      if ((typeof 号 !== "number" && typeof 号 !== "string") || String(号) === "") throw new 通道错("腾讯云没回任务号，稍后会自动再试", true, "无任务号");
      return String(号);
    },
    async 查(任务号: string): Promise<查询结果> {
      const 号 = Number(任务号);
      if (!Number.isSafeInteger(号)) return { 状态: "失败", 话: "任务号不对" };
      const R = await 调("DescribeTaskStatus", { TaskId: 号 });
      const d = (R.Data ?? {}) as { Status?: unknown; ErrorMsg?: unknown; Result?: unknown; ResultDetail?: unknown; AudioDuration?: unknown };
      const 状 = Number(d.Status);
      if (状 === 0) return { 状态: "排队" };
      if (状 === 1) return { 状态: "转写中" };
      if (状 === 3) return { 状态: "失败", 话: 失败话(d.ErrorMsg) };
      if (状 !== 2) throw new 通道错("腾讯云回的状态看不懂，稍后会自动再试", true, "状态");
      const 秒 = Number(d.AudioDuration);
      return { 状态: "成功", 句们: 解析结果(d), 时长毫秒: Number.isFinite(秒) && 秒 > 0 ? Math.round(秒 * 1000) : null };
    },
  };
}

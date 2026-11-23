/**
 * 录音点评 · 转写通道（11-22，录音点评 PR4：腾讯云转写，方案-https与录音点评 §4.1–4.5）。
 *
 * 两条通道，接口一样：
 *   - 腾讯云录音文件识别（异步，tencent.ts）：CreateRecTask 提交、DescribeTaskStatus 查；密钥只从服务器环境读（见 tencent.ts 读凭据）
 *   - 假通道（fake.ts）：ENT_ASR_FAKE=1 时用，回固定的两人对话；3703 实操、测试用，不连外网
 * 用哪条：ENT_ASR_FAKE 设了用假通道；否则密钥齐了用腾讯云；都没有 = 没配（录音点评不放开）。
 * 这一层不碰库、不碰磁盘；排队、重试、落库在 coach-rec-jobs.ts。
 */

/** 交给通道的音频：≤ 请求体上限字节 的直接放请求体（base64）；大的给一个签名下载地址 */
export type 交的音频 = { 方式: "请求体"; 数据: Buffer } | { 方式: "地址"; url: string };

/** 引擎：8k 的（电话录音、amr）一套，其余一套；名字可用环境变量换（腾讯云引擎名【未核】，见 tencent.ts） */
export type 采样档 = "8k" | "16k";

export type 提交输入 = { 档: 采样档; 音频: 交的音频 };

/** 一句：起止毫秒（相对这一段音频开头）、说话人（没分出来 = null）、文字 */
export type 转写句 = { 起: number; 止: number; 说话人: number | null; 文字: string };

export type 查询结果 =
  | { 状态: "排队" | "转写中" }
  | { 状态: "成功"; 句们: 转写句[]; 时长毫秒: number | null }
  | { 状态: "失败"; 话: string };

/**
 * 通道出的错：话 = 给人看的（不带密钥、签名、请求原文）；可重试 = 网络断、5xx、限频这类等一会儿再试可能就好的。
 * 码 = 腾讯云的错误码（只给日志和测试，不给人看）
 */
export class 通道错 extends Error {
  constructor(
    public 话: string,
    public 可重试: boolean,
    public 码: string | null = null,
  ) {
    super(话);
    this.name = "通道错";
  }
}

export interface 转写通道 {
  /** 写进库 engine 列的前缀：「腾讯云」「假通道」 */
  名: string;
  /** 这一档用哪个引擎（写进库 engine 列，「腾讯云·16k_zh_en」） */
  引擎(档: 采样档): string;
  /** 提交一段，回任务号（字符串）。出错抛 通道错 */
  提交(x: 提交输入): Promise<string>;
  /** 查一个任务。网络、5xx 抛 通道错（可重试）；腾讯云说这条失败了回 { 状态: "失败" } */
  查(任务号: string): Promise<查询结果>;
}

/** 请求体方式最多多少原始字节：腾讯云请求体 ≤5MB，base64 后大 1/3，留余量取 3.6MB（方案 §4.3「≤5MB 走请求体」按 base64 后算【未核】） */
export const 请求体上限字节 = Math.floor(3.6 * 1024 * 1024);

export type 密钥状态 = "已配置" | "未配置" | "解不开" | "假通道";

type 环境 = Record<string, string | undefined>;

/** 假通道开没开（ENT_ASR_FAKE=1；=down 模拟提交一直失败、=fail 模拟腾讯云回失败，3703 实操失败路径用） */
export const 假通道开着 = (env: 环境 = process.env): boolean => !!env.ENT_ASR_FAKE?.trim() && env.ENT_ASR_FAKE.trim() !== "0";

/** 现在用哪条通道；没配 = null。每次现读环境（换密钥要重启进程，和别的 .secret-env 一样） */
export async function 选通道(env: 环境 = process.env): Promise<转写通道 | null> {
  if (假通道开着(env)) return (await import("./fake")).假通道(env);
  const { 读凭据, 腾讯云通道 } = await import("./tencent");
  const 凭据 = 读凭据(env);
  return 凭据.状态 === "已配置" ? 腾讯云通道(凭据.值, env) : null;
}

/** 设置页显示用：已配置 / 未配置 / 解不开（换过 auth-secret）/ 假通道。不回任何密钥内容 */
export async function 通道密钥状态(env: 环境 = process.env): Promise<密钥状态> {
  if (假通道开着(env)) return "假通道";
  return (await import("./tencent")).读凭据(env).状态;
}

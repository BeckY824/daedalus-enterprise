/**
 * 录音点评 · 假转写通道（11-22，录音点评 PR4，方案 §4.5「3703 其余实操用假通道」）。不连外网、不要密钥。
 *
 * ENT_ASR_FAKE=1：提交马上回任务号，第一次查回「转写中」、第二次起回固定的两人对话（说话人 0 / 1，按任务号里记的时长排时间）
 * ENT_ASR_FAKE=down：提交一直抛「连不上」（可重试），走 30 秒 / 2 分钟 / 10 分钟三次重试后整理失败的路径
 * ENT_ASR_FAKE=fail：提交成功，查回失败（腾讯云状态 3 那条路）
 * 任务号 = fake-<序号>-<交法>，交法给测试看「这段是走请求体还是签名地址」
 */
import { 通道错, type 转写通道, type 提交输入, type 查询结果 } from "./channel";

type 环境 = Record<string, string | undefined>;

const g = globalThis as unknown as { __假转写?: { 序: number; 查过: Set<string> } };
const 态 = (g.__假转写 ??= { 序: 0, 查过: new Set() });

export const 假转写句们 = [
  { 起: 0, 止: 3200, 说话人: 0, 文字: "（假通道）这次拜访客户主要聊了报价。" },
  { 起: 3200, 止: 7000, 说话人: 1, 文字: "（假通道）报价单下周一前发过去，先确认数量。" },
];

export function 假通道(env: 环境 = process.env): 转写通道 {
  const 模式 = env.ENT_ASR_FAKE?.trim() ?? "1";
  return {
    名: "假通道",
    引擎: (档) => `fake_${档}`,
    async 提交(x: 提交输入): Promise<string> {
      if (模式 === "down") throw new 通道错("连不上腾讯云（网络断了或超时），稍后会自动再试", true, "网络");
      态.序 += 1;
      return `fake-${态.序}-${x.音频.方式 === "请求体" ? "body" : "url"}`;
    },
    async 查(任务号: string): Promise<查询结果> {
      if (!任务号.startsWith("fake-")) return { 状态: "失败", 话: "任务号不对" };
      if (模式 === "fail") return { 状态: "失败", 话: "腾讯云没转写成功" };
      if (!态.查过.has(任务号)) {
        态.查过.add(任务号);
        return { 状态: "转写中" };
      }
      return { 状态: "成功", 句们: 假转写句们.map((x) => ({ ...x })), 时长毫秒: 7000 };
    },
  };
}

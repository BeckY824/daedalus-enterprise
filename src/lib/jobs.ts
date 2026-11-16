/**
 * 后台任务归哪个进程跑（11-16，企业版多进程）。
 *
 * 部署约定（部署脚本照这个起进程）：W 个进程，第 i 个（1..W）听 PORT+i-1，环境变量 CRM_INSTANCE=i；
 * 只有 i=1 设 CRM_JOBS=1，其余设 CRM_JOBS=0。
 *
 *   - CRM_INSTANCE：正整数，没设 / 写错 = 1。只用来在日志和锁里认是哪个进程
 *   - CRM_JOBS：没设 = 跑（单进程部署照旧）；"0" = 不跑；"1"（或别的值）= 跑
 *
 * 「后台任务」= instrumentation.ts 起的同步钟、夜扫钟、启动时的老数据活，加上列附件时顺手清孤儿（attachments.ts）。
 *
 * 开着也要先占「jobs」这把跨进程锁（lib/proc-lock.ts）才跑：配错了、两个进程都设了 CRM_JOBS=1，也只有一个真跑。
 * 没占到打一行日志，之后每分钟悄悄再试一次：占着的那个进程没了（锁过期 / pid 不在），这边接着跑。
 */
import { 占锁, 实例号, type 锁信息 } from "./proc-lock";

export { 实例号 };

/** CRM_JOBS 开没开（不看锁）。每次现读环境变量 */
export function 后台任务开关(env: Record<string, string | undefined> = process.env): boolean {
  return (env.CRM_JOBS ?? "").trim() !== "0";
}

type 状态 = "没试" | "占到" | "没占到";
const g = globalThis as unknown as { __crmJobs?: { 状态: 状态; 重试?: ReturnType<typeof setInterval> } };
const 本 = (g.__crmJobs ??= { 状态: "没试" });

/** 本进程该不该跑后台任务：开关开着，并且没在「占锁没占到」的状态。没走过 起后台任务 的（桌面端、测试）只看开关 */
export function 本进程跑后台任务(env: Record<string, string | undefined> = process.env): boolean {
  return 后台任务开关(env) && 本.状态 !== "没占到";
}

const 谁占着 = (x: 锁信息 | null) => (x ? `实例 ${x.实例}（pid ${x.pid}，${x.开始} 起）` : "别的进程");

/**
 * 开关开着时占锁，占到了调 跑() 一次（等它做完）；没占到打一行日志，每 重试毫秒 再试，占到了再跑。开关关着什么都不做。
 * 回本进程这次占没占到（开关关着回 false）。
 */
export async function 起后台任务(
  跑: () => unknown,
  opts: { 重试毫秒?: number; 锁名?: string; env?: Record<string, string | undefined>; 过期毫秒?: number; 心跳毫秒?: number; 目录?: string } = {},
): Promise<boolean> {
  const env = opts.env ?? process.env;
  const 号 = 实例号(env);
  if (!后台任务开关(env)) {
    console.log(`[后台任务] 实例 ${号}：CRM_JOBS=0，本进程不跑钟和老数据活`);
    return false;
  }
  // 本进程已经占着（开发时热更新、测试里重复调 register）：和原来一样照跑，钟和老数据活各自防重
  const 锁名 = opts.锁名 ?? "jobs";
  const 试 = () => 占锁(锁名, { 附: { 用途: "后台任务" }, 过期毫秒: opts.过期毫秒, 心跳毫秒: opts.心跳毫秒, 目录: opts.目录 });
  // 跑() 起钟那段等它做完（和原来 instrumentation 里直接 await 一样，钟在服务接请求前起好）；出错只记日志
  const 开跑 = async () => {
    本.状态 = "占到";
    try {
      await 跑();
    } catch (e) {
      console.error("[后台任务] 启动出错", e);
    }
  };
  if (本.状态 === "占到") {
    await 开跑();
    return true;
  }
  const r = 试();
  if (r.ok) {
    console.log(`[后台任务] 实例 ${号}：本进程跑钟和老数据活${r.锁.降级 ? "（锁目录用不了，没上跨进程锁）" : ""}`);
    await 开跑();
    return true;
  }
  本.状态 = "没占到";
  console.log(`[后台任务] 实例 ${号}：CRM_JOBS 开着但${谁占着(r.占着的)}已经在跑，本进程不跑；占着的停了再接手`);
  if (!本.重试) {
    本.重试 = setInterval(() => {
      if (本.状态 === "占到") return;
      const again = 试();
      if (!again.ok) return;
      clearInterval(本.重试);
      本.重试 = undefined;
      console.log(`[后台任务] 实例 ${号}：原来跑后台任务的进程停了，本进程接手`);
      void 开跑();
    }, opts.重试毫秒 ?? 60_000);
    本.重试.unref?.();
  }
  return false;
}

/** 测试用：回到没试过的状态 */
export function 重置后台任务状态(): void {
  if (本.重试) clearInterval(本.重试);
  本.重试 = undefined;
  本.状态 = "没试";
}

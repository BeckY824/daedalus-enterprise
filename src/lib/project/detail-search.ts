import { fmtDateTime } from "@/lib/utils";

/**
 * 企业版项目详情页（U-项目-04 / F-项目-18）：顶部搜索框搜这个项目的沟通、卡点，附件块里写明截图、录音来自哪条沟通。
 * 只在界面上过滤已经拿到的那些，不另查库。
 */

/** 搜索框里的字拆成词：空格分开的几个词都得对上（不分大小写） */
export function 词们(q: string): string[] {
  return q.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** 每个词都在这些字段里的某一处出现过（没有词 = 都算对上） */
export function 对得上(词: string[], 字段: (string | null | undefined)[]): boolean {
  if (!词.length) return true;
  const 全 = 字段.filter((x): x is string => !!x).join("\n").toLowerCase();
  return 词.every((w) => 全.includes(w));
}

type 沟通 = { content: string; who: string; node: string; type: string; method?: string | null; 附件?: { name: string }[] };
/** 沟通搜得到的：内容、谁记的、记在哪个进程、沟通类型和方式、附件文件名（编号界面上不摆，不参与搜） */
export const 沟通字段 = (f: 沟通) => [f.content, f.who, f.node, f.type, f.method, ...(f.附件 ?? []).map((a) => a.name)];

type 卡点 = {
  code: string; type: string; impact: string; obstacle: string; description: string; status: string;
  经手人: string | null; 发布人: string; resourceRequest: string | null; progress: string | null; solution: string | null; result: string | null;
};
/** 卡点搜得到的：编号、类型、影响、障碍、描述、状态、经手人、发布人、要的资源、进度、方案、结果 */
export const 卡点字段 = (k: 卡点) => [k.code, k.type, k.impact, k.obstacle, k.description, k.status, k.经手人, k.发布人, k.resourceRequest, k.progress, k.solution, k.result];

/** 附件块里「来自沟通：谁 · 什么时候 · 头几个字」：内容太长截到 20 个字 */
export function 沟通来源(f: { who: string; occurredAt: string; content: string }): string {
  const 头 = f.content.replace(/\s+/g, " ").trim();
  const 摘 = [...头].length > 20 ? `${[...头].slice(0, 20).join("")}…` : 头;
  return [f.who, fmtDateTime(f.occurredAt), 摘].filter(Boolean).join(" · ");
}

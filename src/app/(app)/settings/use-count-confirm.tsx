"use client";
/**
 * 「先数再确认」共用钩子（设置开关 N8，11-23）：会当场动数据的两个开关，确认前先数一遍。
 * 原卡（ProjectSettingsTab 的 持有上限 / 超时回收）和开关总览（SwitchesTab）调同一份，说法、条件都只写这一处。
 *
 *   超时回收：按改完的规则调 预览超时回收 数现在会有几个回公海；0 个不弹框直接存（同原卡），有就后果框写明个数；
 *            确认后保存时服务端当场再扫一遍（projects/actions.ts 改组织规则）。谁能改照旧服务端判（节点时限、!全能）
 *   持有上限：打开前按存着的上限数已经到上限的人（org-rules.ts 到上限的人数），后果框里写几人暂时领不了公海
 */
import { useConsequence } from "@/components/ConsequenceDialog";
import { 预览超时回收 } from "@/app/(app)/projects/actions";
import { 是不限, type 组织规则, type 规则改动 } from "@/lib/project/org-rules";

type 存的结果 = { ok: boolean; error?: string };
/** 取消 = null；数不出来、服务端拒了 = { ok:false, error }；存了 = 存 回的 */
export type 数后结果 = 存的结果 | null;

export function useCountConfirm() {
  const [问后果, 后果框] = useConsequence();

  /** 超时回收：先数会回收几个再确认；改 = 这次要存的改动（打开、改天数、改起算日都走这里） */
  const 超时回收 = async (改: 规则改动, 存: () => Promise<存的结果>): Promise<数后结果> => {
    const 看 = await 预览超时回收(改).catch(() => null);
    if (!看) return { ok: false, error: "没改成，请稍后再试" };
    if (!看.ok) return { ok: false, error: ("error" in 看 && 看.error) || "没改成，请稍后再试" };
    if (!看.个数) return 存();
    let 结果: 数后结果 = null;
    await 问后果({
      题: `按新设置，现在会有 ${看.个数} 个项目回到线索公海`,
      后果: [
        { 标: "回公海", 级: "警", 话: 看.团队
          ? "这些项目在进程上已经超过处理时长没跟进。确认后你名下的马上回到公海；别人名下的在他下次打开首页或项目列表时回到公海"
          : "这些项目在进程上已经超过处理时长没跟进，确认后它们马上回到公海" },
        { 标: "提醒", 话: "负责人都会收到提醒" },
      ],
      是: 改.超时回收?.开 === true ? "确认打开" : "确认保存",
      做: async () => {
        结果 = await 存();
        return 结果;
      },
    });
    return 结果;
  };

  /** 持有上限：打开前写明按几个算、现在几人已到上限；到上限 = 到上限的人数(…) */
  const 持有上限 = async (公海: 组织规则["公海"], 到上限: number, 存: () => Promise<存的结果>): Promise<数后结果> => {
    const 按 = `按${是不限(公海.默认上限) ? "不限" : ` ${公海.默认上限} 个`}${Object.keys(公海.每人上限).length ? "（单独设过的按各自的）" : ""}算`;
    let 结果: 数后结果 = null;
    await 问后果({
      题: "开持有上限？",
      后果: [
        { 标: "全员", 级: "警", 话: 到上限 ? `${按}，现在有 ${到上限} 人已经到了上限，他们暂时领不了公海` : `${按}，现在没有人到上限` },
        { 标: "能改回", 话: "随时可以关掉，关了就不再挡" },
      ],
      是: "开持有上限",
      危: false,
      做: async () => {
        结果 = await 存();
        return 结果;
      },
    });
    return 结果;
  };

  return [{ 超时回收, 持有上限 }, 后果框] as const;
}

"use client";

/**
 * 撤回项目合并（合并客户第二批 2a）：项目详情顶上「已并入」那一行（projects/[id]/MergedIntoLine.tsx）和历史变更里的项目合并单（HistoryChanges.tsx）共用的
 * 后果框写法、撤回结果那几句（照第一批 HistoryChanges MergeOrders）。这里只放写法，不引服务端动作
 */
import type { 后果框参数 } from "@/components/ConsequenceDialog";

/** 被并掉的叫 B（拆回来的那个），留下的叫 A */
export function 项目合并撤回后果(B: string, A: string, 做: 后果框参数["做"]): 后果框参数 {
  return {
    题: `撤回合并：把「${B}」从「${A}」拆回来？`,
    宽: 480,
    危: false,
    是: "撤回合并",
    后果: [
      { 标: "拆回", 话: `「${B}」的结局、线索验证清回合并前；合并时挪过去的沟通、附件、录音点评、联系人回到它上面`, 级: "警" },
      { 标: "组员", 话: `合并时加进「${A}」项目组的组员移出（之后改过角色的留着）` },
      { 标: "留着", 话: `合并之后在「${A}」上新记的沟通不跟着走；之后又改过的对不上，留下不动，撤完列出来` },
    ],
    做,
  };
}

export type 撤回结果 = { 没还原: { 类: string; 原因: string }[] };

/** 撤回之后那几句：全还原了一句；有没还原的列出来（同第一批） */
export function 撤回结果话({ r }: { r: 撤回结果 }) {
  if (r.没还原.length === 0) return <p className="mrg-note" role="status">已撤回，全部还原了</p>;
  return (
    <>
      <p className="mrg-note" role="status">已撤回；留下 {r.没还原.length} 条没还原：</p>
      <ul className="mrg-left" data-testid="merge-undo-left">
        {r.没还原.map((x, i) => <li key={i}>{x.类}：{x.原因}</li>)}
      </ul>
    </>
  );
}

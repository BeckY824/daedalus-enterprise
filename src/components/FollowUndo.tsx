"use client";

/**
 * 刚记的沟通「撤销」（A7-1，11-03）：
 * - 记下后的提示条带一个「撤销」（记下带撤销）；
 * - 时间线上本人记的、记下不到 10 分钟的那条也摆「撤销」（UndoRecentFollow），到点自己收起来。
 * 都调 撤销刚记的沟通：服务器再判一次本人 + 10 分钟，过了说清楚；撤销 = 软删进回收站 + 审计。
 */
import { useEffect, useState } from "react";
import { App, Button } from "antd";
import { 撤销刚记的沟通 } from "@/app/(app)/customers/[id]/actions";
import { 时间线可撤, 撤销剩余毫秒 } from "@/lib/enterprise/follow-undo";

type 提示 = ReturnType<typeof App.useApp>["message"];

/** 撤一条刚记的沟通：成功提示一句再回调；页面别直接引 action，都走这里 */
export async function 撤(message: 提示, id: string, 撤完: () => void) {
  const r = await 撤销刚记的沟通(id);
  if (!r.ok) return void message.error(r.error);
  message.success("已撤销这条沟通");
  撤完();
}

/** 记下后的提示：带「撤销」。没拿到新记录的 id 就只说记下了 */
export function 记下带撤销(message: 提示, 文字: string, id: string | null | undefined, 撤完: () => void) {
  if (!id) return void message.success(文字);
  const key = `follow-undo-${id}`;
  message.success({
    key,
    duration: 6,
    content: (
      <span>
        {文字}
        <Button type="link" size="small" onClick={() => { message.destroy(key); void 撤(message, id, 撤完); }}>撤销</Button>
      </span>
    ),
  });
}

/** 时间线上一条沟通后面的「撤销」：本人记的、10 分钟内才摆，到点自己收起来 */
export function UndoRecentFollow({ id, 我记的, createdAt, 撤完 }: { id: string; 我记的?: boolean; createdAt?: string | null; 撤完: () => void }) {
  const { message } = App.useApp();
  const [能, set能] = useState(() => 时间线可撤(我记的, createdAt));
  const [忙, set忙] = useState(false);
  useEffect(() => {
    if (!能 || !createdAt) return;
    const t = setTimeout(() => set能(false), 撤销剩余毫秒(createdAt) + 500);
    return () => clearTimeout(t);
  }, [能, createdAt]);
  if (!能) return null;
  return (
    <Button
      type="link"
      size="small"
      loading={忙}
      title="自己刚记的，10 分钟内可以撤销"
      onClick={async () => { set忙(true); try { await 撤(message, id, 撤完); } finally { set忙(false); } }}
    >
      撤销
    </Button>
  );
}

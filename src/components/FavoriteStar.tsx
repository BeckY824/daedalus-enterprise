"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Tooltip } from "antd";
import { StarFilled, StarOutlined } from "@ant-design/icons";
import { useViewAs } from "@/components/ViewAsContext";
import { 视图收藏话 } from "@/lib/enterprise/view-as-words";

/**
 * 记录页名字旁边的星（客户、项目共用）：点了就进左栏收藏，再点就拿掉。
 * 先改星的样子再等回话；失败了（回话说不行，或这一下根本没打通）退回去，原因浮在星的正上方（不弹顶部提示，原型 g.notice），不崩整页。
 * 切换视图是只读，星只能看：看到的是被看的人收没收藏。
 */
export default function FavoriteStar({ 初值, 切换 }: { 初值: boolean; 切换: () => Promise<{ ok: true; 收藏了: boolean } | { ok: false; error: string }> }) {
  const router = useRouter();
  const 视图中 = useViewAs();
  const [收藏了, set收藏了] = useState(初值);
  const [错, set错] = useState("");
  const [pending, start] = useTransition();
  const 名 = 收藏了 ? "从左栏收藏里拿掉" : "收藏到左栏";
  // 原因停 4 秒自己收（和 SaveButton「没保存上」一样长）
  useEffect(() => {
    if (!错) return;
    const t = setTimeout(() => set错(""), 4000);
    return () => clearTimeout(t);
  }, [错]);

  return (
    <Tooltip title={错 ? <span role="alert">{错}</span> : 视图中 ? 视图收藏话 : 名} open={错 ? true : undefined}>
      <Button
        type="text"
        size="small"
        className={`rec-star${收藏了 ? " on" : ""}`}
        aria-label={名}
        aria-pressed={收藏了}
        disabled={pending || 视图中}
        icon={收藏了 ? <StarFilled /> : <StarOutlined />}
        onClick={() => {
          const 想要 = !收藏了;
          set收藏了(想要);
          set错("");
          start(async () => {
            try {
              const r = await 切换();
              if (!r.ok) {
                set收藏了(!想要);
                set错(r.error);
                return;
              }
              set收藏了(r.收藏了);
              router.refresh();
            } catch {
              set收藏了(!想要);
              set错("没存上，再点一次试试");
            }
          });
        }}
      />
    </Tooltip>
  );
}

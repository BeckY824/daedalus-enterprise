"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Tooltip } from "antd";
import { StarFilled, StarOutlined } from "@ant-design/icons";
import { useViewAs } from "@/components/ViewAsContext";
import { 视图收藏话 } from "@/lib/enterprise/view-as-words";

/**
 * 记录页名字旁边的星（客户、项目共用）：点了就进左栏收藏，再点就拿掉。
 * 先改星的样子再等回话；失败了（回话说不行，或这一下根本没打通）退回去并说一句，不崩整页。
 * 切换视图是只读，星只能看：看到的是被看的人收没收藏。
 */
export default function FavoriteStar({ 初值, 切换 }: { 初值: boolean; 切换: () => Promise<{ ok: true; 收藏了: boolean } | { ok: false; error: string }> }) {
  const router = useRouter();
  const { message } = App.useApp();
  const 视图中 = useViewAs();
  const [收藏了, set收藏了] = useState(初值);
  const [pending, start] = useTransition();
  const 名 = 收藏了 ? "从左栏收藏里拿掉" : "收藏到左栏";

  return (
    <Tooltip title={视图中 ? 视图收藏话 : 名}>
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
          start(async () => {
            try {
              const r = await 切换();
              if (!r.ok) {
                set收藏了(!想要);
                message.error(r.error);
                return;
              }
              set收藏了(r.收藏了);
              router.refresh();
            } catch {
              set收藏了(!想要);
              message.error("没存上，再点一次试试");
            }
          });
        }}
      />
    </Tooltip>
  );
}

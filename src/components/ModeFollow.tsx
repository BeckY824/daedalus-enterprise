"use client";

import { useEffect } from "react";
import { useLocalPref } from "@/lib/local-pref";
import { 外观键, 默认外观, 读外观, 解明暗, 听系统明暗, type 外观 } from "@/lib/appearance";

/**
 * 明暗选了「跟随系统」：系统一换（白天↔夜间、手动拨），<html data-mode> 当场跟着换，不用刷新。
 * 挂在根布局上，哪一页都在听——只放在设置页的话，关了设置就不跟了。
 * 首次绘制前那一下由 外观预设脚本 解好了，这里只管之后的变化；选的不是跟随系统就不听。
 */
export default function ModeFollow() {
  const [存的] = useLocalPref<Partial<外观>>(外观键, 默认外观);
  const mode = 读外观(JSON.stringify(存的)).mode;
  useEffect(() => {
    if (mode !== "system") return;
    return 听系统明暗(() => {
      document.documentElement.dataset.mode = 解明暗("system");
    });
  }, [mode]);
  return null;
}

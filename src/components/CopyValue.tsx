"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { CheckOutlined, CopyOutlined } from "@ant-design/icons";
import { useCopy } from "@/lib/clipboard";
import { 是空值 } from "@/lib/empty-value";

/**
 * 电话、邮箱：普通文字 + 紧贴右边的小复制键（11-09 用户：超链接取消，右边加个可复制的按钮）。
 *
 * 复制的是传进来的完整值，不看屏幕上被省略号截成了什么样。
 * 号码在服务端过了脱敏器（lib/enterprise/phone-mask.ts 的 号码脱敏器）：看不到真号的人，这里拿到的就是打了码的值，
 * 带 * 的不给按钮，也就没有东西可以复制。这个组件不能拿没打码的原值当 value 传。
 */
export default function CopyValue({
  value,
  叫法,
  种类 = "号码",
  文字,
  style,
}: {
  value: string;
  /** 按钮的 aria-label 和成功提示：复制电话、已复制电话 */
  叫法: string;
  /** 号码才会打码，邮箱地址里的 * 不算打码 */
  种类?: "号码" | "邮箱";
  /** 屏幕上写的字和要复制的不是一回事时才传（「联系负责人：某某」，复制的是邮箱） */
  文字?: string;
  style?: CSSProperties;
}) {
  const 复制 = useCopy();
  const [刚复制, set刚复制] = useState(false);
  const 计时 = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(计时.current), []);

  const 不给按钮 = 是空值(value) || (种类 === "号码" && value.includes("*"));

  async function 点(e: MouseEvent) {
    // 客户详情一行点了进编辑，列表一行点了开详情：点复制不算点这一行
    e.stopPropagation();
    if (!(await 复制(value, `已复制${叫法}`))) return;
    set刚复制(true);
    clearTimeout(计时.current);
    计时.current = setTimeout(() => set刚复制(false), 1500);
  }

  return (
    <span className="copy-val" style={style}>
      <span className="copy-val-t" title={value}>{文字 ?? value}</span>
      {!不给按钮 && (
        <button
          type="button"
          className={`copy-val-b${刚复制 ? " is-done" : ""}`}
          aria-label={`复制${叫法}`}
          title={`复制${叫法}`}
          onClick={点}
          // 外层那一行按回车也进编辑：键盘按在按钮上只算复制
          onKeyDown={(e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && e.stopPropagation()}
        >
          {刚复制 ? <CheckOutlined /> : <CopyOutlined />}
        </button>
      )}
    </span>
  );
}

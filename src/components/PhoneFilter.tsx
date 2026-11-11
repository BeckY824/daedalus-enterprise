"use client";

import { useState, type CSSProperties } from "react";
import { Input } from "antd";
import { PhoneOutlined } from "@ant-design/icons";

/**
 * 列表「手机号」筛选（11-11，P-界面-12 自选筛选里的一项）：输号码（可以只输后几位、中间一段，带空格、横杠、+86 都行），
 * 回车或点开别处就筛，点小叉清掉。比法在服务端 lib/search-keyword.ts 客户号码SQL，地址栏 phone= 由调用方写。
 * 不像搜索框那样打字停一下就筛：它常收在「更多筛选」弹层里，每个字都刷一趟页面会把弹层里的输入打断
 */
export default function PhoneFilter({ value, 改, style }: { value: string; 改: (v: string) => void; style?: CSSProperties }) {
  const [草稿, set草稿] = useState(value);
  const [上次, set上次] = useState(value);
  // 地址栏变了（重置、前进后退）跟着变；自己的草稿不被冲掉
  if (上次 !== value) {
    set上次(value);
    set草稿(value);
  }
  const 交 = (v: string) => {
    const t = v.trim();
    if (t !== value) 改(t);
  };
  return (
    <Input
      style={style}
      aria-label="手机号"
      placeholder="手机号（至少 3 位）"
      prefix={<PhoneOutlined className="muted" />}
      allowClear
      inputMode="tel"
      value={草稿}
      onChange={(e) => {
        set草稿(e.target.value);
        // 点了小叉：立刻回到全部
        if (e.type !== "change" && !e.target.value) 交("");
      }}
      onPressEnter={() => 交(草稿)}
      onBlur={() => 交(草稿)}
    />
  );
}

/**
 * 企业版客户状态的标签配色（10-29，中栏名单按客户状态分组）。字典表没有颜色列（不加迁移），配色在这里定死：
 * - 默认九项按固定 id 认（dict-custStatus-<序号>），改了名颜色不变：潜在蓝、意向紫（10-30：原来意向是深蓝，和潜在分不开）、成交绿、交付青、复购品红、忠诚金、丢单橙红、流失灰、异常红；
 * - 管理员自己加的按名字散到一组备用色上，同一个名字永远同一个颜色；
 * - 字典里已经没有的旧值（停用后删不掉的老数据）同样按名字散。
 * 纯函数，客户端、服务端都能用。
 */
const 默认色 = ["blue", "purple", "green", "cyan", "magenta", "gold", "volcano", "default", "red"] as const;
const 备用色 = ["magenta", "lime", "orange", "geekblue", "purple", "cyan", "gold", "blue"] as const;

function 散(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return 备用色[h % 备用色.length];
}

/** 一项的颜色：默认项按 id 序号，其余按名字 */
export function 客户状态色(项: { id?: string | null; name: string }): string {
  const m = /^dict-custStatus-(\d+)$/.exec(项.id ?? "");
  const i = m ? Number(m[1]) : -1;
  return i >= 0 && i < 默认色.length ? 默认色[i] : 散(项.name);
}

/** 名字 → 颜色：先查页面传来的表（字典几项按 id 定的色），表里没有按名字散 */
export function 客户状态色of(表: Readonly<Record<string, string>> | null | undefined, name: string): string {
  return 表?.[name] ?? 客户状态色({ name });
}

/** 字典几项 → 名字到颜色的表；表里没有的名字调 客户状态色({ name }) 兜底 */
export function 客户状态色表(项们: readonly { id: string; name: string }[]): Record<string, string> {
  return Object.fromEntries(项们.map((x) => [x.name, 客户状态色(x)]));
}

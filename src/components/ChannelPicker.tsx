"use client";

/**
 * 选渠道（2026-10-29 渠道改版）：按「渠道属性 → 渠道名称 → 来源」三级点下去，
 * 或者直接打字搜全称（搜到任何一级、或全称里有这几个字都算）。选中后框里显示渠道全称。
 * 两级（层级="两级"，P16 新建线索用）：「渠道名称 → 来源」，不先问属性；一个渠道名称下只有一个来源、
 * 而且来源就是名称本身的（如转介绍人），不再多点一层，直接在第一列选。
 * 只能选到最末一级（具体来源 = 一个渠道），选了来源渠道就定了。
 * 企业版渠道两层后（P-渠道-01 附.5，11-10）默认就是两级 =「主渠道 → 子渠道」：先选主渠道再选子渠道，各处一个口径；
 * 三级（先问属性）只在明说 层级="三级" 时用。
 *
 * 只认渠道 id：value / onChange 都是 id，外面不用管路径。
 * 停用的渠道不列出来——除非它正是现在选着的那个（编辑一条老记录时不能把它的渠道弄丢）。
 * 「历史渠道」组的渠道由服务端清单（channel-options.ts）挡在外面，同样只带现在选着的那个。
 */
import { useMemo } from "react";
import { Cascader } from "antd";
import { 子渠道名, 渠道显示名, 主渠道显示名 } from "@/lib/enterprise/channel-main-core";

export type 可选渠道 = { id: string; name: string; attr: string | null; platform: string | null; active: boolean };

type 节点 = { value: string; label: string; 全称?: string; children?: 节点[]; disabled?: boolean };

export const 未分属性 = "未分属性";
const 前缀 = { 属性: "attr:", 名称: "plat:" } as const;

export type 渠道层级 = "三级" | "两级";

/** A2-8：一个渠道都没有时，选渠道的地方不摆空下拉，说清找谁加（业务员自己加不了渠道） */
export const 没渠道提示 = "请系统管理员先添加渠道";
/** 能不能选：停用的不算（除非正是现在选着的那个） */
export function 有渠道可选(channels: 可选渠道[], 选着?: string | null): boolean {
  return channels.some((c) => c.active || c.id === 选着);
}

/** 渠道清单 → 「渠道名称 → 来源」两级树；渠道名称按出现顺序，同名不同属性的并在一起 */
export function 两级渠道树(channels: 可选渠道[], 选着?: string | null): 节点[] {
  const 树: 节点[] = [];
  const 名们 = new Map<string, 节点>();
  for (const c of channels) {
    if (!c.active && c.id !== 选着) continue;
    // 第一列 = 主渠道：两层后 platform 就是主渠道名；老渠道没有的按竖线拆全称取前半段
    const p = 主渠道显示名(c.name, c.platform);
    let 名 = 名们.get(p);
    if (!名) {
      名 = { value: 前缀.名称 + p, label: p, children: [] };
      名们.set(p, 名);
      树.push(名);
    }
    名.children!.push(叶(c));
  }
  // 只有一个来源、来源就是名称本身：第一列直接是这个渠道
  return 树.map((名) => (名.children!.length === 1 && 名.children![0].全称 === 名.label ? 名.children![0] : 名));
}

/**
 * 叶子：标签是子渠道名（认半角「|」和全角「｜」）；子渠道留空的写主渠道名本身。
 * 全称按 渠道显示名 规整：老数据尾巴上挂着的「|」「｜」不显示，全角竖线显示成半角（P-渠道-01）
 */
const 叶 = (c: 可选渠道): 节点 => ({
  value: c.id,
  label: (子渠道名(c.name, c.platform) || c.platform?.trim() || 渠道显示名(c.name)) + (c.active ? "" : "（已停用）"),
  全称: 渠道显示名(c.name),
});

/** 渠道清单 → 三级树；每一级按出现顺序排（服务端已按 启用在前、新建在前 排好） */
export function 渠道树(channels: 可选渠道[], 选着?: string | null): 节点[] {
  const 树: 节点[] = [];
  const 属性们 = new Map<string, 节点>();
  for (const c of channels) {
    if (!c.active && c.id !== 选着) continue;
    const a = c.attr?.trim() || 未分属性;
    const p = c.platform?.trim() || c.name;
    let 属 = 属性们.get(a);
    if (!属) {
      属 = { value: 前缀.属性 + a, label: a, children: [] };
      属性们.set(a, 属);
      树.push(属);
    }
    let 名 = 属.children!.find((x) => x.label === p);
    if (!名) {
      名 = { value: `${前缀.名称}${a}\u0000${p}`, label: p, children: [] };
      属.children!.push(名);
    }
    名.children!.push(叶(c));
  }
  return 树;
}

/** id → 在树里的路径（Cascader 要整条路径）；两级树里叶子可能在第一列，所以按深度找 */
export function 路径(树: 节点[], id: string | null | undefined): string[] | undefined {
  if (!id) return undefined;
  for (const n of 树) {
    if (!n.children) {
      if (n.value === id) return [n.value];
      continue;
    }
    const 下 = 路径(n.children, id);
    if (下) return [n.value, ...下];
  }
  return undefined;
}

/** Cascader 交回来的路径 → 渠道 id；没点到最末一级（中间层带前缀）不算选中 */
export function 选中的渠道(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const 末 = String(v[v.length - 1]);
  return 末.startsWith(前缀.属性) || 末.startsWith(前缀.名称) ? null : 末;
}

export default function ChannelPicker({
  channels,
  value,
  onChange,
  allowClear = true,
  disabled,
  placeholder = "选渠道，或输入渠道全称搜",
  style,
  层级 = "两级",
  "aria-label": ariaLabel,
}: {
  channels: 可选渠道[];
  value?: string | null;
  onChange?: (id: string | null) => void;
  allowClear?: boolean;
  disabled?: boolean;
  placeholder?: string;
  style?: React.CSSProperties;
  层级?: 渠道层级;
  "aria-label"?: string;
}) {
  const 树 = useMemo(() => (层级 === "两级" ? 两级渠道树 : 渠道树)(channels, value), [channels, value, 层级]);
  const 当前 = useMemo(() => 路径(树, value), [树, value]);
  if (!有渠道可选(channels, value)) {
    return <div aria-label={ariaLabel} style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: "32px", ...style }}>{没渠道提示}</div>;
  }
  return (
    <Cascader<节点>
      aria-label={ariaLabel}
      style={{ width: "100%", ...style }}
      options={树}
      value={当前}
      allowClear={allowClear}
      disabled={disabled}
      placeholder={placeholder}
      expandTrigger="hover"
      notFoundContent="没有对得上的渠道"
      onChange={(v) => onChange?.(选中的渠道(v))}
      // 每列收窄、长名字一行省略、悬停看全（globals.css .chan-picker-pop；格子上也有 title）
      classNames={{ popup: { root: "chan-picker-pop" } }}
      // 框里只写全称：三级都写出来太长，全称里本来就带着渠道名称和来源
      displayRender={(labels, sel) => {
        const 叶 = sel?.[sel.length - 1] as 节点 | undefined;
        return <span title={叶?.全称}>{叶?.全称 ?? labels[labels.length - 1]}</span>;
      }}
      showSearch={{
        filter: (输入, path) => {
          const k = 输入.trim().toLowerCase();
          if (!k) return true;
          return path.some((n) => (n as 节点).label.toLowerCase().includes(k) || ((n as 节点).全称 ?? "").toLowerCase().includes(k));
        },
        // 搜出来的那一行写全称，比「属性 / 名称 / 来源」三段好认
        render: (_输入, path) => (path[path.length - 1] as 节点).全称 ?? path.map((n) => (n as 节点).label).join(" / "),
        limit: 50,
      }}
    />
  );
}

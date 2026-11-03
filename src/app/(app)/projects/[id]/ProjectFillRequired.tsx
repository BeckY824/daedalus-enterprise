"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Checkbox, Input, InputNumber, Select, Space, Tag } from "antd";
import DatePicker from "@/components/BusinessDatePicker";
import ChannelPicker from "@/components/ChannelPicker";
import AddressInput from "@/components/AddressInput";
import { 币种选项 } from "@/lib/currency";
import { 金额格式 } from "@/lib/money-input";
import { dayjs } from "@/lib/utils";
import { 企业客户级别, 企业级别说明 } from "@/lib/enterprise/customer-v2";
import { 暂未确认 } from "@/lib/enterprise/dict-kinds";
import { 必填叫法, type 必填项 } from "@/lib/project/required";
import { 项目名上限 } from "@/lib/project/wizard";
import { 成交需求上限 } from "@/lib/project/profile-rules";
import { 合同状态们, 痛点标注上限 } from "@/lib/project/proj-fields";
import type { 钱格值 } from "@/lib/project/inline-edit";
import {
  归类, 客户格, 初始草稿, 草稿问题, 草稿是空的, 现值不算的话, 这项的改动, 算窗口状态, 依次保存, 存完怎么走, 按目录排,
  type 地址草稿, 草稿值, 草稿们, 窗外去处, 窗里环境, 想怎么走, 填法,
} from "@/lib/project/required-fill";
import { 编辑项目, 改项目画像Action, 勾项目交付 } from "../actions";
import type { 项目详情 } from "./ProjectDetail";
import type { 联系人 } from "./ProjectTeam";

const 去处按钮: Record<窗外去处, string> = { 沟通: "新增沟通", 附件: "去项目附件", 回款: "去回款", 线索验证: "打开线索验证", 客户: "去客户页" };
const 灰字: CSSProperties = { color: "var(--text-muted)", fontSize: "var(--dt-aux, 12px)", overflowWrap: "anywhere" };
const 满宽: CSSProperties = { width: "100%" };

/** 框外的落点：滚到那块模块，收起着的先展开 */
export function 定位到模块(id: string) {
  // 等框关掉（解除滚动锁）再滚
  window.setTimeout(() => {
    const 壳 = document.getElementById(id);
    if (!壳) return;
    if (壳.classList.contains("is-closed")) 壳.querySelector<HTMLButtonElement>(":scope > .proj-fold-btn")?.click();
    壳.scrollIntoView({ block: "start", behavior: "smooth" });
  }, 60);
}

/**
 * 「完成节点」框（M-节点-05/09，11-03 一窗填完）：还差的必填直接摆输入，控件和页面上编辑这一项时一样；
 * 点一个按钮存齐并推进。存的逻辑在 lib/project/required-fill.ts，校验、权限都在原来的 action 里
 */
export function ProjectFillRequired({ p, 联系人们, 能就地改, 改不了话, 现在在, 能推进, 完成不了, 完成到字, 交付还差, 忙, on完成, on关, on去, 读草稿, 留草稿 }: {
  p: 项目详情;
  联系人们: 联系人[];
  能就地改: boolean;
  改不了话: string;
  现在在: string;
  /** 有下一步、没被别的关挡着（缺必填不算） */
  能推进: boolean;
  完成不了?: string;
  完成到字: string;
  /** 最后一个节点完成 = 交付结清：尾款结清、验收通过没勾的也列进来当场勾（11-03 A5-2），谁都不能缺着推 */
  交付还差?: string[];
  忙: boolean;
  on完成: () => void;
  on关: () => void;
  on去: (去: 窗外去处) => void;
  /** 关了框再回来（去记沟通、传附件）草稿还在：放在 ProjectDetail 上，按项目分开 */
  读草稿: () => 草稿们 | undefined;
  留草稿: (草稿: 草稿们) => void;
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [草稿, set草稿] = useState<草稿们>(() => 读草稿() ?? {});
  const [已存, set已存] = useState<string[]>([]);
  const [失败, set失败] = useState<Partial<Record<string, string>>>({});
  const [话, set话] = useState<string | null>(null);
  const [存着, set存着] = useState(false);
  const [刷新中, 开始刷新] = useTransition();
  /** 防连点；存完等页面刷新好（拿到新的还差）才推 */
  const 锁 = useRef(false);
  const 刷完要 = useRef<"推" | "强推" | null>(null);

  const 缺 = useMemo(() => {
    const 配的 = p.必填?.还差 ?? [];
    return [...配的, ...((交付还差 ?? []) as 必填项[]).filter((k) => !配的.includes(k))];
  }, [p.必填?.还差, 交付还差]);
  const 只能靠填齐 = !!p.必填?.只能靠填齐 || !!交付还差?.length;
  const 环: 窗里环境 = {
    能就地改,
    改不了话,
    只能看字段: p.只能看字段,
    渠道数: p.渠道们?.length,
    有所在地: !!p.所在地,
    有画像: !!p.画像,
    联系人数: 联系人们.length,
  };
  const 值 = (k: 必填项): 草稿值 | undefined => (k in 草稿 ? 草稿[k] : 初始草稿(k, p));
  // 存上的那几行留着打「已存上」，不然部分失败时人看不出哪些成了
  const 行们 = 按目录排([...缺, ...已存]);
  const 态 = 算窗口状态(行们, 环, 值, 已存, 能推进);
  const 占着 = 忙 || 存着 || 刷新中;
  const 能老板推 = 能推进 && !只能靠填齐;
  const 有格子 = 态.待存.length + 态.没填好.length > 0;

  const 改 = (k: 必填项, v: 草稿值) => {
    const 新 = { ...草稿, [k]: v };
    留草稿(新);
    set草稿(新);
    if (失败[k]) set失败({ ...失败, [k]: undefined });
  };

  // 存完的下一步要等页面刷新好再走：on完成 用的是最新的节点，尾款、验收刚勾上的也算数
  useEffect(() => {
    if (刷新中 || !刷完要.current) return;
    const 要 = 刷完要.current;
    刷完要.current = null;
    if (要 === "推" && 缺.length) {
      // 服务端读回来还差（比如别人同时改了）：说清楚留在框里，刚存的要是还差也能重填
      set已存((x) => x.filter((k) => !缺.includes(k as 必填项)));
      set话(`已保存，但系统里还差：${缺.map(必填叫法).join("、")}`);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 这一步只能等 router.refresh 的过渡结束，且 刷完要 只触发一次
    if (!能推进) return set话(完成不了 ?? "现在不能完成这个节点");
    on完成();
  }, [刷新中, 缺, 能推进, 完成不了, on完成]);

  const 走 = async (想: 想怎么走) => {
    if (锁.current) return;
    if (!态.待存.length) return 想 === "强推" ? on完成() : undefined;
    锁.current = true;
    set存着(true);
    set话(null);
    const 这批 = 态.待存;
    const 果 = await 依次保存(这批, async (k) => {
      const 改动 = 这项的改动(k, 值(k));
      if (!改动) return { ok: false, error: "这一项这里填不了" };
      if (改动.存 === "项目") return 编辑项目(p.id, 改动.改动);
      if (改动.存 === "画像") return 改项目画像Action(p.id, 改动.改动);
      return 勾项目交付(p.id, 改动.项, true);
    });
    const 留 = { ...草稿 };
    for (const k of 果.已存) delete 留[k];
    留草稿(留);
    set草稿(留);
    set已存((x) => [...x, ...果.已存]);
    set失败(果.失败);
    if (果.自动推到.length) message.success(`必填齐了，自动推进到 ${果.自动推到.join(" → ")}`);
    const 接着 = 存完怎么走(果, 想);
    const 失败几项 = Object.keys(果.失败).length;
    if (失败几项) set话(`${失败几项} 项没存上，看对应那一格的原因；其它的已存好，填的内容都在`);
    else if (接着 === "留窗") set话("已保存，剩下的填好再完成节点");
    锁.current = false;
    set存着(false);
    if (接着 === "关窗" && !失败几项) {
      on关();
      router.refresh();
      return;
    }
    if (接着 === "推" || 接着 === "强推") 刷完要.current = 接着;
    开始刷新(() => router.refresh());
  };

  /** 下拉、文本、数字、日期…和项目卡 / 编辑项目框里同一套控件 */
  const 控件 = (k: 必填项, 法: Exclude<填法, { 控件: "窗外" }>) => {
    const 名 = 必填叫法(k);
    const v = 值(k);
    const 字 = typeof v === "string" ? v : "";
    switch (法.控件) {
      case "钱": {
        const 钱 = v as 钱格值;
        return (
          <Space.Compact style={满宽}>
            <Select aria-label={`${名}币种`} style={{ width: 140, flexShrink: 0 }} options={币种选项()} showSearch optionFilterProp="label" value={钱.币} onChange={(币: string) => 改(k, { ...钱, 币 })} />
            <InputNumber<number> aria-label={名} style={满宽} min={0} formatter={金额格式} value={钱.数} onChange={(数) => 改(k, { ...钱, 数 })} />
          </Space.Compact>
        );
      }
      case "名称":
        return <Input aria-label={名} maxLength={项目名上限} value={字} onChange={(e) => 改(k, e.target.value)} />;
      case "需求描述":
        return <Input.TextArea aria-label={名} rows={2} maxLength={成交需求上限} placeholder="客户想买什么、要多少" value={字} onChange={(e) => 改(k, e.target.value)} />;
      case "痛点":
        return <Input.TextArea aria-label={名} rows={3} maxLength={痛点标注上限} placeholder="客户现在卡在哪、最着急解决什么" value={字} onChange={(e) => 改(k, e.target.value)} />;
      case "日期":
        return <DatePicker aria-label={名} style={满宽} placeholder="选一天" value={字 ? dayjs(字) : null} onChange={(d) => 改(k, d ? d.format("YYYY-MM-DD") : null)} />;
      case "级别":
        return <Select aria-label={名} style={满宽} allowClear placeholder="选级别" value={字 || undefined} options={企业客户级别.map((x) => ({ value: x, label: 企业级别说明[x] }))} onChange={(x?: string) => 改(k, x ?? null)} />;
      case "合同状态":
        return <Select aria-label={名} style={满宽} value={字 || undefined} placeholder="选合同状态" options={合同状态们.map((x) => ({ value: x, label: x }))} onChange={(x: string) => 改(k, x)} />;
      case "联系人":
        return <Select aria-label={名} style={满宽} allowClear placeholder="选联系人" value={字 || undefined} options={联系人们.map((c) => ({ value: c.id, label: c.position ? `${c.name} · ${c.position}` : c.name }))} onChange={(x?: string) => 改(k, x ?? null)} />;
      case "渠道":
        return <ChannelPicker aria-label={名} style={满宽} channels={p.渠道们 ?? []} value={字 || null} onChange={(x) => 改(k, x)} allowClear placeholder="选渠道" />;
      case "地址":
        return <AddressInput value={v as 地址草稿} onChange={(a) => 改(k, a)} />;
      case "画像单选": {
        const 项 = p.画像?.项们.find((x) => x.键 === 法.键);
        return <Select aria-label={名} style={满宽} allowClear showSearch optionFilterProp="label" placeholder={暂未确认} value={字 || undefined} options={(项?.选项 ?? []).map((x) => ({ value: x, label: x }))} onChange={(x?: string) => 改(k, x ?? null)} />;
      }
      case "画像多选": {
        const 项 = p.画像?.项们.find((x) => x.键 === "productNeeds");
        return <Select aria-label={名} style={满宽} mode="multiple" allowClear optionFilterProp="label" placeholder={暂未确认} value={Array.isArray(v) ? v : []} options={(项?.选项 ?? []).map((x) => ({ value: x, label: x }))} onChange={(x: string[]) => 改(k, x)} />;
      }
      case "勾":
        return <Checkbox checked={v === true} onChange={(e) => 改(k, e.target.checked)}>{名}</Checkbox>;
    }
  };

  // 几项都要去同一处（比如三项都靠记一条沟通）：按钮只摆在第一项上，后面的写「点上面的」（11-03 A6-5）
  const 首个去处 = new Map<窗外去处, string>();
  for (const k of 行们) {
    const 类 = 归类(k, 环);
    if (类.类 === "去" && 类.去 && !已存.includes(k) && !首个去处.has(类.去)) 首个去处.set(类.去, k);
  }
  const 窗外行 = (项: 必填项, 去: 窗外去处 | null, 原因: string) => {
    const 能去 = 去 === "沟通" ? p.能记沟通 : 去 === "附件" ? !!p.项目附件 : 去 === "回款" ? !!p.回款们 : 去 === "线索验证" ? !!p.线索验证 : 去 === "客户" ? !!p.customer : false;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px", minWidth: 0 }}>
        <span style={{ ...灰字, flex: "1 1 200px", minWidth: 0 }}>{原因}</span>
        {去 === "客户" && 能去 && p.customer && <Link href={`/customers/${p.customer.id}${客户格[项] ? `#field-${客户格[项]}` : ""}`}>{去处按钮.客户}</Link>}
        {去 && 去 !== "客户" && 能去 && (首个去处.get(去) === 项
          ? <Button size="small" disabled={占着} onClick={() => on去(去)}>{去处按钮[去]}</Button>
          : <span style={灰字}>点上面的「{去处按钮[去]}」一起补</span>)}
      </div>
    );
  };

  // 灰按钮要写为什么
  const 灰着话 = !缺.length || !能推进 || 态.能一键完成 ? null
    : 态.窗外们.length ? `${态.窗外们.map(必填叫法).join("、")} 这里填不了，处理完才能完成节点${能老板推 ? "，或点「仍要推进」" : ""}`
    : 态.没填好.length ? `还没填好：${态.没填好.map(必填叫法).join("、")}`
    : null;

  return (
    <div className="proj-modal-sec">
      <div><span className="proj-where-label">现在在</span> {现在在}</div>
      {缺.length ? (
        <Alert type="warning" showIcon message={只能靠填齐 ? "还差这些必填，补齐了才能完成这个节点" : "还差这些必填（你是总管理 / 销售管理，可以先推）"} />
      ) : (
        <Alert type="success" showIcon message={p.必填 ? "这个节点的必填都齐了，可以推进" : "这个节点没有配必填，可以推进"} />
      )}
      {行们.length > 0 && (
        <ul
          className="proj-miss-list"
          tabIndex={0}
          aria-label="还差的必填"
          style={{ listStyle: "none", margin: 0, padding: "0 4px 0 0", maxHeight: "min(40vh, 420px)", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}
        >
          {行们.map((k) => {
            const 类 = 归类(k, 环);
            const 存上了 = 已存.includes(k);
            const 项 = k as 必填项;
            const 问题 = 类.类 === "填" && !存上了 && !草稿是空的(项, 值(项)) ? 草稿问题(项, 值(项)) : null;
            const 现值话 = 类.类 === "填" && !存上了 ? 现值不算的话(项, p) : null;
            return (
              <li key={k} data-required={k} style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontWeight: 500, overflowWrap: "anywhere" }}>
                  {必填叫法(k)}
                  {存上了 && <Tag color="success" style={{ marginInlineStart: 8 }}>已存上</Tag>}
                </div>
                {!存上了 && (类.类 === "填" ? 控件(项, 类.法) : 窗外行(项, 类.去, 类.原因))}
                {现值话 && <div style={灰字}>{现值话}</div>}
                {问题 && <div style={灰字}>{问题}</div>}
                {失败[k] && <div className="proj-inline-err" role="alert">{失败[k]}</div>}
              </li>
            );
          })}
        </ul>
      )}
      {态.窗外们.some((k) => { const 类 = 归类(k, 环); return 类.类 === "去" && !!类.去; }) && (
        <div style={灰字}>填过的内容会留着，处理完回来再点「完成节点」；要离开这个项目页先保存</div>
      )}
      {完成不了 && <div style={{ color: "var(--text-muted)" }}>{完成不了}</div>}
      {完成到字 && <div><span className="proj-where-label">完成后</span> {完成到字}</div>}
      {话 && <div role="status" style={{ overflowWrap: "anywhere" }}>{话}</div>}
      {/* 按钮这一排贴在框底（11-03 A6-5）：缺得多、窗口矮时不用先滚到底才看得到 */}
      <div className="proj-fill-foot">
      <Space wrap>
        {!!缺.length && 有格子 && 能推进 && (
          <Button type="primary" disabled={占着 || !态.能一键完成} loading={存着} onClick={() => 走("推")}>保存并完成节点</Button>
        )}
        {!!缺.length && !态.能一键完成 && 态.待存.length > 0 && (
          <Button disabled={占着} onClick={() => 走("只存")}>先保存已填的</Button>
        )}
        {!!缺.length && 能老板推 && (
          <Button type={有格子 ? "default" : "primary"} disabled={占着} onClick={() => 走("强推")}>仍要推进</Button>
        )}
        {!缺.length && 能推进 && <Button type="primary" disabled={占着} onClick={on完成}>确认推进</Button>}
        <Button onClick={on关}>取消</Button>
      </Space>
      {灰着话 && <div style={{ ...灰字, marginTop: 4 }}>{灰着话}</div>}
      </div>
    </div>
  );
}

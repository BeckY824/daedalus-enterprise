"use client";
import Shortcut from "./Shortcut";
import { 交给首页问 } from "@/lib/home-ask";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useBusiness } from "@/lib/business-client";
import { 换一位 } from "@/lib/roster";
import { 公海入口 } from "@/lib/enterprise/nav";
// 只引类型：搜索动作由 layout（服务端）当 prop 传进来，客户端包里不带服务端代码
import type { 全局搜索结果 } from "@/app/(app)/global-search";

/**
 * ⌘K。
 *
 * 一个键管两件事：**跳到哪一页**，和**问一句**。
 *   首页有问答框时，⌘K 就是把光标放回那个框——
 *   在那儿 ⌘K 的意思已经是「我要打字了」，再弹一个浮层等于多一步。
 *   其余页面 ⌘K 打开这张单子：打字筛页面，回车跳过去；
 *   一个页面都没匹配上时，第一条变成「问一句」，回车带着这句话去首页问。
 *
 * 快捷键要能被发现：左栏底部常驻一行「⌘K 跳转 / 提问」，这张单子底下也写着。
 * 藏起来的快捷键等于不存在。
 *
 * 企业版项目模式（U-项目-04 全局搜索）：打两个字以上，页面下面接着出客户、项目、联系人，
 * 范围按角色走（global-search.ts，服务端 加上限定），回车 / 点一下进详情；三组都没搜到、页面也没对上才当问题。
 */
/** 焦点在输入框 / 文本域 / 可编辑区里。⌘N 这类「页面级」快捷键那时不该接管 */
function 在输入框里(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

export default function CommandBar({ 有AI, 企业版项目 = false, 全局搜索 }: { 有AI: boolean; 企业版项目?: boolean; 全局搜索?: (q: string) => Promise<全局搜索结果> }) {
  const router = useRouter();
  const b = useBusiness();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);

  const 页面 = useMemo(
    () => 企业版项目
      ? [
          // 企业版项目模式（10-29）：先是左栏那六个根目录，同一个顺序（lib/enterprise/nav.ts）；
          // 不进左栏的新线索、联系人、跟进照样搜得到，路由都在
          { 名: "首页", 去: "/dashboard", 说明: "问一句，或看今天要跟谁" },
          { 名: "复盘", 去: "/overview", 说明: "复盘：现在 / 本月 / 本年" },
          { 名: "渠道", 去: "/channels", 说明: "外部推荐来源" },
          { 名: "公海", 去: 公海入口, 说明: `没人跟的${b.customer}，谁都能领` },
          { 名: b.customer, 去: "/customers", 说明: "全部档案与跟进" },
          { 名: "项目", 去: "/projects", 说明: "线索、商机、订单三个阶段" },
          { 名: "新线索", 去: "/leads", 说明: "还没建档的人" },
          { 名: "联系人", 去: "/contacts", 说明: "客户那边对接的人" },
          { 名: "沟通记录", 去: "/follow-ups", 说明: "已经发生的沟通" },
          { 名: "跟进计划", 去: "/follow-ups/plans", 说明: "排好还没做的" },
          { 名: "设置", 去: "/settings", 说明: "账号、密码、AI 接入、业务配置" },
        ]
      : [
      { 名: "首页", 去: "/dashboard", 说明: "问一句，或看今天要跟谁" },
      { 名: "数据", 去: "/overview", 说明: "现在 / 本月 / 本年" },
      { 名: "线索", 去: "/leads", 说明: "还没建档的人" },
      { 名: b.customer, 去: "/customers", 说明: "全部档案与跟进" },
      { 名: "渠道", 去: "/channels", 说明: "外部推荐来源" },
      { 名: "联系人", 去: "/contacts", 说明: b.fields.school === "院校" ? "家长、老师、经办人" : "客户那边对接的人" },
      // 企业版只用项目（10-26）；商机两项（/opportunities 一律转到 /projects）和外贸订单 10-28 删了，和左栏一致
      ...(b.projectMode ? [{ 名: "项目", 去: "/projects", 说明: "线索、商机、订单三个阶段" }] : []),
      { 名: "跟进记录", 去: "/follow-ups", 说明: "已经发生的沟通" },
      { 名: "跟进计划", 去: "/follow-ups/plans", 说明: "排好还没做的" },
      { 名: "设置", 去: "/settings", 说明: "账号、密码、AI 接入、业务配置" },
        ],
    [b, 企业版项目],
  );

  const 命中 = useMemo(() => {
    const k = q.trim();
    if (!k) return 页面;
    return 页面.filter((p) => p.名.includes(k) || p.说明.includes(k));
  }, [q, 页面]);

  /** 一个页面都没匹配上：那这句话多半是个问题，不是页面名 */
  // 搜到的结果带着当时的词：词对得上才算数，对不上就是「还在搜」（不在 effect 里同步清状态）
  const [搜到, set搜到] = useState<{ 词: string; r: 全局搜索结果 | null } | null>(null);
  const 词 = q.trim();
  const 要搜 = 企业版项目 && !!全局搜索 && open && 词.length >= 2;
  const 数据 = 要搜 && 搜到?.词 === 词 ? 搜到.r : null;
  const 搜着 = 要搜 && 搜到?.词 !== 词;
  const 第几次 = useRef(0);
  useEffect(() => {
    if (!要搜) return;
    const 这次 = ++第几次.current;
    // 停手 250ms 再搜，打字时不连发；回来晚了的（已经又改了字）不认
    const t = setTimeout(() => {
      全局搜索?.(词)
        .then((r) => { if (这次 === 第几次.current) set搜到({ 词, r }); })
        .catch(() => { if (这次 === 第几次.current) set搜到({ 词, r: null }); });
    }, 250);
    return () => clearTimeout(t);
  }, [要搜, 词, 全局搜索]);

  /** 页面在前，搜到的客户 / 项目 / 联系人接在后面；上下键在这一整串里走 */
  const 行们 = useMemo(() => {
    const 页 = 命中.map((p) => ({ key: `页:${p.去}`, 名: p.名, 说明: p.说明, 去: p.去, 组: "" }));
    if (!要搜 || !数据) return 页;
    const 组 = (名: string, xs: 全局搜索结果["客户"]) => xs.map((x) => ({ key: `${名}:${x.id}`, 名: x.name, 说明: x.附注 ?? "", 去: x.去, 组: 名 }));
    return [...页, ...组(b.customer, 数据.客户), ...组("项目", 数据.项目), ...组("联系人", 数据.联系人)];
  }, [命中, 数据, 要搜, b.customer]);

  const 当问题 = 词.length >= 2 && 行们.length === 0 && !搜着;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      /*
        ⌘N：在当前页新建。它不知道每一页的新建长什么样，也不需要知道——
        页头右上角那个主按钮就是这一页的主动作（见 ui.tsx 的 PageHead），点它就是。
        页头上没有主按钮的页面（首页、数据）什么也不发生，这比弹一个「本页不支持」强。
        在输入框里打字时不接管：那时 ⌘N 该由浏览器或输入法处理。
      */
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n" && !在输入框里(e)) {
        const 主按钮 = document.querySelector<HTMLButtonElement>(".page-head-a button.ant-btn-primary:not([disabled])");
        if (主按钮) {
          e.preventDefault();
          主按钮.click();
        }
        return;
      }
      if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) return;
      e.preventDefault();
      /*
        这一页**自己**有问答框就把光标给它——那才是这一页的主动作。
        「自己的」要当真：0.38 起右边那块全局 AI 面板在每一页都摆了一个同款输入框，
        不排除它的话 ⌘K 在任何页面都只会去聚焦面板，跳转单再也弹不出来。
        ⌘K 和 ⌘J 是两件事：一个是「去哪儿 / 问一句」，一个是那块面板。
      */
      const 框 = [...document.querySelectorAll<HTMLTextAreaElement>(".cli-input textarea")].find((el) => !el.closest(".dock"));
      if (框 && !open) {
        框.focus();
        框.select();
        return;
      }
      // 记录页上 ⌘K 是「换一位」：名单登记过就交给它，不再和跳转单一起响（审查 M8）
      if (!open && 换一位()) return;
      setOpen((v) => !v);
      setQ("");
      setIdx(0);
    };
    window.addEventListener("keydown", onKey);
    // 左栏顶上那个搜索框点了：直接开跳转单（不走 ⌘K 那套「先给页内输入框」的分流——点的就是它）
    const onOpen = () => {
      setOpen(true);
      setQ("");
      setIdx(0);
    };
    window.addEventListener("cmdbar:open", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("cmdbar:open", onOpen);
    };
  }, [open]);

  function 走(i = idx) {
    if (当问题) {
      if (!有AI) return;
      // 带着问题去首页问：答案、过程、建议卡都在那儿，不在一个浮层里
      // 先说一声「这句是我交过去的」：首页只自动发本应用交过去的，外面来的链接只填进框里（J-158）
      交给首页问(q);
      router.push(`/dashboard?q=${encodeURIComponent(q.trim())}`);
    } else {
      const p = 行们[i];
      if (!p) return;
      router.push(p.去);
    }
    setOpen(false);
  }

  return (
    <Modal open={open} onCancel={() => setOpen(false)} footer={null} closable={false} width={520} styles={{ body: { padding: 0 } }}>
      <div className="cmdk">
        <div className="cmdk-in">
          <SearchOutlined />
          <input
            autoFocus
            value={q}
            placeholder={企业版项目 ? `跳到哪一页，搜${b.customer} / 项目 / 联系人，或者问一句` : "跳到哪一页，或者直接问一句"}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx((i) => (i + 1) % Math.max(1, 行们.length));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx((i) => (i <= 0 ? 行们.length - 1 : i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                走();
              } else if (e.key === "Escape") {
                // 标记成「处理过了」：底下首页那句「Esc 打断回答」看到它就不再接（lib/esc.ts）
                e.preventDefault();
                setOpen(false);
              }
            }}
          />
        </div>
        <div className="cmdk-list">
          {当问题 ? (
            <button type="button" className="cmdk-row cmdk-row-on" disabled={!有AI} onClick={() => 走()}>
              <b>{有AI ? "问一句" : "尚未接入 AI"}</b>
              <span>{有AI ? `「${q.trim()}」——去首页问，它会读完记录再答` : "问题保留在输入框中。启用 AI 接入后，可以在这里继续提问。"}</span>
            </button>
          ) : (
            <>
              {行们.map((p, i) => (
                <div key={p.key} className="cmdk-item">
                  {p.组 && p.组 !== 行们[i - 1]?.组 && <div className="cmdk-sec">{p.组}</div>}
                  <button type="button" className={`cmdk-row${i === idx ? " cmdk-row-on" : ""}${p.组 ? " cmdk-hit" : ""}`} title={p.组 ? p.名 : undefined} onClick={() => 走(i)} onMouseEnter={() => setIdx(i)}>
                    <b>{p.名}</b>
                    <span>{p.说明}</span>
                  </button>
                </div>
              ))}
              {要搜 && 搜着 && <div className="cmdk-sec">正在搜{b.customer}、项目、联系人…</div>}
            </>
          )}
        </div>
        <div className="cmdk-foot">
          <kbd>↑↓</kbd> 选 · <kbd>↵</kbd> 去 · <kbd>Esc</kbd> 关 · 首页有问答框时 <kbd><Shortcut>⌘K</Shortcut></kbd> 回到输入框，在{b.customer}记录页换一位，其余页面打开跳转单
        </div>
      </div>
    </Modal>
  );
}

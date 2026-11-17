"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, Input, Modal } from "antd";
import { RightOutlined, SearchOutlined } from "@ant-design/icons";
import dynamic from "next/dynamic";
import { useBusiness } from "@/lib/business-client";
import type { 可选成员 } from "@/lib/utils";
import { 取建档数据 } from "./new/wizard-actions";
import type { 建档数据, 项目开关 } from "./new/ProjectWizard";
import { 搜客户, type 可挑客户 } from "../customers/[id]/pick";
import { 动作出错话 } from "@/lib/stale-deploy";

/** 「新增项目」→「新客户」的建档向导框：点了才加载，不压首屏 JS（同客户页「新增客户」） */
const 建档弹窗 = dynamic(() => import("./new/ProjectWizard").then((m) => m.建档弹窗), { ssr: false });

type 选项 = {
  users: 可选成员[];
  /** 「给老客户开项目」新建框里线索阶段的节点（字典里的） */
  节点们: readonly string[];
  /** 企业版开了超时回收：首条沟通要填下一步时间 */
  要下一步: boolean;
  /** 服务端已经给了向导要的数据（客户页）：「新客户」不再取一次；不给 = 点了再取（项目页） */
  建档?: 建档数据 | null;
  /** 一挂上就把「新增项目」选新老客户那个框打开（客户页「新建 ▾ → 新建项目」点了才挂这一块） */
  起手开着?: boolean;
};

/** 建档向导框的标题：「新线索」= 新线索页的新建（项目开关开着锁住，原 /leads/new 整页，11-15 删了） */
type 建档标题 = "新增项目" | "新增客户" | "新线索";

/**
 * 企业版「新增项目」整条路（11-01 用户：「也是弹窗进行……打开新增的时候给一个选项新客户还是老客户」）：
 * 先问新客户还是老客户，两样都进同一个新建弹窗（PR8）：新客户先查重；老客户（原型 pr.old）点了这一项原地变成搜索框
 * （「新客户」那项收起），挑中一位就进新建弹窗、客户段已经收成那一位，接着填项目和首条沟通——一个框走到底，不再三个框接力。
 * 项目页 / 市场角色「我分出去的」（ProjectsView）和客户页页头「新建 ▾」（CustomersView）共用这一份。
 * 开建档("新增客户")：市场角色「我分出去的」页头的「新建客户」，和客户页「新建客户」同一个向导框
 */
export function useNewProjectFlow({ 建档: 给的 = null, 起手开着 = false }: 选项): { 开选客户: () => void; 开建档: (标题: 建档标题, 项目?: 项目开关) => Promise<void>; 弹框: ReactNode; 取档中: boolean } {
  /*
    焦点从哪来就回哪去：这条路开第一个框时有焦点的那个元素（「新建」按钮，NewMenuButton 点菜单项前先把焦点放回它）。
    antd Modal 关掉时把焦点还给它打开那一刻有焦点的元素；框接框（选新老客户 → 建档向导 / 挑老客户 → 新建项目框）时，
    开下一个框之前先把焦点放回起点，最后一个框关了焦点就回到「新建」，不掉到页面最上面。懒加载那份一挂上就开（起手开着），起点在挂上时记
  */
  const 起点 = useRef<HTMLElement | null>(起手开着 && typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null);
  const 记起点 = () => { if (typeof document !== "undefined") 起点.current = document.activeElement as HTMLElement | null; };
  const 回起点 = () => { const el = 起点.current; if (el?.isConnected) el.focus({ preventScroll: true }); };
  /*
    光靠 Modal 自己还焦点不够（11-12 复审实测）：框接框时下一个框开的那一刻，焦点被上一个框的焦点锁拉回框内，
    它记下的「打开前的焦点」是上一个框里的按钮，关掉时还给一个已经没了的元素，焦点掉到 body。
    所以每个框关的动画走完（afterClose）再看一眼：这条路上已经没有开着的框了，就把焦点放回起点
  */
  const 链开 = useRef(false);
  const 收尾 = () => { if (!链开.current) 回起点(); };
  const b = useBusiness();
  const [选客户, set选客户] = useState(起手开着);
  const [建档, set建档] = useState<建档数据 | null>(给的);
  const [建档开着, set建档开着] = useState(false);
  const [标题, set标题] = useState<建档标题>("新增项目");
  /** 项目开关：不给 = 开（新增项目）；新线索、团队版「新建项目」锁开（原整页建档的口径） */
  const [开关, set开关] = useState<项目开关 | undefined>(undefined);
  const [取档中, set取档中] = useState(false);
  /**
   * 没打开建档框的原因：从选新老客户框里点的，写在那个框里（role=alert，原型 g.notice 不弹顶部提示）；
   * 从「新建 ▾」直接开的没有框可写，才退回顶部提示——报错不能吞
   */
  const [开档错, set开档错] = useState("");
  /**
   * 从「新建 ▾」直接开、没开成（项目模式没开、没取到）：没有选新老客户的框可写，就把要开的那个框照样打开、
   * 框里只写为什么开不了（role=alert）——人点了「新建客户」，看到的就是那个框和原因，不弹顶部提示、报错也不吞
   */
  const [直开错, set直开错] = useState<{ 标题: 建档标题; 话: string } | null>(null);
  /** 原型 pr.old：选新老客户框里点了「老客户」，那一项原地变搜索框 */
  const [挑老, set挑老] = useState(false);
  const [老词, set老词] = useState("");
  /** 搜到的，记着是哪个词搜的：和现在框里的词对得上才摆（对不上 = 正在搜） */
  const [老搜到, set老搜到] = useState<{ 词: string; 们: 可挑客户[] } | null>(null);
  const 老们 = 挑老 && 老搜到 && 老搜到.词 === 老词.trim() ? 老搜到.们 : null;
  /** 挑中的老客户：带进新建弹窗，客户段直接收成这一位（ProjectWizard 老客户起手） */
  const [老客户, set老客户] = useState<可挑客户 | null>(null);
  const 老结果 = useRef<HTMLDivElement>(null);
  // 一边打一边搜（停 300ms，晚回来的旧结果丢掉）；没打字给最近跟进过的几位（搜客户 同客户页挑人）
  useEffect(() => {
    if (!挑老) return;
    let 作废 = false;
    const 词 = 老词.trim();
    const t = setTimeout(() => {
      搜客户(词).then((r) => { if (!作废) set老搜到({ 词, 们: r }); }, () => { if (!作废) { set老搜到({ 词, 们: [] }); set开档错("没搜到，请重试"); } });
    }, 词 ? 300 : 0);
    return () => { 作废 = true; clearTimeout(t); };
  }, [挑老, 老词]);
  const 关选框 = () => { set选客户(false); };
  /** 选框关了（或重新打开）：老客户那一项复原 */
  const 复原选框 = () => { set挑老(false); set老词(""); set老搜到(null); set开档错(""); };
  const 报开档错 = (t: 建档标题, 话: string) => (选客户 ? set开档错(话) : set直开错({ 标题: t, 话 }));
  const 开建档 = async (t: 建档标题, 项目?: 项目开关, 老?: 可挑客户) => {
    // 从「新建 ▾」直接开（市场角色「新建客户」）：起点就是那颗按钮；从选新老客户框里点进来：起点早记好了，先把焦点放回去
    if (选客户) 回起点(); else 记起点();
    set取档中(true);
    set开档错("");
    try {
      const d = 建档 ?? 给的 ?? (await 取建档数据());
      // 按这一下要做的事说：「新建客户」点的说不能新增客户，别说成不能新增项目
      if (!d) return void 报开档错(t, t === "新增客户" ? `项目模式没开，不能新增${b.customer}` : "项目模式没开，不能新增项目");
      set建档(d);
      set老客户(老 ?? null);
      set选客户(false);
      set标题(t);
      set开关(项目);
      set建档开着(true);
    } catch (出错) {
      报开档错(t, 动作出错话(出错, "没打开，请重试"));
    } finally {
      set取档中(false);
    }
  };
  // 原型 pr.new：框一开「新客户」就是默认那一项（亮着、焦点在它上面），回车即走；框从点的那颗按钮处长出（antd 弹框按点击处放大）
  const 新客户钮 = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { 链开.current = 选客户 || 建档开着 || !!直开错; });
  /** 搜索框里：↓ 到第一位，回车直接挑第一位；结果里 ↑↓ 挪、到顶再 ↑ 回搜索框 */
  const 搜框键 = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); 老结果.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
    else if (e.key === "Enter" && 老们?.length) { e.preventDefault(); void 开建档("新增项目", undefined, 老们[0]); }
  };
  const 结果键 = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const 们 = [...(老结果.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = 们.indexOf(document.activeElement as HTMLButtonElement);
    const 下 = e.key === "ArrowDown" ? 们[Math.min(i + 1, 们.length - 1)] : i > 0 ? 们[i - 1] : null;
    if (下) 下.focus();
    else 老结果.current?.parentElement?.querySelector<HTMLInputElement>("input")?.focus();
  };
  const 弹框 = (
    <>
      <Modal open={选客户} title="新增项目" footer={null} width={420} onCancel={关选框} afterClose={() => { 复原选框(); 收尾(); }} afterOpenChange={(开) => { if (开) 新客户钮.current?.focus(); }} destroyOnHidden>
        <div className="new-proj-pick">
          {!挑老 && (
            <button ref={新客户钮} type="button" className="new-proj-opt is-default" disabled={取档中} onClick={() => void 开建档("新增项目")}>
              <两行 名={`新${b.customer}`} 说={`一起建好${b.customer}、联系人和首条沟通，号码先查重`} />
              <RightOutlined aria-hidden />
            </button>
          )}
          {挑老 ? (
            <div className="new-proj-opt pj-old-pick">
              <两行 名={`老${b.customer}`} 说={`选一位已有的${b.customer}，接着填项目和首条沟通`} />
              <Input
                autoFocus
                allowClear
                prefix={<SearchOutlined aria-hidden />}
                aria-label={`搜老${b.customer}`}
                placeholder={`搜${b.customer}名 / 号码`}
                value={老词}
                onChange={(e) => { set开档错(""); set老词(e.target.value); }}
                onKeyDown={搜框键}
              />
              <div className="pj-old-res" ref={老结果} onKeyDown={结果键} aria-busy={老们 === null} aria-label={`搜到的${b.customer}`}>
                {老们 === null ? <div className="pj-old-none" role="status">正在搜…</div>
                  : !老们.length ? <div className="pj-old-none" role="status">{老词.trim() ? `没搜到这位${b.customer}，换个字再搜，或者建新${b.customer}` : `还没有${b.customer}，建新${b.customer}吧`}</div>
                  : 老们.map((c) => (
                    <button key={c.id} type="button" className="pj-old-it" disabled={取档中} onClick={() => void 开建档("新增项目", undefined, c)}>
                      <span className="pj-old-name" title={c.name}>{c.name}</span>
                      {c.附注 && <span className="pj-old-sub" title={c.附注}>{c.附注}</span>}
                    </button>
                  ))}
              </div>
              <Button type="link" size="small" className="pj-old-back" onClick={() => { 复原选框(); requestAnimationFrame(() => 新客户钮.current?.focus()); }}>不是老{b.customer}，建新{b.customer}</Button>
            </div>
          ) : (
            <button type="button" className="new-proj-opt" disabled={取档中} onClick={() => { set开档错(""); set挑老(true); }}>
              <两行 名={`老${b.customer}`} 说={`搜到已有的${b.customer}，同一个框接着填项目和首条沟通`} />
              <RightOutlined aria-hidden />
            </button>
          )}
        </div>
        {开档错 && <div role="alert" className="csq-err">{开档错}</div>}
      </Modal>
      {建档 && <建档弹窗 open={建档开着} 标题={标题} 项目={开关} 数据={建档} 老客户={老客户} onClose={() => set建档开着(false)} afterClose={收尾} />}
      <Modal open={!!直开错} title={直开错?.标题} footer={null} width={420} onCancel={() => set直开错(null)} afterClose={收尾} destroyOnHidden>
        <div role="alert" className="csq-err">{直开错?.话}</div>
      </Modal>
    </>
  );
  return { 开选客户: () => { 记起点(); 复原选框(); set选客户(true); }, 开建档: (t, 项目) => 开建档(t, 项目), 弹框, 取档中 };
}

/** 客户页按需挂的那一份（next/dynamic 懒加载）：挂上就打开选新老客户的框；再点一次由外面换 key 重挂 */
export default function NewProjectFlow(p: Omit<选项, "起手开着">) {
  return useNewProjectFlow({ ...p, 起手开着: true }).弹框;
}

/** 「新增项目」选项里的一项：名字 + 一行小字说明 */
function 两行({ 名, 说 }: { 名: string; 说: string }) {
  return (
    <div className="new-proj-opt-t">
      <div>{名}</div>
      <div className="new-proj-opt-s">{说}</div>
    </div>
  );
}

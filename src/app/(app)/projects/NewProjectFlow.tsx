"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { App, Modal } from "antd";
import { RightOutlined } from "@ant-design/icons";
import dynamic from "next/dynamic";
import { useBusiness } from "@/lib/business-client";
import type { 可选成员 } from "@/lib/utils";
import { 取建档数据 } from "./new/wizard-actions";
import type { 建档数据, 项目开关 } from "./new/ProjectWizard";

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
 * 先问新客户还是老客户，两样都进同一个新建弹窗（PR8）：新客户先查重；老客户在客户名里搜到、挑中后接着填项目和首条沟通（原型 pr.old / cr.old，11-15 起不再三个框接力）。
 * 项目页 / 市场角色「我分出去的」（ProjectsView）和客户页页头「新建 ▾」（CustomersView）共用这一份。
 * 开建档("新增客户")：市场角色「我分出去的」页头的「新建客户」，和客户页「新建客户」同一个向导框
 */
export function useNewProjectFlow({ 建档: 给的 = null, 起手开着 = false }: 选项): { 开选客户: () => void; 开建档: (标题: 建档标题, 项目?: 项目开关) => Promise<void>; 弹框: ReactNode; 取档中: boolean } {
  const { message } = App.useApp();
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
  const 开建档 = async (t: 建档标题, 项目?: 项目开关) => {
    // 从「新建 ▾」直接开（市场角色「新建客户」）：起点就是那颗按钮；从选新老客户框里点进来：起点早记好了，先把焦点放回去
    if (选客户) 回起点(); else 记起点();
    set取档中(true);
    try {
      const d = 建档 ?? 给的 ?? (await 取建档数据());
      // 按这一下要做的事说：「新建客户」点的说不能新增客户，别说成不能新增项目
      if (!d) return void message.error(t === "新增客户" ? `项目模式没开，不能新增${b.customer}` : "项目模式没开，不能新增项目");
      set建档(d);
      set选客户(false);
      set标题(t);
      set开关(项目);
      set建档开着(true);
    } catch {
      message.error("没打开，请重试");
    } finally {
      set取档中(false);
    }
  };
  // 原型 pr.new：框一开「新客户」就是默认那一项（亮着、焦点在它上面），回车即走；框从点的那颗按钮处长出（antd 弹框按点击处放大）
  const 新客户钮 = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { 链开.current = 选客户 || 建档开着; });
  const 弹框 = (
    <>
      <Modal open={选客户} title="新增项目" footer={null} width={420} onCancel={() => set选客户(false)} afterClose={收尾} afterOpenChange={(开) => { if (开) 新客户钮.current?.focus(); }} destroyOnHidden>
        <div className="new-proj-pick">
          <button ref={新客户钮} type="button" className="new-proj-opt is-default" disabled={取档中} onClick={() => void 开建档("新增项目")}>
            <两行 名={`新${b.customer}`} 说={`一起建好${b.customer}、联系人和首条沟通，号码先查重`} />
            <RightOutlined aria-hidden />
          </button>
          <button type="button" className="new-proj-opt" disabled={取档中} onClick={() => void 开建档("新增项目")}>
            <两行 名={`老${b.customer}`} 说={`在${b.customer}名里搜到已有的${b.customer}，同一个框接着填项目和首条沟通`} />
            <RightOutlined aria-hidden />
          </button>
        </div>
      </Modal>
      {建档 && <建档弹窗 open={建档开着} 标题={标题} 项目={开关} 数据={建档} onClose={() => set建档开着(false)} afterClose={收尾} />}
    </>
  );
  return { 开选客户: () => { 记起点(); set选客户(true); }, 开建档, 弹框, 取档中 };
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

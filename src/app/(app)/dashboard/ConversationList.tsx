"use client";

import { dayjs } from "@/lib/utils";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Drawer, Dropdown, Input, Modal } from "antd";
import { PlusOutlined, MoreOutlined } from "@ant-design/icons";
import { 新起一屏, 当前对话, 首页屏, useThread, useConversationId } from "@/lib/home-thread";
import { 占位标题 } from "./home-look";
import { 重命名对话, type 对话概要 } from "./threads";
import { useDeleteChat } from "./use-delete-chat";
import { useIsNowSkin } from "@/lib/use-skin";
import WidthHandle, { 对话列表把手 } from "@/components/WidthHandle";
import PaneToggle from "@/components/PaneToggle";
import { useMiddlePane, usePaneShortcut } from "@/lib/middle-pane";
import { 设抽屉 } from "@/lib/roster";
import { useViewAs } from "@/components/ViewAsContext";
import { 视图AI对话话 } from "@/lib/enterprise/view-as-words";

/**
 * 首页中栏：问过的对话。
 *
 * 在这之前首页那串问答只活在内存里，刷新即清，也开不出第二个——
 * 想把「这个月的回款」和「张三这条线怎么接」分开谈，只能两件事串在同一屏里。
 *
 * **只有自己看得见**（列表由服务端按 ownerId 查，见 threads.ts）。
 * 按最后一次提问倒序，分成今天 / 昨天 / 更早三组：找一条老对话时，
 * 人记得的是「前几天问过」，不是它叫什么名字。
 *
 * 不做的：搜索、置顶的界面、拖进项目。列表短的时候它们都是噪音，
 * 等一屏装不下再说（表结构里 pinnedAt / projectId 已经留好了）。
 */
export default function ConversationList({ rows }: { rows: 对话概要[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [删, 后果框] = useDeleteChat();
  /** 改名没改成：原因写在改名框里，框不关（g.save，不弹顶部提示） */
  const [改名错, set改名错] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  /** 正在改名的那条。null = 没有 */
  const [改名, set改名] = useState<{ id: string; title: string } | null>(null);

  const 选中 = sp.get("c") ?? 当前对话(首页屏) ?? "";
  /*
    home.threads：点了「新建对话」或这一屏问了第一句、还没落库，列表顶上先占一行（标题 = 第一句截断，和落库同一截法）；
    答完落库、router.refresh 带回真行、对话 id 认领上，占位自己让位
  */
  const 屏 = useThread(首页屏);
  const 屏对话 = useConversationId(首页屏);
  const [刚新建, set刚新建] = useState(false);
  const 占位 = 占位标题({ 第一句: 屏[0]?.question, 对话id: 屏对话, 刚新建, 看着老对话: !!sp.get("c") });
  // 收起 / 太窄时成抽屉（lib/middle-pane.ts）。抽屉里点了一条就关上：打开它就是为了换一条
  const 中栏 = useMiddlePane("chat");
  usePaneShortcut(中栏.切换);
  const 关抽屉 = () => 设抽屉("chat", false);

  function 新建() {
    关抽屉();
    set刚新建(true);
    新起一屏(首页屏);
    router.push("/dashboard");
  }

  function 打开(id: string) {
    关抽屉();
    if (id === 选中) return;
    router.push(`/dashboard?c=${id}`);
  }

  async function 存名字() {
    if (!改名) return;
    const r = await 重命名对话(改名.id, 改名.title);
    if (!r.ok) return void set改名错("改不了这条对话");
    set改名错(null);
    set改名(null);
    startTransition(() => router.refresh());
  }

  const 组 = 分组(rows);
  /*
    设计语言 HC-1（用户 11-22 选 C1：同名的列表里带时间）：标题取第一句前 18 字，同一句问几次就几条同名；
    同名的行尾带上次问的时间（今天 / 昨天写钟点，更早写月-日），不多调模型起名。只现状主题，换皮主题照旧
  */
  const 现状 = useIsNowSkin();
  const 同名 = 现状 ? 重名(rows) : null;
  /** 切换视图：服务端已回空（threads.ts），这里说一句为什么是空的 */
  const 视图中 = useViewAs();

  const 内容 = (
    <>
      <div className="pane-h">
        <span className="pane-t">
          对话
          {rows.length > 0 && <span className="pane-n">{rows.length}</span>}
        </span>
        <PaneToggle 栏="chat" 位置="中栏" />
      </div>

      <div className="pane-rows">
        {/* 一整行，图标带着字。页头上一颗光秃秃的加号没人认得出它是「新建对话」 */}
        <button type="button" className="chat-new" onClick={新建}>
          <PlusOutlined />
          新建对话
        </button>
        {视图中 ? (
          <div className="pane-empty">{视图AI对话话}</div>
        ) : rows.length === 0 && !占位 ? (
          <div className="pane-empty">还没有问过什么。在右边问一句，这里就会留下一条。</div>
        ) : (
          <>
          {占位 && (
            <div className="chat-row on chat-row-new" aria-current="true">
              <span className="chat-row-b" title={占位}>{占位}</span>
            </div>
          )}
          {组.map(([名, 条目]) =>
            条目.length === 0 ? null : (
              <section key={名} className="chat-g">
                <div className="chat-g-h">{名}</div>
                {条目.map((c) => (
                  <div key={c.id} className={`chat-row${c.id === 选中 ? " on" : ""}`}>
                    <button type="button" className="chat-row-b" onClick={() => 打开(c.id)} title={c.title}>
                      {同名?.has(c.title) ? (
                        <>
                          <span className="chat-row-n">{c.title}</span>
                          <span className="chat-row-tm">{短时间(c.lastAskedAt)}</span>
                        </>
                      ) : (
                        c.title
                      )}
                    </button>
                    <Dropdown
                      trigger={["click"]}
                      menu={{
                        items: [
                          { key: "rename", label: "重命名" },
                          { key: "delete", label: "删掉", danger: true },
                        ],
                        onClick: ({ key }) => (key === "rename" ? set改名({ id: c.id, title: c.title }) : 删({ id: c.id, title: c.title, 条数: c.条数 })),
                      }}
                    >
                      <button type="button" className="chat-row-m" aria-label={`${c.title} 的操作`}>
                        <MoreOutlined />
                      </button>
                    </Dropdown>
                  </div>
                ))}
              </section>
            ),
          )}
          </>
        )}
      </div>

      <Modal
        open={改名 !== null}
        title="重命名对话"
        onCancel={() => { set改名(null); set改名错(null); }}
        onOk={存名字}
        okText="保存"
        cancelText="取消"
        width={420}
      >
        <Input
          autoFocus
          maxLength={60}
          value={改名?.title ?? ""}
          onChange={(e) => set改名((v) => (v ? { ...v, title: e.target.value } : v))}
          onPressEnter={存名字}
          placeholder="这条对话叫什么"
        />
        {改名错 && <p className="home-rename-err" role="alert">{改名错}</p>}
      </Modal>
      {后果框}
    </>
  );

  if (!中栏.露着) {
    return (
      <Drawer
        placement="left"
        open={中栏.抽屉开着}
        onClose={关抽屉}
        closable={false}
        styles={{ wrapper: { width: 280 }, body: { padding: 0, display: "flex", flexDirection: "column" } }}
        rootClassName="pane-drawer pane-drawer-chat"
      >
        {内容}
      </Drawer>
    );
  }

  return (
    <aside className="pane pane-chat">
      {/* 和左栏同一条能拖的缝：这一列装的是一句句问过的话，多长不是我们定的。往窄拖过头就顺势收起（像访达 / Notion） */}
      <WidthHandle 规格={对话列表把手} on拖过头={中栏.收起} />
      {内容}
    </aside>
  );
}

/**
 * 今天 / 昨天 / 更早。
 *
 * 用**本地日期**比，不算「过去 24 小时」：早上问的那条到了晚上仍然该在「今天」，
 * 而不是因为超过 24 小时跳进「更早」。
 */
function 分组(rows: 对话概要[]): [string, 对话概要[]][] {
  const 日 = (s: string) => dayjs(s).format("YYYY-MM-DD");
  const 今 = dayjs().format("YYYY-MM-DD");
  const 昨 = dayjs().subtract(1, "day").format("YYYY-MM-DD");
  const out: Record<string, 对话概要[]> = { 今天: [], 昨天: [], 更早: [] };
  for (const r of rows) {
    const d = 日(r.lastAskedAt);
    out[d >= 今 ? "今天" : d >= 昨 ? "昨天" : "更早"].push(r);
  }
  return [["今天", out.今天], ["昨天", out.昨天], ["更早", out.更早]];
}

/** 列表里出现不止一次的标题 */
export function 重名(rows: { title: string }[]): Set<string> {
  const 数 = new Map<string, number>();
  for (const r of rows) 数.set(r.title, (数.get(r.title) ?? 0) + 1);
  return new Set([...数].filter(([, n]) => n > 1).map(([t]) => t));
}

/** 同名对话行尾那个时间：今天、昨天写钟点（组名已经说了哪天），更早写月-日 */
export function 短时间(at: string): string {
  const d = dayjs(at);
  return d.isAfter(dayjs().subtract(1, "day").startOf("day")) ? d.format("HH:mm") : d.format("MM-DD");
}

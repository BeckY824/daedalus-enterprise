"use client";

import { useState } from "react";
import { Button, Dropdown, Input, Modal } from "antd";
import SaveButton from "@/components/SaveButton";
import { MoreOutlined } from "@ant-design/icons";
import type { 三态条, 三态条按钮 } from "@/lib/enterprise/tri-state-detail";
import { 三态继续持有, 三态暂缓回收, 三态让同事结束项目 } from "../tri-state-actions";
import { 三态显示名 } from "@/lib/enterprise/tri-state-label";
import { 动作出错话 } from "@/lib/stale-deploy";
import { useFormDraft } from "@/components/FormDraft";

const 标签色 = { 沉睡: "sleep", 待回收: "pend", 暂缓回收中: "hold" } as const;

/**
 * 客户三态状态条（P-界面-19 ③，构想页 C10）：客户名一行下面，属于客户层；只在沉睡 / 待回收 / 暂缓回收中时由服务端给，活跃什么都不摆。
 * 按钮给不给、悬停那段话都是服务端算好的（lib/enterprise/tri-state-detail.ts），这里只画、点了调现有动作、成了刷新。
 * 一行不换行：文字放不下省略号（悬停看全）；按钮多、窄的时候只留主按钮，其余收进「更多」（CSS 容器查询，globals.css .tri-bar）
 */
export default function TriStateBar({ 条, customerId, 开客户转让 }: { 条: 三态条; customerId: string; 开客户转让: (() => void) | null }) {
  const [框, set框] = useState<三态条按钮 | null>(null);
  const [理由, set理由] = useState("");
  const [忙, set忙] = useState(false);
  // 理由打了没交的字留草稿（复盘第 1 类）：按客户 + 哪个动作分；办成了、点取消就删
  const 稿 = useFormDraft({ 键: 框 && 框.动作 !== "让同事结束项目" ? `三态理由:${customerId}:${框.动作}` : null, 开: !!框, 值: { 理由 }, 带回: (v) => { if (v.理由 !== undefined) set理由(v.理由); } });
  // 客户转让走页头那个框；页头没给（我不能转）就不摆这颗
  const 钮们 = 条.按钮们.filter((b) => b.动作 !== "客户转让" || 开客户转让);
  const 次 = 钮们.filter((b) => !b.主);
  const 主 = 钮们.find((b) => b.主);

  const 点 = (b: 三态条按钮) => {
    if (b.动作 === "客户转让") return 开客户转让?.();
    set理由("");
    set框(b);
  };
  /** 成了那一下键上的字（原型 g.save：反馈在键里，不弹顶部提示）。顺延还剩几次、通知了几位都在这句里 */
  const [成话, set成话] = useState("已办好");
  /** 回 { ok:false, error } = 没办成，原因浮在键上方（SaveButton），框不关、可以再点 */
  const 确定 = async (): Promise<{ ok: boolean; error?: string }> => {
    if (!框) return { ok: false, error: "没办成，请刷新后重试" };
    const 话 = 理由.trim();
    if (框.要理由 && !话) return { ok: false, error: "请写理由" };
    set忙(true);
    try {
      const r = 框.动作 === "继续持有" ? await 三态继续持有(customerId, 话 || null)
        : 框.动作 === "暂缓回收" ? await 三态暂缓回收(customerId, 话 || null)
        : await 三态让同事结束项目(customerId);
      if (!r.ok) return { ok: false, error: r.error };
      稿.存好了();
      set成话(框.动作 === "继续持有" ? `已顺延${r.剩次数 != null ? `，还可用 ${r.剩次数} 次` : ""}` : 框.动作 === "暂缓回收" ? "已暂缓回收" : `已通知${r.通知了 ? ` ${r.通知了} 位` : ""}同事`);
      // 已 revalidatePath 的保存不再 router.refresh（跳转优化 PR-B 11-25）：动作里 revalidatePath 了，Next 在同一个回包里就把这页重新渲染好带回来；再 refresh 是让服务器把整页再算一遍，还会把预取缓存再清一次（tri-state-actions 的 刷新）
      return { ok: true };
    } catch (出错) {
      return { ok: false, error: 动作出错话(出错, "没办成，请刷新后重试") };
    } finally {
      set忙(false);
    }
  };
  const 钮 = (b: 三态条按钮, cls?: string) => (
    <Button key={b.动作} size="small" type={b.主 ? "primary" : "default"} className={cls} title={b.说明} onClick={() => 点(b)}>{b.字}</Button>
  );

  return (
    <div className={`tri-bar ${标签色[条.状态]}`} data-testid="tri-state-bar" role="status">
      <span className={`tri-st ${标签色[条.状态]}`}>{三态显示名(条.状态)}</span>
      <span className="tri-tx" title={条.悬停}>{条.文字}</span>
      <span className="tri-sp" />
      {条.旁注 && <span className="tri-note" title={条.旁注}>{条.旁注}</span>}
      {钮们.length > 0 && (
        <span className="tri-acts">
          {次.map((b) => 钮(b, "tri-sec"))}
          {次.length > 0 && (
            <Dropdown trigger={["click"]} menu={{ items: 次.map((b) => ({ key: b.动作, label: <span title={b.说明}>{b.字}</span>, onClick: () => 点(b) })) }}>
              <Button size="small" className="tri-more" icon={<MoreOutlined />} aria-label="更多">更多</Button>
            </Dropdown>
          )}
          {主 && 钮(主)}
        </span>
      )}
      {框 && (
        <Modal
          open
          title={框.字}
          onCancel={() => { if (!忙) { 稿.丢掉(); set框(null); } }}
          width={480}
          footer={[
            <Button key="取消" onClick={() => { 稿.丢掉(); set框(null); }} disabled={忙}>取消</Button>,
            <SaveButton key="是" 做={确定} 已保存={成话} 没保存="没办成" 成了={() => set框(null)}>{框.字}</SaveButton>,
          ]}
        >
          <p className="tri-dlg-note">{框.说明}</p>
          {框.动作 !== "让同事结束项目" && 稿.提示}
          {框.动作 !== "让同事结束项目" && (
            <Input.TextArea
              value={理由}
              onChange={(e) => set理由(e.target.value)}
              maxLength={500}
              autoSize={{ minRows: 2, maxRows: 5 }}
              placeholder={框.要理由 ? "必填：为什么还要留着这位客户" : "可以写一句（选填）"}
              aria-label="理由"
            />
          )}
        </Modal>
      )}
    </div>
  );
}

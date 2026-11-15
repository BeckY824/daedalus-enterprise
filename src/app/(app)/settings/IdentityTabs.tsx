"use client";
/**
 * 设置按登录身份（P-界面-46）多出来的两栏：
 *   「我能做什么」（原型 st.perm）：按身份列能做和不能做的，内容同机制总表（lib/enterprise/settings-scope.ts 我能做什么）
 *   「全公司规则」（原型 st.lock）：不是系统管理员的人也看得见这几项，灰着写「只有总管理能改」，点「找总管理开通」给系统管理员发一条站内通知，
 *    按钮原地变「已发给 xx」（不弹顶部提示）
 */
import { useState } from "react";
import { Button, Tag } from "antd";
import { 锁着的规则, type 能做项 } from "@/lib/enterprise/settings-scope";
import { 找总管理开通 } from "./actions";

export function PermTab({ 身份名, 项们 }: { 身份名: string; 项们: 能做项[] }) {
  return (
    <section className="set-id" aria-label="我能做什么">
      <div className="set-id-h">
        <b>我能做什么</b>
        <span className="set-id-who">{身份名}</span>
      </div>
      <ul className="set-perm">
        {项们.map((x) => (
          <li key={x.事} className={x.能 ? "ok" : "no"}>
            <span className="set-perm-mark" aria-label={x.能 ? "能" : "不能"}>{x.能 ? "✓" : "—"}</span>
            <span className="set-perm-t">{x.事}</span>
            {x.注 && <span className="set-perm-n">{x.注}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RulesTab({ 当前值 = {} }: { 当前值?: Partial<Record<string, string>> }) {
  return (
    <section className="set-id" aria-label="全公司规则">
      <div className="set-id-h">
        <b>全公司规则</b>
        <span className="set-id-who">影响全公司，只有总管理能改；灰掉的只能看</span>
      </div>
      <ul className="set-lock">
        {锁着的规则.map((x) => <LockRow key={x.key} k={x.key} 名={x.名} 说明={x.说明} 现在={当前值[x.key]} />)}
      </ul>
    </section>
  );
}

function LockRow({ k, 名, 说明, 现在 }: { k: string; 名: string; 说明: string; 现在?: string }) {
  const [态, set态] = useState<{ 忙?: boolean; 发给?: string[]; 错?: string }>({});
  const 问 = async () => {
    set态({ 忙: true });
    try {
      const r = await 找总管理开通(k);
      set态(r.ok ? { 发给: r.发给 } : { 错: r.error });
    } catch {
      set态({ 错: "没发出去，请稍后再试" });
    }
  };
  return (
    <li className="set-lock-i" data-key={k}>
      <div className="set-lock-main">
        <div className="set-lock-name">{名}</div>
        <div className="set-lock-d">{说明}{现在 ? ` · 现在 ${现在}` : ""}</div>
        <div className="set-lock-who">只有总管理能改</div>
      </div>
      <Tag className="set-lock-tag">只能看</Tag>
      {态.发给 ? (
        <span className="set-lock-sent" role="status">已发给 {态.发给.join("、")}</span>
      ) : (
        <Button size="small" loading={态.忙} onClick={() => void 问()}>找总管理开通</Button>
      )}
      {态.错 && <div className="set-lock-err" role="alert">{态.错}</div>}
    </li>
  );
}

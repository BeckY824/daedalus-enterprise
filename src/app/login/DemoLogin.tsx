"use client";

import { useState } from "react";
import { Alert, Spin } from "antd";
import { PixelLogo } from "@/components/Logo";
import AuthSide from "./AuthSide";
import { 演示登录 } from "./demo-actions";
import { 登录之后 } from "./after-login";
import type { 演示组 } from "@/lib/enterprise/demo-switch";

/**
 * 演示部署的门（CRM_DEMO_SWITCH=1，见 lib/enterprise/demo-switch.ts）：不要密码，按业务角色列出所有人，点谁就以谁进。
 * 进去以后左下角头像菜单里还能随时换人（AppShell 的「切换身份」），所以这里不用解释每个角色能干什么——进去看。
 */
export default function DemoLogin({ 名单, 产品名 }: { 名单: 演示组[]; 产品名?: string }) {
  const [正在, set正在] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function 进(id: string) {
    if (正在) return;
    set正在(id);
    setError(null);
    const 停 = (msg: string) => {
      setError(msg);
      set正在(null);
    };
    const res = await 演示登录(id).catch(() => ({ ok: false as const, error: "登录请求失败，请检查网络连接后重试" }));
    if (!res.ok) return 停(res.error);
    await 登录之后(res, 停);
  }

  return (
    <div className="auth">
      <AuthSide 门="自部署" 产品名={产品名} />
      <main className="auth-main">
        <div className="auth-form demo-login">
          <div className="auth-mobile-mark" aria-hidden>
            <PixelLogo size={40} />
          </div>
          <div className="auth-step">
            <h1>选一个身份进入</h1>
            <p className="auth-hint">演示环境，不用密码。不同角色看到的数据和菜单不一样；进去后点左下角的名字可以随时换人。</p>
          </div>
          {error && <Alert type="error" showIcon title={error} className="auth-alert" />}
          {名单.length === 0 && <p className="auth-hint">这个部署里还没有可登录的人。</p>}
          {名单.map((g) => (
            <section key={g.角色} className="demo-login-group" aria-label={g.名}>
              <h2>{g.名}</h2>
              {g.人.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="demo-login-person"
                  data-testid={`demo-login-${p.id}`}
                  disabled={!!正在 && 正在 !== p.id}
                  aria-busy={正在 === p.id}
                  onClick={() => void 进(p.id)}
                >
                  <b>{p.name}</b>
                  {p.说明 && <span>{p.说明}</span>}
                  {正在 === p.id && <Spin size="small" className="demo-login-spin" />}
                </button>
              ))}
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

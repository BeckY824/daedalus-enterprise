"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Input, Button, Alert } from "antd";
import { login } from "./actions";
import { 登录之后 } from "./after-login";
import { useMotionTheme } from "@/components/MotionTheme";
import { PixelLogo } from "@/components/Logo";
import AuthSide from "./AuthSide";
import {记找回邮箱,useLoginEmail} from "@/lib/auth-email-prefill";

/** server action 迟迟不返回时的等待上限。链路正常时登录在 3 秒内完成。 */
const 请求超时毫秒 = 20000;

/**
 * 网页版的登录（托管版 / 自部署）。页面壳子在 page.tsx——那里是服务端组件，
 * 由它读运行时环境决定要不要画「忘记密码」：这个部署发不出信时，
 * 那个链接点进去只能看到「请联系我们」，不如不摆。
 *
 * 左栏品牌 + 右边一张表（见 AuthSide）。托管版是共享工作区的固定账号、自部署是管理员建的用户名。
 */
export default function LoginForm({
  可找回密码,
  用邮箱,
  可注册 = false,
  注册地址,
  产品名,
  飞书登录 = false,
  初始错误,
}: {
  可找回密码: boolean;
  用邮箱: boolean;
  /** 托管版收不收新注册。收就摆一条注册入口（开的是桌面端用的云端账号） */
  可注册?: boolean;
  注册地址?: string;
  /** 左栏的产品名。企业版部署可换（CRM_PRODUCT_NAME，lib/enterprise/brand.ts），不传是默认名 */
  产品名?: string;
  /** 企业版配了飞书应用：摆「用飞书登录」，点了走 /api/auth/feishu */
  飞书登录?: boolean;
  /** 打开登录页时就要显示的错（飞书登录没成带回来的原因，见 page.tsx） */
  初始错误?: string;
}) {
  const { 曲线, 时长 } = useMotionTheme();
  /** 托管版的账号是邮箱，自部署是管理员建的登录名。见 page.tsx */
  const 账号名 = 用邮箱 ? "邮箱" : "用户名";
  const [账号, set账号] = useLoginEmail(用邮箱);
  const [密码, set密码] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(初始错误 ?? null);
  const 账号框 = useRef<HTMLInputElement>(null);
  const 密码框 = useRef<HTMLInputElement>(null);
  /**
   * 动效只有两下：报错条撑开（不是砸下来）、登录失败时表单横向抖一下（3px，一个来回）——
   * 密码错了这件事，看见比读见快。系统开了「减弱动态效果」就全部按 0 处理。
   */
  const 少动 = useReducedMotion();
  const [抖, set抖] = useState(0);
  const 秒 = (t: number) => (少动 ? 0 : t);
  const 报错 = (msg: string) => {
    setError(msg);
    set抖((n) => n + 1);
  };

  async function 提交() {
    if (loading) return;
    if (!账号.trim()) {
      报错(`请输入${账号名}`);
      账号框.current?.focus();
      return;
    }
    if (!密码) {
      报错("请输入密码");
      密码框.current?.focus();
      return;
    }
    setLoading(true);
    setError(null);

    let res: Awaited<ReturnType<typeof login>>;
    try {
      /**
       * 必须带超时。server action 是一个普通的 POST，网络层把它挂住时
       * （代理、QUIC 回退失败、服务器无响应都会）这个 await 永远不会 settle，
       * 按钮就会无限转圈且不给任何提示——用户只能看到「一直在加载」。
       */
      res = await Promise.race([
        login(账号.trim(), 密码),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 请求超时毫秒)),
      ]);
    } catch (e) {
      报错(e instanceof Error && e.message === "timeout" ? "服务器无响应，请检查网络连接后重试" : "登录请求失败，请检查网络连接后重试");
      setLoading(false);
      return;
    }

    if (!res.ok) {
      报错(res.error);
      setLoading(false);
      return;
    }

    await 登录之后(res, (msg) => {
      报错(msg);
      setLoading(false);
    });
  }

  return (
    <div className="auth">
      <AuthSide 门={用邮箱 ? "托管版" : "自部署"} 产品名={产品名} />

      <main className="auth-main">
        <motion.form
          className="auth-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void 提交();
          }}
          animate={{ x: 抖 && !少动 ? [0, -3, 3, -2, 2, 0] : 0 }}
          transition={{ x: { duration: 秒(时长.morph), ease: 曲线.ease } }}
        >
          <div className="auth-mobile-mark" aria-hidden>
            <PixelLogo size={40} />
          </div>
          <div className="auth-step">
            <h1>登录</h1>
            <p className="auth-hint">
              {用邮箱 ? (
                <>
                  这里是 Daedalus 账号和云端服务。CRM 请到
                  <a href="https://ai-daedalus.com/download.html" target="_blank" rel="noopener noreferrer">
                    下载页
                  </a>
                  下载桌面端使用。
                </>
              ) : (
                "使用此部署中的账号登录。"
              )}
            </p>
            {飞书登录 && (
              <>
                {/* 整页跳走（不是客户端路由）：去的是接口，它再跳飞书授权页 */}
                <Button size="large" block href="/api/auth/feishu">
                  用飞书登录
                </Button>
                <p className="auth-or">或用用户名和密码</p>
              </>
            )}
            <label className="auth-label" htmlFor="auth-account">
              {账号名}
            </label>
            <Input
              id="auth-account"
              ref={(el) => {
                账号框.current = el?.input ?? null;
              }}
              size="large"
              value={账号}
              onChange={(e) => set账号(e.target.value)}
              placeholder={账号名}
              autoComplete={用邮箱 ? "email" : "username"}
              inputMode={用邮箱 ? "email" : undefined}
              autoFocus
            />
            <label className="auth-label" htmlFor="auth-pw">
              密码
            </label>
            <Input.Password
              id="auth-pw"
              ref={(el) => {
                密码框.current = el?.input ?? null;
              }}
              size="large"
              value={密码}
              onChange={(e) => set密码(e.target.value)}
              placeholder="登录密码"
              autoComplete="current-password"
            />
            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
              登录
            </Button>
            {(可找回密码 || (可注册 && 注册地址)) && (
              <p className="auth-alt">
                {可找回密码 && <Link href="/forgot" onClick={()=>记找回邮箱(账号)}>忘记密码？</Link>}
                {/* 注册已经在桌面端里做（2026-10-14 对外口径）：浏览器里的注册入口指向下载页，
                    装好桌面端在软件里注册。/signup 这条路本身还在，老版本桌面端会开它 */}
                {可注册 && 注册地址 && (
                  <>
                    {可找回密码 && " · "}
                    还没有账号？
                    <a href="https://ai-daedalus.com/download.html" target="_blank" rel="noopener noreferrer">
                      下载桌面端
                    </a>
                    ，在软件里注册
                  </>
                )}
              </p>
            )}
          </div>

          {/* 错误条撑开、收起，而不是砸下来又消失 */}
          <AnimatePresence initial={false}>
            {error && (
              <motion.div
                key="err"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 秒(时长.base), ease: 曲线.ease }}
                style={{ overflow: "hidden" }}
              >
                <Alert type="error" showIcon title={error} className="auth-alert" />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.form>
      </main>
    </div>
  );
}

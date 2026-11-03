/**
 * 企业版登录页（U-登录-01，10-31）：去掉左栏，只留正中一张卡。
 *   - 配了飞书（11-03 改）：只有「用飞书登录」一个按钮 + 一行「无法登录请联系管理员」，页上没有账号密码框、也没有切到账号密码的入口
 *   - 配了飞书 + 地址带 ?admin=1（隐藏入口，给系统管理员兜底）：账号密码表单 + 「改用飞书登录」
 *   - 没配飞书（本机、演示实例）：直接是账号密码那张表，照旧能登录
 *   - 不是企业版（托管版、自部署）：照旧左栏品牌 + 右边表
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/login/actions", () => ({ login: async () => ({ ok: false, error: "x" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));

import LoginForm from "@/app/login/LoginForm";

const 画 = (p: { 飞书登录?: boolean; 居中?: boolean; 产品名?: string; 管理员入口?: boolean }) =>
  renderToStaticMarkup(createElement(LoginForm, { 可找回密码: false, 用邮箱: false, ...p }));

describe("企业版登录页", () => {
  it("配了飞书：正中一张卡，只有飞书按钮 + 「无法登录请联系管理员」，没有账号密码", () => {
    const html = 画({ 飞书登录: true, 居中: true, 产品名: "测试产品" });
    expect(html).toContain("auth auth-solo");
    expect(html).not.toContain("auth-side");
    expect(html).toContain("用飞书登录");
    expect(html).toContain('href="/api/auth/feishu"');
    expect(html).toContain("无法登录请联系管理员");
    // 没有账号、密码框，也没有切过去的入口和密码相关的说法
    expect(html).not.toContain('id="auth-account"');
    expect(html).not.toContain('id="auth-pw"');
    expect(html).not.toContain("账号密码登录");
    expect(html).not.toContain("密码");
    expect(html).not.toContain("<input");
    expect(html).toContain("测试产品");
  });

  it("配了飞书 + 隐藏入口（?admin=1）：账号密码表单，说明只给系统管理员，能改回飞书", () => {
    const html = 画({ 飞书登录: true, 居中: true, 管理员入口: true });
    expect(html).toContain("auth auth-solo");
    expect(html).toContain('id="auth-account"');
    expect(html).toContain('id="auth-pw"');
    expect(html).toContain("系统管理员");
    expect(html).toContain("改用飞书登录");
    expect(html).not.toContain("无法登录请联系管理员");
  });

  it("没配飞书时 ?admin=1 不改样子：照旧账号密码", () => {
    const html = 画({ 飞书登录: false, 居中: true, 管理员入口: true });
    expect(html).toContain('id="auth-account"');
    expect(html).not.toContain("用飞书登录");
  });

  it("没配飞书：正中一张卡，直接是账号密码，没有飞书按钮", () => {
    const html = 画({ 飞书登录: false, 居中: true });
    expect(html).toContain("auth auth-solo");
    expect(html).not.toContain("auth-side");
    expect(html).not.toContain("用飞书登录");
    expect(html).toContain('id="auth-account"');
    expect(html).toContain('id="auth-pw"');
  });

  it("不是企业版：照旧左栏 + 表", () => {
    const html = 画({ 飞书登录: false });
    expect(html).not.toContain("auth-solo");
    expect(html).toContain("auth-side");
    expect(html).toContain('id="auth-account"');
  });
});

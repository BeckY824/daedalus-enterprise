"use client";

/* antd 的全站配置（中文、主题、两个字的按钮不插空格）放在浏览器端组件里（11-15 列表页瘦身）：
   原来在根布局（服务端）直接写 <ConfigProvider locale theme>，这两个对象（约 7 KB）每个整页 HTML 都要序列化一遍塞进 RSC 负载；
   挪到这里后它们跟着 JS 包走、浏览器缓存，页面里不再带。渲染出来的东西和原来一样 */
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { themeConfig } from "@/lib/theme";

export default function AntdConfig({ children }: { children: React.ReactNode }) {
  // 两个字的按钮 antd 默认中间插空格（「客 户」「确 定」），全站不插（10-27 界面统一）
  return <ConfigProvider locale={zhCN} theme={themeConfig} button={{ autoInsertSpace: false }}>{children}</ConfigProvider>;
}

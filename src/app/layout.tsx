import type { Metadata } from "next";
import AntdRegistry from "@/components/AntdRegistry";
import { App as AntdApp } from "antd";
import AntdConfig from "@/components/AntdConfig";
import MotionTheme from "@/components/MotionTheme";
import ModeFollow from "@/components/ModeFollow";
import { 外观预设脚本, 默认外观 } from "@/lib/appearance";
import { 旧浏览器提示脚本 } from "@/lib/old-browser";
import "./globals.css";
import { 自定产品名 } from "@/lib/enterprise/brand";
/* 暗色（设置 → 外观 → 明暗）：一层中性 token 叠在 globals.css 的 :root 上；antd-dark.css 把 antd 的变量接到这些 token 上。
   dark.css 必须排在最后（tests/dark-mode.test.ts） */
import "./antd-dark.css";
import "./dark.css";

/** 企业版可换产品名（CRM_PRODUCT_NAME，lib/enterprise/brand.ts）；别的版本照旧 */
export function generateMetadata(): Metadata {
  return {
    title: 自定产品名() ?? "Daedalus CRM",
    description: "客户全周期管理，让销售更高效",
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    /* data-paper / data-mode 是外观（lib/appearance.ts）。服务端先按默认渲染，
       <head> 里那段在第一次绘制前换成这台电脑存的——所以 html 上这几个属性和服务端对不上是预期的 */
    <html lang="zh-CN" data-paper={默认外观.paper} data-mode={默认外观.mode} suppressHydrationWarning>
      <head>
        {/* 浏览器低于 Next 16 下限（Safari 16.4 等）时整页盖一块提示；新浏览器上什么也不做（lib/old-browser.ts） */}
        <script dangerouslySetInnerHTML={{ __html: 旧浏览器提示脚本 }} />
        <script dangerouslySetInnerHTML={{ __html: 外观预设脚本 }} />
      </head>
      <body>
        <ModeFollow />
        <AntdRegistry>
          {/* 中文、主题、按钮不插空格：在浏览器端组件里配（components/AntdConfig.tsx），这两个对象不进每页的 RSC 负载 */}
          <AntdConfig>
            {/* 动效的两条全局约定（减弱动态时 motion 不动、默认过渡用全站那条曲线）挂在 MotionTheme 里——见 components/MotionTheme.tsx */}
            <MotionTheme>
              <AntdApp>{children}</AntdApp>
            </MotionTheme>
          </AntdConfig>
        </AntdRegistry>
      </body>
    </html>
  );
}

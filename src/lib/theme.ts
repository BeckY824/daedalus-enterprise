import type { ThemeConfig } from "antd";
import { palette, alpha } from "@/lib/palette";
import { antd动效 } from "@/lib/motion";

/**
 * antd 这边的 token。
 *
 * 真正的一份 token 在 `src/app/globals.css` 的 `:root` 里——字号四级、十组颜色、
 * 间距圆角动效、骨架尺寸都在那儿。这里只是把同样的值喂给 antd，
 * 因为 antd 的组件样式是 CSS-in-JS 生成的，读不到 CSS 变量。
 * **两边的数必须一样**：颜色从 lib/palette.ts 取（tests/design-tokens.test.ts 会和 :root 对一遍），
 * 字号、圆角这些数字还是手抄——改了 globals.css 记得回来对。
 *
 * 早先这里还导出过 RAIL_WIDTH = 76 / PANE_WIDTH = 352，没有任何地方用，
 * 值也停在侧栏加宽之前——已经删掉，宽度只由 --rail-w / --pane-w 说了算。
 */
export const BRAND = palette.brand;

/**
 * antd 的 CSS 变量挂在哪个类上。antd 6 默认就是 CSS 变量模式，但 key 取自 React 的 useId（`css-var-_R_2lb_` 这种），
 * 换个组件树就变——主题样式表（src/app/skins/）要按类名覆盖 `--ant-*`，所以钉死成一个固定的 key。
 * 给了 key 之后 antd 直接拿它当类名（不再加 css-var- 前缀），所以 key 本身写成 `css-var-dd`。
 * 固定之后服务端和浏览器算出来的也是同一个，SSR 不会对不上。改名要同步 skins/shared.css 里的 `.css-var-dd`
 * （tests/skins.test.ts 钉着）
 */
export const ANTD_CSS_VAR_KEY = "css-var-dd";

export const themeConfig: ThemeConfig = {
  cssVar: { key: ANTD_CSS_VAR_KEY },
  token: {
    colorPrimary: BRAND,
    colorInfo: BRAND,
    colorLink: BRAND,
    colorSuccess: palette.success,
    colorWarning: palette.warning,
    colorError: palette.danger,
    /* 16a：控件 8（--r-ctl）、卡片 10（--r-card）；浮层、卡片外壳另在组件里给 14（--r-pop） */
    borderRadius: 8,
    borderRadiusLG: 10,
    borderRadiusSM: 4,
    fontSize: 14,
    fontSizeSM: 12,
    fontSizeLG: 16,
    /* 页面标题 22 / 区块标题 15，和 --fs-title / --fs-section 对齐 */
    fontSizeHeading4: 22,
    fontSizeHeading5: 15,
    /* 控件三档（16a）：小 28、默认 32、主操作 40 */
    controlHeight: 32,
    controlHeightSM: 28,
    controlHeightLG: 40,
    colorTextBase: palette.ink,
    colorText: palette.ink,
    colorTextSecondary: palette.textMuted,
    /* Typography type="secondary" 走的是这个，不是 colorTextSecondary。
       派生值是 #9ca3af——跟进记录整列正文就是这么变成浅灰的。说明最浅到 #6b7280 */
    colorTextDescription: palette.textMuted,
    /* --text-faint：placeholder、禁用、装饰。不许当正文 */
    colorTextTertiary: palette.textFaint,
    colorBorder: palette.line,
    colorBorderSecondary: palette.lineSoft,
    colorBgLayout: palette.workbench,
    colorBgContainer: palette.panel,
    colorFillTertiary: palette.hover,
    /* 和 :root 的 --shadow-card / --shadow-pop 一字不差 */
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04), 0 4px 16px rgba(0, 0, 0, 0.05)",
    boxShadowSecondary: "0 2px 6px rgba(0, 0, 0, 0.04), 0 12px 32px rgba(0, 0, 0, 0.10)",
    ...antd动效,
    fontFamily:
      'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "SF Pro SC", "PingFang SC", "Noto Sans SC", "Daedalus YaHei", "Microsoft YaHei", Roboto, sans-serif',
  },
  components: {
    Layout: {
      siderBg: palette.workbench,
      bodyBg: palette.workbench,
      headerBg: palette.panel,
      headerHeight: 52,
    },
    Menu: {
      itemBg: "transparent",
      subMenuItemBg: "transparent",
      itemColor: palette.inkSoft,
      itemHoverBg: palette.hover,
      itemHoverColor: palette.ink,
      /* 16a：选中浅灰底深字，不用蓝底 */
      itemSelectedBg: palette.hover,
      itemSelectedColor: palette.ink,
      itemMarginInline: 10,
      itemMarginBlock: 2,
      itemHeight: 34,
      itemBorderRadius: 8,
      iconSize: 15,
      fontSize: 14,
      collapsedIconSize: 16,
    },
    Card: {
      /* 16a：卡片外壳圆角 14、不画边框（globals.css .ant-card 接 --card-line / --shadow-card，换主题时边框回来） */
      borderRadiusLG: 14,
      paddingLG: 16,
      headerHeight: 48,
      headerFontSize: 15,
      colorBorderSecondary: palette.lineSoft,
      boxShadowTertiary: "none",
    },
    Table: {
      headerBg: palette.panel,
      headerColor: palette.textMuted,
      headerSplitColor: "transparent",
      rowHoverBg: palette.rowHover,
      rowSelectedBg: palette.brandBg,
      // 选中又悬停：比选中再深一档。没有单独的 token，用主色加透明度
      rowSelectedHoverBg: alpha(palette.brand, 0.14),
      borderColor: palette.lineSoft,
      cellPaddingBlock: 12,
      cellPaddingInline: 14,
      cellPaddingBlockMD: 10,
      cellPaddingInlineMD: 14,
      cellPaddingBlockSM: 8,
      cellPaddingInlineSM: 12,
      /* 表格正文就是正文，和别处一样 14。13.5 是上一版为了多塞一列凑出来的 */
      fontSize: 14,
      headerBorderRadius: 14,
    },
    Button: {
      primaryShadow: "none",
      defaultShadow: "none",
      dangerShadow: "none",
      fontWeight: 500,
      defaultBorderColor: palette.line,
      defaultHoverBorderColor: palette.lineStrong,
      defaultHoverColor: palette.ink,
    },
    Input: { activeShadow: `0 0 0 3px ${alpha(palette.brand, 0.14)}` },
    Statistic: { contentFontSize: 26, titleFontSize: 13 },
    Tabs: { titleFontSize: 14, horizontalItemPadding: "10px 0", inkBarColor: palette.ink, itemSelectedColor: palette.ink, itemHoverColor: palette.ink },
    Segmented: { trackPadding: 2, trackBg: palette.hover },
    Tag: { fontSizeSM: 12, borderRadiusSM: 999 },
    Modal: { titleFontSize: 15, borderRadiusLG: 14 },
    Drawer: { borderRadiusLG: 14 },
    Popover: { borderRadiusLG: 14 },
    Form: { labelFontSize: 13, verticalLabelPadding: "0 0 4px", labelColor: palette.textMuted },
    Breadcrumb: { fontSize: 13 },
    Dropdown: { borderRadiusLG: 14 },
    Select: { optionSelectedBg: palette.brandBg, borderRadiusLG: 14 },
    Alert: { borderRadiusLG: 10 },
  },
};

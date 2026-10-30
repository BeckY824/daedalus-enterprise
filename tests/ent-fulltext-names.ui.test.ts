import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { readFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
/* 10-30 用户：「目前渠道页有些都没显示完整。要显示完整。做好排版。其他页面也是一样。」
   渠道页那一格原来单行省略（「Facebook｜VR S…」），改成整段折行：名字不截、不横滚，属性 / 已停用标签钉在名字第一行右边、不压字。
   1024 / 1280 / 1366 三个宽度都量；渲染的是真的 ChannelsView + globals.css，只把服务端动作和抽屉换掉 */
let browser: Browser, bundle: string;
const 长名 = "Facebook｜VR STAR SPACE 某某某超长渠道名测试测试测试";
const 无空格名 = "视频号|星际空间InterstellarSpaceOfficialChannel超长渠道名测试测试测试";
const plugin: Plugin = { name: "fulltext-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},prefetch(){}});export const usePathname=()=>\"/channels\";export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L(p){return <a {...p}/>}");
  stub(/^\.\/actions$/, "export const saveChannel=async()=>({ok:false}),toggleChannel=saveChannel,deleteChannel=saveChannel;");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/ChannelDrawer$/, "export default function D(){return null}");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import ChannelsView from '@/app/(app)/channels/ChannelsView';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import {我Provider} from '@/lib/me-client';import ChannelPicker from '@/components/ChannelPicker';
    const root=createRoot(document.getElementById('root'));
    const 行=(id,name,attr,active)=>({id,name,phone:null,remark:'备注',active,attr,platform:null,endDate:null,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',createdByName:'QA',channelOwnerId:'qa',channelOwnerName:'QA'});
    const rows=[行('c1',${JSON.stringify(长名)},'公域引流',true),行('c2',${JSON.stringify(无空格名)},'个人自拓',false),行('c3','短名','公域引流',true)];
    window.__render=()=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><我Provider value={{id:'qa',name:'QA'}}><ChannelsView rows={rows} users={[{id:'qa',name:'QA'}]} 属性选项={['公域引流','个人自拓']}/></我Provider></BusinessProvider></App></ConfigProvider>);
    // 选渠道的级联：属性 / 名称 / 来源三列，放在 1024 宽的弹窗那么宽的格子里
    window.__picker=()=>root.render(<ConfigProvider locale={zhCN}><div style={{width:472,margin:'420px 0 0 276px'}}><ChannelPicker aria-label='渠道' channels={[{id:'c1',name:${JSON.stringify(长名)},attr:'公域引流',platform:'Facebook',active:true},{id:'c2',name:${JSON.stringify(无空格名)},attr:'个人自拓',platform:null,active:true}]}/></div></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

for (const width of [1024, 1280, 1366]) {
  it(`渠道名整段显示、标签钉在第一行不压字（${width} 宽）`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
    try {
      await page.route("http://fulltext.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
      await page.goto("http://fulltext.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
      await page.evaluate(() => (window as unknown as { __render: () => void }).__render());
      await page.locator(".chan-full").nth(2).waitFor();
      const 量 = await page.evaluate(() => [...document.querySelectorAll(".chan-full")].map((格) => {
        const 名 = 格.firstElementChild as HTMLElement;
        const 标签们 = [...格.querySelectorAll<HTMLElement>(".ant-tag")];
        const 名框 = 名.getBoundingClientRect();
        const cs = getComputedStyle(名);
        const 行高 = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
        const td = 格.closest("td")!;
        return {
          文: 名.textContent,
          行数: Math.round(名框.height / 行高),
          名溢出: 名.scrollWidth > 名.clientWidth + 1,
          // 不看 td.scrollWidth：固定列的阴影伪元素本来就伸出格子外；看渠道这一块自己有没有超出格子的内容区
          格溢出: (格 as HTMLElement).scrollWidth > (格 as HTMLElement).clientWidth + 1 || 格.getBoundingClientRect().right > td.getBoundingClientRect().right - parseFloat(getComputedStyle(td).paddingRight) + 0.5,
          省略: cs.textOverflow === "ellipsis" && cs.whiteSpace === "nowrap",
          标签: 标签们.map((t, i) => {
            const r = t.getBoundingClientRect();
            const 中 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return {
              字: t.textContent,
              交: !(r.left >= 名框.right || r.right <= 名框.left || r.top >= 名框.bottom || r.bottom <= 名框.top),
              // 第一个标签和名字第一行顶齐；第二个叠在它下面，和上一个不相交
              顶差: i === 0 ? Math.abs(r.top - 名框.top) : 0,
              压上一个: i > 0 && r.top < 标签们[i - 1].getBoundingClientRect().bottom,
              在格里: r.right <= td.getBoundingClientRect().right + 0.5,
              点中: !!中 && t.contains(中),
            };
          }),
        };
      }));
      expect(量.map((x) => x.文)).toEqual([长名, 无空格名, "短名"]);
      for (const x of 量) {
        expect(x.省略, x.文!).toBe(false);
        expect(x.名溢出, x.文!).toBe(false);
        expect(x.格溢出, x.文!).toBe(false);
        for (const t of x.标签) {
          expect(t.交, `${x.文} / ${t.字}`).toBe(false);
          expect(t.顶差, `${x.文} / ${t.字}`).toBeLessThanOrEqual(2);
          expect(t.在格里, `${x.文} / ${t.字}`).toBe(true);
          expect(t.点中, `${x.文} / ${t.字}`).toBe(true);
          expect(t.压上一个, `${x.文} / ${t.字}`).toBe(false);
        }
      }
      // 长名真的折了行（不是被藏起来），短名还是一行
      expect(量[0].行数).toBeGreaterThanOrEqual(2);
      expect(量[1].行数).toBeGreaterThanOrEqual(2);
      expect(量[2].行数).toBe(1);
      // 两个标签横着排时名字被挤成一指宽、折到 8 行（10-30 量到的）；上下叠以后名字留得出宽度
      for (const x of 量) expect(x.行数, x.文!).toBeLessThanOrEqual(5);
      expect(量[1].标签.map((t) => t.字)).toEqual(["个人自拓", "已停用"]);
      // 整页不横滚
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    } finally { await page.close(); }
  });
}

/* 选渠道的级联（ChannelPicker）原来格子单行省略、每列最宽 400，三列并排比 1024 屏还宽，弹层被推出左边 */
for (const width of [1024, 1366]) {
  it(`选渠道的级联：长来源折行显示完整、三列都在屏幕里（${width} 宽）`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
    try {
      await page.route("http://fulltext.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
      await page.goto("http://fulltext.test"); await page.addScriptTag({ content: bundle });
      await page.evaluate(() => (window as unknown as { __picker: () => void }).__picker());
      await page.getByRole("combobox", { name: "渠道" }).click();
      const 列 = (k: number) => page.locator(".chan-picker-pop .ant-cascader-menu").nth(k).locator(".ant-cascader-menu-item");
      await 列(0).filter({ hasText: "公域引流" }).hover();
      await 列(1).first().hover();
      await 列(2).first().waitFor();
      // globals.css 放到 antd 运行时样式前面（和应用里一样，同样重的选择器 antd 赢）：只靠先后顺序压不过的写法这里会红
      await page.evaluate((css) => { const s = document.createElement("style"); s.textContent = css; document.head.prepend(s); }, readFileSync(path.resolve("src/app/globals.css"), "utf8"));
      await page.waitForTimeout(100);
      const 量 = await page.evaluate(() => {
        const 格们 = [...document.querySelectorAll<HTMLElement>(".chan-picker-pop .ant-cascader-menu-item-content")];
        const 长 = 格们.filter((e) => (e.textContent ?? "").length > 20);
        const pop = document.querySelector(".chan-picker-pop")!.getBoundingClientRect();
        return {
          长: 长.map((e) => {
            const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
            const 中 = document.elementFromPoint(r.left + 10, r.top + r.height / 2);
            return { 文: e.textContent, 省略: cs.textOverflow === "ellipsis" && cs.whiteSpace === "nowrap", 溢出: e.scrollWidth > e.clientWidth + 1, 折行: r.height > parseFloat(cs.lineHeight) * 1.5, 点中: !!中 && e.contains(中) };
          }),
          左: pop.left, 右: pop.right,
        };
      });
      expect(量.长.length).toBeGreaterThan(0);
      for (const x of 量.长) {
        expect(x.省略, x.文!).toBe(false);
        expect(x.溢出, x.文!).toBe(false);
        expect(x.折行, x.文!).toBe(true);
        expect(x.点中, x.文!).toBe(true);
      }
      expect(量.左).toBeGreaterThanOrEqual(0);
      expect(量.右).toBeLessThanOrEqual(width);
    } finally { await page.close(); }
  });
}

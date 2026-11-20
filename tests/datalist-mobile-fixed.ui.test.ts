/**
 * 手机宽（< 768）右侧固定列钉不钉（PR #384）：
 *   #381 实操给客户列表的操作列写了 手机不钉（只一颗「⋯」，让出中间给号码列）；第一版一律不钉，
 *   线索列表 375 宽的操作列（分配按钮、批量自动分配的结果格）被推到 930–1068px，CI e2e-ent/owner-first-batch A5 挂了。
 *   这里钉住：没写 手机不钉 的右固定列 375 宽照钉、整格在视口里；写了的不钉；电脑宽两样都钉；名字列手机宽收到 120
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "datalist-mobile-fixed", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(){},refresh(){},replace(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import DataList from '@/components/DataList';
    const 行=[{id:'a',name:'某某贸易有限公司'.repeat(4)},{id:'b',name:'乙'}];
    const 列们=(不钉)=>[
      {title:'名称',key:'name',width:240,常驻:true,render:(_,r)=>r.name},
      {title:'电话',key:'phone',width:150,render:()=>'13800000001'},
      {title:'阶段',key:'stage',width:160,render:()=>'跟进中'},
      {title:'',key:'act',width:210,常驻:true,fixed:'right',...(不钉?{手机不钉:true}:{}),render:()=><span className="act-cell">已分给 某某 ✓</span>},
    ];
    createRoot(document.getElementById('root')).render(<App>
      <div id="pin"><DataList 页="m-pin" 列={列们(false)} 行={行} 空库={false} 空态={{title:'空'}} 批量={()=>null}/></div>
      <div id="free"><DataList 页="m-free" 列={列们(true)} 行={行} 空库={false} 空态={{title:'空'}} 批量={()=>null}/></div>
    </App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 量(宽: number) {
  const page = await browser.newPage({ viewport: { width: 宽, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://list.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root' style='padding:0 12px'></div>" }));
  await page.goto("http://list.test/"); await page.addScriptTag({ content: bundle });
  await page.locator("#free .ant-table-row").first().waitFor();
  const r = await page.evaluate(() => {
    const 一张 = (sel: string) => {
      const th = document.querySelector<HTMLElement>(`${sel} thead th.dl-col-act`)!;
      const 格 = document.querySelector<HTMLElement>(`${sel} tr[data-row-key=a] .act-cell`)!.getBoundingClientRect();
      const 名 = document.querySelector<HTMLElement>(`${sel} thead th.dl-col-name`)!;
      return {
        钉右: /ant-table-cell-fix-(right|end)/.test(th.className),
        格右: Math.round(格.right), 格左: Math.round(格.left),
        名字宽: 名.offsetWidth,
      };
    };
    return { 视口: document.documentElement.clientWidth, 页横滚: document.documentElement.scrollWidth > window.innerWidth, 钉: 一张("#pin"), 不钉: 一张("#free") };
  });
  await page.close();
  return { r, errors };
}

it("375 宽：没写 手机不钉 的操作列照钉、结果格整格在视口里；写了的不钉（跟着横滚到最后）；名字列收到 120；页面不横滚", async () => {
  const { r, errors } = await 量(375);
  expect(r.钉, JSON.stringify(r)).toMatchObject({ 钉右: true, 名字宽: 120 });
  expect(r.钉.格右, JSON.stringify(r)).toBeLessThanOrEqual(r.视口);
  expect(r.钉.格左, JSON.stringify(r)).toBeGreaterThanOrEqual(0);
  expect(r.不钉, JSON.stringify(r)).toMatchObject({ 钉右: false, 名字宽: 120 });
  expect(r.不钉.格右, JSON.stringify(r)).toBeGreaterThan(r.视口);
  expect(r.页横滚).toBe(false);
  expect(errors).toEqual([]);
});

it("1280 宽：两样都钉右，名字列照原宽", async () => {
  const { r, errors } = await 量(1280);
  expect(r.钉.钉右).toBe(true);
  expect(r.不钉.钉右).toBe(true);
  expect(r.钉.名字宽).toBeGreaterThanOrEqual(240);
  expect(errors).toEqual([]);
});

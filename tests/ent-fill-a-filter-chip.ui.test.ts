/**
 * 筛选条（原型 cu.filter「选中变成可清除标签，总数滚到新值」）：在 components/CustomFilters 统一做，客户、公海、项目、渠道各页一起生效。
 *
 *   选中：摆在外面的下拉变成一枚「名：值 ×」标签，× 一直看得见（不用悬停）；点 × 清掉、回到原来的下拉
 *   点标签照旧弹出下拉，可以换一个值
 *   总数：「共 N 条」从旧数滚到新数（DataList showTotal 用 CountUp），不是直接跳；减弱动态下直接到位
 *   收在「更多筛选」里的、多选的、不是下拉的（日期段）不变标签
 *   1024 宽：标签长名字不撑破筛选行、不横滚
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-fill-a-filter-chip", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(){},refresh(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {App, Select, Space, DatePicker} from 'antd';
    import MotionTheme from '@/components/MotionTheme';
    import DataList from '@/components/DataList';
    import {useCustomFilters} from '@/components/CustomFilters';
    const 人们=['李想','王一','欧阳长长长长名字的同事'];
    const 全部=Array.from({length:128},(_,i)=>({id:'r'+i,name:'客户'+i,owner:i<23?'李想':i<30?'欧阳长长长长名字的同事':'王一',stage:i%2?'线索':'报价'}));
    function 页(){
      const [f,setF]=useState({owner:'',stage:'',多:[],其他:''});
      const {外露,更多按钮}=useCustomFilters('chip-test',[
        {键:'owner',名:'负责人',宽:150,默认外露:true,有值:!!f.owner,渲染:(style)=><Select style={style} placeholder="全部负责人" allowClear aria-label="负责人" value={f.owner||undefined} onChange={(v)=>setF({...f,owner:v??''})} options={人们.map(x=>({value:x,label:x}))}/>},
        {键:'stage',名:'阶段',宽:110,默认外露:true,有值:!!f.stage,渲染:(style)=><Select style={style} placeholder="全部阶段" allowClear aria-label="阶段" value={f.stage||undefined} onChange={(v)=>setF({...f,stage:v??''})} options={['线索','报价'].map(x=>({value:x,label:x}))}/>},
        {键:'many',名:'标签',宽:140,默认外露:true,有值:f.多.length>0,渲染:(style)=><Select mode="multiple" style={style} placeholder="全部标签" aria-label="标签" value={f.多} onChange={(v)=>setF({...f,多:v})} options={['甲','乙'].map(x=>({value:x,label:x}))}/>},
        {键:'hidden',名:'来源',宽:140,默认外露:false,有值:!!f.其他,渲染:(style)=><Select style={style} placeholder="全部来源" allowClear aria-label="来源" value={f.其他||undefined} onChange={(v)=>setF({...f,其他:v??''})} options={['展会'].map(x=>({value:x,label:x}))}/>},
      ]);
      const 行=全部.filter(r=>(!f.owner||r.owner===f.owner)&&(!f.stage||r.stage===f.stage));
      return <div style={{padding:24}}>
        <div className="list-bar" style={{display:'flex',gap:8,alignItems:'center'}}><Space size={8}>{外露}{更多按钮}</Space></div>
        <DataList 页="chip-test" 列={[{title:'名称',key:'name',常驻:true,render:(_,r)=>r.name},{title:'负责人',key:'owner',render:(_,r)=>r.owner}]} 行={行} 空库={false} 空态={{title:'空'}}/>
      </div>;
    }
    // 服务端分页（客户列表那种）：换筛选先进「加载中」、行和总数还是上一份，300ms 后新的一份才回来（照 useUrlFilters + router.replace）
    function 服务端页(){
      const [f,setF]=useState('');const [料,set料]=useState({owner:'',行:全部});const [等,set等]=useState(false);
      const 换=(v)=>{setF(v);set等(true);setTimeout(()=>{set料({owner:v,行:全部.filter(r=>!v||r.owner===v)});set等(false);},300);};
      return <div style={{padding:24}}>
        <div className="list-bar"><Select style={{width:150}} placeholder="全部负责人" allowClear aria-label="负责人" value={f||undefined} onChange={(v)=>换(v??'')} options={人们.map(x=>({value:x,label:x}))}/></div>
        <DataList 页="chip-srv" 列={[{title:'名称',key:'name',常驻:true,render:(_,r)=>r.name}]} 行={料.行.slice(0,20)} 空库={false} 空态={{title:'空'}} 加载中={等} 分页={{当前页:1,每页:20,总数:料.行.length,翻页(){}}}/>
      </div>;
    }
    createRoot(document.getElementById('root')).render(<MotionTheme><App>{location.search.includes('srv')?<服务端页/>:<页/>}</App></MotionTheme>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(宽 = 1280, 少动 = false, 服务端 = false): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 宽, height: 800 }, reducedMotion: 少动 ? "reduce" : "no-preference" });
  const page = await ctx.newPage(); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://chip.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto(`http://chip.test/customers${服务端 ? "?srv=1" : ""}`);
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.getByText("共 128 条").waitFor();
  return { page, errors };
}
const 选 = async (page: Page, 名: string, 值: string) => {
  await page.getByRole("combobox", { name: 名 }).click();
  // antd 下拉的 role=option 那份是给读屏的、看不见；点看得见的那一行（title 就是选项名）
  await page.getByTitle(值, { exact: true }).last().click();
};

const 总数字 = (page: Page) => page.getByText(/^共 \d+ 条$/).innerText();

it("选中：下拉变成「负责人：李想 ×」标签，× 不用悬停就看得见；点 × 清掉回到原来的下拉；不弹顶部提示", async () => {
  const { page, errors } = await 打开();
  const 原宽 = (await page.getByText("全部负责人").evaluate((e) => e.closest(".list-bar .ant-space-item")!.getBoundingClientRect().width));
  await 选(page, "负责人", "李想");
  // 标签是我们自己的类（cf-chip），只有正筛着的那一项有
  const 框 = () => page.locator(".cf-chip");
  await expect.poll(() => 框().textContent()).toBe("负责人：李想");
  expect(await 框().count()).toBe(1);
  await page.mouse.move(1200, 700);
  const 叉 = 框().getByRole("button", { name: /Clear|清除/ });
  expect(await 叉.evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
  expect(await 叉.isVisible()).toBe(true);
  // 标签跟着字宽，不是原来固定的 150
  const 宽 = (await 框().boundingBox())!.width;
  expect(宽).toBeLessThan(原宽);
  // 别的没选的还是原来的下拉
  expect(await page.getByText("全部阶段").isVisible()).toBe(true);
  await 叉.click();
  await expect.poll(() => 框().count()).toBe(0);
  await page.getByText("全部负责人").waitFor();
  expect(await page.getByText("全部负责人").evaluate((e) => e.closest(".list-bar .ant-space-item")!.getBoundingClientRect().width)).toBe(原宽);
  await expect.poll(() => 总数字(page), { timeout: 4000 }).toBe("共 128 条");
  expect(await page.locator(".ant-message-notice").count()).toBe(0);
  expect(errors).toEqual([]);
  await page.context().close();
});

it("点标签照旧弹出下拉换值；多选的、收在「更多筛选」里的不变标签", async () => {
  const { page, errors } = await 打开();
  await 选(page, "负责人", "李想");
  await 选(page, "负责人", "王一");
  await expect.poll(() => page.locator(".cf-chip").textContent()).toBe("负责人：王一");
  await 选(page, "标签", "甲");
  await page.keyboard.press("Escape");
  // 多选的不变标签：还是只有负责人那一枚
  expect(await page.locator(".cf-chip").count()).toBe(1);
  expect(await page.getByText("标签：").count()).toBe(0);
  expect(await page.getByRole("button", { name: /更多筛选/ }).count()).toBe(1);
  expect(errors).toEqual([]);
  await page.context().close();
});

/* 11-26：总数不滚了——滚的半路一路闪过的数哪个筛选都对不上（实操「客户来源 → 未填」1956 → 1512 → 1449 → … → 235）。
   换筛选：新数回来前留着旧数，回来直接换上，中间不出别的数；动态开着、减弱动态都一样 */
it("换筛选总数不闪别的数：旧数留到新数回来，直接换上（动态开着、减弱动态都是）", async () => {
  const { page, errors } = await 打开();
  // 记下这一段里出现过的数
  await page.evaluate(() => {
    const w = window as unknown as { __见: string[] };
    w.__见 = [];
    const 读 = () => { const t = [...document.querySelectorAll("li")].map((x) => x.textContent ?? "").find((x) => /^共 \d+ 条$/.test(x)); if (t && w.__见.at(-1) !== t) w.__见.push(t); requestAnimationFrame(读); };
    读();
  });
  await 选(page, "负责人", "李想");
  await expect.poll(() => 总数字(page), { timeout: 4000 }).toBe("共 23 条");
  await page.waitForTimeout(100);
  await page.waitForTimeout(500);
  const 见 = await page.evaluate(() => (window as unknown as { __见: string[] }).__见);
  expect(见, `出现过 ${见.join(" → ")}`).toEqual(["共 128 条", "共 23 条"]);
  expect(await page.locator(".list-total-n").evaluate((e) => getComputedStyle(e).fontVariantNumeric)).toBe("tabular-nums");
  expect(errors).toEqual([]);
  await page.context().close();

  const 少 = await 打开(1280, true);
  await 少.page.evaluate(() => {
    const w = window as unknown as { __见: string[] };
    w.__见 = [];
    const 读 = () => { const t = [...document.querySelectorAll("li")].map((x) => x.textContent ?? "").find((x) => /^共 \d+ 条$/.test(x)); if (t && w.__见.at(-1) !== t) w.__见.push(t); requestAnimationFrame(读); };
    读();
  });
  await 选(少.page, "负责人", "李想");
  await expect.poll(() => 总数字(少.page), { timeout: 4000 }).toBe("共 23 条");
  await 少.page.waitForTimeout(300);
  expect(await 少.page.evaluate(() => (window as unknown as { __见: string[] }).__见)).toEqual(["共 128 条", "共 23 条"]);
  expect(await 少.page.locator(".ant-select.cf-chip").evaluate((e) => getComputedStyle(e).scale)).toBe("none");
  expect(少.errors).toEqual([]);
  await 少.page.context().close();
});

it("服务端分页换筛选：加载那 300ms 里留着旧总数，新数回来直接换上，中间不出别的数", async () => {
  for (const 少动 of [false, true]) {
    const { page, errors } = await 打开(1280, 少动, true);
    await page.evaluate(() => {
      const w = window as unknown as { __见: string[] };
      w.__见 = [];
      const 读 = () => { const t = [...document.querySelectorAll("li")].map((x) => x.textContent ?? "").find((x) => /^共 \d+ 条$/.test(x)); if (t && w.__见.at(-1) !== t) w.__见.push(t); requestAnimationFrame(读); };
      读();
    });
    await 选(page, "负责人", "李想");
    await page.waitForTimeout(150);
    expect(await 总数字(page), "新数回来前留着旧数").toBe("共 128 条");
    await expect.poll(() => 总数字(page), { timeout: 4000 }).toBe("共 23 条");
    await page.waitForTimeout(500);
    const 见 = await page.evaluate(() => (window as unknown as { __见: string[] }).__见);
    expect(见, `出现过 ${见.join(" → ")}`).toEqual(["共 128 条", "共 23 条"]);
    expect(errors).toEqual([]);
    await page.context().close();
  }
});

it("1024 宽：长名字的标签不撑破筛选行、页面不横滚，标签不超过 280", async () => {
  const { page, errors } = await 打开(1024);
  await 选(page, "负责人", "欧阳长长长长名字的同事");
  const 负责人 = page.locator(".cf-chip");
  await expect.poll(() => 负责人.textContent()).toContain("负责人：");
  expect((await 负责人.boundingBox())!.width).toBeLessThanOrEqual(280);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
  await page.context().close();
});

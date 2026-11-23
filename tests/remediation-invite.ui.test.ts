import {afterAll,beforeAll,it,expect} from 'vitest';
import {build,type Plugin} from 'esbuild';
import path from 'node:path';
import {chromium,type Browser} from 'playwright';
let browser:Browser,bundle:string;
const plugin:Plugin={name:'turn-boundaries',setup(b){
 const stub=(filter:RegExp,code:string)=>b.onResolve({filter},a=>({path:a.path,namespace:'fixture',pluginData:code}));
 stub(/^next\/navigation$/,"export const useRouter=()=>({refresh(){}});");
 stub(/^next\/link$/,"export default function Link(p){return <a {...p}/>}");
 stub(/(^|\/)(ProposalCard|ProposalBatch|AiWait|StreamMarkdown|ResearchRun|ResearchPerson)$/,"export default function View(){return null};export function ResearchPick(){return null}");
 stub(/(^|\/)AiCost$/,"export default function Cost(){return null};export const useAiOutOfCredits=()=>false;");
 stub(/^@\/lib\/ai-jobs$/,"export const clearJob=()=>{},useJob=key=>key.startsWith('home:')?window.__job:null;");
 stub(/^@\/lib\/draft-jobs$/,"export const useCopyDraft=()=>()=>{},草稿键=(kind,id)=>kind+id,起草=(...args)=>window.__drafts.push(args);");
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.pluginData,loader:'jsx',resolveDir:process.cwd()}));
}};
beforeAll(async()=>{bundle=(await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{App}from'antd';import Turn from'@/app/(app)/dashboard/TurnView';import{BusinessProvider}from'@/lib/business-client';import{DEFAULT_BUSINESS,BUSINESS_PRESETS}from'@/lib/business-config';
 window.__drafts=[];const root=createRoot(document.getElementById('root'));window.__render=(status='已签约',trade=false)=>{window.__job={status:'done',value:{text:'',steps:[],answer:{text:'',customers:[{id:'qa-c',name:'QA客户',followStatus:status}],proposals:[],records:[]}}};const b={...(trade?BUSINESS_PRESETS['外贸出口']:DEFAULT_BUSINESS),statusLabels:{已签约:'已合作'}};root.render(<App><BusinessProvider value={b}><Turn turn={{id:'qa',question:'QA问题',kind:'ask',at:Date.now()}} onRetry={()=>{}} onRemove={()=>{}} onAsk={()=>{}} scrollOnMount={false}/></BusinessProvider></App>)};window.__render();`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic',alias:{'@':path.resolve('src')},define:{'process.env.NODE_ENV':'"production"'},plugins:[plugin],logLevel:'silent'})).outputFiles[0].text;browser=await chromium.launch()},120000);
afterAll(async()=>{await browser?.close()});
// HC-2b（#441）删了回答下面的客户卡片，转介绍邀请随卡片一起没了（企业版本来就不摆）；L-065 那条「签约状态换显示名还保留邀请」不再适用，改成哪种状态都没有邀请，客户名还在「涉及」一行里
it('HC-2b 起首页回答里没有转介绍邀请（已签 / 自定义显示名 / 未签 / 外贸都没有），客户名留在「涉及」一行',async()=>{
 const page=await browser.newPage();await page.route('http://invite.test/**',r=>r.fulfill({contentType:'text/html',body:"<meta charset='utf-8'><div id='root'></div>"}));await page.goto('http://invite.test');await page.addScriptTag({content:bundle});
 const invite=page.getByRole('button',{name:'起草转介绍邀请',exact:true});await page.locator('.cli-inv').waitFor();expect(await page.locator('.cli-inv').innerText()).toContain('QA客户');expect(await invite.count()).toBe(0);
 await page.evaluate(()=>Reflect.get(window,'__render')('已合作'));await page.locator('.cli-inv').waitFor();expect(await invite.count()).toBe(0);
 await page.evaluate(()=>Reflect.get(window,'__render')('跟进中'));await page.locator('.cli-inv').waitFor();expect(await invite.count()).toBe(0);
 await page.evaluate(()=>Reflect.get(window,'__render')('已签约',true));await page.locator('.cli-inv').waitFor();expect(await invite.count()).toBe(0);await page.close();
});

/**
 * 浏览器太旧时整页给提示（layout.tsx 的 <head>，登录页也走这份根 layout）。
 *
 * 起因：macOS Catalina 上的 Safari 15.6 打开，左栏能出、中间整块空白——Next 16 的打包产物只认
 * Chrome/Edge/Firefox 111、Safari 16.4 以上，低于这条线某些代码一解析就挂，React 那半起不来，又不报错。
 *
 * 判断只用特性检测，不认 UA 版本号（UA 能被飞书、企业微信这类内置浏览器改写）：
 * - RegExp 后行断言 `(?<=`：Safari 16.4 才有，正好卡住 Safari < 16.4（这次出事的就是它）；
 * - Array.prototype.findLast：Chrome 97 / Firefox 104 / Safari 15.4；
 * - structuredClone：Chrome 98 / Firefox 94 / Safari 15.4。
 * 任一不支持就判为太旧。新浏览器上三项全过、脚本直接返回，什么都不动，所以不影响首屏、也不会有水合差异。
 *
 * 脚本本身必须是 ES5（旧浏览器要能解析，tests/old-browser-notice.test.ts 用 acorn 按 ES5 校验）：
 * 后行断言只能用 new RegExp 字符串造，写成正则字面量的话旧 Safari 整段解析失败、提示也出不来。
 * 提示挂在 body 最前面、position:fixed 盖满整页；React 起不来时可能整页重渲染把它冲掉，所以每秒补挂一次。
 */
import { palette } from "./palette";

export const 旧浏览器提示节点 = "old-browser-notice";
export const 旧浏览器提示文案 = "浏览器版本太旧，页面打不开。请用 Chrome 打开本地址，或在飞书里打开。";
export const 旧浏览器提示小字 = "Safari 需 16.4 以上；Mac 系统较旧时请装 Chrome";

export const 旧浏览器提示脚本 = `(function(){try{var old=false;try{new RegExp("(?<=a)b");}catch(_){old=true;}if(!Array.prototype.findLast)old=true;if(typeof structuredClone!=="function")old=true;if(!old)return;var ID=${JSON.stringify(旧浏览器提示节点)};function line(tag,text,css){var e=document.createElement(tag);e.textContent=text;if(css)e.style.cssText=css;return e;}function put(){var b=document.body;if(!b)return false;if(document.getElementById(ID))return true;var d=document.createElement("div");d.id=ID;d.setAttribute("role","alert");d.style.cssText="position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:${palette.panel};color:${palette.ink};display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font:16px/1.7 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif;";var box=document.createElement("div");box.style.cssText="max-width:520px;";box.appendChild(line("p",${JSON.stringify(旧浏览器提示文案)},"margin:0 0 8px;font-size:18px;font-weight:600;"));box.appendChild(line("p",${JSON.stringify(旧浏览器提示小字)},"margin:0 0 16px;font-size:13px;color:${palette.textMuted};"));try{box.appendChild(line("p",location.protocol+"//"+location.host,"margin:0;font-size:14px;color:${palette.inkSoft};user-select:all;-webkit-user-select:all;word-break:break-all;"));}catch(_){}d.appendChild(box);b.insertBefore(d,b.firstChild);return true;}if(!put())document.addEventListener("DOMContentLoaded",put);setInterval(put,1000);}catch(_){}})();`;

/**
 * 定时分配（11-17，PR3）的服务端令牌：assign-actions.ts 是 "use server" 文件，导出的函数浏览器都能调。
 * 到点执行要的 定时分出去 带着这把令牌才干活：Symbol() 不能从浏览器序列化传进来，只有服务端 import 了这个模块的代码拿得到。
 */
export const 定时分配令牌: unique symbol = Symbol("定时分配");

/** 超时未跟进自动转（11-17，lib/enterprise/reply-overdue.ts）要的 超时转出 同样带一把，道理同上 */
export const 超时转令牌: unique symbol = Symbol("超时转");

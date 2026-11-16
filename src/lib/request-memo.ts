/**
 * 一次请求里同一样参考数据只读一遍（11-16 提速 F1：请求内去重，不跨请求）。
 *
 * 表靠 React cache()：服务端组件渲染时一次请求一份；渲染外（Server Action 执行、路由、后台、测试）react 给的是新表，等于不记，照旧现读。
 * 记下时带上库指纹（lib/home-cache 库指纹：-shm 的 WAL 索引头，任何进程、任何连接提交一笔都会变）：
 * 同一请求里前面写过库（哪怕是别的进程写的），指纹变了，后面再读就现读，不给写之前的旧值。
 * 拿不到指纹（不是 WAL、相对路径、托管版）时只在这一次请求里记，同 读组织、页面字典 那些 cache() 一样。
 * 记的值是同一份对象，调用方别改它
 */
import { cache } from "react";
import { 库指纹 } from "./home-cache";
import { multiTenant } from "./tenant/context";

type 条 = { 指纹: string | null; 值: Promise<unknown> };
const 本次 = cache(() => new Map<string, 条>());

/** 托管版每个工作区一个库，默认库的指纹说明不了什么（同 settings.ts 现指纹） */
const 现指纹 = (): string | null => (multiTenant() ? null : 库指纹());

/** key 在这一次请求里读过、而且之后库没变：给上次那一份；否则现读并记下。读失败不记（下一次照旧现读） */
export function 请求内记住<T>(key: string, 读: () => Promise<T>): Promise<T> {
  const 表 = 本次();
  // 先取指纹再读：读的过程中有人提交，记下的是旧指纹，下一次一比就现读
  const 指纹 = 现指纹();
  const 有 = 表.get(key);
  if (有 && 有.指纹 === 指纹) return 有.值 as Promise<T>;
  const 值 = 读();
  表.set(key, { 指纹, 值 });
  值.catch(() => {
    if (表.get(key)?.值 === 值) 表.delete(key);
  });
  return 值;
}

/** 这一次请求里记着的都不要了（拿不到库指纹的环境里，写过库之后马上要读新值时用） */
export function 忘掉请求内记住的(): void {
  本次().clear();
}

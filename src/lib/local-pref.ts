"use client";

/**
 * 存在这台机器上的小偏好（列表页显示哪几列等）；lib/list-keep.ts 的 useListKeep 是同一套、记在这个标签页里（列表筛选）。
 *
 * 为什么不是 useState + useEffect 读一遍：那样等于在 effect 里 setState，
 * 会多渲染一轮，服务端渲染出来的还是默认那套、水合之后再跳一下。
 * useSyncExternalStore 天生分服务端快照和客户端快照，水合时用前者，之后用后者，
 * 既不会警告不一致，也不会闪一下。
 *
 * 读不到、存不下、存进去的是坏 JSON——都当没存过，回到默认值。
 * 这里放的东西必须是「丢了也不影响用」的：真正要留住的状态不该在浏览器本地。
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { 清列表记忆 } from "./list-return";

const listeners = new Set<() => void>();
/** 按 key 缓存上一次解析的结果：getSnapshot 每次都要返回同一个引用，否则会无限重渲 */
const cache = new Map<string, { raw: string | null; value: unknown }>();
/** 存不进去时（隐私模式、配额满）退到内存里，至少这一次点的还算数 */
const memory = new Map<string, unknown>();

/** local = 这台机器一直记着（列设置）；session = 这个标签页记着，刷新还在、关了就没（列表筛选，29R） */
export type 存处 = "local" | "session";
const 库 = (处: 存处): Storage => (处 === "session" ? sessionStorage : localStorage);

/** 内存兜底和解析缓存里的键：两处同名的键不串（local 的照旧用原键） */
const 缓存键 = (处: 存处, key: string) => (处 === "local" ? key : `${处}:${key}`);

function read<T>(处: 存处, key: string, fallback: T): T {
  const 键 = 缓存键(处, key);
  if (memory.has(键)) return memory.get(键) as T;
  let raw: string | null = null;
  try {
    raw = 库(处).getItem(key);
  } catch {
    /* 隐私模式下会抛，当没存过 */
  }
  const hit = cache.get(键);
  if (hit && hit.raw === raw) return hit.value as T;
  let value = fallback;
  if (raw) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = fallback;
    }
  }
  cache.set(键, { raw, value });
  return value;
}

export function useLocalPref<T>(key: string, fallback: T): [T, (v: T) => void] {
  return usePref("local", key, fallback);
}

/** 删一个键（存储 + 内存兜底 + 解析缓存）；给 lib/list-keep.ts 用 */
export function 删(处: 存处, key: string) {
  const 键 = 缓存键(处, key);
  memory.delete(键);
  cache.delete(键);
  try {
    库(处).removeItem(key);
  } catch {
    /* 存储被禁：内存清过了 */
  }
}

/** 退出时清掉会话里记的列表筛选（内存兜底和解析缓存；sessionStorage 那边由 lib/list-return.ts 清列表记忆 按前缀清） */
export function 清会话偏好() {
  for (const k of [...memory.keys()]) if (k.startsWith("session:")) memory.delete(k);
  for (const k of [...cache.keys()]) if (k.startsWith("session:")) cache.delete(k);
  listeners.forEach((l) => l());
}

/** 换人时（退出、会话过期跳登录、演示换人、视图换人）把这个标签页里列表记的东西全清：sessionStorage 按前缀 + 这边的内存和缓存 */
export function 清本页列表记忆() {
  清列表记忆();
  清会话偏好();
}

/** 登录页挂上时清一次：会话过期被弹回登录、别的路子换了人，都不走「退出」，上一个人的列表记忆照样不留（#381 复审） */
export function useLoginClearsListMemory() {
  useEffect(() => 清本页列表记忆(), []);
}

/** 给 lib/list-keep.ts 用（useListKeep 记在 session） */
export function usePref<T>(处: 存处, key: string, fallback: T): [T, (v: T) => void] {
  const subscribe = useCallback((l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  const 值 = useSyncExternalStore(
    subscribe,
    () => read(处, key, fallback),
    () => fallback,
  );
  const 写 = useCallback(
    (v: T) => {
      const 键 = 缓存键(处, key);
      try {
        库(处).setItem(key, JSON.stringify(v));
        memory.delete(键);
      } catch {
        // 存不进去就退到内存：这次会话里还算数，换个标签页就没了
        memory.set(键, v);
      }
      cache.delete(键);
      listeners.forEach((l) => l());
    },
    [处, key],
  );
  return useMemo<[T, (v: T) => void]>(() => [值, 写], [值, 写]);
}

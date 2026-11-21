import { useSyncExternalStore } from 'react';

/** A tiny global store, enough for auth and language. */
export function create<T extends object>(init: (set: (p: Partial<T>) => void, get: () => T) => T) {
  let state: T;
  const subs = new Set<() => void>();
  const set = (p: Partial<T>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
  const get = () => state;
  state = init(set, get);
  const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
  function useStore<U>(sel: (s: T) => U): U {
    return useSyncExternalStore(subscribe, () => sel(state), () => sel(state));
  }
  return Object.assign(useStore, { getState: get, setState: set });
}

import { ref, shallowRef, watch, type Ref, type WatchSource } from "vue";

/**
 * Loads data and reloads when any dependency changes. Stale responses from
 * earlier calls are dropped so fast filter changes never show old data.
 */
export function useLoader<T>(fn: () => Promise<T>, deps: WatchSource[] = [], opts: { immediate?: boolean } = {}) {
  const data = shallowRef<T | null>(null) as Ref<T | null>;
  const loading = ref(false);
  const error = ref<string | null>(null);
  let seq = 0;

  async function reload() {
    const id = ++seq;
    loading.value = true;
    error.value = null;
    try {
      const r = await fn();
      if (id === seq) data.value = r;
    } catch (e) {
      if (id === seq) error.value = (e as Error).message;
    } finally {
      if (id === seq) loading.value = false;
    }
  }

  if (deps.length) watch(deps, reload, { deep: true });
  if (opts.immediate !== false) reload();
  return { data, loading, error, reload };
}

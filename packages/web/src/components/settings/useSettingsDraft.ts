import { computed, onMounted, ref, type Ref } from "vue";
import { t } from "@/i18n";
import { api, withToast } from "@/lib/api";
import type { Settings } from "@/lib/types";

/**
 * Loads /settings and keeps an editable draft of one slice of it.
 * `pick` extracts the editable slice, `toPatch` turns the draft into a deep-partial
 * patch for PUT /settings. `dirty` compares the draft with the last saved slice.
 */
export function useSettingsDraft<T>(pick: (s: Settings) => T, toPatch: (draft: T) => Record<string, unknown>, successMessage: string | (() => string) = () => t("settings.saved"), opts: { immediate?: boolean } = {}) {
  const current = ref<Settings | null>(null) as Ref<Settings | null>;
  const draft = ref<T | null>(null) as Ref<T | null>;
  const snapshot = ref("");
  const loading = ref(opts.immediate !== false);
  const saving = ref(false);
  const error = ref<string | null>(null);

  function apply(s: Settings) {
    const slice = pick(s);
    current.value = s;
    snapshot.value = JSON.stringify(slice);
    draft.value = JSON.parse(snapshot.value) as T;
  }

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      apply(await api.get<Settings>("/settings"));
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }

  async function save(): Promise<boolean> {
    if (!draft.value) return false;
    saving.value = true;
    try {
      const patch = toPatch(draft.value);
      const r = await withToast(() => api.put<Settings>("/settings", patch), typeof successMessage === "function" ? successMessage() : successMessage);
      if (r) apply(r);
      return !!r;
    } finally {
      saving.value = false;
    }
  }

  function reset() {
    if (current.value) apply(current.value);
  }

  const dirty = computed(() => draft.value !== null && JSON.stringify(draft.value) !== snapshot.value);

  if (opts.immediate !== false) onMounted(load);
  return { current, draft, loading, saving, error, dirty, load, save, reset, apply };
}

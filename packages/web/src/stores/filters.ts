import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

export const RANGES = [
  { days: 7, labelKey: "common.range.d7" },
  { days: 30, labelKey: "common.range.d30" },
  { days: 90, labelKey: "common.range.d90" },
  { days: 180, labelKey: "common.range.d180" },
  { days: 365, labelKey: "common.range.d365" },
] as const;

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Global time range shared by dashboard, domain and source views. */
export const useFilters = defineStore("filters", () => {
  const days = ref<number>(read("filters.days", 30));
  watch(days, (v) => {
    try {
      localStorage.setItem("filters.days", JSON.stringify(v));
    } catch {
      /* private mode */
    }
  });
  const query = computed(() => ({ days: days.value }));
  return { days, query };
});

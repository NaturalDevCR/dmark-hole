import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

export const RANGES = [
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
  { days: 90, label: "90 días" },
  { days: 180, label: "6 meses" },
  { days: 365, label: "1 año" },
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

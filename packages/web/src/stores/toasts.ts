import { defineStore } from "pinia";
import { ref } from "vue";

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
}

export const useToasts = defineStore("toasts", () => {
  const items = ref<Toast[]>([]);
  let seq = 0;
  function push(kind: Toast["kind"], message: string, ms = kind === "error" ? 7000 : 3500) {
    const id = ++seq;
    items.value.push({ id, kind, message });
    setTimeout(() => dismiss(id), ms);
  }
  function dismiss(id: number) {
    items.value = items.value.filter((t) => t.id !== id);
  }
  return { items, push, dismiss };
});

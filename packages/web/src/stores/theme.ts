import { defineStore } from "pinia";
import { ref } from "vue";

export const useTheme = defineStore("theme", () => {
  const dark = ref(document.documentElement.classList.contains("dark"));
  function toggle() {
    dark.value = !dark.value;
    document.documentElement.classList.toggle("dark", dark.value);
    try {
      localStorage.setItem("theme", dark.value ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }
  return { dark, toggle };
});

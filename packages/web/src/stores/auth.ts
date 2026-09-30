import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";

export const useAuth = defineStore("auth", () => {
  const user = ref<User | null>(null);
  const setupRequired = ref(false);
  const version = ref("");
  const loaded = ref(false);

  async function refresh() {
    const s = await api.get<{ setupRequired: boolean; user: User | null; version: string }>("/auth/status");
    user.value = s.user;
    setupRequired.value = s.setupRequired;
    version.value = s.version;
    loaded.value = true;
  }

  async function login(email: string, password: string) {
    await api.post("/auth/login", { email, password });
    await refresh();
  }

  async function setup(name: string, email: string, password: string) {
    await api.post("/auth/setup", { name, email, password });
    await refresh();
  }

  async function logout() {
    await api.post("/auth/logout").catch(() => undefined);
    user.value = null;
  }

  const isAdmin = computed(() => user.value?.role === "admin");
  return { user, setupRequired, version, loaded, isAdmin, refresh, login, setup, logout };
});

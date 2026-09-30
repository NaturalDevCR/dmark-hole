import { defineStore } from "pinia";
import { ref, computed } from "vue";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string;
}

export const useAuthStore = defineStore("auth", () => {
  const token = ref<string | null>(null);
  const user = ref<User | null>(null);
  const loading = ref(false);

  const isAuthenticated = computed(() => !!token.value);
  const isOrgAdmin = computed(() => user.value?.role === "ORG_ADMIN" || user.value?.role === "SUPER_ADMIN");

  function setToken(t: string) {
    token.value = t;
    localStorage.setItem("token", t);
  }

  function clearAuth() {
    token.value = null;
    user.value = null;
    localStorage.removeItem("token");
  }

  async function fetchUser() {
    if (!token.value) return;
    try {
      const res = await fetch("/api/v1/auth/me", {
        headers: { Authorization: `Bearer ${token.value}` },
      });
      if (res.ok) {
        const data = await res.json();
        user.value = data.data;
      } else {
        clearAuth();
      }
    } catch {
      clearAuth();
    }
  }

  async function login(email: string, password: string) {
    loading.value = true;
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error("Invalid credentials");
      const data = await res.json();
      setToken(data.data.token);
      user.value = data.data.user;
      return true;
    } catch {
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function register(payload: {
    email: string;
    password: string;
    name: string;
    organizationName: string;
    organizationSlug: string;
  }) {
    loading.value = true;
    try {
      const res = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Registration failed");
      const data = await res.json();
      setToken(data.data.token);
      user.value = data.data.user;
      return true;
    } catch {
      return false;
    } finally {
      loading.value = false;
    }
  }

  function logout() {
    clearAuth();
    window.location.href = "/login";
  }

  return { token, user, loading, isAuthenticated, isOrgAdmin, setToken, clearAuth, fetchUser, login, register, logout };
});

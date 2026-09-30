import { ref } from "vue";
import { useAuthStore } from "@/stores/auth";

const API_BASE = "/api/v1";

export function useApi() {
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function request<T>(path: string, options: RequestInit = {}): Promise<T | null> {
    loading.value = true;
    error.value = null;

    const auth = useAuthStore();
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    if (auth.token) {
      headers.Authorization = `Bearer ${auth.token}`;
    }

    if (!(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
      });

      if (res.status === 401) {
        auth.clearAuth();
        throw new Error("Session expired");
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Request failed");
      }

      return data as T;
    } catch (e) {
      error.value = (e as Error).message;
      return null;
    } finally {
      loading.value = false;
    }
  }

  return {
    loading,
    error,
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
    patch: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
    delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  };
}

import { currentLocale } from "@/i18n";
import { useToasts } from "@/stores/toasts";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function qs(query?: Query): string {
  if (!query) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  // x-locale lets the server translate errors, DNS checks, recommendations and alerts.
  const init: RequestInit = { method, credentials: "same-origin", headers: { "x-locale": currentLocale() } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  const res = await fetch(`/api${path}${qs(query)}`, init);
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized && !path.startsWith("/auth/")) onUnauthorized();
    const msg = (data && typeof data === "object" && "error" in data ? String(data.error) : null) ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, data?.issues);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>("GET", path, undefined, query),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  del: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, form),
  url: (path: string, query?: Query) => `/api${path}${qs(query)}`,
};

/** Wraps an action with a toast on error (and optionally on success). */
export async function withToast<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
  const toasts = useToasts();
  try {
    const r = await fn();
    if (success) toasts.push("success", success);
    return r;
  } catch (err) {
    const e = err as ApiError;
    const detail = e.issues?.map((i) => `${i.path}: ${i.message}`).join(" · ");
    toasts.push("error", detail ? `${e.message} — ${detail}` : e.message);
    return undefined;
  }
}

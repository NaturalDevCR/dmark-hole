<template>
  <div class="space-y-6 max-w-2xl">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">Settings</h1>
      <p class="text-sm text-muted-foreground">Organization and user settings</p>
    </div>

    <!-- Profile -->
    <div class="rounded-lg border bg-card p-6">
      <h3 class="text-sm font-semibold mb-4">Profile</h3>
      <div class="space-y-3">
        <div>
          <label class="text-xs text-muted-foreground">Name</label>
          <p class="text-sm">{{ auth.user?.name }}</p>
        </div>
        <div>
          <label class="text-xs text-muted-foreground">Email</label>
          <p class="text-sm">{{ auth.user?.email }}</p>
        </div>
        <div>
          <label class="text-xs text-muted-foreground">Role</label>
          <p class="text-sm">{{ auth.user?.role }}</p>
        </div>
      </div>
    </div>

    <!-- API Keys -->
    <div class="rounded-lg border bg-card p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-semibold">API Keys</h3>
        <button @click="createKey" class="rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
          <Key class="mr-1 inline h-3 w-3" /> New Key
        </button>
      </div>
      <div v-if="!keys.length" class="text-xs text-muted-foreground">No API keys created</div>
      <div v-for="k in keys" :key="k.id" class="flex items-center justify-between py-2 border-b text-sm">
        <div>
          <p class="font-medium">{{ k.name }}</p>
          <p class="text-xs text-muted-foreground">Scopes: {{ k.scopes?.join(", ") }}</p>
        </div>
        <button @click="revokeKey(k.id)" class="text-xs text-red-500 hover:underline">Revoke</button>
      </div>
    </div>

    <!-- Users -->
    <div class="rounded-lg border bg-card p-6" v-if="auth.isOrgAdmin">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-semibold">Team Members</h3>
        <button @click="showInvite = true" class="rounded-md border px-3 py-1.5 text-xs hover:bg-accent">Invite</button>
      </div>
      <div v-for="u in users" :key="u.id" class="flex items-center justify-between py-2 border-b text-sm">
        <div>
          <p class="font-medium">{{ u.name }}</p>
          <p class="text-xs text-muted-foreground">{{ u.email }} · {{ u.role }}</p>
        </div>
        <span :class="['rounded-full px-2 py-0.5 text-xs', u.active ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500']">{{ u.active ? "Active" : "Inactive" }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useApi } from "@/composables/useApi";
import { useAuthStore } from "@/stores/auth";
import { Key } from "lucide-vue-next";

const api = useApi();
const auth = useAuthStore();

const keys = ref<Array<{ id: string; name: string; scopes: string[] }>>([]);
const users = ref<Array<{ id: string; name: string; email: string; role: string; active: boolean }>>([]);
const showInvite = ref(false);

async function load() {
  const [k, u] = await Promise.all([
    api.get<{ data: typeof keys.value }>("/api-keys"),
    api.get<{ data: typeof users.value }>(`/organizations/${auth.user?.organizationId}/users`),
  ]);
  if (k) keys.value = k.data;
  if (u) users.value = u.data;
}

async function createKey() {
  const res = await api.post<{ data: { key: string } }>("/api-keys", { name: "Dashboard Key", scopes: ["read", "write"] });
  if (res?.data?.key) {
    navigator.clipboard.writeText(res.data.key);
    alert("API key copied to clipboard!");
  }
  load();
}

async function revokeKey(id: string) {
  await api.delete(`/api-keys/${id}`);
  load();
}

onMounted(load);
</script>

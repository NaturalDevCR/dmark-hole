<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Domains</h1>
        <p class="text-sm text-muted-foreground">Manage monitored domains</p>
      </div>
      <button
        v-if="auth.isOrgAdmin"
        @click="showAddDomain = true"
        class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        <Plus class="mr-1 inline h-4 w-4" /> Add Domain
      </button>
    </div>

    <!-- Add Domain Modal -->
    <div v-if="showAddDomain" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="showAddDomain = false">
      <div class="w-full max-w-md rounded-lg border bg-card p-6">
        <h2 class="mb-4 text-lg font-semibold">Add Domain</h2>
        <form @submit.prevent="addDomain" class="space-y-4">
          <div>
            <label class="mb-1 block text-sm font-medium">Domain Name</label>
            <input v-model="newDomain" required placeholder="example.com" class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div class="flex gap-2 justify-end">
            <button type="button" @click="showAddDomain = false" class="rounded-md border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" :disabled="loading" class="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">
              {{ loading ? "Adding..." : "Add Domain" }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Domain Table -->
    <div class="rounded-lg border">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b bg-muted/50">
              <th class="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Domain</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Health</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-muted-foreground">DMARC</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-muted-foreground">SPF</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-muted-foreground">DKIM</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Status</th>
              <th class="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in domains" :key="d.id" class="border-b hover:bg-muted/30">
              <td class="px-4 py-3">
                <p class="text-sm font-medium">{{ d.domain }}</p>
                <p class="text-xs text-muted-foreground">{{ d.monitoringMode }}</p>
              </td>
              <td class="px-4 py-3">
                <div class="flex items-center gap-2">
                  <div :class="['h-2 w-2 rounded-full', scoreColor(d.healthScore)]" />
                  <span class="text-sm font-mono">{{ d.healthScore || 0 }}%</span>
                </div>
              </td>
              <td class="px-4 py-3">
                <span :class="['inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', d.dmarcPolicy === 'REJECT' ? 'bg-green-500/10 text-green-500' : d.dmarcPolicy === 'QUARANTINE' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-red-500/10 text-red-500']">
                  {{ d.dmarcPolicy || "NONE" }}
                </span>
              </td>
              <td class="px-4 py-3">
                <span class="inline-flex items-center gap-1 text-xs">
                  <CheckCircle2 v-if="d.hasSpf" class="h-3 w-3 text-green-500" />
                  <XCircle v-else class="h-3 w-3 text-red-500" />
                </span>
              </td>
              <td class="px-4 py-3">
                <span class="inline-flex items-center gap-1 text-xs">
                  <CheckCircle2 v-if="d.hasDkim" class="h-3 w-3 text-green-500" />
                  <XCircle v-else class="h-3 w-3 text-red-500" />
                </span>
              </td>
              <td class="px-4 py-3">
                <span :class="['inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', d.active ? 'bg-green-500/10 text-green-500' : 'bg-muted text-muted-foreground']">
                  {{ d.active ? "Active" : "Inactive" }}
                </span>
              </td>
              <td class="px-4 py-3 text-right">
                <router-link :to="`/domains/${d.id}`" class="text-xs font-medium text-primary hover:underline">View</router-link>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="!domains.length" class="p-12 text-center">
        <Globe class="mx-auto h-8 w-8 text-muted-foreground" />
        <p class="mt-2 text-sm text-muted-foreground">No domains added yet</p>
        <p class="text-xs text-muted-foreground">Add your first domain to start monitoring</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useApi } from "@/composables/useApi";
import { useAuthStore } from "@/stores/auth";
import { Plus, CheckCircle2, XCircle, Globe } from "lucide-vue-next";

const api = useApi();
const auth = useAuthStore();

interface DomainItem {
  id: string;
  domain: string;
  healthScore: number;
  dmarcPolicy: string;
  hasSpf: boolean;
  hasDkim: boolean;
  active: boolean;
  monitoringMode: string;
}

const domains = ref<DomainItem[]>([]);
const showAddDomain = ref(false);
const newDomain = ref("");
const loading = ref(false);

function scoreColor(s: number) {
  if (s >= 80) return "bg-green-500";
  if (s >= 60) return "bg-yellow-500";
  return "bg-red-500";
}

async function loadDomains() {
  const res = await api.get<{ data: DomainItem[] }>("/domains");
  if (res) domains.value = res.data;
}

async function addDomain() {
  loading.value = true;
  await api.post("/domains", { domain: newDomain.value });
  showAddDomain.value = false;
  newDomain.value = "";
  loading.value = false;
  await loadDomains();
}

onMounted(loadDomains);
</script>

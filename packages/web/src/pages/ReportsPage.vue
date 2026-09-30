<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">Reports & Exports</h1>
      <p class="text-sm text-muted-foreground">DMARC reports, exports, and data downloads</p>
    </div>

    <div class="grid gap-4 md:grid-cols-3">
      <button @click="exportReport('DMARC_REPORT', 'CSV')" class="rounded-lg border bg-card p-4 text-left hover:bg-accent">
        <FileText class="h-5 w-5 mb-2" />
        <p class="text-sm font-medium">DMARC Reports (CSV)</p>
        <p class="text-xs text-muted-foreground">Export full DMARC report data</p>
      </button>
      <button @click="exportReport('SUMMARY', 'JSON')" class="rounded-lg border bg-card p-4 text-left hover:bg-accent">
        <BarChart3 class="h-5 w-5 mb-2" />
        <p class="text-sm font-medium">Summary (JSON)</p>
        <p class="text-xs text-muted-foreground">Daily summarized metrics</p>
      </button>
      <button @click="exportReport('ALERTS', 'CSV')" class="rounded-lg border bg-card p-4 text-left hover:bg-accent">
        <AlertTriangle class="h-5 w-5 mb-2" />
        <p class="text-sm font-medium">Alerts (CSV)</p>
        <p class="text-xs text-muted-foreground">Alert history export</p>
      </button>
    </div>

    <div class="rounded-lg border bg-card p-6">
      <h3 class="text-sm font-semibold mb-3">Recent Exports</h3>
      <div v-if="!exports.length" class="text-xs text-muted-foreground">No exports yet</div>
      <div v-for="exp in exports" :key="exp.id" class="flex items-center justify-between py-2 border-b text-sm">
        <span>{{ exp.type }} ({{ exp.format }})</span>
        <span :class="statusColor(exp.status)">{{ exp.status }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useApi } from "@/composables/useApi";
import { FileText, BarChart3, AlertTriangle } from "lucide-vue-next";

const api = useApi();
const exports = ref<Array<{ id: string; type: string; format: string; status: string }>>([]);

function statusColor(s: string) {
  if (s === "COMPLETED") return "text-green-500";
  if (s === "FAILED") return "text-red-500";
  return "text-yellow-500";
}

async function exportReport(type: string, format: string) {
  await api.post("/reports/export", { type, format });
  load();
}

async function load() {
  const res = await api.get<{ data: typeof exports.value }>("/reports/exports");
  if (res) exports.value = res.data;
}

onMounted(load);
</script>

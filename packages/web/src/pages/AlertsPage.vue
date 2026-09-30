<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Alerts</h1>
        <p class="text-sm text-muted-foreground">{{ summary?.totalOpen || 0 }} open alerts</p>
      </div>
      <button @click="acknowledgeAll()" class="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">
        <CheckCheck class="mr-1 inline h-4 w-4" /> Acknowledge All
      </button>
    </div>

    <!-- Summary Cards -->
    <div class="grid gap-4 md:grid-cols-3" v-if="summary">
      <div class="rounded-lg border bg-card p-4">
        <p class="text-xs text-muted-foreground">Critical</p>
        <p class="text-2xl font-bold text-red-500">{{ summary.bySeverity?.find(s => s.severity === "CRITICAL")?.count || 0 }}</p>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <p class="text-xs text-muted-foreground">Warning</p>
        <p class="text-2xl font-bold text-yellow-500">{{ summary.bySeverity?.find(s => s.severity === "WARNING")?.count || 0 }}</p>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <p class="text-xs text-muted-foreground">Info</p>
        <p class="text-2xl font-bold text-blue-500">{{ summary.bySeverity?.find(s => s.severity === "INFO")?.count || 0 }}</p>
      </div>
    </div>

    <!-- Alert List -->
    <div class="space-y-2">
      <div
        v-for="alert in alerts"
        :key="alert.id"
        class="flex items-start gap-3 rounded-lg border p-4"
        :class="alert.acknowledged ? 'opacity-60' : ''"
      >
        <div class="mt-0.5">
          <AlertTriangle v-if="alert.severity === 'CRITICAL'" class="h-5 w-5 text-red-500" />
          <AlertCircle v-else-if="alert.severity === 'WARNING'" class="h-5 w-5 text-yellow-500" />
          <Info v-else class="h-5 w-5 text-blue-500" />
        </div>
        <div class="flex-1">
          <div class="flex items-center gap-2">
            <p class="text-sm font-medium">{{ alert.title }}</p>
            <span :class="severityBadge(alert.severity)" class="rounded-full px-2 py-0.5 text-xs font-medium">
              {{ alert.severity }}
            </span>
            <span class="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{{ alert.type }}</span>
          </div>
          <p class="mt-1 text-sm text-muted-foreground">{{ alert.description }}</p>
          <div class="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span>{{ alert.domain }}</span>
            <span>{{ formatDate(alert.createdAt) }}</span>
          </div>
        </div>
        <div class="flex gap-1">
          <button v-if="!alert.acknowledged" @click="ack(alert.id)" class="rounded-md p-1.5 hover:bg-accent" title="Acknowledge">
            <CheckCircle2 class="h-4 w-4" />
          </button>
          <button v-if="!alert.resolved" @click="resolve(alert.id)" class="rounded-md p-1.5 hover:bg-accent" title="Resolve">
            <CheckCheck class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="!alerts.length" class="rounded-lg border p-12 text-center">
      <CheckCircle2 class="mx-auto h-8 w-8 text-green-500" />
      <p class="mt-2 text-sm">No open alerts</p>
      <p class="text-xs text-muted-foreground">Everything looks good!</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useApi } from "@/composables/useApi";
import { AlertTriangle, AlertCircle, Info, CheckCircle2, CheckCheck } from "lucide-vue-next";

const api = useApi();

interface AlertItem {
  id: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  domain: string;
  acknowledged: boolean;
  resolved: boolean;
  createdAt: string;
}

interface Summary {
  totalOpen: number;
  totalCritical: number;
  bySeverity: Array<{ severity: string; count: number }>;
}

const alerts = ref<AlertItem[]>([]);
const summary = ref<Summary | null>(null);

function severityBadge(sev: string) {
  if (sev === "CRITICAL") return "bg-red-500/10 text-red-500";
  if (sev === "WARNING") return "bg-yellow-500/10 text-yellow-500";
  return "bg-blue-500/10 text-blue-500";
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function loadAlerts() {
  const [a, s] = await Promise.all([
    api.get<{ data: AlertItem[] }>("/alerts?pageSize=50"),
    api.get<{ data: Summary }>("/alerts/summary"),
  ]);
  if (a) alerts.value = a.data;
  if (s) summary.value = s.data;
}

async function ack(id: string) {
  await api.patch(`/alerts/${id}/acknowledge`);
  loadAlerts();
}

async function resolve(id: string) {
  await api.patch(`/alerts/${id}/resolve`);
  loadAlerts();
}

async function acknowledgeAll() {
  await api.post("/alerts/acknowledge-all", {});
  loadAlerts();
}

onMounted(loadAlerts);
</script>

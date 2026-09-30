<script setup lang="ts">
import { CheckCheck, Check, Bell, Info, OctagonAlert, Trash2, TriangleAlert } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { computed, ref, watch, type Component } from "vue";
import Badge from "@/components/ui/Badge.vue";
import Confirm from "@/components/ui/Confirm.vue";
import Empty from "@/components/ui/Empty.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import Pagination from "@/components/ui/Pagination.vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import Spinner from "@/components/ui/Spinner.vue";
import { api, withToast } from "@/lib/api";
import { ago, date, num } from "@/lib/format";
import type { Alert, Paged } from "@/lib/types";
import { useLoader } from "@/lib/useLoader";
import { useAuth } from "@/stores/auth";

const PAGE_SIZE = 20;
const { isAdmin } = storeToRefs(useAuth());
const filter = ref<"all" | "unread">("all");
const page = ref(1);

const { data, loading, error, reload } = useLoader(
  // The server coerces `unread` with z.coerce.boolean-like parsing, so only send it when filtering.
  () => api.get<Paged<Alert> & { unread: number }>("/alerts", { page: page.value, pageSize: PAGE_SIZE, ...(filter.value === "unread" ? { unread: 1 } : {}) }),
  [page, filter],
);
watch(filter, () => (page.value = 1));

const unread = computed(() => data.value?.unread ?? 0);

const SEVERITY: Record<Alert["severity"], { label: string; icon: Component; box: string; tone: "fail" | "misaligned" | "forwarded" }> = {
  critical: { label: "Crítica", icon: OctagonAlert, box: "bg-fail-soft text-fail", tone: "fail" },
  warning: { label: "Advertencia", icon: TriangleAlert, box: "bg-misaligned-soft text-misaligned", tone: "misaligned" },
  info: { label: "Informativa", icon: Info, box: "bg-forwarded-soft text-forwarded", tone: "forwarded" },
};
const TYPE_LABEL: Record<string, string> = {
  new_failing_source: "Fuente nueva",
  compliance_drop: "Cumplimiento",
  forensic_report: "Forense",
  dns_change: "Cambio DNS",
};

const ipOf = (a: Alert) => (a.type === "new_failing_source" && typeof a.data?.ip === "string" ? a.data.ip : null);

const busy = ref<number | null>(null);
async function markRead(a: Alert) {
  busy.value = a.id;
  try {
    if (await withToast(() => api.post(`/alerts/${a.id}/read`))) reload();
  } finally {
    busy.value = null;
  }
}

const markingAll = ref(false);
async function markAll() {
  markingAll.value = true;
  try {
    if (await withToast(() => api.post("/alerts/read-all"), "Todas las alertas marcadas como leídas")) reload();
  } finally {
    markingAll.value = false;
  }
}

const removing = ref<Alert | null>(null);
async function remove() {
  const a = removing.value;
  removing.value = null;
  if (a && (await withToast(() => api.del(`/alerts/${a.id}`), "Alerta eliminada"))) {
    // Step back a page when the last item of a later page was removed.
    if (data.value && data.value.items.length === 1 && page.value > 1) page.value--;
    else reload();
  }
}
</script>

<template>
  <PageHeader title="Alertas" subtitle="Eventos que requieren su atención: fuentes sospechosas, caídas de cumplimiento y cambios DNS">
    <button class="btn-secondary" :disabled="markingAll || !unread" @click="markAll"><Spinner v-if="markingAll" /><CheckCheck v-else class="size-4" />Marcar todas como leídas</button>
  </PageHeader>

  <div class="mb-4 flex gap-1.5">
    <button
      class="rounded-full border px-3 py-1 text-xs font-medium transition"
      :class="filter === 'all' ? 'border-brand bg-brand-soft text-brand' : 'border-line-strong bg-surface text-muted hover:bg-subtle hover:text-fg'"
      @click="filter = 'all'"
    >
      Todas
    </button>
    <button
      class="rounded-full border px-3 py-1 text-xs font-medium transition"
      :class="filter === 'unread' ? 'border-brand bg-brand-soft text-brand' : 'border-line-strong bg-surface text-muted hover:bg-subtle hover:text-fg'"
      @click="filter = 'unread'"
    >
      No leídas<span v-if="unread" class="ml-1.5 tabular-nums">{{ num(unread) }}</span>
    </button>
  </div>

  <div v-if="!data && loading" class="space-y-3"><Skeleton v-for="i in 4" :key="i" class="h-24" /></div>
  <p v-else-if="error" class="text-sm text-fail">{{ error }}</p>
  <div v-else-if="data && !data.items.length" class="card">
    <Empty
      :icon="Bell"
      :title="filter === 'unread' ? 'No tiene alertas sin leer' : 'Aún no hay alertas'"
      :description="filter === 'unread' ? 'Está al día. Las nuevas alertas aparecerán aquí.' : 'Se generan automáticamente cuando aparece una fuente sospechosa, cae el cumplimiento o cambia la configuración DNS. Puede ajustar las reglas en Configuración.'"
    >
      <RouterLink v-if="filter === 'all'" to="/settings?tab=alerts" class="btn-secondary">Configurar alertas</RouterLink>
      <button v-else class="btn-secondary" @click="filter = 'all'">Ver todas</button>
    </Empty>
  </div>

  <template v-else-if="data">
    <ul class="space-y-3">
      <li v-for="a in data.items" :key="a.id" class="card flex gap-4 p-4 transition" :class="a.readAt ? 'opacity-80' : ''">
        <span class="grid size-10 shrink-0 place-items-center rounded-lg" :class="SEVERITY[a.severity].box"><component :is="SEVERITY[a.severity].icon" class="size-5" /></span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span v-if="!a.readAt" class="size-2 shrink-0 rounded-full bg-brand" title="Sin leer" />
            <h3 class="text-sm" :class="a.readAt ? 'font-medium' : 'font-semibold'">{{ a.title }}</h3>
            <Badge :tone="SEVERITY[a.severity].tone">{{ SEVERITY[a.severity].label }}</Badge>
            <Badge v-if="TYPE_LABEL[a.type]">{{ TYPE_LABEL[a.type] }}</Badge>
          </div>
          <p class="mt-1.5 whitespace-pre-line text-sm text-muted">{{ a.message }}</p>
          <div class="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span :title="date(a.createdAt, true)">{{ ago(a.createdAt) }}</span>
            <RouterLink v-if="a.domainId && a.domain" :to="`/domains/${a.domainId}`" class="font-medium text-brand hover:underline">{{ a.domain }}</RouterLink>
            <RouterLink v-if="ipOf(a)" :to="`/sources/${encodeURIComponent(ipOf(a)!)}`" class="mono font-medium text-brand hover:underline">{{ ipOf(a) }}</RouterLink>
            <RouterLink v-if="a.type === 'forensic_report'" to="/forensic" class="font-medium text-brand hover:underline">Ver forenses</RouterLink>
          </div>
        </div>
        <div class="flex shrink-0 items-start gap-1">
          <button v-if="!a.readAt" class="btn-ghost btn-sm p-1.5" title="Marcar como leída" :disabled="busy === a.id" @click="markRead(a)">
            <Spinner v-if="busy === a.id" class="size-4" /><Check v-else class="size-4" /><span class="sr-only">Marcar como leída</span>
          </button>
          <button v-if="isAdmin" class="btn-ghost btn-sm p-1.5 hover:text-fail" title="Eliminar" @click="removing = a"><Trash2 class="size-4" /><span class="sr-only">Eliminar</span></button>
        </div>
      </li>
    </ul>
    <div v-if="data.total > PAGE_SIZE" class="card mt-4 overflow-hidden"><Pagination v-model="page" :total="data.total" :page-size="PAGE_SIZE" class="border-t-0" /></div>
  </template>

  <Confirm v-if="removing" danger title="Eliminar alerta" message="La alerta se eliminará de forma permanente." confirm-label="Eliminar" @confirm="remove" @close="removing = null" />
</template>

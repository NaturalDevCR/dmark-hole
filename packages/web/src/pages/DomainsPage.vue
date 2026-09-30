<script setup lang="ts">
import { AlertTriangle, Globe, Plus, Search, Sparkles } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import ScoreRing from "@/components/charts/ScoreRing.vue";
import Sparkline from "@/components/charts/Sparkline.vue";
import StackBar from "@/components/charts/StackBar.vue";
import PolicyBadge from "@/components/dmarc/PolicyBadge.vue";
import RangePicker from "@/components/dmarc/RangePicker.vue";
import Badge from "@/components/ui/Badge.vue";
import Empty from "@/components/ui/Empty.vue";
import Modal from "@/components/ui/Modal.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import Spinner from "@/components/ui/Spinner.vue";
import { api, withToast } from "@/lib/api";
import { ago, num, pct, short } from "@/lib/format";
import type { DomainSummary } from "@/lib/types";
import { useLoader } from "@/lib/useLoader";
import { useAuth } from "@/stores/auth";
import { useFilters } from "@/stores/filters";

const router = useRouter();
const auth = useAuth();
const { query, days } = storeToRefs(useFilters());
const { data, loading } = useLoader(() => api.get<DomainSummary[]>("/domains", query.value), [query]);

const search = ref("");
const sort = ref<"messages" | "health" | "name">("messages");
const list = computed(() => {
  const s = search.value.trim().toLowerCase();
  const items = (data.value ?? []).filter((d) => !s || d.name.includes(s) || d.displayName?.toLowerCase().includes(s));
  return items.sort((a, b) =>
    sort.value === "name" ? a.name.localeCompare(b.name) : sort.value === "health" ? (a.health ?? -1) - (b.health ?? -1) : b.messages - a.messages,
  );
});

const showAdd = ref(false);
const form = ref({ name: "", displayName: "", notes: "" });
const saving = ref(false);
async function add() {
  saving.value = true;
  const r = await withToast(() => api.post<{ id: number }>("/domains", form.value), "Dominio agregado; verificando DNS…");
  saving.value = false;
  if (r) {
    showAdd.value = false;
    form.value = { name: "", displayName: "", notes: "" };
    router.push(`/domains/${r.id}`);
  }
}
</script>

<template>
  <PageHeader title="Dominios" :subtitle="`${data?.length ?? 0} dominios monitoreados · métricas de los últimos ${days} días`">
    <RangePicker />
    <button v-if="auth.isAdmin" class="btn-primary" @click="showAdd = true"><Plus class="size-4" />Agregar dominio</button>
  </PageHeader>

  <div class="mb-5 flex flex-wrap items-center gap-3">
    <div class="relative w-full max-w-xs">
      <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
      <input v-model="search" class="input pl-9" placeholder="Buscar dominio…" />
    </div>
    <select v-model="sort" class="input w-auto">
      <option value="messages">Ordenar por volumen</option>
      <option value="health">Ordenar por salud (peor primero)</option>
      <option value="name">Ordenar por nombre</option>
    </select>
  </div>

  <div v-if="loading && !data" class="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
    <Skeleton v-for="i in 6" :key="i" class="h-56" />
  </div>

  <Empty
    v-else-if="data && !data.length"
    :icon="Globe"
    title="Sin dominios"
    description="Agregue sus dominios o simplemente configure la ingesta: los dominios se crean automáticamente al recibir el primer reporte."
  >
    <button v-if="auth.isAdmin" class="btn-primary" @click="showAdd = true"><Plus class="size-4" />Agregar dominio</button>
  </Empty>

  <div v-else class="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
    <RouterLink
      v-for="d in list"
      :key="d.id"
      :to="`/domains/${d.id}`"
      class="card group flex flex-col p-5 transition hover:border-line-strong hover:shadow-md"
    >
      <div class="flex items-start gap-4">
        <ScoreRing :score="d.health" :size="52" label="salud" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-base font-semibold group-hover:text-brand">{{ d.name }}</p>
          <p class="truncate text-sm text-muted">{{ d.displayName || (d.lastReportAt ? `Último reporte ${ago(d.lastReportAt)}` : "Sin reportes todavía") }}</p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <PolicyBadge :policy="d.policy" :pct="d.pct" />
            <Badge v-if="d.autoCreated" tone="brand"><Sparkles class="size-3" />Detectado</Badge>
            <Badge v-if="d.dnsIssues" tone="fail"><AlertTriangle class="size-3" />{{ d.dnsIssues }} error{{ d.dnsIssues > 1 ? "es" : "" }} DNS</Badge>
          </div>
        </div>
      </div>

      <div class="mt-5 grid grid-cols-3 gap-3 text-sm">
        <div>
          <p class="text-xs text-muted">Mensajes</p>
          <p class="mt-0.5 font-semibold tabular-nums">{{ short(d.messages) }}</p>
        </div>
        <div>
          <p class="text-xs text-muted">Cumplimiento</p>
          <p class="mt-0.5 font-semibold tabular-nums">{{ pct(d.compliance) }}</p>
        </div>
        <div>
          <p class="text-xs text-muted">No autenticados</p>
          <p class="mt-0.5 font-semibold tabular-nums" :class="d.failing ? 'text-fail' : ''">{{ num(d.failing) }}</p>
        </div>
      </div>

      <div class="mt-4 flex items-end justify-between gap-4">
        <div class="min-w-0 flex-1">
          <StackBar :pass="d.messages - d.failing - d.misaligned" :forwarded="0" :misaligned="d.misaligned" :fail="d.failing" :height="6" />
          <p class="mt-1.5 text-xs text-faint">{{ num(d.sources) }} fuentes · DNS {{ d.dnsScore ?? "—" }}/100</p>
        </div>
        <Sparkline :values="d.spark.map((s) => s.compliance)" :min="0" :max="100" :width="100" :height="30" />
      </div>
    </RouterLink>
  </div>

  <Modal v-if="showAdd" title="Agregar dominio" @close="showAdd = false">
    <form id="add-domain" class="space-y-4" @submit.prevent="add">
      <div>
        <label class="label" for="dn">Dominio</label>
        <input id="dn" v-model="form.name" class="input" placeholder="ejemplo.com" required autofocus />
        <p class="mt-1.5 text-xs text-muted">El dominio del encabezado From (policy_domain). Los subdominios con registro DMARC propio se agregan por separado.</p>
      </div>
      <div>
        <label class="label" for="dd">Nombre descriptivo (opcional)</label>
        <input id="dd" v-model="form.displayName" class="input" placeholder="Marca principal" />
      </div>
      <div>
        <label class="label" for="nt">Notas (opcional)</label>
        <textarea id="nt" v-model="form.notes" class="input min-h-20" />
      </div>
    </form>
    <template #footer>
      <button class="btn-secondary" @click="showAdd = false">Cancelar</button>
      <button class="btn-primary" form="add-domain" :disabled="saving"><Spinner v-if="saving" />Agregar</button>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { Activity, AlertOctagon, ArrowLeft, FileText, Globe, LayoutDashboard, MailCheck, Network, Plus, Settings, Trash2, X } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import BarList from "@/components/charts/BarList.vue";
import ComplianceChart from "@/components/charts/ComplianceChart.vue";
import ScoreRing from "@/components/charts/ScoreRing.vue";
import VolumeChart from "@/components/charts/VolumeChart.vue";
import PolicyBadge from "@/components/dmarc/PolicyBadge.vue";
import RangePicker from "@/components/dmarc/RangePicker.vue";
import DnsTab from "@/components/domain/DnsTab.vue";
import RecommendationList from "@/components/domain/RecommendationList.vue";
import SourcesExplorer from "@/components/sources/SourcesExplorer.vue";
import Card from "@/components/ui/Card.vue";
import Confirm from "@/components/ui/Confirm.vue";
import Empty from "@/components/ui/Empty.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import Spinner from "@/components/ui/Spinner.vue";
import Stat from "@/components/ui/Stat.vue";
import Tabs from "@/components/ui/Tabs.vue";
import { api, withToast } from "@/lib/api";
import { ago, date, num, pct, period, ratio, short } from "@/lib/format";
import type { DnsReport, DomainDetail, Overview, Recommendation, ReportListItem, Paged, Reporter, Timeseries } from "@/lib/types";
import { useLoader } from "@/lib/useLoader";
import { useAuth } from "@/stores/auth";
import { useFilters } from "@/stores/filters";

const props = defineProps<{ id: string }>();
const route = useRoute();
const router = useRouter();
const auth = useAuth();
const { query, days } = storeToRefs(useFilters());
const domainId = computed(() => Number(props.id));

const tab = ref(typeof route.query.tab === "string" ? route.query.tab : "overview");
watch(tab, (t) => router.replace({ query: { ...route.query, tab: t === "overview" ? undefined : t } }));

const domain = useLoader(() => api.get<DomainDetail>(`/domains/${domainId.value}`));
const recs = useLoader(() => api.get<Recommendation[]>(`/domains/${domainId.value}/recommendations`));
const stats = useLoader(
  async () => {
    const q = { ...query.value, domainId: domainId.value };
    const [overview, ts, reporters, auth] = await Promise.all([
      api.get<Overview>("/stats/overview", q),
      api.get<Timeseries>("/stats/timeseries", q),
      api.get<Reporter[]>("/stats/reporters", q),
      api.get<{ spf: string; dkim: string; messages: number }[]>("/stats/auth", q),
    ]);
    return { overview, ts, reporters, auth };
  },
  [query],
);
const reports = useLoader(() => api.get<Paged<ReportListItem>>("/reports", { ...query.value, domainId: domainId.value, pageSize: 15 }), [query]);

const d = computed(() => domain.data.value);
const ov = computed(() => stats.data.value?.overview);
const policy = computed(() => d.value?.dnsResult?.dmarc.tags.p?.toLowerCase() ?? null);
const health = computed(() => {
  const c = ov.value?.compliance ?? null;
  const s = d.value?.dnsResult?.score ?? null;
  if (c === null && s === null) return null;
  if (c === null) return s;
  if (s === null) return Math.round(c);
  return Math.round(c * 0.6 + s * 0.4);
});

const tabs = computed(() => [
  { id: "overview", label: "Resumen", icon: LayoutDashboard },
  { id: "sources", label: "Fuentes", icon: Network, count: ov.value?.sources ?? null },
  { id: "dns", label: "DNS", icon: Globe },
  { id: "reports", label: "Reportes", icon: FileText, count: ov.value?.reports ?? null },
  { id: "settings", label: "Configuración", icon: Settings },
]);

// Authentication matrix: SPF state × DKIM state.
const AUTH_STATES = [
  { key: "aligned", label: "Alineado" },
  { key: "unaligned", label: "Pasa, sin alinear" },
  { key: "fail", label: "Falla / ausente" },
] as const;
const matrix = computed(() => {
  const m: Record<string, number> = {};
  for (const r of stats.data.value?.auth ?? []) m[`${r.spf}|${r.dkim}`] = r.messages;
  return m;
});
const matrixTotal = computed(() => Object.values(matrix.value).reduce((a, b) => a + b, 0));
function cellClass(spf: string, dkim: string) {
  if (spf === "aligned" || dkim === "aligned") return "bg-pass";
  if (spf === "unaligned" || dkim === "unaligned") return "bg-misaligned";
  return "bg-fail";
}

function onDnsUpdated(r: DnsReport) {
  if (d.value) domain.data.value = { ...d.value, dnsResult: r, dnsCheckedAt: r.checkedAt };
  recs.reload();
}

// Settings tab
const form = ref({ displayName: "", notes: "", selectors: [] as string[] });
const newSelector = ref("");
watch(d, (v) => {
  if (v) form.value = { displayName: v.displayName ?? "", notes: v.notes ?? "", selectors: [...v.dkimSelectors] };
});
const saving = ref(false);
async function save() {
  saving.value = true;
  const ok = await withToast(
    () => api.patch(`/domains/${domainId.value}`, { displayName: form.value.displayName, notes: form.value.notes, dkimSelectors: form.value.selectors }),
    "Cambios guardados",
  );
  saving.value = false;
  if (ok) domain.reload();
}
function addSelector() {
  const s = newSelector.value.trim();
  if (!s) return;
  // Stored as selector:domain so a selector for a subdomain can also be tracked.
  const entry = s.includes(":") ? s : `${s}:${d.value?.name}`;
  if (!form.value.selectors.includes(entry)) form.value.selectors.push(entry);
  newSelector.value = "";
}
const confirmDelete = ref(false);
async function remove() {
  confirmDelete.value = false;
  const ok = await withToast(() => api.del(`/domains/${domainId.value}`), "Dominio eliminado");
  if (ok) router.push("/domains");
}
</script>

<template>
  <div v-if="domain.error.value" class="card"><Empty title="Dominio no encontrado" :description="domain.error.value"><RouterLink to="/domains" class="btn-secondary">Volver</RouterLink></Empty></div>

  <template v-else>
    <PageHeader :title="d?.name ?? '…'" :subtitle="d?.displayName ?? undefined">
      <template #eyebrow>
        <RouterLink to="/domains" class="inline-flex items-center gap-1 hover:text-fg"><ArrowLeft class="size-3.5" />Dominios</RouterLink>
      </template>
      <div class="flex items-center gap-3">
        <PolicyBadge v-if="d" :policy="policy" :pct="d.dnsResult?.dmarc.tags.pct ? Number(d.dnsResult.dmarc.tags.pct) : null" />
        <ScoreRing :score="health" :size="44" :stroke="4" />
      </div>
      <RangePicker />
    </PageHeader>

    <Tabs v-model="tab" :tabs="tabs" class="mb-6" />

    <!-- OVERVIEW -->
    <div v-if="tab === 'overview'" class="space-y-6">
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <template v-if="ov">
          <Stat label="Mensajes" :value="short(ov.messages)" :icon="Activity" :hint="`${num(ov.reports)} reportes · ${days} días`" />
          <Stat label="Cumplimiento DMARC" :value="pct(ov.compliance)" :icon="MailCheck" tone="pass" :hint="`SPF ${pct(ov.spfAlignedRate)} · DKIM ${pct(ov.dkimAlignedRate)} alineados`" />
          <Stat label="Fuentes" :value="num(ov.sources)" :icon="Network" tone="forwarded" :hint="`${num(ov.categories.misaligned)} mensajes sin alinear`" />
          <Stat label="No autenticados" :value="short(ov.categories.fail)" :icon="AlertOctagon" tone="fail" :hint="`${num(ov.disposition.reject)} rechazados · ${num(ov.disposition.quarantine)} cuarentena`" />
        </template>
        <template v-else><Skeleton v-for="i in 4" :key="i" class="h-[132px]" /></template>
      </div>

      <Card title="Recomendaciones" subtitle="Acciones priorizadas según los reportes y la configuración DNS" flush>
        <div v-if="recs.loading.value && !recs.data.value" class="p-5"><Skeleton class="h-24" /></div>
        <RecommendationList v-else-if="recs.data.value?.length" :items="recs.data.value" />
        <Empty v-else title="Sin recomendaciones" />
      </Card>

      <div class="grid gap-6 xl:grid-cols-3">
        <Card title="Volumen por resultado" class="xl:col-span-2">
          <VolumeChart v-if="stats.data.value" :data="stats.data.value.ts" />
          <Skeleton v-else class="h-[280px]" />
        </Card>
        <Card title="Matriz de autenticación" subtitle="Mensajes según el estado de SPF y DKIM">
          <div v-if="matrixTotal" class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr>
                  <th class="p-1 text-left font-medium text-muted">SPF ↓ / DKIM →</th>
                  <th v-for="k in AUTH_STATES" :key="k.key" class="p-1 text-center font-medium text-muted">{{ k.label }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in AUTH_STATES" :key="s.key">
                  <th class="p-1 text-left font-medium text-muted">{{ s.label }}</th>
                  <td v-for="k in AUTH_STATES" :key="k.key" class="p-1">
                    <div
                      class="relative grid h-14 place-items-center overflow-hidden rounded-lg border border-line"
                      :title="`${num(matrix[`${s.key}|${k.key}`] ?? 0)} mensajes`"
                    >
                      <span class="absolute inset-0" :class="cellClass(s.key, k.key)" :style="{ opacity: 0.08 + 0.6 * Math.sqrt((matrix[`${s.key}|${k.key}`] ?? 0) / matrixTotal) }" />
                      <span class="relative font-semibold tabular-nums">{{ pct(ratio(matrix[`${s.key}|${k.key}`] ?? 0, matrixTotal)) }}</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <p class="mt-3 text-xs text-muted">Basta con que SPF <b>o</b> DKIM esté alineado para pasar DMARC. DKIM alineado es más robusto: sobrevive al reenvío.</p>
          </div>
          <Empty v-else title="Sin datos" />
        </Card>
      </div>

      <div class="grid gap-6 xl:grid-cols-3">
        <Card title="Tendencia de cumplimiento" class="xl:col-span-2">
          <ComplianceChart v-if="stats.data.value" :days="stats.data.value.ts.days" :values="stats.data.value.ts.series.compliance" />
        </Card>
        <Card title="Quién reporta">
          <BarList
            v-if="stats.data.value?.reporters.length"
            :items="stats.data.value.reporters.slice(0, 8).map((r) => ({ key: r.name, label: r.name, value: r.messages, sub: pct(r.compliance), to: `/reports?domainId=${domainId}&org=${encodeURIComponent(r.name)}` }))"
            :value-label="short"
          />
          <Empty v-else title="Sin reportes" />
        </Card>
      </div>
    </div>

    <SourcesExplorer v-else-if="tab === 'sources'" :domain-id="domainId" />

    <template v-else-if="tab === 'dns'">
      <DnsTab v-if="d" :domain="d" @updated="onDnsUpdated" />
      <Skeleton v-else class="h-96" />
    </template>

    <Card v-else-if="tab === 'reports'" title="Últimos reportes" flush>
      <template #actions><RouterLink :to="`/reports?domainId=${domainId}`" class="btn-ghost btn-sm">Ver todos</RouterLink></template>
      <Empty v-if="reports.data.value && !reports.data.value.items.length" title="Sin reportes en este periodo" />
      <div v-else class="overflow-x-auto">
        <table class="table">
          <thead><tr><th>Reporter</th><th>Periodo</th><th class="text-right">Mensajes</th><th class="text-right">Pasa DMARC</th><th>Recibido</th></tr></thead>
          <tbody>
            <tr v-for="r in reports.data.value?.items ?? []" :key="r.id" class="row-link" @click="router.push(`/reports/${r.id}`)">
              <td class="font-medium">{{ r.orgName }}</td>
              <td class="text-sm text-muted">{{ period(r.beginTs, r.endTs) }}</td>
              <td class="text-right tabular-nums">{{ num(r.messages) }}</td>
              <td class="text-right tabular-nums">{{ pct(ratio(r.pass, r.messages)) }}</td>
              <td class="text-sm text-muted">{{ ago(r.receivedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>

    <div v-else-if="tab === 'settings' && d" class="grid gap-6 xl:grid-cols-3">
      <Card title="Detalles" class="xl:col-span-2">
        <form class="space-y-4" @submit.prevent="save">
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="label">Dominio</label>
              <input class="input" :value="d.name" disabled />
            </div>
            <div>
              <label class="label" for="dn">Nombre descriptivo</label>
              <input id="dn" v-model="form.displayName" class="input" :disabled="!auth.isAdmin" />
            </div>
          </div>
          <div>
            <label class="label" for="nt">Notas</label>
            <textarea id="nt" v-model="form.notes" class="input min-h-24" :disabled="!auth.isAdmin" />
          </div>
          <div>
            <label class="label">Selectores DKIM monitoreados</label>
            <p class="mb-2 text-xs text-muted">Se detectan solos a partir de los reportes. Agregue otros para validar sus claves (formato <code class="mono">selector</code> o <code class="mono">selector:dominio</code>).</p>
            <div class="flex flex-wrap gap-2">
              <span v-for="(s, i) in form.selectors" :key="s" class="mono inline-flex items-center gap-1 rounded-md border border-line bg-subtle px-2 py-1">
                {{ s }}
                <button v-if="auth.isAdmin" type="button" class="text-faint hover:text-fail" @click="form.selectors.splice(i, 1)"><X class="size-3.5" /></button>
              </span>
              <span v-if="!form.selectors.length" class="text-sm text-faint">Ninguno todavía</span>
            </div>
            <div v-if="auth.isAdmin" class="mt-2 flex max-w-sm gap-2">
              <input v-model="newSelector" class="input" placeholder="selector1" @keydown.enter.prevent="addSelector" />
              <button type="button" class="btn-secondary" @click="addSelector"><Plus class="size-4" /></button>
            </div>
          </div>
          <div v-if="auth.isAdmin" class="flex justify-end">
            <button class="btn-primary" :disabled="saving"><Spinner v-if="saving" />Guardar</button>
          </div>
        </form>
      </Card>
      <div class="space-y-6">
        <Card title="Información">
          <dl class="space-y-2 text-sm">
            <div class="flex justify-between gap-2"><dt class="text-muted">Agregado</dt><dd>{{ date(d.createdAt) }}</dd></div>
            <div class="flex justify-between gap-2"><dt class="text-muted">Origen</dt><dd>{{ d.autoCreated ? "Detectado en un reporte" : "Manual" }}</dd></div>
            <div class="flex justify-between gap-2"><dt class="text-muted">Última verificación DNS</dt><dd>{{ ago(d.dnsCheckedAt) }}</dd></div>
          </dl>
        </Card>
        <Card v-if="auth.isAdmin" title="Zona de peligro">
          <p class="mb-3 text-sm text-muted">Elimina el dominio con todos sus reportes, fuentes y alertas. No se puede deshacer.</p>
          <button class="btn-danger" @click="confirmDelete = true"><Trash2 class="size-4" />Eliminar dominio</button>
        </Card>
      </div>
    </div>

    <Confirm
      v-if="confirmDelete"
      title="Eliminar dominio"
      :message="`¿Eliminar ${d?.name} y todos sus datos? Si siguen llegando reportes, el dominio podría volver a crearse automáticamente.`"
      confirm-label="Eliminar"
      danger
      @close="confirmDelete = false"
      @confirm="remove"
    />
  </template>
</template>

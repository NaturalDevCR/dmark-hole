<script setup lang="ts">
import { Activity, ArrowLeft, Download, Layers, MailCheck, Network, Trash2, TriangleAlert } from "lucide-vue-next";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import StackBar from "@/components/charts/StackBar.vue";
import AuthPill from "@/components/dmarc/AuthPill.vue";
import CategoryBadge from "@/components/dmarc/CategoryBadge.vue";
import IpCell from "@/components/dmarc/IpCell.vue";
import PolicyBadge from "@/components/dmarc/PolicyBadge.vue";
import Badge from "@/components/ui/Badge.vue";
import Card from "@/components/ui/Card.vue";
import Confirm from "@/components/ui/Confirm.vue";
import CopyButton from "@/components/ui/CopyButton.vue";
import Empty from "@/components/ui/Empty.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import Stat from "@/components/ui/Stat.vue";
import { api, withToast } from "@/lib/api";
import { CATEGORY, date, num, pct, period as formatPeriod, ratio } from "@/lib/format";
import type { Category, ReportDetail } from "@/lib/types";
import { useLoader } from "@/lib/useLoader";
import { useAuth } from "@/stores/auth";

const props = defineProps<{ id: string }>();
const router = useRouter();
const auth = useAuth();

const { data: r, error } = useLoader(() => api.get<ReportDetail>(`/reports/${props.id}`), [() => props.id]);

const confirmDelete = ref(false);
async function remove() {
  const ok = await withToast(() => api.del(`/reports/${props.id}`), "Reporte eliminado");
  confirmDelete.value = false;
  if (ok !== undefined) router.push("/reports");
}

const categories = computed(() => {
  const c: Record<Category, number> = { pass: 0, forwarded: 0, misaligned: 0, fail: 0 };
  for (const rec of r.value?.records ?? []) c[rec.category] += rec.count;
  return c;
});
const dispositions = computed(() => {
  const d = { none: 0, quarantine: 0, reject: 0 } as Record<string, number>;
  for (const rec of r.value?.records ?? []) d[rec.disposition] = (d[rec.disposition] ?? 0) + rec.count;
  return d;
});

const policyChips = computed(() => {
  const x = r.value;
  if (!x) return [];
  return [
    { k: "p", v: x.p },
    { k: "sp", v: x.sp },
    { k: "np", v: x.np },
    { k: "pct", v: x.pct === null ? null : String(x.pct) },
    { k: "adkim", v: x.adkim },
    { k: "aspf", v: x.aspf },
    { k: "fo", v: x.fo },
    { k: "testing", v: x.testing },
  ].filter((c) => c.v !== null && c.v !== undefined && c.v !== "");
});

const DISPOSITION_TONE: Record<string, "pass" | "misaligned" | "fail" | "neutral"> = { none: "neutral", quarantine: "misaligned", reject: "fail" };
const evalTone = (v: string) => (v === "pass" ? "text-pass" : v === "fail" ? "text-fail" : "text-muted");
const sourceLabel = (s: string) => {
  const i = s.indexOf(":");
  return i > 0 ? `${s.slice(0, i)} · ${s.slice(i + 1)}` : s;
};
const period = computed(() => {
  const x = r.value;
  if (!x) return "";
  return formatPeriod(x.beginTs, x.endTs, true);
});
</script>

<template>
  <div v-if="error" class="card">
    <Empty title="No se pudo cargar el reporte" :description="error">
      <RouterLink to="/reports" class="btn-secondary"><ArrowLeft class="size-4" />Volver a reportes</RouterLink>
    </Empty>
  </div>

  <template v-else>
    <PageHeader :title="r?.orgName ?? 'Reporte'" :subtitle="r ? `Reporte agregado · ${period}` : undefined">
      <template #eyebrow>
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <RouterLink to="/reports" class="inline-flex items-center gap-1 hover:text-fg"><ArrowLeft class="size-3.5" />Reportes</RouterLink>
          <template v-if="r">
            <span class="text-faint">/</span>
            <RouterLink :to="`/domains/${r.domainId}`" class="font-medium text-fg hover:text-brand hover:underline">{{ r.domain }}</RouterLink>
          </template>
        </div>
      </template>
      <template v-if="r">
        <a v-if="r.hasXml" :href="api.url(`/reports/${r.id}/xml`)" class="btn-secondary" download><Download class="size-4" />Descargar XML</a>
        <button v-if="auth.isAdmin" class="btn-danger" @click="confirmDelete = true"><Trash2 class="size-4" />Eliminar</button>
      </template>
    </PageHeader>

    <div v-if="!r" class="space-y-6">
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Skeleton v-for="i in 4" :key="i" class="h-[132px]" /></div>
      <Skeleton class="h-48" />
      <Skeleton class="h-72" />
    </div>

    <template v-else>
      <!-- KPIs -->
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Mensajes" :value="num(r.messages)" :icon="Activity" :hint="`${num(r.pass)} pasan DMARC`" />
        <Stat label="Pasa DMARC" :value="pct(ratio(r.pass, r.messages))" :icon="MailCheck" tone="pass" :hint="`${num(r.messages - r.pass)} no pasan`" />
        <Stat label="Fuentes" :value="num(r.recordCount)" :icon="Network" tone="forwarded" hint="registros en el reporte" />
        <Stat
          label="Disposiciones"
          :value="`${num(dispositions.none ?? 0)} / ${num(dispositions.quarantine ?? 0)} / ${num(dispositions.reject ?? 0)}`"
          :icon="Layers"
          tone="misaligned"
          hint="ninguna / cuarentena / rechazo"
        />
      </div>

      <div class="mt-6 grid gap-6 xl:grid-cols-3">
        <!-- Metadata -->
        <Card title="Detalles del reporte" class="xl:col-span-2">
          <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <div class="min-w-0 sm:col-span-2">
              <dt class="text-xs font-medium text-muted">ID del reporte</dt>
              <dd class="mt-0.5 flex items-center gap-1"><span class="mono truncate">{{ r.reportId }}</span><CopyButton :text="r.reportId" /></dd>
            </div>
            <div>
              <dt class="text-xs font-medium text-muted">Periodo</dt>
              <dd class="mt-0.5 text-sm">{{ period }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium text-muted">Recibido</dt>
              <dd class="mt-0.5 text-sm">{{ date(r.receivedAt, true) }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium text-muted">Fuente</dt>
              <dd class="mt-0.5 text-sm break-all">{{ sourceLabel(r.source) }}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-xs font-medium text-muted">Contacto</dt>
              <dd class="mt-0.5 text-sm break-words">
                {{ r.orgEmail ?? "—" }}
                <span v-if="r.extraContact" class="block text-xs text-muted">{{ r.extraContact }}</span>
              </dd>
            </div>
            <div v-if="r.policyDomain !== r.domain">
              <dt class="text-xs font-medium text-muted">Dominio de la política</dt>
              <dd class="mt-0.5 text-sm">{{ r.policyDomain }}</dd>
            </div>
            <div v-if="r.version">
              <dt class="text-xs font-medium text-muted">Versión del formato</dt>
              <dd class="mt-0.5 text-sm">{{ r.version }}</dd>
            </div>
            <div class="sm:col-span-2">
              <dt class="text-xs font-medium text-muted">Política publicada</dt>
              <dd class="mt-1.5 flex flex-wrap items-center gap-2">
                <PolicyBadge :policy="r.p" :pct="r.pct" />
                <span v-for="c in policyChips" :key="c.k" class="inline-flex items-center overflow-hidden rounded-md text-xs ring-1 ring-line-strong/60 ring-inset">
                  <span class="bg-subtle px-1.5 py-0.5 font-medium text-muted">{{ c.k }}</span>
                  <span class="mono px-1.5 py-0.5">{{ c.v }}</span>
                </span>
              </dd>
            </div>
          </dl>
        </Card>

        <!-- Composition -->
        <Card title="Clasificación de mensajes" subtitle="Según los registros de este reporte">
          <StackBar :pass="categories.pass" :forwarded="categories.forwarded" :misaligned="categories.misaligned" :fail="categories.fail" :height="12" />
          <ul class="mt-4 space-y-2.5">
            <li v-for="c in (['pass', 'forwarded', 'misaligned', 'fail'] as Category[])" :key="c" class="flex items-center gap-3 text-sm">
              <span class="size-2.5 shrink-0 rounded-sm" :style="{ background: `var(--c-series-${c})` }" />
              <span class="flex-1 font-medium">{{ CATEGORY[c].label }}</span>
              <span class="tabular-nums">{{ num(categories[c]) }}</span>
              <span class="w-14 text-right text-xs text-muted tabular-nums">{{ pct(ratio(categories[c], r.messages)) }}</span>
            </li>
          </ul>
        </Card>
      </div>

      <!-- Report errors -->
      <div v-if="r.errors.length" class="mt-6 rounded-xl border border-misaligned/30 bg-misaligned-soft p-4">
        <p class="flex items-center gap-2 text-sm font-semibold text-misaligned"><TriangleAlert class="size-4" />El reportador indicó {{ r.errors.length }} {{ r.errors.length === 1 ? "error" : "errores" }}</p>
        <ul class="mt-2 list-inside list-disc space-y-1 text-sm text-fg">
          <li v-for="(e, i) in r.errors" :key="i" class="break-words">{{ e }}</li>
        </ul>
      </div>

      <!-- Records -->
      <Card title="Registros" :subtitle="`${num(r.records.length)} origen(es) de envío, ordenados por volumen`" class="mt-6" flush>
        <Empty v-if="!r.records.length" title="Este reporte no contiene registros" />
        <div v-else class="overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>Origen</th>
                <th class="text-right">Mensajes</th>
                <th>Resultado</th>
                <th>Disposición</th>
                <th>Evaluación DMARC</th>
                <th>Autenticación</th>
                <th>Identificadores</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="rec in r.records" :key="rec.id" class="align-top">
                <td class="max-w-64 !align-top"><IpCell :ip="rec.sourceIp" :ptr="rec.ptr" :provider="rec.provider" :country="rec.country" /></td>
                <td class="text-right font-medium tabular-nums !align-top">{{ num(rec.count) }}</td>
                <td class="!align-top"><CategoryBadge :category="rec.category" /></td>
                <td class="!align-top">
                  <Badge :tone="DISPOSITION_TONE[rec.disposition] ?? 'neutral'">{{ rec.disposition }}</Badge>
                  <ul v-if="rec.reasons.length" class="mt-1.5 space-y-0.5 text-xs text-muted">
                    <li v-for="(re, i) in rec.reasons" :key="i" class="max-w-48">
                      <span class="font-medium">{{ re.type }}</span><span v-if="re.comment"> · {{ re.comment }}</span>
                    </li>
                  </ul>
                </td>
                <td class="!align-top whitespace-nowrap text-xs">
                  <p>DKIM <span class="font-medium" :class="evalTone(rec.dkimEval)">{{ rec.dkimEval }}</span></p>
                  <p class="mt-0.5">SPF <span class="font-medium" :class="evalTone(rec.spfEval)">{{ rec.spfEval }}</span></p>
                </td>
                <td class="max-w-72 !align-top">
                  <div class="flex flex-col items-start gap-1">
                    <AuthPill v-for="(d, i) in rec.dkim" :key="`d${i}`" kind="DKIM" :result="d.result" :aligned="d.aligned" :domain="d.domain" :selector="d.selector" />
                    <AuthPill v-for="(s, i) in rec.spf" :key="`s${i}`" kind="SPF" :result="s.result" :aligned="s.aligned" :domain="s.domain" />
                    <span v-if="!rec.dkim.length && !rec.spf.length" class="text-xs text-muted">Sin datos de autenticación</span>
                  </div>
                  <p v-for="(d, i) in rec.dkim.filter((x) => x.selector)" :key="`sel${i}`" class="mono mt-1 text-[11px] text-muted">s={{ d.selector }}</p>
                </td>
                <td class="max-w-64 !align-top text-xs">
                  <dl class="space-y-0.5">
                    <div class="flex gap-1.5"><dt class="w-9 shrink-0 text-muted">From</dt><dd class="truncate" :title="rec.headerFrom">{{ rec.headerFrom }}</dd></div>
                    <div v-if="rec.envelopeFrom" class="flex gap-1.5"><dt class="w-9 shrink-0 text-muted">Env.</dt><dd class="truncate" :title="rec.envelopeFrom">{{ rec.envelopeFrom }}</dd></div>
                    <div v-if="rec.envelopeTo" class="flex gap-1.5"><dt class="w-9 shrink-0 text-muted">Para</dt><dd class="truncate" :title="rec.envelopeTo">{{ rec.envelopeTo }}</dd></div>
                  </dl>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </template>
  </template>

  <Confirm
    v-if="confirmDelete"
    title="Eliminar reporte"
    message="Se eliminará este reporte y todos sus registros. Las estadísticas de los periodos que cubre se recalcularán sin él. Esta acción no se puede deshacer."
    confirm-label="Eliminar"
    danger
    @confirm="remove"
    @close="confirmDelete = false"
  />
</template>

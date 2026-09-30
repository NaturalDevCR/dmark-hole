<script setup lang="ts">
import { ArrowLeft } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useRouter } from "vue-router";
import StackBar from "@/components/charts/StackBar.vue";
import AuthPill from "@/components/dmarc/AuthPill.vue";
import CategoryBadge from "@/components/dmarc/CategoryBadge.vue";
import RangePicker from "@/components/dmarc/RangePicker.vue";
import Card from "@/components/ui/Card.vue";
import CopyButton from "@/components/ui/CopyButton.vue";
import Empty from "@/components/ui/Empty.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import Stat from "@/components/ui/Stat.vue";
import { api } from "@/lib/api";
import { countryName, day, flag, num, pct, ratio } from "@/lib/format";
import type { Category, DkimAuth, SpfAuth } from "@/lib/types";
import { useLoader } from "@/lib/useLoader";
import { useFilters } from "@/stores/filters";

const props = defineProps<{ ip: string }>();
const router = useRouter();
const { query } = storeToRefs(useFilters());

interface SourceRecord {
  id: number;
  reportId: number;
  reporter: string;
  day: string;
  domain: string;
  count: number;
  disposition: string;
  dkimEval: string;
  spfEval: string;
  dmarcPass: boolean;
  category: Category;
  headerFrom: string;
  envelopeFrom: string | null;
  dkim: DkimAuth[];
  spf: SpfAuth[];
  reasons: { type: string; comment: string | null }[];
}
interface SourceInfo {
  ip: string;
  ptr?: string | null;
  asn?: number | null;
  asName?: string | null;
  country?: string | null;
  provider?: string | null;
}

const { data, loading } = useLoader(
  () => api.get<{ info: SourceInfo; records: SourceRecord[] }>(`/sources/${encodeURIComponent(props.ip)}`, query.value),
  [query],
);

const totals = computed(() => {
  const t = { messages: 0, pass: 0, forwarded: 0, misaligned: 0, fail: 0, domains: new Set<string>(), reporters: new Set<string>() };
  for (const r of data.value?.records ?? []) {
    t.messages += r.count;
    t[r.category] += r.count;
    t.domains.add(r.domain);
    t.reporters.add(r.reporter);
  }
  return t;
});
</script>

<template>
  <PageHeader :title="ip" :subtitle="data?.info.ptr ?? 'Sin DNS inverso'">
    <template #eyebrow>
      <a class="inline-flex cursor-pointer items-center gap-1 hover:text-fg" @click="router.back()"><ArrowLeft class="size-3.5" />Volver</a>
    </template>
    <CopyButton :text="ip" />
    <RangePicker />
  </PageHeader>

  <div v-if="loading && !data" class="grid gap-4 sm:grid-cols-4"><Skeleton v-for="i in 4" :key="i" class="h-28" /></div>

  <template v-else-if="data">
    <div class="grid gap-4 lg:grid-cols-3">
      <Card title="Identificación" class="lg:col-span-1">
        <dl class="space-y-2.5 text-sm">
          <div class="flex justify-between gap-3"><dt class="text-muted">Proveedor</dt><dd class="font-medium">{{ data.info.provider ?? "Desconocido" }}</dd></div>
          <div class="flex justify-between gap-3"><dt class="text-muted">PTR</dt><dd class="mono truncate" :title="data.info.ptr ?? ''">{{ data.info.ptr ?? "—" }}</dd></div>
          <div class="flex justify-between gap-3"><dt class="text-muted">ASN</dt><dd class="truncate text-right">{{ data.info.asn ? `AS${data.info.asn}` : "—" }} <span class="text-muted">{{ data.info.asName }}</span></dd></div>
          <div class="flex justify-between gap-3"><dt class="text-muted">País</dt><dd>{{ flag(data.info.country) }} {{ countryName(data.info.country) }}</dd></div>
        </dl>
      </Card>
      <div class="grid gap-4 sm:grid-cols-2 lg:col-span-2">
        <Stat label="Mensajes" :value="num(totals.messages)" :hint="`${totals.domains.size} dominio(s) · ${totals.reporters.size} reporter(s)`" />
        <Stat label="Pasa DMARC" :value="pct(ratio(totals.pass + totals.forwarded, totals.messages))" tone="pass" :hint="`${num(totals.fail)} no autenticados · ${num(totals.misaligned)} sin alinear`" />
        <div class="card p-5 sm:col-span-2">
          <StackBar :pass="totals.pass" :forwarded="totals.forwarded" :misaligned="totals.misaligned" :fail="totals.fail" :height="10" />
          <div class="mt-3 flex flex-wrap gap-4 text-xs text-muted">
            <span><span class="text-pass">●</span> Autenticado {{ num(totals.pass) }}</span>
            <span><span class="text-forwarded">●</span> Reenviado {{ num(totals.forwarded) }}</span>
            <span><span class="text-misaligned">●</span> Sin alinear {{ num(totals.misaligned) }}</span>
            <span><span class="text-fail">●</span> No autenticado {{ num(totals.fail) }}</span>
          </div>
        </div>
      </div>
    </div>

    <Card title="Registros en reportes" subtitle="Cada fila es un grupo de mensajes reportado por un receptor" class="mt-6" flush>
      <Empty v-if="!data.records.length" title="Sin registros en este periodo" />
      <div v-else class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr><th>Fecha</th><th>Dominio</th><th>Reporter</th><th class="text-right">Mensajes</th><th>Resultado</th><th>Autenticación</th><th>Disposición</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in data.records" :key="r.id" class="row-link" @click="router.push(`/reports/${r.reportId}`)">
              <td class="text-sm whitespace-nowrap">{{ day(r.day) }}</td>
              <td class="text-sm">
                <p>{{ r.headerFrom }}</p>
                <p v-if="r.envelopeFrom && r.envelopeFrom !== r.headerFrom" class="text-xs text-muted">MAIL FROM {{ r.envelopeFrom }}</p>
              </td>
              <td class="text-sm text-muted">{{ r.reporter }}</td>
              <td class="text-right tabular-nums">{{ num(r.count) }}</td>
              <td><CategoryBadge :category="r.category" /></td>
              <td>
                <div class="flex max-w-md flex-wrap gap-1">
                  <AuthPill v-for="(k, i) in r.dkim" :key="`d${i}`" kind="DKIM" :result="k.result" :aligned="k.aligned" :domain="k.domain" :selector="k.selector" />
                  <AuthPill v-for="(s, i) in r.spf" :key="`s${i}`" kind="SPF" :result="s.result" :aligned="s.aligned" :domain="s.domain" />
                  <span v-if="!r.dkim.length" class="text-xs text-faint">sin DKIM</span>
                </div>
                <p v-for="(x, i) in r.reasons" :key="i" class="mt-1 text-xs text-muted">↳ {{ x.type }}{{ x.comment ? `: ${x.comment}` : "" }}</p>
              </td>
              <td class="text-sm">{{ r.disposition }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  </template>
</template>

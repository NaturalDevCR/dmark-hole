<script setup lang="ts">
import { FileText, FilterX } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import PolicyBadge from "@/components/dmarc/PolicyBadge.vue";
import RangePicker from "@/components/dmarc/RangePicker.vue";
import Empty from "@/components/ui/Empty.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import Pagination from "@/components/ui/Pagination.vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import { api } from "@/lib/api";
import { ago, num, period, ratio } from "@/lib/format";
import type { DomainSummary, Paged, ReportListItem } from "@/lib/types";
import { useLoader } from "@/lib/useLoader";
import { useFilters } from "@/stores/filters";

const PAGE_SIZE = 50;
const route = useRoute();
const router = useRouter();
const { days } = storeToRefs(useFilters());
const page = ref(1);

const str = (v: unknown) => (typeof v === "string" ? v : "");
/** Filters live in the route query so they can be linked to and survive reloads. */
const domainId = computed({
  get: () => str(route.query.domainId),
  set: (v: string) => router.replace({ query: { ...route.query, domainId: v || undefined } }),
});
const org = computed({
  get: () => str(route.query.org),
  set: (v: string) => router.replace({ query: { ...route.query, org: v || undefined } }),
});

const { data: domains } = useLoader(() => api.get<DomainSummary[]>("/domains", { days: 365 }));
const { data: orgs } = useLoader(() => api.get<string[]>("/reports/orgs"));

const { data, loading, error } = useLoader(
  () => api.get<Paged<ReportListItem>>("/reports", { days: days.value, domainId: domainId.value, org: org.value, page: page.value, pageSize: PAGE_SIZE }),
  [days, domainId, org, page],
);

watch([days, domainId, org], () => (page.value = 1));

const filtered = computed(() => !!domainId.value || !!org.value);
const clear = () => router.replace({ query: { ...route.query, domainId: undefined, org: undefined } });
const compliance = (r: ReportListItem) => ratio(r.pass, r.messages);
const tone = (v: number | null) => (v === null ? "text-muted" : v >= 95 ? "text-pass" : v >= 70 ? "text-misaligned" : "text-fail");
const bar = (v: number | null) => (v === null ? "bg-line-strong" : v >= 95 ? "bg-pass" : v >= 70 ? "bg-misaligned" : "bg-fail");
const sourceLabel = (s: string) => {
  const i = s.indexOf(":");
  return i > 0 ? { kind: s.slice(0, i), detail: s.slice(i + 1) } : { kind: s, detail: "" };
};
</script>

<template>
  <PageHeader :title="$t('reports.list.title')" :subtitle="$t('reports.list.subtitle', { days })">
    <RangePicker />
  </PageHeader>

  <div class="mb-4 flex flex-wrap items-end gap-3">
    <div class="w-full sm:w-64">
      <label class="label" for="f-domain">{{ $t("reports.list.domain") }}</label>
      <select id="f-domain" v-model="domainId" class="input">
        <option value="">{{ $t("reports.list.allDomains") }}</option>
        <option v-for="d in domains ?? []" :key="d.id" :value="String(d.id)">{{ d.name }}</option>
      </select>
    </div>
    <div class="w-full sm:w-64">
      <label class="label" for="f-org">{{ $t("reports.list.reporter") }}</label>
      <select id="f-org" v-model="org" class="input">
        <option value="">{{ $t("reports.list.allReporters") }}</option>
        <option v-for="o in orgs ?? []" :key="o" :value="o">{{ o }}</option>
      </select>
    </div>
    <button v-if="filtered" class="btn-ghost" @click="clear"><FilterX class="size-4" />{{ $t("reports.list.clearFilters") }}</button>
  </div>

  <section class="card overflow-hidden">
    <div v-if="error" class="px-5 py-4 text-sm text-fail">{{ $t("reports.list.loadError", { error }) }}</div>
    <div v-if="!data" class="space-y-2 p-4">
      <Skeleton v-for="i in 8" :key="i" class="h-12" />
    </div>
    <Empty
      v-else-if="!data.items.length"
      :icon="FileText"
      :title="$t('reports.list.empty.title')"
      :description="$t('reports.list.empty.description')"
    >
      <div class="flex gap-2">
        <button v-if="filtered" class="btn-secondary" @click="clear">{{ $t("reports.list.clearFilters") }}</button>
        <RouterLink to="/ingest" class="btn-secondary">{{ $t("reports.list.empty.setupIngest") }}</RouterLink>
      </div>
    </Empty>
    <template v-else>
      <div class="overflow-x-auto" :class="loading && 'opacity-60 transition'">
        <table class="table">
          <thead>
            <tr>
              <th>{{ $t("reports.list.table.reporter") }}</th>
              <th>{{ $t("reports.list.table.domain") }}</th>
              <th>{{ $t("reports.list.table.period") }}</th>
              <th>{{ $t("reports.list.table.policy") }}</th>
              <th class="text-right">{{ $t("reports.list.table.messages") }}</th>
              <th class="w-44">{{ $t("reports.list.table.compliance") }}</th>
              <th class="text-right">{{ $t("reports.list.table.records") }}</th>
              <th>{{ $t("reports.list.table.received") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in data.items" :key="r.id" class="row-link" @click="router.push(`/reports/${r.id}`)">
              <td class="max-w-64">
                <p class="truncate font-medium">{{ r.orgName }}</p>
                <p v-if="r.orgEmail" class="truncate text-xs text-muted" :title="r.orgEmail">{{ r.orgEmail }}</p>
              </td>
              <td class="whitespace-nowrap">
                <RouterLink :to="`/domains/${r.domainId}`" class="hover:text-brand hover:underline" @click.stop>{{ r.domain }}</RouterLink>
              </td>
              <td class="whitespace-nowrap text-muted tabular-nums">
                {{ period(r.beginTs, r.endTs) }}
              </td>
              <td><PolicyBadge :policy="r.p" :pct="r.pct" /></td>
              <td class="text-right tabular-nums">{{ num(r.messages) }}</td>
              <td>
                <div class="flex items-center gap-2.5">
                  <span class="w-12 text-sm font-medium tabular-nums" :class="tone(compliance(r))">{{ compliance(r) === null ? "—" : `${compliance(r)}%` }}</span>
                  <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle" role="img" :aria-label="$t('reports.list.complianceAria', { pass: num(r.pass), messages: num(r.messages) })">
                    <div class="h-full rounded-full" :class="bar(compliance(r))" :style="{ width: `${compliance(r) ?? 0}%` }" />
                  </div>
                </div>
              </td>
              <td class="text-right tabular-nums">{{ num(r.recordCount) }}</td>
              <td class="whitespace-nowrap">
                <p class="text-sm">{{ ago(r.receivedAt) }}</p>
                <p class="text-xs text-muted" :title="r.source"><span class="font-medium">{{ sourceLabel(r.source).kind }}</span><span v-if="sourceLabel(r.source).detail" class="ml-1 inline-block max-w-32 truncate align-bottom">{{ sourceLabel(r.source).detail }}</span></p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pagination v-model="page" :total="data.total" :page-size="PAGE_SIZE" />
    </template>
  </section>
</template>

<script setup lang="ts">
import { Activity, AlertOctagon, Inbox, MailCheck, Network, Plus } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import BarList from "@/components/charts/BarList.vue";
import ComplianceChart from "@/components/charts/ComplianceChart.vue";
import Donut from "@/components/charts/Donut.vue";
import ScoreRing from "@/components/charts/ScoreRing.vue";
import Sparkline from "@/components/charts/Sparkline.vue";
import StackBar from "@/components/charts/StackBar.vue";
import VolumeChart from "@/components/charts/VolumeChart.vue";
import IpCell from "@/components/dmarc/IpCell.vue";
import PolicyBadge from "@/components/dmarc/PolicyBadge.vue";
import RangePicker from "@/components/dmarc/RangePicker.vue";
import SourceStatusBadge from "@/components/dmarc/SourceStatusBadge.vue";
import Card from "@/components/ui/Card.vue";
import Empty from "@/components/ui/Empty.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import Stat from "@/components/ui/Stat.vue";
import { api } from "@/lib/api";
import { useChartTokens } from "@/lib/chart";
import { ago, CATEGORY, num, pct, short } from "@/lib/format";
import type { Category, DomainSummary, Overview, Provider, Reporter, Source, Timeseries } from "@/lib/types";
import { useLoader } from "@/lib/useLoader";
import { useFilters } from "@/stores/filters";

const { t } = useI18n();
const router = useRouter();
const { query, days } = storeToRefs(useFilters());

const { data, loading } = useLoader(
  async () => {
    const q = query.value;
    const [overview, ts, domains, providers, reporters, sources] = await Promise.all([
      api.get<Overview>("/stats/overview", q),
      api.get<Timeseries>("/stats/timeseries", q),
      api.get<DomainSummary[]>("/domains", q),
      api.get<Provider[]>("/stats/providers", q),
      api.get<Reporter[]>("/stats/reporters", q),
      api.get<Source[]>("/stats/sources", { ...q, category: "suspicious", limit: 8 }),
    ]);
    return { overview, ts, domains, providers, reporters, sources };
  },
  [query],
);

const ov = computed(() => data.value?.overview);
const change = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);
const complianceDelta = computed(() =>
  ov.value?.compliance !== null && ov.value?.previous.compliance !== null && ov.value
    ? Math.round(((ov.value.compliance ?? 0) - (ov.value.previous.compliance ?? 0)) * 10) / 10
    : null,
);
const donut = computed(() =>
  (["pass", "forwarded", "misaligned", "fail"] as Category[]).map((c) => ({
    key: c,
    name: CATEGORY[c].label,
    value: ov.value?.categories[c] ?? 0,
    color: `var(--c-series-${c})`,
  })),
);
const tokens = useChartTokens();
const donutItems = computed(() => donut.value.map((d) => ({ ...d, color: tokens.value.series[d.key] })));
const empty = computed(() => !loading.value && data.value && data.value.domains.length === 0);
const noData = computed(() => !loading.value && ov.value && ov.value.messages === 0);
const sortedDomains = computed(() => [...(data.value?.domains ?? [])].sort((a, b) => b.messages - a.messages));
</script>

<template>
  <PageHeader :title="$t('common.nav.dashboard')" :subtitle="$t('dashboard.subtitle', { days })">
    <RangePicker />
  </PageHeader>

  <Empty v-if="empty" :icon="Inbox" :title="$t('dashboard.empty.title')" :description="$t('dashboard.empty.description')">
    <div class="flex gap-2">
      <RouterLink to="/domains" class="btn-primary"><Plus class="size-4" />{{ $t("dashboard.empty.addDomain") }}</RouterLink>
      <RouterLink to="/ingest" class="btn-secondary">{{ $t("dashboard.empty.setupIngest") }}</RouterLink>
    </div>
  </Empty>

  <template v-else>
    <!-- KPIs -->
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <template v-if="ov">
        <Stat :label="$t('dashboard.kpi.messages')" :value="short(ov.messages)" :icon="Activity" :delta="change(ov.messages, ov.previous.messages)" :hint="$t('dashboard.kpi.vsPrevious')" />
        <Stat
          :label="$t('dashboard.kpi.compliance')"
          :value="pct(ov.compliance)"
          :icon="MailCheck"
          tone="pass"
          :delta="complianceDelta"
          delta-suffix=" pp"
          :hint="$t('dashboard.kpi.alignedHint', { spf: pct(ov.spfAlignedRate), dkim: pct(ov.dkimAlignedRate) })"
        />
        <Stat :label="$t('dashboard.kpi.sources')" :value="num(ov.sources)" :icon="Network" tone="forwarded" neutral :delta="change(ov.sources, ov.previous.sources)" :hint="$t('dashboard.kpi.reportsHint', { n: num(ov.reports) }, ov.reports)" />
        <Stat
          :label="$t('dashboard.kpi.unauthenticated')"
          :value="short(ov.categories.fail)"
          :icon="AlertOctagon"
          tone="fail"
          invert
          :delta="change(ov.categories.fail, ov.previous.categories.fail)"
          :hint="$t('dashboard.kpi.dispositionHint', { reject: num(ov.disposition.reject), quarantine: num(ov.disposition.quarantine) })"
        />
      </template>
      <template v-else>
        <Skeleton v-for="i in 4" :key="i" class="h-[132px]" />
      </template>
    </div>

    <div v-if="noData" class="card mt-6 border-dashed">
      <Empty :title="$t('dashboard.noData.title')" :description="$t('dashboard.noData.description')" />
    </div>

    <template v-else>
      <!-- Volume + composition -->
      <div class="mt-6 grid gap-6 xl:grid-cols-3">
        <Card :title="$t('dashboard.volume.title')" :subtitle="$t('dashboard.volume.subtitle')" class="xl:col-span-2">
          <VolumeChart v-if="data" :data="data.ts" />
          <Skeleton v-else class="h-[280px]" />
        </Card>
        <Card :title="$t('dashboard.composition.title')">
          <div v-if="ov" class="flex flex-col items-center gap-5">
            <Donut :items="donutItems" :center="pct(ov.compliance)" :center-label="$t('dashboard.composition.centerLabel')" />
            <ul class="w-full space-y-2.5">
              <li v-for="d in donut" :key="d.key" class="flex items-start gap-3">
                <span class="mt-1 size-2.5 shrink-0 rounded-sm" :style="{ background: d.color }" />
                <div class="min-w-0 flex-1">
                  <div class="flex justify-between gap-2 text-sm">
                    <span class="font-medium">{{ d.name }}</span>
                    <span class="tabular-nums">{{ num(d.value) }}</span>
                  </div>
                  <p class="text-xs text-muted">{{ CATEGORY[d.key].hint }}</p>
                </div>
              </li>
            </ul>
          </div>
          <Skeleton v-else class="h-80" />
        </Card>
      </div>

      <!-- Domains -->
      <Card :title="$t('dashboard.health.title')" :subtitle="$t('dashboard.health.subtitle')" class="mt-6" flush>
        <template #actions><RouterLink to="/domains" class="btn-ghost btn-sm">{{ $t("common.actions.viewAll") }}</RouterLink></template>
        <div class="overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>{{ $t("dashboard.health.cols.domain") }}</th>
                <th>{{ $t("dashboard.health.cols.health") }}</th>
                <th>{{ $t("dashboard.health.cols.policy") }}</th>
                <th class="text-right">{{ $t("dashboard.health.cols.messages") }}</th>
                <th class="w-56">{{ $t("dashboard.health.cols.classification") }}</th>
                <th>{{ $t("dashboard.health.cols.compliance") }}</th>
                <th>{{ $t("dashboard.health.cols.lastReport") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in sortedDomains.slice(0, 8)" :key="d.id" class="row-link" @click="router.push(`/domains/${d.id}`)">
                <td>
                  <p class="font-medium">{{ d.name }}</p>
                  <p v-if="d.displayName" class="text-xs text-muted">{{ d.displayName }}</p>
                </td>
                <td><ScoreRing :score="d.health" :size="40" :stroke="4" /></td>
                <td><PolicyBadge :policy="d.policy" :pct="d.pct" /></td>
                <td class="text-right tabular-nums">{{ num(d.messages) }}</td>
                <td>
                  <StackBar :pass="d.messages - d.failing - d.misaligned" :forwarded="0" :misaligned="d.misaligned" :fail="d.failing" />
                </td>
                <td>
                  <div class="flex items-center gap-3">
                    <span class="w-12 text-sm font-medium tabular-nums">{{ pct(d.compliance) }}</span>
                    <Sparkline :values="d.spark.map((s) => s.compliance)" :min="0" :max="100" :width="96" :height="28" />
                  </div>
                </td>
                <td class="text-sm text-muted">{{ ago(d.lastReportAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div class="mt-6 grid gap-6 xl:grid-cols-3">
        <Card :title="$t('dashboard.trend.title')" :subtitle="$t('dashboard.trend.subtitle')" class="xl:col-span-2">
          <ComplianceChart v-if="data" :days="data.ts.days" :values="data.ts.series.compliance" />
        </Card>
        <Card :title="$t('dashboard.reporters.title')" :subtitle="$t('dashboard.reporters.subtitle')">
          <BarList
            v-if="data"
            :items="data.reporters.slice(0, 7).map((r) => ({ key: r.name, label: r.name, value: r.messages, sub: t('dashboard.reporters.reports', { n: num(r.reports) }, r.reports) }))"
            :value-label="short"
          />
        </Card>
      </div>

      <div class="mt-6 grid gap-6 xl:grid-cols-2">
        <Card :title="$t('dashboard.providers.title')" :subtitle="$t('dashboard.providers.subtitle')">
          <template #actions><RouterLink to="/sources" class="btn-ghost btn-sm">{{ $t("dashboard.providers.explore") }}</RouterLink></template>
          <ul v-if="data" class="space-y-3">
            <li v-for="p in data.providers.slice(0, 7)" :key="p.name">
              <div class="mb-1.5 flex items-center justify-between gap-3 text-sm">
                <span class="flex min-w-0 items-center gap-2">
                  <span class="truncate font-medium">{{ p.name }}</span>
                  <span class="text-xs text-faint">{{ $t("dashboard.providers.ips", { n: p.ips }, p.ips) }}</span>
                </span>
                <span class="flex shrink-0 items-center gap-3">
                  <SourceStatusBadge :status="p.status" />
                  <span class="w-16 text-right tabular-nums">{{ short(p.messages) }}</span>
                </span>
              </div>
              <StackBar :pass="p.pass" :forwarded="p.forwarded" :misaligned="p.misaligned" :fail="p.fail" :height="6" />
            </li>
          </ul>
        </Card>
        <Card :title="$t('dashboard.suspicious.title')" :subtitle="$t('dashboard.suspicious.subtitle')" flush>
          <template #actions><RouterLink to="/sources?status=suspicious" class="btn-ghost btn-sm">{{ $t("dashboard.suspicious.viewAll") }}</RouterLink></template>
          <Empty v-if="data && !data.sources.length" :title="$t('dashboard.suspicious.emptyTitle')" :description="$t('dashboard.suspicious.emptyDescription')" />
          <table v-else class="table">
            <thead>
              <tr><th>{{ $t("dashboard.suspicious.cols.origin") }}</th><th>{{ $t("dashboard.suspicious.cols.domains") }}</th><th class="text-right">{{ $t("dashboard.suspicious.cols.failed") }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="s in data?.sources ?? []" :key="s.ip" class="row-link" @click="router.push(`/sources/${encodeURIComponent(s.ip)}`)">
                <td class="max-w-64"><IpCell :ip="s.ip" :ptr="s.ptr" :provider="s.provider" :country="s.country" /></td>
                <td class="max-w-40 truncate text-sm text-muted">{{ s.domains.join(", ") }}</td>
                <td class="text-right font-medium text-fail tabular-nums">{{ num(s.fail) }}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>
    </template>
  </template>
</template>

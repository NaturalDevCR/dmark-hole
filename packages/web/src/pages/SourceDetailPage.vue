<script setup lang="ts">
import { ArrowLeft } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
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
import { CATEGORY, countryName, day, flag, num, pct, ratio } from "@/lib/format";
import type { Category, DkimAuth, SpfAuth } from "@/lib/types";
import { useLoader } from "@/lib/useLoader";
import { useFilters } from "@/stores/filters";

const props = defineProps<{ ip: string }>();
const { t } = useI18n();
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
  const tot = { messages: 0, pass: 0, forwarded: 0, misaligned: 0, fail: 0, domains: new Set<string>(), reporters: new Set<string>() };
  for (const r of data.value?.records ?? []) {
    tot.messages += r.count;
    tot[r.category] += r.count;
    tot.domains.add(r.domain);
    tot.reporters.add(r.reporter);
  }
  return tot;
});
</script>

<template>
  <PageHeader :title="ip" :subtitle="data?.info.ptr ?? $t('sources.detail.noReverseDns')">
    <template #eyebrow>
      <a class="inline-flex cursor-pointer items-center gap-1 hover:text-fg" @click="router.back()"><ArrowLeft class="size-3.5" />{{ $t("common.nav.back") }}</a>
    </template>
    <CopyButton :text="ip" />
    <RangePicker />
  </PageHeader>

  <div v-if="loading && !data" class="grid gap-4 sm:grid-cols-4"><Skeleton v-for="i in 4" :key="i" class="h-28" /></div>

  <template v-else-if="data">
    <div class="grid gap-4 lg:grid-cols-3">
      <Card :title="$t('sources.detail.identification')" class="lg:col-span-1">
        <dl class="space-y-2.5 text-sm">
          <div class="flex justify-between gap-3"><dt class="text-muted">{{ $t("sources.detail.provider") }}</dt><dd class="font-medium">{{ data.info.provider ?? $t("common.unknown") }}</dd></div>
          <div class="flex justify-between gap-3"><dt class="text-muted">{{ $t("sources.detail.ptr") }}</dt><dd class="mono truncate" :title="data.info.ptr ?? ''">{{ data.info.ptr ?? "—" }}</dd></div>
          <div class="flex justify-between gap-3"><dt class="text-muted">{{ $t("sources.detail.asn") }}</dt><dd class="truncate text-right">{{ data.info.asn ? `AS${data.info.asn}` : "—" }} <span class="text-muted">{{ data.info.asName }}</span></dd></div>
          <div class="flex justify-between gap-3"><dt class="text-muted">{{ $t("sources.detail.country") }}</dt><dd>{{ flag(data.info.country) }} {{ countryName(data.info.country) }}</dd></div>
        </dl>
      </Card>
      <div class="grid gap-4 sm:grid-cols-2 lg:col-span-2">
        <Stat
          :label="$t('sources.detail.messages')"
          :value="num(totals.messages)"
          :hint="`${t('sources.detail.domainsCount', { n: totals.domains.size }, totals.domains.size)} · ${t('sources.detail.reportersCount', { n: totals.reporters.size }, totals.reporters.size)}`"
        />
        <Stat
          :label="$t('sources.detail.dmarcPass')"
          :value="pct(ratio(totals.pass + totals.forwarded, totals.messages))"
          tone="pass"
          :hint="$t('sources.detail.passHint', { fail: num(totals.fail), misaligned: num(totals.misaligned) })"
        />
        <div class="card p-5 sm:col-span-2">
          <StackBar :pass="totals.pass" :forwarded="totals.forwarded" :misaligned="totals.misaligned" :fail="totals.fail" :height="10" />
          <div class="mt-3 flex flex-wrap gap-4 text-xs text-muted">
            <span><span class="text-pass">●</span> {{ CATEGORY.pass.label }} {{ num(totals.pass) }}</span>
            <span><span class="text-forwarded">●</span> {{ CATEGORY.forwarded.label }} {{ num(totals.forwarded) }}</span>
            <span><span class="text-misaligned">●</span> {{ CATEGORY.misaligned.label }} {{ num(totals.misaligned) }}</span>
            <span><span class="text-fail">●</span> {{ CATEGORY.fail.label }} {{ num(totals.fail) }}</span>
          </div>
        </div>
      </div>
    </div>

    <Card :title="$t('sources.detail.records.title')" :subtitle="$t('sources.detail.records.subtitle')" class="mt-6" flush>
      <Empty v-if="!data.records.length" :title="$t('sources.detail.records.empty')" />
      <div v-else class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>{{ $t("sources.detail.records.cols.date") }}</th>
              <th>{{ $t("sources.detail.records.cols.domain") }}</th>
              <th>{{ $t("sources.detail.records.cols.reporter") }}</th>
              <th class="text-right">{{ $t("sources.detail.records.cols.messages") }}</th>
              <th>{{ $t("sources.detail.records.cols.result") }}</th>
              <th>{{ $t("sources.detail.records.cols.authentication") }}</th>
              <th>{{ $t("sources.detail.records.cols.disposition") }}</th>
            </tr>
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
                  <span v-if="!r.dkim.length" class="text-xs text-faint">{{ $t("common.auth.noDkim") }}</span>
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

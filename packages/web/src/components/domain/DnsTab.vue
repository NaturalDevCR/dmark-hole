<script setup lang="ts">
import { History, RefreshCw } from "lucide-vue-next";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import ScoreRing from "@/components/charts/ScoreRing.vue";
import CheckList from "@/components/dmarc/CheckList.vue";
import Badge from "@/components/ui/Badge.vue";
import Card from "@/components/ui/Card.vue";
import CopyButton from "@/components/ui/CopyButton.vue";
import Empty from "@/components/ui/Empty.vue";
import Spinner from "@/components/ui/Spinner.vue";
import { api, withToast } from "@/lib/api";
import { ago, date } from "@/lib/format";
import type { Check, DnsReport, DomainDetail } from "@/lib/types";
import { useLoader } from "@/lib/useLoader";
import SpfTree from "./SpfTree.vue";

const props = defineProps<{ domain: DomainDetail }>();
const { t, te } = useI18n();
const emit = defineEmits<{ updated: [DnsReport] }>();
const dns = computed(() => props.domain.dnsResult);
const checking = ref(false);
const showTree = ref(false);

async function recheck() {
  checking.value = true;
  const r = await withToast(() => api.post<DnsReport>(`/domains/${props.domain.id}/dns-check`), t("dns.checkDone"));
  checking.value = false;
  if (r) {
    emit("updated", r);
    history.reload();
  }
}

const history = useLoader(() => api.get<{ checkedAt: number; records: Record<string, unknown> }[]>(`/domains/${props.domain.id}/dns-history`));

/** Description of a DMARC tag (empty when the tag is unknown). */
const tagLabel = (k: string | number) => (te(`dns.dmarc.tags.${k}`) ? t(`dns.dmarc.tags.${k}`) : "");

const worst = (checks: Check[]) =>
  checks.some((c) => c.status === "error") ? "fail" : checks.some((c) => c.status === "warning") ? "misaligned" : checks.length ? "pass" : "neutral";
const statusLabel = (k: "fail" | "misaligned" | "pass" | "neutral") => t(`dns.status.${k}`);

function describeChange(before: Record<string, unknown> | undefined, after: Record<string, unknown>) {
  if (!before) return [t("dns.history.first")];
  return Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}
const NAMES: Record<string, string> = { dmarc: "DMARC", spf: "SPF", dkim: "DKIM", mx: "MX", mtaSts: "MTA-STS", tlsRpt: "TLS-RPT", bimi: "BIMI" };
</script>

<template>
  <Empty v-if="!dns" :title="$t('dns.notChecked.title')" :description="$t('dns.notChecked.description')">
    <button class="btn-primary" :disabled="checking" @click="recheck"><Spinner v-if="checking" /><RefreshCw v-else class="size-4" />{{ $t("dns.checkNow") }}</button>
  </Empty>

  <div v-else class="space-y-6">
    <div class="card flex flex-wrap items-center gap-5 p-5">
      <ScoreRing :score="dns.score" :size="64" label="DNS" />
      <div class="min-w-0 flex-1">
        <p class="font-semibold">{{ $t("dns.posture.title") }}</p>
        <p class="text-sm text-muted">{{ $t("dns.posture.checked", { ago: ago(dns.checkedAt), date: date(dns.checkedAt, true) }) }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <Badge v-for="k in ['dmarc', 'spf', 'dkim'] as const" :key="k" :tone="worst(dns[k].checks.concat(k === 'dkim' ? dns.dkim.selectors.flatMap((s) => s.checks) : []))">
          {{ NAMES[k] }}: {{ statusLabel(worst(dns[k].checks.concat(k === "dkim" ? dns.dkim.selectors.flatMap((s) => s.checks) : []))) }}
        </Badge>
      </div>
      <button class="btn-secondary" :disabled="checking" @click="recheck"><Spinner v-if="checking" /><RefreshCw v-else class="size-4" />{{ $t("dns.checkNow") }}</button>
    </div>

    <div class="grid gap-6 xl:grid-cols-2">
      <!-- DMARC -->
      <Card title="DMARC" :subtitle="$t(dns.dmarc.source === 'organizational' ? 'dns.dmarc.subtitleInherited' : 'dns.dmarc.subtitle', { name: domain.name })">
        <div v-if="dns.dmarc.record" class="mb-4 flex items-start gap-1 rounded-lg border border-line bg-subtle px-3 py-2">
          <code class="mono min-w-0 flex-1 break-all">{{ dns.dmarc.record }}</code>
          <CopyButton :text="dns.dmarc.record" />
        </div>
        <dl v-if="Object.keys(dns.dmarc.tags).length" class="mb-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <template v-for="(v, k) in dns.dmarc.tags" :key="k">
            <dt class="mono text-muted">{{ k }}</dt>
            <dd class="min-w-0">
              <span class="mono break-all">{{ v }}</span>
              <span v-if="tagLabel(k)" class="ml-2 text-xs text-faint">{{ tagLabel(k) }}</span>
            </dd>
          </template>
        </dl>
        <CheckList :checks="dns.dmarc.checks" />
      </Card>

      <!-- SPF -->
      <Card title="SPF" :subtitle="domain.name">
        <template #actions>
          <span class="text-xs text-muted">{{ $t("dns.spf.lookups") }}</span>
          <span class="font-semibold tabular-nums" :class="dns.spf.lookups > 10 ? 'text-fail' : dns.spf.lookups >= 8 ? 'text-misaligned' : 'text-pass'">{{ dns.spf.lookups }}/10</span>
        </template>
        <div v-if="dns.spf.record" class="mb-3 flex items-start gap-1 rounded-lg border border-line bg-subtle px-3 py-2">
          <code class="mono min-w-0 flex-1 break-all">{{ dns.spf.record }}</code>
          <CopyButton :text="dns.spf.record" />
        </div>
        <div v-if="dns.spf.record" class="mb-4 h-1.5 overflow-hidden rounded-full bg-subtle">
          <div
            class="h-full rounded-full"
            :class="dns.spf.lookups > 10 ? 'bg-fail' : dns.spf.lookups >= 8 ? 'bg-misaligned' : 'bg-pass'"
            :style="{ width: `${Math.min(100, dns.spf.lookups * 10)}%` }"
          />
        </div>
        <CheckList :checks="dns.spf.checks" />
        <div v-if="dns.spf.tree?.record" class="mt-4 border-t border-line pt-3">
          <button class="btn-ghost btn-sm -ml-2" @click="showTree = !showTree">{{ showTree ? $t("dns.spf.hideTree") : $t("dns.spf.showTree") }}</button>
          <div v-if="showTree" class="mt-2 max-h-96 overflow-auto"><SpfTree :node="dns.spf.tree" /></div>
        </div>
      </Card>
    </div>

    <!-- DKIM -->
    <Card title="DKIM" :subtitle="$t('dns.dkim.subtitle')" flush>
      <div v-if="dns.dkim.checks.length" class="border-b border-line p-5"><CheckList :checks="dns.dkim.checks" /></div>
      <div v-if="dns.dkim.selectors.length" class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>{{ $t("dns.dkim.cols.selector") }}</th>
              <th>{{ $t("dns.dkim.cols.domain") }}</th>
              <th>{{ $t("dns.dkim.cols.status") }}</th>
              <th>{{ $t("dns.dkim.cols.key") }}</th>
              <th>{{ $t("dns.dkim.cols.origin") }}</th>
              <th>{{ $t("dns.dkim.cols.diagnosis") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in dns.dkim.selectors" :key="s.selector + s.domain">
              <td class="mono font-medium">{{ s.selector }}</td>
              <td class="mono text-muted">{{ s.domain }}</td>
              <td>
                <Badge v-if="!s.found" tone="fail">{{ $t("dns.dkim.notPublished") }}</Badge>
                <Badge v-else-if="s.revoked" tone="neutral">{{ $t("dns.dkim.revoked") }}</Badge>
                <Badge v-else tone="pass">{{ $t("dns.dkim.published") }}</Badge>
              </td>
              <td class="text-sm">{{ s.keyType ? $t("dns.dkim.key", { type: s.keyType.toUpperCase(), bits: s.keyBits ?? "?" }) : "—" }}</td>
              <td class="text-sm text-muted">{{ s.fromReports ? $t("dns.dkim.origin.reports") : $t("dns.dkim.origin.detection") }}</td>
              <td class="text-sm">
                <span v-for="(c, i) in s.checks" :key="i" class="block" :class="{ 'text-fail': c.status === 'error', 'text-misaligned': c.status === 'warning', 'text-muted': c.status === 'ok' || c.status === 'info' }">{{ c.title }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="border-t border-line px-5 py-3 text-xs text-muted">{{ $t("dns.dkim.missingHint") }}</p>
    </Card>

    <div class="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
      <Card title="MX">
        <ul v-if="dns.mx.hosts.length" class="mb-3 space-y-1 text-sm">
          <li v-for="h in dns.mx.hosts" :key="h.exchange" class="flex gap-2"><span class="w-6 text-right text-faint tabular-nums">{{ h.priority }}</span><span class="mono truncate">{{ h.exchange || "." }}</span></li>
        </ul>
        <CheckList :checks="dns.mx.checks" />
      </Card>
      <Card title="MTA-STS">
        <i18n-t v-if="dns.mtaSts.policy" keypath="dns.mtaSts.mode" tag="p" class="mb-3 text-sm">
          <template #mode><b>{{ dns.mtaSts.policy.mode }}</b></template>
          <template #n>{{ dns.mtaSts.policy.mx.length }}</template>
        </i18n-t>
        <CheckList :checks="dns.mtaSts.checks" />
      </Card>
      <Card title="TLS-RPT">
        <CheckList :checks="dns.tlsRpt.checks" />
      </Card>
      <Card title="BIMI">
        <img v-if="dns.bimi.logo" :src="dns.bimi.logo" :alt="$t('dns.bimi.logoAlt')" class="mb-3 size-12 rounded" referrerpolicy="no-referrer" />
        <CheckList :checks="dns.bimi.checks" />
      </Card>
    </div>

    <Card :title="$t('dns.history.title')" :subtitle="$t('dns.history.subtitle')" flush>
      <template #actions><History class="size-4 text-faint" /></template>
      <ul v-if="history.data.value?.length" class="divide-y divide-line">
        <li v-for="(h, i) in history.data.value" :key="h.checkedAt" class="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
          <span class="w-44 text-muted">{{ date(h.checkedAt, true) }}</span>
          <Badge v-for="k in describeChange(history.data.value[i + 1]?.records, h.records)" :key="k" :tone="k === 'dmarc' || k === 'spf' ? 'misaligned' : 'neutral'">
            {{ NAMES[k] ?? k }}
          </Badge>
          <code v-if="h.records.dmarc" class="mono ml-auto max-w-full truncate text-xs text-muted md:max-w-md" :title="String(h.records.dmarc)">{{ h.records.dmarc }}</code>
        </li>
      </ul>
      <Empty v-else :title="$t('dns.history.empty')" />
    </Card>
  </div>
</template>

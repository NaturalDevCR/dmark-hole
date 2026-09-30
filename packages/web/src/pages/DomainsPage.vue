<script setup lang="ts">
import { AlertTriangle, Globe, Plus, Search, Sparkles } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
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

const { t } = useI18n();
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
  const r = await withToast(() => api.post<{ id: number }>("/domains", form.value), t("domains.addModal.added"));
  saving.value = false;
  if (r) {
    showAdd.value = false;
    form.value = { name: "", displayName: "", notes: "" };
    router.push(`/domains/${r.id}`);
  }
}
</script>

<template>
  <PageHeader :title="$t('common.nav.domains')" :subtitle="$t('domains.subtitle', { n: data?.length ?? 0, days }, data?.length ?? 0)">
    <RangePicker />
    <button v-if="auth.isAdmin" class="btn-primary" @click="showAdd = true"><Plus class="size-4" />{{ $t("domains.add") }}</button>
  </PageHeader>

  <div class="mb-5 flex flex-wrap items-center gap-3">
    <div class="relative w-full max-w-xs">
      <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
      <input v-model="search" class="input pl-9" :placeholder="$t('domains.searchPlaceholder')" />
    </div>
    <select v-model="sort" class="input w-auto">
      <option value="messages">{{ $t("domains.sort.messages") }}</option>
      <option value="health">{{ $t("domains.sort.health") }}</option>
      <option value="name">{{ $t("domains.sort.name") }}</option>
    </select>
  </div>

  <div v-if="loading && !data" class="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
    <Skeleton v-for="i in 6" :key="i" class="h-56" />
  </div>

  <Empty
    v-else-if="data && !data.length"
    :icon="Globe"
    :title="$t('domains.empty.title')"
    :description="$t('domains.empty.description')"
  >
    <button v-if="auth.isAdmin" class="btn-primary" @click="showAdd = true"><Plus class="size-4" />{{ $t("domains.add") }}</button>
  </Empty>

  <div v-else class="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
    <RouterLink
      v-for="d in list"
      :key="d.id"
      :to="`/domains/${d.id}`"
      class="card group flex flex-col p-5 transition hover:border-line-strong hover:shadow-md"
    >
      <div class="flex items-start gap-4">
        <ScoreRing :score="d.health" :size="52" :label="$t('domains.card.health')" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-base font-semibold group-hover:text-brand">{{ d.name }}</p>
          <p class="truncate text-sm text-muted">{{ d.displayName || (d.lastReportAt ? $t("domains.card.lastReport", { ago: ago(d.lastReportAt) }) : $t("domains.card.noReports")) }}</p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <PolicyBadge :policy="d.policy" :pct="d.pct" />
            <Badge v-if="d.autoCreated" tone="brand"><Sparkles class="size-3" />{{ $t("domains.card.detected") }}</Badge>
            <Badge v-if="d.dnsIssues" tone="fail"><AlertTriangle class="size-3" />{{ $t("domains.card.dnsErrors", { n: d.dnsIssues }, d.dnsIssues) }}</Badge>
          </div>
        </div>
      </div>

      <div class="mt-5 grid grid-cols-3 gap-3 text-sm">
        <div>
          <p class="text-xs text-muted">{{ $t("domains.card.messages") }}</p>
          <p class="mt-0.5 font-semibold tabular-nums">{{ short(d.messages) }}</p>
        </div>
        <div>
          <p class="text-xs text-muted">{{ $t("domains.card.compliance") }}</p>
          <p class="mt-0.5 font-semibold tabular-nums">{{ pct(d.compliance) }}</p>
        </div>
        <div>
          <p class="text-xs text-muted">{{ $t("domains.card.unauthenticated") }}</p>
          <p class="mt-0.5 font-semibold tabular-nums" :class="d.failing ? 'text-fail' : ''">{{ num(d.failing) }}</p>
        </div>
      </div>

      <div class="mt-4 flex items-end justify-between gap-4">
        <div class="min-w-0 flex-1">
          <StackBar :pass="d.messages - d.failing - d.misaligned" :forwarded="0" :misaligned="d.misaligned" :fail="d.failing" :height="6" />
          <p class="mt-1.5 text-xs text-faint">{{ $t("domains.card.sourcesDns", { n: num(d.sources), score: d.dnsScore ?? "—" }, d.sources) }}</p>
        </div>
        <Sparkline :values="d.spark.map((s) => s.compliance)" :min="0" :max="100" :width="100" :height="30" />
      </div>
    </RouterLink>
  </div>

  <Modal v-if="showAdd" :title="$t('domains.addModal.title')" @close="showAdd = false">
    <form id="add-domain" class="space-y-4" @submit.prevent="add">
      <div>
        <label class="label" for="dn">{{ $t("domains.addModal.domain") }}</label>
        <input id="dn" v-model="form.name" class="input" :placeholder="$t('domains.addModal.domainPlaceholder')" required autofocus />
        <p class="mt-1.5 text-xs text-muted">{{ $t("domains.addModal.domainHelp") }}</p>
      </div>
      <div>
        <label class="label" for="dd">{{ $t("domains.addModal.displayName") }}</label>
        <input id="dd" v-model="form.displayName" class="input" :placeholder="$t('domains.addModal.displayNamePlaceholder')" />
      </div>
      <div>
        <label class="label" for="nt">{{ $t("domains.addModal.notes") }}</label>
        <textarea id="nt" v-model="form.notes" class="input min-h-20" />
      </div>
    </form>
    <template #footer>
      <button class="btn-secondary" @click="showAdd = false">{{ $t("common.actions.cancel") }}</button>
      <button class="btn-primary" form="add-domain" :disabled="saving"><Spinner v-if="saving" />{{ $t("common.actions.add") }}</button>
    </template>
  </Modal>
</template>

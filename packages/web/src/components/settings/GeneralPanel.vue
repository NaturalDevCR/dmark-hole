<script setup lang="ts">
import Skeleton from "@/components/ui/Skeleton.vue";
import Toggle from "@/components/ui/Toggle.vue";
import SaveBar from "./SaveBar.vue";
import { useSettingsDraft } from "./useSettingsDraft";

const int = (v: unknown) => Math.max(0, Math.trunc(Number(v) || 0));

const { draft, loading, error, saving, dirty, save, reset } = useSettingsDraft(
  (s) => ({
    autoCreateDomains: s.autoCreateDomains,
    storeRawXml: s.storeRawXml,
    enrichment: s.enrichment,
    retentionDays: s.retentionDays,
    forensicRetentionDays: s.forensicRetentionDays,
    dnsCheckHours: s.dnsCheckHours,
  }),
  (d) => ({ ...d, retentionDays: int(d.retentionDays), forensicRetentionDays: int(d.forensicRetentionDays), dnsCheckHours: int(d.dnsCheckHours) }),
);
</script>

<template>
  <Skeleton v-if="loading" class="h-96" />
  <p v-else-if="error" class="text-sm text-fail">{{ error }}</p>
  <form v-else-if="draft" class="space-y-6" @submit.prevent="save">
    <section class="card">
      <header class="card-header"><h3 class="card-title">{{ $t("settings.general.processingTitle") }}</h3></header>
      <div class="card-body space-y-5">
        <Toggle
          v-model="draft.autoCreateDomains"
          :label="$t('settings.general.autoCreate')"
          :description="$t('settings.general.autoCreateHint')"
        />
        <Toggle
          v-model="draft.storeRawXml"
          :label="$t('settings.general.storeRaw')"
          :description="$t('settings.general.storeRawHint')"
        />
        <Toggle
          v-model="draft.enrichment"
          :label="$t('settings.general.enrichment')"
          :description="$t('settings.general.enrichmentHint')"
        />
      </div>
    </section>

    <section class="card">
      <header class="card-header"><h3 class="card-title">{{ $t("settings.general.retentionTitle") }}</h3></header>
      <div class="card-body grid gap-5 sm:grid-cols-3">
        <div>
          <label class="label" for="s-ret">{{ $t("settings.general.retention") }}</label>
          <input id="s-ret" v-model.number="draft.retentionDays" type="number" min="0" max="3650" class="input" />
          <p class="mt-1.5 text-xs text-muted">{{ $t("settings.general.retentionHint") }}</p>
        </div>
        <div>
          <label class="label" for="s-fret">{{ $t("settings.general.forensicRetention") }}</label>
          <input id="s-fret" v-model.number="draft.forensicRetentionDays" type="number" min="0" max="3650" class="input" />
          <p class="mt-1.5 text-xs text-muted">{{ $t("settings.general.forensicRetentionHint") }}</p>
        </div>
        <div>
          <label class="label" for="s-dns">{{ $t("settings.general.dnsCheck") }}</label>
          <input id="s-dns" v-model.number="draft.dnsCheckHours" type="number" min="0" max="720" class="input" />
          <p class="mt-1.5 text-xs text-muted">{{ $t("settings.general.dnsCheckHint") }}</p>
        </div>
      </div>
    </section>
    <div class="card"><SaveBar :dirty="dirty" :saving="saving" class="border-t-0" @reset="reset" /></div>
  </form>
</template>

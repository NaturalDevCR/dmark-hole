<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingsDraft } from "@/components/settings/useSettingsDraft";
import Badge from "@/components/ui/Badge.vue";
import Card from "@/components/ui/Card.vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import Spinner from "@/components/ui/Spinner.vue";
import Toggle from "@/components/ui/Toggle.vue";
import { api, withToast } from "@/lib/api";
import { num } from "@/lib/format";
import type { IngestStatus, Settings } from "@/lib/types";
import CodeLine from "./CodeLine.vue";

const { t } = useI18n();
const props = defineProps<{ status: IngestStatus | null; admin: boolean }>();
const emit = defineEmits<{ reload: [] }>();

const parseList = (text: string) => [...new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];

const { current, draft, loading, saving, dirty, save, reset, apply } = useSettingsDraft(
  (s) => ({ recipients: s.smtpReceiver.allowedRecipients.join("\n") }),
  (d) => ({ smtpReceiver: { allowedRecipients: parseList(d.recipients) } }),
  () => t("ingest.smtp.recipientsSaved"),
  { immediate: props.admin },
);

const enabled = computed(() => current.value?.smtpReceiver.enabled ?? props.status?.smtp.running ?? false);
const toggling = ref(false);
async function setEnabled(v: boolean) {
  toggling.value = true;
  try {
    const r = await withToast(() => api.put<Settings>("/settings", { smtpReceiver: { enabled: v } }), v ? t("ingest.smtp.enabled") : t("ingest.smtp.disabled"));
    if (r && current.value) current.value = { ...current.value, smtpReceiver: { ...current.value.smtpReceiver, enabled: r.smtpReceiver.enabled } };
    else if (r) apply(r);
  } finally {
    toggling.value = false;
    setTimeout(() => emit("reload"), 600);
  }
}

// Setup guide: a small "what would my records look like" helper.
const domain = ref("example.com");
const serverHost = ref(typeof window !== "undefined" ? window.location.hostname : "dmarc.example.com");
const port = computed(() => props.status?.smtp.port ?? 2525);
const cleanDomain = computed(() => domain.value.trim().replace(/^@/, "").toLowerCase() || "example.com");
const cleanHost = computed(() => serverHost.value.trim().toLowerCase() || "dmarc.example.com");
const reportsHost = computed(() => `reports.${cleanDomain.value}`);
const rua = computed(() => `mailto:dmarc@${reportsHost.value}`);
const mxRecord = computed(() => `${reportsHost.value}.  IN  MX  10  ${cleanHost.value}.`);
const dmarcRecord = computed(() => `_dmarc.${cleanDomain.value}.  IN  TXT  "v=DMARC1; p=none; rua=${rua.value}"`);
const authRecord = computed(() => `${cleanDomain.value}._report._dmarc.${reportsHost.value}.  IN  TXT  "v=DMARC1"`);
const dockerRun = computed(() => `-p 25:${port.value}`);
</script>

<template>
  <div class="grid gap-6 xl:grid-cols-3">
    <div class="space-y-6 xl:col-span-1">
      <Card :title="t('ingest.smtp.title')" :subtitle="t('ingest.smtp.subtitle')">
        <template #actions>
          <Badge v-if="status" :tone="status.smtp.running ? 'pass' : 'neutral'" dot>{{ status.smtp.running ? t("ingest.smtp.listening") : t("ingest.smtp.stopped") }}</Badge>
        </template>
        <div class="space-y-4">
          <Skeleton v-if="admin && loading" class="h-10" />
          <Toggle
            v-else-if="admin"
            :model-value="enabled"
            :disabled="toggling"
            :label="t('ingest.smtp.enable')"
            :description="t('ingest.smtp.enableHint')"
            @update:model-value="setEnabled"
          />
          <p v-else class="text-sm text-muted">{{ t("ingest.smtp.adminOnly") }}</p>

          <dl v-if="status" class="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-sm">
            <div><dt class="text-xs text-muted">{{ t("ingest.smtp.listenPort") }}</dt><dd class="mono">{{ status.smtp.host }}:{{ status.smtp.port }}</dd></div>
            <div><dt class="text-xs text-muted">{{ t("ingest.smtp.received") }}</dt><dd class="tabular-nums">{{ num(status.smtp.received) }}</dd></div>
            <div><dt class="text-xs text-muted">{{ t("ingest.smtp.tlsStarttls") }}</dt><dd>{{ status.smtp.tls ? t("ingest.smtp.tlsConfigured") : t("ingest.smtp.tlsNotConfigured") }}</dd></div>
          </dl>
          <p v-if="status && !status.smtp.configured" class="rounded-lg border border-misaligned/25 bg-misaligned-soft px-3 py-2 text-xs text-misaligned">
            {{ t("ingest.smtp.needRecipient") }}
          </p>
          <p v-if="status?.smtp.lastError" class="break-words rounded-lg border border-fail/20 bg-fail-soft px-3 py-2 text-xs text-fail">{{ status.smtp.lastError }}</p>
        </div>
      </Card>

      <Card v-if="admin" :title="t('ingest.smtp.recipientsTitle')" :subtitle="t('ingest.smtp.recipientsSubtitle')">
        <Skeleton v-if="loading || !draft" class="h-32" />
        <form v-else class="space-y-3" @submit.prevent="save">
          <div>
            <label class="label" for="smtp-rcpt">{{ t("ingest.smtp.recipientsLabel") }}</label>
            <textarea id="smtp-rcpt" v-model="draft.recipients" rows="4" class="input mono" placeholder="dmarc@reports.example.com&#10;@reports.example.com" spellcheck="false" />
            <i18n-t keypath="ingest.smtp.recipientsHint" tag="p" class="mt-1.5 text-xs text-muted">
              <template #full><span class="mono">dmarc@example.com</span></template>
              <template #domain><span class="mono">@example.com</span></template>
            </i18n-t>
          </div>
          <div class="flex justify-end gap-2">
            <button v-if="dirty" type="button" class="btn-ghost" @click="reset">{{ t("common.actions.discard") }}</button>
            <button type="submit" class="btn-primary" :disabled="!dirty || saving"><Spinner v-if="saving" />{{ t("common.actions.save") }}</button>
          </div>
        </form>
      </Card>
    </div>

    <Card :title="t('ingest.smtp.guide.title')" :subtitle="t('ingest.smtp.guide.subtitle')" class="xl:col-span-2">
      <div class="space-y-6 text-sm">
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="g-domain">{{ t("ingest.smtp.guide.domain") }}</label>
            <input id="g-domain" v-model="domain" class="input" placeholder="example.com" spellcheck="false" />
          </div>
          <div>
            <label class="label" for="g-host">{{ t("ingest.smtp.guide.host") }}</label>
            <input id="g-host" v-model="serverHost" class="input" placeholder="dmarc.example.com" spellcheck="false" />
          </div>
        </div>

        <ol class="space-y-5">
          <li class="flex gap-3">
            <span class="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">1</span>
            <div class="min-w-0 flex-1 space-y-2">
              <p class="font-medium">{{ t("ingest.smtp.guide.step1Title") }}</p>
              <i18n-t keypath="ingest.smtp.guide.step1Body" tag="p" class="text-muted">
                <template #addr><span class="mono">dmarc@{{ reportsHost }}</span></template>
                <template #host><span class="mono">{{ cleanHost }}</span></template>
              </i18n-t>
              <CodeLine :text="mxRecord" />
            </div>
          </li>
          <li class="flex gap-3">
            <span class="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">2</span>
            <div class="min-w-0 flex-1 space-y-2">
              <i18n-t keypath="ingest.smtp.guide.step2Title" tag="p" class="font-medium">
                <template #rua><span class="mono">rua</span></template>
              </i18n-t>
              <CodeLine :text="dmarcRecord" />
              <i18n-t keypath="ingest.smtp.guide.step2Body" tag="p" class="text-muted">
                <template #rua><span class="mono">rua</span></template>
                <template #value><span class="mono">{{ rua }}</span></template>
              </i18n-t>
              <CodeLine :text="authRecord" />
            </div>
          </li>
          <li class="flex gap-3">
            <span class="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">3</span>
            <div class="min-w-0 flex-1 space-y-2">
              <p class="font-medium">{{ t("ingest.smtp.guide.step3Title") }}</p>
              <i18n-t keypath="ingest.smtp.guide.step3Body" tag="p" class="text-muted">
                <template #port><span class="mono">{{ port }}</span></template>
                <template #std><span class="mono">25</span></template>
              </i18n-t>
              <CodeLine :text="dockerRun" :label="t('ingest.smtp.guide.dockerLabel')" />
              <p class="text-muted">{{ t("ingest.smtp.guide.step3Firewall") }}</p>
            </div>
          </li>
          <li class="flex gap-3">
            <span class="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">4</span>
            <div class="min-w-0 flex-1 space-y-2">
              <p class="font-medium">{{ t("ingest.smtp.guide.step4Title") }}</p>
              <p class="text-muted">{{ t("ingest.smtp.guide.step4Body") }}</p>
              <CodeLine :text="'SMTP_TLS_KEY=/certs/privkey.pem\nSMTP_TLS_CERT=/certs/fullchain.pem'" />
            </div>
          </li>
        </ol>
      </div>
    </Card>
  </div>
</template>

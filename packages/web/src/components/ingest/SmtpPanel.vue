<script setup lang="ts">
import { computed, ref } from "vue";
import { useSettingsDraft } from "@/components/settings/useSettingsDraft";
import Badge from "@/components/ui/Badge.vue";
import Card from "@/components/ui/Card.vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import Spinner from "@/components/ui/Spinner.vue";
import Toggle from "@/components/ui/Toggle.vue";
import { api, withToast } from "@/lib/api";
import type { IngestStatus, Settings } from "@/lib/types";
import CodeLine from "./CodeLine.vue";

const props = defineProps<{ status: IngestStatus | null; admin: boolean }>();
const emit = defineEmits<{ reload: [] }>();

const parseList = (text: string) => [...new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];

const { current, draft, loading, saving, dirty, save, reset, apply } = useSettingsDraft(
  (s) => ({ recipients: s.smtpReceiver.allowedRecipients.join("\n") }),
  (d) => ({ smtpReceiver: { allowedRecipients: parseList(d.recipients) } }),
  "Destinatarios permitidos guardados",
  { immediate: props.admin },
);

const enabled = computed(() => current.value?.smtpReceiver.enabled ?? props.status?.smtp.running ?? false);
const toggling = ref(false);
async function setEnabled(v: boolean) {
  toggling.value = true;
  try {
    const r = await withToast(() => api.put<Settings>("/settings", { smtpReceiver: { enabled: v } }), v ? "Receptor SMTP activado" : "Receptor SMTP desactivado");
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
      <Card title="Receptor SMTP" subtitle="Reciba los reportes directamente, sin buzón IMAP">
        <template #actions>
          <Badge v-if="status" :tone="status.smtp.running ? 'pass' : 'neutral'" dot>{{ status.smtp.running ? "Escuchando" : "Detenido" }}</Badge>
        </template>
        <div class="space-y-4">
          <Skeleton v-if="admin && loading" class="h-10" />
          <Toggle
            v-else-if="admin"
            :model-value="enabled"
            :disabled="toggling"
            label="Activar receptor SMTP"
            description="Inicia un servidor SMTP integrado que acepta los correos con reportes DMARC. Es más simple y en tiempo real que sondear un buzón."
            @update:model-value="setEnabled"
          />
          <p v-else class="text-sm text-muted">Solo un administrador puede activar o desactivar el receptor.</p>

          <dl v-if="status" class="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-sm">
            <div><dt class="text-xs text-muted">Puerto de escucha</dt><dd class="mono">{{ status.smtp.host }}:{{ status.smtp.port }}</dd></div>
            <div><dt class="text-xs text-muted">Recibidos</dt><dd class="tabular-nums">{{ status.smtp.received.toLocaleString("es") }}</dd></div>
            <div><dt class="text-xs text-muted">TLS (STARTTLS)</dt><dd>{{ status.smtp.tls ? "Configurado" : "No configurado" }}</dd></div>
          </dl>
          <p v-if="status && !status.smtp.configured" class="rounded-lg border border-misaligned/25 bg-misaligned-soft px-3 py-2 text-xs text-misaligned">
            Configure al menos un destinatario permitido; mientras tanto el receptor rechaza todos los mensajes.
          </p>
          <p v-if="status?.smtp.lastError" class="break-words rounded-lg border border-fail/20 bg-fail-soft px-3 py-2 text-xs text-fail">{{ status.smtp.lastError }}</p>
        </div>
      </Card>

      <Card v-if="admin" title="Destinatarios permitidos" subtitle="Direcciones RCPT TO que el receptor acepta (obligatorio)">
        <Skeleton v-if="loading || !draft" class="h-32" />
        <form v-else class="space-y-3" @submit.prevent="save">
          <div>
            <label class="label" for="smtp-rcpt">Direcciones (una por línea o separadas por comas)</label>
            <textarea id="smtp-rcpt" v-model="draft.recipients" rows="4" class="input mono" placeholder="dmarc@reports.example.com&#10;@reports.example.com" spellcheck="false" />
            <p class="mt-1.5 text-xs text-muted">Use una dirección completa (<span class="mono">dmarc@example.com</span>) o <span class="mono">@example.com</span> para aceptar todo un dominio. Obligatorio: sin destinatarios el receptor rechaza todo el correo, para que nadie en Internet pueda inyectar reportes falsos.</p>
          </div>
          <div class="flex justify-end gap-2">
            <button v-if="dirty" type="button" class="btn-ghost" @click="reset">Descartar</button>
            <button type="submit" class="btn-primary" :disabled="!dirty || saving"><Spinner v-if="saving" />Guardar</button>
          </div>
        </form>
      </Card>
    </div>

    <Card title="Guía de configuración" subtitle="Cómo hacer que los proveedores envíen sus reportes a este servidor" class="xl:col-span-2">
      <div class="space-y-6 text-sm">
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="g-domain">Dominio a monitorear</label>
            <input id="g-domain" v-model="domain" class="input" placeholder="example.com" spellcheck="false" />
          </div>
          <div>
            <label class="label" for="g-host">Nombre público de este servidor</label>
            <input id="g-host" v-model="serverHost" class="input" placeholder="dmarc.example.com" spellcheck="false" />
          </div>
        </div>

        <ol class="space-y-5">
          <li class="flex gap-3">
            <span class="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">1</span>
            <div class="min-w-0 flex-1 space-y-2">
              <p class="font-medium">Apunte un subdominio de reportes a este servidor (registro MX)</p>
              <p class="text-muted">Los proveedores enviarán los reportes a <span class="mono">dmarc@{{ reportsHost }}</span>. El nombre <span class="mono">{{ cleanHost }}</span> debe tener un registro A/AAAA hacia la IP pública de este equipo.</p>
              <CodeLine :text="mxRecord" />
            </div>
          </li>
          <li class="flex gap-3">
            <span class="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">2</span>
            <div class="min-w-0 flex-1 space-y-2">
              <p class="font-medium">Publique (o edite) el registro DMARC del dominio con esta dirección <span class="mono">rua</span></p>
              <CodeLine :text="dmarcRecord" />
              <p class="text-muted">Valor de <span class="mono">rua</span>: <span class="mono">{{ rua }}</span>. Si el destino pertenece a otro dominio distinto del monitoreado, el dominio receptor debe autorizarlo con este registro:</p>
              <CodeLine :text="authRecord" />
            </div>
          </li>
          <li class="flex gap-3">
            <span class="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">3</span>
            <div class="min-w-0 flex-1 space-y-2">
              <p class="font-medium">Exponga el puerto SMTP</p>
              <p class="text-muted">
                El receptor escucha en el puerto <span class="mono">{{ port }}</span>, pero los servidores de correo siempre entregan en el puerto <span class="mono">25</span>. Con Docker mapee 25 → {{ port }}:
              </p>
              <CodeLine :text="dockerRun" label="Opción de docker run / ports de compose" />
              <p class="text-muted">Abra el puerto 25/TCP de entrada en el firewall y en el grupo de seguridad de su proveedor. Algunos proveedores de nube bloquean el puerto 25 entrante o saliente: confírmelo antes de continuar.</p>
            </div>
          </li>
          <li class="flex gap-3">
            <span class="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">4</span>
            <div class="min-w-0 flex-1 space-y-2">
              <p class="font-medium">Opcional: TLS</p>
              <p class="text-muted">Para aceptar STARTTLS defina las variables de entorno con rutas dentro del contenedor y reinicie:</p>
              <CodeLine :text="'SMTP_TLS_KEY=/certs/privkey.pem\nSMTP_TLS_CERT=/certs/fullchain.pem'" />
            </div>
          </li>
        </ol>
      </div>
    </Card>
  </div>
</template>

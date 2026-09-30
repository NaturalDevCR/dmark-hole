<script setup lang="ts">
import { Send } from "lucide-vue-next";
import { ref } from "vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import Spinner from "@/components/ui/Spinner.vue";
import Toggle from "@/components/ui/Toggle.vue";
import { api, withToast } from "@/lib/api";
import type { Settings } from "@/lib/types";
import SaveBar from "./SaveBar.vue";
import { useSettingsDraft } from "./useSettingsDraft";

type Slice = Pick<Settings, "alerts" | "notifications">;

const { draft, loading, error, saving, dirty, save, reset } = useSettingsDraft<Slice>(
  (s) => ({ alerts: s.alerts, notifications: s.notifications }),
  (d) => ({
    alerts: { ...d.alerts, newSourceMinMessages: Math.max(1, Math.trunc(Number(d.alerts.newSourceMinMessages) || 1)), complianceThreshold: Math.min(100, Math.max(0, Number(d.alerts.complianceThreshold) || 0)) },
    notifications: { ...d.notifications, email: { ...d.notifications.email, port: Math.trunc(Number(d.notifications.email.port) || 587) } },
  }),
);

const testing = ref(false);
async function sendTest() {
  testing.value = true;
  try {
    await withToast(() => api.post("/settings/test-notification"), "Notificación de prueba enviada");
  } finally {
    testing.value = false;
  }
}

const formatHints: Record<string, string> = {
  auto: "Detecta Slack, Discord o Microsoft Teams a partir de la URL; en otro caso envía JSON genérico.",
  slack: "Formato de Incoming Webhook de Slack.",
  discord: "Formato de webhook de canal de Discord.",
  teams: "Tarjeta adaptable para un flujo de Microsoft Teams (Workflows).",
  generic: "JSON simple con título, mensaje y severidad para sus propias integraciones.",
};
</script>

<template>
  <Skeleton v-if="loading" class="h-96" />
  <p v-else-if="error" class="text-sm text-fail">{{ error }}</p>
  <form v-else-if="draft" class="space-y-6" @submit.prevent="save">
    <section class="card">
      <header class="card-header"><h3 class="card-title">Reglas de alerta</h3></header>
      <div class="card-body space-y-5">
        <Toggle v-model="draft.alerts.enabled" label="Generar alertas" description="Crea alertas en el panel cuando detecta fuentes nuevas que fallan, caídas de cumplimiento, reportes forenses o cambios DNS." />
        <div class="grid gap-5 sm:grid-cols-3">
          <div>
            <label class="label" for="a-min">Mensajes mínimos de una fuente nueva</label>
            <input id="a-min" v-model.number="draft.alerts.newSourceMinMessages" type="number" min="1" class="input" :disabled="!draft.alerts.enabled" />
            <p class="mt-1.5 text-xs text-muted">Una IP nueva que falla DMARC solo genera alerta si envió al menos esta cantidad de mensajes.</p>
          </div>
          <div>
            <label class="label" for="a-thr">Umbral de cumplimiento (%)</label>
            <input id="a-thr" v-model.number="draft.alerts.complianceThreshold" type="number" min="0" max="100" step="1" class="input" :disabled="!draft.alerts.enabled" />
            <p class="mt-1.5 text-xs text-muted">Alerta cuando el cumplimiento diario de un dominio cae por debajo de este porcentaje.</p>
          </div>
          <div>
            <label class="label" for="a-sev">Severidad mínima a notificar</label>
            <select id="a-sev" v-model="draft.alerts.minSeverity" class="input" :disabled="!draft.alerts.enabled">
              <option value="info">Informativa y superiores</option>
              <option value="warning">Advertencia y superiores</option>
              <option value="critical">Solo críticas</option>
            </select>
            <p class="mt-1.5 text-xs text-muted">Solo las alertas de este nivel o mayor se envían a los canales externos.</p>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <header class="card-header"><h3 class="card-title">Webhook</h3></header>
      <div class="card-body grid gap-5 sm:grid-cols-3">
        <div class="sm:col-span-2">
          <label class="label" for="w-url">URL del webhook</label>
          <input id="w-url" v-model="draft.notifications.webhookUrl" type="url" class="input" placeholder="https://hooks.slack.com/services/…" autocomplete="off" spellcheck="false" />
          <p class="mt-1.5 text-xs text-muted">Déjelo vacío para desactivarlo.</p>
        </div>
        <div>
          <label class="label" for="w-fmt">Formato</label>
          <select id="w-fmt" v-model="draft.notifications.webhookFormat" class="input">
            <option value="auto">Automático</option>
            <option value="slack">Slack</option>
            <option value="discord">Discord</option>
            <option value="teams">Microsoft Teams</option>
            <option value="generic">JSON genérico</option>
          </select>
          <p class="mt-1.5 text-xs text-muted">{{ formatHints[draft.notifications.webhookFormat] }}</p>
        </div>
      </div>
    </section>

    <section class="card">
      <header class="card-header"><h3 class="card-title">Correo electrónico (SMTP saliente)</h3></header>
      <div class="card-body space-y-5">
        <Toggle v-model="draft.notifications.email.enabled" label="Enviar alertas por correo" description="Use un servidor SMTP propio o de un proveedor (Gmail, SES, Mailgun…)." />
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div class="lg:col-span-2">
            <label class="label" for="e-host">Servidor SMTP</label>
            <input id="e-host" v-model="draft.notifications.email.host" class="input" placeholder="smtp.ejemplo.com" :disabled="!draft.notifications.email.enabled" spellcheck="false" />
          </div>
          <div>
            <label class="label" for="e-port">Puerto</label>
            <input id="e-port" v-model.number="draft.notifications.email.port" type="number" min="1" max="65535" class="input" :disabled="!draft.notifications.email.enabled" />
          </div>
          <div class="flex items-end pb-2">
            <Toggle v-model="draft.notifications.email.secure" label="TLS directo" :disabled="!draft.notifications.email.enabled" />
          </div>
          <div class="lg:col-span-2">
            <label class="label" for="e-user">Usuario</label>
            <input id="e-user" v-model="draft.notifications.email.username" class="input" autocomplete="off" :disabled="!draft.notifications.email.enabled" />
          </div>
          <div class="lg:col-span-2">
            <label class="label" for="e-pass">Contraseña</label>
            <input id="e-pass" v-model="draft.notifications.email.password" type="password" class="input" autocomplete="new-password" placeholder="sin cambios" :disabled="!draft.notifications.email.enabled" />
          </div>
          <div class="lg:col-span-2">
            <label class="label" for="e-from">Remitente</label>
            <input id="e-from" v-model="draft.notifications.email.from" type="email" class="input" placeholder="dmarc@ejemplo.com" :disabled="!draft.notifications.email.enabled" />
          </div>
          <div class="lg:col-span-2">
            <label class="label" for="e-to">Destinatarios</label>
            <input id="e-to" v-model="draft.notifications.email.to" class="input" placeholder="equipo@ejemplo.com, seguridad@ejemplo.com" :disabled="!draft.notifications.email.enabled" />
          </div>
        </div>
        <p class="text-xs text-muted">Active «TLS directo» solo para el puerto 465. Con 587 se usa STARTTLS automáticamente.</p>
      </div>
    </section>

    <section class="card">
      <div class="card-body">
        <Toggle v-model="draft.notifications.weeklyDigest" label="Resumen semanal" description="Envía un resumen del estado de sus dominios a los canales configurados (webhook y correo) todos los lunes a las 08:00, hora del servidor." />
      </div>
    </section>

    <div class="card">
      <SaveBar :dirty="dirty" :saving="saving" class="border-t-0" @reset="reset">
        <span v-if="dirty" class="text-xs text-muted">Guarde antes de enviar una prueba.</span>
        <button type="button" class="btn-secondary" :disabled="testing || dirty || saving" @click="sendTest"><Spinner v-if="testing" /><Send v-else class="size-4" />Enviar prueba</button>
      </SaveBar>
    </div>
  </form>
</template>

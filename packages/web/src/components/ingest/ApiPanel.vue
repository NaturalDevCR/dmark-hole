<script setup lang="ts">
import { Eye, EyeOff, KeyRound, RefreshCw } from "lucide-vue-next";
import { computed, ref } from "vue";
import Card from "@/components/ui/Card.vue";
import Confirm from "@/components/ui/Confirm.vue";
import CopyButton from "@/components/ui/CopyButton.vue";
import Spinner from "@/components/ui/Spinner.vue";
import { api, withToast } from "@/lib/api";
import type { IngestStatus } from "@/lib/types";
import CodeLine from "./CodeLine.vue";

const props = defineProps<{ status: IngestStatus | null; admin: boolean }>();
const emit = defineEmits<{ reload: [] }>();

const token = computed(() => props.status?.ingestToken ?? null);
const revealed = ref(false);
const confirming = ref(false);
const rotating = ref(false);
const MASKED = "••••••••••••••••••••••••••••••••";

const base = typeof window !== "undefined" ? `${window.location.protocol}//${window.location.host}` : "https://dmarc.example.com";
const curl = (t: string) => `curl -X POST \\\n  -H "Authorization: Bearer ${t}" \\\n  -H "Content-Type: application/gzip" \\\n  --data-binary @report.xml.gz \\\n  ${base}/api/ingest/raw`;
const curlReal = computed(() => curl(token.value ?? "<token>"));
const curlShown = computed(() => curl(token.value && revealed.value ? token.value : token.value ? "••••••••" : "<token>"));

async function rotate() {
  confirming.value = false;
  rotating.value = true;
  try {
    if (await withToast(() => api.post<{ token: string }>("/settings/ingest-token/rotate"), "Token regenerado")) {
      revealed.value = true;
      emit("reload");
    }
  } finally {
    rotating.value = false;
  }
}
</script>

<template>
  <div class="grid gap-6 xl:grid-cols-2">
    <Card title="Token de ingesta" subtitle="Autoriza el envío de reportes por HTTP sin iniciar sesión">
      <div v-if="admin && token" class="space-y-4">
        <div>
          <label class="label" for="ingest-token">Token</label>
          <div class="flex items-center gap-1 rounded-lg border border-line-strong bg-surface px-3 py-1.5">
            <KeyRound class="size-4 shrink-0 text-faint" />
            <input id="ingest-token" class="mono min-w-0 flex-1 bg-transparent px-2 py-1 text-fg outline-none" readonly :value="revealed ? token : MASKED" />
            <button type="button" class="btn-ghost btn-sm p-1.5" :title="revealed ? 'Ocultar' : 'Mostrar'" @click="revealed = !revealed">
              <EyeOff v-if="revealed" class="size-3.5" /><Eye v-else class="size-3.5" />
            </button>
            <CopyButton :text="token" />
          </div>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="max-w-md text-xs text-muted">Trate el token como una contraseña. Si se expone, regenérelo: el anterior deja de funcionar de inmediato.</p>
          <button class="btn-secondary btn-sm" :disabled="rotating" @click="confirming = true"><Spinner v-if="rotating" class="size-3.5" /><RefreshCw v-else class="size-3.5" />Regenerar</button>
        </div>
      </div>
      <p v-else class="text-sm text-muted">Solo los administradores pueden ver el token de ingesta.</p>
    </Card>

    <Card title="Enviar un reporte por HTTP" subtitle="Útil para scripts, tuberías de correo (Postfix) o webhooks de proveedores de correo">
      <div class="space-y-4 text-sm">
        <CodeLine :text="curlReal" :display="curlShown" label="Ejemplo con curl" />
        <ul class="list-disc space-y-1.5 pl-5 text-muted">
          <li>Acepta el cuerpo tal cual: XML, <span class="mono">.gz</span>, <span class="mono">.zip</span> o un mensaje <span class="mono">.eml</span> completo. Ajuste <span class="mono">Content-Type</span> según el archivo.</li>
          <li>Opcionalmente envíe <span class="mono">X-Filename</span> para identificar el archivo en el registro.</li>
          <li>Límite de 120 solicitudes por minuto. La respuesta detalla los reportes importados, duplicados o con error.</li>
        </ul>
      </div>
    </Card>

    <Confirm
      v-if="confirming"
      danger
      title="Regenerar token de ingesta"
      message="El token actual dejará de funcionar y deberá actualizar todos los scripts o servicios que lo usen. ¿Continuar?"
      confirm-label="Regenerar"
      @confirm="rotate"
      @close="confirming = false"
    />
  </div>
</template>

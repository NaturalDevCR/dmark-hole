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
      <header class="card-header"><h3 class="card-title">Procesamiento de reportes</h3></header>
      <div class="card-body space-y-5">
        <Toggle
          v-model="draft.autoCreateDomains"
          label="Crear dominios automáticamente"
          description="Cuando llega un reporte de un dominio que todavía no está registrado, se agrega solo. Desactívelo si quiere que únicamente se acepten los dominios que usted da de alta."
        />
        <Toggle
          v-model="draft.storeRawXml"
          label="Guardar el XML original"
          description="Conserva una copia comprimida de cada reporte para poder descargarlo o revisarlo después. Ocupa un poco más de espacio en disco."
        />
        <Toggle
          v-model="draft.enrichment"
          label="Enriquecer las IP de origen"
          description="Resuelve el nombre inverso (PTR), el ASN y el país de cada IP mediante consultas DNS (Team Cymru) para identificar quién envía su correo."
        />
      </div>
    </section>

    <section class="card">
      <header class="card-header"><h3 class="card-title">Retención y comprobaciones</h3></header>
      <div class="card-body grid gap-5 sm:grid-cols-3">
        <div>
          <label class="label" for="s-ret">Retención de reportes (días)</label>
          <input id="s-ret" v-model.number="draft.retentionDays" type="number" min="0" max="3650" class="input" />
          <p class="mt-1.5 text-xs text-muted">Los reportes agregados más antiguos se eliminan. 0 = para siempre.</p>
        </div>
        <div>
          <label class="label" for="s-fret">Retención de forenses (días)</label>
          <input id="s-fret" v-model.number="draft.forensicRetentionDays" type="number" min="0" max="3650" class="input" />
          <p class="mt-1.5 text-xs text-muted">Los reportes forenses pueden contener datos personales; conviene conservarlos poco. 0 = para siempre.</p>
        </div>
        <div>
          <label class="label" for="s-dns">Revisión DNS (cada N horas)</label>
          <input id="s-dns" v-model.number="draft.dnsCheckHours" type="number" min="0" max="720" class="input" />
          <p class="mt-1.5 text-xs text-muted">Frecuencia con la que se revisan DMARC, SPF y DKIM de cada dominio. 0 = desactivado.</p>
        </div>
      </div>
    </section>
    <div class="card"><SaveBar :dirty="dirty" :saving="saving" class="border-t-0" @reset="reset" /></div>
  </form>
</template>

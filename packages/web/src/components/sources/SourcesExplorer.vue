<script setup lang="ts">
import { ChevronDown, ChevronRight, Download, Search } from "lucide-vue-next";
import { refDebounced } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import StackBar from "@/components/charts/StackBar.vue";
import IpCell from "@/components/dmarc/IpCell.vue";
import SourceStatusBadge from "@/components/dmarc/SourceStatusBadge.vue";
import Card from "@/components/ui/Card.vue";
import Empty from "@/components/ui/Empty.vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import { api } from "@/lib/api";
import { ago, num, pct, ratio, short, SOURCE_STATUS } from "@/lib/format";
import type { Provider, Source, SourceStatus } from "@/lib/types";
import { useLoader } from "@/lib/useLoader";
import { useFilters } from "@/stores/filters";

const props = defineProps<{ domainId?: number; initialStatus?: SourceStatus | null }>();
const { query } = storeToRefs(useFilters());

const search = ref("");
const debounced = refDebounced(search, 300);
const status = ref<SourceStatus | null>(props.initialStatus ?? null);
const provider = ref<string | null>(null);
const expanded = ref(new Set<string>());

const params = computed(() => ({ ...query.value, domainId: props.domainId }));
const { data, loading } = useLoader(
  async () => {
    const [providers, sources] = await Promise.all([
      api.get<Provider[]>("/stats/providers", params.value),
      api.get<Source[]>("/stats/sources", { ...params.value, search: debounced.value || undefined, limit: 2000 }),
    ]);
    return { providers, sources };
  },
  [params, debounced],
);

const providerName = (s: Source) => s.provider ?? (s.asName ? s.asName.replace(/,\s*[A-Z]{2}$/, "") : "Desconocido");
const rows = computed(() =>
  (data.value?.sources ?? []).filter((s) => (!status.value || s.status === status.value) && (!provider.value || providerName(s) === provider.value)),
);
const counts = computed(() => {
  const c: Record<string, number> = {};
  for (const s of data.value?.sources ?? []) c[s.status] = (c[s.status] ?? 0) + 1;
  return c;
});
const shown = ref(100);

function toggle(ip: string) {
  const next = new Set(expanded.value);
  if (next.has(ip)) next.delete(ip);
  else next.add(ip);
  expanded.value = next;
}

const splitAuth = (list: string[]) =>
  list.map((x) => {
    const i = x.lastIndexOf(":");
    return { domain: x.slice(0, i), result: x.slice(i + 1) };
  });
const statuses = Object.keys(SOURCE_STATUS) as SourceStatus[];
</script>

<template>
  <div class="space-y-6">
    <Card title="Servicios de envío" subtitle="Fuentes agrupadas por proveedor detectado vía DNS inverso y ASN" flush>
      <div v-if="loading && !data" class="p-5"><Skeleton class="h-40" /></div>
      <Empty v-else-if="!data?.providers.length" title="Sin fuentes en este periodo" />
      <div v-else class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>Proveedor</th>
              <th>Estado</th>
              <th class="text-right">IPs</th>
              <th class="text-right">Mensajes</th>
              <th class="w-64">Resultado</th>
              <th class="text-right">Pasa DMARC</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in data.providers.slice(0, 12)"
              :key="p.name"
              class="row-link"
              :class="provider === p.name && 'bg-brand-soft/60'"
              @click="provider = provider === p.name ? null : p.name"
            >
              <td class="font-medium">{{ p.name }}</td>
              <td><SourceStatusBadge :status="p.status" /></td>
              <td class="text-right tabular-nums">{{ num(p.ips) }}</td>
              <td class="text-right tabular-nums">{{ num(p.messages) }}</td>
              <td><StackBar :pass="p.pass" :forwarded="p.forwarded" :misaligned="p.misaligned" :fail="p.fail" /></td>
              <td class="text-right tabular-nums">{{ pct(ratio(p.pass + p.forwarded, p.messages)) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>

    <Card flush>
      <template #header>
        <div class="flex w-full flex-wrap items-center gap-2">
          <h3 class="card-title mr-2">Direcciones IP</h3>
          <button class="btn-sm rounded-full border px-3 py-1 text-xs" :class="!status ? 'border-brand bg-brand-soft text-brand' : 'border-line text-muted hover:text-fg'" @click="status = null">
            Todas <span class="tabular-nums opacity-70">{{ data?.sources.length ?? 0 }}</span>
          </button>
          <button
            v-for="s in statuses"
            :key="s"
            v-show="counts[s]"
            class="rounded-full border px-3 py-1 text-xs"
            :class="status === s ? 'border-brand bg-brand-soft text-brand' : 'border-line text-muted hover:text-fg'"
            @click="status = status === s ? null : s"
          >
            {{ SOURCE_STATUS[s].label }} <span class="tabular-nums opacity-70">{{ counts[s] }}</span>
          </button>
          <span v-if="provider" class="inline-flex items-center gap-1 rounded-full bg-brand-soft px-3 py-1 text-xs text-brand">
            {{ provider }} <button class="ml-1 font-bold" @click="provider = null">×</button>
          </span>
          <div class="ml-auto flex items-center gap-2">
            <div class="relative">
              <Search class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
              <input v-model="search" class="input w-56 py-1.5 pl-8 text-xs" placeholder="IP, PTR, proveedor, ASN…" />
            </div>
            <a class="btn-secondary btn-sm" :href="api.url('/export/records.csv', params)"><Download class="size-3.5" />CSV</a>
          </div>
        </div>
      </template>

      <div v-if="loading && !data" class="p-5"><Skeleton class="h-64" /></div>
      <Empty v-else-if="!rows.length" title="Sin resultados" description="Pruebe con otro filtro o amplíe el rango de fechas." />
      <div v-else class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th class="w-8" />
              <th>Origen</th>
              <th>Estado</th>
              <th class="text-right">Mensajes</th>
              <th class="w-48">Resultado</th>
              <th class="text-right">SPF alin.</th>
              <th class="text-right">DKIM alin.</th>
              <th>Visto</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="s in rows.slice(0, shown)" :key="s.ip">
              <tr class="row-link" @click="toggle(s.ip)">
                <td class="pr-0 text-faint">
                  <ChevronDown v-if="expanded.has(s.ip)" class="size-4" />
                  <ChevronRight v-else class="size-4" />
                </td>
                <td class="max-w-80"><IpCell :ip="s.ip" :ptr="s.ptr" :provider="s.provider" :country="s.country" /></td>
                <td><SourceStatusBadge :status="s.status" /></td>
                <td class="text-right font-medium tabular-nums">{{ num(s.messages) }}</td>
                <td><StackBar :pass="s.pass" :forwarded="s.forwarded" :misaligned="s.misaligned" :fail="s.fail" /></td>
                <td class="text-right tabular-nums">{{ pct(ratio(s.spfAligned, s.messages), 0) }}</td>
                <td class="text-right tabular-nums">{{ pct(ratio(s.dkimAligned, s.messages), 0) }}</td>
                <td class="text-xs whitespace-nowrap text-muted">{{ ago(s.lastSeen) }}</td>
              </tr>
              <tr v-if="expanded.has(s.ip)" class="bg-subtle/40">
                <td />
                <td colspan="7" class="py-4">
                  <div class="grid gap-4 text-sm md:grid-cols-4">
                    <div>
                      <p class="label">Red</p>
                      <p>{{ s.asName ?? "—" }}</p>
                      <p v-if="s.asn" class="text-xs text-muted">AS{{ s.asn }}</p>
                    </div>
                    <div>
                      <p class="label">Dominios (From)</p>
                      <p class="break-words">{{ s.domains.join(", ") }}</p>
                    </div>
                    <div>
                      <p class="label">Firmas DKIM</p>
                      <p v-if="!s.dkimDomains.length" class="text-muted">Sin firma</p>
                      <p v-for="a in splitAuth(s.dkimDomains)" :key="a.domain + a.result" class="truncate">
                        <span :class="a.result === 'pass' ? 'text-pass' : 'text-fail'">●</span> {{ a.domain }} <span class="text-xs text-muted">{{ a.result }}</span>
                      </p>
                    </div>
                    <div>
                      <p class="label">SPF (MAIL FROM)</p>
                      <p v-if="!s.spfDomains.length" class="text-muted">—</p>
                      <p v-for="a in splitAuth(s.spfDomains)" :key="a.domain + a.result" class="truncate">
                        <span :class="a.result === 'pass' ? 'text-pass' : 'text-fail'">●</span> {{ a.domain }} <span class="text-xs text-muted">{{ a.result }}</span>
                      </p>
                    </div>
                  </div>
                  <div class="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
                    <span>Autenticado {{ num(s.pass) }} · Reenviado {{ num(s.forwarded) }} · Sin alinear {{ num(s.misaligned) }} · No autenticado {{ num(s.fail) }}</span>
                    <span>Cuarentena {{ num(s.dispositions.quarantine) }} · Rechazo {{ num(s.dispositions.reject) }}</span>
                    <RouterLink :to="`/sources/${encodeURIComponent(s.ip)}`" class="ml-auto font-medium text-brand hover:underline">Ver detalle →</RouterLink>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <div v-if="rows.length > shown" class="border-t border-line p-3 text-center">
          <button class="btn-ghost btn-sm" @click="shown += 200">Mostrar más ({{ short(rows.length - shown) }} restantes)</button>
        </div>
      </div>
    </Card>
  </div>
</template>

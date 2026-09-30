<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">Integrations</h1>
      <p class="text-sm text-muted-foreground">Connect notifications and external services</p>
    </div>

    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <div v-for="i in integrationTypes" :key="i.type" class="rounded-lg border bg-card p-4">
        <div class="flex items-center gap-2 mb-2">
          <component :is="i.icon" class="h-5 w-5" />
          <p class="text-sm font-medium">{{ i.label }}</p>
        </div>
        <p class="text-xs text-muted-foreground mb-3">{{ i.desc }}</p>
        <button @click="addIntegration(i.type)" class="w-full rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
          {{ hasIntegration(i.type) ? "Configured" : "Connect" }}
        </button>
      </div>
    </div>

    <div class="rounded-lg border bg-card p-6">
      <h3 class="text-sm font-semibold mb-3">Connected Integrations</h3>
      <div v-if="!integrations.length" class="text-xs text-muted-foreground">No integrations configured</div>
      <div v-for="intg in integrations" :key="intg.id" class="flex items-center justify-between py-2 border-b text-sm">
        <span class="font-medium">{{ intg.name }}</span>
        <span class="text-muted-foreground">{{ intg.type }}</span>
        <button @click="removeIntegration(intg.id)" class="text-xs text-red-500 hover:underline">Remove</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useApi } from "@/composables/useApi";
import { Slack, MessageCircle, MessageSquare, Globe } from "lucide-vue-next";

const api = useApi();
const integrations = ref<Array<{ id: string; name: string; type: string }>>([]);

const integrationTypes = [
  { type: "SLACK", label: "Slack", desc: "Send alerts to Slack channels", icon: Slack },
  { type: "DISCORD", label: "Discord", desc: "Send alerts to Discord", icon: MessageCircle },
  { type: "TEAMS", label: "Teams", desc: "Send alerts to Microsoft Teams", icon: MessageSquare },
  { type: "WEBHOOK", label: "Webhook", desc: "Custom webhook notifications", icon: Globe },
];

function hasIntegration(type: string) {
  return integrations.value.some((i) => i.type === type);
}

async function addIntegration(type: string) {
  await api.post("/integrations", { type, name: `${type} Integration`, config: {} });
  load();
}

async function removeIntegration(id: string) {
  await api.delete(`/integrations/${id}`);
  load();
}

async function load() {
  const res = await api.get<{ data: typeof integrations.value }>("/integrations");
  if (res) integrations.value = res.data;
}

onMounted(load);
</script>

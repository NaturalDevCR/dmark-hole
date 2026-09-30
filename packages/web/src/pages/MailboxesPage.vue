<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Mailboxes</h1>
        <p class="text-sm text-muted-foreground">Manage DMARC report ingestion sources</p>
      </div>
      <button @click="showAdd = true" class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
        <Plus class="mr-1 inline h-4 w-4" /> Add Mailbox
      </button>
    </div>

    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <div v-for="mb in mailboxes" :key="mb.id" class="rounded-lg border bg-card p-4">
        <div class="flex items-center justify-between mb-2">
          <p class="text-sm font-semibold">{{ mb.name }}</p>
          <span :class="['rounded-full px-2 py-0.5 text-xs', mb.syncStatus === 'OK' ? 'bg-green-500/10 text-green-500' : mb.syncStatus === 'ERROR' ? 'bg-red-500/10 text-red-500' : 'bg-yellow-500/10 text-yellow-500']">
            {{ mb.syncStatus }}
          </span>
        </div>
        <p class="text-xs text-muted-foreground">{{ mb.email }}</p>
        <p class="text-xs text-muted-foreground mt-1">Type: {{ mb.type }}</p>
        <p class="text-xs text-muted-foreground">Domains: {{ mb.domains?.join(", ") || "None" }}</p>
        <div class="mt-3 flex gap-2">
          <button @click="syncMailbox(mb.id)" class="rounded-md border px-2 py-1 text-xs hover:bg-accent">Sync Now</button>
          <button @click="testMailbox(mb.id)" class="rounded-md border px-2 py-1 text-xs hover:bg-accent">Test</button>
        </div>
      </div>
    </div>

    <div v-if="!mailboxes.length" class="rounded-lg border p-12 text-center">
      <Mail class="mx-auto h-8 w-8 text-muted-foreground" />
      <p class="mt-2 text-sm text-muted-foreground">No mailboxes connected</p>
    </div>

    <!-- Add Modal -->
    <div v-if="showAdd" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="showAdd = false">
      <div class="w-full max-w-md rounded-lg border bg-card p-6">
        <h2 class="mb-4 text-lg font-semibold">Add Mailbox</h2>
        <form @submit.prevent="addMailbox" class="space-y-3">
          <input v-model="form.name" placeholder="Name" required class="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <input v-model="form.email" placeholder="Email" required class="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <select v-model="form.type" required class="w-full rounded-md border bg-background px-3 py-2 text-sm">
            <option value="IMAP">IMAP</option>
            <option value="POP3">POP3</option>
            <option value="MICROSOFT365">Microsoft 365</option>
            <option value="GMAIL_API">Gmail API</option>
            <option value="WEBHOOK">Webhook</option>
          </select>
          <div class="flex gap-2 justify-end mt-4">
            <button type="button" @click="showAdd = false" class="rounded-md border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" class="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Add</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive } from "vue";
import { useApi } from "@/composables/useApi";
import { Plus, Mail } from "lucide-vue-next";

const api = useApi();
const mailboxes = ref<Array<{ id: string; name: string; email: string; type: string; syncStatus: string; domains?: string[] }>>([]);
const showAdd = ref(false);
const form = reactive({ name: "", email: "", type: "IMAP" });

async function load() {
  const res = await api.get<{ data: typeof mailboxes.value }>("/mailboxes");
  if (res) mailboxes.value = res.data;
}

async function addMailbox() {
  await api.post("/mailboxes", { ...form, config: {}, domainIds: [] });
  showAdd.value = false;
  load();
}

async function syncMailbox(id: string) {
  await api.post(`/mailboxes/${id}/sync`);
  load();
}

async function testMailbox(id: string) {
  await api.post(`/mailboxes/${id}/test`);
}

onMounted(load);
</script>

<script setup lang="ts">
import Modal from "./Modal.vue";
defineProps<{ title: string; message: string; confirmLabel?: string; danger?: boolean }>();
const emit = defineEmits<{ confirm: []; close: [] }>();
</script>

<template>
  <Modal :title="title" width="sm" @close="emit('close')">
    <p class="text-sm text-muted">{{ message }}</p>
    <template #footer>
      <button class="btn-secondary" @click="emit('close')">Cancelar</button>
      <button :class="danger ? 'btn-danger' : 'btn-primary'" @click="emit('confirm')">{{ confirmLabel ?? "Confirmar" }}</button>
    </template>
  </Modal>
</template>

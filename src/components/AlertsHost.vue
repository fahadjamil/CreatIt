<script setup lang="ts">
import { computed } from "vue";
import { useAlerts } from "@/composables/useAlerts";

const { alerts, removeAlert } = useAlerts();

const visibleAlerts = computed(() => alerts.value.slice(0, 3));
const toneClass = (kind: string) =>
  kind === "error" ? "app-alerts-alert--error" : "app-alerts-alert--success";
</script>

<template>
  <div class="app-alerts-host" aria-live="polite" aria-relevant="additions removals">
    <div v-for="a in visibleAlerts" :key="a.id" class="app-alerts-item">
      <div :class="['app-alerts-alert', toneClass(a.kind)]" role="alert">
        <button
          class="app-alerts-close"
          type="button"
          aria-label="Dismiss alert"
          @click="removeAlert(a.id)"
        >
          ×
        </button>
        <div v-if="a.title" class="app-alerts-title">{{ a.title }}</div>
        <div class="app-alerts-message">{{ a.message }}</div>
      </div>
    </div>
  </div>
</template>


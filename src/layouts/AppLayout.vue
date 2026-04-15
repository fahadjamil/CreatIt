<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppShell from '@/components/AppShell.vue'

const route = useRoute()
const isAuthLayout = computed(() => route.meta.layout === 'auth')
const isPlainLayout = computed(() => route.meta.layout === 'plain')
</script>

<template>
  <RouterView v-if="isAuthLayout || isPlainLayout" />
  <AppShell v-else>
    <RouterView />
  </AppShell>
</template>

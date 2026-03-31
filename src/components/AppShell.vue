<script setup lang="ts">
import AppContent from '@/components/AppContent.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import AppSidebarHeader from '@/components/AppSidebarHeader.vue'
</script>

<template>
  <div class="app-shell">
    <AppSidebar>
      <AppSidebarHeader />
    </AppSidebar>
    <AppContent>
      <slot />
    </AppContent>
  </div>
</template>

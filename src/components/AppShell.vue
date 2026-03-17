<script setup lang="ts">
import AppContent from './AppContent.vue'
import AppSidebar from './AppSidebar.vue'
import AppSidebarHeader from './AppSidebarHeader.vue'
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

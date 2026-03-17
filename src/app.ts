import { createApp } from 'vue'
import AppLayout from './layouts/AppLayout.vue'
import router from './router'
import '@/css/app.css'
import { initializeTheme } from './composables/useAppearance'

const app = createApp(AppLayout)
initializeTheme()
app.use(router)
app.mount('#app')

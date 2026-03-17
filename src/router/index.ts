import { createRouter, createWebHistory } from 'vue-router'
import Dashboard from '@/pages/Dashboard.vue'
import Welcome from '@/pages/Welcome.vue'
import Login from '@/pages/auth/Login.vue'
import Signup from '@/pages/auth/Signup.vue'
import ForgotPassword from '@/pages/auth/ForgotPassword.vue'

const routes = [
  { path: '/', component: Login, meta: { layout: 'auth' } },
  {
    path: '/auth/forgot-password',
    component: ForgotPassword,
    meta: { layout: 'auth' },
  },
  { path: '/auth/signup', component: Signup, meta: { layout: 'auth' } },
  { path: '/welcome', component: Welcome },
  { path: '/dashboard', component: Dashboard, meta: { layout: 'plain' } },
  { path: '/auth/login', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router

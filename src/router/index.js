import { createRouter, createWebHistory } from 'vue-router';
import Dashboard from '@/pages/Dashboard.vue';
import Welcome from '@/pages/Welcome.vue';
import Login from '@/pages/auth/Login.vue';
import Signup from '@/pages/auth/Signup.vue';
import ForgotPassword from '@/pages/auth/ForgotPassword.vue';
import WalletSetup from '@/pages/wallet/WalletSetup.vue';
import WalletSetupManual from '@/pages/wallet/WalletSetupManual.vue';
import WalletSetupUploadCnic from '@/pages/wallet/WalletSetupUploadCnic.vue';
import WalletSetupBusinessType from '@/pages/wallet/WalletSetupBusinessType.vue';
import WalletSetupBusinessDetails from '@/pages/wallet/WalletSetupBusinessDetails.vue';
import WalletSetupVerifying from '@/pages/wallet/WalletSetupVerifying.vue';
import { isAuthenticated } from '@/lib/auth';
const routes = [
    { path: '/', component: Login, meta: { layout: 'auth', guestOnly: true } },
    {
        path: '/auth/forgot-password',
        component: ForgotPassword,
        meta: { layout: 'auth', guestOnly: true },
    },
    { path: '/auth/signup', component: Signup, meta: { layout: 'auth', guestOnly: true } },
    { path: '/wallet/setup', component: WalletSetup, meta: { layout: 'auth', requiresAuth: true } },
    { path: '/wallet/setup/manual', component: WalletSetupManual, meta: { layout: 'auth', requiresAuth: true } },
    { path: '/wallet/setup/upload-cnic', component: WalletSetupUploadCnic, meta: { layout: 'auth', requiresAuth: true } },
    { path: '/wallet/setup/business-type', component: WalletSetupBusinessType, meta: { layout: 'auth', requiresAuth: true } },
    { path: '/wallet/setup/business-details', component: WalletSetupBusinessDetails, meta: { layout: 'auth', requiresAuth: true } },
    { path: '/wallet/setup/verifying', component: WalletSetupVerifying, meta: { layout: 'auth', requiresAuth: true } },
    { path: '/welcome', component: Welcome, meta: { requiresAuth: true } },
    { path: '/dashboard', component: Dashboard, meta: { layout: 'plain', requiresAuth: true } },
    { path: '/auth/login', component: Login, meta: { layout: 'auth', guestOnly: true } },
];
const router = createRouter({
    history: createWebHistory(),
    routes,
});
router.beforeEach((to) => {
    const authed = isAuthenticated();
    if (authed) {
        if (to.meta.guestOnly) {
            return { path: '/dashboard' };
        }
        return true;
    }
    // Logged out: only guest routes (login, signup, forgot password, etc.)
    if (to.meta.guestOnly) {
        return true;
    }
    return { path: '/auth/login', query: { redirect: to.fullPath } };
});
export default router;

<template>
  <section class="auth-page">
    <header class="auth-header">
      <div class="auth-logo">
        <img
          class="auth-logo-image"
          src="@/assets/logo/create-logo.png"
          alt="Create"
        />
      </div>
      <div class="auth-header-actions">
        <RouterLink
          class="auth-top-action auth-top-action--secondary"
          to="/dashboard"
        >
          Skip
        </RouterLink>
        <RouterLink class="auth-top-action" to="/">Log in</RouterLink>
      </div>
    </header>

    <div class="auth-card-wrapper auth-card-wrapper--compact">
      <RouterLink class="auth-back-link auth-back-link--card" :to="backTo">
        <img class="auth-back-icon" src="@/assets/icons/BackIcon.png" alt="" />
        Back
      </RouterLink>

      <div
        class="auth-card auth-card--compact auth-card--left auth-card--wallet-setup"
      >
        <img
          class="auth-wallet-setup-icon"
          src="@/assets/icons/Money-Wallet-1--Streamline-Ultimate.svg"
          alt=""
        />
        <h3 class="auth-title">Get ready to set up your wallet</h3>
        <p class="auth-subtitle auth-wallet-setup-desc">
          To activate your wallet for payments, transfers, and secure
          transactions, we need some details. You can complete these now or
          finish later.
        </p>

        <div class="auth-wallet-detail-block">

            <img
              class="auth-wallet-detail-icon"
              src="@/assets/icons/Single-Neutral-Id-Card-3--Streamline-Ultimate.png"
              alt=""
            />
          <div class="auth-wallet-detail-content">
            <h2 class="auth-wallet-detail-title">CNIC details</h2>
            <p class="auth-wallet-detail-text">
              We need your government-issued ID to confirm your identity and
              comply with state bank rules.
            </p>
          </div>
        </div>

        <div class="auth-wallet-detail-block">
          <div class="auth-wallet-detail-icon auth-wallet-detail-icon--building">
            <img
              src="@/assets/icons/Desk-Document-Base-Work--Streamline-Ultimate.svg"
              alt=""
            />
          </div>
          <div class="auth-wallet-detail-content">
            <h2 class="auth-wallet-detail-title">Business Details</h2>
            <p class="auth-wallet-detail-text">
              Your business details will help us provide a more tailored wallet
              experience.
            </p>
          </div>
        </div>

        <div class="auth-wallet-setup-buttons">
          <button
            class="auth-button auth-button--outline"
            type="button"
            @click="goToManualEntry"
          >
            Enter Details Manually
          </button>
          <button class="auth-button" type="button" @click="goToUploadCnic">
            Upload your CNIC
          </button>
        </div>
      </div>
    </div>

    <footer class="auth-footer">
      Having trouble accessing your account?
      <button class="auth-link-support" type="button">Contact Support</button>
    </footer>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { useRouter, useRoute } from "vue-router";

const router = useRouter();
const route = useRoute();

const backTo = computed(() => {
  const from = route.query.from;
  if (from === "signup") return "/auth/signup";
  return "/dashboard";
});

function goToManualEntry() {
  router.push({ path: "/wallet/setup/manual", query: route.query });
}

function goToUploadCnic() {
  router.push({ path: "/wallet/setup/upload-cnic", query: route.query });
}
</script>

<style scoped>
.auth-header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.auth-top-action--secondary {
  border-color: #64748b;
  color: #64748b;
}

.auth-wallet-setup-icon {
  width: 48px;
  height: 48px;
  object-fit: contain;
  margin-bottom: 16px;
}

.auth-card--wallet-setup {
  text-align: left;
}

.auth-wallet-setup-desc {
  margin-bottom: 20px;
}

.auth-wallet-detail-block {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 16px;
  padding: 12px 0;
  border-bottom: 1px solid #e2e8f0;
}

.auth-wallet-detail-block:last-of-type {
  border-bottom: none;
  margin-bottom: 24px;
}

.auth-wallet-detail-icon {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
}

.auth-wallet-detail-icon img {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.auth-wallet-detail-icon--building {
  color: #0f172a;
}

.auth-wallet-detail-title {
  margin: 0 0 4px;
  font-size: 0.95rem;
  font-weight: 600;
  color: #0f172a;
}

.auth-wallet-detail-text {
  margin: 0;
  font-size: 0.85rem;
  color: #64748b;
  line-height: 1.4;
}

.auth-wallet-setup-buttons {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.auth-wallet-setup-buttons .auth-button--outline {
  margin-bottom: 0;
}
</style>

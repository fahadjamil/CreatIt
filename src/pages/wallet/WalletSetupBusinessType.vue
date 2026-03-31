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
      <RouterLink class="auth-top-action" to="/">Log in</RouterLink>
    </header>

    <div class="auth-card-wrapper auth-card-wrapper--compact">
      <button
        type="button"
        class="auth-back-link auth-back-link--card auth-back-button"
        @click="goBack"
      >
        <img class="auth-back-icon" src="@/assets/icons/BackIcon.png" alt="" />
        Back
      </button>

      <div
        class="auth-card auth-card--compact auth-card--left auth-card--business-type"
      >
        <img
          class="auth-business-type-icon"
          src="@/assets/icons/Desk-Document-Base-Work--Streamline-Ultimate.svg"
          alt=""
        />
        <h1 class="auth-title">What type of business are you?</h1>
        <p class="auth-subtitle auth-business-type-desc">
          Knowing if you're registered as a business or not will help tailor our
          advice and service.
        </p>

        <form class="auth-business-type-form" @submit.prevent="onNext">
          <label
            class="auth-business-option"
            :class="{ 'auth-business-option--selected': form.businessType === 'registered' }"
          >
            <input
              v-model="form.businessType"
              type="radio"
              name="businessType"
              value="registered"
              class="auth-business-option-input"
            />
            <span class="auth-business-option-label">Registered as a business</span>
            <span class="auth-business-option-desc">
              I have a private limited company or partnership registered with SECP
            </span>
            <span class="auth-business-option-radio" aria-hidden="true" />
          </label>

          <label
            class="auth-business-option"
            :class="{ 'auth-business-option--selected': form.businessType === 'sole_proprietor' }"
          >
            <input
              v-model="form.businessType"
              type="radio"
              name="businessType"
              value="sole_proprietor"
              class="auth-business-option-input"
            />
            <span class="auth-business-option-label">Registered as a sole proprietor</span>
            <span class="auth-business-option-desc">
              I'm registered as a sole proprietor with SECP
            </span>
            <span class="auth-business-option-radio" aria-hidden="true" />
          </label>

          <label
            class="auth-business-option"
            :class="{ 'auth-business-option--selected': form.businessType === 'unregistered' }"
          >
            <input
              v-model="form.businessType"
              type="radio"
              name="businessType"
              value="unregistered"
              class="auth-business-option-input"
            />
            <span class="auth-business-option-label">Not registered at all</span>
            <span class="auth-business-option-desc">
              I run my own unregistered business
            </span>
            <span class="auth-business-option-radio" aria-hidden="true" />
          </label>

          <button class="auth-button" type="submit">Next</button>
        </form>
      </div>
    </div>

    <footer class="auth-footer">
      Having trouble accessing your account?
      <button class="auth-link-support" type="button">Contact Support</button>
    </footer>
  </section>
</template>

<script setup>
import { reactive } from "vue";
import { useRouter, useRoute } from "vue-router";

const router = useRouter();
const route = useRoute();

const form = reactive({
  businessType: "registered",
});

function goBack() {
  if (window.history.length > 2) {
    router.back();
  } else {
    router.push({ path: "/wallet/setup", query: route.query });
  }
}

function onNext() {
  router.push({ path: "/wallet/setup/business-details", query: route.query });
}
</script>

<style scoped>
.auth-business-type-icon {
  width: 48px;
  height: 48px;
  object-fit: contain;
  margin-bottom: 16px;
}

.auth-card--business-type {
  text-align: left;
}

.auth-business-type-desc {
  margin-bottom: 20px;
}

.auth-business-type-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.auth-business-option {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 6px 14px;
  align-items: start;
  padding: 14px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
  background: #fff;
}

.auth-business-option-radio {
  grid-column: 2;
  grid-row: 1 / -1;
  align-self: center;
  width: 20px;
  height: 20px;
  border: 2px solid #cbd5e1;
  border-radius: 50%;
  flex-shrink: 0;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.auth-business-option--selected .auth-business-option-radio {
  border-color: #0f172a;
  background-color: #0f172a;
  box-shadow: inset 0 0 0 3px #fff;
}

.auth-business-option-label {
  grid-column: 1;
  font-size: 1rem;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.3;
}

.auth-business-option-desc {
  grid-column: 1;
  font-size: 0.875rem;
  color: #64748b;
  line-height: 1.45;
  margin: 0;
}

.auth-business-option:hover {
  border-color: #cbd5e1;
}

.auth-business-option--selected {
  border-color: #0f172a;
  background-color: #f8fafc;
}

.auth-business-option-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
</style>

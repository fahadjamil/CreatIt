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
      <RouterLink
        class="auth-back-link auth-back-link--card"
        :to="backTo"
      >
        <img class="auth-back-icon" src="@/assets/icons/BackIcon.png" alt="" />
        Back
      </RouterLink>

      <div
        class="auth-card auth-card--compact auth-card--left auth-card--business-details"
      >
        <img
          class="auth-business-details-icon"
          src="@/assets/icons/Desk-Document-Base-Work--Streamline-Ultimate.svg"
          alt=""
        />
        <h1 class="auth-title">Details about your business</h1>
        <p class="auth-subtitle auth-business-details-desc">
          Provide your details as they have been registered with the SECP
        </p>

        <form class="auth-business-details-form" @submit.prevent="onNext">
          <label class="auth-field">
            <input
              v-model="form.registeredBusinessName"
              class="auth-input"
              type="text"
              placeholder="Registered Business Name"
            />
          </label>
          <label class="auth-field">
            <input
              v-model="form.businessEmail"
              class="auth-input"
              type="email"
              placeholder="Business Email"
            />
          </label>
          <label class="auth-field auth-field--select">
            <select
              v-model="form.primaryIndustry"
              class="auth-input auth-input--select"
              aria-label="Primary Industry"
            >
              <option value="" disabled>Primary Industry</option>
              <option value="retail">Retail</option>
              <option value="manufacturing">Manufacturing</option>
              <option value="services">Services</option>
              <option value="technology">Technology</option>
              <option value="healthcare">Healthcare</option>
              <option value="education">Education</option>
              <option value="other">Other</option>
            </select>
            <img
              class="auth-select-chevron"
              src="@/assets/icons/Down Chevron.svg"
              alt=""
              aria-hidden="true"
            />
          </label>
          <label class="auth-field">
            <input
              v-model="form.ntnNumber"
              class="auth-input"
              type="text"
              placeholder="NTN Number"
            />
          </label>
          <label class="auth-field">
            <textarea
              v-model="form.businessAddress"
              class="auth-input auth-input--textarea"
              placeholder="Business Address"
              rows="3"
            />
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
import { reactive, computed } from "vue";
import { useRouter, useRoute } from "vue-router";

const router = useRouter();
const route = useRoute();

const form = reactive({
  registeredBusinessName: "",
  businessEmail: "",
  primaryIndustry: "",
  ntnNumber: "",
  businessAddress: "",
});

const backTo = computed(() => {
  const query = { ...route.query };
  return { path: "/wallet/setup/business-type", query };
});

function onNext() {
  // TODO: validate and submit; then navigate to verifying
  router.push({ path: "/wallet/setup/verifying", query: route.query });
}
</script>

<style scoped>
.auth-business-details-icon {
  width: 48px;
  height: 48px;
  object-fit: contain;
  margin-bottom: 16px;
}

.auth-card--business-details {
  text-align: left;
}

.auth-business-details-desc {
  margin-bottom: 20px;
}

.auth-business-details-form {
  margin-top: 8px;
}

.auth-field--select {
  position: relative;
}

.auth-input--select {
  appearance: none;
  padding-right: 40px;
}

.auth-select-chevron {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  pointer-events: none;
}

.auth-input--textarea {
  resize: vertical;
  min-height: 80px;
}
</style>

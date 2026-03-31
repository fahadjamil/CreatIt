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
        class="auth-card auth-card--compact auth-card--left auth-card--cnic-verify"
      >
        <img
          class="auth-cnic-verify-icon"
          src="@/assets/icons/Single-Neutral-Id-Card-3--Streamline-Ultimate.png"
          alt=""
        />
        <h1 class="auth-title">Verify your CNIC details</h1>
        <p class="auth-subtitle">Please make sure your details are correct.</p>

        <form class="auth-cnic-form" @submit.prevent="onNext">
          <label class="auth-field">
            <input
              v-model="form.fullName"
              class="auth-input"
              type="text"
              placeholder="Full Name"
            />
          </label>
          <label class="auth-field">
            <input
              v-model="form.cnicNumber"
              class="auth-input"
              type="text"
              placeholder="CNIC Number"
              maxlength="15"
            />
          </label>
          <label class="auth-field">
            <input
              v-model="form.dateOfBirth"
              class="auth-input"
              type="date"
              placeholder="Date of Birth"
            />
          </label>
          <div class="auth-cnic-date-row">
            <label class="auth-field auth-field--half">
              <input
                v-model="form.dateOfIssue"
                class="auth-input"
                type="date"
                placeholder="Date of Issue"
              />
            </label>
            <label class="auth-field auth-field--half">
              <input
                v-model="form.dateOfExpiry"
                class="auth-input"
                type="date"
                placeholder="Date of Expiry"
              />
            </label>
          </div>
          <label class="auth-field">
            <textarea
              v-model="form.address"
              class="auth-input auth-input--textarea"
              placeholder="Address"
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
  fullName: "",
  cnicNumber: "",
  dateOfBirth: "",
  dateOfIssue: "",
  dateOfExpiry: "",
  address: "",
});

const backTo = computed(() => {
  const query = { ...route.query };
  return { path: "/wallet/setup", query };
});

function onNext() {
  // TODO: validate and submit to API; for now navigate to business type step
  router.push({ path: "/wallet/setup/business-type", query: route.query });
}
</script>

<style scoped>
.auth-cnic-verify-icon {
  width: 48px;
  height: 48px;
  object-fit: contain;
  margin-bottom: 16px;
}

.auth-card--cnic-verify {
  text-align: left;
}

.auth-cnic-form {
  margin-top: 8px;
}

.auth-cnic-date-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.auth-field--half {
  margin-bottom: 14px;
}

.auth-input--textarea {
  resize: vertical;
  min-height: 80px;
}
</style>

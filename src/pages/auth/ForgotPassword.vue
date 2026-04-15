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
      <RouterLink class="auth-top-action" to="/auth/signup">Sign Up</RouterLink>
    </header>

    <div class="auth-card-wrapper auth-card-wrapper--compact">
      <RouterLink
        v-if="step === 1"
        class="auth-back-link auth-back-link--card"
        to="/auth/login"
      >
        <img class="auth-back-icon" src="@/assets/icons/BackIcon.png" alt="" />
        Back to Login
      </RouterLink>
      <button
        v-else
        class="auth-back-link auth-back-link--card auth-back-button"
        type="button"
        @click="goToStep(1)"
      >
        <img class="auth-back-icon" src="@/assets/icons/BackIcon.png" alt="" />
        Back
      </button>

      <div v-if="step === 1" class="auth-card auth-card--compact auth-card--left auth-step-first">
        <img
          class="auth-illustration-image"
          src="@/assets/icons/Send-Email-2--Streamline-Ultimate.png"
          alt="Email"
        />

        <h1 class="auth-title">Your email address</h1>
        <p class="auth-subtitle">
          Please enter the email address that you registered to create your create
          account
        </p>

        <label class="auth-field">
          <input
            v-model="email"
            class="auth-input"
            :class="{ 'auth-input--error': emailError }"
            type="email"
            placeholder="email@gmail.com"
            @input="emailError = ''"
          />
          <p v-if="emailError" class="auth-field-error">{{ emailError }}</p>
        </label>

        <button class="auth-button" type="button" :disabled="isSubmitting" @click="submitForgotPassword">
          <span
            v-if="isSubmitting"
            class="auth-button-loader"
            aria-hidden="true"
          ></span>
          {{ isSubmitting ? "Submitting..." : "Submit" }}
        </button>
      </div>
      <div v-else class="auth-card auth-card--compact">
        <img
          class="auth-success-illustration"
          src="@/assets/icons/email-sent.png"
          alt="Email sent"
        />

        <h1 class="auth-title">We've sent you an email</h1>
        <p class="auth-subtitle">
          We've sent an email to <strong>{{ email || "your email" }}</strong>
          to recover your password
        </p>
      </div>
    </div>

    <footer class="auth-footer">
      Having trouble accessing your account?
      <button class="auth-link-support" type="button">Contact Support</button>
    </footer>
  </section>
</template>

<script setup>
import { ref } from "vue";
import { requestForgotPassword } from "@/lib/api";

const step = ref(1);
const email = ref("");
const emailError = ref("");
const isSubmitting = ref(false);

const isValidEmail = (value) => {
  const trimmed = (value || "").trim();
  if (!trimmed) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(trimmed);
};

const goToStep = (nextStep) => {
  step.value = nextStep;
};

const submitForgotPassword = async () => {
  if (isSubmitting.value) return;

  emailError.value = "";
  const trimmed = (email.value || "").trim();
  if (!trimmed) {
    emailError.value = "Please enter your email address.";
    return;
  }
  if (!isValidEmail(trimmed)) {
    emailError.value = "Please enter a valid email address.";
    return;
  }

  isSubmitting.value = true;
  try {
    await requestForgotPassword({ email: trimmed });
    goToStep(2);
  } catch (error) {
    // Alerts are handled globally in the API client.
  } finally {
    isSubmitting.value = false;
  }
};
</script>

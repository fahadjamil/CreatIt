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
        class="auth-card auth-card--compact auth-card--left auth-card--verifying"
      >
        <div class="auth-verifying-illustration" aria-hidden="true">
          <img
            class="auth-verifying-illustration-img"
            src="@/assets/icons/Approval--Streamline-Bangalore.svg"
            alt=""
          />
        </div>
        <h1 class="auth-title">We're verifying your account</h1>
        <p class="auth-subtitle auth-verifying-primary">
          We're just making sure that the information you have provided is
          accurate.
        </p>
        <p class="auth-subtitle auth-verifying-secondary">
          Account verification can take between 2-24 hours, you can still use the
          app while we are verifying your account.
        </p>
        <RouterLink
          class="auth-button auth-button--link"
          :to="{ path: '/dashboard', query: $route.query }"
        >
          Go to my dashboard
        </RouterLink>
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
import { useRoute } from "vue-router";

const route = useRoute();

const backTo = computed(() => {
  const query = { ...route.query };
  return { path: "/wallet/setup/business-details", query };
});
</script>

<style scoped>
.auth-verifying-illustration {
  display: flex;
  justify-content: center;
  margin-bottom: 20px;
}

.auth-verifying-illustration-img {
  width: 120px;
  height: auto;
  object-fit: contain;
}

.auth-card--verifying {
  text-align: left;
}

.auth-verifying-primary {
  margin-bottom: 12px;
}

.auth-verifying-secondary {
  margin-bottom: 24px;
}

.auth-button--link {
  display: block;
  text-align: center;
  text-decoration: none;
  color: #f8fafc;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.25);
}
</style>

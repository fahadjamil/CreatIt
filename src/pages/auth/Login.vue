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

    <div class="auth-card">
      <h1 class="auth-title">Welcome back to Create</h1>
      <p class="auth-subtitle">Please enter your details to log in</p>

      <label class="auth-field">
        <span>Email</span>
        <input class="auth-input" type="email" placeholder="you@example.com" />
      </label>

      <label class="auth-field">
        <span>Password</span>
        <input class="auth-input" type="password" placeholder="••••••••" />
      </label>

      <div class="auth-row">
        <label class="auth-checkbox">
          <input type="checkbox" />
          <span>Remember me</span>
        </label>
        <RouterLink class="auth-link" to="/auth/forgot-password">
          Forgot password
        </RouterLink>
      </div>

      <button class="auth-button" type="button" @click="handleSignIn">
        Sign In
      </button>
    </div>

    <footer class="auth-footer">
      Having trouble accessing your account?
      <button class="auth-link-support" type="button">Contact Support</button>
    </footer>
  </section>
</template>

<script setup>
import { useRouter } from "vue-router";

const router = useRouter();

const handleSignIn = () => {
  router.push("/dashboard");
};
</script>

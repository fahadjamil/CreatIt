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
        <input
          v-model="email"
          class="auth-input"
          type="email"
          placeholder="you@example.com"
        />
      </label>

      <label class="auth-field">
        <span>Password</span>
        <input
          v-model="password"
          class="auth-input"
          type="password"
          placeholder="••••••••"
        />
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

      <button
        class="auth-button"
        type="button"
        :disabled="isSigningIn"
        @click="handleSignIn"
      >
        <span v-if="isSigningIn" class="auth-button-loader" aria-hidden="true"></span>
        {{ isSigningIn ? "Signing in..." : "Sign In" }}
      </button>
    </div>

    <footer class="auth-footer">
      Having trouble accessing your account?
      <button class="auth-link-support" type="button">Contact Support</button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { loginUser } from "@/lib/api";
import { extractAuthTokens, setAuthSession } from "@/lib/auth";
import { getLoginDevicePayload } from "@/lib/device";

const router = useRouter();
const email = ref("");
const password = ref("");
const isSigningIn = ref(false);

const handleSignIn = async () => {
  if (isSigningIn.value) return;

  const payload = {
    email: email.value.trim(),
    password: password.value,
    device: getLoginDevicePayload(),
  };

  isSigningIn.value = true;
  try {
    const response = await loginUser(payload);
    const tokens = extractAuthTokens(response?.data);
    const authSession = {
      token: tokens.token,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      // Keep cookie payload tiny to avoid truncation.
      user: null,
      loggedInAt: new Date().toISOString(),
    };
    setAuthSession(authSession);
    router.push("/dashboard");
  } catch (error) {
    // Alerts are handled globally in the API client.
  } finally {
    isSigningIn.value = false;
  }
};
</script>

<template>
  <section class="auth-page">
    <header class="auth-header">
      <div class="auth-logo">
        <img class="auth-logo-image" src="@/assets/logo/create-logo.png" alt="Create" />
      </div>
      <RouterLink class="auth-top-action" to="/">Log in</RouterLink>
    </header>

    <div class="auth-card-wrapper auth-card-wrapper--compact">
      <RouterLink class="auth-back-link auth-back-link--card" to="/wallet/setup">
        <img class="auth-back-icon" src="@/assets/icons/BackIcon.png" alt="" />
        Back
      </RouterLink>

      <div class="auth-card auth-card--compact auth-card--left auth-card--upload-cnic">
        <img
          class="auth-upload-cnic-hero-icon"
          src="@/assets/icons/Image-File-Landscape--Streamline-Ultimate.svg"
          alt=""
        />
        <h1 class="auth-title">Upload your CNIC</h1>
        <p class="auth-subtitle auth-upload-cnic-desc">
          Upload both sides of your CNIC card and we'll capture the text to make
          it easy for you.
        </p>

        <div class="auth-upload-cnic-zones">
          <!-- Front: show uploaded row or dashed zone -->
          <div v-if="frontFile" class="auth-uploaded-row">
            <img
              class="auth-uploaded-thumb"
              :src="frontPreview"
              alt=""
            />
            <span class="auth-uploaded-filename">{{ frontFile.name }}</span>
            <button
              type="button"
              class="auth-uploaded-delete"
              aria-label="Remove front"
              @click="removeFront"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="#dc2626"/>
              </svg>
            </button>
          </div>
          <label v-else class="auth-upload-zone">
            <input
              type="file"
              accept="image/*"
              class="auth-upload-input"
              @change="onFrontChange"
            />
            <span class="auth-upload-zone-icon">
              <img src="@/assets/icons/Camera-1--Streamline-Ultimate 1.svg" alt="" />
            </span>
            <span class="auth-upload-zone-text">Upload the front of your CNIC</span>
            <span class="auth-upload-zone-plus">+</span>
          </label>

          <!-- Back: show uploaded row or dashed zone -->
          <div v-if="backFile" class="auth-uploaded-row">
            <img
              class="auth-uploaded-thumb"
              :src="backPreview"
              alt=""
            />
            <span class="auth-uploaded-filename">{{ backFile.name }}</span>
            <button
              type="button"
              class="auth-uploaded-delete"
              aria-label="Remove back"
              @click="removeBack"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="#dc2626"/>
              </svg>
            </button>
          </div>
          <label v-else class="auth-upload-zone">
            <input
              type="file"
              accept="image/*"
              class="auth-upload-input"
              @change="onBackChange"
            />
            <span class="auth-upload-zone-icon">
              <img src="@/assets/icons/Camera-1--Streamline-Ultimate 1.svg" alt="" />
            </span>
            <span class="auth-upload-zone-text">Upload the back of your CNIC</span>
            <span class="auth-upload-zone-plus">+</span>
          </label>
        </div>

        <button class="auth-button" type="button" :disabled="!canSubmit" @click="submitUpload">
          Upload your CNIC
        </button>
      </div>
    </div>

    <footer class="auth-footer">
      Having trouble accessing your account?
      <button class="auth-link-support" type="button">Contact Support</button>
    </footer>
  </section>
</template>

<script setup>
import { ref, computed, onUnmounted } from "vue";
import { useRouter, useRoute } from "vue-router";

const router = useRouter();
const route = useRoute();

const frontFile = ref(null);
const backFile = ref(null);
const frontPreview = ref(null);
const backPreview = ref(null);

const canSubmit = computed(() => frontFile.value != null && backFile.value != null);

function setPreview(file, which) {
  if (which === "front") {
    if (frontPreview.value) URL.revokeObjectURL(frontPreview.value);
    frontPreview.value = file ? URL.createObjectURL(file) : null;
  } else {
    if (backPreview.value) URL.revokeObjectURL(backPreview.value);
    backPreview.value = file ? URL.createObjectURL(file) : null;
  }
}

function onFrontChange(e) {
  const file = e.target.files?.[0];
  frontFile.value = file ?? null;
  setPreview(frontFile.value, "front");
}

function onBackChange(e) {
  const file = e.target.files?.[0];
  backFile.value = file ?? null;
  setPreview(backFile.value, "back");
}

function removeFront() {
  frontFile.value = null;
  setPreview(null, "front");
}

function removeBack() {
  backFile.value = null;
  setPreview(null, "back");
}

onUnmounted(() => {
  if (frontPreview.value) URL.revokeObjectURL(frontPreview.value);
  if (backPreview.value) URL.revokeObjectURL(backPreview.value);
});

function submitUpload() {
  if (!canSubmit.value) return;
  // TODO: upload frontFile and backFile, then navigate
  router.push({ path: "/wallet/setup/business-type", query: route.query });
}
</script>

<style scoped>
.auth-card--upload-cnic {
  padding-top: 28px;
}

.auth-upload-cnic-hero-icon {
  width: 48px;
  height: 48px;
  object-fit: contain;
  margin-bottom: 16px;
  display: block;
}

.auth-upload-cnic-desc {
  margin-bottom: 20px;
}

.auth-upload-cnic-zones {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.auth-upload-zone {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 2px dashed #cbd5e1;
  border-radius: 10px;
  background: #fafafa;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.auth-upload-zone:hover {
  border-color: #94a3b8;
  background: #f8fafc;
}

.auth-upload-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.auth-upload-zone-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.auth-upload-zone-icon img {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.auth-upload-zone-text {
  flex: 1;
  font-size: 0.9rem;
  color: #475569;
}

.auth-upload-zone-plus {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid #cbd5e1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  font-weight: 300;
  color: #64748b;
  line-height: 1;
}

.auth-uploaded-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
}

.auth-uploaded-thumb {
  width: 48px;
  height: 36px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
  background: #f1f5f9;
}

.auth-uploaded-filename {
  flex: 1;
  font-size: 0.9rem;
  color: #475569;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.auth-uploaded-delete {
  flex-shrink: 0;
  padding: 6px;
  border: none;
  background: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #dc2626;
  border-radius: 6px;
  transition: background 0.15s;
}

.auth-uploaded-delete:hover {
  background: #fef2f2;
}

.auth-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>

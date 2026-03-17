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
      <RouterLink class="auth-top-action" to="/auth/login">Log In</RouterLink>
    </header>

    <div class="auth-card-wrapper auth-card-wrapper--compact">
      <RouterLink
        v-if="step === 1"
        class="auth-back-link auth-back-link--card"
        to="/auth/login"
      >
        <img
          class="auth-back-icon"
          src="@/assets/icons/BackIcon.png"
          alt=""
        />
        Back to login
      </RouterLink>
      <button
        v-else
        class="auth-back-link auth-back-link--card auth-back-button"
        type="button"
        @click="goToStep(step - 1)"
      >
        <img
          class="auth-back-icon"
          src="@/assets/icons/BackIcon.png"
          alt=""
        />
        Back
      </button>

      <div
        v-if="step === 1"
        class="auth-card auth-card--compact auth-card--left auth-step-first"
      >
        <img
          class="auth-illustration-image"
          src="@/assets/icons/Mobile-Phone--Streamline-Ultimate.png"
          alt="Phone"
        />

        <h1 class="auth-title">Lets get started</h1>
        <p class="auth-subtitle">
          We'll send a verification code to this number.
        </p>

        <label class="auth-field">
          <div class="auth-phone">
            <select
              v-model="countryCode"
              class="auth-input auth-phone-code"
              aria-label="Country code"
            >
              <option
                v-for="country in countryCodes"
                :key="country.code"
                :value="country.dial_code"
              >
                {{ country.dial_code }}
              </option>
            </select>
            <input
              v-model="phoneNumber"
              class="auth-input"
              type="tel"
              placeholder="XXX-XXXXXX"
            />
          </div>
        </label>

        <button class="auth-button" type="button" @click="sendPhoneVerificationCode">
          Continue
        </button>
        <p class="auth-consent">
          By proceeding, you agree to our<br />
          <button class="auth-link-support" type="button">
            Terms &amp; Conditions
          </button>
          and
          <button class="auth-link-support" type="button">
            Privacy Policy
          </button>
        </p>
      </div>
      <div v-else-if="step === 2" class="auth-card auth-card--compact">
        <img
          class="auth-illustration-otp-image auth-otp-icon"
          src="@/assets/icons/Google-Home-Max-2--Streamline-Ultimate.png"
          alt="Verification"
        />

        <h1 class="auth-title auth-otp">Enter verification code</h1>
        <p class="auth-subtitle auth-otp">
          We sent a 4-digit code to {{ phoneDisplay }}.
        </p>

        <div class="auth-otp-inputs" aria-label="Verification code">
          <input
            class="auth-otp-input"
            type="text"
            inputmode="numeric"
            maxlength="1"
            v-model="verificationDigits[0]"
          />
          <input
            class="auth-otp-input"
            type="text"
            inputmode="numeric"
            maxlength="1"
            v-model="verificationDigits[1]"
          />
          <input
            class="auth-otp-input"
            type="text"
            inputmode="numeric"
            maxlength="1"
            v-model="verificationDigits[2]"
          />
          <input
            class="auth-otp-input"
            type="text"
            inputmode="numeric"
            maxlength="1"
            v-model="verificationDigits[3]"
          />
        </div>
        <button class="auth-otp-resend" type="button" @click="sendPhoneVerificationCode">
          Resend code
        </button>
        <button class="auth-button" type="button" @click="goToStep(3)">
          Submit Code
        </button>
      </div>
      <div v-else-if="step === 3" class="auth-card auth-card--compact auth-card--left">
        <img
          class="auth-illustration-image"
          src="@/assets/icons/Single-Neutral-Id-Card-3--Streamline-Ultimate.png"
          alt="Profile"
        />

        <h1 class="auth-title">What should we call you?</h1>
        <p class="auth-subtitle">
          To get started, we need your legal name<br />
          (especially if you're making a Create wallet)
        </p>

        <label class="auth-field">
          <input
            v-model="firstName"
            class="auth-input"
            type="text"
            placeholder="First Name"
          />
        </label>

        <label class="auth-field">
          <input
            v-model="lastName"
            class="auth-input"
            type="text"
            placeholder="Second Name"
          />
        </label>

        <button class="auth-button" type="button" @click="goToStep(4)">
          Next
        </button>
      </div>
      <div v-else-if="step === 4" class="auth-card auth-card--compact auth-card--left">
        <img
          class="auth-illustration-image"
          src="@/assets/icons/Send-Email-2--Streamline-Ultimate.png"
          alt="Email"
        />

        <h1 class="auth-title">How can we reach you?</h1>
        <p class="auth-subtitle">
          We need an email address to send you alerts<br />
          and important communications.
        </p>

        <label class="auth-field">
          <input
            v-model="email"
            class="auth-input"
            type="email"
            placeholder="email@email.com"
          />
        </label>

        <button class="auth-button" type="button" @click="goToStep(5)">
          Next
        </button>
      </div>
      <div v-else-if="step === 5" class="auth-card auth-card--compact auth-card--left">
        <img
          class="auth-illustration-image"
          src="@/assets/icons/Password-Lock-1--Streamline-Ultimate.png"
          alt="Security"
        />

        <h1 class="auth-title">Secure your account</h1>
        <p class="auth-subtitle">
          We take your privacy and security seriously, your<br />
          password is the first way to secure yourself
        </p>

        <label class="auth-field auth-password-field">
          <input
            v-model="password"
            class="auth-input"
            type="password"
            placeholder="Your Password"
          />
          <button class="auth-input-icon" type="button" aria-label="Show password">
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              aria-hidden="true"
            >
              <path
                d="M12 5c-5 0-9 5-9 7s4 7 9 7 9-5 9-7-4-7-9-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"
                fill="currentColor"
              />
            </svg>
          </button>
        </label>

        <label class="auth-field auth-password-field">
          <input
            v-model="passwordConfirmation"
            class="auth-input"
            type="password"
            placeholder="Re-enter your password"
          />
          <button
            class="auth-input-icon"
            type="button"
            aria-label="Show password confirmation"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              aria-hidden="true"
            >
              <path
                d="M12 5c-5 0-9 5-9 7s4 7 9 7 9-5 9-7-4-7-9-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"
                fill="currentColor"
              />
            </svg>
          </button>
        </label>

        <div class="auth-security">
          <p class="auth-security-title">A secure password includes</p>
          <ul class="auth-security-list">
            <li class="auth-security-item">A minimum of 8 characters</li>
            <li class="auth-security-item">At least one number</li>
            <li class="auth-security-item">
              A special character (!@#$%&*?-_)
            </li>
          </ul>
        </div>

        <button class="auth-button" type="button" @click="goToStep(6)">
          Next
        </button>
      </div>
      <div v-else-if="step === 6" class="auth-card auth-card--compact auth-card--left">
        <img
          class="auth-illustration-image"
          src="@/assets/icons/edit writiting.png"
          alt="Account type"
        />

        <h1 class="auth-title">Pick the right account type</h1>
        <p class="auth-subtitle">
          To make the app work the best it can for you, we<br />
          want your permission for a few features
        </p>

        <div class="auth-account-options">
          <label class="auth-account-option">
            <div class="auth-account-copy">
              <span class="auth-account-title">I'm a Creator</span>
              <span class="auth-account-subtitle">
                I'm a creator, freelancing or fulltime.
              </span>
            </div>
            <input
              v-model="accountType"
              class="auth-account-input"
              type="radio"
              name="accountType"
              value="creator"
            />
            <span class="auth-account-indicator" aria-hidden="true"></span>
          </label>

          <label class="auth-account-option">
            <div class="auth-account-copy">
              <span class="auth-account-title">I manage talent</span>
              <span class="auth-account-subtitle">
                I manage one or more creators
              </span>
            </div>
            <input
              v-model="accountType"
              class="auth-account-input"
              type="radio"
              name="accountType"
              value="manager"
            />
            <span class="auth-account-indicator" aria-hidden="true"></span>
          </label>

          <label class="auth-account-option">
            <div class="auth-account-copy">
              <span class="auth-account-title">
                I create and manage talent
              </span>
              <span class="auth-account-subtitle">
                I am a Creator as well as a manager
              </span>
            </div>
            <input
              v-model="accountType"
              class="auth-account-input"
              type="radio"
              name="accountType"
              value="creator_manager"
            />
            <span class="auth-account-indicator" aria-hidden="true"></span>
          </label>
        </div>

        <button class="auth-button" type="button" @click="goToStep(7)">
          Next
        </button>
      </div>
      <div v-else-if="step === 7" class="auth-card auth-card--compact auth-card--left">
        <h1 class="auth-title">Your skills</h1>
        <p class="auth-subtitle">
          Understanding what you do helps us give better<br />
          advice in the future. Pick up to 5.
        </p>

        <div class="auth-search">
          <span class="auth-search-icon">🔍</span>
          <input
            v-model="skillQuery"
            class="auth-input"
            type="text"
            placeholder="Search"
          />
        </div>

        <div class="auth-skill-card">
          <p class="auth-skill-title">Content Creation</p>
          <div class="auth-skill-tags">
            <button
              v-for="skill in filteredSkills"
              :key="skill"
              class="auth-skill-tag"
              :class="{
                'auth-skill-tag--active': selectedSkills.has(skill),
                'auth-skill-tag--disabled': isSkillDisabled(skill),
              }"
              type="button"
              :disabled="isSkillDisabled(skill)"
              @click="toggleSkill(skill)"
            >
              {{ skill }}
            </button>
          </div>
        </div>

        <button
          class="auth-button"
          type="button"
          :disabled="isSubmitting"
       
        >
          {{ isSubmitting ? "Submitting..." : "Next" }}
        </button>
      </div>
      <div v-else class="auth-card auth-card--compact auth-card--left">
        <img
          class="auth-success-illustration"
          src="@/assets/icons/e-wallet-finance.png"
          alt="All set"
        />

        <h1 class="auth-title">All set!</h1>
        <p class="auth-subtitle">
          We've created your Create account, to level up<br />
          your financial experience, get a Create Wallet
        </p>

        <div class="auth-benefits-card">
          <p class="auth-benefits-title">Benefits of a Create Wallet</p>
          <div class="auth-benefits-list">
            <div class="auth-benefit-item">
              <img
                class="auth-benefit-icon"
                src="@/assets/icons/Check-Circle-1--Streamline-Ultimate.png"
                alt=""
              />
              <span>Automatically track your business finances</span>
            </div>
            <div class="auth-benefit-item">
              <img
                class="auth-benefit-icon"
                src="@/assets/icons/Check-Circle-1--Streamline-Ultimate.png"
                alt=""
              />
              <span>Qualify for advanced financing</span>
            </div>
          </div>
        </div>

        <button class="auth-button auth-button--outline"    @click="submitRegistration" type="button">
          Go To Dashboard
        </button>
        <button class="auth-button" type="button">Create My Wallet</button>
      </div>
    </div>

    <footer class="auth-footer">
      Having trouble accessing your account?
      <button class="auth-link-support" type="button">Contact Support</button>
    </footer>
  </section>
</template>

<script setup>
import { computed, ref } from "vue";
import { registerUser, requestPhoneVerificationCode } from "@/lib/api";

const step = ref(1);
const skillQuery = ref("");
const selectedSkills = ref(new Set());
const maxSkills = 5;
const countryCode = ref("+61");
const phoneNumber = ref("");
const isSendingCode = ref(false);
const verificationDigits = ref(["", "", "", ""]);
const firstName = ref("");
const lastName = ref("");
const email = ref("");
const password = ref("");
const passwordConfirmation = ref("");
const accountType = ref("creator");
const isSubmitting = ref(false);

const skills = [
  "Video Production",
  "Photo Editing",
  "Tiktok Creation",
  "Script writing",
  "Animation skills",
  "Voice Acting",
  "Short Videos",
  "Live streaming",
  "Instagram Marketing",
];

const countryCodes = [
  { name: "Afghanistan", dial_code: "+93", code: "AF" },
  { name: "Albania", dial_code: "+355", code: "AL" },
  { name: "Algeria", dial_code: "+213", code: "DZ" },
  { name: "American Samoa", dial_code: "+1-684", code: "AS" },
  { name: "Andorra", dial_code: "+376", code: "AD" },
  { name: "Angola", dial_code: "+244", code: "AO" },
  { name: "Anguilla", dial_code: "+1-264", code: "AI" },
  { name: "Antarctica", dial_code: "+672", code: "AQ" },
  { name: "Antigua and Barbuda", dial_code: "+1-268", code: "AG" },
  { name: "Argentina", dial_code: "+54", code: "AR" },
  { name: "Armenia", dial_code: "+374", code: "AM" },
  { name: "Aruba", dial_code: "+297", code: "AW" },
  { name: "Australia", dial_code: "+61", code: "AU" },
  { name: "Austria", dial_code: "+43", code: "AT" },
  { name: "Azerbaijan", dial_code: "+994", code: "AZ" },
  { name: "Bahamas", dial_code: "+1-242", code: "BS" },
  { name: "Bahrain", dial_code: "+973", code: "BH" },
  { name: "Bangladesh", dial_code: "+880", code: "BD" },
  { name: "Barbados", dial_code: "+1-246", code: "BB" },
  { name: "Belarus", dial_code: "+375", code: "BY" },
  { name: "Belgium", dial_code: "+32", code: "BE" },
  { name: "Belize", dial_code: "+501", code: "BZ" },
  { name: "Benin", dial_code: "+229", code: "BJ" },
  { name: "Bermuda", dial_code: "+1-441", code: "BM" },
  { name: "Bhutan", dial_code: "+975", code: "BT" },
  { name: "Bolivia", dial_code: "+591", code: "BO" },
  { name: "Bosnia and Herzegovina", dial_code: "+387", code: "BA" },
  { name: "Botswana", dial_code: "+267", code: "BW" },
  { name: "Brazil", dial_code: "+55", code: "BR" },
  { name: "British Indian Ocean Territory", dial_code: "+246", code: "IO" },
  { name: "Brunei", dial_code: "+673", code: "BN" },
  { name: "Bulgaria", dial_code: "+359", code: "BG" },
  { name: "Burkina Faso", dial_code: "+226", code: "BF" },
  { name: "Burundi", dial_code: "+257", code: "BI" },
  { name: "Cambodia", dial_code: "+855", code: "KH" },
  { name: "Cameroon", dial_code: "+237", code: "CM" },
  { name: "Canada", dial_code: "+1", code: "CA" },
  { name: "Cape Verde", dial_code: "+238", code: "CV" },
  { name: "Cayman Islands", dial_code: "+1-345", code: "KY" },
  { name: "Central African Republic", dial_code: "+236", code: "CF" },
  { name: "Chad", dial_code: "+235", code: "TD" },
  { name: "Chile", dial_code: "+56", code: "CL" },
  { name: "China", dial_code: "+86", code: "CN" },
  { name: "Christmas Island", dial_code: "+61", code: "CX" },
  { name: "Cocos (Keeling) Islands", dial_code: "+61", code: "CC" },
  { name: "Colombia", dial_code: "+57", code: "CO" },
  { name: "Comoros", dial_code: "+269", code: "KM" },
  { name: "Congo, Democratic Republic of the", dial_code: "+243", code: "CD" },
  { name: "Congo, Republic of the", dial_code: "+242", code: "CG" },
  { name: "Cook Islands", dial_code: "+682", code: "CK" },
  { name: "Costa Rica", dial_code: "+506", code: "CR" },
  { name: "Croatia", dial_code: "+385", code: "HR" },
  { name: "Cuba", dial_code: "+53", code: "CU" },
  { name: "Curacao", dial_code: "+599", code: "CW" },
  { name: "Cyprus", dial_code: "+357", code: "CY" },
  { name: "Czech Republic", dial_code: "+420", code: "CZ" },
  { name: "Denmark", dial_code: "+45", code: "DK" },
  { name: "Djibouti", dial_code: "+253", code: "DJ" },
  { name: "Dominica", dial_code: "+1-767", code: "DM" },
  { name: "Dominican Republic", dial_code: "+1-809", code: "DO" },
  { name: "Dominican Republic", dial_code: "+1-829", code: "DO-829" },
  { name: "Dominican Republic", dial_code: "+1-849", code: "DO-849" },
  { name: "Ecuador", dial_code: "+593", code: "EC" },
  { name: "Egypt", dial_code: "+20", code: "EG" },
  { name: "El Salvador", dial_code: "+503", code: "SV" },
  { name: "Equatorial Guinea", dial_code: "+240", code: "GQ" },
  { name: "Eritrea", dial_code: "+291", code: "ER" },
  { name: "Estonia", dial_code: "+372", code: "EE" },
  { name: "Eswatini", dial_code: "+268", code: "SZ" },
  { name: "Ethiopia", dial_code: "+251", code: "ET" },
  { name: "Falkland Islands", dial_code: "+500", code: "FK" },
  { name: "Faroe Islands", dial_code: "+298", code: "FO" },
  { name: "Fiji", dial_code: "+679", code: "FJ" },
  { name: "Finland", dial_code: "+358", code: "FI" },
  { name: "France", dial_code: "+33", code: "FR" },
  { name: "French Guiana", dial_code: "+594", code: "GF" },
  { name: "French Polynesia", dial_code: "+689", code: "PF" },
  { name: "Gabon", dial_code: "+241", code: "GA" },
  { name: "Gambia", dial_code: "+220", code: "GM" },
  { name: "Georgia", dial_code: "+995", code: "GE" },
  { name: "Germany", dial_code: "+49", code: "DE" },
  { name: "Ghana", dial_code: "+233", code: "GH" },
  { name: "Gibraltar", dial_code: "+350", code: "GI" },
  { name: "Greece", dial_code: "+30", code: "GR" },
  { name: "Greenland", dial_code: "+299", code: "GL" },
  { name: "Grenada", dial_code: "+1-473", code: "GD" },
  { name: "Guadeloupe", dial_code: "+590", code: "GP" },
  { name: "Guam", dial_code: "+1-671", code: "GU" },
  { name: "Guatemala", dial_code: "+502", code: "GT" },
  { name: "Guernsey", dial_code: "+44-1481", code: "GG" },
  { name: "Guinea", dial_code: "+224", code: "GN" },
  { name: "Guinea-Bissau", dial_code: "+245", code: "GW" },
  { name: "Guyana", dial_code: "+592", code: "GY" },
  { name: "Haiti", dial_code: "+509", code: "HT" },
  { name: "Honduras", dial_code: "+504", code: "HN" },
  { name: "Hong Kong", dial_code: "+852", code: "HK" },
  { name: "Hungary", dial_code: "+36", code: "HU" },
  { name: "Iceland", dial_code: "+354", code: "IS" },
  { name: "India", dial_code: "+91", code: "IN" },
  { name: "Indonesia", dial_code: "+62", code: "ID" },
  { name: "Iran", dial_code: "+98", code: "IR" },
  { name: "Iraq", dial_code: "+964", code: "IQ" },
  { name: "Ireland", dial_code: "+353", code: "IE" },
  { name: "Isle of Man", dial_code: "+44-1624", code: "IM" },
  { name: "Israel", dial_code: "+972", code: "IL" },
  { name: "Italy", dial_code: "+39", code: "IT" },
  { name: "Jamaica", dial_code: "+1-876", code: "JM" },
  { name: "Japan", dial_code: "+81", code: "JP" },
  { name: "Jersey", dial_code: "+44-1534", code: "JE" },
  { name: "Jordan", dial_code: "+962", code: "JO" },
  { name: "Kazakhstan", dial_code: "+7", code: "KZ" },
  { name: "Kenya", dial_code: "+254", code: "KE" },
  { name: "Kiribati", dial_code: "+686", code: "KI" },
  { name: "Korea, North", dial_code: "+850", code: "KP" },
  { name: "Korea, South", dial_code: "+82", code: "KR" },
  { name: "Kuwait", dial_code: "+965", code: "KW" },
  { name: "Kyrgyzstan", dial_code: "+996", code: "KG" },
  { name: "Laos", dial_code: "+856", code: "LA" },
  { name: "Latvia", dial_code: "+371", code: "LV" },
  { name: "Lebanon", dial_code: "+961", code: "LB" },
  { name: "Lesotho", dial_code: "+266", code: "LS" },
  { name: "Liberia", dial_code: "+231", code: "LR" },
  { name: "Libya", dial_code: "+218", code: "LY" },
  { name: "Liechtenstein", dial_code: "+423", code: "LI" },
  { name: "Lithuania", dial_code: "+370", code: "LT" },
  { name: "Luxembourg", dial_code: "+352", code: "LU" },
  { name: "Macau", dial_code: "+853", code: "MO" },
  { name: "Madagascar", dial_code: "+261", code: "MG" },
  { name: "Malawi", dial_code: "+265", code: "MW" },
  { name: "Malaysia", dial_code: "+60", code: "MY" },
  { name: "Maldives", dial_code: "+960", code: "MV" },
  { name: "Mali", dial_code: "+223", code: "ML" },
  { name: "Malta", dial_code: "+356", code: "MT" },
  { name: "Marshall Islands", dial_code: "+692", code: "MH" },
  { name: "Martinique", dial_code: "+596", code: "MQ" },
  { name: "Mauritania", dial_code: "+222", code: "MR" },
  { name: "Mauritius", dial_code: "+230", code: "MU" },
  { name: "Mayotte", dial_code: "+262", code: "YT" },
  { name: "Mexico", dial_code: "+52", code: "MX" },
  { name: "Micronesia", dial_code: "+691", code: "FM" },
  { name: "Moldova", dial_code: "+373", code: "MD" },
  { name: "Monaco", dial_code: "+377", code: "MC" },
  { name: "Mongolia", dial_code: "+976", code: "MN" },
  { name: "Montenegro", dial_code: "+382", code: "ME" },
  { name: "Montserrat", dial_code: "+1-664", code: "MS" },
  { name: "Morocco", dial_code: "+212", code: "MA" },
  { name: "Mozambique", dial_code: "+258", code: "MZ" },
  { name: "Myanmar", dial_code: "+95", code: "MM" },
  { name: "Namibia", dial_code: "+264", code: "NA" },
  { name: "Nauru", dial_code: "+674", code: "NR" },
  { name: "Nepal", dial_code: "+977", code: "NP" },
  { name: "Netherlands", dial_code: "+31", code: "NL" },
  { name: "New Caledonia", dial_code: "+687", code: "NC" },
  { name: "New Zealand", dial_code: "+64", code: "NZ" },
  { name: "Nicaragua", dial_code: "+505", code: "NI" },
  { name: "Niger", dial_code: "+227", code: "NE" },
  { name: "Nigeria", dial_code: "+234", code: "NG" },
  { name: "Niue", dial_code: "+683", code: "NU" },
  { name: "Norfolk Island", dial_code: "+672", code: "NF" },
  { name: "North Macedonia", dial_code: "+389", code: "MK" },
  { name: "Northern Mariana Islands", dial_code: "+1-670", code: "MP" },
  { name: "Norway", dial_code: "+47", code: "NO" },
  { name: "Oman", dial_code: "+968", code: "OM" },
  { name: "Pakistan", dial_code: "+92", code: "PK" },
  { name: "Palau", dial_code: "+680", code: "PW" },
  { name: "Palestine", dial_code: "+970", code: "PS" },
  { name: "Panama", dial_code: "+507", code: "PA" },
  { name: "Papua New Guinea", dial_code: "+675", code: "PG" },
  { name: "Paraguay", dial_code: "+595", code: "PY" },
  { name: "Peru", dial_code: "+51", code: "PE" },
  { name: "Philippines", dial_code: "+63", code: "PH" },
  { name: "Poland", dial_code: "+48", code: "PL" },
  { name: "Portugal", dial_code: "+351", code: "PT" },
  { name: "Puerto Rico", dial_code: "+1-787", code: "PR" },
  { name: "Puerto Rico", dial_code: "+1-939", code: "PR-939" },
  { name: "Qatar", dial_code: "+974", code: "QA" },
  { name: "Reunion", dial_code: "+262", code: "RE" },
  { name: "Romania", dial_code: "+40", code: "RO" },
  { name: "Russia", dial_code: "+7", code: "RU" },
  { name: "Rwanda", dial_code: "+250", code: "RW" },
  { name: "Saint Barthelemy", dial_code: "+590", code: "BL" },
  { name: "Saint Helena", dial_code: "+290", code: "SH" },
  { name: "Saint Kitts and Nevis", dial_code: "+1-869", code: "KN" },
  { name: "Saint Lucia", dial_code: "+1-758", code: "LC" },
  { name: "Saint Martin", dial_code: "+590", code: "MF" },
  { name: "Saint Pierre and Miquelon", dial_code: "+508", code: "PM" },
  { name: "Saint Vincent and the Grenadines", dial_code: "+1-784", code: "VC" },
  { name: "Samoa", dial_code: "+685", code: "WS" },
  { name: "San Marino", dial_code: "+378", code: "SM" },
  { name: "Sao Tome and Principe", dial_code: "+239", code: "ST" },
  { name: "Saudi Arabia", dial_code: "+966", code: "SA" },
  { name: "Senegal", dial_code: "+221", code: "SN" },
  { name: "Serbia", dial_code: "+381", code: "RS" },
  { name: "Seychelles", dial_code: "+248", code: "SC" },
  { name: "Sierra Leone", dial_code: "+232", code: "SL" },
  { name: "Singapore", dial_code: "+65", code: "SG" },
  { name: "Sint Maarten", dial_code: "+1-721", code: "SX" },
  { name: "Slovakia", dial_code: "+421", code: "SK" },
  { name: "Slovenia", dial_code: "+386", code: "SI" },
  { name: "Solomon Islands", dial_code: "+677", code: "SB" },
  { name: "Somalia", dial_code: "+252", code: "SO" },
  { name: "South Africa", dial_code: "+27", code: "ZA" },
  { name: "South Sudan", dial_code: "+211", code: "SS" },
  { name: "Spain", dial_code: "+34", code: "ES" },
  { name: "Sri Lanka", dial_code: "+94", code: "LK" },
  { name: "Sudan", dial_code: "+249", code: "SD" },
  { name: "Suriname", dial_code: "+597", code: "SR" },
  { name: "Svalbard and Jan Mayen", dial_code: "+47", code: "SJ" },
  { name: "Sweden", dial_code: "+46", code: "SE" },
  { name: "Switzerland", dial_code: "+41", code: "CH" },
  { name: "Syria", dial_code: "+963", code: "SY" },
  { name: "Taiwan", dial_code: "+886", code: "TW" },
  { name: "Tajikistan", dial_code: "+992", code: "TJ" },
  { name: "Tanzania", dial_code: "+255", code: "TZ" },
  { name: "Thailand", dial_code: "+66", code: "TH" },
  { name: "Timor-Leste", dial_code: "+670", code: "TL" },
  { name: "Togo", dial_code: "+228", code: "TG" },
  { name: "Tokelau", dial_code: "+690", code: "TK" },
  { name: "Tonga", dial_code: "+676", code: "TO" },
  { name: "Trinidad and Tobago", dial_code: "+1-868", code: "TT" },
  { name: "Tunisia", dial_code: "+216", code: "TN" },
  { name: "Turkey", dial_code: "+90", code: "TR" },
  { name: "Turkmenistan", dial_code: "+993", code: "TM" },
  { name: "Turks and Caicos Islands", dial_code: "+1-649", code: "TC" },
  { name: "Tuvalu", dial_code: "+688", code: "TV" },
  { name: "Uganda", dial_code: "+256", code: "UG" },
  { name: "Ukraine", dial_code: "+380", code: "UA" },
  { name: "United Arab Emirates", dial_code: "+971", code: "AE" },
  { name: "United Kingdom", dial_code: "+44", code: "GB" },
  { name: "United States", dial_code: "+1", code: "US" },
  { name: "Uruguay", dial_code: "+598", code: "UY" },
  { name: "Uzbekistan", dial_code: "+998", code: "UZ" },
  { name: "Vanuatu", dial_code: "+678", code: "VU" },
  { name: "Vatican City", dial_code: "+379", code: "VA" },
  { name: "Venezuela", dial_code: "+58", code: "VE" },
  { name: "Vietnam", dial_code: "+84", code: "VN" },
  { name: "Virgin Islands, British", dial_code: "+1-284", code: "VG" },
  { name: "Virgin Islands, U.S.", dial_code: "+1-340", code: "VI" },
  { name: "Wallis and Futuna", dial_code: "+681", code: "WF" },
  { name: "Western Sahara", dial_code: "+212", code: "EH" },
  { name: "Yemen", dial_code: "+967", code: "YE" },
  { name: "Zambia", dial_code: "+260", code: "ZM" },
  { name: "Zimbabwe", dial_code: "+263", code: "ZW" },
];

const contentCreationSkillSet = new Set([
  "Video Production",
  "Photo Editing",
  "Script writing",
  "Animation skills",
  "Voice Acting",
  "Short Videos",
  "Live streaming",
]);

const socialMediaSkillSet = new Set(["Instagram Marketing", "Tiktok Creation"]);

const fullName = computed(() =>
  [firstName.value.trim(), lastName.value.trim()].filter(Boolean).join(" ")
);

const phoneVerificationCode = computed(() =>
  verificationDigits.value.map((digit) => digit.trim()).join("")
);

const fullPhoneNumber = computed(() => {
  const digits = phoneNumber.value.trim();
  if (!digits) {
    return "";
  }
  return `${countryCode.value}${digits}`;
});

const phoneDisplay = computed(() => {
  const combined = fullPhoneNumber.value;
  return combined || `${countryCode.value} 3XX-XXXXXX`;
});

const filteredSkills = computed(() => {
  const query = skillQuery.value.trim().toLowerCase();
  if (!query) {
    return skills;
  }
  return skills.filter((skill) => skill.toLowerCase().includes(query));
});

const goToStep = (nextStep) => {
  step.value = nextStep;
};

const sendPhoneVerificationCode = async () => {
  if (isSendingCode.value) {
    return;
  }
  isSendingCode.value = true;
  try {
    await requestPhoneVerificationCode({ phone_number: fullPhoneNumber.value });
    goToStep(2);
  } catch (error) {
    console.error("Phone verification code request failed", error);
  } finally {
    isSendingCode.value = false;
  }
};

const getDeviceId = () => {
  try {
    const storageKey = "createit_device_id";
    const existing = localStorage.getItem(storageKey);
    if (existing) {
      return existing;
    }
    const nextId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `device-${Date.now()}`;
    localStorage.setItem(storageKey, nextId);
    return nextId;
  } catch (error) {
    return "device-unknown";
  }
};

const getDevicePayload = () => ({
  platform: "web",
  device_id: getDeviceId(),
  device_name: "Web Browser",
  device_model: navigator.userAgent,
  os_version: navigator.platform ?? "web",
  app_version: "1.0.0",
  push_token: "",
});

const submitRegistration = async () => {
  if (isSubmitting.value) {
    return;
  }
  isSubmitting.value = true;
  try {
    const selected = Array.from(selectedSkills.value);
    const payload = {
      phone_number: fullPhoneNumber.value,
      phone_verification_code: phoneVerificationCode.value,
      name: fullName.value,
      email: email.value,
      password: password.value,
      password_confirmation: passwordConfirmation.value,
      device: getDevicePayload(),
      kyc: {
        account_type: accountType.value,
        skills: {
          content_creation: selected.filter((skill) =>
            contentCreationSkillSet.has(skill)
          ),
          social_media: selected.filter((skill) =>
            socialMediaSkillSet.has(skill)
          ),
        },
      },
    };

    await registerUser(payload);
    goToStep(8);
  } catch (error) {
    console.error("Registration failed", error);
  } finally {
    isSubmitting.value = false;
  }
};

const toggleSkill = (skill) => {
  const nextSelection = new Set(selectedSkills.value);
  if (nextSelection.has(skill)) {
    nextSelection.delete(skill);
    selectedSkills.value = nextSelection;
    return;
  }
  if (nextSelection.size >= maxSkills) {
    return;
  }
  nextSelection.add(skill);
  selectedSkills.value = nextSelection;
};

const isSkillDisabled = (skill) =>
  selectedSkills.value.size >= maxSkills && !selectedSkills.value.has(skill);
</script>

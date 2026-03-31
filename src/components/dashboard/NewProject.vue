<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { DateSelect } from "@/components/ui/date-select";
import {
  createProject,
  createProjectMilestone,
  createTag,
  getProjectScopes,
  getTags,
  updateProject,
} from "@/lib/api";
import { useAlerts } from "@/composables/useAlerts";

const emit = defineEmits<{ (e: "close"): void; (e: "complete"): void }>();

const { pushAlert } = useAlerts();

const currentStep = ref(1);

const createdProjectId = ref<string>("");
const createdClientId = ref<string>("");
const isSavingInitialProject = ref(false);
const didCreateMilestones = ref(false);

// Step 1 form state
const projectName = ref("");
const projectType = ref("");
const clientName = ref("");
const clientOrBrand = ref<"brand" | "individual">("brand");
// Default new projects should start as "in_progress"
const projectStatus = ref("in_progress");
// Stored as ISO `YYYY-MM-DD` (display formatted in UI).
const todayIsoDate = new Date().toISOString().split("T")[0];
const startDate = ref(todayIsoDate);
const endDate = ref("");
const scopeDescription = ref("");
const selectedProjectScopeId = ref("");
const uploadedFiles = ref<{ name: string; type: string; file: File }[]>([]);
const selectedTags = ref<string[]>([]);
const selectedTagIds = ref<string[]>([]);
const tagInput = ref("");
const tagsOpen = ref(false);
const isSavingTag = ref(false);
type TagOption = { id: string; name: string; slug: string };
const availableTags = ref<TagOption[]>([]);
type ProjectScopeOption = { id: string; name: string };
const projectScopeOptions = ref<ProjectScopeOption[]>([]);
const clientContactName = ref("");
const clientRole = ref("");
const clientEmail = ref("");
const clientMobile = ref("+92");

// Step 2: Payment structure
type PaymentStructure = "single" | "multiple" | "recurring";
const paymentStructure = ref<PaymentStructure>("single");

// Step 3: Payment details (single payment)
const projectAmountSingle = ref("");
const currencySingle = ref("PKR");
const taxHandling = ref<"including" | "exclusive">("including");
const paymentMethodSingle = ref("PayPak");
const paymentTiming = ref<"before" | "after" | "specific">("specific");
const paymentSpecificDate = ref("");
const financingOptIn = ref(true);

type MilestoneItem = {
  id: number;
  percentage: string;
  date: string;
  amount: string;
  deliverables: string;
};

// Step 3: Payment details (multiple payments)
const projectAmountMultiple = ref("");
const currencyMultiple = ref("PKR");
const taxHandlingMultiple = ref<"including" | "exclusive">("including");
const paymentMethodMultiple = ref("PayPak");
const financingOptInMultiple = ref(true);
const nextMilestoneId = ref(1);
const milestones = ref<MilestoneItem[]>([]);

// Step 3: recurring payments
const projectAmountRecurring = ref("");
const currencyRecurring = ref("PKR");
const taxHandlingRecurring = ref<"including" | "exclusive">("including");
const paymentMethodRecurring = ref("PayPak");
const recurringDurationCount = ref(1);
type RecurringDurationUnit = "weeks" | "months" | "quarters";
const recurringDurationUnit = ref<RecurringDurationUnit>("months");
const financingOptInRecurring = ref(true);
const earlyPayoutAgreedRecurring = ref(false);

/** Steps shown in the top bar only. Agreement is step 6 in the flow but is not listed here. */
const stepBarSteps = [
  { key: "details", label: "Project Details", routeStep: 1 },
  { key: "structure", label: "Payment Structure", routeStep: 2 },
  { key: "payment", label: "Payment Details", routeStep: 3 },
  { key: "early", label: "Early Payout", routeStep: 4 },
  { key: "review", label: "Review", routeStep: 5 },
] as const;

const earlyPayoutAgreed = ref(false);
const earlyPayoutAgreedMultiple = ref(false);

const stepBarVisibleSteps = computed(() =>
  stepBarSteps.filter((s) => (s.key === "early" ? shouldShowFinancingStep.value : true)),
);

const paymentMethodOptions = ["PayPak", "Bank transfer", "JazzCash", "Easypaisa"];
const currencyOptions = ["PKR", "USD"];

const singleAmountNumeric = computed(() => {
  const n = parseFloat(String(projectAmountSingle.value).replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
});

const multipleAmountNumeric = computed(() => {
  const n = parseFloat(String(projectAmountMultiple.value).replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
});

const milestoneTotalNumeric = computed(() =>
  milestones.value.reduce((sum, milestone) => {
    const amount = parseFloat(String(milestone.amount).replace(/,/g, ""));
    return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
  }, 0),
);

const milestoneRemainingNumeric = computed(() => Math.max(0, multipleAmountNumeric.value - milestoneTotalNumeric.value));

const milestoneCompletionPercent = computed(() => {
  if (multipleAmountNumeric.value <= 0) return 0;
  const percent = (milestoneTotalNumeric.value / multipleAmountNumeric.value) * 100;
  return Math.max(0, Math.min(100, Math.round(percent)));
});

const reviewMultipleAmountLine = computed(() => {
  const amount = String(projectAmountMultiple.value).trim() || "0";
  return `${currencyMultiple.value} ${amount}`;
});

const FINANCING_FEE_RATE = 0.025;

const shouldShowFinancingStep = computed(() => {
  if (paymentStructure.value === "single") return financingOptIn.value;
  if (paymentStructure.value === "multiple") return financingOptInMultiple.value;
  if (paymentStructure.value === "recurring") return financingOptInRecurring.value;
  return false;
});

const earlyPayoutTotalPkr = computed(() => {
  const n = singleAmountNumeric.value;
  return n > 0 ? n.toLocaleString("en-PK") : "0";
});

const earlyPayoutFeePkr = computed(() =>
  Math.round(singleAmountNumeric.value * FINANCING_FEE_RATE).toLocaleString("en-PK"),
);

const earlyPayoutYouReceivePkr = computed(() =>
  Math.max(0, Math.floor(singleAmountNumeric.value * (1 - FINANCING_FEE_RATE))).toLocaleString("en-PK"),
);

const earlyPayoutTotalPkrMultiple = computed(() => {
  const base = milestoneTotalNumeric.value > 0 ? milestoneTotalNumeric.value : multipleAmountNumeric.value;
  return base > 0 ? base.toLocaleString("en-PK") : "0";
});

const earlyPayoutFeePkrMultiple = computed(() => {
  const base = milestoneTotalNumeric.value > 0 ? milestoneTotalNumeric.value : multipleAmountNumeric.value;
  return Math.round(base * FINANCING_FEE_RATE).toLocaleString("en-PK");
});

const earlyPayoutYouReceivePkrMultiple = computed(() => {
  const base = milestoneTotalNumeric.value > 0 ? milestoneTotalNumeric.value : multipleAmountNumeric.value;
  return Math.max(0, Math.floor(base * (1 - FINANCING_FEE_RATE))).toLocaleString("en-PK");
});

const recurringAmountNumeric = computed(() => {
  const n = parseFloat(String(projectAmountRecurring.value).replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
});

const recurringPeriodCountInt = computed(() => {
  const n = Math.floor(Number(recurringDurationCount.value));
  return Number.isFinite(n) && n > 0 ? n : 0;
});

const recurringTotalContractNumeric = computed(() => recurringAmountNumeric.value * recurringPeriodCountInt.value);

const earlyPayoutTotalPkrRecurring = computed(() => {
  const base = recurringTotalContractNumeric.value;
  return base > 0 ? base.toLocaleString("en-PK") : "0";
});

const earlyPayoutFeePkrRecurring = computed(() =>
  Math.round(recurringTotalContractNumeric.value * FINANCING_FEE_RATE).toLocaleString("en-PK"),
);

const earlyPayoutYouReceivePkrRecurring = computed(() =>
  Math.max(0, Math.floor(recurringTotalContractNumeric.value * (1 - FINANCING_FEE_RATE))).toLocaleString("en-PK"),
);

const isFinancingStepSingle = computed(() => currentStep.value === 4 && paymentStructure.value === "single");
const isFinancingStepMultiple = computed(() => currentStep.value === 4 && paymentStructure.value === "multiple");
const isFinancingStepRecurring = computed(() => currentStep.value === 4 && paymentStructure.value === "recurring");

const isAgreementStep = computed(() => currentStep.value === 6);

const agreementTermsAccepted = ref(false);
const agreementSendToClient = ref(false);
const isCreatingProject = ref(false);

const agreementActiveNav = ref<"scope" | "timeline" | "payment" | "responsibilities">("scope");

const primaryActionDisabled = computed(() => {
  if (currentStep.value === 1 && !selectedProjectScopeId.value.trim()) return true;
  if (currentStep.value === 1 && isSavingInitialProject.value) return true;
  if (isAgreementStep.value && isCreatingProject.value) return true;
  if (isFinancingStepSingle.value && !earlyPayoutAgreed.value) return true;
  if (isFinancingStepMultiple.value && !earlyPayoutAgreedMultiple.value) return true;
  if (isFinancingStepRecurring.value && !earlyPayoutAgreedRecurring.value) return true;
  if (currentStep.value === 3 && paymentStructure.value === "single") {
    if (singleAmountNumeric.value <= 0) return true;
  }
  if (currentStep.value === 3 && paymentStructure.value === "multiple") {
    // Require full milestone allocation before moving forward.
    if (milestones.value.length === 0) return true;
    if (milestoneCompletionPercent.value < 100) return true;
  }
  if (currentStep.value === 3 && paymentStructure.value === "recurring") {
    if (recurringAmountNumeric.value <= 0) return true;
    if (recurringPeriodCountInt.value < 1) return true;
  }
  if (
    isAgreementStep.value &&
    (!agreementTermsAccepted.value || !agreementSendToClient.value)
  ) {
    return true;
  }
  return false;
});

/** Demo GST estimate (matches design ratio ~9.1% for inclusive display) */
const estimatedGstPkr = computed(() => {
  if (taxHandling.value !== "including" || singleAmountNumeric.value <= 0) return null;
  return (singleAmountNumeric.value * 0.090991).toFixed(2);
});

const estimatedGstMultiple = computed(() => {
  if (taxHandlingMultiple.value !== "including" || multipleAmountNumeric.value <= 0) return null;
  return (multipleAmountNumeric.value * 0.090991).toFixed(2);
});

const estimatedGstRecurring = computed(() => {
  if (taxHandlingRecurring.value !== "including" || recurringAmountNumeric.value <= 0) return null;
  return (recurringAmountNumeric.value * 0.090991).toFixed(2);
});

const financingEligiblePkrForMultiple = computed(() => {
  if (multipleAmountNumeric.value <= 0) return "977,857";
  return Math.floor(multipleAmountNumeric.value * 97.7857).toLocaleString("en-PK");
});

const financingEligiblePkrForRecurring = computed(() => {
  if (recurringAmountNumeric.value <= 0) return "977,857";
  return Math.floor(recurringAmountNumeric.value * 97.7857).toLocaleString("en-PK");
});

const reviewTaxSummaryLabelMultiple = computed(() =>
  taxHandlingMultiple.value === "including" ? "Inclusive of GST" : "Exclusive of GST",
);

const reviewGstPercentApproxMultiple = computed(() => {
  if (taxHandlingMultiple.value !== "including" || multipleAmountNumeric.value <= 0 || !estimatedGstMultiple.value) {
    return null;
  }
  const gst = parseFloat(String(estimatedGstMultiple.value).replace(/,/g, ""));
  if (!Number.isFinite(gst)) return null;
  return ((gst / multipleAmountNumeric.value) * 100).toFixed(1);
});

const reviewTaxAmountLineMultiple = computed(() => {
  if (taxHandlingMultiple.value !== "including") return "Taxes added on top of your fee";
  if (!estimatedGstMultiple.value) return "—";
  const pct = reviewGstPercentApproxMultiple.value;
  const cur = currencyMultiple.value;
  const amt = Number(estimatedGstMultiple.value).toLocaleString("en-PK");
  return pct != null ? `${cur} ${amt} (${pct}%)` : `${cur} ${amt}`;
});

const financingEligiblePkr = computed(() => {
  if (singleAmountNumeric.value <= 0) return "977,857";
  return Math.floor(singleAmountNumeric.value * 97.7857).toLocaleString("en-PK");
});

const reviewSectionOpen = reactive({
  project: true,
  client: true,
  payment: true,
});

function displayOrDash(value: string) {
  const t = String(value ?? "").trim();
  return t.length ? t : "—";
}

function formatSlashDateOrDash(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isFinite(d.getTime())) {
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  // If the DateSelect already provides "DD/MM/YYYY", keep it as-is.
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  // If stored as ISO "YYYY-MM-DD", format using local parsing.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const dd = parseIsoDateLocal(s);
    if (Number.isFinite(dd.getTime())) {
      return dd.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
    }
  }
  return s;
}

function parseIsoDateLocal(iso: string): Date {
  if (!iso || typeof iso !== "string") return new Date();
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return new Date();
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(y, mo, d);
}

const recurringSchedulePreview = computed(() => {
  const n = recurringPeriodCountInt.value;
  const unit = recurringDurationUnit.value;
  const per = recurringAmountNumeric.value;
  if (n < 1 || per <= 0) return [] as { index: number; dueLabel: string; amountLine: string }[];
  const base = parseIsoDateLocal(startDate.value);
  const cur = currencyRecurring.value;
  const amt = per.toLocaleString("en-PK");
  const out: { index: number; dueLabel: string; amountLine: string }[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(base.getTime());
    if (unit === "weeks") d.setDate(d.getDate() + i * 7);
    else if (unit === "months") d.setMonth(d.getMonth() + i);
    else d.setMonth(d.getMonth() + i * 3);
    const dueLabel = d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    out.push({ index: i + 1, dueLabel, amountLine: `${cur} ${amt}` });
  }
  return out;
});

const reviewRecurringAmountLine = computed(() => {
  const amt = String(projectAmountRecurring.value).trim() || "0";
  return `${currencyRecurring.value} ${amt}`;
});

const reviewTaxSummaryLabelRecurring = computed(() =>
  taxHandlingRecurring.value === "including" ? "Inclusive of GST" : "Exclusive of GST",
);

const reviewGstPercentApproxRecurring = computed(() => {
  if (
    taxHandlingRecurring.value !== "including" ||
    recurringAmountNumeric.value <= 0 ||
    !estimatedGstRecurring.value
  ) {
    return null;
  }
  const gst = parseFloat(String(estimatedGstRecurring.value).replace(/,/g, ""));
  if (!Number.isFinite(gst)) return null;
  return ((gst / recurringAmountNumeric.value) * 100).toFixed(1);
});

const reviewTaxAmountLineRecurring = computed(() => {
  if (taxHandlingRecurring.value !== "including") return "Taxes added on top of your fee";
  if (!estimatedGstRecurring.value) return "—";
  const pct = reviewGstPercentApproxRecurring.value;
  const cur = currencyRecurring.value;
  const amt = Number(estimatedGstRecurring.value).toLocaleString("en-PK");
  return pct != null ? `${cur} ${amt} (${pct}%)` : `${cur} ${amt}`;
});

const reviewRecurringDurationLabel = computed(() => {
  const c = recurringPeriodCountInt.value;
  if (c < 1) return "—";
  const u = recurringDurationUnit.value;
  const unitLabel =
    u === "weeks" ? (c === 1 ? "week" : "weeks") : u === "months" ? (c === 1 ? "month" : "months") : c === 1 ? "quarter" : "quarters";
  return `${c} ${unitLabel}`;
});

const showFinancingSummaryRowRecurring = computed(
  () => paymentStructure.value === "recurring" && financingOptInRecurring.value,
);

const reviewPaymentStructureLabel = computed(() => {
  const p = paymentStructure.value;
  if (p === "single") return "Single";
  if (p === "multiple") return "Multiple payments";
  return "Recurring payments";
});

const reviewPaymentTimingLabel = computed(() => {
  const t = paymentTiming.value;
  if (t === "before") return "Before starting the project";
  if (t === "after") return "After completing the project";
  if (t === "specific") {
    const d = displayOrDash(paymentSpecificDate.value);
    return d === "—" ? "On a specific date" : `On a specific date (${d})`;
  }
  return "—";
});

const reviewTaxSummaryLabel = computed(() =>
  taxHandling.value === "including" ? "Inclusive of GST" : "Exclusive of GST",
);

const reviewGstPercentApprox = computed(() => {
  if (taxHandling.value !== "including" || singleAmountNumeric.value <= 0 || !estimatedGstPkr.value) return null;
  const gst = parseFloat(String(estimatedGstPkr.value).replace(/,/g, ""));
  if (!Number.isFinite(gst)) return null;
  return ((gst / singleAmountNumeric.value) * 100).toFixed(1);
});

const reviewTaxAmountLine = computed(() => {
  if (paymentStructure.value !== "single") return "—";
  if (taxHandling.value !== "including") return "Taxes added on top of your fee";
  if (!estimatedGstPkr.value) return "—";
  const pct = reviewGstPercentApprox.value;
  const cur = currencySingle.value;
  const amt = Number(estimatedGstPkr.value).toLocaleString("en-PK");
  return pct != null ? `${cur} ${amt} (${pct}%)` : `${cur} ${amt}`;
});

const reviewProjectAmountLine = computed(() => {
  const amt = String(projectAmountSingle.value).trim() || "0";
  return `${currencySingle.value} ${amt}`;
});

const showFinancingSummaryRow = computed(
  () => paymentStructure.value === "single" && financingOptIn.value,
);

const showFinancingSummaryRowMultiple = computed(
  () => paymentStructure.value === "multiple" && financingOptInMultiple.value,
);

const reviewMultipleFinancingLine = computed(() => {
  const amount = milestoneTotalNumeric.value > 0 ? milestoneTotalNumeric.value : multipleAmountNumeric.value;
  return `${currencyMultiple.value} ${amount.toLocaleString("en-PK")}`;
});

function formatMilestoneLabel(index: number) {
  const n = index + 1;
  const mod10 = n % 10;
  const mod100 = n % 100;
  let suffix = "th";
  if (mod10 === 1 && mod100 !== 11) suffix = "st";
  else if (mod10 === 2 && mod100 !== 12) suffix = "nd";
  else if (mod10 === 3 && mod100 !== 13) suffix = "rd";
  return `${n}${suffix} Milestone`;
}

function milestoneReviewAmount(milestone: MilestoneItem) {
  return milestoneAmountNumber(milestone).toLocaleString("en-PK");
}

function milestoneReviewPercent(milestone: MilestoneItem) {
  const value = String(milestone.percentage ?? "").trim();
  return value.length ? `${value}%` : "—";
}

const agreementClientLabel = computed(() => {
  const name = clientContactName.value.trim();
  if (name) return name;
  return clientName.value.trim() || "the client";
});

const selectedProjectScopeLabel = computed(() => {
  const found = projectScopeOptions.value.find((scope) => scope.id === selectedProjectScopeId.value);
  return found?.name ?? "";
});

const agreementScheduleSummary = computed(() => {
  if (paymentStructure.value === "multiple") {
    return `${milestones.value.length} milestone(s), ${milestoneCompletionPercent.value}% allocated.`;
  }
  if (paymentStructure.value === "recurring") {
    return `${recurringPeriodCountInt.value} payment(s) over ${reviewRecurringDurationLabel.value}, first due ${displayOrDash(startDate.value)}.`;
  }
  return `${reviewPaymentStructureLabel.value}: ${reviewPaymentTimingLabel.value}.`;
});

const agreementAmountSummary = computed(() => {
  if (paymentStructure.value === "single") return reviewProjectAmountLine.value;
  if (paymentStructure.value === "multiple") return reviewMultipleAmountLine.value;
  if (paymentStructure.value === "recurring") {
    return `${reviewRecurringAmountLine.value} per period × ${recurringPeriodCountInt.value} (${reviewRecurringDurationLabel.value})`;
  }
  return `Per ${reviewPaymentStructureLabel.value.toLowerCase()} (amounts to be finalized)`;
});

const projectTypeOptions = [
  "Select project type",
  "Brand photography",
  "Event photography",
  "Product photography",
  "Food photography",
  "Fashion photography",
  "Others",
];
const projectStatusOptions = [
  "Signed",
  "In Progress",
  "Completed",
  "Delayed",
  "in Dispute",
  "Payment Due",
  "Draft",
  "Discussion",
];

const allTags = computed(() => availableTags.value.map((t) => `#${t.name}`));

function normalizeTagText(tag: string): string {
  return String(tag ?? "").trim().replace(/^#/, "");
}

function normalizeTagSlug(value: string): string {
  return normalizeTagText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function findTagByLabel(tag: string): TagOption | undefined {
  const normalized = normalizeTagText(tag).toLowerCase();
  return availableTags.value.find(
    (t) => t.name.toLowerCase() === normalized || t.slug.toLowerCase() === normalized,
  );
}

function addTag(tag: string) {
  const normalizedText = normalizeTagText(tag);
  const normalized = normalizedText ? `#${normalizedText}` : "";
  if (normalized && !selectedTags.value.includes(normalized)) {
    selectedTags.value = [...selectedTags.value, normalized];
  }
  const option = findTagByLabel(tag);
  if (option && !selectedTagIds.value.includes(option.id)) {
    selectedTagIds.value = [...selectedTagIds.value, option.id];
  }
  tagInput.value = "";
}

function removeTag(tag: string) {
  selectedTags.value = selectedTags.value.filter((t) => t !== tag);
  const option = findTagByLabel(tag);
  if (option) {
    selectedTagIds.value = selectedTagIds.value.filter((id) => id !== option.id);
  }
}

async function addCustomTag() {
  if (isSavingTag.value) return;
  const value = tagInput.value.trim();
  if (!value) return;

  const existing = findTagByLabel(value);
  if (existing) {
    addTag(existing.name);
    return;
  }

  const payload = {
    name: normalizeTagText(value),
    slug: normalizeTagSlug(value),
  };
  if (!payload.name || !payload.slug) return;

  isSavingTag.value = true;
  try {
    const response = await createTag(payload);
    const createdRaw = response?.data?.data ?? response?.data ?? {};
    const createdTag: TagOption = {
      id: String(createdRaw.id ?? createdRaw.uuid ?? payload.slug),
      name: String(createdRaw.name ?? payload.name),
      slug: String(createdRaw.slug ?? payload.slug),
    };
    availableTags.value = [createdTag, ...availableTags.value.filter((t) => t.id !== createdTag.id)];
    addTag(createdTag.name);
  } catch (error) {
    console.error("Tag create failed", error);
  } finally {
    isSavingTag.value = false;
    tagInput.value = "";
  }
}

function closeTagPopover() {
  tagsOpen.value = false;
  tagInput.value = "";
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = input.files;
  if (!files?.length) return;
  for (let i = 0; i < files.length; i++) {
    uploadedFiles.value.push({ name: files[i].name, type: files[i].type, file: files[i] });
  }
  input.value = "";
}

function removeFile(index: number) {
  uploadedFiles.value = uploadedFiles.value.filter((_, i) => i !== index);
}

function handleSaveExit() {
  emit("close");
}

function goToReviewEdit() {
  currentStep.value = 1;
}

function scrollAgreementSection(section: "scope" | "timeline" | "payment" | "responsibilities") {
  agreementActiveNav.value = section;
  document.getElementById(`np-a-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function addMilestone() {
  milestones.value.push({
    id: nextMilestoneId.value++,
    percentage: "",
    date: "",
    amount: "",
    deliverables: "",
  });
}

function generateFirstMilestone() {
  if (multipleAmountNumeric.value <= 0) return;
  if (!milestones.value.length) {
    addMilestone();
  }
}

function toNumeric(value: string): number {
  const n = parseFloat(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function formatAmountValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toLocaleString("en-PK", { maximumFractionDigits: 2 });
}

function formatPercentValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function milestoneAmountNumber(milestone: MilestoneItem): number {
  const amount = toNumeric(String(milestone.amount ?? "").replace(/,/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/** Sum of milestone amounts excluding one row — caps allocation so total never exceeds project amount (100%). */
function sumOtherMilestoneAmounts(excludeId: number): number {
  return milestones.value.reduce((sum, m) => {
    if (m.id === excludeId) return sum;
    return sum + milestoneAmountNumber(m);
  }, 0);
}

/** Max percentage this row may use so all milestones stay within 100% of project total. */
function maxPercentForMilestone(excludeId: number): number {
  const projectTotal = multipleAmountNumeric.value;
  if (projectTotal <= 0) return 0;
  const otherAmt = sumOtherMilestoneAmounts(excludeId);
  const remaining = Math.max(0, projectTotal - otherAmt);
  return (remaining / projectTotal) * 100;
}

function onMilestonePercentageInput(milestone: MilestoneItem, rawValue: string) {
  let sanitized = rawValue.replace(/[^\d.]/g, "");
  // keep only first decimal point
  const dotIndex = sanitized.indexOf(".");
  if (dotIndex !== -1) {
    sanitized = sanitized.slice(0, dotIndex + 1) + sanitized.slice(dotIndex + 1).replace(/\./g, "");
  }
  let percent = toNumeric(sanitized);

  const projectTotal = multipleAmountNumeric.value;
  const maxPct = maxPercentForMilestone(milestone.id);
  const cap = Math.max(0, Math.min(100, maxPct));
  if (percent > cap) {
    percent = cap;
    sanitized = cap > 0 ? formatPercentValue(cap) : "";
  }
  milestone.percentage = sanitized;

  if (projectTotal <= 0 || percent <= 0) {
    milestone.amount = "";
    return;
  }

  const amount = (projectTotal * percent) / 100;
  milestone.amount = formatAmountValue(amount);
}

function onMilestonePercentageInputEvent(milestone: MilestoneItem, event: Event) {
  const target = event.target as HTMLInputElement | null;
  if (!target) return;
  onMilestonePercentageInput(milestone, target.value);
  // Ensure the visible value is clamped immediately while typing.
  target.value = milestone.percentage;
}

function onMilestoneAmountInput(milestone: MilestoneItem, rawValue: string) {
  const sanitized = rawValue.replace(/[^\d.,]/g, "");
  const projectTotal = multipleAmountNumeric.value;
  let amount = toNumeric(sanitized);

  const maxAmt = Math.max(0, multipleAmountNumeric.value - sumOtherMilestoneAmounts(milestone.id));

  if (projectTotal <= 0) {
    milestone.amount = sanitized;
    milestone.percentage = "";
    return;
  }

  if (amount > maxAmt) {
    amount = maxAmt;
    milestone.amount = maxAmt > 0 ? formatAmountValue(maxAmt) : "";
  } else {
    milestone.amount = sanitized;
  }

  if (amount <= 0) {
    milestone.percentage = "";
    return;
  }

  const percent = (amount / projectTotal) * 100;
  milestone.percentage = formatPercentValue(percent);
}

function deleteMilestone(milestoneId: number) {
  if (milestones.value.length <= 1) return;
  milestones.value = milestones.value.filter((milestone) => milestone.id !== milestoneId);
}

function mapProjectStatusForApi(status: string): string {
  return String(status ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function mapPaymentScheduleForApi(): string {
  if (paymentTiming.value === "before") return "before_start";
  if (paymentTiming.value === "after") return "after_completion";
  return "specific_date";
}

function toIntegerFlag(value: boolean): string {
  return value ? "1" : "0";
}

function normalizedAmount(amount: string): string {
  const n = parseFloat(String(amount ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? String(n) : "0";
}

function appendCommonProjectPayloadFields(
  form: FormData,
  options: {
    type: "single" | "milestone" | "recurring";
    amount: string;
    financingApplied: boolean;
    currency: string;
    paymentSchedule?: string;
    paymentScheduleDate?: string;
    gstInclusive?: boolean;
  },
) {
  form.append("title", projectName.value.trim());
  form.append("description", scopeDescription.value.trim());
  form.append("status", mapProjectStatusForApi(projectStatus.value));
  form.append("type", options.type);
  form.append("amount", options.amount);
  form.append(
    "gst_inclusive",
    toIntegerFlag(options.gstInclusive ?? taxHandling.value === "including"),
  );
  form.append("financing_applied", toIntegerFlag(options.financingApplied));
  form.append("payment_schedule", options.paymentSchedule ?? "");
  form.append("payment_schedule_date", options.paymentScheduleDate ?? "");
  form.append("currency", options.currency);
  form.append("project_scope_id", selectedProjectScopeId.value.trim());

  for (const tagId of selectedTagIds.value) {
    form.append("tag_ids[]", tagId);
  }
  for (const item of uploadedFiles.value) {
    form.append("images[]", item.file, item.file.name);
  }

  form.append("start_date", startDate.value || "");
  form.append("end_date", endDate.value || "");
  form.append("meta[notes]", scopeDescription.value.trim());

  form.append("client[is_primary]", "1");
  if (createdClientId.value) {
    form.append("client[id]", createdClientId.value);
  }
  form.append("client[role]", clientRole.value.trim() || "Contact");
  form.append("client[type]", clientOrBrand.value === "brand" ? "brand" : "individual");
  form.append("client[status]", "active");
  form.append("client[display_name]", clientContactName.value.trim() || clientName.value.trim());
  form.append("client[brand_name]", clientName.value.trim());
  form.append("client[email]", clientEmail.value.trim());
  form.append("client[phone]", clientMobile.value.trim());
  form.append("client[poc_name]", clientContactName.value.trim());
  form.append("client[poc_email]", clientEmail.value.trim());
  form.append("client[poc_phone]", clientMobile.value.trim());
  form.append("client[meta][notes]", "this is a dummy client note");
}

function logPayloadPreview(form: FormData) {
  const payloadPreview = Array.from(form.entries()).map(([key, value]) => {
    if (value instanceof File) {
      return {
        key,
        type: "file",
        name: value.name,
        size: value.size,
        mime: value.type,
      };
    }
    return { key, type: "text", value };
  });

  console.groupCollapsed("[Project] Create Payload");
  console.table(payloadPreview);
  console.groupEnd();
}

function unwrapProjectFromBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;

  const innerData = o.data;
  if (innerData && typeof innerData === "object" && !Array.isArray(innerData)) {
    const layer = innerData as Record<string, unknown>;
    const nested = layer.data;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
    return layer;
  }

  if (o.project && typeof o.project === "object" && !Array.isArray(o.project)) {
    return o.project as Record<string, unknown>;
  }

  return o;
}

function extractCreatedIds(body: unknown): { projectId: string; clientId: string } {
  const project = unwrapProjectFromBody(body) ?? {};
  const projectAny = project as any;

  const projectId = String(projectAny?.id ?? projectAny?.uuid ?? "").trim();

  const clientCandidate =
    (Array.isArray(projectAny?.clients) ? projectAny.clients?.[0] : null) ??
    projectAny?.client ??
    projectAny?.primary_client ??
    null;
  const clientId =
    clientCandidate && typeof clientCandidate === "object"
      ? String((clientCandidate as any)?.id ?? (clientCandidate as any)?.uuid ?? "").trim()
      : "";

  return { projectId, clientId };
}

function shouldCreateMilestonesNow(): boolean {
  return paymentStructure.value === "multiple" && !!createdProjectId.value && !didCreateMilestones.value;
}

async function createMilestonesSequentially(projectId: string) {
  if (!projectId) return;
  if (!milestones.value.length) return;

  for (const [index, milestone] of milestones.value.entries()) {
    const dueOn = String(milestone.date ?? "").trim();
    const deliverables = String(milestone.deliverables ?? "").trim();
    const amount = normalizedAmount(String(milestone.amount ?? ""));
    const percentage = toNumeric(String(milestone.percentage ?? ""));

    // Title is required by backend (per API payload examples).
    const payload = {
      title: formatMilestoneLabel(index),
      deliverables,
      due_on: dueOn,
      amount,
      percentage,
      sequence: index + 1,
      status: "in_review",
    };

    // Avoid sending completely blank milestones.
    const hasAnyContent = !!deliverables || !!dueOn || toNumeric(amount) > 0 || percentage > 0;
    if (!hasAnyContent) continue;

    await createProjectMilestone(projectId, payload);
  }
}

async function ensureInitialProjectCreated() {
  if (createdProjectId.value || isSavingInitialProject.value) return;

  isSavingInitialProject.value = true;
  try {
    const form = new FormData();

    // Step 1 create: send safe defaults for payment fields and update them later.
    appendCommonProjectPayloadFields(form, {
      type: paymentStructure.value === "multiple" ? "milestone" : paymentStructure.value,
      amount: "0",
      financingApplied: false,
      currency:
        paymentStructure.value === "multiple"
          ? currencyMultiple.value
          : paymentStructure.value === "recurring"
            ? currencyRecurring.value
            : currencySingle.value,
      // Backend requires this field even before payment details step.
      // Use a safe default that does not require a date.
      paymentSchedule: "before_start",
      paymentScheduleDate: "",
    });

    logPayloadPreview(form);
    const response = await createProject(form);
    const { projectId, clientId } = extractCreatedIds(response?.data);

    if (projectId) createdProjectId.value = projectId;
    if (clientId) createdClientId.value = clientId;

    if (!createdProjectId.value) {
      throw new Error("Create project did not return a project id.");
    }
  } finally {
    isSavingInitialProject.value = false;
  }
}

async function submitSingleProject() {
  const form = new FormData();

  appendCommonProjectPayloadFields(form, {
    type: "single",
    amount: normalizedAmount(projectAmountSingle.value),
    financingApplied: financingOptIn.value,
    currency: currencySingle.value,
    paymentSchedule: mapPaymentScheduleForApi(),
    paymentScheduleDate:
      paymentTiming.value === "specific" && paymentSpecificDate.value?.trim() ? paymentSpecificDate.value.trim() : "",
  });

  logPayloadPreview(form);
  const response = createdProjectId.value
    ? await updateProject(createdProjectId.value, form)
    : await createProject(form);
  console.groupCollapsed("[Project] Create Response");
  console.log("Status:", response?.status);
  console.log("Data:", response?.data);
  console.groupEnd();

  const anyData = response?.data as any;
  const serverMsg = anyData?.message ?? anyData?.success_message ?? anyData?.data?.message;
  if (!serverMsg) {
    const title = projectName.value.trim() || "Project";
    pushAlert({ kind: "success", title: "Created", message: `${title} created successfully.` });
  }
}

async function submitMilestoneProject() {
  const form = new FormData();

  appendCommonProjectPayloadFields(form, {
    type: "milestone",
    amount: normalizedAmount(projectAmountMultiple.value),
    financingApplied: financingOptInMultiple.value,
    currency: currencyMultiple.value,
    // Milestone payload shared by API has these keys present, even when empty.
    paymentSchedule: "",
    paymentScheduleDate: "",
  });

  logPayloadPreview(form);
  const response = createdProjectId.value
    ? await updateProject(createdProjectId.value, form)
    : await createProject(form);
  console.groupCollapsed("[Project] Create Response");
  console.log("Status:", response?.status);
  console.log("Data:", response?.data);
  console.groupEnd();

  const { projectId } = extractCreatedIds(response?.data);
  if (projectId && !createdProjectId.value) createdProjectId.value = projectId;

  if (!createdProjectId.value) {
    throw new Error("Create project did not return a project id.");
  }

  if (shouldCreateMilestonesNow()) {
    await createMilestonesSequentially(createdProjectId.value);
    didCreateMilestones.value = true;
  }

  const anyData = response?.data as any;
  const serverMsg = anyData?.message ?? anyData?.success_message ?? anyData?.data?.message;
  if (!serverMsg) {
    const title = projectName.value.trim() || "Project";
    pushAlert({ kind: "success", title: "Created", message: `${title} created successfully.` });
  }
}

async function submitRecurringProject() {
  const form = new FormData();

  appendCommonProjectPayloadFields(form, {
    type: "recurring",
    amount: normalizedAmount(projectAmountRecurring.value),
    financingApplied: financingOptInRecurring.value,
    currency: currencyRecurring.value,
    paymentSchedule: "",
    paymentScheduleDate: "",
    gstInclusive: taxHandlingRecurring.value === "including",
  });

  // Keep these under meta[] to avoid breaking the core API shape.
  form.append("meta[recurring_duration_count]", String(recurringPeriodCountInt.value));
  form.append("meta[recurring_duration_unit]", String(recurringDurationUnit.value));
  form.append("meta[payment_method]", String(paymentMethodRecurring.value));
  form.append("meta[early_payout_agreed]", toIntegerFlag(earlyPayoutAgreedRecurring.value));

  logPayloadPreview(form);
  const response = createdProjectId.value
    ? await updateProject(createdProjectId.value, form)
    : await createProject(form);
  console.groupCollapsed("[Project] Create Response");
  console.log("Status:", response?.status);
  console.log("Data:", response?.data);
  console.groupEnd();

  const anyData = response?.data as any;
  const serverMsg = anyData?.message ?? anyData?.success_message ?? anyData?.data?.message;
  if (!serverMsg) {
    const title = projectName.value.trim() || "Project";
    pushAlert({ kind: "success", title: "Created", message: `${title} created successfully.` });
  }
}

function normalizeTagsFromResponse(raw: any): TagOption[] {
  const list = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  return list
    .map((item: any) => ({
      id: String(item?.id ?? item?.uuid ?? ""),
      name: String(item?.name ?? "").trim(),
      slug: String(item?.slug ?? "").trim(),
    }))
    .filter((item: TagOption) => item.id && item.name);
}

function normalizeProjectScopesFromResponse(raw: any): ProjectScopeOption[] {
  const list = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  return list
    .map((item: any) => ({
      id: String(item?.id ?? item?.uuid ?? ""),
      name: String(item?.name ?? item?.title ?? "").trim(),
    }))
    .filter((item: ProjectScopeOption) => item.id && item.name);
}

async function loadTags() {
  try {
    const response = await getTags();
    availableTags.value = normalizeTagsFromResponse(response?.data);
  } catch (error) {
    console.error("Failed to load tags", error);
    availableTags.value = [];
  }
}

async function loadProjectScopes() {
  try {
    const response = await getProjectScopes();
    const options = normalizeProjectScopesFromResponse(response?.data);
    projectScopeOptions.value = options;
    if (!selectedProjectScopeId.value && options.length > 0) {
      selectedProjectScopeId.value = options[0].id;
    }
  } catch (error) {
    console.error("Failed to load project scopes", error);
    projectScopeOptions.value = [];
  }
}

onMounted(() => {
  loadTags();
  loadProjectScopes();
});

async function handleContinue() {
  if (primaryActionDisabled.value) return;
  if (currentStep.value === 1) {
    try {
      await ensureInitialProjectCreated();
    } catch (error: any) {
      console.groupCollapsed("[Project] Initial Create Error");
      console.error("Status:", error?.response?.status ?? "unknown");
      console.error("Data:", error?.response?.data ?? error);
      console.groupEnd();
      return;
    }
  }
  if (currentStep.value === 6) {
    isCreatingProject.value = true;
    try {
      if (paymentStructure.value === "single") {
        await submitSingleProject();
      } else if (paymentStructure.value === "multiple") {
        await submitMilestoneProject();
      } else if (paymentStructure.value === "recurring") {
        await submitRecurringProject();
      } else {
        console.warn("Project API submit currently implemented for single and milestone only.");
        emit("complete");
        return;
      }
    } catch (error: any) {
      console.groupCollapsed("[Project] Create Error");
      console.error("Status:", error?.response?.status ?? "unknown");
      console.error("Data:", error?.response?.data ?? error);
      console.groupEnd();
      return;
    } finally {
      isCreatingProject.value = false;
    }
    emit("complete");
    return;
  }
  if (currentStep.value === 3 && paymentStructure.value === "single" && !financingOptIn.value) {
    currentStep.value = 5;
    return;
  }
  if (currentStep.value === 3 && paymentStructure.value === "multiple") {
    currentStep.value = financingOptInMultiple.value ? 4 : 5;
    return;
  }
  if (currentStep.value === 3 && paymentStructure.value === "recurring") {
    currentStep.value = financingOptInRecurring.value ? 4 : 5;
    return;
  }
  if (currentStep.value < 6) {
    currentStep.value++;
  }
}
</script>

<template>
  <div class="new-project">
    <!-- Step bar -->
    <div class="new-project-stepbar">
      <div class="new-project-stepbar-track">
        <template v-for="(step, index) in stepBarVisibleSteps" :key="step.key">
          <div
            class="new-project-stepbar-item"
            :class="{
              'new-project-stepbar-item--active': currentStep === step.routeStep,
              'new-project-stepbar-item--done': currentStep > step.routeStep,
            }"
          >
            <span class="new-project-stepbar-number">{{ index + 1 }}</span>
            <span class="new-project-stepbar-label">{{ step.label }}</span>
          </div>
        </template>
      </div>
    </div>

    <!-- Step 1: Project Details -->
    <div v-if="currentStep === 1" class="new-project-form">
      <section class="new-project-section">
        <h3 class="new-project-section-title">Project Details</h3>

        <div class="new-project-fields">
          <div class="new-project-field">
            <Label class="new-project-label">Project Name</Label>
            <Input v-model="projectName" placeholder="Project Name" class="new-project-input" />
          </div>
          <div class="new-project-field">
            <Label class="new-project-label">Type of project</Label>
            <select
              v-model="projectType"
              class="new-project-select"
              aria-label="Project type"
            >
              <option v-for="opt in projectTypeOptions" :key="opt" :value="opt === 'Select project type' ? '' : opt" :disabled="opt === 'Select project type'">
                {{ opt }}
              </option>
            </select>
          </div>
          <div class="new-project-field">
            <Label class="new-project-label">Client</Label>
            <Input v-model="clientName" placeholder="Client or Brand Name" class="new-project-input" />
          </div>
          <div class="new-project-field">
            <Label class="new-project-label">Is this a client or brand?</Label>
            <div class="new-project-toggle">
              <button
                type="button"
                class="new-project-toggle-btn"
                :class="{ 'new-project-toggle-btn--active': clientOrBrand === 'brand' }"
                @click="clientOrBrand = 'brand'"
              >
                Brand
              </button>
              <button
                type="button"
                class="new-project-toggle-btn"
                :class="{ 'new-project-toggle-btn--active': clientOrBrand === 'individual' }"
                @click="clientOrBrand = 'individual'"
              >
                Individual Client
              </button>
            </div>
          </div>
          <div class="new-project-row new-project-row--three">
            <div class="new-project-field">
              <Label class="new-project-label">Project status</Label>
              <select
                v-model="projectStatus"
                class="new-project-select"
                aria-label="Project status"
              >
                <option v-for="opt in projectStatusOptions" :key="opt" :value="opt">
                  {{ opt }}
                </option>
              </select>
            </div>
            <div class="new-project-field">
              <Label class="new-project-label">Starting date</Label>
              <DateSelect v-model="startDate" placeholder="DD/MM/YYYY" display-format="mon d, yyyy" />
            </div>
            <div class="new-project-field">
              <Label class="new-project-label">Ending Date</Label>
              <DateSelect v-model="endDate" placeholder="DD/MM/YYYY" display-format="mon d, yyyy" />
            </div>
          </div>
          <div class="new-project-field">
            <Label class="new-project-label">Project scope</Label>
            <select
              v-model="selectedProjectScopeId"
              class="new-project-select"
              aria-label="Project scope"
            >
              <option value="" disabled>Select project scope</option>
              <option
                v-for="scope in projectScopeOptions"
                :key="scope.id"
                :value="scope.id"
              >
                {{ scope.name }}
              </option>
            </select>
          </div>
          <div class="new-project-field new-project-field--full">
            <Label class="new-project-label">Describe the scope of the project</Label>
            <textarea
              v-model="scopeDescription"
              class="new-project-textarea"
              placeholder="Describe your project Details"
              rows="4"
            />
          </div>
        </div>

        <!-- File upload -->
        <div class="new-project-upload-area">
          <label class="new-project-upload-label">
            <input
              type="file"
              multiple
              class="new-project-upload-input"
              accept=".pdf,.png,.jpg,.jpeg"
              @change="onFileChange"
            />
            <span class="new-project-upload-box">
              <svg class="new-project-upload-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span class="new-project-upload-text">Click to select files or drag to upload</span>
              <span class="new-project-upload-hint">Up to 100 files, max file size 5MB</span>
            </span>
          </label>
          <div v-if="uploadedFiles.length" class="new-project-files">
            <div
              v-for="(file, i) in uploadedFiles"
              :key="i"
              class="new-project-file-card"
            >
              <span class="new-project-file-icon">{{ file.type.includes("pdf") ? "📄" : "🖼" }}</span>
              <span class="new-project-file-name">{{ file.name }}</span>
              <button
                type="button"
                class="new-project-file-remove"
                aria-label="Remove file"
                @click="removeFile(i)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Tags -->
        <div class="new-project-tags">
          <Label class="new-project-label">Tags</Label>
          <div class="new-project-tags-selected">
            <span
              v-for="tag in selectedTags"
              :key="tag"
              class="new-project-tag"
            >
              {{ tag }}
              <button type="button" class="new-project-tag-remove" @click="removeTag(tag)">×</button>
            </span>
            <div class="new-project-tag-popover-wrap">
              <button
                type="button"
                class="new-project-tag-add"
                :class="{ 'new-project-tag-add--open': tagsOpen }"
                aria-haspopup="true"
                :aria-expanded="tagsOpen"
                @click="tagsOpen = !tagsOpen"
              >
                <span class="new-project-tag-add-icon">+</span> Add
              </button>
              <Teleport to="body">
                <Transition name="tag-popover">
                  <div
                    v-if="tagsOpen"
                    class="new-project-tag-popover-backdrop"
                    aria-hidden="true"
                    @click="closeTagPopover"
                  />
                </Transition>
              </Teleport>
              <Transition name="tag-popover">
                <div
                  v-if="tagsOpen"
                  class="new-project-tag-popover"
                  role="dialog"
                  aria-label="Add tag"
                  @pointerdown.stop
                >
                  <div class="new-project-tags-custom">
                    <input
                      v-model="tagInput"
                      type="text"
                      placeholder="Add Custom tag..."
                      class="new-project-input new-project-tag-input"
                      @keydown.enter.prevent="addCustomTag"
                    />
                  </div>
                  <div class="new-project-tags-list-label">All tags</div>
                  <div class="new-project-tag-options">
                    <button
                      v-for="tag in allTags"
                      :key="tag"
                      type="button"
                      class="new-project-tag-option"
                      @click="addTag(tag)"
                    >
                      {{ tag }}
                    </button>
                  </div>
                </div>
              </Transition>
            </div>
          </div>
        </div>
      </section>

      <!-- Client Details -->
      <section class="new-project-section">
        <h3 class="new-project-section-title">Client Details</h3>
        <div class="new-project-fields new-project-fields--grid">
          <div class="new-project-field">
            <Label class="new-project-label">Name</Label>
            <Input v-model="clientContactName" placeholder="Contact person name" class="new-project-input" />
          </div>
          <div class="new-project-field">
            <Label class="new-project-label">Role</Label>
            <Input v-model="clientRole" placeholder="e.g. Project manager, creative Director" class="new-project-input" />
          </div>
          <div class="new-project-field">
            <Label class="new-project-label">Email</Label>
            <Input v-model="clientEmail" placeholder="Contact@company.com" class="new-project-input" />
          </div>
          <div class="new-project-field">
            <Label class="new-project-label">Mobile Number</Label>
            <Input v-model="clientMobile" placeholder="+92" class="new-project-input" />
          </div>
        </div>
      </section>
    </div>

    <!-- Step 2: Payment Structure -->
    <div v-else-if="currentStep === 2" class="new-project-form">
      <section class="new-project-step2">
        <h2 id="np-payment-structure-heading" class="new-project-step2-heading">How do you want to be paid?</h2>
        <div
          class="new-project-step2-cards"
          role="radiogroup"
          aria-labelledby="np-payment-structure-heading"
        >
          <label
            class="new-project-payment-card"
            :class="{ 'new-project-payment-card--selected': paymentStructure === 'single' }"
          >
            <input
              v-model="paymentStructure"
              type="radio"
              value="single"
              name="payment-structure"
              class="new-project-payment-card-input"
            />
            <span class="new-project-payment-card-icon new-project-payment-card-icon--single">
              <img src="@/assets/icons/Single payment.png" alt="" class="new-project-payment-card-icon-image" />
            </span>
            <span class="new-project-payment-card-title">Single payment</span>
            <span class="new-project-payment-card-desc">Receive payment in a single transaction, before or after delivery.</span>
            <span class="new-project-payment-card-footer">Best for quick projects, small jobs, or trusted clients</span>
          </label>
          <label
            class="new-project-payment-card"
            :class="{ 'new-project-payment-card--selected': paymentStructure === 'multiple' }"
          >
            <input
              v-model="paymentStructure"
              type="radio"
              value="multiple"
              name="payment-structure"
              class="new-project-payment-card-input"
            />
            <span class="new-project-payment-card-icon new-project-payment-card-icon--multiple">
              <img src="@/assets/icons/Workflow-Milestones--Streamline-Ultimate.png" alt="" class="new-project-payment-card-icon-image" />
            </span>
            <span class="new-project-payment-card-title">Multiple Payments</span>
            <span class="new-project-payment-card-desc">Split payment into milestones tied to project phases.</span>
            <span class="new-project-payment-card-footer">Best for larger, complex deliverables or new clients</span>
          </label>
          <label
            class="new-project-payment-card"
            :class="{ 'new-project-payment-card--selected': paymentStructure === 'recurring' }"
          >
            <input
              v-model="paymentStructure"
              type="radio"
              value="recurring"
              name="payment-structure"
              class="new-project-payment-card-input"
            />
            <span class="new-project-payment-card-icon new-project-payment-card-icon--recurring">
              <img src="@/assets/icons/loop.png" alt="" class="new-project-payment-card-icon-image" />
            </span>
            <span class="new-project-payment-card-title">Recurring payments</span>
            <span class="new-project-payment-card-desc">Regular fixed payments on a scheduled basis.</span>
            <span class="new-project-payment-card-footer">Best for retainers, ongoing or long term clients</span>
          </label>
        </div>
      </section>
    </div>

    <!-- Step 3: Payment Details (single payment only) -->
    <div v-else-if="currentStep === 3 && paymentStructure === 'single'" class="new-project-form">
      <section class="new-project-section">
        <h3 class="new-project-section-title">How do you want to be paid?</h3>
        <div class="new-project-field">
          <Label class="new-project-label">Project Amount</Label>
          <div class="new-project-amount-row">
            <Input v-model="projectAmountSingle" class="new-project-input new-project-amount-input" placeholder="0" />
            <select v-model="currencySingle" class="new-project-select new-project-currency-select" aria-label="Currency">
              <option v-for="c in currencyOptions" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
        </div>
        <div class="new-project-field">
          <Label class="new-project-label">Tax Handling</Label>
          <div class="new-project-radio-stack">
            <label class="new-project-radio-card" :class="{ 'new-project-radio-card--checked': taxHandling === 'including' }">
              <input v-model="taxHandling" type="radio" value="including" class="new-project-radio-input" />
              <span class="new-project-radio-body">
                <span class="new-project-radio-title">Including GST</span>
                <span class="new-project-radio-hint">All the taxes are included in your total fee.</span>
              </span>
            </label>
            <div v-if="taxHandling === 'including' && estimatedGstPkr" class="new-project-gst-notice">
              <span class="new-project-gst-notice-main">Estimated GST: {{ currencySingle }} {{ estimatedGstPkr }}</span>
              <span class="new-project-gst-notice-sub">Based on the amount entered.</span>
            </div>
            <label class="new-project-radio-card" :class="{ 'new-project-radio-card--checked': taxHandling === 'exclusive' }">
              <input v-model="taxHandling" type="radio" value="exclusive" class="new-project-radio-input" />
              <span class="new-project-radio-body">
                <span class="new-project-radio-title">Exclusive of GST</span>
                <span class="new-project-radio-hint">Taxes will be added on top of your total fee.</span>
              </span>
            </label>
          </div>
        </div>
        <div class="new-project-field">
          <Label class="new-project-label">Choose Payment Method</Label>
          <select v-model="paymentMethodSingle" class="new-project-select" aria-label="Payment method">
            <option v-for="m in paymentMethodOptions" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>
      </section>

      <section class="new-project-section">
        <h3 class="new-project-section-title">When do you want to be paid?</h3>
        <div class="new-project-radio-stack">
          <label class="new-project-radio-card" :class="{ 'new-project-radio-card--checked': paymentTiming === 'before' }">
            <input v-model="paymentTiming" type="radio" value="before" class="new-project-radio-input" />
            <span class="new-project-radio-body">
              <span class="new-project-radio-title">Before Starting the project</span>
              <span class="new-project-radio-hint">Get paid upfront before you begin any work.</span>
            </span>
          </label>
          <label class="new-project-radio-card" :class="{ 'new-project-radio-card--checked': paymentTiming === 'after' }">
            <input v-model="paymentTiming" type="radio" value="after" class="new-project-radio-input" />
            <span class="new-project-radio-body">
              <span class="new-project-radio-title">After completing the project</span>
              <span class="new-project-radio-hint">Get paid when work is approved and delivered.</span>
            </span>
          </label>
          <label class="new-project-radio-card" :class="{ 'new-project-radio-card--checked': paymentTiming === 'specific' }">
            <input v-model="paymentTiming" type="radio" value="specific" class="new-project-radio-input" />
            <span class="new-project-radio-body">
              <span class="new-project-radio-title">On a specific date</span>
              <span class="new-project-radio-hint">Choose a custom date for payment.</span>
            </span>
          </label>
          <div v-if="paymentTiming === 'specific'" class="new-project-date-field">
            <DateSelect v-model="paymentSpecificDate" placeholder="DD/MM/YYYY" display-format="dd/mm/yyyy" />
          </div>
        </div>
      </section>

      <section class="new-project-section">
        <h3 class="new-project-section-title">Financing</h3>
        <p class="new-project-financing-copy">
          You are eligible for advanced financing of PKR {{ financingEligiblePkr }}. Subject to approval, you can get this in your Create wallet within 24 hours.
        </p>
        <div class="new-project-financing-yesno">
          <label class="new-project-yesno" :class="{ 'new-project-yesno--active': financingOptIn }">
            <input v-model="financingOptIn" type="radio" :value="true" class="new-project-radio-input" />
            Yes
          </label>
          <label class="new-project-yesno" :class="{ 'new-project-yesno--active': !financingOptIn }">
            <input v-model="financingOptIn" type="radio" :value="false" class="new-project-radio-input" />
            No
          </label>
        </div>
      </section>
    </div>

    <div v-else-if="currentStep === 3 && paymentStructure === 'multiple'" class="new-project-form">
      <section class="new-project-section">
        <h3 class="new-project-section-title">How do you want to be paid?</h3>
        <div class="new-project-field">
          <Label class="new-project-label">Project Amount</Label>
          <div class="new-project-amount-row">
            <Input v-model="projectAmountMultiple" class="new-project-input new-project-amount-input" placeholder="0" />
            <select v-model="currencyMultiple" class="new-project-select new-project-currency-select" aria-label="Currency">
              <option v-for="c in currencyOptions" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
        </div>
        <div class="new-project-field">
          <Label class="new-project-label">Tax Handling</Label>
          <div class="new-project-radio-stack">
            <label class="new-project-radio-card" :class="{ 'new-project-radio-card--checked': taxHandlingMultiple === 'including' }">
              <input v-model="taxHandlingMultiple" type="radio" value="including" class="new-project-radio-input" />
              <span class="new-project-radio-body">
                <span class="new-project-radio-title">Including GST</span>
                <span class="new-project-radio-hint">All the taxes are included in your total fee.</span>
              </span>
            </label>
            <div v-if="taxHandlingMultiple === 'including' && estimatedGstMultiple" class="new-project-gst-notice">
              <span class="new-project-gst-notice-main">Estimated GST: {{ currencyMultiple }} {{ estimatedGstMultiple }}</span>
              <span class="new-project-gst-notice-sub">Based on the amount entered.</span>
            </div>
            <label class="new-project-radio-card" :class="{ 'new-project-radio-card--checked': taxHandlingMultiple === 'exclusive' }">
              <input v-model="taxHandlingMultiple" type="radio" value="exclusive" class="new-project-radio-input" />
              <span class="new-project-radio-body">
                <span class="new-project-radio-title">Exclusive of GST</span>
                <span class="new-project-radio-hint">Taxes will be added on top of your total fee.</span>
              </span>
            </label>
          </div>
        </div>
        <div class="new-project-field">
          <Label class="new-project-label">Choose Payment Method</Label>
          <select v-model="paymentMethodMultiple" class="new-project-select" aria-label="Payment method">
            <option v-for="m in paymentMethodOptions" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>
      </section>

      <section class="new-project-section">
        <h3 class="new-project-section-title">Add your payment milestones</h3>
        <div class="new-project-milestone-summary">
          <div class="new-project-milestone-summary-item">
            <span class="new-project-milestone-summary-k">total allocated</span>
            <span class="new-project-milestone-summary-v">{{ currencyMultiple }} {{ projectAmountMultiple || '0' }}</span>
          </div>
          <div class="new-project-milestone-summary-item">
            <span class="new-project-milestone-summary-k">Remaining amount</span>
            <span class="new-project-milestone-summary-v">{{ currencyMultiple }} {{ milestoneRemainingNumeric.toLocaleString('en-PK') }}</span>
          </div>
          <div class="new-project-milestone-summary-item">
            <span class="new-project-milestone-summary-k">Completed</span>
            <span class="new-project-milestone-summary-v new-project-milestone-summary-v--success">{{ milestoneCompletionPercent }}%</span>
          </div>
        </div>
      </section>

      <section
        v-if="milestones.length"
        v-for="(milestone, index) in milestones"
        :key="milestone.id"
        class="new-project-section new-project-milestone-card"
      >
        <div class="new-project-milestone-head">
          <span class="new-project-milestone-title">#{{ index + 1 }} Milestone</span>
          <button
            v-if="milestones.length > 1"
            type="button"
            class="new-project-milestone-delete"
            @click="deleteMilestone(milestone.id)"
          >
            Delete
          </button>
        </div>
        <div class="new-project-milestone-grid">
          <div class="new-project-field">
            <Label class="new-project-label">Percentage</Label>
            <input
              :value="milestone.percentage"
              type="text"
              class="new-project-input"
              placeholder="% 50"
              inputmode="decimal"
              @input="(event) => onMilestonePercentageInputEvent(milestone, event)"
            />
          </div>
          <div class="new-project-field">
            <Label class="new-project-label">Date</Label>
            <DateSelect v-model="milestone.date" placeholder="DD/MM/YYYY" display-format="dd/mm/yyyy" />
          </div>
          <div class="new-project-field">
            <Label class="new-project-label">Amount</Label>
            <Input
              :model-value="milestone.amount"
              class="new-project-input"
              :placeholder="`${currencyMultiple} 0`"
              @update:model-value="(value) => onMilestoneAmountInput(milestone, String(value ?? ''))"
            />
          </div>
        </div>
        <div class="new-project-field">
          <Label class="new-project-label">Deliverables</Label>
          <textarea
            v-model="milestone.deliverables"
            class="new-project-input new-project-milestone-deliverables"
            placeholder="Describe the deliverables for this milestone"
          ></textarea>
        </div>
      </section>

      <div class="new-project-milestone-add-wrap">
        <button
          v-if="!milestones.length"
          type="button"
          class="new-project-milestone-add"
          :disabled="multipleAmountNumeric <= 0"
          @click="generateFirstMilestone"
        >
          Generate first milestone
        </button>
        <button
          v-else
          type="button"
          class="new-project-milestone-add"
          @click="addMilestone"
        >
          Add another milestone
        </button>
      </div>

      <section class="new-project-section">
        <h3 class="new-project-section-title">Financing</h3>
        <p class="new-project-financing-copy">
          You are eligible for advanced financing of PKR {{ financingEligiblePkrForMultiple }}. Subject to approval, you can get this in your Create wallet within 24 hours.
        </p>
        <div class="new-project-financing-yesno">
          <label class="new-project-yesno" :class="{ 'new-project-yesno--active': financingOptInMultiple }">
            <input v-model="financingOptInMultiple" type="radio" :value="true" class="new-project-radio-input" />
            Yes
          </label>
          <label class="new-project-yesno" :class="{ 'new-project-yesno--active': !financingOptInMultiple }">
            <input v-model="financingOptInMultiple" type="radio" :value="false" class="new-project-radio-input" />
            No
          </label>
        </div>
      </section>
    </div>

    <!-- Step 3: Payment Details (recurring) -->
    <div v-else-if="currentStep === 3 && paymentStructure === 'recurring'" class="new-project-form">
      <section class="new-project-section">
        <h3 class="new-project-section-title">How do you want to be paid?</h3>
        <div class="new-project-field">
          <Label class="new-project-label">Project Amount</Label>
          <div class="new-project-amount-row">
            <Input v-model="projectAmountRecurring" class="new-project-input new-project-amount-input" placeholder="0" />
            <select v-model="currencyRecurring" class="new-project-select new-project-currency-select" aria-label="Currency">
              <option v-for="c in currencyOptions" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
        </div>
        <div class="new-project-field">
          <Label class="new-project-label">Tax Handling</Label>
          <div class="new-project-radio-stack">
            <label class="new-project-radio-card" :class="{ 'new-project-radio-card--checked': taxHandlingRecurring === 'including' }">
              <input v-model="taxHandlingRecurring" type="radio" value="including" class="new-project-radio-input" />
              <span class="new-project-radio-body">
                <span class="new-project-radio-title">Including GST</span>
                <span class="new-project-radio-hint">All the taxes are included in your total fee.</span>
              </span>
            </label>
            <div v-if="taxHandlingRecurring === 'including' && estimatedGstRecurring" class="new-project-gst-notice">
              <span class="new-project-gst-notice-main">Estimated GST: {{ currencyRecurring }} {{ estimatedGstRecurring }}</span>
              <span class="new-project-gst-notice-sub">Based on the amount entered.</span>
            </div>
            <label class="new-project-radio-card" :class="{ 'new-project-radio-card--checked': taxHandlingRecurring === 'exclusive' }">
              <input v-model="taxHandlingRecurring" type="radio" value="exclusive" class="new-project-radio-input" />
              <span class="new-project-radio-body">
                <span class="new-project-radio-title">Exclusive of GST</span>
                <span class="new-project-radio-hint">Taxes will be added on top of your total fee.</span>
              </span>
            </label>
          </div>
        </div>
        <div class="new-project-field">
          <Label class="new-project-label">Choose Payment Method</Label>
          <select v-model="paymentMethodRecurring" class="new-project-select" aria-label="Payment method">
            <option v-for="m in paymentMethodOptions" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>
      </section>

      <section class="new-project-section">
        <h3 class="new-project-section-title">Payment schedules</h3>
        <div class="new-project-field">
          <Label class="new-project-label">Project Duration</Label>
          <div class="new-project-duration-row">
            <Input
              v-model.number="recurringDurationCount"
              type="number"
              min="1"
              step="1"
              class="new-project-input new-project-duration-input"
              placeholder="0"
            />
            <div class="new-project-duration-units" role="group" aria-label="Duration unit">
              <button
                type="button"
                class="new-project-duration-unit"
                :class="{ 'new-project-duration-unit--active': recurringDurationUnit === 'weeks' }"
                @click="recurringDurationUnit = 'weeks'"
              >
                Weeks
              </button>
              <button
                type="button"
                class="new-project-duration-unit"
                :class="{ 'new-project-duration-unit--active': recurringDurationUnit === 'months' }"
                @click="recurringDurationUnit = 'months'"
              >
                Months
              </button>
              <button
                type="button"
                class="new-project-duration-unit"
                :class="{ 'new-project-duration-unit--active': recurringDurationUnit === 'quarters' }"
                @click="recurringDurationUnit = 'quarters'"
              >
                Quarters
              </button>
            </div>
          </div>
          <p class="new-project-duration-hint">Due dates use your project start date; each payment is spaced by one {{ recurringDurationUnit.slice(0, -1) }}.</p>
        </div>

        <div class="new-project-field new-project-field--full">
          <Label class="new-project-label">Payment Schedule Preview</Label>
          <div v-if="recurringSchedulePreview.length" class="new-project-schedule-preview">
            <div
              v-for="row in recurringSchedulePreview"
              :key="row.index"
              class="new-project-schedule-row"
            >
              <div class="new-project-schedule-main">
                <span class="new-project-schedule-title">#{{ row.index }} Payment</span>
                <span class="new-project-schedule-due">Due on {{ row.dueLabel }}</span>
              </div>
              <span class="new-project-schedule-amount">{{ row.amountLine }}</span>
            </div>
          </div>
          <p v-else class="new-project-schedule-empty">Enter an amount and duration to see scheduled payments.</p>
        </div>
      </section>

      <section class="new-project-section">
        <h3 class="new-project-section-title">Financing</h3>
        <p class="new-project-financing-copy">
          You are eligible for advanced financing of PKR {{ financingEligiblePkrForRecurring }}. Subject to approval, you can get this in your Create wallet within 24 hours.
        </p>
        <div class="new-project-financing-yesno">
          <label class="new-project-yesno" :class="{ 'new-project-yesno--active': financingOptInRecurring }">
            <input v-model="financingOptInRecurring" type="radio" :value="true" class="new-project-radio-input" />
            Yes
          </label>
          <label class="new-project-yesno" :class="{ 'new-project-yesno--active': !financingOptInRecurring }">
            <input v-model="financingOptInRecurring" type="radio" :value="false" class="new-project-radio-input" />
            No
          </label>
        </div>
      </section>
    </div>

    <!-- Step 4: Early Payout (single payment + financing only) -->
    <div v-else-if="currentStep === 4 && paymentStructure === 'single'" class="new-project-form">
      <div class="new-project-early-payout-intro">
        <h2 class="new-project-early-payout-title">Financing with Create</h2>
        <p class="new-project-early-payout-sub">
          Get your payment in advance instead of waiting for your client to pay.
        </p>
      </div>
      <section class="new-project-section">
        <h3 class="new-project-section-title">Here's how it works</h3>
        <p class="new-project-financing-copy">
          We apply a 2.5% financing fee, which will be deducted from your total project amount.
        </p>
        <div class="new-project-early-payout-summary">
          <div class="new-project-early-payout-row">
            <span class="new-project-early-payout-label">Total project value</span>
            <span class="new-project-early-payout-value">PKR {{ earlyPayoutTotalPkr }}</span>
          </div>
          <div class="new-project-early-payout-row">
            <span class="new-project-early-payout-label">Company receives</span>
            <span class="new-project-early-payout-value">PKR {{ earlyPayoutFeePkr }}</span>
          </div>
          <div class="new-project-early-payout-row new-project-early-payout-row--highlight">
            <span class="new-project-early-payout-label">You received</span>
            <span class="new-project-early-payout-value">PKR {{ earlyPayoutYouReceivePkr }}</span>
          </div>
        </div>
      </section>
      <section class="new-project-section">
        <label class="new-project-agree-label">
          <input v-model="earlyPayoutAgreed" type="checkbox" class="new-project-agree-checkbox" />
          <span class="new-project-agree-text">
            <strong class="new-project-agree-title">I Agree</strong>
            <span class="new-project-agree-desc">
              I have read and understand the financial implications of financing my fees through Create.
            </span>
          </span>
        </label>
      </section>
    </div>

    <!-- Step 4: Early Payout (multiple payments + financing only) -->
    <div v-else-if="currentStep === 4 && paymentStructure === 'multiple'" class="new-project-form">
      <div class="new-project-early-payout-intro">
        <h2 class="new-project-early-payout-title">Financing with Create</h2>
        <p class="new-project-early-payout-sub">
          Get your milestone payment in advance instead of waiting for your client to pay.
        </p>
      </div>
      <section class="new-project-section">
        <h3 class="new-project-section-title">Here's how it works</h3>
        <p class="new-project-financing-copy">
          We apply a 2.5% financing fee, which will be deducted from your financed amount.
        </p>
        <div class="new-project-early-payout-summary">
          <div class="new-project-early-payout-row">
            <span class="new-project-early-payout-label">Total financed value</span>
            <span class="new-project-early-payout-value">PKR {{ earlyPayoutTotalPkrMultiple }}</span>
          </div>
          <div class="new-project-early-payout-row">
            <span class="new-project-early-payout-label">Company receives</span>
            <span class="new-project-early-payout-value">PKR {{ earlyPayoutFeePkrMultiple }}</span>
          </div>
          <div class="new-project-early-payout-row new-project-early-payout-row--highlight">
            <span class="new-project-early-payout-label">You received</span>
            <span class="new-project-early-payout-value">PKR {{ earlyPayoutYouReceivePkrMultiple }}</span>
          </div>
        </div>
      </section>
      <section class="new-project-section">
        <label class="new-project-agree-label">
          <input v-model="earlyPayoutAgreedMultiple" type="checkbox" class="new-project-agree-checkbox" />
          <span class="new-project-agree-text">
            <strong class="new-project-agree-title">I Agree</strong>
            <span class="new-project-agree-desc">
              I have read and understand the financial implications of financing my fees through Create.
            </span>
          </span>
        </label>
      </section>
    </div>

    <!-- Step 4: Early Payout (recurring + financing only) -->
    <div v-else-if="currentStep === 4 && paymentStructure === 'recurring'" class="new-project-form">
      <div class="new-project-early-payout-intro">
        <h2 class="new-project-early-payout-title">Financing with Create</h2>
        <p class="new-project-early-payout-sub">
          Get your recurring payments in advance instead of waiting for your client to pay.
        </p>
      </div>
      <section class="new-project-section">
        <h3 class="new-project-section-title">Here's how it works</h3>
        <p class="new-project-financing-copy">
          We apply a 2.5% financing fee, which will be deducted from your total contract value (all scheduled payments).
        </p>
        <div class="new-project-early-payout-summary">
          <div class="new-project-early-payout-row">
            <span class="new-project-early-payout-label">Total contract value</span>
            <span class="new-project-early-payout-value">{{ currencyRecurring }} {{ earlyPayoutTotalPkrRecurring }}</span>
          </div>
          <div class="new-project-early-payout-row">
            <span class="new-project-early-payout-label">Company receives</span>
            <span class="new-project-early-payout-value">{{ currencyRecurring }} {{ earlyPayoutFeePkrRecurring }}</span>
          </div>
          <div class="new-project-early-payout-row new-project-early-payout-row--highlight">
            <span class="new-project-early-payout-label">You received</span>
            <span class="new-project-early-payout-value">{{ currencyRecurring }} {{ earlyPayoutYouReceivePkrRecurring }}</span>
          </div>
        </div>
      </section>
      <section class="new-project-section">
        <label class="new-project-agree-label">
          <input v-model="earlyPayoutAgreedRecurring" type="checkbox" class="new-project-agree-checkbox" />
          <span class="new-project-agree-text">
            <strong class="new-project-agree-title">I Agree</strong>
            <span class="new-project-agree-desc">
              I have read and understand the financial implications of financing my fees through Create.
            </span>
          </span>
        </label>
      </section>
    </div>

    <!-- Step 5: Review -->
    <div v-else-if="currentStep === 5" class="new-project-form new-project-review">
      <header class="new-project-review-header">
        <h2 class="new-project-review-title">Review Details</h2>
        <button
          type="button"
          class="new-project-review-edit"
          aria-label="Edit from project details"
          @click="goToReviewEdit"
        >
          <span class="new-project-review-edit-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </span>
        </button>
      </header>

      <section class="new-project-review-section">
        <button
          type="button"
          class="new-project-review-section-head"
          :aria-expanded="reviewSectionOpen.project"
          @click="reviewSectionOpen.project = !reviewSectionOpen.project"
        >
          <span class="new-project-review-section-title">Project Details</span>
          <span
            class="new-project-review-chevron"
            :class="{ 'new-project-review-chevron--open': reviewSectionOpen.project }"
            aria-hidden="true"
          >▲</span>
        </button>
        <div v-show="reviewSectionOpen.project" class="new-project-review-body">
          <div class="new-project-review-kv">
            <span class="new-project-review-k">Name</span>
            <span class="new-project-review-v">{{ displayOrDash(projectName) }}</span>
          </div>
          <div class="new-project-review-kv">
            <span class="new-project-review-k">Type</span>
            <span class="new-project-review-v">{{ displayOrDash(projectType) }}</span>
          </div>
          <div class="new-project-review-kv">
            <span class="new-project-review-k">Client</span>
            <span class="new-project-review-v">{{ displayOrDash(clientName) }}</span>
          </div>
          <div class="new-project-review-kv">
            <span class="new-project-review-k">Client or brand</span>
            <span class="new-project-review-v">{{ clientOrBrand === 'brand' ? 'Brand' : 'Individual client' }}</span>
          </div>
          <div class="new-project-review-kv">
            <span class="new-project-review-k">Starting</span>
            <span class="new-project-review-v">{{ displayOrDash(startDate) }}</span>
          </div>
          <div class="new-project-review-kv">
            <span class="new-project-review-k">End</span>
            <span class="new-project-review-v">{{ displayOrDash(endDate) }}</span>
          </div>
          <div class="new-project-review-kv">
            <span class="new-project-review-k">Status</span>
            <span class="new-project-review-v">{{ displayOrDash(projectStatus) }}</span>
          </div>
          <div class="new-project-review-kv">
            <span class="new-project-review-k">Project scope</span>
            <span class="new-project-review-v new-project-review-v--multiline">{{ displayOrDash(selectedProjectScopeLabel) }}</span>
          </div>
          <div v-if="selectedTags.length" class="new-project-review-kv">
            <span class="new-project-review-k">Tags</span>
            <span class="new-project-review-v">{{ selectedTags.join(', ') }}</span>
          </div>
          <div v-if="uploadedFiles.length" class="new-project-review-kv">
            <span class="new-project-review-k">Attachments</span>
            <span class="new-project-review-v">{{ uploadedFiles.map((f) => f.name).join(', ') }}</span>
          </div>
        </div>
      </section>

      <section class="new-project-review-section">
        <button
          type="button"
          class="new-project-review-section-head"
          :aria-expanded="reviewSectionOpen.client"
          @click="reviewSectionOpen.client = !reviewSectionOpen.client"
        >
          <span class="new-project-review-section-title">Client Details</span>
          <span
            class="new-project-review-chevron"
            :class="{ 'new-project-review-chevron--open': reviewSectionOpen.client }"
            aria-hidden="true"
          >▲</span>
        </button>
        <div v-show="reviewSectionOpen.client" class="new-project-review-body">
          <div class="new-project-review-kv">
            <span class="new-project-review-k">Name</span>
            <span class="new-project-review-v">{{ displayOrDash(clientContactName) }}</span>
          </div>
          <div class="new-project-review-kv">
            <span class="new-project-review-k">Company</span>
            <span class="new-project-review-v">{{ displayOrDash(clientName) }}</span>
          </div>
          <div class="new-project-review-kv">
            <span class="new-project-review-k">Role</span>
            <span class="new-project-review-v">{{ displayOrDash(clientRole) }}</span>
          </div>
          <div class="new-project-review-kv">
            <span class="new-project-review-k">Email</span>
            <span class="new-project-review-v">{{ displayOrDash(clientEmail) }}</span>
          </div>
          <div class="new-project-review-kv">
            <span class="new-project-review-k">Phone</span>
            <span class="new-project-review-v">{{ displayOrDash(clientMobile) }}</span>
          </div>
        </div>
      </section>

      <section class="new-project-review-section">
        <button
          type="button"
          class="new-project-review-section-head"
          :aria-expanded="reviewSectionOpen.payment"
          @click="reviewSectionOpen.payment = !reviewSectionOpen.payment"
        >
          <span class="new-project-review-section-title">Payment Details</span>
          <span
            class="new-project-review-chevron"
            :class="{ 'new-project-review-chevron--open': reviewSectionOpen.payment }"
            aria-hidden="true"
          >▲</span>
        </button>
        <div v-show="reviewSectionOpen.payment" class="new-project-review-body">
          <template v-if="paymentStructure === 'single'">
            <div class="new-project-review-kv">
              <span class="new-project-review-k">Project amount</span>
              <span class="new-project-review-v">{{ reviewProjectAmountLine }}</span>
            </div>
            <div class="new-project-review-kv">
              <span class="new-project-review-k">Tax</span>
              <span class="new-project-review-v">{{ reviewTaxSummaryLabel }}</span>
            </div>
            <div class="new-project-review-kv">
              <span class="new-project-review-k">Tax amount</span>
              <span class="new-project-review-v">{{ reviewTaxAmountLine }}</span>
            </div>
            <div class="new-project-review-kv">
              <span class="new-project-review-k">Payment method</span>
              <span class="new-project-review-v">{{ displayOrDash(paymentMethodSingle) }}</span>
            </div>
            <div class="new-project-review-kv">
              <span class="new-project-review-k">Payment structure</span>
              <span class="new-project-review-v">{{ reviewPaymentStructureLabel }}</span>
            </div>
            <div class="new-project-review-kv">
              <span class="new-project-review-k">Paid</span>
              <span class="new-project-review-v">{{ reviewPaymentTimingLabel }}</span>
            </div>
          </template>
          <template v-else-if="paymentStructure === 'multiple'">
            <div class="new-project-review-kv">
              <span class="new-project-review-k">Project amount</span>
              <span class="new-project-review-v">{{ reviewMultipleAmountLine }}</span>
            </div>
            <div class="new-project-review-kv">
              <span class="new-project-review-k">Tax</span>
              <span class="new-project-review-v">{{ reviewTaxSummaryLabelMultiple }}</span>
            </div>
            <div class="new-project-review-kv">
              <span class="new-project-review-k">Tax Amount</span>
              <span class="new-project-review-v">{{ reviewTaxAmountLineMultiple }}</span>
            </div>
            <div class="new-project-review-kv">
              <span class="new-project-review-k">Payment method</span>
              <span class="new-project-review-v">{{ displayOrDash(paymentMethodMultiple) }}</span>
            </div>
            <div class="new-project-review-kv">
              <span class="new-project-review-k">Payment structure</span>
              <span class="new-project-review-v">{{ reviewPaymentStructureLabel }}</span>
            </div>
            <div class="new-project-review-kv">
              <span class="new-project-review-k">Paid</span>
              <span class="new-project-review-v">As per milestones</span>
            </div>
          </template>
          <template v-else-if="paymentStructure === 'recurring'">
            <div class="new-project-review-kv">
              <span class="new-project-review-k">Payment amount (each period)</span>
              <span class="new-project-review-v">{{ reviewRecurringAmountLine }}</span>
            </div>
            <div class="new-project-review-kv">
              <span class="new-project-review-k">Tax</span>
              <span class="new-project-review-v">{{ reviewTaxSummaryLabelRecurring }}</span>
            </div>
            <div class="new-project-review-kv">
              <span class="new-project-review-k">Tax amount</span>
              <span class="new-project-review-v">{{ reviewTaxAmountLineRecurring }}</span>
            </div>
            <div class="new-project-review-kv">
              <span class="new-project-review-k">Payment method</span>
              <span class="new-project-review-v">{{ displayOrDash(paymentMethodRecurring) }}</span>
            </div>
            <div class="new-project-review-kv">
              <span class="new-project-review-k">Payment structure</span>
              <span class="new-project-review-v">{{ reviewPaymentStructureLabel }}</span>
            </div>
            <div class="new-project-review-kv">
              <span class="new-project-review-k">Duration</span>
              <span class="new-project-review-v">{{ reviewRecurringDurationLabel }}</span>
            </div>
            <div class="new-project-review-kv">
              <span class="new-project-review-k">Paid</span>
              <span class="new-project-review-v">Recurring schedule</span>
            </div>
          </template>
          <template v-else>
            <div class="new-project-review-kv">
              <span class="new-project-review-k">Payment structure</span>
              <span class="new-project-review-v">{{ reviewPaymentStructureLabel }}</span>
            </div>
            <div class="new-project-review-kv new-project-review-kv--block">
              <span class="new-project-review-k">Payment amounts &amp; schedule</span>
              <span class="new-project-review-v new-project-review-v--muted">Not collected yet for this payment type.</span>
            </div>
          </template>
        </div>
      </section>

      <section v-if="paymentStructure === 'multiple'" class="new-project-review-section">
        <button
          type="button"
          class="new-project-review-section-head"
          aria-expanded="true"
        >
          <span class="new-project-review-section-title">Payment Milestone</span>
          <span class="new-project-review-chevron new-project-review-chevron--open" aria-hidden="true">▲</span>
        </button>
        <div class="new-project-review-body">
          <template v-if="milestones.length">
            <div
              v-for="(milestone, index) in milestones"
              :key="milestone.id"
              class="new-project-review-milestone-item"
            >
              <div class="new-project-review-kv">
                <span class="new-project-review-k">{{ formatMilestoneLabel(index) }}</span>
                <span class="new-project-review-v">
                  {{ milestoneReviewPercent(milestone) }} = {{ currencyMultiple }} {{ milestoneReviewAmount(milestone) }}
                </span>
              </div>
              <div class="new-project-review-kv">
                <span class="new-project-review-k">{{ formatSlashDateOrDash(milestone.date) }}</span>
                <span class="new-project-review-v"></span>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="new-project-review-kv new-project-review-kv--block">
              <span class="new-project-review-k">Payment amounts &amp; schedule</span>
              <span class="new-project-review-v new-project-review-v--muted">No milestones added yet.</span>
            </div>
          </template>
        </div>
      </section>

      <section v-if="paymentStructure === 'recurring'" class="new-project-review-section">
        <button
          type="button"
          class="new-project-review-section-head"
          aria-expanded="true"
        >
          <span class="new-project-review-section-title">Payment schedule</span>
          <span class="new-project-review-chevron new-project-review-chevron--open" aria-hidden="true">▲</span>
        </button>
        <div class="new-project-review-body">
          <template v-if="recurringSchedulePreview.length">
            <div
              v-for="row in recurringSchedulePreview"
              :key="row.index"
              class="new-project-review-milestone-item"
            >
              <div class="new-project-review-kv">
                <span class="new-project-review-k">#{{ row.index }} Payment</span>
                <span class="new-project-review-v">{{ row.amountLine }}</span>
              </div>
              <div class="new-project-review-kv">
                <span class="new-project-review-k">Due</span>
                <span class="new-project-review-v">{{ row.dueLabel }}</span>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="new-project-review-kv new-project-review-kv--block">
              <span class="new-project-review-k">Schedule</span>
              <span class="new-project-review-v new-project-review-v--muted">Add amount and duration to preview schedule.</span>
            </div>
          </template>
        </div>
      </section>

      <section v-if="showFinancingSummaryRow" class="new-project-review-financing-bar">
        <span class="new-project-review-financing-k">Financing</span>
        <span class="new-project-review-financing-v">
          You will receive: {{ currencySingle }} {{ earlyPayoutYouReceivePkr }}
        </span>
      </section>
      <section v-else-if="showFinancingSummaryRowMultiple" class="new-project-review-financing-bar">
        <span class="new-project-review-financing-k">Financing</span>
        <span class="new-project-review-financing-v">
          You will receive: {{ reviewMultipleFinancingLine }}
        </span>
      </section>
      <section v-else-if="showFinancingSummaryRowRecurring" class="new-project-review-financing-bar">
        <span class="new-project-review-financing-k">Financing</span>
        <span class="new-project-review-financing-v">
          You will receive: {{ currencyRecurring }} {{ earlyPayoutYouReceivePkrRecurring }}
        </span>
      </section>
    </div>

    <!-- Step 6: Agreement -->
    <div v-else-if="currentStep === 6" class="new-project-form new-project-agreement">
      <h2 class="new-project-agreement-title">Agreement</h2>
      <div class="new-project-agreement-layout">
        <nav class="new-project-agreement-nav" aria-label="Agreement sections">
          <button
            type="button"
            class="new-project-agreement-nav-btn"
            :class="{ 'new-project-agreement-nav-btn--active': agreementActiveNav === 'scope' }"
            @click="scrollAgreementSection('scope')"
          >
            Project Scope
          </button>
          <button
            type="button"
            class="new-project-agreement-nav-btn"
            :class="{ 'new-project-agreement-nav-btn--active': agreementActiveNav === 'timeline' }"
            @click="scrollAgreementSection('timeline')"
          >
            Timeline
          </button>
          <button
            type="button"
            class="new-project-agreement-nav-btn"
            :class="{ 'new-project-agreement-nav-btn--active': agreementActiveNav === 'payment' }"
            @click="scrollAgreementSection('payment')"
          >
            Payment terms
          </button>
          <button
            type="button"
            class="new-project-agreement-nav-btn"
            :class="{ 'new-project-agreement-nav-btn--active': agreementActiveNav === 'responsibilities' }"
            @click="scrollAgreementSection('responsibilities')"
          >
            Responsibilities
          </button>
        </nav>

        <div class="new-project-agreement-main">
          <article id="np-a-scope" class="new-project-agreement-card" tabindex="-1">
            <h3 class="new-project-agreement-card-title">Project Scope</h3>
            <p class="new-project-agreement-p">
              You will deliver work for
              <strong>{{ displayOrDash(projectName) }}</strong>
              as outlined in the project details. All work will be completed to professional standards by the agreed deadline.
            </p>
            <p v-if="scopeDescription.trim()" class="new-project-agreement-p new-project-agreement-p--muted">
              {{ scopeDescription }}
            </p>
            <p class="new-project-agreement-p">
              <strong>{{ agreementClientLabel }}</strong>
              (client) will provide timely feedback, necessary materials, and clear communication throughout the project.
            </p>
          </article>

          <article id="np-a-timeline" class="new-project-agreement-card" tabindex="-1">
            <h3 class="new-project-agreement-card-title">Timeline</h3>
            <ul class="new-project-agreement-list">
              <li>
                <span class="new-project-agreement-li-k">Start date</span>
                <span class="new-project-agreement-li-v">{{ displayOrDash(startDate) }}</span>
              </li>
              <li>
                <span class="new-project-agreement-li-k">Completion date</span>
                <span class="new-project-agreement-li-v">{{ displayOrDash(endDate) }}</span>
              </li>
              <li>
                <span class="new-project-agreement-li-k">Key milestones</span>
                <span class="new-project-agreement-li-v">
                  As defined by the project scope and payment structure you selected.
                </span>
              </li>
            </ul>
            <p class="new-project-agreement-note">
              Timeline may be adjusted if client feedback or materials are delayed.
            </p>
          </article>

          <article id="np-a-payment" class="new-project-agreement-card" tabindex="-1">
            <h3 class="new-project-agreement-card-title">Payment terms</h3>
            <ul class="new-project-agreement-list">
              <li>
                <span class="new-project-agreement-li-k">Total amount</span>
                <span class="new-project-agreement-li-v">{{ agreementAmountSummary }}</span>
              </li>
              <li>
                <span class="new-project-agreement-li-k">Payment schedule &amp; due date</span>
                <span class="new-project-agreement-li-v">{{ agreementScheduleSummary }}</span>
              </li>
            </ul>
            <p v-if="showFinancingSummaryRow || showFinancingSummaryRowMultiple || showFinancingSummaryRowRecurring" class="new-project-agreement-note">
              Financing via Create is optional and subject to approval. If accepted, early payout will follow the terms
              shown on the Early Payout step.
            </p>
          </article>

          <article id="np-a-responsibilities" class="new-project-agreement-card" tabindex="-1">
            <h3 class="new-project-agreement-card-title">Responsibilities</h3>
            <p class="new-project-agreement-p">
              <strong>Service provider:</strong>
              Deliver the agreed scope with professional quality, communicate proactively about blockers, and honor
              confidentiality for client materials.
            </p>
            <p class="new-project-agreement-p">
              <strong>Client:</strong>
              Provide timely decisions, access to assets, and accurate billing details needed to receive payment.
            </p>
            <p class="new-project-agreement-p">
              <strong>Both parties:</strong>
              Act in good faith, respond within reasonable timeframes, and work to resolve issues through direct
              communication before escalating.
            </p>
          </article>

          <div class="new-project-agreement-checks">
            <label class="new-project-agreement-check-row">
              <input v-model="agreementTermsAccepted" type="checkbox" class="new-project-agreement-checkbox" />
              <span>I agree to these terms of the agreement</span>
            </label>
            <label class="new-project-agreement-check-row">
              <input v-model="agreementSendToClient" type="checkbox" class="new-project-agreement-checkbox" />
              <span>I want to send this to the client</span>
            </label>
          </div>
        </div>
      </div>
    </div>

    <!-- Steps 3 (non-single), 4 (non-single) -->
    <div v-else class="new-project-form">
      <section class="new-project-section">
        <p class="new-project-placeholder">
          <template v-if="currentStep === 3">Payment details for this payment type – coming soon.</template>
          <template v-else>Step {{ currentStep }} – Coming soon.</template>
        </p>
      </section>
    </div>

    <!-- Footer -->
    <footer class="new-project-footer">
      <Button variant="outline" class="new-project-btn new-project-btn--secondary" @click="handleSaveExit">
        Save & Exit
      </Button>
      <Button
        class="new-project-btn new-project-btn--primary"
        :disabled="primaryActionDisabled"
        @click="handleContinue"
      >
        {{ currentStep === 6 ? 'Create Project' : 'Continue' }}
      </Button>
    </footer>
  </div>
</template>

<style scoped>
.new-project {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  background: #eef2f7;
  min-height: 100%;
  padding: 28px 32px 40px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 28px;
}

/* Step bar: horizontal track with numbered steps and connecting lines */
.new-project-stepbar {
  width: 100%;
  padding: 20px 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.new-project-stepbar-track {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 24px;
}

.new-project-stepbar-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  text-align: center;
}

.new-project-stepbar-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 0.8125rem;
  font-weight: 600;
  background: #e2e8f0;
  color: #64748b;
  flex-shrink: 0;
}

.new-project-stepbar-item--active .new-project-stepbar-number {
  background: #0f172a;
  color: #ffffff;
}

.new-project-stepbar-item--done .new-project-stepbar-number {
  background: #0f172a;
  color: #ffffff;
}

.new-project-stepbar-label {
  font-size: 0.75rem;
  color: #94a3b8;
  line-height: 1.1;
  max-width: 110px;
}

.new-project-stepbar-item--active .new-project-stepbar-label {
  font-weight: 600;
  color: #0f172a;
}

.new-project-stepbar-item--done .new-project-stepbar-label {
  color: #64748b;
}

.new-project-stepbar-line {
  flex: 1;
  min-width: 24px;
  max-width: 48px;
  height: 2px;
  background: #e2e8f0;
  margin: 0 8px;
}

.new-project-stepbar-line--done {
  background: #0f172a;
}

.new-project-form {
  flex: 1;
  width: 100%;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.new-project-section {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 28px 32px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.new-project-section-title {
  margin: 0 0 24px;
  font-size: 1.25rem;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.01em;
}

.new-project-fields {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.new-project-fields--grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 18px;
}

@media (max-width: 640px) {
  .new-project-fields--grid {
    grid-template-columns: 1fr;
  }
}

.new-project-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}

.new-project-row--three {
  grid-template-columns: 1fr 1fr 1fr;
}

@media (max-width: 640px) {
  .new-project-row--three {
    grid-template-columns: 1fr;
  }
}

.new-project-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.new-project-field--full {
  grid-column: 1 / -1;
}

.new-project-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #334155;
}

.new-project-input,
.new-project-select,
.new-project-textarea {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-size: 0.875rem;
  color: #0f172a;
  background: #ffffff;
}

.new-project-input::placeholder,
.new-project-textarea::placeholder {
  color: #94a3b8;
}

.new-project-input:focus,
.new-project-select:focus,
.new-project-textarea:focus {
  outline: none;
  border-color: #0f172a;
  box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.1);
}

.new-project-select {
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748b' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
}

.new-project-textarea {
  resize: vertical;
  min-height: 100px;
}

.new-project-toggle {
  display: inline-flex;
  /* border: 1px solid #e2e8f0; */
  border-radius: 999px;
  overflow: hidden;
}

.new-project-toggle-btn {
  padding: 10px 18px;
  font-size: 0.875rem;
  border: none;
  background: #fff;
  color: #64748b;
  cursor: pointer;
}

.new-project-toggle-btn:first-child {
  border-radius: 999px 0 0 999px;
}

.new-project-toggle-btn:last-child {
  border-radius: 0 999px 999px 0;
}

.new-project-toggle-btn--active {
  background: #e2e8f0;
  color: #0f172a;
  font-weight: 600;
}

.new-project-date-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.new-project-date-icon {
  position: absolute;
  right: 12px;
  pointer-events: none;
  font-size: 1rem;
}

.new-project-input--date {
  padding-right: 40px;
}

/* Upload */
.new-project-upload-area {
  margin-top: 20px;
}

.new-project-upload-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
}

.new-project-upload-label {
  cursor: pointer;
  display: block;
}

.new-project-upload-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 36px 24px;
  border: 2px dashed #cbd5e1;
  border-radius: 12px;
  background: #fafbfc;
  transition: border-color 0.2s, background 0.2s;
}

.new-project-upload-box:hover {
  border-color: #94a3b8;
  background: #f1f5f9;
}

.new-project-upload-icon {
  color: #64748b;
  flex-shrink: 0;
}

.new-project-upload-text {
  font-size: 0.875rem;
  color: #475569;
}

.new-project-upload-hint {
  font-size: 0.75rem;
  color: #94a3b8;
}

.new-project-files {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-top: 16px;
}

@media (max-width: 480px) {
  .new-project-files {
    grid-template-columns: 1fr;
  }
}

.new-project-file-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-size: 0.8125rem;
  color: #334155;
}

.new-project-file-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.new-project-file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.new-project-file-remove {
  margin-left: auto;
  padding: 4px;
  border: none;
  background: none;
  cursor: pointer;
  color: #dc2626;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.new-project-file-remove:hover {
  color: #b91c1c;
}

/* Tags */
.new-project-tags {
  margin-top: 20px;
}

.new-project-tags-selected {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.new-project-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: #0f172a;
  border: none;
  border-radius: 999px;
  font-size: 0.8125rem;
  font-weight: 500;
  color: #ffffff;
}

.new-project-tag-remove {
  border: none;
  background: none;
  cursor: pointer;
  padding: 0 2px;
  font-size: 1rem;
  line-height: 1;
  color: rgba(255, 255, 255, 0.85);
}

.new-project-tag-remove:hover {
  color: #fff;
}

.new-project-tag-add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  background: #ffffff;
  font-size: 0.8125rem;
  font-weight: 500;
  color: #475569;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.new-project-tag-add:hover {
  border-color: #cbd5e1;
  color: #0f172a;
}

.new-project-tag-add-icon {
  font-size: 1rem;
  line-height: 1;
}

.new-project-tag-add--open {
  border-color: #0f172a;
  color: #0f172a;
}

/* Tag popover (replaces dropdown) */
.new-project-tag-popover-wrap {
  position: relative;
  display: inline-block;
}

.new-project-tag-popover-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9998;
  background: transparent;
}

.new-project-tag-popover {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 6px;
  z-index: 9999;
  min-width: 240px;
  padding: 12px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 10px 40px rgba(15, 23, 42, 0.12);
}

.new-project-tags-custom {
  margin-bottom: 10px;
}

.new-project-tag-input {
  width: 100%;
}

.new-project-tags-list-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: #94a3b8;
  margin-bottom: 8px;
  display: block;
}

.new-project-tag-options {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.new-project-tag-option {
  display: block;
  width: 100%;
  padding: 8px 12px;
  text-align: left;
  border: none;
  background: none;
  font-size: 0.875rem;
  color: #334155;
  cursor: pointer;
  border-radius: 6px;
}

.new-project-tag-option:hover {
  background: #f1f5f9;
}

/* Tag popover transition */
.tag-popover-enter-active,
.tag-popover-leave-active {
  transition: opacity 0.15s ease;
}
.tag-popover-enter-from,
.tag-popover-leave-to {
  opacity: 0;
}

/* Footer — pale bar; outline “Save & Exit” left, solid primary right; equal pill height */
.new-project-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-top: auto;
  margin-left: -32px;
  margin-right: -32px;
  margin-bottom: -40px;
  padding: 20px 32px;
  background: #f5f7fa;
  flex-shrink: 0;
}

.new-project-footer :deep(.new-project-btn--secondary) {
  min-height: 48px;
  height: 48px;
  padding: 0 28px;
  border-radius: 999px !important;
  border: 1px solid #0f172a !important;
  background: rgba(255, 255, 255, 0.7) !important;
  color: #0f172a !important;
  font-weight: 600;
  font-size: 0.9375rem;
  box-shadow: none !important;
}

.new-project-footer :deep(.new-project-btn--secondary:hover) {
  background: rgba(255, 255, 255, 0.95) !important;
}

.new-project-footer :deep(.new-project-btn--primary) {
  min-height: 48px;
  height: 48px;
  padding: 0 28px;
  border-radius: 999px !important;
  background: #0f172a !important;
  color: #ffffff !important;
  border: none !important;
  font-weight: 600;
  font-size: 0.9375rem;
  box-shadow: none !important;
}

.new-project-footer :deep(.new-project-btn--primary:hover) {
  background: #1e293b !important;
}

.new-project-placeholder {
  margin: 0;
  color: #64748b;
  font-size: 0.95rem;
}

/* Step 2: Payment Structure */
.new-project-step2 {
  width: 100%;
  max-width: 100%;
}

.new-project-step2-heading {
  margin: 0 0 28px;
  font-size: 1.5rem;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.02em;
}

.new-project-step2-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

@media (max-width: 768px) {
  .new-project-step2-cards {
    grid-template-columns: 1fr;
  }
}

.new-project-payment-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  padding: 24px;
  margin: 0;
  background: #ffffff;
  border: 2px solid #e2e8f0;
  border-radius: 12px;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s, background 0.15s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  touch-action: manipulation;
  -webkit-tap-highlight-color: rgba(15, 23, 42, 0.08);
  min-height: 44px;
  user-select: none;
}

.new-project-payment-card:hover {
  border-color: #cbd5e1;
}

.new-project-payment-card:active {
  background: #f8fafc;
}

.new-project-payment-card:has(.new-project-payment-card-input:focus-visible) {
  outline: 2px solid #0f172a;
  outline-offset: 2px;
}

.new-project-payment-card--selected {
  border-color: #0f172a;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
  background: #fafbfc;
}

/* Visually hide radio; entire label remains the hit target (reliable on touch / nested content). */
.new-project-payment-card-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
  opacity: 0;
  pointer-events: none;
}

.new-project-payment-card-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  margin-bottom: 16px;
  color: #0f172a;
}

.new-project-payment-card-icon-image {
  width: 40px;
  height: 40px;
  object-fit: contain;
}

.new-project-payment-card-icon--single,
.new-project-payment-card-icon--multiple,
.new-project-payment-card-icon--recurring {
  background: #e0f2fe;
}

.new-project-payment-card-title {
  display: block;
  margin: 0 0 8px;
  font-size: 1rem;
  font-weight: 700;
  color: #0f172a;
}

.new-project-payment-card-desc {
  display: block;
  margin: 0 0 16px;
  font-size: 0.875rem;
  line-height: 1.5;
  color: #64748b;
  flex: 1;
}

.new-project-payment-card-footer {
  display: block;
  padding-top: 16px;
  border-top: 1px solid #e2e8f0;
  font-size: 0.8125rem;
  color: #94a3b8;
  width: 100%;
}

/* Step 3: Payment details (single) */
.new-project-milestone-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}

.new-project-milestone-summary-item {
  padding: 14px 16px;
  border-right: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.new-project-milestone-summary-item:last-child {
  border-right: 0;
}

.new-project-milestone-summary-k {
  font-size: 0.75rem;
  color: #64748b;
  text-transform: lowercase;
}

.new-project-milestone-summary-v {
  font-size: 1.75rem;
  font-weight: 500;
  line-height: 1.1;
  color: #0f172a;
}

.new-project-milestone-summary-v--success {
  color: #059669;
}

.new-project-milestone-card {
  border: 1px solid #e2e8f0;
}

.new-project-milestone-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.new-project-milestone-title {
  font-size: 1rem;
  font-weight: 600;
  color: #0f172a;
}

.new-project-milestone-delete {
  border: 1px solid #fca5a5;
  color: #dc2626;
  background: #fff5f5;
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 0.8125rem;
  cursor: pointer;
}

.new-project-milestone-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 2fr;
  gap: 12px;
}

.new-project-milestone-deliverables {
  min-height: 84px;
  resize: vertical;
}

.new-project-milestone-add-wrap {
  display: flex;
  justify-content: center;
}

.new-project-milestone-add {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #0f172a;
  border-radius: 999px;
  padding: 8px 16px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}

.new-project-milestone-add:hover {
  background: #f8fafc;
}

@media (max-width: 900px) {
  .new-project-milestone-summary {
    grid-template-columns: 1fr;
  }

  .new-project-milestone-summary-item {
    border-right: 0;
    border-bottom: 1px solid #e2e8f0;
  }

  .new-project-milestone-summary-item:last-child {
    border-bottom: 0;
  }

  .new-project-milestone-grid {
    grid-template-columns: 1fr;
  }
}

.new-project-amount-row {
  display: flex;
  gap: 12px;
  align-items: stretch;
}

.new-project-amount-input {
  flex: 1;
  min-width: 0;
}

.new-project-currency-select {
  width: auto;
  min-width: 100px;
  flex-shrink: 0;
}

.new-project-radio-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.new-project-radio-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  cursor: pointer;
  background: #fff;
  transition: border-color 0.15s, background 0.15s;
}

.new-project-radio-card:hover {
  border-color: #cbd5e1;
}

.new-project-radio-card--checked {
  border-color: #0f172a;
  background: #f8fafc;
}

.new-project-radio-input {
  margin-top: 4px;
  flex-shrink: 0;
  accent-color: #0f172a;
}

.new-project-radio-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
}

.new-project-radio-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #0f172a;
}

.new-project-radio-hint {
  font-size: 0.8125rem;
  color: #64748b;
  line-height: 1.45;
}

.new-project-gst-notice {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: -4px 0 4px 28px;
  padding: 12px 14px;
  background: #fef9c3;
  border: 1px solid #fde047;
  border-radius: 8px;
  font-size: 0.8125rem;
  color: #713f12;
  line-height: 1.45;
}

.new-project-gst-notice-main {
  font-weight: 600;
}

.new-project-gst-notice-sub {
  font-size: 0.75rem;
  color: #854d0e;
  opacity: 0.95;
}

.new-project-date-field {
  margin-left: 28px;
  margin-top: 4px;
  max-width: 280px;
}

.new-project-financing-copy {
  margin: 0 0 16px;
  font-size: 0.875rem;
  line-height: 1.55;
  color: #475569;
}

.new-project-financing-yesno {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.new-project-yesno {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  font-size: 0.875rem;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
  background: #fff;
}

.new-project-yesno--active {
  border-color: #0f172a;
  color: #0f172a;
  background: #f1f5f9;
}

/* Recurring: duration + schedule preview */
.new-project-duration-row {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 12px;
}

.new-project-duration-input {
  flex: 0 0 120px;
  min-width: 100px;
}

.new-project-duration-units {
  display: inline-flex;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  overflow: hidden;
  background: #f1f5f9;
}

.new-project-duration-unit {
  border: none;
  background: transparent;
  padding: 10px 16px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
}

.new-project-duration-unit--active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}

.new-project-duration-hint {
  margin: 8px 0 0;
  font-size: 0.8125rem;
  color: #94a3b8;
  line-height: 1.45;
}

.new-project-schedule-preview {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}

.new-project-schedule-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid #e2e8f0;
  font-size: 0.875rem;
}

.new-project-schedule-row:last-child {
  border-bottom: none;
}

.new-project-schedule-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.new-project-schedule-title {
  font-weight: 600;
  color: #0f172a;
}

.new-project-schedule-due {
  font-size: 0.8125rem;
  color: #64748b;
}

.new-project-schedule-amount {
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
}

.new-project-schedule-empty {
  margin: 0;
  font-size: 0.875rem;
  color: #94a3b8;
}

/* Step 4: Early Payout */
.new-project-early-payout-intro {
  margin-bottom: 4px;
}

.new-project-early-payout-title {
  margin: 0 0 8px;
  font-size: 1.375rem;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.02em;
}

.new-project-early-payout-sub {
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.5;
  color: #64748b;
}

.new-project-early-payout-summary {
  margin-top: 16px;
  padding: 18px 20px;
  background: #f1f5f9;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.new-project-early-payout-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  font-size: 0.875rem;
}

.new-project-early-payout-label {
  color: #64748b;
}

.new-project-early-payout-value {
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
}

.new-project-early-payout-row--highlight .new-project-early-payout-label,
.new-project-early-payout-row--highlight .new-project-early-payout-value {
  color: #15803d;
}

.new-project-agree-label {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  cursor: pointer;
}

.new-project-agree-checkbox {
  margin-top: 3px;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  accent-color: #0f172a;
  cursor: pointer;
}

.new-project-agree-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
}

.new-project-agree-title {
  font-size: 0.9375rem;
  color: #0f172a;
}

.new-project-agree-desc {
  font-size: 0.875rem;
  line-height: 1.5;
  color: #64748b;
  font-weight: 400;
}

.new-project-footer :deep(.new-project-btn--primary:disabled) {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Step 5: Review */
.new-project-review {
  gap: 16px;
}

.new-project-review-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 4px 0 8px;
}

.new-project-review-title {
  margin: 0;
  font-size: 1.375rem;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.02em;
}

.new-project-review-edit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #0f172a;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.new-project-review-edit:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
}

.new-project-review-edit-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

.new-project-review-section {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}

.new-project-review-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 18px 24px;
  border: none;
  background: #fff;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: #0f172a;
}

.new-project-review-section-head:hover {
  background: #fafafa;
}

.new-project-review-section-title {
  font-size: 0.9375rem;
  font-weight: 600;
}

.new-project-review-chevron {
  display: inline-block;
  font-size: 0.65rem;
  color: #94a3b8;
  transition: transform 0.2s ease;
  transform: rotate(180deg);
}

.new-project-review-chevron--open {
  transform: rotate(0deg);
}

.new-project-review-body {
  padding: 0 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.new-project-review-kv {
  display: grid;
  grid-template-columns: minmax(100px, 1fr) minmax(120px, 1.4fr);
  gap: 16px 24px;
  align-items: start;
  font-size: 0.875rem;
}

.new-project-review-kv--block {
  grid-template-columns: 1fr;
}

.new-project-review-kv--block .new-project-review-k {
  margin-bottom: 4px;
}

.new-project-review-k {
  color: #64748b;
}

.new-project-review-v {
  font-weight: 500;
  color: #0f172a;
  text-align: right;
  word-break: break-word;
}

.new-project-review-kv--block .new-project-review-v {
  text-align: left;
}

.new-project-review-v--multiline {
  font-weight: 400;
  line-height: 1.5;
  white-space: pre-wrap;
}

.new-project-review-v--muted {
  color: #94a3b8;
  font-weight: 400;
}

.new-project-review-financing-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 24px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  font-size: 0.875rem;
}

.new-project-review-financing-k {
  font-weight: 600;
  color: #0f172a;
}

.new-project-review-financing-v {
  font-weight: 600;
  color: #15803d;
  text-align: right;
}

.new-project-review-milestone-item + .new-project-review-milestone-item {
  border-top: 1px solid #e2e8f0;
  padding-top: 12px;
}

/* Step 6: Agreement */
.new-project-agreement-title {
  margin: 0 0 20px;
  font-size: 1.375rem;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.02em;
}

.new-project-agreement-layout {
  display: flex;
  align-items: flex-start;
  gap: 28px;
  width: 100%;
}

.new-project-agreement-nav {
  flex-shrink: 0;
  width: 180px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: sticky;
  top: 8px;
}

.new-project-agreement-nav-btn {
  padding: 10px 14px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-size: 0.875rem;
  font-weight: 500;
  color: #64748b;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.new-project-agreement-nav-btn:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.new-project-agreement-nav-btn--active {
  background: #fff;
  color: #0f172a;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}

.new-project-agreement-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.new-project-agreement-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 24px 28px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  scroll-margin-top: 24px;
}

.new-project-agreement-card-title {
  margin: 0 0 14px;
  font-size: 1rem;
  font-weight: 700;
  color: #0f172a;
}

.new-project-agreement-p {
  margin: 0 0 12px;
  font-size: 0.875rem;
  line-height: 1.6;
  color: #334155;
}

.new-project-agreement-p:last-child {
  margin-bottom: 0;
}

.new-project-agreement-p--muted {
  padding: 12px 14px;
  background: #f8fafc;
  border-radius: 8px;
  color: #475569;
  white-space: pre-wrap;
}

.new-project-agreement-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.new-project-agreement-list li {
  display: grid;
  grid-template-columns: minmax(120px, 160px) 1fr;
  gap: 12px 20px;
  font-size: 0.875rem;
  line-height: 1.5;
  align-items: start;
}

.new-project-agreement-li-k {
  color: #64748b;
}

.new-project-agreement-li-v {
  font-weight: 500;
  color: #0f172a;
}

.new-project-agreement-note {
  margin: 16px 0 0;
  padding: 12px 14px;
  background: #fefce8;
  border: 1px solid #fde047;
  border-radius: 8px;
  font-size: 0.8125rem;
  color: #713f12;
  line-height: 1.5;
}

.new-project-agreement-checks {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
}

.new-project-agreement-check-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 18px 22px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  font-size: 0.875rem;
  line-height: 1.45;
  color: #0f172a;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.new-project-agreement-checkbox {
  margin-top: 2px;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  accent-color: #0f172a;
  cursor: pointer;
}

@media (max-width: 800px) {
  .new-project-agreement-layout {
    flex-direction: column;
  }

  .new-project-agreement-nav {
    width: 100%;
    flex-direction: row;
    flex-wrap: wrap;
    position: static;
  }

  .new-project-agreement-list li {
    grid-template-columns: 1fr;
  }
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { getProjects } from "@/lib/api";

const emit = defineEmits<{
  (e: "view-projects"): void;
  (e: "create-project"): void;
  (e: "record-transactions"): void;
}>();

const isLoading = ref(false);
const projectsCount = ref(0);

type ProjectCard = {
  id: string;
  title: string;
  clientName: string;
  amount: number;
  amountFormatted: string;
  paymentType: string;
  dueDateDisplay: string;
  status: string;
};

const projects = ref<ProjectCard[]>([]);
const carouselPage = ref(0);
const CARDS_PER_PAGE = 3;

const hasProjects = computed(() => projectsCount.value > 0);
const hasProjectCards = computed(() => projects.value.length > 0);
const totalCarouselPages = computed(() =>
  Math.max(1, Math.ceil(projects.value.length / CARDS_PER_PAGE)),
);
const visibleProjects = computed(() => {
  const start = carouselPage.value * CARDS_PER_PAGE;
  return projects.value.slice(start, start + CARDS_PER_PAGE);
});

const availableBalance = computed(() => {
  const total = projects.value.reduce((sum, p) => sum + (Number.isFinite(p.amount) ? p.amount : 0), 0);
  return total;
});

const availableBalanceFormatted = computed(() => {
  return availableBalance.value.toLocaleString("en-PK");
});

function normalizePaymentType(paymentType: string): string {
  const value = paymentType.trim().toLowerCase();
  if (value === "single") return "Single";
  if (value === "multiple") return "Multiple";
  if (value === "recurring") return "Recurring";
  if (value === "deliverables" || value === "deliverable") return "Deliverables";
  return paymentType;
}

function formatDueDateDisplay(raw: string): string {
  if (!raw || raw === "—") return "—";
  const tryDate = new Date(raw);
  if (!Number.isNaN(tryDate.getTime())) {
    const day = String(tryDate.getDate()).padStart(2, "0");
    const month = String(tryDate.getMonth() + 1).padStart(2, "0");
    const yy = String(tryDate.getFullYear()).slice(-2);
    return `${day}-${month}-${yy}`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1].slice(-2)}`;
  return raw;
}

function statusLabel(status: string): string {
  const value = String(status ?? "")
    .trim()
    .toLowerCase();
  if (value.includes("in_progress") || value.includes("in-progress")) return "In Progress";
  if (value.includes("draft")) return "Draft";
  if (value.includes("complete")) return "Completed";
  if (value.includes("dispute")) return "In Dispute";
  if (value.includes("delay")) return "Delayed";
  if (value.includes("payment") && (value.includes("due") || value.includes("overdue"))) return "Payment Due";
  return "Signed";
}

function statusVariant(status: string): string {
  const value = String(status ?? "")
    .trim()
    .toLowerCase();
  if (value.includes("payment") && (value.includes("due") || value.includes("overdue"))) return "payment-due";
  if (value.includes("delay")) return "delayed";
  if (value.includes("in_progress") || value.includes("in-progress")) return "in-progress";
  if (value.includes("draft")) return "draft";
  if (value.includes("complete")) return "completed";
  if (value.includes("dispute")) return "in-dispute";
  return "signed";
}

function setCarouselPage(next: number) {
  carouselPage.value = Math.min(Math.max(0, next), totalCarouselPages.value - 1);
}

function prevCarouselPage() {
  setCarouselPage(carouselPage.value - 1);
}

function nextCarouselPage() {
  setCarouselPage(carouselPage.value + 1);
}

function normalizeProjectsResponse(raw: any): ProjectCard[] {
  const list = Array.isArray(raw?.data?.data)
    ? raw.data.data
    : Array.isArray(raw?.data)
      ? raw.data
      : Array.isArray(raw)
        ? raw
        : [];

  return list.map((item: any) => {
    const primaryClient =
      (Array.isArray(item?.clients) ? item.clients[0] : undefined) ?? item?.client ?? null;
    const amount = item?.amount ?? item?.total_amount ?? item?.totalAmount ?? 0;
    const numericAmount = Number(amount);
    const amountFormatted = Number.isFinite(numericAmount)
      ? numericAmount.toLocaleString("en-PK")
      : String(amount ?? "0");

    const dueDate = String(item?.end_date ?? item?.due_date ?? "—");

    return {
      id: String(item?.id ?? item?.uuid ?? crypto.randomUUID?.() ?? Date.now()),
      title: String(item?.title ?? item?.name ?? "Untitled Project"),
      clientName: String(
        primaryClient?.display_name ??
          item?.client_name ??
          primaryClient?.name ??
          primaryClient?.brand_name ??
          "—",
      ),
      amount: Number.isFinite(numericAmount) ? numericAmount : 0,
      amountFormatted,
      paymentType: String(item?.type ?? item?.payment_type ?? "single"),
      dueDateDisplay: formatDueDateDisplay(dueDate),
      status: String(item?.status ?? "draft"),
    };
  });
}

async function loadProjectsCount() {
  isLoading.value = true;
  try {
    const response = await getProjects();
    const list = normalizeProjectsResponse(response?.data);
    projects.value = list;
    projectsCount.value = list.length;
    setCarouselPage(0);
  } catch (e) {
    projectsCount.value = 0;
    projects.value = [];
    setCarouselPage(0);
  } finally {
    isLoading.value = false;
  }
}

type TransactionRow = {
  id: string;
  direction: "in" | "out";
  accountName: string;
  projectTitle: string;
  timeLabel: string;
  amountMasked: string;
};

type TransactionGroup = {
  label: string;
  rows: TransactionRow[];
};

const transactions = ref<TransactionRow[]>([]);

const transactionGroups = computed<TransactionGroup[]>(() => {
  // Empty until transactions API is integrated.
  // When there are no transactions, the dashboard should show the empty state.
  if (transactions.value.length === 0) return [];

  return [
    {
      label: "Transactions",
      rows: transactions.value,
    },
  ];
});

const hasTransactions = computed(() => transactionGroups.value.length > 0);

onMounted(() => {
  loadProjectsCount();
});
</script>

<template>
  <div class="dashboard-home">
    <section class="dashboard-card dashboard-balance-card">
      <div>
        <p class="dashboard-card-label">Current Available Balance</p>
        <div class="dashboard-balance-value">
          {{ availableBalanceFormatted }} <span>PKR</span>
        </div>
        <p class="dashboard-card-caption">Tap for view amount due from clients</p>
      </div>
      <img class="dashboard-eye" src="@/assets/icons/loop.png" alt="" />
    </section>

    <section class="dashboard-section">
      <div class="dashboard-section-header">
        <h2>Projects</h2>
        <button
          v-if="hasProjects"
          class="dashboard-link"
          type="button"
          @click="emit('view-projects')"
        >
          View projects
        </button>
      </div>

      <div v-if="isLoading" class="dashboard-card dashboard-home-loading">Loading...</div>

      <div v-else-if="!hasProjects" class="dashboard-card dashboard-home-empty">
        <img
          class="dashboard-home-empty-illustration"
          src="@/assets/icons/Group (1).svg"
          alt=""
        />
        <div class="dashboard-home-empty-title">Start your first project</div>
        <div class="dashboard-home-empty-subtitle">You have no projects at the moment!</div>
        <button class="dashboard-home-empty-cta" type="button" @click="emit('create-project')">
          Create project
        </button>
      </div>

      <div v-else class="dashboard-home-projects-carousel">
        <div class="dashboard-home-projects-track">
          <article
            v-for="project in visibleProjects"
            :key="project.id"
            class="dashboard-home-project-card"
          >
            <div class="dashboard-home-project-head">
              <h3 class="dashboard-home-project-title">{{ project.title }}</h3>
              <span class="dashboard-home-status-pill" :data-variant="statusVariant(project.status)">
                <span class="dashboard-home-status-dot" aria-hidden="true"></span>
                {{ statusLabel(project.status) }}
              </span>
            </div>
            <p class="dashboard-home-project-client">{{ project.clientName }}</p>
            <div class="dashboard-home-project-metrics" role="presentation">
              <div class="dashboard-home-project-metric">
                <span class="dashboard-home-project-metric-label">Amount (PKR)</span>
                <span class="dashboard-home-project-metric-value">{{ project.amountFormatted }}</span>
              </div>
              <div class="dashboard-home-project-divider" aria-hidden="true"></div>
              <div class="dashboard-home-project-metric">
                <span class="dashboard-home-project-metric-label">Payment Type</span>
                <span class="dashboard-home-project-metric-value dashboard-home-project-metric-value--muted">
                  {{ normalizePaymentType(project.paymentType) }}
                </span>
              </div>
              <div class="dashboard-home-project-divider" aria-hidden="true"></div>
              <div class="dashboard-home-project-metric">
                <span class="dashboard-home-project-metric-label">Date Due</span>
                <span class="dashboard-home-project-metric-value dashboard-home-project-metric-value--muted">
                  {{ project.dueDateDisplay }}
                </span>
              </div>
            </div>
          </article>
        </div>

        <div v-if="hasProjectCards" class="dashboard-home-projects-controls">
          <div class="dashboard-home-dots" role="tablist" aria-label="Projects pages">
            <button
              v-for="n in totalCarouselPages"
              :key="n"
              type="button"
              class="dashboard-home-dot"
              :class="{ 'dashboard-home-dot--active': n - 1 === carouselPage }"
              :aria-current="n - 1 === carouselPage ? 'true' : undefined"
              @click="setCarouselPage(n - 1)"
            >
              <span class="dashboard-home-dot-sr">Page {{ n }}</span>
            </button>
          </div>

          <div class="dashboard-home-arrows" aria-label="Projects navigation">
            <button
              type="button"
              class="dashboard-home-arrow"
              :disabled="carouselPage <= 0"
              @click="prevCarouselPage"
              aria-label="Previous projects"
            >
              ‹
            </button>
            <button
              type="button"
              class="dashboard-home-arrow"
              :disabled="carouselPage >= totalCarouselPages - 1"
              @click="nextCarouselPage"
              aria-label="Next projects"
            >
              ›
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="dashboard-section">
      <div class="dashboard-section-header">
        <h2>Transactions</h2>
        <button
          v-if="hasTransactions"
          class="dashboard-link"
          type="button"
          @click="emit('record-transactions')"
        >
          View transactions
        </button>
      </div>

      <div v-if="isLoading" class="dashboard-card dashboard-home-loading">Loading...</div>

      <div v-else-if="!hasTransactions" class="dashboard-card dashboard-home-empty">
        <img
          class="dashboard-home-empty-illustration"
          src="@/assets/icons/Group.svg"
          alt=""
        />
        <div class="dashboard-home-empty-title">Start tracking your finances</div>
        <div class="dashboard-home-empty-subtitle">
          You can track your incoming and outgoing transactions here
        </div>
        <button class="dashboard-home-empty-cta" type="button" @click="emit('record-transactions')">
          Record Transactions
        </button>
      </div>

      <div v-else class="dashboard-card dashboard-home-transactions">
        <div class="dashboard-home-transactions-list">
          <div v-for="group in transactionGroups" :key="group.label" class="dashboard-home-transactions-group">
            <div class="dashboard-home-transactions-group-title">{{ group.label }}</div>
            <div class="dashboard-home-transactions-rows">
              <div v-for="row in group.rows" :key="row.id" class="dashboard-home-transaction-row">
                <div
                  class="dashboard-home-transaction-icon"
                  :class="row.direction === 'in' ? 'dashboard-home-transaction-icon--in' : 'dashboard-home-transaction-icon--out'"
                  aria-hidden="true"
                >
                  <span v-if="row.direction === 'in'">↓</span>
                  <span v-else>↑</span>
                </div>
                <div class="dashboard-home-transaction-main">
                  <div class="dashboard-home-transaction-name">{{ row.accountName }}</div>
                  <div class="dashboard-home-transaction-sub">{{ row.projectTitle }}</div>
                </div>
                <div class="dashboard-home-transaction-meta">
                  <div
                    class="dashboard-home-transaction-amount"
                    :class="{ 'dashboard-home-transaction-amount--negative': row.direction === 'out' }"
                  >
                    {{ row.amountMasked }}
                  </div>
                  <div class="dashboard-home-transaction-time">{{ row.timeLabel }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.dashboard-home {
  display: contents;
}

.dashboard-home-projects-carousel {
  width: 100%;
  display: grid;
  gap: 10px;
}

.dashboard-home-projects-track {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

@media (max-width: 1100px) {
  .dashboard-home-projects-track {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .dashboard-home-projects-track {
    grid-template-columns: 1fr;
  }
}

.dashboard-home-project-card {
  border-radius: 12px;
  border: 1px solid #e8ecf1;
  background: #ffffff;
  padding: 16px 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}

.dashboard-home-project-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.dashboard-home-project-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.35;
  flex: 1;
  min-width: 0;
}

.dashboard-home-project-client {
  margin: 0;
  font-size: 0.8125rem;
  color: #94a3b8;
}

.dashboard-home-project-metrics {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto 1fr;
  align-items: stretch;
  gap: 0;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid #f1f5f9;
}

.dashboard-home-project-metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 0 4px;
}

.dashboard-home-project-metric-label {
  font-size: 0.6875rem;
  font-weight: 500;
  color: #94a3b8;
}

.dashboard-home-project-metric-value {
  font-size: 0.875rem;
  font-weight: 700;
  color: #0f172a;
}

.dashboard-home-project-metric-value--muted {
  font-weight: 600;
  color: #334155;
}

.dashboard-home-project-divider {
  width: 1px;
  background: #e2e8f0;
  align-self: stretch;
  min-height: 36px;
}

.dashboard-home-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 0.625rem;
  font-weight: 600;
  flex-shrink: 0;
  max-width: 48%;
}

.dashboard-home-status-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  position: relative;
}

.dashboard-home-status-dot::after {
  content: "";
  position: absolute;
  inset: 3px;
  border-radius: 999px;
  background: currentColor;
}

.dashboard-home-status-pill[data-variant="signed"] {
  background: #eef2ff;
  border-color: #dbeafe;
  color: #1e293b;
}

.dashboard-home-status-pill[data-variant="signed"] .dashboard-home-status-dot {
  background: #dbeafe;
}

.dashboard-home-status-pill[data-variant="completed"] {
  background: #ecfdf3;
  border-color: #bbf7d0;
  color: #166534;
}

.dashboard-home-status-pill[data-variant="completed"] .dashboard-home-status-dot {
  background: #22c55e;
}

.dashboard-home-status-pill[data-variant="in-dispute"] {
  background: #fef2f2;
  border-color: #fecaca;
  color: #dc2626;
}

.dashboard-home-status-pill[data-variant="in-dispute"] .dashboard-home-status-dot {
  background: #ef4444;
}

.dashboard-home-status-pill[data-variant="payment-due"] {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}

.dashboard-home-status-pill[data-variant="payment-due"] .dashboard-home-status-dot {
  background: #f87171;
}

.dashboard-home-status-pill[data-variant="delayed"] {
  background: #f1f5f9;
  border-color: #e2e8f0;
  color: #475569;
}

.dashboard-home-status-pill[data-variant="delayed"] .dashboard-home-status-dot {
  background: #94a3b8;
}

.dashboard-home-status-pill[data-variant="in-progress"] {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1d4ed8;
}

.dashboard-home-status-pill[data-variant="in-progress"] .dashboard-home-status-dot {
  background: #3b82f6;
}

.dashboard-home-status-pill[data-variant="draft"] {
  background: #f3f4f6;
  border-color: #e5e7eb;
  color: #4b5563;
}

.dashboard-home-status-pill[data-variant="draft"] .dashboard-home-status-dot {
  background: #9ca3af;
}

.dashboard-home-projects-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 2px;
}

.dashboard-home-dots {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.dashboard-home-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  border: none;
  background: #e2e8f0;
  padding: 0;
  cursor: pointer;
}

.dashboard-home-dot--active {
  background: #0f172a;
}

.dashboard-home-dot-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.dashboard-home-arrows {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.dashboard-home-arrow {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #0f172a;
  cursor: pointer;
  display: grid;
  place-items: center;
  font-size: 18px;
  line-height: 1;
  box-shadow: 0 1px 0 rgba(15, 23, 42, 0.05);
}

.dashboard-home-arrow:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.dashboard-home-loading {
  color: #64748b;
  font-size: 0.875rem;
}

.dashboard-home-empty {
  min-height: 180px;
  padding: 22px 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 6px;
}

.dashboard-home-empty-illustration {
  width: 92px;
  height: 60px;
  object-fit: contain;
  margin-bottom: 6px;
}

.dashboard-home-empty-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #0f172a;
}

.dashboard-home-empty-subtitle {
  font-size: 0.75rem;
  color: #94a3b8;
  margin-bottom: 8px;
  max-width: 520px;
}

.dashboard-home-empty-cta {
  height: 34px;
  padding: 0 18px;
  border-radius: 999px;
  border: 1px solid #0f172a;
  background: #ffffff;
  color: #0f172a;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.dashboard-home-empty-cta:hover {
  background: #f8fafc;
}

.dashboard-home-nonempty-note {
  color: #64748b;
  font-size: 0.875rem;
}

.dashboard-home-transactions {
  padding: 14px 16px;
}

.dashboard-home-transactions-list {
  display: grid;
  gap: 14px;
}

.dashboard-home-transactions-group-title {
  font-size: 0.75rem;
  color: #94a3b8;
  margin-bottom: 8px;
}

.dashboard-home-transactions-rows {
  display: grid;
  gap: 12px;
}

.dashboard-home-transaction-row {
  display: grid;
  grid-template-columns: 34px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 10px 6px;
  border-radius: 10px;
}

.dashboard-home-transaction-row:hover {
  background: #f8fafc;
}

.dashboard-home-transaction-icon {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 14px;
  line-height: 1;
}

.dashboard-home-transaction-icon--in {
  background: #dcfce7;
  color: #16a34a;
}

.dashboard-home-transaction-icon--out {
  background: #fee2e2;
  color: #ef4444;
}

.dashboard-home-transaction-main {
  min-width: 0;
}

.dashboard-home-transaction-name {
  font-size: 0.75rem;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: 0.02em;
}

.dashboard-home-transaction-sub {
  font-size: 0.7rem;
  color: #94a3b8;
}

.dashboard-home-transaction-meta {
  text-align: right;
}

.dashboard-home-transaction-amount {
  font-size: 0.8rem;
  font-weight: 700;
  color: #0f172a;
}

.dashboard-home-transaction-amount--negative {
  color: #ef4444;
}

.dashboard-home-transaction-time {
  font-size: 0.68rem;
  color: #94a3b8;
  margin-top: 2px;
}
</style>

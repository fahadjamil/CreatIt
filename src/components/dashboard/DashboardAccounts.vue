<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { getAccountStatement } from "@/lib/api";

type StatementRow = {
  id: string;
  occurredAt: string;
  dateLabel: string;
  accountName: string;
  projectTitle: string;
  direction: "in" | "out";
  amountLabel: string;
};

const isLoading = ref(false);
const rows = ref<StatementRow[]>([]);

function parseDateLoose(raw: string): Date | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;

  // Fast path: native parse handles ISO/RFC formats.
  const native = new Date(v);
  if (!Number.isNaN(native.getTime())) return native;

  // Common backend formats: "YYYY-MM-DD" or "YYYY-MM-DD HH:mm:ss"
  const ymd = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]) - 1;
    const d = Number(ymd[3]);
    const hh = Number(ymd[4] ?? "0");
    const mm = Number(ymd[5] ?? "0");
    const ss = Number(ymd[6] ?? "0");
    const dt = new Date(y, m, d, hh, mm, ss);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  // Common UI/API formats: "DD-MM-YYYY" or "DD/MM/YYYY" (optionally with time)
  const dmy = /^(\d{2})[\/-](\d{2})[\/-](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]) - 1;
    const y = Number(dmy[3]);
    const hh = Number(dmy[4] ?? "0");
    const mm = Number(dmy[5] ?? "0");
    const ss = Number(dmy[6] ?? "0");
    const dt = new Date(y, m, d, hh, mm, ss);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  // Epoch seconds/ms
  const asNum = Number(v);
  if (Number.isFinite(asNum) && asNum > 0) {
    const ms = asNum < 1e12 ? asNum * 1000 : asNum;
    const dt = new Date(ms);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  return null;
}

function extractOccurredAt(item: any): string {
  // Prefer explicit date fields first, then fall back to created/timestamp.
  const candidates: unknown[] = [
    item?.transaction_date,
    item?.transactionDate,
    item?.txn_date,
    item?.txnDate,
    item?.value_date,
    item?.valueDate,
    item?.posted_at,
    item?.postedAt,
    item?.booking_date,
    item?.bookingDate,
    item?.created_at,
    item?.createdAt,
    item?.date,
    item?.datetime,
    item?.time,
    item?.timestamp,
    item?.meta?.transaction_date,
    item?.meta?.value_date,
    item?.meta?.posted_at,
    item?.meta?.created_at,
  ];

  for (const c of candidates) {
    const t = safePrimitiveText(c) || safeObjectLabel(c);
    if (t) return t;
  }
  return "";
}

function safePrimitiveText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return "";
}

function safeObjectLabel(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const o = value as Record<string, unknown>;
  return (
    safePrimitiveText(o.name) ||
    safePrimitiveText(o.title) ||
    safePrimitiveText(o.display_name) ||
    safePrimitiveText(o.project_name) ||
    safePrimitiveText(o.account_name) ||
    safePrimitiveText(o.account_title) ||
    ""
  );
}

function pickFirstLabel(candidates: Array<unknown>): string {
  for (const c of candidates) {
    const t = safePrimitiveText(c) || safeObjectLabel(c);
    if (t) return t;
  }
  return "";
}

function extractAccountName(item: any): string {
  return pickFirstLabel([
    item?.account_name,
    item?.accountName,
    item?.account_title,
    item?.accountTitle,
    item?.account,
    item?.bank_account,
    item?.bankAccount,
    item?.sender_name,
    item?.sender,
    item?.receiver_name,
    item?.receiver,
    item?.from_account,
    item?.fromAccount,
    item?.to_account,
    item?.toAccount,
    item?.counterparty_name,
    item?.counterparty,
    item?.name,
  ]);
}

function extractProjectTitle(item: any): string {
  return pickFirstLabel([
    item?.project_title,
    item?.projectTitle,
    item?.project_name,
    item?.projectName,
    item?.project,
    item?.meta?.project_title,
    item?.meta?.project_name,
    item?.reference,
    item?.description,
    item?.narration,
    item?.particular,
    item?.remarks,
  ]);
}

function formatDate(raw: string): string {
  const d = parseDateLoose(raw);
  if (!d) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${day}-${month}-${yy}`;
}

function normalizeStatementResponse(raw: any): any[] {
  if (Array.isArray(raw?.data?.data)) return raw.data.data;
  if (Array.isArray(raw?.data?.statement)) return raw.data.statement;
  if (Array.isArray(raw?.data?.transactions)) return raw.data.transactions;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw)) return raw;
  return [];
}

function mapDirection(item: any, amountNum: number): "in" | "out" {
  const type = String(item?.type ?? item?.direction ?? item?.txn_type ?? "")
    .trim()
    .toLowerCase();
  if (type === "debit" || type === "out" || type === "withdrawal" || type === "payment") return "out";
  if (type === "credit" || type === "in" || type === "deposit" || type === "receipt") return "in";
  if (Number.isFinite(amountNum) && amountNum < 0) return "out";
  return "in";
}

async function loadStatement() {
  isLoading.value = true;
  try {
    const res = await getAccountStatement();
    const list = normalizeStatementResponse(res?.data);
    const mapped: StatementRow[] = list.map((item: any, idx: number) => {
      const occurredAt = extractOccurredAt(item);
      const amountRaw =
        item?.amount ??
        item?.transaction_amount ??
        item?.value ??
        item?.net_amount ??
        item?.netAmount ??
        0;
      const amountNum = Number(amountRaw);
      const direction = mapDirection(item, amountNum);
      const absAmount = Number.isFinite(amountNum) ? Math.abs(amountNum) : 0;
      const currency = String(item?.currency ?? item?.currency_code ?? "PKR").trim() || "PKR";
      const amountLabel = `${direction === "out" ? "-" : ""}${currency} ${absAmount.toLocaleString("en-PK", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

      return {
        id: String(item?.id ?? item?.uuid ?? `${occurredAt || "row"}-${idx}`),
        occurredAt,
        dateLabel: formatDate(occurredAt),
        accountName: extractAccountName(item) || "—",
        projectTitle: extractProjectTitle(item) || "—",
        direction,
        amountLabel,
      };
    });

    mapped.sort((a, b) => {
      const ad = parseDateLoose(a.occurredAt)?.getTime() ?? 0;
      const bd = parseDateLoose(b.occurredAt)?.getTime() ?? 0;
      return bd - ad;
    });

    rows.value = mapped;
  } catch {
    rows.value = [];
  } finally {
    isLoading.value = false;
  }
}

const hasRows = computed(() => rows.value.length > 0);

onMounted(() => {
  loadStatement();
});
</script>

<template>
  <div class="accounts-screen">
    <div class="accounts-header">
      <div>
        <h2 class="accounts-title">Accounts</h2>
        <p class="accounts-subtitle">Account statement</p>
      </div>
      <button type="button" class="accounts-refresh" :disabled="isLoading" @click="loadStatement">
        {{ isLoading ? "Loading..." : "Refresh" }}
      </button>
    </div>

    <div v-if="isLoading" class="accounts-card accounts-placeholder">Loading statement...</div>

    <div v-else-if="!hasRows" class="accounts-card accounts-placeholder">
      No transactions found.
    </div>

    <div v-else class="accounts-table-wrap">
      <table class="accounts-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Date</th>
            <th>Account</th>
            <th>Project</th>
            <th>Type</th>
            <th class="accounts-amount-head">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, index) in rows" :key="r.id">
            <td>{{ index + 1 }}</td>
            <td>{{ r.dateLabel }}</td>
            <td class="accounts-ellipsis">{{ r.accountName }}</td>
            <td class="accounts-ellipsis">{{ r.projectTitle }}</td>
            <td>
              <span class="accounts-pill" :data-variant="r.direction">
                {{ r.direction === "in" ? "Credit" : "Debit" }}
              </span>
            </td>
            <td class="accounts-amount" :class="{ 'accounts-amount--negative': r.direction === 'out' }">
              {{ r.amountLabel }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.accounts-screen {
  width: 100%;
  min-height: calc(100vh - 120px);
  padding: 18px 24px 28px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.accounts-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.accounts-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  color: #0f172a;
}

.accounts-subtitle {
  margin: 2px 0 0;
  font-size: 0.8125rem;
  color: #64748b;
}

.accounts-refresh {
  height: 34px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #0f172a;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.accounts-refresh:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.accounts-card {
  border-radius: 12px;
  border: 1px solid #e8ecf1;
  background: #ffffff;
  padding: 16px 18px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}

.accounts-placeholder {
  font-size: 0.875rem;
  color: #64748b;
}

.accounts-table-wrap {
  width: 100%;
  overflow-x: auto;
  border-radius: 10px;
  border: 1px solid #e5e7eb;
  background: #ffffff;
}

.accounts-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 900px;
  text-align: left;
}

.accounts-table th,
.accounts-table td {
  border-bottom: 1px solid #f0f2f5;
  padding: 14px 14px;
  font-size: 0.78rem;
  color: #1f2937;
  white-space: nowrap;
}

.accounts-table th {
  font-size: 0.7rem;
  color: #6b7280;
  font-weight: 600;
  background: #ffffff;
}

.accounts-amount-head {
  text-align: right;
}

.accounts-amount {
  text-align: right;
  font-weight: 700;
  color: #0f172a;
}

.accounts-amount--negative {
  color: #ef4444;
}

.accounts-pill {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  color: #334155;
}

.accounts-pill[data-variant="in"] {
  border-color: #bbf7d0;
  background: #f0fdf4;
  color: #166534;
}

.accounts-pill[data-variant="out"] {
  border-color: #fecaca;
  background: #fef2f2;
  color: #991b1b;
}

.accounts-ellipsis {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>


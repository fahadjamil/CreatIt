<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  getCalendar,
  type CalendarInvoiceRow,
  type CalendarPayload,
  type CalendarProjectRow,
} from "@/lib/api";
import { useAlerts } from "@/composables/useAlerts";
import { projectStatusLabel } from "@/lib/projectStatus";

const { pushAlert } = useAlerts();

type CalendarCell = {
  key: string;
  day: number;
  date: Date;
  inCurrentMonth: boolean;
};

const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const today = new Date();
const viewMonthDate = ref(new Date(today.getFullYear(), today.getMonth(), 1));
const selectedDate = ref(new Date(today.getFullYear(), today.getMonth(), today.getDate()));

const calendarPayload = ref<CalendarPayload | null>(null);
const loading = ref(false);
const sideTab = ref<"invoices" | "projects">("invoices");

function formatDateYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthRange(monthStart: Date): { from_date: string; to_date: string } {
  const y = monthStart.getFullYear();
  const m = monthStart.getMonth();
  const from = new Date(y, m, 1);
  const to = new Date(y, m + 1, 0);
  return { from_date: formatDateYMD(from), to_date: formatDateYMD(to) };
}

async function fetchCalendar() {
  loading.value = true;
  try {
    const { from_date, to_date } = monthRange(viewMonthDate.value);
    const res = await getCalendar({ from_date, to_date });
    const body = res.data as { data?: CalendarPayload };
    calendarPayload.value = body.data ?? (res.data as unknown as CalendarPayload) ?? null;
  } catch {
    calendarPayload.value = null;
    pushAlert({
      kind: "error",
      title: "Calendar unavailable",
      message: "We could not load this month. Check your connection and try again.",
    });
  } finally {
    loading.value = false;
  }
}

watch(
  viewMonthDate,
  () => {
    void fetchCalendar();
  },
  { immediate: true },
);

const monthLabel = computed(() =>
  viewMonthDate.value.toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  }),
);

const selectedDateLabel = computed(() =>
  selectedDate.value.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }),
);

const summaryLine = computed(() => {
  const p = calendarPayload.value;
  if (!p) return "";
  return `${p.project_count} project${p.project_count === 1 ? "" : "s"} · ${p.invoice_count} invoice${p.invoice_count === 1 ? "" : "s"} · ${p.holiday_count} holiday${p.holiday_count === 1 ? "" : "s"}`;
});

const calendarCells = computed<CalendarCell[]>(() => {
  const year = viewMonthDate.value.getFullYear();
  const month = viewMonthDate.value.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekDay = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const cells: CalendarCell[] = [];

  for (let i = 0; i < startWeekDay; i += 1) {
    const day = daysInPrevMonth - startWeekDay + i + 1;
    const date = new Date(year, month - 1, day);
    cells.push({
      key: `prev-${formatDateYMD(date)}`,
      day,
      date,
      inCurrentMonth: false,
    });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    cells.push({
      key: `curr-${formatDateYMD(date)}`,
      day,
      date,
      inCurrentMonth: true,
    });
  }

  while (cells.length < 42) {
    const day = cells.length - (startWeekDay + daysInMonth) + 1;
    const date = new Date(year, month + 1, day);
    cells.push({
      key: `next-${formatDateYMD(date)}`,
      day,
      date,
      inCurrentMonth: false,
    });
  }

  return cells;
});

/** YYYY-MM-DD for calendar dots; prefers due date, then issued. */
function rawToYMD(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const d = new Date(raw > 1e12 ? raw : raw * 1000);
    if (!Number.isNaN(d.getTime())) return formatDateYMD(d);
  }
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return formatDateYMD(d);
  return null;
}

function pickInvoiceIssuedRaw(inv: CalendarInvoiceRow): unknown {
  return (
    inv.issued_at ??
    inv.issuedAt ??
    inv.issued_on ??
    inv.issue_date ??
    inv.invoice_date ??
    inv.date_issued ??
    inv.created_at ??
    inv.createdAt ??
    inv.date
  );
}

function pickInvoiceDueRaw(inv: CalendarInvoiceRow): unknown {
  return inv.due_date ?? inv.due_on ?? inv.dueDate ?? inv.due_at ?? inv.dueAt;
}

function pickInvoicePaidRaw(inv: CalendarInvoiceRow): unknown {
  const meta =
    inv.meta && typeof inv.meta === "object" && !Array.isArray(inv.meta)
      ? (inv.meta as Record<string, unknown>)
      : null;
  return (
    inv.paid_date ??
    meta?.paid_date ??
    meta?.paid_at ??
    inv.paid_at ??
    inv.paidAt ??
    inv.payment_date ??
    inv.paid_on ??
    inv.settled_at ??
    inv.settledAt
  );
}

function invoiceIsPaid(inv: CalendarInvoiceRow): boolean {
  const s = String(inv.status ?? inv.state ?? inv.invoice_status ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return s === "paid" || s === "settled";
}

/** Calendar dot / day association: paid invoices use paid date when present; else due, then issued. */
function invoicePrimaryDate(inv: CalendarInvoiceRow): string | null {
  if (invoiceIsPaid(inv)) {
    const paidYmd = rawToYMD(pickInvoicePaidRaw(inv));
    if (paidYmd) return paidYmd;
  }
  return rawToYMD(pickInvoiceDueRaw(inv)) ?? rawToYMD(pickInvoiceIssuedRaw(inv));
}

function invoiceRowKey(inv: CalendarInvoiceRow, index: number): string {
  const id = inv.id ?? inv.uuid;
  return id != null ? String(id) : `invoice-${index}`;
}

function invoiceTitle(inv: CalendarInvoiceRow): string {
  return String(inv.project_name ?? inv.title ?? inv.invoice_title ?? "Invoice");
}

function invoiceClient(inv: CalendarInvoiceRow): string {
  return String(inv.client_display_name ?? inv.client_name ?? inv.customer_name ?? "");
}

function invoiceNumberLine(inv: CalendarInvoiceRow): string {
  const n = inv.invoice_no ?? inv.invoice_number ?? inv.number ?? inv.code;
  return n ? String(n) : "";
}

function parseMoneyish(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/** Matches project-details / typical API: amount_total, strings with commas, etc. */
function invoiceAmountLine(inv: CalendarInvoiceRow): string {
  const keys = [
    "amount_total",
    "total_amount",
    "grand_total",
    "total",
    "amount",
    "subtotal",
    "amount_subtotal",
    "invoice_amount",
    "balance",
  ] as const;
  for (const k of keys) {
    const n = parseMoneyish(inv[k]);
    if (n != null) return n.toLocaleString("en-PK");
  }
  return "—";
}

function invoiceStatusLine(inv: CalendarInvoiceRow): string {
  return String(inv.status ?? inv.state ?? inv.invoice_status ?? "").trim() || "—";
}

function formatShortDate(raw: unknown): string {
  if (raw == null || raw === "") return "—";
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" });
    }
  }
  const s = String(raw).trim();
  if (!s) return "—";
  const d = new Date(/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" });
  }
  return "—";
}

function hasHoliday(cell: CalendarCell): boolean {
  if (!cell.inCurrentMonth) return false;
  const key = formatDateYMD(cell.date);
  return calendarPayload.value?.holidays?.some((h) => h.date.slice(0, 10) === key) ?? false;
}

function hasProjectOrInvoiceEvent(cell: CalendarCell): boolean {
  if (!cell.inCurrentMonth) return false;
  const key = formatDateYMD(cell.date);
  const p = calendarPayload.value;
  const proj = p?.projects?.some((pr) => pr.end_date?.slice(0, 10) === key) ?? false;
  const inv =
    p?.invoices?.some((row) => invoicePrimaryDate(row as CalendarInvoiceRow) === key) ?? false;
  return proj || inv;
}

function hasEvents(cell: CalendarCell): boolean {
  return hasHoliday(cell) || hasProjectOrInvoiceEvent(cell);
}

function isSameDate(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

function isSelected(cell: CalendarCell) {
  return isSameDate(cell.date, selectedDate.value);
}

function goToToday() {
  const now = new Date();
  viewMonthDate.value = new Date(now.getFullYear(), now.getMonth(), 1);
  selectedDate.value = new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function goToPreviousMonth() {
  const prev = new Date(viewMonthDate.value);
  prev.setMonth(prev.getMonth() - 1);
  viewMonthDate.value = new Date(prev.getFullYear(), prev.getMonth(), 1);
}

function goToNextMonth() {
  const next = new Date(viewMonthDate.value);
  next.setMonth(next.getMonth() + 1);
  viewMonthDate.value = new Date(next.getFullYear(), next.getMonth(), 1);
}

function selectDate(cell: CalendarCell) {
  selectedDate.value = new Date(cell.date.getFullYear(), cell.date.getMonth(), cell.date.getDate());
  if (!cell.inCurrentMonth) {
    viewMonthDate.value = new Date(cell.date.getFullYear(), cell.date.getMonth(), 1);
  }
}

function formatProjectEnd(p: CalendarProjectRow): string {
  if (!p.end_date) return "—";
  return formatShortDate(p.end_date);
}

const invoicesList = computed<CalendarInvoiceRow[]>(
  () => (calendarPayload.value?.invoices ?? []) as CalendarInvoiceRow[],
);
const projectsList = computed(() => calendarPayload.value?.projects ?? []);

const selectedDateYmd = computed(() => formatDateYMD(selectedDate.value));

const invoicesForSelectedDate = computed(() => {
  const key = selectedDateYmd.value;
  return invoicesList.value.filter((inv) => invoicePrimaryDate(inv) === key);
});

const projectsForSelectedDate = computed(() => {
  const key = selectedDateYmd.value;
  return projectsList.value.filter((p) => String(p.end_date ?? "").slice(0, 10) === key);
});
</script>

<template>
  <section class="calendar-screen">
    <div class="calendar-layout">
      <article class="calendar-panel">
        <h2 class="calendar-title">Calendar</h2>
        <p v-if="summaryLine" class="calendar-summary">{{ summaryLine }}</p>
        <div class="calendar-card">
          <div class="calendar-card-head">
            <div class="calendar-card-head-date">
              <strong>{{ selectedDateLabel }}</strong>
              <span class="calendar-card-head-hint">Select a day to see invoices and projects for that date</span>
            </div>
            <div class="calendar-actions">
              <span class="calendar-month">{{ monthLabel }}</span>
              <span v-if="loading" class="calendar-loading">Loading…</span>
              <button type="button" class="calendar-chip calendar-chip--today" @click="goToToday">Today</button>
              <button
                type="button"
                class="calendar-icon-btn"
                aria-label="Previous"
                :disabled="loading"
                @click="goToPreviousMonth"
              >
                ‹
              </button>
              <button
                type="button"
                class="calendar-icon-btn"
                aria-label="Next"
                :disabled="loading"
                @click="goToNextMonth"
              >
                ›
              </button>
            </div>
          </div>
          <div class="calendar-grid">
            <div v-for="day in weekDays" :key="day" class="calendar-weekday">{{ day }}</div>

            <div v-for="cell in calendarCells" :key="cell.key" class="calendar-day">
              <button
                type="button"
                class="calendar-day-hit"
                :class="{
                  'calendar-day-hit--selected': isSelected(cell),
                  'calendar-day-hit--faded': !cell.inCurrentMonth,
                }"
                @click="selectDate(cell)"
              >
                <span class="calendar-day-num">{{ cell.day }}</span>
                <span v-if="hasEvents(cell)" class="calendar-dot-row" aria-hidden="true">
                  <span v-if="hasHoliday(cell)" class="calendar-dot calendar-dot--holiday"></span>
                  <span
                    v-if="hasProjectOrInvoiceEvent(cell)"
                    class="calendar-dot"
                    :class="{ 'calendar-dot--muted': hasHoliday(cell) }"
                  ></span>
                </span>
              </button>
            </div>
          </div>
        </div>
      </article>

      <aside class="calendar-side-panel">
        <div class="calendar-segmented">
          <button
            type="button"
            class="calendar-segmented-item"
            :class="{ 'calendar-segmented-item--active': sideTab === 'invoices' }"
            @click="sideTab = 'invoices'"
          >
            Invoices ({{ calendarPayload?.invoice_count ?? 0 }})
          </button>
          <button
            type="button"
            class="calendar-segmented-item"
            :class="{ 'calendar-segmented-item--active': sideTab === 'projects' }"
            @click="sideTab = 'projects'"
          >
            Projects ({{ calendarPayload?.project_count ?? 0 }})
          </button>
        </div>

        <p class="calendar-side-date-line">Showing: <strong>{{ selectedDateLabel }}</strong></p>

        <template v-if="sideTab === 'invoices'">
          <p v-if="!loading && invoicesList.length === 0" class="calendar-empty">No invoices in this month.</p>
          <p v-else-if="!loading && invoicesForSelectedDate.length === 0" class="calendar-empty">
            No invoices on this date. Choose another day or use month arrows.
          </p>
          <article v-for="(inv, idx) in invoicesForSelectedDate" :key="invoiceRowKey(inv, idx)" class="invoice-card">
            <div class="invoice-card-head">
              <div>
                <h3>{{ invoiceTitle(inv) }}</h3>
                <p v-if="invoiceClient(inv)">{{ invoiceClient(inv) }}</p>
                <p v-if="invoiceNumberLine(inv)">{{ invoiceNumberLine(inv) }}</p>
              </div>
              <div class="invoice-card-badge-wrap">
                <span class="invoice-status">{{ invoiceStatusLine(inv) }}</span>
              </div>
            </div>
            <div class="invoice-card-meta">
              <div>
                <span>Amount (PKR)</span>
                <strong>{{ invoiceAmountLine(inv) }}</strong>
              </div>
              <div>
                <span>Date issued</span>
                <strong>{{ formatShortDate(pickInvoiceIssuedRaw(inv)) }}</strong>
              </div>
              <div>
                <span>Date due</span>
                <strong>{{ formatShortDate(pickInvoiceDueRaw(inv)) }}</strong>
              </div>
              <div v-if="invoiceIsPaid(inv)">
                <span>Date paid</span>
                <strong>{{ formatShortDate(pickInvoicePaidRaw(inv)) }}</strong>
              </div>
            </div>
          </article>
        </template>

        <template v-else>
          <p v-if="!loading && projectsList.length === 0" class="calendar-empty">No projects ending in this month.</p>
          <p v-else-if="!loading && projectsForSelectedDate.length === 0" class="calendar-empty">
            No projects ending on this date.
          </p>
          <article v-for="p in projectsForSelectedDate" :key="p.id" class="project-card">
            <div class="invoice-card-head">
              <div>
                <h3>{{ p.project_name }}</h3>
                <p>{{ p.client_display_name }}</p>
                <p class="project-card-end">End date {{ formatProjectEnd(p) }}</p>
              </div>
              <div class="invoice-card-badge-wrap">
                <span class="invoice-status">{{ projectStatusLabel(p.status) }}</span>
              </div>
            </div>
          </article>
        </template>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.calendar-screen {
  width: 100%;
}

.calendar-layout {
  display: grid;
  grid-template-columns: 1.45fr 1fr;
  gap: 18px;
}

.calendar-title {
  margin: 0 0 10px;
  font-size: 1.9rem;
  font-weight: 500;
  color: #131c2c;
}

.calendar-summary {
  margin: 0 0 12px;
  font-size: 0.88rem;
  color: #6b7280;
}

.calendar-card {
  border: 1px solid #e6e8ee;
  border-radius: 16px;
  background: #ffffff;
  padding: 18px 18px 10px;
}

.calendar-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 14px;
  border-bottom: 1px solid #eef0f4;
}

.calendar-card-head strong {
  font-size: 1.1rem;
  color: #111827;
}

.calendar-card-head-date {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.calendar-card-head-hint {
  font-size: 0.72rem;
  font-weight: 400;
  color: #9aa0ac;
  line-height: 1.3;
}

.calendar-side-date-line {
  margin: 0;
  font-size: 0.82rem;
  color: #6b7280;
}

.calendar-side-date-line strong {
  font-size: inherit;
  color: #111827;
}

.calendar-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.calendar-month {
  font-size: 0.82rem;
  color: #6b7280;
  min-width: 78px;
  text-align: center;
}

.calendar-loading {
  font-size: 0.78rem;
  color: #9aa0ac;
}

.calendar-chip {
  border: 1px solid #d8dde7;
  background: #ffffff;
  color: #1f2937;
  border-radius: 999px;
  padding: 7px 16px;
  font-size: 0.85rem;
  cursor: pointer;
}

.calendar-chip--today {
  font-weight: 600;
}

.calendar-icon-btn {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  border: 1px solid #d8dde7;
  background: #ffffff;
  color: #7c8596;
  font-size: 1rem;
  cursor: pointer;
}

.calendar-icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  row-gap: 14px;
  column-gap: 8px;
  padding: 12px 4px 8px;
}

.calendar-weekday {
  font-size: 0.78rem;
  color: #9aa0ac;
  text-align: center;
}

.calendar-day {
  min-height: 56px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

.calendar-day-hit {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  max-width: 52px;
  margin: 0;
  padding: 2px 2px 4px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.calendar-day-hit:focus-visible {
  outline: 2px solid #0f234a;
  outline-offset: 2px;
}

.calendar-day-num {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  color: #2d3648;
  font-size: 0.95rem;
}

.calendar-day-hit--faded .calendar-day-num {
  color: #a9afba;
}

.calendar-day-hit--selected .calendar-day-num {
  background: #0f234a;
  color: #ffffff;
  font-weight: 600;
}

.calendar-dot-row {
  display: inline-flex;
  gap: 4px;
  min-height: 6px;
  align-items: center;
  justify-content: center;
}

.calendar-dot {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: #384565;
}

.calendar-dot--muted {
  background: #d1d5df;
}

.calendar-dot--holiday {
  background: #7c3aed;
}

.calendar-side-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.calendar-empty {
  margin: 8px 0;
  font-size: 0.9rem;
  color: #6b7280;
}

.calendar-segmented {
  display: inline-flex;
  width: fit-content;
  gap: 8px;
  flex-wrap: wrap;
}

.calendar-segmented-item {
  border: 1px solid #e4e7ee;
  background: #ffffff;
  color: #5d6780;
  border-radius: 999px;
  padding: 8px 16px;
  font-size: 0.85rem;
  cursor: pointer;
}

.calendar-segmented-item--active {
  background: #0f234a;
  border-color: #0f234a;
  color: #ffffff;
}

.invoice-card {
  border: 1px solid #e8ebf1;
  border-radius: 12px;
  background: #ffffff;
  padding: 14px 16px;
}

.project-card {
  border: 1px solid #e8ebf1;
  border-radius: 12px;
  background: #ffffff;
  padding: 14px 16px;
}

.project-card-end {
  font-size: 0.74rem;
  color: #5d6780;
}

.invoice-card-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.invoice-card-head h3 {
  margin: 0;
  font-size: 1.45rem;
  color: #1b2435;
  line-height: 1.05;
}

.invoice-card-head p {
  margin: 2px 0 0;
  font-size: 0.74rem;
  color: #8a93a3;
}

.invoice-card-badge-wrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.invoice-status {
  display: inline-flex;
  align-items: center;
  height: 28px;
  border-radius: 999px;
  border: 1px solid #d9deea;
  padding: 0 11px;
  font-size: 0.75rem;
  color: #1f2a3d;
  background: #fbfcff;
}

.invoice-card-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid #eef1f5;
}

.invoice-card-meta span {
  display: block;
  font-size: 0.72rem;
  color: #8e96a5;
}

.invoice-card-meta strong {
  display: block;
  margin-top: 4px;
  font-size: 1.62rem;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: #111827;
  line-height: 1.1;
}

@media (max-width: 1200px) {
  .calendar-layout {
    grid-template-columns: 1fr;
  }
}
</style>

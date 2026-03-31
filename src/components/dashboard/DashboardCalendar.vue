<script setup lang="ts">
import { computed, ref } from "vue";

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

const monthLabel = computed(() =>
  viewMonthDate.value.toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  })
);

const selectedDateLabel = computed(() =>
  selectedDate.value.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
);

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
      key: `prev-${date.toISOString()}`,
      day,
      date,
      inCurrentMonth: false,
    });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    cells.push({
      key: `curr-${date.toISOString()}`,
      day,
      date,
      inCurrentMonth: true,
    });
  }

  while (cells.length < 42) {
    const day = cells.length - (startWeekDay + daysInMonth) + 1;
    const date = new Date(year, month + 1, day);
    cells.push({
      key: `next-${date.toISOString()}`,
      day,
      date,
      inCurrentMonth: false,
    });
  }

  return cells;
});

const invoiceCards = Array.from({ length: 3 });

function isSameDate(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

function isSelected(cell: CalendarCell) {
  return isSameDate(cell.date, selectedDate.value);
}

function hasEvents(cell: CalendarCell) {
  return cell.inCurrentMonth && [11, 20, 30].includes(cell.day);
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
</script>

<template>
  <section class="calendar-screen">
    <div class="calendar-layout">
      <article class="calendar-panel">
        <h2 class="calendar-title">Calendar</h2>
        <div class="calendar-card">
          <div class="calendar-card-head">
            <strong>{{ selectedDateLabel }}</strong>
            <div class="calendar-actions">
              <span class="calendar-month">{{ monthLabel }}</span>
              <button type="button" class="calendar-chip calendar-chip--today" @click="goToToday">Today</button>
              <button type="button" class="calendar-icon-btn" aria-label="Previous" @click="goToPreviousMonth">
                ‹
              </button>
              <button type="button" class="calendar-icon-btn" aria-label="Next" @click="goToNextMonth">›</button>
            </div>
          </div>
          <div class="calendar-grid">
            <div v-for="day in weekDays" :key="day" class="calendar-weekday">{{ day }}</div>

            <div v-for="cell in calendarCells" :key="cell.key" class="calendar-day">
              <button
                type="button"
                class="calendar-day-num"
                :class="{
                  'calendar-day-num--selected': isSelected(cell),
                  'calendar-day-num--faded': !cell.inCurrentMonth,
                }"
                @click="selectDate(cell)"
              >
                {{ cell.day }}
              </button>
              <div v-if="hasEvents(cell)" class="calendar-dot-row">
                <span class="calendar-dot"></span>
                <span class="calendar-dot calendar-dot--muted"></span>
              </div>
            </div>
          </div>
        </div>
      </article>

      <aside class="calendar-side-panel">
        <div class="calendar-segmented">
          <button type="button" class="calendar-segmented-item calendar-segmented-item--active">Invoice</button>
          <button type="button" class="calendar-segmented-item">Projects</button>
        </div>

        <article v-for="(_, idx) in invoiceCards" :key="idx" class="invoice-card">
          <div class="invoice-card-head">
            <div>
              <h3>Project Name</h3>
              <p>Client Name</p>
              <p>Invoice Number</p>
            </div>
            <div class="invoice-card-badge-wrap">
              <span class="invoice-status">In Review</span>
              <button type="button" class="invoice-menu" aria-label="More">⋮</button>
            </div>
          </div>
          <div class="invoice-card-meta">
            <div>
              <span>Amount (PKR)</span>
              <strong>250,000</strong>
            </div>
            <div>
              <span>Date Issued</span>
              <strong>25-07-25</strong>
            </div>
            <div>
              <span>Date Due</span>
              <strong>28-07-25</strong>
            </div>
          </div>
        </article>
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

.calendar-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.calendar-month {
  font-size: 0.82rem;
  color: #6b7280;
  min-width: 78px;
  text-align: center;
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
  display: grid;
  justify-items: center;
  align-content: start;
  gap: 4px;
}

.calendar-day-num {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  color: #2d3648;
  font-size: 0.95rem;
  border: none;
  background: transparent;
  cursor: pointer;
}

.calendar-day-num--faded {
  color: #a9afba;
}

.calendar-day-num--selected {
  background: #0f234a;
  color: #ffffff;
  font-weight: 600;
}

.calendar-dot-row {
  display: inline-flex;
  gap: 4px;
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

.calendar-side-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.calendar-segmented {
  display: inline-flex;
  width: fit-content;
  gap: 8px;
}

.calendar-segmented-item {
  border: 1px solid #e4e7ee;
  background: #ffffff;
  color: #5d6780;
  border-radius: 999px;
  padding: 8px 16px;
  font-size: 0.85rem;
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

.invoice-menu {
  border: none;
  background: transparent;
  color: #6f7889;
  font-size: 1.1rem;
  line-height: 1;
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

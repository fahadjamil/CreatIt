<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

type Mode = "week" | "month" | "year";

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    placeholder?: string;
    disabled?: boolean;
    /** Display format only (stored value remains ISO `YYYY-MM-DD`). */
    displayFormat?: "dd/mm/yyyy" | "d mon, yyyy" | "mon d, yyyy";
    /**
     * Picking a day updates the model and closes immediately (no Apply).
     * Use inside modal dialogs so users are not confused by the two-step flow.
     */
    commitOnSelect?: boolean;
  }>(),
  {
    modelValue: "",
    placeholder: "DD/MM/YYYY",
    disabled: false,
    displayFormat: "dd/mm/yyyy",
    commitOnSelect: false,
  },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "apply", value: string): void;
  (e: "reset"): void;
}>();

const open = ref(false);
const mode = ref<Mode>("week");
const anchorRef = ref<HTMLElement | null>(null);
/** Popover is portaled to `body` so it is not clipped by `overflow: auto` on dialogs and stacks above modal surfaces. */
const popoverPos = ref({ top: 0, left: 0, width: 320 });

const draftIso = ref<string>("");

const popoverFixedStyle = computed(() => ({
  top: `${popoverPos.value.top}px`,
  left: `${popoverPos.value.left}px`,
  width: `${popoverPos.value.width}px`,
}));

function updatePopoverPosition() {
  const wrap = anchorRef.value;
  if (!wrap) return;
  const r = wrap.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(320, vw - 24);
  let left = r.left;
  let top = r.bottom + 6;
  if (left + width > vw - 12) left = Math.max(12, vw - width - 12);
  const estPopoverH = 400;
  if (top + estPopoverH > vh - 12) top = Math.max(12, r.top - estPopoverH - 6);
  popoverPos.value = { top, left, width };
}

function onViewportChange() {
  if (open.value) updatePopoverPosition();
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toIso(d: Date) {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  return `${yyyy}-${mm}-${dd}`;
}

function parseIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  // Guard against JS date rollover (e.g. 2025-02-31)
  if (toIso(d) !== `${m[1]}-${m[2]}-${m[3]}`) return null;
  return d;
}

function formatDisplay(iso: string) {
  const d = parseIso(iso);
  if (!d) return "";
  if (props.displayFormat === "d mon, yyyy") {
    const mon = d.toLocaleString("en-US", { month: "short" });
    return `${d.getDate()} ${mon}, ${d.getFullYear()}`;
  }
  if (props.displayFormat === "mon d, yyyy") {
    const mon = d.toLocaleString("en-US", { month: "short" });
    return `${mon} ${d.getDate()}, ${d.getFullYear()}`;
  }
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

const displayValue = computed(() => (props.modelValue ? formatDisplay(props.modelValue) : ""));

const viewMonth = ref<number>(new Date().getMonth());
const viewYear = ref<number>(new Date().getFullYear());

watch(
  () => props.modelValue,
  (v) => {
    const d = parseIso(v || "");
    if (d) {
      viewMonth.value = d.getMonth();
      viewYear.value = d.getFullYear();
    }
    if (!open.value) draftIso.value = String(v || "");
  },
  { immediate: true },
);

watch(open, async (isOpen) => {
  if (isOpen) {
    draftIso.value = String(props.modelValue || "");
    const d = parseIso(draftIso.value);
    if (d) {
      viewMonth.value = d.getMonth();
      viewYear.value = d.getFullYear();
    }
    await nextTick();
    updatePopoverPosition();
  }
});

const monthLabel = computed(() => {
  const d = new Date(viewYear.value, viewMonth.value, 1);
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
});

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const calendarCells = computed(() => {
  const first = new Date(viewYear.value, viewMonth.value, 1);
  const startDay = first.getDay(); // 0..6
  const daysInMonth = new Date(viewYear.value, viewMonth.value + 1, 0).getDate();
  const cells: Array<{ iso: string; day: number; inMonth: boolean }> = [];

  // leading (prev month)
  const prevMonthDays = new Date(viewYear.value, viewMonth.value, 0).getDate();
  for (let i = 0; i < startDay; i++) {
    const day = prevMonthDays - (startDay - 1 - i);
    const d = new Date(viewYear.value, viewMonth.value - 1, day);
    cells.push({ iso: toIso(d), day, inMonth: false });
  }

  // current month
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(viewYear.value, viewMonth.value, day);
    cells.push({ iso: toIso(d), day, inMonth: true });
  }

  // trailing to 6 rows (42)
  while (cells.length < 42) {
    const last = parseIso(cells[cells.length - 1]!.iso)!;
    const d = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    cells.push({ iso: toIso(d), day: d.getDate(), inMonth: false });
  }

  return cells;
});

function prevMonth() {
  if (viewMonth.value === 0) {
    viewMonth.value = 11;
    viewYear.value -= 1;
  } else {
    viewMonth.value -= 1;
  }
}

function nextMonth() {
  if (viewMonth.value === 11) {
    viewMonth.value = 0;
    viewYear.value += 1;
  } else {
    viewMonth.value += 1;
  }
}

function selectIso(iso: string) {
  draftIso.value = iso;
  if (props.commitOnSelect) {
    emit("update:modelValue", iso);
    emit("apply", iso);
    open.value = false;
  }
}

function onReset() {
  draftIso.value = "";
  emit("update:modelValue", "");
  emit("reset");
  open.value = false;
}

function onApply() {
  emit("update:modelValue", draftIso.value);
  emit("apply", draftIso.value);
  open.value = false;
}

function onBackdrop() {
  open.value = false;
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key === "Escape") open.value = false;
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onViewportChange, true);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", onViewportChange);
  window.removeEventListener("scroll", onViewportChange, true);
});
</script>

<template>
  <div ref="anchorRef" class="ds-wrap">
    <button
      type="button"
      class="ds-input"
      :class="{ 'ds-input--placeholder': !displayValue, 'ds-input--disabled': disabled }"
      :disabled="disabled"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="ds-input-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 2v3M16 2v3" />
          <path d="M3 10h18" />
          <rect x="3" y="5" width="18" height="17" rx="2" />
        </svg>
      </span>
      <span class="ds-input-text">
        {{ displayValue || placeholder }}
      </span>
    </button>

    <Teleport to="body">
      <Transition name="ds-fade">
        <div v-if="open" class="ds-backdrop" aria-hidden="true" @click="onBackdrop" />
      </Transition>
      <Transition name="ds-pop">
        <div
          v-if="open"
          class="ds-popover ds-popover--fixed"
          role="dialog"
          aria-label="Choose date"
          :style="popoverFixedStyle"
          @pointerdown.stop
        >
          <div class="ds-mode">
            <button type="button" class="ds-mode-btn" :class="{ 'ds-mode-btn--active': mode === 'week' }" @click="mode = 'week'">
              Week
            </button>
            <button type="button" class="ds-mode-btn" :class="{ 'ds-mode-btn--active': mode === 'month' }" @click="mode = 'month'">
              Month
            </button>
            <button type="button" class="ds-mode-btn" :class="{ 'ds-mode-btn--active': mode === 'year' }" @click="mode = 'year'">
              Year
            </button>
          </div>

          <div class="ds-head">
            <button type="button" class="ds-nav" aria-label="Previous month" @click="prevMonth">‹</button>
            <div class="ds-month">{{ monthLabel }}</div>
            <button type="button" class="ds-nav" aria-label="Next month" @click="nextMonth">›</button>
          </div>

          <div class="ds-grid">
            <div v-for="w in weekdays" :key="w" class="ds-weekday">{{ w }}</div>

            <button
              v-for="cell in calendarCells"
              :key="cell.iso"
              type="button"
              class="ds-day"
              :class="{
                'ds-day--muted': !cell.inMonth,
                'ds-day--selected': cell.iso === draftIso,
              }"
              @click="selectIso(cell.iso)"
            >
              {{ cell.day }}
            </button>
          </div>

          <div class="ds-actions">
            <button type="button" class="ds-action ds-action--ghost" @click="onReset">Reset</button>
            <button type="button" class="ds-action ds-action--primary" @click="onApply">Apply</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.ds-wrap {
  position: relative;
  width: 100%;
}

.ds-input {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-size: 0.875rem;
  color: #0f172a;
  background: #ffffff;
  cursor: pointer;
  text-align: left;
}

.ds-input--placeholder {
  color: #94a3b8;
}

.ds-input--disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.ds-input:focus {
  outline: none;
  border-color: #0f172a;
  box-shadow: none;
}

.ds-input-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ds-input-icon {
  flex-shrink: 0;
  pointer-events: none;
  color: #64748b;
}

.ds-backdrop {
  position: fixed;
  inset: 0;
  /* Above app dialogs (z ~480), below app toasts (z 10000) */
  z-index: 9500;
  background: transparent;
  /* Modal dialogs set body pointer-events: none; keep picker interactive. */
  pointer-events: auto;
}

.ds-popover {
  padding: 12px;
  border-radius: 12px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  box-shadow:
    0 10px 40px rgba(15, 23, 42, 0.14),
    0 0 0 1px rgba(15, 23, 42, 0.04);
  max-width: calc(100vw - 24px);
  box-sizing: border-box;
}

.ds-popover--fixed {
  position: fixed;
  z-index: 9510;
  pointer-events: auto;
}

.ds-mode {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
  padding: 4px;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  background: #ffffff;
}

.ds-mode-btn {
  border: none;
  background: transparent;
  padding: 8px 10px;
  border-radius: 999px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
}

.ds-mode-btn--active {
  background: #0f172a;
  color: #ffffff;
}

.ds-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  padding: 6px 2px;
}

.ds-month {
  font-size: 0.875rem;
  font-weight: 600;
  color: #0f172a;
}

.ds-nav {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  cursor: pointer;
  color: #0f172a;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ds-nav:hover {
  background: #f8fafc;
}

.ds-grid {
  margin-top: 6px;
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}

.ds-weekday {
  font-size: 0.75rem;
  color: #94a3b8;
  text-align: center;
  padding: 6px 0 4px;
  font-weight: 600;
}

.ds-day {
  border: none;
  background: #ffffff;
  color: #0f172a;
  border-radius: 10px;
  height: 34px;
  cursor: pointer;
  font-size: 0.875rem;
}

.ds-day:hover {
  background: #f1f5f9;
}

.ds-day--muted {
  color: #cbd5e1;
}

.ds-day--selected {
  background: #0f172a;
  color: #ffffff;
}

.ds-actions {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
}

.ds-action {
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}

.ds-action--ghost {
  border: 1px solid #0f172a;
  background: #ffffff;
  color: #0f172a;
}

.ds-action--primary {
  border: none;
  background: #0f172a;
  color: #ffffff;
}

.ds-action--primary:hover {
  background: #1e293b;
}

.ds-fade-enter-active,
.ds-fade-leave-active {
  transition: opacity 0.12s ease;
}
.ds-fade-enter-from,
.ds-fade-leave-to {
  opacity: 0;
}

.ds-pop-enter-active,
.ds-pop-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.ds-pop-enter-from,
.ds-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>

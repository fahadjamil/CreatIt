<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { getProjectById } from "@/lib/api";

type Props = {
  projectId: string;
};

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "back"): void;
}>();

const isLoading = ref(false);
const errorMessage = ref("");
const project = ref<Record<string, unknown> | null>(null);

const STORAGE_IMAGE_BASE_URL = "https://dev.createit.pk/storage/";

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function resolveStorageUrl(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  const base = STORAGE_IMAGE_BASE_URL.replace(/\/+$/, "");

  // Accept values like:
  // - "foo.jpg"
  // - "/foo.jpg"
  // - "storage/foo.jpg"
  // - "/storage/foo.jpg"
  // and always map to `${base}/foo.jpg`
  let path = s.replace(/^\/+/, "");
  path = path.replace(/^storage\/+/i, "");
  return `${base}/${path}`;
}

/** Normalize GET /projects/:id body the same way list items vary (wrapped `data`, `project`, etc.). */
function unwrapProjectPayload(body: unknown): Record<string, unknown> | null {
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

function normalizePaymentTypeLabel(paymentType: string): string {
  const value = paymentType.trim().toLowerCase();
  if (value === "single") return "Single";
  if (value === "multiple") return "Multiple";
  if (value === "recurring") return "Recurring";
  if (value === "deliverables" || value === "deliverable") return "Deliverables";
  return paymentType;
}

function formatDetailDate(raw: unknown): string {
  if (raw == null || raw === "") return "—";
  const s = String(raw).trim();
  if (!s) return "—";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return s;
  return d.toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });
}

function formatSlashDate(raw: unknown): string {
  if (raw == null || raw === "") return "—";
  const s = String(raw).trim();
  if (!s) return "—";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return s;
  // DD/MM/YYYY
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatMoney(raw: unknown, currency: string): string {
  if (raw == null || raw === "") return "—";
  const n = Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n)) return String(raw);
  return `${currency} ${n.toLocaleString("en-PK")}`;
}

function formatPercent(raw: unknown): string {
  if (raw == null || raw === "") return "—";
  const n = Number(String(raw).replace(/%/g, ""));
  if (!Number.isFinite(n)) return String(raw);
  return `${n}%`;
}

function formatStatusLabel(raw: unknown): string {
  if (raw == null || raw === "") return "—";
  const s = String(raw).trim();
  if (!s) return "—";
  // Convert: in_review -> In Review, in-review -> In Review
  return s
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const projectData = computed(() => project.value ?? {});

const primaryClient = computed(() => {
  const p = projectData.value;
  const fromList = Array.isArray(p.clients) ? p.clients[0] : undefined;
  return fromList ?? p.client ?? null;
});

const title = computed(() => String(projectData.value.title ?? projectData.value.name ?? "Project Details"));
const statusLabel = computed(() => String(projectData.value.status ?? projectData.value.project_status ?? "—"));
const createdAt = computed(() => formatDetailDate(projectData.value.created_at ?? projectData.value.createdAt));
const typeLabel = computed(() =>
  normalizePaymentTypeLabel(String(projectData.value.type ?? projectData.value.payment_type ?? "—")),
);
const clientLabel = computed(() => {
  const c = primaryClient.value as Record<string, unknown> | null;
  return String(
    c?.display_name ??
      projectData.value.client_name ??
      c?.name ??
      c?.brand_name ??
      "—",
  );
});
const startDate = computed(() => formatDetailDate(projectData.value.start_date ?? projectData.value.started_at));
const endDate = computed(() => formatDetailDate(projectData.value.end_date ?? projectData.value.due_date));
const scope = computed(() => {
  const p = projectData.value;
  const ps = p.project_scope;
  if (ps && typeof ps === "object" && !Array.isArray(ps)) {
    const po = ps as Record<string, unknown>;
    const label = po.name ?? po.title ?? po.label ?? po.description;
    if (label != null && String(label).trim()) return String(label);
  }
  const direct = p.scope_description ?? p.description ?? p.scope;
  return String(direct ?? "—");
});
const amount = computed(() => {
  const value = Number(projectData.value.amount ?? projectData.value.total_amount ?? projectData.value.totalAmount ?? 0);
  const currency = String(projectData.value.currency ?? projectData.value.currency_code ?? "PKR");
  if (!Number.isFinite(value)) return "—";
  return `${currency} ${value.toLocaleString("en-PK")}`;
});
const gstRateLabel = computed(() => {
  const raw = projectData.value.gst_rate ?? projectData.value.tax_rate;
  if (raw == null || raw === "") return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return String(raw);
  return `${n}%`;
});
const gstAmountLabel = computed(() => {
  const raw = projectData.value.gst_amount ?? projectData.value.tax_amount;
  if (raw == null || raw === "") return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return String(raw);
  const currency = String(projectData.value.currency ?? projectData.value.currency_code ?? "PKR");
  return `${currency} ${n.toLocaleString("en-PK")}`;
});
const totalAmountLabel = computed(() => {
  const raw = projectData.value.total_amount ?? projectData.value.totalAmount;
  if (raw == null || raw === "") return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return String(raw);
  const currency = String(projectData.value.currency ?? projectData.value.currency_code ?? "PKR");
  return `${currency} ${n.toLocaleString("en-PK")}`;
});
const gstInclusiveLabel = computed(() => {
  const raw = projectData.value.gst_inclusive ?? projectData.value.is_gst_inclusive ?? projectData.value.tax_inclusive;
  if (raw == null || raw === "") return "—";
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  const n = Number(raw);
  if (Number.isFinite(n)) return n === 1 ? "Yes" : "No";
  return String(raw);
});
const paymentMethod = computed(() =>
  String(
    projectData.value.payment_method ??
      projectData.value.payment_mode ??
      projectData.value.billing_method ??
      (projectData.value.meta && typeof projectData.value.meta === "object" && !Array.isArray(projectData.value.meta)
        ? (projectData.value.meta as any)?.payment_method
        : undefined) ??
      "—",
  ),
);
const paymentStructure = computed(() =>
  normalizePaymentTypeLabel(
    String(projectData.value.payment_structure ?? projectData.value.type ?? projectData.value.payment_type ?? "—"),
  ),
);
const paymentSchedule = computed(() =>
  String(projectData.value.payment_schedule ?? projectData.value.paymentSchedule ?? "—"),
);
const paymentScheduleDate = computed(() =>
  formatDetailDate(projectData.value.payment_schedule_date ?? projectData.value.paymentScheduleDate),
);
const financingLabel = computed(() => {
  const p = projectData.value;
  const applied = p.financing_applied;
  if (typeof applied === "boolean") return applied ? "Yes" : "No";
  const amt = p.financing_amount ?? p.financing;
  if (amt != null && amt !== "") {
    const n = Number(amt);
    if (Number.isFinite(n)) return `PKR ${n.toLocaleString("en-PK")}`;
    return String(amt);
  }
  return "—";
});

const clientEmail = computed(() => {
  const c = primaryClient.value as Record<string, unknown> | null;
  const v = c?.email ?? c?.poc_email ?? projectData.value.client_email;
  const s = v != null ? String(v).trim() : "";
  return s || "—";
});

const clientPhone = computed(() => {
  const c = primaryClient.value as Record<string, unknown> | null;
  const v = c?.phone ?? c?.mobile_number ?? c?.poc_phone ?? projectData.value.client_phone;
  const s = v != null ? String(v).trim() : "";
  return s || "—";
});

const clientRole = computed(() => {
  const c = primaryClient.value as any;
  const role = c?.pivot?.role ?? c?.role ?? null;
  const s = role != null ? String(role).trim() : "";
  return s || "—";
});

const earlyPayoutAgreedLabel = computed(() => {
  const meta = projectData.value.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return "—";
  const raw = (meta as any)?.early_payout_agreed;
  if (raw == null || raw === "") return "—";
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  const n = Number(raw);
  if (Number.isFinite(n)) return n === 1 ? "Yes" : "No";
  const s = String(raw).trim().toLowerCase();
  if (s === "yes" || s === "true") return "Yes";
  if (s === "no" || s === "false") return "No";
  return String(raw);
});

const recurringDurationLabel = computed(() => {
  const p = projectData.value as any;
  const weeks = p.recurring_weeks;
  const months = p.recurring_months;
  const weekN = weeks != null && weeks !== "" ? Number(weeks) : NaN;
  const monthN = months != null && months !== "" ? Number(months) : NaN;
  if (Number.isFinite(weekN) && weekN > 0) return `${weekN} week(s)`;
  if (Number.isFinite(monthN) && monthN > 0) return `${monthN} month(s)`;

  const meta = p.meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const countRaw = (meta as any)?.recurring_duration_count;
    const unitRaw = (meta as any)?.recurring_duration_unit;
    const count = countRaw != null ? String(countRaw).trim() : "";
    const unit = unitRaw != null ? String(unitRaw).trim() : "";
    if (count && unit) return `${count} ${unit}`;
    if (count) return count;
  }
  return "—";
});

const tags = computed(() => {
  const p = projectData.value as any;
  const raw = p.tags ?? p.tag_list ?? p.project_tags ?? p.tag_ids;
  const list = toArray(raw);
  return list
    .map((t) => {
      if (t && typeof t === "object") {
        const o = t as any;
        return String(o.name ?? o.title ?? o.slug ?? o.id ?? "").trim();
      }
      return String(t ?? "").trim();
    })
    .filter(Boolean);
});

const mediaItems = computed(() => {
  const p = projectData.value as any;
  const raw = p.images ?? p.media ?? p.attachments ?? p.files ?? p.gallery;
  const list = toArray(raw);
  return list
    .map((m) => {
      if (!m) return null;
      if (typeof m === "string") {
        const url = resolveStorageUrl(m);
        if (!url) return null;
        return { url, name: url };
      }
      if (typeof m === "object") {
        const o = m as any;
        const rawUrl = String(o.url ?? o.path ?? o.src ?? o.file_url ?? o.download_url ?? "").trim();
        const url = resolveStorageUrl(rawUrl);
        if (!url) return null;
        return { url, name: url };
      }
      return null;
    })
    .filter(Boolean) as { url: string; name: string }[];
});

const milestoneItems = computed(() => {
  const p = projectData.value as any;
  const currency = String(p.currency ?? p.currency_code ?? "PKR");
  const raw = p.milestones ?? p.payment_milestones ?? [];
  const list = toArray(raw);
  return list
    .map((m, index) => {
      if (!m || typeof m !== "object") return null;
      const o = m as any;
      const id = String(o.id ?? o.uuid ?? `milestone-${index}`);
      const title = String(o.title ?? o.name ?? o.label ?? `Milestone ${index + 1}`).trim();
      const percentage = formatPercent(o.percentage ?? o.percent ?? o.pct);
      const amount = formatMoney(o.amount ?? o.value ?? o.total, currency);
      const due = formatSlashDate(
        o.due_on ?? o.dueOn ?? o.date ?? o.due_date ?? o.dueDate ?? o.payment_date,
      );
      const deliverables = String(o.deliverables ?? o.description ?? o.details ?? "").trim() || "—";
      const status = formatStatusLabel(o.status);
      return { id, title, percentage, amount, due, deliverables, status };
    })
    .filter(Boolean) as {
    id: string;
    title: string;
    percentage: string;
    amount: string;
    due: string;
    deliverables: string;
    status: string;
  }[];
});

async function loadProjectDetails() {
  if (!props.projectId) return;
  isLoading.value = true;
  errorMessage.value = "";
  try {
    const response = await getProjectById(props.projectId);
    project.value = unwrapProjectPayload(response?.data);
    if (!project.value || typeof project.value !== "object") {
      project.value = null;
      errorMessage.value = "Could not load project details right now.";
    }
  } catch (error) {
    console.error("Failed to load project details", error);
    errorMessage.value = "Could not load project details right now.";
    project.value = null;
  } finally {
    isLoading.value = false;
  }
}

watch(() => props.projectId, loadProjectDetails, { immediate: true });
</script>

<template>
  <section class="project-details-screen">
    <div class="project-details-breadcrumb">
      <button type="button" class="project-details-back" @click="emit('back')">←</button>
      <span>{{ title }}</span>
      <span>›</span>
      <strong>Details</strong>
    </div>

    <div v-if="isLoading" class="project-details-placeholder">Loading project details...</div>
    <div v-else-if="errorMessage" class="project-details-placeholder">{{ errorMessage }}</div>
    <div v-else class="project-details-body">
      <article class="project-details-card">
        <header class="project-details-card-header">Project Details</header>
        <div class="project-details-grid">
          <div class="project-details-row"><span>Name</span><strong>{{ title }}</strong></div>
          <div class="project-details-row"><span>Type</span><strong>{{ typeLabel }}</strong></div>
          <div class="project-details-row"><span>Status</span><strong>{{ statusLabel }}</strong></div>
          <div class="project-details-row"><span>Created</span><strong>{{ createdAt }}</strong></div>
          <div class="project-details-row"><span>Client</span><strong>{{ clientLabel }}</strong></div>
          <div class="project-details-row"><span>Starting</span><strong>{{ startDate }}</strong></div>
          <div class="project-details-row"><span>End</span><strong>{{ endDate }}</strong></div>
          <div class="project-details-row"><span>Project Scope</span><strong>{{ scope }}</strong></div>
        </div>
      </article>

      <article class="project-details-card">
        <header class="project-details-card-header">Tags</header>
        <div class="project-details-grid">
          <div class="project-details-row project-details-row--stack">
            <span>Tags</span>
            <strong v-if="tags.length">{{ tags.join(", ") }}</strong>
            <strong v-else>—</strong>
          </div>
        </div>
      </article>

      <article class="project-details-card">
        <header class="project-details-card-header">Media</header>
        <div class="project-details-grid">
          <div class="project-details-row project-details-row--stack">
            <span>Files</span>
            <strong v-if="!mediaItems.length">—</strong>
            <div v-else class="project-details-media">
              <a v-for="m in mediaItems" :key="m.url" class="project-details-media-thumb" :href="m.url" target="_blank" rel="noreferrer">
                <img class="project-details-media-img" :src="m.url" :alt="title" loading="lazy" />
              </a>
            </div>
          </div>
        </div>
      </article>

      <article class="project-details-card">
        <header class="project-details-card-header">Client Details</header>
        <div class="project-details-grid">
          <div class="project-details-row"><span>Name</span><strong>{{ clientLabel }}</strong></div>
          <div class="project-details-row"><span>Role</span><strong>{{ clientRole }}</strong></div>
          <div class="project-details-row"><span>Email</span><strong>{{ clientEmail }}</strong></div>
          <div class="project-details-row"><span>Phone</span><strong>{{ clientPhone }}</strong></div>
        </div>
      </article>

      <article class="project-details-card">
        <header class="project-details-card-header">Payment Details</header>
        <div class="project-details-grid">
          <div class="project-details-row"><span>Project Amount</span><strong>{{ amount }}</strong></div>
          <div class="project-details-row"><span>Payment method</span><strong>{{ paymentMethod }}</strong></div>
          <div class="project-details-row"><span>Payment Structure</span><strong>{{ paymentStructure }}</strong></div>
          <div class="project-details-row"><span>Payment schedule</span><strong>{{ paymentSchedule }}</strong></div>
          <div class="project-details-row"><span>Schedule date</span><strong>{{ paymentScheduleDate }}</strong></div>
          <div class="project-details-row"><span>GST inclusive</span><strong>{{ gstInclusiveLabel }}</strong></div>
          <div class="project-details-row"><span>GST rate</span><strong>{{ gstRateLabel }}</strong></div>
          <div class="project-details-row"><span>GST amount</span><strong>{{ gstAmountLabel }}</strong></div>
          <div class="project-details-row"><span>Total amount</span><strong>{{ totalAmountLabel }}</strong></div>
        </div>
      </article>

      <article v-if="String(projectData.type ?? '') === 'milestone'" class="project-details-card">
        <header class="project-details-card-header">Milestones</header>
        <div class="project-details-grid">
          <div v-if="!milestoneItems.length" class="project-details-row">
            <span>Milestones</span><strong>—</strong>
          </div>
          <div v-else class="project-details-row project-details-row--full">
            <div class="project-details-milestones">
              <div class="project-details-milestones-head">
                <span>Title</span>
                <span>%</span>
                <span>Amount</span>
                <span>Date</span>
                <span>Status</span>
                <span>Deliverables</span>
              </div>
              <div v-for="m in milestoneItems" :key="m.id" class="project-details-milestones-row">
                <strong>{{ m.title }}</strong>
                <span>{{ m.percentage }}</span>
                <span>{{ m.amount }}</span>
                <span>{{ m.due }}</span>
                <span>{{ m.status }}</span>
                <span class="project-details-milestones-deliverables">{{ m.deliverables }}</span>
              </div>
            </div>
          </div>
        </div>
      </article>

      <article v-if="String(projectData.type ?? '') === 'recurring'" class="project-details-card">
        <header class="project-details-card-header">Recurring Details</header>
        <div class="project-details-grid">
          <div class="project-details-row"><span>Duration</span><strong>{{ recurringDurationLabel }}</strong></div>
          <div class="project-details-row"><span>Early payout agreed</span><strong>{{ earlyPayoutAgreedLabel }}</strong></div>
        </div>
      </article>

      <article class="project-details-card">
        <header class="project-details-card-header">Financing</header>
        <div class="project-details-grid">
          <div class="project-details-row"><span>Financing</span><strong>{{ financingLabel }}</strong></div>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.project-details-screen {
  width: 100%;
  min-height: calc(100vh - 120px);
  padding: 18px 24px 28px;
  box-sizing: border-box;
}

.project-details-breadcrumb {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #64748b;
  font-size: 0.75rem;
  margin-bottom: 14px;
}

.project-details-back {
  width: 22px;
  height: 22px;
  border: 1px solid #dbe2ea;
  border-radius: 999px;
  background: #fff;
  cursor: pointer;
  color: #334155;
}

.project-details-body {
  display: grid;
  gap: 10px;
}

.project-details-card {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.project-details-card-header {
  padding: 10px 12px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #0f172a;
  border-bottom: 1px solid #edf2f7;
}

.project-details-grid {
  display: grid;
  padding: 6px 0;
}

.project-details-row {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: 12px;
  padding: 10px 12px;
  font-size: 0.75rem;
  color: #64748b;
}

.project-details-row--stack {
  grid-template-columns: 180px 1fr;
  align-items: start;
}

.project-details-row--full {
  grid-template-columns: 1fr;
}

.project-details-row strong {
  color: #0f172a;
  font-weight: 500;
  text-align: right;
}

.project-details-row--stack strong {
  text-align: left;
}

.project-details-media {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.project-details-media-thumb {
  display: block;
  width: 96px;
  height: 96px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
  background: #f8fafc;
}

.project-details-media-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.project-details-milestones {
  width: 100%;
  display: grid;
  gap: 8px;
}

.project-details-milestones-head {
  display: grid;
  grid-template-columns: 160px 60px 120px 120px 100px 1fr;
  gap: 10px;
  font-size: 0.7rem;
  color: #64748b;
  padding: 8px 0;
  border-bottom: 1px solid #edf2f7;
}

.project-details-milestones-row {
  display: grid;
  grid-template-columns: 160px 60px 120px 120px 100px 1fr;
  gap: 10px;
  font-size: 0.75rem;
  color: #0f172a;
  align-items: start;
}

.project-details-milestones-row strong {
  text-align: left;
  font-weight: 600;
}

.project-details-milestones-deliverables {
  color: #334155;
}

.project-details-placeholder {
  margin-top: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 16px;
  background: #fff;
  color: #64748b;
  font-size: 0.875rem;
}
</style>

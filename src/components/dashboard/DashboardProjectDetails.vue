<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  createInvoiceTermsTemplate,
  extractInvoiceTermsTemplatesList,
  extractMessage,
  extractMessageFromAxiosErrorData,
  extractUploadedImageIds,
  getInvoicePdfWithRetry,
  getInvoiceTermsTemplates,
  interpretInvoicePdfBlob,
  getProjectById,
  issueInvoice,
  sendProjectMilestoneToClient,
  updateProjectMilestoneStatus,
  updateInvoiceFollowUp,
  updateInvoiceStatus,
  uploadImages,
  type InvoiceTermsTemplateApi,
} from "@/lib/api";
import { useAlerts } from "@/composables/useAlerts";
import { resolveImageRecordSource, resolveStorageUrl } from "@/lib/storageUrl";
import { currentUserProfile, formatUserInvoiceBlock } from "@/lib/userProfile";
import { getAuthToken } from "@/lib/auth";
import { compressImageFile } from "@/lib/imageCompression";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Calendar,
  Check,
  Clock,
  CloudUpload,
  Download,
  FileText,
  Image as ImageIcon,
  Banknote,
  ChevronRight,
  Link2,
  Mail,
  MessageCircle,
  Paperclip,
  Send,
  Trash2,
  Video,
} from "lucide-vue-next";
import DateSelect from "@/components/ui/date-select/DateSelect.vue";
import { projectStatusLabel } from "@/lib/projectStatus";

type Props = {
  projectId: string;
};

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "back"): void;
  (e: "settings"): void;
  (e: "create-invoice", payload: { projectId: string; milestoneId: string | null }): void;
}>();

const { pushAlert } = useAlerts();

const isLoading = ref(false);
const errorMessage = ref("");
const project = ref<Record<string, unknown> | null>(null);
const activeTab = ref<"details" | "invoice" | "milestones">("details");
const selectedInvoiceId = ref<string | null>(null);

type InvoiceStatusKey = "not_issued" | "in_review" | "issued" | "rejected" | "approved" | "paid" | "delayed";

type SectionKey =
  | "projectDetails"
  | "projectStatus"
  | "clientDetails"
  | "paymentDetails"
  | "tags"
  | "media"
  | "recurring";
const openSections = ref<Record<SectionKey, boolean>>({
  projectDetails: true,
  projectStatus: true,
  clientDetails: true,
  paymentDetails: true,
  tags: false,
  media: false,
  recurring: true,
});

function toggleSection(key: SectionKey) {
  openSections.value[key] = !openSections.value[key];
}

/** Local calendar date as `YYYY-MM-DD` (not UTC — avoids wrong "today" near timezone boundaries). */
function localTodayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** DateSelect teleports to `body`; block dialog dismiss so paid-date picker stays usable (incl. touch + composedPath). */
function isEventTargetInsideDateSelectPortal(orig: Event | undefined): boolean {
  if (!orig) return false;
  const test = (n: EventTarget | null | undefined) => {
    if (!(n instanceof Element)) return false;
    return Boolean(n.closest(".ds-popover") || n.closest(".ds-backdrop"));
  };
  if (test(orig.target)) return true;
  const pe = orig as PointerEvent;
  if (typeof pe.composedPath === "function") {
    for (const n of pe.composedPath()) {
      if (test(n)) return true;
    }
  }
  return false;
}

function onInvoicePaidDialogOutsideDismiss(ev: Event) {
  const detail = (ev as CustomEvent<{ originalEvent?: Event }>).detail;
  if (isEventTargetInsideDateSelectPortal(detail?.originalEvent)) {
    ev.preventDefault();
  }
}

const DEFAULT_INVOICE_TERMS =
  "Payment is due within 30 days of invoice date. Please remit payment to the account details provided. Late payments may incur a 1.5% monthly fee";

const DEFAULT_INVOICE_NOTES =
  "Thank you for your business! This invoice includes all agreed-upon services for Q1 2024. If you have any questions regarding this invoice, please contact our billing department at billing@acmecorp.com or call (555) 123-4567.";

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
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

/** DD-MM-YY as in design mocks */
function formatShortDmy(raw: unknown): string {
  if (raw == null || raw === "") return "—";
  const s = String(raw).trim();
  if (!s) return "—";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return s;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
}

function formatPaymentScheduleHuman(raw: unknown, scheduleDateFormatted: string): string {
  if (raw == null || raw === "") return "—";
  const s = String(raw).trim().toLowerCase().replace(/-/g, "_");
  if (s === "before_start") return "Before starting the project";
  if (s === "after_completion") return "After completion of the project";
  if (s === "specific_date") return scheduleDateFormatted && scheduleDateFormatted !== "—" ? `On ${scheduleDateFormatted}` : "Specific date";
  return String(raw);
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
const statusLabel = computed(() =>
  formatStatusLabel(projectData.value.status ?? projectData.value.project_status),
);
/** Canonical label for status pills (e.g. Discussion). */
const projectStatusDisplayLabel = computed(() =>
  projectStatusLabel(projectData.value.status ?? projectData.value.project_status),
);

const isMilestoneProject = computed(() => {
  const p = projectData.value;
  const t = String(p.type ?? p.payment_type ?? "").trim().toLowerCase();
  if (t === "milestone") return true;
  const ps = String(p.payment_structure ?? "").trim().toLowerCase();
  return ps === "multiple";
});

function formatMilestoneMonthYear(raw: unknown): string {
  if (raw == null || raw === "") return "—";
  const s = String(raw).trim();
  if (!s) return "—";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return "—";
  const month = d.toLocaleDateString("en-US", { month: "long" });
  const year = d.getFullYear();
  return `${month}, ${year}`;
}

function milestoneRowCompleted(raw: unknown): boolean {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (!s) return false;
  if (s.includes("complete") || s.includes("paid") || s === "done") return true;
  return false;
}

/**
 * True once work was actually submitted via send-to-client (or finished).
 * Do not treat `in_review` alone as sent — the API may use that status before anything is sent.
 */
function milestoneRecordSentToClient(o: Record<string, unknown>): boolean {
  if (milestoneRowCompleted(o.status ?? o.state)) return true;
  const status = String(o.status ?? o.state ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (status === "approved") return true;
  if (String(o.work_link ?? o.workLink ?? "").trim()) return true;
  const imgs = o.images ?? o.milestone_images;
  if (Array.isArray(imgs) && imgs.length > 0) return true;
  if (o.last_sent_at != null && String(o.last_sent_at).trim()) return true;
  if (o.lastSentAt != null && String(o.lastSentAt).trim()) return true;
  return false;
}

function milestoneStatusBadgeForRow(o: Record<string, unknown>): {
  text: string;
  variant: "completed" | "review" | "neutral";
} {
  if (milestoneRowCompleted(o.status ?? o.state)) {
    return { text: "Completed", variant: "completed" };
  }
  const status = String(o.status ?? o.state ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (status === "in_review") return { text: "In review", variant: "review" };
  return { text: formatStatusLabel(o.status ?? o.state), variant: "neutral" };
}

function milestoneImageThumbsForRow(o: Record<string, unknown>): {
  url: string;
  name: string;
  kind: "image" | "file";
}[] {
  const raw = toArray(o.images ?? o.milestone_images);
  return raw
    .map((img, i) => {
      const r = img && typeof img === "object" && !Array.isArray(img) ? (img as Record<string, unknown>) : {};
      const source = resolveImageRecordSource(r);
      const url = resolveStorageUrl(source);
      if (!url) return null;
      const label = r.label ?? r.name;
      const name = label != null && String(label).trim() ? String(label).trim() : `File ${i + 1}`;
      const lower = url.toLowerCase();
      const kind = /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/.test(lower) ? ("image" as const) : ("file" as const);
      return { url, name, kind };
    })
    .filter(Boolean) as { url: string; name: string; kind: "image" | "file" }[];
}

/** Image attachment ids already stored on the milestone (for resend payload). */
function milestoneImageIdsFromRecord(o: Record<string, unknown>): string[] {
  const raw = toArray(o.images ?? o.milestone_images);
  return raw
    .map((img) => {
      const r = img && typeof img === "object" && !Array.isArray(img) ? (img as Record<string, unknown>) : {};
      const id = r.id ?? r.uuid;
      return id == null ? "" : String(id).trim();
    })
    .filter(Boolean);
}

type MilestoneCardRow = {
  id: string;
  sequence: number;
  title: string;
  description: string;
  dueLabel: string;
  amountLabel: string;
  percentageLabel: string;
  showSend: boolean;
  statusBadgeText: string;
  statusBadgeVariant: "completed" | "review" | "neutral";
  workLink: string;
  imageIds: string[];
  lastSentLabel: string;
  lastSentAtLine: string;
  images: { url: string; name: string; kind: "image" | "file" }[];
};

/** e.g. Oct 2, 3:39 PM — for milestone “sent” timeline */
function formatMilestoneLastSentLine(raw: unknown): string {
  if (raw == null || raw === "") return "";
  const d = new Date(String(raw).trim());
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatMilestoneOrdinalLabel(sequence: number): string {
  const n = Math.max(1, Math.floor(sequence));
  const rem100 = n % 100;
  const rem10 = n % 10;
  let suffix = "th";
  if (rem100 < 11 || rem100 > 13) {
    if (rem10 === 1) suffix = "st";
    else if (rem10 === 2) suffix = "nd";
    else if (rem10 === 3) suffix = "rd";
  }
  return `${n}${suffix} Milestone`;
}

const milestoneRows = computed<MilestoneCardRow[]>(() => {
  const p = projectData.value as Record<string, unknown>;
  const raw = toArray(p.milestones ?? p.project_milestones);
  const currency = String(p.currency ?? p.currency_code ?? "PKR");
  const rows = raw.map((m, index) => {
    const o = m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : {};
    const id = String(o.id ?? o.uuid ?? `milestone-${index}`);
    const seq = Number(o.sequence ?? o.order ?? index + 1);
    const sequence = Number.isFinite(seq) ? seq : index + 1;
    const description = String(o.deliverables ?? o.description ?? o.details ?? "").trim() || "—";
    const titleRaw = String(o.title ?? "").trim();
    const title = titleRaw || formatMilestoneOrdinalLabel(sequence);
    const dueRaw = o.due_on ?? o.dueOn ?? o.due_date ?? o.date;
    const dueLabel = formatMilestoneMonthYear(dueRaw);
    const amt = o.amount ?? o.value;
    const n = Number(String(amt ?? "").replace(/,/g, ""));
    const amountLabel = Number.isFinite(n) ? `${currency} ${n.toLocaleString("en-PK")}` : "—";
    const percentageLabel = formatPercent(o.percentage);
    const sent = milestoneRecordSentToClient(o);
    const showSend = !sent;
    const badge = milestoneStatusBadgeForRow(o);
    const workLink = String(o.work_link ?? o.workLink ?? "").trim();
    const lastRaw = o.last_sent_at ?? o.lastSentAt;
    const lastSentLabel = lastRaw != null && String(lastRaw).trim() ? formatDetailDate(lastRaw) : "";
    const lastSentAtLine = formatMilestoneLastSentLine(lastRaw);
    const images = milestoneImageThumbsForRow(o);
    const imageIds = milestoneImageIdsFromRecord(o);
    return {
      id,
      sequence,
      title,
      description,
      dueLabel,
      amountLabel,
      percentageLabel,
      showSend,
      statusBadgeText: badge.text,
      statusBadgeVariant: badge.variant,
      workLink,
      imageIds,
      lastSentLabel,
      lastSentAtLine,
      images,
    };
  });
  return rows.sort((a, b) => a.sequence - b.sequence);
});

const milestoneCount = computed(() => milestoneRows.value.length);

const MILESTONE_SEND_MAX_FILES = 100;
const MILESTONE_SEND_MAX_FILE_BYTES = 5 * 1024 * 1024;

const milestoneSendModalOpen = ref(false);
const milestoneSuccessModalOpen = ref(false);
const milestoneSendTarget = ref<{ id: string; sequence: number } | null>(null);
const milestoneSendWorkLink = ref("https://");
const milestoneSendFiles = ref<File[]>([]);
const milestoneSendDropActive = ref(false);
const milestoneSuccessTitle = ref("");
const milestoneSendSaving = ref(false);
const selectedMilestoneDetailId = ref<string | null>(null);

const selectedMilestoneDetailRow = computed(() =>
  milestoneRows.value.find((r) => r.id === selectedMilestoneDetailId.value) ?? null,
);

type MilestoneClientStatusKey = "in_review" | "approved" | "rejected";
const milestoneClientStatusOverrideById = ref<Record<string, MilestoneClientStatusKey | undefined>>({});

const milestoneClientStatusOptions: {
  key: MilestoneClientStatusKey;
  label: string;
  variant: "review" | "approved" | "rejected";
}[] = [
  { key: "in_review", label: "In review", variant: "review" },
  { key: "approved", label: "Approved", variant: "approved" },
  { key: "rejected", label: "Rejected", variant: "rejected" },
];

const milestoneClientStatusSelectedKey = computed<MilestoneClientStatusKey>(() => {
  const row = selectedMilestoneDetailRow.value;
  if (!row) return "in_review";

  const override = milestoneClientStatusOverrideById.value[row.id];
  if (override) return override;

  if (row.statusBadgeVariant === "completed") return "approved";
  const st = String(row.statusBadgeText ?? "").toLowerCase();
  if (st.includes("approved")) return "approved";
  if (st.includes("reject")) return "rejected";
  return "in_review";
});

const milestoneDetailClientStep = computed(() => {
  const row = selectedMilestoneDetailRow.value;
  if (!row) return { text: "In review", variant: "review" as const };

  const override = milestoneClientStatusOverrideById.value[row.id];
  if (override === "approved") return { text: "Approved", variant: "approved" as const };
  if (override === "rejected") return { text: "Rejected", variant: "rejected" as const };
  if (override === "in_review") return { text: "In review", variant: "review" as const };

  if (row.statusBadgeVariant === "completed") {
    return { text: "Approved", variant: "approved" as const };
  }
  const st = String(row.statusBadgeText ?? "").toLowerCase();
  if (st.includes("approved")) return { text: "Approved", variant: "approved" as const };
  if (st.includes("reject")) return { text: "Rejected", variant: "rejected" as const };
  if (st.includes("review")) return { text: "In review", variant: "review" as const };
  return { text: "In review", variant: "review" as const };
});

/** Same linkage rule as CreateInvoiceFlow (milestone_id / nested milestone). */
function invoiceBelongsToMilestone(inv: Record<string, unknown>, milestoneId: string): boolean {
  const direct = String(inv.milestone_id ?? inv.project_milestone_id ?? "").trim();
  if (direct && direct === milestoneId) return true;
  const m = inv.milestone;
  if (m && typeof m === "object" && !Array.isArray(m)) {
    const id = String((m as Record<string, unknown>).id ?? (m as Record<string, unknown>).uuid ?? "").trim();
    if (id && id === milestoneId) return true;
  }
  return false;
}

function openMilestoneDetailScreen(row: MilestoneCardRow) {
  selectedMilestoneDetailId.value = row.id;
}

function closeMilestoneDetailScreen() {
  selectedMilestoneDetailId.value = null;
}

async function setMilestoneClientStatus(status: MilestoneClientStatusKey) {
  const row = selectedMilestoneDetailRow.value;
  if (!row) return;
  const p = projectData.value as Record<string, unknown>;
  const projectId = String(p.id ?? props.projectId ?? "").trim();
  if (!projectId) return;

  try {
    await updateProjectMilestoneStatus(projectId, row.id, { status });
    milestoneClientStatusOverrideById.value = {
      ...milestoneClientStatusOverrideById.value,
      [row.id]: status,
    };
    pushAlert({
      kind: "success",
      title: "Milestone status updated",
      message:
        status === "approved"
          ? "Marked as Approved."
          : status === "rejected"
            ? "Marked as Rejected."
            : "Marked as In review.",
      timeoutMs: 3500,
    });
  } catch {
    // Global API handler surfaces errors
  }
}

/** Milestone detail: PDF is only available after the invoice leaves Not Issued. */
function milestoneInvoiceIsIssued(inv: InvoiceRow): boolean {
  return inv.statusKey !== "not_issued";
}

const isOpeningMilestoneInvoicePdf = ref(false);

/** Open invoice PDF in a new tab (remote URL, or authenticated stream: `/download` then `/pdf`, see `VITE_INVOICE_PDF_PATH`). */
async function openInvoicePdfInBrowser(inv: InvoiceRow) {
  if (!canDownloadInvoicePdf(inv)) {
    pushAlert({
      kind: "info",
      title: "PDF not available",
      message: "This invoice does not have a downloadable PDF yet.",
      timeoutMs: 6000,
    });
    return;
  }

  const remoteUrl = invoiceRemotePdfUrl(inv.raw);
  if (remoteUrl) {
    window.open(remoteUrl, "_blank", "noopener,noreferrer");
    return;
  }

  isOpeningMilestoneInvoicePdf.value = true;
  try {
    const res = await getInvoicePdfWithRetry(inv.id);
    const interpreted = await interpretInvoicePdfBlob(res.data as Blob);
    if (interpreted.kind === "error") {
      pushAlert({
        kind: "error",
        title: "PDF",
        message: interpreted.message,
        timeoutMs: 8000,
      });
      return;
    }
    const objectUrl = URL.createObjectURL(interpreted.blob);
    const win = window.open(objectUrl, "_blank", "noopener,noreferrer");
    if (!win) {
      URL.revokeObjectURL(objectUrl);
      pushAlert({
        kind: "info",
        title: "Pop-up blocked",
        message: "Allow pop-ups for this site to view the invoice PDF, or use Download from the invoice screen.",
        timeoutMs: 8000,
      });
      return;
    }
    win.addEventListener("beforeunload", () => URL.revokeObjectURL(objectUrl), { once: true });
    setTimeout(() => URL.revokeObjectURL(objectUrl), 120_000);
  } catch (e: unknown) {
    let msg = "Could not load the invoice PDF.";
    if (e && typeof e === "object" && "response" in e) {
      const data = (e as { response?: { data?: unknown } }).response?.data;
      msg = (await extractMessageFromAxiosErrorData(data)) || msg;
    }
    pushAlert({ kind: "error", title: "PDF", message: String(msg), timeoutMs: 8000 });
  } finally {
    isOpeningMilestoneInvoicePdf.value = false;
  }
}

function viewInvoiceFromMilestoneDetail() {
  if (!milestoneDetailHasInvoice.value) {
    pushAlert({
      kind: "info",
      title: "No invoice yet",
      message: "An invoice will appear here once it is generated for this milestone.",
      timeoutMs: 4500,
    });
    return;
  }
  const inv = milestoneDetailInvoice.value;
  if (!inv) return;
  if (isMilestoneProject.value) {
    if (!milestoneInvoiceIsIssued(inv)) {
      pushAlert({
        kind: "info",
        title: "Invoice not issued yet",
        message: "Issue this invoice using the status control above, then you can view the PDF here.",
        timeoutMs: 6500,
      });
      return;
    }
    void openInvoicePdfInBrowser(inv);
    return;
  }
  activeTab.value = "invoice";
  selectedInvoiceId.value = inv.id;
}

async function resendMilestoneFromDetail() {
  const row = selectedMilestoneDetailRow.value;
  if (!row || milestoneSendSaving.value) return;

  const workLink = row.workLink;
  const imageIds = row.imageIds;
  if (!workLink && !imageIds.length) {
    pushAlert({
      kind: "error",
      title: "Nothing to resend",
      message: "This milestone has no saved work link or attachments. Use Send to add them first.",
      timeoutMs: 6000,
    });
    return;
  }

  milestoneSendSaving.value = true;
  try {
    await postMilestoneSendToClient(row.id, row.sequence, workLink, imageIds);
  } catch {
    // global API handler surfaces errors
  } finally {
    milestoneSendSaving.value = false;
  }
}

function onMilestoneCardPointer(row: MilestoneCardRow, ev: MouseEvent) {
  if (row.showSend) return;
  const el = ev.target as HTMLElement | null;
  if (el?.closest?.("a, button")) return;
  openMilestoneDetailScreen(row);
}

function onMilestoneCardKeydown(row: MilestoneCardRow, ev: KeyboardEvent) {
  if (row.showSend) return;
  if (ev.key !== "Enter" && ev.key !== " ") return;
  if (ev.target !== ev.currentTarget) return;
  ev.preventDefault();
  openMilestoneDetailScreen(row);
}

function milestoneSendFileKind(f: File): "video" | "image" | "file" {
  const t = String(f.type ?? "").toLowerCase();
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("image/")) return "image";
  return "file";
}

function resetMilestoneSendForm() {
  milestoneSendWorkLink.value = "https://";
  milestoneSendFiles.value = [];
  milestoneSendDropActive.value = false;
}

function openMilestoneSendModal(row: MilestoneCardRow) {
  milestoneSendTarget.value = { id: row.id, sequence: row.sequence };
  resetMilestoneSendForm();
  milestoneSendModalOpen.value = true;
}

function closeMilestoneSendModal() {
  milestoneSendModalOpen.value = false;
  milestoneSendTarget.value = null;
  resetMilestoneSendForm();
}

function addMilestoneSendFiles(incoming: File[]) {
  const next = [...milestoneSendFiles.value];
  for (const f of incoming) {
    if (f.size > MILESTONE_SEND_MAX_FILE_BYTES) {
      pushAlert({
        kind: "error",
        title: "File too large",
        message: `"${f.name}" exceeds the 5MB limit.`,
        timeoutMs: 6000,
      });
      continue;
    }
    if (next.length >= MILESTONE_SEND_MAX_FILES) {
      pushAlert({
        kind: "error",
        title: "Too many files",
        message: `You can upload up to ${MILESTONE_SEND_MAX_FILES} files.`,
        timeoutMs: 6000,
      });
      break;
    }
    next.push(f);
  }
  milestoneSendFiles.value = next;
}

function onMilestoneSendFilesPicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = input.files;
  if (!files?.length) return;
  addMilestoneSendFiles(Array.from(files));
  input.value = "";
}

function onMilestoneSendDrop(e: DragEvent) {
  milestoneSendDropActive.value = false;
  const dt = e.dataTransfer;
  if (!dt?.files?.length) return;
  addMilestoneSendFiles(Array.from(dt.files));
}

function removeMilestoneSendFile(idx: number) {
  milestoneSendFiles.value = milestoneSendFiles.value.filter((_, i) => i !== idx);
}

function closeMilestoneSuccessModal() {
  milestoneSuccessModalOpen.value = false;
  milestoneSuccessTitle.value = "";
}

const createdAt = computed(() => formatDetailDate(projectData.value.created_at ?? projectData.value.createdAt));
const startDateShort = computed(() => formatShortDmy(projectData.value.start_date ?? projectData.value.started_at));
const endDateShort = computed(() => formatShortDmy(projectData.value.end_date ?? projectData.value.due_date));

const projectCategoryLabel = computed(() => {
  const p = projectData.value;
  const ps = p.project_scope;
  if (ps && typeof ps === "object" && !Array.isArray(ps)) {
    const name = String((ps as Record<string, unknown>).name ?? "").trim();
    if (name) return name;
  }
  const fallback = p.category ?? p.scope_name;
  const s = fallback != null ? String(fallback).trim() : "";
  return s || "—";
});

const clientCompanyName = computed(() => {
  const c = primaryClient.value as Record<string, unknown> | null;
  const v = c?.brand_name ?? projectData.value.client_brand ?? projectData.value.client_name;
  const s = v != null ? String(v).trim() : "";
  return s || "—";
});

const clientContactName = computed(() => {
  const c = primaryClient.value as Record<string, unknown> | null;
  const v = c?.poc_name ?? c?.display_name ?? c?.name;
  const s = v != null ? String(v).trim() : "";
  return s || "—";
});

function projectTaxInclusive(): boolean | null {
  const raw = projectData.value.gst_inclusive ?? projectData.value.is_gst_inclusive ?? projectData.value.tax_inclusive;
  if (raw == null || raw === "") return null;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw === 1;
  const s = String(raw).trim().toLowerCase();
  if (s === "yes" || s === "true" || s === "1" || s === "inclusive") return true;
  if (s === "no" || s === "false" || s === "0" || s === "exclusive") return false;
  return null;
}

const taxInclusiveLine = computed(() => {
  const v = projectTaxInclusive();
  if (v == null) return "—";
  return v ? "Inclusive of GST Tax" : "Exclusive of GST Tax";
});

/** Short label for invoice details panel (matches invoice preview wording). */
const taxInclusiveShortLabel = computed(() => {
  const v = projectTaxInclusive();
  if (v == null) return "—";
  return v ? "Including GST" : "Excluding GST";
});

const scope = computed(() => {
  const p = projectData.value;
  const direct = p.scope_description ?? p.description ?? p.scope;
  if (direct != null && String(direct).trim()) return String(direct).trim();
  const ps = p.project_scope;
  if (ps && typeof ps === "object" && !Array.isArray(ps)) {
    const po = ps as Record<string, unknown>;
    const label = po.description ?? po.details ?? po.name ?? po.title ?? po.label;
    if (label != null && String(label).trim()) return String(label);
  }
  return "—";
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
const paymentScheduleDate = computed(() =>
  formatDetailDate(projectData.value.payment_schedule_date ?? projectData.value.paymentScheduleDate),
);

const taxAmountWithPercent = computed(() => {
  const amt = gstAmountLabel.value;
  const pct = gstRateLabel.value;
  if (amt === "—" && pct === "—") return "—";
  if (pct === "—") return amt;
  if (amt === "—") return pct;
  return `${amt} (${pct})`;
});

const paidWhenLabel = computed(() =>
  formatPaymentScheduleHuman(
    projectData.value.payment_schedule ?? projectData.value.paymentSchedule,
    paymentScheduleDate.value,
  ),
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
  const raw =
    p.images ??
    p.media ??
    p.project_images ??
    p.projectImages ??
    p.attachments ??
    p.files ??
    p.gallery;
  const list = toArray(raw);

  function fileNameFromUrl(url: string): string {
    try {
      const u = new URL(url);
      const base = u.pathname.split("/").filter(Boolean).pop() ?? url;
      return decodeURIComponent(base);
    } catch {
      const cleaned = url.split("?")[0] ?? url;
      const base = cleaned.split("/").filter(Boolean).pop() ?? cleaned;
      return base || "Attachment";
    }
  }

  function isImageUrl(url: string): boolean {
    const u = String(url ?? "").toLowerCase();
    return /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/.test(u);
  }

  function pickAttachmentName(record: any, fallbackUrl: string): string {
    const keys = ["name", "original_name", "originalName", "filename", "file_name", "title", "label"] as const;
    for (const k of keys) {
      const v = record?.[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return fileNameFromUrl(fallbackUrl);
  }

  return list
    .map((m) => {
      if (!m) return null;
      if (typeof m === "string") {
        const url = resolveStorageUrl(m);
        if (!url) return null;
        return { url, name: fileNameFromUrl(url), kind: isImageUrl(url) ? ("image" as const) : ("file" as const) };
      }
      if (typeof m === "object") {
        const source = resolveImageRecordSource(m);
        const url = resolveStorageUrl(source);
        if (!url) return null;
        return { url, name: pickAttachmentName(m, url), kind: isImageUrl(url) ? ("image" as const) : ("file" as const) };
      }
      return null;
    })
    .filter(Boolean) as { url: string; name: string; kind: "image" | "file" }[];
});

const protectedImageSrc = ref(new Map<string, string>());

function cleanupProtectedImageSrc(keep: Set<string>) {
  for (const [url, blobUrl] of protectedImageSrc.value.entries()) {
    if (keep.has(url)) continue;
    try {
      URL.revokeObjectURL(blobUrl);
    } catch {
      // ignore
    }
    protectedImageSrc.value.delete(url);
  }
}

async function ensureProtectedImage(url: string) {
  if (!url || protectedImageSrc.value.has(url)) return;
  const token = getAuthToken();
  if (!token) return;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    protectedImageSrc.value.set(url, blobUrl);
  } catch {
    // ignore — fall back to direct URL
  }
}

const mediaImageSrc = (m: { url: string; kind: "image" | "file" }) => {
  if (m.kind !== "image") return "";
  return protectedImageSrc.value.get(m.url) || m.url;
};

const protectedImageSourceUrls = computed(() => {
  const fromMedia = mediaItems.value.map((m) => m.url);
  const fromMilestones = milestoneRows.value.flatMap((r) =>
    r.images.filter((i) => i.kind === "image").map((i) => i.url),
  );
  return [...new Set([...fromMedia, ...fromMilestones])];
});

watch(
  protectedImageSourceUrls,
  (urls) => {
    const keep = new Set(urls);
    cleanupProtectedImageSrc(keep);
    for (const u of urls) void ensureProtectedImage(u);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  cleanupProtectedImageSrc(new Set());
});

type InvoiceRow = {
  id: string;
  number: string;
  currency?: string;
  amountSubtotal?: number;
  amountTax?: number;
  amountTotal?: number;
  issuedAt?: string;
  dueDate?: string;
  gstRate?: number;
  notes?: string;
  terms?: string;
  statusLabel: string;
  /** Dropdown / API status key (distinct from statusVariant, which collapses some states for styling). */
  statusKey: InvoiceStatusKey;
  statusVariant: string;
  /** Keep raw invoice payload for features like payment evidence. */
  raw: Record<string, unknown>;
  /** From API `follow_up_*` when present */
  followUpEnabled?: boolean;
  followUpTone?: string;
  followUpMethod?: string;
  followUpFrequency?: string;
  followUpMessage?: string;
};

function normalizeInvoiceStatus(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  return s
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatInvoiceDate(raw: unknown): string {
  if (raw == null || raw === "") return "—";
  const s = String(raw).trim();
  if (!s) return "—";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return s;
  const dd = String(d.getDate()).padStart(2, "0");
  const mon = d.toLocaleDateString("en-GB", { month: "short" });
  const yyyy = d.getFullYear();
  return `${dd} ${mon}, ${yyyy}`;
}

function formatInvoiceDateLong(raw: unknown): string {
  if (raw == null || raw === "") return "—";
  const s = String(raw).trim();
  if (!s) return "—";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** MM/DD/YYYY for follow-up message preview */
function formatInvoiceDueUs(raw: unknown): string {
  if (raw == null || raw === "") return "—";
  const s = String(raw).trim();
  if (!s) return "—";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

function invoiceStatusVariant(raw: unknown): string {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!s) return "unknown";
  if (["not_issued", "notissued", "draft"].includes(s)) return "not_issued";
  if (["in_review", "review", "under_review"].includes(s)) return "issued";
  if (["issued", "sent", "unpaid"].includes(s)) return "issued";
  if (["approved", "accepted", "confirmed"].includes(s)) return "issued";
  if (["paid", "settled"].includes(s)) return "paid";
  if (["delayed", "overdue", "past_due"].includes(s)) return "overdue";
  if (["rejected", "cancelled", "canceled", "void", "declined"].includes(s)) return "cancelled";
  return "unknown";
}

/** Maps API/raw status to the invoice status dropdown keys (must stay aligned with invoiceStatusOptions). */
function normalizeInvoiceStatusKey(raw: unknown): InvoiceStatusKey {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!s) return "not_issued";
  if (["not_issued", "notissued", "draft"].includes(s)) return "not_issued";
  if (["in_review", "review", "under_review"].includes(s)) return "in_review";
  if (["issued", "sent", "unpaid"].includes(s)) return "issued";
  if (["approved", "accepted", "confirmed"].includes(s)) return "approved";
  if (["paid", "settled"].includes(s)) return "paid";
  if (["delayed", "overdue", "past_due"].includes(s)) return "delayed";
  if (["rejected", "cancelled", "canceled", "void", "declined"].includes(s)) return "rejected";
  return "not_issued";
}

/**
 * Human-readable invoice # for UI and follow-up copy. Prefer explicit invoice_* / reference fields;
 * use generic `number` last — some APIs store an internal id there while `invoice_number` is the label.
 */
function pickInvoiceDisplayNumber(o: Record<string, unknown>, index: number): string {
  const meta =
    o.meta && typeof o.meta === "object" && !Array.isArray(o.meta)
      ? (o.meta as Record<string, unknown>)
      : null;
  const candidates: unknown[] = [
    o.invoice_no,
    o.invoice_number,
    o.invoiceNumber,
    o.reference,
    o.invoice_reference,
    o.document_number,
    o.serial,
    o.code,
    meta?.invoice_no,
    meta?.invoice_number,
    o.number,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    const s = String(c).trim();
    if (s) return s;
  }
  return `2025-ELE-00${index + 1}`;
}

const invoiceItems = computed<InvoiceRow[]>(() => {
  const p = projectData.value as any;
  const raw =
    p.invoices ??
    p.invoice_list ??
    p.project_invoices ??
    p.invoice ??
    (p.billing && typeof p.billing === "object" && !Array.isArray(p.billing) ? p.billing.invoices : undefined) ??
    [];
  const list = toArray(raw);

  return list
    .map((inv, index) => {
      if (!inv || typeof inv !== "object") return null;
      const o = inv as any;
      const id = String(o.id ?? o.uuid ?? `invoice-${index}`);
      const rawNumber = pickInvoiceDisplayNumber(o as Record<string, unknown>, index);
      const number = rawNumber.startsWith("#") ? rawNumber : `#${rawNumber}`;

      const statusRaw = o.status ?? o.state ?? o.invoice_status;
      const statusLabel = normalizeInvoiceStatus(statusRaw) || "—";
      const statusKey = normalizeInvoiceStatusKey(statusRaw);
      const statusVariant = invoiceStatusVariant(statusRaw);
      const notes = String(o.notes ?? o.note ?? o.meta?.notes ?? "").trim() || undefined;
      const terms = String(o.terms ?? o.payment_terms ?? o.meta?.terms ?? "").trim() || undefined;

      const currency = String(o.currency ?? o.currency_code ?? "").trim() || undefined;
      const subtotalN = Number(String(o.amount_subtotal ?? o.subtotal ?? "").replace(/,/g, ""));
      const taxN = Number(String(o.amount_tax ?? o.tax_amount ?? "").replace(/,/g, ""));
      const totalN = Number(String(o.amount_total ?? o.total ?? o.total_amount ?? "").replace(/,/g, ""));
      const amountSubtotal = Number.isFinite(subtotalN) ? subtotalN : undefined;
      const amountTax = Number.isFinite(taxN) ? taxN : undefined;
      const amountTotal = Number.isFinite(totalN) ? totalN : undefined;

      const issuedAt = String(o.issued_at ?? o.issuedAt ?? o.created_at ?? "").trim() || undefined;
      const dueDate = String(o.due_date ?? o.dueDate ?? "").trim() || undefined;

      const gstRateN = Number(String(o.gst_rate ?? o.tax_rate ?? "").replace(/%/g, ""));
      const gstRate = Number.isFinite(gstRateN) ? gstRateN : undefined;

      const followUpEnabled =
        typeof o.follow_up_enabled === "boolean" ? o.follow_up_enabled : undefined;
      const followUpTone = typeof o.follow_up_tone === "string" ? o.follow_up_tone : undefined;
      const followUpMethod = typeof o.follow_up_method === "string" ? o.follow_up_method : undefined;
      const followUpFrequency = typeof o.follow_up_frequency === "string" ? o.follow_up_frequency : undefined;
      const followUpMessage = typeof o.follow_up_message === "string" ? o.follow_up_message : undefined;

      return {
        id,
        number,
        currency,
        amountSubtotal,
        amountTax,
        amountTotal,
        issuedAt,
        dueDate,
        gstRate,
        notes,
        terms,
        statusLabel,
        statusKey,
        statusVariant,
        raw: o as Record<string, unknown>,
        followUpEnabled,
        followUpTone,
        followUpMethod,
        followUpFrequency,
        followUpMessage,
      };
    })
    .filter(Boolean) as InvoiceRow[];
});

const milestoneDetailInvoice = computed(() => {
  const row = selectedMilestoneDetailRow.value;
  if (!row) return null as InvoiceRow | null;
  for (const inv of invoiceItems.value) {
    if (invoiceBelongsToMilestone(inv.raw, row.id)) return inv;
  }
  return null;
});

const milestoneDetailHasInvoice = computed(() => milestoneDetailInvoice.value != null);

const milestoneDetailInvoiceReady = computed(
  () => !!selectedMilestoneDetailRow.value && milestoneDetailClientStep.value.variant === "approved" && milestoneDetailHasInvoice.value,
);

const isMilestoneInvoiceStatusLocked = computed(() => milestoneDetailInvoice.value?.statusVariant === "paid");

const milestoneInvoiceStatusUiLabel = computed(() => {
  if (milestoneDetailClientStep.value.variant !== "approved") return "Pending";
  if (!milestoneDetailInvoice.value) return "Not Issued";
  return milestoneDetailInvoice.value.statusLabel;
});

/** Aligns with `project-details-invoice-status` [data-variant] (pre-approval uses neutral styling). */
const milestoneInvoiceStatusUiDataVariant = computed(() => {
  if (milestoneDetailClientStep.value.variant !== "approved") return "not_issued";
  if (!milestoneDetailInvoice.value) return "not_issued";
  return milestoneDetailInvoice.value.statusVariant;
});

const milestoneDetailPaymentStep = computed(() => {
  if (milestoneDetailClientStep.value.variant !== "approved") {
    return { text: "Pending", variant: "pending" as const };
  }
  const inv = milestoneDetailInvoice.value;
  if (!inv) return { text: "Pending", variant: "pending" as const };
  if (inv.statusKey === "paid") return { text: "Paid", variant: "paid" as const };
  return { text: "Pending", variant: "pending" as const };
});

const invoiceCount = computed(() => invoiceItems.value.length);

const projectCurrency = computed(() => String(projectData.value.currency ?? projectData.value.currency_code ?? "PKR"));
const projectAmountFormatted = computed(() => {
  const raw = projectData.value.amount ?? projectData.value.total_amount ?? projectData.value.totalAmount;
  const n = Number(String(raw ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-PK");
});

const activeInvoice = computed<InvoiceRow | null>(() => selectedInvoice.value ?? null);

const invoiceCurrency = computed(() => activeInvoice.value?.currency ?? projectCurrency.value);

const invoiceTotalFormatted = computed(() => {
  const invTotal = activeInvoice.value?.amountTotal;
  if (typeof invTotal === "number" && Number.isFinite(invTotal)) return invTotal.toLocaleString("en-PK");
  return projectAmountFormatted.value;
});

const invoiceIssuedOn = computed(() => {
  const inv = activeInvoice.value;
  const raw = inv?.issuedAt ?? projectData.value.start_date ?? projectData.value.started_at ?? projectData.value.created_at;
  return formatInvoiceDate(raw);
});
const invoiceDueOn = computed(() => {
  const inv = activeInvoice.value;
  const raw = inv?.dueDate ?? projectData.value.end_date ?? projectData.value.due_date ?? projectData.value.dueDate;
  return formatInvoiceDate(raw);
});

const invoiceIssuedOnLong = computed(() => {
  const inv = activeInvoice.value;
  const raw = inv?.issuedAt ?? projectData.value.start_date ?? projectData.value.started_at ?? projectData.value.created_at;
  return formatInvoiceDateLong(raw);
});
const invoiceDueOnLong = computed(() => {
  const inv = activeInvoice.value;
  const raw = inv?.dueDate ?? projectData.value.end_date ?? projectData.value.due_date ?? projectData.value.dueDate;
  return formatInvoiceDateLong(raw);
});

const numericProjectTotal = computed(() => {
  const raw = projectData.value.amount ?? projectData.value.total_amount ?? projectData.value.totalAmount;
  const n = Number(String(raw ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
});

const numericGstAmount = computed(() => {
  const raw = projectData.value.gst_amount ?? projectData.value.tax_amount;
  const n = Number(String(raw ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
});

const invoicePreviewSubtotal = computed(() => {
  const inv = activeInvoice.value;
  if (inv?.amountSubtotal != null && Number.isFinite(inv.amountSubtotal)) return inv.amountSubtotal;
  const total = numericProjectTotal.value;
  const tax = numericGstAmount.value;
  const inclusive = projectTaxInclusive();
  if (!Number.isFinite(total)) return NaN;
  if (!Number.isFinite(tax)) return total;
  if (inclusive === true) return total - tax;
  if (inclusive === false) return total;
  return total - tax;
});

const invoicePreviewTaxAmount = computed(() => {
  const inv = activeInvoice.value;
  if (inv?.amountTax != null && Number.isFinite(inv.amountTax)) return inv.amountTax;
  const tax = numericGstAmount.value;
  return Number.isFinite(tax) ? tax : NaN;
});

const invoicePreviewGrandTotal = computed(() => {
  const inv = activeInvoice.value;
  if (inv?.amountTotal != null && Number.isFinite(inv.amountTotal)) return inv.amountTotal;
  const total = numericProjectTotal.value;
  const tax = numericGstAmount.value;
  const inclusive = projectTaxInclusive();
  if (!Number.isFinite(total)) return NaN;
  if (!Number.isFinite(tax)) return total;
  if (inclusive === true) return total;
  if (inclusive === false) return total + tax;
  return total;
});

function previewMoney(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  return `${invoiceCurrency.value} ${amount.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const invoicePreviewTaxLabel = computed(() => {
  const inv = activeInvoice.value;
  const pct = typeof inv?.gstRate === "number" && Number.isFinite(inv.gstRate) ? `${inv.gstRate}%` : gstRateLabel.value;
  if (pct && pct !== "—") return `Tax (${pct})`;
  return "Tax";
});

const invoiceIssuerBlock = computed(() => {
  const userBlock = formatUserInvoiceBlock(currentUserProfile.value).trim();
  if (userBlock) return userBlock;

  const p = projectData.value as Record<string, unknown>;
  const org = p.organization ?? p.business ?? p.vendor ?? p.seller;
  if (org && typeof org === "object" && !Array.isArray(org)) {
    const o = org as Record<string, unknown>;
    const name = String(o.name ?? o.company_name ?? "").trim();
    const line1 = String(o.address ?? o.address_line1 ?? "").trim();
    const line2 = [o.city, o.state, o.postal_code ?? o.zip]
      .map((x) => (x != null ? String(x).trim() : ""))
      .filter(Boolean)
      .join(", ");
    const email = String(o.email ?? "").trim();
    const parts = [name, [line1, line2].filter(Boolean).join(", "), email].filter(Boolean);
    if (parts.length) return parts.join("\n");
  }
  const fromMeta = p.meta && typeof p.meta === "object" && !Array.isArray(p.meta) ? (p.meta as any).invoice_from : "";
  const s = fromMeta != null ? String(fromMeta).trim() : "";
  return s || "—";
});

const invoiceClientBlock = computed(() => {
  const c = primaryClient.value as Record<string, unknown> | null;
  const lines: string[] = [];
  const company = clientCompanyName.value;
  if (company && company !== "—") lines.push(company);
  const a1 = c?.address_line1 ?? c?.address ?? c?.street;
  const a1s = a1 != null ? String(a1).trim() : "";
  const city = c?.city != null ? String(c.city).trim() : "";
  const region = c?.state ?? c?.province ?? c?.region;
  const regions = region != null ? String(region).trim() : "";
  const zip = c?.postal_code ?? c?.zip ?? c?.zip_code;
  const zips = zip != null ? String(zip).trim() : "";
  const cityLine = [city, regions, zips].filter(Boolean).join(", ");
  if (a1s) lines.push(a1s);
  if (cityLine) lines.push(cityLine);
  const em = clientEmail.value;
  if (em && em !== "—") lines.push(em);
  return lines.length ? lines.join("\n") : "—";
});

const invoiceCards = computed<InvoiceRow[]>(() => {
  if (invoiceItems.value.length) return invoiceItems.value;
  return [
    {
      id: "project-invoice",
      number: "#—",
      notes: DEFAULT_INVOICE_NOTES,
      terms: DEFAULT_INVOICE_TERMS,
      statusLabel: "Not Issued",
      statusKey: "not_issued",
      statusVariant: "not_issued",
      raw: {},
    },
  ];
});

const selectedInvoice = computed<InvoiceRow | null>(() => {
  if (!selectedInvoiceId.value) return null;
  return invoiceCards.value.find((x) => x.id === selectedInvoiceId.value) ?? null;
});

const isInvoiceStatusLocked = computed(() => selectedInvoice.value?.statusVariant === "paid");

const invoicePreviewLineAmount = computed(() => {
  const sub = invoicePreviewSubtotal.value;
  if (Number.isFinite(sub)) return sub;
  return numericProjectTotal.value;
});

type InvoicePreviewLineItem = {
  id: string;
  sourceTitle: string;
  sourceDescription?: string;
  dateLabel: string;
  amountLabel: string;
};

function pickProjectInvoiceSubject(): string {
  const p = projectData.value as Record<string, unknown>;
  const candidates: unknown[] = [p.title, p.name, p.project_name, p.projectTitle, p.projectName];
  for (const c of candidates) {
    const s = c != null ? String(c).trim() : "";
    if (s) return s;
  }
  return "Invoice";
}

const invoicePreviewSubject = computed(() => pickProjectInvoiceSubject());

function normalizeInvoiceLineItemsFromRaw(raw: Record<string, unknown> | undefined): InvoicePreviewLineItem[] {
  if (!raw || typeof raw !== "object") return [];
  const candidates: unknown[] = [
    (raw as any).items,
    (raw as any).line_items,
    (raw as any).lineItems,
    (raw as any).lines,
    (raw as any).milestones,
  ];
  const arr = candidates.find((x) => Array.isArray(x)) as unknown[] | undefined;
  if (!arr) return [];

  return arr
    .map((it, index) => {
      const o = it && typeof it === "object" && !Array.isArray(it) ? (it as Record<string, unknown>) : null;
      if (!o) return null;
      const id = String(o.id ?? o.uuid ?? `line-${index}`);
      const title = String(o.title ?? o.name ?? o.source ?? o.label ?? "").trim();
      const description = String(o.description ?? o.details ?? o.note ?? o.notes ?? "").trim();
      const dateRaw = o.date ?? o.due_on ?? o.due_date ?? o.issued_at ?? o.created_at;
      const dateLabel = formatInvoiceDate(dateRaw);
      const amtRaw = o.amount ?? o.total ?? o.value ?? o.price;
      const n = Number(String(amtRaw ?? "").replace(/,/g, ""));
      const amountLabel = Number.isFinite(n) ? previewMoney(n) : "—";
      const sourceTitle = title || `Item ${index + 1}`;
      return {
        id,
        sourceTitle,
        sourceDescription: description || undefined,
        dateLabel,
        amountLabel,
      } satisfies InvoicePreviewLineItem;
    })
    .filter(Boolean) as InvoicePreviewLineItem[];
}

function invoicePreviewLineItemsFromMilestones(): InvoicePreviewLineItem[] {
  const p = projectData.value as Record<string, unknown>;
  const ms = toArray(p.milestones ?? p.project_milestones);
  const currency = invoiceCurrency.value;
  return ms
    .map((m, index) => {
      const o = m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : {};
      const id = String(o.id ?? o.uuid ?? `milestone-${index}`);
      const seq = Number(o.sequence ?? o.order ?? index + 1);
      const sequence = Number.isFinite(seq) ? seq : index + 1;
      const titleRaw = String(o.title ?? "").trim();
      const sourceTitle = titleRaw || `${sequence} Milestone`;
      const sourceDescription = String(o.deliverables ?? o.description ?? o.details ?? "").trim() || undefined;
      const dateRaw = o.due_on ?? o.dueOn ?? o.due_date ?? o.date ?? projectData.value.end_date ?? projectData.value.due_date;
      const dateLabel = formatInvoiceDate(dateRaw);
      const amt = o.amount ?? o.value;
      const n = Number(String(amt ?? "").replace(/,/g, ""));
      const amountLabel = Number.isFinite(n)
        ? `${currency} ${n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "—";
      return { id, sourceTitle, sourceDescription, dateLabel, amountLabel } satisfies InvoicePreviewLineItem;
    })
    .filter((x) => x.sourceTitle.trim() || x.amountLabel !== "—");
}

const invoicePreviewLineItems = computed<InvoicePreviewLineItem[]>(() => {
  const fromRaw = normalizeInvoiceLineItemsFromRaw(activeInvoice.value?.raw);
  if (fromRaw.length) return fromRaw;
  if (isMilestoneProject.value) {
    const fromMilestones = invoicePreviewLineItemsFromMilestones();
    if (fromMilestones.length) return fromMilestones;
  }
  return [
    {
      id: "single",
      sourceTitle: invoicePreviewSubject.value,
      sourceDescription: undefined,
      dateLabel: invoiceIssuedOn.value,
      amountLabel: previewMoney(invoicePreviewLineAmount.value),
    },
  ];
});

const invoicePreviewNotes = computed(() => {
  const n = selectedInvoice.value?.notes?.trim();
  return n || DEFAULT_INVOICE_NOTES;
});

const invoicePreviewTerms = computed(() => {
  const t = selectedInvoice.value?.terms?.trim();
  return t || DEFAULT_INVOICE_TERMS;
});

const invoiceDetailsOpenSections = ref({
  invoiceDetails: true,
  notes: true,
  terms: true,
});

function toggleInvoiceDetailsSection(key: keyof typeof invoiceDetailsOpenSections.value) {
  invoiceDetailsOpenSections.value[key] = !invoiceDetailsOpenSections.value[key];
}

const invoicePreviewExpanded = ref(false);

function openInvoiceDetails(id: string) {
  selectedInvoiceId.value = id;
}

function closeInvoiceDetails() {
  selectedInvoiceId.value = null;
  invoicePreviewExpanded.value = false;
  followUpModalOpen.value = false;
}

/** Backend-hosted PDF when present (prefer static PDF over signed/ephemeral `pdf_url`). */
function invoiceRemotePdfUrl(raw: Record<string, unknown> | undefined): string | null {
  if (!raw || typeof raw !== "object") return null;
  const candidates: unknown[] = [raw.static_pdf_url, raw.staticPdfUrl, raw.pdf_url, raw.pdfUrl];
  for (const u of candidates) {
    if (typeof u !== "string") continue;
    const s = u.trim();
    if (s && /^https?:\/\//i.test(s)) return s;
  }
  return null;
}

/** True when we can offer PDF download: persisted invoice, or any row with a remote PDF URL. */
function canDownloadInvoicePdf(inv: InvoiceRow | null | undefined): boolean {
  if (!inv) return false;
  if (invoiceRemotePdfUrl(inv.raw)) return true;
  if (!inv.id || inv.id === "project-invoice") return false;
  if (/^invoice-\d+$/.test(inv.id)) return false;
  return true;
}

const isDownloadingInvoicePdf = ref(false);
/** Root of the on-screen invoice card — captured to PDF (same layout as the preview). */
const invoicePreviewCaptureRef = ref<HTMLElement | null>(null);

async function downloadInvoicePdf(inv: InvoiceRow) {
  if (!canDownloadInvoicePdf(inv)) return;
  const remoteUrl = invoiceRemotePdfUrl(inv.raw);
  if (remoteUrl) {
    isDownloadingInvoicePdf.value = true;
    try {
      const base = String(inv.number ?? "")
        .replace(/^#/, "")
        .replace(/[^\w.-]+/g, "_")
        .trim();
      const filename = `invoice-${base || inv.id}.pdf`;
      try {
        const res = await fetch(remoteUrl, { mode: "cors" });
        if (res.ok) {
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = filename;
          a.rel = "noopener";
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(blobUrl);
          return;
        }
      } catch {
        /* cross-origin or network — open in new tab */
      }
      window.open(remoteUrl, "_blank", "noopener,noreferrer");
    } finally {
      isDownloadingInvoicePdf.value = false;
    }
    return;
  }

  isDownloadingInvoicePdf.value = true;
  const wasExpanded = invoicePreviewExpanded.value;
  try {
    activeTab.value = "invoice";
    selectedInvoiceId.value = inv.id;
    invoicePreviewExpanded.value = false;

    await nextTick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await new Promise((r) => setTimeout(r, 120));

    const el = invoicePreviewCaptureRef.value;
    if (!el) {
      pushAlert({
        kind: "error",
        title: "PDF",
        message: "Invoice preview is not on screen. Open the Invoice tab and try again.",
        timeoutMs: 6000,
      });
      return;
    }

    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#ffffff",
      logging: false,
      ignoreElements: (node) =>
        node instanceof HTMLElement && node.classList.contains("project-details-invoice-preview-expand"),
    });

    const imgData = canvas.toDataURL("image/png", 1.0);
    const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const maxW = pageW - margin * 2;
    const maxH = pageH - margin * 2;
    const ratio = canvas.width / canvas.height;
    let w = maxW;
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    const x = (pageW - w) / 2;
    const y = margin + (maxH - h) / 2;
    pdf.addImage(imgData, "PNG", x, y, w, h);

    const base = String(inv.number ?? "")
      .replace(/^#/, "")
      .replace(/[^\w.-]+/g, "_")
      .trim();
    pdf.save(`invoice-${base || inv.id}.pdf`);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Could not create the invoice PDF.";
    pushAlert({ kind: "error", title: "PDF failed", message: msg, timeoutMs: 8000 });
  } finally {
    invoicePreviewExpanded.value = wasExpanded;
    isDownloadingInvoicePdf.value = false;
  }
}

type FollowUpTone = "gentle" | "firm";
type FollowUpMethod = "email" | "whatsapp";
type FollowUpFrequency = "every_3_days" | "weekly";

type FollowUpSettings = {
  enabled: boolean;
  tone: FollowUpTone;
  method: FollowUpMethod;
  frequency: FollowUpFrequency;
  /** Custom copy when set; otherwise the tone-based default is used */
  message?: string;
};

const followUpDefaults: FollowUpSettings = {
  enabled: false,
  tone: "gentle",
  method: "whatsapp",
  frequency: "every_3_days",
  message: undefined,
};

const followUpSaved = ref<FollowUpSettings>({ ...followUpDefaults });
const followUpDraft = ref<FollowUpSettings>({ ...followUpDefaults });
const followUpModalOpen = ref(false);

watch(
  [selectedInvoiceId, invoiceItems],
  () => {
    followUpSaved.value = followUpSettingsFromInvoiceRow(selectedInvoice.value);
  },
  { immediate: true },
);

/** Row toggle: on when automation is saved on, or while the setup popup is open */
const followUpToggleOn = computed(() => followUpSaved.value.enabled || followUpModalOpen.value);

function openFollowUpModal() {
  // Always allow opening the setup/edit dialog
  followUpDraft.value = { ...followUpSaved.value, enabled: true };
  followUpModalOpen.value = true;
}

function onFollowUpToggleClick() {
  if (followUpModalOpen.value) {
    cancelFollowUpModal();
    return;
  }
  if (followUpSaved.value.enabled) {
    followUpSaved.value = { ...followUpSaved.value, enabled: false };
    return;
  }
  followUpDraft.value = { ...followUpSaved.value, enabled: true };
  followUpModalOpen.value = true;
}

function toApiFollowUpTone(tone: FollowUpTone): string {
  return tone === "firm" ? "firm_notice" : "gentle_reminder";
}
function toApiFollowUpFrequency(freq: FollowUpFrequency): string {
  return freq === "weekly" ? "weekly_until_paid" : "after_3_days_until_paid";
}
function fromApiFollowUpTone(raw: unknown): FollowUpTone {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s.includes("firm")) return "firm";
  return "gentle";
}
function fromApiFollowUpFrequency(raw: unknown): FollowUpFrequency {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s.includes("week")) return "weekly";
  return "every_3_days";
}
function fromApiFollowUpMethod(raw: unknown): FollowUpMethod {
  const s = String(raw ?? "").trim().toLowerCase();
  return s === "email" ? "email" : "whatsapp";
}

function followUpSettingsFromInvoiceRow(inv: InvoiceRow | null): FollowUpSettings {
  if (!inv || inv.id === "project-invoice") {
    return { ...followUpDefaults };
  }
  const hasFollow =
    typeof inv.followUpEnabled === "boolean" ||
    inv.followUpTone != null ||
    inv.followUpMethod != null ||
    inv.followUpFrequency != null ||
    (typeof inv.followUpMessage === "string" && inv.followUpMessage.trim() !== "");
  if (!hasFollow) {
    return { ...followUpDefaults };
  }
  return {
    enabled: typeof inv.followUpEnabled === "boolean" ? inv.followUpEnabled : followUpDefaults.enabled,
    tone: inv.followUpTone != null ? fromApiFollowUpTone(inv.followUpTone) : followUpDefaults.tone,
    method: inv.followUpMethod != null ? fromApiFollowUpMethod(inv.followUpMethod) : followUpDefaults.method,
    frequency:
      inv.followUpFrequency != null ? fromApiFollowUpFrequency(inv.followUpFrequency) : followUpDefaults.frequency,
    message: inv.followUpMessage?.trim() || undefined,
  };
}

function followUpSettingsFromApiPayload(o: Record<string, unknown> | null): FollowUpSettings | null {
  if (!o) return null;
  const msg = o.follow_up_message;
  return {
    enabled: !!o.follow_up_enabled,
    tone: o.follow_up_tone != null ? fromApiFollowUpTone(o.follow_up_tone) : followUpDefaults.tone,
    method: o.follow_up_method != null ? fromApiFollowUpMethod(o.follow_up_method) : followUpDefaults.method,
    frequency:
      o.follow_up_frequency != null ? fromApiFollowUpFrequency(o.follow_up_frequency) : followUpDefaults.frequency,
    message: typeof msg === "string" && msg.trim() ? msg.trim() : undefined,
  };
}

/** Axios response body: `{ data: { ...invoice } }` */
function unwrapInvoiceFromPatchResponse(res: unknown): Record<string, unknown> | null {
  const r = res as { data?: unknown } | null;
  const body = r?.data;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const outer = body as Record<string, unknown>;
  const inner = outer.data;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return outer;
}

function setFollowUpDraftTone(tone: FollowUpTone) {
  followUpDraft.value.tone = tone;
}

function moneyStringForApi(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

/** Subtotal for invoice PATCH validation (API expects `subtotal`). */
function resolveInvoiceSubtotalForApi(): string {
  const inv = activeInvoice.value;
  if (inv?.amountSubtotal != null && Number.isFinite(inv.amountSubtotal)) {
    return moneyStringForApi(inv.amountSubtotal);
  }
  const fromPreview = invoicePreviewSubtotal.value;
  if (Number.isFinite(fromPreview)) return moneyStringForApi(fromPreview);
  const total = numericProjectTotal.value;
  const tax = numericGstAmount.value;
  const inclusive = projectTaxInclusive();
  if (Number.isFinite(total)) {
    if (!Number.isFinite(tax)) return moneyStringForApi(total);
    if (inclusive === true) return moneyStringForApi(total - tax);
    if (inclusive === false) return moneyStringForApi(total);
    return moneyStringForApi(total - tax);
  }
  return "0.00";
}

async function saveFollowUpModal() {
  // If we don't have a real invoice id (fallback card), just save locally.
  const invoiceId = selectedInvoice.value?.id;
  if (!invoiceId || invoiceId === "project-invoice") {
    followUpSaved.value = { ...followUpDraft.value };
    followUpModalOpen.value = false;
    return;
  }

  const draft = followUpDraft.value;
  const payload = {
    subtotal: resolveInvoiceSubtotalForApi(),
    follow_up_enabled: !!draft.enabled,
    follow_up_tone: toApiFollowUpTone(draft.tone),
    follow_up_method: draft.method,
    follow_up_frequency: toApiFollowUpFrequency(draft.frequency),
    follow_up_message: followUpMessagePreview.value,
  };

  try {
    const res = await updateInvoiceFollowUp(invoiceId, payload);
    const invoicePayload = unwrapInvoiceFromPatchResponse(res);
    const fromApi = followUpSettingsFromApiPayload(invoicePayload);
    followUpSaved.value = fromApi ?? { ...followUpDraft.value };

    followUpModalOpen.value = false;

    // Refresh invoice list/details in case backend returns updated invoice fields.
    await loadProjectDetails();
  } catch {
    // Alerts are handled globally by the API client interceptor.
  }
}

function cancelFollowUpModal() {
  followUpModalOpen.value = false;
}

function resolveInvoiceTermsTemplateIdForIssue(invRaw: Record<string, unknown> | null | undefined): string | null {
  const raw = invRaw ?? (projectData.value as any);
  if (!raw || typeof raw !== "object") return null;

  const candidates: unknown[] = [
    (raw as any).invoice_terms_template_id,
    (raw as any).terms_template_id,
    (raw as any).invoiceTermsTemplateId,
    (raw as any).termsTemplateId,
    (raw as any).invoice_terms_template?.id,
    (raw as any).terms_template?.id,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    const s = String(c).trim();
    if (s) return s;
  }
  return null;
}

function pickTermsTemplateIdFromCreateResponse(res: unknown): string | null {
  const body = (res as { data?: unknown })?.data;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  const dataLayer = o.data;
  if (dataLayer && typeof dataLayer === "object" && !Array.isArray(dataLayer)) {
    const inner = dataLayer as Record<string, unknown>;
    const id = inner.id ?? inner.uuid;
    if (id != null && String(id).trim()) return String(id).trim();
  }
  const id = o.id ?? o.uuid;
  if (id != null && String(id).trim()) return String(id).trim();
  return null;
}

const invoiceIssueTemplateModalOpen = ref(false);
const issuePickerRevertStatus = ref<InvoiceStatusKey>("not_issued");
const issuePickerNeedsRevertOnClose = ref(false);
const issueTermsTemplates = ref<InvoiceTermsTemplateApi[]>([]);
const issueTermsLoading = ref(false);
const issueTermsMode = ref<"existing" | "new">("existing");
const issueSelectedTemplateId = ref("");
const issueNewTemplateName = ref("");
const issueNewTemplateBody = ref("");

const issueSelectedTemplateBody = computed(() => {
  const id = String(issueSelectedTemplateId.value ?? "").trim();
  if (!id) return "";
  const t = issueTermsTemplates.value.find((x) => x.id === id);
  return String(t?.body ?? "");
});

watch(invoiceIssueTemplateModalOpen, (open) => {
  if (open) return;
  if (!issuePickerNeedsRevertOnClose.value) return;
  invoiceStatusDraft.value = { ...invoiceStatusDraft.value, status: issuePickerRevertStatus.value };
  issuePickerNeedsRevertOnClose.value = false;
  if (!invoicePaidModalOpen.value) invoiceStatusSubjectInv.value = null;
});

async function loadIssueTermsTemplatesForPicker(inv: InvoiceRow) {
  issueTermsLoading.value = true;
  try {
    const res = await getInvoiceTermsTemplates();
    const list = extractInvoiceTermsTemplatesList(res.data);
    issueTermsTemplates.value = list
      .map((x: any) => ({
        id: String(x.id ?? "").trim(),
        name: String(x.name ?? "Template").trim(),
        body: String(x.body ?? ""),
        owner_user_id: x.owner_user_id ?? null,
      }))
      .filter((x: InvoiceTermsTemplateApi) => x.id);
    const preset = resolveInvoiceTermsTemplateIdForIssue(inv.raw);
    const presetOk = Boolean(preset && issueTermsTemplates.value.some((t) => t.id === preset));
    issueSelectedTemplateId.value = presetOk && preset ? preset : issueTermsTemplates.value[0]?.id ?? "";
  } catch {
    issueTermsTemplates.value = [];
    issueSelectedTemplateId.value = "";
  } finally {
    issueTermsLoading.value = false;
  }
}

function openInvoiceIssueTemplatePicker(inv: InvoiceRow) {
  if (!canIssueFromProjectDetails(inv)) {
    pushAlert({
      kind: "info",
      title: "In Review required",
      message:
        "Set this invoice to In Review before issuing from the project. Use Create Invoice from the top menu if you need to issue straight from draft.",
      timeoutMs: 9000,
    });
    return;
  }
  issuePickerRevertStatus.value = inv.statusKey;
  issuePickerNeedsRevertOnClose.value = true;
  invoiceStatusSubjectInv.value = inv;
  invoiceStatusPopoverOpen.value = false;
  milestoneInvoiceStatusPopoverOpen.value = false;
  issueTermsMode.value = "existing";
  issueNewTemplateName.value = "";
  issueNewTemplateBody.value = "";
  invoiceIssueTemplateModalOpen.value = true;
  void loadIssueTermsTemplatesForPicker(inv);
}

function cancelInvoiceIssueTemplatePicker() {
  issuePickerNeedsRevertOnClose.value = false;
  invoiceStatusDraft.value = { ...invoiceStatusDraft.value, status: issuePickerRevertStatus.value };
  invoiceIssueTemplateModalOpen.value = false;
  if (!invoicePaidModalOpen.value) invoiceStatusSubjectInv.value = null;
}

async function confirmInvoiceIssueWithSelectedTemplate() {
  if (invoiceStatusSaving.value) return;
  const inv = invoiceStatusSubjectInv.value ?? resolveInvoiceForStatusAction();
  if (!inv) return;
  if (!canIssueFromProjectDetails(inv)) {
    pushAlert({
      kind: "info",
      title: "In Review required",
      message:
        "This invoice is no longer in review. Refresh the project, set it to In Review, then issue again.",
      timeoutMs: 9000,
    });
    cancelInvoiceIssueTemplatePicker();
    return;
  }
  const invoiceId = inv.id;
  if (!invoiceId || invoiceId === "project-invoice") return;

  let templateId = "";
  if (issueTermsMode.value === "new") {
    const name = issueNewTemplateName.value.trim();
    const body = issueNewTemplateBody.value.trim();
    if (!name || !body) {
      pushAlert({
        kind: "error",
        title: "Template required",
        message: "Enter a name and terms text for the new template.",
        timeoutMs: 6000,
      });
      return;
    }
    invoiceStatusSaving.value = true;
    try {
      const res = await createInvoiceTermsTemplate({ name, body });
      const newId = pickTermsTemplateIdFromCreateResponse(res);
      if (!newId) {
        pushAlert({
          kind: "error",
          title: "Template creation failed",
          message: "The server did not return a template id. Try again or contact support.",
          timeoutMs: 8000,
        });
        return;
      }
      templateId = newId;
    } catch {
      return;
    } finally {
      invoiceStatusSaving.value = false;
    }
  } else {
    templateId = String(issueSelectedTemplateId.value ?? "").trim();
    if (!templateId) {
      pushAlert({
        kind: "error",
        title: "Select a template",
        message: "Choose an existing terms template or create a new one.",
        timeoutMs: 6000,
      });
      return;
    }
  }

  const { name, email } = resolveIssueCustomerFromProject();
  if (!name || !email) {
    pushAlert({
      kind: "error",
      title: "Customer details required",
      message: "Customer name and email are required to issue an invoice.",
      timeoutMs: 6000,
    });
    return;
  }

  invoiceStatusSaving.value = true;
  try {
    await issueInvoice(invoiceId, { invoice_terms_template_id: templateId });
    issuePickerNeedsRevertOnClose.value = false;
    invoiceIssueTemplateModalOpen.value = false;
    invoiceStatusSubjectInv.value = null;
    await loadProjectDetails();
  } catch {
    // global interceptor handles alert
  } finally {
    invoiceStatusSaving.value = false;
  }
}

function resolveIssueCustomerFromProject(): { name: string | null; email: string | null } {
  const c = primaryClient.value as any;
  const nameCandidates: unknown[] = [
    c?.brand_name,
    c?.brandName,
    c?.display_name,
    c?.displayName,
    c?.poc_name,
    c?.pocName,
    c?.name,
    c?.full_name,
    c?.fullName,
  ];
  const emailCandidates: unknown[] = [c?.poc_email, c?.pocEmail, c?.email, c?.contact_email, c?.contactEmail];
  const name =
    nameCandidates
      .map((x) => (x == null ? "" : String(x).trim()))
      .find(Boolean) ?? null;
  const email =
    emailCandidates
      .map((x) => (x == null ? "" : String(x).trim()))
      .find(Boolean) ?? null;
  return { name, email };
}

const invoiceStatusOptions: { key: InvoiceStatusKey; label: string; variant: string }[] = [
  { key: "not_issued", label: "Not Issued", variant: "not_issued" },
  { key: "in_review", label: "In Review", variant: "issued" },
  { key: "issued", label: "Issued", variant: "issued" },
  { key: "rejected", label: "Rejected", variant: "cancelled" },
  { key: "approved", label: "Approved", variant: "issued" },
  { key: "paid", label: "Paid", variant: "paid" },
  { key: "delayed", label: "Delayed", variant: "overdue" },
];

const invoiceStatusPopoverOpen = ref(false);
const milestoneInvoiceStatusPopoverOpen = ref(false);
const invoicePaidModalOpen = ref(false);
const invoiceStatusAnchorRef = ref<HTMLElement | null>(null);
const milestoneInvoiceStatusAnchorRef = ref<HTMLElement | null>(null);
/** Invoice row used for PATCH/issue/paid flows when opened from milestone detail (invoice tab is hidden for milestone projects). */
const invoiceStatusSubjectInv = ref<InvoiceRow | null>(null);
const invoiceEvidenceModalOpen = ref(false);
const invoiceStatusSaving = ref(false);

const MAX_INVOICE_EVIDENCE_FILES = 100;
const MAX_INVOICE_EVIDENCE_FILE_BYTES = 5 * 1024 * 1024;

const invoiceStatusDraft = ref<{
  status: InvoiceStatusKey;
  paidDate: string;
  notes: string;
  files: File[];
}>({
  status: "not_issued",
  paidDate: localTodayIso(),
  notes: "",
  files: [],
});

const invoiceEvidenceDropActive = ref(false);

function addEvidenceFiles(incoming: File[]) {
  const next = [...invoiceStatusDraft.value.files];
  for (const f of incoming) {
    if (f.size > MAX_INVOICE_EVIDENCE_FILE_BYTES) {
      pushAlert({
        kind: "error",
        title: "File too large",
        message: `"${f.name}" exceeds the 5MB limit.`,
        timeoutMs: 6000,
      });
      continue;
    }
    if (next.length >= MAX_INVOICE_EVIDENCE_FILES) {
      pushAlert({
        kind: "error",
        title: "Too many files",
        message: `You can upload up to ${MAX_INVOICE_EVIDENCE_FILES} files.`,
        timeoutMs: 6000,
      });
      break;
    }
    next.push(f);
  }
  invoiceStatusDraft.value.files = next;
}

function onEvidenceDrop(e: DragEvent) {
  invoiceEvidenceDropActive.value = false;
  const dt = e.dataTransfer;
  if (!dt?.files?.length) return;
  addEvidenceFiles(Array.from(dt.files));
}

function openInvoiceStatusPopover() {
  const inv = selectedInvoice.value;
  if (!inv) return;
  if (isInvoiceStatusLocked.value) return;
  invoiceStatusSubjectInv.value = inv;
  invoiceStatusDraft.value = {
    status: inv.statusKey,
    paidDate: localTodayIso(),
    notes: "",
    files: [],
  };
  invoiceStatusPopoverOpen.value = true;
}

function closeInvoiceStatusPopover() {
  invoiceStatusPopoverOpen.value = false;
  invoiceStatusSaving.value = false;
  if (!invoicePaidModalOpen.value) invoiceStatusSubjectInv.value = null;
}

/** Row to PATCH for status changes: milestone popover uses the milestone-linked invoice; invoice tab uses subject or selection. */
function resolveInvoiceForStatusAction(): InvoiceRow | null {
  if (milestoneInvoiceStatusPopoverOpen.value) {
    return milestoneDetailInvoice.value;
  }
  return invoiceStatusSubjectInv.value ?? selectedInvoice.value;
}

/**
 * Project details: invoice must be In Review before Issued (draft → in review → issued).
 * The same applies when Create Invoice is opened from this project; standalone Create Invoice from the menu may issue from draft.
 */
function canIssueFromProjectDetails(inv: InvoiceRow | null): boolean {
  return inv != null && inv.statusKey === "in_review";
}

function isInvoiceStatusOptionDisabled(opt: { key: InvoiceStatusKey }): boolean {
  if (opt.key !== "issued") return false;
  return !canIssueFromProjectDetails(resolveInvoiceForStatusAction());
}

function openMilestoneInvoiceStatusPopover() {
  if (isMilestoneInvoiceStatusLocked.value) return;
  const inv = milestoneDetailInvoice.value;
  invoiceStatusSubjectInv.value = inv;
  invoiceStatusDraft.value = {
    status: inv?.statusKey ?? "not_issued",
    paidDate: localTodayIso(),
    notes: "",
    files: [],
  };
  milestoneInvoiceStatusPopoverOpen.value = true;
}

function closeMilestoneInvoiceStatusPopover() {
  milestoneInvoiceStatusPopoverOpen.value = false;
  invoiceStatusSaving.value = false;
  if (!invoicePaidModalOpen.value) invoiceStatusSubjectInv.value = null;
}

function openPaidEvidenceModal() {
  const inv = invoiceStatusSubjectInv.value ?? selectedInvoice.value;
  if (!inv) return;
  if (inv.statusVariant === "paid") return;
  invoiceStatusDraft.value.status = "paid";
  invoiceStatusDraft.value.paidDate = localTodayIso();
  invoiceStatusDraft.value.notes = "";
  invoiceStatusDraft.value.files = [];
  invoicePaidModalOpen.value = true;
}

async function updateInvoiceStatusQuick(status: InvoiceStatusKey) {
  if (invoiceStatusSaving.value) return;

  const inv = resolveInvoiceForStatusAction();

  if (milestoneInvoiceStatusPopoverOpen.value && (!inv || inv.id === "project-invoice")) {
    if (status === "not_issued") {
      milestoneInvoiceStatusPopoverOpen.value = false;
      if (!invoicePaidModalOpen.value) invoiceStatusSubjectInv.value = null;
      return;
    }
    pushAlert({
      kind: "info",
      title: "No invoice yet",
      message: "Create an invoice linked to this milestone here, then you can change its status.",
      timeoutMs: 6500,
    });
    return;
  }

  if (!inv) return;
  const invoiceId = inv.id;
  if (!invoiceId || invoiceId === "project-invoice") return;

  if (status === "paid") {
    invoiceStatusPopoverOpen.value = false;
    milestoneInvoiceStatusPopoverOpen.value = false;
    invoiceStatusSubjectInv.value = inv;
    openPaidEvidenceModal();
    return;
  }

  if (status === "issued") {
    if (!canIssueFromProjectDetails(inv)) {
      invoiceStatusDraft.value = { ...invoiceStatusDraft.value, status: inv.statusKey };
      pushAlert({
        kind: "info",
        title: "In Review required",
        message:
          "Set this invoice to In Review before issuing from the project. Create Invoice opened from here follows the same rule; use Create Invoice from the top menu if you need to issue straight from draft.",
        timeoutMs: 9000,
      });
      return;
    }
    const { name, email } = resolveIssueCustomerFromProject();
    if (!name || !email) {
      invoiceStatusDraft.value = { ...invoiceStatusDraft.value, status: inv.statusKey };
      pushAlert({
        kind: "error",
        title: "Customer details required",
        message: "Customer name and email are required to issue an invoice.",
        timeoutMs: 6000,
      });
      return;
    }
    openInvoiceIssueTemplatePicker(inv);
    return;
  }

  invoiceStatusSaving.value = true;
  try {
    await updateInvoiceStatus(invoiceId, { status });
    invoiceStatusPopoverOpen.value = false;
    milestoneInvoiceStatusPopoverOpen.value = false;
    invoiceStatusSubjectInv.value = null;
    await loadProjectDetails();
  } catch {
    // global interceptor handles alert
  } finally {
    invoiceStatusSaving.value = false;
  }
}

function openCreateInvoiceFromMilestoneDetail() {
  const m = selectedMilestoneDetailRow.value as any;
  const milestoneId = String(m?.id ?? m?.uuid ?? "").trim() || null;
  emit("create-invoice", { projectId: String(props.projectId), milestoneId });
}

function onEvidenceFilesPicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = input.files;
  if (!files?.length) return;
  addEvidenceFiles(Array.from(files));
  input.value = "";
}

function removeEvidenceFile(idx: number) {
  invoiceStatusDraft.value.files = invoiceStatusDraft.value.files.filter((_, i) => i !== idx);
}

function fileIsImage(f: File): boolean {
  const t = String(f.type ?? "").toLowerCase();
  return t.startsWith("image/");
}

async function uploadEvidenceAndGetIds(files: File[]): Promise<string[]> {
  const trimmed = files.slice(0, MAX_INVOICE_EVIDENCE_FILES);
  if (!trimmed.length) return [];
  const form = new FormData();
  for (const f of trimmed) {
    const fileToSend = fileIsImage(f)
      ? await compressImageFile(f, { maxWidth: 1920, maxHeight: 1920, quality: 0.82, keepPng: true })
      : f;
    form.append("images[]", fileToSend, f.name);
    form.append("labels[]", f.name);
  }
  const res = await uploadImages(form);
  return extractUploadedImageIds(res?.data);
}

async function uploadMilestoneSendFilesForApi(files: File[]): Promise<string[]> {
  const trimmed = files.slice(0, MILESTONE_SEND_MAX_FILES);
  if (!trimmed.length) return [];
  const form = new FormData();
  for (const f of trimmed) {
    const fileToSend = fileIsImage(f)
      ? await compressImageFile(f, { maxWidth: 1920, maxHeight: 1920, quality: 0.82, keepPng: true })
      : f;
    form.append("images[]", fileToSend, f.name);
    form.append("labels[]", f.name);
  }
  const res = await uploadImages(form);
  return extractUploadedImageIds(res?.data);
}

function mergeMilestoneIntoLocalProject(updated: Record<string, unknown>) {
  const p = project.value;
  if (!p || typeof p !== "object") return;
  const id = String(updated.id ?? updated.uuid ?? "").trim();
  if (!id) return;

  const useMilestones = Array.isArray((p as Record<string, unknown>).milestones);
  const useAlt = Array.isArray((p as Record<string, unknown>).project_milestones);
  const key = useMilestones ? "milestones" : useAlt ? "project_milestones" : "milestones";
  const existing = Array.isArray((p as Record<string, unknown>)[key])
    ? [...((p as Record<string, unknown>)[key] as unknown[])]
    : [];

  let found = false;
  const next = existing.map((m) => {
    const o = m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : {};
    const mid = String(o.id ?? o.uuid ?? "").trim();
    if (mid === id) {
      found = true;
      return { ...o, ...updated };
    }
    return m;
  });
  if (!found) next.push(updated);
  project.value = { ...(p as Record<string, unknown>), [key]: next } as Record<string, unknown>;
}

async function postMilestoneSendToClient(
  milestoneId: string,
  sequence: number,
  workLink: string,
  imageIds: string[],
): Promise<void> {
  const res = await sendProjectMilestoneToClient(props.projectId, milestoneId, {
    work_link: workLink,
    image_ids: imageIds,
  });

  const body = res?.data as Record<string, unknown> | undefined;
  const rawMilestone = body?.data;
  if (rawMilestone && typeof rawMilestone === "object" && !Array.isArray(rawMilestone)) {
    mergeMilestoneIntoLocalProject(rawMilestone as Record<string, unknown>);
    const title = String((rawMilestone as Record<string, unknown>).title ?? "").trim();
    milestoneSuccessTitle.value = title || formatMilestoneOrdinalLabel(sequence);
  } else {
    await loadProjectDetails();
    milestoneSuccessTitle.value = formatMilestoneOrdinalLabel(sequence);
  }

  milestoneSuccessModalOpen.value = true;
}

async function confirmSendMilestoneToClient() {
  const t = milestoneSendTarget.value;
  if (!t || milestoneSendSaving.value) return;

  const rawWorkLink = milestoneSendWorkLink.value.trim();
  const workLink = rawWorkLink === "https://" || rawWorkLink === "http://" ? "" : rawWorkLink;
  const files = milestoneSendFiles.value;
  if (!workLink && !files.length) {
    pushAlert({
      kind: "error",
      title: "Add details",
      message: "Enter a work link and/or attach at least one file.",
      timeoutMs: 6000,
    });
    return;
  }

  milestoneSendSaving.value = true;
  try {
    let imageIds: string[] = [];
    if (files.length) {
      imageIds = await uploadMilestoneSendFilesForApi(files);
      if (!imageIds.length) {
        pushAlert({
          kind: "error",
          title: "Upload failed",
          message: "Could not upload attachments. Try again.",
          timeoutMs: 6000,
        });
        return;
      }
    }

    await postMilestoneSendToClient(t.id, t.sequence, workLink, imageIds);

    milestoneSendModalOpen.value = false;
    milestoneSendTarget.value = null;
    resetMilestoneSendForm();
  } catch {
    // global API handler surfaces errors
  } finally {
    milestoneSendSaving.value = false;
  }
}

function invoiceEvidenceItemsFromRaw(
  raw: Record<string, unknown> | null,
): { url: string; name: string; kind: "image" | "file" }[] {
  if (!raw) return [];
  const candidates: unknown[] = [
    (raw as any).payment_proof_images,
    (raw as any).payment_proof_image,
    (raw as any).payment_proof,
    (raw as any).payment_evidence,
    (raw as any).payment_evidence_images,
    (raw as any).payment_proof_attachments,
    (raw as any).attachments,
  ];
  const list = candidates.flatMap((x) => toArray(x)).filter(Boolean);

  function isImageUrl(url: string): boolean {
    const u = String(url ?? "").toLowerCase();
    return /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/.test(u);
  }
  function nameFromUrl(url: string): string {
    try {
      const u = new URL(url);
      const base = u.pathname.split("/").filter(Boolean).pop() ?? url;
      return decodeURIComponent(base);
    } catch {
      const cleaned = url.split("?")[0] ?? url;
      const base = cleaned.split("/").filter(Boolean).pop() ?? cleaned;
      return base || "Attachment";
    }
  }
  function pickName(record: any, fallbackUrl: string): string {
    const keys = ["name", "original_name", "originalName", "filename", "file_name", "title", "label"] as const;
    for (const k of keys) {
      const v = record?.[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return nameFromUrl(fallbackUrl);
  }

  return list
    .map((m) => {
      if (typeof m === "string") {
        const url = resolveStorageUrl(m);
        if (!url) return null;
        return { url, name: nameFromUrl(url), kind: isImageUrl(url) ? ("image" as const) : ("file" as const) };
      }
      if (typeof m === "object" && m) {
        const source = resolveImageRecordSource(m);
        const url = resolveStorageUrl(source);
        if (!url) return null;
        return { url, name: pickName(m, url), kind: isImageUrl(url) ? ("image" as const) : ("file" as const) };
      }
      return null;
    })
    .filter(Boolean) as { url: string; name: string; kind: "image" | "file" }[];
}

const invoiceEvidenceItems = computed(() => invoiceEvidenceItemsFromRaw(selectedInvoice.value?.raw ?? null));
const hasInvoiceEvidence = computed(() => invoiceEvidenceItems.value.length > 0);

function openInvoiceEvidenceModal() {
  if (!selectedInvoice.value) return;
  if (!isInvoiceStatusLocked.value) return;
  if (!hasInvoiceEvidence.value) return;
  invoiceEvidenceModalOpen.value = true;
}

async function saveInvoiceStatusModal() {
  const inv = invoiceStatusSubjectInv.value ?? selectedInvoice.value;
  if (!inv) return;
  const invoiceId = inv.id;
  if (!invoiceId || invoiceId === "project-invoice") return;
  if (invoiceStatusSaving.value) return;

  invoiceStatusSaving.value = true;
  try {
    const draft = invoiceStatusDraft.value;
    const payload: {
      status: string;
      payment_proof_image_ids?: string[];
      paid_date?: string;
      payment_notes?: string;
    } = { status: draft.status };

    if (draft.status === "issued") {
      invoicePaidModalOpen.value = false;
      invoiceStatusSaving.value = false;
      openInvoiceIssueTemplatePicker(inv);
      return;
    }

    if (draft.status === "paid") {
      if (!draft.files.length) {
        pushAlert({
          kind: "error",
          title: "Evidence required",
          message: "Please upload payment evidence before marking this invoice as Paid.",
          timeoutMs: 6000,
        });
        return;
      }

      // 1) POST /api/v1/uploads/images (images[], labels[]) → ids
      // 2) PATCH /api/v1/invoices/:id/status with payment_proof_image_ids[], paid_date, payment_notes
      const ids = await uploadEvidenceAndGetIds(draft.files);
      if (!ids.length) {
        pushAlert({
          kind: "error",
          title: "Upload failed",
          message: "Payment evidence uploaded but no file ids were returned. Try again or contact support.",
          timeoutMs: 8000,
        });
        return;
      }
      payload.payment_proof_image_ids = ids;
      payload.paid_date = String(draft.paidDate ?? "").trim();
      payload.payment_notes = String(draft.notes ?? "").trim();
    }

    await updateInvoiceStatus(invoiceId, payload);
    invoiceStatusPopoverOpen.value = false;
    milestoneInvoiceStatusPopoverOpen.value = false;
    invoicePaidModalOpen.value = false;
    invoiceStatusDraft.value.files = [];
    await loadProjectDetails();
  } catch {
    // global interceptor handles alert
  } finally {
    invoiceStatusSaving.value = false;
  }
}

function onInvoiceStatusDocPointerDown(e: PointerEvent) {
  const target = e.target as Node | null;
  if (!target) return;

  if (invoiceStatusPopoverOpen.value) {
    const anchor = invoiceStatusAnchorRef.value;
    if (!(anchor && anchor.contains(target))) {
      invoiceStatusPopoverOpen.value = false;
      if (!invoicePaidModalOpen.value) invoiceStatusSubjectInv.value = null;
    }
  }

  if (milestoneInvoiceStatusPopoverOpen.value) {
    const anchor = milestoneInvoiceStatusAnchorRef.value;
    if (!(anchor && anchor.contains(target))) {
      milestoneInvoiceStatusPopoverOpen.value = false;
      if (!invoicePaidModalOpen.value) invoiceStatusSubjectInv.value = null;
    }
  }
}

watch(invoicePaidModalOpen, (open) => {
  if (!open) invoiceStatusSubjectInv.value = null;
});

onMounted(() => {
  document.addEventListener("pointerdown", onInvoiceStatusDocPointerDown, { capture: true });
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onInvoiceStatusDocPointerDown, { capture: true } as any);
});

const followUpSwipeStart = ref<{ x: number; y: number } | null>(null);
const followUpPointerStart = ref<{ x: number; y: number; id: number } | null>(null);

function onFollowUpSwipeStart(e: TouchEvent) {
  const t = e.touches?.[0];
  if (!t) return;
  followUpSwipeStart.value = { x: t.clientX, y: t.clientY };
}

function onFollowUpSwipeEnd(e: TouchEvent) {
  const start = followUpSwipeStart.value;
  followUpSwipeStart.value = null;
  const t = e.changedTouches?.[0];
  if (!start || !t) return;
  const dx = t.clientX - start.x;
  const dy = t.clientY - start.y;
  // Swipe-right threshold; keep vertical tolerance to avoid interfering with scroll.
  if (dx > 60 && Math.abs(dy) < 35) {
    openFollowUpModal();
  }
}

function onFollowUpPointerDown(e: PointerEvent) {
  // Only track primary pointer/button; don't interfere with right-click etc.
  if (e.button != null && e.button !== 0) return;
  followUpPointerStart.value = { x: e.clientX, y: e.clientY, id: e.pointerId };
}

function onFollowUpPointerUp(e: PointerEvent) {
  const start = followUpPointerStart.value;
  followUpPointerStart.value = null;
  if (!start || start.id !== e.pointerId) return;
  const dx = e.clientX - start.x;
  const dy = e.clientY - start.y;
  if (dx > 60 && Math.abs(dy) < 35) {
    openFollowUpModal();
  }
}

/** Default copy for the current tone and invoice (used when the customer has not customized the message). */
const followUpDefaultMessage = computed(() => {
  const num = selectedInvoice.value?.number ?? "#—";
  const grand = invoicePreviewGrandTotal.value;
  const amt = Number.isFinite(grand) ? previewMoney(grand) : previewMoney(invoicePreviewLineAmount.value);
  const inv = activeInvoice.value;
  const dueRaw = inv?.dueDate ?? projectData.value.end_date ?? projectData.value.due_date ?? projectData.value.dueDate;
  const due = formatInvoiceDueUs(dueRaw);
  if (followUpDraft.value.tone === "firm") {
    return `This is a formal notice that Invoice ${num} for ${amt} was due on ${due}. Please remit payment as soon as possible.`;
  }
  return `Hi! Just a friendly reminder that Invoice ${num} for ${amt} was due on ${due}. Let me know if you have any questions! 😊`;
});

const followUpMessagePreview = computed(() => {
  const custom = followUpDraft.value.message?.trim();
  if (custom) return custom;
  return followUpDefaultMessage.value;
});

/** Editable message: shows saved/custom text, or the tone-based default; saving matches default clears customization. */
const followUpMessageEdit = computed({
  get() {
    const raw = followUpDraft.value.message;
    if (typeof raw === "string" && raw.trim() !== "") return raw;
    return followUpDefaultMessage.value;
  },
  set(v: string) {
    const def = followUpDefaultMessage.value;
    if (v.trim() === def.trim()) followUpDraft.value.message = undefined;
    else followUpDraft.value.message = v;
  },
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

watch(isMilestoneProject, (milestone) => {
  if (!milestone && activeTab.value === "milestones") activeTab.value = "details";
});

watch(activeTab, (tab) => {
  if (tab !== "milestones") selectedMilestoneDetailId.value = null;
});

watch(
  () => milestoneRows.value,
  (rows) => {
    const id = selectedMilestoneDetailId.value;
    if (id && !rows.some((r) => r.id === id)) selectedMilestoneDetailId.value = null;
  },
);

watch(
  () => props.projectId,
  () => {
    activeTab.value = "details";
    selectedInvoiceId.value = null;
    selectedMilestoneDetailId.value = null;
    invoicePreviewExpanded.value = false;
    followUpModalOpen.value = false;
    void loadProjectDetails();
  },
  { immediate: true },
);
</script>

<template>
  <section class="project-details-screen">
    <div class="project-details-top">
      <div class="project-details-breadcrumb">
        <button type="button" class="project-details-back" aria-label="Back" @click="emit('back')">←</button>
        <button
          v-if="(activeTab === 'invoice' && selectedInvoiceId) || (activeTab === 'milestones' && selectedMilestoneDetailId)"
          type="button"
          class="project-details-bc-link"
          @click="activeTab === 'milestones' ? closeMilestoneDetailScreen() : closeInvoiceDetails()"
        >
          {{ title }}
        </button>
        <span v-else class="project-details-bc-project">{{ title }}</span>
        <span class="project-details-bc-sep">›</span>
        <strong v-if="activeTab === 'details'">Details</strong>
        <template v-else-if="activeTab === 'milestones'">
          <button
            v-if="selectedMilestoneDetailId"
            type="button"
            class="project-details-bc-link"
            @click="closeMilestoneDetailScreen"
          >
            Milestones
          </button>
          <strong v-else>Milestones</strong>
          <template v-if="selectedMilestoneDetailId && selectedMilestoneDetailRow">
            <span class="project-details-bc-sep">›</span>
            <strong class="project-details-bc-current">{{ selectedMilestoneDetailRow.title }}</strong>
          </template>
        </template>
        <template v-else-if="activeTab === 'invoice'">
          <button v-if="selectedInvoiceId" type="button" class="project-details-bc-link" @click="closeInvoiceDetails">
            Invoice
          </button>
          <strong v-else>Invoice</strong>
          <template v-if="selectedInvoiceId">
            <span class="project-details-bc-sep">›</span>
            <strong class="project-details-bc-current">Details</strong>
          </template>
        </template>
      </div>
      <button type="button" class="project-details-settings" aria-label="Project settings" @click="emit('settings')">
        <span class="project-details-settings-icon" aria-hidden="true">⚙</span>
      </button>
    </div>

    <div v-if="isLoading" class="project-details-placeholder">Loading project details...</div>
    <div v-else-if="errorMessage" class="project-details-placeholder">{{ errorMessage }}</div>
    <template v-else>
      <div class="project-details-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="project-details-tab"
          :class="{ 'project-details-tab--active': activeTab === 'details' }"
          :aria-selected="activeTab === 'details'"
          @click="activeTab = 'details'"
        >
          Details
        </button>
        <button
          v-if="isMilestoneProject"
          type="button"
          role="tab"
          class="project-details-tab"
          :class="{ 'project-details-tab--active': activeTab === 'milestones' }"
          :aria-selected="activeTab === 'milestones'"
          @click="activeTab = 'milestones'"
        >
          Milestones
          <span v-if="milestoneCount > 0" class="project-details-tab-badge">{{ milestoneCount }}</span>
        </button>
        <button
          v-else
          type="button"
          role="tab"
          class="project-details-tab"
          :class="{ 'project-details-tab--active': activeTab === 'invoice' }"
          :aria-selected="activeTab === 'invoice'"
          @click="activeTab = 'invoice'"
        >
          Invoice
          <span v-if="invoiceCount > 0" class="project-details-tab-badge">{{ invoiceCount }}</span>
        </button>
      </div>

      <div v-show="activeTab === 'details'" class="project-details-body">
        <article class="project-details-card">
          <button
            type="button"
            class="project-details-card-header project-details-card-header--toggle"
            @click="toggleSection('projectDetails')"
          >
            <span>Project Details</span>
            <span class="project-details-chevron" :class="{ 'project-details-chevron--collapsed': !openSections.projectDetails }" />
          </button>
          <div v-show="openSections.projectDetails" class="project-details-card-body">
            <div class="project-details-grid">
              <div class="project-details-row">
                <span>Name</span><strong>{{ title }}</strong>
              </div>
              <div class="project-details-row">
                <span>Type</span><strong>{{ projectCategoryLabel }}</strong>
              </div>
              <div class="project-details-row">
                <span>Client</span><strong>{{ clientCompanyName }}</strong>
              </div>
              <div class="project-details-row">
                <span>Starting</span><strong>{{ startDateShort }}</strong>
              </div>
              <div class="project-details-row">
                <span>End</span><strong>{{ endDateShort }}</strong>
              </div>
              <div class="project-details-row project-details-row--scope">
                <span>Project Scope</span>
                <strong class="project-details-scope-value">{{ scope }}</strong>
              </div>
            </div>
          </div>
        </article>

        <article v-if="isMilestoneProject" class="project-details-card project-details-card--status-compact">
          <div class="project-details-status-compact">
            <span class="project-details-status-compact-title">Project Status</span>
            <button type="button" class="project-details-status-discussion">
              <MessageCircle class="project-details-status-discussion-icon" stroke-width="2" aria-hidden="true" />
              {{ projectStatusDisplayLabel }}
            </button>
          </div>
        </article>
        <article v-else class="project-details-card">
          <button
            type="button"
            class="project-details-card-header project-details-card-header--toggle"
            @click="toggleSection('projectStatus')"
          >
            <span>Project Status</span>
            <span class="project-details-chevron" :class="{ 'project-details-chevron--collapsed': !openSections.projectStatus }" />
          </button>
          <div v-show="openSections.projectStatus" class="project-details-card-body project-details-card-body--status">
            <div class="project-details-grid">
              <div class="project-details-row">
                <span>Status</span><strong>{{ statusLabel }}</strong>
              </div>
              <div class="project-details-row">
                <span>Created</span><strong>{{ createdAt }}</strong>
              </div>
            </div>
          </div>
        </article>

        <article class="project-details-card">
          <button
            type="button"
            class="project-details-card-header project-details-card-header--toggle"
            @click="toggleSection('clientDetails')"
          >
            <span>Client Details</span>
            <span class="project-details-chevron" :class="{ 'project-details-chevron--collapsed': !openSections.clientDetails }" />
          </button>
          <div v-show="openSections.clientDetails" class="project-details-card-body">
            <div class="project-details-grid">
              <div class="project-details-row">
                <span>Name</span><strong>{{ clientContactName }}</strong>
              </div>
              <div class="project-details-row">
                <span>Company</span><strong>{{ clientCompanyName }}</strong>
              </div>
              <div class="project-details-row">
                <span>Role</span><strong>{{ clientRole }}</strong>
              </div>
              <div class="project-details-row">
                <span>Email</span><strong>{{ clientEmail }}</strong>
              </div>
              <div class="project-details-row">
                <span>Phone</span><strong>{{ clientPhone }}</strong>
              </div>
            </div>
          </div>
        </article>

        <article class="project-details-card">
          <button
            type="button"
            class="project-details-card-header project-details-card-header--toggle"
            @click="toggleSection('paymentDetails')"
          >
            <span>Payment Details</span>
            <span class="project-details-chevron" :class="{ 'project-details-chevron--collapsed': !openSections.paymentDetails }" />
          </button>
          <div v-show="openSections.paymentDetails" class="project-details-card-body">
            <div class="project-details-grid">
              <div class="project-details-row">
                <span>Project Amount</span><strong>{{ amount }}</strong>
              </div>
              <div class="project-details-row">
                <span>Tax</span><strong>{{ taxInclusiveLine }}</strong>
              </div>
              <div class="project-details-row">
                <span>Tax Amount</span><strong>{{ taxAmountWithPercent }}</strong>
              </div>
              <div class="project-details-row">
                <span>Payment method</span><strong>{{ paymentMethod }}</strong>
              </div>
              <div class="project-details-row">
                <span>Payment Structure</span><strong>{{ paymentStructure }}</strong>
              </div>
              <div class="project-details-row">
                <span>Paid</span><strong>{{ paidWhenLabel }}</strong>
              </div>
            </div>
          </div>
        </article>

        <article v-if="String(projectData.type ?? '') === 'recurring'" class="project-details-card">
          <button
            type="button"
            class="project-details-card-header project-details-card-header--toggle"
            @click="toggleSection('recurring')"
          >
            <span>Recurring Details</span>
            <span class="project-details-chevron" :class="{ 'project-details-chevron--collapsed': !openSections.recurring }" />
          </button>
          <div v-show="openSections.recurring" class="project-details-card-body">
            <div class="project-details-grid">
              <div class="project-details-row">
                <span>Duration</span><strong>{{ recurringDurationLabel }}</strong>
              </div>
              <div class="project-details-row">
                <span>Early payout agreed</span><strong>{{ earlyPayoutAgreedLabel }}</strong>
              </div>
            </div>
          </div>
        </article>

        <article v-if="tags.length" class="project-details-card">
          <button
            type="button"
            class="project-details-card-header project-details-card-header--toggle"
            @click="toggleSection('tags')"
          >
            <span>Tags</span>
            <span class="project-details-chevron" :class="{ 'project-details-chevron--collapsed': !openSections.tags }" />
          </button>
          <div v-show="openSections.tags" class="project-details-card-body">
            <div class="project-details-grid">
              <div class="project-details-row project-details-row--stack">
                <span>Tags</span>
                <strong>{{ tags.join(", ") }}</strong>
              </div>
            </div>
          </div>
        </article>

        <article v-if="mediaItems.length" class="project-details-card">
          <button
            type="button"
            class="project-details-card-header project-details-card-header--toggle"
            @click="toggleSection('media')"
          >
            <span>Attachments</span>
            <span class="project-details-chevron" :class="{ 'project-details-chevron--collapsed': !openSections.media }" />
          </button>
          <div v-show="openSections.media" class="project-details-card-body">
            <div class="project-details-grid">
              <div class="project-details-row project-details-row--stack">
                <span>Files</span>
                <div class="project-details-media">
                  <a
                    v-for="m in mediaItems"
                    :key="m.url"
                    class="project-details-media-thumb"
                    :href="m.url"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      v-if="m.kind === 'image'"
                      class="project-details-media-img"
                      :src="mediaImageSrc(m)"
                      :alt="m.name"
                      loading="lazy"
                    />
                    <div v-else class="project-details-media-file" :title="m.name">
                      <span class="project-details-media-file-icon" aria-hidden="true">📄</span>
                      <span class="project-details-media-file-name">{{ m.name }}</span>
                    </div>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </article>

        <article class="project-details-card project-details-card--financing">
          <div class="project-details-financing-row">
            <span class="project-details-financing-title">Financing</span>
            <strong class="project-details-financing-value">{{ financingLabel }}</strong>
          </div>
        </article>
      </div>

      <div
        v-show="activeTab === 'milestones'"
        class="project-details-body project-details-body--milestones"
        :class="{ 'project-details-body--milestone-detail': !!selectedMilestoneDetailRow }"
      >
        <div v-if="selectedMilestoneDetailRow" class="milestone-timeline-page">
          <div class="milestone-timeline">
            <section class="milestone-timeline-step">
              <div class="milestone-timeline-card">
                <div class="milestone-timeline-card-head">
                  <div class="milestone-timeline-card-title-row">
                    <span class="milestone-timeline-icon milestone-timeline-icon--success">
                      <Check class="milestone-timeline-icon-svg" stroke-width="2.5" aria-hidden="true" />
                    </span>
                    <span class="milestone-timeline-card-name">Milestone</span>
                    <span class="milestone-timeline-pill milestone-timeline-pill--sent">Sent</span>
                  </div>
                  <p v-if="selectedMilestoneDetailRow.lastSentAtLine" class="milestone-timeline-meta-line">
                    <Send class="milestone-timeline-meta-ico" stroke-width="2" aria-hidden="true" />
                    {{ selectedMilestoneDetailRow.lastSentAtLine }}
                  </p>
                  <p class="milestone-timeline-body-text">
                    The milestone has been successfully sent to the client.
                  </p>
                  <div
                    v-if="selectedMilestoneDetailRow.images.length || selectedMilestoneDetailRow.workLink"
                    class="milestone-timeline-chips"
                  >
                    <span v-if="selectedMilestoneDetailRow.images.length" class="milestone-timeline-chip">
                      <Paperclip class="milestone-timeline-chip-ico" stroke-width="2" aria-hidden="true" />
                      {{ selectedMilestoneDetailRow.images.length }}
                    </span>
                    <span v-if="selectedMilestoneDetailRow.workLink" class="milestone-timeline-chip">
                      <Link2 class="milestone-timeline-chip-ico" stroke-width="2" aria-hidden="true" />
                      1
                    </span>
                  </div>
                  <div class="milestone-timeline-card-actions milestone-timeline-card-actions--end">
                    <button
                      type="button"
                      class="milestone-timeline-btn milestone-timeline-btn--outline"
                      :disabled="milestoneSendSaving"
                      @click="resendMilestoneFromDetail"
                    >
                      {{ milestoneSendSaving ? "Sending…" : "Resend" }}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section class="milestone-timeline-step">
              <div class="milestone-timeline-card">
                <div class="milestone-timeline-card-head">
                  <div class="milestone-timeline-card-title-row">
                    <span class="milestone-timeline-icon milestone-timeline-icon--muted">
                      <Clock class="milestone-timeline-icon-svg" stroke-width="2" aria-hidden="true" />
                    </span>
                    <span class="milestone-timeline-card-name">Client</span>
                    <span
                      class="milestone-timeline-pill"
                      :class="{
                        'milestone-timeline-pill--review': milestoneDetailClientStep.variant === 'review',
                        'milestone-timeline-pill--approved': milestoneDetailClientStep.variant === 'approved',
                        'milestone-timeline-pill--rejected': milestoneDetailClientStep.variant === 'rejected',
                      }"
                    >
                      {{ milestoneDetailClientStep.text }}
                    </span>
                  </div>
                  <p class="milestone-timeline-body-text">
                    The milestone deliverable has been submitted to the client for their review.
                  </p>
                  <div class="milestone-timeline-card-actions">
                    <DropdownMenu>
                      <DropdownMenuTrigger as-child>
                        <button type="button" class="milestone-timeline-btn milestone-timeline-btn--outline">
                          Change status
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" class="milestone-status-menu">
                        <div class="milestone-status-menu-title">Client Status</div>
                        <DropdownMenuItem
                          v-for="opt in milestoneClientStatusOptions"
                          :key="opt.key"
                          class="milestone-status-menu-item invoice-status-popover-item"
                          :class="{ 'invoice-status-popover-item--active': milestoneClientStatusSelectedKey === opt.key }"
                          @select="setMilestoneClientStatus(opt.key)"
                        >
                          <span class="invoice-status-popover-left">
                            <span class="invoice-status-dot" :data-variant="opt.variant" aria-hidden="true" />
                            <span class="invoice-status-popover-text">{{ opt.label }}</span>
                          </span>
                          <span class="invoice-status-popover-radio" :data-on="milestoneClientStatusSelectedKey === opt.key" />
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            </section>

            <section class="milestone-timeline-step">
              <div class="milestone-timeline-card">
                <div class="milestone-timeline-card-head">
                  <div class="milestone-timeline-card-title-row">
                    <span class="milestone-timeline-icon milestone-timeline-icon--muted">
                      <FileText class="milestone-timeline-icon-svg" stroke-width="2" aria-hidden="true" />
                    </span>
                    <span class="milestone-timeline-card-name">Invoice generated</span>
                    <template v-if="milestoneDetailClientStep.variant !== 'approved'">
                      <span class="milestone-timeline-pill milestone-timeline-pill--pending">Pending</span>
                    </template>
                    <div
                      v-else
                      ref="milestoneInvoiceStatusAnchorRef"
                      class="project-details-invoice-status-actions milestone-timeline-invoice-status"
                    >
                      <button
                        type="button"
                        class="project-details-invoice-status"
                        :class="{ 'project-details-invoice-status--clickable': !isMilestoneInvoiceStatusLocked }"
                        :data-variant="milestoneInvoiceStatusUiDataVariant"
                        :disabled="isMilestoneInvoiceStatusLocked"
                        @click="openMilestoneInvoiceStatusPopover"
                      >
                        <span class="project-details-invoice-status-dot" aria-hidden="true"></span>
                        {{ milestoneInvoiceStatusUiLabel }}
                      </button>
                      <div
                        v-if="milestoneInvoiceStatusPopoverOpen"
                        class="invoice-status-popover"
                        role="dialog"
                        aria-label="Invoice status"
                      >
                        <div class="invoice-status-popover-title">Invoice Status</div>
                        <button
                          v-for="opt in invoiceStatusOptions"
                          :key="opt.key"
                          type="button"
                          class="invoice-status-popover-item"
                          :class="{ 'invoice-status-popover-item--active': invoiceStatusDraft.status === opt.key }"
                          :disabled="isInvoiceStatusOptionDisabled(opt)"
                          :title="
                            isInvoiceStatusOptionDisabled(opt)
                              ? 'Set the invoice to In Review before issuing from the project.'
                              : undefined
                          "
                          @click="invoiceStatusDraft.status = opt.key; updateInvoiceStatusQuick(opt.key)"
                        >
                          <span class="invoice-status-popover-left">
                            <span class="invoice-status-dot" :data-variant="opt.variant" aria-hidden="true" />
                            <span class="invoice-status-popover-text">{{ opt.label }}</span>
                          </span>
                          <span class="invoice-status-popover-radio" :data-on="invoiceStatusDraft.status === opt.key" />
                        </button>
                      </div>
                    </div>
                  </div>
                  <p class="milestone-timeline-body-text">
                    <template v-if="milestoneDetailClientStep.variant !== 'approved'">
                      The invoice will be generated once the milestone is approved.
                    </template>
                    <template v-else-if="!milestoneDetailHasInvoice">
                      Generate an invoice for this milestone from Create → Invoice. Status will show here as Not Issued until an invoice is linked.
                    </template>
                    <template v-else>
                      Use the status control: Not Issued → In Review → Issued, then Paid when settled (same as single-payment projects).
                    </template>
                  </p>
                  <div v-if="milestoneDetailClientStep.variant === 'approved'" class="milestone-timeline-card-actions milestone-timeline-card-actions--end">
                    <button
                      v-if="milestoneDetailHasInvoice && milestoneDetailInvoice?.statusKey === 'approved'"
                      type="button"
                      class="milestone-timeline-btn milestone-timeline-btn--outline"
                      :disabled="isOpeningMilestoneInvoicePdf"
                      @click="viewInvoiceFromMilestoneDetail"
                    >
                      {{ isOpeningMilestoneInvoicePdf ? "Opening…" : "View invoice" }}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section class="milestone-timeline-step milestone-timeline-step--last">
              <div class="milestone-timeline-card">
                <div class="milestone-timeline-card-head">
                  <div class="milestone-timeline-card-title-row">
                    <span class="milestone-timeline-icon milestone-timeline-icon--payment">
                      <Banknote class="milestone-timeline-icon-svg" stroke-width="2" aria-hidden="true" />
                    </span>
                    <span class="milestone-timeline-card-name">Payment</span>
                    <span
                      class="milestone-timeline-pill"
                      :class="{
                        'milestone-timeline-pill--paid': milestoneDetailPaymentStep.variant === 'paid',
                        'milestone-timeline-pill--pending': milestoneDetailPaymentStep.variant === 'pending',
                      }"
                    >
                      {{ milestoneDetailPaymentStep.text }}
                    </span>
                  </div>
                  <p class="milestone-timeline-body-text">
                    {{
                      milestoneDetailPaymentStep.variant === "paid"
                        ? "This milestone’s invoice is marked paid."
                        : "Waiting for client payment"
                    }}
                  </p>
                </div>
              </div>
            </section>
          </div>
        </div>

        <template v-else>
          <p v-if="!milestoneRows.length" class="project-details-placeholder project-details-placeholder--inline">
            No milestones for this project yet.
          </p>
          <article
            v-for="(row, idx) in milestoneRows"
            :key="row.id"
            class="project-details-milestone-card"
            :class="{ 'project-details-milestone-card--sent': !row.showSend }"
            :tabindex="row.showSend ? undefined : 0"
            :aria-label="row.showSend ? undefined : `View details for ${row.title}`"
            @click="onMilestoneCardPointer(row, $event)"
            @keydown="onMilestoneCardKeydown(row, $event)"
          >
          <div class="project-details-milestone-head">
            <div class="project-details-milestone-head-left">
              <span
                class="project-details-milestone-badge"
                :class="{ 'project-details-milestone-badge--primary': idx === 0 }"
              >
                {{ row.sequence }}
              </span>
              <span class="project-details-milestone-label">Milestone</span>
            </div>
            <div class="project-details-milestone-head-right">
              <span
                v-if="!row.showSend"
                class="project-details-milestone-status"
                :data-variant="row.statusBadgeVariant"
              >
                <Check
                  v-if="row.statusBadgeVariant === 'completed'"
                  class="project-details-milestone-status-icon"
                  stroke-width="2.5"
                  aria-hidden="true"
                />
                {{ row.statusBadgeText }}
              </span>
              <ChevronRight
                v-if="!row.showSend"
                class="project-details-milestone-chevron"
                stroke-width="2.25"
                aria-hidden="true"
              />
              <button
                v-else
                type="button"
                class="project-details-milestone-send"
                @click.stop="openMilestoneSendModal(row)"
              >
                Send
              </button>
            </div>
          </div>
          <p class="project-details-milestone-title" v-if="!row.showSend && row.title">{{ row.title }}</p>
          <p class="project-details-milestone-desc">{{ row.description }}</p>
          <template v-if="!row.showSend">
            <div v-if="row.percentageLabel && row.percentageLabel !== '—'" class="project-details-milestone-meta">
              <span class="project-details-milestone-meta-label">Allocation</span>
              <strong class="project-details-milestone-meta-value">{{ row.percentageLabel }}</strong>
            </div>
            <div v-if="row.workLink" class="project-details-milestone-work-link">
              <Link2 class="project-details-milestone-link-ico" stroke-width="2" aria-hidden="true" />
              <a
                class="project-details-milestone-link-a"
                :href="row.workLink"
                target="_blank"
                rel="noreferrer"
                @click.stop
              >
                {{ row.workLink }}
              </a>
            </div>
            <p v-if="row.lastSentLabel" class="project-details-milestone-sent">Sent {{ row.lastSentLabel }}</p>
            <div v-if="row.images.length" class="project-details-milestone-media">
              <a
                v-for="(m, mi) in row.images"
                :key="m.url + ':' + mi"
                class="project-details-media-thumb"
                :href="m.url"
                target="_blank"
                rel="noreferrer"
                @click.stop
              >
                <img
                  v-if="m.kind === 'image'"
                  class="project-details-media-img"
                  :src="mediaImageSrc(m)"
                  :alt="m.name"
                  loading="lazy"
                />
                <div v-else class="project-details-media-file" :title="m.name">
                  <span class="project-details-media-file-icon" aria-hidden="true">📄</span>
                  <span class="project-details-media-file-name">{{ m.name }}</span>
                </div>
              </a>
            </div>
          </template>
          <div class="project-details-milestone-divider" />
          <div class="project-details-milestone-foot">
            <span class="project-details-milestone-date">
              <Calendar class="project-details-milestone-cal" stroke-width="2" aria-hidden="true" />
              {{ row.dueLabel }}
            </span>
            <strong class="project-details-milestone-amt">{{ row.amountLabel }}</strong>
          </div>
        </article>
        </template>
      </div>

      <div
        v-show="activeTab === 'invoice' && !isMilestoneProject"
        class="project-details-body project-details-body--invoice-tab"
        :class="{ 'project-details-body--invoice-detail': !!selectedInvoiceId }"
      >
        <div v-if="selectedInvoiceId" class="project-details-invoice-detail-header">
          <h1 class="project-details-invoice-page-heading">Invoice Details</h1>
          <button
            v-if="selectedInvoice && canDownloadInvoicePdf(selectedInvoice)"
            type="button"
            class="project-details-invoice-download-pdf"
            :disabled="isDownloadingInvoicePdf"
            @click="selectedInvoice && downloadInvoicePdf(selectedInvoice)"
          >
            <Download class="project-details-invoice-download-pdf-icon" stroke-width="2" aria-hidden="true" />
            {{ isDownloadingInvoicePdf ? "Downloading…" : "Download PDF" }}
          </button>
        </div>
        <div v-if="!selectedInvoiceId" class="project-details-invoice-grid">
          <article
            v-for="inv in invoiceCards"
            :key="inv.id"
            class="project-details-invoice-card"
            role="button"
            tabindex="0"
            @click="openInvoiceDetails(inv.id)"
            @keydown.enter="openInvoiceDetails(inv.id)"
            @keydown.space.prevent="openInvoiceDetails(inv.id)"
          >
            <div class="project-details-invoice-card-head">
              <div class="project-details-invoice-amount">
                {{ inv.amountTotal != null ? inv.amountTotal.toLocaleString("en-PK") : projectAmountFormatted }}
                <span>{{ inv.currency ?? projectCurrency }}</span>
              </div>
              <span class="project-details-invoice-status" :data-variant="inv.statusVariant">
                <span class="project-details-invoice-status-dot" aria-hidden="true"></span>
                {{ inv.statusLabel }}
              </span>
            </div>
            <div class="project-details-invoice-rows">
              <div class="project-details-invoice-row">
                <span>Issued</span>
                <strong>{{ formatInvoiceDate(inv.issuedAt ?? projectData.start_date ?? projectData.started_at ?? projectData.created_at) }}</strong>
              </div>
              <div class="project-details-invoice-row">
                <span>Due</span>
                <strong>{{ formatInvoiceDate(inv.dueDate ?? projectData.end_date ?? projectData.due_date ?? projectData.dueDate) }}</strong>
              </div>
              <div class="project-details-invoice-row">
                <span>Tax Amount</span>
                <strong>
                  {{
                    inv.amountTax != null
                      ? `${inv.currency ?? projectCurrency} ${inv.amountTax.toLocaleString("en-PK")} ${
                          inv.gstRate != null ? `(${inv.gstRate}%)` : gstRateLabel !== "—" ? `(${gstRateLabel})` : ""
                        }`.trim()
                      : taxAmountWithPercent
                  }}
                </strong>
              </div>
              <div class="project-details-invoice-row">
                <span>Invoice</span>
                <strong>{{ inv.number }}</strong>
              </div>
            </div>
          </article>
        </div>

        <div v-else class="project-details-invoice-details">
          <div class="project-details-invoice-details-left">
            <article class="project-details-card">
              <div class="project-details-card-body project-details-card-body--invoice-plain">
                <div class="project-details-grid project-details-grid--invoice-details">
                  <div class="project-details-row project-details-row--invoice-amount">
                    <span>Amount</span>
                    <strong>{{ invoiceTotalFormatted }} {{ invoiceCurrency }}</strong>
                  </div>
                  <div class="project-details-row">
                    <span>Project Name</span>
                    <strong>{{ title }}</strong>
                  </div>
                  <div class="project-details-row">
                    <span>Issued</span>
                    <strong>{{ invoiceIssuedOn }}</strong>
                  </div>
                  <div class="project-details-row">
                    <span>Due</span>
                    <strong>{{ invoiceDueOn }}</strong>
                  </div>
                  <div class="project-details-row">
                    <span>Tax</span>
                    <strong>{{ taxInclusiveShortLabel }}</strong>
                  </div>
                  <div class="project-details-row">
                    <span>Tax Amount</span>
                    <strong>{{ taxAmountWithPercent }}</strong>
                  </div>
                  <div class="project-details-row">
                    <span>Invoice</span>
                    <strong>{{ selectedInvoice?.number ?? "#—" }}</strong>
                  </div>
                </div>
              </div>
            </article>

            <article class="project-details-card">
              <button
                type="button"
                class="project-details-card-header project-details-card-header--toggle project-details-invoice-accordion-head"
                @click="toggleInvoiceDetailsSection('notes')"
              >
                <span>Notes</span>
                <span
                  class="project-details-chevron"
                  :class="{ 'project-details-chevron--collapsed': !invoiceDetailsOpenSections.notes }"
                />
              </button>
              <div
                v-show="invoiceDetailsOpenSections.notes"
                class="project-details-card-body project-details-invoice-details-text"
              >
                {{ invoicePreviewNotes }}
              </div>
            </article>

            <article class="project-details-card">
              <button
                type="button"
                class="project-details-card-header project-details-card-header--toggle project-details-invoice-accordion-head"
                @click="toggleInvoiceDetailsSection('terms')"
              >
                <span>Terms</span>
                <span
                  class="project-details-chevron"
                  :class="{ 'project-details-chevron--collapsed': !invoiceDetailsOpenSections.terms }"
                />
              </button>
              <div
                v-show="invoiceDetailsOpenSections.terms"
                class="project-details-card-body project-details-invoice-details-text"
              >
                {{ invoicePreviewTerms }}
              </div>
            </article>

            <article class="project-details-card">
              <div
                class="project-details-invoice-followup"
                @touchstart.passive="onFollowUpSwipeStart"
                @touchend="onFollowUpSwipeEnd"
                @pointerdown="onFollowUpPointerDown"
                @pointerup="onFollowUpPointerUp"
              >
                <span>Follow up</span>
                <button
                  type="button"
                  class="project-details-switch"
                  :aria-pressed="followUpToggleOn"
                  :data-on="followUpToggleOn"
                  aria-label="Follow up automation"
                  @click="onFollowUpToggleClick"
                >
                  <span class="project-details-switch-thumb" />
                </button>
              </div>
            </article>

            <article class="project-details-card project-details-card--invoice-status-dropdown">
              <div class="project-details-invoice-status-row">
                <span class="project-details-invoice-status-title">Invoice status</span>
                <div ref="invoiceStatusAnchorRef" class="project-details-invoice-status-actions">
                  <button
                    type="button"
                    class="project-details-invoice-status"
                    :class="{ 'project-details-invoice-status--clickable': !isInvoiceStatusLocked }"
                    :data-variant="selectedInvoice?.statusVariant ?? 'not_issued'"
                    :disabled="isInvoiceStatusLocked || !selectedInvoice || selectedInvoice.id === 'project-invoice'"
                    @click="openInvoiceStatusPopover"
                  >
                    <span class="project-details-invoice-status-dot" aria-hidden="true"></span>
                    {{ selectedInvoice?.statusLabel ?? "Not Issued" }}
                  </button>

                  <button
                    v-if="isInvoiceStatusLocked && hasInvoiceEvidence"
                    type="button"
                    class="project-details-invoice-evidence-btn"
                    @click="openInvoiceEvidenceModal"
                  >
                    View attachment
                  </button>

                  <div v-if="invoiceStatusPopoverOpen" class="invoice-status-popover" role="dialog" aria-label="Invoice status">
                    <div class="invoice-status-popover-title">Invoice Status</div>
                    <button
                      v-for="opt in invoiceStatusOptions"
                      :key="opt.key"
                      type="button"
                      class="invoice-status-popover-item"
                      :class="{ 'invoice-status-popover-item--active': invoiceStatusDraft.status === opt.key }"
                      :disabled="isInvoiceStatusOptionDisabled(opt)"
                      :title="
                        isInvoiceStatusOptionDisabled(opt)
                          ? 'Set the invoice to In Review before issuing from the project.'
                          : undefined
                      "
                      @click="invoiceStatusDraft.status = opt.key; updateInvoiceStatusQuick(opt.key)"
                    >
                      <span class="invoice-status-popover-left">
                        <span class="invoice-status-dot" :data-variant="opt.variant" aria-hidden="true" />
                        <span class="invoice-status-popover-text">{{ opt.label }}</span>
                      </span>
                      <span class="invoice-status-popover-radio" :data-on="invoiceStatusDraft.status === opt.key" />
                    </button>
                  </div>
                </div>
              </div>
            </article>

          </div>

          <div class="project-details-invoice-details-right">
            <div
              ref="invoicePreviewCaptureRef"
              class="project-details-invoice-preview"
              :class="{ 'project-details-invoice-preview--expanded': invoicePreviewExpanded }"
            >
              <button
                type="button"
                class="project-details-invoice-preview-expand"
                :aria-pressed="invoicePreviewExpanded"
                :aria-label="invoicePreviewExpanded ? 'Close expanded preview' : 'Expand invoice preview'"
                @click="invoicePreviewExpanded = !invoicePreviewExpanded"
              >
                <span class="project-details-invoice-preview-expand-icon" aria-hidden="true">⛶</span>
              </button>
              <div class="project-details-invoice-preview-top">
                <div class="project-details-invoice-preview-brand">
                  <img
                    class="project-details-invoice-preview-logo"
                    src="@/assets/invoice-logo.png"
                    alt=""
                    width="40"
                    height="40"
                  />
                  <div class="project-details-invoice-preview-heading">
                    <div class="project-details-invoice-preview-title">Invoice</div>
                    <div class="project-details-invoice-preview-id">{{ selectedInvoice?.number ?? "#—" }}</div>
                  </div>
                </div>
                <div class="project-details-invoice-preview-meta">
                  <div>Issued: {{ invoiceIssuedOnLong }}</div>
                  <div>Due: {{ invoiceDueOnLong }}</div>
                </div>
              </div>
              <div class="project-details-invoice-preview-body">
                <div class="project-details-invoice-preview-line"></div>
                <div class="project-details-invoice-preview-grid">
                  <div>
                    <div class="project-details-invoice-preview-label">From</div>
                    <div class="project-details-invoice-preview-text project-details-invoice-preview-text--address">
                      {{ invoiceIssuerBlock }}
                    </div>
                  </div>
                  <div>
                    <div class="project-details-invoice-preview-label">To</div>
                    <div class="project-details-invoice-preview-text project-details-invoice-preview-text--address">
                      {{ invoiceClientBlock }}
                    </div>
                  </div>
                </div>
                <div class="project-details-invoice-preview-subject">{{ invoicePreviewSubject }}</div>
                <div class="project-details-invoice-preview-table">
                  <div class="project-details-invoice-preview-th">
                    <span>Source</span>
                    <span>Date</span>
                    <span class="project-details-invoice-preview-amount">Amount</span>
                  </div>
                  <div v-for="row in invoicePreviewLineItems" :key="row.id" class="project-details-invoice-preview-tr">
                    <div class="project-details-invoice-preview-source">
                      <div class="project-details-invoice-preview-source-title">{{ row.sourceTitle }}</div>
                      <div v-if="row.sourceDescription" class="project-details-invoice-preview-source-desc">
                        {{ row.sourceDescription }}
                      </div>
                    </div>
                    <span class="project-details-invoice-preview-date">{{ row.dateLabel }}</span>
                    <span class="project-details-invoice-preview-amount">{{ row.amountLabel }}</span>
                  </div>
                </div>
                <div class="project-details-invoice-preview-totals">
                  <div
                    v-if="Number.isFinite(invoicePreviewSubtotal)"
                    class="project-details-invoice-preview-total-row"
                  >
                    <span>Subtotal</span>
                    <span>{{ previewMoney(invoicePreviewSubtotal) }}</span>
                  </div>
                  <div
                    v-if="Number.isFinite(invoicePreviewTaxAmount)"
                    class="project-details-invoice-preview-total-row"
                  >
                    <span>{{ invoicePreviewTaxLabel }}</span>
                    <span>{{ previewMoney(invoicePreviewTaxAmount) }}</span>
                  </div>
                  <div v-if="Number.isFinite(invoicePreviewGrandTotal)" class="project-details-invoice-preview-total">
                    <span>Total</span>
                    <strong>{{ previewMoney(invoicePreviewGrandTotal) }}</strong>
                  </div>
                </div>
                <div class="project-details-invoice-preview-footer">
                  <div class="project-details-invoice-preview-footer-block">
                    <div class="project-details-invoice-preview-footer-label">Payment terms</div>
                    <div class="project-details-invoice-preview-footer-text">{{ invoicePreviewTerms }}</div>
                  </div>
                  <div class="project-details-invoice-preview-footer-block">
                    <div class="project-details-invoice-preview-footer-label">Notes</div>
                    <div class="project-details-invoice-preview-footer-text">{{ invoicePreviewNotes }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <Dialog v-model:open="invoicePaidModalOpen">
      <DialogContent
        class="invoice-status-dialog"
        :show-close-button="false"
        @pointer-down-outside="onInvoicePaidDialogOutsideDismiss"
        @interact-outside="onInvoicePaidDialogOutsideDismiss"
      >
        <div class="invoice-status-dialog-inner">
          <div class="invoice-status-dialog-head">
            <div class="invoice-status-dialog-title-block">
              <h2 class="invoice-status-dialog-title">Invoice status</h2>
            </div>
          </div>

          <div class="invoice-status-dialog-body">
            <label class="invoice-status-field-label">Add Payment Evidence</label>
            <div class="invoice-status-drop" :class="{ 'invoice-status-drop--drag': invoiceEvidenceDropActive }">
              <input
                class="invoice-status-file-input"
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx"
                @change="onEvidenceFilesPicked"
                @dragenter.prevent="invoiceEvidenceDropActive = true"
                @dragleave.prevent="invoiceEvidenceDropActive = false"
                @dragover.prevent="invoiceEvidenceDropActive = true"
                @drop.prevent="onEvidenceDrop"
              />
              <div class="invoice-status-drop-visual">
                <CloudUpload class="invoice-status-drop-icon" aria-hidden="true" stroke-width="1.75" />
                <div class="invoice-status-drop-line">Click to select files or drag to upload</div>
                <div class="invoice-status-drop-sub">
                  Up to {{ MAX_INVOICE_EVIDENCE_FILES }} files, max file size 5MB
                </div>
              </div>
            </div>

            <div v-if="invoiceStatusDraft.files.length" class="invoice-status-file-list">
              <div
                v-for="(f, idx) in invoiceStatusDraft.files"
                :key="f.name + ':' + f.size + ':' + f.lastModified"
                class="invoice-status-file-row"
              >
                <span class="invoice-status-file-left">
                  <FileText class="invoice-status-file-doc" aria-hidden="true" stroke-width="2" />
                  <span class="invoice-status-file-name" :title="f.name">{{ f.name }}</span>
                </span>
                <button
                  type="button"
                  class="invoice-status-file-remove"
                  :aria-label="'Remove ' + f.name"
                  @click="removeEvidenceFile(idx)"
                >
                  <Trash2 class="invoice-status-file-trash" aria-hidden="true" stroke-width="2" />
                </button>
              </div>
            </div>

            <label class="invoice-status-field-label" for="invoice-paid-notes">Add Notes</label>
            <textarea
              id="invoice-paid-notes"
              v-model="invoiceStatusDraft.notes"
              class="invoice-status-notes"
              rows="3"
              placeholder="Message here"
            />

            <label class="invoice-status-field-label">Paid Date</label>
            <div class="invoice-status-paid-date-wrap">
              <DateSelect
                v-model="invoiceStatusDraft.paidDate"
                commit-on-select
                placeholder="DD/MM/YYYY"
                class="invoice-status-paid-date-select"
              />
            </div>
          </div>

          <div class="invoice-status-dialog-footer">
            <button type="button" class="invoice-status-btn invoice-status-btn--secondary" @click="invoicePaidModalOpen = false">
              Cancel
            </button>
            <button
              type="button"
              class="invoice-status-btn invoice-status-btn--primary"
              :disabled="invoiceStatusSaving"
              @click="saveInvoiceStatusModal"
            >
              {{ invoiceStatusSaving ? "Updating…" : "Update" }}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="invoiceIssueTemplateModalOpen">
      <DialogContent class="invoice-status-dialog issue-template-dialog" :show-close-button="false">
        <div class="invoice-status-dialog-inner">
          <div class="invoice-status-dialog-head">
            <div class="invoice-status-dialog-title-block">
              <h2 class="invoice-status-dialog-title">Issue invoice</h2>
              <p class="invoice-status-dialog-desc">
                Choose payment terms to send with this invoice, or create a new template.
              </p>
            </div>
          </div>

          <div class="invoice-status-dialog-body">
            <div class="issue-template-mode-row" role="tablist" aria-label="Template source">
              <button
                type="button"
                class="issue-template-mode-btn"
                :class="{ 'issue-template-mode-btn--active': issueTermsMode === 'existing' }"
                role="tab"
                :aria-selected="issueTermsMode === 'existing'"
                @click="issueTermsMode = 'existing'"
              >
                Existing templates
              </button>
              <button
                type="button"
                class="issue-template-mode-btn"
                :class="{ 'issue-template-mode-btn--active': issueTermsMode === 'new' }"
                role="tab"
                :aria-selected="issueTermsMode === 'new'"
                @click="issueTermsMode = 'new'"
              >
                New template
              </button>
            </div>

            <template v-if="issueTermsMode === 'existing'">
              <label class="invoice-status-field-label" for="issue-template-select">Terms template</label>
              <select
                id="issue-template-select"
                v-model="issueSelectedTemplateId"
                class="issue-template-select"
                :disabled="issueTermsLoading || !issueTermsTemplates.length"
              >
                <option v-if="issueTermsLoading" value="" disabled>Loading templates…</option>
                <option v-else-if="!issueTermsTemplates.length" value="" disabled>No templates found</option>
                <option v-for="t in issueTermsTemplates" :key="t.id" :value="t.id">{{ t.name }}</option>
              </select>
              <template v-if="!issueTermsLoading && issueTermsTemplates.length">
                <label class="invoice-status-field-label" for="issue-existing-template-body">Terms text</label>
                <textarea
                  id="issue-existing-template-body"
                  class="invoice-status-notes issue-template-body-readonly"
                  rows="5"
                  readonly
                  :value="issueSelectedTemplateBody"
                  :placeholder="issueSelectedTemplateBody ? undefined : 'No terms text for this template.'"
                />
              </template>
              <p v-if="!issueTermsLoading && !issueTermsTemplates.length" class="issue-template-hint">
                Switch to “New template” to add one, then issue the invoice.
              </p>
            </template>

            <template v-else>
              <label class="invoice-status-field-label" for="issue-new-template-name">Template name</label>
              <input
                id="issue-new-template-name"
                v-model="issueNewTemplateName"
                type="text"
                class="milestone-send-work-link-input"
                placeholder="e.g. Standard 30-day terms"
                autocomplete="off"
              />
              <label class="invoice-status-field-label" for="issue-new-template-body">Terms text</label>
              <textarea
                id="issue-new-template-body"
                v-model="issueNewTemplateBody"
                class="invoice-status-notes"
                rows="5"
                placeholder="Payment terms, late fees, etc."
              />
            </template>
          </div>

          <div class="invoice-status-dialog-footer">
            <button
              type="button"
              class="invoice-status-btn invoice-status-btn--secondary"
              :disabled="invoiceStatusSaving"
              @click="cancelInvoiceIssueTemplatePicker"
            >
              Cancel
            </button>
            <button
              type="button"
              class="invoice-status-btn invoice-status-btn--primary"
              :disabled="invoiceStatusSaving || (issueTermsMode === 'existing' && issueTermsLoading)"
              @click="confirmInvoiceIssueWithSelectedTemplate"
            >
              {{ invoiceStatusSaving ? "Issuing…" : "Issue invoice" }}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="milestoneSendModalOpen">
      <DialogContent class="invoice-status-dialog" :show-close-button="false">
        <div class="invoice-status-dialog-inner">
          <div class="invoice-status-dialog-head">
            <div class="invoice-status-dialog-title-block">
              <h2 class="invoice-status-dialog-title">Milestone send</h2>
            </div>
          </div>

          <div class="invoice-status-dialog-body">
            <label class="invoice-status-field-label" for="milestone-work-link">Work link</label>
            <input
              id="milestone-work-link"
              v-model="milestoneSendWorkLink"
              type="url"
              class="milestone-send-work-link-input"
              placeholder="https://"
              autocomplete="url"
            />

            <label class="invoice-status-field-label">Add Payment Evidence</label>
            <div class="invoice-status-drop" :class="{ 'invoice-status-drop--drag': milestoneSendDropActive }">
              <input
                class="invoice-status-file-input"
                type="file"
                multiple
                accept="image/*,video/*,.pdf,.doc,.docx"
                @change="onMilestoneSendFilesPicked"
                @dragenter.prevent="milestoneSendDropActive = true"
                @dragleave.prevent="milestoneSendDropActive = false"
                @dragover.prevent="milestoneSendDropActive = true"
                @drop.prevent="onMilestoneSendDrop"
              />
              <div class="invoice-status-drop-visual">
                <CloudUpload class="invoice-status-drop-icon" aria-hidden="true" stroke-width="1.75" />
                <div class="invoice-status-drop-line">Click to select files or drag to upload</div>
                <div class="invoice-status-drop-sub">
                  Up to {{ MILESTONE_SEND_MAX_FILES }} files, max file size 5MB
                </div>
              </div>
            </div>

            <div v-if="milestoneSendFiles.length" class="invoice-status-file-list">
              <div
                v-for="(f, idx) in milestoneSendFiles"
                :key="f.name + ':' + f.size + ':' + f.lastModified"
                class="invoice-status-file-row"
              >
                <span class="invoice-status-file-left">
                  <Video
                    v-if="milestoneSendFileKind(f) === 'video'"
                    class="invoice-status-file-doc"
                    aria-hidden="true"
                    stroke-width="2"
                  />
                  <ImageIcon
                    v-else-if="milestoneSendFileKind(f) === 'image'"
                    class="invoice-status-file-doc"
                    aria-hidden="true"
                    stroke-width="2"
                  />
                  <FileText v-else class="invoice-status-file-doc" aria-hidden="true" stroke-width="2" />
                  <span class="invoice-status-file-name" :title="f.name">{{ f.name }}</span>
                </span>
                <button
                  type="button"
                  class="invoice-status-file-remove"
                  :aria-label="'Remove ' + f.name"
                  @click="removeMilestoneSendFile(idx)"
                >
                  <Trash2 class="invoice-status-file-trash" aria-hidden="true" stroke-width="2" />
                </button>
              </div>
            </div>
          </div>

          <div class="invoice-status-dialog-footer">
            <button type="button" class="invoice-status-btn invoice-status-btn--secondary" @click="closeMilestoneSendModal">
              Cancel
            </button>
            <button
              type="button"
              class="invoice-status-btn invoice-status-btn--primary"
              :disabled="milestoneSendSaving"
              @click="confirmSendMilestoneToClient"
            >
              {{ milestoneSendSaving ? "Sending…" : "Send to Client" }}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="milestoneSuccessModalOpen">
      <DialogContent class="milestone-success-dialog" :show-close-button="false">
        <div class="milestone-success-dialog-inner">
          <div class="milestone-success-icon-wrap" aria-hidden="true">
            <Check class="milestone-success-check" stroke-width="3" />
          </div>
          <h2 class="milestone-success-title">{{ milestoneSuccessTitle }}</h2>
          <p class="milestone-success-text">Milestone successfully sent to the client.</p>
          <div class="milestone-success-footer">
            <button type="button" class="invoice-status-btn invoice-status-btn--primary" @click="closeMilestoneSuccessModal">
              OK
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="invoiceEvidenceModalOpen">
      <DialogContent class="invoice-evidence-dialog" :show-close-button="false">
        <div class="invoice-evidence-dialog-inner">
          <div class="invoice-evidence-dialog-head">
            <div class="invoice-evidence-dialog-title-block">
              <h2 class="invoice-evidence-dialog-title">Payment evidence</h2>
              <p class="invoice-evidence-dialog-desc">Attachments submitted for this paid invoice.</p>
            </div>
          </div>

          <div class="invoice-evidence-dialog-body">
            <div class="project-details-media invoice-evidence-media">
              <a
                v-for="m in invoiceEvidenceItems"
                :key="m.url"
                class="project-details-media-thumb"
                :href="m.url"
                target="_blank"
                rel="noreferrer"
              >
                <img
                  v-if="m.kind === 'image'"
                  class="project-details-media-img"
                  :src="mediaImageSrc(m)"
                  :alt="m.name"
                  loading="lazy"
                />
                <div v-else class="project-details-media-file" :title="m.name">
                  <span class="project-details-media-file-icon" aria-hidden="true">📄</span>
                  <span class="project-details-media-file-name">{{ m.name }}</span>
                </div>
              </a>
            </div>
          </div>

          <div class="invoice-evidence-dialog-footer">
            <button type="button" class="invoice-status-btn invoice-status-btn--primary" @click="invoiceEvidenceModalOpen = false">
              Close
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="followUpModalOpen">
      <DialogContent
        class="follow-up-dialog"
        :show-close-button="false"
      >
        <div class="follow-up-dialog-inner">
          <div class="follow-up-dialog-head">
            <div class="follow-up-dialog-title-block">
              <h2 class="follow-up-dialog-title">Follow up</h2>
              <p class="follow-up-dialog-desc">Automate follow-ups for Due payments.</p>
            </div>
            <button
              type="button"
              class="follow-up-header-switch"
              :aria-pressed="followUpDraft.enabled"
              :data-on="followUpDraft.enabled"
              @click="followUpDraft.enabled = !followUpDraft.enabled"
            >
              <span class="follow-up-header-switch-thumb" />
            </button>
          </div>

          <div class="follow-up-dialog-body">
            <label class="follow-up-field-label" for="follow-up-message-edit">Message</label>
            <textarea
              id="follow-up-message-edit"
              v-model="followUpMessageEdit"
              class="follow-up-message-preview follow-up-message-edit"
              rows="4"
              spellcheck="true"
              aria-label="Follow-up message"
            />

            <label class="follow-up-field-label">Message Tone</label>
            <div class="follow-up-option-row follow-up-option-row--2">
              <button
                type="button"
                class="follow-up-choice"
                :class="{ 'follow-up-choice--active': followUpDraft.tone === 'gentle' }"
                @click="setFollowUpDraftTone('gentle')"
              >
                <span class="follow-up-choice-text">Gentle Reminder</span>
                <span class="follow-up-choice-radio" :data-on="followUpDraft.tone === 'gentle'" />
              </button>
              <button
                type="button"
                class="follow-up-choice"
                :class="{ 'follow-up-choice--active': followUpDraft.tone === 'firm' }"
                @click="setFollowUpDraftTone('firm')"
              >
                <span class="follow-up-choice-text">Firm Notice</span>
                <span class="follow-up-choice-radio" :data-on="followUpDraft.tone === 'firm'" />
              </button>
            </div>

            <label class="follow-up-field-label">Method</label>
            <div class="follow-up-option-row follow-up-option-row--2">
              <button
                type="button"
                class="follow-up-method"
                :class="{ 'follow-up-method--active': followUpDraft.method === 'email' }"
                @click="followUpDraft.method = 'email'"
              >
                <Mail class="follow-up-method-leading-icon" stroke-width="2" aria-hidden="true" />
                <span class="follow-up-method-text">Email</span>
                <span class="follow-up-method-indicator" :data-checked="followUpDraft.method === 'email'">
                  <Check
                    v-if="followUpDraft.method === 'email'"
                    class="follow-up-method-indicator-icon"
                    stroke-width="3"
                    aria-hidden="true"
                  />
                </span>
              </button>
              <button
                type="button"
                class="follow-up-method"
                :class="{ 'follow-up-method--active': followUpDraft.method === 'whatsapp' }"
                @click="followUpDraft.method = 'whatsapp'"
              >
                <span class="follow-up-method-wa-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <path
                      fill="#25D366"
                      d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.881 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"
                    />
                  </svg>
                </span>
                <span class="follow-up-method-text">WhatsApp</span>
                <span class="follow-up-method-indicator" :data-checked="followUpDraft.method === 'whatsapp'">
                  <Check
                    v-if="followUpDraft.method === 'whatsapp'"
                    class="follow-up-method-indicator-icon"
                    stroke-width="3"
                    aria-hidden="true"
                  />
                </span>
              </button>
            </div>

            <label class="follow-up-field-label">Follow Up frequently</label>
            <div class="follow-up-option-row follow-up-option-stack">
              <button
                type="button"
                class="follow-up-choice follow-up-choice--clock"
                :class="{ 'follow-up-choice--active': followUpDraft.frequency === 'every_3_days' }"
                @click="followUpDraft.frequency = 'every_3_days'"
              >
                <Clock class="follow-up-clock-icon" stroke-width="2" aria-hidden="true" />
                <span class="follow-up-choice-text">After 3 days Until paid</span>
                <span class="follow-up-choice-radio" :data-on="followUpDraft.frequency === 'every_3_days'" />
              </button>
              <button
                type="button"
                class="follow-up-choice follow-up-choice--clock"
                :class="{ 'follow-up-choice--active': followUpDraft.frequency === 'weekly' }"
                @click="followUpDraft.frequency = 'weekly'"
              >
                <Clock class="follow-up-clock-icon" stroke-width="2" aria-hidden="true" />
                <span class="follow-up-choice-text">Weekly Until paid</span>
                <span class="follow-up-choice-radio" :data-on="followUpDraft.frequency === 'weekly'" />
              </button>
            </div>
          </div>

          <div class="follow-up-dialog-footer">
            <button type="button" class="follow-up-btn follow-up-btn--secondary" @click="cancelFollowUpModal">
              Cancel
            </button>
            <button type="button" class="follow-up-btn follow-up-btn--primary" @click="saveFollowUpModal">
              Save
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </section>
</template>

<style scoped>
.project-details-screen {
  width: 100%;
  min-height: calc(100vh - 120px);
  padding: 18px 24px 32px;
  box-sizing: border-box;
  background: #f7f8fa;
}

.project-details-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.project-details-breadcrumb {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #64748b;
  font-size: 0.8125rem;
}

.project-details-bc-sep {
  opacity: 0.7;
}

.project-details-bc-project {
  color: inherit;
}

.project-details-bc-link {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-size: inherit;
  color: #2563eb;
  cursor: pointer;
  text-align: left;
}

.project-details-bc-link:hover {
  text-decoration: underline;
}

.project-details-bc-current {
  color: #0f172a;
}

.project-details-breadcrumb strong {
  color: #0f172a;
  font-weight: 600;
}

.project-details-back {
  width: 28px;
  height: 28px;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  background: #fff;
  cursor: pointer;
  color: #334155;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  line-height: 1;
}

.project-details-settings {
  width: 36px;
  height: 36px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #475569;
}

.project-details-settings:hover {
  background: #f8fafc;
}

.project-details-settings-icon {
  font-size: 1rem;
  line-height: 1;
}

.project-details-tabs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  margin-bottom: 16px;
  background: #e2e8f0;
  border-radius: 999px;
}

.project-details-tab {
  border: 1px solid transparent;
  background: #fff;
  cursor: pointer;
  font-size: 0.8125rem;
  font-weight: 500;
  color: #475569;
  padding: 8px 18px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.project-details-tab:not(.project-details-tab--active) {
  border-color: #e2e8f0;
}

.project-details-tab--active {
  background: #1e3a5f;
  border-color: #1e3a5f;
  color: #fff;
  box-shadow: none;
}

.project-details-tab-badge {
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.2);
  color: inherit;
  font-size: 0.6875rem;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.project-details-tab:not(.project-details-tab--active) .project-details-tab-badge {
  background: #e2e8f0;
  color: #334155;
}

.project-details-body {
  display: grid;
  gap: 12px;
}

.project-details-body--invoice-tab {
  max-width: 100%;
}

.project-details-body--invoice-detail {
  margin-top: 4px;
}

.project-details-invoice-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin: 0 0 20px;
}

.project-details-invoice-page-heading {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #1e293b;
  line-height: 1.2;
}

.project-details-invoice-download-pdf {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid #0f172a;
  background: #ffffff;
  color: #0f172a;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}

.project-details-invoice-download-pdf:hover:not(:disabled) {
  background: #f8fafc;
}

.project-details-invoice-download-pdf:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.project-details-invoice-download-pdf-icon {
  width: 16px;
  height: 16px;
}

.project-details-invoice-card-pdf {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 12px;
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  color: #0f172a;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}

.project-details-invoice-card-pdf:hover:not(:disabled) {
  border-color: #cbd5e1;
  background: #f1f5f9;
}

.project-details-invoice-card-pdf:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.project-details-invoice-card-pdf-icon {
  width: 14px;
  height: 14px;
}

.project-details-card {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.project-details-card--financing {
  box-shadow: none;
}

.project-details-card--invoice-status-dropdown {
  overflow: visible;
}

.project-details-card-header {
  padding: 12px 16px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #0f172a;
  border: none;
  border-bottom: 1px solid #f1f5f9;
  background: #fff;
  width: 100%;
  text-align: left;
}

.project-details-card-header--toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
}

.project-details-card-header--toggle:hover {
  background: #fafbfc;
}

.project-details-card-header--static {
  padding: 12px 16px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #0f172a;
  border-bottom: 1px solid #f1f5f9;
}

.project-details-chevron {
  width: 10px;
  height: 10px;
  border-right: 2px solid #94a3b8;
  border-bottom: 2px solid #94a3b8;
  transform: rotate(-135deg);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.project-details-chevron--collapsed {
  transform: rotate(45deg);
}

.project-details-card-body {
  padding: 4px 0 8px;
}

.project-details-card-body--status {
  padding-bottom: 12px;
}

.project-details-grid {
  display: grid;
  padding: 4px 0;
}

.project-details-row {
  display: grid;
  grid-template-columns: minmax(120px, 200px) 1fr;
  gap: 16px;
  padding: 10px 16px;
  font-size: 0.8125rem;
  color: #64748b;
  align-items: start;
}

.project-details-row--scope {
  align-items: start;
}

.project-details-row--stack {
  grid-template-columns: minmax(120px, 200px) 1fr;
}

.project-details-scope-value {
  text-align: right;
  white-space: pre-wrap;
  line-height: 1.45;
  font-weight: 500;
}

.project-details-row strong {
  color: #0f172a;
  font-weight: 500;
  text-align: right;
  justify-self: end;
}

.project-details-row--stack strong {
  text-align: left;
  justify-self: start;
}

.project-details-financing-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  font-size: 0.8125rem;
}

.project-details-financing-title {
  font-weight: 600;
  color: #0f172a;
}

.project-details-financing-value {
  color: #0f172a;
  font-weight: 500;
  font-size: 0.875rem;
}

.project-details-card--status-compact {
  overflow: visible;
}

.project-details-status-compact {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
}

.project-details-status-compact-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #0f172a;
}

.project-details-status-discussion {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid #1e3a5f;
  background: #fff;
  color: #1e3a5f;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: default;
}

.project-details-status-discussion-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.project-details-body--milestones {
  gap: 14px;
}

.project-details-milestone-card {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #fff;
  padding: 16px 18px 14px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.project-details-milestone-card--sent {
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.project-details-milestone-card--sent:hover {
  border-color: #cbd5e1;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
}

.project-details-milestone-card--sent:focus {
  outline: none;
}

.project-details-milestone-card--sent:focus-visible {
  outline: 2px solid #1d4ed8;
  outline-offset: 2px;
}

.project-details-milestone-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.project-details-milestone-head-left {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.project-details-milestone-badge {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 600;
  background: #e2e8f0;
  color: #64748b;
  flex-shrink: 0;
}

.project-details-milestone-badge--primary {
  background: #1e3a5f;
  color: #fff;
}

.project-details-milestone-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #0f172a;
}

.project-details-milestone-head-right {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.project-details-milestone-chevron {
  width: 18px;
  height: 18px;
  color: #94a3b8;
  flex-shrink: 0;
}

.project-details-milestone-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
}

.project-details-milestone-status[data-variant="completed"] {
  background: #ecfdf3;
  border: 1px solid #bbf7d0;
  color: #166534;
}

.project-details-milestone-status[data-variant="review"] {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #1d4ed8;
}

.project-details-milestone-status[data-variant="neutral"] {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  color: #475569;
}

.project-details-milestone-status-icon {
  width: 14px;
  height: 14px;
}

.project-details-milestone-title {
  margin: 0 0 8px;
  font-size: 0.9375rem;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.02em;
}

.project-details-milestone-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 0.75rem;
}

.project-details-milestone-meta-label {
  color: #64748b;
  font-weight: 600;
}

.project-details-milestone-meta-value {
  color: #0f172a;
  font-weight: 700;
}

.project-details-milestone-work-link {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 0.75rem;
}

.project-details-milestone-link-ico {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: #64748b;
  margin-top: 2px;
}

.project-details-milestone-link-a {
  color: #1d4ed8;
  font-weight: 600;
  text-decoration: none;
  word-break: break-all;
}

.project-details-milestone-link-a:hover {
  text-decoration: underline;
}

.project-details-milestone-sent {
  margin: 0 0 12px;
  font-size: 0.6875rem;
  color: #64748b;
}

.project-details-milestone-media {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.project-details-milestone-send {
  padding: 6px 16px;
  border-radius: 999px;
  border: 1px solid #1e3a5f;
  background: #fff;
  color: #1e3a5f;
  font-size: 0.6875rem;
  font-weight: 600;
  cursor: pointer;
}

.project-details-milestone-send:hover {
  background: #f8fafc;
}

.project-details-milestone-desc {
  margin: 0 0 14px;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: #64748b;
}

.project-details-milestone-divider {
  height: 1px;
  background: #f1f5f9;
  margin: 0 0 12px;
}

.project-details-milestone-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.75rem;
}

.project-details-milestone-date {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #64748b;
}

.project-details-milestone-cal {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  opacity: 0.85;
}

.project-details-milestone-amt {
  font-size: 0.875rem;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.02em;
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

.project-details-media-file {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  gap: 6px;
  padding: 10px;
  box-sizing: border-box;
  color: #0f172a;
}

.project-details-media-file-icon {
  font-size: 18px;
  line-height: 1;
}

.project-details-media-file-name {
  font-size: 0.7rem;
  font-weight: 600;
  color: #334155;
  text-align: center;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.project-details-invoice-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
  gap: 14px;
  align-items: stretch;
}

.project-details-invoice-card {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  overflow: hidden;
  cursor: pointer;
}

.project-details-invoice-card:focus-visible {
  outline: 2px solid #1d4ed8;
  outline-offset: 2px;
}

.project-details-invoice-card-head {
  padding: 10px 12px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 10px;
  border-bottom: 1px solid #f1f5f9;
}

.project-details-invoice-amount {
  min-width: 0;
  flex: 1 1 auto;
  font-size: 0.875rem;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.01em;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.project-details-invoice-amount span {
  font-size: 0.625rem;
  font-weight: 700;
  color: #475569;
  margin-left: 3px;
}

.project-details-invoice-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
  padding: 2px 10px;
  margin-left: auto;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  color: #0f172a;
  font-size: 0.6875rem;
  font-weight: 600;
  white-space: nowrap;
  max-width: 100%;
  box-sizing: border-box;
}

.project-details-invoice-status--clickable {
  cursor: pointer;
}

.project-details-invoice-status:disabled {
  opacity: 0.9;
  cursor: default;
}

.project-details-invoice-status-actions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  position: relative;
}

.project-details-invoice-evidence-btn {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  color: #1d4ed8;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}

.project-details-invoice-evidence-btn:hover {
  text-decoration: underline;
}

.project-details-invoice-status-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #0f172a;
  position: relative;
  opacity: 0.9;
}

.project-details-invoice-status-dot::after {
  content: "";
  position: absolute;
  inset: 3px;
  border-radius: 999px;
  background: #ffffff;
  opacity: 0.6;
}

.project-details-invoice-status[data-variant="paid"] {
  border-color: #bbf7d0;
  background: #f0fdf4;
  color: #166534;
}

.project-details-invoice-status[data-variant="paid"] .project-details-invoice-status-dot {
  background: #16a34a;
}

.project-details-invoice-status[data-variant="issued"] {
  border-color: #bfdbfe;
  background: #eff6ff;
  color: #1d4ed8;
}

.project-details-invoice-status[data-variant="issued"] .project-details-invoice-status-dot {
  background: #3b82f6;
}

.project-details-invoice-status[data-variant="not_issued"],
.project-details-invoice-status[data-variant="unknown"] {
  border-color: #bfdbfe;
  background: #eff6ff;
  color: #1d4ed8;
}

.project-details-invoice-status[data-variant="not_issued"] .project-details-invoice-status-dot,
.project-details-invoice-status[data-variant="unknown"] .project-details-invoice-status-dot {
  background: #3b82f6;
}

.project-details-invoice-status[data-variant="overdue"] {
  border-color: #fecaca;
  background: #fef2f2;
  color: #b91c1c;
}

.project-details-invoice-status[data-variant="overdue"] .project-details-invoice-status-dot {
  background: #ef4444;
}

.project-details-invoice-status[data-variant="cancelled"] {
  border-color: #e5e7eb;
  background: #f3f4f6;
  color: #4b5563;
}

.project-details-invoice-status[data-variant="cancelled"] .project-details-invoice-status-dot {
  background: #9ca3af;
}

.project-details-invoice-rows {
  padding: 8px 12px 10px;
  display: grid;
  gap: 8px;
}

.project-details-invoice-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, auto);
  gap: 10px;
  align-items: center;
  font-size: 0.6875rem;
  color: #94a3b8;
}

.project-details-invoice-row strong {
  font-size: 0.6875rem;
  font-weight: 600;
  color: #0f172a;
  text-align: right;
  min-width: 0;
  overflow-wrap: anywhere;
}

@media (max-width: 380px) {
  .project-details-invoice-row {
    grid-template-columns: 1fr;
    gap: 2px;
    align-items: start;
  }

  .project-details-invoice-row strong {
    text-align: left;
  }
}

.project-details-invoice-details {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.project-details-invoice-details-left {
  min-width: 0;
}

.project-details-invoice-details-right {
  display: flex;
  justify-content: stretch;
  min-width: 0;
}

.project-details-invoice-details-left .project-details-card {
  border-radius: 8px;
  border-color: #e6edf5;
  box-shadow: none;
}

.project-details-card-body--invoice-plain {
  padding: 8px 0 10px;
}

.project-details-grid--invoice-details .project-details-row {
  grid-template-columns: minmax(120px, 170px) 1fr;
}

.project-details-invoice-accordion-head {
  background: #ffffff;
  border-bottom-color: #eef2f7;
}

.project-details-invoice-accordion-head:hover {
  background: #fbfdff;
}

.project-details-invoice-details-left .project-details-row {
  padding: 8px 16px;
  font-size: 0.75rem;
}

.project-details-invoice-details-left .project-details-row span {
  color: #94a3b8;
}

.project-details-invoice-details-left .project-details-row strong {
  font-weight: 600;
  color: #1e3a5f;
}

.project-details-row--invoice-amount strong {
  font-size: 1.0625rem;
  font-weight: 700;
  color: #0f172a;
}

.project-details-invoice-details-text {
  padding: 12px 16px 14px;
  font-size: 0.75rem;
  color: #334155;
  line-height: 1.55;
  white-space: pre-wrap;
}

.project-details-invoice-followup {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  font-size: 0.75rem;
  color: #0f172a;
  font-weight: 700;
}

.follow-up-dialog {
  width: min(456px, calc(100vw - 2rem));
  padding: 0;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid #e8ecf1;
  background: #f3f4f6;
  box-shadow: 0 25px 60px rgba(15, 23, 42, 0.22);
}

.follow-up-dialog-inner {
  display: flex;
  flex-direction: column;
  max-height: min(90vh, 680px);
  background: #f3f4f6;
}

.follow-up-dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 24px 18px;
  border-bottom: none;
  background: #f3f4f6;
}

.follow-up-dialog-title {
  margin: 0;
  font-size: 1.28rem;
  font-weight: 700;
  color: #0a0f1a;
  letter-spacing: -0.025em;
  line-height: 1.2;
}

.follow-up-dialog-desc {
  margin: 8px 0 0;
  font-size: 0.8125rem;
  color: #64748b;
  line-height: 1.5;
  font-weight: 500;
  max-width: 280px;
}

.follow-up-header-switch {
  width: 44px;
  height: 24px;
  flex-shrink: 0;
  margin-top: 4px;
  border-radius: 999px;
  border: 1px solid #dce3eb;
  background: #eef2f6;
  cursor: pointer;
  padding: 0;
  position: relative;
  transition:
    background 0.18s ease,
    border-color 0.18s ease;
}

.follow-up-header-switch[data-on="true"] {
  background: #0f172a;
  border-color: #0f172a;
}

.follow-up-header-switch-thumb {
  position: absolute;
  top: 50%;
  left: 3px;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12);
  transition: left 0.18s ease;
}

.follow-up-header-switch[data-on="true"] .follow-up-header-switch-thumb {
  left: 23px;
}

.follow-up-dialog-body {
  padding: 18px 24px 10px;
  overflow-y: auto;
  background: #f3f4f6;
}

.follow-up-field-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 8px;
  margin-top: 18px;
  letter-spacing: -0.01em;
}

.follow-up-field-label:first-of-type {
  margin-top: 0;
}

.follow-up-message-preview {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 14px 16px;
  font-size: 0.8125rem;
  line-height: 1.55;
  color: #334155;
  background: #ffffff;
  min-height: 76px;
}

.follow-up-message-edit {
  box-sizing: border-box;
  width: 100%;
  resize: vertical;
  font: inherit;
  outline: none;
}

.follow-up-message-edit:focus {
  border-color: #94a3b8;
  box-shadow: 0 0 0 1px #cbd5e1;
}

.follow-up-option-row {
  display: flex;
  gap: 12px;
}

.follow-up-option-row--2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.follow-up-option-stack {
  flex-direction: column;
  gap: 12px;
}

.follow-up-choice {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 14px;
  border-radius: 10px;
  border: 1.5px solid #e5e7eb;
  background: #fff;
  cursor: pointer;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #1e293b;
  text-align: left;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.follow-up-choice-text {
  flex: 1;
  min-width: 0;
  line-height: 1.35;
}

.follow-up-choice--clock {
  width: 100%;
  box-sizing: border-box;
}

.follow-up-choice--active {
  border-color: #0f172a;
  background: #ffffff;
}

.follow-up-choice-radio {
  margin-left: auto;
  width: 19px;
  height: 19px;
  border-radius: 999px;
  border: 2px solid #c5cdd8;
  flex-shrink: 0;
  box-sizing: border-box;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.follow-up-choice-radio[data-on="true"] {
  border-color: #0f172a;
  background: #0f172a;
  box-shadow: inset 0 0 0 3px #fff;
}

.follow-up-clock-icon {
  width: 18px;
  height: 18px;
  color: #64748b;
  flex-shrink: 0;
}

.follow-up-method {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 11px;
  padding: 14px 14px 14px 14px;
  border-radius: 10px;
  border: 1.5px solid #e5e7eb;
  background: #fff;
  cursor: pointer;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #1e293b;
  text-align: left;
  min-height: 52px;
  box-sizing: border-box;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.follow-up-method--active {
  border-color: #0f172a;
  background: #ffffff;
}

.follow-up-method-leading-icon {
  width: 22px;
  height: 22px;
  color: #475569;
  flex-shrink: 0;
}

.follow-up-method-wa-icon {
  display: flex;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
}

.follow-up-method-text {
  flex: 1;
  min-width: 0;
  line-height: 1.35;
}

.follow-up-method-indicator {
  margin-left: auto;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1.5px solid #cbd5e1;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.follow-up-method-indicator[data-checked="true"] {
  background: #0f172a;
  border-color: #0f172a;
}

.follow-up-method-indicator-icon {
  width: 12px;
  height: 12px;
  color: #fff;
  stroke: #fff;
}

.follow-up-dialog-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  padding: 18px 24px 22px;
  border-top: none;
  background: #f3f4f6;
}

.milestone-send-work-link-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 10px 12px;
  font: inherit;
  font-size: 0.875rem;
  color: #0f172a;
}

.milestone-send-work-link-input::placeholder {
  color: #94a3b8;
}

.issue-template-dialog {
  max-width: min(calc(100% - 2rem), 440px);
}

.issue-template-mode-row {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
}

.issue-template-mode-btn {
  flex: 1;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  background: #fff;
  font-size: 0.8125rem;
  font-weight: 700;
  color: #64748b;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}

.issue-template-mode-btn:hover {
  border-color: #cbd5e1;
  color: #0f172a;
}

.issue-template-mode-btn--active {
  border-color: #c7d2fe;
  background: #f8fafc;
  color: #1e3a5f;
}

.issue-template-select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 10px 12px;
  font: inherit;
  font-size: 0.875rem;
  color: #0f172a;
  background: #fff;
}

.issue-template-hint {
  margin: 8px 0 0;
  font-size: 0.8125rem;
  color: #64748b;
  line-height: 1.45;
}

.issue-template-body-readonly {
  margin-top: 0;
  background: #f8fafc;
  color: #334155;
  resize: none;
  cursor: default;
}

.issue-template-body-readonly::placeholder {
  color: #94a3b8;
}

.milestone-success-dialog {
  padding: 0;
  overflow: hidden;
  max-width: min(calc(100% - 2rem), 380px);
}

.milestone-success-dialog-inner {
  padding: 28px 22px 22px;
  text-align: center;
}

.milestone-success-icon-wrap {
  width: 64px;
  height: 64px;
  margin: 0 auto 16px;
  border-radius: 999px;
  background: #dcfce7;
  display: flex;
  align-items: center;
  justify-content: center;
}

.milestone-success-check {
  width: 32px;
  height: 32px;
  color: #16a34a;
}

.milestone-success-title {
  margin: 0 0 10px;
  font-size: 1.125rem;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.02em;
}

.milestone-success-text {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 500;
  color: #64748b;
  line-height: 1.45;
}

.milestone-success-footer {
  margin-top: 22px;
  display: flex;
  justify-content: center;
}

.project-details-body--milestone-detail {
  width: 100%;
  max-width: none;
  margin: 0;
}

.milestone-timeline-page {
  width: 100%;
  min-width: 0;
}

.milestone-timeline {
  display: flex;
  flex-direction: column;
  gap: 0;
  width: 100%;
  min-width: 0;
}

.milestone-timeline-step {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
}

.milestone-timeline-step--last {
  grid-template-columns: 1fr;
}

.milestone-timeline-rail {
  position: relative;
  display: flex;
  justify-content: center;
  padding-top: 8px;
}

.milestone-timeline-rail-line {
  width: 2px;
  flex: 1;
  min-height: 24px;
  background: linear-gradient(180deg, #cbd5e1 0%, #e2e8f0 100%);
  border-radius: 999px;
}

.milestone-timeline-card {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  margin-bottom: 0;
}

.milestone-timeline-step:not(.milestone-timeline-step--last) .milestone-timeline-card {
  margin-bottom: 10px;
}

.milestone-timeline-card-head {
  padding: 16px 16px 14px;
}

.milestone-timeline-card-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.milestone-timeline-card-name {
  font-size: 0.9375rem;
  font-weight: 700;
  color: #0f172a;
  flex: 1;
  min-width: 0;
}

.milestone-timeline-icon {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.milestone-timeline-icon--success {
  background: #ecfdf3;
  color: #16a34a;
}

.milestone-timeline-icon--muted {
  background: #f1f5f9;
  color: #64748b;
}

.milestone-timeline-icon--payment {
  background: #fefce8;
  color: #a16207;
}

.milestone-timeline-icon-svg {
  width: 18px;
  height: 18px;
}

.milestone-timeline-pill {
  font-size: 0.6875rem;
  font-weight: 700;
  padding: 5px 11px;
  border-radius: 999px;
  flex-shrink: 0;
}

.milestone-timeline-pill--sent {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #1d4ed8;
}

.milestone-timeline-pill--review {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #1d4ed8;
}

.milestone-timeline-pill--approved {
  background: #ecfdf3;
  border: 1px solid #bbf7d0;
  color: #166534;
}

.milestone-timeline-pill--rejected {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
}

.milestone-timeline-pill--pending {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  color: #64748b;
}

.milestone-timeline-pill--paid {
  background: #ecfdf3;
  border: 1px solid #bbf7d0;
  color: #166534;
}

.milestone-timeline-invoice-status {
  flex-shrink: 0;
  margin-left: auto;
}

:deep(.milestone-status-menu) {
  width: 180px;
  padding: 10px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow:
    0 10px 25px rgba(15, 23, 42, 0.12),
    0 2px 6px rgba(15, 23, 42, 0.08);
}

.milestone-status-menu-title {
  font-size: 0.75rem;
  font-weight: 700;
  color: #64748b;
  margin: 2px 2px 8px;
}

.milestone-status-menu-item {
  padding: 6px 4px;
}

.milestone-status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
  width: 100%;
}

.milestone-status-pill--review {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #1d4ed8;
}

.milestone-status-pill--approved {
  background: #ecfdf3;
  border: 1px solid #bbf7d0;
  color: #166534;
}

.milestone-status-pill--rejected {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
}

.milestone-timeline-meta-line {
  margin: 0 0 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #475569;
}

.milestone-timeline-meta-ico {
  width: 16px;
  height: 16px;
  color: #64748b;
  flex-shrink: 0;
}

.milestone-timeline-body-text {
  margin: 0 0 12px;
  font-size: 0.8125rem;
  line-height: 1.55;
  color: #64748b;
}

.milestone-timeline-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.milestone-timeline-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  font-size: 0.75rem;
  font-weight: 700;
  color: #0f172a;
}

.milestone-timeline-chip-ico {
  width: 14px;
  height: 14px;
  color: #64748b;
}

.milestone-timeline-card-actions {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
}

.milestone-timeline-card-actions--end {
  justify-content: flex-end;
}

.milestone-timeline-btn {
  height: 36px;
  padding: 0 16px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 0.8125rem;
  cursor: pointer;
  border: 1px solid transparent;
}

.milestone-timeline-btn--primary {
  background: #1e3a5f;
  border-color: #1e3a5f;
  color: #fff;
}

.milestone-timeline-btn--primary:hover {
  background: #152a45;
  border-color: #152a45;
}

.milestone-timeline-btn--outline {
  background: #fff;
  border-color: #0f172a;
  color: #0f172a;
}

.milestone-timeline-btn--outline:hover {
  background: #f8fafc;
}

.invoice-status-dialog {
  padding: 0;
  overflow: hidden;
}

.invoice-status-dialog-inner,
.invoice-evidence-dialog-inner {
  display: grid;
  grid-template-rows: auto 1fr auto;
}

.invoice-status-dialog-head,
.invoice-evidence-dialog-head {
  padding: 18px 18px 0;
}

.invoice-status-dialog-title,
.invoice-evidence-dialog-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.01em;
}

.invoice-status-dialog-desc,
.invoice-evidence-dialog-desc {
  margin: 6px 0 0;
  font-size: 0.8125rem;
  color: #64748b;
}

.invoice-status-dialog-body,
.invoice-evidence-dialog-body {
  padding: 14px 18px 16px;
}

.invoice-status-field-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 700;
  color: #475569;
  margin: 10px 0 8px;
}

.invoice-status-options {
  display: grid;
  gap: 10px;
}

.invoice-status-option {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  cursor: pointer;
}

.invoice-status-option--active {
  border-color: #c7d2fe;
  background: #f8fafc;
}

.invoice-status-option-left {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.invoice-status-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #0f172a;
}

.invoice-status-dot[data-variant="paid"] {
  background: #16a34a;
}
.invoice-status-dot[data-variant="issued"] {
  background: #3b82f6;
}
.invoice-status-dot[data-variant="review"] {
  background: #3b82f6;
}
.invoice-status-dot[data-variant="approved"] {
  background: #16a34a;
}
.invoice-status-dot[data-variant="rejected"] {
  background: #ef4444;
}
.invoice-status-dot[data-variant="overdue"] {
  background: #ef4444;
}
.invoice-status-dot[data-variant="cancelled"] {
  background: #9ca3af;
}

.invoice-status-option-text {
  font-size: 0.875rem;
  font-weight: 700;
  color: #0f172a;
}

.invoice-status-option-radio {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 2px solid #cbd5e1;
  position: relative;
}
.invoice-status-option-radio[data-on="true"] {
  border-color: #1d4ed8;
}
.invoice-status-option-radio[data-on="true"]::after {
  content: "";
  position: absolute;
  inset: 3px;
  border-radius: 999px;
  background: #1d4ed8;
}

.invoice-status-paid-block {
  margin-top: 8px;
}

.invoice-status-drop {
  border: 1px dashed #cbd5e1;
  border-radius: 12px;
  padding: 22px 16px;
  background: #f8fafc;
  position: relative;
  min-height: 132px;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.invoice-status-drop--drag {
  border-color: #93c5fd;
  background: #eff6ff;
}

.invoice-status-file-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  z-index: 1;
}

.invoice-status-drop-visual {
  position: relative;
  z-index: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  pointer-events: none;
  text-align: center;
}

.invoice-status-drop-icon {
  width: 40px;
  height: 40px;
  color: #64748b;
}

.invoice-status-drop-line {
  font-size: 0.875rem;
  font-weight: 600;
  color: #0f172a;
}

.invoice-status-drop-sub {
  font-size: 0.75rem;
  color: #94a3b8;
}

.invoice-status-file-list {
  margin-top: 10px;
  display: grid;
  gap: 8px;
}

.invoice-status-file-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #fecaca;
  border-radius: 12px;
  background: #fef2f2;
}

.invoice-status-file-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.invoice-status-file-doc {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  color: #dc2626;
}

.invoice-status-file-name {
  font-size: 0.8125rem;
  font-weight: 700;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.invoice-status-file-remove {
  border: none;
  background: none;
  padding: 6px;
  font: inherit;
  color: #dc2626;
  cursor: pointer;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.invoice-status-file-remove:hover {
  background: rgba(220, 38, 38, 0.1);
}

.invoice-status-file-trash {
  width: 18px;
  height: 18px;
}

.invoice-status-notes {
  width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 10px 12px;
  font: inherit;
  font-size: 0.875rem;
  resize: vertical;
}

.invoice-status-paid-date-wrap {
  width: 100%;
}

.invoice-status-paid-date-wrap :deep(.ds-wrap) {
  width: 100%;
}

.invoice-status-paid-date-wrap :deep(.ds-input) {
  width: 100%;
  justify-content: flex-start;
}

.invoice-status-dialog-footer,
.invoice-evidence-dialog-footer {
  padding: 0 18px 18px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.invoice-status-btn {
  height: 38px;
  padding: 0 16px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 0.875rem;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  cursor: pointer;
}

.invoice-status-btn--primary {
  border-color: #1d4ed8;
  background: #1d4ed8;
  color: #ffffff;
}

.invoice-status-btn--secondary {
  color: #0f172a;
  border-color: #0f172a;
  background: #ffffff;
}

.invoice-status-btn:disabled {
  opacity: 0.7;
  cursor: default;
}

.invoice-evidence-media {
  margin-top: 10px;
}

.invoice-status-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 180px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.14);
  z-index: 40;
  padding: 10px;
}

.invoice-status-popover-title {
  font-size: 0.6875rem;
  font-weight: 800;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 2px 6px 8px;
}

.invoice-status-popover-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  border: none;
  background: transparent;
  cursor: pointer;
}

.invoice-status-popover-item:hover {
  background: #f8fafc;
}

.invoice-status-popover-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.invoice-status-popover-item:disabled:hover {
  background: transparent;
}

.invoice-status-popover-item--active {
  background: #f1f5f9;
}

.invoice-status-popover-left {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.invoice-status-popover-text {
  font-size: 0.8125rem;
  font-weight: 700;
  color: #0f172a;
}

.invoice-status-popover-radio {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  border: 2px solid #cbd5e1;
  position: relative;
}

.invoice-status-popover-radio[data-on="true"] {
  border-color: #0f172a;
}

.invoice-status-popover-radio[data-on="true"]::after {
  content: "";
  position: absolute;
  inset: 2px;
  border-radius: 999px;
  background: #0f172a;
}

.follow-up-btn {
  min-width: 104px;
  padding: 10px 22px;
  border-radius: 999px;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    opacity 0.15s ease;
}

.follow-up-btn--secondary {
  border: 1px solid #cbd5e1;
  background: transparent;
  color: #0f172a;
}

.follow-up-btn--secondary:hover {
  background: rgba(255, 255, 255, 0.55);
}

.follow-up-btn--primary {
  border: 1px solid #0f172a;
  background: #0f172a;
  color: #fff;
}

.follow-up-btn--primary:hover {
  background: #111827;
  border-color: #111827;
}

.project-details-switch {
  width: 40px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #f1f5f9;
  cursor: pointer;
  padding: 0;
  position: relative;
}

.project-details-switch[data-on="true"] {
  background: #0f172a;
  border-color: #0f172a;
}

.project-details-switch-thumb {
  position: absolute;
  top: 50%;
  left: 2px;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: #fff;
  transition: left 0.18s ease;
}

.project-details-switch[data-on="true"] .project-details-switch-thumb {
  left: 20px;
}

.project-details-invoice-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
}

.project-details-invoice-status-title {
  font-size: 0.75rem;
  font-weight: 700;
  color: #0f172a;
}

.project-details-invoice-preview {
  position: relative;
  width: 100%;
  max-width: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  overflow: hidden;
}

.project-details-invoice-preview--expanded {
  position: fixed;
  inset: 20px;
  z-index: 300;
  width: auto !important;
  max-width: none;
  max-height: calc(100vh - 40px);
  overflow: auto;
  box-shadow: 0 25px 60px rgba(15, 23, 42, 0.22);
}

.project-details-invoice-preview-expand {
  position: absolute;
  bottom: 14px;
  left: 14px;
  z-index: 2;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: #475569;
}

.project-details-invoice-preview-expand:hover {
  background: #f8fafc;
  color: #0f172a;
}

.project-details-invoice-preview-expand-icon {
  font-size: 0.95rem;
  line-height: 1;
}

.project-details-invoice-preview-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border-bottom: 1px solid #f1f5f9;
}

.project-details-invoice-preview-brand {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
}

.project-details-invoice-preview-logo {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  flex-shrink: 0;
  object-fit: cover;
  display: block;
}

.project-details-invoice-preview-heading {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.project-details-invoice-preview-title {
  font-size: 1.375rem;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.03em;
  line-height: 1.15;
}

.project-details-invoice-preview-id {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #64748b;
}

.project-details-invoice-preview-meta {
  font-size: 0.75rem;
  color: #64748b;
  text-align: right;
  line-height: 1.5;
  flex-shrink: 0;
}

.project-details-invoice-preview-body {
  padding: 18px 20px 20px;
}

.project-details-invoice-preview-line {
  height: 1px;
  background: #e2e8f0;
  margin-bottom: 12px;
}

.project-details-invoice-preview-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 14px;
}

.project-details-invoice-preview-label {
  font-size: 0.65rem;
  font-weight: 700;
  color: #94a3b8;
  margin-bottom: 4px;
}

.project-details-invoice-preview-text {
  font-size: 0.75rem;
  color: #0f172a;
}

.project-details-invoice-preview-text--address {
  white-space: pre-line;
  line-height: 1.5;
}

.project-details-invoice-preview-table {
  border: 1px solid #f1f5f9;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 14px;
}

.project-details-invoice-preview-th,
.project-details-invoice-preview-tr {
  display: grid;
  grid-template-columns: 1.8fr 0.9fr 0.9fr;
  gap: 12px;
  padding: 10px 12px;
  font-size: 0.7rem;
}

.project-details-invoice-preview-th {
  background: #f8fafc;
  color: #64748b;
  font-weight: 700;
}

.project-details-invoice-preview-tr {
  color: #0f172a;
  border-top: 1px solid #f1f5f9;
  align-items: start;
}

.project-details-invoice-preview-subject {
  font-size: 0.8rem;
  font-weight: 700;
  color: #0f172a;
  margin: 6px 0 10px;
}

.project-details-invoice-preview-source {
  min-width: 0;
}

.project-details-invoice-preview-source-title {
  font-weight: 700;
  color: #0f172a;
  line-height: 1.25;
}

.project-details-invoice-preview-source-desc {
  margin-top: 2px;
  color: #64748b;
  font-size: 0.66rem;
  line-height: 1.35;
  white-space: pre-wrap;
}

.project-details-invoice-preview-date {
  color: #0f172a;
}

.project-details-invoice-preview-amount {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.project-details-invoice-preview-totals {
  padding-bottom: 8px;
}

.project-details-invoice-preview-total-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.74rem;
  color: #64748b;
  margin-bottom: 6px;
}

.project-details-invoice-preview-total-row span:last-child {
  color: #0f172a;
  font-weight: 500;
}

.project-details-invoice-preview-total {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  padding-top: 12px;
  border-top: 1px solid #f1f5f9;
  font-size: 0.84rem;
  color: #0f172a;
  font-weight: 700;
}

.project-details-invoice-preview-footer {
  margin-top: 8px;
  padding: 16px 0 40px;
  border-top: 1px solid #e2e8f0;
}

.project-details-invoice-preview-footer-block + .project-details-invoice-preview-footer-block {
  margin-top: 14px;
}

.project-details-invoice-preview-footer-label {
  font-size: 0.75rem;
  font-weight: 700;
  color: #64748b;
  margin-bottom: 6px;
}

.project-details-invoice-preview-footer-text {
  font-size: 0.72rem;
  color: #475569;
  line-height: 1.55;
  white-space: pre-wrap;
}

@media (max-width: 1100px) {
  .project-details-invoice-details {
    grid-template-columns: 1fr;
  }

  .project-details-invoice-details-left {
    max-width: none;
  }

  .project-details-invoice-details-right {
    justify-content: flex-start;
  }
}

.project-details-placeholder {
  margin-top: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px;
  background: #fff;
  color: #64748b;
  font-size: 0.875rem;
}

.project-details-placeholder--inline {
  margin-top: 0;
  border: none;
  padding: 12px 16px 20px;
  background: transparent;
}

/* DropdownMenuContent is rendered in a portal, so keep these styles global. */
:global(.milestone-status-menu) {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow:
    0 10px 25px rgba(15, 23, 42, 0.12),
    0 2px 6px rgba(15, 23, 42, 0.08);
}

:global(.milestone-status-menu-title) {
  color: #64748b;
}

:global(.milestone-status-menu-item) {
  background: transparent;
}
</style>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ChevronDown, ChevronUp, Download, Search, Trash2, X } from "lucide-vue-next";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import DateSelect from "@/components/ui/date-select/DateSelect.vue";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAlerts } from "@/composables/useAlerts";
import { useCurrentUser } from "@/composables/useCurrentUser";
import { normalizeProjectStatus } from "@/lib/projectStatus";
import {
  createClient,
  apiClient,
  createInvoiceTermsTemplate,
  createProject,
  createProjectMilestone,
  extractInvoiceTermsTemplatesList,
  extractMessage,
  extractInvoicePdfUrlFromResponseBody,
  extractMessageFromAxiosErrorData,
  fetchInvoicePdfBlobFromUrl,
  getClientById,
  getClients,
  getInvoiceTermsTemplates,
  getInvoicePdfWithRetry,
  getProjectById,
  interpretInvoicePdfBlob,
  getProjectScopes,
  getProjects,
  issueInvoice,
  patchInvoice,
  updateClient,
  type InvoiceTermsTemplateApi,
} from "@/lib/api";

type Props = {
  /** When set, open in project-invoice mode and load this project automatically. */
  prefillProjectId?: string | null;
  /** When set with a milestone project, pre-select this milestone as the invoice source. */
  prefillMilestoneId?: string | null;
};

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "issued", payload: { projectId: string | null; invoiceId: string }): void;
}>();

const { pushAlert } = useAlerts();
const { displayLabel, profile } = useCurrentUser();

type ProjectPick = {
  id: string;
  title: string;
  clientLine: string;
  paymentType: string;
  /** From API when present; used to filter projects after choosing a client. */
  clientId: string | null;
};

type SourceMode = "existing_client" | "new_client";

type InvoiceCategory = "project" | "custom";

const step = ref<1 | 2>(1);
/** Top-level: project-based invoice vs custom (line-item / one-off) invoice. */
const invoiceCategory = ref<InvoiceCategory>("custom");
const sourceMode = ref<SourceMode>("existing_client");
/** Custom + New Client: screen 1 = client intake only, then project / amounts. */
const newClientFormPhase = ref<1 | 2>(1);
const newClientKind = ref<"brand" | "individual">("brand");

/** Existing-client path: stable key (real client id or `name:${clientLine}`). */
const selectedClientKey = ref<string>("");

const projectsLoading = ref(false);
const projectRows = ref<ProjectPick[]>([]);
const selectedProjectId = ref<string | null>(null);
const projectDetail = ref<Record<string, unknown> | null>(null);
const loadingProject = ref(false);

const totalAmountDisplay = ref("");
const gstInclusive = ref(true);
const issueDateIso = ref("");
const dueDateIso = ref("");
const note = ref("");
const currencyCode = ref("PKR");

/** Recurring projects: multi-select draft invoices as amount sources (UI + summed total). */
const selectedSourceInvoiceIds = ref<string[]>([]);
const invoiceSourceGridExpanded = ref(false);
const INVOICE_GRID_COLLAPSED_COUNT = 9;

const draftInvoiceId = ref<string | null>(null);
/**
 * When the user selects multiple invoices (recurring) or multiple milestones (deliverables),
 * issue every resolved draft invoice id. `draftInvoiceId` remains for legacy single-invoice flows
 * and for PDF preview (we show the first issued invoice).
 */
const draftInvoiceIds = ref<string[]>([]);
const creatingDraft = ref(false);
const issuing = ref(false);

/** After successful issue: show PDF modal; emit `issued` + `close` only when the modal is dismissed. */
const issuedPdfModalOpen = ref(false);
const issuedPdfLoading = ref(false);
const issuedPdfObjectUrl = ref<string | null>(null);
const issuedPdfBlob = ref<Blob | null>(null);
const issuedPdfLoadError = ref<string | null>(null);
const pendingIssuedPayload = ref<{ projectId: string | null; invoiceId: string } | null>(null);
let issuedPdfFetchGeneration = 0;

function revokeIssuedPdfObjectUrl() {
  if (issuedPdfObjectUrl.value) {
    URL.revokeObjectURL(issuedPdfObjectUrl.value);
    issuedPdfObjectUrl.value = null;
  }
}

function onIssuedPdfDialogOpenChange(open: boolean) {
  if (!open) finishIssuedInvoiceFlow();
}

function finishIssuedInvoiceFlow() {
  issuedPdfFetchGeneration += 1;
  revokeIssuedPdfObjectUrl();
  issuedPdfBlob.value = null;
  issuedPdfLoadError.value = null;
  issuedPdfLoading.value = false;
  issuedPdfModalOpen.value = false;
  const p = pendingIssuedPayload.value;
  pendingIssuedPayload.value = null;
  if (p) {
    emit("issued", p);
    emit("close");
  }
}

function downloadIssuedPdf() {
  const blob = issuedPdfBlob.value;
  const id = pendingIssuedPayload.value?.invoiceId;
  if (!blob || !id) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `invoice-${String(id).replace(/[^\w.-]+/g, "_")}.pdf`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

async function fetchAndShowIssuedInvoicePdf(
  invoiceId: string,
  opts?: { hostedPdfUrl?: string | null },
) {
  const gen = ++issuedPdfFetchGeneration;
  issuedPdfModalOpen.value = true;
  issuedPdfLoading.value = true;
  issuedPdfLoadError.value = null;
  revokeIssuedPdfObjectUrl();
  issuedPdfBlob.value = null;
  try {
    let rawBlob: Blob | null = null;
    const hosted = opts?.hostedPdfUrl?.trim();
    if (hosted) {
      rawBlob = await fetchInvoicePdfBlobFromUrl(hosted);
    }
    if (!rawBlob || rawBlob.size === 0) {
      const res = await getInvoicePdfWithRetry(invoiceId);
      if (gen !== issuedPdfFetchGeneration) return;
      rawBlob = res.data as Blob;
    }
    if (gen !== issuedPdfFetchGeneration) return;
    let interpreted = await interpretInvoicePdfBlob(rawBlob);
    if (interpreted.kind === "error" && hosted) {
      try {
        const res = await getInvoicePdfWithRetry(invoiceId);
        if (gen !== issuedPdfFetchGeneration) return;
        interpreted = await interpretInvoicePdfBlob(res.data as Blob);
      } catch {
        /* keep hosted-path error message */
      }
    }
    if (gen !== issuedPdfFetchGeneration) return;
    if (interpreted.kind === "error") {
      issuedPdfLoadError.value = interpreted.message;
      return;
    }
    issuedPdfBlob.value = interpreted.blob;
    issuedPdfObjectUrl.value = URL.createObjectURL(interpreted.blob);
  } catch (e: unknown) {
    if (gen !== issuedPdfFetchGeneration) return;
    let msg = "Could not load the invoice PDF.";
    if (e && typeof e === "object" && "response" in e) {
      const data = (e as { response?: { data?: unknown } }).response?.data;
      msg = (await extractMessageFromAxiosErrorData(data)) || msg;
    }
    issuedPdfLoadError.value = String(msg);
  } finally {
    if (gen === issuedPdfFetchGeneration) issuedPdfLoading.value = false;
  }
}

/** Milestone projects: multi-select milestones as amount sources (UI + summed total). */
const selectedSourceMilestoneIds = ref<string[]>([]);
const milestoneGridExpanded = ref(false);
const milestoneDetailsOpen = ref(false);
const MILESTONE_GRID_COLLAPSED_COUNT = 4;

const termsLoading = ref(false);
const termsTemplates = ref<InvoiceTermsTemplateApi[]>([]);
const termsMode = ref<"existing" | "custom">("existing");
const selectedTermsTemplateId = ref("");
const termsText = ref("");
const customTermsTemplateName = ref("");
const createdTermsTemplateId = ref<string | null>(null);
const invoiceNotes = ref("");
const visualTemplate = ref<"classic" | "modern">("classic");

/** New-client path: manual recipient / job details (design: one-off invoice). */
const newClientName = ref("");
const newBrandName = ref("");
const newClientEmail = ref("");
const newClientAddress = ref("");
const newClientPhone = ref("");
/** Set after POST /api/v1/clients succeeds (Custom → New Client step 1). */
const createdNewClientId = ref<string | null>(null);
const creatingNewClient = ref(false);

/** Custom invoice: project + line items are created via POST /api/v1/projects (no existing project pick). */
type CustomLineItem = { id: number; description: string; amount: string };
type CustomPaymentKind = "single" | "deliverables";
const customProjectTitle = ref("");
const customPaymentKind = ref<CustomPaymentKind>("single");
let customLineItemSeq = 1;
const customLineItems = ref<CustomLineItem[]>([
  { id: customLineItemSeq++, description: "", amount: "" },
]);
const customExistingClientId = ref("");
type AddressBookClientOption = { id: string; label: string };
const addressBookClients = ref<AddressBookClientOption[]>([]);
const addressBookLoading = ref(false);
const projectScopeIdForCreate = ref("");
const creatingCustomProject = ref(false);

const isProjectInvoice = computed(() => invoiceCategory.value === "project");
const showClientSubtypeRow = computed(() => !isProjectInvoice.value);
const isCustomNewClientPhase1 = computed(
  () =>
    step.value === 1 &&
    invoiceCategory.value === "custom" &&
    sourceMode.value === "new_client" &&
    newClientFormPhase.value === 1,
);

const isCustomNewClientPhase2 = computed(
  () =>
    step.value === 1 &&
    invoiceCategory.value === "custom" &&
    sourceMode.value === "new_client" &&
    newClientFormPhase.value === 2,
);

/** Custom invoice, existing client (step 1): match product layout — panel, combobox, footer user. */
const isCustomExistingClientForm = computed(
  () =>
    step.value === 1 &&
    invoiceCategory.value === "custom" &&
    sourceMode.value === "existing_client",
);

const issuerOrgLine = computed(() => {
  const p = profile.value;
  if (!p) return "";
  return String(p.company_name || p.brand_name || "").trim();
});

const clientPickerOpen = ref(false);
const clientSearchText = ref("");
const clientComboRef = ref<HTMLElement | null>(null);

const filteredAddressBookClients = computed(() => {
  const q = clientSearchText.value.trim().toLowerCase();
  const list = addressBookClients.value;
  if (!q) return list;
  return list.filter((c) => c.label.toLowerCase().includes(q));
});

const lineItemDescPlaceholder = computed(() =>
  isCustomExistingClientForm.value ? "Input field" : "Description",
);

const taxSectionLabel = computed(() =>
  isCustomExistingClientForm.value ? "Taxes Handling" : "Tax Handling",
);

const notePlaceholder = computed(() =>
  isCustomExistingClientForm.value ? "Message here" : "Describe your project Details",
);

const projectTitleLabel = computed(() =>
  isCustomExistingClientForm.value ? "Project Title" : "Project title",
);

const projectTitleInputPlaceholder = computed(() =>
  isCustomExistingClientForm.value ? "Q1 2024 Design Services" : "e.g. Q1 2024 Design Services",
);

/** When a client id is selected, keep the visible input in sync with their label. */
function syncClientSearchFromSelection() {
  const id = customExistingClientId.value;
  if (!id) return;
  const row = addressBookClients.value.find((c) => c.id === id);
  if (row) clientSearchText.value = row.label;
}

function openClientPicker() {
  clientPickerOpen.value = true;
}

function toggleClientPicker() {
  clientPickerOpen.value = !clientPickerOpen.value;
}

function selectAddressBookClient(c: AddressBookClientOption) {
  customExistingClientId.value = c.id;
  clientSearchText.value = c.label;
  clientPickerOpen.value = false;
}

function onClientSearchInput() {
  clientPickerOpen.value = true;
  if (!clientSearchText.value.trim()) {
    customExistingClientId.value = "";
    return;
  }
  const row = addressBookClients.value.find((x) => x.id === customExistingClientId.value);
  if (row && clientSearchText.value !== row.label) {
    customExistingClientId.value = "";
  }
}

function onDocumentPointerDown(ev: MouseEvent | TouchEvent) {
  const root = clientComboRef.value;
  const t = ev.target;
  if (!root || !(t instanceof Node)) return;
  if (root.contains(t)) return;
  clientPickerOpen.value = false;
  syncClientSearchFromSelection();
}

watch([addressBookClients, customExistingClientId], () => syncClientSearchFromSelection());

watch(isCustomExistingClientForm, (on) => {
  if (!on) clientPickerOpen.value = false;
});

/** One-line recap on phase 2 (invoice amounts step). */
const newClientBillToLine = computed(() => {
  if (newClientKind.value === "brand") {
    const brand = newBrandName.value.trim();
    const contact = newClientName.value.trim();
    if (brand && contact) return `${brand} · ${contact}`;
    return brand || contact || "New client";
  }
  const n = newClientName.value.trim();
  const co = newBrandName.value.trim();
  if (n && co) return `${n} · ${co}`;
  return n || co || "New client";
});

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

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

function normalizePaymentLabel(raw: unknown): string {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "single") return "Single Payment";
  if (value === "multiple") return "Multiple Payment";
  if (value === "recurring") return "Recurring Payment";
  if (value === "milestone") return "Milestone";
  return String(raw ?? "Payment").trim() || "Payment";
}

function extractProjectsList(raw: unknown): ProjectPick[] {
  const list = Array.isArray((raw as any)?.data)
    ? (raw as any).data
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];
  return list
    .filter((item: any) => normalizeProjectStatus(item?.status) !== "draft")
    .map((item: any) => {
    const primaryClient = (Array.isArray(item?.clients) ? item.clients[0] : undefined) ?? item?.client ?? null;
    const clientName = primaryClient
      ? String(
          primaryClient.display_name ??
            primaryClient.brand_name ??
            primaryClient.poc_name ??
            primaryClient.name ??
            "",
        ).trim()
      : "";
    const clientId = primaryClient
      ? String(
          (primaryClient as Record<string, unknown>).id ??
            (primaryClient as Record<string, unknown>).uuid ??
            "",
        ).trim() || null
      : null;
    return {
      id: String(item?.id ?? item?.uuid ?? "").trim(),
      title: String(item?.title ?? item?.name ?? "Untitled").trim(),
      clientLine: clientName || "—",
      paymentType: normalizePaymentLabel(item?.payment_structure ?? item?.type ?? item?.payment_type),
      clientId,
    };
  });
}

function clientKeyForProject(p: ProjectPick): string {
  if (p.clientId) return p.clientId;
  return `name:${p.clientLine}`;
}

const projectRowsForSelect = computed(() => {
  if (isProjectInvoice.value) return projectRows.value;
  if (sourceMode.value !== "existing_client") return projectRows.value;
  const key = selectedClientKey.value.trim();
  if (!key) return [];
  return projectRows.value.filter((p) => clientKeyForProject(p) === key);
});

function readProjectTaxInclusive(p: Record<string, unknown>): boolean | null {
  const raw = p.gst_inclusive ?? p.is_gst_inclusive ?? p.tax_inclusive;
  if (raw == null || raw === "") return null;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw === 1;
  const s = String(raw).trim().toLowerCase();
  if (s === "yes" || s === "true" || s === "1" || s === "inclusive") return true;
  if (s === "no" || s === "false" || s === "0" || s === "exclusive") return false;
  return null;
}

function formatAmountInput(n: number): string {
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("en-PK");
}

function parseAmountInput(s: string): number {
  const n = Number(String(s).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
}

/** Strip non-numeric input; keeps digits, thousands commas, and at most one decimal point. */
function sanitizeAmountInputValue(raw: string): string {
  let out = "";
  let seenDot = false;
  for (const c of raw) {
    if (c >= "0" && c <= "9") out += c;
    else if (c === ",") out += c;
    else if (c === "." && !seenDot) {
      out += c;
      seenDot = true;
    }
  }
  return out;
}

function onTotalAmountDisplayInput(v: string | number) {
  totalAmountDisplay.value = sanitizeAmountInputValue(String(v ?? ""));
}

function onLineItemAmountInput(rowId: number, v: string | number) {
  const sanitized = sanitizeAmountInputValue(String(v ?? ""));
  const row = customLineItems.value.find((r) => r.id === rowId);
  if (row) row.amount = sanitized;
}

function normalizedAmountString(s: string): string {
  const n = parseAmountInput(s);
  return Number.isFinite(n) ? String(n) : "0";
}

function resetCustomInvoiceFields() {
  customProjectTitle.value = "";
  customPaymentKind.value = "single";
  customLineItemSeq = 1;
  customLineItems.value = [{ id: customLineItemSeq++, description: "", amount: "" }];
  customExistingClientId.value = "";
  projectScopeIdForCreate.value = "";
}

function extractClientsArray(raw: unknown): Record<string, unknown>[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.data)) return r.data as Record<string, unknown>[];
  const inner = r.data as Record<string, unknown> | undefined;
  if (inner && Array.isArray(inner.data)) return inner.data as Record<string, unknown>[];
  return [];
}

function clientLabelFromRecord(row: Record<string, unknown>): string {
  const typeValue = String(row.type ?? "").trim().toLowerCase();
  const brand = String(row.brand_name ?? "").trim();
  const ind = String(row.display_name ?? row.name ?? "").trim();
  if (typeValue === "individual") return ind || brand || "Client";
  return brand || ind || "Client";
}

type ProjectScopeRow = { id: string; name: string; slug: string };

function normalizeProjectScopesFromResponse(raw: unknown): ProjectScopeRow[] {
  const r = raw as { data?: unknown } | unknown[] | null | undefined;
  const list = Array.isArray(r) ? r : Array.isArray(r?.data) ? (r.data as unknown[]) : [];
  return list
    .map((item: unknown) => {
      const o = item as Record<string, unknown>;
      const id = String(o?.id ?? o?.uuid ?? "").trim();
      const name = String(o?.name ?? o?.title ?? "").trim();
      const slug = String(o?.slug ?? "").trim();
      return { id, name, slug };
    })
    .filter((x) => x.id);
}

/** Custom invoice: use the "Signed" scope when the API exposes it (name/slug), else first scope. */
function pickSignedProjectScopeId(options: ProjectScopeRow[]): string {
  if (!options.length) return "";
  const match = options.find((o) => {
    const name = o.name.toLowerCase();
    const slug = o.slug.toLowerCase();
    return (
      name === "signed" ||
      slug === "signed" ||
      name.includes("signed") ||
      slug.includes("signed")
    );
  });
  return (match ?? options[0]).id;
}

async function loadAddressBookClients() {
  addressBookLoading.value = true;
  try {
    const res = await getClients();
    const list = extractClientsArray(res?.data);
    addressBookClients.value = list
      .map((c) => {
        const id = String(c.id ?? c.uuid ?? "").trim();
        return { id, label: clientLabelFromRecord(c) };
      })
      .filter((x) => x.id);
  } catch {
    addressBookClients.value = [];
  } finally {
    addressBookLoading.value = false;
  }
}

async function ensureProjectScopeForCreate() {
  if (projectScopeIdForCreate.value.trim()) return;
  try {
    const res = await getProjectScopes();
    const options = normalizeProjectScopesFromResponse(res?.data);
    projectScopeIdForCreate.value = pickSignedProjectScopeId(options);
  } catch {
    projectScopeIdForCreate.value = "";
  }
}

function sumCustomLineAmountsNumeric(): number {
  let sum = 0;
  for (const row of customLineItems.value) {
    const n = parseAmountInput(row.amount);
    if (Number.isFinite(n) && n > 0) sum += n;
  }
  return sum;
}

function syncCustomLineItemsToTotalDisplay() {
  if (invoiceCategory.value !== "custom" || step.value !== 1) return;
  const sum = sumCustomLineAmountsNumeric();
  totalAmountDisplay.value = sum > 0 ? formatAmountInput(sum) : "";
}

function addCustomLineItem() {
  if (customPaymentKind.value !== "deliverables") return;
  customLineItems.value = [
    ...customLineItems.value,
    { id: customLineItemSeq++, description: "", amount: "" },
  ];
}

function removeCustomLineItem(id: number) {
  if (customPaymentKind.value !== "deliverables") return;
  if (customLineItems.value.length <= 1) return;
  customLineItems.value = customLineItems.value.filter((r) => r.id !== id);
  syncCustomLineItemsToTotalDisplay();
}

function buildCustomProjectDescription(): string {
  const noteT = note.value.trim();
  if (noteT) return noteT;
  const parts = customLineItems.value.map((r) => r.description.trim()).filter(Boolean);
  return parts.length ? parts.join("\n") : customProjectTitle.value.trim();
}

function extractCreatedProjectIdFromResponse(body: unknown): string {
  const p = unwrapProjectPayload(body);
  if (!p) return "";
  return String(p.id ?? p.uuid ?? "").trim();
}

async function appendClientNestedFieldsForProjectCreate(form: FormData, clientId: string) {
  form.append("client[is_primary]", "1");
  form.append("client[id]", clientId.trim());
  let c: Record<string, unknown> | null = null;
  try {
    const res = await getClientById(clientId);
    c = unwrapProjectPayload(res?.data);
  } catch {
    c = null;
  }
  if (!c) {
    form.append("client[type]", "brand");
    form.append("client[status]", "active");
    form.append("client[role]", "Contact");
    form.append("client[brand_name]", "");
    form.append("client[poc_name]", "");
    form.append("client[poc_email]", "");
    form.append("client[poc_phone]", "");
    return;
  }
  const typeVal = String(c.type ?? "brand").trim().toLowerCase() === "individual" ? "individual" : "brand";
  form.append("client[type]", typeVal);
  form.append("client[status]", String(c.status ?? "active"));
  form.append("client[role]", String(c.role ?? "Contact"));
  form.append("client[brand_name]", String(c.brand_name ?? c.display_name ?? "").trim());
  form.append("client[poc_name]", String(c.poc_name ?? "").trim());
  form.append("client[poc_email]", String(c.poc_email ?? c.email ?? "").trim());
  form.append("client[poc_phone]", String(c.poc_phone ?? c.phone ?? "").trim());
}

async function buildCustomProjectFormData(options: {
  apiType: "single" | "milestone";
  amountNumeric: number;
}): Promise<FormData> {
  const form = new FormData();
  const amountStr = Number.isFinite(options.amountNumeric) ? String(options.amountNumeric) : "0";
  const scopeId = projectScopeIdForCreate.value.trim();
  if (!scopeId) {
    throw new Error("Missing project scope. Configure project scopes in the app, then try again.");
  }
  const clientId =
    sourceMode.value === "new_client"
      ? String(createdNewClientId.value ?? "").trim()
      : customExistingClientId.value.trim();
  if (!clientId) throw new Error("Missing client id.");

  form.append("title", customProjectTitle.value.trim());
  form.append("description", buildCustomProjectDescription());
  /** Signed so the server exposes a draft invoice that can be issued on the next wizard step. */
  form.append("status", normalizeProjectStatus("signed"));
  form.append("type", options.apiType);
  form.append("amount", amountStr);
  form.append("gst_inclusive", gstInclusive.value ? "1" : "0");
  form.append("financing_applied", "0");
  form.append("payment_schedule", "before_start");
  form.append("payment_schedule_date", "");
  form.append("currency", currencyCode.value.trim() || "PKR");
  form.append("project_scope_id", scopeId);
  form.append("start_date", issueDateIso.value.trim() || todayIso());
  form.append("end_date", dueDateIso.value.trim() || issueDateIso.value.trim() || todayIso());
  form.append("meta[notes]", note.value.trim());

  await appendClientNestedFieldsForProjectCreate(form, clientId);
  return form;
}

async function createMilestonesForCustomDeliverables(projectId: string, totalAmount: number) {
  const rows = customLineItems.value.filter((r) => {
    const n = parseAmountInput(r.amount);
    return Number.isFinite(n) && n > 0;
  });
  for (const [index, row] of rows.entries()) {
    const rowAmt = parseAmountInput(row.amount);
    const pct =
      totalAmount > 0 && Number.isFinite(rowAmt) ? Math.round((rowAmt / totalAmount) * 10000) / 100 : 0;
    const title = row.description.trim() || `Item ${index + 1}`;
    await createProjectMilestone(projectId, {
      title,
      deliverables: row.description.trim(),
      due_on: dueDateIso.value.trim() || issueDateIso.value.trim() || "",
      amount: normalizedAmountString(row.amount),
      percentage: pct,
      sequence: index + 1,
      status: "approved",
    });
  }
}

async function loadFreshProjectForCustomInvoice(projectId: string) {
  loadingProject.value = true;
  try {
    const res = await getProjectById(projectId);
    const p = unwrapProjectPayload(res?.data);
    projectDetail.value = p;
    selectedProjectId.value = projectId;
    selectedSourceInvoiceIds.value = [];
    invoiceSourceGridExpanded.value = false;
  } catch {
    projectDetail.value = null;
    selectedProjectId.value = null;
  } finally {
    loadingProject.value = false;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sync milestone ids from GET project so `pickDraftInvoiceIdForMilestoneSelection` can match invoices. */
function syncMilestoneIdsFromPayloadForCustomWizard(p: Record<string, unknown>) {
  if (!customDeliverablesBootstrap.value) return;
  const raw = toArray((p as any).milestones ?? (p as any).project_milestones);
  const ids: string[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    const o = m as Record<string, unknown>;
    const id = String(o.id ?? o.uuid ?? "").trim();
    if (!id) continue;
    const rowAmt = Number(String(o.amount ?? o.total_amount ?? "").replace(/,/g, ""));
    if (Number.isFinite(rowAmt) && rowAmt > 0) ids.push(id);
  }
  if (ids.length) selectedSourceMilestoneIds.value = ids;
}

/**
 * After creating a project, some backends attach/create draft invoice(s) asynchronously.
 * Milestone/deliverables projects may only expose per-milestone invoices (no single `draft_invoice_id`).
 */
async function loadFreshProjectAndWaitForDraftInvoice(
  projectId: string,
  options?: { milestoneDeliverablesMode?: boolean },
): Promise<string | null> {
  const milestoneMode = Boolean(options?.milestoneDeliverablesMode);
  const maxAttempts = milestoneMode ? 40 : 18;
  const baseDelayMs = milestoneMode ? 400 : 350;
  const maxDelayMs = milestoneMode ? 2000 : 1600;

  loadingProject.value = true;
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await getProjectById(projectId);
        const p = unwrapProjectPayload(res?.data);
        projectDetail.value = p;
        selectedProjectId.value = projectId;
        selectedSourceInvoiceIds.value = [];
        invoiceSourceGridExpanded.value = false;

        if (milestoneMode && p) syncMilestoneIdsFromPayloadForCustomWizard(p);

        const fromMilestones = milestoneMode ? pickDraftInvoiceIdForMilestoneSelection(p) : null;
        const draftId = fromMilestones ?? pickDraftInvoiceIdFromProject(p);
        if (draftId) return draftId;
      } catch {
        // transient; retry
      }
      if (attempt < maxAttempts) {
        const backoff = Math.min(maxDelayMs, Math.round(baseDelayMs * Math.pow(1.32, attempt - 1)));
        await sleep(backoff);
      }
    }
    return null;
  } finally {
    loadingProject.value = false;
  }
}

const gstRatePercent = computed(() => {
  const p = projectDetail.value;
  if (!p) return 10;
  const raw = p.gst_rate ?? p.tax_rate;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 10;
});

/** When total is GST-inclusive, estimated tax portion: total * r / (100 + r) */
const estimatedGstAmount = computed(() => {
  const total = parseAmountInput(totalAmountDisplay.value);
  if (!gstInclusive.value || !Number.isFinite(total) || total <= 0) return null;
  const r = gstRatePercent.value;
  const tax = (total * r) / (100 + r);
  return Math.round(tax * 100) / 100;
});

const primaryClient = computed(() => {
  const p = projectDetail.value;
  if (!p) return null;
  const fromList = Array.isArray(p.clients) ? p.clients[0] : undefined;
  return fromList ?? p.client ?? null;
});

function resolveIssueCustomer(): { name: string | null; email: string | null } {
  if (sourceMode.value === "new_client") {
    const email = newClientEmail.value.trim();
    if (newClientKind.value === "brand") {
      const brand = newBrandName.value.trim();
      const contact = newClientName.value.trim();
      const name = brand || contact || null;
      return { name, email: email || null };
    }
    const name = newClientName.value.trim() || null;
    return { name, email: email || null };
  }
  const c = primaryClient.value as Record<string, unknown> | null;
  if (!c) return { name: null, email: null };
  const nameCandidates = [
    c.brand_name,
    c.display_name,
    c.poc_name,
    c.name,
    c.full_name,
  ];
  const emailCandidates = [c.poc_email, c.email, c.contact_email];
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

function decodeTermsBody(body: string) {
  return String(body ?? "").replace(/\\n/g, "\n");
}

function extractInvoicesFromProject(p: Record<string, unknown> | null): unknown[] {
  if (!p) return [];
  const raw =
    p.invoices ??
    p.invoice_list ??
    p.project_invoices ??
    p.invoice ??
    (p.billing && typeof p.billing === "object" && !Array.isArray(p.billing)
      ? (p.billing as Record<string, unknown>).invoices
      : undefined) ??
    [];
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    // Common API shapes:
    // - { ...invoice }
    // - { data: { ...invoice } }
    // - { data: [ ...invoices ] }
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data;
    if (o.data && typeof o.data === "object" && !Array.isArray(o.data)) return [o.data];
    return [o];
  }
  return [];
}

function normalizeInvoiceStatusForPick(raw: unknown): string {
  let s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!s) return "not_issued";
  if (["in_review", "under_review", "review"].includes(s)) return "in_review";
  return s;
}

/** Invoice has left the draft / pre-issue stage; Create Invoice must not call issue for these. */
function isInvoiceStatusAlreadyIssuedOrFinal(statusKey: string): boolean {
  return [
    "issued",
    "sent",
    "unpaid",
    "approved",
    "accepted",
    "confirmed",
    "paid",
    "settled",
    "delayed",
    "overdue",
    "past_due",
    "rejected",
    "cancelled",
    "canceled",
    "void",
    "declined",
  ].includes(statusKey);
}

/**
 * When Create Invoice is opened from project details, match the project screen: only `in_review`
 * invoices may be issued. Standalone Create Invoice (dashboard menu) may still issue from draft.
 */
function createInvoiceIssuanceRequiresPriorReview(): boolean {
  return Boolean(String(props.prefillProjectId ?? "").trim());
}

/** Rows eligible for POST /invoices/:id/issue from this wizard (depends on entry path). */
function isIssuableInvoiceStatusKey(statusKey: string): boolean {
  if (isInvoiceStatusAlreadyIssuedOrFinal(statusKey)) return false;
  if (createInvoiceIssuanceRequiresPriorReview()) return statusKey === "in_review";
  return ["draft", "not_issued", "notissued", "pending", "in_review"].includes(statusKey);
}

function findInvoiceObjectInProject(
  p: Record<string, unknown> | null,
  invoiceId: string,
): Record<string, unknown> | null {
  const list = extractInvoicesFromProject(p);
  for (const inv of list) {
    if (!inv || typeof inv !== "object" || Array.isArray(inv)) continue;
    const o = inv as Record<string, unknown>;
    const id = String(o.id ?? o.uuid ?? "").trim();
    if (id === invoiceId) return o;
  }
  return null;
}

function isRecurringProjectPayload(p: Record<string, unknown> | null): boolean {
  if (!p) return false;
  const ps = String(p.payment_structure ?? p.payment_type ?? p.type ?? "")
    .trim()
    .toLowerCase();
  return ps === "recurring";
}

function isMilestoneProjectPayload(p: Record<string, unknown> | null): boolean {
  if (!p) return false;
  const ps = String(p.payment_structure ?? p.payment_type ?? p.type ?? "")
    .trim()
    .toLowerCase();
  return ps === "milestone";
}

type InvoiceSourceCard = {
  id: string;
  numberLabel: string;
  statusLabel: string;
  statusKey: string;
  amountDisplay: string;
  dueShort: string;
  selectable: boolean;
  amountNumeric: number;
};

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

function formatDueShort(raw: string | undefined): string {
  if (!raw || !String(raw).trim()) return "—";
  const d = new Date(String(raw));
  if (!Number.isFinite(d.getTime())) return "—";
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${String(d.getFullYear()).slice(-2)}`;
}

function invoiceCardStatusLabel(statusKey: string): string {
  if (["draft", "not_issued", "notissued", "pending"].includes(statusKey)) return "Draft";
  if (statusKey === "in_review") return "In Review";
  return statusKey
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const isRecurringProject = computed(() => isRecurringProjectPayload(projectDetail.value));
const isMilestoneProject = computed(() => isMilestoneProjectPayload(projectDetail.value));

const invoiceSourceCardsAll = computed((): InvoiceSourceCard[] => {
  const p = projectDetail.value;
  const list = extractInvoicesFromProject(p);
  return list
    .map((inv, index) => {
      if (!inv || typeof inv !== "object" || Array.isArray(inv)) return null;
      const o = inv as Record<string, unknown>;
      const id = String(o.id ?? o.uuid ?? "").trim();
      if (!id) return null;
      const rawNum = pickInvoiceDisplayNumber(o, index);
      const numberLabel = rawNum.startsWith("#") ? rawNum : `#${rawNum}`;
      const statusKey = normalizeInvoiceStatusForPick(o.status ?? o.state ?? o.invoice_status);
      const selectable = isIssuableInvoiceStatusKey(statusKey);
      const subtotalN = Number(String(o.amount_subtotal ?? o.subtotal ?? "").replace(/,/g, ""));
      const totalN = Number(String(o.amount_total ?? o.total ?? o.total_amount ?? o.amount ?? "").replace(/,/g, ""));
      const amountNumeric = Number.isFinite(subtotalN) && subtotalN > 0 ? subtotalN : Number.isFinite(totalN) ? totalN : 0;
      const amountDisplay =
        amountNumeric > 0 ? amountNumeric.toLocaleString("en-PK") : "—";
      const dueRaw = String(o.due_date ?? o.dueDate ?? o.due_on ?? "").trim();
      return {
        id,
        numberLabel,
        statusLabel: invoiceCardStatusLabel(statusKey),
        statusKey,
        amountDisplay,
        dueShort: formatDueShort(dueRaw || undefined),
        selectable,
        amountNumeric,
      };
    })
    .filter(Boolean) as InvoiceSourceCard[];
});

/** Recurring UI: selectable rows follow `isIssuableInvoiceStatusKey` (draft vs in review depends on entry path). */
const invoiceSourceCards = computed(() => invoiceSourceCardsAll.value.filter((c) => c.selectable));

const visibleInvoiceSourceCards = computed(() => {
  const rows = invoiceSourceCards.value;
  if (invoiceSourceGridExpanded.value || rows.length <= INVOICE_GRID_COLLAPSED_COUNT) return rows;
  return rows.slice(0, INVOICE_GRID_COLLAPSED_COUNT);
});

const invoiceSourceToggleLabel = computed(() =>
  invoiceSourceGridExpanded.value ? "Show Less" : "Show More",
);

const selectedSourceCount = computed(() => selectedSourceInvoiceIds.value.length);

function isSourceInvoiceSelected(id: string): boolean {
  return selectedSourceInvoiceIds.value.includes(id);
}

function toggleSourceInvoice(card: InvoiceSourceCard) {
  if (!card.selectable) return;
  const ids = [...selectedSourceInvoiceIds.value];
  const i = ids.indexOf(card.id);
  if (i >= 0) ids.splice(i, 1);
  else ids.push(card.id);
  selectedSourceInvoiceIds.value = ids;
  applySelectionToTotal();
}

function applySelectionToTotal() {
  if (!isRecurringProject.value) return;
  const cards = invoiceSourceCards.value;
  const set = new Set(selectedSourceInvoiceIds.value);
  let sum = 0;
  for (const c of cards) {
    if (set.has(c.id) && c.amountNumeric > 0) sum += c.amountNumeric;
  }
  if (sum > 0) totalAmountDisplay.value = formatAmountInput(sum);
  else if (cards.length > 0) totalAmountDisplay.value = "";
}

type MilestoneSourceCard = {
  id: string;
  sequence: number;
  title: string;
  dueLabel: string;
  amountDisplay: string;
  amountNumeric: number;
  deliverables: string;
  /** Only client-approved milestones can be invoiced. */
  selectable: boolean;
};

function toArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function normalizeMilestoneClientReviewStatus(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
}

/** True when the client has approved this milestone (server `status` on PATCH /milestones/:id/status). */
function isMilestoneClientApprovedForInvoice(o: Record<string, unknown>): boolean {
  const s = normalizeMilestoneClientReviewStatus(o.status ?? o.state ?? o.milestone_status);
  if (s === "approved") return true;
  const client = o.client;
  if (client && typeof client === "object" && !Array.isArray(client)) {
    const cs = normalizeMilestoneClientReviewStatus((client as Record<string, unknown>).status);
    if (cs === "approved") return true;
  }
  return false;
}

/**
 * Custom invoice → Deliverables: milestones are created in `approved` and per-milestone draft invoices
 * appear shortly after. While `customDeliverablesBootstrap` is on, treat those as selectable for this wizard only.
 */
const customDeliverablesBootstrap = ref(false);

function isMilestoneInReviewBillableForCustomWizard(o: Record<string, unknown>): boolean {
  const s = normalizeMilestoneClientReviewStatus(o.status ?? o.state ?? o.milestone_status);
  if (!["in_review", "pending", "draft", "not_issued"].includes(s)) return false;
  const amt = Number(String(o.amount ?? o.total_amount ?? "").replace(/,/g, ""));
  return Number.isFinite(amt) && amt > 0;
}

function formatMilestoneMonthYear(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

const milestoneSourceCards = computed<MilestoneSourceCard[]>(() => {
  const p = projectDetail.value;
  if (!p) return [];
  const raw = toArray((p as any).milestones ?? (p as any).project_milestones);
  return raw
    .map((m, index) => {
      if (!m || typeof m !== "object" || Array.isArray(m)) return null;
      const o = m as Record<string, unknown>;
      const id = String(o.id ?? o.uuid ?? "").trim() || `milestone-${index}`;
      const seqRaw = Number(o.sequence ?? o.order ?? index + 1);
      const sequence = Number.isFinite(seqRaw) && seqRaw > 0 ? Math.trunc(seqRaw) : index + 1;
      const title = String(o.title ?? "").trim() || `Milestone ${sequence}`;
      const dueLabel = formatMilestoneMonthYear(o.due_on ?? o.due_date ?? o.dueDate);
      const deliverables = String(o.deliverables ?? o.description ?? "").trim();
      const amt = Number(String(o.amount ?? o.total_amount ?? "").replace(/,/g, ""));
      const amountNumeric = Number.isFinite(amt) ? amt : 0;
      const amountDisplay = amountNumeric > 0 ? amountNumeric.toLocaleString("en-PK") : "—";
      const selectable =
        isMilestoneClientApprovedForInvoice(o) ||
        (customDeliverablesBootstrap.value && isMilestoneInReviewBillableForCustomWizard(o));
      return { id, sequence, title, dueLabel, amountDisplay, amountNumeric, deliverables, selectable };
    })
    .filter(Boolean) as MilestoneSourceCard[];
});

const approvedMilestoneSourceCount = computed(() => milestoneSourceCards.value.filter((c) => c.selectable).length);

const visibleMilestoneSourceCards = computed(() => {
  const rows = milestoneSourceCards.value;
  if (milestoneGridExpanded.value || rows.length <= MILESTONE_GRID_COLLAPSED_COUNT) return rows;
  return rows.slice(0, MILESTONE_GRID_COLLAPSED_COUNT);
});

const milestoneSourceToggleLabel = computed(() =>
  milestoneGridExpanded.value ? "Show Less" : "View All Milestones",
);

const selectedMilestoneSourceCount = computed(() => selectedSourceMilestoneIds.value.length);

function isSourceMilestoneSelected(id: string): boolean {
  return selectedSourceMilestoneIds.value.includes(id);
}

function toggleSourceMilestone(card: MilestoneSourceCard) {
  if (!card.selectable) return;
  const ids = [...selectedSourceMilestoneIds.value];
  const i = ids.indexOf(card.id);
  if (i >= 0) ids.splice(i, 1);
  else ids.push(card.id);
  selectedSourceMilestoneIds.value = ids;
  applyMilestoneSelectionToTotal();
}

function applyMilestoneSelectionToTotal() {
  if (!isMilestoneProject.value) return;
  const cards = milestoneSourceCards.value;
  const set = new Set(selectedSourceMilestoneIds.value);
  let sum = 0;
  for (const c of cards) {
    if (c.selectable && set.has(c.id) && c.amountNumeric > 0) sum += c.amountNumeric;
  }
  if (sum > 0) totalAmountDisplay.value = formatAmountInput(sum);
  else if (cards.length > 0) totalAmountDisplay.value = "";
}

function defaultApprovedMilestoneSelectionId(): string | null {
  const first = milestoneSourceCards.value
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .find((c) => c.selectable && c.amountNumeric > 0);
  return first?.id ?? null;
}

watch(milestoneSourceCards, (cards) => {
  if (!isMilestoneProject.value) return;
  const allowed = new Set(cards.filter((c) => c.selectable).map((c) => c.id));
  const next = selectedSourceMilestoneIds.value.filter((id) => allowed.has(id));
  if (next.length !== selectedSourceMilestoneIds.value.length) {
    selectedSourceMilestoneIds.value = next;
    applyMilestoneSelectionToTotal();
  }
});

/** Draft / not-yet-issued invoice id from loaded project payload (GET project). */
function pickDraftInvoiceIdFromProject(p: Record<string, unknown> | null): string | null {
  if (!p) return null;

  const requireReview = createInvoiceIssuanceRequiresPriorReview();

  // Some APIs expose the draft invoice as a single field instead of embedding it in `invoices`.
  const directIdCandidates = [
    (p as any).draft_invoice_id,
    (p as any).draftInvoiceId,
    (p as any).draft_invoice?.id,
    (p as any).draft_invoice?.uuid,
    (p as any).invoice_draft_id,
    (p as any).current_invoice_id,
  ]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean);

  const list = extractInvoicesFromProject(p);

  if (requireReview && directIdCandidates.length > 0) {
    for (const directId of directIdCandidates) {
      for (const inv of list) {
        if (!inv || typeof inv !== "object" || Array.isArray(inv)) continue;
        const o = inv as Record<string, unknown>;
        const id = String(o.id ?? o.uuid ?? "").trim();
        if (!id || id !== directId) continue;
        const status = normalizeInvoiceStatusForPick(o.status ?? o.state ?? o.invoice_status);
        if (isIssuableInvoiceStatusKey(status)) return id;
      }
    }
  } else if (!requireReview && directIdCandidates.length > 0) {
    return directIdCandidates[0] ?? null;
  }

  for (const inv of list) {
    if (!inv || typeof inv !== "object" || Array.isArray(inv)) continue;
    const o = inv as Record<string, unknown>;
    const id = String(o.id ?? o.uuid ?? "").trim();
    if (!id) continue;
    const status = normalizeInvoiceStatusForPick(o.status ?? o.state ?? o.invoice_status);
    if (isIssuableInvoiceStatusKey(status)) return id;
  }

  if (!requireReview && directIdCandidates.length > 0) return directIdCandidates[0] ?? null;
  return null;
}

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

/** Prefer a draft invoice tied to a selected milestone when the API provides the link. */
function pickDraftInvoiceIdForMilestoneSelection(p: Record<string, unknown> | null): string | null {
  if (!p || !selectedSourceMilestoneIds.value.length) return null;
  const list = extractInvoicesFromProject(p);
  for (const milestoneId of selectedSourceMilestoneIds.value) {
    for (const inv of list) {
      if (!inv || typeof inv !== "object" || Array.isArray(inv)) continue;
      const o = inv as Record<string, unknown>;
      const id = String(o.id ?? o.uuid ?? "").trim();
      if (!id) continue;
      if (!invoiceBelongsToMilestone(o, milestoneId)) continue;
      const status = normalizeInvoiceStatusForPick(o.status ?? o.state ?? o.invoice_status);
      if (isIssuableInvoiceStatusKey(status)) return id;
    }
  }
  return null;
}

function resolveDraftInvoiceIdsForContinue(): string[] {
  // Recurring: user is selecting invoice rows directly; issue every selected, allowed invoice id.
  if (isRecurringProject.value && selectedSourceInvoiceIds.value.length > 0) {
    const allowed = new Set(invoiceSourceCards.value.map((c) => c.id));
    return selectedSourceInvoiceIds.value.filter((id) => allowed.has(id));
  }

  // Milestone/deliverables: user selects milestones; resolve draft invoice id per selected milestone.
  if (isMilestoneProject.value && selectedSourceMilestoneIds.value.length > 0) {
    const p = projectDetail.value;
    if (!p) return [];
    const list = extractInvoicesFromProject(p);
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const milestoneId of selectedSourceMilestoneIds.value) {
      for (const inv of list) {
        if (!inv || typeof inv !== "object" || Array.isArray(inv)) continue;
        const o = inv as Record<string, unknown>;
        const id = String(o.id ?? o.uuid ?? "").trim();
        if (!id || seen.has(id)) continue;
        if (!invoiceBelongsToMilestone(o, milestoneId)) continue;
        const status = normalizeInvoiceStatusForPick(o.status ?? o.state ?? o.invoice_status);
        if (!isIssuableInvoiceStatusKey(status)) continue;
        seen.add(id);
        ids.push(id);
        break;
      }
    }
    return ids;
  }

  const single = pickDraftInvoiceIdFromProject(projectDetail.value);
  return single ? [single] : [];
}

async function loadProjectList() {
  projectsLoading.value = true;
  try {
    const res = await getProjects();
    projectRows.value = extractProjectsList(res?.data).filter((p) => p.id);
  } catch {
    projectRows.value = [];
  } finally {
    projectsLoading.value = false;
  }
}

async function onSelectProject(row: ProjectPick) {
  customDeliverablesBootstrap.value = false;
  selectedProjectId.value = row.id;
  const fillFromProject = isProjectInvoice.value || sourceMode.value === "existing_client";

  loadingProject.value = true;
  try {
    const res = await getProjectById(row.id);
    const p = unwrapProjectPayload(res?.data);
    projectDetail.value = p;
    if (!p) return;

    if (!isRecurringProjectPayload(p)) {
      selectedSourceInvoiceIds.value = [];
      invoiceSourceGridExpanded.value = false;
    }
    if (!isMilestoneProjectPayload(p)) {
      selectedSourceMilestoneIds.value = [];
      milestoneGridExpanded.value = false;
      milestoneDetailsOpen.value = false;
    }

    if (!fillFromProject) {
      if (isRecurringProjectPayload(p)) {
        selectedSourceInvoiceIds.value = invoiceSourceCards.value.map((c) => c.id);
        invoiceSourceGridExpanded.value = false;
      }
      if (isMilestoneProjectPayload(p)) {
        const def = defaultApprovedMilestoneSelectionId();
        selectedSourceMilestoneIds.value = def ? [def] : [];
        milestoneGridExpanded.value = false;
        milestoneDetailsOpen.value = false;
      }
      // Custom mode: keep amounts/dates/notes the user entered; still load project for client (issue/send).
      return;
    }

    const amount = Number(p.amount ?? p.total_amount ?? p.totalAmount ?? 0);
    if (Number.isFinite(amount) && amount > 0) {
      totalAmountDisplay.value = formatAmountInput(amount);
    }

    const cur = String(p.currency ?? p.currency_code ?? "PKR").trim();
    currencyCode.value = cur || "PKR";

    const ti = readProjectTaxInclusive(p);
    if (ti != null) gstInclusive.value = ti;

    const startRaw = p.start_date ?? p.started_at ?? p.created_at;
    const endRaw = p.end_date ?? p.due_date;
    if (startRaw) {
      const d = new Date(String(startRaw));
      if (Number.isFinite(d.getTime())) {
        issueDateIso.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      }
    } else {
      issueDateIso.value = todayIso();
    }
    if (endRaw) {
      const d = new Date(String(endRaw));
      if (Number.isFinite(d.getTime())) {
        dueDateIso.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      }
    } else {
      dueDateIso.value = "";
    }

    const scope =
      p.scope_description ??
      p.description ??
      p.scope ??
      (p.project_scope && typeof p.project_scope === "object" && !Array.isArray(p.project_scope)
        ? (p.project_scope as any).description ?? (p.project_scope as any).name
        : "");
    note.value = scope != null && String(scope).trim() ? String(scope).trim() : "";

    if (isRecurringProjectPayload(p)) {
      selectedSourceInvoiceIds.value = invoiceSourceCards.value.map((c) => c.id);
      invoiceSourceGridExpanded.value = false;
      applySelectionToTotal();
    }
    if (isMilestoneProjectPayload(p)) {
      const def = defaultApprovedMilestoneSelectionId();
      selectedSourceMilestoneIds.value = def ? [def] : [];
      milestoneGridExpanded.value = false;
      milestoneDetailsOpen.value = false;
      applyMilestoneSelectionToTotal();
    }
  } catch {
    projectDetail.value = null;
  } finally {
    loadingProject.value = false;
  }
}

async function loadProjectByIdDirect(projectId: string) {
  selectedProjectId.value = projectId;
  loadingProject.value = true;
  try {
    const res = await getProjectById(projectId);
    const p = unwrapProjectPayload(res?.data);
    projectDetail.value = p;
    if (!p) return;

    // Reset irrelevant selection state when the loaded project doesn't support it.
    if (!isRecurringProjectPayload(p)) {
      selectedSourceInvoiceIds.value = [];
      invoiceSourceGridExpanded.value = false;
    }
    if (!isMilestoneProjectPayload(p)) {
      selectedSourceMilestoneIds.value = [];
      milestoneGridExpanded.value = false;
      milestoneDetailsOpen.value = false;
    }

    // Project invoice: align amounts with the project defaults (same behavior as onSelectProject).
    const amount = Number(p.amount ?? p.total_amount ?? p.totalAmount ?? 0);
    if (Number.isFinite(amount) && amount > 0) totalAmountDisplay.value = formatAmountInput(amount);

    const cur = String(p.currency ?? p.currency_code ?? "PKR").trim();
    currencyCode.value = cur || "PKR";

    const ti = readProjectTaxInclusive(p);
    if (ti != null) gstInclusive.value = ti;

    const startRaw = p.start_date ?? p.started_at ?? p.created_at;
    const endRaw = p.end_date ?? p.due_date;
    if (startRaw) {
      const d = new Date(String(startRaw));
      if (Number.isFinite(d.getTime())) issueDateIso.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      else issueDateIso.value = todayIso();
    } else {
      issueDateIso.value = todayIso();
    }
    if (endRaw) {
      const d = new Date(String(endRaw));
      if (Number.isFinite(d.getTime())) dueDateIso.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      else dueDateIso.value = "";
    } else {
      dueDateIso.value = "";
    }

    const scope =
      p.scope_description ??
      p.description ??
      p.scope ??
      (p.project_scope && typeof p.project_scope === "object" && !Array.isArray(p.project_scope)
        ? (p.project_scope as any).description ?? (p.project_scope as any).name
        : "");
    note.value = scope != null && String(scope).trim() ? String(scope).trim() : "";

    if (isRecurringProjectPayload(p)) {
      selectedSourceInvoiceIds.value = invoiceSourceCards.value.map((c) => c.id);
      invoiceSourceGridExpanded.value = false;
      applySelectionToTotal();
    }
    if (isMilestoneProjectPayload(p)) {
      milestoneGridExpanded.value = false;
      milestoneDetailsOpen.value = false;
    }
  } catch {
    projectDetail.value = null;
  } finally {
    loadingProject.value = false;
  }
}

const prefillApplied = ref(false);
watch(
  () => [props.prefillProjectId, props.prefillMilestoneId],
  async () => {
    if (prefillApplied.value) return;
    const pid = String(props.prefillProjectId ?? "").trim();
    if (!pid) return;

    prefillApplied.value = true;
    step.value = 1;
    invoiceCategory.value = "project";
    sourceMode.value = "existing_client";

    await loadProjectByIdDirect(pid);

    const mid = String(props.prefillMilestoneId ?? "").trim();
    if (mid && isMilestoneProject.value) {
      const allowed = new Set(milestoneSourceCards.value.filter((c) => c.selectable).map((c) => c.id));
      if (allowed.has(mid)) {
        selectedSourceMilestoneIds.value = [mid];
        applyMilestoneSelectionToTotal();
      } else {
        selectedSourceMilestoneIds.value = [];
        applyMilestoneSelectionToTotal();
        pushAlert({
          kind: "info",
          title: "Milestone not invoice-ready",
          message: "This milestone must be Approved by the client to generate an invoice.",
          timeoutMs: 6500,
        });
      }
    }
  },
  { immediate: true },
);

function onProjectSelectChange(e: Event) {
  const id = String((e.target as HTMLSelectElement).value ?? "").trim();
  if (!id) {
    clearProject();
    return;
  }
  const pool =
    isProjectInvoice.value || sourceMode.value === "existing_client"
      ? projectRowsForSelect.value
      : projectRows.value;
  const row = pool.find((x) => x.id === id) ?? projectRows.value.find((x) => x.id === id);
  if (row) void onSelectProject(row);
}

function clearProject() {
  customDeliverablesBootstrap.value = false;
  selectedProjectId.value = null;
  projectDetail.value = null;
  draftInvoiceId.value = null;
  totalAmountDisplay.value = "";
  note.value = "";
  issueDateIso.value = todayIso();
  dueDateIso.value = "";
  selectedSourceInvoiceIds.value = [];
  invoiceSourceGridExpanded.value = false;
  selectedSourceMilestoneIds.value = [];
  milestoneGridExpanded.value = false;
  milestoneDetailsOpen.value = false;
}

watch(invoiceCategory, (cat) => {
  newClientFormPhase.value = 1;
  createdNewClientId.value = null;
  if (cat === "project") {
    selectedClientKey.value = "";
    sourceMode.value = "existing_client";
  } else {
    selectedClientKey.value = "";
    /** Custom flow always creates a new project later; drop any project picked on the Project tab. */
    selectedProjectId.value = null;
    projectDetail.value = null;
    draftInvoiceId.value = null;
    customDeliverablesBootstrap.value = false;
    selectedSourceInvoiceIds.value = [];
    invoiceSourceGridExpanded.value = false;
    resetCustomInvoiceFields();
    if (sourceMode.value === "existing_client") void loadAddressBookClients();
  }
});

watch(sourceMode, (mode) => {
  newClientFormPhase.value = 1;
  selectedClientKey.value = "";
  createdNewClientId.value = null;
  if (mode === "new_client") {
    clearProject();
    gstInclusive.value = true;
    customExistingClientId.value = "";
  } else if (selectedProjectId.value && invoiceCategory.value === "project") {
    const row = projectRows.value.find((x) => x.id === selectedProjectId.value);
    if (row) void onSelectProject(row);
  }
  if (mode === "existing_client" && invoiceCategory.value === "custom") {
    void loadAddressBookClients();
  }
});

watch(
  customLineItems,
  () => {
    syncCustomLineItemsToTotalDisplay();
  },
  { deep: true },
);

watch(customPaymentKind, (k) => {
  if (k !== "single") return;
  if (customLineItems.value.length <= 1) return;
  const first = customLineItems.value[0];
  customLineItems.value = [
    first
      ? { ...first }
      : { id: customLineItemSeq++, description: "", amount: "" },
  ];
  syncCustomLineItemsToTotalDisplay();
});

watch(selectedClientKey, () => {
  if (sourceMode.value !== "existing_client" || isProjectInvoice.value) return;
  selectedProjectId.value = null;
  projectDetail.value = null;
  draftInvoiceId.value = null;
  totalAmountDisplay.value = "";
  note.value = "";
  issueDateIso.value = todayIso();
  dueDateIso.value = "";
  selectedSourceInvoiceIds.value = [];
  invoiceSourceGridExpanded.value = false;
});

watch(selectedTermsTemplateId, (id) => {
  const t = termsTemplates.value.find((x) => String(x.id) === String(id));
  if (t && termsMode.value === "existing") {
    termsText.value = decodeTermsBody(t.body);
  }
});

watch(termsMode, (m) => {
  if (m === "existing" && selectedTermsTemplateId.value) {
    const t = termsTemplates.value.find((x) => String(x.id) === String(selectedTermsTemplateId.value));
    if (t) termsText.value = decodeTermsBody(t.body);
  }
});

watch(step, (s) => {
  if (s === 2) void loadTermsTemplates();
});

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

async function loadTermsTemplates() {
  termsLoading.value = true;
  try {
    const res = await getInvoiceTermsTemplates();
    console.groupCollapsed("[API] GET /api/v1/invoice-terms-templates");
    console.log("Status:", (res as any)?.status);
    console.log("Data:", (res as any)?.data);
    console.groupEnd();
    const list = extractInvoiceTermsTemplatesList(res.data);
    termsTemplates.value = list.map((x: any) => ({
      id: String(x.id ?? "").trim(),
      name: String(x.name ?? "Template").trim(),
      body: String(x.body ?? ""),
      owner_user_id: x.owner_user_id ?? null,
    })).filter((x: InvoiceTermsTemplateApi) => x.id);
    if (!selectedTermsTemplateId.value && termsTemplates.value.length) {
      selectedTermsTemplateId.value = termsTemplates.value[0]!.id;
      termsText.value = decodeTermsBody(termsTemplates.value[0]!.body);
    }
  } catch (err: unknown) {
    termsTemplates.value = [];
    console.groupCollapsed("[API] GET /api/v1/invoice-terms-templates (error)");
    console.error(err);
    console.log("Response status:", (err as any)?.response?.status);
    console.log("Response data:", (err as any)?.response?.data);
    console.groupEnd();
    const data = (err as { response?: { data?: unknown } })?.response?.data;
    const msg =
      extractMessage(data) ??
      (err instanceof Error ? err.message : null) ??
      "Could not load terms templates.";
    pushAlert({
      kind: "error",
      title: "Terms templates",
      message: msg,
      timeoutMs: 9000,
    });
  } finally {
    termsLoading.value = false;
  }
}

function isValidEmailLoose(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

function goToNewClientIntake() {
  newClientFormPhase.value = 1;
}

function buildNewClientCreatePayload(): {
  type: "individual" | "brand";
  status: "active";
  display_name: string;
  brand_name: string;
  poc_name: string;
  poc_email: string;
  poc_phone?: string;
  meta?: { notes?: string };
} {
  const email = newClientEmail.value.trim();
  const phone = newClientPhone.value.trim();
  const addr = newClientAddress.value.trim();
  const noteParts: string[] = [];
  if (newClientKind.value === "individual" && newBrandName.value.trim()) {
    noteParts.push(`Company: ${newBrandName.value.trim()}`);
  }
  if (addr) noteParts.push(`Address: ${addr}`);

  if (newClientKind.value === "brand") {
    const contact = newClientName.value.trim();
    const brand = newBrandName.value.trim();
    const displayName = brand || contact;
    return {
      type: "brand",
      status: "active",
      display_name: displayName,
      brand_name: brand || contact,
      poc_name: contact || brand,
      poc_email: email,
      ...(phone ? { poc_phone: phone } : {}),
      ...(noteParts.length ? { meta: { notes: noteParts.join("\n") } } : {}),
    };
  }

  const name = newClientName.value.trim();
  return {
    type: "individual",
    status: "active",
    display_name: name,
    brand_name: "",
    poc_name: name,
    poc_email: email,
    ...(phone ? { poc_phone: phone } : {}),
    ...(noteParts.length ? { meta: { notes: noteParts.join("\n") } } : {}),
  };
}

function validateNewClientIntake(): boolean {
  if (!isValidEmailLoose(newClientEmail.value)) {
    pushAlert({
      kind: "error",
      title: "Client email",
      message: "Enter a valid email address.",
      timeoutMs: 6000,
    });
    return false;
  }
  if (newClientKind.value === "brand") {
    if (!newBrandName.value.trim()) {
      pushAlert({
        kind: "error",
        title: "Brand name",
        message: "Enter the brand or company name.",
        timeoutMs: 6000,
      });
      return false;
    }
  } else if (!newClientName.value.trim()) {
    pushAlert({
      kind: "error",
      title: "Client name",
      message: "Enter the client's full name.",
      timeoutMs: 6000,
    });
    return false;
  }
  return true;
}

async function onContinue() {
  if (isCustomNewClientPhase1.value) {
    if (!validateNewClientIntake()) return;
    creatingNewClient.value = true;
    try {
      const payload = buildNewClientCreatePayload();
      const existingId = createdNewClientId.value?.trim();
      const res = existingId
        ? await updateClient(existingId, payload, { skipAlert: true })
        : await createClient(payload, { skipAlert: true });
      const saved = (res?.data as { data?: unknown } | undefined)?.data ?? res?.data;
      const savedRec =
        saved && typeof saved === "object" && !Array.isArray(saved)
          ? (saved as Record<string, unknown>)
          : null;
      const id = String(savedRec?.id ?? savedRec?.uuid ?? existingId ?? "").trim();
      createdNewClientId.value = id || null;
      await loadProjectList();
      newClientFormPhase.value = 2;
    } catch (err: unknown) {
      const data = (err as { response?: { data?: unknown } })?.response?.data;
      const msg =
        extractMessage(data) ??
        (err instanceof Error ? err.message : null) ??
        "Could not create the client. Please try again.";
      pushAlert({
        kind: "error",
        title: "New client",
        message: msg,
        timeoutMs: 10000,
      });
    } finally {
      creatingNewClient.value = false;
    }
    return;
  }

  if (sourceMode.value === "new_client") {
    if (!validateNewClientIntake()) return;
  }

  /** Custom invoice: create a new project from the wizard, then open step 2 with its draft invoice. */
  if (!isProjectInvoice.value) {
    syncCustomLineItemsToTotalDisplay();
    if (!customProjectTitle.value.trim()) {
      pushAlert({
        kind: "error",
        title: "Project title",
        message: "Enter a title for this project.",
        timeoutMs: 7000,
      });
      return;
    }
    const clientIdForProject =
      sourceMode.value === "new_client"
        ? String(createdNewClientId.value ?? "").trim()
        : customExistingClientId.value.trim();
    if (!clientIdForProject) {
      pushAlert({
        kind: "error",
        title: "Client required",
        message:
          sourceMode.value === "new_client"
            ? "Complete new client details first, then continue to this step."
            : "Select a client.",
        timeoutMs: 9000,
      });
      return;
    }

    const totalNum = sumCustomLineAmountsNumeric();
    if (!Number.isFinite(totalNum) || totalNum <= 0) {
      pushAlert({
        kind: "error",
        title: "Amount required",
        message: "Enter a valid amount for each line item.",
        timeoutMs: 6000,
      });
      return;
    }

    const firstLine = customLineItems.value[0];
    if (customPaymentKind.value === "single") {
      if (!firstLine?.description.trim()) {
        pushAlert({
          kind: "error",
          title: "Description",
          message: "Enter a short description for this item.",
          timeoutMs: 6000,
        });
        return;
      }
    } else {
      for (const row of customLineItems.value) {
        const n = parseAmountInput(row.amount);
        if (Number.isFinite(n) && n > 0 && !row.description.trim()) {
          pushAlert({
            kind: "error",
            title: "Description",
            message: "Each line with an amount needs a description.",
            timeoutMs: 7000,
          });
          return;
        }
      }
    }

    if (!issueDateIso.value) {
      pushAlert({ kind: "error", title: "Issue date", message: "Choose an issue date.", timeoutMs: 6000 });
      return;
    }

    creatingCustomProject.value = true;
    try {
      /** Never PATCH an existing project here: custom invoice always POST /api/v1/projects. */
      selectedProjectId.value = null;
      projectDetail.value = null;
      draftInvoiceId.value = null;
      customDeliverablesBootstrap.value = false;

      await ensureProjectScopeForCreate();
      if (!projectScopeIdForCreate.value.trim()) {
        pushAlert({
          kind: "error",
          title: "Project scope",
          message: "No project scope is available. Add scopes in the app or contact support, then try again.",
          timeoutMs: 10000,
        });
        return;
      }
      const apiType = customPaymentKind.value === "single" ? "single" : "milestone";
      const form = await buildCustomProjectFormData({ apiType, amountNumeric: totalNum });
      const res = await createProject(form, { skipAlert: true });
      const projectId = extractCreatedProjectIdFromResponse(res?.data);
      if (!projectId) {
        pushAlert({
          kind: "error",
          title: "Create project",
          message: "The server did not return a new project id. Check the network response or try again.",
          timeoutMs: 10000,
        });
        return;
      }
      if (apiType === "milestone") {
        await createMilestonesForCustomDeliverables(projectId, totalNum);
        customDeliverablesBootstrap.value = true;
      }
      const draftId = await loadFreshProjectAndWaitForDraftInvoice(projectId, {
        milestoneDeliverablesMode: apiType === "milestone",
      });
      if (!draftId) {
        customDeliverablesBootstrap.value = false;
        pushAlert({
          kind: "error",
          title: "Invoice not ready yet",
          message:
            apiType === "milestone"
              ? "The project and milestones are saved, but draft invoices for those milestones are not available from the server yet. Wait a minute and try Continue again, or open the project in the dashboard."
              : "The new project is saved, but the draft invoice wasn't ready yet. Please wait a moment and try again, or open the project in the dashboard.",
          timeoutMs: 12000,
        });
        return;
      }
      invoiceNotes.value = note.value.trim();
      draftInvoiceId.value = draftId;
      step.value = 2;
      void loadProjectList();
    } catch (err: unknown) {
      customDeliverablesBootstrap.value = false;
      const data = (err as { response?: { data?: unknown } })?.response?.data;
      const msg =
        extractMessage(data) ??
        (err instanceof Error ? err.message : null) ??
        "Could not create the project. Please try again.";
      pushAlert({
        kind: "error",
        title: "Create project",
        message: msg,
        timeoutMs: 12000,
      });
    } finally {
      creatingCustomProject.value = false;
    }
    return;
  }

  if (!selectedProjectId.value) {
    const hint =
      sourceMode.value === "existing_client"
        ? "Select a project for this client to continue."
        : "Select a project so the draft invoice can be issued (create a project first if needed).";
    pushAlert({ kind: "error", title: "Project required", message: hint, timeoutMs: 8000 });
    return;
  }
  const subtotal = parseAmountInput(totalAmountDisplay.value);
  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    pushAlert({ kind: "error", title: "Amount required", message: "Enter a valid total amount.", timeoutMs: 6000 });
    return;
  }
  if (!issueDateIso.value) {
    pushAlert({ kind: "error", title: "Issue date", message: "Choose an issue date.", timeoutMs: 6000 });
    return;
  }

  if (
    isRecurringProject.value &&
    invoiceSourceCards.value.length > 0 &&
    !selectedSourceInvoiceIds.value.length
  ) {
    pushAlert({
      kind: "error",
      title: "Invoice amount source",
      message: createInvoiceIssuanceRequiresPriorReview()
        ? "Select at least one invoice in In review to use as the amount source. Draft invoices must be moved to In review from the project first."
        : "Select at least one draft invoice to use as the amount source.",
      timeoutMs: 9000,
    });
    return;
  }

  if (isMilestoneProject.value && milestoneSourceCards.value.length > 0 && approvedMilestoneSourceCount.value === 0) {
    pushAlert({
      kind: "error",
      title: "Client approval required",
      message: "Invoices can only be generated for milestones the client has approved.",
      timeoutMs: 10000,
    });
    return;
  }

  if (
    isMilestoneProject.value &&
    approvedMilestoneSourceCount.value > 0 &&
    !selectedSourceMilestoneIds.value.length
  ) {
    pushAlert({
      kind: "error",
      title: "Milestone required",
      message: "Select at least one approved milestone to use as the amount source.",
      timeoutMs: 9000,
    });
    return;
  }

  const draftIds = resolveDraftInvoiceIdsForContinue();
  if (!draftIds.length) {
    pushAlert({
      kind: "error",
      title: createInvoiceIssuanceRequiresPriorReview() ? "No invoice ready to issue" : "No draft invoice",
      message: createInvoiceIssuanceRequiresPriorReview()
        ? "This project has no invoice in In review yet. Open the project, set the invoice to In review, then continue here. Draft invoices cannot be issued when Create Invoice was opened from the project."
        : "This project has no draft invoice to issue. Open the project, ensure a draft exists, then try again.",
      timeoutMs: 10000,
    });
    return;
  }

  invoiceNotes.value = note.value.trim();
  draftInvoiceIds.value = draftIds;
  draftInvoiceId.value = draftIds[0] ?? null;
  step.value = 2;
}

function buildNewClientDetailsBlock(): string {
  const lines: string[] = [];
  if (newClientKind.value === "brand") {
    const b = newBrandName.value.trim();
    if (b) lines.push(`Brand: ${b}`);
    const c = newClientName.value.trim();
    if (c) lines.push(`Contact: ${c}`);
  } else {
    const n = newClientName.value.trim();
    if (n) lines.push(`Client: ${n}`);
    const co = newBrandName.value.trim();
    if (co) lines.push(`Company: ${co}`);
  }
  const addr = newClientAddress.value.trim();
  if (addr) lines.push(`Address: ${addr}`);
  const phone = newClientPhone.value.trim();
  if (phone) lines.push(`Phone: ${phone}`);
  return lines.join("\n");
}

function onBack() {
  if (step.value === 2) {
    draftInvoiceId.value = null;
    step.value = 1;
    return;
  }
  if (isCustomNewClientPhase1.value) {
    emit("close");
    return;
  }
  if (
    step.value === 1 &&
    invoiceCategory.value === "custom" &&
    sourceMode.value === "new_client" &&
    newClientFormPhase.value === 2
  ) {
    newClientFormPhase.value = 1;
    return;
  }
  emit("close");
}

async function onContinueFromTemplateStyle() {
  const { name, email } = resolveIssueCustomer();
  if (!name || !email) {
    pushAlert({
      kind: "error",
      title: "Customer details",
      message: "This project needs a client with name and email before you can send an invoice.",
      timeoutMs: 8000,
    });
    return;
  }

  if (termsMode.value === "custom" && !termsText.value.trim()) {
    pushAlert({
      kind: "error",
      title: "Terms",
      message: "Enter terms and conditions, or switch to Existing and pick a template.",
      timeoutMs: 8000,
    });
    return;
  }

  if (termsMode.value === "custom" && !customTermsTemplateName.value.trim()) {
    pushAlert({
      kind: "error",
      title: "Terms",
      message: "Enter a template name for your custom terms.",
      timeoutMs: 8000,
    });
    return;
  }

  // If user entered custom terms, create a terms template first, then proceed.
  if (termsMode.value === "custom") {
    creatingDraft.value = true;
    try {
      const res = await createInvoiceTermsTemplate(
        {
          name: customTermsTemplateName.value.trim(),
          body: termsText.value.trim(),
        },
        { skipAlert: true },
      );
      const newId = pickTermsTemplateIdFromCreateResponse(res);
      if (!newId) {
        pushAlert({
          kind: "error",
          title: "Terms",
          message:
            "The server did not return a template id. Check POST /api/v1/invoice-terms-templates response shape.",
          timeoutMs: 10000,
        });
        return;
      }
      createdTermsTemplateId.value = newId;
      selectedTermsTemplateId.value = newId;
      // Refresh list so the new template is selectable/visible immediately.
      await loadTermsTemplates().catch(() => undefined);
    } catch (err: unknown) {
      const data = (err as { response?: { data?: unknown } })?.response?.data;
      const msg =
        extractMessage(data) ??
        (err instanceof Error ? err.message : null) ??
        "Could not create the terms template. Please try again.";
      pushAlert({
        kind: "error",
        title: "Terms",
        message: msg,
        timeoutMs: 10000,
      });
      return;
    } finally {
      creatingDraft.value = false;
    }
  }

  const templateId = resolveTermsTemplateIdForIssue();
  if (!templateId) {
    pushAlert({
      kind: "error",
      title: "Terms",
      message:
        "No invoice terms template is available. Create one with Custom terms, or ensure GET /api/v1/invoice-terms-templates returns data.",
      timeoutMs: 8000,
    });
    return;
  }

  if (!draftInvoiceIds.value.length) {
    const ids = resolveDraftInvoiceIdsForContinue();
    if (ids.length) {
      draftInvoiceIds.value = ids;
      draftInvoiceId.value = ids[0] ?? null;
    }
  }
  if (!draftInvoiceIds.value.length) {
    pushAlert({
      kind: "error",
      title: "Invoice",
      message: createInvoiceIssuanceRequiresPriorReview()
        ? "No invoice id to issue. Go back to step 1 and select a project that has an invoice in In review."
        : "No draft invoice id. Go back to step 1 and ensure the project loaded with a draft invoice.",
      timeoutMs: 10000,
    });
    return;
  }

  await onGenerate();
}

function resolveTermsTemplateIdForIssue(): string | null {
  if (createdTermsTemplateId.value) return createdTermsTemplateId.value;
  if (termsMode.value === "existing") {
    const id = String(selectedTermsTemplateId.value ?? "").trim();
    return id || null;
  }
  const first = termsTemplates.value[0]?.id;
  return first ? String(first) : null;
}

async function onGenerate() {
  const ids = draftInvoiceIds.value.length
    ? [...draftInvoiceIds.value]
    : draftInvoiceId.value
      ? [draftInvoiceId.value]
      : [];
  if (!ids.length) return;

  const invoiceIdsToIssue = ids.filter(Boolean);
  const firstInvoiceId = invoiceIdsToIssue[0] ?? null;
  if (!firstInvoiceId) return;

  // Best-effort guard: if we can refresh project, ensure every resolved id is still issuable.
  if (selectedProjectId.value) {
    try {
      const res = await getProjectById(selectedProjectId.value);
      const fresh = unwrapProjectPayload(res?.data);
      for (const invoiceId of invoiceIdsToIssue) {
        const inv = findInvoiceObjectInProject(fresh, invoiceId);
        if (!inv) continue;
        const status = normalizeInvoiceStatusForPick(inv.status ?? inv.state ?? inv.invoice_status);
        if (isIssuableInvoiceStatusKey(status)) continue;
        const fromProject = createInvoiceIssuanceRequiresPriorReview();
        const draftLike = ["draft", "not_issued", "notissued", "pending"].includes(status);
        pushAlert({
          kind: "error",
          title: fromProject ? "Invoice not ready" : "Invoice already issued",
          message: fromProject
            ? draftLike
              ? "When Create Invoice is opened from a project, the invoice must be In review before it can be issued. Set it to In review on the project, then try again."
              : "This invoice cannot be issued from Create Invoice. Open the project to view or manage it."
            : "This invoice is no longer a draft and cannot be issued again from Create Invoice. Open the project to view it, or create a new billable item if you need another invoice.",
          timeoutMs: 12000,
        });
        return;
      }
    } catch {
      // If the project cannot be refreshed, fall through; the issue request may still succeed or fail server-side.
    }
  }

  const templateId = resolveTermsTemplateIdForIssue();
  if (!templateId) {
    pushAlert({
      kind: "error",
      title: "Terms",
      message: "No invoice terms template is available. Ensure GET /api/v1/invoice-terms-templates returns data.",
      timeoutMs: 8000,
    });
    return;
  }

  const { name, email } = resolveIssueCustomer();
  if (!name || !email) {
    pushAlert({
      kind: "error",
      title: "Customer details",
      message: "This project needs a client with name and email before you can issue an invoice.",
      timeoutMs: 8000,
    });
    return;
  }

  issuing.value = true;
  try {
    const notesBase = invoiceNotes.value.trim();
    const newClientExtra = sourceMode.value === "new_client" ? buildNewClientDetailsBlock() : "";
    const notesCombined = [notesBase, newClientExtra].filter(Boolean).join("\n\n");
    const patchBodyBase: Record<string, unknown> = {
      notes: notesCombined,
      currency: currencyCode.value,
      terms: termsText.value.trim(),
      gst_inclusive: gstInclusive.value,
      visual_template: visualTemplate.value,
    };
    if (issueDateIso.value) patchBodyBase.issue_date = issueDateIso.value;
    patchBodyBase.due_date = dueDateIso.value || null;

    // Avoid accidentally overwriting per-invoice amounts when issuing multiple invoices.
    // Single invoice flow keeps existing behavior (user-edited total amount patches subtotal).
    const shouldPatchSubtotal = invoiceIdsToIssue.length === 1;
    const subtotal = shouldPatchSubtotal ? parseAmountInput(totalAmountDisplay.value) : NaN;

    let firstIssuedPdfUrl: string | null = null;
    for (const invoiceId of invoiceIdsToIssue) {
      const patchBody = { ...patchBodyBase } as Record<string, unknown>;
      if (shouldPatchSubtotal && Number.isFinite(subtotal) && subtotal > 0) {
        patchBody.subtotal = String(subtotal);
      }
      await patchInvoice(invoiceId, patchBody, { skipAlert: true }).catch(() => undefined);

      const issueRes = await issueInvoice(invoiceId, {
        invoice_terms_template_id: templateId,
        visual_template: visualTemplate.value,
      });

      if (!firstIssuedPdfUrl && invoiceId === firstInvoiceId) {
        firstIssuedPdfUrl = extractInvoicePdfUrlFromResponseBody(issueRes?.data);
        if (!firstIssuedPdfUrl) {
          try {
            const invRes = await apiClient.get(`/api/v1/invoices/${invoiceId}`, { skipAlert: true } as any);
            firstIssuedPdfUrl = extractInvoicePdfUrlFromResponseBody(invRes?.data);
          } catch {
            /* optional route / shape */
          }
        }
      }
    }

    pendingIssuedPayload.value = { projectId: selectedProjectId.value, invoiceId: firstInvoiceId };
    await fetchAndShowIssuedInvoicePdf(firstInvoiceId, { hostedPdfUrl: firstIssuedPdfUrl ?? undefined });
  } catch {
    // handled globally
  } finally {
    issuing.value = false;
  }
}

onMounted(() => {
  issueDateIso.value = todayIso();
  void loadProjectList();
  if (invoiceCategory.value === "custom" && sourceMode.value === "existing_client") {
    void loadAddressBookClients();
  }
  document.addEventListener("mousedown", onDocumentPointerDown);
});

onBeforeUnmount(() => {
  issuedPdfFetchGeneration += 1;
  revokeIssuedPdfObjectUrl();
  document.removeEventListener("mousedown", onDocumentPointerDown);
});
</script>

<template>
  <div class="cif" :class="{ 'cif--new-client-intake': isCustomNewClientPhase1 }">
    <div class="cif-inner">
      <div class="cif-head">
        <h1 class="cif-title">Create Invoice</h1>
      </div>

      <template v-if="step === 1">
        <div
          class="cif-toggle cif-toggle--project-custom"
          role="group"
          aria-label="Invoice type"
        >
          <button
            type="button"
            class="cif-toggle-btn"
            :class="{ 'cif-toggle-btn--on': invoiceCategory === 'project' }"
            @click="invoiceCategory = 'project'"
          >
            Project
          </button>
          <button
            type="button"
            class="cif-toggle-btn"
            :class="{ 'cif-toggle-btn--on': invoiceCategory === 'custom' }"
            @click="invoiceCategory = 'custom'"
          >
            Custom
          </button>
        </div>

        <div
          v-if="showClientSubtypeRow"
          class="cif-toggle cif-toggle--segmented cif-toggle--client-source"
          role="group"
          aria-label="Client type"
        >
          <button
            type="button"
            class="cif-toggle-btn cif-toggle-btn--grow"
            :class="{ 'cif-toggle-btn--on': sourceMode === 'existing_client' }"
            @click="sourceMode = 'existing_client'"
          >
            Existing Client
          </button>
          <button
            type="button"
            class="cif-toggle-btn cif-toggle-btn--grow"
            :class="{ 'cif-toggle-btn--on': sourceMode === 'new_client' }"
            @click="sourceMode = 'new_client'"
          >
            New Client
          </button>
        </div>

        <section v-if="isCustomNewClientPhase1" class="cif-new-client" aria-label="New client details">
          <div class="cif-new-client-fields">
            <div class="cif-nc-row cif-nc-row--one-half">
              <div class="cif-field cif-field--intake">
                <Label class="cif-label" for="cif-new-client-name">Client</Label>
                <Input
                  id="cif-new-client-name"
                  v-model="newClientName"
                  class="cif-field-input cif-field-input--intake cif-field-input--fill-available"
                  autocomplete="name"
                  placeholder="Full Name"
                />
              </div>
            </div>

            <div class="cif-field cif-field--intake cif-field--tight">
              <span class="cif-kind-question" id="cif-kind-q">Is this a client or brand?</span>
              <div
                class="cif-toggle cif-toggle--segmented cif-toggle--client-kind"
                role="group"
                aria-labelledby="cif-kind-q"
              >
                <button
                  type="button"
                  class="cif-toggle-btn cif-toggle-btn--grow"
                  :class="{ 'cif-toggle-btn--on': newClientKind === 'brand' }"
                  @click="newClientKind = 'brand'"
                >
                  Brand
                </button>
                <button
                  type="button"
                  class="cif-toggle-btn cif-toggle-btn--grow"
                  :class="{ 'cif-toggle-btn--on': newClientKind === 'individual' }"
                  @click="newClientKind = 'individual'"
                >
                  Individual Client
                </button>
              </div>
            </div>

            <div v-if="newClientKind === 'brand'" class="cif-nc-row cif-nc-row--one-half">
              <div class="cif-field cif-field--intake">
                <Label class="cif-label" for="cif-new-brand-name">Brand</Label>
                <Input
                  id="cif-new-brand-name"
                  v-model="newBrandName"
                  class="cif-field-input cif-field-input--intake cif-field-input--fill-available"
                  autocomplete="organization"
                  placeholder="Brand or company name"
                />
              </div>
            </div>

            <div class="cif-nc-row cif-nc-row--two-half">
              <div class="cif-field cif-field--intake">
                <Label class="cif-label" for="cif-new-client-email">Email</Label>
                <Input
                  id="cif-new-client-email"
                  v-model="newClientEmail"
                  class="cif-field-input cif-field-input--intake cif-field-input--fill-available"
                  type="email"
                  autocomplete="email"
                  placeholder="you@example.com"
                />
              </div>
              <div class="cif-field cif-field--intake">
                <Label class="cif-label" for="cif-new-client-phone">Phone Number</Label>
                <Input
                  id="cif-new-client-phone"
                  v-model="newClientPhone"
                  class="cif-field-input cif-field-input--intake cif-field-input--fill-available"
                  type="tel"
                  autocomplete="tel"
                  placeholder="03XXXXX"
                />
              </div>
            </div>
            <div class="cif-field cif-field--intake">
              <Label class="cif-label" for="cif-new-client-address">Address</Label>
              <textarea
                id="cif-new-client-address"
                v-model="newClientAddress"
                class="cif-textarea cif-textarea--new-client cif-textarea--intake"
                rows="3"
                placeholder="Enter client Address"
              />
            </div>
          </div>
        </section>

        <template v-else>
          <div v-if="isCustomNewClientPhase2" class="cif-bill-to" role="status">
            <div class="cif-bill-to-inner">
              <span class="cif-bill-to-label">Bill to</span>
              <span class="cif-bill-to-name">{{ newClientBillToLine }}</span>
              <span class="cif-bill-to-email">{{ newClientEmail }}</span>
            </div>
            <button type="button" class="cif-bill-to-edit" @click="goToNewClientIntake">Edit</button>
          </div>

          <p v-if="isProjectInvoice" class="cif-hint">Select a project. Amounts and dates can follow the project or be adjusted below.</p>
          <p v-else-if="sourceMode === 'existing_client' && !isCustomExistingClientForm" class="cif-hint">
            Choose a client, then enter the project title, payment type, and line items. A new project is created when you continue.
          </p>
          <p v-else-if="isCustomNewClientPhase2" class="cif-hint">
            Enter the project title, payment type, and line items. A new project is created when you continue.
          </p>

          <template v-if="isProjectInvoice">
            <div class="cif-field">
              <Label class="cif-label" for="cif-project-select">Project</Label>
              <select
                id="cif-project-select"
                class="cif-select"
                :value="selectedProjectId ?? ''"
                :disabled="projectsLoading"
                :aria-busy="projectsLoading"
                @change="onProjectSelectChange"
              >
                <option value="">{{ projectsLoading ? "Loading projects…" : "Select a project…" }}</option>
                <option v-for="p in projectRows" :key="p.id" :value="p.id">
                  {{ p.title }} — {{ p.clientLine }} ({{ p.paymentType }})
                </option>
              </select>
              <p v-if="!projectsLoading && !projectRows.length" class="cif-field-hint">No projects yet. Create one first.</p>
              <p v-else-if="loadingProject" class="cif-field-hint">Loading project…</p>
            </div>

            <div v-if="isRecurringProject && invoiceSourceCards.length" class="cif-field cif-invoice-source">
              <div class="cif-invoice-source-head">
                <Label class="cif-label cif-invoice-source-title">Invoice Amount source</Label>
                <span class="cif-invoice-source-count">
                  {{ selectedSourceCount }}
                  {{ selectedSourceCount === 1 ? "invoice" : "invoices" }} selected
                </span>
              </div>
              <div class="cif-invoice-grid" role="list">
                <button
                  v-for="card in visibleInvoiceSourceCards"
                  :key="card.id"
                  type="button"
                  class="cif-inv-card"
                  :class="{ 'cif-inv-card--selected': isSourceInvoiceSelected(card.id) }"
                  role="listitem"
                  @click="toggleSourceInvoice(card)"
                >
                  <div class="cif-inv-card-top">
                    <span class="cif-inv-num">{{ card.numberLabel }}</span>
                    <span class="cif-inv-badge">
                      <span class="cif-inv-dot" aria-hidden="true" />
                      {{ card.statusLabel }}
                    </span>
                  </div>
                  <div class="cif-inv-card-mid">
                    <div class="cif-inv-col">
                      <span class="cif-inv-meta">Amount ({{ currencyCode }})</span>
                      <span class="cif-inv-amt">{{ card.amountDisplay }}</span>
                    </div>
                    <div class="cif-inv-col cif-inv-col--end">
                      <span class="cif-inv-meta">Date Due</span>
                      <span class="cif-inv-due">{{ card.dueShort }}</span>
                    </div>
                  </div>
                </button>
              </div>
              <button
                v-if="invoiceSourceCards.length > INVOICE_GRID_COLLAPSED_COUNT"
                type="button"
                class="cif-invoice-grid-toggle"
                @click="invoiceSourceGridExpanded = !invoiceSourceGridExpanded"
              >
                {{ invoiceSourceToggleLabel }}
                <ChevronUp v-if="invoiceSourceGridExpanded" class="cif-invoice-grid-chevron" :stroke-width="2" aria-hidden="true" />
                <ChevronDown v-else class="cif-invoice-grid-chevron" :stroke-width="2" aria-hidden="true" />
              </button>
            </div>

            <div v-if="isMilestoneProject && milestoneSourceCards.length" class="cif-field cif-milestone-source">
              <div class="cif-milestone-source-head">
                <Label class="cif-label cif-milestone-source-title">Amount Source</Label>
                <button
                  type="button"
                  class="cif-milestone-details-toggle"
                  @click="milestoneDetailsOpen = !milestoneDetailsOpen"
                >
                  {{ milestoneDetailsOpen ? "Hide Milestone Details" : "Show Milestone Details" }}
                </button>
              </div>

              <div class="cif-milestone-grid" role="list">
                <button
                  v-for="card in visibleMilestoneSourceCards"
                  :key="card.id"
                  type="button"
                  class="cif-ms-card"
                  :class="{
                    'cif-ms-card--selected': card.selectable && isSourceMilestoneSelected(card.id),
                    'cif-ms-card--locked': !card.selectable,
                  }"
                  :disabled="!card.selectable"
                  role="listitem"
                  @click="toggleSourceMilestone(card)"
                >
                  <span class="cif-ms-check" aria-hidden="true">
                    <span
                      class="cif-ms-check-box"
                      :class="{
                        'cif-ms-check-box--on': card.selectable && isSourceMilestoneSelected(card.id),
                        'cif-ms-check-box--locked': !card.selectable,
                      }"
                    />
                  </span>
                  <div class="cif-ms-body">
                    <div class="cif-ms-top">
                      <span class="cif-ms-seq">{{ card.sequence }}</span>
                      <span class="cif-ms-kind">Milestone</span>
                    </div>
                    <div v-if="milestoneDetailsOpen" class="cif-ms-title">
                      {{ card.title }}
                    </div>
                    <div v-if="milestoneDetailsOpen && card.deliverables" class="cif-ms-desc">
                      {{ card.deliverables }}
                    </div>
                    <div class="cif-ms-bottom">
                      <span class="cif-ms-due">{{ card.dueLabel }}</span>
                      <span class="cif-ms-amt">{{ currencyCode }} {{ card.amountDisplay }}</span>
                    </div>
                  </div>
                </button>
              </div>

              <button
                v-if="milestoneSourceCards.length > MILESTONE_GRID_COLLAPSED_COUNT"
                type="button"
                class="cif-milestone-grid-toggle"
                @click="milestoneGridExpanded = !milestoneGridExpanded"
              >
                {{ milestoneSourceToggleLabel }}
                <ChevronUp v-if="milestoneGridExpanded" class="cif-milestone-grid-chevron" :stroke-width="2" aria-hidden="true" />
                <ChevronDown v-else class="cif-milestone-grid-chevron" :stroke-width="2" aria-hidden="true" />
              </button>

              <p
                v-if="milestoneSourceCards.length && !approvedMilestoneSourceCount && !customDeliverablesBootstrap"
                class="cif-field-hint"
              >
                Invoices can only be generated after the client approves a milestone.
              </p>
              <p
                v-else-if="approvedMilestoneSourceCount && !selectedMilestoneSourceCount"
                class="cif-field-hint"
              >
                Select at least one approved milestone.
              </p>
            </div>

            <div class="cif-field">
              <Label class="cif-label">Total Amount</Label>
              <div class="cif-money">
                <Input
                  :model-value="totalAmountDisplay"
                  class="cif-money-input"
                  placeholder="e.g 10,000"
                  inputmode="decimal"
                  @update:model-value="onTotalAmountDisplayInput"
                />
                <span class="cif-money-suffix">{{ currencyCode }}</span>
              </div>
            </div>

            <div class="cif-field">
              <Label class="cif-label">{{ taxSectionLabel }}</Label>
              <div class="cif-tax">
                <label class="cif-radio" :class="{ 'cif-radio--active': gstInclusive }">
                  <input v-model="gstInclusive" type="radio" class="sr-only" :value="true" />
                  <span class="cif-radio-visual" aria-hidden="true" />
                  <span class="cif-radio-body">
                    <span class="cif-radio-title">Including GST</span>
                    <span class="cif-radio-sub">All the taxes are included in your total fee.</span>
                  </span>
                </label>
                <label class="cif-radio" :class="{ 'cif-radio--active': !gstInclusive }">
                  <input v-model="gstInclusive" type="radio" class="sr-only" :value="false" />
                  <span class="cif-radio-visual" aria-hidden="true" />
                  <span class="cif-radio-body">
                    <span class="cif-radio-title">Exclusive of GST</span>
                    <span class="cif-radio-sub">Tax is added on top of your quoted fee.</span>
                  </span>
                </label>
              </div>
              <div v-if="gstInclusive && estimatedGstAmount != null" class="cif-estimate">
                Estimated GST:
                <strong>
                  {{ currencyCode }}
                  {{ estimatedGstAmount.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}
                </strong>
                Based on the amount entered.
              </div>
            </div>

            <div class="cif-row-dates">
              <div class="cif-field">
                <Label class="cif-label">Issue Date</Label>
                <DateSelect v-model="issueDateIso" display-format="mon d, yyyy" />
              </div>
              <div class="cif-field">
                <Label class="cif-label">Due Date</Label>
                <DateSelect v-model="dueDateIso" display-format="dd/mm/yyyy" placeholder="DD/MM/YYYY" />
              </div>
            </div>

            <div class="cif-field">
              <Label class="cif-label">Note</Label>
              <textarea
                v-model="note"
                class="cif-textarea"
                rows="4"
                :placeholder="notePlaceholder"
              ></textarea>
            </div>
          </template>

          <template v-else>
            <div :class="{ 'cif-form-panel': isCustomExistingClientForm }">
              <template v-if="sourceMode === 'existing_client'">
                <div ref="clientComboRef" class="cif-field cif-field--client-combo">
                  <Label class="cif-label" for="cif-client-combo-input">Choose Client</Label>
                  <div class="cif-client-combo" :class="{ 'cif-client-combo--open': clientPickerOpen }">
                    <div class="cif-client-combo-control">
                      <Search class="cif-client-combo-icon" :size="18" :stroke-width="2" aria-hidden="true" />
                      <input
                        id="cif-client-combo-input"
                        v-model="clientSearchText"
                        type="text"
                        class="cif-client-combo-input"
                        :disabled="addressBookLoading || !addressBookClients.length"
                        :placeholder="addressBookLoading ? 'Loading clients…' : 'Select a client…'"
                        autocomplete="off"
                        role="combobox"
                        :aria-expanded="clientPickerOpen"
                        aria-controls="cif-client-listbox"
                        aria-autocomplete="list"
                        @focus="openClientPicker"
                        @input="onClientSearchInput"
                      />
                      <button
                        type="button"
                        class="cif-client-combo-chevron"
                        tabindex="-1"
                        aria-label="Toggle client list"
                        @click.stop="toggleClientPicker"
                      >
                        <ChevronDown
                          class="cif-client-combo-chevron-icon"
                          :class="{ 'cif-client-combo-chevron-icon--up': clientPickerOpen }"
                          :stroke-width="2"
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                    <ul
                      v-show="clientPickerOpen && filteredAddressBookClients.length > 0"
                      id="cif-client-listbox"
                      class="cif-client-combo-list"
                      role="listbox"
                    >
                      <li
                        v-for="c in filteredAddressBookClients"
                        :key="c.id"
                        role="option"
                        :aria-selected="c.id === customExistingClientId"
                        class="cif-client-combo-option"
                        @mousedown.prevent="selectAddressBookClient(c)"
                      >
                        {{ c.label }}
                      </li>
                    </ul>
                  </div>
                  <p
                    v-if="
                      clientPickerOpen &&
                      addressBookClients.length > 0 &&
                      filteredAddressBookClients.length === 0
                    "
                    class="cif-field-hint"
                  >
                    No matching clients.
                  </p>
                  <p v-if="!addressBookLoading && !addressBookClients.length" class="cif-field-hint">
                    No clients found. Add a client first or use New Client.
                  </p>
                </div>
              </template>

              <div class="cif-field">
                <Label class="cif-label" for="cif-custom-project-title">{{ projectTitleLabel }}</Label>
                <Input
                  id="cif-custom-project-title"
                  v-model="customProjectTitle"
                  class="cif-field-input"
                  :placeholder="projectTitleInputPlaceholder"
                  autocomplete="off"
                />
              </div>

              <div class="cif-field">
                <span class="cif-label">Project type</span>
                <div class="cif-payment-cards" role="group" aria-label="Project payment type">
                  <button
                    type="button"
                    class="cif-payment-card"
                    :class="{ 'cif-payment-card--active': customPaymentKind === 'single' }"
                    @click="customPaymentKind = 'single'"
                  >
                    <span class="cif-payment-card-radio" aria-hidden="true" />
                    <span class="cif-payment-card-copy">
                      <span class="cif-payment-card-title">{{
                        isCustomExistingClientForm ? "Single Payment" : "Single payment"
                      }}</span>
                      <span class="cif-payment-card-sub">{{
                        isCustomExistingClientForm
                          ? "Receive one lump sum payment for the entire project"
                          : "One lump sum for the whole project."
                      }}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    class="cif-payment-card"
                    :class="{ 'cif-payment-card--active': customPaymentKind === 'deliverables' }"
                    @click="customPaymentKind = 'deliverables'"
                  >
                    <span class="cif-payment-card-radio" aria-hidden="true" />
                    <span class="cif-payment-card-copy">
                      <span class="cif-payment-card-title">Deliverables</span>
                      <span class="cif-payment-card-sub">{{
                        isCustomExistingClientForm
                          ? "Split payment across multiple items"
                          : "Split the total across multiple line items."
                      }}</span>
                    </span>
                  </button>
                </div>
              </div>

              <div class="cif-field">
                <div class="cif-items-head">
                  <Label class="cif-label cif-items-title">Items</Label>
                  <button
                    v-if="customPaymentKind === 'deliverables'"
                    type="button"
                    class="cif-btn-add-row"
                    @click="addCustomLineItem"
                  >
                    {{ isCustomExistingClientForm ? "Add New" : "Add new" }}
                  </button>
                </div>
                <div class="cif-items-table" role="table" aria-label="Invoice line items">
                  <div class="cif-items-row cif-items-row--head" role="row">
                    <span role="columnheader">Description</span>
                    <span role="columnheader">Amount</span>
                    <span v-if="customPaymentKind === 'deliverables'" class="cif-items-actions-h" aria-hidden="true" />
                  </div>
                  <div v-for="(row, idx) in customLineItems" :key="row.id" class="cif-items-row" role="row">
                    <Input
                      v-model="row.description"
                      class="cif-field-input cif-items-desc"
                      :placeholder="lineItemDescPlaceholder"
                      :aria-label="`Item ${idx + 1} description`"
                    />
                    <div class="cif-money cif-money--item">
                      <Input
                        :model-value="row.amount"
                        class="cif-money-input"
                        placeholder="0"
                        inputmode="decimal"
                        :aria-label="`Item ${idx + 1} amount`"
                        @update:model-value="(v) => onLineItemAmountInput(row.id, v)"
                      />
                      <span class="cif-money-suffix">{{ currencyCode }}</span>
                    </div>
                    <div v-if="customPaymentKind === 'deliverables'" class="cif-items-actions">
                      <button
                        v-if="customLineItems.length > 1"
                        type="button"
                        class="cif-icon-btn"
                        aria-label="Remove line"
                        @click="removeCustomLineItem(row.id)"
                      >
                        <Trash2 class="cif-trash-icon" :stroke-width="2" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="cif-field">
                <Label class="cif-label">Total</Label>
                <div class="cif-money cif-money--readonly">
                  <span class="cif-money-readonly">{{ totalAmountDisplay || "0" }}</span>
                  <span class="cif-money-suffix">{{ currencyCode }}</span>
                </div>
              </div>

              <div class="cif-field">
                <Label class="cif-label">{{ taxSectionLabel }}</Label>
                <div class="cif-tax">
                  <label class="cif-radio" :class="{ 'cif-radio--active': gstInclusive }">
                    <input v-model="gstInclusive" type="radio" class="sr-only" :value="true" />
                    <span class="cif-radio-visual" aria-hidden="true" />
                    <span class="cif-radio-body">
                      <span class="cif-radio-title">Including GST</span>
                      <span class="cif-radio-sub">All the taxes are included in your total fee.</span>
                    </span>
                  </label>
                  <label class="cif-radio" :class="{ 'cif-radio--active': !gstInclusive }">
                    <input v-model="gstInclusive" type="radio" class="sr-only" :value="false" />
                    <span class="cif-radio-visual" aria-hidden="true" />
                    <span class="cif-radio-body">
                      <span class="cif-radio-title">Exclusive of GST</span>
                      <span class="cif-radio-sub">Tax is added on top of your quoted fee.</span>
                    </span>
                  </label>
                </div>
                <div v-if="gstInclusive && estimatedGstAmount != null" class="cif-estimate">
                  Estimated GST:
                  <strong>
                    {{ currencyCode }}
                    {{ estimatedGstAmount.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}
                  </strong>
                  Based on the amount entered.
                </div>
              </div>

              <div class="cif-row-dates">
                <div class="cif-field">
                  <Label class="cif-label">Issue Date</Label>
                  <DateSelect v-model="issueDateIso" display-format="mon d, yyyy" />
                </div>
                <div class="cif-field">
                  <Label class="cif-label">Due Date</Label>
                  <DateSelect v-model="dueDateIso" display-format="dd/mm/yyyy" placeholder="DD/MM/YYYY" />
                </div>
              </div>

              <div class="cif-field">
                <Label class="cif-label">Note</Label>
                <textarea
                  v-model="note"
                  class="cif-textarea"
                  rows="4"
                  :placeholder="notePlaceholder"
                ></textarea>
              </div>
            </div>
          </template>
        </template>
      </template>

      <template v-else-if="step === 2">
        <h2 class="cif-section-title">Template Style</h2>
        <div class="cif-field">
          <Label class="cif-label">Choose Template</Label>
          <select v-model="visualTemplate" class="cif-select">
            <option value="classic">Classic</option>
            <option value="modern">Modern</option>
          </select>
        </div>
        <div class="cif-field">
          <Label class="cif-label">Choose Currency</Label>
          <select v-model="currencyCode" class="cif-select">
            <option value="PKR">PKR</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
        <div class="cif-field">
          <Label class="cif-label">Notes</Label>
          <textarea
            v-model="invoiceNotes"
            class="cif-textarea"
            rows="4"
            placeholder="Notes on the invoice"
          ></textarea>
        </div>

        <h2 class="cif-section-title">Terms</h2>
        <div class="cif-toggle cif-toggle--small" role="group">
          <button
            type="button"
            class="cif-toggle-btn"
            :class="{ 'cif-toggle-btn--on': termsMode === 'existing' }"
            @click="termsMode = 'existing'"
          >
            Existing
          </button>
          <button
            type="button"
            class="cif-toggle-btn"
            :class="{ 'cif-toggle-btn--on': termsMode === 'custom' }"
            @click="termsMode = 'custom'"
          >
            Custom
          </button>
        </div>

        <div v-if="termsMode === 'existing'" class="cif-field">
          <Label class="cif-label">Select a term template</Label>
          <select v-model="selectedTermsTemplateId" class="cif-select" :disabled="termsLoading || !termsTemplates.length">
            <option v-if="!termsLoading && !termsTemplates.length" value="" disabled>No templates found</option>
            <option v-for="t in termsTemplates" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
        </div>

        <div v-else class="cif-field">
          <Label class="cif-label">Term template name</Label>
          <Input
            v-model="customTermsTemplateName"
            class="cif-field-input"
            placeholder="e.g. General, Net-15, Late fee"
            autocomplete="off"
          />
          <p class="cif-field-hint">This name is for your reference while creating custom terms.</p>
        </div>

        <div class="cif-field">
          <Label class="cif-label">Terms &amp; Conditions</Label>
          <textarea v-model="termsText" class="cif-textarea" rows="6"></textarea>
        </div>
        <p v-if="termsMode === 'existing'" class="cif-field-hint">Text loads from the selected template. Switch to Custom to write your own.</p>
      </template>

      <div
        class="cif-footer"
        :class="{
          'cif-footer--intake': isCustomNewClientPhase1,
          'cif-footer--existing-custom': isCustomExistingClientForm,
        }"
      >
        <div v-if="isCustomExistingClientForm" class="cif-footer-user">
          <span class="cif-footer-user-name">{{ displayLabel || "—" }}</span>
          <span v-if="issuerOrgLine" class="cif-footer-user-org">{{ issuerOrgLine }}</span>
        </div>
        <button
          v-else-if="!isCustomNewClientPhase1"
          type="button"
          class="cif-btn cif-btn--ghost"
          @click="onBack"
        >
          Back
        </button>
        <button
          v-if="step === 1"
          type="button"
          class="cif-btn cif-btn--primary"
          :class="{ 'cif-btn--intake-continue': isCustomNewClientPhase1 }"
          :disabled="creatingNewClient || creatingCustomProject"
          @click="onContinue"
        >
          {{ creatingNewClient || creatingCustomProject ? "…" : "Continue" }}
        </button>
        <button
          v-else
          type="button"
          class="cif-btn cif-btn--primary"
          :disabled="termsLoading || creatingDraft || issuing"
          @click="onContinueFromTemplateStyle"
        >
          {{ creatingDraft || issuing ? "…" : "Send invoice" }}
        </button>
      </div>
    </div>

    <Dialog v-model:open="issuedPdfModalOpen" @update:open="onIssuedPdfDialogOpenChange">
      <DialogContent class="cif-issued-pdf-dialog" :show-close-button="false">
        <div class="cif-issued-pdf-head">
          <h2 class="cif-issued-pdf-title">Invoice</h2>
          <div class="cif-issued-pdf-head-actions">
            <button
              type="button"
              class="cif-issued-pdf-icon-btn"
              :disabled="!issuedPdfBlob || issuedPdfLoading"
              aria-label="Download PDF"
              title="Download PDF"
              @click="downloadIssuedPdf"
            >
              <Download class="size-5" stroke-width="2" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="cif-issued-pdf-icon-btn"
              aria-label="Close"
              title="Close"
              @click="issuedPdfModalOpen = false"
            >
              <X class="size-5" stroke-width="2" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div class="cif-issued-pdf-body">
          <div v-if="issuedPdfLoading" class="cif-issued-pdf-loading">Loading PDF…</div>
          <iframe
            v-else-if="issuedPdfObjectUrl"
            :src="issuedPdfObjectUrl"
            class="cif-issued-pdf-iframe"
            title="Invoice PDF preview"
          />
          <p v-else-if="issuedPdfLoadError" class="cif-issued-pdf-error">{{ issuedPdfLoadError }}</p>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.cif {
  min-height: 100%;
  padding: 8px 0 40px;
  background: transparent;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  overflow-x: clip;
}

.cif--new-client-intake {
  margin: -16px -16px -28px;
  padding: 24px clamp(12px, 4vw, 20px) 48px;
  min-height: calc(100dvh - 120px);
  background: #f8f9fb;
  box-sizing: border-box;
}

.cif-inner {
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.cif-form-panel {
  background: #f8f9fa;
  border-radius: 12px;
  padding: 24px clamp(16px, 3vw, 28px) 28px;
  margin-bottom: 8px;
  box-sizing: border-box;
  width: 100%;
}

.cif-form-panel #cif-custom-project-title,
.cif-form-panel .cif-items-desc {
  border: none !important;
  box-shadow: none !important;
}

.cif-form-panel #cif-custom-project-title:focus-visible,
.cif-form-panel .cif-items-desc:focus-visible {
  outline: 2px solid #0f172a;
  outline-offset: 2px;
}

.cif-field--client-combo {
  position: relative;
  z-index: 2;
}

.cif-client-combo {
  position: relative;
}

.cif-client-combo-control {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 0 12px 0 14px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  box-sizing: border-box;
}

.cif-client-combo--open .cif-client-combo-control {
  border-color: #0f172a;
}

.cif-client-combo-icon {
  flex-shrink: 0;
  color: #64748b;
}

.cif-client-combo-input {
  flex: 1;
  min-width: 0;
  height: 44px;
  border: none !important;
  background: transparent !important;
  font-size: 0.9375rem !important;
  color: #0f172a;
  box-shadow: none !important;
  outline: none;
}

.cif-client-combo-input::placeholder {
  color: #94a3b8;
}

.cif-client-combo-input:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.cif-client-combo-chevron {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
}

.cif-client-combo-chevron:hover {
  background: #f1f5f9;
  color: #0f172a;
}

.cif-client-combo-chevron-icon {
  width: 18px;
  height: 18px;
  transition: transform 0.15s ease;
}

.cif-client-combo-chevron-icon--up {
  transform: rotate(180deg);
}

.cif-client-combo-list {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 6px);
  margin: 0;
  padding: 6px;
  list-style: none;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 10px 40px rgba(15, 23, 42, 0.1);
  z-index: 20;
  box-sizing: border-box;
}

.cif-client-combo-option {
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 0.875rem;
  color: #0f172a;
  cursor: pointer;
}

.cif-client-combo-option:hover,
.cif-client-combo-option:focus {
  background: #f1f5f9;
  outline: none;
}

.cif-head {
  margin-bottom: 20px;
}

.cif-title {
  margin: 0;
  font-size: 1.625rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #0f172a;
}

.cif-toggle {
  display: inline-flex;
  padding: 4px;
  border-radius: 999px;
  background: #e8eaef;
  gap: 4px;
  margin-bottom: 20px;
}

.cif-toggle-btn {
  border: none;
  background: transparent;
  padding: 10px 20px;
  border-radius: 999px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  min-width: 0;
  flex: 0 1 auto;
}

.cif-toggle-btn--on {
  background: #0f172a;
  color: #fff;
}

.cif-toggle--project-custom {
  background: #e8eaef;
}

.cif-toggle--project-custom .cif-toggle-btn:not(.cif-toggle-btn--on) {
  background: #ffffff;
  color: #64748b;
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.06);
}

.cif-toggle--project-custom .cif-toggle-btn--on {
  background: #0f172a;
  color: #ffffff;
  box-shadow: none;
}

.cif-toggle--client-source {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  background: #e8eaef;
}

.cif-toggle--client-source .cif-toggle-btn:not(.cif-toggle-btn--on) {
  background: #dce1ea;
  color: #64748b;
}

.cif-toggle--client-source .cif-toggle-btn--on {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
}

.cif-toggle--client-kind {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  background: #e8eaef;
}

.cif-toggle--client-kind .cif-toggle-btn:not(.cif-toggle-btn--on) {
  background: #dce1ea;
  color: #64748b;
}

.cif-toggle--client-kind .cif-toggle-btn--on {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 0 0 1px #cbd5e1;
}

.cif-toggle--small {
  margin-bottom: 16px;
}

.cif-toggle--segmented {
  display: flex;
  width: 100%;
  box-sizing: border-box;
}

.cif-toggle-btn--grow {
  flex: 1 1 0;
  min-width: 0;
  text-align: center;
  line-height: 1.25;
  hyphens: auto;
}

.cif-kind-question {
  display: block;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 10px;
}

.cif-field--tight {
  margin-bottom: 20px;
}

.cif-field--flush {
  margin-bottom: 0;
}

@media (max-width: 559px) {
  .cif-field--flush {
    margin-bottom: 16px;
  }
}

.cif-new-client {
  margin-top: 8px;
  margin-bottom: 0;
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
}

.cif-new-client-fields {
  display: flex;
  flex-direction: column;
  gap: 22px;
  width: 100%;
  min-width: 0;
}

.cif-new-client-fields .cif-field {
  margin-bottom: 0;
}

/* Two-column grid: true 50/50 split (gap subtracted by grid); single fields use left column only */
.cif-nc-row--one-half,
.cif-nc-row--two-half {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  column-gap: 16px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.cif-nc-row--one-half > .cif-field {
  grid-column: 1;
  min-width: 0;
}

.cif-nc-row--two-half > .cif-field {
  min-width: 0;
}

@media (max-width: 520px) {
  .cif-nc-row--one-half {
    grid-template-columns: minmax(0, 1fr);
  }

  .cif-nc-row--one-half > .cif-field {
    grid-column: auto;
  }

  .cif-nc-row--two-half {
    grid-template-columns: minmax(0, 1fr);
    row-gap: 16px;
  }
}

.cif-field--intake {
  margin-bottom: 22px;
}

.cif-field-input--intake {
  height: 48px !important;
  min-height: 48px !important;
  border-radius: 14px !important;
  border: 1px solid #e2e8f0 !important;
  background: #ffffff !important;
  font-size: 0.9375rem !important;
}

/* Fills grid/flex cell reliably (same idea as element.style width: -webkit-fill-available) */
.cif-field-input--fill-available {
  box-sizing: border-box !important;
  min-width: 0 !important;
  max-width: 100% !important;
  width: 100% !important;
  width: -moz-available !important;
  width: -webkit-fill-available !important;
  width: stretch !important;
}

.cif-textarea--intake {
  border-radius: 14px !important;
  border: 1px solid #e2e8f0 !important;
  background: #ffffff !important;
}

.cif-field-input {
  height: 44px !important;
  min-height: 44px !important;
  border-radius: 10px !important;
  font-size: 0.9375rem !important;
}

.cif-textarea--new-client {
  min-height: 88px;
  font-size: 0.9375rem;
  border-radius: 12px;
  background: #fff;
}

.cif-bill-to {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin: 0 0 18px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  flex-wrap: wrap;
}

.cif-bill-to-inner {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.cif-bill-to-label {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #94a3b8;
}

.cif-bill-to-name {
  font-size: 0.9375rem;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.35;
  word-break: break-word;
}

.cif-bill-to-email {
  font-size: 0.8125rem;
  color: #64748b;
}

.cif-bill-to-edit {
  flex-shrink: 0;
  margin-top: 2px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #fff;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #334155;
  cursor: pointer;
}

.cif-bill-to-edit:hover {
  border-color: #cbd5e1;
  color: #0f172a;
  background: #f8fafc;
}

.cif-footer--intake {
  justify-content: flex-end;
  margin-top: 8px;
  padding-top: 28px;
  border-top: none;
}

.cif-btn--intake-continue {
  min-width: 132px;
  height: 48px;
  padding: 0 32px;
  border-radius: 999px;
  font-size: 0.9375rem;
  font-weight: 600;
}

.cif-hint {
  margin: -12px 0 16px;
  font-size: 0.8125rem;
  color: #64748b;
}

.cif-field {
  margin-bottom: 18px;
}

.cif-label {
  display: block;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #334155;
  margin-bottom: 8px;
}

.cif-money {
  display: flex;
  align-items: stretch;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  overflow: hidden;
}

.cif-money-input {
  flex: 1;
  min-width: 0;
  border: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  height: 44px;
}

.cif-money-suffix {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 14px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #475569;
  background: #f8fafc;
  border-left: 1px solid #e2e8f0;
  white-space: nowrap;
}

.cif-money--readonly {
  background: #f8fafc;
}

.cif-money-readonly {
  display: flex;
  align-items: center;
  flex: 1;
  min-height: 44px;
  padding: 0 12px;
  font-size: 0.9375rem;
  font-weight: 600;
  color: #0f172a;
}

.cif-money--item {
  width: 100%;
  min-width: 0;
}

.cif-payment-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

@media (max-width: 520px) {
  .cif-payment-cards {
    grid-template-columns: 1fr;
  }
}

.cif-payment-card {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 2px solid #e2e8f0;
  background: #fff;
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: border-color 0.15s ease;
}

.cif-payment-card:hover {
  border-color: #cbd5e1;
}

.cif-payment-card--active {
  border-color: #0f172a;
}

.cif-payment-card-radio {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  border-radius: 50%;
  border: 2px solid #cbd5e1;
  background: #fff;
  box-sizing: border-box;
}

.cif-payment-card--active .cif-payment-card-radio {
  border-color: #0f172a;
  box-shadow: inset 0 0 0 4px #0f172a;
}

.cif-payment-card-copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}

.cif-payment-card-title {
  font-size: 0.9375rem;
  font-weight: 700;
  color: #0f172a;
}

.cif-payment-card-sub {
  font-size: 0.8125rem;
  color: #64748b;
  line-height: 1.4;
}

.cif-items-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.cif-items-title {
  margin-bottom: 0;
}

.cif-btn-add-row {
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid #0f172a;
  background: #fff;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #0f172a;
  cursor: pointer;
}

.cif-btn-add-row:hover {
  background: #f8fafc;
}

.cif-items-table {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cif-items-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(200px, 320px) auto;
  gap: 10px;
  align-items: center;
}

.cif-items-row--head {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
}

.cif-items-row--head span[role="columnheader"] {
  padding-left: 2px;
}

.cif-items-desc {
  width: 100%;
  min-width: 0;
}

.cif-items-actions,
.cif-items-actions-h {
  width: 40px;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
}

.cif-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #dc2626;
  cursor: pointer;
}

.cif-icon-btn:hover {
  background: #fef2f2;
}

.cif-trash-icon {
  width: 18px;
  height: 18px;
}

.cif-tax {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cif-radio {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 2px solid #e2e8f0;
  background: #fff;
  cursor: pointer;
}

.cif-radio--active {
  border-color: #0f172a;
}

.cif-radio-visual {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  border-radius: 50%;
  border: 2px solid #cbd5e1;
  background: #fff;
  box-sizing: border-box;
}

.cif-radio--active .cif-radio-visual {
  border-color: #0f172a;
  box-shadow: inset 0 0 0 4px #0f172a;
}

.cif-radio-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.cif-radio-title {
  font-weight: 600;
  font-size: 0.875rem;
  color: #0f172a;
}

.cif-radio-sub {
  display: block;
  font-size: 0.8125rem;
  color: #64748b;
  line-height: 1.4;
}

.cif-estimate {
  margin-top: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  background: #fff9e6;
  border: 1px solid #f59e0b;
  font-size: 0.875rem;
  color: #78350f;
  line-height: 1.45;
}

.cif-invoice-source-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.cif-invoice-source-title {
  margin-bottom: 0;
}

.cif-invoice-source-count {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #64748b;
  white-space: nowrap;
}

.cif-invoice-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

@media (max-width: 720px) {
  .cif-invoice-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 480px) {
  .cif-invoice-grid {
    grid-template-columns: 1fr;
  }
}

.cif-inv-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  text-align: left;
  padding: 12px 12px 14px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #fff;
  cursor: pointer;
  font: inherit;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.cif-inv-card:hover {
  border-color: #cbd5e1;
}

.cif-inv-card--selected {
  border-color: #334155;
  box-shadow: 0 0 0 1px #334155;
}

.cif-inv-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.cif-inv-num {
  font-size: 0.8125rem;
  font-weight: 700;
  color: #0f172a;
}

.cif-inv-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
  color: #0f172a;
  background: #f1f5f9;
}

.cif-inv-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #0f172a;
  flex-shrink: 0;
}

.cif-inv-card-mid {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-top: auto;
}

.cif-inv-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cif-inv-col--end {
  align-items: flex-end;
  text-align: right;
}

.cif-inv-meta {
  font-size: 0.6875rem;
  font-weight: 600;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.cif-inv-amt {
  font-size: 0.9375rem;
  font-weight: 700;
  color: #0f172a;
}

.cif-inv-due {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #475569;
}

.cif-invoice-grid-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  margin-top: 14px;
  padding: 8px;
  border: none;
  background: transparent;
  font-size: 0.875rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
}

.cif-invoice-grid-toggle:hover {
  color: #0f172a;
}

.cif-invoice-grid-chevron {
  width: 18px;
  height: 18px;
}

.cif-milestone-source-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.cif-milestone-details-toggle {
  background: transparent;
  border: 0;
  padding: 0;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.cif-milestone-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 10px;
}

.cif-ms-card {
  display: grid;
  grid-template-columns: 22px 1fr;
  gap: 10px;
  width: 100%;
  text-align: left;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
  padding: 12px 12px;
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;
}

.cif-ms-card:hover {
  border-color: #d1d5db;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02);
}

.cif-ms-card--selected {
  border-color: #cbd5e1;
  background: #fbfdff;
}

.cif-ms-card--locked {
  opacity: 0.55;
  cursor: not-allowed;
}

.cif-ms-check {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 4px;
}

.cif-ms-check-box {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1.5px solid #cbd5e1;
  background: #fff;
  position: relative;
}

.cif-ms-check-box--on {
  border-color: #0f172a;
  background: #0f172a;
}

.cif-ms-check-box--on::after {
  content: "✓";
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -56%);
  width: auto;
  height: auto;
  border: none;
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
  color: #fff;
}

.cif-ms-check-box--locked {
  border-color: #e5e7eb;
  background: #f3f4f6;
}

.cif-ms-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cif-ms-seq {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: #e5e7eb;
  color: #111827;
  font-size: 12px;
  font-weight: 700;
}

.cif-ms-kind {
  font-size: 13px;
  font-weight: 700;
  color: #111827;
}

.cif-ms-title {
  margin-top: 6px;
  font-weight: 700;
  color: #111827;
  font-size: 13px;
}

.cif-ms-desc {
  margin-top: 4px;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.35;
  max-height: calc(1.35em * 2);
  overflow: hidden;
}

.cif-ms-bottom {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.cif-ms-due {
  color: #6b7280;
  font-size: 12px;
}

.cif-ms-amt {
  color: #111827;
  font-size: 12px;
  font-weight: 700;
}

.cif-milestone-grid-toggle {
  margin-top: 10px;
  width: 100%;
  border: 1px solid #e5e7eb;
  background: #fff;
  border-radius: 999px;
  padding: 8px 12px;
  font-weight: 700;
  color: #111827;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
}

.cif-milestone-grid-chevron {
  width: 16px;
  height: 16px;
}

.cif-row-dates {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

@media (max-width: 520px) {
  .cif-row-dates {
    grid-template-columns: 1fr;
  }
}

.cif-textarea {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font: inherit;
  font-size: 0.875rem;
  resize: vertical;
  min-height: 100px;
}

.cif-textarea:focus {
  outline: none;
  border-color: #0f172a;
  box-shadow: none;
}

.cif-section-title {
  margin: 8px 0 14px;
  font-size: 1.05rem;
  font-weight: 700;
  color: #0f172a;
}

.cif-select {
  width: 100%;
  max-width: 100%;
  height: 44px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  font-size: 0.875rem;
  background: #fff;
  box-sizing: border-box;
  box-shadow: none;
}

.cif-select:focus {
  outline: none;
  border-color: #0f172a;
  box-shadow: none;
}

.cif-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid #e2e8f0;
}

.cif-footer--existing-custom {
  margin-top: 0;
  padding: 20px 0 8px;
  border-top: 1px solid #e5e7eb;
  background: transparent;
}

.cif-footer-user {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.cif-footer-user-name {
  font-size: 0.9375rem;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.3;
}

.cif-footer-user-org {
  font-size: 0.8125rem;
  color: #64748b;
  line-height: 1.3;
}

.cif-btn {
  min-width: 120px;
  height: 44px;
  padding: 0 20px;
  border-radius: 10px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}

.cif-btn--ghost {
  border: 1px solid #0f172a;
  background: #fff;
  color: #0f172a;
}

.cif-btn--primary {
  border: none;
  background: #0f172a;
  color: #fff;
}

.cif-btn--primary:hover {
  background: #1e293b;
}

.cif-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.cif-field-hint {
  margin: 6px 0 0;
  font-size: 0.75rem;
  color: #64748b;
}

@media (max-width: 559px) {
  .cif-toggle--project-custom .cif-toggle-btn {
    padding: 10px 14px;
    font-size: 0.8125rem;
  }

  .cif-toggle-btn--grow {
    padding: 10px 10px;
    font-size: 0.8125rem;
  }

  .cif-title {
    font-size: 1.375rem;
  }
}

@media (max-width: 480px) {
  .cif-bill-to {
    flex-direction: column;
    align-items: stretch;
  }

  .cif-bill-to-edit {
    align-self: flex-end;
    margin-top: 4px;
  }

  .cif-invoice-source-head {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  .cif-invoice-source-count {
    white-space: normal;
  }
}

@media (max-width: 560px) {
  .cif-items-row--head {
    display: none;
  }

  .cif-items-row:not(.cif-items-row--head) {
    grid-template-columns: 1fr;
    gap: 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid #f1f5f9;
  }

  .cif-items-row:not(.cif-items-row--head):last-child {
    border-bottom: none;
    padding-bottom: 0;
  }

  .cif-items-row:not(.cif-items-row--head) > .cif-items-desc {
    grid-column: 1 / -1;
  }

  .cif-items-row:not(.cif-items-row--head) > .cif-money--item {
    grid-column: 1 / -1;
    max-width: none;
    width: 100%;
  }

  .cif-items-row:not(.cif-items-row--head) > .cif-items-actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
    width: 100%;
    margin-top: -4px;
  }

  .cif-items-table {
    gap: 14px;
  }
}

@media (max-width: 420px) {
  .cif-footer:not(.cif-footer--intake) {
    flex-direction: column-reverse;
    align-items: stretch;
  }

  .cif-footer:not(.cif-footer--intake) .cif-btn {
    width: 100%;
    min-width: 0;
  }
}

.cif-issued-pdf-dialog {
  max-width: min(92vw, 880px) !important;
  width: 100%;
  padding: 0 !important;
  gap: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: min(90dvh, 900px);
}

.cif-issued-pdf-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.cif-issued-pdf-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  color: #0f172a;
}

.cif-issued-pdf-head-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.cif-issued-pdf-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #475569;
  cursor: pointer;
}

.cif-issued-pdf-icon-btn:hover:not(:disabled) {
  background: #f1f5f9;
  color: #0f172a;
}

.cif-issued-pdf-icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.cif-issued-pdf-body {
  min-height: 200px;
  max-height: min(72dvh, 760px);
  background: #f8fafc;
}

.cif-issued-pdf-loading {
  padding: 48px 24px;
  text-align: center;
  font-size: 0.9375rem;
  color: #64748b;
}

.cif-issued-pdf-iframe {
  width: 100%;
  height: min(72dvh, 760px);
  border: none;
  display: block;
  background: #fff;
}

.cif-issued-pdf-error {
  margin: 0;
  padding: 24px;
  font-size: 0.875rem;
  color: #b91c1c;
  line-height: 1.5;
}
</style>

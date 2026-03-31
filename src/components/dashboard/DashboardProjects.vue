<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient as createClientApi, getClients, getProjects } from "@/lib/api";
import { useAlerts } from "@/composables/useAlerts";

type BaseClientRow = {
  id: string;
  type: "brand" | "individual";
  clientName: string;
  brandName?: string;
  email?: string;
  mobileNumber?: string;
  status: "active" | "inactive";
  notes?: string;
  createdAt: string;
};

type ClientRow = BaseClientRow & {
  companyLine: string;
  totalSpendFormatted: string;
  projectCount: number;
  startedLabel: string;
};

const emit = defineEmits<{
  (e: "open-new-project"): void;
  (e: "open-project-details", projectId: string): void;
  (e: "request-tab", tab: "projects" | "clients" | "draft"): void;
}>();
const props = withDefaults(
  defineProps<{
    initialTab?: "projects" | "clients" | "draft";
    lockTab?: "projects" | "clients" | "draft";
  }>(),
  {
    initialTab: "projects",
    lockTab: undefined,
  }
);

const { pushAlert } = useAlerts();

const activeTab = ref<"projects" | "clients" | "draft">(props.initialTab);
const searchQuery = ref("");
/** Card grid (default) vs table list — matches design mockup */
const projectsViewMode = ref<"grid" | "list">("grid");
const PROJECTS_PAGE_SIZE = 12;
const projectsPage = ref(1);

watch(
  () => props.initialTab,
  (nextTab) => {
    if (!props.lockTab) activeTab.value = nextTab;
  },
);

watch(
  () => props.lockTab,
  (nextLocked) => {
    if (nextLocked) {
      activeTab.value = nextLocked;
      return;
    }
    activeTab.value = props.initialTab;
  },
  { immediate: true },
);

type ProjectRow = {
  id: string;
  title: string;
  clientName: string;
  amountLabel: string;
  /** Numeric amount formatted for display (e.g. "250,000") */
  amountFormatted: string;
  paymentType: string;
  dueDate: string;
  status: string;
};

type ProjectStatus =
  | "signed"
  | "completed"
  | "in-dispute"
  | "in-progress"
  | "draft"
  | "delayed"
  | "payment-due";

const isLoadingProjects = ref(false);
const projects = ref<ProjectRow[]>([]);
const clients = ref<ClientRow[]>([]);
const drafts = ref([]);

const isAddClientOpen = ref(false);
const addClientForm = reactive({
  type: "brand" as "brand" | "individual",
  clientName: "",
  brandName: "",
  email: "",
  mobileNumber: "",
  status: "active" as "active" | "inactive",
  notes: "",
});

const showEmptyState = computed(() => {
  if (activeTab.value === "projects") return projects.value.length === 0;
  if (activeTab.value === "clients") return clients.value.length === 0;
  return drafts.value.length === 0;
});
const canCreateClient = computed(() => addClientForm.clientName.trim().length > 0);
const filteredProjects = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return projects.value;
  return projects.value.filter((p) =>
    [p.title, p.clientName, p.status, p.paymentType].join(" ").toLowerCase().includes(q),
  );
});

const filteredClients = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return clients.value;
  return clients.value.filter((c) => {
    const hay = [c.clientName, c.companyLine, c.brandName, c.email, c.mobileNumber]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
});

const tabCounts = computed(() => ({
  projects: projects.value.length,
  clients: clients.value.length,
  draft: drafts.value.length,
}));

const projectsTotalPages = computed(() =>
  Math.max(1, Math.ceil(filteredProjects.value.length / PROJECTS_PAGE_SIZE)),
);

const paginatedProjects = computed(() => {
  const start = (projectsPage.value - 1) * PROJECTS_PAGE_SIZE;
  return filteredProjects.value.slice(start, start + PROJECTS_PAGE_SIZE);
});

const projectsPageNumbers = computed(() => {
  const total = projectsTotalPages.value;
  const cur = projectsPage.value;
  const window = 4;
  const pages: number[] = [];
  let start = Math.max(1, cur - Math.floor(window / 2));
  let end = Math.min(total, start + window - 1);
  if (end - start + 1 < window) start = Math.max(1, end - window + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  return pages;
});

watch([filteredProjects, searchQuery], () => {
  projectsPage.value = 1;
});

watch(projectsTotalPages, (total) => {
  if (projectsPage.value > total) projectsPage.value = total;
});

function normalizePaymentType(paymentType: string): string {
  const value = paymentType.trim().toLowerCase();
  if (value === "single") return "Single";
  if (value === "multiple") return "Multiple";
  if (value === "recurring") return "Recurring";
  if (value === "deliverables" || value === "deliverable") return "Deliverables";
  return paymentType;
}

function normalizeStatus(status: string): ProjectStatus {
  const value = status.trim().toLowerCase();
  if (value.includes("payment") && (value.includes("due") || value.includes("overdue")))
    return "payment-due";
  if (value.includes("delay")) return "delayed";
  if (value.includes("in_progress") || value.includes("in-progress")) return "in-progress";
  if (value.includes("draft")) return "draft";
  if (value.includes("complete")) return "completed";
  if (value.includes("dispute")) return "in-dispute";
  return "signed";
}

function normalizeClientStatus(status: unknown): "active" | "inactive" {
  const value = String(status ?? "")
    .trim()
    .toLowerCase();
  return value === "inactive" ? "inactive" : "active";
}

function statusLabel(status: string): string {
  const normalized = normalizeStatus(status);
  if (normalized === "in-progress") return "In Progress";
  if (normalized === "draft") return "Draft";
  if (normalized === "completed") return "Completed";
  if (normalized === "in-dispute") return "In Dispute";
  if (normalized === "delayed") return "Delayed";
  if (normalized === "payment-due") return "Payment Due";
  return "Signed";
}

function statusClass(status: string): string {
  return `dashboard-status-pill--${normalizeStatus(status)}`;
}

/** Display due date as DD-MM-YY when parsable */
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

function setProjectsPage(n: number) {
  projectsPage.value = Math.min(Math.max(1, n), projectsTotalPages.value);
}

function prevProjectsPage() {
  setProjectsPage(projectsPage.value - 1);
}

function nextProjectsPage() {
  setProjectsPage(projectsPage.value + 1);
}

function openProjectDetails(projectId: string) {
  emit("open-project-details", projectId);
}

const emptyStateCopy = computed(() => {
  const map = {
    projects: {
      heading: "You have no projects yet",
      subtext: "Start documenting your projects",
      cta: "Create Project",
    },
    clients: {
      heading: "You have no Contacts yet",
      subtext: "Keep track of your client details in one place",
      cta: "Create Client",
    },
    draft: {
      heading: "You have no drafts yet",
      subtext: "Start a draft to continue later",
      cta: "Create Draft",
    },
  } as const;
  return map[activeTab.value] ?? map.projects;
});

function resetAddClientForm() {
  addClientForm.type = "brand";
  addClientForm.clientName = "";
  addClientForm.brandName = "";
  addClientForm.email = "";
  addClientForm.mobileNumber = "";
  addClientForm.status = "active";
  addClientForm.notes = "";
}

function openAddClient() {
  resetAddClientForm();
  isAddClientOpen.value = true;
}

function closeAddClient() {
  isAddClientOpen.value = false;
}

async function createClient() {
  const displayName = addClientForm.clientName.trim();
  if (!displayName) return;

  const payload = {
    type: addClientForm.type === "brand" ? ("brand" as const) : ("individual" as const),
    status: addClientForm.status,
    display_name: displayName,
    brand_name: addClientForm.type === "brand" ? addClientForm.brandName.trim() : "",
    email: addClientForm.email.trim(),
    phone: addClientForm.mobileNumber.trim(),
    meta: addClientForm.notes.trim() ? { notes: addClientForm.notes.trim() } : undefined,
  };

  console.groupCollapsed("[Clients] createClient payload");
  console.log(payload);
  console.groupEnd();

  try {
    const response = await createClientApi(payload);
    console.groupCollapsed("[Clients] createClient API response");
    console.log("status:", response?.status);
    console.log("headers:", response?.headers);
    console.log("data:", response?.data);
    console.groupEnd();

    const created = response?.data?.data ?? response?.data;
    const createdId = String(created?.id ?? created?.uuid ?? Date.now());
    const createdName = String(
      created?.display_name ?? created?.name ?? created?.brand_name ?? payload.display_name,
    );

    const anyData = response?.data as any;
    const serverMsg = anyData?.message ?? anyData?.success_message ?? anyData?.data?.message;
    if (!serverMsg) {
      pushAlert({
        kind: "success",
        title: "Created",
        message: `${createdName || "Client"} created successfully.`,
      });
    }

    const baseRow: BaseClientRow = {
      id: createdId,
      type: payload.type === "brand" ? "brand" : "individual",
      clientName: createdName,
      brandName: String(created?.brand_name ?? payload.brand_name ?? "").trim() || undefined,
      email: String(created?.email ?? payload.email ?? "").trim() || undefined,
      mobileNumber: String(created?.phone ?? payload.phone ?? "").trim() || undefined,
      status: normalizeClientStatus(created?.status ?? payload.status),
      notes: String(created?.meta?.notes ?? payload.meta?.notes ?? "").trim() || undefined,
      createdAt: String(created?.created_at ?? new Date().toISOString()),
    };
    clients.value.unshift({
      ...baseRow,
      companyLine:
        baseRow.type === "brand" ? (baseRow.brandName ?? "").trim() || "—" : "Individual",
      totalSpendFormatted: "0",
      projectCount: 0,
      startedLabel: formatDueDateDisplay(baseRow.createdAt),
    });

    closeAddClient();
  } catch (error: any) {
    console.groupCollapsed("[Clients] createClient API error");
    console.error(error);
    console.log("response status:", error?.response?.status);
    console.log("response data:", error?.response?.data);
    console.groupEnd();
  }
}

function onCreateClick() {
  if (activeTab.value === "projects") {
    emit("open-new-project");
    return;
  }
  if (activeTab.value === "clients") {
    openAddClient();
  }
  // draft flow TODO
}

function selectTab(tab: "projects" | "clients" | "draft") {
  if (props.lockTab === "clients" && tab !== "clients") {
    emit("request-tab", tab);
    return;
  }
  activeTab.value = tab;
}

function stableEmbeddedClientKey(client: any): string {
  const id = String(client?.id ?? client?.uuid ?? "")
    .trim();
  if (id) return id;
  return `noid:${String(client?.display_name ?? client?.name ?? client?.brand_name ?? "unknown")}`;
}

function mapApiClientToBase(client: any, index: number): BaseClientRow {
  const name = String(
    client?.display_name ?? client?.name ?? client?.brand_name ?? "Unnamed Client",
  );
  const typeValue = String(client?.type ?? "").trim().toLowerCase();
  const type: "brand" | "individual" = typeValue === "brand" ? "brand" : "individual";
  const brandName = String(client?.brand_name ?? "").trim() || undefined;
  const email = String(client?.email ?? "").trim() || undefined;
  const mobileNumber = String(client?.phone ?? client?.mobile_number ?? "").trim() || undefined;
  const realId = String(client?.id ?? client?.uuid ?? "").trim();
  return {
    id: realId || `client-${index}`,
    type,
    clientName: name,
    brandName,
    email,
    mobileNumber,
    status: normalizeClientStatus(client?.status),
    notes: String(client?.meta?.notes ?? "").trim() || undefined,
    createdAt: String(client?.created_at ?? new Date().toISOString()),
  };
}

function mapEmbeddedProjectClientToBase(client: any): BaseClientRow {
  const row = mapApiClientToBase(client, 0);
  row.id = stableEmbeddedClientKey(client);
  return row;
}

function companyLineFor(c: BaseClientRow): string {
  if (c.type === "brand") return (c.brandName ?? "").trim() || "—";
  return "Individual";
}

function extractClientsArray(raw: unknown): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.data)) return r.data as any[];
  const inner = r.data as Record<string, unknown> | undefined;
  if (inner && Array.isArray(inner.data)) return inner.data as any[];
  return [];
}

function normalizeStandaloneClientsResponse(raw: unknown): BaseClientRow[] {
  const list = extractClientsArray(raw);
  return list.map((c, i) => mapApiClientToBase(c, i));
}

function buildClientProjectStats(raw: any): Map<string, { spend: number; count: number; earliestMs: number | null }> {
  const list = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  const map = new Map<string, { spend: number; count: number; earliestMs: number | null }>();

  for (const item of list) {
    const amount = Number(item?.amount ?? item?.total_amount ?? item?.totalAmount ?? 0) || 0;
    const startRaw = String(item?.created_at ?? item?.start_date ?? item?.started_at ?? "");
    const itemClients = Array.isArray(item?.clients) ? item.clients : item?.client ? [item.client] : [];

    for (const client of itemClients) {
      const key = stableEmbeddedClientKey(client);
      const cur = map.get(key) ?? { spend: 0, count: 0, earliestMs: null as number | null };
      cur.spend += amount;
      cur.count += 1;
      if (startRaw) {
        const t = new Date(startRaw).getTime();
        if (!Number.isNaN(t)) {
          if (cur.earliestMs === null || t < cur.earliestMs) cur.earliestMs = t;
        }
      }
      map.set(key, cur);
    }
  }
  return map;
}

function mergeClientSources(apiRows: BaseClientRow[], projectRows: BaseClientRow[]): BaseClientRow[] {
  if (!apiRows.length) return projectRows;
  const byId = new Map<string, BaseClientRow>();
  for (const r of apiRows) byId.set(r.id, r);
  for (const r of projectRows) {
    if (!byId.has(r.id)) byId.set(r.id, r);
  }
  return Array.from(byId.values());
}

function enrichClientsWithStats(
  rows: BaseClientRow[],
  stats: Map<string, { spend: number; count: number; earliestMs: number | null }>,
): ClientRow[] {
  return rows.map((row) => {
    const stat = stats.get(row.id);
    const spend = stat?.spend ?? 0;
    const count = stat?.count ?? 0;
    const startedLabel =
      stat?.earliestMs != null
        ? formatDueDateDisplay(new Date(stat.earliestMs).toISOString())
        : formatDueDateDisplay(row.createdAt);
    return {
      ...row,
      companyLine: companyLineFor(row),
      totalSpendFormatted: spend.toLocaleString("en-PK"),
      projectCount: count,
      startedLabel,
    };
  });
}

function normalizeProjectsResponse(raw: any): ProjectRow[] {
  const list = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  return list.map((item: any) => {
    const primaryClient =
      (Array.isArray(item?.clients) ? item.clients[0] : undefined) ?? item?.client ?? null;
    const amount = item?.amount ?? item?.total_amount ?? item?.totalAmount ?? 0;
    const currency = item?.currency ?? item?.currency_code ?? "PKR";
    const numericAmount = Number(amount);
    const amountLabel = Number.isFinite(numericAmount)
      ? `${currency} ${numericAmount.toLocaleString("en-PK")}`
      : `${currency} ${String(amount ?? "0")}`;

    const amountFormatted = Number.isFinite(numericAmount)
      ? numericAmount.toLocaleString("en-PK")
      : String(amount ?? "0");

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
      amountLabel,
      amountFormatted,
      paymentType: String(item?.type ?? item?.payment_type ?? "single"),
      dueDate: String(item?.end_date ?? item?.due_date ?? "—"),
      status: String(item?.status ?? "draft"),
    };
  });
}

function normalizeClientsResponse(raw: any): BaseClientRow[] {
  const rows = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  const byKey = new Map<string, any>();

  for (const item of rows) {
    const itemClients = Array.isArray(item?.clients)
      ? item.clients
      : item?.client
        ? [item.client]
        : [];

    for (const client of itemClients) {
      const key = stableEmbeddedClientKey(client);
      if (!byKey.has(key)) {
        byKey.set(key, client);
      }
    }
  }

  return Array.from(byKey.values()).map((client: any) => mapEmbeddedProjectClientToBase(client));
}

async function loadProjects() {
  isLoadingProjects.value = true;
  try {
    const [projectsRes, clientsRes] = await Promise.all([
      getProjects(),
      getClients().catch(() => null),
    ]);
    console.groupCollapsed("[Dashboard] getProjects API Response");
    console.log("status:", projectsRes?.status);
    console.log("raw data:", projectsRes?.data);
    console.groupEnd();

    const rawProjects = projectsRes?.data;
    projects.value = normalizeProjectsResponse(rawProjects);
    const stats = buildClientProjectStats(rawProjects);
    const fromProjects = normalizeClientsResponse(rawProjects);
    const fromApi = clientsRes ? normalizeStandaloneClientsResponse(clientsRes.data) : [];
    const merged = mergeClientSources(fromApi, fromProjects);
    clients.value = enrichClientsWithStats(merged, stats);
  } catch (error) {
    console.error("Failed to fetch projects", error);
    projects.value = [];
    clients.value = [];
  } finally {
    isLoadingProjects.value = false;
  }
}

onMounted(() => {
  loadProjects();
});
</script>

<template>
  <div class="dashboard-projects-screen">
    <div class="dashboard-empty-wrap">
      <div class="dashboard-projects-header">
        <div class="dashboard-tabs">
          <button
            type="button"
            class="dashboard-tab"
            :class="{ 'dashboard-tab--active': activeTab === 'projects' }"
            @click="selectTab('projects')"
          >
            Projects
            <span class="dashboard-tab-badge">{{ tabCounts.projects }}</span>
          </button>
          <button
            type="button"
            class="dashboard-tab"
            :class="{ 'dashboard-tab--active': activeTab === 'clients' }"
            @click="selectTab('clients')"
          >
            Clients
            <span class="dashboard-tab-badge">{{ tabCounts.clients }}</span>
          </button>
          <button
            type="button"
            class="dashboard-tab"
            :class="{ 'dashboard-tab--active': activeTab === 'draft' }"
            @click="selectTab('draft')"
          >
            Draft
            <span class="dashboard-tab-badge">{{ tabCounts.draft }}</span>
          </button>
        </div>
        <button
          v-if="activeTab === 'projects' && !props.lockTab"
          type="button"
          class="dashboard-new-project-btn"
          @click="emit('open-new-project')"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke-linecap="round" />
          </svg>
          New Project
        </button>
        <button
          v-if="activeTab === 'clients' && clients.length > 0"
          type="button"
          class="dashboard-new-project-btn"
          @click="openAddClient"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke-linecap="round" />
          </svg>
          Create Client
        </button>
      </div>
      <div
        class="dashboard-empty-bar"
        :class="{
          'dashboard-empty-bar--projects': activeTab === 'projects' && !showEmptyState,
          'dashboard-empty-bar--spread': activeTab !== 'projects' || showEmptyState,
        }"
      >
        <div
          class="dashboard-empty-search"
          :class="{ 'dashboard-empty-search--wide': activeTab === 'projects' ? !showEmptyState : true }"
        >
          <svg
            class="dashboard-empty-search-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            v-model="searchQuery"
            type="search"
            class="dashboard-empty-search-input"
            placeholder="Search..."
            aria-label="Search"
          />
        </div>
        <div class="dashboard-list-actions">
          <button type="button" class="dashboard-empty-filters">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            Filters
          </button>
          <div v-if="activeTab === 'projects'" class="dashboard-view-toggle" role="group" aria-label="Project view">
            <button
              type="button"
              class="dashboard-view-toggle-btn"
              :class="{ 'dashboard-view-toggle-btn--active': projectsViewMode === 'grid' }"
              :aria-pressed="projectsViewMode === 'grid'"
              @click="projectsViewMode = 'grid'"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="7" height="7" rx="1.5" />
                <rect x="14" y="4" width="7" height="7" rx="1.5" />
                <rect x="3" y="13" width="7" height="7" rx="1.5" />
                <rect x="14" y="13" width="7" height="7" rx="1.5" />
              </svg>
              <span class="dashboard-view-toggle-sr">Grid</span>
            </button>
            <button
              type="button"
              class="dashboard-view-toggle-btn dashboard-view-toggle-btn--with-label"
              :class="{ 'dashboard-view-toggle-btn--active': projectsViewMode === 'list' }"
              :aria-pressed="projectsViewMode === 'list'"
              @click="projectsViewMode = 'list'"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round" />
              </svg>
              List
            </button>
          </div>
        </div>
      </div>
      <div v-if="isLoadingProjects && activeTab === 'projects'" class="dashboard-projects-list-placeholder">
        Loading projects...
      </div>
      <div v-else-if="isLoadingProjects && activeTab === 'clients'" class="dashboard-projects-list-placeholder">
        Loading clients...
      </div>
      <div v-else-if="showEmptyState" class="dashboard-empty-state">
        <div class="dashboard-empty-illustration" aria-hidden="true">
          <img class="dashboard-empty-illustration-img" src="@/assets/icons/empty.svg" alt="" />
        </div>
        <h2 class="dashboard-empty-heading" :class="{ 'dashboard-empty-heading--prominent': activeTab === 'clients' }">
          {{ emptyStateCopy.heading }}
        </h2>
        <p class="dashboard-empty-subtext" :class="{ 'dashboard-empty-subtext--muted': activeTab === 'clients' }">
          {{ emptyStateCopy.subtext }}
        </p>
        <button
          v-if="activeTab !== 'draft'"
          type="button"
          class="dashboard-empty-cta"
          :class="{ 'dashboard-empty-cta--lg': activeTab === 'clients' }"
          @click="onCreateClick"
        >
          {{ emptyStateCopy.cta }}
        </button>
      </div>
      <div v-else class="dashboard-projects-list-area">
        <template v-if="activeTab === 'projects'">
          <div v-if="filteredProjects.length === 0" class="dashboard-projects-list-placeholder">
            No projects found.
          </div>
          <template v-else>
            <div
              v-if="projectsViewMode === 'grid'"
              class="dashboard-projects-card-grid"
            >
              <article
                v-for="project in paginatedProjects"
                :key="project.id"
                class="dashboard-project-card"
                role="button"
                tabindex="0"
                @click="openProjectDetails(project.id)"
                @keydown.enter="openProjectDetails(project.id)"
                @keydown.space.prevent="openProjectDetails(project.id)"
              >
                <div class="dashboard-project-card-head">
                  <h3 class="dashboard-project-card-title">{{ project.title }}</h3>
                  <span class="dashboard-status-pill" :class="statusClass(project.status)">
                    <span class="dashboard-status-dot" aria-hidden="true"></span>
                    {{ statusLabel(project.status) }}
                  </span>
                </div>
                <p class="dashboard-project-card-client">{{ project.clientName }}</p>
                <div class="dashboard-project-card-metrics" role="presentation">
                  <div class="dashboard-project-card-metric">
                    <span class="dashboard-project-card-metric-label">Amount (PKR)</span>
                    <span class="dashboard-project-card-metric-value">{{ project.amountFormatted }}</span>
                  </div>
                  <div class="dashboard-project-card-divider" aria-hidden="true"></div>
                  <div class="dashboard-project-card-metric">
                    <span class="dashboard-project-card-metric-label">Payment Type</span>
                    <span class="dashboard-project-card-metric-value dashboard-project-card-metric-value--muted">
                      {{ normalizePaymentType(project.paymentType) }}
                    </span>
                  </div>
                  <div class="dashboard-project-card-divider" aria-hidden="true"></div>
                  <div class="dashboard-project-card-metric">
                    <span class="dashboard-project-card-metric-label">Date Due</span>
                    <span class="dashboard-project-card-metric-value dashboard-project-card-metric-value--muted">
                      {{ formatDueDateDisplay(project.dueDate) }}
                    </span>
                  </div>
                </div>
              </article>
            </div>
            <div v-else class="dashboard-projects-table-wrap">
              <table class="dashboard-projects-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Project Name</th>
                    <th>Clients</th>
                    <th>Total Amount</th>
                    <th>Payment Type</th>
                    <th>Due Date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(project, index) in paginatedProjects"
                    :key="project.id"
                    class="dashboard-project-row"
                    @click="openProjectDetails(project.id)"
                  >
                    <td>{{ (projectsPage - 1) * PROJECTS_PAGE_SIZE + index + 1 }}</td>
                    <td>{{ project.title }}</td>
                    <td>{{ project.clientName }}</td>
                    <td>{{ project.amountLabel }}</td>
                    <td>
                      <span class="dashboard-payment-type">• {{ normalizePaymentType(project.paymentType) }}</span>
                    </td>
                    <td>{{ formatDueDateDisplay(project.dueDate) }}</td>
                    <td>
                      <span class="dashboard-status-pill" :class="statusClass(project.status)">
                        <span class="dashboard-status-dot" aria-hidden="true"></span>
                        {{ statusLabel(project.status) }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <nav
              v-if="projectsTotalPages > 1"
              class="dashboard-projects-pagination"
              aria-label="Project pages"
            >
              <button
                type="button"
                class="dashboard-page-link"
                :disabled="projectsPage <= 1"
                @click="prevProjectsPage"
              >
                &lt; Previous
              </button>
              <div class="dashboard-page-nums">
                <button
                  v-for="n in projectsPageNumbers"
                  :key="n"
                  type="button"
                  class="dashboard-page-num"
                  :class="{ 'dashboard-page-num--active': n === projectsPage }"
                  :aria-current="n === projectsPage ? 'page' : undefined"
                  @click="setProjectsPage(n)"
                >
                  {{ n }}
                </button>
              </div>
              <button
                type="button"
                class="dashboard-page-link"
                :disabled="projectsPage >= projectsTotalPages"
                @click="nextProjectsPage"
              >
                Next &gt;
              </button>
            </nav>
          </template>
        </template>
        <template v-else-if="activeTab === 'clients'">
          <div v-if="filteredClients.length === 0" class="dashboard-projects-list-placeholder">
            No clients found.
          </div>
          <div v-else class="dashboard-clients-card-grid">
            <article v-for="c in filteredClients" :key="c.id" class="dashboard-client-card">
              <div class="dashboard-client-card-top">
                <div class="dashboard-client-card-titles">
                  <h3 class="dashboard-client-card-name">{{ c.clientName }}</h3>
                  <p class="dashboard-client-card-company">{{ c.companyLine }}</p>
                </div>
                <span
                  class="dashboard-client-card-status"
                  :data-status="c.status"
                >
                  <svg
                    v-if="c.status === 'active'"
                    class="dashboard-client-card-status-icon"
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M2 1.5v7l6-3.5-6-3.5z" />
                  </svg>
                  {{ c.status === "active" ? "Active" : "Inactive" }}
                </span>
              </div>
              <div class="dashboard-client-card-contacts">
                <div v-if="c.mobileNumber" class="dashboard-client-card-contact-row">
                  <svg
                    class="dashboard-client-card-contact-icon"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path
                      d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
                    />
                  </svg>
                  <span>{{ c.mobileNumber }}</span>
                </div>
                <div v-if="c.email" class="dashboard-client-card-contact-row">
                  <svg
                    class="dashboard-client-card-contact-icon"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                  <span class="dashboard-client-card-email">{{ c.email }}</span>
                </div>
              </div>
              <div class="dashboard-client-card-metrics" role="presentation">
                <div class="dashboard-client-card-metric">
                  <span class="dashboard-client-card-metric-label">Total Spend (PKR)</span>
                  <span class="dashboard-client-card-metric-value">{{ c.totalSpendFormatted }}</span>
                </div>
                <div class="dashboard-client-card-divider" aria-hidden="true"></div>
                <div class="dashboard-client-card-metric">
                  <span class="dashboard-client-card-metric-label">Projects</span>
                  <span class="dashboard-client-card-metric-value">{{ c.projectCount }}</span>
                </div>
                <div class="dashboard-client-card-divider" aria-hidden="true"></div>
                <div class="dashboard-client-card-metric">
                  <span class="dashboard-client-card-metric-label">Started</span>
                  <span class="dashboard-client-card-metric-value dashboard-client-card-metric-value--muted">{{
                    c.startedLabel
                  }}</span>
                </div>
              </div>
            </article>
          </div>
        </template>
        <p v-else class="dashboard-projects-list-placeholder">List of {{ activeTab }} will appear here.</p>
      </div>
    </div>

    <div
      v-if="isAddClientOpen"
      class="dashboard-modal"
      role="presentation"
      @click.self="closeAddClient"
    >
      <div class="dashboard-modal-card" role="dialog" aria-modal="true" aria-label="Add New Client">
        <div class="dashboard-modal-header">
          <div class="dashboard-modal-title">Add New Client</div>
        </div>

        <form class="dashboard-add-client-form" @submit.prevent="createClient">
          <div class="dashboard-add-client-row">
            <Label class="dashboard-add-client-label">Client</Label>
            <Input v-model="addClientForm.clientName" placeholder="Client or Brand Name" />
          </div>

          <div class="dashboard-add-client-row">
            <Label class="dashboard-add-client-label">Is this a client or brand?</Label>
            <div class="dashboard-add-client-segment" role="radiogroup" aria-label="Client type">
              <label class="dashboard-seg-option">
                <input v-model="addClientForm.type" class="dashboard-seg-input" type="radio" value="brand" />
                <span class="dashboard-seg-pill">Brand</span>
              </label>
              <label class="dashboard-seg-option">
                <input v-model="addClientForm.type" class="dashboard-seg-input" type="radio" value="individual" />
                <span class="dashboard-seg-pill">Individual Client</span>
              </label>
            </div>
          </div>

          <div v-if="addClientForm.type === 'brand'" class="dashboard-add-client-row">
            <Label class="dashboard-add-client-label">Brand</Label>
            <Input v-model="addClientForm.brandName" placeholder="Brand or company name" />
          </div>

          <div class="dashboard-add-client-grid">
            <div class="dashboard-add-client-row">
              <Label class="dashboard-add-client-label">Email</Label>
              <Input v-model="addClientForm.email" type="email" placeholder="Contact@company.com" />
            </div>
            <div class="dashboard-add-client-row">
              <Label class="dashboard-add-client-label">Mobile Number</Label>
              <Input v-model="addClientForm.mobileNumber" placeholder="+92" />
            </div>
          </div>

          <div class="dashboard-add-client-row">
            <Label class="dashboard-add-client-label">Status</Label>
            <select v-model="addClientForm.status" class="dashboard-select">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div class="dashboard-add-client-row">
            <Label class="dashboard-add-client-label">Notes</Label>
            <textarea
              v-model="addClientForm.notes"
              class="dashboard-textarea"
              rows="3"
              placeholder="Things to remember about the client"
            />
          </div>

          <div class="dashboard-add-client-footer">
            <button type="button" class="dashboard-footer-btn dashboard-footer-btn--cancel" @click="closeAddClient">
              Cancel
            </button>
            <button
              type="submit"
              class="dashboard-footer-btn dashboard-footer-btn--create"
              :disabled="!canCreateClient"
            >
              Create Client
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard-projects-screen {
  display: contents;
}

.dashboard-empty-wrap {
  width: 100%;
  min-height: calc(100vh - 120px);
  padding: 18px 24px 28px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dashboard-projects-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.dashboard-tabs {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.dashboard-tab {
  appearance: none;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #0f172a;
  border-radius: 999px;
  padding: 6px 12px 6px 14px;
  font-size: 0.8125rem;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.dashboard-tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
  background: #f1f5f9;
  color: #475569;
}

.dashboard-tab--active .dashboard-tab-badge {
  background: rgba(255, 255, 255, 0.2);
  color: #ffffff;
}

.dashboard-tab--active {
  background: #0f172a;
  border-color: #0f172a;
  color: #ffffff;
}

.dashboard-empty-bar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 14px;
}

.dashboard-empty-bar--projects {
  justify-content: space-between;
}

.dashboard-empty-bar--spread {
  justify-content: space-between;
  gap: 14px;
}

.dashboard-empty-bar--spread .dashboard-empty-search--wide {
  flex: 1 1 280px;
  max-width: none;
}

.dashboard-new-project-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 36px;
  border-radius: 999px;
  border: 1px solid #0f172a;
  background: #0f172a;
  color: #ffffff;
  font-size: 0.8125rem;
  font-weight: 600;
  padding: 0 16px;
  cursor: pointer;
  box-shadow: 0 1px 0 rgba(15, 23, 42, 0.08);
}

.dashboard-empty-search {
  position: relative;
  width: 240px;
  max-width: 100%;
}

.dashboard-empty-search--wide {
  flex: 1 1 280px;
  width: auto;
  min-width: 200px;
  max-width: 100%;
}

.dashboard-empty-search-icon {
  position: absolute;
  top: 50%;
  left: 10px;
  transform: translateY(-50%);
  color: #94a3b8;
  pointer-events: none;
}

.dashboard-empty-search-input {
  width: 100%;
  height: 32px;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  padding: 0 12px 0 30px;
  font-size: 0.8125rem;
  color: #0f172a;
  outline: none;
}

.dashboard-empty-search-input::placeholder {
  color: #94a3b8;
}

.dashboard-empty-filters {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #0f172a;
  font-size: 0.8125rem;
  cursor: pointer;
  color: #334155;
}

.dashboard-view-toggle {
  display: inline-flex;
  align-items: stretch;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  overflow: hidden;
}

.dashboard-view-toggle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 32px;
  min-width: 40px;
  padding: 0 10px;
  border: none;
  background: transparent;
  color: #64748b;
  font-size: 0.8125rem;
  cursor: pointer;
}

.dashboard-view-toggle-btn--with-label {
  padding: 0 12px 0 10px;
}

.dashboard-view-toggle-btn--active {
  background: #f1f5f9;
  color: #0f172a;
}

.dashboard-view-toggle-sr {
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

.dashboard-list-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.dashboard-empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
}

.dashboard-projects-list-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: stretch;
  text-align: left;
  gap: 20px;
}

.dashboard-projects-card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  width: 100%;
}

@media (max-width: 1100px) {
  .dashboard-projects-card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .dashboard-projects-card-grid {
    grid-template-columns: 1fr;
  }
}

.dashboard-project-card {
  border-radius: 12px;
  border: 1px solid #e8ecf1;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  padding: 16px 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

.dashboard-project-card:hover {
  border-color: #cbd5e1;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.09);
}

.dashboard-project-card:focus-visible {
  outline: 2px solid #1d4ed8;
  outline-offset: 2px;
}

.dashboard-project-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.dashboard-project-card-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.35;
  flex: 1;
  min-width: 0;
}

.dashboard-project-card .dashboard-status-pill {
  flex-shrink: 0;
  max-width: 48%;
}

.dashboard-project-card-client {
  margin: 0;
  font-size: 0.8125rem;
  color: #94a3b8;
}

.dashboard-project-card-metrics {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto 1fr;
  align-items: stretch;
  gap: 0;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid #f1f5f9;
}

.dashboard-project-card-metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 0 4px;
}

.dashboard-project-card-metric-label {
  font-size: 0.6875rem;
  font-weight: 500;
  color: #94a3b8;
  text-transform: none;
}

.dashboard-project-card-metric-value {
  font-size: 0.875rem;
  font-weight: 700;
  color: #0f172a;
}

.dashboard-project-card-metric-value--muted {
  font-weight: 600;
  color: #334155;
}

.dashboard-project-card-divider {
  width: 1px;
  background: #e2e8f0;
  align-self: stretch;
  min-height: 36px;
}

.dashboard-projects-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-wrap: wrap;
  padding-top: 4px;
}

.dashboard-page-link {
  border: none;
  background: transparent;
  color: #64748b;
  font-size: 0.8125rem;
  padding: 6px 10px;
  cursor: pointer;
  border-radius: 6px;
}

.dashboard-page-link:hover:not(:disabled) {
  color: #0f172a;
}

.dashboard-page-link:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.dashboard-page-nums {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.dashboard-page-num {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: #64748b;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
}

.dashboard-page-num:hover {
  color: #0f172a;
  background: #f8fafc;
}

.dashboard-page-num--active {
  background: #e2e8f0;
  color: #0f172a;
  font-weight: 600;
}

.dashboard-projects-table-wrap {
  width: 100%;
  overflow-x: auto;
  border-radius: 10px;
  border: 1px solid #e5e7eb;
  background: #ffffff;
}

.dashboard-projects-count {
  width: 100%;
  text-align: left;
  margin-bottom: 8px;
  color: #64748b;
  font-size: 0.75rem;
}

.dashboard-projects-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 900px;
  text-align: left;
}

.dashboard-projects-table th,
.dashboard-projects-table td {
  border-bottom: 1px solid #f0f2f5;
  padding: 14px 14px;
  font-size: 0.78rem;
  color: #1f2937;
  white-space: nowrap;
}

.dashboard-project-row {
  cursor: pointer;
}

.dashboard-project-row:hover td {
  background: #f8fafc;
}

.dashboard-projects-table th {
  font-size: 0.7rem;
  color: #6b7280;
  font-weight: 600;
  background: #ffffff;
}

.dashboard-payment-type {
  color: #4b5563;
}

.dashboard-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 0.625rem;
  font-weight: 600;
}

.dashboard-status-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  position: relative;
}

.dashboard-status-dot::after {
  content: "";
  position: absolute;
  inset: 3px;
  border-radius: 999px;
  background: currentColor;
}

.dashboard-status-pill--signed {
  background: #eef2ff;
  border-color: #dbeafe;
  color: #1e293b;
}

.dashboard-status-pill--signed .dashboard-status-dot {
  background: #dbeafe;
}

.dashboard-status-pill--completed {
  background: #ecfdf3;
  border-color: #bbf7d0;
  color: #166534;
}

.dashboard-status-pill--completed .dashboard-status-dot {
  background: #22c55e;
}

.dashboard-status-pill--in-dispute {
  background: #fef2f2;
  border-color: #fecaca;
  color: #dc2626;
}

.dashboard-status-pill--in-dispute .dashboard-status-dot {
  background: #ef4444;
}

.dashboard-status-pill--payment-due {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}

.dashboard-status-pill--payment-due .dashboard-status-dot {
  background: #f87171;
}

.dashboard-status-pill--delayed {
  background: #f1f5f9;
  border-color: #e2e8f0;
  color: #475569;
}

.dashboard-status-pill--delayed .dashboard-status-dot {
  background: #94a3b8;
}

.dashboard-status-pill--in-progress {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1d4ed8;
}

.dashboard-status-pill--in-progress .dashboard-status-dot {
  background: #3b82f6;
}

.dashboard-status-pill--draft {
  background: #f3f4f6;
  border-color: #e5e7eb;
  color: #4b5563;
}

.dashboard-status-pill--draft .dashboard-status-dot {
  background: #9ca3af;
}

.dashboard-empty-illustration {
  margin-bottom: 10px;
}

.dashboard-empty-illustration-img {
  display: block;
  width: 150px;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}

.dashboard-empty-illustration-img--contacts {
  width: 168px;
}

.dashboard-empty-heading {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: #0f172a;
}

.dashboard-empty-heading--prominent {
  font-size: 1.125rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.dashboard-empty-subtext {
  margin: 6px 0 14px;
  font-size: 0.75rem;
  color: #64748b;
}

.dashboard-empty-subtext--muted {
  font-size: 0.8125rem;
  color: #94a3b8;
  max-width: 22rem;
}

.dashboard-empty-cta {
  height: 32px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid #0f172a;
  background: #0f172a;
  color: #ffffff;
  font-size: 0.8125rem;
  cursor: pointer;
  font-weight: 600;
}

.dashboard-empty-cta--lg {
  height: 40px;
  padding: 0 22px;
  font-size: 0.875rem;
}

.dashboard-clients-card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  width: 100%;
}

@media (max-width: 1100px) {
  .dashboard-clients-card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .dashboard-clients-card-grid {
    grid-template-columns: 1fr;
  }
}

.dashboard-client-card {
  border-radius: 12px;
  border: 1px solid #e8ecf1;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  padding: 16px 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  text-align: left;
}

.dashboard-client-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.dashboard-client-card-titles {
  min-width: 0;
  flex: 1;
}

.dashboard-client-card-name {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.3;
}

.dashboard-client-card-company {
  margin: 4px 0 0;
  font-size: 0.8125rem;
  color: #64748b;
  line-height: 1.35;
}

.dashboard-client-card-status {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: capitalize;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  color: #475569;
}

.dashboard-client-card-status[data-status="inactive"] {
  background: #f8fafc;
  color: #64748b;
}

.dashboard-client-card-status-icon {
  flex-shrink: 0;
  opacity: 0.85;
}

.dashboard-client-card-contacts {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dashboard-client-card-contact-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 0.8125rem;
  color: #334155;
  line-height: 1.4;
}

.dashboard-client-card-contact-icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: #94a3b8;
}

.dashboard-client-card-email {
  word-break: break-word;
}

.dashboard-client-card-metrics {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto 1fr;
  align-items: stretch;
  gap: 0;
  margin-top: 2px;
  padding-top: 12px;
  border-top: 1px solid #f1f5f9;
}

.dashboard-client-card-metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 0 4px;
}

.dashboard-client-card-metric-label {
  font-size: 0.6875rem;
  font-weight: 500;
  color: #94a3b8;
}

.dashboard-client-card-metric-value {
  font-size: 0.875rem;
  font-weight: 700;
  color: #0f172a;
}

.dashboard-client-card-metric-value--muted {
  font-weight: 600;
  color: #334155;
}

.dashboard-client-card-divider {
  width: 1px;
  background: #e8ecf1;
  align-self: stretch;
  min-height: 36px;
}

.dashboard-pill {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 0.75rem;
  border: 1px solid #e2e8f0;
  color: #0f172a;
  background: #f8fafc;
  text-transform: capitalize;
}

.dashboard-pill[data-variant="active"] {
  border-color: #bbf7d0;
  background: #f0fdf4;
  color: #166534;
}

.dashboard-pill[data-variant="inactive"] {
  border-color: #fecaca;
  background: #fef2f2;
  color: #991b1b;
}

.dashboard-modal {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 24px;
  background: rgba(15, 23, 42, 0.35);
  backdrop-filter: blur(4px);
}

.dashboard-modal-card {
  width: min(640px, 100%);
  margin: 0 auto;
  border-radius: 12px;
  border: 1px solid #d8dee8;
  background: #f4f6fa;
  box-shadow: 0 24px 56px rgba(2, 6, 23, 0.22);
  padding: 22px 28px 24px;
}

.dashboard-modal-header {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  margin-bottom: 14px;
}

.dashboard-modal-title {
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #1a202c;
}

.dashboard-add-client-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.dashboard-add-client-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dashboard-add-client-label {
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.3;
  color: #2d3748;
}

.dashboard-add-client-row :deep([data-slot="input"]) {
  height: 40px;
  border-radius: 8px;
  border-color: #cbd5e0;
  background: #ffffff;
  padding: 0 14px;
  font-size: 0.875rem;
  color: #111827;
}

.dashboard-add-client-row :deep([data-slot="input"]::placeholder) {
  color: #9ca3af;
}

.dashboard-add-client-segment {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.dashboard-seg-option {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.dashboard-seg-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.dashboard-seg-pill {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #1a202c;
  font-size: 0.875rem;
  font-weight: 500;
}

.dashboard-seg-option:has(input:checked) .dashboard-seg-pill {
  border-color: #1a202c;
  background: #1a202c;
  color: #ffffff;
}

.dashboard-add-client-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.dashboard-select {
  height: 40px;
  width: 100%;
  border-radius: 8px;
  border: 1px solid #cbd5e0;
  background: #ffffff;
  padding: 0 14px;
  font-size: 0.875rem;
  color: #111827;
  outline: none;
}

.dashboard-textarea {
  width: 100%;
  min-height: 84px;
  border-radius: 8px;
  border: 1px solid #cbd5e0;
  background: #ffffff;
  padding: 12px 14px;
  font-size: 0.875rem;
  line-height: 1.5;
  color: #111827;
  outline: none;
  resize: vertical;
}

.dashboard-textarea::placeholder {
  color: #9ca3af;
}

.dashboard-add-client-footer {
  margin-top: 2px;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 2px;
}

.dashboard-footer-btn {
  appearance: none;
  min-width: 120px;
  height: 40px;
  padding: 0 20px;
  border-radius: 999px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}

.dashboard-footer-btn--cancel {
  border: 1px solid #1a202c;
  background: #ffffff;
  color: #1a202c;
}

.dashboard-footer-btn--create {
  border: 1px solid #1a202c;
  background: #1a202c;
  color: #ffffff;
}

.dashboard-footer-btn--create:disabled {
  border-color: #cbd5e1;
  background: #e2e8f0;
  color: #94a3b8;
  cursor: not-allowed;
}

@media (max-width: 520px) {
  .dashboard-empty-bar {
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .dashboard-empty-search {
    width: 100%;
  }

  .dashboard-add-client-grid {
    grid-template-columns: 1fr;
  }
}
</style>

<script setup>
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { Bell, ChevronDown, CirclePlus, FileText, FolderPlus, Link2, TrendingUp } from "lucide-vue-next";
import {
  DashboardCalendar,
  DashboardHome,
  DashboardAccounts,
  DashboardProjectDetails,
  DashboardProjects,
  NewProject,
} from "@/components/dashboard";
import CreateInvoiceFlow from "@/components/dashboard/CreateInvoiceFlow.vue";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrentUser } from "@/composables/useCurrentUser";
import { clearAuthSession } from "@/lib/auth";
import { showColoredToast } from "@/lib/swToast";

const router = useRouter();
const { displayLabel, initials, refresh: refreshUserProfile } = useCurrentUser();
const isSidebarCollapsed = ref(false);
/** Which main screen: 'home' | 'projects' | 'calendar' | 'clients' | 'accounts' */
const currentView = ref("home");
/** When true, show New Project instead of the projects list screen */
const showNewProject = ref(false);
/** When set, New Project opens in edit mode and pre-fills saved data */
const editingProjectId = ref(null);
/** Full-screen create invoice wizard from the top “Create” menu */
const showCreateInvoice = ref(false);
const createInvoicePrefillProjectId = ref(null);
const createInvoicePrefillMilestoneId = ref(null);
const projectsInitialTab = ref("projects");
const selectedProjectId = ref(null);
/** Shown on the bell badge (placeholder until notifications API exists). */
const notificationCount = ref(2);

const toggleSidebar = () => {
  isSidebarCollapsed.value = !isSidebarCollapsed.value;
};
const handleLogout = () => {
  clearAuthSession();
  router.push("/");
};

function openNewProject(projectId) {
  showCreateInvoice.value = false;
  selectedProjectId.value = null;
  editingProjectId.value = projectId ? String(projectId) : null;
  /** NewProject is only mounted in the non-home branch; home must switch to projects first */
  currentView.value = "projects";
  showNewProject.value = true;
}

function closeNewProject() {
  showNewProject.value = false;
  editingProjectId.value = null;
}

function goToProjects() {
  showCreateInvoice.value = false;
  currentView.value = "projects";
  projectsInitialTab.value = "projects";
  selectedProjectId.value = null;
  showNewProject.value = false;
  editingProjectId.value = null;
}

function goToClients() {
  showCreateInvoice.value = false;
  currentView.value = "clients";
  projectsInitialTab.value = "clients";
  selectedProjectId.value = null;
  showNewProject.value = false;
  editingProjectId.value = null;
}

function onProjectsScreenTab(tab) {
  if (tab === "clients") {
    goToClients();
    return;
  }
  if (tab === "projects") {
    goToProjects();
    return;
  }
  if (tab === "draft") {
    showCreateInvoice.value = false;
    currentView.value = "projects";
    projectsInitialTab.value = "draft";
    selectedProjectId.value = null;
    showNewProject.value = false;
    editingProjectId.value = null;
  }
}

function goToCalendar() {
  showCreateInvoice.value = false;
  currentView.value = "calendar";
  selectedProjectId.value = null;
  showNewProject.value = false;
  editingProjectId.value = null;
}

function goToAccounts() {
  showCreateInvoice.value = false;
  currentView.value = "accounts";
  projectsInitialTab.value = "projects";
  selectedProjectId.value = null;
  showNewProject.value = false;
  editingProjectId.value = null;
}

function openProjectDetails(projectId) {
  showCreateInvoice.value = false;
  currentView.value = "projects";
  showNewProject.value = false;
  editingProjectId.value = null;
  selectedProjectId.value = projectId;
}

function closeProjectDetails() {
  selectedProjectId.value = null;
}

function onCreatePaymentLink() {
  showColoredToast({
    kind: "info",
    message: "Payment links will be available in a future update.",
  });
}

function onCreateInvoice() {
  showCreateInvoice.value = true;
}

function onCreateInvoiceForMilestone(payload) {
  const pid = payload?.projectId ? String(payload.projectId) : null;
  createInvoicePrefillProjectId.value = pid;
  createInvoicePrefillMilestoneId.value = payload?.milestoneId ? String(payload.milestoneId) : null;
  showCreateInvoice.value = true;
}

function onInvoiceFlowClose() {
  showCreateInvoice.value = false;
  createInvoicePrefillProjectId.value = null;
  createInvoicePrefillMilestoneId.value = null;
}

function onInvoiceIssued() {
  showCreateInvoice.value = false;
  createInvoicePrefillProjectId.value = null;
  createInvoicePrefillMilestoneId.value = null;
}

onMounted(() => {
  refreshUserProfile();
  try {
    const raw = sessionStorage.getItem("createit_signup_customer_data");
    if (raw) {
      const data = JSON.parse(raw);
      console.log("Customer signup data (from previous steps):", data);
    }
  } catch (e) {
    console.warn("Could not read signup customer data", e);
  }
});
</script>

<template>
  <section class="dashboard-shell" :class="{ 'dashboard-shell--collapsed': isSidebarCollapsed }">
    <aside class="dashboard-sidebar" :class="{ 'dashboard-sidebar--collapsed': isSidebarCollapsed }">
      <button class="dashboard-create" type="button">
        <img class="dashboard-create-icon" src="@/assets/logo/create-logo.png" alt="" />
      </button>

      <nav class="dashboard-nav">
        <button
          type="button"
          class="dashboard-nav-item"
          :class="{ 'dashboard-nav-item--active': currentView === 'home' }"
          @click="currentView = 'home'; showNewProject = false; showCreateInvoice = false"
        >
          <img src="@/assets/icons/Component 7-7.svg" alt="" />
          <span>Home</span>
        </button>
        <button
          type="button"
          class="dashboard-nav-item"
          :class="{ 'dashboard-nav-item--active': currentView === 'projects' || currentView === 'clients' }"
          @click="goToProjects"
        >
          <img src="@/assets/icons/Component 7-1.svg" alt="" />
          <span>Projects</span>
        </button>
        <button
          class="dashboard-nav-item"
          :class="{ 'dashboard-nav-item--active': currentView === 'accounts' }"
          type="button"
          @click="goToAccounts"
        >
          <img src="@/assets/icons/Component 7-5.svg" alt="" />
          <span>Accounts</span>
        </button>
        <hr class="dashboard-nav-sep" />
        <button
          class="dashboard-nav-item"
          :class="{ 'dashboard-nav-item--active': currentView === 'clients' }"
          type="button"
          @click="goToClients"
        >
          <img src="@/assets/icons/Component 7-4.svg" alt="" />
          <span>Client</span>
        </button>
        <button class="dashboard-nav-item" type="button">
          <img src="@/assets/icons/Component 7-3.svg" alt="" />
          <span>Documents</span>
        </button>
        <button
          class="dashboard-nav-item"
          :class="{ 'dashboard-nav-item--active': currentView === 'calendar' }"
          type="button"
          @click="goToCalendar"
        >
          <img src="@/assets/icons/Component 7-2.svg" alt="" />
          <span>Calendar</span>
        </button>
        <button class="dashboard-nav-item" type="button">
          <img src="@/assets/icons/Component 7-6.svg" alt="" />
          <span>Reports</span>
        </button>
        <button class="dashboard-nav-item" type="button">
          <img src="@/assets/icons/Component 7.svg" alt="" />
          <span>Tax Center</span>
        </button>
        <hr class="dashboard-nav-sep" />
      </nav>

      <div class="dashboard-nav-footer">
        <button class="dashboard-nav-item dashboard-nav-item--muted" type="button">
          <img src="@/assets/icons/Component 8.svg" alt="" />
          <span>Help Center</span>
        </button>
        <button class="dashboard-nav-item dashboard-nav-item--muted" type="button">
          <img src="@/assets/icons/Component 8-1.svg" alt="" />
          <span>Setting</span>
        </button>
        <button class="dashboard-nav-item dashboard-nav-item--muted" type="button" @click="handleLogout">
          <img src="@/assets/icons/Component 8-2.svg" alt="" />
          <span>Log out</span>
        </button>
      </div>
    </aside>

    <div class="dashboard-main">
      <header class="dashboard-topbar">
        <div class="dashboard-topbar-actions">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                class="dashboard-create-menu-trigger"
                aria-label="Create new"
              >
                <CirclePlus class="dashboard-create-menu-trigger-icon" :size="20" :stroke-width="2" aria-hidden="true" />
                <ChevronDown class="dashboard-create-menu-trigger-icon" :size="16" :stroke-width="2" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" :side-offset="8" class="dashboard-create-menu-content">
              <DropdownMenuItem class="dashboard-create-menu-item" @select="openNewProject()">
                <FolderPlus class="size-5 shrink-0 text-[#2563eb]" :stroke-width="2" aria-hidden="true" />
                <span>Project</span>
              </DropdownMenuItem>
              <DropdownMenuItem class="dashboard-create-menu-item" @select="goToAccounts()">
                <TrendingUp class="size-5 shrink-0 text-[#16a34a]" :stroke-width="2" aria-hidden="true" />
                <span>Transaction</span>
              </DropdownMenuItem>
              <DropdownMenuItem class="dashboard-create-menu-item" @select="onCreatePaymentLink()">
                <Link2 class="size-5 shrink-0 text-[#9333ea]" :stroke-width="2" aria-hidden="true" />
                <span>Payment Link</span>
              </DropdownMenuItem>
              <DropdownMenuItem class="dashboard-create-menu-item" @select="onCreateInvoice()">
                <FileText class="size-5 shrink-0 text-[#ea580c]" :stroke-width="2" aria-hidden="true" />
                <span>Invoice</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button class="dashboard-topbar-notify" type="button" aria-label="Notifications">
            <Bell class="dashboard-topbar-notify-icon" :size="22" :stroke-width="2" aria-hidden="true" />
            <span v-if="notificationCount > 0" class="dashboard-topbar-notify-badge">{{ notificationCount > 9 ? "9+" : notificationCount }}</span>
          </button>

          <div class="dashboard-profile" :title="displayLabel || 'Account'">
            <div class="dashboard-avatar">{{ initials }}</div>
          </div>
        </div>
      </header>

      <div
        class="dashboard-content"
        :class="{ 'dashboard-content--invoice': showCreateInvoice }"
      >
        <CreateInvoiceFlow
          v-if="showCreateInvoice"
          :prefill-project-id="createInvoicePrefillProjectId"
          :prefill-milestone-id="createInvoicePrefillMilestoneId"
          @close="onInvoiceFlowClose"
          @issued="onInvoiceIssued"
        />
        <template v-else>
          <DashboardHome
            v-if="currentView === 'home'"
            @view-projects="goToProjects"
            @create-project="openNewProject"
            @record-transactions="goToAccounts"
          />
          <DashboardAccounts v-else-if="currentView === 'accounts'" />
          <DashboardCalendar v-else-if="currentView === 'calendar'" />
          <template v-else>
            <NewProject
              v-if="showNewProject"
              :project-id="editingProjectId ?? undefined"
              @close="closeNewProject"
              @complete="closeNewProject"
            />
            <DashboardProjectDetails
              v-else-if="selectedProjectId"
              :project-id="selectedProjectId"
              @back="closeProjectDetails"
              @create-invoice="onCreateInvoiceForMilestone"
            />
            <DashboardProjects
              v-else
              :initial-tab="projectsInitialTab"
              :lock-tab="currentView === 'clients' ? 'clients' : undefined"
              @open-new-project="openNewProject"
              @open-project-details="openProjectDetails"
              @request-tab="onProjectsScreenTab"
            />
          </template>
        </template>
      </div>
    </div>
  </section>
</template>

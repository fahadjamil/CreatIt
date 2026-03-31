<script setup>
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  DashboardCalendar,
  DashboardHome,
  DashboardProjectDetails,
  DashboardProjects,
  NewProject,
} from "@/components/dashboard";
import { clearAuthSession } from "@/lib/auth";

const router = useRouter();
const isSidebarCollapsed = ref(false);
/** Which main screen: 'home' | 'projects' | 'calendar' | 'clients' */
const currentView = ref("home");
/** When true, show New Project instead of the projects list screen */
const showNewProject = ref(false);
const projectsInitialTab = ref("projects");
const selectedProjectId = ref(null);

const toggleSidebar = () => {
  isSidebarCollapsed.value = !isSidebarCollapsed.value;
};
const handleLogout = () => {
  clearAuthSession();
  router.push("/");
};

function openNewProject() {
  selectedProjectId.value = null;
  showNewProject.value = true;
}

function closeNewProject() {
  showNewProject.value = false;
}

function goToProjects() {
  currentView.value = "projects";
  projectsInitialTab.value = "projects";
  selectedProjectId.value = null;
  showNewProject.value = false;
}

function goToClients() {
  currentView.value = "clients";
  projectsInitialTab.value = "clients";
  selectedProjectId.value = null;
  showNewProject.value = false;
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
    currentView.value = "projects";
    projectsInitialTab.value = "draft";
    selectedProjectId.value = null;
    showNewProject.value = false;
  }
}

function goToCalendar() {
  currentView.value = "calendar";
  selectedProjectId.value = null;
  showNewProject.value = false;
}

function openProjectDetails(projectId) {
  currentView.value = "projects";
  showNewProject.value = false;
  selectedProjectId.value = projectId;
}

function closeProjectDetails() {
  selectedProjectId.value = null;
}

onMounted(() => {
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
          @click="currentView = 'home'; showNewProject = false"
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
        <button class="dashboard-nav-item" type="button">
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
          <button class="dashboard-icon-button" type="button" aria-label="Theme">
            <span>◐</span>
          </button>
          <button class="dashboard-icon-button" type="button" aria-label="Notifications">
            <img src="@/assets/icons/notification.png" alt="" />
            <span class="dashboard-notification-dot"></span>
          </button>
          <div class="dashboard-avatar">SC</div>
        </div>
      </header>

      <div class="dashboard-content">
        <DashboardHome
          v-if="currentView === 'home'"
          @view-projects="goToProjects"
          @create-project="openNewProject"
          @record-transactions="goToProjects"
        />
        <DashboardCalendar v-else-if="currentView === 'calendar'" />
        <template v-else>
          <NewProject v-if="showNewProject" @close="closeNewProject" @complete="closeNewProject" />
          <DashboardProjectDetails
            v-else-if="selectedProjectId"
            :project-id="selectedProjectId"
            @back="closeProjectDetails"
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
      </div>
    </div>
  </section>
</template>

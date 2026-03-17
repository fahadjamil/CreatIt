<script setup>
import { ref } from "vue";

const isSidebarCollapsed = ref(false);
const toggleSidebar = () => {
  isSidebarCollapsed.value = !isSidebarCollapsed.value;
};
</script>

<template>
  <section class="dashboard-shell" :class="{ 'dashboard-shell--collapsed': isSidebarCollapsed }">
    <aside class="dashboard-sidebar" :class="{ 'dashboard-sidebar--collapsed': isSidebarCollapsed }">
      <div class="dashboard-logo">
        <img src="@/assets/logo/create-logo.png" alt="Create" />
        <button class="dashboard-collapse-button" type="button" @click="toggleSidebar">
          <img src="@/assets/icons/Down Chevron.svg" alt="" />
        </button>
      </div>

      <nav class="dashboard-nav">
        <button class="dashboard-nav-item dashboard-nav-item--active" type="button">
          <img src="@/assets/icons/Overview.png" alt="" />
          <span>Home</span>
        </button>
        <button class="dashboard-nav-item" type="button">
          <img src="@/assets/icons/projects.png" alt="" />
          <span>Projects</span>
        </button>
        <button class="dashboard-nav-item" type="button">
          <img src="@/assets/icons/Accounts pressed.png" alt="" />
          <span>Accounts</span>
        </button>
        <button class="dashboard-nav-item" type="button">
          <img src="@/assets/icons/Profile.png" alt="" />
          <span>Clients</span>
        </button>
        <button class="dashboard-nav-item" type="button">
          <img src="@/assets/icons/project.png" alt="" />
          <span>Documents</span>
        </button>
        <button class="dashboard-nav-item" type="button">
          <img src="@/assets/icons/Calendar.png" alt="" />
          <span>Calendar</span>
        </button>
        <button class="dashboard-nav-item" type="button">
          <img src="@/assets/icons/Overview.png" alt="" />
          <span>Reports</span>
        </button>
        <button class="dashboard-nav-item" type="button">
          <img src="@/assets/icons/Accounting-Coins-Stack--Streamline-Ultimate 1.png" alt="" />
          <span>Tax Center</span>
        </button>
      </nav>

      <div class="dashboard-nav-footer">
        <button class="dashboard-nav-item dashboard-nav-item--muted" type="button">
          <img src="@/assets/icons/Alert-Circle--Streamline-Ultimate.png" alt="" />
          <span>Help Center</span>
        </button>
        <button class="dashboard-nav-item dashboard-nav-item--muted" type="button">
          <img src="@/assets/icons/setup.png" alt="" />
          <span>Setting</span>
        </button>
        <button class="dashboard-nav-item dashboard-nav-item--muted" type="button">
          <img src="@/assets/icons/Minus-Math-Symbol-Circle--Streamline-Ultimate.png" alt="" />
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
        <section class="dashboard-card dashboard-balance-card">
          <div>
            <p class="dashboard-card-label">Current Available Balance</p>
            <div class="dashboard-balance-value">150,000,000 <span>PKR</span></div>
            <p class="dashboard-card-caption">Tap for view amount due from clients</p>
          </div>
          <img class="dashboard-eye" src="@/assets/icons/loop.png" alt="" />
        </section>

        <section class="dashboard-section">
          <div class="dashboard-section-header">
            <h2>Projects</h2>
            <button class="dashboard-link" type="button">View projects</button>
          </div>
          <div class="dashboard-projects-grid">
            <article class="dashboard-card dashboard-project-card">
              <div class="dashboard-project-title">Digital Marketing Campaign</div>
              <div class="dashboard-project-client">Ayesha Umer</div>
              <span class="dashboard-pill">In Progress</span>
              <div class="dashboard-project-meta">
                <div>
                  <span>Amount (PKR)</span>
                  <strong>250,000</strong>
                </div>
                <div>
                  <span>Payment Type</span>
                  <strong>Single</strong>
                </div>
                <div>
                  <span>Date Due</span>
                  <strong>28-07-25</strong>
                </div>
              </div>
            </article>
            <article class="dashboard-card dashboard-project-card">
              <div class="dashboard-project-title">Digital Marketing Campaign</div>
              <div class="dashboard-project-client">Emily Carter</div>
              <span class="dashboard-pill">Signed</span>
              <div class="dashboard-project-meta">
                <div>
                  <span>Amount (PKR)</span>
                  <strong>350,000</strong>
                </div>
                <div>
                  <span>Payment Type</span>
                  <strong>Multiple</strong>
                </div>
                <div>
                  <span>Date Due</span>
                  <strong>20-01-25</strong>
                </div>
              </div>
            </article>
            <article class="dashboard-card dashboard-project-card">
              <div class="dashboard-project-title">Digital Marketing Campaign</div>
              <div class="dashboard-project-client">Usman Thair</div>
              <span class="dashboard-pill">Discussion</span>
              <div class="dashboard-project-meta">
                <div>
                  <span>Amount (PKR)</span>
                  <strong>100,000</strong>
                </div>
                <div>
                  <span>Payment Type</span>
                  <strong>Recurring</strong>
                </div>
                <div>
                  <span>Date Due</span>
                  <strong>18-03-25</strong>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section class="dashboard-section">
          <div class="dashboard-section-header">
            <h2>Transactions</h2>
            <button class="dashboard-link" type="button">View transactions</button>
          </div>
          <div class="dashboard-card dashboard-transaction-card">
            <p class="dashboard-card-label">Today</p>
            <div class="dashboard-transaction-item">
              <span class="dashboard-transaction-icon dashboard-transaction-icon--up">↓</span>
              <div>
                <div class="dashboard-transaction-name">ACCOUNT NAME</div>
                <div class="dashboard-transaction-meta">Project Title</div>
              </div>
              <div class="dashboard-transaction-amount">
                Rs. 175,00
                <span>07:36 AM</span>
              </div>
            </div>
            <div class="dashboard-transaction-item">
              <span class="dashboard-transaction-icon dashboard-transaction-icon--down">↑</span>
              <div>
                <div class="dashboard-transaction-name">ACCOUNT NAME</div>
                <div class="dashboard-transaction-meta">Project Title</div>
              </div>
              <div class="dashboard-transaction-amount dashboard-transaction-amount--negative">
                -Rs. 175,00
                <span>07:36 AM</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </section>
</template>

const AI_MODEL = "gemini-1.5-flash"; // Powered by HFIT CORE (Gemini)
const BACKEND_URL = window.location.protocol === "file:" ? "http://localhost:3000" : "";


let currentUser = null;
let authMode = 'signup';

// --- STORAGE HELPERS ---
function setSession(token, email) {
  localStorage.setItem("hfit_token", token);
  if (email) {
    let accounts = JSON.parse(localStorage.getItem("hfit_accounts") || "[]");
    accounts = accounts.filter(a => a !== email); // Prevent duplicates
    accounts.unshift(email); // Put most recent at top
    localStorage.setItem("hfit_accounts", JSON.stringify(accounts.slice(0, 5)));
  }
}

function getRecentAccounts() {
  return JSON.parse(localStorage.getItem("hfit_accounts") || "[]");
}

function getSession() {
  return localStorage.getItem("hfit_token");
}

function clearSession() {
  localStorage.removeItem("hfit_token");
}

// --- AUTH LOGIC ---
async function createAccount(email, password, username, age) {
  try {
    const res = await fetch(`${BACKEND_URL}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, username, age })
    });
    const result = await res.json();
    const lang = document.documentElement.lang || 'en';
    const dict = translations[lang] || translations['en'];
    if (result.success) {
      setSession(result.token, email);
      currentUser = {
        email: result.user.email,
        profile: { username: result.user.username, age: result.user.age },
        data: result.user.data
      };
      return { success: true };
    }
    return { success: false, message: result.message || (dict["signup-failed"] || "Signup failed.") };
  } catch (e) {
    const lang = document.documentElement.lang || 'en';
    const dict = translations[lang] || translations['en'];
    console.error("Transmission Error:", e);
    return { success: false, message: dict["core-failed"] || "Hfit Core Connection Failed." };
  }
}

async function login(email, password) {
  try {
    const res = await fetch(`${BACKEND_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const result = await res.json();
    const lang = document.documentElement.lang || 'en';
    const dict = translations[lang] || translations['en'];
    if (result.success) {
      setSession(result.token, email);
      currentUser = {
        email: result.user.email,
        profile: { username: result.user.username, age: result.user.age },
        data: result.user.data
      };
      return { success: true };
    }
    return { success: false, message: result.message || (dict["login-failed"] || "Login failed.") };
  } catch (e) {
    const lang = document.documentElement.lang || 'en';
    const dict = translations[lang] || translations['en'];
    console.error("Transmission Error:", e);
    return { success: false, message: dict["core-failed"] || "Hfit Core Connection Failed." };
  }
}


// --- INITIALIZATION ---
window.onload = async () => {
  const token = getSession();

  // MIGRATION: Check if there's old local storage data that needs migrating
  if (!token) {
    const oldUsers = JSON.parse(localStorage.getItem("users")) || [];
    const oldSessionEmail = localStorage.getItem("session");

    if (oldSessionEmail && oldUsers.length > 0) {
      const oldUser = oldUsers.find(u => u.email === oldSessionEmail.toLowerCase());
      if (oldUser) {
        console.log("Migrating legacy account data to Hfit Core...");
        try {
          // Create a new account with the old data
          const res = await fetch(`${BACKEND_URL}/signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: oldUser.email,
              password: "migrated_account_temp", // Generic password for migrated accounts
              username: oldUser.profile.username || "Legacy User",
              age: oldUser.profile.age || 25
            })
          });
          const result = await res.json();
          if (result.success) {
            setSession(result.token);
            // Sync their old data up to the server immediately
            await fetch(`${BACKEND_URL}/api/data`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${result.token}`
              },
              body: JSON.stringify({ data: oldUser.data })
            });
            // Clear the legacy storage so we don't migrate again
            localStorage.removeItem("session");
            localStorage.removeItem("users");
            // Reload the page to start fresh with the new token
            window.location.reload();
            return;
          }
        } catch (e) {
          console.error("Migration failed", e);
        }
      }
    }
  }

  if (token) {
    document.getElementById("authScreen").classList.add("hidden"); // Immediately hide auth if token exists
    try {
      const res = await fetch(`${BACKEND_URL}/api/user`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${token}` }
      });
      const result = await res.json();
      if (result.success) {
        currentUser = {
          email: result.user.email,
          profile: { username: result.user.username, age: result.user.age },
          data: result.user.data
        };
        if (!currentUser.data.activities) currentUser.data.activities = [];
        if (!currentUser.data.sleep) currentUser.data.sleep = [];
        if (!currentUser.data.goals) currentUser.data.goals = [];

        initChatSystem();
        showApp();
        checkAiStatus(); 
        checkBioRhythm();
        initDraggableDashboard();
        renderActivities();
        updateDashboard();
      } else {
        throw new Error("Invalid session");
      }
    } catch (e) {
      console.warn("Session check failed:", e);
      if (e.message === "Invalid session") clearSession();

      document.getElementById("authScreen").classList.remove("hidden");
      document.getElementById("app").classList.add("hidden");
    }
  } else {
    document.getElementById("authScreen").classList.remove("hidden");
    document.getElementById("app").classList.add("hidden");
  }

  const theme = localStorage.getItem("hfitTheme") || "dark-mode";
  document.body.className = theme;
  checkBioRhythm(); // Ensure bio-rhythm is applied on top of saved theme

  const recentAccounts = getRecentAccounts();
  if (recentAccounts.length > 0) {
    authMode = 'signin';
    renderRecentAccounts();
  }
  setAuthMode(authMode);

  // Start checking core status immediately
  checkAiStatus();

  // Register site visit
  fetch(`${BACKEND_URL}/api/visit`).catch(() => {});

  // Hide Splash Screen Setup
  const hideSplash = () => {
    const splash = document.getElementById("splashScreen");
    if (splash && splash.style.opacity !== '0') {
      splash.style.opacity = '0';
      splash.style.visibility = 'hidden';
      setTimeout(() => splash.remove(), 800);
    }
  };

  document.getElementById("splashScreen")?.addEventListener("click", hideSplash);
  setTimeout(hideSplash, 1200);
};

// --- BIO-RHYTHM ---
function checkBioRhythm() {
  const hour = new Date().getHours();
  document.body.classList.remove('morning-mode', 'afternoon-mode', 'recovery-mode', 'midnight-mode');

  if (hour >= 5 && hour < 12) {
    document.body.classList.add('morning-mode');
  } else if (hour >= 12 && hour < 17) {
    document.body.classList.add('afternoon-mode');
  } else if (hour >= 17 && hour < 22) {
    document.body.classList.add('recovery-mode');
  } else {
    document.body.classList.add('midnight-mode');
  }
  // Default is neutral Focus Blue (as defined in :root)
}

// --- DRAGGABLE DASHBOARD ---
function initDraggableDashboard() {
  const grid = document.querySelector('.dashboard-grid');
  const cards = document.querySelectorAll('.card');
  const handles = document.querySelectorAll('.drag-handle[draggable="true"]');

  // Load saved order
  const savedOrder = JSON.parse(localStorage.getItem('hfit_dashboard_order') || '[]');
  if (savedOrder.length > 0) {
    savedOrder.forEach(id => {
      const el = document.getElementById(id);
      if (el) grid.appendChild(el);
    });
  }

  handles.forEach(handle => {
    const card = handle.parentElement;

    handle.addEventListener('dragstart', (e) => {
      card.classList.add('dragging');
      e.dataTransfer.setData('text/plain', card.id);
      setTimeout(() => card.style.opacity = '0.5', 0);
    });

    handle.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      card.style.opacity = '1';
      saveDashboardOrder();
    });
  });

  cards.forEach(card => {
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = document.querySelector('.dragging');
      if (!dragging) return;

      const afterElement = getDragAfterElement(grid, e.clientY);
      if (afterElement == null) {
        grid.appendChild(dragging);
      } else {
        grid.insertBefore(dragging, afterElement);
      }
    });
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.card:not(.dragging)')];

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function saveDashboardOrder() {
  const ids = [...document.querySelectorAll('.dashboard-grid .card')].map(c => c.id).filter(id => id);
  localStorage.setItem('hfit_dashboard_order', JSON.stringify(ids));
}

function renderRecentAccounts() {
  const container = document.getElementById("recentAccountsContainer");
  const list = document.getElementById("recentAccountsList");
  const accounts = getRecentAccounts();

  if (accounts.length === 0) {
    container.classList.add("hidden");
    return;
  }

  container.classList.remove("hidden");
  list.innerHTML = accounts.map(email => `
    <div class="card stat-card" style="padding: 12px 20px; display: flex; align-items: center; gap: 15px; background: var(--glass-bg); margin: 0; position: relative; transition: all 0.3s;">
      <div style="flex-grow: 1; display: flex; align-items: center; gap: 15px; cursor: pointer;" onclick="selectRecentAccount('${email}')">
        <div style="width: 32px; height: 32px; background: var(--accent-primary); color: #000; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.8rem;">${email[0].toUpperCase()}</div>
        <div>
          <p style="font-weight: 700; font-size: 0.9rem; margin: 0;">${email}</p>
          <p style="font-size: 0.7rem; color: var(--text-dim); margin: 0;">Stored Profile</p>
        </div>
      </div>
      <button onclick="removeRecentAccount('${email}')" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: 0.2s; font-size: 0.8rem;" title="Remove Account from Device">✖</button>
    </div>
  `).join('');
}

function removeRecentAccount(email) {
  let accounts = getRecentAccounts();
  accounts = accounts.filter(e => e !== email);
  localStorage.setItem("hfit_accounts", JSON.stringify(accounts));
  renderRecentAccounts();
  if (accounts.length === 0) {
    setAuthMode('signup');
  }
}

function selectRecentAccount(email) {
  document.getElementById("email").value = email;
  setAuthMode('signin');
  document.getElementById("password").focus();
}

function updateStatusUI(text, color) {
  const ids = ["ai-status-pulse", "ai-status-pulse-mobile", "ai-status-pulse-sidebar"];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = text;
      if (color) el.style.color = color;
    }
  });
}

async function checkAiStatus(retries = 10) {
  updateStatusUI("SYNCING WITH CORE...", "var(--accent-primary)");

  try {
    const res = await fetch(`${BACKEND_URL}/health`);

    if (res.ok) {
      const data = await res.json();
      if (data.ai_key_status === "MISSING") {
        updateStatusUI("AI KEY MISSING", "#f59e0b");
      } else {
        updateStatusUI("CORE ONLINE", "var(--accent-primary)");
      }
    } else {
      throw new Error(`Server status ${res.status}`);
    }
  } catch (e) {
    console.warn("Core connectivity issue:", e);
    if (retries > 0) {
      const dots = ".".repeat(3 - (retries % 3));
      updateStatusUI(`WAKING CORE${dots}`, "#f59e0b");
      setTimeout(() => checkAiStatus(retries - 1), 3000);
    } else {
      updateStatusUI("CORE OFFLINE", "#ef4444");
    }
  }
}

function resetDevice() {
  const lang = document.documentElement.lang || 'en';
  const dict = window.translations ? window.translations[lang] || window.translations['en'] : {};
  const msg = dict["reset-confirm"] || "Are you sure you want to reset the device and clear all memory? This will log you out and erase all local data.";
  
  if (confirm(msg)) {
    clearSession();
    localStorage.removeItem("hfit_accounts");
    localStorage.removeItem("hfitTheme");
    localStorage.removeItem("hfit_dashboard_order");
    location.reload();
  }
}

// --- CHAT HISTORY SYSTEM ---
function initChatSystem() {
  if (!currentUser.data.chatThreads) {
    currentUser.data.chatThreads = [];
    if (currentUser.data.chats && currentUser.data.chats.length > 0) {
      currentUser.data.chatThreads.push({
        id: Date.now().toString(),
        title: "Previous Chat",
        messages: currentUser.data.chats
      });
    }
    currentUser.data.chats = []; // Migrate legacy
  }

  if (currentUser.data.chatThreads.length === 0) {
    startNewChat();
  } else if (!currentUser.data.currentChatId) {
    currentUser.data.currentChatId = currentUser.data.chatThreads[0].id;
  }
}

function startNewChat() {
  const newChatId = Date.now().toString();
  currentUser.data.chatThreads.unshift({
    id: newChatId,
    title: "New Conversation",
    messages: []
  });
  currentUser.data.currentChatId = newChatId;
  saveCurrentUserData();
  renderChatSidebar();
  renderChat();
}

function switchChat(chatId) {
  currentUser.data.currentChatId = chatId;
  saveCurrentUserData();
  renderChatSidebar();
  renderChat();
}

function getCurrentChatMessages() {
  if (!currentUser.data.chatThreads) return [];
  const thread = currentUser.data.chatThreads.find(t => t.id === currentUser.data.currentChatId);
  return thread ? thread.messages : [];
}

function updateCurrentChatMessages(newMessage) {
  const thread = currentUser.data.chatThreads.find(t => t.id === currentUser.data.currentChatId);
  if (thread) {
    thread.messages.push(newMessage);
    // Title generation is now handled asynchronously in sendMessage
  }
}

function renderChatSidebar() {
  const list = document.getElementById("chatHistoryList");
  if (!list) return;
  list.innerHTML = currentUser.data.chatThreads.map(t => `
        <div class="history-item ${t.id === currentUser.data.currentChatId ? 'active' : ''}" onclick="switchChat('${t.id}')">
            💬 ${t.title}
        </div>
    `).join('');
}

// --- UI LOGIC ---
function setAuthMode(mode) {
  authMode = mode;
  document.getElementById("btn-mode-signup").classList.toggle("active", mode === 'signup');
  document.getElementById("btn-mode-signin").classList.toggle("active", mode === 'signin');
  document.getElementById("signupFields").style.display = mode === 'signup' ? "flex" : "none";
  document.getElementById("authSubmitBtn").textContent = mode === 'signup' ? "Initialize Health AI" : "Authenticate Session";
  
  if (mode === 'signup') {
    // Captcha has been removed for frictionless onboarding
  }
}

// Auth logic

async function handleAuth(e) {
  e.preventDefault();
  const errorDiv = document.getElementById("authError");
  errorDiv.classList.add("hidden");

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  let result = { success: false };
  if (authMode === 'signup') {
    const username = document.getElementById("firstName").value;
    const age = document.getElementById("ageInput").value;
    result = await createAccount(email, password, username, age);
  } else {
    result = await login(email, password);
  }

  if (result.success) {
    initChatSystem();
    showApp();
    checkAiStatus();
  } else {
    errorDiv.textContent = result.message;
    errorDiv.classList.remove("hidden");
  }
}

function showApp() {
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  const fab = document.querySelector(".fab-ai");
  if (fab) fab.classList.remove("hidden");
  const mobileHeader = document.querySelector(".mobile-header");
  if (mobileHeader) mobileHeader.classList.remove("hidden");
  document.getElementById("userName").textContent = currentUser.profile.username;

  renderChatSidebar();
  updateDashboard();
  renderGoals();
  renderSleepWeekly();
  renderTrends();
  renderChat();
  startBioSync();
}

function logout() {
  clearSession();
  location.reload();
}

function toggleTheme() {
  const isLight = document.body.classList.toggle("light-mode");
  localStorage.setItem("hfitTheme", isLight ? "light-mode" : "dark-mode");
}

// Secret Dev Reveal Logic
let logoClickCount = 0;

// --- SECRET ARCHITECT ACCESS CODE: 2026hfit ---
let secretBuffer = '';
let secretTimeout = null;
const SECRET_CODE = '2026hfit';
const ARCHITECT_PASSWORD = '2026';

document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

  secretBuffer += e.key.toLowerCase();
  if (secretTimeout) clearTimeout(secretTimeout);
  secretTimeout = setTimeout(() => { secretBuffer = ''; }, 3000);

  if (secretBuffer.endsWith(SECRET_CODE)) {
    secretBuffer = '';
    showArchitectPasswordModal();
  }
});

function showArchitectPasswordModal() {
  // Remove any existing modal
  const existing = document.getElementById('architectModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'architectModal';
  modal.innerHTML = `
    <div style="
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.85); display: flex; justify-content: center; align-items: center;
      z-index: 99999; backdrop-filter: blur(20px);
      animation: architectFadeIn 0.3s ease-out;
    ">
      <div style="
        background: linear-gradient(145deg, rgba(10,15,25,0.98), rgba(5,8,15,0.95));
        border: 1px solid rgba(0, 242, 255, 0.15);
        border-radius: 24px; padding: 45px; max-width: 420px; width: 90%;
        text-align: center; position: relative;
        box-shadow: 0 30px 80px rgba(0,0,0,0.6), 0 0 60px rgba(0, 242, 255, 0.05);
        animation: architectSlideUp 0.4s cubic-bezier(0.23, 1, 0.32, 1);
      ">
        <div style="font-size: 2.5rem; margin-bottom: 15px;">🔐</div>
        <h2 style="
          color: #00f2ff; font-family: 'Inter', sans-serif; font-weight: 900;
          font-size: 1.3rem; letter-spacing: 3px; margin-bottom: 8px;
        ">ARCHITECT ACCESS</h2>
        <p style="
          color: rgba(255,255,255,0.4); font-size: 0.8rem; font-weight: 500;
          margin-bottom: 30px; letter-spacing: 1px;
        ">HFIT CORE AUTHENTICATION REQUIRED</p>
        <input type="password" id="architectPasswordInput" placeholder="Enter access code" 
          autocomplete="off" maxlength="10"
          style="
            width: 100%; padding: 16px 20px; border-radius: 16px; border: 1px solid rgba(0, 242, 255, 0.2);
            background: rgba(0,0,0,0.4); color: #fff; font-size: 1.1rem; font-family: 'Inter', sans-serif;
            text-align: center; letter-spacing: 8px; font-weight: 700;
            outline: none; transition: border-color 0.3s;
            box-sizing: border-box;
          " />
        <div id="architectError" style="
          color: #ef4444; font-size: 0.85rem; font-weight: 700; margin-top: 12px;
          min-height: 20px; letter-spacing: 1px;
        "></div>
        <div style="display: flex; gap: 12px; margin-top: 20px;">
          <button onclick="document.getElementById('architectModal').remove()" style="
            flex: 1; padding: 14px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.1);
            background: transparent; color: rgba(255,255,255,0.5); font-weight: 700;
            cursor: pointer; font-size: 0.85rem; letter-spacing: 1px;
            font-family: 'Inter', sans-serif; transition: all 0.3s;
          ">ABORT</button>
          <button id="architectSubmitBtn" onclick="submitArchitectPassword()" style="
            flex: 1; padding: 14px; border-radius: 14px; border: none;
            background: linear-gradient(135deg, #00f2ff, #0080ff); color: #000; font-weight: 800;
            cursor: pointer; font-size: 0.85rem; letter-spacing: 1px;
            font-family: 'Inter', sans-serif; transition: all 0.3s;
          ">AUTHENTICATE</button>
        </div>
        <p style="
          color: rgba(255,255,255,0.15); font-size: 0.7rem; margin-top: 20px;
          letter-spacing: 0.5px;
        ">ENCRYPTED CHANNEL • HFIT CORE v2.1</p>
      </div>
    </div>
    <style>
      @keyframes architectFadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes architectSlideUp { from { opacity: 0; transform: translateY(30px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
      #architectPasswordInput:focus { border-color: #00f2ff !important; box-shadow: 0 0 20px rgba(0, 242, 255, 0.15); }
      #architectSubmitBtn:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0, 242, 255, 0.3); }
    </style>
  `;
  document.body.appendChild(modal);

  // Focus the input
  setTimeout(() => {
    const inp = document.getElementById('architectPasswordInput');
    if (inp) {
      inp.focus();
      inp.addEventListener('keyup', (ev) => {
        if (ev.key === 'Enter') submitArchitectPassword();
        // Also allow Escape to close
        if (ev.key === 'Escape') document.getElementById('architectModal')?.remove();
      });
    }
  }, 100);
}

function submitArchitectPassword() {
  const inp = document.getElementById('architectPasswordInput');
  const errEl = document.getElementById('architectError');
  if (!inp) return;

  const pwd = inp.value.trim();
  if (pwd === ARCHITECT_PASSWORD) {
    // Success — animate and redirect
    errEl.style.color = '#00f2ff';
    errEl.textContent = 'ACCESS GRANTED';
    inp.style.borderColor = '#00f2ff';
    inp.disabled = true;
    setTimeout(() => {
      document.getElementById('architectModal')?.remove();
      window.location.href = `${BACKEND_URL}/architect-portal`;
    }, 300);
  } else {
    // Wrong password
    errEl.textContent = 'ACCESS DENIED';
    inp.value = '';
    inp.style.borderColor = '#ef4444';
    setTimeout(() => {
      inp.style.borderColor = 'rgba(0, 242, 255, 0.2)';
      errEl.textContent = '';
    }, 1500);
  }
}

function openTab(id) {
  console.log("Hfit Nav: switching to", id);
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".sidebar button").forEach(b => b.classList.remove("active"));

  const target = document.getElementById(id);
  if (!target) return;
  target.classList.add("active");

  const btn = document.getElementById(`btn-${id}`);
  if (btn) btn.classList.add("active");

  // Close sidebar on mobile after selection
  if (window.innerWidth < 1024) {
    document.querySelector('.sidebar').classList.remove('open');
  }

  // Secret Architect Hub Redirect - 15 LOGO CLICKS + OVERVIEW CLICK
  if (id === 'dashboard' && logoClickCount >= 15) {
    logoClickCount = 0; // Reset
    openAdminSigmaMenu();
    return;
  }

  if (id === 'dashboard') updateDashboard();
  if (id === 'ai') setTimeout(() => {
    const chatHist = document.getElementById("chatHistory");
    chatHist.scrollTop = chatHist.scrollHeight;
  }, 100);

  if (id === 'feedback') {
    const hub = document.querySelector('.feedback-hub');
    const form = document.getElementById('feedbackFormContainer');
    if (hub) hub.classList.add('hidden'); // Always hide logs for regular support
    if (form) form.classList.remove('hidden'); // Always show form
  }

  // Auto-scroll to top for better UX on mobile
  const content = document.querySelector('.content');
  if (content) content.scrollTop = 0;
}

function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  sidebar.classList.toggle('open');
}

document.addEventListener('DOMContentLoaded', () => {
  // Mobile Menu Toggle
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', toggleSidebar);
  }

  // Dashboard buttons (Theme, Visits, Reset)
  document.getElementById('themeToggleBtn')?.addEventListener('click', toggleTheme);
  
  const visitsBtn = document.querySelector('[data-t="site-visits"]');
  if (visitsBtn) visitsBtn.addEventListener('click', fetchVisitsCount);

  const resetBadge = document.querySelector('.status-badge');
  if (resetBadge) resetBadge.addEventListener('click', resetDevice);

  setTimeout(() => {
    const logo = document.querySelector('.sidebar-logo');
    if (logo) {
      logo.addEventListener('click', () => {
        logoClickCount++;
        console.log("System Sequence:", logoClickCount);
      });
    }
  }, 1000);

  const authForm = document.getElementById('authForm');
  if (authForm) {
    authForm.addEventListener('submit', handleAuth);
  }

  // Initial check
  checkAiStatus();
});

// --- DATA PERSISTENCE HELPERS ---
async function saveCurrentUserData() {
  if (!currentUser) return;
  const token = getSession();
  if (!token) return;

  try {
    await fetch(`${BACKEND_URL}/api/data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ data: currentUser.data })
    });
  } catch (e) {
    console.warn("Failed to sync data to core:", e);
  }
}

window.openAdminSigmaMenu = async function() {
    alert("SECURITY ALERT: This feature has been disabled for safety. Use the promote_admin chat command or the Architect Portal password.");
};

window.fetchVisitsCount = async function() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/get-visits`);
    const data = await res.json();
    const modal = document.getElementById('visitsModal');
    if (modal) {
      document.getElementById('visitsModalText').textContent = `${data.visits} / 500 visits`;
      const pct = Math.min((data.visits / 500) * 100, 100);
      document.getElementById('visitsProgressBar').style.width = `${pct}%`;
      modal.classList.remove('hidden');
    }
  } catch (e) {
    console.error(e);
  }
};


async function askAI(message, systemPrompt = "You are a helpful health agent.", imageBase64 = null, onChunk = null) {
  const disclaimer = "\n\nDISCLAIMER: This information is for 'good purpose' only and must be confirmed with a licensed medical professional before taking any action. Do not make medical decisions based on this AI.";

  updateStatusUI("SYNCING...", "var(--accent-primary)");

  try {
    const langCode = document.documentElement.lang || 'en';
    const langName = langCode === 'iw' ? 'Hebrew (עברית)' : 'English';
    const languageDirective = `\n\nCRITICAL: Respond ONLY in ${langName}. Do not use any other language. Ensure all medical and health information is accurate and professional.`;

    const res = await fetch(`${BACKEND_URL}/chat`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${getSession()}`
      },
      body: JSON.stringify({
        message,
        system: systemPrompt + languageDirective,
        model: AI_MODEL,
        image: imageBase64,
        stream: !!onChunk
      }),
      signal: AbortSignal.timeout(120000) // Increase timeout for reliable delivery 
    });

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || `Server Error ${res.status}`);
    }

    if (onChunk) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullReply = "";

      try {
        let streamTimeout;
        while (true) {
          const { done, value } = await Promise.race([
            reader.read(),
            new Promise((_, reject) => {
              streamTimeout = setTimeout(() => reject(new Error("Stream timeout")), 15000);
            })
          ]);
          clearTimeout(streamTimeout);
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const dataStr = line.slice(6);
              if (dataStr.trim() === "[DONE]") break;
              try {
                const data = JSON.parse(dataStr);
                const content = data.choices[0]?.delta?.content || "";
                if (content) {
                  fullReply += content;
                  onChunk(fullReply);
                }
              } catch (e) {
                // Ignore partial JSON or other stream noise
              }
            }
          }
        }
      } catch (err) {
        console.warn("Stream disconnected early or timed out:", err);
        if (!fullReply) fullReply = "Connection interrupted. Partial response unavailable.";
      }

      updateStatusUI("CORE READY", "var(--accent-primary)");
      return fullReply;
    } else {
      const data = await res.json();
      console.log("[AI SYNC]", data);
      updateStatusUI("CONNECTED TO CORE", "var(--accent-primary)");
      return data.reply || "No response received.";
    }
  } catch (error) {
    console.warn(`Request failed:`, error.message);
    updateStatusUI("CORE OFFLINE", "#ef4444");
    return `Error: ${error.message}. Potential Reasons: Server not running or API issue.`;
  }
}

// Merged with final updateDashboard below

// --- AI CHAT ---
function formatAIResponse(text) {
  if (!text) return "";
  // More organized and robust formatting
  let formatted = text
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^# (.*$)/gm, '<h1 style="color:var(--accent-primary); margin-top:15px;">$1</h1>')
    .replace(/^## (.*$)/gm, '<h2 style="color:var(--accent-primary); margin-top:12px;">$1</h2>')
    .replace(/^### (.*$)/gm, '<h3 style="margin-top:10px;">$1</h3>')
    .replace(/^\s*[-•*]\s*(.*)$/gm, '<li style="margin-bottom:6px;">$1</li>');

  // Intelligent list wrapping
  formatted = formatted.replace(/(<li>.*<\/li>)/gs, (match) => `<ul style="padding-left:20px; margin-top:10px; margin-bottom:15px; border-left: 2px solid var(--accent-primary); list-style:none;">${match}</ul>`);

  formatted = formatted
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" style="color:var(--accent-primary); text-decoration:underline;">$1</a>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');

  return formatted;
}

function renderChat() {
  const container = document.getElementById("chatHistory");
  const messages = getCurrentChatMessages();
  container.innerHTML = messages.map(m => {
    let contentHtml = m.role === 'assistant' ? formatAIResponse(m.content) : m.content;
    if (m.image) {
      contentHtml = `<img src="${m.image}" style="max-width:100%; border-radius:12px; margin-bottom:10px; display:block;" />` + contentHtml;
    }

    const avatar = m.role === 'user' ? '👤' : '🤖';
    return `
      <div class="message-wrapper ${m.role}-wrapper">
        <div class="message-avatar">${avatar}</div>
        <div class="message ${m.role === 'user' ? 'user-msg' : 'ai-msg'}">${contentHtml}</div>
      </div>
    `;
  }).join('');

  if (messages.length === 0) {
    const lang = document.documentElement.lang || 'en';
    const dict = translations[lang] || translations['en'];
    const welcomeMsg = lang === 'iw' 
      ? `ברוכים הבאים ל-Hfit Premium, ${currentUser.profile.username}. איך אוכל לשפר את הביצועים שלך היום? אני מצויד כעת ב-<strong>ראייה רפואית</strong>. תוכל להעלות תמונות של אוכל או אפילו בעיות עור לניתוח.`
      : `Welcome to Hfit Premium, ${currentUser.profile.username}. How can I optimize your performance today? I am now equipped with <strong>Medical Vision</strong>. You can upload photos of food or even skin concerns for analysis.`;
    
    container.innerHTML = `
      <div class="message-wrapper assistant-wrapper">
        <div class="message-avatar">🤖</div>
        <div class="message ai-msg">
          ${welcomeMsg}
        </div>
      </div>
    `;
  }
  container.scrollTop = container.scrollHeight;
}

function sendMessage() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text) return;

  if (text.toLowerCase().startsWith("promote_admin:")) {
    // Pass the command to the AI so the backend can verify the key
  }

  updateCurrentChatMessages({ role: "user", content: text });
  renderChat();
  input.value = "";
  saveCurrentUserData();

  const container = document.getElementById("chatHistory");

  // Create temporary wrapper for loading
  const wrapper = document.createElement("div");
  wrapper.className = "message-wrapper assistant-wrapper";
  wrapper.innerHTML = `
    <div class="message-avatar">🤖</div>
    <div class="message ai-msg">
      <div class="typing"><span>HFIT CORE THINKING...</span><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>
    </div>
  `;
  container.appendChild(wrapper);
  const aiMsgBox = wrapper.querySelector(".ai-msg");
  container.scrollTop = container.scrollHeight;

  const sysPrompt = `You are Hfit AI Agent, an elite advanced health agent.
Follow these 20 core rules strictly:

Safety & Reliability:
1. Do Not Guess: If information is missing, ask a clarifying question or clearly state that the answer is an "estimate."
2. Knowledge Boundaries: If unsure, state so clearly. Never invent or hallucinate answers.
3. Prevent Medical Risks: For sensitive topics, provide general info only and explicitly recommend consulting a medical professional. Never provide dangerous instructions.

Understanding the User:
4. Smart Clarifications: Before important recommendations, ask up to 2 brief, essential clarifying questions.
5. Contextual Awareness: Utilize provided info. Don't answer as if every prompt is the first.

Structure & Tone:
6. Straight to the Point: First sentence must directly answer the user's question.
7. Stick to the Prompt: Answer only what was asked.
8. Comprehensive Answers: Cover all parts of the question.
9. Adjust Depth: Brief for simple questions, detailed for complex.
10. Simple & Human Language: Avoid unnecessary medical jargon.

Accuracy & Consistency:
11. No Contradictions: Maintain consistency in numbers/data.
12. Accurate Terminology: Use correct and precise concepts/terms.
13. Self-Correction: Update response if new user info is provided.
14. Logic Check: Verify internally if logical and realistic.

Calculations & Data:
15. Smart Calculations: Break down math, calculate per quantity, summarize, state if exact or estimate. Do not skip steps or guess numbers.

User Experience (UX):
16. Prioritize: Start with most important information.
17. Prevent Confusion: Max 1-2 options, clearly recommend the best one.
18. Format Consistency: Keep uniform structure. Use sharp, clean formatting.
19. Use Examples: Provide short examples when necessary.

Ending the Response:
20. Value-Driven Closing: Every response MUST end with ONE of the following: A one-sentence summary, ONE clear actionable step, or a follow-up question (if more info needed).`;

  askAI(text, sysPrompt, null, null).then(response => {
    // Check if the response is an object (for special actions) or just text
    let finalReply = typeof response === 'string' ? response : response.reply;
    
    if (typeof response === 'object' && response.action === 'reload_admin') {
      // Secret command handled
      window.openAdminSigmaMenu();
    }

    aiMsgBox.innerHTML = formatAIResponse(finalReply);
    updateCurrentChatMessages({ role: "assistant", content: finalReply });
    saveCurrentUserData();
    container.scrollTop = container.scrollHeight;

    // Asynchronously generate a topic title if this is the first exchange
    const thread = currentUser.data.chatThreads.find(t => t.id === currentUser.data.currentChatId);
    if (thread && thread.messages.length === 2 && thread.title === "New Conversation") {
      askAI(
        `Based on this exchange: \nUser: ${text} \nAI: ${finalReply} \nProvide 2 or 4 short title options (separated by |). Respond with ONLY the options.`,
        "You are a title generator. Respond with nothing but the short title."
      ).then(titleReply => {
        if (titleReply && titleReply.trim() && !titleReply.startsWith("Error")) {
          thread.title = titleReply.includes('|') ? titleReply.split('|')[0].trim() : titleReply.replace(/["']/g, "").trim();
          renderChatSidebar();
          saveCurrentUserData();
        }
      }).catch(e => console.error("Topic generation failed", e));
    }
  }).catch(error => {
    console.error("Chat Error:", error);
    aiMsgBox.innerHTML = `<span style="color:#ef4444;">HFIT CORE ERROR: ${error.message || "Unknown error during transmission."}</span>`;
    updateStatusUI("CORE OFFLINE", "#ef4444");
  });
}

// --- IMAGE REDUCER UTILS ---
function resizeImage(file, maxWidth, maxHeight, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > maxWidth) { height = Math.round((height *= maxWidth / width)); width = maxWidth; }
      } else {
        if (height > maxHeight) { width = Math.round((width *= maxHeight / height)); height = maxHeight; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      callback(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// --- FOOD ANALYZER ---
let foodImageBase64 = null;
function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  resizeImage(file, 1024, 1024, (resizedBase64) => {
    foodImageBase64 = resizedBase64;
    const prev = document.getElementById("foodPreview");
    prev.src = foodImageBase64;
    prev.classList.remove("hidden");
    document.getElementById("uploadPlaceholder").classList.add("hidden");
    document.getElementById("foodResult").textContent = ""; // Clear previous result
  });
}

function clearFoodAnalyzer() {
  foodImageBase64 = null;
  document.getElementById("foodImage").value = "";
  document.getElementById("foodPreview").src = "";
  document.getElementById("foodPreview").classList.add("hidden");
  document.getElementById("uploadPlaceholder").classList.remove("hidden");
  document.getElementById("foodInput").value = "";
  document.getElementById("foodResult").textContent = "";
  document.getElementById("food-cals").textContent = "0";
  document.getElementById("food-protein").textContent = "0g";
  document.getElementById("food-carbs").textContent = "0g";
  document.getElementById("food-fats").textContent = "0g";
}

async function analyzeFood(e) {
  const lang = document.documentElement.lang || 'en';
  const query = document.getElementById("foodInput").value;
  const status = document.getElementById("foodResult");
  const btn = e?.target?.closest('button') || document.querySelector('button[onclick*="analyzeFood"]');
  const currentImage = foodImageBase64;

  if (!query && !currentImage) {
    status.textContent = "REQUIRED: PHOTO OR DESCRIPTION.";
    status.style.color = "#ef4444";
    return;
  }

  // Visual Feedback
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner"></div> ANALYZING...`;

  status.textContent = "SYNCING WITH NUTRITION ENGINE...";
  status.style.color = "var(--accent-primary)";

  const prompt = `Analyze this meal accurately and carefully: ${query || "image"}. Identify the food accurately. Provide highly accurate calories, protein, carbs, and fats. Return ONLY a valid JSON: { "cals": 500, "protein": 30, "carbs": 40, "fats": 20, "name": "Meal Name" }. Ensure the "name" is in ${lang === 'iw' ? 'Hebrew' : 'English'}. No markdown or extra text.`;

  try {
    const reply = await askAI(prompt, "Nutrition expert ONLY. Return raw JSON string.", currentImage);

    if (reply.startsWith("Error:")) {
      throw new Error(reply);
    }

    // Robust parsing
    let result = null;
    try {
      const jsonStrMatch = reply.match(/\{[\s\S]*\}/);
      if (!jsonStrMatch) throw new Error("No JSON found in AI response");
      result = JSON.parse(jsonStrMatch[0]);
    } catch (parseErr) {
      console.warn("JSON parse failed, checking for text fallbacks...", parseErr);
      const calsMatch = reply.match(/(\d+)\s*cals/i) || reply.match(/calories:\s*(\d+)/i);
      if (calsMatch) {
        const lang = document.documentElement.lang || 'en';
        const dict = translations[lang] || translations['en'];
        result = {
          cals: parseInt(calsMatch[1]),
          protein: 0, carbs: 0, fats: 0,
          name: dict["identified-meal"] || "IDENTIFIED MEAL"
        };
      }
    }

    if (!result) {
      throw new Error("Could not parse nutrition data.");
    }

    // Normalize keys
    const cals = result.cals || result.calories || 0;
    const protein = result.protein || 0;
    const carbs = result.carbs || 0;
    const fats = result.fats || result.fat || 0;

    document.getElementById("food-cals").textContent = cals;
    document.getElementById("food-protein").textContent = protein + "g";
    document.getElementById("food-carbs").textContent = carbs + "g";
    document.getElementById("food-fats").textContent = fats + "g";
    document.getElementById("dash-cals").textContent = cals;

    // Save calorie data to today's history
    const today = new Date().toLocaleDateString();
    if (!currentUser.data.sleep) currentUser.data.sleep = [];
    let todayLog = currentUser.data.sleep.find(s => s.fullDate === today);
    if (!todayLog) {
      todayLog = {
        date: new Date().toLocaleDateString('en-US', { weekday: 'short' }),
        fullDate: today,
        hours: 0,
        percent: 0,
        cals: 0
      };
      currentUser.data.sleep.push(todayLog);
    }
    todayLog.cals = (todayLog.cals || 0) + cals;

    // Reset visuals gracefully
    foodImageBase64 = null;
    document.getElementById("foodPreview").classList.add("hidden");
    document.getElementById("uploadPlaceholder").classList.remove("hidden");
    document.getElementById("foodInput").value = "";

    saveCurrentUserData();
    updateDashboard();
    
    // Jump to dashboard after short delay to see result
    setTimeout(() => openTab('dashboard'), 2000);
  } catch (e) {
    const lang = document.documentElement.lang || 'en';
    const dict = translations[lang] || translations['en'];
    console.error("ANALYSIS_ERROR:", e);
    status.textContent = dict["analysis-failed"] || "ANALYSIS FAILED.";
    status.style.color = "#ef4444";
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// --- SLEEP ---
function trackSleep() {
  let hours = parseFloat(document.getElementById("sleepInput").value);
  const status = document.getElementById("sleepStatus");
  status.classList.add("hidden");

  if (isNaN(hours)) {
    const lang = document.documentElement.lang || 'en';
    const dict = translations[lang] || translations['en'];
    status.textContent = dict["hours-required"] || "REQUIRED: HOURS.";
    status.classList.remove("hidden");
    return;
  }

  const today = new Date().toLocaleDateString();
  const alreadyTracked = currentUser.data.sleep.find(s => s.fullDate === today);

  if (alreadyTracked && alreadyTracked.hours > 0) {
    const lang = document.documentElement.lang || 'en';
    const dict = translations[lang] || translations['en'];
    status.textContent = dict["metrics-finalized"] || "FINALIZED.";
    status.classList.remove("hidden");
    return;
  }

  const ideal = currentUser.profile.age < 18 ? 9 : 8;
  const percent = Math.min(Math.round((hours / ideal) * 100), 100);

  if (alreadyTracked) {
    alreadyTracked.hours = hours;
    alreadyTracked.percent = percent;
  } else {
    currentUser.data.sleep.push({
      date: new Date().toLocaleDateString('en-US', { weekday: 'short' }),
      fullDate: today,
      hours,
      percent
    });
  }

  if (currentUser.data.sleep.length > 7) currentUser.data.sleep.shift();

  renderSleepWeekly();
  updateSleepCircle(percent);
  saveCurrentUserData();
  updateDashboard();
  document.getElementById("sleepInput").value = "";

  const insightEl = document.getElementById("sleepAiInsight");
  insightEl.classList.remove("hidden");
  insightEl.innerHTML = `<div class="typing"><span>ANALYZING SLEEP METRICS...</span><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
  const age = currentUser.profile.age || 25;
  const prompt = `I am ${age} years old and I slept for ${hours} hours today. Analyze this in one short paragraph and provide a small description saying if I need more or less sleep for my age. Use a supportive tone.`;
  askAI(prompt, "You are an elite sleep expert AI. Respond in a few sentences only.").then(reply => {
     insightEl.innerHTML = `<button type="button" onclick="document.getElementById('sleepAiInsight').classList.add('hidden')" style="float:right; background:none; color:var(--text-dim); padding:0; font-size:1.2rem;">✖</button><strong>🤖 Sleep Expert Insight:</strong><br><br>${reply}`;
  }).catch(() => {
     insightEl.innerHTML = `<button type="button" onclick="document.getElementById('sleepAiInsight').classList.add('hidden')" style="float:right; background:none; color:var(--text-dim); padding:0; font-size:1.2rem;">✖</button><strong>🤖 Sleep Expert Insight:</strong><br><br>Connection to Sleep Core lost. Please try again later.`;
  });
}

function updateSleepCircle(percent) {
  document.getElementById("sleepPercent").textContent = `${percent}% `;
  document.getElementById("sleepCircle").style.background = `conic-gradient(var(--accent-primary) ${percent * 3.6}deg, var(--glass-border) 0deg)`;
}

function renderSleepWeekly() {
  const container = document.getElementById("sleepWeeklyList");
  const lang = document.documentElement.lang || 'en';
  const hebrewDays = {
    'Sun': 'יום ראשון',
    'Mon': 'יום שני',
    'Tue': 'יום שלישי',
    'Wed': 'יום רביעי',
    'Thu': 'יום חמישי',
    'Fri': 'יום שישי',
    'Sat': 'שבת'
  };
  container.innerHTML = currentUser.data.sleep.map(s => {
    let displayDate = s.date;
    if (lang === 'iw' && hebrewDays[s.date]) {
      displayDate = hebrewDays[s.date];
    }
    return `
    <div class="day-circle-box">
      <div class="day-circle ${s.percent >= 80 ? 'score-high' : ''}">${s.percent}%</div>
      <span class="day-label">${displayDate}</span>
    </div>
    `;
  }).join('');
}

// --- PLANNING ---
let planMode = 'workout';
function setPlanMode(mode) {
  planMode = mode;
  document.getElementById("btn-mode-workout").classList.toggle("active", mode === 'workout');
  document.getElementById("btn-mode-meal").classList.toggle("active", mode === 'meal');
  document.getElementById("workoutInputs").classList.toggle("hidden", mode !== 'workout');
  document.getElementById("mealInputs").classList.toggle("hidden", mode !== 'meal');
  loadSavedPlans();
}

async function generatePlan() {
  const lang = document.documentElement.lang || 'en';
  const dict = translations[lang] || translations['en'];
  const resBox = document.getElementById("planResult");
  resBox.classList.remove("hidden");
  resBox.innerHTML = `<div class="typing"><span>${dict["architecting"] || "ARCHITECTING"}</span><div class="typing-dot"></div><div class="typing-dot"></div></div>`;

  const prompt = planMode === 'workout'
    ? `Workout: ${document.getElementById("targetArea").value}, Time: ${document.getElementById("timePerWorkout").value}, Loc: ${document.getElementById("location").value}.`
    : `Meal Plan: ${document.getElementById("mealGoal").value}, Diet: ${document.getElementById("dietType").value}.`;

  const reply = await askAI(prompt, "Elite conditioning coach. Provide raw text outline with bold headers and bullet points. Neat and organized.");
  const title = dict["elite-strategy"] || "ELITE STRATEGY";
  const formattedReply = `<strong> ${title} (${planMode.toUpperCase()}):</strong> <br><br>${reply.replace(/\n/g, "<br>")}`;
  resBox.innerHTML = formattedReply;

  // Persistence
  if (!currentUser.data.lastPlans) currentUser.data.lastPlans = {};
  currentUser.data.lastPlans[planMode] = formattedReply;
  saveCurrentUserData();
}

function loadSavedPlans() {
  const resBox = document.getElementById("planResult");
  if (currentUser.data.lastPlans && currentUser.data.lastPlans[planMode]) {
    resBox.innerHTML = currentUser.data.lastPlans[planMode];
    resBox.classList.remove("hidden");
  } else {
    resBox.innerHTML = "";
    resBox.classList.add("hidden");
  }
}

function clearPlanAnalyzer() {
  document.getElementById("targetArea").value = "";
  document.getElementById("timePerWorkout").value = "";
  document.getElementById("location").value = "";
  document.getElementById("mealGoal").value = "";
  document.getElementById("dietType").value = "";
  const resultDiv = document.getElementById("planResult");
  resultDiv.classList.add("hidden");
  resultDiv.innerHTML = "";
  if (currentUser.data.lastPlans) {
    currentUser.data.lastPlans[planMode] = "";
    saveCurrentUserData();
  }
}

const originalOpenTab = openTab;
openTab = (id) => {
  originalOpenTab(id);
  if (id === 'workout') loadSavedPlans();
};

// --- BRUISE IDENTIFIER ---
let bruiseImageBase64 = null;
function handleBruiseUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  resizeImage(file, 512, 512, (resizedBase64) => {
    bruiseImageBase64 = resizedBase64;
    const prev = document.getElementById("bruisePreview");
    prev.src = bruiseImageBase64;
    document.getElementById("scannerContainer").classList.remove("hidden");
    document.getElementById("bruisePlaceholder").classList.add("hidden");
    document.getElementById("bruiseResult").classList.add("hidden");
    document.getElementById("bruiseResult").innerHTML = "";
  });
}

function clearBruiseAnalyzer() {
  bruiseImageBase64 = null;
  document.getElementById("bruiseImage").value = "";
  document.getElementById("bruisePreview").src = "";
  document.getElementById("scannerContainer").classList.add("hidden");
  document.getElementById("bruisePlaceholder").classList.remove("hidden");
  const bruiseResult = document.getElementById("bruiseResult");
  bruiseResult.classList.add("hidden");
  bruiseResult.innerHTML = "";
}

async function analyzeBruise(e) {
  const lang = document.documentElement.lang || 'en';
  const status = document.getElementById("bruiseResult");
  const btn = e?.target?.closest('button') || document.querySelector('button[onclick*="analyzeBruise"]');
  const currentImage = bruiseImageBase64;

  if (!currentImage) {
    const lang = document.documentElement.lang || 'en';
    const dict = translations[lang] || translations['en'];
    status.classList.remove("hidden");
    status.innerHTML = `<span style="color:#ef4444;">${dict["vision-error"] || "SYNC ERROR: NO VISUAL DATA UPLOADED."}</span>`;
    return;
  }

  // Visual Feedback
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner"></div> SCANNING...`;

  document.getElementById("scannerContainer").classList.add("active-scan");
  status.classList.remove("hidden");
  status.innerHTML = `<div class="typing"><span>SCANNING DERMAL TISSUE...</span><div class="typing-dot"></div><div class="typing-dot"></div></div>`;

  const prompt = `Analyze this image extremely carefully. Identify what is in this image (skin concern, bruise, rash, etc.) with high accuracy. Provide a professional medical description, potential causes, and urgency level. Use bold headers. Respond in ${lang === 'iw' ? 'Hebrew' : 'English'}.`;

  try {
    const reply = await askAI(prompt, "Hfit Vision Module. Medical diagnostic tone with clear, professional headers. Elite response formatting.", currentImage);

    // Check if error message returned
    if (reply.startsWith("Error:")) {
      throw new Error(reply);
    }

    // Save result to dashboard
    if (!currentUser.data.visionHistory) currentUser.data.visionHistory = [];
    currentUser.data.visionHistory.unshift({
      timestamp: new Date().toISOString(),
      displayDate: new Date().toLocaleString(),
      result: reply
    });
    if (currentUser.data.visionHistory.length > 5) currentUser.data.visionHistory.pop();

    // Clear visual preview
    document.getElementById("scannerContainer").classList.remove("active-scan");
    document.getElementById("scannerContainer").classList.add("hidden");
    document.getElementById("bruisePlaceholder").classList.remove("hidden");
    bruiseImageBase64 = null;
    
    saveCurrentUserData();
    updateDashboard();
    
    // Switch to dashboard to show permanence
    setTimeout(() => openTab('dashboard'), 3000);
  } catch (e) {
    const lang = document.documentElement.lang || 'en';
    const dict = translations[lang] || translations['en'];
    console.error("BRUISE_SCAN_ERROR:", e);
    document.getElementById("scannerContainer").classList.remove("active-scan");
    status.innerHTML = `<span style="color:#ef4444;">${dict["scan-interrupted"] || "SCAN INTERRUPTED."}</span>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// --- GOALS ---
function addGoal() {
  const input = document.getElementById("goalInput");
  const targetInput = document.getElementById("goalTarget");
  const unitInput = document.getElementById("goalUnit");

  const text = input.value.trim();
  const targetValue = parseFloat(targetInput.value) || 0;
  const unit = unitInput.value.trim() || "";

  if (!text) return;
  currentUser.data.goals.push({
    text,
    done: false,
    targetValue,
    currentValue: 0,
    unit
  });

  input.value = "";
  targetInput.value = "";
  unitInput.value = "";

  renderGoals();
  saveCurrentUserData();
  updateDashboard();
}

function toggleGoal(idx) {
  // Not used directly with new buttons, kept for reference or replace if desired.
}

function completeGoal(idx) {
  const goalItems = document.querySelectorAll('.goal-item');
  const targetItem = goalItems[idx];

  if (targetItem) {
    targetItem.classList.add('success-burst');
  }

  currentUser.data.goals[idx].done = true;
  saveCurrentUserData();
  updateDashboard();

  setTimeout(() => {
    currentUser.data.goals.splice(idx, 1);
    renderGoals();
    saveCurrentUserData();
    updateDashboard();
  }, 600);
}

function deleteGoal(idx) {
  currentUser.data.goals.splice(idx, 1);
  renderGoals();
  saveCurrentUserData();
  updateDashboard();
}

function renderGoals() {
  const list = document.getElementById("goalList");
  list.innerHTML = currentUser.data.goals.map((g, i) => {
    const progress = g.targetValue > 0 ? Math.min((g.currentValue / g.targetValue) * 100, 100) : (g.done ? 100 : 0);
    const circleContent = g.targetValue > 0 ? Math.round(progress) + '%' : (g.done ? '✔' : '📌');
    const circleSize = g.targetValue > 0 ? '0.7rem' : '1.2rem';

    return `
      <li class="goal-item" style="display:flex; align-items:center; gap:15px; background:var(--glass-bg); padding:20px; border-radius:24px; border:1px solid var(--glass-border);">
        <div class="progress-circle" style="width:50px; height:50px; min-width:50px; background: conic-gradient(var(--accent-primary) ${progress * 3.6}deg, var(--glass-border) 0deg);">
          <span style="font-size:${circleSize};">${circleContent}</span>
        </div>
        <div style="flex-grow:1;">
          <p style="font-weight:700; font-size:1.1rem; margin-bottom:2px; text-decoration: ${g.done ? 'line-through' : 'none'}; opacity: ${g.done ? 0.6 : 1};">${g.text}</p>
          ${g.targetValue > 0 ? `<p style="font-size:0.8rem; color:var(--text-dim);">${g.currentValue} / ${g.targetValue} ${g.unit}</p>` : ''}
          ${g.targetValue > 0 ? `
          <div style="display:flex; gap:8px; margin-top:8px;">
            <button class="btn-small btn-secondary" style="padding:4px 12px; font-size:0.75rem; min-height:28px;" onclick="adjustGoalAmount(${i})">Adjust</button>
          </div>
          ` : ''}
        </div>
        <div style="display:flex; gap:10px;">
          <button class="goal-btn-check ${g.done ? 'checked' : ''}" onclick="completeGoal(${i})" title="Complete">✔</button>
          <button class="goal-btn-cross" onclick="deleteGoal(${i})" title="Delete">✖</button>
        </div>
      </li>
    `;
  }).join('');
}

function adjustGoalAmount(idx) {
  const goal = currentUser.data.goals[idx];
  const modal = document.getElementById("goalAdjustModal");
  if (!modal) {
    let val = prompt(`Enter NEW TOTAL for "${goal.text}" (Current: ${goal.currentValue} ${goal.unit}):`);
    if (val === null) return;
    let num = parseFloat(val);
    saveGoalAdjustment(idx, num);
    return;
  }
  document.getElementById("goalAdjustText").textContent = `Enter NEW TOTAL for "${goal.text}" (Current: ${goal.currentValue} ${goal.unit}):`;
  const input = document.getElementById("goalAdjustInput");
  input.value = goal.currentValue;
  
  modal.classList.remove("hidden");
  input.focus();
  
  const btn = document.getElementById("goalAdjustBtn");
  btn.onclick = () => {
    let num = parseFloat(input.value);
    modal.classList.add("hidden");
    saveGoalAdjustment(idx, num);
  };
  input.onkeyup = (e) => {
    if (e.key === 'Enter') {
      let num = parseFloat(input.value);
      modal.classList.add("hidden");
      saveGoalAdjustment(idx, num);
    }
  };
}

function saveGoalAdjustment(idx, num) {
  if (!isNaN(num)) {
    currentUser.data.goals[idx].currentValue = Math.max(0, num);
    if (currentUser.data.goals[idx].currentValue >= currentUser.data.goals[idx].targetValue) {
      currentUser.data.goals[idx].done = true;
    } else {
      currentUser.data.goals[idx].done = false;
    }
    renderGoals();
    saveCurrentUserData();
    updateDashboard();
  }
}

// --- ACTIVITIES ---
let selectedActivityType = 'Run';
let selectedActivityIcon = '🏃';

function setActivityType(type, icon) {
  selectedActivityType = type;
  selectedActivityIcon = icon;
  document.querySelectorAll('.activity-selector button').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.includes(type));
  });
}

function logActivity() {
  const duration = parseInt(document.getElementById("activityDuration").value);
  const notes = document.getElementById("activityNotes").value.trim();

  if (!duration) return;

  const activity = {
    type: selectedActivityType,
    icon: selectedActivityIcon,
    duration,
    notes,
    timestamp: new Date().toISOString(),
    displayDate: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };

  if (!currentUser.data.activities) currentUser.data.activities = [];
  currentUser.data.activities.unshift(activity);

  // Keep only last 20 activities
  if (currentUser.data.activities.length > 20) currentUser.data.activities.pop();

  document.getElementById("activityDuration").value = "";
  document.getElementById("activityNotes").value = "";

  renderActivities();
  saveCurrentUserData();
  updateDashboard();

  if (typeof showNotification === 'function') {
    showNotification("Activity Logged", `${activity.type} completed and saved.`);
  }
}

function renderActivities() {
  const container = document.getElementById("activityHistory");
  if (!container || !currentUser.data.activities) return;

  container.innerHTML = currentUser.data.activities.map(a => `
    <div style="display:flex; align-items:center; gap:15px; background:var(--glass-bg); padding:20px; border-radius:30px; border:1px solid var(--glass-border); transition:var(--transition); margin-bottom: 2px;">
      <div style="width:50px; height:50px; min-width:50px; background:var(--accent-primary); color:#000; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:1.5rem;">${a.icon}</div>
      <div style="flex-grow:1;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
           <h4 style="margin:0; font-size:1.1rem; color:var(--text-main);">${a.type}</h4>
           <span style="font-size:0.8rem; color:var(--accent-primary); font-weight:700;">${a.displayDate}</span>
        </div>
        <p style="margin:0; font-size:0.9rem; color:var(--text-dim);">
           ${a.duration} minutes of performance
           ${a.notes ? `<br><span style="font-style:italic; opacity:0.8;">"${a.notes}"</span>` : ''}
        </p>
      </div>
    </div>
  `).join('');
}

// --- FEEDBACK ---
// New function to load feedback logs
async function loadFeedbackHub() {
  const container = document.getElementById("feedbackList");
  if (!container) return;

  const lang = document.documentElement.lang || 'en';
  const dict = translations[lang] || translations['en'];

  container.innerHTML = `<p style="text-align:center; color:var(--text-dim);">${dict["loading-logs"] || "Retrieving logs..."}</p>`;


  try {
    const res = await fetch(`${BACKEND_URL}/feedback-logs`);
    const data = await res.json();
    if (data.success && data.logs) {
      if (data.logs.length === 0) {
        container.innerHTML = `<p style="text-align:center; color:var(--text-dim);">No logs found in the core buffer.</p>`;
        return;
      }

      container.innerHTML = data.logs.map((log, i) => `
        <div class="feedback-card" style="animation-delay: ${i * 0.1}s">
          <div class="feedback-meta">
            <span>USER: ${log.name || 'Anonymous'}</span>
            <span style="opacity: 0.7; font-size: 0.75rem;">${new Date(log.timestamp).toLocaleString()}</span>
          </div>
          <div class="feedback-text">${log.feedback}</div>
          ${log.reply ? `
            <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--glass-border); font-size: 0.85rem;">
              <strong style="color: var(--accent-primary);">ARCHITECT RELAY:</strong>
              <p style="font-style: italic; opacity: 0.9;">${log.reply}</p>
            </div>
          ` : ''}
        </div>
      `).join('');
    } else {
      container.innerHTML = `<p style="color:#ef4444; text-align:center;">Encryption error. Could not retrieve logs.</p>`;
    }
  } catch (e) {
    console.error("Failed to load feedback logs:", e);
    container.innerHTML = `<p style="color:#ef4444; text-align:center;">Connection lost to Feedback Core.</p>`;
  }
}

// --- GOOGLE AUTH ---
async function loginWithGoogle() {
  // --- MOCK GOOGLE AUTHENTICATION POPUP ---
  // Since you don't have a Google Client ID, we are simulating the Google Accounts popup
  // so the feature actually works and you don't get the 'invalid_client' error!

  const modalHtml = `
    <div id="mockGoogleModal" style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.6); display:flex; justify-content:center; align-items:center; z-index:9999; backdrop-filter:blur(8px); animation: fadeIn 0.3s ease-out;">
      <div style="background:#fff; width:450px; border-radius:12px; padding:40px; text-align:center; color:#202124; font-family:'Roboto', sans-serif; box-shadow:0 15px 40px rgba(0,0,0,0.3); transform: translateY(0); animation: slideUp 0.4s cubic-bezier(0.23, 1, 0.32, 1);">
        <div style="font-size:24px; font-weight:500; margin-bottom:15px;">
          <span style="color:#4285F4">G</span><span style="color:#EA4335">o</span><span style="color:#FBBC05">o</span><span style="color:#4285F4">g</span><span style="color:#34A853">l</span><span style="color:#EA4335">e</span>
        </div>
        <h2 style="font-size:22px; font-weight:500; margin-bottom:10px; color:#3c4043;">Choose an account</h2>
        <p style="font-size:16px; margin-bottom:30px; color:#5f6368;">to continue to <strong style="color:#202124;">Hfit Premium</strong></p>

        <div style="text-align:left; border:1px solid #dadce0; border-radius:8px; overflow:hidden; margin-bottom: 20px;">
          <div class="google-acc" onclick="simulateGoogleLogin('danielrykner@gmail.com', 'Daniel Rykner')" style="padding:15px 20px; border-bottom:1px solid #dadce0; cursor:pointer; display:flex; align-items:center; transition:background 0.2s;">
            <div style="width:36px; height:36px; background:#4285F4; color:white; border-radius:50%; display:flex; justify-content:center; align-items:center; font-weight:bold; margin-right:15px; font-size: 16px;">D</div>
            <div>
              <div style="font-weight:500; font-size:14px; color:#3c4043;">Daniel Rykner</div>
              <div style="font-size:12px; color:#5f6368;">danielrykner@gmail.com</div>
            </div>
          </div>
          <div class="google-acc" onclick="simulateGoogleLogin('test@health.ai', 'Test User')" style="padding:15px 20px; cursor:pointer; display:flex; align-items:center; transition:background 0.2s;">
            <div style="width:36px; height:36px; background:#34A853; color:white; border-radius:50%; display:flex; justify-content:center; align-items:center; font-weight:bold; margin-right:15px; font-size: 16px;">T</div>
            <div>
              <div style="font-weight:500; font-size:14px; color:#3c4043;">Test User</div>
              <div style="font-size:12px; color:#5f6368;">test@health.ai</div>
            </div>
          </div>
        </div>

        <div style="margin-top:20px; text-align:right;">
          <button onclick="document.getElementById('mockGoogleModal').remove()" style="background:none; border:none; color:#1a73e8; font-weight:500; cursor:pointer; padding:10px; text-transform: none; box-shadow: none; letter-spacing: normal;">Cancel</button>
        </div>
        <style>
          .google-acc:hover {background - color: #f8f9fa !important; }
          @keyframes fadeIn {from {opacity: 0; } to {opacity: 1; } }
          @keyframes slideUp {from {opacity: 0; transform: translateY(20px); } to {opacity: 1; transform: translateY(0); } }
        </style>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

// Simulated backend call for the mock Google Accounts
window.simulateGoogleLogin = async function (email, name) {
  document.getElementById('mockGoogleModal').remove();

  try {
    const res = await fetch(`${BACKEND_URL}/google-auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name })
    });
    const data = await res.json();
    if (data.success) {
      setSession(data.token, email);
      currentUser = {
        email: data.user.email,
        profile: { username: data.user.username, age: data.user.age },
        data: data.user.data
      };
      initChatSystem();
      showApp();
      checkAiStatus();
    } else {
      alert(data.message);
    }
  } catch (e) {
    alert("Google Auth failed to connect to server.");
  }
}


async function sendFeedback() {
  const name = document.getElementById("nameInput").value || "Anonymous";
  const feedback = document.getElementById("feedbackInput").value;
  const status = document.getElementById("feedbackStatus");
  const btn = event?.target?.closest('button') || document.querySelector('button[onclick="sendFeedback()"]');

  if (!feedback) {
    status.textContent = "Please provide your feedback or issue details first.";
    status.classList.remove("hidden");
    status.style.color = "#ef4444";
    return;
  }

  status.classList.add("hidden");

  // Loading Feedback
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner"></div> TRANSMITTING...`;

  try {
    const res = await fetch(`${BACKEND_URL}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, feedback })
    });

    if (res.ok) {
      status.textContent = "TRANSMISSION SUCCESSFUL. CORE UPDATED.";
      status.style.color = "var(--accent-primary)";
      status.classList.remove("hidden");
      document.getElementById("nameInput").value = "";
      document.getElementById("feedbackInput").value = "";
      loadFeedbackHub(); // Refresh the feedback hub
      setTimeout(() => {
        status.classList.add("hidden");
      }, 3000);
    } else {
      throw new Error();
    }
  } catch (e) {
    status.textContent = "TRANSMISSION FAILED. CORE OFFLINE.";
    status.style.color = "#ef4444";
    status.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

function resetFeedbackForm() {
  document.getElementById('feedbackFormContainer').classList.remove('hidden');
  document.getElementById('feedbackSuccessContainer').classList.add('hidden');
  document.getElementById('feedbackStatus').classList.add('hidden');
}

// --- AUTH FEEDBACK ---
function openFeedbackFromAuth() {
  document.getElementById('authFeedbackModal').classList.remove('hidden');
}

function closeAuthFeedback() {
  document.getElementById('authFeedbackModal').classList.add('hidden');
}

async function sendAuthFeedback() {
  const name = document.getElementById("authNameInput").value || "Auth Screen Visitor";
  const feedback = document.getElementById("authFeedbackInput").value;
  const status = document.getElementById("authFeedbackStatus");
  const btn = event?.target?.closest('button');

  if (!feedback) {
    status.textContent = "Please provide your feedback or issue details first.";
    status.classList.remove("hidden");
    return;
  }

  status.classList.add("hidden");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "TRANSMITTING...";
  }

  try {
    const res = await fetch(`${BACKEND_URL}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, feedback })
    });

    if (res.ok) {
      status.textContent = "SUCCESS: Feedback Sent! Closing...";
      status.style.color = "var(--accent-primary)";
      status.classList.remove("hidden");
      setTimeout(() => {
        closeAuthFeedback();
        document.getElementById("authFeedbackInput").value = "";
        status.classList.add("hidden");
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Transmit Feedback";
        }
      }, 2000);
    } else {
      throw new Error();
    }
  } catch (e) {
    status.textContent = "CORE CONNECTION FAILED.";
    status.style.color = "#ef4444";
    status.classList.remove("hidden");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Transmit Feedback";
    }
  }
}



// --- PERFORMANCE TRENDS ---
let activeTrendType = 'sleep';

function toggleTrend(type) {
  activeTrendType = type;
  document.getElementById("btn-trend-sleep").classList.toggle("active", type === 'sleep');
  document.getElementById("btn-trend-cals").classList.toggle("active", type === 'cals');
  renderTrends();
}

let performanceChartInstance = null;

function renderTrends() {
  const canvas = document.getElementById("performanceChart");
  if (!canvas || !currentUser) return;

  const ctx = canvas.getContext('2d');

  const dataPoints = currentUser.data.sleep.map(s => s.percent);

  const days = currentUser.data.sleep.map(s => s.date);

  if (performanceChartInstance) {
    performanceChartInstance.destroy();
  }

  if (dataPoints.length === 0) {
    // Show empty state on canvas if needed, or just an empty chart
    performanceChartInstance = new Chart(ctx, {
      type: 'line',
      data: { labels: ['No Data'], datasets: [{ data: [], label: 'Awaiting data...' }] },
      options: { responsive: true, maintainAspectRatio: false }
    });
    return;
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, 250);
  gradient.addColorStop(0, 'rgba(0, 242, 255, 0.4)'); // use accent-primary
  gradient.addColorStop(1, 'rgba(0, 242, 255, 0.0)');

  performanceChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: days,
      datasets: [{
        label: 'Sleep Quality %',
        data: dataPoints,
        borderColor: '#00f2ff', // var(--accent-primary)
        backgroundColor: gradient,
        borderWidth: 3,
        pointBackgroundColor: '#000',
        pointBorderColor: '#00f2ff',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        fill: true,
        tension: 0.5 // Maximum smoothness
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(10, 15, 25, 0.9)',
          titleColor: '#8b9bb4',
          bodyColor: '#fff',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 10,
          displayColors: false,
          callbacks: {
            label: function (context) {
              return context.parsed.y + '%';
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false,
            drawBorder: false
          },
          ticks: {
            color: '#8b9bb4',
            font: {
              family: "'Inter', sans-serif",
              size: 12
            }
          }
        },
        y: {
          min: 0,
          max: 100,
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
            drawBorder: false
          },
          ticks: {
            color: '#8b9bb4',
            stepSize: 25,
            callback: function (value) {
              return value + '%';
            },
            font: {
              family: "'Inter', sans-serif",
              size: 12
            }
          }
        }
      }
    }
  });
}

// --- BIO-SYNC NOTIFICATIONS ---
let notificationsEnabled = true;
let notifInterval = null;

function showNotification(title, message) {
  const notif = document.createElement("div");
  notif.style.position = "fixed";
  notif.style.top = "30px";
  notif.style.right = "30px";
  notif.style.backgroundColor = "#fff";
  notif.style.borderLeft = "6px solid #000";
  notif.style.color = "#000";
  notif.style.padding = "20px 25px";
  notif.style.borderRadius = "16px";
  notif.style.boxShadow = "0 25px 50px -12px rgba(0, 0, 0, 0.4)";
  notif.style.zIndex = "10000";
  notif.style.transform = "translateX(calc(100% + 40px))";
  notif.style.transition = "transform 0.5s cubic-bezier(0.19, 1, 0.22, 1)";
  notif.style.fontFamily = "'Inter', sans-serif";
  notif.style.minWidth = "280px";
  notif.style.maxWidth = "calc(100vw - 60px)";
  notif.style.display = "flex";
  notif.style.flexDirection = "column";
  notif.style.gap = "4px";

  notif.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
      <span style="font-size:18px;">✨</span>
      <h4 style="margin:0; font-size:15px; font-weight:800; text-transform:uppercase; letter-spacing:0.5px; color:#000;">${title}</h4>
    </div>
    <p style="margin:0; font-size:14px; color:#555; line-height:1.4; font-weight:500;">${message}</p>
    `;

  document.body.appendChild(notif);

  // Animate in
  setTimeout(() => {
    notif.style.transform = "translateX(0)";
  }, 100);

  // Animate out after 6 seconds
  setTimeout(() => {
    notif.style.transform = "translateX(calc(100% + 40px))";
    setTimeout(() => notif.remove(), 600);
  }, 6000);
}

function toggleNotifications() {
  // Toggle feature no longer uses OS notifications, it's automatic.
}

function startBioSync() {
  if (notifInterval) clearInterval(notifInterval);

  // Show welcome notification
  setTimeout(() => {
    showNotification("Bio-Sync Online", "Health performance monitoring is now active. Stay optimized.");
  }, 1000);

  // Reminders every 10 mins (was 30)
  notifInterval = setInterval(() => {
    const tips = [
      "Hydration Check: Your cellular performance requires H2O.",
      "Posture Calibration: Align your spine for peak cognitive flow.",
      "Vision Break: Look at the horizon to reset optical strain.",
      "Deep Breath: Oxygenate your blood to maintain Hfit focus."
    ];
    const randomTip = tips[Math.floor(Math.random() * tips.length)];
    showNotification("Hfit Performance Reminder", randomTip);
  }, 600000); // 10 mins - 600,000 ms
}

function stopBioSync() {
  if (notifInterval) clearInterval(notifInterval);
}

// Trends and Notifications synchronized with core Hfit logic.
window.addEventListener('resize', () => {
  if (document.getElementById("dashboard").classList.contains("active")) {
    renderTrends();
  }
});

async function updateDashboard() {
  if (!currentUser) return;

  const lang = document.documentElement.lang || 'en';
  const dict = translations[lang] || translations['en'];

  const hour = new Date().getHours();
  let greetingKey = "good-evening";
  if (hour < 12) greetingKey = "good-morning";
  else if (hour < 18) greetingKey = "good-afternoon";

  const greeting = dict[greetingKey] || "Hi";

  document.getElementById("welcomeText").innerHTML = `${greeting}, <span id="userName">${currentUser.profile.username}</span> 👋`;

  // Update Nutrition
  const lastSleepData = currentUser.data.sleep[currentUser.data.sleep.length - 1];
  const dashCals = document.getElementById("dash-cals");
  if (dashCals) {
    dashCals.textContent = (lastSleepData && lastSleepData.cals) ? lastSleepData.cals : "0";
  }

  // Update Sleep Circle
  const lastSleep = currentUser.data.sleep[currentUser.data.sleep.length - 1];
  const sleepVal = document.getElementById("dash-sleep-val");
  const sleepStatus = document.getElementById("dash-sleep-status");
  const sleepCircle = document.getElementById("dash-sleep-circle");

  if (lastSleep) {
    sleepVal.textContent = `${lastSleep.percent}%`;
    sleepStatus.textContent = lastSleep.percent >= 80 ? (dict["optimized-recovery"] || "Optimized") : (dict["needs-improvement"] || "Needs Improvement");
    if (sleepCircle) sleepCircle.style.background = `conic-gradient(var(--accent-primary) ${lastSleep.percent * 3.6}deg, var(--glass-border) 0deg)`;
  }

  // Update Dashboard Goals (Circular + List)
  const dashGoalsWheel = document.getElementById("dash-goals-wheel");
  const dashGoalsVal = document.getElementById("dash-goals-val");
  const dashGoalsCircle = document.getElementById("dash-goals-circle");

  if (dashGoalsWheel && currentUser.data.goals) {
    const totalGoals = currentUser.data.goals.length;
    const completedGoals = currentUser.data.goals.filter(g => g.done).length;
    const progressPercent = totalGoals > 0 ? Math.round((completedGoals / totalGoals) * 100) : 0;

    if (dashGoalsVal) dashGoalsVal.textContent = `${progressPercent}%`;
    if (dashGoalsCircle) dashGoalsCircle.style.background = `conic-gradient(var(--accent-primary) ${progressPercent * 3.6}deg, var(--glass-border) 0deg)`;

    const activeGoals = currentUser.data.goals.filter(g => !g.done).slice(0, 3);
    if (activeGoals.length > 0) {
      dashGoalsWheel.innerHTML = activeGoals.map(g => {
        return `
          <div class="goal-mini-circle" title="${g.text}">
             ${g.text[0].toUpperCase()}
          </div>
        `;
      }).join('');
    } else {
      dashGoalsWheel.innerHTML = `<p style="color:var(--text-dim); font-size:0.8rem;">${totalGoals > 0 ? (dict["all-completed"] || "Done!") : (dict["no-goals"] || "None")}</p>`;
    }
  }

  // Ensure all static text is translated
  translatePage();

  // Update Vision Widget
  const visionHist = document.getElementById("dash-vision-history");
  const visionLastText = document.getElementById("dash-vision-last-text");
  const visionContent = document.getElementById("dash-vision-content");

  if (currentUser.data.visionHistory && currentUser.data.visionHistory.length > 0) {
    const lastVision = currentUser.data.visionHistory[0];
    if (visionHist && visionLastText && visionContent) {
      visionHist.classList.remove("hidden");
      visionContent.classList.add("hidden");
      visionLastText.textContent = lastVision.result;
    }
  }

  // Update AI Insights
  const insightBox = document.getElementById("dash-ai-insight");
  if (insightBox) {
    if (lastSleep && lastSleep.percent < 70) {
      insightBox.textContent = "Sleep patterns detected below thresholds. We recommend a 15-minute cool-down session before bedtime.";
    } else if (currentUser.data.activities && currentUser.data.activities.length > 0) {
      const lastAct = currentUser.data.activities[0];
      insightBox.textContent = `Excellent ${lastAct.type} session! Your metabolic rate is currently optimized. Stay hydrated.`;
    } else {
      insightBox.textContent = "Awaiting performance data. Log your first activity or sleep cycle for personalized intelligence.";
    }
  }

  renderTrends();
}

// --- LANGUAGE TOGGLE (LOCAL) ---
function translatePage() {
  const lang = document.documentElement.lang || 'en';
  const dict = translations[lang] || translations['en'];

  document.querySelectorAll('[data-t]').forEach(el => {
    const key = el.getAttribute('data-t');
    if (dict[key]) {
      el.innerHTML = dict[key];
    }
  });

  document.querySelectorAll('[data-t-placeholder]').forEach(el => {
    const key = el.getAttribute('data-t-placeholder');
    if (dict[key]) {
      el.placeholder = dict[key];
    }
  });

  // Special cases for dynamics
  if (currentUser) {
    const lang = document.documentElement.lang || 'en';
    const dict = translations[lang] || translations['en'];
    const hour = new Date().getHours();
    let greetingKey = "good-evening";
    if (hour < 12) greetingKey = "good-morning";
    else if (hour < 18) greetingKey = "good-afternoon";
    const greeting = dict[greetingKey] || "Hi";
    document.getElementById("welcomeText").innerHTML = `${greeting}, <span id="userName">${currentUser.profile.username}</span> 👋`;
  }
}

window.setLanguage = function (lang) {
  document.documentElement.lang = lang;
  localStorage.setItem('hfit_lang', lang);

  if (lang === 'iw') {
    document.body.setAttribute('dir', 'rtl');
    document.documentElement.setAttribute('dir', 'rtl');
  } else {
    document.body.setAttribute('dir', 'ltr');
    document.documentElement.setAttribute('dir', 'ltr');
  }

  translatePage();

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  const activeBtn = document.getElementById('lang-' + lang);
  if (activeBtn) {
    activeBtn.classList.add('active');
  }
};

// Auto-detect language on load
const savedLang = localStorage.getItem('hfit_lang') || 'en';
setTimeout(() => setLanguage(savedLang), 100);

// --- ADMIN SIGMA MENU ---
function openAdminSigmaMenu() {
  const existing = document.getElementById('adminSigmaModal');
  if (existing) existing.remove();

  const token = getSession();

  const lang = document.documentElement.lang || 'en';
  const dict = translations[lang] || translations['en'];

  const modal = document.createElement('div');
  modal.id = 'adminSigmaModal';
  modal.innerHTML = `
    <div style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.9); display:flex; justify-content:center; align-items:center; z-index:999999; backdrop-filter:blur(20px);">
      <div style="background:var(--sidebar-bg); border:1px solid #7000ff; border-radius:24px; padding:30px; width:90%; max-width:800px; height:80vh; display:flex; flex-direction:column; position:relative; box-shadow:0 0 50px rgba(112,0,255,0.2);">
        <button onclick="document.getElementById('adminSigmaModal').remove()" style="position:absolute; top:20px; right:20px; background:none; box-shadow:none; color:var(--text-dim);">✖</button>
        <h2 style="color:#7000ff; margin-bottom:20px; font-weight:900; letter-spacing:2px;">${dict["admin-sigma-menu"] || "👑 ADMIN SIGMA MENU"}</h2>
        
        <div style="display:flex; gap:15px; margin-bottom:20px;">
          <button id="adminTabUsers" onclick="loadAdminUsers()" style="flex:1; background:#7000ff; color:#fff;">${dict["admin-users"] || "USERS"}</button>
          <button id="adminTabFeedback" onclick="loadAdminFeedback()" style="flex:1; background:var(--glass-bg); color:var(--text-dim);">${dict["admin-feedback"] || "FEEDBACK"}</button>
        </div>

        <div id="adminContent" style="flex:1; overflow-y:auto; padding:15px; background:rgba(0,0,0,0.3); border-radius:16px; border:1px solid var(--glass-border);">
          <p style="color:var(--text-dim);">${lang === 'iw' ? 'בחר לשונית להצגת נתונים.' : 'Select a tab to view data.'}</p>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  loadAdminUsers();
}

async function loadAdminUsers() {
  document.getElementById("adminTabUsers").style.background = "#7000ff";
  document.getElementById("adminTabUsers").style.color = "#fff";
  document.getElementById("adminTabFeedback").style.background = "var(--glass-bg)";
  document.getElementById("adminTabFeedback").style.color = "var(--text-dim)";
  
  const content = document.getElementById("adminContent");
  content.innerHTML = `<p style="color:var(--text-dim);">Loading users...</p>`;

  const token = getSession();
  try {
    const res = await fetch(`${BACKEND_URL}/api/users`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      const lang = document.documentElement.lang || 'en';
      const dict = translations[lang] || translations['en'];
      content.innerHTML = data.users.map(u => `
        <div style="background:var(--glass-bg); padding:15px; margin-bottom:10px; border-radius:12px; border:1px solid var(--glass-border); display:flex; justify-content:space-between; align-items:center;">
          <div>
            <p style="font-weight:bold; color:var(--text-main);">${u.username} (ID: ${u.id}) ${u.is_admin ? `<span style="color:#7000ff; font-size:0.7rem; margin-left:10px;">[${dict["admin-status"] || "ADMIN"}]</span>` : ''}</p>
            <p style="font-size:0.8rem; color:var(--text-dim);">${u.email} | Age: ${u.age}</p>
          </div>
          <button onclick="resetUserPassword(${u.id})" style="background:#ef4444; padding:8px 16px; font-size:0.8rem;">${dict["reset-pass"] || "RESET PASS"}</button>
        </div>
      `).join('');
    } else {
      content.innerHTML = `<p style="color:#ef4444;">Failed to load users. Are you admin?</p>`;
    }
  } catch (e) {
    content.innerHTML = `<p style="color:#ef4444;">Connection error.</p>`;
  }
}

async function loadAdminFeedback() {
  document.getElementById("adminTabFeedback").style.background = "#7000ff";
  document.getElementById("adminTabFeedback").style.color = "#fff";
  document.getElementById("adminTabUsers").style.background = "var(--glass-bg)";
  document.getElementById("adminTabUsers").style.color = "var(--text-dim)";
  
  const content = document.getElementById("adminContent");
  content.innerHTML = `<p style="color:var(--text-dim);">Loading feedback...</p>`;

  try {
    const res = await fetch(`${BACKEND_URL}/feedback-logs`);
    const data = await res.json();
    if (data.success) {
      const lang = document.documentElement.lang || 'en';
      const dict = translations[lang] || translations['en'];
      content.innerHTML = data.logs.map(log => `
        <div style="background:var(--glass-bg); padding:15px; margin-bottom:10px; border-radius:12px; border:1px solid var(--glass-border);">
          <p style="font-weight:bold; color:var(--accent-primary); font-size:0.8rem; margin-bottom:5px;">${dict["user-status"] || "USER"}: ${log.name}</p>
          <p style="font-size:0.9rem; color:var(--text-main);">${log.feedback}</p>
        </div>
      `).join('');
    } else {
      content.innerHTML = `<p style="color:#ef4444;">Failed to load feedback.</p>`;
    }
  } catch (e) {
    content.innerHTML = `<p style="color:#ef4444;">Connection error.</p>`;
  }
}

async function resetUserPassword(userId) {
  const newPass = prompt("Enter new password for user ID " + userId + ":");
  if (!newPass) return;
  
  const token = getSession();
  try {
    const res = await fetch(`${BACKEND_URL}/api/reset-password`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ userId, newPassword: newPass })
    });
    const data = await res.json();
    if (data.success) {
      alert("Password reset successfully!");
    } else {
      alert("Failed to reset password.");
    }
  } catch(e) {
    alert("Error resetting password.");
  }
}

// Function to fetch and display website visits
async function fetchVisitsCount() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/get-visits`);
    const data = await res.json();
    if(data.visits !== undefined) {
      const lang = document.documentElement.lang || 'en';
      const dict = translations[lang] || translations['en'];
      const msg = (dict["visits-count"] || "Website has been opened {n} times.").replace("{n}", data.visits);
      alert(msg);
    }
  } catch(e) {
    alert("Could not retrieve visits count.");
  }
}


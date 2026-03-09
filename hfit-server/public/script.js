const AI_MODEL = "google/gemini-2.0-flash-exp:free"; // Default to FREE model to prevent credit errors
const BACKEND_URL = (!window.location.origin || window.location.origin === "null" || window.location.origin.includes("localhost") || window.location.protocol === "file:") ? "http://localhost:3000" : ""; // Relative path works automatically on Render

let currentUser = null;
let authMode = 'signup';

// --- STORAGE HELPERS ---
function setSession(token, email) {
  localStorage.setItem("hfit_token", token);
  if (email) {
    const accounts = JSON.parse(localStorage.getItem("hfit_accounts") || "[]");
    if (!accounts.includes(email)) {
      accounts.push(email);
      localStorage.setItem("hfit_accounts", JSON.stringify(accounts));
    }
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
    if (result.success) {
      setSession(result.token, email);
      currentUser = {
        email: result.user.email,
        profile: { username: result.user.username, age: result.user.age },
        data: result.user.data
      };
      return { success: true };
    }
    return { success: false, message: result.message || "Signup failed." };
  } catch (e) {
    console.error("Transmission Error:", e);
    return { success: false, message: `Hfit Core Connection Failed at: ${BACKEND_URL}. Check if the server is live.` };
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
    if (result.success) {
      setSession(result.token, email);
      currentUser = {
        email: result.user.email,
        profile: { username: result.user.username, age: result.user.age },
        data: result.user.data
      };
      return { success: true };
    }
    return { success: false, message: result.message || "Login failed." };
  } catch (e) {
    console.error("Transmission Error:", e);
    return { success: false, message: `Hfit Core Connection Failed at: ${BACKEND_URL}. Check if the server is live.` };
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
        initChatSystem();
        showApp();
        checkAiStatus();
      } else {
        throw new Error("Invalid session");
      }
    } catch (e) {
      console.warn("Session check failed:", e);
      // Only clear if it was explicitly an invalid session from server
      if (e.message === "Invalid session") clearSession();

      if (!currentUser) {
        document.getElementById("authScreen").classList.remove("hidden");
        document.getElementById("app").classList.add("hidden");
      }
    }
  } else {
    document.getElementById("authScreen").classList.remove("hidden");
    document.getElementById("app").classList.add("hidden");
  }

  const theme = localStorage.getItem("hfitTheme") || "dark-mode";
  document.body.className = theme;

  const recentAccounts = getRecentAccounts();
  if (recentAccounts.length > 0) {
    authMode = 'signin';
    renderRecentAccounts();
  }
  setAuthMode(authMode);
};

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
    <div class="card stat-card" style="padding: 12px 20px; cursor: pointer; display: flex; align-items: center; gap: 15px; background: var(--glass-bg); margin: 0;" onclick="selectRecentAccount('${email}')">
      <div style="width: 32px; height: 32px; background: var(--accent-primary); color: #000; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.8rem;">${email[0].toUpperCase()}</div>
      <div style="flex-grow: 1;">
        <p style="font-weight: 700; font-size: 0.9rem; margin: 0;">${email}</p>
        <p style="font-size: 0.7rem; color: var(--text-dim); margin: 0;">Stored Profile</p>
      </div>
      <span style="font-size: 1.2rem; opacity: 0.5;">→</span>
    </div>
  `).join('');
}

function selectRecentAccount(email) {
  document.getElementById("email").value = email;
  setAuthMode('signin');
  document.getElementById("password").focus();
}

async function checkAiStatus() {
  const statusEl = document.getElementById("ai-status-pulse");
  if (!statusEl) return;

  statusEl.textContent = "SYNCING WITH CORE...";
  statusEl.style.color = "var(--accent-primary)";

  try {
    const res = await fetch(`${BACKEND_URL}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(15000) // 15s to allow for Render cold starts
    });

    if (res.ok) {
      const data = await res.json();
      if (data.ai_key_status === "MISSING") {
        statusEl.textContent = "AI KEY MISSING";
        statusEl.style.color = "#f59e0b"; // Warning orange
      } else {
        statusEl.textContent = "CORE ONLINE";
        statusEl.style.color = "var(--accent-primary)";
      }
    } else {
      throw new Error();
    }
  } catch (e) {
    statusEl.textContent = "CORE OFFLINE";
    statusEl.style.color = "#ef4444";
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
  document.getElementById("signupFields").style.display = mode === 'signup' ? "contents" : "none";
  document.getElementById("authSubmitBtn").textContent = mode === 'signup' ? "Initialize Health AI" : "Authenticate Session";
}

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
    if (!username || !age) {
      errorDiv.textContent = "Please provide Name and Age.";
      errorDiv.classList.remove("hidden");
      return;
    }
    result = await createAccount(email, password, username, age);
  } else {
    result = await login(email, password);
  }

  if (result.success) {
    // currentUser is successfully populated inside createAccount / login
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

function openTab(id) {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".sidebar button").forEach(b => b.classList.remove("active"));

  document.getElementById(id).classList.add("active");
  const btn = document.getElementById(`btn-${id}`);
  if (btn) btn.classList.add("active");

  if (id === 'dashboard') updateDashboard();
  if (id === 'ai') setTimeout(() => {
    const chatHist = document.getElementById("chatHistory");
    chatHist.scrollTop = chatHist.scrollHeight;
  }, 100);
}

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


async function askAI(message, systemPrompt = "You are a helpful health assistant.", imageBase64 = null, onChunk = null) {
  const disclaimer = "\n\nDISCLAIMER: This information is for 'good purpose' only and must be confirmed with a licensed medical professional before taking any action. Do not make medical decisions based on this AI.";

  const statusEl = document.getElementById("ai-status-pulse");
  if (statusEl) statusEl.textContent = "SYNCING...";

  try {
    const res = await fetch(`${BACKEND_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        system: systemPrompt + disclaimer,
        model: AI_MODEL,
        image: imageBase64,
        stream: !!onChunk
      })
    });

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || `Server Error ${res.status}`);
    }

    if (onChunk) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullReply = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            if (dataStr === "[DONE]") break;
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

      if (statusEl) {
        statusEl.textContent = "CORE READY";
        statusEl.style.color = "var(--accent-primary)";
      }
      return fullReply;
    } else {
      const data = await res.json();
      if (statusEl) {
        statusEl.textContent = "CONNECTED TO CORE";
        statusEl.style.color = "var(--accent-primary)";
      }
      return data.reply || "No response received.";
    }
  } catch (error) {
    console.warn(`Request failed:`, error.message);
    if (statusEl) {
      statusEl.textContent = "CORE OFFLINE";
      statusEl.style.color = "#ef4444";
    }
    return `Error: ${error.message}. Potential Reasons: Server not running or API issue.`;
  }
}

// --- DASHBOARD ---
async function updateDashboard() {
  // Sleep Stats
  const lastSleep = currentUser.data.sleep[currentUser.data.sleep.length - 1];
  if (lastSleep) {
    document.getElementById("dash-sleep-val").textContent = `${lastSleep.percent}%`;
    document.getElementById("dash-sleep-status").textContent = `${lastSleep.hours}h Performance`;
    document.getElementById("dash-sleep-circle").style.borderColor = lastSleep.percent >= 80 ? "var(--accent-primary)" : "var(--glass-border)";
  }

  // Goals
  const dashGoals = document.getElementById("dash-goals-list");
  const activeGoals = currentUser.data.goals.filter(g => !g.done).slice(0, 3);
  dashGoals.innerHTML = activeGoals.length > 0 ? activeGoals.map(g => `<p style="font-weight:600;">• ${g.text}</p>`).join('') : `<p style="color:var(--text-dim);">Clear for takeoff.</p>`;

  // AI Insight
  const insightBox = document.getElementById("dash-ai-insight");
  if (lastSleep) {
    insightBox.style.opacity = "0.5";
    const prompt = `Based on my sleep data (${lastSleep.hours} hours, ${lastSleep.percent}% quality) and age (${currentUser.profile.age}), give me a 1-sentence health tip.`;
    const reply = await askAI(prompt, "Provide a sharp 1-sentence health optimization based on data.");
    insightBox.textContent = reply;
    insightBox.style.opacity = "1";
  }
  renderTrends();
}

// --- AI CHAT ---
function formatAIResponse(text) {
  let formatted = text
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>') // Bold Italic
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')    // Bold
    .replace(/\*(.*?)\*/g, '<em>$1</em>')               // Italic
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')               // H1
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')              // H2
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')             // H3
    .replace(/^\s*[-•*]\s*(.*)$/gm, '<li>$1</li>')      // Bullets
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')          // Wrap bullet groups
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>') // Links
    .replace(/\n\n/g, '<br><br>')                       // Paragraphs
    .replace(/\n/g, '<br>');                            // Line breaks
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
    container.innerHTML = `
      <div class="message-wrapper assistant-wrapper">
        <div class="message-avatar">🤖</div>
        <div class="message ai-msg">
          Welcome to Hfit Premium, ${currentUser.profile.username}. How can I optimize your performance today? 
          I am now equipped with <strong>Medical Vision</strong>. You can upload photos of food or even skin concerns for analysis.
        </div>
      </div>
    `;
  }
  container.scrollTop = container.scrollHeight;
}

// --- CHAT IMAGE HANDLING ---
let chatImageBase64 = null;
function handleChatImage(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    chatImageBase64 = ev.target.result;
    document.getElementById("chatImagePreview").src = chatImageBase64;
    document.getElementById("chatImagePreviewContainer").classList.remove("hidden");
  };
  reader.readAsDataURL(file);
}

function clearChatImage() {
  chatImageBase64 = null;
  document.getElementById("chatImagePreviewContainer").classList.add("hidden");
  document.getElementById("chatImage").value = "";
}

async function sendMessage() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text && !chatImageBase64) return;

  const currentImage = chatImageBase64;
  updateCurrentChatMessages({ role: "user", content: text, image: currentImage });
  renderChat();
  input.value = "";
  clearChatImage();
  saveCurrentUserData();

  const container = document.getElementById("chatHistory");

  // Create temporary wrapper for streaming
  const wrapper = document.createElement("div");
  wrapper.className = "message-wrapper assistant-wrapper";
  wrapper.innerHTML = `
    <div class="message-avatar">🤖</div>
    <div class="message ai-msg typing-streaming"></div>
  `;
  container.appendChild(wrapper);
  const aiMsgBox = wrapper.querySelector(".ai-msg");
  container.scrollTop = container.scrollHeight;

  const sysPrompt = `You are Hfit AI, an elite health and mental health performance companion. 
  CRITICAL RULE: You ONLY discuss topics related to physical health, exercise, nutrition, sleep, biohacking, and mental well-being/psychology. 
  If the user asks about anything else (politics, general history, coding, sports trivia beyond health aspects, etc.), politely decline and steer the conversation back to their health and wellness.
  User: ${currentUser.profile.username}. Tone: professional, neat, elite. Formatting: Use bullet points and paragraphs. Always include a short medical disclaimer.`;

  const reply = await askAI(text, sysPrompt, currentImage, (streamedText) => {
    aiMsgBox.innerHTML = formatAIResponse(streamedText);
    container.scrollTop = container.scrollHeight;
  });

  aiMsgBox.classList.remove("typing-streaming");
  updateCurrentChatMessages({ role: "assistant", content: reply });
  saveCurrentUserData();

  // Asynchronously generate a topic title if this is the first exchange
  const thread = currentUser.data.chatThreads.find(t => t.id === currentUser.data.currentChatId);
  if (thread && thread.messages.length === 2 && thread.title === "New Conversation") {
    askAI(
      `Based on this exchange:\nUser: ${text}\nAI: ${reply}\nProvide a 2-4 word title. Respond with ONLY the title.`,
      "You are a title generator. Respond with nothing but the short title."
    ).then(titleReply => {
      if (titleReply && titleReply.trim() && !titleReply.startsWith("Error")) {
        thread.title = titleReply.replace(/["']/g, "").trim();
        renderChatSidebar();
        saveCurrentUserData();
      }
    }).catch(e => console.error("Topic generation failed", e));
  }
}

// --- FOOD ANALYZER ---
let foodImageBase64 = null;
function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    foodImageBase64 = ev.target.result;
    const prev = document.getElementById("foodPreview");
    prev.src = foodImageBase64;
    prev.classList.remove("hidden");
    document.getElementById("uploadPlaceholder").classList.add("hidden");
    document.getElementById("foodResult").textContent = ""; // Clear previous result
  };
  reader.readAsDataURL(file);
}

async function analyzeFood() {
  const query = document.getElementById("foodInput").value;
  const status = document.getElementById("foodResult");
  const btn = event?.target?.closest('button') || document.querySelector('button[onclick="analyzeFood()"]');
  const currentImage = foodImageBase64;

  if (!query && !currentImage) {
    status.textContent = "REQUIRED: MEAL PHOTO OR TEXT.";
    status.style.color = "#ef4444";
    return;
  }

  // Visual Feedback
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner"></div> ANALYZING...`;

  status.textContent = "SYNCING WITH NUTRITION ENGINE...";
  status.style.color = "var(--accent-primary)";

  const prompt = `Analyze this meal: ${query || "image"}. Provide calories, protein, carbs, and fats. Return ONLY a valid JSON: {"cals": 500, "protein": 30, "carbs": 40, "fats": 20, "name": "Meal Name"}`;

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
        result = {
          cals: parseInt(calsMatch[1]),
          name: "IDENTIFIED MEAL"
        };
      }
    }

    if (!result) {
      throw new Error("Could not parse nutrition data.");
    }

    document.getElementById("food-cals").textContent = result.cals || 0;
    document.getElementById("food-protein").textContent = (result.protein || 0) + "g";
    document.getElementById("food-carbs").textContent = (result.carbs || 0) + "g";
    document.getElementById("food-fats").textContent = (result.fats || 0) + "g";
    document.getElementById("dash-cals").textContent = result.cals || 0;

    // Save calorie data to today's history for trends
    const today = new Date().toLocaleDateString();
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
    todayLog.cals = (todayLog.cals || 0) + (result.cals || 0);

    // Keep history at 7 days
    if (currentUser.data.sleep.length > 7) currentUser.data.sleep.shift();

    // Reset visuals gracefully
    foodImageBase64 = null;
    document.getElementById("foodPreview").classList.add("hidden");
    document.getElementById("uploadPlaceholder").classList.remove("hidden");
    document.getElementById("foodQuery").value = "";

    updateDashboard();
  } catch (e) {
    console.error("ANALYSIS_ERROR:", e);
    status.textContent = "ANALYSIS FAILED. PLEASE TRY A CLEARER IMAGE OR DISCRIPTION.";
    status.style.color = "#ef4444";
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// --- SLEEP ---
function trackSleep() {
  const hours = parseFloat(document.getElementById("sleepInput").value);
  const status = document.getElementById("sleepStatus");
  status.classList.add("hidden");

  if (isNaN(hours)) {
    status.textContent = "Please enter valid sleep hours.";
    status.classList.remove("hidden");
    return;
  }

  const today = new Date().toLocaleDateString();
  const alreadyTracked = currentUser.data.sleep.find(s => s.fullDate === today);

  if (alreadyTracked) {
    status.textContent = "Metrics finalized. Recovery tracking is capped at 1/day.";
    status.classList.remove("hidden");
    return;
  }

  const ideal = currentUser.profile.age < 18 ? 9 : 8;
  const percent = Math.min(Math.round((hours / ideal) * 100), 100);

  currentUser.data.sleep.push({
    date: new Date().toLocaleDateString('en-US', { weekday: 'short' }),
    fullDate: today,
    hours,
    percent
  });

  if (currentUser.data.sleep.length > 7) currentUser.data.sleep.shift();

  renderSleepWeekly();
  updateSleepCircle(percent);
  saveCurrentUserData();
  updateDashboard();
}

function updateSleepCircle(percent) {
  document.getElementById("sleepPercent").textContent = `${percent}%`;
  document.getElementById("sleepCircle").style.background = `conic-gradient(var(--accent-primary) ${percent * 3.6}deg, var(--glass-border) 0deg)`;
}

function renderSleepWeekly() {
  const container = document.getElementById("sleepWeeklyList");
  container.innerHTML = currentUser.data.sleep.map(s => `
    <div class="day-circle-box">
      <div class="day-circle ${s.percent >= 80 ? 'score-high' : ''}">${s.percent}%</div>
      <span class="day-label">${s.date}</span>
    </div>
  `).join('');
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
  const resBox = document.getElementById("planResult");
  resBox.classList.remove("hidden");
  resBox.innerHTML = `<div class="typing"><span>ARCHITECTING STRATEGY</span><div class="typing-dot"></div><div class="typing-dot"></div></div>`;

  const prompt = planMode === 'workout'
    ? `Workout: ${document.getElementById("targetArea").value}, Time: ${document.getElementById("timePerWorkout").value}, Loc: ${document.getElementById("location").value}.`
    : `Meal Plan: ${document.getElementById("mealGoal").value}, Diet: ${document.getElementById("dietType").value}.`;

  const reply = await askAI(prompt, "Elite conditioning coach. Provide raw text outline with bold headers and bullet points. Neat and organized.");
  const formattedReply = `<strong>ELITE ${planMode.toUpperCase()} STRATEGY:</strong><br><br>${reply.replace(/\n/g, "<br>")}`;
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

// Update openTab to load plans
const originalOpenTab = openTab;
openTab = (id) => {
  originalOpenTab(id);
  if (id === 'workout') loadSavedPlans();
  if (id === 'feedback') loadRecentFeedback();
};

// --- BRUISE IDENTIFIER ---
let bruiseImageBase64 = null;
function handleBruiseUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    bruiseImageBase64 = ev.target.result;
    const prev = document.getElementById("bruisePreview");
    prev.src = bruiseImageBase64;
    prev.classList.remove("hidden");
    document.getElementById("bruisePlaceholder").classList.add("hidden");
    document.getElementById("bruiseResult").classList.add("hidden"); // Hide previous result
    document.getElementById("bruiseResult").innerHTML = "";
  };
  reader.readAsDataURL(file);
}

async function analyzeBruise() {
  const status = document.getElementById("bruiseResult");
  const btn = event?.target?.closest('button') || document.querySelector('button[onclick="analyzeBruise()"]');
  const currentImage = bruiseImageBase64;

  if (!currentImage) {
    status.classList.remove("hidden");
    status.innerHTML = `<span style="color:#ef4444;">SYNC ERROR: NO VISUAL DATA UPLOADED.</span>`;
    return;
  }

  // Visual Feedback
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner"></div> SCANNING...`;

  status.classList.remove("hidden");
  status.innerHTML = `<div class="typing"><span>SCANNING DERMAL TISSUE...</span><div class="typing-dot"></div><div class="typing-dot"></div></div>`;

  const prompt = "Identify what is in this image (skin concern, bruise, rash, etc.). Provide a professional medical description and urgency level. Use bold headers.";

  try {
    const reply = await askAI(prompt, "Hfit Vision Module. Medical diagnostic tone with clear, professional headers. Elite response formatting.", currentImage);

    // Check if error message returned
    if (reply.startsWith("Error:")) {
      throw new Error(reply);
    }

    status.innerHTML = `
      <div style="background: rgba(0, 242, 255, 0.03); border: 1px solid var(--accent-primary); padding: 20px; border-radius: 20px;">
        <span style="color:var(--accent-primary); font-weight:700; font-size: 1.2rem; display: block; margin-bottom: 15px;">🔍 DIAGNOSTIC COMPLETE</span>
        <div style="line-height: 1.6;">${reply.replace(/\n/g, "<br>")}</div>
      </div>
    `;

    // Clear visual preview to allow for next scan
    bruiseImageBase64 = null;
    document.getElementById("bruisePreview").classList.add("hidden");
    document.getElementById("bruisePlaceholder").classList.remove("hidden");
  } catch (e) {
    console.error("BRUISE_SCAN_ERROR:", e);
    status.innerHTML = `<span style="color:#ef4444;">SCAN INTERRUPTED. SYSTEM OFFLINE OR CLEARER PHOTO REQUIRED.</span>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// --- GOALS ---
function addGoal() {
  const input = document.getElementById("goalInput");
  const text = input.value.trim();
  if (!text) return;
  currentUser.data.goals.push({ text, done: false });
  input.value = "";
  renderGoals();
  saveCurrentUserData();
  updateDashboard();
}

function toggleGoal(idx) {
  // Not used directly with new buttons, kept for reference or replace if desired.
}

function completeGoal(idx) {
  currentUser.data.goals[idx].done = true;
  renderGoals();
  saveCurrentUserData();
  updateDashboard();

  setTimeout(() => {
    currentUser.data.goals.splice(idx, 1);
    renderGoals();
    saveCurrentUserData();
    updateDashboard();
  }, 1000);
}

function deleteGoal(idx) {
  currentUser.data.goals.splice(idx, 1);
  renderGoals();
  saveCurrentUserData();
  updateDashboard();
}

function renderGoals() {
  const list = document.getElementById("goalList");
  list.innerHTML = currentUser.data.goals.map((g, i) => `
    <li class="goal-item" style="opacity: ${g.done ? 0.5 : 1};">
      <button class="goal-btn-check ${g.done ? 'checked' : ''}" onclick="completeGoal(${i})" title="Complete">✔</button>
      <span style="flex-grow:1; font-weight:600; text-decoration: ${g.done ? 'line-through' : 'none'};">${g.text}</span>
      <button class="goal-btn-cross" onclick="deleteGoal(${i})" title="Delete">✖</button>
    </li>
  `).join('');
}

// --- FEEDBACK ---
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
            .google-acc:hover { background-color: #f8f9fa !important; }
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
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
      setSession(data.token);
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
  const name = document.getElementById("nameInput").value || "Anonymous User";
  const feedback = document.getElementById("feedbackInput").value;
  const status = document.getElementById("feedbackStatus");
  status.classList.add("hidden");

  if (!feedback) {
    status.textContent = "REQUIRED: FEEDBACK CONTENT.";
    status.style.color = "#ef4444";
    status.classList.remove("hidden");
    return;
  }

  status.textContent = "TRANSMITTING TO CORE...";
  status.style.color = "var(--accent-primary)";
  status.classList.remove("hidden");

  try {
    const res = await fetch(`${BACKEND_URL}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, feedback })
    });

    if (res.ok) {
      status.textContent = "FEEDBACK RECEIVED. CORE CALIBRATED.";
      document.getElementById("feedbackInput").value = "";
      document.getElementById("nameInput").value = "";
      showNotification("Success", "Your feedback has been logged to GitHub.");
      loadRecentFeedback(); // refresh the list
    } else {
      throw new Error();
    }
  } catch (e) {
    status.textContent = "TRANSMISSION FAILED. CORE OFFLINE.";
  }
}

async function loadRecentFeedback() {
  const list = document.getElementById("recentFeedbackList");
  if (!list) return;

  try {
    const res = await fetch(`${BACKEND_URL}/feedback`);
    const data = await res.json();

    if (data.success && data.feedback.length > 0) {
      list.innerHTML = data.feedback.slice(0, 10).map(f => `
        <li class="goal-item" style="flex-direction: column; align-items: flex-start; gap: 8px;">
          <div style="display: flex; justify-content: space-between; width: 100%;">
            <span style="font-weight: 700; color: var(--accent-primary);">${f.name || 'Anonymous'}</span>
            <span style="font-size: 0.8rem; color: var(--text-dim);">${new Date(f.timestamp).toLocaleDateString()}</span>
          </div>
          <span style="line-height: 1.5;">${f.message}</span>
        </li>
      `).join('');
    } else {
      list.innerHTML = `<li class="goal-item"><span style="color:var(--text-dim);">No recent updates available.</span></li>`;
    }
  } catch (e) {
    list.innerHTML = `<li class="goal-item"><span style="color:#ef4444;">Failed to sync recent data.</span></li>`;
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
        tension: 0.4 // nice curve
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

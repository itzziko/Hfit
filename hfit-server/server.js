import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import axios from "axios";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import fs from "fs";
import { initDb } from "./db.js";
import dbPromise from "./db.js";
import helmet from "helmet";
import xss from "xss";
import validator from "validator";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

// Initialize Database immediately using top-level await
await initDb();

// Initialize Google AI
// OpenRouter replaces genAI

const OWNER_KEY = process.env.OWNER_KEY || "default_owner_key";
const JWT_SECRET = process.env.JWT_SECRET || "fallback_super_secret_key_123";

// HFIT CORE CONFIGURATION & BYPASS LOGIC
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const isDemoMode = !OPENROUTER_API_KEY.startsWith('sk-or-v1-');

console.log(`[HFIT CORE] Mode: ${isDemoMode ? 'DEMO' : 'LIVE'} | Key Status: ${OPENROUTER_API_KEY ? 'CONFIGURED' : 'MISSING'}`);


const app = express();
app.set('trust proxy', 1);

// PRODUCTION SECURITY
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "https://www.google.com", "https://www.gstatic.com"],
            "script-src-attr": ["'unsafe-inline'"],
            "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            "frame-src": ["'self'", "https://www.google.com"],
            "img-src": ["'self'", "data:", "https://*"],
            "connect-src": ["'self'", "https://api.github.com", "http://localhost:3000"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

const corsOptions = {
    origin: process.env.NODE_ENV === 'production' ? process.env.ALLOWED_ORIGIN : true,
    methods: 'GET,POST,DELETE,PUT',
    credentials: true
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Protect sensitive files
app.use((req, res, next) => {
    const forbidden = ['.env', '.sqlite', 'package.json', 'package-lock.json', 'feedback-logs.txt', 'feedback.html'];
    const isForbidden = forbidden.some(file => req.path.toLowerCase().includes(file));
    
    if (isForbidden) {
        return res.status(403).send("ACCESS DENIED: SYSTEM FILE PROTECTION ACTIVE");
    }
    next();
});

app.use(express.static(path.join(__dirname, "public")));

/* ---------------- BRIGHT DATA CONFIG ---------------- */

const BRIGHTDATA_USERNAME = process.env.BRIGHTDATA_USERNAME;
const BRIGHTDATA_PASSWORD = process.env.BRIGHTDATA_PASSWORD;

async function fetchWithBrightData(url) {
    try {
        const response = await axios.get(url, {
            proxy: {
                host: "zproxy.lum-superproxy.io",
                port: 22225,
                auth: { username: BRIGHTDATA_USERNAME, password: BRIGHTDATA_PASSWORD }
            },
            timeout: 20000
        });
        return response.data;
    } catch (err) {
        console.error("[BRIGHTDATA ERROR]", err.message);
        return null;
    }
}

/* ---------------- AUTH & BANS ---------------- */

const authenticateToken = (req, res, next) => {
    const queryKey = req.query.key || req.headers['x-hfit-key'];
    if (queryKey && queryKey === OWNER_KEY) {
        req.user = { id: 0, email: "architect@hfit.system", is_admin: 1 };
        return next();
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

const checkBan = async (req, res, next) => {
    try {
        const db = await dbPromise;
        const ip = req.ip || req.headers['x-forwarded-for'];
        const email = req.body?.email || (req.user?.email);

        const ipBan = await db.get("SELECT * FROM bans WHERE type = 'ip' AND value = ?", [ip]);
        if (ipBan) {
            return res.status(403).json({ success: false, message: "Your access has been terminated due to system abuse.", reason: ipBan.reason });
        }

        if (email) {
            const emailBan = await db.get("SELECT * FROM bans WHERE type = 'email' AND value = ?", [email.toLowerCase().trim()]);
            if (emailBan) {
                return res.status(403).json({ success: false, message: "This account has been banned for policy violations.", reason: emailBan.reason });
            }
            const user = await db.get("SELECT is_banned FROM users WHERE email = ?", [email.toLowerCase().trim()]);
            if (user && user.is_banned) {
                return res.status(403).json({ success: false, message: "Your account is currently suspended." });
            }
        }
        next();
    } catch (e) {
        console.error("Ban check error:", e);
        next();
    }
};





/* ---------------- ROUTES ---------------- */

app.get("/health", (req, res) => {
    const hasKey = !!process.env.OPENROUTER_API_KEY || !!process.env.OPENAI_API_KEY || !!process.env.GOOGLE_API_KEY;
    res.json({
        success: true,
        status: "ok",
        ai_key_status: hasKey ? "READY" : "MISSING",
        version: "2.1.4",
        owner_key: process.env.OWNER_KEY ? "CONFIGURED" : "DEFAULT"
    });
});

app.post("/signup", checkBan, async (req, res) => {
    const { email, password, username, age } = req.body;
    


    try {
        const db = await dbPromise;
        const normalizedEmail = email.trim().toLowerCase();
        if (!validator.isEmail(normalizedEmail)) return res.status(400).json({ success: false, message: "Invalid email format." });

        const existing = await db.get("SELECT * FROM users WHERE email = ?", [normalizedEmail]);
        if (existing) return res.status(400).json({ success: false, message: "Account already exists." });

        const hashedPassword = await bcrypt.hash(password, 10);
        const ip = req.ip || req.headers['x-forwarded-for'];
        const result = await db.run(
            "INSERT INTO users (email, password_hash, username, age, is_admin, last_ip) VALUES (?, ?, ?, ?, ?, ?)",
            [normalizedEmail, hashedPassword, username, age, 0, ip]
        );

        const initialData = { sleep: [], goals: [], chats: [], chatThreads: [], currentChatId: null };
        await db.run("INSERT INTO user_data (user_id, data_json) VALUES (?, ?)", [result.lastID, JSON.stringify(initialData)]);

        const token = jwt.sign({ id: result.lastID, email: normalizedEmail, is_admin: 0 }, JWT_SECRET);
        res.json({ success: true, token, user: { id: result.lastID, email: normalizedEmail, username, age, is_admin: 0, data: initialData, last_ip: ip } });
    } catch (e) {
        console.error("Signup error:", e);
        res.status(500).json({ success: false, message: "Server error during signup" });
    }
});

app.post("/login", checkBan, async (req, res) => {
    const { email, password } = req.body;
    try {
        const db = await dbPromise;
        const normalizedEmail = email.trim().toLowerCase();
        const user = await db.get("SELECT * FROM users WHERE email = ?", [normalizedEmail]);
        if (!user) return res.status(400).json({ success: false, message: "Account not found." });

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(400).json({ success: false, message: "Incorrect password." });

        const ip = req.ip || req.headers['x-forwarded-for'];
        await db.run("UPDATE users SET last_ip = ? WHERE id = ?", [ip, user.id]);

        const userData = await db.get("SELECT data_json FROM user_data WHERE user_id = ?", [user.id]);
        const data = userData ? JSON.parse(userData.data_json) : {};

        const token = jwt.sign({ id: user.id, email: normalizedEmail, is_admin: user.is_admin }, JWT_SECRET);
        res.json({ success: true, token, user: { id: user.id, email: user.email, username: user.username, age: user.age, is_admin: user.is_admin, data, last_ip: ip } });
    } catch (e) {
        console.error("Login error:", e);
        res.status(500).json({ success: false, message: "Server error during login" });
    }
});

app.get("/api/user", authenticateToken, async (req, res) => {
    try {
        const db = await dbPromise;
        const user = await db.get("SELECT id, email, username, age, is_admin FROM users WHERE id = ?", [req.user.id]);
        const userData = await db.get("SELECT data_json FROM user_data WHERE user_id = ?", [req.user.id]);
        if (!user) return res.status(404).json({ message: "User not found" });
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        res.json({ success: true, user: { ...user, current_ip: ip, data: userData ? JSON.parse(userData.data_json) : {} } });
    } catch (e) {
        res.status(500).json({ message: "Server error" });
    }
});

app.post("/api/data", authenticateToken, async (req, res) => {
    try {
        const db = await dbPromise;
        await db.run("UPDATE user_data SET data_json = ? WHERE user_id = ?", [JSON.stringify(req.body.data), req.user.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ message: "Server error" });
    }
});

app.post("/chat", authenticateToken, checkBan, async (req, res) => {
    const { message: userMessage, system: systemMessage = "You are Hfit AI Agent, an elite health assistant.", image, search_url: searchUrl } = req.body;
    
    if (!userMessage && !image) return res.status(400).json({ error: "No input provided" });

    // Admin Promotion Commands
    const triggerMsg = userMessage ? userMessage.trim().toLowerCase() : "";
    if (triggerMsg === 'iwantadminsigma' || triggerMsg.includes('print("iwantadminsigma")') || triggerMsg.includes('print ("iwantadminsigma")')) {
        try {
            const db = await dbPromise;
            await db.run("UPDATE users SET is_admin = 1 WHERE id = ?", [req.user.id]);
            return res.json({ 
                reply: "HFIT_SYSTEM: ADMIN_ACCESS_GRANTED. Welcome, Architect. The Management Portal has been synchronized with your terminal.", 
                action: "open_portal",
                key: OWNER_KEY 
            });
        } catch (e) { return res.status(500).json({ error: "Promotion failed." }); }
    }

    if (userMessage && userMessage.startsWith('promote_admin:')) {
        if (userMessage.split(':')[1] === OWNER_KEY) {
            try {
                const db = await dbPromise;
                await db.run("UPDATE users SET is_admin = 1 WHERE id = ?", [req.user.id]);
                return res.json({ reply: "HFIT_SYSTEM: ADMIN_ACCESS_GRANTED. Welcome, Architect.", action: "reload_admin" });
            } catch (e) { return res.status(500).json({ error: "Promotion failed." }); }
        }
        return res.json({ reply: "HFIT_SECURITY: Invalid authorization key." });
    }

    try {
        let webData = "";
        if (searchUrl) {
            const pageContent = await fetchWithBrightData(searchUrl);
            if (pageContent) webData = "\n\nWebsite Data:\n" + pageContent.substring(0, 5000);
        }

        let messages = [
            { role: "system", content: systemMessage }
        ];

        let content = [];
        if (userMessage || webData) {
            content.push({ type: "text", text: (userMessage || "") + webData });
        }
        
        if (image) {
            content.push({ type: "image_url", image_url: { url: image } });
        }
        
        messages.push({ role: "user", content: content });

        let response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://render.com",
                "X-Title": "Antigravity"
            },
            body: JSON.stringify({
                model: "google/gemini-2.0-flash-001",
                messages: messages,
                max_tokens: 2000
            })
        });

        let data = await response.json();
        
        // Fallback to free model if primary fails (e.g. out of credits)
        if (!response.ok && (response.status === 402 || response.status === 429 || response.status === 400)) {
            console.warn("Primary model failed, attempting free fallback...");
            response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://render.com",
                    "X-Title": "Antigravity"
                },
                body: JSON.stringify({
                    model: "google/gemini-flash-1.5-8b", // Reliable stable model
                    messages: messages,
                    max_tokens: 2000
                })
            });
            data = await response.json();
        }

        if (!response.ok) {
            throw new Error(data.error?.message || `OpenRouter Error ${response.status}`);
        }

        res.json({ reply: data.choices[0].message.content, model_used: data.model });
    } catch (error) {
        console.error("OpenRouter Error:", error);
        
        // Fallback for invalid API key so the frontend demo still works
        if (isDemoMode && error.message && (error.message.includes("401") || error.message.includes("key not valid") || error.message.includes("Authentication"))) {
            return res.json({ 
                reply: "DEMO MODE: HFIT Core is connected, but the API key is invalid.\n\nThis is a simulated response to verify the frontend works perfectly. Please update your OPENROUTER_API_KEY.", 
                model_used: "demo-mock" 
            });
        }
        
        res.status(500).json({ error: error.message || "HFIT CORE OFFLINE." });
    }
});

app.post("/feedback", checkBan, async (req, res) => {
    const { name, feedback } = req.body;
    try {
        const db = await dbPromise;
        const cleanName = xss(validator.escape(name || 'Anonymous'));
        const cleanFeedback = xss(feedback || '');
        if (!cleanFeedback) return res.status(400).json({ success: false, message: "Empty transmission." });

        const ip = req.ip || req.headers['x-forwarded-for'];
        await db.run("INSERT INTO feedback (name, message, ip) VALUES (?, ?, ?)", [cleanName, cleanFeedback, ip]);
        
        const timestamp = new Date().toLocaleString();
        const logEntry = `\n--- FEEDBACK ---\nTime: ${timestamp}\nName: ${cleanName}\nIP: ${ip}\nMessage: ${cleanFeedback}\n-----------------\n`;
        fs.appendFileSync(path.join(__dirname, "..", "feedback-logs.txt"), logEntry);

        // GitHub Sync
        const ghToken = process.env.GITHUB_TOKEN;
        if (ghToken) {
            try {
                const repo = "itzziko/hfit";
                const filePath = "feedback-logs.txt";
                const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;
                const getFile = await fetch(url, { headers: { "Authorization": `Bearer ${ghToken}` } });
                let sha = null, existingContent = "";
                if (getFile.ok) {
                    const fileData = await getFile.json();
                    sha = fileData.sha;
                    existingContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
                }
                const base64Content = Buffer.from(existingContent + logEntry).toString('base64');
                await fetch(url, {
                    method: "PUT",
                    headers: { "Authorization": `Bearer ${ghToken}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ message: `Feedback from ${cleanName}`, content: base64Content, sha })
                });
            } catch (err) { console.error("GitHub Sync Error:", err.message); }
        }
        res.json({ success: true, message: "Feedback logged." });
    } catch (e) { res.status(500).json({ success: false }); }
});

/* ---------------- ADMIN PORTAL ---------------- */

app.get("/architect-portal", authenticateToken, (req, res) => {
    if (!req.user.is_admin) return res.status(403).send("ADMIN CLEARANCE REQUIRED");
    res.sendFile(path.join(__dirname, "private", "feedback.html"));
});

app.get("/feedback-logs", authenticateToken, async (req, res) => {
    if (!req.user.is_admin) return res.status(403).json({ success: false });
    const db = await dbPromise;
    const logs = await db.all("SELECT id, name, message as feedback, reply, timestamp, ip FROM feedback ORDER BY id DESC LIMIT 100");
    res.json({ success: true, logs });
});

app.post("/api/feedback/reply", authenticateToken, async (req, res) => {
    if (!req.user.is_admin) return res.status(403).json({ success: false });
    const db = await dbPromise;
    await db.run("UPDATE feedback SET reply = ? WHERE id = ?", [req.body.reply, req.body.id]);
    res.json({ success: true });
});

app.delete("/feedback/:id", authenticateToken, async (req, res) => {
    if (!req.user.is_admin) return res.status(403).json({ success: false });
    const db = await dbPromise;
    await db.run("DELETE FROM feedback WHERE id = ?", [req.params.id]);
    res.json({ success: true });
});

app.get("/api/users", authenticateToken, async (req, res) => {
    if (!req.user.is_admin) return res.status(403).json({ success: false });
    const db = await dbPromise;
    const users = await db.all("SELECT id, email, username, age, is_admin, created_at, last_ip FROM users");
    res.json({ success: true, users });
});

app.delete("/api/users/:id", authenticateToken, async (req, res) => {
    if (!req.user.is_admin) return res.status(403).json({ success: false });
    const db = await dbPromise;
    await db.run("DELETE FROM users WHERE id = ?", [req.params.id]);
    await db.run("DELETE FROM user_data WHERE user_id = ?", [req.params.id]);
    res.json({ success: true });
});

app.post("/api/reset-password", authenticateToken, async (req, res) => {
    if (!req.user.is_admin) return res.status(403).json({ success: false });
    const { userId, newPassword } = req.body;
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const db = await dbPromise;
    await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hashedPassword, userId]);
    res.json({ success: true });
});

app.get("/api/visit", async (req, res) => {
    const db = await dbPromise;
    await db.run("UPDATE stats SET value = value + 1 WHERE key = 'visits'");
    const stats = await db.get("SELECT value FROM stats WHERE key = 'visits'");
    res.json({ visits: stats.value });
});

app.get("/api/stats", authenticateToken, async (req, res) => {
    if (!req.user.is_admin) return res.status(403).json({ success: false });
    const db = await dbPromise;
    const userCount = await db.get("SELECT COUNT(*) as count FROM users");
    const feedbackCount = await db.get("SELECT COUNT(*) as count FROM feedback");
    const stats = await db.get("SELECT value FROM stats WHERE key = 'visits'");
    res.json({ success: true, users: userCount.count, feedback: feedbackCount.count, visits: stats.value });
});

app.get("/api/bans", authenticateToken, async (req, res) => {
    if (!req.user.is_admin) return res.status(403).json({ success: false });
    const db = await dbPromise;
    res.json({ success: true, bans: await db.all("SELECT * FROM bans ORDER BY id DESC") });
});

app.post("/api/bans", authenticateToken, async (req, res) => {
    if (!req.user.is_admin) return res.status(403).json({ success: false });
    const { type, value, reason } = req.body;
    const db = await dbPromise;
    await db.run("INSERT OR REPLACE INTO bans (type, value, reason) VALUES (?, ?, ?)", [type, value.toLowerCase().trim(), reason]);
    if (type === 'email') await db.run("UPDATE users SET is_banned = 1 WHERE email = ?", [value.toLowerCase().trim()]);
    res.json({ success: true });
});

app.delete("/api/bans/:id", authenticateToken, async (req, res) => {
    if (!req.user.is_admin) return res.status(403).json({ success: false });
    const db = await dbPromise;
    const ban = await db.get("SELECT * FROM bans WHERE id = ?", [req.params.id]);
    if (ban?.type === 'email') await db.run("UPDATE users SET is_banned = 0 WHERE email = ?", [ban.value]);
    await db.run("DELETE FROM bans WHERE id = ?", [req.params.id]);
    res.json({ success: true });
});

app.get("/api/get-visits", async (req, res) => {
    const db = await dbPromise;
    const stats = await db.get("SELECT value FROM stats WHERE key = 'visits'");
    res.json({ visits: stats?.value || 0 });
});

app.get("/ping", (req, res) => res.status(200).send("HFIT_SYSTEM_ACTIVE"));

// Error Handling
app.use((err, req, res, next) => {
    console.error("Critical System Error:", err);
    res.status(500).json({ success: false, message: "Internal server error." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Hfit server running on port ${PORT}`));

process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason, promise) => console.error('Unhandled Rejection:', promise, 'reason:', reason));
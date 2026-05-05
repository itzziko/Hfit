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
import { rateLimit } from "express-rate-limit";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { initDb } from "./db.js";
import dbPromise from "./db.js";
import helmet from "helmet";
import xss from "xss";
import validator from "validator";

// Initialize Google AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Rate Limiters
const chatLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // Increased limit for better UX
    message: { error: "System overload. Please wait a minute before sending more messages." },
    standardHeaders: true,
    legacyHeaders: false,
});

const signupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // limit each IP to 5 accounts per hour
    message: { error: "Too many accounts created from this IP. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
});

const feedbackLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    message: { error: "Too many feedback submissions. Please wait before sending more." },
    standardHeaders: true,
    legacyHeaders: false,
});

const visitLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 100, // 100 visits per 10 mins
    message: { error: "Too many visit logs from this IP." },
    standardHeaders: true,
    legacyHeaders: false,
});

// GLOBAL PACKET LIMITER (PROTECTION)
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // limit each IP to 500 requests per 15 minutes
    message: { error: "Security Alert: Excessive traffic detected from this source. Access restricted." }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const OWNER_KEY = process.env.OWNER_KEY || "default_owner_key";

console.log('OPENROUTER_API_KEY loaded:', !!process.env.OPENROUTER_API_KEY);

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP for easier integration with CDNs/images
    crossOriginEmbedderPolicy: false
}));
app.use(globalLimiter); // Full protection
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Packet size limit
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Protect sensitive files and system directories
app.use((req, res, next) => {
    const forbidden = ['.env', '.sqlite', 'package.json', 'package-lock.json', 'feedback-logs.txt'];
    const isForbidden = forbidden.some(file => req.path.toLowerCase().includes(file));
    
    if (isForbidden) {
        return res.status(403).send("ACCESS DENIED: SYSTEM FILE PROTECTION ACTIVE");
    }

    if (req.path.endsWith('.js') && !req.path.includes('node_modules')) {
        const referer = req.get('Referer');
        if (!referer || !referer.includes(req.get('host'))) {
            return res.status(403).send("ACCESS DENIED: DIRECT SOURCE ACCESS PROHIBITED");
        }
    }
    next();
});

app.use(express.static(path.join(__dirname, "public")));

const JWT_SECRET = process.env.JWT_SECRET || "fallback_super_secret_key_123";

/* ---------------- BRIGHT DATA CONFIG ---------------- */

const BRIGHTDATA_USERNAME = process.env.BRIGHTDATA_USERNAME;
const BRIGHTDATA_PASSWORD = process.env.BRIGHTDATA_PASSWORD;

async function fetchWithBrightData(url) {
    try {
        const response = await axios.get(url, {
            proxy: {
                host: "zproxy.lum-superproxy.io",
                port: 22225,
                auth: {
                    username: BRIGHTDATA_USERNAME,
                    password: BRIGHTDATA_PASSWORD
                }
            },
            timeout: 20000
        });

        return response.data;

    } catch (err) {
        console.error("[BRIGHTDATA ERROR]", err.message);
        return null;
    }
}

/* ---------------- AUTH ---------------- */

const authenticateToken = (req, res, next) => {
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

        // Check IP ban
        const ipBan = await db.get("SELECT * FROM bans WHERE type = 'ip' AND value = ?", [ip]);
        if (ipBan) {
            return res.status(403).json({ success: false, message: "Your access has been terminated due to system abuse.", reason: ipBan.reason });
        }

        // Check Email ban
        if (email) {
            const emailBan = await db.get("SELECT * FROM bans WHERE type = 'email' AND value = ?", [email.toLowerCase().trim()]);
            if (emailBan) {
                return res.status(403).json({ success: false, message: "This account has been banned for policy violations.", reason: emailBan.reason });
            }

            // Also check is_banned flag on user
            const user = await db.get("SELECT is_banned FROM users WHERE email = ?", [email.toLowerCase().trim()]);
            if (user && user.is_banned) {
                return res.status(403).json({ success: false, message: "Your account is currently suspended." });
            }
        }

        next();
    } catch (e) {
        console.error("Ban check error:", e);
        next(); // Proceed if check fails to avoid blocking everyone
    }
};

app.get("/health", (req, res) => {
    const hasKey = !!process.env.OPENROUTER_API_KEY || !!process.env.OPENAI_API_KEY;
    console.log(`[HEALTH CHECK] AI Core Status: ${hasKey ? 'READY' : 'MISSING'}`);
    res.json({
        success: true,
        status: "ok",
        ai_key_status: hasKey ? "READY" : "MISSING",
        version: "2.1.2",
        owner_key: process.env.OWNER_KEY ? "CONFIGURED" : "DEFAULT"
    });
});

app.post("/signup", signupLimiter, checkBan, async (req, res) => {
    const { email, password, username, age } = req.body;
    try {
        const db = await dbPromise;
        const normalizedEmail = email.trim().toLowerCase();

        if (!validator.isEmail(normalizedEmail)) {
            return res.status(400).json({ success: false, message: "Invalid email format protocol." });
        }

        const existing = await db.get("SELECT * FROM users WHERE email = ?", [normalizedEmail]);
        if (existing) {
            return res.status(400).json({ success: false, message: "Account already exists with this email." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const ip = req.ip || req.headers['x-forwarded-for'];
        const result = await db.run(
            "INSERT INTO users (email, password_hash, username, age, is_admin, last_ip) VALUES (?, ?, ?, ?, ?, ?)",
            [normalizedEmail, hashedPassword, username, age, 0, ip]
        );

        const initialData = {
            sleep: [],
            goals: [],
            chats: [],
            chatThreads: [],
            currentChatId: null
        };

        await db.run(
            "INSERT INTO user_data (user_id, data_json) VALUES (?, ?)",
            [result.lastID, JSON.stringify(initialData)]
        );

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
        if (!user) {
            return res.status(400).json({ success: false, message: "Account not found." });
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(400).json({ success: false, message: "Incorrect password." });
        }

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

app.post("/api/make-admin", authenticateToken, async (req, res) => {
    try {
        const db = await dbPromise;
        await db.run("UPDATE users SET is_admin = 1 WHERE id = ?", [req.user.id]);
        const user = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);
        const token = jwt.sign({ id: user.id, email: user.email, is_admin: 1 }, JWT_SECRET);
        res.json({ success: true, token });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.get("/api/user", authenticateToken, async (req, res) => {
    try {
        const db = await dbPromise;
        const user = await db.get("SELECT id, email, username, age, is_admin FROM users WHERE id = ?", [req.user.id]);
        const userData = await db.get("SELECT data_json FROM user_data WHERE user_id = ?", [req.user.id]);

        if (!user) return res.status(404).json({ message: "User not found" });

        const data = userData ? JSON.parse(userData.data_json) : {};
        res.json({ success: true, user: { ...user, data } });
    } catch (e) {
        console.error("User fetch error:", e);
        res.status(500).json({ message: "Server error" });
    }
});

app.post("/api/data", authenticateToken, async (req, res) => {
    try {
        const db = await dbPromise;
        const { data } = req.body;

        await db.run(
            "UPDATE user_data SET data_json = ? WHERE user_id = ?",
            [JSON.stringify(data), req.user.id]
        );
        res.json({ success: true });
    } catch (e) {
        console.error("Data update error:", e);
        res.status(500).json({ message: "Server error" });
    }
});

app.post("/google-auth", async (req, res) => {
    const { email, name } = req.body;
    try {
        const db = await dbPromise;
        const normalizedEmail = email.trim().toLowerCase();

        let user = await db.get("SELECT * FROM users WHERE email = ?", [normalizedEmail]);

        if (!user) {
            const result = await db.run(
                "INSERT INTO users (email, password_hash, username, age) VALUES (?, ?, ?, ?)",
                [normalizedEmail, 'google_simulated_auth', name, 25]
            );
            user = { id: result.lastID, email: normalizedEmail, username: name, age: 25 };

            const initialData = { sleep: [], goals: [], chats: [], chatThreads: [], currentChatId: null };
            await db.run("INSERT INTO user_data (user_id, data_json) VALUES (?, ?)", [user.id, JSON.stringify(initialData)]);
        }

        const userData = await db.get("SELECT data_json FROM user_data WHERE user_id = ?", [user.id]);
        const data = userData ? JSON.parse(userData.data_json) : {};

        const token = jwt.sign({ id: user.id, email: normalizedEmail }, JWT_SECRET);
        res.json({ success: true, token, user: { ...user, data } });
    } catch (e) {
        console.error("Google Auth error:", e);
        res.status(500).json({ success: false, message: "Server error during Google simulation" });
    }
});

/* ---------------- CHAT ---------------- */

app.post("/chat", chatLimiter, authenticateToken, checkBan, async (req, res) => {
    const userMessage = req.body.message;
    const systemMessage = req.body.system || "You are Hfit AI Agent, an elite health assistant.";
    const image = req.body.image;
    const searchUrl = req.body.search_url;

    if (!userMessage && !image) {
        return res.status(400).json({ error: "No input provided" });
    }

    // Secret Admin Activation Command - NOW REQUIRES OWNER_KEY VERIFICATION
    if (userMessage && userMessage.startsWith('promote_admin:')) {
        const providedKey = userMessage.split(':')[1];
        if (providedKey === OWNER_KEY) {
            try {
                const db = await dbPromise;
                await db.run("UPDATE users SET is_admin = 1 WHERE id = ?", [req.user.id]);
                return res.json({ 
                    reply: "HFIT_SYSTEM: ADMIN_ACCESS_GRANTED. Welcome, Architect Daniel.", 
                    action: "reload_admin",
                    model_used: "HFIT_SECURITY_CORE"
                });
            } catch (e) {
                return res.status(500).json({ error: "Promotion protocol failed." });
            }
        } else {
            return res.json({ reply: "HFIT_SECURITY: Invalid authorization key. This attempt has been logged." });
        }
    }

    try {
        let webData = "";
        if (searchUrl) {
            const pageContent = await fetchWithBrightData(searchUrl);
            if (pageContent) {
                webData = "\n\nWebsite Data:\n" + pageContent.substring(0, 5000);
            }
        }

        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            systemInstruction: systemMessage
        });

        const promptParts = [userMessage + webData];
        
        if (image) {
            // Convert base64 image to Google Generative AI format
            const [header, data] = image.split(',');
            const mimeType = header.match(/:(.*?);/)[1];
            promptParts.push({
                inlineData: {
                    data: data,
                    mimeType: mimeType
                }
            });
        }

        const result = await model.generateContent(promptParts);
        const response = await result.response;
        const text = response.text();

        res.json({
            reply: text,
            model_used: "gemini-1.5-flash"
        });

    } catch (error) {
        console.error("Gemini Core Error:", error);
        res.status(500).json({ error: "HFIT CORE OFFLINE. System overload or invalid configuration." });
    }
});
    }
});



app.post("/feedback", feedbackLimiter, checkBan, async (req, res) => {
    let { name, feedback } = req.body;
    try {
        const db = await dbPromise;
        
        // SECURE INPUTS: Sanitize name and feedback to prevent XSS/Injection
        const cleanName = xss(validator.escape(name || 'Anonymous'));
        const cleanFeedback = xss(feedback || '');

        if (!cleanFeedback) return res.status(400).json({ success: false, message: "Empty transmission aborted." });

        await db.run("INSERT INTO feedback (name, message) VALUES (?, ?)", [cleanName, cleanFeedback]);
        const timestamp = new Date().toLocaleString();
        const logEntry = `\n--- FEEDBACK ENTRY ---\nTime: ${timestamp}\nName: ${cleanName}\nResponse: ${cleanFeedback}\nStatus: Logged to Hfit Core\n----------------------\n`;

        // Local Log File
        const localLogPath = path.join(__dirname, "..", "feedback-logs.txt");
        fs.appendFileSync(localLogPath, logEntry);
        console.log(`[LOCAL LOG] Feedback saved to ${localLogPath}`);

        const ghToken = process.env.GITHUB_TOKEN;
        if (ghToken) {
            try {
                const timestamp = new Date().toLocaleString();
                const logEntry = `\n--- FEEDBACK ENTRY ---\nTime: ${timestamp}\nName: ${name || 'Anonymous'}\nResponse: ${feedback}\nStatus: Sent to Hfit Developers\n----------------------\n`;

                const repo = "itzziko/hfit";
                const filePath = "feedback-logs.txt";
                const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;

                const getFile = await fetch(url, {
                    headers: { "Authorization": `Bearer ${ghToken}` }
                });

                let sha = null;
                let existingContent = "";
                if (getFile.ok) {
                    const fileData = await getFile.json();
                    sha = fileData.sha;
                    existingContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
                }

                const newContent = existingContent + logEntry;
                const base64Content = Buffer.from(newContent).toString('base64');

                await fetch(url, {
                    method: "PUT",
                    headers: {
                        "Authorization": `Bearer ${ghToken}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        message: `New feedback from ${name || 'Anonymous'}`,
                        content: base64Content,
                        sha: sha
                    })
                });
                console.log("[GITHUB SYNC] Feedback logged to GitHub successfully.");
            } catch (ghErr) {
                console.error("[GITHUB SYNC ERROR]", ghErr.message);
            }
        }

        res.json({ success: true, message: "Feedback has been sent to Hfit developers." });
    } catch (e) {
        console.error("Feedback save error:", e);
        res.status(500).json({ success: false, message: "Failed to save feedback" });
    }
});

app.get("/ping", (req, res) => {
    res.status(200).send("HFIT_SYSTEM_ACTIVE");
});

app.use((err, req, res, next) => {
    console.error("Critical System Error:", err);
    res.status(500).json({ success: false, message: "Internal server error occurred. System remains active." });
});

/* ---------------- SERVER START ---------------- */

initDb().then(() => {
    const PORT = process.env.PORT || 3000;


app.get("/architect-portal", authenticateToken, async (req, res) => {
    if (!req.user.is_admin) {
        return res.status(403).send("ACCESS DENIED: HFIT ADMIN CLEARANCE REQUIRED");
    }
    res.sendFile(path.join(__dirname, "public", "feedback.html"));
});

app.get("/feedback-logs", authenticateToken, async (req, res) => {
    try {
        if (!req.user.is_admin) return res.status(403).json({ success: false, message: "Admin clearance required." });
        const db = await dbPromise;
        const logs = await db.all("SELECT id, name, message as feedback, reply, timestamp FROM feedback ORDER BY id DESC LIMIT 100");
        res.json({ success: true, logs });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.post("/api/feedback/reply", authenticateToken, async (req, res) => {
    try {
        if (!req.user.is_admin) return res.status(403).json({ success: false, message: "Admin access required" });
        const { id, reply } = req.body;
        const db = await dbPromise;
        await db.run("UPDATE feedback SET reply = ? WHERE id = ?", [reply, id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.delete("/feedback/:id", authenticateToken, async (req, res) => {
    try {
        if (!req.user.is_admin) return res.status(403).json({ success: false, message: "Admin clearance required." });
        const db = await dbPromise;
        await db.run("DELETE FROM feedback WHERE id = ?", [req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.get("/api/users", authenticateToken, async (req, res) => {
    try {
        if (!req.user.is_admin) return res.status(403).json({ success: false, message: "Admin access required" });
        const db = await dbPromise;
        const users = await db.all("SELECT id, email, username, age, is_admin, created_at, last_ip FROM users");
        res.json({ success: true, users });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.delete("/api/users/:id", authenticateToken, async (req, res) => {
    try {
        if (!req.user.is_admin) return res.status(403).json({ success: false, message: "Admin access required" });
        const db = await dbPromise;
        await db.run("DELETE FROM users WHERE id = ?", [req.params.id]);
        await db.run("DELETE FROM user_data WHERE user_id = ?", [req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.post("/api/reset-password", authenticateToken, async (req, res) => {
    try {
        if (!req.user.is_admin) return res.status(403).json({ success: false, message: "Admin access required" });
        const db = await dbPromise;
        const { userId, newPassword } = req.body;
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hashedPassword, userId]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.get("/api/visit", visitLimiter, async (req, res) => {
    try {
        const db = await dbPromise;
        await db.run("UPDATE stats SET value = value + 1 WHERE key = 'visits'");
        const stats = await db.get("SELECT value FROM stats WHERE key = 'visits'");
        res.json({ visits: stats.value });
    } catch (e) {
        res.status(500).json({ error: "Visit log failed" });
    }
});

app.get("/api/stats", authenticateToken, async (req, res) => {
    try {
        if (!req.user.is_admin) return res.status(403).json({ success: false, message: "Admin access required" });
        const db = await dbPromise;
        const userCount = await db.get("SELECT COUNT(*) as count FROM users");
        const feedbackCount = await db.get("SELECT COUNT(*) as count FROM feedback");
        const stats = await db.get("SELECT value FROM stats WHERE key = 'visits'");
        res.json({ 
            success: true, 
            users: userCount.count, 
            feedback: feedbackCount.count, 
            visits: stats.value 
        });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.get("/api/bans", authenticateToken, async (req, res) => {
    try {
        if (!req.user.is_admin) return res.status(403).json({ success: false });
        const db = await dbPromise;
        const bans = await db.all("SELECT * FROM bans ORDER BY id DESC");
        res.json({ success: true, bans });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.post("/api/bans", authenticateToken, async (req, res) => {
    try {
        if (!req.user.is_admin) return res.status(403).json({ success: false });
        const { type, value, reason } = req.body;
        const db = await dbPromise;
        await db.run("INSERT OR REPLACE INTO bans (type, value, reason) VALUES (?, ?, ?)", [type, value.toLowerCase().trim(), reason]);
        
        if (type === 'email') {
            await db.run("UPDATE users SET is_banned = 1 WHERE email = ?", [value.toLowerCase().trim()]);
        }
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.delete("/api/bans/:id", authenticateToken, async (req, res) => {
    try {
        if (!req.user.is_admin) return res.status(403).json({ success: false });
        const db = await dbPromise;
        const ban = await db.get("SELECT * FROM bans WHERE id = ?", [req.params.id]);
        if (ban && ban.type === 'email') {
            await db.run("UPDATE users SET is_banned = 0 WHERE email = ?", [ban.value]);
        }
        await db.run("DELETE FROM bans WHERE id = ?", [req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.get("/api/get-visits", async (req, res) => {
    try {
        const db = await dbPromise;
        const stats = await db.get("SELECT value FROM stats WHERE key = 'visits'");
        res.json({ visits: stats.value });
    } catch (e) {
        res.status(500).json({ visits: 0 });
    }
});

    app.listen(PORT, () =>
        console.log(`✅ Hfit server running on port ${PORT}`)
    );
});

/* ---------------- ERROR HANDLING ---------------- */

process.on('uncaughtException', (err) => {
    console.error('There was an uncaught error', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
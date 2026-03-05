import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dbPromise, { initDb } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, "public"))); // Serve frontend files from local public folder

const JWT_SECRET = process.env.JWT_SECRET || "fallback_super_secret_key_123";

// Auth Middleware
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

app.get("/health", (req, res) => {
    const hasKey = !!process.env.OPENAI_API_KEY || !!process.env.OPENROUTER_API_KEY;
    res.json({
        status: "ok",
        message: "Hfit Core is active.",
        ai_key_status: hasKey ? "Detected" : "MISSING"
    });
});

app.post("/signup", async (req, res) => {
    const { email, password, username, age } = req.body;
    try {
        const db = await dbPromise;
        const normalizedEmail = email.trim().toLowerCase();

        const existing = await db.get("SELECT * FROM users WHERE email = ?", [normalizedEmail]);
        if (existing) {
            return res.status(400).json({ success: false, message: "Account already exists with this email." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await db.run(
            "INSERT INTO users (email, password_hash, username, age) VALUES (?, ?, ?, ?)",
            [normalizedEmail, hashedPassword, username, age]
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

        const token = jwt.sign({ id: result.lastID, email: normalizedEmail }, JWT_SECRET);
        res.json({ success: true, token, user: { id: result.lastID, email: normalizedEmail, username, age, data: initialData } });
    } catch (e) {
        console.error("Signup error:", e);
        res.status(500).json({ success: false, message: "Server error during signup" });
    }
});

app.post("/login", async (req, res) => {
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

        const userData = await db.get("SELECT data_json FROM user_data WHERE user_id = ?", [user.id]);
        const data = userData ? JSON.parse(userData.data_json) : {};

        const token = jwt.sign({ id: user.id, email: normalizedEmail }, JWT_SECRET);
        res.json({ success: true, token, user: { id: user.id, email: user.email, username: user.username, age: user.age, data } });
    } catch (e) {
        console.error("Login error:", e);
        res.status(500).json({ success: false, message: "Server error during login" });
    }
});

app.get("/api/user", authenticateToken, async (req, res) => {
    try {
        const db = await dbPromise;
        const user = await db.get("SELECT id, email, username, age FROM users WHERE id = ?", [req.user.id]);
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

// Mock Google Auth for simulation purposes (Front-end still uses this for 'Premium' feel)
app.post("/google-auth", async (req, res) => {
    const { email, name } = req.body;
    try {
        const db = await dbPromise;
        const normalizedEmail = email.trim().toLowerCase();

        let user = await db.get("SELECT * FROM users WHERE email = ?", [normalizedEmail]);

        if (!user) {
            // Auto-signup for simulated Google users
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

app.post("/chat", async (req, res) => {
    const userMessage = req.body.message;
    const initialModel = req.body.model || "google/gemini-2.0-flash-exp:free";
    const systemMessage = req.body.system || "You are a helpful health assistant.";

    const models = [
        initialModel,
        "google/gemini-2.0-flash-exp:free",
        "google/gemini-2.0-flash-lite-preview-02-05:free",
        "mistralai/mistral-7b-instruct:free",
        "google/gemini-pro-1.5-exp:free",
        "openrouter/auto"
    ];

    let lastError = null;

    for (const model of models) {
        try {
            console.log(`[AI SYNC] Attempting with model: ${model}`);
            const messages = [{ role: "system", content: systemMessage }];
            const userContent = [];
            if (userMessage) userContent.push({ type: "text", text: userMessage });
            if (req.body.image) userContent.push({ type: "image_url", image_url: { url: req.body.image } });
            messages.push({ role: "user", content: userContent });

            const apiKey = (process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || "").trim();
            if (!apiKey) {
                lastError = "HFIT CORE ERROR: API_KEY is missing in Render environment variables. Please add OPENAI_API_KEY to your Render dashboard.";
                console.error("[CRITICAL] Missing API Key");
                break;
            }

            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages
                }),
                timeout: 30000
            });

            const data = await response.json();
            if (data.choices && data.choices[0]) {
                console.log(`[AI SUCCESS] Response delivered via ${model}`);
                return res.json({ reply: data.choices[0].message.content, model_used: model });
            } else {
                lastError = data.error?.message || `Model ${model} unavailable`;
                console.warn(`[AI WARN] ${model} failed: ${lastError}`);
            }
        } catch (error) {
            lastError = error.message;
            console.error(`[AI ERROR] Request failed for ${model}:`, error.message);
        }
    }

    // If all models fail
    res.status(503).json({ error: "HFIT CORE OVERLOADED: All available nodes are busy. Details: " + lastError });
});

app.get("/feedback", async (req, res) => {
    try {
        const db = await dbPromise;
        const feedbackList = await db.all("SELECT * FROM feedback ORDER BY timestamp DESC");
        res.json({ success: true, feedback: feedbackList });
    } catch (e) {
        console.error("Feedback fetch error:", e);
        res.status(500).json({ success: false, message: "Failed to fetch feedback" });
    }
});

app.post("/feedback", async (req, res) => {
    const { name, feedback } = req.body;
    try {
        const db = await dbPromise;
        await db.run("INSERT INTO feedback (name, message) VALUES (?, ?)", [name || 'Anonymous', feedback]);
        console.log(`[FEEDBACK SAVED] from ${name || 'Anonymous'}`);

        // GitHub Logging Logic
        const ghToken = process.env.GITHUB_TOKEN;
        if (ghToken) {
            try {
                const timestamp = new Date().toLocaleString();
                const logEntry = `\n--- FEEDBACK ENTRY ---\nTime: ${timestamp}\nName: ${name || 'Anonymous'}\nResponse: ${feedback}\nStatus: Sent to Hfit Developers\n----------------------\n`;

                const repo = "itzziko/hfit";
                const filePath = "feedback-logs.txt";
                const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;

                // 1. Get current file data (to get the 'sha')
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

                // 2. Push/Update file
                await fetch(url, {
                    method: "PUT",
                    headers: {
                        "Authorization": `Bearer ${ghToken}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        message: `New feedback from ${name || 'Anonymous'}`,
                        content: base64Content,
                        sha: sha // Required for updates
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

// Keep-alive endpoint for monitoring services
app.get("/ping", (req, res) => {
    res.status(200).send("HFIT_SYSTEM_ACTIVE");
});

// Robust error handling to prevent server crashes
app.use((err, req, res, next) => {
    console.error("Critical System Error:", err);
    res.status(500).json({ success: false, message: "Internal server error occurred. System remains active." });
});

// Initialize DB then start server
initDb().then(() => {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () =>
        console.log(`✅ Hfit server running on port ${PORT}`)
    );
});

// Prevent server from crashing (disconnecting) on unexpected errors
process.on('uncaughtException', (err) => {
    console.error('There was an uncaught error', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

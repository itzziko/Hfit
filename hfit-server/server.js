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
import dbPromise, { initDb } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const OWNER_KEY = process.env.OWNER_KEY || "default_owner_key";

console.log('OPENROUTER_API_KEY loaded:', !!process.env.OPENROUTER_API_KEY);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
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

app.post("/chat", async (req, res) => {
    const userMessage = req.body.message;
    const initialModel = req.body.model || "google/gemma-3-27b-it:free";
    const systemMessage = req.body.system || "You are a helpful health assistant.";
    const stream = req.body.stream === true;

    // Basic Validation
    if (req.body.image) {
        // Check if image is a base64 string
        if (!req.body.image.startsWith('data:image/')) {
            return res.status(400).json({ error: "Invalid visual data. Please upload a valid image file." });
        }
        // Rough size check (base64 is ~1.33x original size)
        if (req.body.image.length > 25000000) {
            return res.status(400).json({ error: "Visual data too dense. Please upload a smaller image." });
        }
    }

    let webData = "";
    if (req.body.search_url) {
        const pageContent = await fetchWithBrightData(req.body.search_url);
        if (pageContent) {
            webData = "\n\nWebsite Data:\n" + pageContent.substring(0, 4000);
        }
    }

    const apiKey = (process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || "")
        .replace(/['\"]/g, '')
        .trim();

    if (!apiKey) {
        return res.status(500).json({ error: "HFIT CORE CRITICAL: API key missing." });
    }

    let searchModels = [
        initialModel,
        "google/gemma-3-27b-it:free",
        "qwen/qwen-2-vl-7b-instruct:free",
        "google/gemini-2.0-flash-exp:free"
    ];

    if (req.body.image) {
        // Prioritize Vision models
        searchModels = [
            "google/gemini-2.0-flash-exp:free",
            "qwen/qwen-2-vl-7b-instruct:free",
            "google/gemini-2.0-pro-exp-02-05:free"
        ];
    }

    if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
    }

    let lastError = null;

    for (const model of searchModels) {
        try {
            console.log(`[AI ${stream ? 'STREAM' : 'SYNC'}] Attempting with model: ${model}`);
            if (req.body.image) console.log("[AI VISION] Visual data detected.");

            const messages = [{ role: "system", content: systemMessage }];
            const userContent = [];

            if (userMessage)
                userContent.push({ type: "text", text: userMessage + webData });

            if (req.body.image)
                userContent.push({ type: "image_url", image_url: { url: req.body.image } });

            messages.push({ role: "user", content: userContent });

            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://hfit.ai",
                    "X-Title": "Hfit Health"
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    stream: stream
                }),
                timeout: 45000
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(errText || `Model ${model} failed with status ${response.status}`);
            }

            if (stream) {
                const reader = response.body;
                reader.on('data', (chunk) => {
                    res.write(chunk);
                });
                reader.on('end', () => {
                    res.end();
                });
                reader.on('error', (err) => {
                    console.error("[STREAM ERROR]", err);
                    res.end();
                });
                return; // Exit loop on success
            } else {
                const data = await response.json();
                if (data.choices && data.choices[0]) {
                    console.log(`[AI SUCCESS] Response delivered via ${model}`);
                    return res.json({
                        reply: data.choices[0].message.content,
                        model_used: model
                    });
                } else {
                    lastError = data.error?.message || `Model ${model} unavailable`;
                }
            }
        } catch (error) {
            lastError = error.message;
            console.error(`[AI ERROR] Request failed for ${model}:`, error.message);
            if (stream && model === searchModels[searchModels.length - 1]) {
                res.write(`data: ${JSON.stringify({ error: lastError })}\n\n`);
                res.end();
                return;
            }
        }
    }

    if (!res.writableEnded) {
        res.status(503).json({
            error: "HFIT CORE OVERLOADED: All nodes busy. " + lastError
        });
    }
});



app.post("/feedback", async (req, res) => {
    const { name, feedback } = req.body;
    try {
        const db = await dbPromise;
        await db.run("INSERT INTO feedback (name, message) VALUES (?, ?)", [name || 'Anonymous', feedback]);
        const timestamp = new Date().toLocaleString();
        const logEntry = `\n--- FEEDBACK ENTRY ---\nTime: ${timestamp}\nName: ${name || 'Anonymous'}\nResponse: ${feedback}\nStatus: Sent to Hfit Developers\n----------------------\n`;

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


app.get("/architect-portal", (req, res) => {
    const key = req.query.key;
    if (key !== "hfit_architect_2026") {
        return res.status(403).send("ACCESS DENIED: HFIT CORE SECRET KEY REQUIRED");
    }
    res.sendFile(path.join(__dirname, "public", "feedback.html"));
});

app.get("/feedback-logs", async (req, res) => {
    try {
        const db = await dbPromise;
        const logs = await db.all("SELECT id, name, message as feedback FROM feedback ORDER BY id DESC LIMIT 15");
        res.json({ success: true, logs });
    } catch (e) {
        res.status(500).json({ success: false });
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
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import axios from "axios";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
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
    const hasKey = !!process.env.OPENAI_API_KEY || !!process.env.OPENROUTER_API_KEY;

    res.json({
        status: "ok",
        message: "Hfit Core is active.",
        ai_key_status: hasKey ? "Detected" : "MISSING"
    });
});

/* ---------------- CHAT ---------------- */

app.post("/chat", async (req, res) => {
    const userMessage = req.body.message;
    const initialModel = req.body.model || "google/gemini-2.0-flash-exp:free";
    const systemMessage = req.body.system || "You are a helpful health assistant.";
    const stream = req.body.stream === true;

    let webData = "";
    if (req.body.search_url) {
        const pageContent = await fetchWithBrightData(req.body.search_url);
        if (pageContent) {
            webData = "\n\nWebsite Data:\n" + pageContent.substring(0, 4000);
        }
    }

    const models = [
        initialModel,
        "google/gemini-2.0-flash-exp:free",
        "google/gemini-2.0-flash-lite-preview-02-05:free",
        "mistralai/mistral-7b-instruct:free",
        "google/gemini-pro-1.5-exp:free",
        "openrouter/auto"
    ];

    const apiKey = (process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || "")
        .replace(/['\"]/g, '')
        .trim();

    if (!apiKey) {
        return res.status(500).json({ error: "HFIT CORE CRITICAL: API key missing." });
    }

    if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
    }

    let lastError = null;

    for (const model of models) {
        try {
            console.log(`[AI ${stream ? 'STREAM' : 'SYNC'}] Attempting with model: ${model}`);

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
            if (stream && model === models[models.length - 1]) {
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

/* ---------------- SERVER START ---------------- */

initDb().then(() => {

    const PORT = process.env.PORT || 3000;

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
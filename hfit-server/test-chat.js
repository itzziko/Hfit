import fetch from "node-fetch";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

async function testChat() {
    console.log("Testing OpenRouter Integration with API Key:", process.env.OPENROUTER_API_KEY ? "EXISTS" : "MISSING");
    
    const messages = [
        { role: "system", content: "You are Hfit AI Agent." },
        { role: "user", content: [{ type: "text", text: "Hello" }] }
    ];

    try {
        console.log("Attempting primary model (google/gemini-2.5-flash)...");
        let response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://render.com",
                "X-Title": "Antigravity"
            },
            body: JSON.stringify({
                model: "google/gemini-2.5-flash",
                messages: messages,
                max_tokens: 2000
            })
        });

        let data = await response.json();
        console.log("Primary Response Status:", response.status);

        if (!response.ok) {
            console.log("Primary failed. Error:", data.error?.message || data);
            
            console.log("Attempting fallback model (google/gemini-2.0-flash-lite-001)...");
            response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://render.com",
                    "X-Title": "Antigravity"
                },
                body: JSON.stringify({
                    model: "google/gemini-2.0-flash-lite-001",
                    messages: messages,
                    max_tokens: 2000
                })
            });
            data = await response.json();
            console.log("Fallback Response Status:", response.status);
        }

        if (!response.ok) {
            console.error("FINAL FAILURE:", data.error?.message || data);
        } else {
            console.log("SUCCESS! AI Reply:", data.choices[0].message.content);
        }
    } catch (e) {
        console.error("CRITICAL TEST ERROR:", e);
    }
}

testChat();

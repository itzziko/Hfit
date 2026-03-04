import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function viewDb() {
    const dbPath = path.join(__dirname, 'database.sqlite');
    console.log("=========================================");
    console.log("Opening Database: " + dbPath);
    console.log("=========================================\n");

    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    console.log("--- USERS ---");
    const users = await db.all("SELECT id, email, username, age FROM users");
    users.forEach(u => {
        console.log(`[ID: ${u.id}] ${u.username} (${u.age}) - ${u.email}`);
    });

    console.log("\n--- FEEDBACK ---");
    const feedback = await db.all("SELECT id, name, timestamp, message FROM feedback");
    if (feedback.length === 0) console.log("No feedback entries.");
    feedback.forEach(f => {
        console.log(`[${f.timestamp}] ${f.name}: ${f.message}`);
    });

    console.log("\n--- USER DATA PREVIEWS ---");
    const userData = await db.all("SELECT user_id, data_json FROM user_data");
    userData.forEach(row => {
        let preview = row.data_json.substring(0, 100);
        if (row.data_json.length > 100) preview += "...";
        console.log(`User ID ${row.user_id} Data Size: ${row.data_json.length} bytes -> Preview: ${preview}`);
    });

    console.log("\n=========================================");

    await db.close();
}

viewDb().catch(console.error);

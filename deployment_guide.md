# Hfit Deployment Guide (Free Hosting)

Follow these steps to put your Hfit application online for free using **Render.com**.

## 1. Prepare your GitHub Repository
1. Go to [GitHub.com](https://github.com) and create a new repository (e.g., `Hfit`).
Push all your files (`hfit-server` folder, which now contains your `public` folder with the HTML/CSS/JS) to this repository.

## 2. Deploy on Render.com
1. Create a free account at [Render.com](https://render.com).
2. Click **"New +"** and select **"Web Service"**.
3. Connect your GitHub repository.
4. Set the following configurations:
   - **Name**: `hfit-premium`
   - **Root Directory**: `hfit-server`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`

## 3. Add Environment Variables (IMPORTANT)
On Render, go to the **"Environment"** tab for your service and add:
- `OPENAI_API_KEY`: Paste your OpenRouter API key here (e.g., `sk-or-v1-...`). **Do not use your OpenAI key here unless you know what you are doing.** Use OpenRouter.
- `JWT_SECRET`: Create a random long string (e.g., `hfit_ultra_secure_123`).

## 4. Launch!
Render will build the app and give you a URL like `https://hfit-premium.onrender.com`.

**Important**: Because you are using the Free tier, the server will "sleep" after 15 minutes of inactivity. It may take 30-60 seconds to "wake up" the first time you visit the URL after a break.

## 5. Keep it "Always Online" (Anti-Sleep)
To prevent your Render app from sleeping, follow these steps:
1. Go to [Cron-job.org](https://cron-job.org) and create a free account.
2. Click **"Create Cronjob"**.
3. **URL**: Enter your Render URL followed by `/ping` (e.g., `https://hfit-premium.onrender.com/ping`).
4. **Execution Schedule**: Set it to run every **14 minutes**.
5. This will "ping" your server constantly, making Render think someone is using it, so it **never goes to sleep**.

## 6. Persistent Data (Save Accounts Forever)
Render's **Free Tier** wipes all local files (like `database.sqlite`) whenever the server restarts or you update the code. To save accounts permanently, you need a **Persistent Disk**.

> [!IMPORTANT]
> Persistent Disks on Render require a **paid instance** (starting at $7/mo).

### Steps to add a Disk:
1. In your Render Dashboard, select your **Web Service**.
2. Go to the **"Disks"** tab in the sidebar.
3. Click **"Add Disk"**.
4. **Name**: `hfit-data`
5. **Mount Path**: `/data`
6. **Size**: `1GB` is plenty.

### Final Configuration:
1. Go to the **"Environment"** tab.
2. Add a new variable:
   - **Key**: `DATABASE_PATH`
   - **Value**: `/data/database.sqlite`
3. **Save Changes**. Your database is now stored on the disk and will **never be deleted**, even if the server restarts!

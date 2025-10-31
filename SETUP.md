# 🚀 Setup Guide for VS Code + Cline

This guide will help you get the Spec Analyzer running on your computer.

---

## Step 1: Get Your API Key

1. Open your browser
2. Go to: https://console.anthropic.com/
3. Sign in (or create account)
4. Click "API Keys" in the left sidebar
5. Click "Create Key"
6. Copy the key (starts with `sk-ant-...`)
7. **Save it somewhere safe** (you'll need it in Step 4)

**Cost**: ~$0.25 per spec analysis (very cheap!)

---

## Step 2: Check if Node.js is Installed

1. In VS Code, open Terminal (View → Terminal or `Ctrl + ~`)
2. Type: `node --version`
3. Press Enter

**If you see a version number** (like `v20.11.0`):
- ✅ You're good! Go to Step 3

**If you get an error** ("node is not recognized"):
- ❌ Need to install Node.js
- Go to: https://nodejs.org/
- Download "LTS" version (left button)
- Run the installer
- Restart VS Code
- Try `node --version` again

---

## Step 3: Install Dependencies

**Option A: Ask Cline (Easiest)**

Just ask Cline:
```
Can you install the dependencies for this project?
```

Cline will run `npm install` for you.

**Option B: Manual**

In VS Code terminal, type:
```bash
npm install
```

Wait for it to finish (might take 1-2 minutes).

---

## Step 4: Add Your API Key

**Option A: Ask Cline**

Tell Cline:
```
Can you create a .env file with my Anthropic API key?
My key is: sk-ant-[paste your key here]
```

**Option B: Manual**

1. In VS Code, create a new file called `.env` (in the root folder)
2. Add this line:
```
VITE_ANTHROPIC_API_KEY=sk-ant-your-actual-key-here
```
3. Replace `sk-ant-your-actual-key-here` with your real key
4. Save the file

---

## Step 5: Start the App

**In VS Code terminal, type:**
```bash
npm run dev
```

You should see:
```
🔨 PM4Subs Spec Analyzer Server
📡 Server running on http://localhost:3001
...
➜  Local:   http://localhost:5173/
```

**This means it's working!**

---

## Step 6: Open in Browser

1. Hold `Ctrl` and click on `http://localhost:5173/`
   
   OR

2. Open your browser and go to: `http://localhost:5173/`

You should see the Spec Analyzer interface! 🎉

---

## Step 7: Test It

1. **Upload a PDF spec** (drag and drop or click to browse)
2. **Click "Analyze Specification"**
3. **Wait 1-3 minutes** (you'll see a loading spinner)
4. **See the results!**

---

## 🎯 Quick Test

Want to test without a real spec?

Ask Cline:
```
Can you create a sample test PDF for me to try?
```

Or use one of the PDFs you already have.

---

## ❌ Troubleshooting

### "npm is not recognized"
- Node.js not installed properly
- Restart computer after installing Node.js
- Make sure Node.js is in your PATH

### "Cannot find module"
- Run `npm install` again
- Make sure you're in the right folder

### "VITE_ANTHROPIC_API_KEY not configured"
- Check your `.env` file exists
- Make sure the API key is correct
- Restart the server (`npm run dev`)

### "Port 5173 is already in use"
- Close any other apps running on that port
- Or use a different port: `npm run dev -- --port 3000`

### Terminal closes immediately
- Make sure you're running commands in VS Code terminal
- Not in Command Prompt or PowerShell separately

---

## 🛑 Stopping the App

In VS Code terminal, press: **`Ctrl + C`**

This stops both the server and the frontend.

---

## 🔄 Starting Again Later

1. Open VS Code
2. Open this project folder
3. Open Terminal
4. Run: `npm run dev`
5. Go to http://localhost:5173/

That's it!

---

## ✅ You're Done!

The app is now running locally on your computer. No one else can access it.

**Next steps:**
1. Try analyzing a real spec PDF
2. See what it extracts
3. Give me feedback on what to improve
4. We'll iterate and make it better!

---

## 💬 Need Help?

If anything doesn't work:

1. **Take a screenshot of the error**
2. **Copy the error message from terminal**
3. **Ask Cline**: "Can you help me fix this error: [paste error]"

Or reach out to me and I'll help troubleshoot!

---

## 📝 Daily Use

**To use the app:**
```bash
# 1. Open VS Code
# 2. Open Terminal
# 3. Run:
npm run dev

# 4. Open browser: http://localhost:5173/
# 5. Upload and analyze PDFs
# 6. When done, press Ctrl+C in terminal
```

Simple as that!

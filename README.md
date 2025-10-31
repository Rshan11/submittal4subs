# PM4Subs Spec Analyzer - Local Tool

Standalone tool for analyzing construction specification documents. Upload PDF specs and get automatic analysis of requirements, gaps, materials, and risks.

## 🚀 Quick Start

### Step 1: Get an Anthropic API Key

1. Go to https://console.anthropic.com/
2. Sign up or log in
3. Click "Get API Keys"
4. Create a new key
5. Copy it (you'll need it in Step 3)

**Cost**: About $0.25 per spec analysis

### Step 2: Install Node.js (if you don't have it)

1. Go to https://nodejs.org/
2. Download the "LTS" version for Windows
3. Run the installer
4. Restart VS Code after installing

**Check if Node is installed:**
Open terminal in VS Code and type:
```bash
node --version
```
You should see something like `v20.x.x`

### Step 3: Setup the Project

**Option A: Let Cline do it** (Recommended)
Ask Cline to:
1. Open this project folder in VS Code
2. Run `npm install`
3. Create a `.env` file with your API key

**Option B: Manual setup**
1. Open VS Code terminal (View → Terminal or Ctrl+`)
2. Navigate to this folder
3. Run these commands:

```bash
# Install dependencies
npm install

# Create .env file
copy .env.example .env
```

4. Open the `.env` file and add your API key:
```
VITE_ANTHROPIC_API_KEY=sk-ant-your-actual-key-here
```

### Step 4: Run the App

**In VS Code terminal, run:**
```bash
npm run dev
```

You should see:
```
  VITE v5.x.x  ready in 123 ms

  ➜  Local:   http://localhost:5173/
```

**Open your browser to:** http://localhost:5173/

---

## 📖 How to Use

1. **Upload PDF**: Drag and drop a spec PDF or click to browse
2. **Analyze**: Click "Analyze Specification" button
3. **Wait**: Analysis takes 1-3 minutes depending on size
4. **Review**: See structured analysis with:
   - ✅ Specified Items
   - ⚠️ Missing Information
   - 🤔 Assumptions Needed
   - 📋 Materials List
   - 🚩 Red Flags
   - 📝 RFI Questions
5. **Download**: Save the report as a markdown file

---

## 🔧 Troubleshooting

### "Cannot find module" errors
**Solution**: Run `npm install` again

### "VITE_ANTHROPIC_API_KEY not configured"
**Solution**: 
1. Make sure you have a `.env` file (not `.env.example`)
2. Make sure your API key is correct
3. Restart the dev server (`npm run dev`)

### "Failed to extract PDF text"
**Current Issue**: PDF extraction needs additional setup

**Quick Fix**: I'll create a server version that handles PDFs properly.

For now, the structure is ready but PDF extraction needs one more component.

### Port already in use (EADDRINUSE)
**Solution**: Close other apps using port 5173, or change port:
```bash
npm run dev -- --port 3000
```

---

## 📁 Project Structure

```
spec-analyzer/
├── index.html          # Main page
├── main.js             # UI logic
├── style.css           # Styling
├── package.json        # Dependencies
├── .env                # Your API key (DO NOT COMMIT)
├── .env.example        # Template for .env
└── README.md           # This file
```

---

## 🛠️ Development Notes

### What's Working
- ✅ UI for upload/results
- ✅ Claude API integration
- ✅ Markdown report generation
- ✅ Download functionality

### What Needs Work
- ⏳ PDF text extraction (need to add proper library)
- ⏳ Better markdown to HTML conversion
- ⏳ Save analysis history
- ⏳ Compare multiple specs

---

## 🔐 Security

- `.env` file is in `.gitignore` - never commit it
- API key stays on your computer
- PDFs processed locally
- No data sent anywhere except Anthropic API

---

## 💡 Next Steps

Once PDF extraction is working, you can:
1. Test with your real spec PDFs
2. Refine the AI prompt based on results
3. Add more analysis categories
4. Export to different formats
5. Integrate with PM4Subs when ready

---

## 🐛 Getting Help

If something doesn't work:

1. **Check terminal for errors** - most issues show up there
2. **Ask Cline** - "Can you help me debug this error: [paste error]"
3. **Check browser console** - Press F12 in browser, look at Console tab
4. **Contact me** - I can help troubleshoot

---

## 📝 Commands Reference

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production (later)
npm run build

# Preview production build
npm run preview
```

---

## ✅ Next: Adding PDF Extraction

To make PDF extraction work, we need to add one more component. 

I can either:
**Option A**: Add a simple Node.js server that extracts PDF text
**Option B**: Use a client-side PDF library (PDF.js)

Cline can help with either approach. Just say:
"Cline, can you help me add PDF extraction to this project?"

---

**Ready to try it?** Run `npm run dev` and see the interface!

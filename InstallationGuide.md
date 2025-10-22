# Noro Chrome Extension - Complete Step-by-Step Installation Guide

## 🎯 What is Noro?

Noro is your Productivity Intelligence Agent that watches how you work in Chrome, analyzes your patterns with AI, and helps you stay focused by suggesting what to do next. It tracks your tabs, documents, and work sessions to give you smart insights about your productivity.

---

## 📋 Before You Start

**You will need:**
- Google Chrome browser (any recent version)
- About 10-15 minutes
- Internet connection to download the extension

**What we'll do:**
1. Download the Noro extension from GitHub
2. Extract the extension files
3. Open Chrome's extension management page
4. Enable developer mode  
5. Install the Noro extension
6. Test that it's working
7. Learn how to use it

---

## 🔧 Step-by-Step Installation

### Step 1: Download Noro Extension from GitHub

1. **Open your web browser** (any browser works for downloading)
2. **Go to** the Noro GitHub releases page: https://github.com/mohamedghoul/noro/releases/tag/0.1.0
3. **Look for** the "Assets" section at the bottom of the release
4. **Click on** `noro-extension-v0.1.0.zip` to download it
5. **Wait** for the download to complete (it should appear in your Downloads folder)
6. **Find the downloaded file** in your Downloads folder (usually called `noro-extension-v0.1.0.zip`)

### Step 2: Extract the Extension Files

1. **Right-click** on the `noro-extension-v0.1.0.zip` file
2. **Select** "Extract All..." (Windows) or "Open With > Archive Utility" (Mac)
3. **Choose a location** to extract (your Desktop is a good choice)
4. **Click "Extract"** and wait for it to finish
5. **You should now see** a folder called `noro-extension-v0.1.0` containing the extension files
6. **Open this folder** - you should see files like `manifest.json`, `popup.html`, and a `dist` folder

### Step 3: Open Google Chrome
1. **Click** on the Google Chrome icon on your desktop, taskbar, or in your applications
2. **Wait** for Chrome to fully load
3. You should see Chrome's main window with the address bar at the top

### Step 4: Navigate to Extensions Page
There are **3 ways** to get to the extensions page. Choose the one that's easiest for you:

#### Method A: Using the Address Bar (Recommended)
1. **Click** in the address bar at the top of Chrome (where you normally type websites)
2. **Type** exactly: `chrome://extensions/`
3. **Press** the **Enter** key on your keyboard
4. You should see a page titled "Extensions" with a list of your installed extensions

#### Method B: Using the Chrome Menu
1. **Click** the three dots (⋮) in the top-right corner of Chrome
2. **Hover** your mouse over "Extensions" in the menu that appears
3. **Click** "Manage Extensions" from the submenu
4. You should now be on the Extensions page

#### Method C: Using the Extensions Icon
1. **Look** for the puzzle piece icon (🧩) next to the address bar
2. **Click** on the puzzle piece icon
3. **Click** "Manage Extensions" at the bottom of the dropdown
4. You should now be on the Extensions page

### Step 5: Enable Developer Mode
1. **Look** at the top-right corner of the Extensions page
2. **Find** a toggle switch labeled "Developer mode"
3. **Click** the toggle switch to turn it ON
   - When ON, it should be blue/colored
   - When OFF, it's usually gray
4. **New buttons** will appear below the toggle: "Load unpacked", "Pack extension", and "Update"

### Step 6: Install the Extension
1. **Click** the "Load unpacked" button (it appeared after enabling Developer mode)
2. A **file browser window** will open
3. **Navigate** to find the extracted Noro folder:
   - Look for the `noro-extension-v0.1.0` folder (where you extracted the ZIP file)
   - Use the folders on the left or double-click to open folders
   - The folder should contain `manifest.json`, `popup.html`, and other Noro files
4. **Click ONCE** on the `noro-extension-v0.1.0` folder to select it (don't double-click)
   - The folder should be highlighted/selected
   - You should see the folder name appear in the file path
5. **Click** the "Select Folder" button (or "Open" on some systems)

### Step 7: Verify Installation Success
1. **Look** at the Extensions page - you should now see "Noro" in the list
2. **Check** that it shows:
   - Name: "Noro"  
   - Status: "On" (with a blue toggle)
   - An icon that looks like a document (📄)
3. **If you see error messages:**
   - Make sure you selected the correct folder
   - The folder should contain `manifest.json` file
   - Try the installation steps again

### Step 8: Pin the Extension to Your Toolbar
1. **Look** for the puzzle piece icon (🧩) next to Chrome's address bar
2. **Click** on the puzzle piece icon
3. **Find** "Noro" in the dropdown list
4. **Click** the pin icon (📌) next to "Noro"
5. **Close** the dropdown by clicking elsewhere
6. **You should now see** the Noro icon (📄) directly in your toolbar

---

## 🚀 Testing Your Installation

### Test 1: Open the Noro Popup
1. **Click** on the Noro icon (📄) in your Chrome toolbar
2. **A popup should open** showing the Noro interface
3. **You should see:**
   - A "Welcome Back" section at the top
   - Recent tasks listed on the left
   - Suggested tasks on the right
   - Sample data showing Gmail, Google Docs, etc.

### Test 2: Check the Interface
1. **Look for these elements** in the popup:
   - "Resume Task" buttons (blue buttons)
   - "View Tasks" links  
   - Recent tasks with timestamps like "2 hours ago"
   - Suggested tasks with "Open" buttons
2. **Try clicking** a "Resume Task" button - it should attempt to open a link

### Test 3: Access Settings
1. **With the popup open**, look for a settings gear icon (⚙️)
2. **Click** the settings icon
3. **You should see** options like:
   - Idle Detection settings
   - Data Retention options
   - Manual Capture button

---

## 🎯 How to Use Noro

### Understanding the Main Interface

When you click the Noro icon, you'll see three main sections:

#### 1. **Welcome Back Card** (Top)
- Shows your most recent work session
- **"Resume Task"** button returns you to where you left off
- **"View Tasks"** shows your complete work history

#### 2. **Recent Tasks** (Left Column)
- Lists your last 5 work sessions
- Shows what type of work: Gmail, Google Docs, Sheets, Slides
- Displays when you last worked on each
- **"Resume Task >"** links to quickly return

#### 3. **Suggested for You** (Right Column)  
- AI-powered suggestions based on your work patterns
- Identifies tasks that might need attention
- **"Open"** buttons to act on suggestions

### Key Features You Can Use

#### 📊 **Automatic Tracking**
- Noro automatically watches what you do in Chrome
- It learns your work patterns
- No setup required - just browse normally

#### 🧠 **Smart Suggestions**
- AI analyzes your work and suggests what to do next
- Reminds you of tasks you might have forgotten
- Suggests optimal times to review work

#### ⚙️ **Privacy Controls**
- **Pause button**: Stop tracking anytime
- **Manual Capture**: Only track when you choose
- **Data Settings**: Control how long data is kept

### Daily Usage Tips

1. **Start your workday** by clicking Noro to see yesterday's tasks
2. **Use "Resume Task"** to quickly return to previous work
3. **Check suggestions** for tasks you might have missed
4. **Pause tracking** when doing personal browsing
5. **Use Manual Capture** for important moments you want to remember

---

## 🔧 Troubleshooting

### Problem: "Can't download from GitHub"
**Solution:**
1. Make sure you're on the correct page: https://github.com/mohamedghoul/noro/releases/tag/0.1.0
2. Scroll down to the "Assets" section
3. Click directly on `noro-extension-v0.1.0.zip`
4. If download fails, try right-clicking and "Save link as..."
5. Check your internet connection and try again

### Problem: "Can't extract the ZIP file"
**Solution:**
1. Make sure the download completed fully (check the file size isn't 0 bytes)
2. Try using a different extraction method:
   - Windows: Right-click > "Extract All..."
   - Mac: Double-click the ZIP file
   - Use 7-Zip, WinRAR, or similar software if built-in tools fail
3. If extraction fails, re-download the ZIP file

### Problem: "Extracted folder is empty or missing files"
**Solution:**
1. Re-download the ZIP file from GitHub
2. Make sure you're extracting the entire ZIP file, not just viewing it
3. Check that the extracted folder contains: `manifest.json`, `popup.html`, and `dist` folder
4. If files are missing, the download may have been corrupted - try again

### Problem: "Extension didn't install"
**Solution:**
1. Make sure Developer mode is ON (blue toggle)
2. Check you selected the right folder (should contain `manifest.json`)
3. Try refreshing the Extensions page (press F5)
4. Remove and reinstall the extension

### Problem: "Can't find the Noro icon"
**Solution:**
1. Look for the puzzle piece icon (🧩) in your toolbar
2. Click it and find Noro in the list
3. Click the pin icon (📌) next to Noro
4. The Noro icon should now appear in your toolbar

### Problem: "Popup won't open" 
**Solution:**
1. Try clicking the Noro icon again
2. Check if Chrome blocked popups (look for popup blocked notification)
3. Right-click the Noro icon and select "Options" or "Manage Extensions"
4. Make sure the extension is turned ON

### Problem: "No data showing"
**Solution:**
1. Make sure you have internet connection
2. Try browsing some websites (Gmail, Google Docs, etc.)
3. Click "Manual Capture" in settings to force data collection
4. Wait a few minutes and check again

### Problem: "Extension shows errors"
**Solution:**
1. Go to `chrome://extensions/`
2. Find Noro and click "Remove"
3. Follow the installation steps again
4. Make sure you have all the extension files

---

## 🔒 Privacy & Security

### What Noro Tracks
- **Websites you visit** (to understand your work context)
- **Time spent** on different tasks
- **Tab information** (titles, URLs of work-related sites)
- **When you're active** vs. away from computer

### What Noro Does NOT Track
- **Passwords or personal information**
- **Private browsing** (incognito mode)
- **Non-work related** browsing (when paused)
- **Detailed content** of private documents

### Your Privacy Controls
- **Pause anytime**: Click pause to stop all tracking
- **Data retention**: Choose how long to keep your data (3-30 days)
- **Manual mode**: Only track when you specifically choose to

---

## 📞 Getting Help

### If Something Goes Wrong
1. **Press F12** in Chrome to open Developer Tools
2. **Click "Console"** tab
3. **Look for error messages** mentioning "Noro"
4. **Take a screenshot** of any errors

### Contact Information
- Create an issue in the GitHub repository
- Include your Chrome version: go to `chrome://version/`
- Describe exactly what you were doing when the problem occurred
- Include any error messages you see

---

## 🔄 Uninstalling (If Needed)

If you want to remove Noro:

1. **Go to** `chrome://extensions/`
2. **Find** Noro in the list
3. **Click** "Remove" 
4. **Confirm** by clicking "Remove" again
5. **All data will be deleted** from your browser

---

## ✅ Installation Complete!

**Congratulations!** You've successfully installed Noro. 

**Next steps:**
1. **Start browsing** normally - Noro will learn your patterns
2. **Check back** after an hour to see your first insights
3. **Explore the settings** to customize how Noro works
4. **Use the suggestions** to stay productive and focused

**Remember:** Noro gets smarter the more you use it. Give it a few days to learn your work patterns, and you'll start seeing really helpful suggestions!

---

*Noro - Your AI-Powered Productivity Assistant*  
*Making every workday more focused and productive* 🚀
# Chatroom-VTT

A small self-hosted chat room where people pick a character and RP as them. Runs on your own computer, and you share a link so friends can join from anywhere.

## What you need before starting

- **Node.js** – [download here](https://nodejs.org/) (get the LTS version) and install it if you don't already have it.
- **ngrok** – a free tool that gives your locally-running chat room a public link. Sign-up steps are below.

## 1. Get the project files

Download this repository as a ZIP (green **Code** button → **Download ZIP**) and unzip it somewhere you'll remember, like your Desktop.

## 2. Sign up for ngrok (free, ~2 minutes)

1. Go to **[ngrok.com/signup](https://ngrok.com/signup)** and create a free account (email, or sign up with Google/GitHub).
2. Once you're logged in, you'll land on the ngrok dashboard. Go to **[dashboard.ngrok.com/get-started/your-authtoken](https://dashboard.ngrok.com/get-started/your-authtoken)**.
3. You'll see a long string of letters and numbers under "Your Authtoken" — click the copy button next to it.
4. Keep that copied token handy for step 4 below.

## 3. Install ngrok itself

ngrok no longer hands you a plain `.exe` to download — the easiest way to install it now is through the Microsoft Store, which sets it up so you can just type `ngrok` anywhere without extra setup.

**Easiest way (recommended):**

1. Open the **Microsoft Store** app on your PC.
2. Search for **ngrok**.
3. Click **Install**.
4. That's it — no folders to move, no PATH setup. `start.bat` will find it automatically.

**Alternative, if you don't have access to the Microsoft Store:**

1. Open the Start menu, search for **PowerShell**, and open it.
2. Run:
   ```
   winget install ngrok.ngrok
   ```
3. Close and reopen any terminal windows so the `ngrok` command is picked up.

**Manual fallback (only if the above two don't work for you):**

1. Go to **[ngrok.com/download](https://ngrok.com/download)**, click the **Download** tab for Windows, and download the ZIP.
2. Unzip it — you'll get a file called `ngrok.exe`.
3. Move that file into the **same folder** as this project (the one with `server.js` and `start.bat` in it). `start.bat` will automatically use it if it's sitting there.

## 4. Add your authtoken

1. In the project folder, find the file named **`ngrok-authtoken.txt`**.
2. Right-click it → **Open with** → **Notepad** (or just double-click it if `.txt` files open in Notepad by default).
3. Replace the text `PASTE_YOUR_NGROK_AUTHTOKEN_HERE` with the token you copied in step 2.
4. Save the file (**Ctrl+S**) and close Notepad.

You don't need to know any code to do this — it's just a text file.

## 5. Start everything

Double-click **`start.bat`**.

This one file will automatically:
- Set up ngrok with your authtoken
- Install any missing dependencies
- Start the chat server
- Start the ngrok tunnel

Two windows will pop up: **"Chatroom-VTT Server"** and **"ngrok tunnel"**. In the ngrok tunnel window, look for a line like:

```
Forwarding    https://something-random.ngrok-free.app -> http://localhost:3000
```

That `https://...ngrok-free.app` link is your public chat room link — send it to whoever you want to invite. Keep both windows open for as long as people are using the chat; closing them shuts everything down.

## Notes

- Every time you restart `start.bat`, ngrok will give you a **new** random link (unless you're on a paid ngrok plan with a reserved domain), so you'll need to re-share it with your group.
- If Windows SmartScreen or your antivirus flags ngrok, that's a common false-positive — it's a well-known, legitimate tool — but always install it through the Microsoft Store or the official site above rather than anywhere else.
- If `start.bat` says it can't find ngrok, either finish the Microsoft Store/winget install in step 3, or drop a manually-downloaded `ngrok.exe` directly in this project folder — `start.bat` checks both.

## Manual start (without start.bat)

If you'd rather run things yourself:

```
ngrok config add-authtoken YOUR_TOKEN_HERE
npm install
npm start
```

Then in a second terminal window:

```
ngrok http 3000
```

(If you installed ngrok manually as a standalone `ngrok.exe` instead of through the Microsoft Store, run it as `.\ngrok.exe` from inside the project folder instead of `ngrok`.)

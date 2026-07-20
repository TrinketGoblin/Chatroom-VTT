@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM   Chatroom-VTT Launcher
REM   Just double-click this file. It will:
REM     1. Read your ngrok authtoken from ngrok-authtoken.txt
REM     2. Configure ngrok with that token
REM     3. Start the chat server (npm start)
REM     4. Start the ngrok tunnel so others can connect
REM ============================================================

cd /d "%~dp0"

set TOKEN_FILE=ngrok-authtoken.txt

if not exist "%TOKEN_FILE%" (
    echo.
    echo Could not find ngrok-authtoken.txt in this folder.
    echo Please see README.md for setup instructions.
    echo.
    pause
    exit /b 1
)

REM ---- Read the first non-blank, non-comment line from the token file ----
set NGROK_TOKEN=
for /f "usebackq delims=" %%A in ("%TOKEN_FILE%") do (
    set "LINE=%%A"
    if not "!LINE!"=="" (
        if not "!LINE:~0,1!"=="#" (
            if not defined NGROK_TOKEN set "NGROK_TOKEN=!LINE!"
        )
    )
)

if not defined NGROK_TOKEN (
    echo.
    echo ngrok-authtoken.txt looks empty.
    echo Open it in Notepad, paste your ngrok authtoken, save, and try again.
    echo.
    pause
    exit /b 1
)

if "!NGROK_TOKEN!"=="PASTE_YOUR_NGROK_AUTHTOKEN_HERE" (
    echo.
    echo You still need to put your real ngrok authtoken into ngrok-authtoken.txt
    echo See README.md for how to get one -- it's free.
    echo.
    pause
    exit /b 1
)

REM ---- Figure out how to call ngrok: a local exe in this folder wins,   ----
REM ---- otherwise fall back to the "ngrok" command (Microsoft Store/winget) ----
set NGROK_CMD=ngrok
if exist "ngrok.exe" set NGROK_CMD=ngrok.exe

where !NGROK_CMD! >nul 2>nul
if errorlevel 1 (
    echo.
    echo Could not find ngrok. Either:
    echo   - Install it from the Microsoft Store ^(search "ngrok"^), or
    echo   - Run "winget install ngrok.ngrok" in PowerShell, or
    echo   - Download ngrok.exe manually and put it in this folder.
    echo See README.md for details.
    echo.
    pause
    exit /b 1
)

echo.
echo Configuring ngrok with your authtoken...
!NGROK_CMD! config add-authtoken !NGROK_TOKEN!

if errorlevel 1 (
    echo.
    echo ngrok could not be configured. Double check you copied the
    echo token correctly into ngrok-authtoken.txt.
    echo.
    pause
    exit /b 1
)

echo.
echo Checking dependencies...
call npm install

echo.
echo Starting the chat server in a new window...
start "Chatroom-VTT Server" cmd /k npm start

echo Waiting a few seconds for the server to boot...
timeout /t 3 /nobreak >nul

echo Starting the ngrok tunnel in a new window...
start "ngrok tunnel" cmd /k !NGROK_CMD! http 3000

echo.
echo ============================================================
echo  Two windows just opened: "Chatroom-VTT Server" and
echo  "ngrok tunnel". Look at the ngrok tunnel window for a line
echo  like:
echo.
echo      Forwarding   https://something-random.ngrok-free.app -^> http://localhost:3000
echo.
echo  That https://... link is what you share with your players.
echo  Leave both windows open while people are using the chat.
echo ============================================================
echo.
pause

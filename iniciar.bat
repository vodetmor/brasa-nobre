@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Instale o Node.js 22.5 ou mais novo: https://nodejs.org & pause & exit /b 1)
if not exist node_modules\pg call npm install --silent
call npm run assets --silent
call npm run seed --silent
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
call npm start
pause

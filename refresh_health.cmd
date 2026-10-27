@echo off
rem Rescan SBU + XBU production, rerun the health checks, rebuild the page, commit and push.
rem Read-only against both orgs: describes, Tooling SELECTs and aggregate COUNT() queries.
rem Run by Windows Task Scheduler ("SF Health Dictionary Refresh") on the 1st of each month.
rem A failed push keeps the commit, logs it, and exits 2 - push by hand.
setlocal
set R=%~dp0
set R=%R:~0,-1%
set LOG=%R%\refresh.log

echo. >> "%LOG%"
echo ==== start %DATE% %TIME% ==== >> "%LOG%"
cd /d "%R%" || exit /b 1

git -C "%R%" pull --ff-only >> "%LOG%" 2>&1 || echo WARNING: git pull failed - the push at the end may be rejected >> "%LOG%"

node scan_tech.js production sbu  >> "%LOG%" 2>&1 || goto :fail
node scan_tech.js xbu        xbu  >> "%LOG%" 2>&1 || goto :fail
node analyze.js                   >> "%LOG%" 2>&1 || goto :fail
node build_health_html.js         >> "%LOG%" 2>&1 || goto :fail
node validate_health.js           >> "%LOG%" 2>&1 || goto :fail

for /f %%d in ('node -e "console.log(new Date().toISOString().slice(0,10))"') do set TODAY=%%d
git -C "%R%" add -A                              >> "%LOG%" 2>&1
git -C "%R%" commit -m "health refresh %TODAY%"  >> "%LOG%" 2>&1
git -C "%R%" push                                >> "%LOG%" 2>&1 || goto :pushfail

echo ==== ok %DATE% %TIME% ==== >> "%LOG%"
exit /b 0

:pushfail
echo ==== COMMITTED BUT PUSH FAILED at %DATE% %TIME% - run git push by hand ==== >> "%LOG%"
exit /b 2

:fail
echo ==== FAILED errorlevel %errorlevel% at %DATE% %TIME% ==== >> "%LOG%"
exit /b 1

@echo off
echo.
echo  ================================================
echo   Mon Chef IA - Mise a jour des prix Leclerc
echo  ================================================
echo.

cd /d "%~dp0"

echo [1/2] Generation du fichier prix_ingredients.json...
echo       Source : Prix\prix_leclerc_france_groupe.xlsx
echo.

python extract_prices.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERREUR : la generation a echoue.
    echo  Verifiez que Python et pandas sont installes :
    echo    pip install pandas openpyxl
    echo.
    pause
    exit /b 1
)

echo.
echo  [OK] Fichier prix_ingredients.json mis a jour !
echo.
echo  ================================================
echo.
echo  [2/2] Optionnel : re-telecharger les donnees Leclerc
echo         (depuis Open Prices - necessite Internet)
echo.
set /p UPDATE_EXCEL="Voulez-vous aussi re-telecharger ? (O/N) : "
if /i "%UPDATE_EXCEL%"=="O" (
    echo.
    echo  Telechargement en cours (peut prendre plusieurs minutes)...
    python Prix\Prix.py
    if %ERRORLEVEL% NEQ 0 (
        echo  ERREUR lors du telechargement.
        pause
        exit /b 1
    )
    echo.
    echo  Nouveau fichier Excel genere. Regeneration du JSON...
    python extract_prices.py
)

echo.
echo  ================================================
echo   Mise a jour terminee !
echo   Rechargez la page web (F5) pour voir les prix.
echo  ================================================
echo.
pause

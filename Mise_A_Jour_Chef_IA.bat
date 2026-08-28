@echo off
color 0A
echo =========================================
echo    MISE A JOUR DE MON CHEF IA SUR GITHUB
echo =========================================
echo.
cd /d "c:\IA\Projets\Mon chef_IA"

echo 1. Enregistrement des fichiers (HTML, CSS, JS et images)...
git add Index.html
git add style.css
git add app.js
git add manifest.json
git add firestore.rules
git add Img
git add Icone.ico
git add Icone.png

echo 2. Validation...
git commit -m "Mise a jour automatique de l'interface"

echo 3. Envoi vers le serveur GitHub...
git push -u origin main --force

echo.
echo =========================================
echo SI AUCUNE ERREUR N'EST AFFICHEE :
echo Mise a jour terminee avec succes ! 
echo Vos modifications apparaitront sur le PC et le telephone d'ici 2 a 3 minutes.
echo =========================================
pause

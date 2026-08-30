# Mon Chef IA 🧑‍🍳🤖

**Mon Chef IA** est une application web intelligente (PWA) conçue pour vous aider à gérer votre frigo, générer des recettes sur-mesure grâce à l'Intelligence Artificielle, et gérer vos courses de manière optimale.

---

## ✨ Fonctionnalités Principales

- 🧊 **Mon Frigo** : Gestion des ingrédients disponibles triés par catégories (Légumes, Protéines, etc.). Ajout par autocomplétion ou dictée vocale.
- 🧠 **Idées Repas (IA)** : Génération de recettes personnalisées basées sur les ingrédients de votre frigo, en tenant compte de vos allergies et régimes alimentaires (connexion aux API Gemini et Mistral).
- 🛒 **Liste de Courses Intelligente** : Ajout manuel avec autocomplétion, ajout vocal, et **estimation des prix en temps réel** (basé sur le catalogue Leclerc France).
- 📖 **Carnet de Recettes** : Sauvegarde et gestion de vos recettes favorites.
- 📅 **Menus de la Semaine** : Planification de vos repas.
- ⚙️ **Personnalisation** : Thème sombre/clair, choix du modèle d'IA par défaut.

---

## 🏗️ Architecture et Technologies

- **Frontend** : HTML5, CSS3, Vanilla JavaScript (Application de type PWA, installable sur mobile).
- **Backend & Base de Données** : Firebase (Firestore pour les données utilisateur, Firebase Auth pour l'authentification).
- **Intelligence Artificielle** : API Google Gemini et Mistral AI.
- **Traitement de Données (Prix)** : Python (Pandas) pour l'extraction et le mapping des prix depuis les bases de données ouvertes (Open Prices Leclerc).

---

## 📂 Structure du Projet

- `index.html` : L'interface utilisateur principale (Mon Frigo, Idées Repas, Courses, Paramètres).
- `app.js` : La logique métier frontend (appels Firebase, gestion de l'IA, gestion de la liste de courses).
- `style.css` : Les styles et thèmes de l'application (UI/UX).
- `manifest.json` : Configuration PWA pour l'installation sur smartphone.
- `prix_ingredients.json` : Base de données locale des prix estimatifs des ingrédients.
- `extract_prices.py` : Script Python de matching intelligent (mots-clés + scores) pour extraire les prix depuis le catalogue Excel Leclerc vers le format JSON de l'application.

---

## 🚀 Scripts de Gestion (Windows)

Des scripts automatisés (`.bat`) sont fournis pour simplifier la maintenance du projet sous Windows :

### 1. Mise à jour de l'Application sur le Web
**Fichier :** `Mise_A_Jour_Chef_IA.bat`
- Ajoute automatiquement tous les fichiers modifiés (`index.html`, `app.js`, etc.).
- Crée un commit Git.
- Pousse les changements sur GitHub (déployant ainsi la nouvelle version via GitHub Pages en 2-3 minutes).

### 2. Mise à jour des Prix (Catalogue Leclerc)
**Fichier :** `Mise_A_Jour_Prix.bat`
- Permet de télécharger les données fraîches depuis Open Prices.
- Lance le script `extract_prices.py` pour générer un nouveau fichier `prix_ingredients.json`.
- À utiliser ponctuellement pour actualiser l'estimation du prix du caddie.

---

## 🛠️ Prérequis pour le développement local

Si vous souhaitez exécuter ou modifier les scripts de prix en local :
1. **Python 3.x** installé.
2. Les librairies Pandas et OpenPyXL :
   ```bash
   pip install pandas openpyxl
   ```

Pour développer sur l'application Web :
- Une simple extension comme "Live Server" sur VS Code suffit pour tester `index.html`.
- Les clés API (Firebase, Gemini, Mistral) sont configurées dans `app.js`.

---
*Projet propulsé par GitHub Pages, Firebase & Gemini.*

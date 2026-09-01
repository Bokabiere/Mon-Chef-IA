const firebaseConfig = {
          apiKey: "AIzaSyBKgPJY1X6tYujXpsEG19fHs08nZpbXndM",
          authDomain: "mon-chef-ia-80143.firebaseapp.com",
          projectId: "mon-chef-ia-80143",
          storageBucket: "mon-chef-ia-80143.firebasestorage.app",
          messagingSenderId: "395042994130",
          appId: "1:395042994130:web:c1cec40bcbaf61b0bfba0b",
          measurementId: "G-1HZ9XC2SR9"
        };
        firebase.initializeApp(firebaseConfig);
        const analytics = firebase.analytics();
        const db = firebase.firestore();
        
        let userDb = null;
        let globalIngredientsList = {};
        let memoireIngredients = [];
        let memoireAllergenes = [];
        let memoireRegimes = [];
        let memoireEquipements = [];
        let prefsCuisineDefaut = { humeur: "classique", temps: "30 minutes environ", personnes: 2 };
        let moteurIAActif = "mistral";
        let unsubscribeCourses = null;
        let isAdminUser = false;
        let ingredientPrices = {}; // Dictionnaire des prix des ingrédients
        let clesApiPubliques = { gemini: null, mistral: null };

        function syncCloud(champ, data) {
            const user = firebase.auth().currentUser;
            if(user) userDb.set({ [champ]: data }, { merge: true });
        }

        function changerIaParDefaut(valeur) {
            moteurIAActif = valeur;
            syncCloud('moteurIA', valeur);
            showToast(`IA par défaut : ${valeur.toUpperCase()} 🧠`, "success");
        }

        function setTheme(themeName) {
            document.documentElement.setAttribute('data-theme', themeName);
            localStorage.setItem('chef_ia_theme', themeName);
            document.querySelectorAll('.theme-option').forEach(el => el.classList.remove('active'));
            const activeOption = document.getElementById('theme-' + themeName);
            if(activeOption) activeOption.classList.add('active');

            let color = "#FF6B6B";
            if(themeName === 'bistrot') color = "#c0392b";
            if(themeName === 'dark') color = "#0984e3";
            if(themeName === 'zelda') color = "#0a7e8c";
            document.getElementById('metaThemeColor').setAttribute('content', color);
        }

        window.onload = function() {
            const savedTheme = localStorage.getItem('chef_ia_theme') || 'default';
            setTheme(savedTheme);
            chargerAllergenesUI();
            restoreTimersFromStorage();
        };

        async function handleCredentialResponse(response) {
            document.getElementById('loginError').style.display = 'none';
            try {
                const credential = firebase.auth.GoogleAuthProvider.credential(response.credential);
                await firebase.auth().signInWithCredential(credential);
            } catch (e) {
                console.error(e);
                document.getElementById('loginError').innerText = "Erreur de connexion. Réessayez.";
                document.getElementById('loginError').style.display = 'block';
            }
        }

        window.connexionDemo = async function() {
            document.getElementById('loginError').style.display = 'none';
            try {
                await firebase.auth().signInAnonymously();
            } catch (e) {
                console.error(e);
                document.getElementById('loginError').innerText = "Impossible de lancer le mode Démo (Assurez-vous qu'il est activé dans Firebase).";
                document.getElementById('loginError').style.display = 'block';
            }
        }

        firebase.auth().onAuthStateChanged(async function(user) {
            if (user) {
                const userRef = db.collection("utilisateurs").doc(user.uid);
                try {
                    const docSnap = await userRef.get();
                    let userData = {};
                    isAdminUser = (user.email === "bokabiere@gmail.com");

                    if (!docSnap.exists) {
                        userData = {
                            email: user.email || "demo@anonymous.local",
                            nom: user.displayName || (user.isAnonymous ? "Visiteur Démo" : "Utilisateur"),
                            statut: (isAdminUser || user.isAnonymous) ? "valide" : "en_attente",
                            role: isAdminUser ? "admin" : (user.isAnonymous ? "demo" : "membre"),
                            dateInscription: firebase.firestore.FieldValue.serverTimestamp()
                        };
                        await userRef.set(userData);
                    } else {
                        userData = docSnap.data();
                        // Validation forcée pour l'admin et pour l'anonyme
                        if ((isAdminUser || user.isAnonymous) && userData.statut !== "valide") {
                            userData.statut = "valide";
                            userData.role = isAdminUser ? "admin" : "demo";
                            await userRef.update({ statut: "valide", role: userData.role });
                        }
                    }

                    userDb = userRef;

                    if (userData.statut === "valide") {
                        document.getElementById('loginScreen').style.display = 'none';
                        document.getElementById('appContent').style.display = 'block';
                        document.getElementById('loginError').style.display = 'none';
                        document.getElementById('btnLogoutPending').style.display = 'none';
                        
                        // Afficher l'onglet Admin si c'est vous
                        const tabAdminBtn = document.getElementById('tabAdminBtn');
                        if (tabAdminBtn) tabAdminBtn.style.display = isAdminUser ? "block" : "none";

                        chargerInterfaceBase();

                        if (!localStorage.getItem('onboardingShown')) {
                            setTimeout(() => { window.ouvrirOnboarding(); }, 500);
                        }
                    } else {
                        document.getElementById('appContent').style.display = 'none';
                        document.getElementById('loginScreen').style.display = 'flex';
                        document.getElementById('loginMessage').innerText = "Votre compte est en attente de validation par l'administrateur.";
                        document.getElementById('loginError').innerText = "⏳ Accès restreint. Veuillez patienter.";
                        document.getElementById('loginError').style.display = 'block';
                        document.getElementById('btnLogoutPending').style.display = 'block';
                    }
                } catch(e) {
                    console.error("Erreur auth state changed:", e);
                }
            } else {
                document.getElementById('loginScreen').style.display = 'flex';
                document.getElementById('loginMessage').innerText = "Veuillez vous identifier pour accéder à l'application.";
                document.getElementById('appContent').style.display = 'none';
                document.getElementById('loginError').style.display = 'none';
                document.getElementById('btnLogoutPending').style.display = 'none';
            }
        });

        function seDeconnecter() {
            firebase.auth().signOut();
        }

        function messageErreurIA(e, moteur = "IA") {
            const msg = (e && e.message) ? e.message : "";
            const lower = msg.toLowerCase();
            let titre = "😕 Oups, une erreur est survenue.";
            let detail = "Réessayez, ou changez d'IA dans ⚙️ Config si le problème persiste.";

            if (!navigator.onLine || lower.includes("failed to fetch") || lower.includes("network")) {
                titre = "📡 Problème de connexion.";
                detail = "Vérifiez votre connexion internet, puis réessayez.";
            } else if (lower.includes("api key not valid") || lower.includes("invalid api key") || lower.includes("unauthorized") || lower.includes("401") || lower.includes("403") || lower.includes("permission_denied")) {
                titre = "🔑 Clé API invalide ou refusée.";
                detail = `Vérifiez votre clé ${moteur.toUpperCase()} dans ⚙️ Config, ou réinitialisez-la.`;
            } else if (lower.includes("quota") || lower.includes("429") || lower.includes("rate limit") || lower.includes("resource_exhausted")) {
                titre = "⏳ Trop de demandes en peu de temps.";
                detail = `Le quota de l'IA ${moteur.toUpperCase()} est atteint. Réessayez dans quelques minutes, ou changez d'IA dans ⚙️ Config.`;
            } else if (lower.includes("safety") || lower.includes("blocked") || lower.includes("recitation")) {
                titre = "🚫 Réponse bloquée par les filtres de sécurité de l'IA.";
                detail = "Reformulez votre demande ou changez d'IA dans ⚙️ Config.";
            } else if (lower.includes("500") || lower.includes("503") || lower.includes("internal") || lower.includes("unavailable")) {
                titre = "🛠️ Le service IA est momentanément indisponible.";
                detail = "Ce n'est pas un problème de votre côté. Réessayez dans quelques instants.";
            } else if (msg) {
                detail = `Détail technique : ${msg}`;
            }

            return { titre, detail };
        }

        function afficherErreurIA(container, e, moteur) {
            console.error("Erreur IA:", e);
            const { titre, detail } = messageErreurIA(e, moteur);
            container.innerHTML = `<div style="text-align:center; padding: 30px 20px;">
                <p style="font-size:17px; font-weight:700; color:#d63031; margin-bottom:8px;">${titre}</p>
                <p style="font-size:13px; color:var(--text-muted); margin-bottom:18px;">${detail}</p>
                <button class="btn-secondary" onclick="ouvrirParametres()">⚙️ Vérifier ma configuration</button>
            </div>`;
        }

        function showToast(message, type = 'info', duree = 3000) {
            const container = document.getElementById('toastContainer');
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.innerText = message;
            container.appendChild(toast);
            requestAnimationFrame(() => toast.classList.add('show'));
            setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, duree);
        }

        function showConfirm(message, { danger = false, texteOk = 'Confirmer', texteAnnuler = 'Annuler' } = {}) {
            return new Promise((resolve) => {
                const previouslyFocused = document.activeElement;
                const overlay = document.createElement('div');
                overlay.className = 'confirm-overlay';
                overlay.setAttribute('role', 'dialog');
                overlay.setAttribute('aria-modal', 'true');
                overlay.setAttribute('aria-label', message);
                overlay.innerHTML = `<div class="confirm-box"><p>${message}</p><div class="confirm-actions"><button class="btn-cancel">${texteAnnuler}</button><button class="btn-ok ${danger ? 'danger' : ''}">${texteOk}</button></div></div>`;
                document.body.appendChild(overlay);
                requestAnimationFrame(() => { overlay.classList.add('show'); overlay.querySelector('.btn-cancel').focus(); });
                const fermer = (result) => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus(); resolve(result); };
                overlay.querySelector('.btn-cancel').onclick = () => fermer(false);
                overlay.querySelector('.btn-ok').onclick = () => fermer(true);
                overlay.onclick = (e) => { if (e.target === overlay) fermer(false); };
            });
        }

        function showPrompt(message, placeholder = '') {
            return new Promise((resolve) => {
                const previouslyFocused = document.activeElement;
                const overlay = document.createElement('div');
                overlay.className = 'confirm-overlay';
                overlay.setAttribute('role', 'dialog');
                overlay.setAttribute('aria-modal', 'true');
                overlay.setAttribute('aria-label', message);
                overlay.innerHTML = `<div class="confirm-box"><p>${message}</p><input type="text" class="prompt-input" placeholder="${placeholder}"><div class="confirm-actions"><button class="btn-cancel">Annuler</button><button class="btn-ok">Valider</button></div></div>`;
                document.body.appendChild(overlay);
                requestAnimationFrame(() => overlay.classList.add('show'));
                const input = overlay.querySelector('.prompt-input');
                input.focus();
                const fermer = (result) => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus(); resolve(result); };
                overlay.querySelector('.btn-cancel').onclick = () => fermer(null);
                overlay.querySelector('.btn-ok').onclick = () => fermer(input.value.trim() || null);
                input.addEventListener('keydown', (e) => { if (e.key === 'Enter') fermer(input.value.trim() || null); });
                overlay.onclick = (e) => { if (e.target === overlay) fermer(null); };
            });
        }

        async function getApiKey(provider = 'gemini') {
            let keyName = provider + '_api_key';
            let key = localStorage.getItem(keyName);
            
            if (!key && clesApiPubliques[provider]) {
                return clesApiPubliques[provider];
            }
            
            if (!key) {
                let nomF = provider === 'mistral' ? 'Mistral AI' : 'Gemini';
                key = await showPrompt(`🔒 Sécurité : Veuillez coller votre clé API ${nomF}.`, "Collez votre clé ici...");
                if (key) localStorage.setItem(keyName, key);
            }
            return key;
        }

        function voirModifierClesAPI() {
            document.getElementById('inputKeyGemini').value = localStorage.getItem('gemini_api_key') || "";
            document.getElementById('inputKeyMistral').value = localStorage.getItem('mistral_api_key') || "";
            document.getElementById('modalApiKeys').style.display = 'flex';
        }

        function sauvegarderCleAPI(provider) {
            const inputId = provider === 'mistral' ? 'inputKeyMistral' : 'inputKeyGemini';
            const nomF = provider === 'mistral' ? 'Mistral AI' : 'Gemini';
            const val = document.getElementById(inputId).value.trim();
            const keyName = provider + '_api_key';
            if (val) {
                localStorage.setItem(keyName, val);
                showToast(`Clé ${nomF} enregistrée ✅`, "success");
            } else {
                localStorage.removeItem(keyName);
                showToast(`Clé ${nomF} effacée`, "info");
            }
        }

        function reinitialiserClesAPI() {
            localStorage.removeItem('gemini_api_key');
            localStorage.removeItem('mistral_api_key');
            showToast("Toutes les clés API ont été effacées !", "success");
        }

        const CACHE_PREFIX = "chef_ia_cache_";
        const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

        function setCache(key, data) {
            const cacheItem = { timestamp: new Date().getTime(), data: data };
            try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(cacheItem)); } catch (e) { console.warn("Cache local plein"); }
        }

        function getCache(key) {
            const cachedStr = localStorage.getItem(CACHE_PREFIX + key);
            if (!cachedStr) return null;
            try {
                const cacheItem = JSON.parse(cachedStr);
                if (new Date().getTime() - cacheItem.timestamp > CACHE_DURATION_MS) {
                    localStorage.removeItem(CACHE_PREFIX + key); return null;
                }
                return cacheItem.data;
            } catch (e) { return null; }
        }

        function viderCacheApp() {
            Object.keys(localStorage).forEach(key => { if (key.startsWith(CACHE_PREFIX)) localStorage.removeItem(key); });
            showToast("Cache nettoyé avec succès !", "success");
        }

        async function verifierMiseAJour() {
            if (!('serviceWorker' in navigator)) {
                showToast("Mises à jour non disponibles sur ce navigateur", "error");
                return;
            }

            const btn = document.getElementById('btnVerifierMaj');
            const texteOriginal = btn ? btn.innerText : null;
            if (btn) { btn.disabled = true; btn.innerText = "🔄 Vérification en cours…"; }
            showToast("Vérification de la dernière version…", "info");

            try {
                const registration = await navigator.serviceWorker.getRegistration();
                if (!registration) {
                    showToast("Aucune version hors-ligne installée à mettre à jour", "info");
                    if (btn) { btn.disabled = false; btn.innerText = texteOriginal; }
                    return;
                }

                let miseAJourTrouvee = false;
                const onUpdateFound = () => { miseAJourTrouvee = true; };
                registration.addEventListener('updatefound', onUpdateFound);

                await registration.update();

                // Laisse le temps au navigateur de télécharger/installer une éventuelle nouvelle version.
                // Si une mise à jour est trouvée, la page se recharge automatiquement (voir le listener
                // 'controllerchange' déjà en place plus bas) — sinon on prévient que tout est déjà à jour.
                setTimeout(() => {
                    registration.removeEventListener('updatefound', onUpdateFound);
                    if (btn) { btn.disabled = false; btn.innerText = texteOriginal; }
                    if (!miseAJourTrouvee) {
                        showToast("Vous êtes déjà sur la dernière version ✅", "success");
                    }
                }, 3000);
            } catch (e) {
                console.error("Erreur vérification mise à jour :", e);
                showToast("Impossible de vérifier les mises à jour", "error");
                if (btn) { btn.disabled = false; btn.innerText = texteOriginal; }
            }
        }

        function sauvegarderAllergenes() {
            memoireAllergenes = Array.from(document.querySelectorAll('.chk-allergene:checked')).map(cb => cb.value);
            syncCloud('allergenes', memoireAllergenes);
        }

        function chargerAllergenesUI() {
            const container = document.getElementById('customAllergene').parentElement.parentElement.previousElementSibling;
            const existingValues = Array.from(document.querySelectorAll('.chk-allergene')).map(cb => cb.value);
            document.querySelectorAll('.chk-allergene').forEach(cb => cb.checked = false);
            memoireAllergenes.forEach(val => {
                if (existingValues.includes(val)) {
                    const cb = document.querySelector(`.chk-allergene[value="${val}"]`);
                    if (cb) cb.checked = true;
                } else {
                    const newLabel = document.createElement('label');
                    newLabel.className = 'ingredient-item';
                    newLabel.style.cssText = "display: flex; align-items: center; gap: 10px;";
                    newLabel.innerHTML = `<input type="checkbox" class="chk-allergene" value="${val}" checked onchange="sauvegarderAllergenes()"><span style="display: block; width: 100%;">⚠️ ${val}</span>`;
                    container.appendChild(newLabel);
                }
            });
        }

        function ajouterAllergenCustom() {
            const input = document.getElementById('customAllergene');
            const val = input.value.trim();
            if(!val) return;
            const container = input.parentElement.parentElement.previousElementSibling;
            const newLabel = document.createElement('label');
            newLabel.className = 'ingredient-item';
            newLabel.style.cssText = "display: flex; align-items: center; gap: 10px;";
            newLabel.innerHTML = `<input type="checkbox" class="chk-allergene" value="${val}" checked onchange="sauvegarderAllergenes()"><span style="display: block; width: 100%;">⚠️ ${val}</span>`;
            container.appendChild(newLabel);
            input.value = "";
            sauvegarderAllergenes();
        }

        function getAllergenesPrompt() {
            if (memoireAllergenes.length === 0) return "";
            return `\nATTENTION - RESTRICTIONS STRICTES / ALLERGÈNES : Tu dois ABSOLUMENT EXCLURE ces ingrédients ou leurs dérivés : ${memoireAllergenes.join(", ")}.`;
        }

        function sauvegarderRegimes() {
            memoireRegimes = Array.from(document.querySelectorAll('.chk-regime:checked')).map(cb => cb.value);
            syncCloud('regimes', memoireRegimes);
            showToast("Préférences alimentaires mises à jour 🥦", "success");
        }

        function chargerRegimesUI() {
            document.querySelectorAll('.chk-regime').forEach(cb => {
                cb.checked = memoireRegimes.includes(cb.value);
            });
        }

        function getRegimesPrompt() {
            if (memoireRegimes.length === 0) return "";
            return `\nPRÉFÉRENCE ALIMENTAIRE PERMANENTE DE L'UTILISATEUR (à respecter dans toutes les recettes) : ${memoireRegimes.join(", ")}.`;
        }

        function sauvegarderEquipements() {
            memoireEquipements = Array.from(document.querySelectorAll('.chk-equipement:checked')).map(cb => cb.value);
            const autreEquipement = document.getElementById('inputAutreEquipement').value.trim();
            if(autreEquipement) {
                const autres = autreEquipement.split(',').map(e => e.trim()).filter(e => e);
                memoireEquipements = memoireEquipements.concat(autres);
            }
            syncCloud('equipements', memoireEquipements);
            showToast("Équipements mis à jour 🍳", "success");
        }

        function chargerEquipementsUI() {
            document.querySelectorAll('.chk-equipement').forEach(cb => {
                cb.checked = memoireEquipements.includes(cb.value);
            });
            const standardEquipements = Array.from(document.querySelectorAll('.chk-equipement')).map(cb => cb.value);
            const autres = memoireEquipements.filter(e => !standardEquipements.includes(e));
            const inputAutre = document.getElementById('inputAutreEquipement');
            if (inputAutre) inputAutre.value = autres.join(', ');
        }

        function sauvegarderPrefsCuisine() {
            const selHumeur = document.getElementById('paramHumeurDefaut');
            const selTemps = document.getElementById('paramTempsDefaut');
            const inputPersonnes = document.getElementById('paramPersonnesDefaut');
            if (!selHumeur || !selTemps || !inputPersonnes) return;

            let personnes = parseInt(inputPersonnes.value, 10);
            if (!personnes || personnes < 1) personnes = 1;
            inputPersonnes.value = personnes;

            prefsCuisineDefaut = { humeur: selHumeur.value, temps: selTemps.value, personnes: personnes };
            syncCloud('prefsCuisine', prefsCuisineDefaut);
            showToast("Préférences de recettes mises à jour 🍽️", "success");
        }

        function chargerPrefsCuisineUI() {
            const selHumeur = document.getElementById('paramHumeurDefaut');
            const selTemps = document.getElementById('paramTempsDefaut');
            const inputPersonnes = document.getElementById('paramPersonnesDefaut');
            if (selHumeur) selHumeur.value = prefsCuisineDefaut.humeur;
            if (selTemps) selTemps.value = prefsCuisineDefaut.temps;
            if (inputPersonnes) inputPersonnes.value = prefsCuisineDefaut.personnes;
        }

        function getEquipementsPrompt() {
            if (memoireEquipements.length === 0) return "";
            return `\nMATÉRIEL ET ÉQUIPEMENT DISPONIBLE : ${memoireEquipements.join(", ")}. Tu DOIS proposer en priorité des recettes qui utilisent ce matériel (par exemple, si Cookeo est listé, propose des plats au Cookeo), mais tu peux occasionnellement proposer des plats avec du matériel standard (poêle, casserole).`;
        }

        async function loadPrices() {
            try {
                const response = await fetch('./prix_ingredients.json');
                if (response.ok) {
                    ingredientPrices = await response.json();
                    console.log(`✅ ${Object.keys(ingredientPrices).length} prix Leclerc chargés`);
                } else {
                    console.warn('⚠️ Fichier prix_ingredients.json non trouvé');
                }
            } catch (e) {
                console.warn('⚠️ Erreur lors du chargement des prix:', e.message);
            }
        }

        /**
         * Retourne les données de prix pour un ingrédient donné.
         * Recherche dans l'ordre :
         *   1. Correspondance exacte (insensible à la casse)
         *   2. La clé du JSON est contenue dans le nom de l'ingrédient
         *   3. Le nom de l'ingrédient est contenu dans la clé du JSON
         * Gère à la fois l'ancien format (valeur = nombre) et le nouveau (valeur = objet avec .prix)
         * @param {string} nom - Nom de l'ingrédient tel qu'il apparaît dans l'app
         * @returns {{ prix: number, prix_min: number, prix_max: number, produit_ref: string }|null}
         */
        function getPrixIngredient(nom) {
            if (!nom || Object.keys(ingredientPrices).length === 0) return null;
            const nomLower = nom.toLowerCase().trim();

            // 1. Correspondance exacte (insensible à la casse)
            for (const [cle, val] of Object.entries(ingredientPrices)) {
                if (cle.toLowerCase() === nomLower) {
                    return typeof val === 'object' ? val : { prix: val, prix_min: val, prix_max: val, produit_ref: cle };
                }
            }
            // 2. La clé du JSON est contenue dans le nom de l'ingrédient
            for (const [cle, val] of Object.entries(ingredientPrices)) {
                if (nomLower.includes(cle.toLowerCase())) {
                    return typeof val === 'object' ? val : { prix: val, prix_min: val, prix_max: val, produit_ref: cle };
                }
            }
            // 3. Le nom de l'ingrédient est contenu dans la clé du JSON
            for (const [cle, val] of Object.entries(ingredientPrices)) {
                if (cle.toLowerCase().includes(nomLower)) {
                    return typeof val === 'object' ? val : { prix: val, prix_min: val, prix_max: val, produit_ref: cle };
                }
            }
            return null;
        }


        window.ouvrirOnboarding = function() {
            document.getElementById('modalOnboarding').style.display = 'flex';
        }

        window.fermerOnboarding = function() {
            document.getElementById('modalOnboarding').style.display = 'none';
            localStorage.setItem('onboardingShown', 'true');
        }

        // --- NOUVEAUTÉS (dernières mises à jour de l'application) ---
        // Pour ajouter une nouvelle entrée : l'insérer en tête de tableau avec un
        // "version" unique (ex. date du jour). C'est ce qui déclenche le badge
        // "nouveau" tant que l'utilisateur n'a pas ouvert la fenêtre au moins une fois.
        const NOUVEAUTES = [
            {
                version: "2026-09-01",
                titre: "1er septembre 2026",
                items: [
                    "🆕 Nouveau bouton \"Nouveautés\" sur l'accueil : retrouvez ici l'historique des dernières améliorations de l'application."
                ]
            },
            {
                version: "2026-08-31-c",
                titre: "31 août 2026",
                items: [
                    "🛒 Liste de courses : possibilité d'annuler la suppression d'un article, bouton de dictée vocale, prix affichés plus clairement comme indicatifs.",
                    "♿ Accessibilité : navigation au clavier, contrastes et lecture d'écran améliorés sur toute l'application."
                ]
            },
            {
                version: "2026-08-31-b",
                titre: "31 août 2026",
                items: [
                    "⏱️ Minuteurs de cuisine fiabilisés : ne dérivent plus quand l'écran est en veille, survivent à un rechargement de la page, bouton \"+1 min\", relance en un clic, et annulation possible après suppression d'un minuteur actif.",
                    "📳 Vibration et alerte répétée tant qu'un minuteur terminé n'est pas fermé ou relancé.",
                    "📱 L'écran ne s'éteint plus tant qu'un minuteur tourne, et le nombre de minuteurs actifs s'affiche sur l'icône de l'application (PWA installée)."
                ]
            },
            {
                version: "2026-08-31-a",
                titre: "31 août 2026",
                items: [
                    "⚙️ Nouvel onglet \"Recettes\" dans Paramètres : définissez une bonne fois pour toutes votre humeur/style, temps disponible et nombre de personnes par défaut pour la fenêtre \"En cuisine !\".",
                    "✨ Mises à jour de l'application plus discrètes : une petite bannière propose d'actualiser dès qu'une nouvelle version est disponible, sans jamais recharger la page de force."
                ]
            }
        ];

        window.ouvrirNouveautes = function() {
            const cont = document.getElementById('nouveautesContent');
            if (cont) {
                cont.innerHTML = NOUVEAUTES.map(entree => `
                    <div style="margin-bottom: 20px;">
                        <div style="font-weight: bold; color: var(--primary); margin-bottom: 8px;">${entree.titre}</div>
                        <ul style="padding-left: 20px; margin: 0;">
                            ${entree.items.map(i => `<li style="margin-bottom: 8px;">${i}</li>`).join('')}
                        </ul>
                    </div>
                `).join('');
            }
            document.getElementById('modalNouveautes').style.display = 'flex';
            localStorage.setItem('nouveautesVues', NOUVEAUTES[0].version);
            const badge = document.getElementById('badgeNouveautes');
            if (badge) badge.style.display = 'none';
        }

        window.fermerNouveautes = function() {
            document.getElementById('modalNouveautes').style.display = 'none';
        }

        function verifierBadgeNouveautes() {
            const badge = document.getElementById('badgeNouveautes');
            if (!badge) return;
            const derniereVue = localStorage.getItem('nouveautesVues');
            badge.style.display = (derniereVue !== NOUVEAUTES[0].version) ? 'block' : 'none';
        }

        async function chargerInterfaceBase() {
            verifierBadgeNouveautes();
            await loadPrices();
            try {
                const user = firebase.auth().currentUser;
                if(user) {
                    const userDoc = await userDb.get();
                    if(userDoc.exists) {
                        memoireIngredients = userDoc.data().ingredients || [];
                        memoireAllergenes = userDoc.data().allergenes || [];
                        memoireRegimes = userDoc.data().regimes || [];
                        memoireEquipements = userDoc.data().equipements || [];
                        moteurIAActif = userDoc.data().moteurIA || "mistral";
                        const prefsCuisineSauvegardees = userDoc.data().prefsCuisine;
                        if (prefsCuisineSauvegardees) {
                            prefsCuisineDefaut = Object.assign({}, prefsCuisineDefaut, prefsCuisineSauvegardees);
                        }
                        
                        const selectGlobal = document.getElementById('selecteurIaGlobal');
                        if(selectGlobal) selectGlobal.value = moteurIAActif;
                    }
                }
                
                let docRef = db.collection("config").doc("ingredients");
                let docSnap = await docRef.get();
                if (docSnap.exists) { globalIngredientsList = docSnap.data(); }
                
                let apiKeysRef = db.collection("config").doc("api_keys");
                let apiKeysSnap = await apiKeysRef.get();
                if (apiKeysSnap.exists) { 
                    const data = apiKeysSnap.data();
                    clesApiPubliques.gemini = data.gemini || null;
                    clesApiPubliques.mistral = data.mistral || null;
                }
                
                afficherIngredientsGauche();
                chargerAllergenesUI();
                chargerRegimesUI();
                chargerEquipementsUI();
                chargerPrefsCuisineUI();

                document.getElementById('categoriesContainer').addEventListener('change', (e) => {
                    if (!e.target.classList.contains('chk-ingredient')) return;
                    memoireIngredients = Array.from(document.querySelectorAll('.chk-ingredient:checked')).map(c => c.value);
                    syncCloud('ingredients', memoireIngredients);
                    updateButtonLabel();
                });
            } catch (e) { 
                console.error("Détail de l'erreur :", e);
                document.getElementById('categoriesContainer').innerHTML = `<span style='color:red;'>Erreur : ${e.message}</span>`; 
            }
        }

        
        window.updateButtonLabel = function() {
            const oldBtn = document.getElementById('btnGenererRecettes');
            if(oldBtn) {
                const n = memoireIngredients.length;
                oldBtn.innerText = n > 0 ? `✨ Inventer mes recettes (${n})` : "✨ Inventer mes recettes";
            }
        };

        const iconesIngredients = {
            "Tomate": "🍅", "Carotte": "🥕", "Courgette": "🥒", "Aubergine": "🍆", "Oignon": "🧅", "Ail": "🧄",
            "Oeufs": "🥚", "Poulet": "🍗", "Boeuf haché": "🥩", "Pâtes": "🍝", "Riz blanc": "🍚", "Pomme de terre": "🥔",
            "Sauce tomate": "🥫", "Sauce soja": "🍾", "Moutarde": "🟡", "Fromage": "🧀", "Lait": "🥛"
        };

                window.filtrerIngredients = function(terme) {
            try {
                const resDiv = document.getElementById('autocompleteResults');
                const originalTerm = terme.trim();
                terme = originalTerm.toLowerCase();
                if(!terme) { resDiv.style.display = 'none'; return; }
                let matches = [];
                let exactMatchFound = false;
                for(const cat in globalIngredientsList) {
                    if (Array.isArray(globalIngredientsList[cat])) {
                        globalIngredientsList[cat].forEach(ing => {
                            if(typeof ing === 'string') {
                                if(ing.toLowerCase() === terme) exactMatchFound = true;
                                if(ing.toLowerCase().includes(terme)) matches.push({ nom: ing, cat: cat });
                            }
                        });
                    }
                }
                
                let html = "";
                matches.forEach(m => {
                    const icone = iconesIngredients[m.nom] || "🍽️";
                    let safeNom = m.nom.replace(/'/g, "\\\'");
                    html += `<div class="autocomplete-item" onclick="selectionnerIngredientAutocomplete('${safeNom}')">${icone} <b>${m.nom}</b> <span style="font-size:10px; color:var(--text-muted);">(${m.cat})</span></div>`;
                });

                if(!exactMatchFound && originalTerm.length > 1) {
                    let safeTerm = originalTerm.replace(/'/g, "\\\'");
                    html += `<div class="autocomplete-item" style="color:var(--primary); font-weight:bold; justify-content:center;" onclick="ajouterIngredientPersonnalise('${safeTerm}')">➕ Ajouter "${originalTerm}" à mon frigo</div>`;
                }

                if(html === "") {
                    resDiv.style.display = 'none';
                } else {
                    resDiv.innerHTML = html;
                    resDiv.style.display = 'block';
                }
            } catch(e) {
                console.error("Erreur filtrerIngredients:", e);
            }
        };;

        
        window.supprimerIngredientPersonnalise = async function(event, nom) {
            event.stopPropagation();
            if(!globalIngredientsList['Mes Ajouts']) return;
            
            globalIngredientsList['Mes Ajouts'] = globalIngredientsList['Mes Ajouts'].filter(i => i !== nom);
            
            if(memoireIngredients.includes(nom)) {
                memoireIngredients = memoireIngredients.filter(i => i !== nom);
                syncCloud('ingredients', memoireIngredients);
                updateButtonLabel();
            }
            
            try {
                const docRef = userDb.collection("userData").doc("customIngredients");
                await docRef.update({
                    items: firebase.firestore.FieldValue.arrayRemove(nom)
                });
            } catch(e) { console.error("Erreur suppression:", e); }
            
            afficherIngredientsGauche();
            showToast(`"${nom}" supprimé`, "success");
        };

        window.ajouterIngredientPersonnalise = async function(nom) {
            nom = nom.charAt(0).toUpperCase() + nom.slice(1);
            if(!globalIngredientsList['Mes Ajouts']) globalIngredientsList['Mes Ajouts'] = [];
            if(!globalIngredientsList['Mes Ajouts'].includes(nom)) {
                globalIngredientsList['Mes Ajouts'].push(nom);
                
                try {
                    const docRef = userDb.collection("userData").doc("customIngredients");
                    await docRef.set({
                        items: firebase.firestore.FieldValue.arrayUnion(nom)
                    }, { merge: true });
                } catch(e) { console.error("Erreur save custom:", e); }
            }
            
            if(!memoireIngredients.includes(nom)) memoireIngredients.push(nom);
            syncCloud('ingredients', memoireIngredients);
            updateButtonLabel();
            afficherIngredientsGauche();
            
            document.getElementById('ingredientSearch').value = '';
            document.getElementById('autocompleteResults').style.display = 'none';
            showToast(nom + " ajouté au frigo !", "success");
        };

        window.selectionnerIngredientAutocomplete = function(nom) {
            if (!memoireIngredients.includes(nom)) {
                memoireIngredients.push(nom);
                syncCloud('ingredients', memoireIngredients);
                updateButtonLabel();
            }
            afficherIngredientsGauche(nom);
            document.getElementById('ingredientSearch').value = "";
            document.getElementById('autocompleteResults').style.display = 'none';
        };

        window.decocherTout = function() {
            memoireIngredients = [];
            syncCloud('ingredients', memoireIngredients);
            updateButtonLabel();
            afficherIngredientsGauche();
        };


                function afficherIngredientsGauche(highlightName) {
            const container = document.getElementById('categoriesContainer');
            if(!container) return;
            // On mémorise les états ouverts
            const openStates = {};
            container.querySelectorAll('details').forEach(d => {
                const title = d.querySelector('summary').innerText.split(' ')[0];
                openStates[title] = d.open;
            });

            container.innerHTML = "";
            const sortedCats = Object.keys(globalIngredientsList).sort();

            for (const cat of sortedCats) {
                let items = globalIngredientsList[cat];
                if (!items || items.length === 0) continue;
                items.sort();
                
                const nbCochesCat = items.filter(i => memoireIngredients.includes(i)).length;
                const badgeCompteur = nbCochesCat > 0 ? `<span style="background:var(--primary); color:white; font-size:10px; padding:3px 7px; border-radius:12px; margin-left:8px; vertical-align: middle;">${nbCochesCat}</span>` : '';

                const details = document.createElement('details');
                details.className = 'category-details';
                if(openStates[cat] || nbCochesCat > 0) details.open = true;

                const summary = document.createElement('summary');
                summary.className = 'category-summary';
                summary.innerHTML = `
                    <span>${cat}</span>
                    <div class="category-meta">
                        <span class="category-count">${nbCochesCat}/${items.length}</span>
                        ${badgeCompteur}
                    </div>
                `;
                details.appendChild(summary);

                const contentDiv = document.createElement('div');
                contentDiv.className = 'category-content ingredient-tags';

                items.forEach(ing => {
                    const isChecked = memoireIngredients.includes(ing);
                    const icone = iconesIngredients[ing] || "🍽️";
                    const tag = document.createElement('div');
                    tag.className = 'ingredient-tag' + (isChecked ? ' active' : '');
                    tag.dataset.ingredientName = ing;
                    
                    const priceData = getPrixIngredient(ing);
                    const priceHtml = priceData
                        ? ` <span style="font-size:11px; opacity:0.7; margin-left:6px;" title="Réf: ${(priceData.produit_ref||'').substring(0,50)} (Leclerc)">${priceData.prix.toFixed(2)}€</span>`
                        : '';
                    
                    if (cat === 'Mes Ajouts') {
                        let safeIng = ing.replace(/'/g, "\\\'");
                        tag.innerHTML = `${icone} ${ing} ${priceHtml}<span class="delete-tag-btn" onclick="supprimerIngredientPersonnalise(event, '${safeIng}')">✖</span>`;
                    } else {
                        tag.innerHTML = `${icone} ${ing}${priceHtml}`;
                    }

                    tag.onclick = function() {
                        toggleIngredient(ing, this);
                    };
                    contentDiv.appendChild(tag);
                });

                details.appendChild(contentDiv);
                container.appendChild(details);
            }

            if (highlightName) {
                const cible = container.querySelector(`[data-ingredient-name="${CSS.escape(highlightName)}"]`);
                if (cible) {
                    cible.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    cible.classList.add('just-selected');
                    setTimeout(() => cible.classList.remove('just-selected'), 1600);
                }
            }
        }

        window.toggleIngredient = function(nom, element) {
            const index = memoireIngredients.indexOf(nom);
            if (index > -1) {
                memoireIngredients.splice(index, 1);
            } else {
                memoireIngredients.push(nom);
            }
            syncCloud('ingredients', memoireIngredients);
            updateButtonLabel();
            afficherIngredientsGauche();
        };

        function ouvrirParametres() { 
             
            chargerListeManageIng(); 
            if (isAdminUser) chargerDemandesAcces();
        }
        
        function fermerParametres() { document.getElementById('modalParametres').style.display = 'none'; }
        
        function switchTab(tab) {
            const tabs = ['tabIng', 'tabCarnet', 'tabTheme', 'tabAllergene', 'tabEquipement', 'tabPrefs', 'tabOptions', 'tabAdmin'];
            tabs.forEach(t => {
                const btn = document.getElementById(t + 'Btn'); const content = document.getElementById(t);
                if(btn) { btn.classList.remove('active'); btn.setAttribute('aria-selected', 'false'); } if(content) content.style.display = 'none';
            });
            const activeBtn = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1) + 'Btn');
            const activeContent = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
            if(activeBtn) { activeBtn.classList.add('active'); activeBtn.setAttribute('aria-selected', 'true'); } if(activeContent) activeContent.style.display = 'block';
            
            if(tab === 'ing') chargerListeManageIng(); 
            if(tab === 'carnet') chargerListeManageCarnet(); 
            if(tab === 'allergene') { chargerAllergenesUI(); chargerRegimesUI(); }
            if(tab === 'prefs') chargerPrefsCuisineUI();
            if(tab === 'admin' && isAdminUser) chargerDemandesAcces();
        }

        async function chargerDemandesAcces() {
            const container = document.getElementById('listeDemandesAcces');
            container.innerHTML = "<p style='text-align:center;'>Chargement...</p>";
            try {
                const snapshot = await db.collection("utilisateurs").where("statut", "==", "en_attente").get();
                if (snapshot.empty) return container.innerHTML = "<p style='text-align:center; padding:20px; color:var(--text-muted);'>Aucune demande en attente.</p>";
                
                let html = "";
                snapshot.forEach(doc => {
                    let u = doc.data();
                    html += `<div class="list-item-manage">
                                <div><b>${u.email}</b><br><span style="font-size:11px; color:var(--text-muted);">${u.nom || 'Sans nom'}</span></div>
                                <div style="display:flex; gap:5px;">
                                    <button class="btn-primary" style="margin-top:0; padding:6px 12px; font-size:12px; background:#27ae60;" onclick="validerCompte('${doc.id}', true)">✅ Valider</button>
                                    <button class="btn-danger" style="padding:6px 12px; font-size:12px;" onclick="validerCompte('${doc.id}', false)">❌ Refuser</button>
                                </div>
                             </div>`;
                });
                container.innerHTML = html;
            } catch(e) { container.innerHTML = "<p style='color:red;'>Erreur de chargement.</p>"; }
        }

        async function validerCompte(userId, accepter) {
            if (accepter) {
                await db.collection("utilisateurs").doc(userId).update({ statut: "valide" });
                showToast("Compte validé avec succès !", "success");
            } else {
                await db.collection("utilisateurs").doc(userId).delete();
                showToast("Demande refusée et supprimée.", "info");
            }
            chargerDemandesAcces();
        }

        async function ajouterIngredientDB() {
            const cat = document.getElementById('paramCat').value; const ing = document.getElementById('paramNewIng').value.trim();
            if(!ing) return showToast("Merci de saisir un ingrédient.", "error");
            try {
                await db.collection("config").doc("ingredients").update({ [cat]: firebase.firestore.FieldValue.arrayUnion(ing) });
                if(!globalIngredientsList[cat]) globalIngredientsList[cat] = [];
                if(!globalIngredientsList[cat].includes(ing)) globalIngredientsList[cat].push(ing);
                document.getElementById('paramNewIng').value = ""; chargerListeManageIng(); afficherIngredientsGauche();
                showToast(`"${ing}" ajouté !`, "success");
            } catch(e) { showToast("Erreur lors de l'ajout.", "error"); }
        }

        async function supprimerIngredientDB(cat, ing) {
            const ok = await showConfirm(`Supprimer "${ing}" ?`, { danger: true, texteOk: 'Supprimer' });
            if(!ok) return;
            try {
                await db.collection("config").doc("ingredients").update({ [cat]: firebase.firestore.FieldValue.arrayRemove(ing) });
                globalIngredientsList[cat] = globalIngredientsList[cat].filter(i => i !== ing);
                chargerListeManageIng(); afficherIngredientsGauche();
                memoireIngredients = memoireIngredients.filter(i => i !== ing); syncCloud('ingredients', memoireIngredients);
                showToast(`"${ing}" supprimé.`, "success");
            } catch(e) { showToast("Erreur lors de la suppression.", "error"); }
        }

        function chargerListeManageIng() {
            const listDiv = document.getElementById('listManageIng'); let html = ""; const sortedCats = Object.keys(globalIngredientsList).sort();
            for(const cat of sortedCats) {
                let items = globalIngredientsList[cat] || []; items.sort();
                items.forEach(ing => {
                    let safeIng = ing.replace(/'/g, "\\'"); let safeCat = cat.replace(/'/g, "\\'");
                    html += `<div class="list-item-manage"><div><span class="badge-cat">${cat}</span> ${ing}</div><button class="btn-danger" onclick="supprimerIngredientDB('${safeCat}', '${safeIng}')">🗑️</button></div>`;
                });
            }
            listDiv.innerHTML = html || "<p style='text-align:center;'>Aucun ingrédient.</p>";
        }

        async function chargerListeManageCarnet() {
            const listDiv = document.getElementById('listManageCarnet'); listDiv.innerHTML = "<p style='text-align:center;'>Chargement...</p>";
            try {
                const snapshot = await userDb.collection("carnet").orderBy("date", "desc").get();
                if (snapshot.empty) return listDiv.innerHTML = "<p style='text-align:center;'>Carnet vide.</p>";
                let html = "";
                snapshot.forEach(doc => {
                    const item = doc.data(); let titre = item.recette.split('\n')[0].substring(0, 40) + "..."; let dateStr = item.date ? item.date.toDate().toLocaleDateString() : "";
                    html += `<div class="list-item-manage"><div style="font-size: 13px; font-weight: 500;"><div style="color:var(--primary); font-size:11px;">${dateStr}</div>${titre}</div><button class="btn-danger" onclick="supprimerRecetteCarnetDB('${doc.id}')">🗑️</button></div>`;
                });
                listDiv.innerHTML = html;
            } catch(e) {}
        }
        async function supprimerRecetteCarnetDB(docId) {
            const ok = await showConfirm("Supprimer cette recette du carnet ?", { danger: true, texteOk: 'Supprimer' });
            if(!ok) return;
            try { await userDb.collection("carnet").doc(docId).delete(); chargerListeManageCarnet(); showToast("Recette supprimée.", "success"); } catch(e) { showToast("Erreur lors de la suppression.", "error"); }
        }

        let recognition;
                function toggleVocal() {
            if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return showToast("La dictée vocale n'est pas supportée par votre navigateur.", "error");
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition; recognition = new SpeechRecognition(); recognition.lang = 'fr-FR';
            const btn = document.getElementById('btnMic'); btn.classList.add('listening'); btn.innerText = "🎙️ Écoute...";
            recognition.onresult = function(event) {
                const texte = event.results[0][0].transcript.toLowerCase();
                btn.classList.remove('listening'); btn.innerText = "🎙️ Dicter";
                let count = 0;
                for(let cat in globalIngredientsList) {
                    globalIngredientsList[cat].forEach(ing => {
                        if(texte.includes(ing.toLowerCase())) {
                            if(!memoireIngredients.includes(ing)) {
                                memoireIngredients.push(ing);
                                count++;
                            }
                        }
                    });
                }
                syncCloud('ingredients', memoireIngredients); updateButtonLabel(); afficherIngredientsGauche();
                if(count > 0) showToast(count + " ingrédient(s) ajouté(s)", "success");
            };
            recognition.onerror = function(event) { btn.classList.remove('listening'); btn.innerText = "🎙️ Dicter"; let msg; if (event.error === 'not-allowed' || event.error === 'permission-denied') { msg = "Micro refusé : autorisez l'accès au micro dans les paramètres du navigateur."; } else if (event.error === 'no-speech') { msg = "Aucune parole détectée, réessayez."; } else { msg = "Erreur de dictée vocale : " + event.error; } showToast(msg, 'error'); };
            recognition.start();
        }

        async function ajouterCourse(btn, ingredient) {
            const ingredientNom = formatCourseName(ingredient || '');
            if (!ingredientNom) return;

            try {
                const snapshot = await userDb.collection("courses").get();
                const dejaPresent = snapshot.docs.some(doc => normalizeCourseValue(doc.data().ingredient) === normalizeCourseValue(ingredientNom));
                if (dejaPresent) {
                    if (btn) {
                        btn.innerText = "✓ Déjà";
                        btn.disabled = true;
                        btn.style.background = "#636e72";
                    }
                    showToast(`"${ingredientNom}" est déjà dans la liste de courses.`, "info");
                    return;
                }

                if (btn) { btn.innerText = "⏳"; btn.disabled = true; }
                await userDb.collection("courses").add({
                    ingredient: ingredientNom,
                    checked: false,
                    date: firebase.firestore.FieldValue.serverTimestamp(),
                    order: Date.now()
                });

                if (btn) { btn.innerText = "✅"; btn.style.background = "#27ae60"; }
                showToast(`"${ingredientNom}" ajouté à la liste de courses ✅`, "success");
                const navBtn = document.getElementById('btnNavCourses');
                if (navBtn) {
                    navBtn.classList.remove('animate-cart'); void navBtn.offsetWidth; navBtn.classList.add('animate-cart');
                }
            } catch (e) {
                if (btn) {
                    btn.innerText = "❌";
                    btn.disabled = false;
                }
                showToast("Erreur lors de l’ajout à la liste.", "error");
            }
        }

        window.ajouterTousIngredientsManquants = async function(container) {
            if (!container) return;
            const boutons = Array.from(container.querySelectorAll('.missing-add-btn'));
            const items = boutons
                .map(btn => btn.dataset.ingredient)
                .filter(Boolean)
                .filter((item, index, arr) => arr.findIndex(existing => normalizeCourseValue(existing) === normalizeCourseValue(item)) === index);

            if (!items.length) return;

            for (const item of items) {
                const btn = container.querySelector(`.missing-add-btn[data-ingredient="${item.replace(/"/g, '\\"')}"]`);
                if (btn && !btn.disabled) {
                    await ajouterCourse(btn, item);
                }
            }
        };

        window.ajouterCourseManuelle = async function() {
            fermerCourseAutocomplete();
            const input = document.getElementById('courseInput');
            if(!input) return;
            const texte = input.value.trim();
            if(!texte) return;

            try {
                const snapshot = await userDb.collection("courses").get();
                const dejaPresent = snapshot.docs.some(doc => normalizeCourseValue(doc.data().ingredient) === normalizeCourseValue(texte));
                if (dejaPresent) {
                    showToast(`"${texte}" est déjà dans la liste de courses.`, "info");
                    input.value = '';
                    return;
                }

                const items = document.querySelectorAll('.course-item');
                let maxOrder = 0;
                items.forEach(el => {
                    const order = parseInt(el.dataset.order || '0');
                    if(order > maxOrder) maxOrder = order;
                });

                await userDb.collection("courses").add({
                    ingredient: formatCourseName(texte),
                    date: firebase.firestore.FieldValue.serverTimestamp(),
                    checked: false,
                    order: maxOrder + 1
                });
                input.value = '';
                showToast(`"${formatCourseName(texte)}" ajouté à la liste ✅`, "success");
            } catch (e) {
                showToast("Erreur lors de l’ajout manuel.", "error");
            }
        };

        // ── Autocomplétion liste de courses ─────────────────────────────────
        let courseAutocompleteIndex = -1;

        window.filtrerCourseAutocomplete = function(terme) {
            const resDiv = document.getElementById('courseAutocompleteResults');
            if (!resDiv) return;
            terme = terme.trim();
            if (!terme) { fermerCourseAutocomplete(); return; }
            const termeLower = terme.toLowerCase();
            const matches = new Map();
            for (const cat in globalIngredientsList) {
                if (Array.isArray(globalIngredientsList[cat])) {
                    globalIngredientsList[cat].forEach(ing => {
                        if (typeof ing === 'string' && ing.toLowerCase().includes(termeLower))
                            if (!matches.has(ing)) matches.set(ing, getPrixIngredient(ing));
                    });
                }
            }
            for (const cle of Object.keys(ingredientPrices)) {
                if (cle.toLowerCase().includes(termeLower) && !matches.has(cle))
                    matches.set(cle, getPrixIngredient(cle));
            }
            if (matches.size === 0) { fermerCourseAutocomplete(); return; }
            courseAutocompleteIndex = -1;
            let html = ''; let i = 0;
            for (const [nom, prix] of matches) {
                if (i >= 8) break;
                const prixHtml = prix ? ` <span style="font-size:11px;opacity:0.6;margin-left:4px;">${prix.prix.toFixed(2)}€</span>` : '';
                const icone = iconesIngredients[nom] || '🛒';
                html += `<div class="autocomplete-item" onmousedown="selectionnerCourseAutocomplete('${nom.replace(/'/g, "\\'")}')">${icone} <span style="font-weight:500;">${nom}</span>${prixHtml}</div>`;
                i++;
            }
            resDiv.innerHTML = html;
            resDiv.style.display = 'block';
        };

        window.navigerCourseAutocomplete = function(e) {
            const resDiv = document.getElementById('courseAutocompleteResults');
            const input = document.getElementById('courseInput');
            const dropdownOuvert = resDiv && resDiv.style.display !== 'none';
            const its = dropdownOuvert ? resDiv.querySelectorAll('.autocomplete-item') : [];

            if (e.key === 'Enter') {
                e.preventDefault();
                if (dropdownOuvert && courseAutocompleteIndex >= 0 && its[courseAutocompleteIndex]) {
                    its[courseAutocompleteIndex].dispatchEvent(new MouseEvent('mousedown'));
                } else {
                    ajouterCourseManuelle();
                }
                return;
            }
            if (!dropdownOuvert || !its.length) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); courseAutocompleteIndex = Math.min(courseAutocompleteIndex + 1, its.length - 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); courseAutocompleteIndex = Math.max(courseAutocompleteIndex - 1, -1); }
            else if (e.key === 'Escape') { fermerCourseAutocomplete(); return; }
            else if (e.key === 'Tab' && its.length > 0) { e.preventDefault(); its[0].dispatchEvent(new MouseEvent('mousedown')); return; }
            else { return; }
            its.forEach((el, idx) => { el.style.background = idx === courseAutocompleteIndex ? 'var(--primary)' : ''; el.style.color = idx === courseAutocompleteIndex ? '#fff' : ''; });
            if (courseAutocompleteIndex >= 0) input.value = its[courseAutocompleteIndex].querySelector('span').textContent.trim();
        };

        window.selectionnerCourseAutocomplete = function(nom) {
            const input = document.getElementById('courseInput');
            if (input) { input.value = nom; }
            fermerCourseAutocomplete();
            ajouterCourseManuelle();
        };

        function fermerCourseAutocomplete() {
            const resDiv = document.getElementById('courseAutocompleteResults');
            if (resDiv) { resDiv.style.display = 'none'; resDiv.innerHTML = ''; }
            courseAutocompleteIndex = -1;
        }

        document.addEventListener('click', function(e) {
            const inp = document.getElementById('courseInput');
            const res = document.getElementById('courseAutocompleteResults');
            if (inp && res && !inp.contains(e.target) && !res.contains(e.target)) fermerCourseAutocomplete();
        });
        // ────────────────────────────────────────────────────────────────────

        window.supprimerCourseDoc = function(event, docId, ingredient, wasChecked) {
            event.stopPropagation();
            userDb.collection("courses").doc(docId).delete().then(() => {
                showUndoToastCourse(ingredient, wasChecked);
            }).catch(function(err) {
                console.error("Erreur suppression course:", err);
                showToast("Erreur lors de la suppression.", "error");
            });
        };

        function showUndoToastCourse(ingredient, wasChecked) {
            const container = document.getElementById('toastContainer');
            if (!container) return;
            const safeJs = String(ingredient).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
            const toast = document.createElement('div');
            toast.className = 'toast success';
            toast.innerHTML = `<span>"${escapeHtml(ingredient)}" supprimé</span> <button type="button" style="margin-left:10px; background:none; border:none; color:var(--primary); font-weight:700; cursor:pointer; text-decoration:underline; font-size:inherit;" onclick="restaurerCourse(this, '${safeJs}', ${wasChecked})">Annuler</button>`;
            container.appendChild(toast);
            requestAnimationFrame(() => toast.classList.add('show'));
            const hideTimeoutId = setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 6000);
            toast._hideTimeoutId = hideTimeoutId;
        }

        window.restaurerCourse = async function(btn, ingredient, wasChecked) {
            const toast = btn.closest('.toast');
            if (toast) { clearTimeout(toast._hideTimeoutId); toast.remove(); }
            try {
                const items = document.querySelectorAll('.course-item');
                let maxOrder = 0;
                items.forEach(el => { const order = parseInt(el.dataset.order || '0'); if (order > maxOrder) maxOrder = order; });
                await userDb.collection("courses").add({
                    ingredient: ingredient,
                    date: firebase.firestore.FieldValue.serverTimestamp(),
                    checked: wasChecked,
                    order: maxOrder + 1
                });
                showToast(`"${ingredient}" restauré`, "success");
            } catch (e) {
                console.error("Erreur restauration course:", e);
                showToast("Erreur lors de la restauration.", "error");
            }
        };

        let isVocalCourses = false;
        let coursesRecognition = null;

        window.toggleVocalCourses = function() {
            const btn = document.getElementById('btnMicCourses');
            if (isVocalCourses) {
                if (coursesRecognition) coursesRecognition.stop();
                return;
            }
            if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
                alert("La dictée vocale n'est pas supportée sur ce navigateur.");
                return;
            }
            
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            coursesRecognition = new SpeechRecognition();
            coursesRecognition.lang = 'fr-FR';
            coursesRecognition.interimResults = false;
            coursesRecognition.maxAlternatives = 1;

            coursesRecognition.onstart = function() {
                isVocalCourses = true;
                if(btn) {
                    btn.style.backgroundColor = "#ff4757";
                    btn.style.animation = "pulse 1.5s infinite";
                }
                const inp = document.getElementById('courseInput');
                if(inp) inp.placeholder = "Écoute en cours...";
            };

            coursesRecognition.onresult = function(event) {
                let transcript = event.results[0][0].transcript;
                
                let replaced = transcript.replace(/ et /gi, ',')
                                         .replace(/ des /gi, ',')
                                         .replace(/ du /gi, ',')
                                         .replace(/ de la /gi, ',')
                                         .replace(/ un /gi, ',')
                                         .replace(/ une /gi, ',');
                
                let articles = replaced.split(',').map(s => s.trim()).filter(s => s.length > 1);
                
                const items = document.querySelectorAll('.course-item');
                let maxOrder = 0;
                items.forEach(el => {
                    const order = parseInt(el.dataset.order || '0');
                    if(order > maxOrder) maxOrder = order;
                });

                let batch = userDb.batch();
                articles.forEach((art) => {
                    maxOrder++;
                    let docRef = userDb.collection("courses").doc();
                    batch.set(docRef, {
                        ingredient: art.charAt(0).toUpperCase() + art.slice(1),
                        date: firebase.firestore.FieldValue.serverTimestamp(),
                        checked: false,
                        order: maxOrder
                    });
                });
                
                batch.commit().then(() => {
                    showToast(articles.length + " article(s) ajouté(s)", "success");
                }).catch(function(err) { console.error("Erreur ajout vocal courses:", err); showToast("Erreur ajout vocal.", "error"); });
            };

            coursesRecognition.onerror = function(event) {
                showToast("Erreur vocale : " + event.error, "error");
            };

            coursesRecognition.onend = function() {
                isVocalCourses = false;
                if(btn) {
                    btn.style.backgroundColor = "";
                    btn.style.animation = "none";
                }
                const inp = document.getElementById('courseInput');
                if(inp) inp.placeholder = "Ajouter (ex: Lait)...";
            };

            coursesRecognition.start();
        };
        
        let draggedCourseItem = null;

        window.handleDragStart = function(e) {
            draggedCourseItem = this;
            this.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', this.innerHTML);
        };

        window.handleDragOver = function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            return false;
        };
        
        window.handleDragEnter = function(e) {
            this.classList.add('drag-over');
        };

        window.handleDragLeave = function(e) {
            this.classList.remove('drag-over');
        };

        window.handleDrop = function(e) {
            e.stopPropagation();
            if (draggedCourseItem !== this) {
                let list = Array.from(this.parentNode.children);
                let draggedIndex = list.indexOf(draggedCourseItem);
                let targetIndex = list.indexOf(this);
                
                if (draggedIndex < targetIndex) {
                    this.parentNode.insertBefore(draggedCourseItem, this.nextSibling);
                } else {
                    this.parentNode.insertBefore(draggedCourseItem, this);
                }
                
                sauvegarderOrdreCourses(this.parentNode);
            }
            return false;
        };

        window.handleDragEnd = function(e) {
            this.classList.remove('dragging');
            document.querySelectorAll('.course-item').forEach(item => item.classList.remove('drag-over'));
        };

        window.sauvegarderOrdreCourses = function(container) {
            let items = container.querySelectorAll('.course-item');
            let batch = userDb.batch();
            items.forEach((item, index) => {
                let docId = item.dataset.id;
                if(docId) {
                    let docRef = userDb.collection("courses").doc(docId);
                    batch.update(docRef, { order: index });
                }
            });
            batch.commit().then(() => console.log("Ordre courses sauvegardé")).catch(function(err) { console.error("Erreur ordre courses:", err); });
        };


                        function ouvrirCourses() {
            const contentDiv = document.getElementById('listeCoursesContent'); contentDiv.innerHTML = "<p style='text-align:center;'>Chargement...</p>";
            if(unsubscribeCourses) unsubscribeCourses();
            
            unsubscribeCourses = userDb.collection("courses").onSnapshot((snapshot) => {
                if(snapshot.empty) return contentDiv.innerHTML = "<p style='text-align:center; padding: 20px; margin-top:15vh; color:var(--text-muted);'>Votre liste est vide. 🎉</p>";
                
                let docs = [];
                snapshot.forEach(doc => docs.push({ id: doc.id, ...doc.data() }));
                
                docs.sort((a, b) => {
                    const orderA = a.order !== undefined ? a.order : 0;
                    const orderB = b.order !== undefined ? b.order : 0;
                    if(orderA !== orderB) return orderA - orderB;
                    const dateA = a.date ? a.date.toMillis() : 0;
                    const dateB = b.date ? b.date.toMillis() : 0;
                    return dateB - dateA;
                });

                let htmlAcheter = ""; let htmlCaddie = ""; let hasCaddie = false;
                let totalAcheter = 0; let totalCaddie = 0;
                
                docs.forEach(item => {
                    const isChecked = item.checked === true;
                    const priceData = getPrixIngredient(item.ingredient);
                    const price = priceData?.prix || 0;
                    const priceHtml = price > 0
                        ? `<div style="font-size:12px; color:var(--text-muted); margin-top:2px;" title="Réf Leclerc: ${(priceData.produit_ref||'').substring(0,60)}">${price.toFixed(2)}€</div>`
                        : '';
                    
                    const safeIngredientJs = String(item.ingredient).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
                    let itemHtml = `<div class="course-item ${isChecked ? 'checked' : ''}" draggable="true" data-id="${item.id}" data-order="${item.order || 0}" onclick="checkerCourse('${item.id}', ${isChecked})">
                                        <div class="course-content">
                                            <div class="circle-check"></div>
                                            <div>
                                                <span style="font-size: 15px; font-weight:500;">${item.ingredient}</span>
                                                ${priceHtml}
                                            </div>
                                        </div>
                                        <button class="btn-delete-course" aria-label="Supprimer ${escapeHtml(item.ingredient)} de la liste" onclick="supprimerCourseDoc(event, '${item.id}', '${safeIngredientJs}', ${isChecked})">🗑️</button>
                                    </div>`;
                    
                    if (isChecked) { 
                        htmlCaddie += itemHtml; 
                        hasCaddie = true;
                        totalCaddie += price;
                    } else { 
                        htmlAcheter += itemHtml;
                        totalAcheter += price;
                    }
                });
                
                const pendingCount = docs.filter(item => item.checked !== true).length;
                const caddieCount = docs.filter(item => item.checked === true).length;
                const totalPrice = totalAcheter + totalCaddie;
                
                const summaryHtml = `
                    <div class="courses-summary">
                        <div>
                            <span class="courses-summary-label">À acheter</span>
                            <strong>${pendingCount}</strong>
                            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${totalAcheter.toFixed(2)}€</div>
                        </div>
                        <div>
                            <span class="courses-summary-label">Caddie</span>
                            <strong>${caddieCount}</strong>
                            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${totalCaddie.toFixed(2)}€</div>
                        </div>
                    </div>
                    <div style="background: linear-gradient(135deg, rgba(16,172,132,0.06), rgba(76,175,80,0.04)); border: 1.5px solid var(--border); border-radius: 12px; padding: 14px; margin-bottom: 16px; text-align: center;">
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">COÛT TOTAL</div>
                        <div style="font-size: 24px; font-weight: 700; color: #1e8e5a;">${totalPrice.toFixed(2)}€</div>
                        <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px; opacity: 0.8;">Prix indicatifs (Open Prices), hors promotions</div>
                    </div>
                `;

                let finalHtml = summaryHtml + (htmlAcheter ? `<div id="courses-active-list">${htmlAcheter}</div>` : "");
                if (hasCaddie) { finalHtml += `<div class="caddie-divider">🛒 Dans le caddie</div><div id="courses-caddie-list">${htmlCaddie}</div>`; finalHtml += `<button class="btn-danger" style="width:100%; margin-top:15px; padding:15px; font-size:14px; font-weight:bold;" onclick="viderCaddie()">🗑️ Jeter les articles du caddie</button>`; }
                if(!htmlAcheter && !hasCaddie) { finalHtml = summaryHtml + "<p style='text-align:center; padding: 20px; margin-top:15vh; color:var(--text-muted);'>Votre liste est vide. 🎉</p>"; }
                if(!htmlAcheter && hasCaddie) { finalHtml = summaryHtml + "<p style='text-align:center; padding: 20px; color:var(--primary); font-weight:bold;'>Tout est dans le caddie ! 🎯</p>" + finalHtml.replace(summaryHtml, ''); }
                contentDiv.innerHTML = finalHtml;
                
                document.querySelectorAll('.course-item').forEach(item => {
                    item.addEventListener('dragstart', handleDragStart, false);
                    item.addEventListener('dragenter', handleDragEnter, false);
                    item.addEventListener('dragover', handleDragOver, false);
                    item.addEventListener('dragleave', handleDragLeave, false);
                    item.addEventListener('drop', handleDrop, false);
                    item.addEventListener('dragend', handleDragEnd, false);
                });
            }, (error) => { contentDiv.innerHTML = "<p style='color:red;'>Erreur de synchronisation.</p>"; });
        }

        async function checkerCourse(docId, currentState) { try { await userDb.collection("courses").doc(docId).update({ checked: !currentState }); } catch(e) { showToast("Erreur de mise à jour", "error"); } }
        async function viderCaddie() {
            const ok = await showConfirm("Supprimer définitivement les articles barrés ?", { danger: true });
            if (!ok) return;
            try {
                const snapshot = await userDb.collection("courses").where("checked", "==", true).get();
                const batch = db.batch(); snapshot.forEach(doc => { batch.delete(doc.ref); });
                await batch.commit(); showToast("Caddie vidé !", "success");
            } catch(e) { showToast("Erreur lors de la suppression.", "error"); }
        }

        function toggleShoppingMode() {
            const modalContent = document.getElementById('modalCoursesContent'); const btn = document.getElementById('btnShoppingMode');
            modalContent.classList.toggle('shopping-mode');
            if(modalContent.classList.contains('shopping-mode')) { btn.innerText = "✖ Quitter mode"; btn.style.background = "var(--primary)"; btn.style.color = "white"; } else { btn.innerText = "🔍 Plein écran"; btn.style.background = "var(--bg-color)"; btn.style.color = "var(--text-muted)"; }
        }

        async function chargerPlanning() {
            document.getElementById('modalPlanning').style.display = 'flex';
            const contentDiv = document.getElementById('planningContent'); contentDiv.innerHTML = "<p style='text-align:center;'>Recherche du menu...</p>";
            try {
                let docSnap = await userDb.collection("planning").doc("semaine").get();
                let data = docSnap.exists ? docSnap.data() : {};
                
                // Migration check
                let needsUpdate = false;
                const jours = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
                jours.forEach(j => {
                    if (data[j] && typeof data[j] === 'string') {
                        data[j] = { dejeuner: null, diner: { plat: data[j], done: false } };
                        needsUpdate = true;
                    }
                });
                if (needsUpdate) await userDb.collection("planning").doc("semaine").set(data);
                
                afficherPlanningHtml(data);
            } catch (e) { contentDiv.innerHTML = "<p style='color:red;'>Erreur.</p>"; }
        }

        function afficherPlanningHtml(planningObj) {
            const contentDiv = document.getElementById('planningContent'); 
            let html = `
            <div style="display:flex; gap:10px; margin-bottom:20px;">
                <button class="btn-primary" style="flex:2; padding: 12px; font-size: 14px;" onclick="ouvrirModalMultiPlanning()">🪄 Générer plusieurs repas</button>
                <button class="btn-danger" style="flex:1; padding: 12px; font-size: 14px;" onclick="viderPlanning()">🗑️ Vider le planning</button>
            </div>
            <div class="planning-grid">`;
            const jours = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
            
            const renderMeal = (jour, repas, mealData, label) => {
                if (mealData && mealData.plat) {
                    let safePlat = mealData.plat.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    let doneCheck = mealData.done ? 'checked' : '';
                    let opacity = mealData.done ? '0.6' : '1';
                    let textDecoration = mealData.done ? 'line-through' : 'none';
                    return `<div class="meal-block filled" style="opacity: ${opacity};">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span class="meal-label">${label}</span>
                            <input type="checkbox" ${doneCheck} onchange="toggleRepasDone('${jour}', '${repas}', this.checked)" style="width:16px; height:16px; accent-color: var(--primary);">
                        </div>
                        <div class="meal-name" style="text-decoration: ${textDecoration}; margin: 8px 0;">${mealData.plat}</div>
                        <div class="meal-actions">
                            <button class="btn-action" style="background:#ff7675; padding: 4px; font-size: 11px; flex:0.3;" onclick="retirerRepas('${jour}', '${repas}')" title="Retirer">🗑️</button>
                            <button class="btn-action" style="background:#6c5ce7; padding: 4px; font-size: 11px; flex:0.3;" onclick="relancerRepasPlanning('${jour}', '${repas}', '${safePlat}')" title="Autre plat">🎲</button>
                            <button class="btn-action btn-expand" style="padding: 4px 8px; font-size: 11px; flex:1;" onclick="cuisinerCePlat('${safePlat}', '${jour}', '${repas}')">🍳 Cuisiner</button>
                        </div>
                    </div>`;
                } else {
                    return `<div class="meal-block empty" onclick="ouvrirModalCuisson(true, '${jour}', '${repas}')" style="cursor:pointer; transition: 0.2s;">
                        <span class="meal-label">${label}</span>
                        <div style="font-size:12px; color:var(--primary); font-weight:bold; margin-top:5px; text-align:center;">+ Ajouter</div>
                    </div>`;
                }
            };

            jours.forEach(jour => {
                let dayData = planningObj[jour] || {};
                html += `<div class="day-card"><div class="day-title">${jour}</div>`;
                html += renderMeal(jour, 'dejeuner', dayData.dejeuner, 'Déjeuner');
                html += renderMeal(jour, 'diner', dayData.diner, 'Dîner');
                html += `</div>`;
            });
            html += `</div>`;
            contentDiv.innerHTML = html;
        }

        window.toggleRepasDone = async function(jour, repas, isDone) {
            try {
                await userDb.collection("planning").doc("semaine").update({ [`${jour}.${repas}.done`]: isDone });
                chargerPlanning();
            } catch(e) { console.error(e); }
        };

        window.retirerRepas = async function(jour, repas) {
            try {
                await userDb.collection("planning").doc("semaine").update({ [`${jour}.${repas}`]: null });
                chargerPlanning();
            } catch(e) { console.error(e); }
        };

        window.viderPlanning = async function() {
            if(!confirm("Voulez-vous vraiment vider tout votre planning ?")) return;
            try {
                await userDb.collection("planning").doc("semaine").set({});
                chargerPlanning();
            } catch(e) { console.error(e); }
        };

        window.ouvrirModalMultiPlanning = function() {
            document.getElementById('modalMultiPlanning').style.display = 'flex';
            const grid = document.getElementById('multiPlanningGrid');
            const jours = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
            let html = '';
            jours.forEach(j => {
                html += `<div style="background:rgba(255, 107, 107, 0.05); padding:10px; border-radius:8px; border:1px solid var(--border);">
                    <div style="font-weight:bold; margin-bottom:5px; color:var(--primary); font-size:14px;">${j}</div>
                    <label style="display:block; font-size:13px; margin-bottom:5px; cursor:pointer;"><input type="checkbox" class="chk-multi-repas" data-jour="${j}" data-repas="dejeuner" style="accent-color:var(--primary);"> Midi</label>
                    <label style="display:block; font-size:13px; cursor:pointer;"><input type="checkbox" class="chk-multi-repas" data-jour="${j}" data-repas="diner" style="accent-color:var(--primary);"> Soir</label>
                </div>`;
            });
            grid.innerHTML = html;
        };

        window.fermerModalMultiPlanning = function() {
            document.getElementById('modalMultiPlanning').style.display = 'none';
        };

        window.genererMultiRepasPlanning = async function() {
            const checkboxes = document.querySelectorAll('.chk-multi-repas:checked');
            if (checkboxes.length === 0) return showToast("Veuillez sélectionner au moins un repas.", "error");
            
            const checkedIngr = memoireIngredients;
            if (checkedIngr.length === 0) {
                showToast("Cochez au moins un ingrédient.", "error");
                return;
            }

            const humeur = document.getElementById('multiHumeur').value;
            const personnes = document.getElementById('multiPersonnes').value;
            const temps = document.getElementById('multiTemps').value;
            const moteur = moteurIAActif;

            let cibles = [];
            checkboxes.forEach(chk => cibles.push(`${chk.dataset.jour} ${chk.dataset.repas}`));
            
            fermerModalMultiPlanning();
            const contentDiv = document.getElementById('planningContent');
            contentDiv.innerHTML = `<div class="loader" style="display:block; margin-top:5vh;"><div class="loader-spinner"></div><p style="margin-top:20px;">Création de ${cibles.length} repas...</p></div>`;
            
            const historique = await getHistoriquePrompt();
            const prompt = `Génère un menu pour EXACTEMENT ces repas : ${cibles.join(", ")}. 
            Pour ${personnes} personnes. Temps imparti : ${temps}. Dispo : ${checkedIngr.join(", ")} (hors épices/condiments). Style : ${humeur}. ${getAllergenesPrompt()} ${getRegimesPrompt()} ${getEquipementsPrompt()} ${historique}
            Format STRICT requis (un par ligne, RIEN D'AUTRE) :
            [Jour] [dejeuner/diner]: [Nom du plat (sans recette)]
            Exemple:
            Lundi dejeuner: Salade niçoise
            Lundi diner: Poulet rôti`;

            try {
                const apiKey = await getApiKey(moteur);
                if (!apiKey) { showToast(`Clé API requise.`, "error"); chargerPlanning(); return; }
                
                let texte = "";
                if (moteur === 'gemini') {
                    const rep = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
                    const data = await rep.json(); texte = data.candidates[0].content.parts[0].text;
                } else if (moteur === 'mistral') {
                    const rep = await fetch(`https://api.mistral.ai/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, body: JSON.stringify({ model: "mistral-small-latest", messages: [{ role: "user", content: prompt }] }) });
                    const data = await rep.json(); texte = data.choices[0].message.content;
                }

                let lignes = texte.split('\n').filter(l => l.includes(':')); 
                
                const docSnap = await userDb.collection("planning").doc("semaine").get();
                let currentData = docSnap.exists ? docSnap.data() : {};
                
                lignes.forEach(l => { 
                    let parts = l.split(':'); 
                    if(parts.length >= 2) {
                        let key = parts[0].trim().toLowerCase(); 
                        let plat = parts.slice(1).join(':').trim().replace(/[*#]/g, '');
                        
                        let matchedJour = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"].find(j => key.includes(j));
                        if(matchedJour) matchedJour = matchedJour.charAt(0).toUpperCase() + matchedJour.slice(1);
                        
                        let matchedRepas = key.includes("dejeuner") || key.includes("déjeuner") || key.includes("midi") ? "dejeuner" : (key.includes("diner") || key.includes("dîner") || key.includes("soir") ? "diner" : null);
                        
                        if (matchedJour && matchedRepas) {
                            if(!currentData[matchedJour]) currentData[matchedJour] = {};
                            currentData[matchedJour][matchedRepas] = { plat: plat, done: false };
                        }
                    }
                });
                
                await userDb.collection("planning").doc("semaine").set(currentData);
                chargerPlanning();
            } catch(e) { 
                const { titre, detail } = messageErreurIA(e, moteur); 
                showToast(`${titre} ${detail}`, "error", 5000); 
                chargerPlanning(); 
            }
        };

        window.genererRepasPlanning = async function() {
            const jour = document.getElementById('planningJour').value;
            const repas = document.getElementById('planningRepas').value;
            
            const checked = memoireIngredients;
            if (checked.length === 0) {
                showToast("Cochez au moins un ingrédient pour planifier.", "error");
                chargerPlanning();
                return;
            }
            const contentDiv = document.getElementById('planningContent');
            contentDiv.innerHTML = `<div class="loader" style="display:block; margin-top:5vh;"><div class="loader-spinner"></div><p style="margin-top:20px;">Recherche pour ${jour} (${repas})...</p></div>`;
            document.getElementById('modalPlanning').style.display = 'flex';
            
            const humeur = document.getElementById('humeur').value;
            const personnes = document.getElementById('personnes').value;
            const temps = document.getElementById('temps').value;
            const moteur = moteurIAActif;

            const historique = await getHistoriquePrompt();
            const prompt = `Génère UN SEUL plat pour le ${repas} de ${personnes} personnes. Temps imparti : ${temps}. Dispo : ${checked.join(", ")} (hors épices/condiments). Style : ${humeur}. ${getAllergenesPrompt()} ${getRegimesPrompt()} ${getEquipementsPrompt()} ${historique}
            Réponds UNIQUEMENT avec le nom du plat (pas de recette, pas d'intro).`;

            try {
                const apiKey = await getApiKey(moteur);
                if (!apiKey) { showToast(`Clé API requise pour ${moteur}.`, "error"); chargerPlanning(); return; }
                let texte = "";
                if (moteur === 'gemini') {
                    const rep = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
                    const data = await rep.json(); texte = data.candidates[0].content.parts[0].text;
                } else if (moteur === 'mistral') {
                    const rep = await fetch(`https://api.mistral.ai/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, body: JSON.stringify({ model: "mistral-small-latest", messages: [{ role: "user", content: prompt }] }) });
                    const data = await rep.json(); texte = data.choices[0].message.content;
                }

                let nouveauPlat = texte.trim().replace(/[*#]/g, '');
                
                const docSnap = await userDb.collection("planning").doc("semaine").get();
                let currentData = docSnap.exists ? docSnap.data() : {};
                if(!currentData[jour]) currentData[jour] = {};
                currentData[jour][repas] = { plat: nouveauPlat, done: false };
                
                await userDb.collection("planning").doc("semaine").set(currentData);
                chargerPlanning();
            } catch(e) { 
                const { titre, detail } = messageErreurIA(e, moteur); 
                showToast(`${titre} ${detail}`, "error", 5000); 
                chargerPlanning(); 
            }
        };

        window.relancerRepasPlanning = async function(jour, repas, platActuel) {
            const checked = memoireIngredients;
            const contentDiv = document.getElementById('planningContent');
            contentDiv.innerHTML = `<div class="loader" style="display:block; margin-top:5vh;"><div class="loader-spinner"></div><p style="margin-top:20px;">Recherche d'une alternative pour ${jour} (${repas})...</p></div>`;
            const moteur = moteurIAActif;

            const historique = await getHistoriquePrompt();
            const prompt = `L'utilisateur ne veut pas de "${platActuel}" pour son ${repas}. Propose UN SEUL nouveau plat différent en utilisant les ingrédients possédés : ${checked.join(", ")} (hors épices/condiments). ${getAllergenesPrompt()} ${getRegimesPrompt()} ${getEquipementsPrompt()} ${historique} Réponds UNIQUEMENT avec le nom du plat.`;

            try {
                const apiKey = await getApiKey(moteur);
                if (!apiKey) { showToast(`Clé API requise pour ${moteur}.`, "error"); chargerPlanning(); return; }
                let texte = "";
                if (moteur === 'gemini') {
                    const rep = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
                    const data = await rep.json(); texte = data.candidates[0].content.parts[0].text;
                } else if (moteur === 'mistral') {
                    const rep = await fetch(`https://api.mistral.ai/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, body: JSON.stringify({ model: "mistral-small-latest", messages: [{ role: "user", content: prompt }] }) });
                    const data = await rep.json(); texte = data.choices[0].message.content;
                }

                let nouveauPlat = texte.trim().replace(/[*#]/g, '');
                
                const docSnap = await userDb.collection("planning").doc("semaine").get();
                let currentData = docSnap.exists ? docSnap.data() : {};
                if(!currentData[jour]) currentData[jour] = {};
                currentData[jour][repas] = { plat: nouveauPlat, done: false };
                
                await userDb.collection("planning").doc("semaine").set(currentData);
                chargerPlanning();
            } catch(e) { 
                const { titre, detail } = messageErreurIA(e, moteur); 
                showToast(`${titre} ${detail}`, "error", 5000); 
                chargerPlanning(); 
            }
        };

        function garantirBoutonRegenerer(html) {
            if (html.includes('regenererRecette')) return html;
            return `<div style="display:flex; align-items:center; justify-content:flex-end; margin-bottom:10px;"><button class="btn-top" onclick="regenererRecette(this)">🔄 Une autre recette</button></div>` + html;
        }

        window.cuisinerCePlat = async function(nomDuPlat, jour, repas) {
            document.getElementById('modalPlanning').style.display = 'none';
            const resDiv = document.getElementById('resultatDiv'); 
            const loader = document.getElementById('loader');
            
            // Check if we already have the detailed recipe saved in the planning
            let docSnap = null;
            if (jour && repas) {
                docSnap = await userDb.collection("planning").doc("semaine").get();
                if (docSnap.exists) {
                    let data = docSnap.data();
                    if (data[jour] && data[jour][repas] && data[jour][repas].recetteText) {
                        // Display the saved recipe instantly
                        switchView('results');
                        resDiv.innerHTML = data[jour][repas].recetteText;
                        return;
                    }
                }
            }

            const personnes = document.getElementById('personnes').value;
            const moteur = moteurIAActif;
            switchView('results');

            const historique = await getHistoriquePrompt();
            const prompt = `Cuisiner : "${nomDuPlat}". Recette détaillée pour ${personnes} pers. ${getAllergenesPrompt()} ${getRegimesPrompt()} ${getEquipementsPrompt()} ${historique}
            IMPORTANT : Donne UNIQUEMENT la recette, sans séparateur, avec un émoji et le titre au début. Ingrédients manquants ? Finir par : "COURSES: ingrédient1, ingrédient2". Durées en chiffres. Pas de blabla.`;

            resDiv.innerHTML = ""; 
            loader.style.display = "block"; 
            
            try {
                const apiKey = await getApiKey(moteur);
                if (!apiKey) { loader.style.display = "none"; showToast(`Clé API requise.`, "error"); return; }
                
                let texte = "";
                if (moteur === 'gemini') {
                    const rep = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
                    const data = await rep.json(); texte = data.candidates[0].content.parts[0].text;
                } else if (moteur === 'mistral') {
                    const rep = await fetch(`https://api.mistral.ai/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, body: JSON.stringify({ model: "mistral-small-latest", messages: [{ role: "user", content: prompt }] }) });
                    const data = await rep.json(); texte = data.choices[0].message.content;
                }

                loader.style.display = "none";
                let safeTitre = nomDuPlat.replace(/'/g, "\\'");
                let index = 'plan';
                let contenu = enrichirTexteChrono(texte.trim());
                let rawSteps = contenu.split('\n').filter(line => line.trim().length > 15).map(line => line.replace(/'/g, "\\'").replace(/"/g, '&quot;'));
                if (rawSteps.length === 0) rawSteps = [contenu.replace(/<br>/g, ' ').replace(/<[^>]*>/g, '').trim()];
                let stepsArrayString = `['${rawSteps.join("','")}']`;
                
                // Construct a detailed view similar to normal recipes
                let contenuHtml = `<details class="recipe-card" id="card-${index}" open><summary><div><span>🍽️ ${nomDuPlat}</span><div class="recipe-mini-meta" style="margin-top: 5px;">👥 ${personnes} pers.</div></div></summary><div class="recipe-content"><div style="display:flex; justify-content:flex-end; margin-bottom:15px;"><button class="toggle-view" onclick="togglePasAPas(this, 'text-view-${index}', 'step-view-${index}', ${stepsArrayString})" aria-pressed="false">👀 Mode Pas-à-pas</button></div><div id="text-view-${index}" class="text-view">${contenu.replace(/\n/g, '<br>')}</div><div id="step-view-${index}" class="pas-a-pas-container"><div style="color:var(--primary); font-weight:bold;" class="step-counter">Étape 1</div><div class="step-text">Contenu</div><div class="step-controls"><button class="btn-step" onclick="changeStep('step-view-${index}', -1)" aria-label="Étape précédente">⬅️ Précédent</button><button class="btn-step" onclick="changeStep('step-view-${index}', 1)" aria-label="Étape suivante">➡️ Suivant</button></div></div><div class="recipe-actions"><button class="btn-action btn-expand" onclick="toggleExpand('card-${index}', this)">⛶ Agrandir</button></div>
                <div class="planning-validation-buttons" style="margin-top: 15px; display: flex; gap: 10px;">
                    <button class="btn-primary" style="flex: 1;" onclick="validerRecettePlanning(this, '${safeTitre}', '${jour}', '${repas}')">✅ Valider et sauvegarder</button>
                    <button class="btn-secondary" style="flex: 1;" onclick="cuisinerCePlat('${safeTitre}', '${jour}', '${repas}')">🔄 Régénérer</button>
                </div></div></details>`;
                
                resDiv.innerHTML = contenuHtml;

            } catch(e) {
                loader.style.display = "none";
                const { titre, detail } = messageErreurIA(e, moteur); 
                showToast(`${titre} ${detail}`, "error", 5000); 
            }
        };

        window.validerRecettePlanning = async function(btn, nomDuPlat, jour, repas) {
            const card = btn.closest('.recipe-card');
            
            // Remove the validation buttons before saving
            const validationDiv = card.querySelector('.planning-validation-buttons');
            if (validationDiv) validationDiv.remove();
            
            // Add a small "Sauvegardé" badge or normal layout
            let htmlToSave = card.outerHTML;
            
            try {
                const docSnap = await userDb.collection("planning").doc("semaine").get();
                let currentData = docSnap.exists ? docSnap.data() : {};
                if(!currentData[jour]) currentData[jour] = {};
                if(!currentData[jour][repas]) currentData[jour][repas] = { plat: nomDuPlat, done: false };
                
                currentData[jour][repas].recetteText = htmlToSave;
                
                await userDb.collection("planning").doc("semaine").set(currentData);
                showToast("✅ Recette détaillée sauvegardée au planning !", "success");
                chargerPlanning(); // Reload the planning in background
            } catch(e) {
                console.error(e);
                showToast("Erreur lors de la sauvegarde.", "error");
            }
        };

        function lancerRecetteRapide() {
            const checked = memoireIngredients;
            if (checked.length === 0) return showToast("Sélectionnez au moins un ingrédient !", "error");
            const personnes = document.getElementById('personnes').value;
            showToast("⚡ Recherche de recettes ultra rapides (15 min max) !", "info");
            chercherRecettesIA({
                humeur: "flemme absolue, le moins de vaisselle et d'effort possible, ultra rapide",
                temps: "15 minutes max",
                personnes: personnes
            });
        }

        async function chercherRecettesIA(optionsForcees = null) {
            const checked = memoireIngredients;
            if (checked.length === 0) return showToast("Sélectionnez au moins un ingrédient !", "error");
            
            const humeur = optionsForcees ? optionsForcees.humeur : document.getElementById('humeur').value;
            const personnes = optionsForcees ? optionsForcees.personnes : document.getElementById('personnes').value;
            const temps = optionsForcees ? optionsForcees.temps : document.getElementById('temps').value;
            const moteur = moteurIAActif;
            
            const cacheKey = `recettes_v2_${humeur}_${temps}_${personnes}_${moteur}_${checked.sort().join('_')}`.toLowerCase();
            const resDiv = document.getElementById('resultatDiv'); const loader = document.getElementById('loader');
            switchView('results');
            
            const historique = await getHistoriquePrompt();
            const prompt = `Génère OBLIGATOIREMENT 3 recettes distinctes et différentes pour ${personnes} personnes. Temps imparti : ${temps}. Dispo : ${checked.join(", ")} (hors épices/condiments de base). Style : ${humeur}. ${getAllergenesPrompt()} ${getRegimesPrompt()} ${getEquipementsPrompt()} ${historique}

Règles de formatage ABSOLUES :
1. Sépare chaque recette de manière stricte en écrivant exactement ---RECETTE--- entre elles. Ne mets AUCUN texte d'introduction ni de conclusion.
2. La TOUTE PREMIÈRE ligne de chaque recette doit commencer par un émoji suivi du TITRE du plat.
3. Si un ingrédient non coché est nécessaire, termine la recette par la ligne exacte : "COURSES: ingrédient1, ingrédient2".
4. Indique toutes les durées en chiffres (ex: 15 min). Pas de blabla inutile avant ou après les recettes.`;
            const titleTemplate = "J'ai trouvé {N} idées pour vous ! (Fraîches)";

            const requestContext = { prompt, titleTemplate, cacheKey, moteur, personnes };
            window._lastRecipeRequest = requestContext; localStorage.setItem('chef_ia_last_request', JSON.stringify(requestContext));

            const cachedData = getCache(cacheKey);
            if (cachedData) { resDiv.innerHTML = garantirBoutonRegenerer(cachedData); showToast("⚡ Recettes chargées depuis le cache !", "success"); return; }
            resDiv.innerHTML = ""; loader.style.display = "block"; executerRequeteIA(prompt, titleTemplate, cacheKey, 2, personnes);
        }

        function normalizeRecipeResponse(text) {
            return (text || "").replace(/\r/g, "").replace(/\u00A0/g, " ").trim();
        }

        function splitRecipeBlocks(rawText) {
            const normalized = normalizeRecipeResponse(rawText);
            if (!normalized) return [];

            const explicitBlocks = normalized.split(/-{2,}\s*RECETTE\s*-{2,}/i).filter(block => block.trim().length > 50);
            if (explicitBlocks.length > 0) {
                return explicitBlocks.map(block => block.trim());
            }

            return [normalized];
        }

        function looksLikeRecipeBlock(block) {
            const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
            const text = lines.join(' ');
            if (lines.length < 3 || text.length < 80) return false;
            const hasTitle = /^[^\n]{3,}$/.test(lines[0]);
            const hasCookingSignal = /(ingrédients|ingredients|étapes|etapes|préparation|preparation|temps|min|courses)/i.test(text);
            return hasTitle && hasCookingSignal;
        }

        function sanitizeRecipeBlock(block) {
            return block
                .replace(/\*\*|\*|#/g, '')
                .replace(/\s+\n\s+/g, '\n')
                .trim();
        }

        function normalizeTextForCheck(value) {
            return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        }

        function normalizeCourseValue(value) {
            return normalizeTextForCheck(value).replace(/[\s\-_]+/g, ' ');
        }

        function formatCourseName(value) {
            return String(value || '').trim().replace(/\s+/g, ' ').replace(/^\w/, c => c.toUpperCase());
        }

        function getRecipeStateFromText(text) {
            const missingItems = parseMissingIngredientsFromText(text);
            if (!missingItems.length) {
                return { missingItems: [], badge: '<span class="recipe-status-badge recipe-status-ready">🟢 Prête</span>', ready: true };
            }
            const label = missingItems.length === 1 ? '1 ingrédient manquant' : `${missingItems.length} ingrédients manquants`;
            return { missingItems, badge: `<span class="recipe-status-badge recipe-status-missing">🟡 ${label}</span>`, ready: false };
        }

        function parseMissingIngredientsFromText(text) {
            if (!text) return [];
            const source = String(text).replace(/\r/g, '').trim();
            const patterns = [
                /(?:^|\n)\s*(?:COURSES|COURSE|INGRÉDIENTS MANQUANTS|INGREDIENTS MANQUANTS|À ACHETER|A ACHETER|IL VOUS MANQUE|MANQUE)\s*[:\-]?\s*(.+)/i,
                /(?:^|\n)\s*(?:COURSES|COURSE|INGRÉDIENTS MANQUANTS|INGREDIENTS MANQUANTS|À ACHETER|A ACHETER|IL VOUS MANQUE|MANQUE)\s*[:\-]?\s*([\s\S]+)/i
            ];

            for (const pattern of patterns) {
                const match = source.match(pattern);
                if (!match) continue;
                const rawList = match[1].replace(/\n+/g, ' ');
                const items = rawList
                    .split(/[;,]/)
                    .map(item => item.replace(/^[\-•\*\s]+/, '').replace(/[.]+$/, '').trim())
                    .filter(Boolean)
                    .filter(item => !/^(?:et|ou|des|du|de la|un|une|de)$/i.test(item));
                if (items.length) return items.slice(0, 8);
            }

            return [];
        }

        function buildMissingIngredientsBadge(items) {
            if (!Array.isArray(items) || items.length === 0) return '';
            const label = items.length > 1 ? `${items.length} ingrédients manquent` : '1 ingrédient manque';
            const listText = items.map(item => item.replace(/'/g, "\\'")).join(', ');
            return `<span class="missing-ingredient-pill" title="${listText}">⚠️ ${label}</span>`;
        }

        function getRegimeForbiddenKeywords() {
            const forbidden = {
                'végétarien': ['boeuf', 'veau', 'porc', 'poulet', 'canard', 'saumon', 'poisson', 'crevette', 'jambon', 'bacon', 'merguez', 'charcuterie'],
                'vegetarien': ['boeuf', 'veau', 'porc', 'poulet', 'canard', 'saumon', 'poisson', 'crevette', 'jambon', 'bacon', 'merguez', 'charcuterie'],
                'végétalien': ['boeuf', 'veau', 'porc', 'poulet', 'canard', 'saumon', 'poisson', 'crevette', 'jambon', 'bacon', 'merguez', 'charcuterie', 'lait', 'beurre', 'fromage', 'oeufs', 'oeuf', 'yaourt', 'crème', 'creme'],
                'vegetalien': ['boeuf', 'veau', 'porc', 'poulet', 'canard', 'saumon', 'poisson', 'crevette', 'jambon', 'bacon', 'merguez', 'charcuterie', 'lait', 'beurre', 'fromage', 'oeufs', 'oeuf', 'yaourt', 'crème', 'creme'],
                'sans gluten': ['blé', 'ble', 'farine de ble', 'farine de blé', 'pain', 'pate', 'pâtes', 'biscuit', 'brioche', 'seigle', 'orge'],
                'sans lactose': ['lait', 'beurre', 'fromage', 'yaourt', 'creme', 'crème', 'chèvre', 'chevre'],
                'sans porc': ['porc', 'jambon', 'bacon', 'merguez', 'grillade de porc'],
                'vegan': ['lait', 'beurre', 'fromage', 'oeufs', 'oeuf', 'yaourt', 'creme', 'crème', 'poisson', 'poulet', 'boeuf', 'porc', 'merguez', 'jambon', 'bacon'],
                'detox': ['friture', 'gras', 'beignet', 'burger', 'frite', 'sauce lourde']
            };

            const map = {};
            memoireRegimes.forEach(regime => {
                const key = normalizeTextForCheck(regime);
                if (forbidden[key]) map[key] = forbidden[key];
            });
            return map;
        }

        function validateRecipeAgainstRestrictions(block) {
            if (!block || !block.trim()) return false;
            const text = normalizeTextForCheck(block);
            if (text.length < 80) return false;

            const allergenes = memoireAllergenes.map(a => normalizeTextForCheck(a));
            for (const allergene of allergenes) {
                if (!allergene) continue;
                if (text.includes(allergene)) return false;
            }

            const regimeRules = getRegimeForbiddenKeywords();
            for (const [regimeKey, forbiddenWords] of Object.entries(regimeRules)) {
                if (forbiddenWords.some(word => text.includes(normalizeTextForCheck(word)))) {
                    return false;
                }
            }

            const ingredients = memoireIngredients.map(i => normalizeTextForCheck(i));
            const hasAnyIngredients = ingredients.length > 0;
            if (hasAnyIngredients) {
                const mentionsSelectedIngredients = ingredients.filter(item => item && text.includes(item)).length;
                if (mentionsSelectedIngredients === 0 && !/courses:|manque|à acheter|a acheter/i.test(block)) {
                    return false;
                }
            }

            return true;
        }

        function filterValidRecipeBlocks(blocks) {
            return blocks
                .map(block => sanitizeRecipeBlock(block))
                .filter(block => looksLikeRecipeBlock(block))
                .filter(validateRecipeAgainstRestrictions);
        }

        async function executerRequeteIA(prompt, titleTemplate, cacheKey = null, retries = 2, personnes = null) {
            const resDiv = document.getElementById('resultatDiv'); const loader = document.getElementById('loader');
            const moteur = moteurIAActif;
            
            const requestContext = { prompt, titleTemplate, cacheKey, moteur, personnes };
            window._lastRecipeRequest = requestContext; localStorage.setItem('chef_ia_last_request', JSON.stringify(requestContext));

            let lastError = null;

            for (let attempt = 0; attempt <= retries; attempt++) {
                try {
                    const apiKey = await getApiKey(moteur);
                    if (!apiKey) { loader.style.display = "none"; showToast(`Clé API ${moteur} requise.`, "error"); return; }
                    
                    let texteReponse = "";

                    if (moteur === 'gemini') {
                        const rep = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=${apiKey}`, {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                        });
                        const data = await rep.json();
                        if(data.error) throw new Error(data.error.message);
                        texteReponse = data.candidates[0].content.parts[0].text;
                    } 
                    else if (moteur === 'mistral') {
                        const rep = await fetch(`https://api.mistral.ai/v1/chat/completions`, {
                            method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
                            body: JSON.stringify({ model: "mistral-small-latest", messages: [{ role: "system", content: "Tu es un parseur automatique. Tu DOIS OBLIGATOIREMENT séparer les 3 recettes par la chaîne de caractères exacte '---RECETTE---'." }, { role: "user", content: prompt }] })
                        });
                        const data = await rep.json();
                        if(data.error) throw new Error(data.error.message);
                        texteReponse = data.choices[0].message.content;
                    }

                    const blocsBruts = splitRecipeBlocks(texteReponse);
                    const blocs = filterValidRecipeBlocks(blocsBruts);

                    if (blocs.length === 0) {
                        throw new Error("La réponse de l'IA est incomplète, incohérente ou incompatible avec vos restrictions.");
                    }

                    loader.style.display = "none";

                    const blocsAFaire = blocs.slice(0, 3);
                    let mainTitle = titleTemplate.replace('{N}', blocsAFaire.length);
                    let html = `<div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-top:48px; margin-bottom:10px;"><h3 style="margin:0;">${mainTitle}</h3><button class="btn-top" onclick="regenererRecette(this)">🔄 Une autre recette</button></div>`;
                    
                    const blocsTriees = blocsAFaire
                        .map((bloc, index) => ({ bloc, index, state: getRecipeStateFromText(bloc) }))
                        .sort((a, b) => a.state.missingItems.length - b.state.missingItems.length);

                    blocsTriees.forEach(({ bloc, index, state }) => {
                        let lines = bloc.split('\n').map(l => l.trim()).filter(Boolean);
                        let titre = lines[0].replace(/^[^\wÀ-ÿ\d]+/, '').trim();
                        let contenu = lines.slice(1).join('\n').trim();
                        if (!titre) titre = `Recette ${index + 1}`;
                        if (!contenu) contenu = bloc;

                        let missingItems = state.missingItems.length ? state.missingItems : parseMissingIngredientsFromText(contenu);
                        if (missingItems.length === 0) missingItems = parseMissingIngredientsFromText(bloc);
                        const missingBadge = buildMissingIngredientsBadge(missingItems);
                        
                        const nbPersonnesText = personnes ? ` • 👥 ${personnes} pers.` : "";
                        const recipeMeta = missingItems.length
                            ? `<div class="recipe-mini-meta">${missingItems.length} ingrédient${missingItems.length > 1 ? 's' : ''} à compléter${nbPersonnesText}</div>`
                            : `<div class="recipe-mini-meta recipe-mini-meta-ready">Recette prête${nbPersonnesText}</div>`;

                        let coursesMatch = contenu.match(/COURSES\s*:\s*(.*)/i) || contenu.match(/(?:IL VOUS MANQUE|MANQUE|À ACHETER|A ACHETER)[^\n]*[:\-]?\s*(.*)/i);
                        if (coursesMatch) {
                            let items = parseMissingIngredientsFromText(coursesMatch[0]);
                            if (items.length === 0) {
                                items = (coursesMatch[1] || '').split(',').map(i => i.trim()).filter(Boolean);
                            }
                            if (items.length) {
                                const uniqueItems = [...new Map(items.map(item => [normalizeCourseValue(item), item])).values()];
                                let coursesUI = `<div class="courses-box"><div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom: 10px;"><b>🛒 Il vous manque :</b><button class="btn-course add-all-courses-btn" onclick="ajouterTousIngredientsManquants(this.closest('.courses-box'))">➕ Ajouter tout</button></div><ul style="padding-left: 20px; margin-top:10px;">`;
                                uniqueItems.forEach(item => { coursesUI += `<li>${item} <button class="btn-course missing-add-btn" data-ingredient="${item.replace(/"/g, '&quot;')}" onclick="ajouterCourse(this, this.dataset.ingredient)">➕ Ajouter</button></li>`; });
                                coursesUI += `</ul></div>`;
                                contenu = contenu.replace(coursesMatch[0], coursesUI);
                            }
                        }
                        if (missingItems.length && !coursesMatch) {
                            const uniqueItems = [...new Map(missingItems.map(item => [normalizeCourseValue(item), item])).values()];
                            const itemList = uniqueItems.map(item => `<li>${item} <button class="btn-course missing-add-btn" data-ingredient="${item.replace(/"/g, '&quot;')}" onclick="ajouterCourse(this, this.dataset.ingredient)">➕ Ajouter</button></li>`).join('');
                            contenu += `<div class="courses-box"><div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px;"><b>🛒 Il vous manque :</b><button class="btn-course add-all-courses-btn" onclick="ajouterTousIngredientsManquants(this.closest('.courses-box'))">➕ Ajouter tout</button></div><ul style="padding-left: 20px; margin-top:10px;">${itemList}</ul></div>`;
                        }
                        contenu = enrichirTexteChrono(contenu);
                        let safeTitre = titre.replace(/'/g, "\\'"); let rawSteps = contenu.split('\n').filter(line => line.trim().length > 15).map(line => line.replace(/'/g, "\\'").replace(/"/g, '&quot;'));
                        if (rawSteps.length === 0) rawSteps = [contenu.replace(/<br>/g, ' ').replace(/<[^>]*>/g, '').trim()];
                        let stepsArrayString = `['${rawSteps.join("','")}']`;

                        html += `<details class="recipe-card" id="card-${index}" ${index === 0 ? 'open' : ''}><summary><div><span>${titre}</span>${recipeMeta}</div>${missingBadge}</summary><div class="recipe-content"><div style="display:flex; justify-content:flex-end; margin-bottom:15px;"><button class="toggle-view" onclick="togglePasAPas(this, 'text-view-${index}', 'step-view-${index}', ${stepsArrayString})" aria-pressed="false">👀 Mode Pas-à-pas</button></div><div id="text-view-${index}" class="text-view">${contenu.replace(/\n/g, '<br>')}</div><div id="step-view-${index}" class="pas-a-pas-container"><div style="color:var(--primary); font-weight:bold;" class="step-counter">Étape 1</div><div class="step-text">Contenu</div><div class="step-controls"><button class="btn-step" onclick="changeStep('step-view-${index}', -1)" aria-label="Étape précédente">⬅️ Précédent</button><button class="btn-step" onclick="changeStep('step-view-${index}', 1)" aria-label="Étape suivante">➡️ Suivant</button></div></div><div class="recipe-actions"><button class="btn-action btn-save" onclick="sauvegarder(this, '${safeTitre}', 'text-view-${index}')">💾 Sauvegarder</button><button class="btn-action btn-expand" onclick="toggleExpand('card-${index}', this)">⛶ Agrandir</button><div style="width:100%; margin-top:10px; display:flex; gap:10px;"><input type="text" id="refine-input-${index}" placeholder="Ex: Version vegan, sans four..." style="flex:1; padding:8px; border:1px solid var(--border); border-radius:6px; background:var(--bg-color); color:var(--text-main); font-size:13px;"><button class="btn-action" style="background:var(--accent);" onclick="affinerRecette('${index}', '${safeTitre}')">✨ Affiner</button></div></div></div></details>`;
                    });
                    
                    resDiv.innerHTML = html;
                    if (typeof confetti === "function") confetti({ particleCount: 60, spread: 60, origin: { y: 0.9 }, zIndex: 100 });
                    if (cacheKey) setCache(cacheKey, html);
                    return;
                } catch (e) {
                    lastError = e;
                    if (attempt < retries) {
                        showToast("La réponse IA est incomplète, nouvelle tentative...", "info", 2500);
                        continue;
                    }
                    loader.style.display = "none";
                    afficherErreurIA(resDiv, e, moteur);
                    return;
                }
            }

            if (lastError) {
                loader.style.display = "none";
                afficherErreurIA(resDiv, lastError, moteur);
            }
        }

        async function regenererRecette(btn) {
            let context = window._lastRecipeRequest;
            if (!context) { const saved = localStorage.getItem('chef_ia_last_request'); if (saved) context = JSON.parse(saved); }
            if (!context) { showToast("Veuillez relancer la recherche depuis le bouton principal.", "error"); return; }
            if (btn) { btn.disabled = true; btn.innerText = "⏳ Recherche..."; }
            
            const resDiv = document.getElementById('resultatDiv'); const loader = document.getElementById('loader'); const loaderText = document.getElementById('loaderText');
            resDiv.innerHTML = ""; loader.style.display = "block"; if (loaderText) loaderText.innerText = "Le Chef cherche de nouvelles idées... 💭";
            
            const { prompt, titleTemplate, cacheKey } = context;
            let basePrompt = prompt.split('\nRègles de formatage')[0].split('\nIMPORTANT')[0];
            const promptRegen = `${basePrompt}

Génère OBLIGATOIREMENT 3 nouvelles recettes distinctes, différentes des précédentes, avec des idées nouvelles.

Règles de formatage ABSOLUES :
1. Sépare chaque recette de manière stricte en écrivant exactement ---RECETTE--- entre elles. Ne mets AUCUN texte d'introduction ni de conclusion.
2. La TOUTE PREMIÈRE ligne de chaque recette doit commencer par un émoji suivi du TITRE du plat.
3. Si un ingrédient non coché est nécessaire, termine la recette par la ligne exacte : "COURSES: ingrédient1, ingrédient2".
4. Indique toutes les durées en chiffres (ex: 15 min). Pas de blabla inutile avant ou après les recettes.`;

            const baseCacheKey = cacheKey ? cacheKey.split('_v')[0] : null; const nouveauCacheKey = baseCacheKey ? `${baseCacheKey}_v${Date.now()}` : null;
            
            try { await executerRequeteIA(promptRegen, titleTemplate, nouveauCacheKey, 2, context.personnes); } 
            catch (e) { afficherErreurIA(resDiv, e, context.moteur); loader.style.display = "none"; }
            if (loaderText) loaderText.innerText = "Le Chef élabore vos menus...";
        }

        async function chargerCarnet() {
            const contentDiv = document.getElementById('carnetRecettesList'); contentDiv.innerHTML = "<p style='text-align:center;'>Chargement...</p>";
            try {
                const snapshot = await userDb.collection("carnet").orderBy("date", "desc").get();
                if (snapshot.empty) return contentDiv.innerHTML = `<h3 style="text-align:center; margin-top:15vh; color:var(--text-muted); font-weight:400; opacity:0.8;">Votre carnet est vide !</h3>`;
                let html = ""; let index = 0;
                snapshot.forEach(doc => {
                    const item = doc.data(); let bloc = item.recette; let iSaut = bloc.indexOf('\n'); let titre = bloc.substring(0, iSaut).trim().replace(/[*#]/g, ''); let contenu = bloc.substring(iSaut).trim().replace(/[*#]/g, ''); let dateStr = item.date ? item.date.toDate().toLocaleDateString() : ""; let note = item.note || 0;
                    contenu = enrichirTexteChrono(contenu);
                    let rawSteps = contenu.split('\n').filter(line => line.trim().length > 15).map(line => line.replace(/'/g, "\\'").replace(/"/g, '&quot;')); let stepsArrayString = `['${rawSteps.join("','")}']`;
                    let starsHtml = `<div class="rating-stars" data-doc="${doc.id}">`; for (let n = 1; n <= 5; n++) { starsHtml += `<span class="star ${n <= note ? 'filled' : ''}" onclick="noterRecette('${doc.id}', ${n})">★</span>`; } starsHtml += `<span class="rating-label">${note > 0 ? 'Votre note' : 'Notez cette recette'}</span></div>`;
                    html += `<details class="recipe-card" id="carnet-card-${index}"><summary>${titre} <span style="font-size:12px; color:var(--text-muted); margin-left:10px;">(${dateStr})</span></summary><div class="recipe-content">${starsHtml}<div style="display:flex; justify-content:flex-end; margin-bottom:15px;"><button class="toggle-view" onclick="togglePasAPas(this, 'carnet-text-${index}', 'carnet-step-${index}', ${stepsArrayString})" aria-pressed="false">👀 Mode Pas-à-pas</button></div><div id="carnet-text-${index}" class="text-view">${contenu.replace(/\n/g, '<br>')}</div><div id="carnet-step-${index}" class="pas-a-pas-container"><div style="color:var(--primary); font-weight:bold;" class="step-counter">Étape 1</div><div class="step-text">Contenu</div><div class="step-controls"><button class="btn-step" onclick="changeStep('carnet-step-${index}', -1)" aria-label="Étape précédente">⬅️ Précédent</button><button class="btn-step" onclick="changeStep('carnet-step-${index}', 1)" aria-label="Étape suivante">➡️ Suivant</button></div></div><div class="recipe-actions"><button class="btn-action btn-expand" onclick="toggleExpand('carnet-card-${index}', this)">⛶ Agrandir</button></div></div></details>`;
                    index++;
                });
                contentDiv.innerHTML = html;
            } catch (e) { contentDiv.innerHTML = "<p style='color:red;'>Erreur.</p>"; }
        }

        async function noterRecette(docId, note) {
            const container = document.querySelector(`.rating-stars[data-doc="${docId}"]`);
            try {
                await userDb.collection("carnet").doc(docId).update({ note: note });
                if (container) { container.querySelectorAll('.star').forEach((star, i) => { star.classList.toggle('filled', i < note); }); container.querySelector('.rating-label').innerText = "Votre note"; }
            } catch (e) { if (container) container.querySelector('.rating-label').innerText = "Erreur, réessayez"; }
        }

        async function getHistoriquePrompt() {
            try {
                const snapshot = await userDb.collection("carnet").where("note", ">", 0).get();
                if (snapshot.empty) return "";
                let aimes = [], evites = [];
                snapshot.forEach(doc => { const item = doc.data(); let titre = item.recette.split('\n')[0].replace(/[*#⭐0-9.]/g, '').trim(); if (!titre) return; if (item.note >= 4) aimes.push(titre); else if (item.note <= 2) evites.push(titre); });
                let txt = ""; if (aimes.length) txt += `\nL'utilisateur a AIMÉ ces plats par le passé (note ≥4/5) : ${aimes.slice(0, 8).join(", ")}. Inspire-toi de styles similaires si pertinent.`; if (evites.length) txt += `\nL'utilisateur N'A PAS aimé ces plats (note ≤2/5) : ${evites.slice(0, 8).join(", ")}. Évite de reproposer des plats trop proches.`;
                return txt;
            } catch (e) { return ""; }
        }

                async function analyserImageIA(event) {
            const file = event.target.files[0]; if (!file) return;
            const resDiv = document.getElementById('resultatDiv'); const loader = document.getElementById('loader');
            resDiv.innerHTML = ""; loader.style.display = "block"; loader.querySelector('p').innerText = "Le Chef analyse votre photo... 📸";
            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64String = reader.result.split(',')[1];
                const promptText = "Liste TOUS les ingrédients alimentaires visibles sur cette image. Renvoie UNIQUEMENT les noms séparés par des virgules (ex: Tomate, Oignon, Poulet).";
                try {
                    const apiKey = await getApiKey('gemini');
                    if (!apiKey) { loader.style.display = "none"; showToast("Clé API Gemini requise pour la vision.", "error"); return; }
                    const rep = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=${apiKey}`, {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ contents: [{ parts: [{ text: promptText }, { inlineData: { mimeType: file.type || "image/jpeg", data: base64String } }] }] })
                    });
                    const data = await rep.json(); loader.style.display = "none";
                    if(data.error) throw new Error(data.error.message);
                    const text = data.candidates[0].content.parts[0].text;
                    const itemsTrouves = text.split(',').map(i => i.trim()).filter(i => i.length > 1);
                    if (itemsTrouves.length === 0) return resDiv.innerHTML = "<h3 style='text-align:center;'>Aucun ingrédient détecté.</h3>";
                    
                    let htmlList = "";
                    itemsTrouves.forEach(item => {
                        let match = null;
                        for(let cat in globalIngredientsList) {
                            let found = globalIngredientsList[cat].find(g => g.toLowerCase().includes(item.toLowerCase()) || item.toLowerCase().includes(g.toLowerCase()));
                            if(found) { match = found; break; }
                        }
                        const nomExact = match ? match : item.charAt(0).toUpperCase() + item.slice(1);
                        htmlList += `<div class="scan-result-item"><span>${nomExact} ${match ? '✅' : '🆕'}</span><input type="checkbox" checked value="${nomExact.replace(/'/g, "\'")}" class="pending-scan-chk"></div>`;
                    });
                    document.getElementById('iaScanResults').innerHTML = htmlList; document.getElementById('modalIAScanner').style.display = 'flex'; event.target.value = "";
                } catch (e) { loader.style.display = "none"; afficherErreurIA(resDiv, e, 'gemini'); }
            };
            reader.readAsDataURL(file);
        }

        async function validerScanIA() {
            const confirmedItems = Array.from(document.querySelectorAll('.pending-scan-chk:checked')).map(cb => cb.value);
            let checkedCount = 0;
            for(let item of confirmedItems) {
                let found = false;
                for(let cat in globalIngredientsList) {
                    if(globalIngredientsList[cat].includes(item)) found = true;
                }
                if(!found) {
                    if(typeof ajouterIngredientPersonnalise === 'function') {
                        await ajouterIngredientPersonnalise(item);
                    }
                } else {
                    if(!memoireIngredients.includes(item)) memoireIngredients.push(item);
                }
                checkedCount++;
            }
            syncCloud('ingredients', memoireIngredients);
            updateButtonLabel();
            afficherIngredientsGauche();
            document.getElementById('modalIAScanner').style.display = 'none';
            document.getElementById('resultatDiv').innerHTML = `<h3 style='text-align:center; color:var(--primary);'>${checkedCount} ingrédient(s) ajouté(s) ! ✨</h3>`;
        }

        let html5QrcodeScanner;
        function ouvrirBarcodeScanner() {
            document.getElementById('modalBarcode').style.display = 'flex'; document.getElementById('barcode-status').innerText = "Caméra en cours...";
            html5QrcodeScanner = new Html5Qrcode("barcode-scanner-container");
            html5QrcodeScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 200 } }, onScanSuccess, () => {}).catch(err => { document.getElementById('barcode-status').innerText = "Erreur : " + err; });
            pushOverlayHistory('modalBarcode', fermerBarcodeScannerReel);
        }
        function fermerBarcodeScannerReel() { document.getElementById('modalBarcode').style.display = 'none'; if (html5QrcodeScanner) html5QrcodeScanner.stop().catch(err => {}); }
        function fermerBarcodeScanner() { closeOverlayOrBack('modalBarcode', fermerBarcodeScannerReel); }
        let isScanning = false;
        async function onScanSuccess(decodedText) {
            if (isScanning) return; isScanning = true; document.getElementById('barcode-status').innerText = "Recherche Open Food Facts... ⏳";
            try {
                const rep = await fetch(`https://world.openfoodfacts.org/api/v0/product/${decodedText}.json`); const data = await rep.json();
                if (data.status === 1 && data.product) {
                    let productName = (data.product.product_name_fr || data.product.product_name || "Inconnu").split(',')[0].trim(); productName = productName.charAt(0).toUpperCase() + productName.slice(1);
                    fermerBarcodeScanner(); document.getElementById('iaScanResults').innerHTML = `<div class="scan-result-item"><span>${productName}</span><input type="checkbox" checked value="${productName}" class="pending-scan-chk"></div>`; document.getElementById('modalIAScanner').style.display = 'flex';
                } else { document.getElementById('barcode-status').innerText = "Introuvable ❌"; setTimeout(() => { isScanning = false; }, 2000); }
            } catch(e) { isScanning = false; }
        }

        function toggleExpand(cardId, btn) {
            const card = document.getElementById(cardId);
            const overlayName = 'recipe-fullscreen-' + cardId;
            const revert = function() {
                card.classList.remove('is-fullscreen');
                btn.innerHTML = "⛶ Agrandir";
            };
            if (!card.classList.contains('is-fullscreen')) {
                card.classList.add('is-fullscreen');
                btn.innerHTML = "✖ Fermer";
                pushOverlayHistory(overlayName, revert);
            } else {
                closeOverlayOrBack(overlayName, revert);
            }
        }
        let recipeSteps = {};
        function togglePasAPas(btnToggle, textId, stepId, stepsArray) {
            const textView = document.getElementById(textId); const stepView = document.getElementById(stepId);
            if (textView.style.display === "none") { textView.style.display = "block"; stepView.style.display = "none"; btnToggle.innerText = "👀 Mode Pas-à-pas"; btnToggle.setAttribute('aria-pressed', 'false'); }
            else { textView.style.display = "none"; stepView.style.display = "block"; btnToggle.innerText = "📄 Vue complète"; btnToggle.setAttribute('aria-pressed', 'true'); recipeSteps[stepId] = { current: 0, steps: stepsArray }; updateStepDisplayCustom(stepId, recipeSteps[stepId]); }
        }
        function changeStep(stepId, direction) {
            let data = recipeSteps[stepId]; data.current += direction;
            if (data.current < 0) data.current = 0; if (data.current >= data.steps.length) data.current = data.steps.length - 1; 
            updateStepDisplayCustom(stepId, data);
        }
        function updateStepDisplayCustom(containerId, data) {
            const container = document.getElementById(containerId); if(!container) return;
            container.querySelector('.step-counter').innerText = `Étape ${data.current + 1} / ${data.steps.length}`; container.querySelector('.step-text').innerHTML = data.steps[data.current];
            container.querySelectorAll('.btn-step')[0].disabled = (data.current === 0); container.querySelectorAll('.btn-step')[1].disabled = (data.current === data.steps.length - 1);
        }

        async function sauvegarder(btn, titre, contentId) {
            btn.innerText = "⏳..."; btn.disabled = true; let texte = titre + "\n\n" + document.getElementById(contentId).innerText;
            try { await userDb.collection("carnet").add({ recette: texte, date: firebase.firestore.FieldValue.serverTimestamp() }); btn.innerText = "✅ Sauvegardé"; btn.style.background = "#27ae60"; } catch (e) { btn.innerText = "Erreur"; btn.disabled = false; }
        }

        // ============================================================
        // GESTION DES MINUTEURS (MULTI-TIMER)
        // ============================================================
        let activeTimers = {};
        let timerIdCounter = 0;
        let isTimerMuted = false;
        let globalTimerInterval = null;
        let alertLoopInterval = null;
        let titleFlickerInterval = null;
        let titleFlickerState = false;
        let originalDocTitle = document.title;
        let sharedAudioCtx = null;
        let wakeLockSentinel = null;
        let detectedTimersRegistry = {};
        let detectedTimersRegistryCounter = 0;
        const TIMERS_STORAGE_KEY = 'chefIA_activeTimers_v1';
        const WIDGET_COLLAPSE_KEY = 'chefIA_timerWidgetCollapsed';

        function escapeHtml(str) {
            return String(str).replace(/[&<>"']/g, function(c) {
                return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
            });
        }

        function toggleMuteTimers() {
            isTimerMuted = !isTimerMuted;
            let btn = document.getElementById("btnMuteTimers");
            btn.innerText = isTimerMuted ? "🔇" : "🔊";
            btn.setAttribute('aria-label', isTimerMuted ? "Réactiver le son des minuteurs" : "Couper le son des minuteurs");
        }

        function requestNotificationPermission() {
            if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
                Notification.requestPermission();
            }
        }

        function toggleTimerWidget() {
            let widget = document.getElementById("multiTimerWidget");
            widget.classList.toggle("collapsed");
            let btn = document.getElementById("btnToggleTimerWidget");
            let collapsed = widget.classList.contains("collapsed");
            btn.innerText = collapsed ? "▲" : "▼";
            btn.setAttribute('aria-label', collapsed ? "Afficher les minuteurs" : "Masquer les minuteurs");
            try { localStorage.setItem(WIDGET_COLLAPSE_KEY, collapsed ? "1" : "0"); } catch (e) {}
        }

        function addQuickTimer(minutes) {
            startTimer(minutes, `Minuteur ${minutes}m`);
        }

        function addManualTimer() {
            let name = document.getElementById("newTimerName").value || "Chronomètre";
            let m = parseInt(document.getElementById("newTimerMin").value) || 0;
            let s = parseInt(document.getElementById("newTimerSec").value) || 0;
            if (m === 0 && s === 0) return;
            startTimer(m + (s/60), name);
            document.getElementById("newTimerName").value = "";
            document.getElementById("newTimerMin").value = "";
            document.getElementById("newTimerSec").value = "";
            document.getElementById("addTimerForm").style.display = 'none';
            document.getElementById("btnShowAddTimer").style.display = 'block';
        }

        function enrichirTexteChrono(contenu) {
            let detected = [];
            let result = contenu.replace(/(\d+)\s*(min|minute|minutes)/gi, function(match, minutes, unite, offset, string) {
                let beforeStr = string.substring(0, offset);
                let lastPunc = Math.max(beforeStr.lastIndexOf('.'), beforeStr.lastIndexOf('\n'), beforeStr.lastIndexOf(':'));
                let start = lastPunc === -1 ? 0 : lastPunc + 1;
                let before = string.substring(start, offset);

                let afterStr = string.substring(offset + match.length);
                let nextPuncRegex = /[.\n]/;
                let nextPuncMatch = afterStr.match(nextPuncRegex);
                let end = nextPuncMatch ? offset + match.length + nextPuncMatch.index : string.length;
                let after = string.substring(offset + match.length, end);
                
                let contexte = (before + " " + after).trim().replace(/\s+/g, ' ');
                
                let nomTache = contexte;
                
                if (nomTache.length < 3) {
                    nomTache = `Chrono ${minutes}m`;
                }

                detected.push({ minutes: parseFloat(minutes), nom: nomTache });
                
                let escapedNom = nomTache.replace(/'/g, "\\'").replace(/"/g, "&quot;");
                return `<span class="timer-tag" onclick="startTimer(${minutes}, '${escapedNom}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault(); startTimer(${minutes}, '${escapedNom}');}" role="button" tabindex="0" aria-label="Lancer un minuteur de ${match}">⏱️ ${match}</span>`;
            });

            if (detected.length >= 2) {
                let regId = 'dt_' + (++detectedTimersRegistryCounter);
                detectedTimersRegistry[regId] = detected;
                let banner = `<div class="timers-detected-banner"><span>⏱️ ${detected.length} minuteurs détectés dans cette recette</span><button type="button" onclick="lancerMinuteursDetectes('${regId}')">Tout lancer</button></div>`;
                result = banner + result;
            }

            return result;
        }

        function lancerMinuteursDetectes(regId) {
            let list = detectedTimersRegistry[regId];
            if (!list) return;
            list.forEach(t => startTimer(t.minutes, t.nom));
            delete detectedTimersRegistry[regId];
        }

        // --- Boucle de tick unique basée sur horodatage absolu ---
        // (fiable même si l'onglet est mis en arrière-plan / throttlé par le navigateur)
        function ensureGlobalTicker() {
            if (globalTimerInterval) return;
            globalTimerInterval = setInterval(tickAllTimers, 1000);
        }

        function stopGlobalTickerIfIdle() {
            if (Object.keys(activeTimers).length === 0 && globalTimerInterval) {
                clearInterval(globalTimerInterval);
                globalTimerInterval = null;
            }
        }

        function tickAllTimers() {
            let now = Date.now();
            let anyChange = false;
            let justFinished = false;

            for (let id in activeTimers) {
                let timer = activeTimers[id];
                if (timer.paused || timer.finished) continue;

                let remaining = Math.max(0, Math.round((timer.endTime - now) / 1000));
                if (remaining !== timer.remaining) {
                    timer.remaining = remaining;
                    updateTimerDisplay(id);
                    anyChange = true;
                }

                if (remaining <= 0) {
                    timer.finished = true;
                    let el = document.getElementById(`timerItem_${id}`);
                    if (el) el.classList.add("timer-finished");
                    declencherAlerteFinMinuteur(id, timer.name);
                    justFinished = true;
                    anyChange = true;
                }
            }

            if (anyChange) saveTimersToStorage();
            if (justFinished) renderTimersList();
        }

        function updateTimerDisplay(id) {
            let timer = activeTimers[id];
            let el = document.getElementById(`timeDisplay_${id}`);
            if (!el || !timer) return;
            let m = Math.floor(timer.remaining / 60);
            let s = timer.remaining % 60;
            el.innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
        }

        function startTimer(minutes, nom = null) {
            requestNotificationPermission();
            let timeInSeconds = Math.round(parseFloat(minutes) * 60);
            if (timeInSeconds <= 0) return;
            
            if (!nom) nom = `Chrono ${Math.floor(minutes)}m`;

            let isFirstTimer = Object.keys(activeTimers).length === 0;
            let id = "timer_" + (++timerIdCounter);
            let now = Date.now();
            
            let timerObj = {
                id: id,
                name: nom,
                durationSeconds: timeInSeconds,
                endTime: now + timeInSeconds * 1000,
                remaining: timeInSeconds,
                paused: false,
                finished: false
            };
            
            activeTimers[id] = timerObj;
            
            const widget = document.getElementById('multiTimerWidget');
            widget.style.display = 'flex';
            if (isFirstTimer && widget.classList.contains("collapsed")) {
                toggleTimerWidget();
            }
            
            ensureGlobalTicker();
            requestWakeLock();
            renderTimersList();
            updateTimersCount();
            saveTimersToStorage();
            updateAppBadge();
        }

        function removeTimer(id) {
            let timer = activeTimers[id];
            if (!timer) return;

            let canUndo = !timer.finished;
            delete activeTimers[id];

            renderTimersList();
            updateTimersCount();
            saveTimersToStorage();
            updateAppBadge();
            stopGlobalTickerIfIdle();
            releaseWakeLockIfIdle();

            if (!hasUnacknowledgedFinishedTimers()) {
                stopTitleFlicker();
                if (alertLoopInterval) { clearInterval(alertLoopInterval); alertLoopInterval = null; }
            }

            if (canUndo) {
                showUndoToast(timer);
            }
        }

        function showUndoToast(timerSnapshot) {
            let toast = document.getElementById('timerUndoToast');
            if (!toast) return;

            if (window._timerUndoTimeoutId) { clearTimeout(window._timerUndoTimeoutId); }
            window._lastRemovedTimer = timerSnapshot;

            toast.innerHTML = `<span>⏱️ Minuteur "${escapeHtml(timerSnapshot.name)}" supprimé</span><button type="button" onclick="undoRemoveTimer()">Annuler</button>`;
            toast.classList.add('visible');

            window._timerUndoTimeoutId = setTimeout(() => {
                toast.classList.remove('visible');
                window._lastRemovedTimer = null;
            }, 6000);
        }

        function undoRemoveTimer() {
            let snap = window._lastRemovedTimer;
            if (!snap) return;

            activeTimers[snap.id] = snap;
            window._lastRemovedTimer = null;

            let toast = document.getElementById('timerUndoToast');
            if (toast) toast.classList.remove('visible');
            if (window._timerUndoTimeoutId) { clearTimeout(window._timerUndoTimeoutId); }

            const widget = document.getElementById('multiTimerWidget');
            widget.style.display = 'flex';

            ensureGlobalTicker();
            requestWakeLock();
            renderTimersList();
            updateTimersCount();
            saveTimersToStorage();
            updateAppBadge();
        }

        function togglePauseTimer(id) {
            let timer = activeTimers[id];
            if (!timer || timer.finished) return;

            if (timer.paused) {
                timer.endTime = Date.now() + timer.remaining * 1000;
                timer.paused = false;
            } else {
                timer.remaining = Math.max(0, Math.round((timer.endTime - Date.now()) / 1000));
                timer.paused = true;
            }

            renderTimersList();
            saveTimersToStorage();
        }

        function addMinuteToTimer(id) {
            let timer = activeTimers[id];
            if (!timer || timer.finished) return;

            timer.durationSeconds = (timer.durationSeconds || 0) + 60;
            if (timer.paused) {
                timer.remaining += 60;
            } else {
                timer.endTime += 60000;
                timer.remaining = Math.max(0, Math.round((timer.endTime - Date.now()) / 1000));
            }

            renderTimersList();
            saveTimersToStorage();
        }

        function restartTimer(id) {
            let timer = activeTimers[id];
            if (!timer) return;
            let durationMinutes = (timer.durationSeconds || 60) / 60;
            let name = timer.name;
            delete activeTimers[id];
            startTimer(durationMinutes, name);
        }

        function renderTimersList() {
            let listEl = document.getElementById("timersList");
            listEl.innerHTML = "";
            for (let id in activeTimers) {
                let timer = activeTimers[id];
                let remaining = timer.finished ? 0 : (timer.paused ? timer.remaining : Math.max(0, Math.round((timer.endTime - Date.now()) / 1000)));
                let m = Math.floor(remaining / 60);
                let s = remaining % 60;
                let timeStr = `${m}:${s < 10 ? '0' : ''}${s}`;
                
                let item = document.createElement("div");
                let stateClass = timer.finished ? "timer-finished" : (timer.paused ? "timer-paused" : "timer-running");
                item.className = "timer-item " + stateClass;
                item.id = `timerItem_${id}`;
                item.setAttribute("role", "status");

                let nomEchappe = escapeHtml(timer.name);
                let controlsHtml;

                if (timer.finished) {
                    controlsHtml = `
                        <button class="btn-restart" onclick="restartTimer('${id}')" aria-label="Relancer ${nomEchappe}" title="Relancer">🔁</button>
                        <button class="btn-stop" onclick="removeTimer('${id}')" aria-label="Fermer l'alerte de ${nomEchappe}" title="OK">X</button>
                    `;
                } else {
                    controlsHtml = `
                        <button class="btn-add-min" onclick="addMinuteToTimer('${id}')" aria-label="Ajouter une minute à ${nomEchappe}" title="+1 min">+1m</button>
                        <button class="btn-pause" onclick="togglePauseTimer('${id}')" aria-label="${timer.paused ? 'Reprendre' : 'Mettre en pause'} ${nomEchappe}" title="${timer.paused ? 'Reprendre' : 'Pause'}">${timer.paused ? '▶' : '⏸'}</button>
                        <button class="btn-stop" onclick="removeTimer('${id}')" aria-label="Supprimer ${nomEchappe}" title="Supprimer">X</button>
                    `;
                }

                item.innerHTML = `
                    <div class="timer-info">
                        <span class="timer-name">${nomEchappe}</span>
                        <span class="timer-time" id="timeDisplay_${id}">${timeStr}${timer.paused ? ' (Pause)' : ''}</span>
                    </div>
                    <div class="timer-controls">${controlsHtml}</div>
                `;
                listEl.appendChild(item);
            }
            
            if (Object.keys(activeTimers).length === 0) {
                document.getElementById('multiTimerWidget').style.display = 'none';
            }
        }
        
        function updateTimersCount() {
            document.getElementById("activeTimersCount").innerText = Object.keys(activeTimers).length;
        }

        // --- Persistance (survit à un rechargement de page ou une fermeture d'onglet) ---
        function saveTimersToStorage() {
            try {
                let data = {};
                for (let id in activeTimers) {
                    let t = activeTimers[id];
                    data[id] = {
                        name: t.name,
                        durationSeconds: t.durationSeconds,
                        endTime: t.endTime,
                        remaining: t.remaining,
                        paused: t.paused,
                        finished: t.finished
                    };
                }
                localStorage.setItem(TIMERS_STORAGE_KEY, JSON.stringify({ timers: data, counter: timerIdCounter }));
            } catch (e) {}
        }

        function restoreTimersFromStorage() {
            try {
                let raw = localStorage.getItem(TIMERS_STORAGE_KEY);
                if (!raw) return;
                let saved = JSON.parse(raw);
                timerIdCounter = saved.counter || 0;

                for (let id in saved.timers) {
                    let t = saved.timers[id];
                    activeTimers[id] = {
                        id: id,
                        name: t.name,
                        durationSeconds: t.durationSeconds,
                        endTime: t.endTime,
                        remaining: t.remaining,
                        paused: !!t.paused,
                        finished: !!t.finished
                    };
                }

                if (Object.keys(activeTimers).length === 0) return;

                let collapsedPref = localStorage.getItem(WIDGET_COLLAPSE_KEY);
                const widget = document.getElementById('multiTimerWidget');
                widget.style.display = 'flex';
                if (collapsedPref === "0") {
                    widget.classList.remove("collapsed");
                    document.getElementById("btnToggleTimerWidget").innerText = "▼";
                } else {
                    widget.classList.add("collapsed");
                    document.getElementById("btnToggleTimerWidget").innerText = "▲";
                }

                ensureGlobalTicker();
                requestWakeLock();
                tickAllTimers();
                renderTimersList();
                updateTimersCount();
                updateAppBadge();
            } catch (e) {}
        }

        // --- Verrou d'écran (empêche l'écran de s'éteindre pendant qu'un minuteur tourne) ---
        async function requestWakeLock() {
            try {
                if ('wakeLock' in navigator && !wakeLockSentinel) {
                    wakeLockSentinel = await navigator.wakeLock.request('screen');
                    wakeLockSentinel.addEventListener('release', () => { wakeLockSentinel = null; });
                }
            } catch (e) { /* refusé ou non supporté : pas bloquant */ }
        }

        function releaseWakeLockIfIdle() {
            if (Object.keys(activeTimers).length === 0 && wakeLockSentinel) {
                wakeLockSentinel.release().catch(() => {});
                wakeLockSentinel = null;
            }
        }

        // --- Badge PWA (nombre de minuteurs actifs visible sur l'icône de l'app) ---
        function updateAppBadge() {
            if (!('setAppBadge' in navigator)) return;
            try {
                let count = Object.keys(activeTimers).length;
                if (count > 0) navigator.setAppBadge(count).catch(() => {});
                else navigator.clearAppBadge().catch(() => {});
            } catch (e) {}
        }

        // --- Alerte sonore avec AudioContext partagé (évite la fuite de ressources) ---
        function getSharedAudioCtx() {
            if (!sharedAudioCtx) {
                try { sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
            }
            if (sharedAudioCtx.state === 'suspended') { sharedAudioCtx.resume().catch(() => {}); }
            return sharedAudioCtx;
        }

        function playAlertSound() {
            if (isTimerMuted) return;
            try { 
                const audioCtx = getSharedAudioCtx();
                if (!audioCtx) return;
                const osc = audioCtx.createOscillator(); 
                const gain = audioCtx.createGain(); 
                osc.type = 'sine'; 
                osc.frequency.value = 587.33; 
                gain.gain.setValueAtTime(0.5, audioCtx.currentTime); 
                osc.connect(gain); 
                gain.connect(audioCtx.destination); 
                osc.start(); 
                osc.stop(audioCtx.currentTime + 0.8); 
            } catch(e) {}
        }

        function hasUnacknowledgedFinishedTimers() {
            for (let id in activeTimers) {
                if (activeTimers[id].finished) return true;
            }
            return false;
        }

        function ensureAlertLoop() {
            if (alertLoopInterval) return;
            alertLoopInterval = setInterval(() => {
                if (!hasUnacknowledgedFinishedTimers()) {
                    clearInterval(alertLoopInterval);
                    alertLoopInterval = null;
                    return;
                }
                playAlertSound();
                if (navigator.vibrate) navigator.vibrate(300);
            }, 6000);
        }

        function startTitleFlicker() {
            if (titleFlickerInterval) return;
            titleFlickerInterval = setInterval(() => {
                if (!hasUnacknowledgedFinishedTimers()) {
                    stopTitleFlicker();
                    return;
                }
                titleFlickerState = !titleFlickerState;
                document.title = titleFlickerState ? "⏰ C'est prêt !" : originalDocTitle;
            }, 1000);
        }

        function stopTitleFlicker() {
            if (titleFlickerInterval) { clearInterval(titleFlickerInterval); titleFlickerInterval = null; }
            document.title = originalDocTitle;
        }

        function declencherAlerteFinMinuteur(id, nom) {
            if (typeof confetti === "function") { confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 }, zIndex: 9999 }); }
            
            playAlertSound();

            if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300]);
            
            if ("Notification" in window && Notification.permission === "granted") {
                new Notification("⏳ C'est prêt !", {
                    body: `Votre minuteur "${nom}" est terminé !`,
                    icon: "Icone.png"
                });
            }

            if (!isTimerMuted && 'speechSynthesis' in window) { 
                const utterance = new SpeechSynthesisUtterance(`Attention chef, le minuteur ${nom} est écoulé !`); 
                utterance.lang = 'fr-FR'; 
                window.speechSynthesis.speak(utterance); 
            }

            let liveEl = document.getElementById('timerAriaLive');
            if (liveEl) liveEl.textContent = `Le minuteur ${nom} est terminé.`;

            ensureAlertLoop();
            startTitleFlicker();
            updateAppBadge();
        }

        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'visible') {
                tickAllTimers();
                if (Object.keys(activeTimers).length > 0) requestWakeLock();
            }
        });
        // --- NAVIGATION MOBILE (BOTTOM NAV) ---
        // --- GESTION ANDROID : bouton/geste "retour" ferme les fenêtres ouvertes (modales, plein écran)
        // avant de changer de vue, au lieu de quitter l'appli. Chaque overlay pousse une entrée
        // d'historique à l'ouverture ; le bouton retour la consomme et referme l'overlay du dessus.
        window.overlayBackStack = [];
        function pushOverlayHistory(name, closeFn) {
            window.overlayBackStack.push({ name: name, closeFn: closeFn });
            try { history.pushState({ androidOverlay: name }, ''); } catch (e) {}
        }
        function closeOverlayOrBack(name, fallbackCloseFn) {
            const top = window.overlayBackStack[window.overlayBackStack.length - 1];
            if (top && top.name === name) {
                history.back(); // déclenche popstate -> dépile -> exécute fallbackCloseFn
            } else {
                fallbackCloseFn();
            }
        }
        window.addEventListener('popstate', function(event) {
            if (window.overlayBackStack.length > 0) {
                const top = window.overlayBackStack.pop();
                try { top.closeFn(); } catch (e) { console.error(e); }
                return;
            }
            if (event.state && event.state.view) {
                switchView(event.state.view, false);
            } else {
                switchView('home', false);
            }
        });

        function switchView(viewId, pushHistory = true) {
            if (pushHistory) {
                history.pushState({ view: viewId }, '', '#' + viewId);
            }
            // Masquer toutes les vues
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            // Désactiver tous les boutons de la navbar
            document.querySelectorAll('.nav-item').forEach(b => { b.classList.remove('active'); b.removeAttribute('aria-current'); });
            
            // Activer la vue correspondante
            const targetView = document.getElementById('view-' + viewId);
            if (targetView) targetView.classList.add('active');
            
            // Activer le bouton de la navbar
            const targetBtn = document.getElementById('nav-btn-' + viewId);
            if (targetBtn) { targetBtn.classList.add('active'); targetBtn.setAttribute('aria-current', 'page'); }

            // Logique spécifique aux vues pour charger leur contenu depuis les modales/fonctions existantes
            if (viewId === 'favorites') {
                chargerCarnetDansVue();
            } else if (viewId === 'cart') {
                chargerCoursesDansVue();
            } else if (viewId === 'settings') {
                chargerParametresDansVue();
            } else if (viewId === 'results') {
                // Scroll top on results
                targetView.scrollTo({ top: 0, behavior: 'smooth' });
            }
        }

        function chargerCarnetDansVue() {
            chargerCarnet();
        }

        function chargerCoursesDansVue() {
            ouvrirCourses();
        }

        function chargerParametresDansVue() {
            ouvrirParametres();
            // Move parametres if they are still in modal (for backward compatibility if HTML isn't updated)
            const modalBody = document.querySelector('#modalParametres .modal-body');
            const vueDest = document.getElementById('parametresContent');
            if(modalBody && vueDest && vueDest.children.length === 0) {
                while(modalBody.firstChild) vueDest.appendChild(modalBody.firstChild);
            }
            const modalOrig = document.getElementById('modalParametres');
            if(modalOrig) modalOrig.style.display = 'none';
        }
// --- INSTALLATION PWA ---
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btnInstall = document.getElementById('btnInstallPwa');
    if(btnInstall) {
        btnInstall.style.display = 'block';
        btnInstall.addEventListener('click', async () => {
            btnInstall.style.display = 'none';
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            deferredPrompt = null;
        });
    }
});
// --- AFFINAGE DE RECETTES ---
async function affinerRecette(index, titre) {
    const input = document.getElementById('refine-input-' + index);
    const consigne = input.value.trim();
    if (!consigne) {
        showToast("Veuillez entrer une consigne pour affiner la recette.", "error");
        return;
    }
    
    const textDiv = document.getElementById('text-view-' + index);
    const contenuActuel = textDiv.innerText;
    
    input.value = "Affinage en cours... ⏳";
    input.disabled = true;
    
    const moteur = moteurIAActif;
    const prompt = `Voici une recette intitulée "${titre}" :
${contenuActuel}

La demande de modification est : "${consigne}".
Renvoie UNIQUEMENT la recette modifiée, sans introduction ni conclusion, en gardant le même format de liste et d'étapes.`;

    try {
        const apiKey = await getApiKey(moteur);
        if (!apiKey) throw new Error("Clé API manquante");
        
        let texteReponse = "";
        if (moteur === 'gemini') {
            const rep = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=${apiKey}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
            const data = await rep.json();
            if(data.error) throw new Error(data.error.message);
            texteReponse = data.candidates[0].content.parts[0].text;
        } else if (moteur === 'mistral') {
            const rep = await fetch(`https://api.mistral.ai/v1/chat/completions`, {
                method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
                body: JSON.stringify({ model: "mistral-small-latest", messages: [{ role: "user", content: prompt }] })
            });
            const data = await rep.json();
            if(data.error) throw new Error(data.error.message);
            texteReponse = data.choices[0].message.content;
        }
        
        // Formater le nouveau contenu
        let contenuFormate = texteReponse.replace(/[*#]/g, '').trim();
        contenuFormate = enrichirTexteChrono(contenuFormate);
        
        textDiv.innerHTML = contenuFormate.replace(/\n/g, '<br>');
        
        showToast("Recette affinée avec succès ! ✨", "success");
        input.value = "";
    } catch (err) {
        console.error(err);
        showToast("Erreur lors de l'affinage.", "error");
        input.value = consigne;
    } finally {
        input.disabled = false;
    }
}


// --- GESTION DE L'ACCUEIL ET DES INGREDIENTS ---





// Hook dans renderCategories (si on voulait mettre a jour)
// Mais on peut juste appeler mettreAJourResumeIngredients apres le premier chargement.


window.modePlanningContext = false;
window.ouvrirModalCuisson = function(modePlanning = false, jour = 'Lundi', repas = 'diner') {
    window.modePlanningContext = modePlanning;
    document.getElementById('modalCuisson').style.display = 'flex';
    pushOverlayHistory('modalCuisson', fermerModalCuissonReel);

    document.getElementById('humeur').value = prefsCuisineDefaut.humeur;
    document.getElementById('temps').value = prefsCuisineDefaut.temps;
    document.getElementById('personnes').value = prefsCuisineDefaut.personnes;

    const btnGenerer = document.getElementById('btnGenererRecettes');
    const btnRapide = document.getElementById('btnRecetteRapide');
    const planningOptions = document.getElementById('planningOptions');
    
    if(modePlanning) {
        planningOptions.style.display = 'block';
        document.getElementById('planningJour').value = jour;
        document.getElementById('planningRepas').value = repas;
        
        btnGenerer.innerText = "✨ Générer pour ce repas";
        btnGenerer.onclick = function() { fermerModalCuisson(); genererRepasPlanning(); };
        btnRapide.style.display = 'none';
    } else {
        planningOptions.style.display = 'none';
        btnGenerer.innerText = "✨ Inventer mes recettes";
        btnGenerer.onclick = function() { fermerModalCuisson(); chercherRecettesIA(); };
        btnRapide.style.display = 'block';
    }
};
function fermerModalCuissonReel() {
    document.getElementById('modalCuisson').style.display = 'none';
}
window.fermerModalCuisson = function() {
    closeOverlayOrBack('modalCuisson', fermerModalCuissonReel);
};

// --- SERVICE WORKER REGISTRATION FOR PWA ---
window.swRegistrationChefIA = null;

function afficherBanniereMiseAJourDisponible() {
    const toast = document.getElementById('majDisponibleToast');
    if (!toast) { window.location.reload(); return; } // filet de sécurité si le HTML n'est pas à jour
    toast.innerHTML = `<span>✨ Nouvelle version disponible</span><button type="button" onclick="window.location.reload()">Actualiser</button>`;
    toast.classList.add('visible');
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((registration) => {
        console.log('ServiceWorker registration successful with scope: ', registration.scope);
        window.swRegistrationChefIA = registration;

        // Vérifie activement l'existence d'une nouvelle version dès l'ouverture de l'app,
        // au lieu d'attendre la vérification automatique (différée) du navigateur — totalement
        // silencieux pour l'utilisateur tant qu'aucune mise à jour n'est trouvée.
        registration.update();

        // Revérifie aussi quand l'app repasse au premier plan (retour depuis un autre onglet/app),
        // et périodiquement tant que l'app reste ouverte (toutes les 30 min).
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') registration.update();
        });
        setInterval(() => registration.update(), 30 * 60 * 1000);
      }, (err) => {
        console.log('ServiceWorker registration failed: ', err);
      });

    // Dès qu'un nouveau Service Worker prend le contrôle de la page (mise à jour installée),
    // on prévient l'utilisateur avec une petite bannière plutôt que de recharger de force :
    // s'il est en train de saisir quelque chose, on ne veut pas lui faire perdre sa saisie.
    // Il suffit d'un tap pour passer à la nouvelle version ; sinon, elle s'appliquera
    // automatiquement à sa prochaine ouverture de l'app.
    let bannièreDéjàAffichée = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (bannièreDéjàAffichée) return;
        bannièreDéjàAffichée = true;
        afficherBanniereMiseAJourDisponible();
    });
  });
}


// ============================================================
// ACCESSIBILITÉ — gestion générique des modales
// (focus à l'ouverture/fermeture, fond masqué aux lecteurs d'écran,
//  fermeture au clavier avec la touche Echap)
// ============================================================
(function initModalAccessibility() {
    const appContent = document.getElementById('appContent');
    const overlays = document.querySelectorAll('.modal-overlay');
    let dernierElementFocus = null;

    function elementsFocusables(container) {
        return container.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    }

    overlays.forEach(overlay => {
        const observer = new MutationObserver(() => {
            const estOuverte = getComputedStyle(overlay).display !== 'none';
            if (estOuverte) {
                dernierElementFocus = document.activeElement;
                if (appContent) { appContent.setAttribute('aria-hidden', 'true'); try { appContent.inert = true; } catch (e) {} }
                const focusables = elementsFocusables(overlay);
                if (focusables.length) focusables[0].focus();
            } else {
                if (appContent) { appContent.removeAttribute('aria-hidden'); try { appContent.inert = false; } catch (e) {} }
                if (dernierElementFocus && typeof dernierElementFocus.focus === 'function') dernierElementFocus.focus();
            }
        });
        observer.observe(overlay, { attributes: true, attributeFilter: ['style'] });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const boutonAnnulerOuvert = document.querySelector('.confirm-overlay.show .btn-cancel');
        if (boutonAnnulerOuvert) { boutonAnnulerOuvert.click(); return; }
        if (window.overlayBackStack && window.overlayBackStack.length > 0) { history.back(); return; }
        const modaleOuverte = Array.from(document.querySelectorAll('.modal-overlay')).find(o => getComputedStyle(o).display !== 'none');
        if (modaleOuverte) modaleOuverte.style.display = 'none';
    });
})();

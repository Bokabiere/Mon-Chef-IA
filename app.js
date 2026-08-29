const firebaseConfig = {
          apiKey: "AIzaSyBKgPJY1X6tYujXpsEG19fHs08nZpbXndM",
          authDomain: "mon-chef-ia-80143.firebaseapp.com",
          projectId: "mon-chef-ia-80143",
          storageBucket: "mon-chef-ia-80143.firebasestorage.app",
          messagingSenderId: "395042994130",
          appId: "1:395042994130:web:c1cec40bcbaf61b0bfba0b"
        };
        firebase.initializeApp(firebaseConfig);
        const db = firebase.firestore();
        
        let userDb = null;
        let globalIngredientsList = {};
        let memoireIngredients = [];
        let memoireAllergenes = [];
        let memoireRegimes = [];
        let moteurIAActif = "gemini";
        let unsubscribeCourses = null;
        let isAdminUser = false;

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

        firebase.auth().onAuthStateChanged(async function(user) {
            if (user) {
                const userRef = db.collection("utilisateurs").doc(user.uid);
                try {
                    const docSnap = await userRef.get();
                    let userData = {};
                    isAdminUser = (user.email === "bokabiere@gmail.com");

                    if (!docSnap.exists) {
                        userData = {
                            email: user.email,
                            nom: user.displayName || "Utilisateur",
                            statut: isAdminUser ? "valide" : "en_attente",
                            role: isAdminUser ? "admin" : "membre",
                            dateInscription: firebase.firestore.FieldValue.serverTimestamp()
                        };
                        await userRef.set(userData);
                    } else {
                        userData = docSnap.data();
                        // Si vous êtes l'admin mais que le statut n'était pas 'valide', on force
                        if (isAdminUser && userData.statut !== "valide") {
                            userData.statut = "valide";
                            userData.role = "admin";
                            await userRef.update({ statut: "valide", role: "admin" });
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
                const overlay = document.createElement('div');
                overlay.className = 'confirm-overlay';
                overlay.innerHTML = `<div class="confirm-box"><p>${message}</p><div class="confirm-actions"><button class="btn-cancel">${texteAnnuler}</button><button class="btn-ok ${danger ? 'danger' : ''}">${texteOk}</button></div></div>`;
                document.body.appendChild(overlay);
                requestAnimationFrame(() => overlay.classList.add('show'));
                const fermer = (result) => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); resolve(result); };
                overlay.querySelector('.btn-cancel').onclick = () => fermer(false);
                overlay.querySelector('.btn-ok').onclick = () => fermer(true);
                overlay.onclick = (e) => { if (e.target === overlay) fermer(false); };
            });
        }

        function showPrompt(message, placeholder = '') {
            return new Promise((resolve) => {
                const overlay = document.createElement('div');
                overlay.className = 'confirm-overlay';
                overlay.innerHTML = `<div class="confirm-box"><p>${message}</p><input type="text" class="prompt-input" placeholder="${placeholder}"><div class="confirm-actions"><button class="btn-cancel">Annuler</button><button class="btn-ok">Valider</button></div></div>`;
                document.body.appendChild(overlay);
                requestAnimationFrame(() => overlay.classList.add('show'));
                const input = overlay.querySelector('.prompt-input');
                input.focus();
                const fermer = (result) => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); resolve(result); };
                overlay.querySelector('.btn-cancel').onclick = () => fermer(null);
                overlay.querySelector('.btn-ok').onclick = () => fermer(input.value.trim() || null);
                input.addEventListener('keydown', (e) => { if (e.key === 'Enter') fermer(input.value.trim() || null); });
                overlay.onclick = (e) => { if (e.target === overlay) fermer(null); };
            });
        }

        async function getApiKey(provider = 'gemini') {
            let keyName = provider + '_api_key';
            let key = localStorage.getItem(keyName);
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

        async function chargerInterfaceBase() {
            try {
                const user = firebase.auth().currentUser;
                if(user) {
                    const userDoc = await userDb.get();
                    if(userDoc.exists) {
                        memoireIngredients = userDoc.data().ingredients || [];
                        memoireAllergenes = userDoc.data().allergenes || [];
                        memoireRegimes = userDoc.data().regimes || [];
                        moteurIAActif = userDoc.data().moteurIA || "gemini";
                        
                        const selectGlobal = document.getElementById('selecteurIaGlobal');
                        if(selectGlobal) selectGlobal.value = moteurIAActif;
                    }
                }
                
                let docRef = db.collection("config").doc("ingredients");
                let docSnap = await docRef.get();
                if (docSnap.exists) { globalIngredientsList = docSnap.data(); }
                
                afficherIngredientsGauche();
                chargerAllergenesUI();
                chargerRegimesUI();

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

        const iconesIngredients = {
            "Tomate": "🍅", "Carotte": "🥕", "Courgette": "🥒", "Aubergine": "🍆", "Oignon": "🧅", "Ail": "🧄",
            "Oeufs": "🥚", "Poulet": "🍗", "Boeuf haché": "🥩", "Pâtes": "🍝", "Riz blanc": "🍚", "Pomme de terre": "🥔",
            "Sauce tomate": "🥫", "Sauce soja": "🍾", "Moutarde": "🟡", "Fromage": "🧀", "Lait": "🥛"
        };

        function afficherIngredientsGauche() {
            const container = document.getElementById('categoriesContainer');
            container.innerHTML = "";
            const sortedCats = Object.keys(globalIngredientsList).sort();

            for (const cat of sortedCats) {
                let items = globalIngredientsList[cat];
                if (!items || items.length === 0) continue;
                items.sort();
                const nbCochesCat = items.filter(i => memoireIngredients.includes(i)).length;
                const badgeCompteur = nbCochesCat > 0 ? `<span style="background:var(--primary); color:white; font-size:10px; padding:3px 7px; border-radius:12px; margin-left:8px; vertical-align: middle;">${nbCochesCat}</span>` : '';

                let html = `<details class="cat-details"><summary style="display:flex; align-items:center;">${cat} ${badgeCompteur}</summary><div class="ingredient-list">`;
                items.forEach(item => {
                    const isChecked = memoireIngredients.includes(item) ? "checked" : "";
                    const icone = iconesIngredients[item] || "🍴";
                    html += `<label class="ingredient-item"><input type="checkbox" value="${item}" class="chk-ingredient" ${isChecked}><span>${icone} ${item}</span></label>`;
                });
                html += `</div></details>`;
                container.innerHTML += html;
            }
            updateButtonLabel();
        }

        function updateButtonLabel() {
            const btn = document.getElementById('btnGenererRecettes');
            if (!btn) return;
            const n = document.querySelectorAll('.chk-ingredient:checked').length;
            btn.innerText = n > 0 ? `✨ Inventer mes recettes (${n} ingrédient${n > 1 ? 's' : ''})` : "✨ Inventer mes recettes";
        }

        function decocherTout() { 
            document.querySelectorAll('.chk-ingredient:checked').forEach(cb => cb.checked = false); 
            memoireIngredients = []; syncCloud('ingredients', memoireIngredients);
            updateButtonLabel(); afficherIngredientsGauche(); 
        }

        function filtrerIngredients(terme) {
            const resDiv = document.getElementById('autocompleteResults');
            terme = terme.trim().toLowerCase();
            if(!terme) { resDiv.style.display = 'none'; return; }
            let matches = [];
            for(const cat in globalIngredientsList) {
                globalIngredientsList[cat].forEach(ing => {
                    if(ing.toLowerCase().includes(terme)) matches.push({ nom: ing, cat: cat });
                });
            }
            if(matches.length === 0) { resDiv.style.display = 'none'; return; }
            let html = "";
            matches.forEach(m => {
                const icone = iconesIngredients[m.nom] || "🍴";
                html += `<div class="autocomplete-item" onclick="selectionnerIngredientAutocomplete('${m.nom}')">${icone} <b>${m.nom}</b> <span style="font-size:10px; color:var(--text-muted);">(${m.cat})</span></div>`;
            });
            resDiv.innerHTML = html; resDiv.style.display = 'block';
        }

        function selectionnerIngredientAutocomplete(nom) {
            document.getElementById('ingredientSearch').value = "";
            document.getElementById('autocompleteResults').style.display = 'none';
            document.querySelectorAll('.chk-ingredient').forEach(cb => {
                if(cb.value === nom) {
                    cb.checked = true;
                    let details = cb.closest('details');
                    if(details) details.open = true;
                    cb.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });
            memoireIngredients = Array.from(document.querySelectorAll('.chk-ingredient:checked')).map(c => c.value);
            syncCloud('ingredients', memoireIngredients);
            updateButtonLabel(); afficherIngredientsGauche(); 
        }

        function ouvrirParametres() { 
             
            chargerListeManageIng(); 
            if (isAdminUser) chargerDemandesAcces();
        }
        
        function fermerParametres() { document.getElementById('modalParametres').style.display = 'none'; }
        
        function switchTab(tab) {
            const tabs = ['tabIng', 'tabCarnet', 'tabTheme', 'tabAllergene', 'tabOptions', 'tabAdmin'];
            tabs.forEach(t => {
                const btn = document.getElementById(t + 'Btn'); const content = document.getElementById(t);
                if(btn) btn.classList.remove('active'); if(content) content.style.display = 'none';
            });
            const activeBtn = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1) + 'Btn');
            const activeContent = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
            if(activeBtn) activeBtn.classList.add('active'); if(activeContent) activeContent.style.display = 'block';
            
            if(tab === 'ing') chargerListeManageIng(); 
            if(tab === 'carnet') chargerListeManageCarnet(); 
            if(tab === 'allergene') { chargerAllergenesUI(); chargerRegimesUI(); }
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
                document.querySelectorAll('.chk-ingredient').forEach(cb => { if (texte.includes(cb.value.toLowerCase())) cb.checked = true; });
                memoireIngredients = Array.from(document.querySelectorAll('.chk-ingredient:checked')).map(c => c.value);
                syncCloud('ingredients', memoireIngredients); updateButtonLabel(); afficherIngredientsGauche(); 
            };
            recognition.onerror = function() { btn.classList.remove('listening'); btn.innerText = "🎙️ Dicter"; };
            recognition.start();
        }

        async function ajouterCourse(btn, ingredient) {
            btn.innerText = "⏳"; btn.disabled = true;
            try { 
                await userDb.collection("courses").add({ ingredient: ingredient, checked: false, date: firebase.firestore.FieldValue.serverTimestamp() }); 
                btn.innerText = "✅"; btn.style.background = "#27ae60"; 
                const navBtn = document.getElementById('btnNavCourses'); navBtn.classList.remove('animate-cart'); void navBtn.offsetWidth; navBtn.classList.add('animate-cart');
            } catch (e) { btn.innerText = "❌"; }
        }

        async function ajouterCourseManuelle() {
            const input = document.getElementById('inputCourseManuelle'); const ingredient = input.value.trim();
            if(!ingredient) return;
            try {
                await userDb.collection("courses").add({ ingredient: ingredient.charAt(0).toUpperCase() + ingredient.slice(1), checked: false, date: firebase.firestore.FieldValue.serverTimestamp() });
                input.value = "";
            } catch(e) { showToast("Erreur lors de l'ajout", "error"); }
        }

        function ouvrirCourses() {
            const contentDiv = document.getElementById('listeCoursesContent'); contentDiv.innerHTML = "<p style='text-align:center;'>Chargement...</p>";
            if(unsubscribeCourses) unsubscribeCourses();
            unsubscribeCourses = userDb.collection("courses").orderBy("date", "desc").onSnapshot((snapshot) => {
                if(snapshot.empty) return contentDiv.innerHTML = "<p style='text-align:center; padding: 20px; color:var(--text-muted);'>Votre liste est vide. 🎉</p>";
                let htmlAcheter = ""; let htmlCaddie = ""; let hasCaddie = false;
                snapshot.forEach(doc => {
                    const item = doc.data(); const isChecked = item.checked === true;
                    let itemHtml = `<div class="course-item ${isChecked ? 'checked' : ''}" onclick="checkerCourse('${doc.id}', ${isChecked})"><div class="circle-check"></div><span style="font-size: 15px; font-weight:500;">${item.ingredient}</span></div>`;
                    if (isChecked) { htmlCaddie += itemHtml; hasCaddie = true; } else { htmlAcheter += itemHtml; }
                });
                let finalHtml = htmlAcheter;
                if (hasCaddie) { finalHtml += `<div class="caddie-divider">🛒 Dans le caddie</div>` + htmlCaddie; finalHtml += `<button class="btn-danger" style="width:100%; margin-top:15px; padding:15px; font-size:14px; font-weight:bold;" onclick="viderCaddie()">🗑️ Jeter les articles du caddie</button>`; }
                if(!htmlAcheter && hasCaddie) { finalHtml = "<p style='text-align:center; padding: 20px; color:var(--primary); font-weight:bold;'>Tout est dans le caddie ! 🎯</p>" + finalHtml; }
                contentDiv.innerHTML = finalHtml;
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
                const docSnap = await userDb.collection("planning").doc("semaine").get();
                if (docSnap.exists) { afficherPlanningHtml(docSnap.data()); } else { genererNouveauPlanning(); }
            } catch (e) { contentDiv.innerHTML = "<p style='color:red;'>Erreur.</p>"; }
        }

        function afficherPlanningHtml(planningObj) {
            const contentDiv = document.getElementById('planningContent'); let html = `<div class="planning-grid">`;
            const jours = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
            jours.forEach(jour => {
                html += `<div class="day-card"><div class="day-title">${jour}</div><div class="meal-block empty"><span class="meal-label">Déjeuner</span><div style="font-size:12px; color:var(--text-muted);">+ Choisir une recette</div></div>`;
                if(planningObj[jour]) {
                    let plat = planningObj[jour]; let safePlat = plat.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    html += `<div class="meal-block filled"><span class="meal-label">Dîner</span><div class="meal-name">${plat}</div><div class="meal-actions"><button class="btn-action" style="background:#6c5ce7; padding: 4px 8px; font-size: 11px; flex:1;" onclick="relancerJour('${jour}', '${safePlat}')">🎲 Autre</button><button class="btn-action btn-expand" style="padding: 4px 8px; font-size: 11px; flex:1;" onclick="cuisinerCePlat('${safePlat}')">🍳 Cuisiner</button></div></div>`;
                } else { html += `<div class="meal-block empty"><span class="meal-label">Dîner</span><div style="font-size:12px; color:var(--text-muted);">+ Choisir une recette</div></div>`; }
                html += `</div>`;
            });
            html += `</div><button class="btn-danger" style="margin-top:20px; width:100%; padding: 12px; font-size: 14px;" onclick="genererNouveauPlanning()">🔄 Réinitialiser et générer une nouvelle semaine</button>`;
            contentDiv.innerHTML = html;
        }

        async function genererNouveauPlanning() {
            const contentDiv = document.getElementById('planningContent');
            const checked = Array.from(document.querySelectorAll('.chk-ingredient:checked')).map(c => c.value);
            if (checked.length === 0) return contentDiv.innerHTML = "<p style='text-align:center; color:#d63031; padding: 20px;'>Cochez quelques ingrédients pour planifier.</p>";
            contentDiv.innerHTML = `<div class="loader" style="display:block; margin-top:5vh;"><div class="loader-spinner"></div><p style="margin-top:20px;">Création du menu...</p></div>`;
            const moteur = moteurIAActif;

            const historique = await getHistoriquePrompt();
            const prompt = `Génère un menu simple pour 7 jours en utilisant en priorité absolue ces ingrédients possédés : ${checked.join(", ")}. (Ne tiens PAS compte des épices, du sel, du poivre, des huiles ou des condiments de base, pars du principe qu'ils sont toujours disponibles). ${getAllergenesPrompt()} ${getRegimesPrompt()} ${historique}
            Format STRICT requis (un par ligne) :
            Lundi: [Plat]
            Mardi: [Plat]
            Mercredi: [Plat]
            Jeudi: [Plat]
            Vendredi: [Plat]
            Samedi: [Plat]
            Dimanche: [Plat]`;

            try {
                const apiKey = await getApiKey(moteur);
                if (!apiKey) { contentDiv.innerHTML = ""; showToast(`Clé API ${moteur} requise.`, "error"); return; }
                let texte = "";
                if (moteur === 'gemini') {
                    const rep = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
                    const data = await rep.json(); texte = data.candidates[0].content.parts[0].text;
                } else if (moteur === 'mistral') {
                    const rep = await fetch(`https://api.mistral.ai/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, body: JSON.stringify({ model: "mistral-small-latest", messages: [{ role: "user", content: prompt }] }) });
                    const data = await rep.json(); texte = data.choices[0].message.content;
                }

                let lignes = texte.split('\n').filter(l => l.includes(':')); let planningObj = {};
                lignes.forEach(l => { let parts = l.split(':'); planningObj[parts[0].trim()] = parts[1].trim(); });
                await userDb.collection("planning").doc("semaine").set(planningObj);
                afficherPlanningHtml(planningObj);
            } catch (e) { afficherErreurIA(contentDiv, e, moteur); }
        }

        async function relancerJour(jour, platActuel) {
            const contentDiv = document.getElementById('planningContent');
            const checked = Array.from(document.querySelectorAll('.chk-ingredient:checked')).map(c => c.value);
            contentDiv.innerHTML = `<div class="loader" style="display:block; margin-top:5vh;"><div class="loader-spinner"></div><p style="margin-top:20px;">Recherche pour ${jour}...</p></div>`;
            const moteur = moteurIAActif;

            const prompt = `L'utilisateur ne veut pas de "${platActuel}" ce ${jour}. Propose UN SEUL nouveau plat en utilisant les ingrédients possédés : ${checked.join(", ")} (hors épices/condiments). ${getAllergenesPrompt()} ${getRegimesPrompt()} Réponds UNIQUEMENT avec le nom du plat.`;

            try {
                const apiKey = await getApiKey(moteur);
                if (!apiKey) { showToast(`Clé API requise pour ${moteur}.`, "error"); chargerPlanning(); return; }
                let texte = "";
                if (moteur === 'gemini') {
                    const rep = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
                    const data = await rep.json(); texte = data.candidates[0].content.parts[0].text;
                } else if (moteur === 'mistral') {
                    const rep = await fetch(`https://api.mistral.ai/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, body: JSON.stringify({ model: "mistral-small-latest", messages: [{ role: "user", content: prompt }] }) });
                    const data = await rep.json(); texte = data.choices[0].message.content;
                }

                let nouveauPlat = texte.trim().replace(/[*#]/g, '');
                await userDb.collection("planning").doc("semaine").update({ [jour]: nouveauPlat });
                const docSnap = await userDb.collection("planning").doc("semaine").get();
                afficherPlanningHtml(docSnap.data());
            } catch(e) { const { titre, detail } = messageErreurIA(e, moteur); showToast(`${titre} ${detail}`, "error", 5000); chargerPlanning(); }
        }

        function garantirBoutonRegenerer(html) {
            if (html.includes('regenererRecette')) return html;
            return `<div style="display:flex; align-items:center; justify-content:flex-end; margin-bottom:10px;"><button class="btn-top" onclick="regenererRecette(this)">🔄 Une autre recette</button></div>` + html;
        }

        async function cuisinerCePlat(nomDuPlat) {
            document.getElementById('modalPlanning').style.display = 'none';
            const personnes = document.getElementById('personnes').value;
            const resDiv = document.getElementById('resultatDiv'); const loader = document.getElementById('loader');
            const moteur = moteurIAActif;
            
            const cacheKey = `plat_${nomDuPlat}_${personnes}_${moteur}`.replace(/\s+/g, '_').toLowerCase();
            switchView('results');

            const historique = await getHistoriquePrompt();
            const prompt = `Cuisiner : "${nomDuPlat}". Recette détaillée pour ${personnes} pers. ${getAllergenesPrompt()} ${getRegimesPrompt()} ${historique}
            1. Séparer avec '---RECETTE---'. 2. 1ère ligne = émoji + TITRE. 3. Ingrédients manquants ? Finir par : "COURSES: ingrédient1, ingrédient2". 4. Durées en chiffres (15 min). Pas de Markdown.`;
            const titleTemplate = `Voici la recette pour : ${nomDuPlat} 🍽️`;

            const requestContext = { prompt, titleTemplate, cacheKey, moteur };
            window._lastRecipeRequest = requestContext; localStorage.setItem('chef_ia_last_request', JSON.stringify(requestContext));

            const cachedData = getCache(cacheKey);
            if (cachedData) { resDiv.innerHTML = garantirBoutonRegenerer(cachedData); showToast("⚡ Recette chargée depuis le cache !", "success"); return; }
            resDiv.innerHTML = ""; loader.style.display = "block"; executerRequeteIA(prompt, titleTemplate, cacheKey);
        }

        function lancerRecetteRapide() {
            const checked = Array.from(document.querySelectorAll('.chk-ingredient:checked')).map(c => c.value);
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
            const checked = Array.from(document.querySelectorAll('.chk-ingredient:checked')).map(c => c.value);
            if (checked.length === 0) return showToast("Sélectionnez au moins un ingrédient !", "error");
            
            const humeur = optionsForcees ? optionsForcees.humeur : document.getElementById('humeur').value;
            const personnes = optionsForcees ? optionsForcees.personnes : document.getElementById('personnes').value;
            const temps = optionsForcees ? optionsForcees.temps : document.getElementById('temps').value;
            const moteur = moteurIAActif;
            
            const cacheKey = `recettes_v2_${humeur}_${temps}_${personnes}_${moteur}_${checked.sort().join('_')}`.toLowerCase();
            const resDiv = document.getElementById('resultatDiv'); const loader = document.getElementById('loader');
            switchView('results');
            
            const historique = await getHistoriquePrompt();
            const prompt = `Génère OBLIGATOIREMENT 3 recettes distinctes et différentes pour ${personnes} personnes. Temps imparti : ${temps}. Dispo : ${checked.join(", ")} (hors épices/condiments de base). Style : ${humeur}. ${getAllergenesPrompt()} ${getRegimesPrompt()} ${historique}

Règles de formatage ABSOLUES :
1. Sépare chaque recette de manière stricte en écrivant exactement ---RECETTE--- entre elles. Ne mets AUCUN texte d'introduction ni de conclusion.
2. La TOUTE PREMIÈRE ligne de chaque recette doit commencer par un émoji suivi du TITRE du plat.
3. Si un ingrédient non coché est nécessaire, termine la recette par la ligne exacte : "COURSES: ingrédient1, ingrédient2".
4. Indique toutes les durées en chiffres (ex: 15 min). Pas de blabla inutile avant ou après les recettes.`;
            const titleTemplate = "J'ai trouvé {N} idées pour vous ! (Fraîches)";

            const requestContext = { prompt, titleTemplate, cacheKey, moteur };
            window._lastRecipeRequest = requestContext; localStorage.setItem('chef_ia_last_request', JSON.stringify(requestContext));

            const cachedData = getCache(cacheKey);
            if (cachedData) { resDiv.innerHTML = garantirBoutonRegenerer(cachedData); showToast("⚡ Recettes chargées depuis le cache !", "success"); return; }
            resDiv.innerHTML = ""; loader.style.display = "block"; executerRequeteIA(prompt, titleTemplate, cacheKey);
        }

        async function executerRequeteIA(prompt, titleTemplate, cacheKey = null) {
            const resDiv = document.getElementById('resultatDiv'); const loader = document.getElementById('loader');
            const moteur = moteurIAActif;
            
            const requestContext = { prompt, titleTemplate, cacheKey, moteur };
            window._lastRecipeRequest = requestContext; localStorage.setItem('chef_ia_last_request', JSON.stringify(requestContext));

            try {
                const apiKey = await getApiKey(moteur);
                if (!apiKey) { loader.style.display = "none"; showToast(`Clé API ${moteur} requise.`, "error"); return; }
                
                let texteReponse = "";

                if (moteur === 'gemini') {
                    const rep = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
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

                loader.style.display = "none";

                let blocs = texteReponse.split(/-{2,}\s*RECETTE\s*-{2,}/i).filter(b => b.trim().length > 50);
                let mainTitle = titleTemplate.replace('{N}', blocs.length);
                let html = `<div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-bottom:10px;"><h3 style="margin:0;">${mainTitle}</h3><button class="btn-top" onclick="regenererRecette(this)">🔄 Une autre recette</button></div>`;
                
                blocs.forEach((bloc, index) => {
                    bloc = bloc.trim(); let iSaut = bloc.indexOf('\n');
                    let titre = bloc.substring(0, iSaut).trim().replace(/[*#]/g, ''); let contenu = bloc.substring(iSaut).trim().replace(/[*#]/g, '');
                    
                    let coursesMatch = contenu.match(/COURSES:\s*(.*)/i);
                    if (coursesMatch) {
                        let items = coursesMatch[1].split(',').map(i => i.trim());
                        let coursesUI = `<div class="courses-box"><b>🛒 Il vous manque :</b><ul style="padding-left: 20px; margin-top:10px;">`;
                        items.forEach(item => { coursesUI += `<li>${item} <button class="btn-course" onclick="ajouterCourse(this, '${item.replace(/'/g, "\\'")}')">➕ Ajouter</button></li>`; });
                        coursesUI += `</ul></div>`; contenu = contenu.replace(coursesMatch[0], coursesUI);
                    }
                    contenu = contenu.replace(/(\d+)\s*(min|minute|minutes)/gi, `<span class="timer-tag" onclick="startTimer($1)">⏱️ $1 min</span>`);
                    let safeTitre = titre.replace(/'/g, "\\'"); let rawSteps = contenu.split('\n').filter(line => line.trim().length > 15).map(line => line.replace(/'/g, "\\'").replace(/"/g, '&quot;'));
                    let stepsArrayString = `['${rawSteps.join("','")}']`;

                    html += `<details class="recipe-card" id="card-${index}" ${index === 0 ? 'open' : ''}><summary>${titre}</summary><div class="recipe-content"><button class="toggle-view" onclick="togglePasAPas(this, 'text-view-${index}', 'step-view-${index}', ${stepsArrayString})">👀 Mode Pas-à-pas</button><div id="text-view-${index}" class="text-view">${contenu.replace(/\n/g, '<br>')}</div><div id="step-view-${index}" class="pas-a-pas-container"><div style="color:var(--primary); font-weight:bold;" class="step-counter">Étape 1</div><div class="step-text">Contenu</div><div class="step-controls"><button class="btn-step" onclick="changeStep('${index}', -1)">⬅️</button><button class="btn-step" onclick="changeStep('${index}', 1)">➡️</button></div></div><div class="recipe-actions"><button class="btn-action btn-save" onclick="sauvegarder(this, '${safeTitre}', 'text-view-${index}')">💾 Sauvegarder</button><button class="btn-action btn-expand" onclick="toggleExpand('card-${index}', this)">⛶ Agrandir</button><div style="width:100%; margin-top:10px; display:flex; gap:10px;"><input type="text" id="refine-input-${index}" placeholder="Ex: Version vegan, sans four..." style="flex:1; padding:8px; border:1px solid var(--border); border-radius:6px; background:var(--bg-color); color:var(--text-main); font-size:13px;"><button class="btn-action" style="background:var(--accent);" onclick="affinerRecette('${index}', '${safeTitre}')">✨ Affiner</button></div></div></div></details>`;
                });
                
                resDiv.innerHTML = html;
                if (typeof confetti === "function") confetti({ particleCount: 60, spread: 60, origin: { y: 0.9 }, zIndex: 100 });
                if (cacheKey) setCache(cacheKey, html); 
            } catch (e) { loader.style.display = "none"; afficherErreurIA(resDiv, e, moteur); }
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
            
            try { await executerRequeteIA(promptRegen, titleTemplate, nouveauCacheKey); } 
            catch (e) { afficherErreurIA(resDiv, e, context.moteur); loader.style.display = "none"; }
            if (loaderText) loaderText.innerText = "Le Chef élabore vos menus...";
        }

        async function chargerCarnet() {
            const contentDiv = document.getElementById('carnetRecettesList'); contentDiv.innerHTML = "<p style='text-align:center;'>Chargement...</p>";
            try {
                const snapshot = await userDb.collection("carnet").orderBy("date", "desc").get();
                if (snapshot.empty) return contentDiv.innerHTML = `<h3 style="text-align:center;">Votre carnet est vide !</h3>`;
                let html = ""; let index = 0;
                snapshot.forEach(doc => {
                    const item = doc.data(); let bloc = item.recette; let iSaut = bloc.indexOf('\n'); let titre = bloc.substring(0, iSaut).trim().replace(/[*#]/g, ''); let contenu = bloc.substring(iSaut).trim().replace(/[*#]/g, ''); let dateStr = item.date ? item.date.toDate().toLocaleDateString() : ""; let note = item.note || 0;
                    contenu = contenu.replace(/(\d+)\s*(min|minute|minutes)/gi, `<span class="timer-tag" onclick="startTimer($1)">⏱️ $1 min</span>`);
                    let rawSteps = contenu.split('\n').filter(line => line.trim().length > 15).map(line => line.replace(/'/g, "\\'").replace(/"/g, '&quot;')); let stepsArrayString = `['${rawSteps.join("','")}']`;
                    let starsHtml = `<div class="rating-stars" data-doc="${doc.id}">`; for (let n = 1; n <= 5; n++) { starsHtml += `<span class="star ${n <= note ? 'filled' : ''}" onclick="noterRecette('${doc.id}', ${n})">★</span>`; } starsHtml += `<span class="rating-label">${note > 0 ? 'Votre note' : 'Notez cette recette'}</span></div>`;
                    html += `<details class="recipe-card" id="carnet-card-${index}"><summary>${titre} <span style="font-size:12px; color:var(--text-muted); margin-left:10px;">(${dateStr})</span></summary><div class="recipe-content">${starsHtml}<button class="toggle-view" onclick="togglePasAPas(this, 'carnet-text-${index}', 'carnet-step-${index}', ${stepsArrayString})">👀 Mode Pas-à-pas</button><div id="carnet-text-${index}" class="text-view">${contenu.replace(/\n/g, '<br>')}</div><div id="carnet-step-${index}" class="pas-a-pas-container"><div style="color:var(--primary); font-weight:bold;" class="step-counter">Étape 1</div><div class="step-text">Contenu</div><div class="step-controls"><button class="btn-step" onclick="changeStep('carnet-${index}', -1)">⬅️</button><button class="btn-step" onclick="changeStep('carnet-${index}', 1)">➡️</button></div></div><div class="recipe-actions"><button class="btn-action btn-expand" onclick="toggleExpand('carnet-card-${index}', this)">⛶ Agrandir</button></div></div></details>`;
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
                    const rep = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ contents: [{ parts: [{ text: promptText }, { inlineData: { mimeType: file.type || "image/jpeg", data: base64String } }] }] })
                    });
                    const data = await rep.json(); loader.style.display = "none";
                    if(data.error) throw new Error(data.error.message);
                    const text = data.candidates[0].content.parts[0].text;
                    const itemsTrouves = text.split(',').map(i => i.trim()).filter(i => i.length > 1);
                    if (itemsTrouves.length === 0) return resDiv.innerHTML = "<h3 style='text-align:center;'>Aucun ingrédient détecté.</h3>";
                    const existingCheckboxes = Array.from(document.querySelectorAll('.chk-ingredient')); let htmlList = ""; window.scanPendingItems = [];
                    itemsTrouves.forEach(item => {
                        const match = existingCheckboxes.find(cb => cb.value.toLowerCase().includes(item.toLowerCase()) || item.toLowerCase().includes(cb.value.toLowerCase()));
                        const nomExact = match ? match.value : item.charAt(0).toUpperCase() + item.slice(1);
                        htmlList += `<div class="scan-result-item"><span>${nomExact} ${match ? '✅' : '🆕'}</span><input type="checkbox" checked value="${nomExact}" class="pending-scan-chk"></div>`;
                    });
                    document.getElementById('iaScanResults').innerHTML = htmlList; document.getElementById('modalIAScanner').style.display = 'flex'; event.target.value = "";
                } catch (e) { loader.style.display = "none"; afficherErreurIA(resDiv, e, 'gemini'); }
            };
            reader.readAsDataURL(file);
        }

        function validerScanIA() {
            const confirmedItems = Array.from(document.querySelectorAll('.pending-scan-chk:checked')).map(cb => cb.value); const existingCheckboxes = Array.from(document.querySelectorAll('.chk-ingredient')); let checkedCount = 0;
            confirmedItems.forEach(item => {
                const cb = existingCheckboxes.find(c => c.value === item);
                if (cb) { cb.checked = true; checkedCount++; } 
                else {
                    const container = document.getElementById('categoriesContainer');
                    let diversDetails = Array.from(container.querySelectorAll('details')).find(d => d.querySelector('summary').innerText.includes('Divers'));
                    if (!diversDetails) { diversDetails = document.createElement('details'); diversDetails.className = 'cat-details'; diversDetails.innerHTML = `<summary style="display:flex; align-items:center;">Divers</summary><div class="ingredient-list"></div>`; container.appendChild(diversDetails); }
                    const list = diversDetails.querySelector('.ingredient-list'); list.insertAdjacentHTML('beforeend', `<label class="ingredient-item"><input type="checkbox" value="${item}" class="chk-ingredient" checked><span>🍴 ${item}</span></label>`); checkedCount++;
                }
            });
            memoireIngredients = Array.from(document.querySelectorAll('.chk-ingredient:checked')).map(c => c.value); syncCloud('ingredients', memoireIngredients);
            document.getElementById('modalIAScanner').style.display = 'none'; document.getElementById('resultatDiv').innerHTML = `<h3 style='text-align:center; color:var(--primary);'>${checkedCount} ingrédient(s) ajouté(s) ! ✨</h3>`;
            updateButtonLabel(); afficherIngredientsGauche(); 
        }

        let html5QrcodeScanner;
        function ouvrirBarcodeScanner() {
            document.getElementById('modalBarcode').style.display = 'flex'; document.getElementById('barcode-status').innerText = "Caméra en cours...";
            html5QrcodeScanner = new Html5Qrcode("barcode-scanner-container");
            html5QrcodeScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 200 } }, onScanSuccess, () => {}).catch(err => { document.getElementById('barcode-status').innerText = "Erreur : " + err; });
        }
        function fermerBarcodeScanner() { document.getElementById('modalBarcode').style.display = 'none'; if (html5QrcodeScanner) html5QrcodeScanner.stop().catch(err => {}); }
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

        function toggleExpand(cardId, btn) { const card = document.getElementById(cardId); card.classList.toggle('is-fullscreen'); btn.innerHTML = card.classList.contains('is-fullscreen') ? ">< Réduire" : "⛶ Agrandir"; }
        let recipeSteps = {};
        function togglePasAPas(btnToggle, textId, stepId, stepsArray) {
            const textView = document.getElementById(textId); const stepView = document.getElementById(stepId);
            if (textView.style.display === "none") { textView.style.display = "block"; stepView.style.display = "none"; btnToggle.innerText = "👀 Mode Pas-à-pas"; } 
            else { textView.style.display = "none"; stepView.style.display = "block"; btnToggle.innerText = "📄 Vue complète"; let index = stepId.split('-').slice(2).join('-'); recipeSteps[index] = { current: 0, steps: stepsArray }; updateStepDisplayCustom(stepId, recipeSteps[index]); }
        }
        function changeStep(recipeIndex, direction) {
            let data = recipeSteps[recipeIndex]; data.current += direction;
            if (data.current < 0) data.current = 0; if (data.current >= data.steps.length) data.current = data.steps.length - 1; 
            let containerId = recipeIndex.toString().includes('carnet') ? `carnet-step-${recipeIndex.split('-')[2]}` : `step-view-${recipeIndex}`; updateStepDisplayCustom(containerId, data);
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

        let timerInterval;
        function startTimer(minutes) {
            clearInterval(timerInterval); let timeInSeconds = parseInt(minutes) * 60; const timerUI = document.getElementById('floatingTimer'); const timeDisplay = document.getElementById('timeDisplay');
            timerUI.style.display = 'flex';
            timerInterval = setInterval(() => {
                let m = Math.floor(timeInSeconds / 60); let s = timeInSeconds % 60; timeDisplay.innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
                if (timeInSeconds <= 0) { clearInterval(timerInterval); timeDisplay.innerText = "🔔 Fin !"; declencherAlerteFinMinuteur(); }
                timeInSeconds--;
            }, 1000);
        }
        function stopTimer() { clearInterval(timerInterval); document.getElementById('floatingTimer').style.display = 'none'; }
        function declencherAlerteFinMinuteur() {
            if (typeof confetti === "function") { confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 }, zIndex: 9999 }); }
            try { const audioCtx = new (window.AudioContext || window.webkitAudioContext)(); const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain(); osc.type = 'sine'; osc.frequency.value = 587.33; gain.gain.setValueAtTime(0.5, audioCtx.currentTime); osc.connect(gain); gain.connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + 0.8); } catch(e) {}
            if ('speechSynthesis' in window) { const utterance = new SpeechSynthesisUtterance("Attention chef, le minuteur est écoulé ! Votre cuisson est prête !"); utterance.lang = 'fr-FR'; window.speechSynthesis.speak(utterance); }
        }

        // --- NAVIGATION MOBILE (BOTTOM NAV) ---
        window.addEventListener('popstate', function(event) {
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
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            
            // Activer la vue correspondante
            const targetView = document.getElementById('view-' + viewId);
            if (targetView) targetView.classList.add('active');
            
            // Activer le bouton de la navbar
            const targetBtn = document.getElementById('nav-btn-' + viewId);
            if (targetBtn) targetBtn.classList.add('active');

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
            const rep = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
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
        contenuFormate = contenuFormate.replace(/(\d+)\s*(min|minute|minutes)/gi, `<span class="timer-tag" onclick="startTimer($1)">⏱️ $1 min</span>`);
        
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


window.ouvrirModalCuisson = function() {
    document.getElementById('modalCuisson').style.display = 'flex';
};
window.fermerModalCuisson = function() {
    document.getElementById('modalCuisson').style.display = 'none';
};

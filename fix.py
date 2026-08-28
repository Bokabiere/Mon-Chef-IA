js_code = '''
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
    
    input.value = "Affinage en cours... ?";
    input.disabled = true;
    
    const moteur = moteurIAActif;
    const prompt = \Voici une recette intitulée "\" :
\

La demande de modification est : "\".
Renvoie UNIQUEMENT la recette modifiée, sans introduction ni conclusion, en gardant le même format de liste et d'étapes.\;

    try {
        const apiKey = await getApiKey(moteur);
        if (!apiKey) throw new Error("Clé API manquante");
        
        let texteReponse = "";
        if (moteur === 'gemini') {
            const rep = await fetch(\https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=\\, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
            const data = await rep.json();
            if(data.error) throw new Error(data.error.message);
            texteReponse = data.candidates[0].content.parts[0].text;
        } else if (moteur === 'mistral') {
            const rep = await fetch(\https://api.mistral.ai/v1/chat/completions\, {
                method: "POST", headers: { "Content-Type": "application/json", "Authorization": \Bearer \\ },
                body: JSON.stringify({ model: "mistral-small-latest", messages: [{ role: "user", content: prompt }] })
            });
            const data = await rep.json();
            if(data.error) throw new Error(data.error.message);
            texteReponse = data.choices[0].message.content;
        }
        
        // Formater le nouveau contenu
        let contenuFormate = texteReponse.replace(/[*#]/g, '').trim();
        contenuFormate = contenuFormate.replace(/(\d+)\s*(min|minute|minutes)/gi, \<span class="timer-tag" onclick="startTimer(\)">?? \ min</span>\);
        
        textDiv.innerHTML = contenuFormate.replace(/\\n/g, '<br>');
        
        showToast("Recette affinée avec succès ! ?", "success");
        input.value = "";
    } catch (err) {
        console.error(err);
        showToast("Erreur lors de l'affinage.", "error");
        input.value = consigne;
    } finally {
        input.disabled = false;
    }
}
'''
with open('app.js', 'ab') as f:
    f.write(js_code.encode('utf-8'))

# -*- coding: utf-8 -*-
"""
Script de generation du fichier prix_ingredients.json
Fait correspondre les ingredients de l'application avec les produits Leclerc du fichier Excel.
Strategie : matching par mots-cles + score base sur nb_releves (fiabilite).
"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import pandas as pd
import json
import unicodedata
import re

# ─── 1. Dictionnaire complet des ingredients de l'app ──────────────────────
# Cle   = nom exact tel qu'il apparait dans l'application (Firestore / icones)
# Valeur = liste de mots-cles a chercher dans le nom du produit Excel (priorite decroissante)

INGREDIENTS_MAP = {
    # Legumes
    "Tomate":             ["tomates rondes", "tomates en grappe", "tomates cerises", "tomate"],
    "Carotte":            ["carottes fraiches", "carottes sac", "carottes en vrac", "carotte"],
    "Courgette":          ["courgettes fraiches", "courgette"],
    "Aubergine":          ["aubergines fraiches", "aubergine"],
    "Oignon":             ["oignons jaunes", "oignon jaune", "filet oignons", "oignon"],
    "Ail":                ["tete d'ail", "bulbe d'ail", "ail rose", "ail blanc"],
    "Poivron":            ["poivron rouge", "poivron vert", "poivron jaune", "poivron"],
    "Concombre":          ["concombre frais", "concombre"],
    "Salade":             ["sachet salade", "mache", "roquette", "laitue", "salade"],
    "Epinards":           ["feuilles epinard", "epinards surgeles", "epinard"],
    "Champignons":        ["champignons de paris frais", "champignons frais", "champignon de paris"],
    "Haricots verts":     ["haricots verts surgeles", "haricots verts frais", "haricot vert"],
    "Petit pois":         ["petits pois surgeles", "petits pois", "petit pois"],
    "Brocoli":            ["brocoli frais", "brocolis surgeles", "brocoli"],
    "Chou-fleur":         ["chou-fleur frais", "chou fleur"],
    "Celeri":             ["branches de celeri", "celeri branche", "celeri"],
    "Poireau":            ["poireaux frais", "poireau frais", "poireau"],
    "Radis":              ["radis frais", "radis"],
    "Betterave":          ["betterave cuite", "betterave"],
    "Asperge":            ["asperges vertes fraiches", "asperge"],
    "Artichaut":          ["artichaut breton", "artichaut"],
    "Fenouil":            ["fenouil frais", "fenouil"],
    "Navet":              ["navets frais", "navet"],
    "Avocat":             ["avocat frais", "avocats"],
    "Mais":               ["epis de mais", "mais en boite", "mais"],

    # Fruits
    "Pomme":              ["pomme golden", "pomme gala", "pomme fuji", "pomme"],
    "Poire":              ["poire conference", "poire williams", "poire"],
    "Banane":             ["banane", "bananes"],
    "Orange":             ["orange a jus", "orange filet", "orange"],
    "Citron":             ["citron jaune", "citron"],
    "Fraise":             ["fraises gariguette", "barquette fraises", "fraise"],
    "Raisin":             ["raisin blanc", "raisin noir", "raisin"],
    "Pasteque":           ["pasteque"],
    "Melon":              ["melon charentais", "melon"],
    "Kiwi":               ["kiwi"],
    "Mangue":             ["mangue fraiche", "mangue"],
    "Ananas":             ["ananas frais", "ananas victoria", "ananas"],
    "Peche":              ["peche plate", "peche blanche", "peche jaune", "peche"],
    "Abricot":            ["abricots frais", "abricot"],
    "Cerise":             ["cerises burlat", "cerise"],
    "Myrtille":           ["myrtilles fraiches", "myrtille"],
    "Framboise":          ["framboises fraiches", "framboise"],

    # Proteines
    "Poulet":             ["poulet entier", "blanc de poulet", "filet poulet", "poulet fermier"],
    "Boeuf hache":        ["boeuf hache", "steak hache"],
    "Steak":              ["steak", "entrecote", "bifteck"],
    "Porc":               ["filet mignon porc", "cote de porc", "porc"],
    "Agneau":             ["gigot agneau", "cote agneau", "agneau"],
    "Saumon":             ["saumon atlantique", "saumon", "pave de saumon"],
    "Thon":               ["thon naturel", "thon"],
    "Cabillaud":          ["cabillaud", "lieu noir"],
    "Crevettes":          ["crevettes", "crevette"],
    "Moules":             ["moules", "moule"],
    "Sardines":           ["sardines", "sardine"],
    "Oeufs":              ["oeufs", "oeufs frais"],
    "Jambon":             ["jambon blanc", "jambon cuit", "jambon"],
    "Lardons":            ["lardons", "lardon"],
    "Saucisse":           ["saucisse de strasbourg", "saucisse"],
    "Merguez":            ["merguez"],
    "Tofu":               ["tofu"],

    # Feculents
    "Pates":              ["pates spaghetti", "spaghetti", "tagliatelles", "penne", "pates"],
    "Riz blanc":          ["riz long", "riz basmati", "riz blanc", "riz"],
    "Pomme de terre":     ["pomme de terre", "pommes de terre"],
    "Pain":               ["pain de campagne", "baguette", "pain"],
    "Quinoa":             ["quinoa"],
    "Lentilles":          ["lentilles vertes", "lentilles"],
    "Pois chiches":       ["pois chiche", "pois chiches"],
    "Haricots blancs":    ["haricots blancs", "haricot blanc"],
    "Farine":             ["farine de ble", "farine"],
    "Semoule":            ["semoule"],
    "Polenta":            ["polenta"],
    "Maizena":            ["maizena", "fecule de mais"],

    # Produits laitiers
    "Lait":               ["lait demi-ecreme", "lait entier", "lait"],
    "Fromage":            ["emmental", "gruyere", "fromage rape", "fromage"],
    "Beurre":             ["beurre doux", "beurre"],
    "Creme fraiche":      ["creme fraiche epaisse", "creme fraiche"],
    "Yaourt":             ["yaourt nature", "yaourt"],
    "Mozzarella":         ["mozzarella"],
    "Parmesan":           ["parmesan"],
    "Camembert":          ["camembert"],
    "Comte":              ["comte"],
    "Roquefort":          ["roquefort"],
    "Chevre":             ["fromage de chevre", "chevre"],
    "Creme liquide":      ["creme liquide", "creme entiere"],
    "Lait de coco":       ["lait de coco"],

    # Epicerie / Condiments
    "Huile d'olive":      ["huile d'olive", "huile olive"],
    "Huile":              ["huile de tournesol", "huile vegetale", "huile"],
    "Sauce tomate":       ["coulis de tomate", "sauce tomate", "tomates pelees"],
    "Sauce soja":         ["sauce soja", "tamari"],
    "Moutarde":           ["moutarde de dijon", "moutarde"],
    "Vinaigre":           ["vinaigre balsamique", "vinaigre de vin", "vinaigre"],
    "Sucre":              ["sucre en poudre", "sucre cristallise", "sucre"],
    "Sel":                ["sel fin de table", "sel de cuisine", "sel fin"],
    "Poivre":             ["poivre du moulin noir", "poivre noir moulin", "poivre moulin"],
    "Mayonnaise":         ["mayonnaise"],
    "Ketchup":            ["ketchup"],
    "Tabasco":            ["tabasco rouge 60ml", "tabasco"],
    "Curry":              ["poudre de curry", "curry en poudre", "curry"],
    "Cumin":              ["cumin en poudre", "graines de cumin", "cumin"],
    "Paprika":            ["paprika doux en poudre", "paprika fume", "paprika en poudre"],
    "Herbes de Provence": ["herbes de provence", "herbes provencales"],
    "Thym":               ["thym feuilles seches", "thym seche", "bouquet thym"],
    "Romarin":            ["romarin seche", "feuilles romarin"],
    "Laurier":            ["feuilles de laurier", "laurier sauce", "laurier"],
    "Basilic":            ["basilic frais pot", "basilic seche", "basilic"],
    "Persil":             ["persil plat frais", "persil frais", "persil"],
    "Coriandre":          ["coriandre fraiche", "feuilles coriandre", "coriandre"],
    "Cannelle":           ["cannelle moulue", "cannelle en poudre", "baton cannelle"],
    "Gingembre":          ["gingembre en poudre", "gingembre moulu", "gingembre"],
    "Curcuma":            ["curcuma en poudre", "curcuma moulu"],
    "Levure":             ["levure chimique alsacienne", "levure chimique", "levure boulangere"],
    "Chocolat":           ["tablette chocolat noir patissier", "chocolat noir patissier", "chocolat noir"],
    "Miel":               ["miel d'acacia", "miel toutes fleurs", "miel"],
    "Confiture":          ["confiture de fraises", "confiture fraises", "confiture"],
    "Bouillon":           ["bouillon kub de poule", "bouillon de poule", "cube bouillon de legumes"],
    "Pesto":              ["pesto alla genovese", "pesto vert basilic", "pesto"],
    "Vinaigre":           ["vinaigre de vin rouge", "vinaigre de vin blanc", "vinaigre balsamique"],
    "Parmesan":           ["parmesan rape 100g", "parmesan rape", "parmesan"],
    "Moutarde":           ["moutarde de dijon fine et forte", "moutarde de dijon", "moutarde forte"],
}

# Noms alternatifs : clés de l'app avec accents → alias sans accents pour lookup
# (permettent de trouver aussi les ingrédients avec accents dans Firestore)
ALIASES = {
    "Épinards":           "Epinards",
    "Céleri":             "Celeri",
    "Maïs":               "Mais",
    "Pâtes":              "Pates",
    "Pêche":              "Peche",
    "Boeuf haché":        "Boeuf hache",
    "Crème fraîche":      "Creme fraiche",
    "Crème liquide":      "Creme liquide",
    "Huile d'olive":      "Huile d'olive",
    "Maïzena":            "Maizena",
    "Comté":              "Comte",
    "Chèvre":             "Chevre",
    "Féculents":          None,
    "Quinoa":             "Quinoa",
    "Lentilles":          "Lentilles",
    "Haricots blancs":    "Haricots blancs",
    "Farine":             "Farine",
    "Semoule":            "Semoule",
    "Pois chiches":       "Pois chiches",
}


def normaliser(texte):
    """Minuscules + suppression accents."""
    if not isinstance(texte, str):
        return ""
    texte = texte.lower().strip()
    texte = unicodedata.normalize("NFD", texte)
    texte = "".join(c for c in texte if unicodedata.category(c) != "Mn")
    return texte


def chercher_meilleur_produit(df, mots_cles):
    """
    Cherche le produit correspondant aux mots-cles donnes.
    Retourne la ligne avec le plus grand nombre de releves (prix le plus fiable).
    """
    for mot in mots_cles:
        mot_norm = normaliser(mot)
        masque = df["product_name_norm"].str.contains(re.escape(mot_norm), na=False)
        resultats = df[masque]
        if len(resultats) > 0:
            meilleur = resultats.nlargest(1, "nb_releves").iloc[0]
            return meilleur, mot
    return None, None


# ─── 2. Lecture du fichier Excel ─────────────────────────────────────────────
print("=" * 65)
print("Chargement du fichier Excel Leclerc...")
df = pd.read_excel("Prix/prix_leclerc_france_groupé.xlsx")

df.columns = [
    "product_code", "product_name", "brands",
    "categorie", "sous_categorie",
    "prix_moyen", "prix_min", "prix_max", "nb_releves"
]

print(f"   {len(df)} produits charges")

df["product_name_norm"] = df["product_name"].apply(normaliser)
df = df[df["prix_moyen"] < 100]
print(f"   {len(df)} produits apres filtrage prix aberrants (>100 EUR)")

# ─── 3. Matching ingredient → produit ────────────────────────────────────────
print("\n" + "=" * 65)
print("Matching ingredients -> produits Leclerc...")
print("=" * 65)

prix_mapping = {}
trouves = 0
non_trouves = []

for ingredient, mots_cles in INGREDIENTS_MAP.items():
    meilleur, mot_utilise = chercher_meilleur_produit(df, mots_cles)
    if meilleur is not None:
        prix_mapping[ingredient] = {
            "prix":        round(float(meilleur["prix_moyen"]), 2),
            "prix_min":    round(float(meilleur["prix_min"]), 2),
            "prix_max":    round(float(meilleur["prix_max"]), 2),
            "nb_releves":  int(meilleur["nb_releves"]),
            "produit_ref": str(meilleur["product_name"]),
            "categorie":   str(meilleur["categorie"])
        }
        trouves += 1
        ref = str(meilleur["product_name"])[:40]
        print(f"  OK  {ingredient:<25} -> {ref:<40} ({meilleur['prix_moyen']:.2f}EUR, {int(meilleur['nb_releves'])} releves)")
    else:
        non_trouves.append(ingredient)
        print(f"  --  {ingredient:<25} -> NON TROUVE")

# Ajouter les aliases avec accents (copie des entrees sans accents)
for nom_avec_accent, nom_sans_accent in ALIASES.items():
    if nom_sans_accent and nom_sans_accent in prix_mapping and nom_avec_accent not in prix_mapping:
        prix_mapping[nom_avec_accent] = prix_mapping[nom_sans_accent]

# ─── 4. Resume ────────────────────────────────────────────────────────────────
pct = 100 * trouves // len(INGREDIENTS_MAP)
print("\n" + "=" * 65)
print(f"Resultat : {trouves}/{len(INGREDIENTS_MAP)} ingredients mappes ({pct}%)")
if non_trouves:
    print(f"Non trouves : {', '.join(non_trouves)}")

# ─── 5. Sauvegarde ───────────────────────────────────────────────────────────
with open("prix_ingredients.json", "w", encoding="utf-8") as f:
    json.dump(prix_mapping, f, indent=2, ensure_ascii=False)

print(f"\nFichier 'prix_ingredients.json' genere avec succes!")
print(f"{trouves} ingredients - Prix Leclerc France")

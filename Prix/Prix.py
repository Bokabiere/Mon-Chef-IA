import pandas as pd

url = "https://www.data.gouv.fr/api/1/datasets/r/49716ed5-aacf-4692-8b2d-3cc6d15bf1d1"
df = pd.read_parquet(url)

print(f"{len(df)} prix au total dans le fichier.")

mask_france = df["location_osm_display_name"].str.contains("France", case=False, na=False)
mask_leclerc = df["location_osm_display_name"].str.contains("Leclerc", case=False, na=False)

df_filtré = df[mask_france & mask_leclerc].copy()

print(f"{len(df_filtré)} prix trouvés pour Leclerc en France.")

# Correction : retirer le fuseau horaire de toutes les colonnes datetime
for col in df_filtré.select_dtypes(include=["datetimetz"]).columns:
    df_filtré[col] = df_filtré[col].dt.tz_localize(None)

df_filtré.to_excel("prix_leclerc_france.xlsx", index=False)
print("Export terminé : prix_leclerc_france.xlsx")
import fs from 'fs';

export function loadConfig() {
  try {
    if (!fs.existsSync('./config.json')) {
      console.error("❌ Fichier config.json introuvable !");
      return {};
    }
    return JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
  } catch (e) {
    console.error("❌ Erreur lors du chargement de la config :", e);
    return {};
  }
}

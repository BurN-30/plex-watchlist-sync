import os
import time
import random
import re
import json
from datetime import datetime
import xml.etree.ElementTree as ET
from xml.dom import minidom

# --- IMPORT OFFICIEL ---
try:
    from letterboxdpy.pages.user_watchlist import UserWatchlist
    print("✅ Librairie chargée : Mode UserWatchlist")
except ImportError as e:
    print(f"❌ ERREUR CRITIQUE : Impossible d'importer letterboxdpy. {e}")
    exit()

# --- CONFIGURATION ---

# Chemin relatif au script (dans le dossier feeds/ du projet)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "feeds")
CONFIG_FILE = os.path.join(PROJECT_ROOT, "letterboxd.config.json")

# Charger les usernames depuis le fichier de config
def load_usernames():
    if not os.path.exists(CONFIG_FILE):
        print(f"❌ Fichier de configuration introuvable : {CONFIG_FILE}")
        print(f"   Créez 'letterboxd.config.json' depuis 'letterboxd.config.example.json'")
        exit(1)
    
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            config = json.load(f)
            usernames = config.get('letterboxdUsernames', [])
            
            if not usernames:
                print("❌ Aucun username trouvé dans letterboxd.config.json")
                print("   Ajoutez vos usernames dans le tableau 'letterboxdUsernames'")
                exit(1)
                
            return usernames
    except json.JSONDecodeError as e:
        print(f"❌ Erreur de parsing JSON dans {CONFIG_FILE}: {e}")
        exit(1)
    except Exception as e:
        print(f"❌ Erreur lors du chargement de la config: {e}")
        exit(1)

FRIENDS = load_usernames()

# ---------------------

def log(message):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}")

def extract_year_from_slug(slug):
    """ Tente de récupérer l'année (4 chiffres) à la fin du slug. """
    if not slug: return None
    match = re.search(r'-(\d{4})$', slug)
    return match.group(1) if match else None

def create_rss_xml(username, watchlist_data):
    """ Génère un XML RSS strict pour rssReader.js """
    rss = ET.Element("rss", version="2.0")
    channel = ET.SubElement(rss, "channel")
    
    ET.SubElement(channel, "title").text = f"{username} Watchlist"
    ET.SubElement(channel, "link").text = f"https://letterboxd.com/{username}/watchlist/"
    ET.SubElement(channel, "description").text = f"Watchlist de {username}"
    
    count = 0
    if not watchlist_data: watchlist_data = {}
        
    items = watchlist_data.items()

    for key, film in items:
        # Données par défaut
        title_raw = "Inconnu"
        slug = key 
        year = None
        
        # Récupération des données
        if isinstance(film, dict):
            title_raw = film.get('name', 'Sans titre')
            
            # URL (pour le guid, même si le JS ne l'utilise pas pour l'ID ici)
            url = film.get('url')
            if not url:
                 slug = film.get('slug', key)
                 url = f"https://letterboxd.com/film/{slug}/"
            
            # Année (Crucial pour ton rssReader.js)
            year = film.get('year')
            if not year:
                year = extract_year_from_slug(slug)

        else:
            title_raw = str(film)
            url = f"https://letterboxd.com/{username}/watchlist/"

        # FORMATAGE OBLIGATOIRE POUR TON JS : "Titre (Année)"
        # Ton regex JS attend : /^(.*?)\s*[([{\s](\d{4})[)\]}\s]/
        if year:
            final_title = f"{title_raw} ({year})"
        else:
            final_title = title_raw 

        item = ET.SubElement(channel, "item")
        ET.SubElement(item, "title").text = final_title
        ET.SubElement(item, "link").text = url
        ET.SubElement(item, "guid").text = url # Sera lu par JS, mais regex échouera (pas grave)
        count += 1

    try:
        xml_str = minidom.parseString(ET.tostring(rss)).toprettyxml(indent="  ")
    except Exception:
        xml_str = ET.tostring(rss, encoding='utf-8').decode('utf-8')
        
    return xml_str, count

def run_update():
    if not os.path.exists(OUTPUT_DIR):
        try: os.makedirs(OUTPUT_DIR)
        except: pass

    log(f"--- Démarrage ({len(FRIENDS)} amis) ---")

    for username in FRIENDS:
        log(f"Traitement de : {username}...")
        
        try:
            # 1. Récupération via la classe officielle
            instance = UserWatchlist(username)
            raw_response = instance.get_watchlist()
            
            # 2. Extraction des données
            watchlist_data = raw_response.get('data', {})
            
            # 3. Génération XML
            output_file = os.path.join(OUTPUT_DIR, f"{username}.xml")
            xml_content, count = create_rss_xml(username, watchlist_data)

            with open(output_file, "w", encoding="utf-8") as f:
                f.write(xml_content)

            log(f"✅ {username}.xml : {count} films.")

        except Exception as e:
            err = str(e)
            if "404" in err:
                log(f"❌ Utilisateur inconnu (404) : {username}")
            else:
                log(f"❌ Erreur sur {username} : {err}")

        # Pause anti-ban (important même pour la watchlist simple)
        wait = random.randint(3, 6)
        time.sleep(wait)

    log("--- Terminé ! ---")

if __name__ == "__main__":
    run_update()
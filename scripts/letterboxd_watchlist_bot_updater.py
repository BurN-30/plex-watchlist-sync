#!/usr/bin/env python3
"""
letterboxd_watchlist_bot_updater.py - Generate RSS feeds from Letterboxd watchlists

Usage:
    python letterboxd_watchlist_bot_updater.py [--test USERNAME] [--force-custom] [--check-selectors]
"""

import os
import sys
import time
import random
import json
import argparse
from datetime import datetime
import xml.etree.ElementTree as ET
from xml.dom import minidom
from typing import Dict, List, Optional

# Import scraper
try:
    from letterboxd_scraper import LetterboxdScraper, log, log_error
except ImportError:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from letterboxd_scraper import LetterboxdScraper, log, log_error

# Configuration
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "feeds")
CONFIG_FILE = os.path.join(PROJECT_ROOT, "letterboxd.config.json")
STATUS_FILE = os.path.join(PROJECT_ROOT, "logs", "letterboxd-status.json")


def load_config() -> Dict:
    if not os.path.exists(CONFIG_FILE):
        log_error(f"Config not found: {CONFIG_FILE}")
        log("Create letterboxd.config.json from letterboxd.config.example.json")
        sys.exit(1)

    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            config = json.load(f)
            usernames = config.get('letterboxdUsernames', [])
            if not usernames:
                log_error("No usernames in letterboxd.config.json")
                sys.exit(1)
            return config
    except Exception as e:
        log_error(f"Config error", e)
        sys.exit(1)


def extract_year_from_slug(slug: str) -> Optional[str]:
    if not slug:
        return None
    import re
    match = re.search(r'-(\d{4})$', slug)
    return match.group(1) if match else None


def create_rss_xml(username: str, watchlist_data: Dict) -> tuple:
    """Create RSS XML from watchlist data with IMDb/TMDb IDs"""
    rss = ET.Element("rss", version="2.0")
    channel = ET.SubElement(rss, "channel")

    ET.SubElement(channel, "title").text = f"{username} Watchlist"
    ET.SubElement(channel, "link").text = f"https://letterboxd.com/{username}/watchlist/"
    ET.SubElement(channel, "description").text = f"Letterboxd watchlist for {username}"
    ET.SubElement(channel, "lastBuildDate").text = datetime.utcnow().strftime('%a, %d %b %Y %H:%M:%S GMT')
    ET.SubElement(channel, "generator").text = "plex-watchlist-sync"

    count = 0
    if not watchlist_data:
        watchlist_data = {}

    for key, film in watchlist_data.items():
        if not isinstance(film, dict):
            continue

        title = film.get('name', film.get('title', 'Untitled'))
        year = film.get('year')
        slug = film.get('slug', key)
        url = film.get('url', f"https://letterboxd.com/film/{slug}/")
        imdb_id = film.get('imdb_id')
        tmdb_id = film.get('tmdb_id')
        content_type = film.get('type', 'movie')

        # Build title with year
        final_title = f"{title} ({year})" if year else title

        item = ET.SubElement(channel, "item")
        ET.SubElement(item, "title").text = final_title
        ET.SubElement(item, "link").text = url
        
        # Use IMDb or TMDb as GUID (priority to IMDb)
        if imdb_id:
            guid_url = f"https://www.imdb.com/title/{imdb_id}/"
            ET.SubElement(item, "guid", isPermaLink="true").text = guid_url
        elif tmdb_id:
            tmdb_type = 'tv' if content_type == 'show' else 'movie'
            guid_url = f"https://www.themoviedb.org/{tmdb_type}/{tmdb_id}"
            ET.SubElement(item, "guid", isPermaLink="true").text = guid_url
        else:
            ET.SubElement(item, "guid", isPermaLink="true").text = url
        
        ET.SubElement(item, "category").text = "letterboxd"
        
        # Add custom fields for IDs
        if imdb_id:
            ET.SubElement(item, "imdbId").text = imdb_id
        if tmdb_id:
            ET.SubElement(item, "tmdbId").text = tmdb_id
        
        count += 1

    # Pretty print XML
    try:
        xml_str = minidom.parseString(ET.tostring(rss, encoding='unicode')).toprettyxml(indent="  ")
        lines = xml_str.split('\n')
        if lines[0].startswith('<?xml'):
            xml_str = '\n'.join(lines[1:])
        xml_str = '<?xml version="1.0" encoding="UTF-8"?>\n' + xml_str.strip()
    except Exception:
        xml_str = ET.tostring(rss, encoding='unicode')

    return xml_str, count


def save_status(status: Dict) -> None:
    try:
        os.makedirs(os.path.dirname(STATUS_FILE), exist_ok=True)
        with open(STATUS_FILE, 'w', encoding='utf-8') as f:
            json.dump(status, f, indent=2, ensure_ascii=False)
    except Exception:
        pass


def run_update(usernames: List[str], scraper: LetterboxdScraper, dry_run: bool = False) -> Dict:
    if not dry_run:
        os.makedirs(OUTPUT_DIR, exist_ok=True)

        # Backup existing XML files before scraping
        try:
            from backup_feeds import backup_feeds, cleanup_old_backups
            backup_feeds()
            cleanup_old_backups()
            log("[BACKUP] XML files backed up")
        except ImportError:
            log("[WARN] backup_feeds module not found, skipping backup")
        except Exception as e:
            log_error("Backup failed (non-critical)", e)

    stats = {
        "started_at": datetime.utcnow().isoformat(),
        "users_processed": 0,
        "users_failed": 0,
        "total_films": 0,
        "errors": [],
        "details": {}
    }

    log("=" * 60)
    log("LETTERBOXD WATCHLIST UPDATER")
    log("=" * 60)
    log(f"Mode: {'TEST' if dry_run else 'PRODUCTION'}")
    log(f"Users: {len(usernames)}")

    for i, username in enumerate(usernames, 1):
        log(f"\n[{i}/{len(usernames)}] {username}")

        try:
            watchlist_data = scraper.get_watchlist(username)
            xml_content, count = create_rss_xml(username, watchlist_data)

            if not dry_run:
                output_file = os.path.join(OUTPUT_DIR, f"{username}.xml")
                with open(output_file, "w", encoding="utf-8") as f:
                    f.write(xml_content)
                log(f"   [OK] {username}.xml : {count} films")
            else:
                log(f"   [OK] [DRY-RUN] {count} films")

            stats["users_processed"] += 1
            stats["total_films"] += count
            stats["details"][username] = {"status": "success", "films": count}

        except Exception as e:
            error_msg = str(e)
            log(f"   [FAILED] {error_msg}")
            stats["users_failed"] += 1
            stats["errors"].append({"user": username, "error": error_msg})
            stats["details"][username] = {"status": "failed", "error": error_msg}

        # Rate limiting between users
        if i < len(usernames):
            wait = random.uniform(3, 6)
            log(f"   Waiting {wait:.1f}s...")
            time.sleep(wait)

    stats["finished_at"] = datetime.utcnow().isoformat()
    stats["success_rate"] = f"{(stats['users_processed'] / len(usernames) * 100):.1f}%" if usernames else "N/A"

    if not dry_run:
        save_status(stats)

    log(f"\n{'=' * 60}")
    log(f"Success: {stats['users_processed']}/{len(usernames)}")
    log(f"Failed: {stats['users_failed']}/{len(usernames)}")
    log(f"Total: {stats['total_films']} films")

    return stats


def main():
    parser = argparse.ArgumentParser(description="Generate RSS feeds from Letterboxd")
    parser.add_argument('--test', '-t', metavar='USERNAME', help="Test with a specific user")
    parser.add_argument('--force-custom', '-f', action='store_true', help="Force custom scraper")
    parser.add_argument('--check-selectors', '-c', action='store_true', help="Check selectors")

    args = parser.parse_args()

    use_library = not args.force_custom
    scraper = LetterboxdScraper(use_library=use_library)

    if args.check_selectors:
        test_user = args.test or "dave"
        success = scraper.test_selectors(test_user)
        sys.exit(0 if success else 1)

    if args.test:
        log(f"[TEST] User: {args.test}")
        run_update([args.test], scraper, dry_run=True)
        sys.exit(0)

    config = load_config()
    usernames = config.get('letterboxdUsernames', [])
    stats = run_update(usernames, scraper, dry_run=False)

    sys.exit(0 if stats["users_failed"] == 0 or stats["users_processed"] > 0 else 1)


if __name__ == "__main__":
    main()

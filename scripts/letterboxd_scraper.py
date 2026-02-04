"""
letterboxd_scraper.py - Letterboxd scraping abstraction layer

Provides a unified interface to fetch Letterboxd watchlists.
Uses letterboxdpy by default, with automatic fallback to custom scraper
if the library fails (due to HTML structure changes on the site).

Usage:
    from letterboxd_scraper import LetterboxdScraper
    scraper = LetterboxdScraper()
    watchlist = scraper.get_watchlist("username")
"""

import os
import json
import re
import time
import random
from datetime import datetime
from typing import Dict, Optional, Any

# Paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
SELECTORS_FILE = os.path.join(PROJECT_ROOT, 'letterboxd.selectors.json')
ERROR_LOG_FILE = os.path.join(PROJECT_ROOT, 'logs', 'letterboxd-scraper-errors.log')
CACHE_FILE = os.path.join(PROJECT_ROOT, 'logs', 'letterboxd-ids-cache.json')

# Default selectors - Updated Feb 2026 for React frontend
DEFAULT_SELECTORS = {
    "watchlist": {
        "container": "ul.grid",
        "item": "li.griditem",
        "poster_div": "div.react-component[data-component-class='LazyPoster']",
        "poster_attr_slug": "data-item-slug",
        "poster_attr_id": "data-film-id",
        "poster_attr_name": "data-item-name",
        "poster_attr_link": "data-item-link",
        "year_pattern": r"\((\d{4})\)$",
        "pagination": {"next_page": "a.next", "page_param": "page"}
    },
    "film_page": {
        "imdb_link": "a[href*='imdb.com']",
        "tmdb_link": "a[href*='themoviedb.org']",
        "title": "h1.headline-1",
        "year": "small.number a",
        "type_indicator": "div.film-header"
    }
}

# Rate limiting: max 1 request per 2 seconds to avoid ban
RATE_LIMIT_DELAY = 2.0
last_request_time = 0


def log(message: str, level: str = "INFO") -> None:
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{timestamp}] [{level}] {message}")


def log_error(message: str, exception: Optional[Exception] = None) -> None:
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    error_msg = f"[{timestamp}] {message}"
    if exception:
        error_msg += f"\n  Exception: {type(exception).__name__}: {exception}"
    print(f"[ERROR] {message}")
    try:
        os.makedirs(os.path.dirname(ERROR_LOG_FILE), exist_ok=True)
        with open(ERROR_LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(error_msg + "\n")
    except Exception:
        pass


def rate_limit():
    """Enforce rate limiting to avoid Letterboxd ban"""
    global last_request_time
    now = time.time()
    elapsed = now - last_request_time
    if elapsed < RATE_LIMIT_DELAY:
        sleep_time = RATE_LIMIT_DELAY - elapsed
        time.sleep(sleep_time)
    last_request_time = time.time()


class LetterboxdScraper:
    """Letterboxd scraper with automatic fallback and ID extraction."""

    def __init__(self, use_library: bool = True):
        self.use_library = use_library
        self.selectors = self._load_selectors()
        self._library_available = self._check_library()
        self._session = None
        self._ids_cache = self._load_ids_cache()

        if self.use_library and self._library_available:
            log("Mode: letterboxdpy (with custom fallback)")
        elif self.use_library and not self._library_available:
            log("Mode: Custom scraper (letterboxdpy unavailable)", "WARN")
        else:
            log("Mode: Custom scraper only")

    def _load_selectors(self) -> Dict:
        if os.path.exists(SELECTORS_FILE):
            try:
                with open(SELECTORS_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    log(f"Selectors loaded from {SELECTORS_FILE}")
                    return data
            except Exception as e:
                log_error(f"Error loading selectors", e)
        return DEFAULT_SELECTORS

    def _load_ids_cache(self) -> Dict:
        """Load cached IMDb/TMDb IDs to avoid re-scraping"""
        if os.path.exists(CACHE_FILE):
            try:
                with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    def _save_ids_cache(self):
        """Save IMDb/TMDb IDs cache"""
        try:
            os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
            with open(CACHE_FILE, 'w', encoding='utf-8') as f:
                json.dump(self._ids_cache, f, indent=2)
        except Exception as e:
            log_error("Error saving IDs cache", e)

    def _check_library(self) -> bool:
        try:
            from letterboxdpy.pages.user_watchlist import UserWatchlist
            return True
        except ImportError:
            return False

    def get_watchlist(self, username: str) -> Dict[str, Any]:
        """
        Get watchlist for a user with automatic fallback.

        Fallback order:
        1. letterboxdpy library (if enabled and available)
        2. Custom HTML scraper
        3. RSS feed fallback (if HTML scraper fails)
        """
        if self.use_library and self._library_available:
            try:
                return self._get_via_library(username)
            except Exception as e:
                log_error(f"letterboxdpy failed for '{username}'", e)
                log("Switching to custom scraper...", "WARN")

        try:
            return self._get_via_custom_scraper(username)
        except Exception as e:
            log_error(f"Custom scraper failed for '{username}'", e)
            log("Attempting RSS fallback...", "WARN")
            return self._get_via_rss_fallback(username)

    def _get_via_library(self, username: str) -> Dict[str, Any]:
        from letterboxdpy.pages.user_watchlist import UserWatchlist
        log(f"[letterboxdpy] Fetching watchlist: {username}")
        instance = UserWatchlist(username)
        response = instance.get_watchlist()
        return response.get('data', {})

    def _get_via_custom_scraper(self, username: str) -> Dict[str, Any]:
        try:
            import requests
            from bs4 import BeautifulSoup
        except ImportError as e:
            log_error("Missing dependencies: pip install requests beautifulsoup4", e)
            raise

        log(f"[custom] Fetching watchlist: {username}")

        if not self._session:
            self._session = requests.Session()
            # Note: Do NOT include 'br' (brotli) in Accept-Encoding - it causes different HTML response
            self._session.headers.update({
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
            })

        watchlist = {}
        page = 1
        sel = self.selectors.get('watchlist', DEFAULT_SELECTORS['watchlist'])

        while True:
            rate_limit()  # Enforce rate limiting
            url = f"https://letterboxd.com/{username}/watchlist/page/{page}/"

            try:
                response = self._session.get(url, timeout=30)
                if response.status_code == 404:
                    if page == 1:
                        raise Exception(f"User '{username}' not found (404)")
                    break
                response.raise_for_status()
            except Exception as e:
                if page == 1:
                    raise
                break

            soup = BeautifulSoup(response.text, 'html.parser')
            container = soup.select_one(sel['container'])

            if not container:
                if page == 1:
                    raise Exception(f"Selector '{sel['container']}' not found")
                break

            items = container.select(sel['item'])
            if not items:
                break

            for item in items:
                try:
                    film = self._parse_film_item(item, sel, username)
                    if film and film.get('slug'):
                        # Fetch IMDb/TMDb IDs from film page
                        film = self._enrich_with_ids(film, username)
                        watchlist[film['slug']] = film
                except Exception as e:
                    log_error(f"Error parsing film item", e)
                    continue

            next_link = soup.select_one(sel.get('pagination', {}).get('next_page', 'a.next'))
            if not next_link:
                break

            page += 1
            log(f"[custom] Page {page} for {username}...")

        log(f"[custom] {len(watchlist)} films found for {username}")
        self._save_ids_cache()  # Save cache after scraping
        return watchlist

    def _parse_film_item(self, item, sel: Dict, username: str) -> Optional[Dict]:
        # New structure (Feb 2026): data is on div.react-component[data-component-class='LazyPoster']
        poster_div = item.select_one(sel.get('poster_div', "div.react-component[data-component-class='LazyPoster']"))
        if not poster_div:
            # Fallback: check if item itself has the attributes (in case structure changes)
            poster_div = item
            if not poster_div.get(sel.get('poster_attr_slug', 'data-item-slug')):
                return None

        slug = poster_div.get(sel.get('poster_attr_slug', 'data-item-slug'), '')
        film_id = poster_div.get(sel.get('poster_attr_id', 'data-film-id'), '')

        if not slug:
            return None

        # Get title from data-item-name attribute (new structure)
        title_raw = poster_div.get(sel.get('poster_attr_name', 'data-item-name'), '')

        # Fallback to img alt if data-item-name not available
        if not title_raw:
            img = item.select_one('img.image')
            title_raw = img.get('alt', 'Unknown') if img else 'Unknown'

        year = None
        year_pattern = sel.get('year_pattern', r'\((\d{4})\)$')
        year_match = re.search(year_pattern, title_raw)
        if year_match:
            year = year_match.group(1)
            title_clean = re.sub(year_pattern, '', title_raw).strip()
        else:
            title_clean = title_raw

        # Get film URL from data-item-link or construct from slug
        film_link = poster_div.get(sel.get('poster_attr_link', 'data-item-link'), '')
        if film_link:
            film_url = f"https://letterboxd.com{film_link}" if film_link.startswith('/') else film_link
        else:
            film_url = f"https://letterboxd.com/film/{slug}/"

        return {
            'name': title_clean,
            'year': year,
            'slug': slug,
            'film_id': film_id,
            'url': film_url,
            'imdb_id': None,
            'tmdb_id': None,
            'type': 'movie'  # Default, will be refined by _enrich_with_ids
        }

    def _enrich_with_ids(self, film: Dict, username: str) -> Dict:
        """Fetch IMDb/TMDb IDs from film page with robust error handling"""
        import requests
        slug = film['slug']

        # Check cache first
        if slug in self._ids_cache:
            cached = self._ids_cache[slug]
            film['imdb_id'] = cached.get('imdb_id')
            film['tmdb_id'] = cached.get('tmdb_id')
            film['type'] = cached.get('type', 'movie')
            return film

        # Fetch film page
        try:
            rate_limit()  # Enforce rate limiting
            url = film['url']
            response = self._session.get(url, timeout=30)

            # Handle 404 (film deleted/private)
            if response.status_code == 404:
                log(f"[SKIP] Film not found (404): {film['name']}")
                return film

            # Handle other HTTP errors
            if response.status_code == 403:
                log(f"[SKIP] Access forbidden (403): {film['name']}")
                return film

            response.raise_for_status()

            from bs4 import BeautifulSoup
            soup = BeautifulSoup(response.text, 'html.parser')
            sel = self.selectors.get('film_page', DEFAULT_SELECTORS['film_page'])

            # Extract IMDb ID
            imdb_link = soup.select_one(sel['imdb_link'])
            if imdb_link and 'href' in imdb_link.attrs:
                imdb_url = imdb_link['href']
                imdb_match = re.search(r'tt\d+', imdb_url)
                if imdb_match:
                    film['imdb_id'] = imdb_match.group(0)

            # Extract TMDb ID
            tmdb_link = soup.select_one(sel['tmdb_link'])
            if tmdb_link and 'href' in tmdb_link.attrs:
                tmdb_url = tmdb_link['href']
                # TMDb URLs: https://www.themoviedb.org/movie/12345 or /tv/12345
                tmdb_match = re.search(r'themoviedb\.org/(movie|tv)/(\d+)', tmdb_url)
                if tmdb_match:
                    content_type = tmdb_match.group(1)
                    film['tmdb_id'] = tmdb_match.group(2)
                    # If it's a TV show on TMDb, mark it as show
                    if content_type == 'tv':
                        film['type'] = 'show'

            # Cache the IDs
            self._ids_cache[slug] = {
                'imdb_id': film.get('imdb_id'),
                'tmdb_id': film.get('tmdb_id'),
                'type': film.get('type', 'movie')
            }

            if film.get('imdb_id') or film.get('tmdb_id'):
                log(f"[IDs] {film['name']}: IMDb={film.get('imdb_id')} TMDb={film.get('tmdb_id')} Type={film.get('type')}")

        except requests.exceptions.Timeout:
            log_error(f"Timeout fetching {slug} (will retry next run)")
        except requests.exceptions.ConnectionError:
            log_error(f"Connection error for {slug} (will retry next run)")
        except Exception as e:
            log_error(f"Error fetching IDs for {slug}", e)

        return film

    def _get_via_rss_fallback(self, username: str) -> Dict[str, Any]:
        """
        Fallback: Use Letterboxd's lists RSS feed to get film data.

        Note: Letterboxd doesn't provide RSS for watchlists directly,
        but we can try the user's activity RSS which includes watchlist additions.
        This is slower and less complete than HTML scraping.

        If RSS is unavailable, returns empty dict.
        """
        import requests
        from xml.etree import ElementTree

        log(f"[RSS] Attempting RSS fallback for: {username}")

        if not self._session:
            self._session = requests.Session()
            self._session.headers.update({
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/rss+xml, application/xml, text/xml, */*',
            })

        # Try the user's RSS feed (general activity)
        rss_url = f"https://letterboxd.com/{username}/rss/"

        try:
            rate_limit()
            response = self._session.get(rss_url, timeout=30)

            if response.status_code == 404:
                log(f"[RSS] No RSS feed available for {username}")
                return {}

            response.raise_for_status()

            # Parse RSS XML
            root = ElementTree.fromstring(response.content)
            watchlist = {}

            # Find all items in the RSS feed
            for item in root.findall('.//item'):
                try:
                    title_elem = item.find('title')
                    link_elem = item.find('link')

                    if title_elem is None or link_elem is None:
                        continue

                    title_text = title_elem.text or ''
                    link_text = link_elem.text or ''

                    # RSS items for watchlist additions look like:
                    # "username added Film Title (2024) to their watchlist"
                    # We need to extract film info from the link
                    if '/film/' not in link_text:
                        continue

                    # Extract slug from link
                    slug_match = re.search(r'/film/([^/]+)/', link_text)
                    if not slug_match:
                        continue

                    slug = slug_match.group(1)

                    # Try to extract title and year from title text
                    # Format varies but often includes "Film Title (Year)"
                    year_match = re.search(r'\((\d{4})\)', title_text)
                    year = year_match.group(1) if year_match else None

                    # Clean title - remove year and common prefixes
                    clean_title = re.sub(r'\s*\(\d{4}\)\s*', '', title_text)
                    clean_title = re.sub(r'^.*?(added|watched|liked)\s+', '', clean_title, flags=re.IGNORECASE)
                    clean_title = re.sub(r'\s+to their.*$', '', clean_title, flags=re.IGNORECASE)
                    clean_title = clean_title.strip()

                    if not clean_title:
                        clean_title = slug.replace('-', ' ').title()

                    film = {
                        'name': clean_title,
                        'year': year,
                        'slug': slug,
                        'film_id': '',
                        'url': f"https://letterboxd.com/film/{slug}/",
                        'imdb_id': None,
                        'tmdb_id': None,
                        'type': 'movie'
                    }

                    # Enrich with IDs
                    film = self._enrich_with_ids(film, username)
                    watchlist[slug] = film

                except Exception as e:
                    log_error(f"Error parsing RSS item", e)
                    continue

            log(f"[RSS] Found {len(watchlist)} films from RSS feed")
            self._save_ids_cache()
            return watchlist

        except Exception as e:
            log_error(f"RSS fallback failed for {username}", e)
            return {}

    def test_selectors(self, username: str) -> bool:
        log(f"Testing selectors with user: {username}")
        try:
            original = self.use_library
            self.use_library = False
            watchlist = self._get_via_custom_scraper(username)
            self.use_library = original

            if watchlist:
                log(f"[OK] Selectors working! {len(watchlist)} films found")
                first = next(iter(watchlist.values()))
                log(f"   Example: {first.get('name')} ({first.get('year')})")
                return True
            log("[WARN] No films found (empty watchlist or selectors broken)")
            return True
        except Exception as e:
            log_error("Selectors NOT WORKING", e)
            return False


if __name__ == "__main__":
    import sys
    print("=" * 60)
    print("LETTERBOXD SCRAPER - TEST")
    print("=" * 60)

    test_user = sys.argv[1] if len(sys.argv) > 1 else "dave"

    # Force custom scraper only (letterboxdpy often fails with 403)
    use_lib = "--use-library" in sys.argv
    scraper = LetterboxdScraper(use_library=use_lib)

    print(f"\nTesting with user: {test_user}")
    print("-" * 40)

    try:
        watchlist = scraper.get_watchlist(test_user)
        print(f"\n[OK] {len(watchlist)} films found")

        # Show first 5 films
        for i, (slug, film) in enumerate(list(watchlist.items())[:5]):
            imdb = film.get('imdb_id') or 'N/A'
            tmdb = film.get('tmdb_id') or 'N/A'
            print(f"  {i+1}. {film['name']} ({film.get('year', '?')}) - IMDb:{imdb} TMDb:{tmdb}")

    except Exception as e:
        print(f"\n[ERROR] {e}")
        import traceback
        traceback.print_exc()

    print("\n" + "=" * 60)

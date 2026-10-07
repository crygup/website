"""Read only the site owner's Steam activity. Never return the API key."""
import json
import os
import re
import time
from functools import lru_cache
from pathlib import Path
from threading import Lock
from urllib.parse import urlencode
from urllib.request import Request, urlopen

STEAM_ID = '76561199034626559'
_lock = Lock()
_cached = (0, None)


def api_key():
    if os.environ.get('STEAM_API_KEY'):
        return os.environ['STEAM_API_KEY']
    env = Path(__file__).resolve().parents[2] / '.env'
    if env.is_file():
        for line in env.read_text(encoding='utf-8-sig').splitlines():
            name, _, value = line.partition('=')
            if name.strip() == 'STEAM_API_KEY':
                return value.strip().strip('\"\'')
    raise RuntimeError('Steam is not configured')


def read_json(url, headers=None):
    with urlopen(Request(url, headers=headers or {}), timeout=10) as response:
        return json.load(response)


def steam(method, **params):
    return read_json('https://api.steampowered.com/' + method + '/?' + urlencode(params),
                     {'x-webapi-key': api_key()})['response']


@lru_cache(maxsize=512)
def is_game(appid):
    result = read_json('https://store.steampowered.com/api/appdetails?' + urlencode({'appids': appid, 'l': 'english'})).get(str(appid), {})
    if not result.get('success'):
        return False
    data = result.get('data', {})
    software_genres = {'Animation & Modeling', 'Audio Production', 'Design & Illustration',
                       'Education', 'Photo Editing', 'Software Training', 'Utilities',
                       'Video Production', 'Web Publishing', 'Game Development', 'Accounting'}
    return data.get('type') == 'game' and not any(
        genre.get('description') in software_genres for genre in data.get('genres', []))


def fetch_activity():
    players = steam('ISteamUser/GetPlayerSummaries/v2', steamids=STEAM_ID).get('players', [])
    owned = steam('IPlayerService/GetOwnedGames/v1', steamid=STEAM_ID,
                  include_appinfo=1, include_played_free_games=1)
    if 'games' not in owned:
        raise RuntimeError('Steam activity is not visible')
    current = str(players[0].get('gameid', '')) if players else ''
    games = sorted(owned['games'], key=lambda g: (str(g['appid']) == current, g.get('rtime_last_played', 0)), reverse=True)
    for game in games:
        appid = int(game['appid'])
        playing = str(appid) == current
        if not playing and not game.get('rtime_last_played'):
            continue
        if not is_game(appid):
            continue
        icon = game.get('img_icon_url', '')
        return {'appid': appid, 'name': game['name'], 'playing': playing,
                'last_played': game.get('rtime_last_played'),
                'playtime_minutes': game.get('playtime_forever', 0),
                'icon': f'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/{appid}/{icon}_full.jpg' if re.fullmatch(r'[a-fA-F0-9]{40}', icon) else None}
    return None


def activity():
    global _cached
    # ponytail: one owner and one refresh lock; use per-owner caches for multiple profiles.
    with _lock:
        if time.monotonic() >= _cached[0]:
            try:
                result = (200, {'game': fetch_activity()})
            except Exception:
                # Upstream exceptions can contain sensitive request details.
                result = (503, {'error': 'Steam activity is unavailable'})
            _cached = (time.monotonic() + 60, result)
        return _cached[1]

"""Public anime watch activity for fluttershy. No OAuth credentials required."""
import json
import time
from functools import lru_cache
from threading import Lock
from urllib.request import Request, urlopen

_lock = Lock()
_cached = (0, None)


def query(document, variables=None):
    request = Request('https://graphql.anilist.co',
                      data=json.dumps({'query': document, 'variables': variables or {}}).encode(),
                      headers={'Content-Type': 'application/json', 'Accept': 'application/json',
                               'User-Agent': 'crygup-website/1.0'})
    with urlopen(request, timeout=10) as response:
        result = json.load(response)
    if result.get('errors'):
        raise RuntimeError('AniList query failed')
    return result['data']


@lru_cache(maxsize=1)
def user_id():
    return query('{User(name:"fluttershy"){id}}')['User']['id']


def watch_label(item):
    status = item.get('status', '').lower()
    if status in ('completed', 'watched'):
        return 'Watched'
    if status == 'rewatched':
        return 'Rewatched'
    if status not in ('watched episode', 'rewatched episode'):
        return None
    progress = ''.join((item.get('progress') or '').split())
    verb = 'Rewatched' if status.startswith('rewatched') else 'Watched'
    if not progress:
        return verb
    return f'{verb} {"episodes" if "-" in progress else "episode"} {progress}'


def fetch_activity():
    page = 1
    while True:
        result = query('''query($user:Int,$page:Int){Page(page:$page,perPage:50){
          pageInfo{hasNextPage}
          activities(userId:$user,type:ANIME_LIST,sort:ID_DESC){... on ListActivity{
            status progress createdAt media{id title{english romaji} coverImage{large}}
          }}
        }}''', {'user': user_id(), 'page': page})['Page']
        for item in result['activities']:
            label = watch_label(item)
            media = item.get('media')
            if not label or not media:
                continue
            entries = query('''query($user:Int,$media:Int){Page(perPage:1){
              mediaList(userId:$user,mediaId:$media){score(format:POINT_10_DECIMAL) repeat}
            }}''', {'user': user_id(), 'media': media['id']})['Page']['mediaList']
            entry = entries[0] if entries else {}
            return {'id': media['id'], 'name': media['title']['english'] or media['title']['romaji'],
                    'image': media['coverImage']['large'], 'label': label,
                    'watched_at': item['createdAt'], 'score': entry.get('score') or None,
                    'rewatches': entry.get('repeat', 0)}
        if not result['pageInfo']['hasNextPage']:
            return None
        page += 1


def activity():
    global _cached
    # ponytail: one public profile; use per-user caches if more profiles are added.
    with _lock:
        if time.monotonic() >= _cached[0]:
            try:
                result = (200, {'anime': fetch_activity()})
            except Exception:
                result = (503, {'error': 'AniList activity is unavailable'})
            _cached = (time.monotonic() + 300, result)
        return _cached[1]

#!/usr/bin/env bash

# Headless adapter for the desktop UI. It uses the same ani-cli endpoints and
# parsing rules, but never opens fzf, a shell prompt, or a terminal window.

set -u

base_api="https://anidb.app"
agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
curl_exe="${ANI_CLI_CURL:-curl}"

fail() {
    printf '%s\n' "$1" >&2
    exit 1
}

api_get() {
    "$curl_exe" -sL -A "$agent" --max-time 20 "$1" || return 1
}

search_anime() {
    [ -n "${1:-}" ] || fail "Enter an anime title."
    query=$(printf '%s' "$1" | sed 's| |+|g')
    page=$(api_get "${base_api}/browse?q=${query}") || fail "Could not reach AniDB. Check your internet connection."
    printf '%s' "$page" | grep -qi "Just a moment" && fail "AniDB is temporarily blocking this request."
    printf '%s' "$page" | tr '\n' ' ' | sed 's|<a href|\n<a href|g' | sed -nE 's|.*anime/([a-z0-9-]+-[0-9]+)".*alt="([^"]+)".*|\1\t\2|p' | sed -e "s|&#039;|'|g" -e 's|&quot;|"|g'
}

episode_list() {
    [ -n "${1:-}" ] || fail "Missing anime id."
    anime_number="${1##*-}"
    page=$(api_get "${base_api}/api/frontend/anime/${anime_number}/episodes") || fail "Could not load episodes."
    printf '%s' "$page" | sed 's|},{|}\n{|g' | sed -nE 's|.*"id":([0-9]+).*"number":([0-9]+).*|\1\t\2|p'
}

stream_url() {
    [ $# -ge 2 ] || fail "Missing episode."
    anime_id="$1"
    episode_number="$2"
    language="${3:-sub}"
    wanted_quality="${4:-best}"
    episode_id=$(episode_list "$anime_id" | awk -F '\t' -v ep="$episode_number" '$2 == ep { print $1; exit }')
    [ -n "$episode_id" ] || fail "Episode ${episode_number} was not found."

    language_code="jpn"
    [ "$language" = "dub" ] && language_code="eng"
    language_page=$(api_get "${base_api}/api/frontend/episode/${episode_id}/languages") || fail "Could not load stream sources."
    embed=$(printf '%s' "$language_page" | sed 's|},{|}\n{|g' | sed -nE 's|.*'"${language_code}"'.*embed_url":"([^"]+)".*|\1|p' | sed 's|\\/|/|g' | head -n 1)
    [ -n "$embed" ] || fail "No ${language} source is available for this episode."

    embed_page=$(api_get "$embed") || fail "Could not load the video embed."
    master=$(printf '%s' "$embed_page" | sed -nE "s|.*file: '([^']*)'.*|\1|p" | head -n 1)
    [ -n "$master" ] || fail "The video source did not return a playlist."
    case "$master" in
        http://*|https://*) ;;
        *) master="${embed%/*}/${master#./}" ;;
    esac
    playlist=$(api_get "$master") || fail "Could not load the video playlist."

    links=$(printf '%s' "$playlist" | awk '
        /#EXT-X-STREAM-INF/ {
            info=$0
            url=""
            if (getline url > 0 && url !~ /^#/) {
                height=info
                sub(/^.*RESOLUTION=[0-9]+x/, "", height)
                sub(/[^0-9].*$/, "", height)
                print height "\t" url
            }
        }
    ')
    [ -n "$links" ] || fail "No playable video qualities were returned."

    case "$wanted_quality" in
        1080p|720p|480p) selected=$(printf '%s\n' "$links" | awk -F '\t' -v wanted="${wanted_quality%p}" '$1 == wanted { print; exit }') ;;
        *) selected=$(printf '%s\n' "$links" | sort -nr -k1,1 | head -n 1) ;;
    esac
    [ -n "$selected" ] || selected=$(printf '%s\n' "$links" | sort -nr -k1,1 | head -n 1)
    selected_url=$(printf '%s\n' "$selected" | cut -f 2-)
    case "$selected_url" in
        http://*|https://*) ;;
        *) selected_url="${master%/*}/${selected_url#./}" ;;
    esac
    printf '%s\n' "$selected_url"
}

download_episode() {
    [ $# -ge 5 ] || fail "Missing download destination."
    url=$(stream_url "$1" "$2" "$3" "$4")
    destination="$5"
    if command -v yt-dlp >/dev/null 2>&1; then
        yt-dlp --no-part --no-mtime -o "$destination" "$url" >/dev/null 2>&1 || fail "yt-dlp could not download this episode."
    elif command -v ffmpeg >/dev/null 2>&1; then
        ffmpeg -y -loglevel error -i "$url" -c copy "$destination" >/dev/null 2>&1 || fail "ffmpeg could not download this episode."
    else
        fail "Install yt-dlp or ffmpeg to download episodes."
    fi
}

case "${1:-}" in
    search) search_anime "${2:-}" ;;
    episodes) episode_list "${2:-}" ;;
    stream) stream_url "${2:-}" "${3:-}" "${4:-sub}" "${5:-best}" ;;
    download) download_episode "${2:-}" "${3:-}" "${4:-sub}" "${5:-best}" "${6:-}" ;;
    *) fail "Unknown gui-api operation." ;;
esac

# FxEmbedPreview for Revenge Classic

Port of the Vencord `fxEmbedPreview` plugin to the Vendetta/Bunny-style plugin API used by Revenge Classic.

## Platforms
| Platform | Source | Shows |
|---|---|---|
| X / Twitter | `api.fxtwitter.com/2/status/<id>`, fallback `api.vxtwitter.com` | author, text, photos, video, GIF, quote, poll, likes/reposts/replies/views, date |
| Reddit | `reddit.com/comments/<id>.json` (redd.it and `/s/` share links are resolved first) | title, author, subreddit, self-text, image, gallery (up to 4), video (no audio, Reddit serves it separately), score, comments |
| TikTok | FxEmbed-style proxy (default `tnktok.com`) Open Graph tags, then TikTok oEmbed, then the page's own Open Graph | playable video via the proxy; otherwise title, creator, thumbnail |
| Instagram | proxy domain (default `eeinstagram.com`) Open Graph tags, then the real page | video/image + caption when the proxy works. The real page is usually a login wall, in which case nothing is added and Discord's own embed stays |

All proxy domains are editable in settings. Cards never change message text; `<link>` and suppressed embeds are skipped; each platform can be switched off.

## What changed from the desktop plugin
| Desktop plugin | This port |
|---|---|
| `native.ts` (Electron main process, CSP edits, blob downloads, DNS/IP checks) | Not needed: React Native `fetch` has no CORS/CSP, and the native player plays the video URL directly |
| Custom React card + CSS | Injected Discord embeds, rendered by Discord's own mobile UI |
| Retry link, expandable caption, clickable intent counts, "could not load" notes | Dropped (Discord's embed renderer owns the layout; failures just leave Discord's embed). Use "Clear post cache" in settings to retry |
| Per-host replacement rules / generic OG cards for any site | Replaced by two proxy-domain fields (TikTok, Instagram) |

## How it works
A `before` patch on `FluxDispatcher.dispatch` edits the raw `embeds` of `MESSAGE_CREATE`, `MESSAGE_UPDATE` and `LOAD_MESSAGES_SUCCESS` payloads when the post is cached. On a cache miss it fetches, then dispatches a local `MESSAGE_UPDATE` with the new embeds. Discord's later unfurl updates pass through the same hook, so the card is not overwritten.

## Install / build
```
pnpm i   # or npm i / bun i
pnpm build
```
Serve `dist/` (e.g. `npx http-server dist -p 4040 --cors`), then in Revenge Classic: Settings > Plugins > + and enter `http://<your-pc-ip>:4040/`.

If the loader rejects the output, drop `src/` and `manifest.json` into `vendetta-mod/plugin-template` and build with its script.

## Known limits
- Messages already on screen when the plugin loads lose Discord's non-X embeds if hide-original is on (their raw embeds were never seen). Reopening the channel fixes it.
- Native playback of `video.twimg.com` URLs inside injected embeds is best-effort; confirm on your Discord version.

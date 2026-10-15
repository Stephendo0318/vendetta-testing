// Post lookups for X, Reddit, Instagram and TikTok. React Native's fetch has no CORS/CSP limits, so no native helper is needed.
// Note: avoids `new URL(...)` on purpose; React Native's URL polyfill is incomplete.

export type Provider = "x" | "reddit" | "instagram" | "tiktok";

export interface PostLink { provider: Provider; key: string; url: string; username?: string; id?: string; }
export interface FetchConfig { tiktokDomain: string; instagramDomain: string; }

export interface XMedia { url: string; thumbnail?: string; type?: string; width?: number; height?: number; }
export interface XPoll { choices: Array<{ label?: string; percentage?: number; }>; totalVotes?: number; timeLeft?: string; }
export interface XQuote { name?: string; screenName?: string; text?: string; url?: string; }
export interface Post {
    provider: Provider;
    url: string;
    title?: string;
    name?: string;
    screenName?: string;
    authorUrl?: string;
    avatar?: string;
    text?: string;
    tag?: string; // e.g. "r/pics"
    nsfw?: boolean;
    videos: XMedia[];
    photos: XMedia[];
    createdAt?: string;
    likes?: number; // Reddit: score
    reposts?: number;
    replies?: number; // Reddit: comment count
    quotes?: number;
    views?: number;
    quote?: XQuote;
    poll?: XPoll;
}

const BROWSER_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const BOT_UA = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)";

const sizeOf = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
const num = (v: unknown) => typeof v === "number" ? v : undefined;
const isoFromSeconds = (s: unknown) => typeof s === "number" ? new Date(s * 1000).toISOString() : undefined;

// ---------- HTTP helpers ----------

interface Res { status: number; text: string; url: string; }

async function request(url: string, headers: Record<string, string> = {}, ms = 12000): Promise<Res> {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : undefined;
    const timer = setTimeout(() => ctrl?.abort(), ms);
    try {
        const res = await fetch(url, { signal: ctrl?.signal, headers });
        const text = await res.text().catch(() => "");
        return { status: res.status, text, url: res.url || url };
    } finally {
        clearTimeout(timer);
    }
}

const ok = (r: Res) => r.status >= 200 && r.status < 300;

async function getJson(url: string, headers: Record<string, string> = {}, ms?: number): Promise<{ status: number; json: any; }> {
    const r = await request(url, { Accept: "application/json", ...headers }, ms);
    let json: any = null;
    try { json = JSON.parse(r.text); } catch { /* not JSON */ }
    return { status: r.status, json };
}

/** Follows redirects (short links) and returns the final URL. */
async function resolveUrl(url: string): Promise<string> {
    try {
        const r = await request(url, { "User-Agent": BROWSER_UA, Accept: "text/html" }, 12000);
        return r.url || url;
    } catch {
        return url;
    }
}

const hostOf = (url: string) => /^https?:\/\/([^/?#:]+)/i.exec(url)?.[1]?.toLowerCase();

/** tiktok.com -> tnktok.com, keeping subdomains (vm.tiktok.com -> vm.tnktok.com) and dropping www/m. */
function swapHost(url: string, base: string, domain: string) {
    const target = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!target) return url;
    return url.replace(/^(https?:\/\/)([^/?#]+)/i, (_, scheme: string, host: string) => {
        const h = host.toLowerCase().replace(/^(?:www|m|mobile)\./, "");
        const sub = h.endsWith(base) ? h.slice(0, h.length - base.length) : "";
        return `${scheme}${sub}${target}`;
    });
}

const absUrl = (value: string | undefined, base: string) => {
    if (!value) return undefined;
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("//")) return `https:${value}`;
    const origin = /^(https?:\/\/[^/?#]+)/i.exec(base)?.[1];
    return origin && value.startsWith("/") ? origin + value : undefined;
};

// ---------- Open Graph scraping ----------

function decodeEntities(value: string) {
    return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
        if (entity[0] === "#") {
            const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
            try { return String.fromCodePoint(code); } catch { return ""; }
        }
        return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[entity.toLowerCase()] ?? "";
    });
}

function readMetaTags(html: string) {
    const tags: Record<string, string> = {};
    for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
        const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
        const m = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag);
        const content = m?.[1] ?? m?.[2];
        if (key && content != null && !(key in tags)) tags[key] = decodeEntities(content);
    }
    return tags;
}

interface Og { title?: string; description?: string; image?: string; video?: string; }

async function fetchOg(url: string, ua: string): Promise<Og | null> {
    const r = await request(url, { "User-Agent": ua, Accept: "text/html,application/xhtml+xml" }, 15000);
    if (!ok(r)) return null;
    const html = r.text.slice(0, 1_000_000);
    const meta = readMetaTags(html);
    const base = r.url || url;
    const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
    const videoType = meta["og:video:type"] ?? "";
    const og: Og = {
        title: meta["og:title"] ?? meta["twitter:title"] ?? (titleTag ? decodeEntities(titleTag) : undefined),
        description: meta["og:description"] ?? meta["twitter:description"] ?? meta.description,
        image: absUrl(meta["og:image"] ?? meta["twitter:image"], base),
        video: /html/i.test(videoType) ? undefined : absUrl(meta["og:video:secure_url"] ?? meta["og:video:url"] ?? meta["og:video"] ?? meta["twitter:player:stream"], base)
    };
    return og.title || og.description || og.image || og.video ? og : null;
}

function postFromOg(provider: Provider, url: string, og: Og): Post {
    return {
        provider,
        url,
        title: og.title,
        text: og.description && og.description !== og.title ? og.description : undefined,
        videos: og.video ? [{ url: og.video, thumbnail: og.image, type: "video" }] : [],
        photos: !og.video && og.image ? [{ url: og.image }] : []
    };
}

// ---------- X / Twitter ----------

function normalizeFx(s: any, url: string): Post {
    const quote = s.quote && s.quote.type !== "tombstone" ? s.quote : undefined;
    const rawVideos: any[] = s.media?.videos?.length ? s.media.videos : quote?.media?.videos ?? [];
    return {
        provider: "x",
        url,
        name: s.author?.name,
        screenName: s.author?.screen_name,
        avatar: s.author?.avatar_url ?? undefined,
        text: s.text,
        videos: rawVideos.filter(v => v.url).map(v => ({ url: v.url, thumbnail: v.thumbnail_url, type: v.type, width: sizeOf(v.width), height: sizeOf(v.height) })),
        photos: (s.media?.photos ?? []).filter((p: any) => p.url).map((p: any) => ({ url: p.url, width: sizeOf(p.width), height: sizeOf(p.height) })),
        createdAt: s.created_at,
        likes: num(s.likes), reposts: num(s.reposts), replies: num(s.replies), quotes: num(s.quotes), views: num(s.views),
        quote: quote ? { name: quote.author?.name, screenName: quote.author?.screen_name, text: quote.text, url: quote.url } : undefined,
        poll: s.poll?.choices?.length ? {
            choices: s.poll.choices.map((c: any) => ({ label: c.label, percentage: num(c.percentage) })),
            totalVotes: num(s.poll.total_votes),
            timeLeft: s.poll.time_left_en
        } : undefined
    };
}

function normalizeVx(t: any, url: string): Post {
    const ext: any[] = Array.isArray(t.media_extended) ? t.media_extended : [];
    const videos: XMedia[] = ext
        .filter(m => /video|gif/i.test(m.type ?? "") && typeof m.url === "string")
        .map(m => ({ url: m.url, thumbnail: m.thumbnail_url, type: m.type, width: sizeOf(m.size?.width), height: sizeOf(m.size?.height) }));
    for (const u of Array.isArray(t.mediaURLs) ? t.mediaURLs : []) {
        if (typeof u === "string" && /video\.twimg\.com/i.test(u) && !videos.some(v => v.url === u))
            videos.push({ url: u, type: /tweet_video/i.test(u) ? "gif" : "video" });
    }
    return {
        provider: "x",
        url,
        name: t.user_name,
        screenName: t.user_screen_name,
        avatar: t.user_profile_image_url ?? t.profile_image_url,
        text: t.text,
        videos,
        photos: ext.filter(m => /photo|image/i.test(m.type ?? "") && typeof m.url === "string").map(m => ({ url: m.url, width: sizeOf(m.size?.width), height: sizeOf(m.size?.height) })),
        createdAt: t.date,
        likes: num(t.likes), reposts: num(t.retweets), replies: num(t.replies), views: num(t.views)
    };
}

async function fetchX(link: PostLink): Promise<Post | null> {
    const id = link.id!;
    const ua = { "User-Agent": "Revenge-FxEmbedPreview" };
    let fallback = false;
    try {
        const { status, json } = await getJson(`https://api.fxtwitter.com/2/status/${id}`, ua);
        if (status >= 200 && status < 300 && json) {
            if (json.code === 200 && json.status && json.status.type !== "tombstone")
                return normalizeFx(json.status, `https://x.com/${json.status.author?.screen_name ?? link.username}/status/${id}`);
            const code = json.code ?? 0;
            fallback = code >= 500 || code === 429 || !json.status;
            if (!fallback) return null;
        } else {
            fallback = status >= 500 || status === 429 || !json;
            if (!fallback) return null;
        }
    } catch {
        fallback = true; // network failure
    }
    if (!fallback) return null;

    try {
        const user = link.username && /^[A-Za-z0-9_]{1,30}$/.test(link.username) ? link.username : "i";
        const { status, json } = await getJson(`https://api.vxtwitter.com/${encodeURIComponent(user)}/status/${id}`, ua);
        if (status < 200 || status >= 300 || !json) return null;
        const tweet = json.tweet ?? json;
        if (!tweet || (!tweet.tweetID && !tweet.text && !tweet.mediaURLs && !tweet.media_extended)) return null;
        return normalizeVx(tweet, `https://x.com/${tweet.user_screen_name ?? user}/status/${id}`);
    } catch {
        return null;
    }
}

// ---------- Reddit ----------

function normalizeReddit(json: any, fallbackUrl: string): Post | null {
    // The comments endpoint returns [postListing, commentListing].
    const listing = Array.isArray(json) ? json[0] : json;
    const d = listing?.data?.children?.[0]?.data;
    if (!d || d.removed_by_category === "deleted") return null;

    const m = d.crosspost_parent_list?.[0] ?? d;
    const preview = m.preview?.images?.[0]?.source;
    let photos: XMedia[] = [];

    if (m.is_gallery && m.gallery_data?.items && m.media_metadata) {
        for (const item of m.gallery_data.items) {
            const s = m.media_metadata[item.media_id]?.s;
            const u = s?.u ?? s?.gif;
            if (typeof u === "string") photos.push({ url: u, width: sizeOf(s.x), height: sizeOf(s.y) });
        }
    }
    if (!photos.length && typeof preview?.url === "string") photos.push({ url: preview.url, width: sizeOf(preview.width), height: sizeOf(preview.height) });
    else if (!photos.length && typeof m.url_overridden_by_dest === "string" && /\.(?:jpe?g|png|gif|webp)(?:\?|$)/i.test(m.url_overridden_by_dest))
        photos.push({ url: m.url_overridden_by_dest });

    // Reddit's fallback MP4 has no audio track (audio is a separate DASH stream).
    const rv = m.secure_media?.reddit_video ?? m.preview?.reddit_video_preview;
    const videos: XMedia[] = typeof rv?.fallback_url === "string"
        ? [{ url: rv.fallback_url, thumbnail: preview?.url, type: rv.is_gif ? "gif" : "video", width: sizeOf(rv.width), height: sizeOf(rv.height) }]
        : [];
    if (videos.length) photos = [];

    let text = typeof d.selftext === "string" ? d.selftext.slice(0, 1500) : "";
    const external = m.url_overridden_by_dest;
    if (!d.is_self && typeof external === "string" && !photos.length && !videos.length && !/reddit\.com|redd\.it/i.test(external))
        text = `${text}${text ? "\n\n" : ""}${external}`;

    return {
        provider: "reddit",
        url: typeof d.permalink === "string" ? `https://www.reddit.com${d.permalink}` : fallbackUrl,
        title: typeof d.title === "string" ? d.title : undefined,
        name: typeof d.author === "string" ? `u/${d.author}` : undefined,
        authorUrl: typeof d.author === "string" ? `https://www.reddit.com/user/${d.author}` : undefined,
        tag: d.subreddit_name_prefixed,
        nsfw: !!d.over_18,
        text: text || undefined,
        videos,
        photos,
        createdAt: isoFromSeconds(d.created_utc),
        likes: num(d.score),
        replies: num(d.num_comments)
    };
}

async function fetchReddit(link: PostLink): Promise<Post | null> {
    let url = link.url;
    if (/\/\/redd\.it\//i.test(url) || /\/s\/[A-Za-z0-9]+/.test(url)) url = await resolveUrl(url);
    const id = /\/comments\/([a-z0-9]+)/i.exec(url)?.[1];
    if (!id) return null;
    const { status, json } = await getJson(`https://www.reddit.com/comments/${id}.json?raw_json=1&limit=1`, { "User-Agent": BROWSER_UA }, 15000);
    if (status < 200 || status >= 300 || !json) return null;
    return normalizeReddit(json, url);
}

// ---------- TikTok ----------

async function fetchTikTok(link: PostLink, cfg: FetchConfig): Promise<Post | null> {
    // 1) An FxEmbed-style proxy (tnktok.com by default) exposes the playable video through Open Graph tags.
    if (cfg.tiktokDomain.trim()) {
        try {
            const og = await fetchOg(swapHost(link.url, "tiktok.com", cfg.tiktokDomain), BOT_UA);
            if (og && (og.video || og.image)) return postFromOg("tiktok", link.url, og);
        } catch { /* fall through to oEmbed */ }
    }

    // 2) TikTok's public oEmbed gives title, creator and a thumbnail (no playable video).
    let url = link.url;
    if (/\/\/(?:vm|vt)\.tiktok\.com\/|\/\/(?:www\.)?tiktok\.com\/t\//i.test(url)) url = await resolveUrl(url);
    url = url.replace(/[?#].*$/, "");
    try {
        const { status, json } = await getJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { "User-Agent": BROWSER_UA }, 15000);
        if (status >= 200 && status < 300 && json && (json.thumbnail_url || json.title || json.author_name)) {
            return {
                provider: "tiktok",
                url,
                name: json.author_name,
                authorUrl: json.author_url,
                text: json.title,
                videos: [],
                photos: typeof json.thumbnail_url === "string" ? [{ url: json.thumbnail_url, width: sizeOf(json.thumbnail_width), height: sizeOf(json.thumbnail_height) }] : []
            };
        }
    } catch { /* try Open Graph on the page itself */ }

    try {
        const og = await fetchOg(url, BOT_UA);
        return og ? postFromOg("tiktok", url, og) : null;
    } catch {
        return null;
    }
}

// ---------- Instagram ----------

async function fetchInstagram(link: PostLink, cfg: FetchConfig): Promise<Post | null> {
    // A proxy domain (e.g. eeinstagram.com) usually returns usable Open Graph tags including video.
    if (cfg.instagramDomain.trim()) {
        try {
            const og = await fetchOg(swapHost(link.url, "instagram.com", cfg.instagramDomain), BOT_UA);
            if (og && (og.video || og.image)) return postFromOg("instagram", link.url, og);
        } catch { /* fall back to the real page */ }
    }
    // Direct page: often a login wall, in which case there is nothing to show and Discord's own embed stays.
    try {
        const og = await fetchOg(link.url, BROWSER_UA);
        return og && (og.image || og.video) ? postFromOg("instagram", link.url, og) : null;
    } catch {
        return null;
    }
}

// ---------- Cache: 30 min for hits, 30 s for failures, 200 entries max ----------

const OK_TTL = 30 * 60 * 1000;
const FAIL_TTL = 30 * 1000;
const MAX_ENTRIES = 200;

interface Entry { expires: number; promise: Promise<Post | null>; settled?: { value: Post | null; }; }
const cache = new Map<string, Entry>();

/** undefined = not requested yet / still loading, null = failed recently, Post = ready. */
export function peekPost(key: string): Post | null | undefined {
    const e = cache.get(key);
    if (!e || e.expires < Date.now() || !e.settled) return undefined;
    return e.settled.value;
}

function fetchPost(link: PostLink, cfg: FetchConfig): Promise<Post | null> {
    switch (link.provider) {
        case "x": return fetchX(link);
        case "reddit": return fetchReddit(link);
        case "tiktok": return fetchTikTok(link, cfg);
        case "instagram": return fetchInstagram(link, cfg);
    }
}

export function loadPost(link: PostLink, cfg: FetchConfig): Promise<Post | null> {
    const hit = cache.get(link.key);
    if (hit && hit.expires >= Date.now()) return hit.promise;

    const entry: Entry = { expires: Date.now() + OK_TTL, promise: undefined as any };
    entry.promise = fetchPost(link, cfg).catch(() => null).then(value => {
        entry.settled = { value };
        entry.expires = Date.now() + (value ? OK_TTL : FAIL_TTL);
        return value;
    });
    cache.delete(link.key);
    cache.set(link.key, entry);
    while (cache.size > MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
    }
    return entry.promise;
}

export const clearPostCache = () => cache.clear();
export { hostOf };

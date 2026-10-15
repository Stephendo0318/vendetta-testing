import type { Post, PostLink, Provider, XMedia } from "./api";

export type Providers = Record<Provider, boolean>;
export interface EmbedOptions { hideOriginal: boolean; showStats: boolean; showQuote: boolean; showPoll: boolean; maxMedia: number; providers: Providers; }

const MARKER = "FxEmbed";
const COLORS: Record<Provider, number> = { x: 0x6364ff, reddit: 0xff4500, instagram: 0xe1306c, tiktok: 0xfe2c55 };
const LABELS: Record<Provider, string> = { x: "X", reddit: "Reddit", instagram: "Instagram", tiktok: "TikTok" };

// A leading "<" means the sender suppressed the embed, so those links are skipped.
const PATTERNS: Array<{ provider: Provider; src: string; }> = [
    { provider: "x", src: "(<)?(https?:\\/\\/(?:(?:www|mobile)\\.)?(?:x|twitter)\\.com\\/([A-Za-z0-9_]{1,30})\\/(?:i\\/)?(?:web\\/)?status\\/(\\d{1,25})[^\\s<>]*)" },
    { provider: "reddit", src: "(<)?(https?:\\/\\/(?:(?:www|old|new|np|m)\\.)?reddit\\.com\\/r\\/[A-Za-z0-9_]+\\/(?:comments|s)\\/[A-Za-z0-9]+[^\\s<>]*|https?:\\/\\/redd\\.it\\/[A-Za-z0-9]+[^\\s<>]*)" },
    { provider: "instagram", src: "(<)?(https?:\\/\\/(?:www\\.)?instagram\\.com\\/(?:[A-Za-z0-9_.]+\\/)?(?:p|reel|reels|tv)\\/[A-Za-z0-9_-]+[^\\s<>]*|https?:\\/\\/(?:www\\.)?instagram\\.com\\/share\\/(?:(?:p|reel)\\/)?[A-Za-z0-9_-]+[^\\s<>]*)" },
    { provider: "tiktok", src: "(<)?(https?:\\/\\/(?:(?:www|m)\\.)?tiktok\\.com\\/@[A-Za-z0-9_.]+\\/(?:video|photo)\\/\\d+[^\\s<>]*|https?:\\/\\/(?:vm|vt)\\.tiktok\\.com\\/[A-Za-z0-9]+[^\\s<>]*|https?:\\/\\/(?:www\\.)?tiktok\\.com\\/t\\/[A-Za-z0-9]+[^\\s<>]*)" }
];

export const ALL_PROVIDERS: Providers = { x: true, reddit: true, instagram: true, tiktok: true };

const canon = (url: string) => url.replace(/[?#].*$/, "").replace(/[),.!?]+$/, "").replace(/\/+$/, "");

function keyFor(provider: Provider, url: string, xId?: string) {
    if (provider === "x") return `x:${xId}`;
    const id = provider === "reddit" ? /(?:\/comments\/|redd\.it\/)([A-Za-z0-9]+)/i.exec(url)?.[1]
        : provider === "instagram" ? /\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i.exec(url)?.[1]
        : /\/(?:video|photo)\/(\d+)/i.exec(url)?.[1];
    return `${provider}:${(id ?? url).toLowerCase()}`;
}

/** Unique supported links in a message, in order of appearance (max 3). */
export function parseLinks(content: string | undefined, providers: Providers = ALL_PROVIDERS, max = 3): PostLink[] {
    if (!content) return [];
    const found: Array<{ index: number; link: PostLink; }> = [];
    for (const { provider, src } of PATTERNS) {
        if (!providers[provider]) continue;
        const re = new RegExp(src, "gi");
        let m: RegExpExecArray | null;
        while ((m = re.exec(content))) {
            if (m[1]) continue;
            if (provider === "x") {
                found.push({ index: m.index, link: { provider, key: keyFor(provider, m[2], m[4]), url: `https://x.com/${m[3]}/status/${m[4]}`, username: m[3], id: m[4] } });
            } else {
                const url = canon(m[2]);
                found.push({ index: m.index, link: { provider, key: keyFor(provider, url), url } });
            }
        }
    }
    found.sort((a, b) => a.index - b.index);
    const out: PostLink[] = [];
    for (const { link } of found) if (!out.some(l => l.key === link.key)) out.push(link);
    return out.slice(0, max);
}

// Our main embed carries the footer marker; extra gallery items carry it as provider name.
export const isOurs = (embed: any) =>
    (typeof embed?.footer?.text === "string" && embed.footer.text.startsWith(MARKER)) || embed?.provider?.name === MARKER;

function hostProvider(url: string): Provider | undefined {
    const host = /^https?:\/\/([^/?#:]+)/i.exec(url ?? "")?.[1]?.toLowerCase().replace(/^www\./, "");
    if (!host) return undefined;
    if (/(^|\.)(?:x|twitter|fxtwitter|vxtwitter|fixupx|fixvx)\.com$/.test(host)) return "x";
    if (/(^|\.)(?:reddit\.com|redd\.it|rxddit\.com)$/.test(host)) return "reddit";
    if (/(^|\.)(?:instagram|ddinstagram|eeinstagram|kkinstagram|uuinstagram|vxinstagram|fxstagram|instagramez)\.com$/.test(host)) return "instagram";
    if (/(^|\.)(?:tiktok|tnktok|tiktxk|vxtiktok|tiktokez|fixtiktok)\.com$/.test(host)) return "tiktok";
    return undefined;
}

function compact(n: number) {
    if (n < 1000) return String(n);
    const fmt = (v: number, s: string) => `${v.toFixed(v < 10 ? 1 : 0).replace(/\.0$/, "")}${s}`;
    return n < 1_000_000 ? fmt(n / 1000, "K") : fmt(n / 1_000_000, "M");
}

const dims = (m: XMedia) => ({ ...(m.width ? { width: m.width } : {}), ...(m.height ? { height: m.height } : {}) });
const asMedia = (m: XMedia, url: string) => ({ url, proxy_url: url, ...dims(m) });

function description(post: Post, o: EmbedOptions) {
    const parts: string[] = [];
    if (post.nsfw) parts.push("🔞 **NSFW**");
    if (post.text) parts.push(post.text);
    if (o.showQuote && post.quote && (post.quote.text || post.quote.name)) {
        const who = post.quote.name || post.quote.screenName || "Quoted post";
        const handle = post.quote.screenName ? ` (@${post.quote.screenName})` : "";
        const body = (post.quote.text ?? "").split("\n").map(l => `> ${l}`).join("\n");
        parts.push(`> **${who}**${handle}\n${body}`);
    }
    if (o.showPoll && post.poll) {
        const lines = post.poll.choices.map(c => {
            const p = Math.max(0, Math.min(100, Math.round(c.percentage ?? 0)));
            const filled = Math.round(p / 10);
            return `${"▓".repeat(filled)}${"░".repeat(10 - filled)} ${p}% ${c.label ?? ""}`.trimEnd();
        });
        const note = [post.poll.totalVotes != null ? `${post.poll.totalVotes.toLocaleString()} votes` : "", post.poll.timeLeft ?? ""].filter(Boolean).join(" · ");
        parts.push(lines.join("\n") + (note ? `\n*${note}*` : ""));
    }
    return parts.join("\n\n").slice(0, 4000);
}

function footer(post: Post, o: EmbedOptions) {
    const bits: string[] = [];
    if (post.provider !== "x") bits.push(post.tag ?? LABELS[post.provider]);
    if (o.showStats) {
        if (post.provider === "reddit") {
            if (post.likes != null) bits.push(`⬆ ${compact(post.likes)}`);
            if (post.replies != null) bits.push(`💬 ${compact(post.replies)}`);
        } else if (post.provider === "x") {
            const stats = [
                post.replies != null && `💬 ${compact(post.replies)}`,
                post.reposts != null && `🔁 ${compact(post.reposts)}`,
                post.likes != null && `❤️ ${compact(post.likes)}`,
                post.views != null && `👁 ${compact(post.views)}`,
                post.quotes ? `↪ ${compact(post.quotes)}` : false
            ].filter(Boolean).join("  ");
            if (stats) bits.push(stats);
        }
    }
    return [MARKER, ...bits].join(" · ");
}

type Kind = "video" | "gifv" | "photo";

/** Builds gateway-shaped (snake_case) embeds, so Discord's own store/renderer treats them like server embeds. */
export function buildEmbeds(post: Post, o: EmbedOptions): any[] {
    const desc = description(post, o);
    const media: Array<{ kind: Kind; m: XMedia; }> = [
        ...post.videos.map(m => ({ kind: (m.type?.toLowerCase() === "gif" ? "gifv" : "video") as Kind, m })),
        ...post.photos.map(m => ({ kind: "photo" as Kind, m }))
    ].slice(0, Math.max(1, o.maxMedia));

    if (!media.length && !desc && !post.title) return [];

    const date = post.createdAt ? new Date(post.createdAt) : undefined;
    const head: any = {
        url: post.url,
        color: COLORS[post.provider],
        ...(post.title ? { title: post.title.slice(0, 256) } : {}),
        ...(desc ? { description: desc } : {}),
        ...(date && !Number.isNaN(date.getTime()) ? { timestamp: date.toISOString() } : {}),
        footer: { text: footer(post, o) }
    };

    if (post.provider === "x" && (post.name || post.screenName)) {
        head.author = {
            name: post.name && post.screenName ? `${post.name} (@${post.screenName})` : post.name || `@${post.screenName}`,
            url: `https://x.com/${post.screenName ?? ""}`,
            ...(post.avatar ? { icon_url: post.avatar, proxy_icon_url: post.avatar } : {})
        };
    } else if (post.name) {
        head.author = { name: post.name, ...(post.authorUrl ? { url: post.authorUrl } : {}) };
    }

    const mediaFields = ({ kind, m }: { kind: Kind; m: XMedia; }) => {
        if (kind === "photo") return { type: "rich", image: asMedia(m, m.url) };
        return { type: kind, video: asMedia(m, m.url), ...(m.thumbnail ? { thumbnail: asMedia(m, m.thumbnail) } : {}) };
    };

    if (!media.length) return [{ ...head, type: "rich" }];
    // Extra items share the same url, which Discord groups into one gallery.
    return media.map((item, i) => i === 0 ? { ...head, ...mediaFields(item) } : { url: post.url, provider: { name: MARKER }, ...mediaFields(item) });
}

/** Replaces Discord's own embeds for the given links (if enabled) and appends ours. */
export function composeEmbeds(discord: any[], links: PostLink[], posts: Array<Post | null | undefined>, o: EmbedOptions) {
    const ready = new Map<string, { link: PostLink; post: Post; }>();
    links.forEach((link, i) => { const p = posts[i]; if (p) ready.set(link.key, { link, post: p }); });
    if (!ready.size) return { embeds: discord, changed: false };

    const readyLinks = [...ready.values()].map(r => r.link);
    const perProvider = (p: Provider) => links.filter(l => l.provider === p).length;

    const hides = (e: any) => {
        const url: string = e?.url ?? "";
        const exact = parseLinks(url, ALL_PROVIDERS, 1)[0];
        if (exact && ready.has(exact.key)) return true;
        // Short links resolve to a different URL on Discord's side: fall back to "the only link of that platform".
        const hp = hostProvider(url);
        return !!hp && perProvider(hp) === 1 && readyLinks.some(l => l.provider === hp);
    };

    const kept = discord.filter(e => !isOurs(e) && !(o.hideOriginal && hides(e)));
    const ours: any[] = [];
    ready.forEach(({ post }) => ours.push(...buildEmbeds(post, o)));
    return { embeds: [...kept, ...ours], changed: true };
}

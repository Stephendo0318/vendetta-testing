import { findByStoreName } from "@vendetta/metro";
import { FluxDispatcher } from "@vendetta/metro/common";
import { before } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";

import { type FetchConfig, loadPost, type PostLink, peekPost } from "./api";
import { composeEmbeds, type EmbedOptions, isOurs, parseLinks } from "./embeds";

const MessageStore = findByStoreName("MessageStore");
const ChannelStore = findByStoreName("ChannelStore");
const SelectedChannelStore = findByStoreName("SelectedChannelStore");

const SUPPRESS_EMBEDS = 1 << 2;

interface Ref { channelId: string; messageId: string; }
const keyOf = (r: Ref) => `${r.channelId}:${r.messageId}`;

// Discord's own raw embeds per message, so we can put them back or keep them when our card is added.
const rawEmbeds = new Map<string, any[]>();
const injected = new Set<string>();
const pending = new Map<string, Map<string, Ref>>(); // status id -> refs waiting for that post
const lastSent = new Map<string, string>();
let unpatch: (() => void) | undefined;

function trim(map: Map<string, unknown> | Set<string>, max = 500) {
    while (map.size > max) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
    }
}

export const DEFAULT_TIKTOK_DOMAIN = "tnktok.com";
export const DEFAULT_INSTAGRAM_DOMAIN = "eeinstagram.com";

export const getOptions = (): EmbedOptions => ({
    hideOriginal: storage.hideOriginal !== false,
    showStats: storage.showStats !== false,
    showQuote: storage.showQuote !== false,
    showPoll: storage.showPoll !== false,
    maxMedia: 4,
    providers: {
        x: storage.enableX !== false,
        reddit: storage.enableReddit !== false,
        instagram: storage.enableInstagram !== false,
        tiktok: storage.enableTikTok !== false
    }
});

export const getConfig = (): FetchConfig => ({
    tiktokDomain: typeof storage.tiktokDomain === "string" ? storage.tiktokDomain : DEFAULT_TIKTOK_DOMAIN,
    instagramDomain: typeof storage.instagramDomain === "string" ? storage.instagramDomain : DEFAULT_INSTAGRAM_DOMAIN
});

function track(link: PostLink, ref: Ref) {
    let refs = pending.get(link.key);
    if (!refs) pending.set(link.key, refs = new Map());
    refs.set(keyOf(ref), ref);
    loadPost(link, getConfig()).then(() => flush(link.key));
}

function flush(postKey: string) {
    const refs = pending.get(postKey);
    if (!refs) return;
    pending.delete(postKey);
    refs.forEach(refresh);
}

function dispatchEmbeds(ref: Ref, embeds: any[]) {
    FluxDispatcher.dispatch({
        type: "MESSAGE_UPDATE",
        __fxp: true, // our own hook ignores this event
        message: {
            id: ref.messageId,
            channel_id: ref.channelId,
            guild_id: ChannelStore?.getChannel?.(ref.channelId)?.guild_id,
            embeds
        }
    });
}

/** Recomputes the embeds of a message already in the store and pushes them as a MESSAGE_UPDATE. */
function refresh(ref: Ref) {
    try {
        const stored = MessageStore?.getMessage?.(ref.channelId, ref.messageId);
        if (!stored || (stored.flags ?? 0) & SUPPRESS_EMBEDS) return;

        const opts = getOptions();
        const links = parseLinks(stored.content, opts.providers);
        const key = keyOf(ref);
        const base = rawEmbeds.get(key) ?? [];
        const restore = () => {
            if (injected.delete(key)) {
                lastSent.delete(key);
                dispatchEmbeds(ref, base);
            }
        };

        if (!links.length) return restore();
        const { embeds, changed } = composeEmbeds(base, links, links.map(l => peekPost(l.key)), opts);
        if (!changed) return restore();

        const signature = JSON.stringify(embeds);
        if (lastSent.get(key) === signature) return;
        lastSent.set(key, signature);
        trim(lastSent);

        injected.add(key);
        trim(injected);
        dispatchEmbeds(ref, embeds);
    } catch (e) {
        console.warn("[FxEmbedPreview] refresh failed", e);
    }
}

/** Runs synchronously inside the dispatcher: patches the raw message payload before the stores see it. */
function processRaw(msg: any, partial: boolean) {
    if (!msg?.id || !msg.channel_id) return;

    const ref: Ref = { channelId: msg.channel_id, messageId: msg.id };
    const stored = MessageStore?.getMessage?.(ref.channelId, ref.messageId);
    const content: string | undefined = msg.content ?? stored?.content;
    const flags: number = msg.flags ?? stored?.flags ?? 0;
    if (!content || flags & SUPPRESS_EMBEDS) return;

    const opts = getOptions();
    const links = parseLinks(content, opts.providers);
    if (!links.length) return;

    const key = keyOf(ref);
    let discord: any[] | undefined;
    if (Array.isArray(msg.embeds)) {
        discord = msg.embeds.filter((e: any) => !isOurs(e));
        rawEmbeds.set(key, discord!);
        trim(rawEmbeds);
    } else if (!partial) {
        discord = [];
    }

    const posts = links.map(l => peekPost(l.key));
    links.forEach((l, i) => { if (posts[i] === undefined) track(l, ref); });

    if (!discord) return;
    const { embeds, changed } = composeEmbeds(discord, links, posts, opts);
    if (changed) {
        msg.embeds = embeds;
        injected.add(key);
        trim(injected);
    }
}

function onDispatch(event: any) {
    if (!event || event.__fxp) return;
    try {
        switch (event.type) {
            case "MESSAGE_CREATE":
                processRaw(event.message, false);
                break;
            case "MESSAGE_UPDATE":
                processRaw(event.message, true);
                break;
            case "LOAD_MESSAGES_SUCCESS":
                if (Array.isArray(event.messages)) event.messages.forEach((m: any) => processRaw(m, false));
                break;
        }
    } catch (e) {
        console.warn("[FxEmbedPreview] dispatch hook failed", e);
    }
}

/** Re-applies the cards to the open channel (used on startup and when a setting changes). */
export function refreshVisible() {
    try {
        const channelId = SelectedChannelStore?.getChannelId?.();
        const collection = channelId && MessageStore?.getMessages?.(channelId);
        const messages: any[] = collection?.toArray?.() ?? collection?._array ?? [];
        for (const m of messages) {
            const links = parseLinks(m.content, getOptions().providers);
            const ref: Ref = { channelId: m.channel_id ?? m.channelId ?? channelId, messageId: m.id };
            links.forEach(l => { if (peekPost(l.key) === undefined) track(l, ref); });
            refresh(ref);
        }
    } catch (e) {
        console.warn("[FxEmbedPreview] refreshVisible failed", e);
    }
}

export function start() {
    unpatch = before("dispatch", FluxDispatcher, ([event]: any[]) => { onDispatch(event); });
    setTimeout(refreshVisible, 0);
}

export function stop() {
    unpatch?.();
    unpatch = undefined;
    // Put Discord's own embeds back on messages we touched.
    injected.forEach(key => {
        const [channelId, messageId] = key.split(":");
        try { dispatchEmbeds({ channelId, messageId }, rawEmbeds.get(key) ?? []); } catch { /* ignore */ }
    });
    injected.clear();
    pending.clear();
    lastSent.clear();
    rawEmbeds.clear();
}

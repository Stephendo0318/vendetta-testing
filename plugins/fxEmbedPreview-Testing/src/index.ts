import { storage } from "@vendetta/plugin";

import Settings from "./Settings";
import { DEFAULT_INSTAGRAM_DOMAIN, DEFAULT_TIKTOK_DOMAIN, start, stop } from "./runtime";

export default {
    onLoad() {
        for (const key of ["hideOriginal", "showStats", "showQuote", "showPoll", "enableX", "enableReddit", "enableInstagram", "enableTikTok"])
            storage[key] ??= true;
        storage.tiktokDomain ??= DEFAULT_TIKTOK_DOMAIN;
        storage.instagramDomain ??= DEFAULT_INSTAGRAM_DOMAIN;
        start();
    },
    onUnload() {
        stop();
    },
    settings: Settings
};

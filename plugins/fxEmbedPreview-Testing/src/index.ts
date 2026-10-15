import { storage } from "@vendetta/plugin";

import Settings from "./Settings";
import { DEFAULT_DOMAINS, start, stop } from "./runtime";

export default {
    onLoad() {
        for (const key of ["hideOriginal", "showStats", "showQuote", "showPoll", "enableX", "enableReddit", "enableInstagram", "enableTikTok"])
            storage[key] ??= true;
        storage.photoStyle ??= "native";
        // New keys (plural) so hosts saved by older versions can't override the fresh defaults.
        for (const [key, value] of Object.entries(DEFAULT_DOMAINS)) storage[key] ??= value;
        start();
    },
    onUnload() {
        stop();
    },
    settings: Settings
};

import { React, ReactNative as RN } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

import { clearPostCache } from "./api";
import { DEFAULT_INSTAGRAM_DOMAIN, DEFAULT_TIKTOK_DOMAIN, refreshVisible } from "./runtime";

// Fall back to plain React Native widgets if this build of the client doesn't expose a Forms component.
const F: any = Forms ?? {};
const Box: any = (props: any) => <RN.View>{props.title ? <RN.Text style={{ margin: 16, fontWeight: "bold" }}>{props.title}</RN.Text> : null}{props.children}</RN.View>;
const FormSection: any = F.FormSection ?? Box;
const FormText: any = F.FormText ?? ((props: any) => <RN.Text style={props.style}>{props.children}</RN.Text>);
const FormSwitchRow: any = F.FormSwitchRow ?? ((props: any) => (
    <RN.View style={{ flexDirection: "row", alignItems: "center", padding: 16 }}>
        <RN.View style={{ flex: 1 }}><RN.Text>{props.label}</RN.Text><RN.Text style={{ opacity: 0.6 }}>{props.subLabel}</RN.Text></RN.View>
        <RN.Switch value={props.value} onValueChange={props.onValueChange} />
    </RN.View>
));
const FormRow: any = F.FormRow ?? ((props: any) => (
    <RN.Pressable onPress={props.onPress} style={{ padding: 16 }}><RN.Text>{props.label}</RN.Text><RN.Text style={{ opacity: 0.6 }}>{props.subLabel}</RN.Text></RN.Pressable>
));
const FormInput: any = F.FormInput ?? ((props: any) => (
    <RN.View style={{ padding: 16 }}><RN.Text>{props.title}</RN.Text><RN.TextInput defaultValue={props.value} placeholder={props.placeholder} onChangeText={props.onChange} autoCapitalize="none" autoCorrect={false} /></RN.View>
));

const PLATFORMS = [
    { key: "enableX", label: "X / Twitter", sub: "x.com and twitter.com post links" },
    { key: "enableReddit", label: "Reddit", sub: "Post links, redd.it and share links" },
    { key: "enableInstagram", label: "Instagram", sub: "Posts, reels and TV. Best-effort, see proxy domain below." },
    { key: "enableTikTok", label: "TikTok", sub: "Video links and vm/vt short links" }
];

const OPTIONS = [
    { key: "hideOriginal", label: "Hide Discord's own embed", sub: "Only when the plugin actually shows a card for that link." },
    { key: "showStats", label: "Show engagement", sub: "Likes, reposts, views, score and comments in the card footer." },
    { key: "showQuote", label: "Show quoted post", sub: "X only." },
    { key: "showPoll", label: "Show polls", sub: "X only." }
];

export default function Settings() {
    useProxy(storage);
    return (
        <RN.ScrollView>
            <FormSection title="Platforms" android_noDivider>
                {PLATFORMS.map(o => (
                    <FormSwitchRow
                        key={o.key}
                        label={o.label}
                        subLabel={o.sub}
                        value={storage[o.key] !== false}
                        onValueChange={(v: boolean) => { storage[o.key] = v; refreshVisible(); }}
                    />
                ))}
            </FormSection>
            <FormSection title="Cards">
                {OPTIONS.map(o => (
                    <FormSwitchRow
                        key={o.key}
                        label={o.label}
                        subLabel={o.sub}
                        value={storage[o.key] !== false}
                        onValueChange={(v: boolean) => { storage[o.key] = v; refreshVisible(); }}
                    />
                ))}
            </FormSection>
            <FormSection title="Proxy domains">
                <FormInput
                    title="TikTok embed domain"
                    placeholder={DEFAULT_TIKTOK_DOMAIN}
                    value={typeof storage.tiktokDomain === "string" ? storage.tiktokDomain : DEFAULT_TIKTOK_DOMAIN}
                    onChange={(v: string) => { storage.tiktokDomain = v.trim(); clearPostCache(); }}
                />
                <FormInput
                    title="Instagram embed domain"
                    placeholder={DEFAULT_INSTAGRAM_DOMAIN}
                    value={typeof storage.instagramDomain === "string" ? storage.instagramDomain : DEFAULT_INSTAGRAM_DOMAIN}
                    onChange={(v: string) => { storage.instagramDomain = v.trim(); clearPostCache(); }}
                />
                <FormText style={{ marginHorizontal: 16, opacity: 0.6 }}>
                    FxEmbed-style services whose Open Graph tags include playable video. Leave empty to read the real site (TikTok then falls back to a thumbnail card; Instagram usually hits a login wall).
                </FormText>
            </FormSection>
            <FormSection title="Cache">
                <FormRow
                    label="Clear post cache"
                    subLabel="Posts are cached for 30 minutes, failed lookups for 30 seconds."
                    onPress={() => { clearPostCache(); refreshVisible(); showToast("Cache cleared"); }}
                />
            </FormSection>
            <FormText style={{ margin: 16, opacity: 0.6 }}>
                Message text is never changed. Cards are local to this device.
            </FormText>
        </RN.ScrollView>
    );
}

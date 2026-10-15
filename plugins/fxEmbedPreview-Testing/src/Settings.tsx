import { React, ReactNative as RN } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

import { clearPostCache } from "./api";
import { DEFAULT_DOMAINS, diagnose, refreshVisible } from "./runtime";

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

const PHOTO_STYLES = [
    { key: "native", label: "Separate image embeds", sub: "Card, then the photos as their own embeds (how Discord shows a bare image link)." },
    { key: "card", label: "Photo inside the card", sub: "Photo sits in the same embed as the text." },
    { key: "thumb", label: "Small thumbnail", sub: "Photo as the card's small corner image." }
] as const;

const HOSTS = [
    { key: "xDomains", title: "X fallback hosts", note: "Used when the API has no media for a quote post." },
    { key: "tiktokDomains", title: "TikTok hosts" },
    { key: "instagramDomains", title: "Instagram hosts" },
    { key: "redditDomains", title: "Reddit fallback hosts", note: "Used when reddit.com blocks the lookup." }
] as const;

export default function Settings() {
    useProxy(storage);
    const [testUrl, setTestUrl] = React.useState("");
    const [report, setReport] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const style = PHOTO_STYLES.find(p => p.key === storage.photoStyle) ?? PHOTO_STYLES[0];

    const runTest = async () => {
        if (busy) return;
        setBusy(true);
        setReport("Testing...");
        try {
            setReport(await diagnose(testUrl));
        } catch (e: any) {
            setReport(`Test crashed: ${String(e?.message ?? e)}`);
        } finally {
            setBusy(false);
        }
    };

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
            <FormSection title="Photos">
                <FormRow
                    label={`Photo display: ${style.label}`}
                    subLabel={`${style.sub} Tap to change.`}
                    onPress={() => {
                        const next = PHOTO_STYLES[(PHOTO_STYLES.findIndex(p => p.key === style.key) + 1) % PHOTO_STYLES.length];
                        storage.photoStyle = next.key;
                        refreshVisible();
                    }}
                />
            </FormSection>
            <FormSection title="Embed hosts">
                {HOSTS.map(h => (
                    <FormInput
                        key={h.key}
                        title={h.title}
                        placeholder={DEFAULT_DOMAINS[h.key]}
                        value={typeof storage[h.key] === "string" ? storage[h.key] : DEFAULT_DOMAINS[h.key]}
                        onChange={(v: string) => { storage[h.key] = v.trim(); clearPostCache(); }}
                    />
                ))}
                <FormText style={{ marginHorizontal: 16, opacity: 0.6 }}>
                    Comma-separated FxEmbed-style hosts. All are asked at once and the first useful answer wins, so a dead host costs nothing. Clear a field to restore the default after an update.
                </FormText>
            </FormSection>
            <FormSection title="Test a link">
                <FormInput
                    title="Link"
                    placeholder="Paste an x.com / reddit / tiktok / instagram link"
                    value={testUrl}
                    onChange={(v: string) => setTestUrl(v)}
                />
                <FormRow label={busy ? "Testing..." : "Run test"} subLabel="Shows which source answered or why each one failed." onPress={runTest} />
                {report ? <RN.Text selectable style={{ margin: 16, fontFamily: "monospace", fontSize: 12, opacity: 0.85 }}>{report}</RN.Text> : null}
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

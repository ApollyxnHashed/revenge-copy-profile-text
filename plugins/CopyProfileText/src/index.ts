import { findByName } from "@vendetta/metro";
import { ReactNative, React } from "@vendetta/metro/common";
import { after, unpatchAll } from "@vendetta/patcher";

/**
 * Recursively walks a rendered React element tree and marks every native
 * <Text> node as selectable, giving it a no-op onPress when it doesn't
 * already have one of its own.
 *
 * The onPress part matters: on Discord's mobile client, a bare <Text>
 * with no press handler lets the OS's native long-press text selection
 * take over. If a parent element is the one handling taps (opening a
 * profile, expanding a card, etc.) that's untouched here - we only ever
 * touch onPress on the Text node itself, and only when it doesn't already
 * have one, so nothing that currently works stops working.
 *
 * Technique lifted directly from shipwr3ckd's CopyBios plugin:
 * https://github.com/shipwr3ckd/revengeplugin/tree/master/plugins/CopyBios
 */
function makeSelectable(node: any): void {
    if (!node || typeof node !== "object") return;

    if (node.type === ReactNative.Text) {
        node.props.selectable = true;

        if (typeof node.props.onPress !== "function") {
            node.props.onPress = () => {};
        }
    }

    const children = node.props?.children;
    if (Array.isArray(children)) {
        for (const child of children) makeSelectable(child);
    } else if (typeof children === "object") {
        makeSelectable(children);
    }
}

/**
 * Scans Metro's already-initialized modules directly, instead of using
 * @vendetta/metro's own find(). Two reasons this exists:
 *
 * 1. The profile screen's top-level component isn't always a clean
 *    top-level export, and a single find() call made once when this file
 *    first runs can miss a module that gets registered a moment later -
 *    and never gets retried on its own.
 * 2. It lets us try more than one possible name for the same component,
 *    which matters because Discord has renamed this particular one
 *    before (see findUserProfile below).
 *
 * This never force-requires a module (which can be unsafe mid-boot) - it
 * only ever looks at modules Metro has already finished initializing.
 */
function rawFind(predicate: (exports: any) => boolean): any {
    // @ts-ignore - injected by Discord's Metro/Hermes runtime
    const modules = (typeof window !== "undefined" ? window.modules : undefined) ?? (globalThis as any).modules;
    if (!modules) return undefined;

    for (const id in modules) {
        const def = modules[id];
        if (!def?.isInitialized) continue;

        const exports = def.publicModule?.exports;
        if (!exports) continue;

        try {
            if (predicate(exports)) return exports;
            if (exports.default != null && predicate(exports.default)) return exports.default;
        } catch {
            // A predicate throwing on one module's shape shouldn't stop the scan.
        }
    }

    return undefined;
}

function findUserProfile(): any {
    // Discord renamed this component before ("UserProfile" ->
    // "UserProfileContent"). Try the current name first, then fall back.
    return (
        rawFind((m) => m?.type?.name === "UserProfileContent") ??
        rawFind((m) => m?.type?.name === "UserProfile")
    );
}

let profilePatched = false;
let bioPatched = false;
let retryHandle: ReturnType<typeof setInterval> | undefined;

/**
 * Patches the whole profile popup/sheet at once. Kept as one layer of
 * defense: covers any <Text> that's a *direct*, already-resolved
 * descendant of what this component itself returns. It does NOT reach
 * text rendered by a nested child component's own render call (that
 * child hasn't run yet at this point) - which is exactly why pronouns
 * and status needed the createElement/jsx patch below as well.
 */
function patchWholeProfile(): boolean {
    const UserProfile = findUserProfile();
    if (!UserProfile) return false;

    after("type", UserProfile, (_args: any[], res: any) => {
        try {
            makeSelectable(res);
        } catch {
            // Don't let a shape we didn't expect crash the profile screen.
        }
        return res;
    });

    return true;
}

/**
 * Extra, independent patch on the bio's own text renderer - the same
 * target CopyBios patches. Kept as a safety net: if Discord ever
 * restructures the profile popup so patchWholeProfile() above stops
 * finding its target, bios stay selectable on their own regardless.
 */
function patchBioText(): boolean {
    const BioText = findByName("BioText", false);
    if (!BioText) return false;

    after("default", BioText, ([_props]: any[], res: any) => {
        if (!res?.props) return res;

        res.props.selectable = true;
        if (typeof res.props.onPress !== "function") {
            res.props.onPress = () => {};
        }

        makeSelectable(res);
        return res;
    });

    return true;
}

/**
 * The pronouns row and the custom-status bubble are each rendered by
 * their own nested child component (not a plain <Text> written directly
 * in UserProfileContent's own JSX, and not a clean top-level Metro
 * export we can findByName either) - so neither patchWholeProfile() nor
 * patchBioText() ever sees their actual <Text> output.
 *
 * Instead of guessing that child component's name, this patches the
 * functions React itself calls to create *every* element in the app -
 * React.createElement, plus the jsx/jsxs/jsxDEV runtime Discord's bundle
 * actually compiles down to - and marks any element being created as a
 * native <Text> selectable right then, regardless of which component
 * created it or how deeply it's nested. That covers pronouns, status,
 * and bio (redundantly - harmless) all at once, and keeps working even
 * if Discord renames/restructures the profile popup again.
 *
 * Same technique (and largely the same implementation) used by other
 * real Revenge plugins - e.g. Staff Tags - to reach components that
 * aren't reachable via a normal findByName lookup.
 */
function patchTextCreation(): void {
    function interceptElementCreation(args: any[], res: any): any {
        if (!res || typeof res !== "object") return res;
        if (args[0] === ReactNative.Text && res.props) {
            res.props.selectable = true;
            if (typeof res.props.onPress !== "function") {
                res.props.onPress = () => {};
            }
        }
        return res;
    }

    if (typeof React?.createElement === "function") {
        after("createElement", React, interceptElementCreation);
    }

    const patchedJsxRuntimes = new WeakSet<any>();

    function isJsxRuntime(m: any): boolean {
        return typeof m?.jsx === "function" || typeof m?.jsxs === "function" || typeof m?.jsxDEV === "function";
    }

    function patchJsxObject(runtime: any): void {
        if (patchedJsxRuntimes.has(runtime)) return;
        patchedJsxRuntimes.add(runtime);
        for (const key of ["jsx", "jsxs", "jsxDEV"] as const) {
            if (typeof runtime[key] !== "function") continue;
            after(key, runtime, interceptElementCreation);
        }
    }

    function scanAndPatchJsxRuntimes(): void {
        // @ts-ignore - injected by Discord's Metro/Hermes runtime
        const modules = (typeof window !== "undefined" ? window.modules : undefined) ?? (globalThis as any).modules;
        if (!modules) return;

        for (const id in modules) {
            const def = modules[id];
            if (!def?.isInitialized) continue;

            const exports = def.publicModule?.exports;
            if (!exports) continue;

            try {
                if (isJsxRuntime(exports)) patchJsxObject(exports);
                const dflt = exports.default;
                if (dflt != null && isJsxRuntime(dflt)) patchJsxObject(dflt);
            } catch {
                // A weirdly-shaped module shouldn't stop the scan.
            }
        }
    }

    // Discord's JSX runtime module isn't always registered yet when this
    // plugin loads, so keep re-scanning for a while (Metro registers
    // modules lazily as screens get visited) instead of only checking once.
    scanAndPatchJsxRuntimes();

    let jsxTicks = 0;
    jsxScanHandle = setInterval(() => {
        scanAndPatchJsxRuntimes();
        if (++jsxTicks >= 80) { // ~24s at 300ms
            if (jsxScanHandle) clearInterval(jsxScanHandle);
            jsxScanHandle = undefined;
        }
    }, 300);
}

let jsxScanHandle: ReturnType<typeof setInterval> | undefined;

function stopRetrying() {
    if (retryHandle) {
        clearInterval(retryHandle);
        retryHandle = undefined;
    }
}

function attempt() {
    if (!profilePatched) profilePatched = patchWholeProfile();
    if (!bioPatched) bioPatched = patchBioText();
    if (profilePatched && bioPatched) stopRetrying();
}

// Try immediately (this is enough most of the time - it's exactly what
// CopyBios does), then keep retrying every 300ms for ~12s in case one of
// the targets registers a little late during app startup.
attempt();
if (!(profilePatched && bioPatched)) {
    let ticks = 0;
    retryHandle = setInterval(() => {
        attempt();
        if (++ticks >= 40) stopRetrying();
    }, 300);
}

patchTextCreation();

export const onUnload = () => {
    stopRetrying();
    if (jsxScanHandle) {
        clearInterval(jsxScanHandle);
        jsxScanHandle = undefined;
    }
    unpatchAll();
};

/**
 * Gnome Stronghold gate entry (2459,3383). The gate script auto-walks the
 * player through (forcemove ±3z) — never sendWalk while it runs.
 *
 * Fresh-account trap: with %femi_help=0 and Femi within 6 tiles the click
 * opens her boxes dialog INSTEAD of passing. Answer "Sorry, I'm a bit busy."
 * (sets femi_help=1, declines) and the script resumes into the passage.
 * An unanswered dialog stalls the script at the gate indefinitely.
 */
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';

export const GNOME_GATE = { x: 2459, z: 3383 };

export type GateDeps = {
    sdk: BotSDK;
    bot: BotActions;
    log: (msg: string) => void;
    intent: (msg: string) => void;
    pos: () => { x: number; z: number; level: number };
    walkNear: (x: number, z: number, tolerance?: number) => Promise<boolean>;
    closeUi: () => Promise<void>;
};

async function answerFemi(d: GateDeps): Promise<boolean> {
    for (let i = 0; i < 12; i++) {
        const dialog = d.sdk.getDialog() as any;
        const opts: Array<{ index: number; text: string }> = dialog?.options ?? [];
        const busy = opts.find((o) => /busy/i.test(o.text ?? ''));
        if (dialog?.isOpen && busy) {
            d.log('Femi boxes dialog — declining to pass the gate');
            await d.sdk.sendClickDialog(busy.index);
            await d.sdk.waitForTicks(4).catch(() => {});
            return true;
        }
        if (!dialog?.isOpen) return false;
        await d.sdk.waitForTicks(1).catch(() => {});
    }
    return false;
}

/** Click the gate and ride its forcemove through. True once past the line. */
export async function enterGnomeStronghold(d: GateDeps): Promise<boolean> {
    const z0 = d.pos().z;
    const fromSouth = z0 <= GNOME_GATE.z;
    for (let attempt = 1; attempt <= 4; attempt++) {
        if (fromSouth !== d.pos().z <= GNOME_GATE.z) return true; // crossed meanwhile
        await d.closeUi();
        await d.walkNear(GNOME_GATE.x, GNOME_GATE.z, 2);
        await d.sdk.scanNearbyLocs(10).catch(() => {});
        const gate = (d.sdk.getNearbyLocs() ?? []).find(
            (l) =>
                Math.abs(l.x - GNOME_GATE.x) <= 2 &&
                Math.abs(l.z - GNOME_GATE.z) <= 2 &&
                /^gate$/i.test(l.name) &&
                l.optionsWithIndex.some((o) => /^open$/i.test(o.text))
        );
        if (!gate) {
            d.log(`Gate try ${attempt}: no Open gate visible @ ${d.pos().x},${d.pos().z} — settling`);
            await d.sdk.waitForTicks(6).catch(() => {});
            continue;
        }
        d.intent('Opening gnome stronghold gate');
        d.log(`Opening gate @ ${gate.x},${gate.z} (try ${attempt})`);
        const r = await d.bot.interactLoc(gate, /open/i);
        if (!r.success) {
            const openOpt = gate.optionsWithIndex.find((o) => /^open$/i.test(o.text))!;
            await d.sdk.sendInteractLoc(gate.x, gate.z, gate.id, openOpt.opIndex);
        }
        // Femi may interrupt fresh accounts here — answer, then the script resumes.
        await answerFemi(d);
        // Wait for the scripted forcemove to land (server walks us through);
        // do NOT sendWalk meanwhile or the two walks fight.
        const crossed = await d.sdk
            .waitForCondition((s) => {
                const z = s.player?.worldZ ?? z0;
                return fromSouth ? z >= GNOME_GATE.z + 3 : z <= GNOME_GATE.z - 3;
            }, 12_000)
            .then(() => true)
            .catch(() => false);
        await answerFemi(d);
        if (crossed) {
            d.log(`Through gate @ ${d.pos().x},${d.pos().z}`);
            return true;
        }
        d.log(`Gate try ${attempt}: no crossing yet @ ${d.pos().x},${d.pos().z}`);
    }
    return fromSouth ? d.pos().z >= GNOME_GATE.z + 3 : d.pos().z <= GNOME_GATE.z - 3;
}

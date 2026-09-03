#!/usr/bin/env bun
/**
 * Quest Wiki Generator (bot-grade)
 *
 * Derives quest walkthrough data from server RS2 source: varp state machines,
 * journal hints, dialog option text, item requirements, and NPC spawn coords.
 *
 * Run: bun wiki/generate-quests.ts
 *
 * Output:
 *   wiki/quests/{wiki-slug}.generated.md
 *   wiki/quests/index.json
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename, relative } from 'path';

const CONTENT_DIR = join(import.meta.dir, '..', 'server', 'content');
const SCRIPTS_DIR = join(CONTENT_DIR, 'scripts');
const WIKI_QUESTS_DIR = join(import.meta.dir, 'quests');

// ─── Types ───────────────────────────────────────────────────────────────────

interface SpawnLocation {
    mapX: number;
    mapZ: number;
    globalX: number;
    globalZ: number;
    level: number;
    mapSquare: string;
}

interface QuestRegistryEntry {
    slug: string;
    varp: string;
    completeConst: string;
    specialProgress?: string; // ~proc or expression instead of %varp
}

interface QuestState {
    constName: string;
    value: number;
    journalHint?: string;
}

interface ExtractedAction {
    dialogChoices: string[];
    playerLines: string[];
    npcLines: string[];
    itemsConsumed: string[];
    itemsRequired: string[];
    itemsGranted: string[];
    transitions: Array<{ toConst: string; toValue: number }>;
    labels: string[];
}

interface GatingScript {
    relPath: string;
    trigger?: { kind: string; target: string };
    switchCases: Array<{ stateConst: string; label?: string }>;
    actions: ExtractedAction;
}

interface QuestIndexEntry {
    slug: string;
    wikiSlug: string;
    wikiProseFile: string | null;
    generatedFile: string;
    varp: string;
    completeConst: string;
    completeValue: number;
    states: QuestState[];
    npcs: Array<{ config: string; displayName: string; spawns: SpawnLocation[] }>;
    items: string[];
    gatingScripts: string[];
    journalFile: string | null;
}

// ─── Slug → wiki filename (prose guides use inconsistent naming) ─────────────

const SLUG_TO_WIKI: Record<string, string> = {
    runemysteries: 'rune-mysteries',
    doric: 'dorics-quest',
    cook: 'cooks-assistant',
    romeojuliet: 'romeo-and-juliet',
    hetty: 'witchs-potion',
    chompybird: 'big-chompy-bird-hunting',
    priest: 'restless-ghost',
    squire: 'knights-sword',
    imp: 'imp-catcher',
    druid: 'druidic-ritual',
    gobdip: 'goblin-diplomacy',
    sheep: 'sheep-shearer',
    fluffs: 'gertudes-cat',
    demon: 'demon-slayer',
    prince: 'prince-ali-rescue',
    fortress: 'black-knights-fortress',
    haunted: 'ernest-the-chicken',
    hunt: 'pirates-treasure',
    drunkmonk: 'monks-friend',
    vampire: 'vampire-slayer',
    totem: 'tribal-totem',
    fishingcompo: 'fishing-contest',
    scorpcatcher: 'scorpion-catcher',
    zanaris: 'lost-city',
    dragon: 'dragon-slayer',
    blackarmgang: 'shield-of-arrav',
    elena: 'plague-city',
    seaslug: 'sea-slug',
    arthur: 'merlins-crystal',
    tree: 'tree-gnome-village',
    waterfall: 'waterfall-quest',
    grail: 'holy-grail',
    ball: 'witchs-house',
    murder: 'murder-mystery',
    itexam: 'digsite',
    hazeelcult: 'hazeel-cult',
    hero: 'heros-quest',
    itgronigen: 'observatory',
    arena: 'fight-arena',
    junglepotion: 'jungle-potion',
    ikov: 'temple-of-ikov',
    biohazard: 'biohazard',
    sheepherder: 'sheep-herder',
    mcannon: 'dwarf-cannon',
    cog: 'clock-tower',
    grandtree: 'grand-tree',
    upass: 'underground-pass',
    zombiequeen: 'shilo-village',
    crest: 'family-crest',
    desertrescue: 'tourist-trap',
    itwatchtower: 'watchtower',
    legends: 'legends-quest',
    elemental_workshop: 'elemental-workshop',
    priestperil: 'priest-in-peril',
    druidspirit: 'nature-spirit',
    death: 'death-plateau',
    troll: 'troll-stronghold',
    tbwt: 'tourist-trap',
    mortton: 'shilo-village',
    regicide: 'watchtower',
    viking: 'troll-stronghold',
    horror: 'witchs-house',
    eadgar: 'troll-stronghold',
    pirates: 'pirates-treasure',
};

// ─── File helpers ───────────────────────────────────────────────────────────

function findFilesRecursive(dir: string, ext: string): string[] {
    const results: string[] = [];
    function walk(d: string) {
        if (!existsSync(d)) return;
        for (const entry of readdirSync(d, { withFileTypes: true })) {
            const fullPath = join(d, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === '_test') continue;
                walk(fullPath);
            } else if (entry.name.endsWith(ext)) {
                results.push(fullPath);
            }
        }
    }
    walk(dir);
    return results;
}

function parsePackFile(content: string): { idToName: Map<number, string>; nameToId: Map<string, number> } {
    const idToName = new Map<number, string>();
    const nameToId = new Map<string, number>();
    for (const line of content.split('\n')) {
        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) continue;
        const id = parseInt(line.slice(0, eqIdx));
        const name = line.slice(eqIdx + 1).trim();
        if (!isNaN(id) && name) {
            idToName.set(id, name);
            nameToId.set(name, id);
        }
    }
    return { idToName, nameToId };
}

function parseMapSpawns(mapsDir: string, npcIdToName: Map<number, string>): Map<string, SpawnLocation[]> {
    const spawns = new Map<string, SpawnLocation[]>();
    if (!existsSync(mapsDir)) return spawns;
    const mapFiles = readdirSync(mapsDir).filter((f) => f.endsWith('.jm2'));

    for (const file of mapFiles) {
        const match = file.match(/^m(\d+)_(\d+)\.jm2$/);
        if (!match) continue;
        const mapX = parseInt(match[1]);
        const mapZ = parseInt(match[2]);
        const mapSquare = `m${mapX}_${mapZ}`;

        const content = readFileSync(join(mapsDir, file), 'utf-8');
        const npcSectionStart = content.indexOf('==== NPC ====');
        if (npcSectionStart === -1) continue;

        const afterNpc = content.slice(npcSectionStart + '==== NPC ===='.length);
        const nextSection = afterNpc.indexOf('====');
        const npcBlock = nextSection === -1 ? afterNpc : afterNpc.slice(0, nextSection);

        for (const line of npcBlock.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const m = trimmed.match(/^(\d+)\s+(\d+)\s+(\d+):\s*(\d+)$/);
            if (!m) continue;
            const level = parseInt(m[1]);
            const localX = parseInt(m[2]);
            const localZ = parseInt(m[3]);
            const npcId = parseInt(m[4]);
            const configName = npcIdToName.get(npcId);
            if (!configName) continue;
            const globalX = mapX * 64 + localX;
            const globalZ = mapZ * 64 + localZ;
            if (!spawns.has(configName)) spawns.set(configName, []);
            spawns.get(configName)!.push({ mapX, mapZ, globalX, globalZ, level, mapSquare });
        }
    }
    return spawns;
}

function parseObjConfigs(content: string): Map<string, string> {
    const names = new Map<string, string>();
    let currentName = '';
    let currentDisplayName = '';
    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (line.startsWith('//')) continue;
        const sectionMatch = line.match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
            if (currentName && currentDisplayName) names.set(currentName, currentDisplayName);
            currentName = sectionMatch[1];
            currentDisplayName = '';
            continue;
        }
        if (line.startsWith('name=')) currentDisplayName = line.slice(5);
    }
    if (currentName && currentDisplayName) names.set(currentName, currentDisplayName);
    return names;
}

function parseNpcConfigs(content: string): Map<string, string> {
    const names = new Map<string, string>();
    let currentName = '';
    let displayName = '';
    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (line.startsWith('//')) continue;
        const sectionMatch = line.match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
            if (currentName && displayName) names.set(currentName, displayName);
            currentName = sectionMatch[1];
            displayName = '';
            continue;
        }
        if (line.startsWith('name=')) displayName = line.slice(5);
    }
    if (currentName && displayName) names.set(currentName, displayName);
    return names;
}

// ─── Constants & registry ─────────────────────────────────────────────────────

function parseAllConstants(): Map<string, number> {
    const constants = new Map<string, number>();
    const constantFiles = findFilesRecursive(SCRIPTS_DIR, '.constant');
    for (const file of constantFiles) {
        for (const line of readFileSync(file, 'utf-8').split('\n')) {
            const m = line.match(/^\^(\w+)\s*=\s*(-?\d+)\s*$/);
            if (m) constants.set(m[1], parseInt(m[2]));
        }
    }
    return constants;
}

function parseRegistry(): QuestRegistryEntry[] {
    const questsFile = join(SCRIPTS_DIR, 'general', 'scripts', 'quests.rs2');
    const content = readFileSync(questsFile, 'utf-8');
    const entries: QuestRegistryEntry[] = [];
    const re = /~send_quest_progress_colour\(questlist:([^,]+),\s*(%[^,]+|~[^,]+),\s*([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
        const slug = m[1];
        const progress = m[2].trim();
        const completeConst = m[3].trim();
        if (progress.startsWith('%')) {
            entries.push({ slug, varp: progress.slice(1), completeConst });
        } else {
            entries.push({ slug, varp: '', completeConst, specialProgress: progress });
        }
    }
    return entries;
}

function parseVarpFiles(): Map<string, string> {
    /** varp block name -> quest folder hint */
    const varpToQuestFolder = new Map<string, string>();
    const varpFiles = findFilesRecursive(join(SCRIPTS_DIR, 'quests'), '.varp');
    for (const file of varpFiles) {
        const content = readFileSync(file, 'utf-8');
        const header = content.match(/^\[(\w+)\]/m);
        if (!header) continue;
        const varpName = header[1];
        const parts = file.split('/');
        const questIdx = parts.findIndex((p) => p.startsWith('quest_'));
        if (questIdx !== -1) varpToQuestFolder.set(varpName, parts[questIdx]);
    }
    return varpToQuestFolder;
}

// ─── Journal hints ──────────────────────────────────────────────────────────

function cleanJournalText(raw: string): string {
    return raw
        .replace(/@dbl@/g, '')
        .replace(/@dre@/g, '')
        .replace(/@str@/g, '')
        .replace(/\|/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseJournalHints(varp: string, constants: Map<string, number>): Map<string, string> {
    const hints = new Map<string, string>();
    const journalFiles = findFilesRecursive(SCRIPTS_DIR, '.rs2').filter(
        (f) => basename(f).includes('journal') || basename(f).includes('_journal')
    );

    for (const file of journalFiles) {
        const content = readFileSync(file, 'utf-8');
        if (!content.includes(`%${varp}`)) continue;

        // if(%varp = ^state) { $text = "..."; }
        const blockRe = new RegExp(
            `(?:if|else if)\\s*\\(%${varp}\\s*=\\s*(\\^\\w+)\\)\\s*\\{([^}]+(?:\\{[^}]*\\}[^}]*)*)\\}`,
            'g'
        );
        let m: RegExpExecArray | null;
        while ((m = blockRe.exec(content)) !== null) {
            const stateConst = m[1].slice(1);
            const body = m[2];
            const texts: string[] = [];
            const textRe = /\$text\s*=\s*(?:append\(\$text,\s*)?"([^"]*)"/g;
            let tm: RegExpExecArray | null;
            while ((tm = textRe.exec(body)) !== null) {
                texts.push(cleanJournalText(tm[1]));
            }
            if (texts.length) hints.set(stateConst, texts.join(' '));
        }

        // questlist button journals: if_button,questlist:slug
        const ifButtonRe = new RegExp(
            `(?:if|else if)\\s*\\(%${varp}\\s*=\\s*(\\^\\w+)\\)\\s*\\{([^}]+(?:\\{[^}]*\\}[^}]*)*)\\}`,
            'g'
        );
        while ((m = ifButtonRe.exec(content)) !== null) {
            const stateConst = m[1].slice(1);
            if (hints.has(stateConst)) continue;
            const body = m[2];
            const texts: string[] = [];
            const textRe = /\$text\s*=\s*(?:append\(\$text,\s*)?"([^"]*)"/g;
            let tm: RegExpExecArray | null;
            while ((tm = textRe.exec(body)) !== null) {
                texts.push(cleanJournalText(tm[1]));
            }
            if (texts.length) hints.set(stateConst, texts.join(' '));
        }
    }
    return hints;
}

function collectQuestStates(
    varp: string,
    completeConst: string,
    constants: Map<string, number>,
    journalHints: Map<string, string>
): QuestState[] {
    const completeName = completeConst.startsWith('^') ? completeConst.slice(1) : completeConst;
    const completeValue = constants.get(completeName) ?? 9999;

    // Prefix heuristic: romeojuliet_* from quest-specific constants
    const prefix = completeName.replace(/_complete$/, '').replace(/_completed.*$/, '');
    const states: QuestState[] = [];

    for (const [name, value] of constants) {
        if (name.endsWith('_questpoints')) continue;
        if (value > completeValue) continue;
        if (name === completeName) {
            states.push({
                constName: name,
                value,
                journalHint: journalHints.get(name) ?? 'Quest complete.',
            });
            continue;
        }
        if (name.startsWith(prefix + '_') || name.startsWith(prefix.replace(/quest$/, '') + '_')) {
            states.push({
                constName: name,
                value,
                journalHint: journalHints.get(name),
            });
        }
    }

    // Also include states referenced only in journal
    for (const [stateConst, hint] of journalHints) {
        if (stateConst.endsWith('_questpoints')) continue;
        if (!states.some((s) => s.constName === stateConst)) {
            states.push({
                constName: stateConst,
                value: constants.get(stateConst) ?? -1,
                journalHint: hint,
            });
        }
    }

    states.sort((a, b) => a.value - b.value);
    return states;
}

// ─── RS2 script extraction ──────────────────────────────────────────────────

function decodeRs2Text(s: string): string {
    return s
        .replace(/<p,\w+>/g, '')
        .replace(/\|/g, ' ')
        .replace(/\\n/g, ' ')
        .trim();
}

function extractActionsFromBlock(block: string, varp: string): ExtractedAction {
    const action: ExtractedAction = {
        dialogChoices: [],
        playerLines: [],
        npcLines: [],
        itemsConsumed: [],
        itemsRequired: [],
        itemsGranted: [],
        transitions: [],
        labels: [],
    };

    const choiceRe = /~p_choice\d+\("([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = choiceRe.exec(block)) !== null) {
        action.dialogChoices.push(decodeRs2Text(m[1]));
    }

    const multiRe = /@multi\d+\("([^"]+)"/g;
    while ((m = multiRe.exec(block)) !== null) {
        action.dialogChoices.push(decodeRs2Text(m[1]));
    }

    const multiInlineRe = /@multi\d+\("([^"]+)",\s*\w+/g;
    while ((m = multiInlineRe.exec(block)) !== null) {
        action.dialogChoices.push(decodeRs2Text(m[1]));
    }

    const chatPlayerRe = /~chatplayer\("([^"]+)"/g;
    while ((m = chatPlayerRe.exec(block)) !== null) {
        action.playerLines.push(decodeRs2Text(m[1]));
    }

    const chatNpcRe = /~chatnpc\("([^"]+)"/g;
    while ((m = chatNpcRe.exec(block)) !== null) {
        action.npcLines.push(decodeRs2Text(m[1]));
    }

    const invDelRe = /inv_del\(\w+,\s*(\w+),/g;
    while ((m = invDelRe.exec(block)) !== null) {
        action.itemsConsumed.push(m[1]);
    }

    const invAddRe = /inv_add\(\w+,\s*(\w+),/g;
    while ((m = invAddRe.exec(block)) !== null) {
        action.itemsGranted.push(m[1]);
    }

    const invTotalRe = /inv_total\(\w+,\s*(\w+)\)\s*([><=]+)\s*0/g;
    while ((m = invTotalRe.exec(block)) !== null) {
        action.itemsRequired.push(m[1]);
    }

    const varpAssignRe = new RegExp(`%${varp}\\s*=\\s*(\\^\\w+)`, 'g');
    while ((m = varpAssignRe.exec(block)) !== null) {
        const toConst = m[1].slice(1);
        action.transitions.push({ toConst, toValue: -1 });
    }

    const labelRe = /@(\w+)/g;
    while ((m = labelRe.exec(block)) !== null) {
        if (!action.labels.includes(m[1])) action.labels.push(m[1]);
    }

    return action;
}

function parseGatingScript(filePath: string, varp: string): GatingScript | null {
    const content = readFileSync(filePath, 'utf-8');
    if (!content.includes(`%${varp}`)) return null;

    const relPath = relative(SCRIPTS_DIR, filePath);
    const result: GatingScript = {
        relPath,
        switchCases: [],
        actions: {
            dialogChoices: [],
            playerLines: [],
            npcLines: [],
            itemsConsumed: [],
            itemsRequired: [],
            itemsGranted: [],
            transitions: [],
            labels: [],
        },
    };

    const triggerMatch = content.match(/^\[(\w+),([^\]]+)\]/m);
    if (triggerMatch) {
        result.trigger = { kind: triggerMatch[1], target: triggerMatch[2].trim() };
    }

    const switchMatch = content.match(
        new RegExp(`switch_int\\s*\\(\\s*%${varp}\\s*\\)\\s*\\{([^}]+(?:\\{[^}]*\\}[^}]*)*)\\}`, 's')
    );
    if (switchMatch) {
        const switchBody = switchMatch[1];
        const caseRe = /case\s+(\^\w+)\s*:\s*(?:@(\w+))?/g;
        let cm: RegExpExecArray | null;
        while ((cm = caseRe.exec(switchBody)) !== null) {
            result.switchCases.push({
                stateConst: cm[1].slice(1),
                label: cm[2] ?? undefined,
            });
        }
    }

    const merged = extractActionsFromBlock(content, varp);
    result.actions = merged;
    return result;
}

function extractLabelBlock(content: string, label: string): string {
    const re = new RegExp(`\\[label,${label}\\]([\\s\\S]*?)(?=\\n\\[)`, 'm');
    const m = content.match(re);
    return m ? m[1] : '';
}

function extractActionsForState(
    gatingScripts: GatingScript[],
    stateConst: string,
    varp: string,
    fileContents: Map<string, string>
): ExtractedAction {
    const merged: ExtractedAction = {
        dialogChoices: [],
        playerLines: [],
        npcLines: [],
        itemsConsumed: [],
        itemsRequired: [],
        itemsGranted: [],
        transitions: [],
        labels: [],
    };

    for (const gs of gatingScripts) {
        const caseInfo = gs.switchCases.find((c) => c.stateConst === stateConst);
        const fullPath = join(SCRIPTS_DIR, gs.relPath);
        const content = fileContents.get(fullPath) ?? '';

        if (caseInfo?.label) {
            const block = extractLabelBlock(content, caseInfo.label);
            if (block) {
                const partial = extractActionsFromBlock(block, varp);
                for (const k of Object.keys(merged) as Array<keyof ExtractedAction>) {
                    if (k === 'transitions') merged.transitions.push(...partial.transitions);
                    else (merged[k] as string[]).push(...(partial[k] as string[]));
                }
                continue;
            }
        }

        if (caseInfo) {
            // Fall back to whole-script actions only when no label body was extracted
            const hasLabelBody =
                caseInfo.label && extractLabelBlock(content, caseInfo.label).length > 0;
            if (!hasLabelBody) {
                const partial = gs.actions;
                for (const k of Object.keys(merged) as Array<keyof ExtractedAction>) {
                    if (k === 'transitions') merged.transitions.push(...partial.transitions);
                    else (merged[k] as string[]).push(...(partial[k] as string[]));
                }
            }
        }
    }

    return merged;
}

// ─── Markdown emission ────────────────────────────────────────────────────────

function wikiSlugForQuest(slug: string): string {
    if (SLUG_TO_WIKI[slug]) return SLUG_TO_WIKI[slug];
    return slug.replace(/_/g, '-');
}

function formatSpawn(s: SpawnLocation): string {
    return `(${s.globalX}, ${s.globalZ}, level ${s.level})`;
}

function itemDisplay(config: string, objNames: Map<string, string>): string {
    return objNames.get(config) ?? config;
}

function npcDisplay(config: string, npcNames: Map<string, string>): string {
    return npcNames.get(config) ?? config;
}

function emitQuestMarkdown(
    entry: QuestRegistryEntry,
    states: QuestState[],
    gatingScripts: GatingScript[],
    fileContents: Map<string, string>,
    npcSpawns: Map<string, SpawnLocation[]>,
    npcNames: Map<string, string>,
    objNames: Map<string, string>,
    constants: Map<string, number>,
    proseTitle?: string
): string {
    const wikiSlug = wikiSlugForQuest(entry.slug);
    const completeName = entry.completeConst.startsWith('^') ? entry.completeConst.slice(1) : entry.completeConst;
    const completeValue = constants.get(completeName) ?? '?';

    const allNpcConfigs = new Set<string>();
    for (const gs of gatingScripts) {
        if (gs.trigger?.kind.startsWith('opnpc') && gs.trigger.target) {
            allNpcConfigs.add(gs.trigger.target);
        }
    }

    const allItems = new Set<string>();
    for (const gs of gatingScripts) {
        for (const i of [...gs.actions.itemsConsumed, ...gs.actions.itemsRequired, ...gs.actions.itemsGranted]) {
            allItems.add(i);
        }
    }

    const lines: string[] = [];
    const title = proseTitle ?? wikiSlug.replace(/-/g, ' ');
    lines.push(`# ${title} (generated)`);
    lines.push('');
    lines.push(`> Auto-generated from server RS2 source. Slug: \`${entry.slug}\`, varp: \`%${entry.varp}\`, complete: \`${completeName}\` (= ${completeValue}).`);
    lines.push('');
    lines.push('## Registry');
    lines.push('');
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| Quest list slug | \`${entry.slug}\` |`);
    lines.push(`| Progress varp | \`%${entry.varp}\` |`);
    lines.push(`| Complete constant | \`${completeName}\` (${completeValue}) |`);
    if (entry.specialProgress) lines.push(`| Note | special progress expr — verify manually |`);
    lines.push('');

    if (allNpcConfigs.size) {
        lines.push('## NPCs');
        lines.push('');
        for (const config of [...allNpcConfigs].sort()) {
            const display = npcDisplay(config, npcNames);
            const spawns = npcSpawns.get(config) ?? [];
            lines.push(`### ${display} (\`${config}\`)`);
            if (spawns.length) {
                const primary = spawns[0];
                lines.push(`- Primary spawn: ${formatSpawn(primary)}`);
                if (spawns.length > 1) {
                    lines.push(`- Other spawns: ${spawns.slice(1, 4).map(formatSpawn).join('; ')}${spawns.length > 4 ? '…' : ''}`);
                }
            } else {
                lines.push('- Spawn: not in map data (instanced / moved / members)');
            }
            lines.push('');
        }
    }

    if (allItems.size) {
        lines.push('## Items');
        lines.push('');
        for (const item of [...allItems].sort()) {
            lines.push(`- \`${item}\` — ${itemDisplay(item, objNames)}`);
        }
        lines.push('');
    }

    lines.push('## State machine');
    lines.push('');

    for (const state of states) {
        lines.push(`### \`${state.constName}\` (value ${state.value})`);
        if (state.journalHint) {
            lines.push('');
            lines.push(`**Journal:** ${state.journalHint}`);
        }

        const relevantScripts = gatingScripts.filter((gs) =>
            gs.switchCases.some((c) => c.stateConst === state.constName)
        );

        if (relevantScripts.length) {
            lines.push('');
            lines.push('**Interact:**');
            for (const gs of relevantScripts) {
                const trig = gs.trigger
                    ? `${gs.trigger.kind} → \`${gs.trigger.target}\` (${npcDisplay(gs.trigger.target, npcNames)})`
                    : gs.relPath;
                const caseInfo = gs.switchCases.find((c) => c.stateConst === state.constName);
                lines.push(`- ${trig}${caseInfo?.label ? ` → @${caseInfo.label}` : ''}`);
            }
        }

        // Dialog / items scoped to this state's label bodies
        const stateActions = extractActionsForState(gatingScripts, state.constName, entry.varp, fileContents);

        const choices = new Set(stateActions.dialogChoices);
        const consumed = new Set(stateActions.itemsConsumed);
        const required = new Set(stateActions.itemsRequired);

        if (choices.size) {
            lines.push('');
            lines.push('**Dialog options (click by text):**');
            for (const c of [...choices].sort()) {
                lines.push(`- \`${c}\``);
            }
        }

        if (required.size) {
            lines.push('');
            lines.push('**Items required:**');
            for (const i of [...required].sort()) {
                lines.push(`- ${itemDisplay(i, objNames)} (\`${i}\`)`);
            }
        }

        if (consumed.size) {
            lines.push('');
            lines.push('**Items consumed:**');
            for (const i of [...consumed].sort()) {
                lines.push(`- ${itemDisplay(i, objNames)} (\`${i}\`)`);
            }
        }

        const nextStates = stateActions.transitions;
        const uniqueNext = [...new Set(nextStates.map((t) => t.toConst))];
        if (uniqueNext.length) {
            lines.push('');
            lines.push('**Varp transitions in script:**');
            for (const n of uniqueNext) {
                const v = constants.get(n);
                lines.push(`- → \`${n}\` (${v ?? '?'})`);
            }
        }

        lines.push('');
    }

    if (gatingScripts.length) {
        lines.push('## Source scripts');
        lines.push('');
        for (const gs of gatingScripts) {
            lines.push(`- \`scripts/${gs.relPath}\``);
        }
        lines.push('');
    }

    return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
    console.log('Quest generator — parsing server content…\n');

    mkdirSync(WIKI_QUESTS_DIR, { recursive: true });

    const constants = parseAllConstants();
    console.log(`  Constants: ${constants.size}`);

    const registry = parseRegistry();
    console.log(`  Registry entries: ${registry.length}`);

    const npcPackPath = join(CONTENT_DIR, 'pack', 'npc.pack');
    const npcPack = parsePackFile(readFileSync(npcPackPath, 'utf-8'));
    const npcSpawns = parseMapSpawns(join(CONTENT_DIR, 'maps'), npcPack.idToName);
    console.log(`  NPC spawns: ${npcSpawns.size} configs`);

    const npcNames = new Map<string, string>();
    const npcFiles = findFilesRecursive(SCRIPTS_DIR, '.npc');
    for (const file of npcFiles) {
        const parsed = parseNpcConfigs(readFileSync(file, 'utf-8'));
        for (const [k, v] of parsed) {
            if (!npcNames.has(k) || v) npcNames.set(k, v);
        }
    }
    console.log(`  NPC display names: ${npcNames.size}`);

    const objNames = new Map<string, string>();
    const allObjPath = join(SCRIPTS_DIR, '_unpack', '225', 'all.obj');
    if (existsSync(allObjPath)) {
        for (const [k, v] of parseObjConfigs(readFileSync(allObjPath, 'utf-8'))) objNames.set(k, v);
    }
    for (const file of findFilesRecursive(SCRIPTS_DIR, '.obj')) {
        if (file.includes('_unpack')) continue;
        for (const [k, v] of parseObjConfigs(readFileSync(file, 'utf-8'))) {
            if (!objNames.has(k)) objNames.set(k, v);
        }
    }
    console.log(`  Obj display names: ${objNames.size}`);

    const rs2Files = findFilesRecursive(SCRIPTS_DIR, '.rs2');
    const fileContents = new Map<string, string>();
    for (const file of rs2Files) {
        fileContents.set(file, readFileSync(file, 'utf-8'));
    }

    const proseFiles = new Set(
        readdirSync(WIKI_QUESTS_DIR)
            .filter((f) => f.endsWith('.md') && !f.endsWith('.generated.md'))
            .map((f) => f.replace(/\.md$/, ''))
    );

    const index: Record<string, QuestIndexEntry> = {};
    let generated = 0;
    let skipped = 0;

    for (const entry of registry) {
        if (!entry.varp) {
            console.log(`  skip ${entry.slug}: non-varp progress (${entry.specialProgress})`);
            skipped++;
            continue;
        }

        const journalHints = parseJournalHints(entry.varp, constants);
        const states = collectQuestStates(entry.varp, entry.completeConst, constants, journalHints);

        const gatingScripts: GatingScript[] = [];
        for (const file of rs2Files) {
            if (file.includes('_test')) continue;
            if (basename(file).includes('journal')) continue;
            const parsed = parseGatingScript(file, entry.varp);
            if (parsed) gatingScripts.push(parsed);
        }

        const wikiSlug = wikiSlugForQuest(entry.slug);
        const generatedFile = `${wikiSlug}.generated.md`;
        const proseFile = proseFiles.has(wikiSlug) ? `${wikiSlug}.md` : null;
        let proseTitle: string | undefined;
        if (proseFile) {
            const prosePath = join(WIKI_QUESTS_DIR, proseFile);
            const heading = readFileSync(prosePath, 'utf-8').match(/^#\s+(.+)$/m);
            if (heading) proseTitle = heading[1].trim();
        }

        const markdown = emitQuestMarkdown(
            entry,
            states,
            gatingScripts,
            fileContents,
            npcSpawns,
            npcNames,
            objNames,
            constants,
            proseTitle
        );

        writeFileSync(join(WIKI_QUESTS_DIR, generatedFile), markdown, 'utf-8');
        generated++;

        const allNpcConfigs = new Set<string>();
        for (const gs of gatingScripts) {
            if (gs.trigger?.kind.startsWith('opnpc')) allNpcConfigs.add(gs.trigger.target);
        }

        const allItems = new Set<string>();
        for (const gs of gatingScripts) {
            for (const i of [
                ...gs.actions.itemsConsumed,
                ...gs.actions.itemsRequired,
                ...gs.actions.itemsGranted,
            ]) {
                allItems.add(i);
            }
        }

        const completeName = entry.completeConst.startsWith('^')
            ? entry.completeConst.slice(1)
            : entry.completeConst;

        const journalFile = findFilesRecursive(SCRIPTS_DIR, '.rs2').find(
            (f) => basename(f).includes('journal') && readFileSync(f, 'utf-8').includes(`%${entry.varp}`)
        );

        index[entry.slug] = {
            slug: entry.slug,
            wikiSlug,
            wikiProseFile: proseFile,
            generatedFile,
            varp: entry.varp,
            completeConst: completeName,
            completeValue: constants.get(completeName) ?? -1,
            states,
            npcs: [...allNpcConfigs].map((config) => ({
                config,
                displayName: npcDisplay(config, npcNames),
                spawns: npcSpawns.get(config) ?? [],
            })),
            items: [...allItems].sort(),
            gatingScripts: gatingScripts.map((g) => g.relPath),
            journalFile: journalFile ? relative(SCRIPTS_DIR, journalFile) : null,
        };
    }

    writeFileSync(join(WIKI_QUESTS_DIR, 'index.json'), JSON.stringify(index, null, 2), 'utf-8');

    console.log(`\nGenerated ${generated} quest files (+ ${skipped} skipped).`);
    console.log(`  wiki/quests/index.json`);
    console.log(`  wiki/quests/*.generated.md`);

    // Coverage report
    const wikiCount = proseFiles.size;
    const withProse = Object.values(index).filter((e) => e.wikiProseFile).length;
    const withScripts = Object.values(index).filter((e) => e.gatingScripts.length > 0).length;
    const withJournal = Object.values(index).filter((e) => e.journalFile).length;

    console.log('\nCoverage:');
    console.log(`  Registry quests: ${registry.length}`);
    console.log(`  Prose wiki guides: ${wikiCount}`);
    console.log(`  Matched prose slug: ${withProse}`);
    console.log(`  With gating scripts: ${withScripts}`);
    console.log(`  With journal file: ${withJournal}`);

    const proseOnly = [...proseFiles].filter((slug) => !Object.values(index).some((e) => e.wikiSlug === slug));
    if (proseOnly.length) {
        console.log(`  Prose guides without registry match: ${proseOnly.length}`);
        console.log(`    ${proseOnly.slice(0, 10).join(', ')}${proseOnly.length > 10 ? '…' : ''}`);
    }
}

main();

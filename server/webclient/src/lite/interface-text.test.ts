// Quest journals encode checkpoint state ONLY in formatting tags:
//   @str@I have a bucket of milk with me   -> the player has it (struck through)
//   @dbl@a @dre@bucket@dbl@ of @dre@milk   -> still needed
// `normaliseComponentText` strips `@\w{3}@`, so any consumer that reads only the
// normalised debug string cannot tell those two states apart. Structured
// components must therefore carry the RAW text as well.
import { describe, expect, test } from 'bun:test';

import './dom-shim.js';

const { default: IfType } = await import('#/config/IfType.js');
const { getInterfaceTextComponents } = await import('./actions.js');

const LAYER = 0;
const TEXT = 4;

function defineComponent(id: number, com: Record<string, unknown>): void {
    IfType.list[id] = { id, ...com } as never;
}

describe('interface text components', () => {
    test('preserves raw formatting while exposing normalised text separately', () => {
        defineComponent(8000, { type: LAYER, children: [8001] });
        defineComponent(8001, { type: TEXT, text: '@str@I have a bucket of milk with me|' });

        const [component] = getInterfaceTextComponents({} as never, 8000);
        expect(component!.componentId).toBe(8001);
        expect(component!.type).toBe(TEXT);
        expect(component!.rawText).toBe('@str@I have a bucket of milk with me|');
        expect(component!.text).toBe('I have a bucket of milk with me|');
    });

    test('distinguishes the have-it and need-it journal lines that differ only by tag', () => {
        defineComponent(8010, { type: LAYER, children: [8011, 8012] });
        defineComponent(8011, { type: TEXT, text: '@str@I have an egg with me|' });
        defineComponent(8012, { type: TEXT, text: '@dbl@an @dre@egg|' });

        const components = getInterfaceTextComponents({} as never, 8010);
        const have = components.filter(c => c.rawText.includes('@str@'));
        const need = components.filter(c => c.rawText.includes('@dbl@'));
        expect(have).toHaveLength(1);
        expect(need).toHaveLength(1);
        // The normalised forms are still different here, but a *tag-only* change
        // (same words, different emphasis) would be invisible without rawText.
        expect(have[0]!.componentId).not.toBe(need[0]!.componentId);
    });

    test('includes non-clickable components, which is the whole point', () => {
        defineComponent(8020, { type: LAYER, children: [8021] });
        defineComponent(8021, { type: TEXT, buttonType: 0, text: 'Druidic Ritual' });
        expect(getInterfaceTextComponents({} as never, 8020).map(c => c.text)).toEqual(['Druidic Ritual']);
    });

    test('walks nested trees and skips empty slots', () => {
        defineComponent(8030, { type: LAYER, children: [8031] });
        defineComponent(8031, { type: LAYER, children: [8032, 8033] });
        defineComponent(8032, { type: TEXT, text: '' });
        defineComponent(8033, { type: TEXT, text: 'The Cook\'s Quest' });
        expect(getInterfaceTextComponents({} as never, 8030).map(c => c.text)).toEqual(["The Cook's Quest"]);
    });

    test('returns nothing for an unset root instead of throwing', () => {
        expect(getInterfaceTextComponents({} as never, -1)).toEqual([]);
        expect(getInterfaceTextComponents({} as never, 99999)).toEqual([]);
    });
});

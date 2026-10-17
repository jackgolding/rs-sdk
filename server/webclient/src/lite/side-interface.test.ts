// Side-tab interfaces (the quest list, combat tab, bank side inventory) are not
// main modals, so they must be walkable by an explicit root id. Before this,
// `getInterfaceOptions` only ever looked at `mainModalId`, which made the quest
// list — and therefore the quest journal behind it — unreachable from a script.
import { describe, expect, test } from 'bun:test';

import './dom-shim.js';

const { default: IfType } = await import('#/config/IfType.js');
const { getInterfaceOptionsFor } = await import('./actions.js');

const BUTTON_OK = 1;
const PLAIN_TEXT = 4;

/** Install a component in the shared IfType registry the client reads from. */
function defineComponent(id: number, com: Record<string, unknown>): void {
    IfType.list[id] = { id, ...com } as never;
}

describe('side-tab interface options', () => {
    test('walks an arbitrary interface root and returns only its clickable children', () => {
        defineComponent(7001, { type: 0, children: [7002, 7003] });
        defineComponent(7002, { type: PLAIN_TEXT, buttonType: 0, width: 84, height: 14, text: 'FREE QUESTS:' });
        defineComponent(7003, { type: PLAIN_TEXT, buttonType: BUTTON_OK, width: 130, height: 14, text: "Cook's Assistant" });

        const options = getInterfaceOptionsFor({} as never, 7001);
        expect(options.map(o => o.text)).toEqual(["Cook's Assistant"]);
        expect(options[0]!.componentId).toBe(7003);
    });

    test('finds buttons nested below the root, as the real quest list is', () => {
        defineComponent(7010, { type: 0, children: [7011] });
        defineComponent(7011, { type: 0, children: [7012] });
        defineComponent(7012, { type: PLAIN_TEXT, buttonType: BUTTON_OK, width: 130, height: 14, text: 'Druidic Ritual' });
        expect(getInterfaceOptionsFor({} as never, 7010).map(o => o.text)).toEqual(['Druidic Ritual']);
    });

    test('returns nothing for an unset root instead of throwing', () => {
        expect(getInterfaceOptionsFor({} as never, -1)).toEqual([]);
        expect(getInterfaceOptionsFor({} as never, 99999)).toEqual([]);
    });

    test('scopes to the requested root and does not leak other interfaces', () => {
        defineComponent(7100, { type: 0, children: [7101] });
        defineComponent(7101, { type: PLAIN_TEXT, buttonType: BUTTON_OK, width: 10, height: 10, text: 'Modal Only' });
        expect(getInterfaceOptionsFor({} as never, 7100).map(o => o.text)).toEqual(['Modal Only']);
        expect(getInterfaceOptionsFor({} as never, 7200)).toEqual([]);
    });
});

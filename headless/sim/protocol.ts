// protocol.ts - BotAction wire validation (Atlas: unknown opcode throws loudly).
// Minimal slice: known-type check + engine-order check. No ISAAC here —
// rs-sdk bots speak BotAction over the gateway, so the harness validates there.

const KNOWN_ACTION_TYPES = new Set([
    'none', 'wait', 'talkToNpc', 'interactNpc', 'interactPlayer',
    'clickDialogOption', 'clickComponent', 'clickComponentWithOption',
    'acceptCharacterDesign', 'randomizeCharacterDesign', 'walkTo',
    'useInventoryItem', 'dropItem', 'pickupItem', 'interactGroundItem',
    'interactLoc', 'useItemOnItem', 'useItemOnLoc', 'useItemOnNpc',
    'useEquipmentItem', 'shopBuy', 'shopSell', 'closeShop', 'closeModal',
    'setCombatStyle', 'spellOnNpc', 'spellOnPlayer', 'spellOnItem',
    'spellOnGroundItem', 'setTab', 'say', 'localChat', 'privateMessage',
    'bankDeposit', 'bankWithdraw', 'searchGE', 'submitCountDialog',
    'scanNearbyLocs', 'scanGroundItems', 'togglePrayer'
]);

export interface SimAction {
    type: string;
    [k: string]: unknown;
}

/** Throws on unknown action type. Returns actions unchanged for chaining. */
export function validateActionOrder(actions: SimAction[]): SimAction[] {
    for (const a of actions) {
        if (!KNOWN_ACTION_TYPES.has(a.type)) {
            throw new Error(`[sim-protocol] unknown action type: ${a.type}`);
        }
    }
    return actions;
}

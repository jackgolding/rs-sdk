import { describe, expect, test } from 'bun:test';
import { areaName, loadPlaces, parsePlaces } from './areas';

const places = loadPlaces();

describe('area names', () => {
    test('drops unfinished map labels', () => {
        const parsed = parsePlaces('=(due Jan-2005),3429,3555,0\n=Castle Wars/(due Dec-2004),2432,3111,0\n=Lumbridge,3239,3233,1\n');
        expect(parsed.map((place) => place.name)).toEqual(['Castle Wars', 'Lumbridge']);
    });

    test('names the towns the fleet actually stands in', () => {
        const spots: Array<[number, number, string]> = [
            [3222, 3218, 'Lumbridge'],
            [3186, 3436, 'Varrock'],
            [3253, 3420, 'Varrock'],
            [3012, 3355, 'Falador'],
            [2945, 3368, 'Falador'],
            [3092, 3243, 'Draynor Village'],
            [3108, 3345, 'Draynor Manor'],
            [3094, 3492, 'Edgeville'],
            [2726, 3485, "Seers' Village"],
            [2708, 3461, "Seers' Village"],
            [2727, 3500, "Seers' Village"],
            [2808, 3443, 'Catherby'],
            [2744, 3444, 'Flax'],
            [2613, 3091, 'Yanille'],
            [2655, 3283, 'East Ardougne'],
            [2662, 3312, 'East Ardougne'],
            [2970, 3235, 'Rimmington'],
            [2905, 3295, 'Crafting Guild'],
            [2474, 3436, 'Tree Gnome Stronghold'],
            [3044, 9736, 'Mining Guild'],
            [3040, 9774, 'Mining Guild'],
            [3114, 9929, 'Edgeville dungeon'],
            [2716, 9817, 'King Black Dragon'],
            [2926, 4818, 'Rune essence mine'],
            [3200, 9580, 'Zanaris'],
            [3078, 3810, 'Lava Maze'],
            [3005, 3950, 'Agility Training Area'],
            [3030, 3633, 'Dark Knight Fortress'],
        ];
        for (const [x, z, name] of spots) {
            expect(areaName(x, z, places), `${x},${z}`).toBe(name);
        }
    });
});

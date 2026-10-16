import { initPathfinding, isTileWalkable } from './sdk/pathfinding';

initPathfinding();

// Map walkability x 2995-3020, z 3930-3968 (# = blocked). Lava/fences show up.
let header = 'z\\x ';
for (let x = 2995; x <= 3020; x++) header += String(x).slice(2);
console.log(header);
for (let z = 3968; z >= 3930; z--) {
    let row = `${z} `;
    for (let x = 2995; x <= 3020; x++) row += isTileWalkable(0, x, z) ? '.' : '#';
    console.log(row);
}
process.exit(0);

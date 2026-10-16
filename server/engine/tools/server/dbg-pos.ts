import InvType from '#/cache/config/InvType.js';
import ObjType from '#/cache/config/ObjType.js';
import VarPlayerType from '#/cache/config/VarPlayerType.js';
import VarBitType from '#/cache/config/VarBitType.js';
import { PlayerLoading } from '#/engine/entity/PlayerLoading.js';
import Packet from '#/io/Packet.js';
import { readFileSync } from 'fs';
InvType.load('data/pack'); ObjType.load('data/pack'); VarPlayerType.load('data/pack'); VarBitType.load('data/pack');
for (const f of process.argv.slice(2)) {
    const p = PlayerLoading.load('x', new Packet(readFileSync(f)), null);
    console.log(f, '->', p.x, p.z, 'L' + p.level);
}
process.exit(0);

import { runScript } from '../../sdk/runner';

await runScript(async (ctx) => {
    const { bot, sdk } = ctx;

    // Skip tutorial if active
    await bot.skipTutorial();

    // === YOUR SCRIPT LOGIC BELOW ===

    // Example: chop a tree
    const tree = sdk.findNearbyLoc(/^tree$/i);
    if (tree) {
        console.log(`Found tree at (${tree.x}, ${tree.z})`);
        const result = await bot.chopTree(tree);
        console.log(result.message);
    }

    // === END SCRIPT LOGIC ===

}, {
    timeout: 60_000,  // 1 minute timeout
});

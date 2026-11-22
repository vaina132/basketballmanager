# Player photos

- Source: Wikimedia Commons, through each player's Wikidata item (image, P18), fetched on 22 November 2026.
- Made by `scripts/real-data-player-photos.mjs`: each real-pack player matched to a Wikidata basketball player by name plus at least one more fact (birth date, a team like his club, or for a unique name the nationality); a birth date that disagrees rules the match out. Cropped to the top centre square and resized to 128x128 WebP in `players/`, named by the pack player ID. The map, with author and licence of every photo, is `src/data/player-photos.ts`; the matches are in `real-data/player-photo-matches.json`.
- Only free licences that allow reuse and changes are kept: CC0, public domain, CC BY and CC BY-SA. Never NC, ND, fair use or non-free files.
- Each photo belongs to its author and keeps its licence. The game names the author and licence, with links to the licence and the Commons file page, under the player's portrait and in the Credits list (career start, "Data" details, "Player photos").
- The photos are adapted (cropped and resized). Photos under CC BY-SA stay under the same CC BY-SA licence in their adapted form.
- A photo is removed on request.
- Players without a photo here keep the game's drawn avatar.

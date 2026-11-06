# Courtside interface direction

This repository builds a basketball management game. The user explicitly requires a game interface throughout, including the overview and future management screens. See [Game design, section 11](docs/game-design.md#11-interface-structure) for the full interface specification.

- Build useful management workspaces around the current club, actual game state, and the next decision. Use compact navigation, readable tables, player information, current condition, and direct actions.
- The overview is the manager's desk: current fixture/result, availability, lineup, concerns, instructions, and relevant activity. Every displayed value must come from implemented game state.
- Do not add landing-page heroes, marketing slogans, promotional feature cards, roadmap banners, oversized decorative artwork, or future-feature advertising to gameplay screens.
- Do not invent fixtures, dates, finances, messages, standings, or club activity to fill a dashboard. Show a simulated date or a Continue action only when the corresponding world/calendar behavior exists.
- Navigation and actions must work. Omit unavailable systems from normal navigation instead of presenting placeholder destinations as playable features. Keep development scope in documentation and use a concise, factual in-game prototype label where necessary.
- On the match screen, retain the large court directly below the score. Keep secondary coaching controls below it; do not restore the standalone shot-clock/possession information panel the user removed.
- Show current stamina with bars and numeric values for active players and reserves. Current match condition is distinct from the permanent stamina attribute. Add text labels for fatigue, injury, and exclusion rather than relying on color alone.
- Keep player identity, displayed lineup, condition, scores, and available actions coherent after substitutions, pause/resume, save/load, and navigation. Presentation must not change simulation outcomes.
- Use the shared charcoal/slate surfaces and amber accent, flat panel borders, compact section bars, and dense readable tables. Keep the navigation and command bar small; gain density through spacing rather than shrinking player names or data below readable body text.
- Team instructions must be directly editable using labeled sliders with visible values, keyboard access, and the same authoritative settings on the overview and match screen. Rotation control is a two-position Manual/Assistant policy. Finished matches disable these controls.
- Preserve keyboard access, visible focus, readable contrast, reduced-motion support, and desktop/tablet usability. Favor useful information density over decorative whitespace.

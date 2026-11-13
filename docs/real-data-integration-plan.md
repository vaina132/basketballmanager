# Real-world data integration plan (owner's plan, stored for later)

Shared by the owner on 13 November 2026. **Not active yet:** follow this plan only when the project reaches the integration of real data into the game. Until then it is a reference, not a work item.

Owner's notes when sharing it:

- Use **API-Sports (API-BASKETBALL)** first, starting with its free tier.
- The owner has set up a **Supabase** account for the game. Tell the owner when the work reaches the point where Supabase is needed.
- Keep the approach simple; do not overcomplicate it.

When this work starts, reconcile it with the earlier first-release scope in [implementation-plan.md](implementation-plan.md) and [data-and-sources.md](design/data-and-sources.md) (twelve domestic divisions and three European competitions): this plan proposes a smaller launch set (NBA, EuroLeague, ACB, BBL, BSL, LBA) and a BBL + EuroLeague pilot. Confirm the scope with the owner before building. Never ask the owner to paste API keys into chat or commit them.

The plan as shared:

---

## 1. Background and objective

I have been discussing with ChatGPT how to integrate authentic, regularly updated real-world basketball data into our basketball manager game.

We have agreed on an overall strategy, architecture, business model, and development priorities. I want you to understand these decisions and incorporate them into our existing development roadmap.

**The objective is to create a basketball management simulation featuring real professional basketball clubs, real players, authentic rosters, actual historical statistics, and realistic player attributes calculated from real-world performances.**

Think of the data-driven authenticity of Football Manager, but applied to basketball.

We do not need every basketball league in the world. We prefer a smaller number of accurately represented leagues over dozens of competitions containing incomplete or unreliable data.

Importantly, we want an affordable, scalable solution suitable for an independent game developer.

## 2. Business model and distribution

Our commercial strategy has been decided:

**Browser version**
- Players can access the game for free.
- The free version allows them to play one complete season.
- After that, they must purchase the full game to continue their careers.
- The full game costs **€15 as a one-time purchase**, not a subscription.
- Paying users can play unlimited seasons.

**Future Steam version**
- We eventually want to publish a downloadable PC version on Steam.
- The same basketball database and simulation systems should support both browser and desktop distribution.
- Steam distribution and licensing requirements should be considered from the beginning, even if the browser version launches first.

We should avoid any technical decisions that unnecessarily complicate the future Steam release.

## 3. Our primary architectural decision

**We do NOT want the game to directly contact an external basketball API every time someone opens a club, views a player, or simulates a match.**

Instead, we want to maintain our own centralized basketball database.

The intended architecture is:

External basketball data provider(s)
↓
Automated data import and synchronization system
↓
Our central basketball database
↓
Player-attribute calculation engine
↓
Versioned basketball starting datasets
↓
Our basketball manager game

The external API is primarily a source for acquiring and refreshing real-world data.

Our own database becomes the main source of basketball information for the game.

### Why this matters

Suppose 1,000 people play the game.

We do not want 1,000 separate external API sessions requesting similar basketball information.

Instead, our system downloads and updates the necessary information centrally. Everyone starting a new game can access the prepared dataset without requiring an additional external sports-data API call.

This dramatically reduces API consumption, improves performance, reduces dependencies on external services, and makes future Steam distribution easier.

Requests to our own database are separate from the external API provider's request quota.

## 4. Basketball data provider selection

We evaluated several providers, including:

- API-Sports / API-BASKETBALL
- BALLDONTLIE
- Sportradar
- Genius Sports

### Initial preference: API-Sports

Website: https://api-sports.io/sports/basketball

API-Sports appears to be a promising starting option because its basketball subscription provides access to multiple competitions rather than requiring a separate payment for every league.

Its advertised paid plan has offered approximately 7,500 API requests daily at a relatively affordable monthly price (recently around 13–15 in the displayed currency, excluding tax, subject to verification).

There is also a limited free tier.

**We should begin with the free tier and test actual data quality before purchasing anything.**

### Why not BALLDONTLIE as the primary provider?

BALLDONTLIE has attractive published commercial data-use terms, but its detailed statistics subscriptions are generally priced per league.

At approximately $39.99/month per league, costs can accumulate quickly. Its all-access subscription is considerably more expensive than our initial budget.

Therefore, API-Sports is currently our preferred candidate, provided its player-level data is sufficient.

### Important qualification

We have NOT yet confirmed that API-Sports provides every field we need in every targeted league.

It is essential to investigate its actual API endpoints, available seasons, player statistics, roster completeness, and missing information.

Do not assume that a competition appearing in its league list means detailed individual player statistics are available.

If API-Sports has insufficient data for a particular major league, investigate an alternative provider or another appropriately licensed source.

The import architecture should remain provider-independent, allowing us to replace or combine providers later without rebuilding the game.

## 5. Initial selection of basketball leagues

We have decided to prioritize a relatively small group of important leagues with reliable data.

### Proposed initial launch competitions

1. NBA — United States
2. EuroLeague — Europe
3. Liga ACB — Spain
4. Basketball Bundesliga (BBL) — Germany
5. Basketbol Süper Ligi (BSL) — Turkey
6. Lega Basket Serie A (LBA) — Italy

Other competitions, such as EuroCup, French LNB and Greek A1, can be considered later.

**These six are launch candidates, not an unconditional requirement.**

Before including a league, verify that sufficient current roster information and historical player-level statistics are actually available.

If statistics are unavailable or seriously incomplete, simply exclude the league.

We are NOT interested in spending significant development time trying to recover obscure lower-division leagues.

### Suggested technical pilot

Start with German BBL and EuroLeague, provided the chosen provider has adequate data for both.

Successfully import their clubs, players, rosters, statistics and calculated attributes.

Then scale the same process to the other selected leagues.

We should not import thousands of records before validating the data model and importer.

## 6. Required real-world basketball data

When somebody starts a new career, the game should offer authentic basketball information.

### A. Players

We want, wherever reliably available:

- Full real-world player names
- Date of birth or age
- Nationality
- Height and weight
- Playing position
- Current club
- Jersey number
- Previous clubs, where available
- Previous-season statistics
- Current-season statistics
- Historical performance data
- Stable identifiers for recognizing players across seasons and providers

The source of information should be recorded.

If some data is unavailable, we should identify and handle those gaps rather than silently inventing real-world facts.

### B. Clubs

We require:

- Real club names
- Club country
- Club city
- Real club colors (primary and secondary, where verifiable)
- Current roster
- Associated competitions
- Relevant historical results
- Home arena or venue, where available
- Stable club identifiers

**Club colors are important.**

However, the API-Sports basketball team endpoints do not appear to provide explicit club-color fields.

Therefore, club colors may need to come from a separate verified source or manually maintained identity records.

We should prepare a system that supports these additional club attributes without modifying the imported statistics.

### C. Competitions

We need:

- Real competition names
- Participating clubs
- Competition structure
- League standings
- Real historical results
- Season-specific membership
- Relevant competition rules

Not every competition rule will necessarily be provided by an API. Some may need to be defined in our own game database.

### D. Player statistics

At a minimum, we need sufficient individual player statistics to calculate realistic basketball abilities.

Examples include:

- Games played
- Minutes
- Points
- Field-goal attempts and percentages
- Two-point and three-point shooting
- Free throws
- Offensive and defensive rebounds
- Assists
- Steals
- Blocks
- Turnovers
- Personal fouls

Advanced statistics would be useful where available, but should not be a prerequisite for including every league.

We need at least the previous completed season (2025–26) and available current-season (2026–27) information for the initial dataset.

## 7. Player attributes must be calculated from real statistics

We want a realistic Football Manager-style player-rating system.

External basketball providers generally give statistical information, not the complete set of simulation attributes our game requires.

Therefore, we need our own **Player Rating Engine**.

For example, the game might include attributes such as:

- Shooting
- Three-point shooting
- Midrange shooting
- Finishing
- Passing
- Ball handling
- Playmaking
- Rebounding
- Perimeter defense
- Interior defense
- Steals
- Shot blocking
- Basketball IQ
- Athleticism
- Stamina
- Consistency
- Potential
- Overall rating

These are illustrative attributes; adapt them to our existing game design rather than introducing unnecessary duplication.

### How calculations should work

Player ratings should be calculated primarily using real historical statistics, adjusted for relevant factors.

For example:

- Previous-season performance
- Available current-season performance
- Minutes played
- Playing position
- Competition strength
- Age
- Statistical consistency
- Sample size
- Performance relative to comparable players

A player averaging 20 points in a weaker competition should not automatically have the same overall rating as a EuroLeague player averaging 20 points.

We need league-strength normalization.

Similarly, a player averaging 15 points in 10 minutes cannot be evaluated in the same way as someone averaging 15 points in 30 minutes.

Certain attributes, such as potential, leadership and basketball IQ, cannot be measured directly from ordinary box-score statistics. Those may require reasonable estimates or additional data.

The system should distinguish calculated, manually adjusted and estimated attributes.

We should also store enough information to explain how ratings were generated and recalculate them when new statistics become available.

## 8. Club and player identities across competitions

This is particularly important.

A club can participate in multiple competitions simultaneously.

For example, Real Madrid participates in the Spanish ACB and EuroLeague.

**Real Madrid must exist as one club in our database, not two separate clubs with unrelated squads.**

The same applies to players.

We need an identity-matching system that recognizes when different competition records or providers refer to the same club or player.

This should prevent duplicate clubs, duplicated player profiles and inconsistent rosters.

We should have a canonical player and club ID system, plus provider-specific ID mappings.

Roster membership must be associated with the relevant season and effective dates.

## 9. Monthly updates and database versioning

We decided that **monthly synchronization** is sufficient for the initial version.

There is no need to maintain real-time game statistics or live match information.

The game is a career simulation, not a live-score application.

### Example process

**November 2026**

Import the latest available real-world information and generate basketball database version 1.0.

**December 2026**

Download updated rosters, player information, statistics and transfers.

Generate database version 1.1.

**January 2027**

Repeat the process and generate version 1.2.

And so on.

We may also support manually triggered imports after major transfer windows.

### Extremely important: career independence

Real-world database updates must NOT interfere with careers that players have already started.

Imagine someone begins managing Real Madrid in November 2026.

They then play until 2032 in their fictional basketball career.

Their game world must evolve independently according to our simulation.

If a real-life player transfers to another club in December 2026, that real-world transfer should NOT automatically modify the user's existing career.

Instead:

- Newly created careers should use the newest released real-world database.
- Existing careers should retain the world state established when they began.
- Subsequent fictional transfers, results, development and careers must be controlled by our simulation.
- An existing saved career should never be overwritten by a monthly real-world sync.

This distinction is fundamental to the entire architecture.

## 10. Club logos and player photographs

We have deliberately decided to postpone the use of official club logos and real player photographs.

For the initial version:

**Required:**
- Real player names
- Real clubs
- Real rosters
- Real player information
- Historical statistics
- Derived player attributes
- Verified real club colors

**Not required initially:**
- Official club logos
- Real player headshots
- Official competition logos

We can use original generic player portraits, silhouettes and simple club identity graphics for now.

However, the database and user interface should already accommodate photographs and official logos in the future.

For example, a player or club could have a nullable image reference that is populated later when suitable assets and permissions are available.

Do not make real photographs or official logos a dependency for the initial release.

## 11. Commercial licensing and permissions

This is an essential issue.

We intend to distribute a commercial game, first through a browser with a €15 unlock and later through Steam.

We need to distinguish between:

1. Permission to access a sports-data API.
2. Permission to store and process its data in our own database.
3. Permission to distribute or display imported data in a commercial game.
4. Possible third-party rights relating to players, teams, competitions and branding.
5. Separate rights involving photographs, logos and likenesses.

A paid API subscription does not automatically grant all these permissions.

For example, API-Sports places responsibility for obtaining necessary publication rights on the developer.

BALLDONTLIE publishes more permissive commercial-use terms for its own data, but these do not automatically clear independent rights belonging to leagues, clubs or players.

We should therefore investigate licensing before public release.

In particular, we need written clarity on whether the data provider permits:

- Central storage of downloaded basketball data.
- Periodic synchronization.
- Calculation of derived game ratings.
- Display of imported data in a paid browser game.
- Distribution of downloaded data within a Steam application.
- Retention and use of historical datasets.

We must also identify any separate permissions required for the commercial use of real player and club identities.

Do not assume that a data subscription grants rights to all third-party content.

### Potential licensing organizations

If needed later, we can contact:

- NBPA / THINK450 for NBA player group rights.
- Winners Alliance for EuroLeague player group licensing.
- Euroleague Basketball for official competition-related rights.
- Other relevant league or club rights holders.

We do not currently have a confirmed price for comprehensive player and team licensing.

This must be separately investigated.

For now, prioritize building and testing the data architecture. Do not release a public version containing uncleared material until the legal position has been established.

Also, do not use unauthorized scraping as a workaround for missing data or licensing restrictions.

## 12. Recommended technology architecture

Please adapt the following architecture to the game's existing technology stack.

Do not unnecessarily rewrite functioning components or introduce a completely different technology stack.

### A. Central database

A hosted PostgreSQL database such as Supabase would be a reasonable choice.

It should hold:

- Players
- Clubs
- Competitions
- Seasons
- Club participation
- Season-specific rosters
- Player statistics
- Derived attributes
- Club identity information
- Provider identifiers
- Import history
- Data versions
- Data-quality information

The data should be normalized appropriately and designed for efficient searching and loading.

### B. Data importer

A backend process should:

1. Connect securely to API-Sports.
2. Retrieve selected competition data.
3. Retrieve club and roster information.
4. Retrieve available player statistics.
5. Normalize the incoming data.
6. Match existing player and club records.
7. Identify missing or conflicting information.
8. Update the central database.
9. Calculate the corresponding player attributes.
10. Prepare and validate a new database version.

The importer must not expose API keys to the browser or the downloadable game.

It should support scheduled and manually triggered updates, logging, retry handling, duplicate prevention and API request budgeting.

### C. Data validation

We should have basic checks such as:

- How many clubs were imported?
- How many players were imported?
- How many players have usable statistics?
- Are there duplicated players?
- Which players have missing positions, nationalities or heights?
- Are rosters current?
- Are some leagues missing entire categories of information?
- Have team rosters changed unexpectedly?
- Did the import unexpectedly reduce database completeness?

A failed or incomplete import should not automatically replace the last known-good published database.

### D. Game integration

The game should consume the prepared data, not independently query sports-data providers.

A new career should use the latest published, validated starting dataset.

The career should then maintain its own independent simulation state.

The full game's access-control and save systems must remain separate from the real-world data-import process.

### E. Future Steam compatibility

Consider how to package an appropriate licensed starting database with a future PC release or supply authorized data updates.

The game should not require continuous access to a paid external sports API to simulate matches.

Ensure that anything distributed with the Steam version is allowed under the relevant licenses.

## 13. API request usage and cost control

API-Sports has offered a basketball plan with approximately 7,500 API requests/day.

An API request means a call to one of the provider's endpoints. One request may return multiple players, teams or statistics records, depending on the endpoint.

It does not necessarily mean one request per individual player.

With our architecture, ordinary gameplay should create approximately **zero requests to the external basketball-data provider**.

For example:

- A user opens their squad: reads our prepared game data.
- A user views player attributes: reads our prepared game data.
- A user simulates a match: uses the simulation engine.
- A user completes a season: uses the simulation engine.
- A user begins a new career: loads our prepared dataset.

The external API is contacted primarily during scheduled imports.

This should substantially reduce costs.

We still need to measure actual requests during the pilot, particularly for collecting comprehensive historical player statistics.

Our initial aim is an affordable multi-league data subscription, ideally in the range of approximately €15–30/month if an appropriate licensed source allows it.

This is a budget target for data access, NOT an assumption that all necessary commercial content rights can be purchased at that price.

## 14. What I want you to do next

Please review the current state of our basketball manager game and assess how to introduce this architecture.

**Do not immediately rewrite the application or start importing thousands of players.**

First, I want a concrete technical assessment and implementation roadmap.

### Phase 1 — Existing game assessment

Inspect our current project and identify:

- Current technology stack and architecture.
- Existing player, club and league data structures.
- How player attributes are currently generated or stored.
- How teams and competitions are represented.
- How the simulation accesses data.
- How existing career saves work.
- Which components can be reused.
- Which components must be modified.

Explain how the proposed real-world database would integrate into the existing application.

### Phase 2 — Provider feasibility study

Investigate API-Sports' current official basketball API documentation.

Determine what is actually available for our selected competitions.

Verify:

- Current rosters.
- Player names.
- Player biographical details.
- Previous-season statistics.
- Current-season statistics.
- Team information.
- Historical results.
- API limitations.
- Rate limits and expected request volumes.
- Provider terms affecting storage and distribution.

Identify missing information and possible alternatives.

Do not claim that a field is available unless it is actually documented or confirmed in a representative API response.

If API access is needed, tell me how to configure it securely. Do not ask me to paste secrets into chat or commit them to the repository.

### Phase 3 — Database design

Propose a scalable and provider-independent database schema.

Pay particular attention to:

- Unique identification of players and clubs.
- Multiple competitions involving the same club.
- Historical rosters.
- Transfers.
- Player statistics across multiple seasons.
- Calculated ratings.
- Data provenance.
- Monthly synchronization.
- Versioned starting datasets.
- Saved-career independence.

### Phase 4 — Rating engine

Propose a realistic algorithm for converting basketball statistics into game attributes.

Explain:

- Which statistics drive each attribute.
- How position affects calculations.
- How competition strength is normalized.
- How age and potential are handled.
- How missing data is treated.
- How unrealistic ratings are detected.

### Phase 5 — Limited technical prototype

After the architecture is agreed upon, implement a small pilot using German BBL and EuroLeague if data coverage is adequate.

The prototype should demonstrate:

1. Importing real clubs.
2. Importing actual roster members.
3. Importing real historical player statistics.
4. Linking players to clubs correctly.
5. Storing club identities and verified colors.
6. Automatically calculating attributes.
7. Showing the imported data in existing game screens.
8. Running an update without corrupting the existing database.
9. Starting a career from a versioned dataset.

If one of the pilot competitions fails the coverage test, substitute another adequately covered major league.

### Phase 6 — Expansion and release preparation

Only after the pilot works should we expand to all selected leagues.

Before a public or paid release, separately complete the necessary commercial data-rights and player/club identity licensing review.

## 15. Important development principles

Please follow these principles throughout implementation:

**Realism:** Player and club information must be grounded in real-world data, not arbitrarily generated.

**Accuracy over quantity:** Ten good leagues are preferable to fifty incomplete ones.

**Affordability:** Avoid unnecessary enterprise-grade services and expensive per-league subscriptions.

**Provider independence:** It should be possible to replace API-Sports in the future.

**Career independence:** Existing careers must never change because the real-world database was updated.

**Traceability:** We should know where imported data came from and when it was last updated.

**Maintainability:** Avoid unnecessarily modifying our existing simulation and user-interface architecture.

**Licensing awareness:** Differentiate technical feasibility from commercial distribution rights.

**Future compatibility:** The architecture should support both browser and Steam versions.

**No unnecessary real-time data:** Monthly updates are sufficient initially.

**No official imagery required:** Real player photos and club logos can be addressed later.

## 16. Expected response from you

After reviewing our existing project, please provide:

1. **Current-state assessment:** What we already have and what needs to change.
2. **Recommended implementation architecture:** How the database, importer, rating engine and game will interact.
3. **Provider feasibility assessment:** Whether API-Sports appears capable of supplying the required information for our initial leagues.
4. **Data-model proposal:** The essential database tables and relationships.
5. **Development roadmap:** A phased plan with specific implementation milestones.
6. **Risks and missing information:** Including data completeness, commercial licensing and expected costs.
7. **First implementation milestone:** The smallest working prototype that proves this architecture will work.

Please challenge any technical assumptions that seem incorrect or unnecessarily expensive.

The objective is not to design an entirely new game. It is to integrate an authentic, affordable, maintainable and regularly updated real-world basketball data system into the basketball manager game we are already developing.

**Our final vision: A basketball management game where every new career begins with authentic, up-to-date real-world basketball data, but develops into an independent fictional basketball universe through our own simulation engine.**

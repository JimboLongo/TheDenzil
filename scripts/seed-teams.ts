import { resolveTeam, type Sport } from "../src/db/teams";

const ODDS_API_KEY = process.env.ODDS_API_KEY;

if (!ODDS_API_KEY) {
  throw new Error("ODDS_API_KEY is not set");
}

// Fixed list — the NFL hasn't added or moved a team since 2002. The
// odds API's /events endpoint only returns teams with an upcoming
// scheduled game, which silently drops whoever's on a bye at fetch
// time (3 of 32, last time this ran). Hardcoding avoids that.
const NFL_TEAMS = [
  "Arizona Cardinals",
  "Atlanta Falcons",
  "Baltimore Ravens",
  "Buffalo Bills",
  "Carolina Panthers",
  "Chicago Bears",
  "Cincinnati Bengals",
  "Cleveland Browns",
  "Dallas Cowboys",
  "Denver Broncos",
  "Detroit Lions",
  "Green Bay Packers",
  "Houston Texans",
  "Indianapolis Colts",
  "Jacksonville Jaguars",
  "Kansas City Chiefs",
  "Las Vegas Raiders",
  "Los Angeles Chargers",
  "Los Angeles Rams",
  "Miami Dolphins",
  "Minnesota Vikings",
  "New England Patriots",
  "New Orleans Saints",
  "New York Giants",
  "New York Jets",
  "Philadelphia Eagles",
  "Pittsburgh Steelers",
  "San Francisco 49ers",
  "Seattle Seahawks",
  "Tampa Bay Buccaneers",
  "Tennessee Titans",
  "Washington Commanders",
];

type OddsApiEvent = {
  home_team: string;
  away_team: string;
};

async function fetchDistinctTeamNames(sportKey: string): Promise<string[]> {
  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/events/?apiKey=${ODDS_API_KEY}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(
      `the-odds-api request failed for ${sportKey}: ${res.status} ${await res.text()}`,
    );
  }

  const events = (await res.json()) as OddsApiEvent[];
  const names = new Set<string>();
  for (const event of events) {
    names.add(event.home_team);
    names.add(event.away_team);
  }

  return [...names].sort();
}

async function seedSport(sport: Sport, canonicalNames: string[]) {
  let inserted = 0;

  for (const name of canonicalNames) {
    const { created } = await resolveTeam(name, sport);
    if (created) inserted++;
  }

  return inserted;
}

async function main() {
  const bySport: Record<Sport, string[]> = {
    NFL: [...NFL_TEAMS].sort(),
    NCAA: await fetchDistinctTeamNames("americanfootball_ncaaf"),
    CFL: [],
  };

  const insertedCounts: Record<Sport, number> = { NFL: 0, NCAA: 0, CFL: 0 };
  for (const sport of ["NFL", "NCAA"] as const) {
    insertedCounts[sport] = await seedSport(sport, bySport[sport]);
  }

  for (const sport of ["NFL", "NCAA"] as const) {
    console.log(
      `${sport}: ${bySport[sport].length} distinct teams (${insertedCounts[sport]} inserted)`,
    );
  }

  for (const sport of ["NFL", "NCAA"] as const) {
    console.log(`\nFirst 10 ${sport} canonical names:`);
    for (const name of bySport[sport].slice(0, 10)) {
      console.log(`  ${name}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

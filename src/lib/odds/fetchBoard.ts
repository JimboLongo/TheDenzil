import { resolveTeam, type Sport } from "../../db/teams";

const ODDS_API_KEY = process.env.ODDS_API_KEY;

const SPORT_KEYS: Record<Sport, string> = {
  NFL: "americanfootball_nfl",
  NCAA: "americanfootball_ncaaf",
  CFL: "americanfootball_cfl",
};

const PREFERRED_BOOKS = ["draftkings", "fanduel", "betmgm", "caesars"];

export type Market = "SPREAD" | "TOTAL";

export type CandidateGame = {
  sport: Sport;
  externalEventId: string;
  homeTeamId: number;
  awayTeamId: number;
  kickoffAt: Date;
  market: Market;
  favoriteTeamId: number | null;
  spread: number | null;
  totalPoints: number | null;
  sourceBook: string;
};

export type FetchBoardResult = {
  candidates: CandidateGame[];
  eventsFetched: number;
  teamsCreated: number;
  spreadRows: number;
  totalRows: number;
  requestsRemaining: string | null;
};

type OddsApiOutcome = {
  name: string;
  price: number;
  point?: number;
};

type OddsApiMarket = {
  key: "spreads" | "totals" | string;
  last_update: string;
  outcomes: OddsApiOutcome[];
};

type OddsApiBookmaker = {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
};

type OddsApiEvent = {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
};

function toIsoNoMillis(date: Date): string {
  return date.toISOString().split(".")[0] + "Z";
}

type MarketPick = { market: OddsApiMarket; bookmakerKey: string } | null;

function findMarketAmongBooks(
  event: OddsApiEvent,
  key: "spreads" | "totals",
  bookKeys: string[],
): MarketPick {
  for (const bookKey of bookKeys) {
    const bookmaker = event.bookmakers?.find((b) => b.key === bookKey);
    const market = bookmaker?.markets.find((m) => m.key === key);
    if (market) return { market, bookmakerKey: bookKey };
  }
  return null;
}

function findMarketAnyBook(
  event: OddsApiEvent,
  key: "spreads" | "totals",
): MarketPick {
  for (const bookmaker of event.bookmakers ?? []) {
    const market = bookmaker.markets.find((m) => m.key === key);
    if (market) return { market, bookmakerKey: bookmaker.key };
  }
  return null;
}

/**
 * Walks PREFERRED_BOOKS for a book that has BOTH markets, so one event's
 * spread and total always come from the same book. Only when no preferred
 * book carries both does this fall back to a per-market search (preferred
 * books first, then any book) — a mixed-book line, which gets logged.
 */
function selectMarketsForEvent(event: OddsApiEvent): {
  spreads: MarketPick;
  totals: MarketPick;
  mixed: boolean;
} {
  for (const bookKey of PREFERRED_BOOKS) {
    const bookmaker = event.bookmakers?.find((b) => b.key === bookKey);
    if (!bookmaker) continue;
    const spreads = bookmaker.markets.find((m) => m.key === "spreads");
    const totals = bookmaker.markets.find((m) => m.key === "totals");
    if (spreads && totals) {
      return {
        spreads: { market: spreads, bookmakerKey: bookKey },
        totals: { market: totals, bookmakerKey: bookKey },
        mixed: false,
      };
    }
  }

  const spreads =
    findMarketAmongBooks(event, "spreads", PREFERRED_BOOKS) ??
    findMarketAnyBook(event, "spreads");
  const totals =
    findMarketAmongBooks(event, "totals", PREFERRED_BOOKS) ??
    findMarketAnyBook(event, "totals");

  return { spreads, totals, mixed: true };
}

export async function fetchBoard(
  sport: Sport,
  fromDate: Date,
  toDate: Date,
): Promise<FetchBoardResult> {
  if (!ODDS_API_KEY) {
    throw new Error("ODDS_API_KEY is not set");
  }

  const sportKey = SPORT_KEYS[sport];
  const params = new URLSearchParams({
    apiKey: ODDS_API_KEY,
    regions: "us",
    markets: "spreads,totals",
    oddsFormat: "american",
    dateFormat: "iso",
    commenceTimeFrom: toIsoNoMillis(fromDate),
    commenceTimeTo: toIsoNoMillis(toDate),
  });

  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?${params.toString()}`;
  const res = await fetch(url);

  const requestsRemaining = res.headers.get("x-requests-remaining");
  console.log(`[odds] ${sport} x-requests-remaining: ${requestsRemaining ?? "unknown"}`);

  if (!res.ok) {
    throw new Error(
      `the-odds-api odds request failed for ${sport}: ${res.status} ${await res.text()}`,
    );
  }

  const events = (await res.json()) as OddsApiEvent[];

  const candidates: CandidateGame[] = [];
  let teamsCreated = 0;
  let spreadRows = 0;
  let totalRows = 0;

  for (const event of events) {
    const home = await resolveTeam(event.home_team, sport);
    const away = await resolveTeam(event.away_team, sport);
    if (home.created) teamsCreated++;
    if (away.created) teamsCreated++;

    const kickoffAt = new Date(event.commence_time);

    const { spreads, totals, mixed } = selectMarketsForEvent(event);

    if (mixed && (spreads || totals)) {
      console.warn(
        `[odds] mixed-book line for ${event.away_team} @ ${event.home_team} ` +
          `(${event.id}): spreads=${spreads?.bookmakerKey ?? "none"} totals=${totals?.bookmakerKey ?? "none"}`,
      );
    }

    if (spreads && spreads.market.outcomes.length > 0) {
      const favoriteOutcome = spreads.market.outcomes.reduce((min, o) =>
        (o.point ?? 0) < (min.point ?? 0) ? o : min,
      );
      const favorite =
        favoriteOutcome.name === event.home_team ? home : away;

      candidates.push({
        sport,
        externalEventId: event.id,
        homeTeamId: home.teamId,
        awayTeamId: away.teamId,
        kickoffAt,
        market: "SPREAD",
        favoriteTeamId: favorite.teamId,
        spread: Math.abs(favoriteOutcome.point ?? 0),
        totalPoints: null,
        sourceBook: spreads.bookmakerKey,
      });
      spreadRows++;
    }

    const overOutcome = totals?.market.outcomes.find((o) => o.name === "Over");
    if (totals && overOutcome && overOutcome.point !== undefined) {
      candidates.push({
        sport,
        externalEventId: event.id,
        homeTeamId: home.teamId,
        awayTeamId: away.teamId,
        kickoffAt,
        market: "TOTAL",
        favoriteTeamId: null,
        spread: null,
        totalPoints: overOutcome.point,
        sourceBook: totals.bookmakerKey,
      });
      totalRows++;
    }
  }

  return {
    candidates,
    eventsFetched: events.length,
    teamsCreated,
    spreadRows,
    totalRows,
    requestsRemaining,
  };
}

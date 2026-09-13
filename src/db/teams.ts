import { eq } from "drizzle-orm";
import { db } from "./index";
import { team, teamAlias } from "./schema";

export type Sport = "NFL" | "NCAA" | "CFL";
export type TeamAliasSource = "archive" | "odds_api" | "manual";

export type ResolveTeamResult = {
  teamId: number;
  created: boolean;
};

/**
 * Resolves a team name to a team.id, creating the team and a self-alias
 * on first sight. All lookups go through team_alias, never
 * team.canonicalName directly, so this is the one path in and the one
 * path out. `aliasSource` records where the name actually came from
 * (defaults to 'odds_api' since that's the common caller) — this is
 * what lets a manually-entered team be told apart from an ingested one
 * later, e.g. for cleanup.
 */
export async function resolveTeam(
  name: string,
  sport: Sport,
  aliasSource: TeamAliasSource = "odds_api",
): Promise<ResolveTeamResult> {
  const [existingAlias] = await db
    .select({ teamId: teamAlias.teamId })
    .from(teamAlias)
    .where(eq(teamAlias.alias, name))
    .limit(1);

  if (existingAlias) {
    return { teamId: existingAlias.teamId, created: false };
  }

  const [newTeam] = await db
    .insert(team)
    .values({ sport, canonicalName: name, isActive: true })
    .returning({ id: team.id });

  await db.insert(teamAlias).values({
    teamId: newTeam.id,
    alias: name,
    source: aliasSource,
  });

  return { teamId: newTeam.id, created: true };
}

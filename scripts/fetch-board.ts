import { fetchBoard } from "../src/lib/odds/fetchBoard";
import type { Sport } from "../src/db/teams";

const SPORTS: Sport[] = ["NFL", "NCAA"];

async function main() {
  const fromDate = new Date();
  const toDate = new Date(fromDate.getTime() + 8 * 24 * 60 * 60 * 1000);

  for (const sport of SPORTS) {
    const result = await fetchBoard(sport, fromDate, toDate);
    console.log(
      `${sport}: ${result.eventsFetched} events, ${result.teamsCreated} teams newly created, ` +
        `${result.spreadRows} spread rows, ${result.totalRows} total rows`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

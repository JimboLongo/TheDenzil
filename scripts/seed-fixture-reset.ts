import { deleteFixtureSeason } from "../src/db/fixture";

async function main() {
  await deleteFixtureSeason();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

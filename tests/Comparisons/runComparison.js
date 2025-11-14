import { DevLiveUrlComparator } from "./DevLiveUrlComparator.js";

async function run() {
  const comparator = new DevLiveUrlComparator();
  await comparator.compare();
}

run();


//"type": "module", Add this in package.json
// run node tests/Comparisons/runComparison.js
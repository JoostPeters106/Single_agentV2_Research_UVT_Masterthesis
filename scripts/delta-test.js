const fs = require('fs');
const path = require('path');

function normalizeCustomerName(name = '') {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '');
}

const NEGATIVE_CUES = [
  'removed',
  'remove',
  'remove from',
  'dropped',
  'drop',
  'dropped from',
  'exclude',
  'excluded',
  'eliminate',
  'eliminated',
  'deprioritize',
  'deprioritized',
  'no longer prioritize',
  'not prioritize',
  'not recommending',
  'no longer recommend',
  'no longer recommending'
].map((cue) => normalizeCustomerName(cue));

function loadCustomerNames() {
  const csvPath = path.join(__dirname, '..', 'data', 'Customer_List_with_YTD_Purchases.csv');
  const content = fs.readFileSync(csvPath, 'utf8');
  return content
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(';')[1])
    .filter(Boolean)
    .map((name) => name.trim());
}

function extractCustomers(text = '', customerNames = []) {
  if (!text) return [];
  const normalizedText = normalizeCustomerName(text);
  const seen = new Set();

  const cueHits = NEGATIVE_CUES.flatMap((cue) => {
    const hits = [];
    let start = normalizedText.indexOf(cue);
    while (start !== -1) {
      hits.push(start);
      start = normalizedText.indexOf(cue, start + cue.length);
    }
    return hits;
  });

  const isNegated = (canonical) => {
    let index = normalizedText.indexOf(canonical);
    while (index !== -1) {
      const threshold = canonical.length + 20;
      const isNearCue = cueHits.some((cueIndex) => Math.abs(cueIndex - index) <= threshold);
      if (isNearCue) return true;
      index = normalizedText.indexOf(canonical, index + canonical.length);
    }
    return false;
  };

  return customerNames
    .map((name) => ({
      canonical: normalizeCustomerName(name),
      display: name
    }))
    .filter(({ canonical, display }) => {
      if (!canonical || seen.has(canonical)) return false;
      const found = normalizedText.includes(canonical);
      if (!found || !display) return false;
      if (isNegated(canonical)) return false;
      seen.add(canonical);
      return true;
    });
}

function runScenario(initial, revised, customerNames) {
  const initialCustomers = extractCustomers(initial, customerNames);
  const revisedCustomers = extractCustomers(revised, customerNames);

  const initialMap = new Map(initialCustomers.map(({ canonical, display }) => [canonical, display]));
  const revisedMap = new Map(revisedCustomers.map(({ canonical, display }) => [canonical, display]));

  const added = Array.from(revisedMap.entries())
    .filter(([canonical]) => !initialMap.has(canonical))
    .map(([, display]) => display);
  const removed = Array.from(initialMap.entries())
    .filter(([canonical]) => !revisedMap.has(canonical))
    .map(([, display]) => display);

  return { added, removed };
}

function main() {
  const customerNames = loadCustomerNames();
  const scenarios = [
    {
      label: 'Removal noted explicitly',
      initial:
        'I recommend MediCore Clinics, FinSure Partners, and SolarEdge Europe because of their steady performance and purchase volumes.',
      revised:
        'Revisiting my earlier recommendation. I would prioritize MediCore Clinics and FinSure Partners due to their high YTD spend. SolarEdge Europe is removed as its YTD purchase amount is significantly lower.'
    },
    {
      label: 'New customer added',
      initial: 'Start with AgroGrowth BV and ArtisPrint Design for their growth potential.',
      revised: 'Updating my view: add MediCore Clinics alongside AgroGrowth BV and ArtisPrint Design.'
    }
  ];

  scenarios.forEach(({ label, initial, revised }) => {
    const { added, removed } = runScenario(initial, revised, customerNames);
    console.log(`\nScenario: ${label}`);
    console.log('  Initial:', initial);
    console.log('  Revised:', revised);
    console.log('  Added:', added.length ? added.join(', ') : 'None');
    console.log('  Removed:', removed.length ? removed.join(', ') : 'None');
  });
}

main();

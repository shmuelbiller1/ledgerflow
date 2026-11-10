const tsNode = require('ts-node').register({ transpileOnly: true });
const { parseNaturalLanguageEntry } = require('./src/lib/algorithms/nl-parser.ts');
const result = parseNaturalLanguageEntry("earned $1500 client retainer check today");
console.log(JSON.stringify(result, null, 2));

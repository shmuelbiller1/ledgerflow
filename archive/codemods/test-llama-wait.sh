npm install llamaindex
cat << 'TS' > test-llama.ts
import { LlamaParseReader } from 'llamaindex';
console.log(LlamaParseReader);
console.log(Object.getOwnPropertyNames(LlamaParseReader.prototype));
TS
npx tsx test-llama.ts

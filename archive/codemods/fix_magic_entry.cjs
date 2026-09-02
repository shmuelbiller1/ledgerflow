const fs = require('fs');

let c = fs.readFileSync('src/components/ledger/MagicEntry.tsx', 'utf8');

c = c.replace(
  `} else {
          const fallback = parseNaturalLanguageEntry(text);
          setParsed(fallback);
        }`,
  `} else {
          const fallback = parseNaturalLanguageEntry(text);
          setParsed({
            action: fallback.action,
            amount: fallback.amountCents || 0,
            description: fallback.description,
            method: fallback.method,
            dateStr: fallback.dateStr
          });
        }`
);

c = c.replace(
  `} catch (e) {
        const fallback = parseNaturalLanguageEntry(text);
        setParsed(fallback);
      } finally {`,
  `} catch (e) {
        const fallback = parseNaturalLanguageEntry(text);
        setParsed({
            action: fallback.action,
            amount: fallback.amountCents || 0,
            description: fallback.description,
            method: fallback.method,
            dateStr: fallback.dateStr
        });
      } finally {`
);

fs.writeFileSync('src/components/ledger/MagicEntry.tsx', c);

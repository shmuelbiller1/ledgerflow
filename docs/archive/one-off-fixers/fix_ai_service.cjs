const fs = require('fs');

let c = fs.readFileSync('src/services/aiService.ts', 'utf8');

c = c.replace(
  `    const idToken = await getIdToken();
    if (!idToken) throw new Error("Authentication required for AI operations");`,
  `    const idToken = await getIdToken();
    if (!idToken) throw new Error("Authentication required for AI operations - falling back to local heuristic");`
);

c = c.replace(
  `    } catch (e) {
      console.error("Magic Entry AI failed", e);
      return null;
    }`,
  `    } catch (e) {
      return null;
    }`
);

fs.writeFileSync('src/services/aiService.ts', c);

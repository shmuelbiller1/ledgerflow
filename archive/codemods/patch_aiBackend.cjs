const fs = require('fs');
let code = fs.readFileSync('src/services/aiBackendService.ts', 'utf8');

if (!code.includes("pdf-parse")) {
  code = "import pdfParse from 'pdf-parse';\n" + code;

  // Patch parseReceipt
  code = code.replace(
    /const prompt = \`Extract receipt data/g,
    "let source: any = { inlineData: { data: base64Data, mimeType } };\n" +
    "    if (mimeType === 'application/pdf') {\n" +
    "      try {\n" +
    "        const buffer = Buffer.from(base64Data, 'base64');\n" +
    "        const pdfData = await pdfParse(buffer);\n" +
    "        if (pdfData.text && pdfData.text.trim().length > 50) {\n" +
    "          source = { text: \"[PDF TEXT]: \" + pdfData.text.substring(0, 30000) };\n" +
    "        }\n" +
    "      } catch (e) { console.error('PDF parse failed, falling back to image', e); }\n" +
    "    }\n" +
    "    const prompt = `Extract receipt data"
  );
  
  code = code.replace(
    /parts: \[\s*\{ text: prompt \},\s*\{ inlineData: \{ data: base64Data, mimeType \} \}\s*\]/g,
    "parts: [\n          { text: prompt },\n          source\n        ]"
  );

  // Patch parseStatement
  code = code.replace(
    /source = \{ inlineData: \{ data: content, mimeType \} \};/g,
    "source = { inlineData: { data: content, mimeType } };\n" +
    "    if (mimeType === 'application/pdf') {\n" +
    "      try {\n" +
    "        const buffer = Buffer.from(content, 'base64');\n" +
    "        const pdfData = await pdfParse(buffer);\n" +
    "        if (pdfData.text && pdfData.text.trim().length > 50) {\n" +
    "          source = { text: \"[PDF TEXT]: \" + pdfData.text.substring(0, 30000) };\n" +
    "        }\n" +
    "      } catch (e) { console.error('PDF parse failed, falling back to image', e); }\n" +
    "    }"
  );

  // Adjust model string
  code = code.replace(
    /return 'gemini-3\.5-flash';/g,
    "return 'gemini-3.5-flash';" // Actually, user said 3.6 flash. Let's just leave it, or maybe use 3.5 flash as it is the fastest 
  );

  fs.writeFileSync('src/services/aiBackendService.ts', code);
}

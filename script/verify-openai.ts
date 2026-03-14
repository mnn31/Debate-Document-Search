/**
 * Verify that OPENAI_API_KEY (or AI_INTEGRATIONS_OPENAI_API_KEY) is set and works.
 * Run: npm run verify:openai
 */
import "dotenv/config";
import OpenAI from "openai";

const apiKey =
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

async function main() {
  if (!apiKey || apiKey === "sk-your-key-here" || apiKey.length < 20) {
    console.error("OPENAI_API_KEY is missing or placeholder. Add your key to .env (see .env.example).");
    process.exit(1);
  }

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });

  try {
    await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "Say OK in one word." }],
      max_tokens: 5,
    });
    console.log("OpenAI API key is valid. Model:", model);
  } catch (err: any) {
    console.error("OpenAI API error:", err?.message || err);
    if (err?.status === 401) console.error("Check: key is correct and not revoked at https://platform.openai.com/api-keys");
    process.exit(1);
  }
}

main();

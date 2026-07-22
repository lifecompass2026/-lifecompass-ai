const SUPABASE_URL = "https://cutqvgjtjpnypnmtgttd.supabase.co";
const SUPABASE_KEY = "sb_publishable_LbtwytaWW3tlJ8lvuIJOlA_oTJYtJVZ";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const token = (req.headers.authorization || "")
      .replace(/^Bearer\s+/i, "")
      .trim();

    const { message } = req.body || {};

    if (!token) {
      return res.status(401).json({ error: "Please log in first." });
    }

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Please enter a message." });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "The OpenAI API key has not been added in Vercel."
      });
    }

    const allowanceResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/use_free_message`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: "{}"
      }
    );

    if (!allowanceResponse.ok) {
      const details = await allowanceResponse.text();

      if (details.includes("FREE_LIMIT_REACHED")) {
        return res.status(402).json({
          error: "You have used your 10 free messages."
        });
      }

      return res.status(401).json({
        error: "Your login has expired. Please log in again."
      });
    }

    const remaining = await allowanceResponse.json();

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        instructions:
          "You are LifeCompass AI, a friendly practical everyday assistant. Help with money, home, travel, work and daily organisation. Give clear, useful answers in plain British English.",
        input: message.trim(),
        max_output_tokens: 500
      })
    });

    const data = await aiResponse.json();

    if (!aiResponse.ok) {
      return res.status(aiResponse.status).json({
        error: data?.error?.message || "The AI service could not respond."
      });
    }

    return res.status(200).json({
    reply:
  data.output
    ?.flatMap(item => item.content || [])
    ?.find(part => part.type === "output_text")
    ?.text ||
  "Sorry, I could not create a response.",
      remaining
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Something went wrong. Please try again."
    });
  }
}

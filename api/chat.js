export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Please enter a message." });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        instructions:
          "You are LifeCompass AI, a friendly practical everyday assistant. Help with money, home, travel, work and daily organisation. Give clear, useful answers in plain British English.",
        input: message,
        max_output_tokens: 500
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(data);
      return res.status(response.status).json({
        error: data?.error?.message || "The AI service could not respond."
      });
    }

    return res.status(200).json({
      reply: data.output_text || "Sorry, I could not create a response."
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: "Something went wrong. Please try again."
    });
  }
}
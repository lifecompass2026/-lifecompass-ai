import crypto from "crypto";

export const config = {
  api: {
    bodyParser: false,
  },
};

const SUPABASE_URL = "https://cutqvgjtjpnypnmtgttd.supabase.co";

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  const parts = signatureHeader.split(",");
  const timestamp = parts
    .find((part) => part.startsWith("t="))
    ?.replace("t=", "");

  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.replace("v1=", ""));

  if (!timestamp || signatures.length === 0) {
    return false;
  }

  const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  return signatures.some((signature) => {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature, "hex"),
        Buffer.from(expectedSignature, "hex")
      );
    } catch {
      return false;
    }
  });
}

async function findUserIdByEmail(email, supabaseSecretKey) {
  if (!email) return null;

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`,
    {
      headers: {
        apikey: supabaseSecretKey,
        Authorization: `Bearer ${supabaseSecretKey}`,
      },
    }
  );

  if (!response.ok) return null;

  const data = await response.json();
  const users = Array.isArray(data) ? data : data.users || [];

  const user = users.find(
    (item) =>
      item.email &&
      item.email.toLowerCase() === email.toLowerCase()
  );

  return user?.id || null;
}

async function updateSubscription(
  userId,
  isSubscribed,
  supabaseSecretKey
) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/user_accounts?on_conflict=user_id`,
    {
      method: "POST",
      headers: {
        apikey: supabaseSecretKey,
        Authorization: `Bearer ${supabaseSecretKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        user_id: userId,
        is_subscribed: isSubscribed,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase update failed: ${errorText}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

    if (!webhookSecret || !supabaseSecretKey) {
      return res.status(500).json({
        error: "Required environment variables are missing",
      });
    }

    const rawBody = await readRawBody(req);
    const stripeSignature = req.headers["stripe-signature"];

    if (
      !stripeSignature ||
      !verifyStripeSignature(
        rawBody,
        stripeSignature,
        webhookSecret
      )
    ) {
      return res.status(400).json({
        error: "Invalid Stripe signature",
      });
    }

    const event = JSON.parse(rawBody.toString("utf8"));
    const object = event.data.object;

    let isSubscribed = null;

    if (event.type === "checkout.session.completed") {
      isSubscribed = true;
    }

    if (event.type === "customer.subscription.updated") {
      isSubscribed =
        object.status === "active" ||
        object.status === "trialing";
    }

    if (
      event.type === "customer.subscription.deleted" ||
      event.type === "invoice.payment_failed"
    ) {
      isSubscribed = false;
    }

    if (isSubscribed === null) {
      return res.status(200).json({ received: true });
    }

    let userId =
      object.client_reference_id ||
      object.metadata?.supabase_user_id ||
      object.metadata?.user_id ||
      null;

    const email =
      object.customer_details?.email ||
      object.customer_email ||
      object.metadata?.email ||
      null;

    if (!userId && email) {
      userId = await findUserIdByEmail(
        email,
        supabaseSecretKey
      );
    }

    if (!userId) {
      return res.status(200).json({
        received: true,
        warning: "No matching LifeCompass user was found",
      });
    }

    await updateSubscription(
      userId,
      isSubscribed,
      supabaseSecretKey
    );

    return res.status(200).json({
      received: true,
      subscriptionUpdated: true,
    });
  } catch (error) {
    console.error("Stripe webhook error:", error);

    return res.status(500).json({
      error: error.message || "Webhook processing failed",
    });
  }
}
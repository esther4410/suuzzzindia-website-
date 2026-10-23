// Sends visitors outside India from the retail store to /international.
// Runs on Vercel before the page is served. Only the store pages below are checked;
// the trade catalog, order tracking and policy pages stay open to everyone.
export const config = {
  matcher: ["/", "/index.html", "/checkout-payment.html"],
};

// Search engines and link-preview bots always see the real store.
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|preview|lighthouse/i;

export default function middleware(request) {
  const url = new URL(request.url);

  // ?geo=US previews the redirect from anywhere; ?geo=IN previews the Indian view.
  const test = (url.searchParams.get("geo") || "").toUpperCase();
  const country = test || request.headers.get("x-vercel-ip-country") || "";

  const ua = request.headers.get("user-agent") || "";
  const cookie = request.headers.get("cookie") || "";
  // Set by "Continue to the India store" on /international, kept for 30 days.
  const choseIndia = /(?:^|;\s*)sl_india=1/.test(cookie);

  // Unknown country counts as India, so a real customer is never sent away.
  if (!country || country === "IN" || BOT.test(ua) || (choseIndia && !test)) return;

  const dest = new URL("/international", url);
  if (test) dest.searchParams.set("geo", test);
  return Response.redirect(dest, 307);
}

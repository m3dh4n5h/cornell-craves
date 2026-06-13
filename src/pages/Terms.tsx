const SECTIONS = [
  {
    heading: "What Cornell Craves is",
    body: "Cornell Craves is a free directory that helps Cornell student clubs list food fundraisers and helps students find them. It is a student project, not a business, and it is not affiliated with, endorsed by, or operated by Cornell University.",
  },
  {
    heading: "We do not handle money",
    body: "Cornell Craves never processes, holds, or transfers payments. When you order, you pay the club directly through Venmo or Zelle using the details the club provides. Cornell Craves is not a party to that transaction, takes no fee, and has no ability to issue refunds, chargebacks, or guarantees. Any payment dispute is strictly between you and the club.",
  },
  {
    heading: "Clubs are responsible for their own listings",
    body: "Each club is solely responsible for the accuracy of its listings, prices, pickup times, fulfillment, and for collecting and remitting any taxes. Cornell Craves does not verify, inspect, prepare, store, or deliver any food and makes no representation that an order will be fulfilled.",
  },
  {
    heading: "Food safety and allergens",
    body: "Allergen and dietary labels are entered by clubs and are provided for convenience only. They are not verified by Cornell Craves and may be incomplete or wrong. If you have a food allergy or dietary restriction, confirm directly with the club before eating anything. Cornell Craves is not responsible for any illness, allergic reaction, or harm arising from food obtained through a listing.",
  },
  {
    heading: "QR pickup passes",
    body: "A QR pass confirms that a club marked your payment as received; it is not proof of payment on its own and does not guarantee a specific item. Keep your pass private. Cornell Craves is not liable for a pass that is shared, screenshotted, or intercepted.",
  },
  {
    heading: "Accounts and accuracy",
    body: "You agree to sign in with a genuine Google account and to provide accurate information, including your NetID and Cornell email. Do not impersonate others or place orders you do not intend to pay for. We may remove listings or accounts that abuse the service.",
  },
  {
    heading: "No warranty, no liability",
    body: 'The service is provided "as is" without warranties of any kind. To the fullest extent allowed by law, the Cornell Craves maintainers are not liable for any indirect, incidental, or consequential damages, or for any loss arising from your use of the service, listings, payments, or food. Your use of Cornell Craves is at your own risk.',
  },
  {
    heading: "Privacy",
    body: "We store only what the service needs: your name, Cornell email and NetID, optional phone and payment handles, your orders and reservations, and your preferences. Clubs you order from can see the order details needed to fulfill it. Questions you ask in Q&A are anonymized. We do not sell your data. To have your data removed, contact the maintainers.",
  },
];

export default function Terms() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight">Terms and disclaimer</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Last updated June 2026. Using Cornell Craves means you agree to the following.
      </p>

      <div className="mt-8 space-y-6">
        {SECTIONS.map((section) => (
          <section key={section.heading}>
            <h2 className="text-base font-bold">{section.heading}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{section.body}</p>
          </section>
        ))}
      </div>

      <p className="mt-10 text-xs text-ink-muted">
        Cornell Craves is an independent student project and is not affiliated with Cornell
        University. "Cornell" is used only to describe the campus community the project serves.
      </p>
    </div>
  );
}

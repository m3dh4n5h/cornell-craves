const SECTIONS = [
  {
    heading: "What Cornell Craves is",
    body: "Cornell Craves is a free directory that helps Cornell student clubs list food fundraisers and helps students find them. It is a student project, not a business, and it is not affiliated with, endorsed by, or operated by Cornell University. We provide listing and discovery tools only. We are not a seller, a food vendor, a delivery service, or a payment processor.",
  },
  {
    heading: "Who can use it",
    body: "Ordering, reserving pickups, and craving alerts are for current Cornell students and require an @cornell.edu Google account. Clubs must be legitimate Cornell student organizations and must be authorized by their organization to run the fundraiser they list. By using the service you confirm you meet these requirements.",
  },
  {
    heading: "We do not handle money",
    body: "Cornell Craves never processes, holds, or transfers payments. When you order, you pay the club directly through Venmo or Zelle using the details the club provides. Cornell Craves is not a party to that transaction, takes no fee, and has no ability to issue refunds, chargebacks, or guarantees. Any payment dispute is strictly between you and the club.",
  },
  {
    heading: "Clubs are responsible for their own listings",
    body: "Each club is solely responsible for its listings, prices, pickup times, and fulfillment, and for complying with all applicable laws, including food-safety and health regulations, cottage-food and food-handler rules, Cornell policies, and any tax collection or remittance. Cornell Craves does not verify, inspect, prepare, store, handle, or deliver any food, and makes no representation that an order will be fulfilled. Clubs, not Cornell Craves, are responsible for the food they provide and for any claim arising from it.",
  },
  {
    heading: "Food safety and allergens",
    body: "Allergen and dietary labels are entered by clubs and are provided for convenience only. They are not verified by Cornell Craves and may be incomplete or wrong. If you have a food allergy or dietary restriction, confirm directly with the club before eating anything. Cornell Craves is not responsible for any illness, allergic reaction, or harm arising from food obtained through a listing.",
  },
  {
    heading: "QR pickup passes",
    body: "A QR pass confirms that a club marked your payment as received. It is not proof of payment on its own and does not guarantee a specific item. Keep your pass private. Cornell Craves is not liable for a pass that is shared, screenshotted, or intercepted.",
  },
  {
    heading: "Accounts and accuracy",
    body: "You agree to sign in with a genuine Google account and to provide accurate information, including your NetID and Cornell email. Do not impersonate others or place orders you do not intend to pay for. You are responsible for activity on your account.",
  },
  {
    heading: "Acceptable use",
    body: "Do not use Cornell Craves to sell alcohol, tobacco, cannabis, or any unlawful or prohibited item, to harass or defraud anyone, to post false or infringing content, or to interfere with the service. We may remove listings, content, or accounts and suspend access at any time, with or without notice, to keep the service safe.",
  },
  {
    heading: "Your content",
    body: "You keep ownership of the listings, logos, photos, reviews, and questions you submit, and you grant Cornell Craves a non-exclusive license to display them within the service. You are responsible for having the rights to anything you upload and for ensuring it is accurate and lawful.",
  },
  {
    heading: "Indemnification",
    body: "To the fullest extent allowed by law, you agree to defend, indemnify, and hold harmless the Cornell Craves maintainers from any claim, loss, liability, or expense (including reasonable legal fees) arising out of your listings, your content, the food you provide or consume, your payments, or your use of the service. This is in addition to, and does not limit, your other responsibilities under these terms.",
  },
  {
    heading: "No warranty",
    body: 'The service is provided "as is" and "as available" without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the service will be uninterrupted, error-free, or secure, or that any listing or club is accurate or reliable.',
  },
  {
    heading: "Limitation of liability",
    body: "To the fullest extent allowed by law, the Cornell Craves maintainers are not liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss arising from your use of the service, listings, payments, or food. Your use of Cornell Craves is at your own risk.",
  },
  {
    heading: "Privacy",
    body: "We store only what the service needs: your name, Cornell email and NetID, optional phone and payment handles, your orders and reservations, and your preferences. Clubs you order from can see the order details needed to fulfill it. Questions you ask in Q&A are anonymized. We do not sell your data. To have your data removed, delete your account in settings or contact the maintainers.",
  },
  {
    heading: "Changes to these terms",
    body: "We may update these terms as the service changes. The latest version always lives on this page, and continuing to use Cornell Craves after an update means you accept the new terms.",
  },
  {
    heading: "Governing law",
    body: "These terms are governed by the laws of the State of New York, without regard to conflict-of-law rules. Any dispute will be brought in the state or federal courts located in Tompkins County, New York.",
  },
  {
    heading: "Contact",
    body: "Cornell Craves is maintained by students. For data-removal requests, security issues, or questions about these terms, reach the maintainers through the project's GitHub repository.",
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

import { jsPDF } from "jspdf";
import type { MyOrder } from "@/types/database";

function money(value: number): string {
  return `$${Number(value).toFixed(2)}`;
}

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Awaiting payment verification",
  qr_sent: "Payment verified, pass sent",
  picked_up: "Picked up",
  cancelled: "Cancelled",
};

const DISCLAIMERS = [
  "Cornell Craves is a free student directory and is not affiliated with Cornell University. It is not a seller, food vendor, or payment processor.",
  "Cornell Craves does not handle money. You pay the club directly through Venmo or Zelle. There are no refunds or guarantees through Cornell Craves; any payment issue is between you and the club.",
  "Allergen and dietary labels are entered by the club and are not verified. Confirm directly with the club before eating anything.",
  "This document is an order summary for your records, not a tax invoice or proof of payment.",
];

/** Generate and download a tidy PDF summary of a submitted order. */
export function saveOrderPdf(order: MyOrder): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 18;
  const right = pageWidth - margin;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const ink: [number, number, number] = [22, 24, 31];
  const muted: [number, number, number] = [120, 120, 120];
  const saffron: [number, number, number] = [184, 118, 31];

  const line = () => {
    doc.setDrawColor(225, 221, 208);
    doc.line(margin, y, right, y);
  };

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...saffron);
  doc.text("CORNELL CRAVES", margin, y);
  doc.setTextColor(...muted);
  doc.setFont("helvetica", "normal");
  doc.text(
    new Date(order.created_at).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }),
    right,
    y,
    { align: "right" },
  );
  y += 8;
  doc.setTextColor(...ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Order summary", margin, y);
  y += 4;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...muted);
  doc.text(`Order ${order.id.slice(0, 8).toUpperCase()}`, margin, y + 3);
  y += 9;
  line();
  y += 8;

  // Two-column meta
  const metaRow = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...muted);
    doc.text(label.toUpperCase(), margin, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(...ink);
    const lines = doc.splitTextToSize(value, contentWidth);
    doc.text(lines, margin, y + 5);
    y += 5 + lines.length * 5 + 3;
  };

  metaRow("Drop", `${order.listing_title} (${order.brand})`);
  metaRow("Club", order.club_name ?? "Cornell club");
  metaRow("Ordered by", `${order.orderer_name}, ${order.orderer_email}`);
  if (order.location_name || order.pickup_info) {
    metaRow("Pickup", order.location_name ?? order.pickup_info ?? "See the listing");
  }
  metaRow("Status", STATUS_LABEL[order.status] ?? order.status);

  y += 2;
  line();
  y += 8;

  // Items table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  doc.text("ITEM", margin, y);
  doc.text("QTY", right - 60, y, { align: "right" });
  doc.text("EACH", right - 32, y, { align: "right" });
  doc.text("TOTAL", right, y, { align: "right" });
  y += 3;
  line();
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...ink);
  for (const item of order.items_json ?? []) {
    const name = doc.splitTextToSize(item.name, contentWidth - 70);
    doc.text(name, margin, y);
    doc.text(String(item.qty), right - 60, y, { align: "right" });
    doc.text(money(item.price), right - 32, y, { align: "right" });
    doc.text(money(item.price * item.qty), right, y, { align: "right" });
    y += Math.max(name.length * 5, 6) + 2;
  }

  y += 1;
  line();
  y += 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Total", margin, y);
  doc.text(money(Number(order.total)), right, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...muted);
  const payLabel =
    order.payment_method === "both"
      ? "Venmo or Zelle"
      : order.payment_method === "venmo"
        ? "Venmo"
        : "Zelle";
  doc.text(`Pay the club directly via ${payLabel}.`, margin, y);
  y += 8;

  // Pickup code
  const code = order.qr_codes.find((qr) => qr.user_type === "orderer")?.pickup_code;
  if (code) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...muted);
    doc.text("PICKUP CODE", margin, y);
    doc.setFontSize(15);
    doc.setTextColor(...ink);
    doc.text(code, margin, y + 6);
    y += 13;
  }

  // Contact
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  doc.text("QUESTIONS? CONTACT THE CLUB", margin, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...ink);
  doc.text(order.contact_email || order.club_name || "See the listing", margin, y + 5);
  y += 12;

  line();
  y += 6;

  // Disclaimers
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  doc.text("DISCLAIMERS", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  for (const text of DISCLAIMERS) {
    const lines = doc.splitTextToSize(text, contentWidth);
    doc.text(lines, margin, y);
    y += lines.length * 4 + 2;
  }

  doc.save(`cornell-craves-order-${order.id.slice(0, 8)}.pdf`);
}

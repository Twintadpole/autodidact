import { invoiceBalance, invoicePaid, invoiceState, invoiceTotal } from '@pool/shared';
import { addressText } from './format';
import { money } from './customer';
import { periodLabel, TERMS_LABEL } from './money';
import type { Customer, Invoice, Settings } from './types';

/**
 * The invoice PDF, made on the phone (works offline). Built ONLY from: the invoice (number,
 * dates, lines, payments, note), the business details, and the customer's name, address and
 * billing email. Chemical costs and anything else owner-only are never read here.
 * (Checked by e2e/invoices-recap.cjs.)
 */
const dateText = (d: string | null | undefined) => {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(y!, m! - 1, day!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export async function invoicePdf(inv: Invoice, customer: Pick<Customer, 'name' | 'address' | 'email' | 'billingEmail'> | undefined, biz: Settings | null): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: false });
  const W = doc.internal.pageSize.getWidth();
  const M = 48;
  const navy: [number, number, number] = [20, 45, 80];
  let y = M;

  // ---- business (left) and logo
  let textX = M;
  if (biz?.logoDataUrl) {
    try {
      const p = doc.getImageProperties(biz.logoDataUrl);
      const h = 84;
      const w = (p.width / p.height) * h;
      doc.addImage(biz.logoDataUrl, 'PNG', M, y, w, h);
      textX = M + w + 14;
    } catch {
      // a broken logo never blocks the invoice
    }
  }
  doc.setTextColor(...navy).setFont('helvetica', 'bold').setFontSize(15);
  doc.text(biz?.businessName?.trim() || '', textX, y + 16);
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(60, 60, 60);
  const bizLines = [addressText(biz?.address), biz?.phone, biz?.email].filter((x): x is string => !!x?.trim());
  bizLines.forEach((l, i) => doc.text(l, textX, y + 32 + i * 13));

  // ---- invoice block (right)
  doc.setTextColor(...navy).setFont('helvetica', 'bold').setFontSize(22);
  doc.text('INVOICE', W - M, y + 18, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(40, 40, 40);
  const right: [string, string][] = [
    ['Invoice #', String(inv.number)],
    ['Date', dateText(inv.issueDate)],
    ['Due', inv.dueDate ? dateText(inv.dueDate) : TERMS_LABEL[biz?.terms ?? 'receipt']],
    ...(inv.period ? ([['Service month', periodLabel(inv.period)]] as [string, string][]) : []),
  ];
  right.forEach(([k, v], i) => {
    doc.setTextColor(110, 110, 110).text(k, W - M - 110, y + 40 + i * 14, { align: 'right' });
    doc.setTextColor(30, 30, 30).text(v, W - M, y + 40 + i * 14, { align: 'right' });
  });
  y += 110;

  // ---- bill to
  doc.setDrawColor(210, 215, 220).line(M, y, W - M, y);
  y += 20;
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(110, 110, 110).text('BILL TO', M, y);
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(30, 30, 30);
  const billTo = [customer?.name, addressText(customer?.address), customer?.billingEmail || customer?.email].filter((x): x is string => !!x?.trim());
  billTo.forEach((l, i) => doc.text(l, M, y + 16 + i * 14));
  y += 24 + billTo.length * 14 + 12;

  // ---- lines
  doc.setFillColor(...navy).rect(M, y, W - 2 * M, 22, 'F');
  doc.setTextColor(255, 255, 255).setFont('helvetica', 'bold').setFontSize(10);
  doc.text('Description', M + 10, y + 15);
  doc.text('Amount', W - M - 10, y + 15, { align: 'right' });
  y += 22;
  doc.setFont('helvetica', 'normal').setTextColor(30, 30, 30);
  for (const l of inv.lines) {
    const wrapped = doc.splitTextToSize(l.description || '—', W - 2 * M - 120) as string[];
    const h = 10 + wrapped.length * 13;
    doc.text(wrapped, M + 10, y + 16);
    doc.text(money(l.amount), W - M - 10, y + 16, { align: 'right' });
    y += h + 4;
    doc.setDrawColor(230, 233, 236).line(M, y, W - M, y);
  }

  // ---- totals
  y += 18;
  const totals: [string, string, boolean][] = [['Total', money(invoiceTotal(inv)), false]];
  if (inv.payments.length) {
    totals.push(['Paid', `− ${money(invoicePaid(inv))}`, false]);
    totals.push(['Balance due', money(invoiceBalance(inv)), true]);
  } else {
    totals[0]![2] = true;
  }
  for (const [k, v, bold] of totals) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(bold ? 12 : 10.5);
    doc.text(k, W - M - 120, y, { align: 'right' });
    doc.text(v, W - M - 10, y, { align: 'right' });
    y += bold ? 20 : 16;
  }

  // ---- payments received
  if (inv.payments.length) {
    y += 8;
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(110, 110, 110).text('PAYMENTS RECEIVED', M, y);
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(30, 30, 30);
    inv.payments.forEach((p, i) => {
      const how = [p.method ? p.method[0]!.toUpperCase() + p.method.slice(1) : '', p.reference].filter(Boolean).join(' ');
      doc.text(`${dateText(p.date)}${how ? ` · ${how}` : ''}`, M, y + 15 + i * 14);
      doc.text(money(p.amount), M + 260, y + 15 + i * 14, { align: 'right' });
    });
    y += 20 + inv.payments.length * 14;
  }

  // ---- note and payment instructions
  const blocks: [string, string | undefined][] = [
    ['NOTE', inv.notes?.trim()],
    ['HOW TO PAY', biz?.paymentInstructions?.trim()],
  ];
  for (const [title, text] of blocks) {
    if (!text) continue;
    y += 18;
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(110, 110, 110).text(title, M, y);
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(30, 30, 30);
    const wrapped = doc.splitTextToSize(text, W - 2 * M) as string[];
    doc.text(wrapped, M, y + 15);
    y += 15 + wrapped.length * 13;
  }

  // ---- stamp
  const state = invoiceState(inv);
  if (state === 'paid' || state === 'void') {
    doc.setFont('helvetica', 'bold').setFontSize(40).setTextColor(state === 'paid' ? 46 : 180, state === 'paid' ? 140 : 40, state === 'paid' ? 70 : 40);
    doc.text(state === 'paid' ? 'PAID' : 'VOID', W - M, 300, { align: 'right', angle: 12 });
  }

  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(140, 140, 140);
  doc.text('Thank you for your business.', W / 2, doc.internal.pageSize.getHeight() - 36, { align: 'center' });
  return doc.output('blob');
}

/** Opens Android's share menu with the PDF (or downloads it where sharing isn't available). */
export async function sharePdf(blob: Blob, filename: string, title: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title });
    return 'shared';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

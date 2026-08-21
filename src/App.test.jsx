import { describe, expect, it } from "vitest";
import { computeInvoice, financialYear, invoiceBalance, lineAmountPaise, toPaise, validateGSTIN } from "./App.jsx";

const intrastateCompany = { gstin: "27AAAAA0000A1Z5" };
const interstateCustomer = { gstin: "33AAAAA0000A1Z5" };
const intrastateCustomer = { gstin: "27AAAAA0000A1Z5" };
const invoice = {
  id: "invoice-1", customerSnapshot: intrastateCustomer,
  items: [{ id: "line-1", description: "Freight", hsn: "9965", qty: "1", rate: "100000", taxRate: "18" }],
};

describe("GST and accounting calculations", () => {
  it("uses integer paise for decimal values and fractional quantities", () => {
    expect(toPaise("0.01")).toBe(1);
    expect(toPaise("100.50")).toBe(10050);
    expect(lineAmountPaise("2.5", "100.50")).toBe(25125);
  });

  it("calculates intrastate CGST and SGST", () => {
    const total = computeInvoice(invoice, intrastateCompany, intrastateCustomer);
    expect(total.cgstPaise).toBe(900000);
    expect(total.sgstPaise).toBe(900000);
    expect(total.igstPaise).toBe(0);
    expect(total.grandTotalPaise).toBe(11800000);
  });

  it("calculates interstate IGST", () => {
    const total = computeInvoice(invoice, intrastateCompany, interstateCustomer);
    expect(total.igstPaise).toBe(1800000);
    expect(total.cgstPaise).toBe(0);
    expect(total.sgstPaise).toBe(0);
  });

  it("uses payments and notes to calculate outstanding", () => {
    const balance = invoiceBalance(invoice,
      [{ invoiceId: "invoice-1", amountPaise: 3000000 }, { invoiceId: "invoice-1", amountPaise: 2000000 }],
      [{ invoiceId: "invoice-1", amountPaise: 1000000, status: "issued" }],
      [{ invoiceId: "invoice-1", amountPaise: 500000, status: "issued" }], intrastateCompany);
    expect(balance.totalPaise).toBe(11800000);
    expect(balance.paymentPaise).toBe(5000000);
    expect(balance.outstandingPaise).toBe(6300000);
  });

  it("calculates financial years on the April boundary", () => {
    expect(financialYear("2026-03-31")).toBe("2025-26");
    expect(financialYear("2026-04-01")).toBe("2026-27");
  });

  it("validates GSTIN format/checksum without claiming government verification", () => {
    expect(validateGSTIN("27AABCU9603R1ZN").valid).toBe(true);
    expect(validateGSTIN("27AABCU9603R1Z0").valid).toBe(false);
  });
});

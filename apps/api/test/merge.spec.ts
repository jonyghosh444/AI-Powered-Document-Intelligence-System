import { applyCorrections } from "../src/merge";

describe("applyCorrections", () => {
  const current = {
    invoice_number: { value: "INV-1", confidence: 0.4 },
    invoice_date: { value: "2024-03-01", confidence: 0.4 },
    supplier_name: { value: "Acme", confidence: 0.4 },
    customer_name: { value: null, confidence: 0 },
    subtotal: { value: 100, confidence: 0.4 },
    tax: { value: 10, confidence: 0.4 },
    total: { value: 110, confidence: 0.4 },
    currency: { value: "USD", confidence: 0.4 },
    line_items: [{ description: "Widget", quantity: 1, unit_price: 100, amount: 100 }],
  };

  it("records only fields that change and marks them certain", () => {
    const { next, changes } = applyCorrections(current, { customer_name: "Northwind", invoice_number: "INV-1" });
    expect(changes).toEqual([{ fieldPath: "customer_name", oldValue: null, newValue: "Northwind" }]);
    expect(next.customer_name).toEqual({ value: "Northwind", confidence: 1 });
    expect(next.invoice_number.confidence).toBe(0.4);
  });

  it("replaces line items as one correction", () => {
    const { next, changes } = applyCorrections(current, {
      line_items: [{ description: "Gadget", quantity: 2, unit_price: 5, amount: 10 }],
    });
    expect(changes[0].fieldPath).toBe("line_items");
    expect(next.line_items[0].amount).toBe(10);
  });

  it("does not invent a number from blank text", () => {
    const { next } = applyCorrections(current, { total: "" });
    expect(next.total.value).toBeNull();
  });
});

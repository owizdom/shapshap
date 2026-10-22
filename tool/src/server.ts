import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { valueTradeIn, findPhones, createCheckout, confirmPayment } from "./tools.ts";
import type { Deps } from "./types.ts";

function reply(result: object) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result as Record<string, unknown>,
  };
}

export function buildServer(deps: Deps): McpServer {
  const server = new McpServer({ name: "shapshap", version: "0.1.0" });

  server.registerTool("value_trade_in", {
    description: "Values a customer's iPhone for trade-in from the shop's price list and returns a signed quote with the deduction working. It may refuse a phone outright (FAULT_NOT_BOUGHT) and may mark some faults as provisional (inspect_faults), to be confirmed at the pickup inspection. It prices the phone the way the shop's website calculator does: optional screen, body, battery and parts condition (defaults: light wear, light wear, healthy, genuine; pass them only when the customer states them), and named faults deducted on top. The condition used is returned. All figures are exact naira, not rounded. Call it first, and quote the customer only the figures it returns.",
    inputSchema: {
      model: z.string().describe("iPhone model, for example iPhone 16 Plus"),
      capacity_gb: z.number().describe("Storage capacity in GB"),
      faults: z.array(z.string()).describe("Fault ids reported by the customer, empty if none"),
      screen: z.enum(["flawless", "light", "visible", "cracked"]).optional().describe("Screen condition; omit unless the customer states it (default light)"),
      body: z.enum(["flawless", "light", "visible", "cracked"]).optional().describe("Body and frame condition; omit unless the customer states it (default light)"),
      battery: z.enum(["healthy", "worn", "service", "replaced"]).optional().describe("Battery state; omit unless the customer states it (default healthy)"),
      parts: z.enum(["genuine", "one", "multiple"]).optional().describe("How many parts are not genuine Apple; omit unless the customer states it (default genuine)"),
    },
  }, async (args) => reply(await valueTradeIn(deps, args)));

  server.registerTool("find_phones", {
    description: "Lists up to three in-stock phones the customer can swap to, within their top-up budget, cheapest top-up first. Call it after value_trade_in; prices and top-ups come only from this tool. Each option carries an offer_token that locks the price and top-up shown, so pass it unchanged to create_checkout.",
    inputSchema: {
      quote_token: z.string().describe("The quote_token returned by value_trade_in"),
      max_topup_ngn: z.number().describe("The most the customer is willing to pay on top, in naira"),
    },
  }, async (args) => reply(await findPhones(deps, args)));

  server.registerTool("create_checkout", {
    description: "Creates a Paystack payment link for the top-up on one chosen phone. Call it once the customer picks a phone, passing that option's offer_token from find_phones; the offer locks the price shown, so the customer pays exactly the top-up they were quoted even if the shop price list changes meanwhile. The amount comes from the offer and nowhere else. It requires the customer to have confirmed that Find My is off on their trade-in phone; pass find_my_off true only after they say so.",
    inputSchema: {
      quote_token: z.string().describe("The quote_token returned by value_trade_in"),
      offer_token: z.string().describe("The offer_token of the chosen phone, exactly as returned by find_phones for this quote_token"),
      find_my_off: z.boolean().describe("True only if the customer has confirmed Find My is turned off on the phone they are trading in"),
    },
  }, async (args) => reply(await createCheckout(deps, args)));

  server.registerTool("confirm_payment", {
    description: "Checks whether a checkout has been paid and reserves the phone, returning a pickup code. Call it after the customer says they have paid; only its answer decides whether the phone is reserved.",
    inputSchema: {
      reference: z.string().describe("The reference returned by create_checkout"),
    },
  }, async (args) => reply(await confirmPayment(deps, args)));

  return server;
}

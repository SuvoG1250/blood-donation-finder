import {
  fetchPincodeOffices,
  postOfficeToAddress,
  WB_STATE_LABEL,
} from "@/lib/postalPincode";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ pincode: string }> },
) {
  const { pincode } = await ctx.params;
  const digits = (pincode ?? "").replace(/\D/g, "");
  if (digits.length !== 6) {
    return json({ error: "PIN code must be 6 digits." }, 400);
  }

  try {
    const offices = await fetchPincodeOffices(digits);
    if (offices.length === 0) {
      return json({
        ok: false,
        state: WB_STATE_LABEL,
        message: "No West Bengal post offices found for this PIN code.",
        offices: [],
      });
    }

    return json({
      ok: true,
      state: WB_STATE_LABEL,
      pincode: digits,
      offices: offices.map((po) => ({
        ...postOfficeToAddress(po, digits),
        branchType: po.BranchType ?? "",
        deliveryStatus: po.DeliveryStatus ?? "",
      })),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "PIN code lookup failed.";
    return json({ error: message }, 502);
  }
}

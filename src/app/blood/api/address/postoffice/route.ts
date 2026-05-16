import {
  fetchPostOfficeByName,
  postOfficeToAddress,
  WB_STATE_LABEL,
} from "@/lib/postalPincode";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return json({ error: "Search query must be at least 2 characters." }, 400);
  }

  try {
    const offices = await fetchPostOfficeByName(q);
    if (offices.length === 0) {
      return json({
        ok: false,
        state: WB_STATE_LABEL,
        message: "No West Bengal post offices found for this name.",
        offices: [],
      });
    }

    return json({
      ok: true,
      state: WB_STATE_LABEL,
      query: q,
      offices: offices.map((po) => ({
        ...postOfficeToAddress(po),
        branchType: po.BranchType ?? "",
        deliveryStatus: po.DeliveryStatus ?? "",
      })),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Post office search failed.";
    return json({ error: message }, 502);
  }
}

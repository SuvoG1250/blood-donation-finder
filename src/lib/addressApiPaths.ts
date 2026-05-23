/** App routes live under /blood; middleware redirects bare paths on pages only. */

export function pincodeApiPath(pincode: string): string[] {
  const digits = pincode.replace(/\D/g, "");
  return [
    `/blood/api/address/pincode/${digits}`,
    `/api/address/pincode/${digits}`,
  ];
}

export function postOfficeApiPath(query: string): string[] {
  const q = encodeURIComponent(query.trim());
  return [
    `/blood/api/address/postoffice?q=${q}`,
    `/api/address/postoffice?q=${q}`,
  ];
}

export async function fetchFirstOk(paths: string[]): Promise<Response> {
  let lastError: unknown = null;
  for (const path of paths) {
    try {
      const resp = await fetch(path, { cache: "no-store" });
      if (resp.status === 404) continue;
      return resp;
    } catch (e) {
      lastError = e;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("Could not reach address service.");
}

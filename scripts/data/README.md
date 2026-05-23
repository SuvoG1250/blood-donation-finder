# West Bengal location source data

## `wb-jjm-villages.tsv`

Household survey export from the **West Bengal Jal Jeevan Mission** portal with:

| Column | Example |
|--------|---------|
| District | `HOOGHLY` |
| Block | `Khanakul - I` |
| Gram Panchayat | `BALIPUR` |
| Village | `Balipur (113)` |

~16,600 villages across West Bengal (district → block → GP → village).

**Source:** `https://jjm.wbphed.gov.in/dashboard/ajax_requests/public_ajax/getvilllistchildsmcode`

The public endpoint may require an authenticated session. If download fails, refresh this file from a logged-in browser export or replace with an updated TSV in the same pipe-separated format.

## Regenerating `wb-locations.json`

```bash
npm run build:wb-locations
```

This merges this file with official districts and `india-pincode` post offices.

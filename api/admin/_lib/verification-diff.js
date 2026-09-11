// Batch 1 — Change Detection.
// Shared by both the manual "Send to Verification Queue" flow (router.js)
// and the scheduled cron refresh (cron/table-downloader-refresh.js).
//
// Before a bulk upsert into `verifications`, this looks up the existing rows
// (matched by authority + reference_no, same key the upsert itself uses) and
// snapshots any row whose status is about to change into
// `verification_history` — so a status flip (e.g. Valid -> Cancelled) shows
// up on that record's History, not just silently overwritten.
//
// Best-effort only: any failure here must never block the actual upsert.
export async function logVerificationStatusChanges(SB, sbHeaders, payload) {
  try {
    const keyed = payload.filter(r => r.reference_no);
    if (keyed.length === 0) return 0;

    const authorities = [...new Set(keyed.map(r => r.authority))].filter(Boolean);
    const existingByKey = new Map();

    for (const authority of authorities) {
      const r = await fetch(
        `${SB()}/rest/v1/verifications?authority=eq.${encodeURIComponent(authority)}&select=id,authority,reference_no,status,name,city,notes,blacklist_status,official_source_url,published`,
        { headers: sbHeaders() }
      );
      const rows = await r.json();
      if (Array.isArray(rows)) {
        rows.forEach(row => existingByKey.set(`${row.authority}|${row.reference_no}`, row));
      }
    }

    const historyEntries = [];
    for (const newRow of keyed) {
      const key = `${newRow.authority}|${newRow.reference_no}`;
      const oldRow = existingByKey.get(key);
      const newStatus = newRow.status || 'unknown';
      if (oldRow && oldRow.status !== newStatus) {
        historyEntries.push({
          verification_id: oldRow.id,
          old_data: oldRow,
          new_data: { ...oldRow, ...newRow, status: newStatus }
        });
      }
    }

    if (historyEntries.length > 0) {
      await fetch(`${SB()}/rest/v1/verification_history`, {
        method: 'POST',
        headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(historyEntries)
      });
    }
    return historyEntries.length;
  } catch (e) {
    return 0;
  }
}

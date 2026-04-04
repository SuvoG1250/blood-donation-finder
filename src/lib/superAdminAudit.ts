import type { SupabaseClient } from "@supabase/supabase-js";

export async function logSuperAdminAction(
  adminClient: SupabaseClient,
  row: {
    actor_user_id: string;
    action_type: string;
    target_kind?: string | null;
    target_id?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await adminClient.from("super_admin_audit_logs").insert({
      actor_user_id: row.actor_user_id,
      action_type: row.action_type,
      target_kind: row.target_kind ?? null,
      target_id: row.target_id ?? null,
      metadata: row.metadata ?? {},
    });
  } catch {
    // non-blocking
  }
}

// Recalculate lead scores (one lead, a list, or all leads after weights change).
import { getContext, handler, json, HttpError } from '../_shared/context.ts';
import { computeLeadScore } from '../_shared/pipeline.ts';

Deno.serve(handler(async (req, body) => {
  const ctx = await getContext(req);
  let ids: string[] = body.lead_ids ?? (body.lead_id ? [body.lead_id] : []);
  if (body.all) {
    if (!['super_admin', 'admin', 'sales_manager'].includes(ctx.user.role)) throw new HttpError(403, 'Managers and admins only');
    const { data } = await ctx.admin.from('leads').select('id').limit(2000);
    ids = (data ?? []).map(d => d.id);
  }
  if (!ids.length) throw new HttpError(400, 'lead_id, lead_ids or all required');
  const results: Record<string, unknown> = {};
  for (const id of ids) results[id] = await computeLeadScore(ctx.admin, id);
  return json({ rescored: ids.length, results: ids.length === 1 ? results : undefined });
}));

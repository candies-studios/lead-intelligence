import { signUnsubscribe } from './mail.ts';
export const unsubSecret = () => Deno.env.get('UNSUBSCRIBE_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
export async function unsubscribeUrl(contactId: string, enrollmentId?: string | null) {
  const t = await signUnsubscribe(unsubSecret(), contactId, enrollmentId);
  return `${Deno.env.get('SUPABASE_URL')}/functions/v1/unsubscribe?t=${encodeURIComponent(t)}`;
}

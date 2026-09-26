-- Ensure administrators can read and reply to every internal conversation,
-- including conversations created before this migration.
BEGIN;

CREATE OR REPLACE FUNCTION public.can_access_conversation(target_conversation_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = target_conversation_id
        AND cm.user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.can_send_conversation_message(target_conversation_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin()
    OR (public.can_access_conversation(target_conversation_id)
      AND EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.id = target_conversation_id AND c.conversation_type = 'support'
      ));
$$;

CREATE OR REPLACE FUNCTION public.send_admin_broadcast(
  conversation_subject text,
  message_body text,
  target_role text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_conversation_id uuid; recipient record;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only administrators can send broadcasts'; END IF;
  IF char_length(trim(conversation_subject)) = 0 OR char_length(trim(message_body)) = 0 THEN
    RAISE EXCEPTION 'Subject and message are required';
  END IF;
  IF target_role IS NOT NULL AND target_role NOT IN
    ('admin', 'organizer', 'author', 'reviewer', 'participant') THEN
    RAISE EXCEPTION 'Invalid recipient role';
  END IF;
  INSERT INTO public.conversations(subject, conversation_type, created_by)
  VALUES (trim(conversation_subject), 'broadcast', auth.uid())
  RETURNING id INTO new_conversation_id;
  FOR recipient IN
    SELECT id FROM public.profiles
    WHERE target_role IS NULL OR role = target_role
  LOOP
    INSERT INTO public.conversation_members(conversation_id, user_id)
    VALUES (new_conversation_id, recipient.id) ON CONFLICT DO NOTHING;
  END LOOP;
  INSERT INTO public.messages(conversation_id, sender_id, body)
  VALUES (new_conversation_id, auth.uid(), trim(message_body));
  RETURN new_conversation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_admin_broadcast(text, text, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;

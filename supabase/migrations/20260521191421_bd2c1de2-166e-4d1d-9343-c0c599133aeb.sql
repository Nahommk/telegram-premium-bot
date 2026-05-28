
REVOKE EXECUTE ON FUNCTION public.process_payment(UUID, TEXT, public.payment_method, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_payment(UUID, TEXT, public.payment_method, INTEGER, JSONB) TO service_role;

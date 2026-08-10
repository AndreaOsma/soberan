type Props = { error: string | null };

export function ModalFormError({ error }: Props) {
  if (!error) return null;
  return (
    <p className="error-banner modal-form-error" role="alert">
      {error}
    </p>
  );
}

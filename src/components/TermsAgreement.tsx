/** Required "I agree to the Terms" checkbox for registration flows. */
export function TermsAgreement({
  checked,
  onChange,
  invalid = false,
  extra,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  invalid?: boolean;
  /** Extra clause appended after "the Terms", e.g. club responsibility. */
  extra?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-5 shrink-0 accent-(--color-primary-dark)"
        aria-invalid={invalid}
      />
      <span className={invalid ? "text-sm text-accent" : "text-sm text-ink-muted"}>
        I agree to the{" "}
        <a
          href="/terms"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-primary-dark underline-offset-2 hover-fine:underline"
        >
          Terms and disclaimer
        </a>
        {extra ? ` ${extra}` : "."}
      </span>
    </label>
  );
}

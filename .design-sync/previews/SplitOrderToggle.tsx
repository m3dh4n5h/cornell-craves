import { useState } from "react";
import { SplitOrderToggle } from "cornell-craves";

function Demo({ initial }: { initial: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  return (
    <div style={{ maxWidth: 420 }}>
      <SplitOrderToggle enabled={enabled} onChange={setEnabled} />
    </div>
  );
}

export function Off() {
  return <Demo initial={false} />;
}

export function On() {
  return <Demo initial />;
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Combobox } from "@/components/ui/combobox";
import type { CampusLocation } from "@/types/database";

interface LocationComboboxProps {
  id?: string;
  locationId: string;
  locations: CampusLocation[];
  onChange: (locationId: string) => void;
  placeholder?: string;
  invalid?: boolean;
  emptyHint?: string;
  "aria-label"?: string;
}

/**
 * Campus-location picker styled and driven like the Brand field, instead of
 * a native <select>. Adapts Combobox's plain string value to a
 * CampusLocation id: typing filters by name, and only an exact (case
 * insensitive) match resolves to a real locationId - anything else clears
 * the selection, same as leaving the field blank.
 */
export function LocationCombobox({
  id,
  locationId,
  locations,
  onChange,
  placeholder = "Pick a location",
  invalid,
  emptyHint,
  "aria-label": ariaLabel,
}: LocationComboboxProps) {
  const options = useMemo(() => locations.map((location) => location.name), [locations]);
  const selectedName = locations.find((location) => location.id === locationId)?.name ?? "";
  const [text, setText] = useState(selectedName);
  // What `text` was last synced to, so the effect below only reacts to
  // externally-driven changes (locations arriving after this row mounted, a
  // locationId set from outside) and never stomps on text the user is
  // mid-typing, which wouldn't resolve to a name until it exactly matches.
  const lastSyncedName = useRef(selectedName);

  useEffect(() => {
    if (selectedName === lastSyncedName.current) return;
    lastSyncedName.current = selectedName;
    setText(selectedName);
  }, [selectedName]);

  const handleChange = (value: string) => {
    setText(value);
    const match = locations.find(
      (location) => location.name.toLowerCase() === value.trim().toLowerCase(),
    );
    lastSyncedName.current = match?.name ?? "";
    onChange(match?.id ?? "");
  };

  return (
    <Combobox
      id={id}
      value={text}
      onChange={handleChange}
      options={options}
      placeholder={placeholder}
      invalid={invalid}
      emptyHint={emptyHint}
      aria-label={ariaLabel}
    />
  );
}

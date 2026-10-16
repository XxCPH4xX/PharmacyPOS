"use client";
import { MapPin } from "lucide-react";
import { AppSelect } from "./select";
export function BranchPicker({
  value,
  branches,
  onChange,
}: {
  value: string;
  branches: { id: string; name: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <AppSelect
      value={value}
      onValueChange={onChange}
      options={branches.map((branch) => ({
        value: branch.id,
        label: branch.name,
      }))}
      aria-label="Select branch"
      className="branch-select-control"
      icon={<MapPin size={16} />}
      placeholder="Choose a branch"
    />
  );
}

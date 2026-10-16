"use client";

import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";

export function AppSelect({
  value,
  defaultValue,
  onValueChange,
  options,
  name,
  required,
  disabled,
  placeholder = "Choose an option",
  icon,
  className = "",
  ...triggerProps
}: {
  value?: string | number;
  defaultValue?: string | number;
  onValueChange?: (value: string) => void;
  options: { value: string | number; label: string; disabled?: boolean }[];
  name?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  icon?: ReactNode;
} & Omit<
  ComponentProps<typeof Select.Trigger>,
  "value" | "defaultValue" | "onChange" | "children"
>) {
  // Radix reserves the empty string for its placeholder; our forms also use it for "All branches".
  const [internal, setInternal] = useState(
    String(defaultValue ?? options[0]?.value ?? ""),
  );
  const selected = String(value ?? internal);
  const emptyOption = options.find((option) => option.value === "");
  const encode = (item: string | number) =>
    String(item) === "" && !emptyOption?.disabled
      ? "__empty_option__"
      : String(item);
  return (
    <Select.Root
      value={encode(selected)}
      onValueChange={(next) => {
        const decoded = next === "__empty_option__" ? "" : next;
        setInternal(decoded);
        onValueChange?.(decoded);
      }}
      disabled={disabled}
      required={required}
    >
      {name && (
        <input type="hidden" name={name} value={selected} disabled={disabled} />
      )}
      <Select.Trigger
        {...triggerProps}
        className={`branch-picker-trigger app-select-trigger ${className}`}
      >
        {icon}
        <Select.Value
          placeholder={emptyOption?.disabled ? emptyOption.label : placeholder}
        />
        <Select.Icon>
          <ChevronDown size={16} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="branch-picker-menu app-select-menu"
          position="popper"
          align="end"
          sideOffset={6}
          collisionPadding={12}
        >
          <Select.ScrollUpButton className="select-scroll">
            <ChevronUp size={16} />
          </Select.ScrollUpButton>
          <Select.Viewport>
            {options
              .filter((option) => !(option.value === "" && option.disabled))
              .map((option) => (
                <Select.Item
                  className="branch-picker-item"
                  value={encode(option.value)}
                  key={option.value}
                  disabled={option.disabled}
                  textValue={option.label}
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator>
                    <Check size={16} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="select-scroll">
            <ChevronDown size={16} />
          </Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

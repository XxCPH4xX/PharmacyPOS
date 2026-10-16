"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronLeft,
  ChevronRight,
  Cross,
  LoaderCircle,
  SearchX,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  cloneElement,
  useId,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";

export const cn = (...values: Parameters<typeof clsx>) =>
  twMerge(clsx(...values));
export function Button({
  children,
  className,
  variant = "primary",
  busy = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={cn("button", `button-${variant}`, className)}
    >
      {busy && <LoaderCircle size={16} className="spin" />}
      {children}
    </button>
  );
}
export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={cn("brand", light && "brand-light")}>
      <span className="brand-icon">
        <Cross size={23} strokeWidth={2.6} />
      </span>
      <div>
        <strong>
          PharmaCore<span>ERP</span>
        </strong>
        <small>Care in every operation.</small>
      </div>
    </div>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
  className,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={cn("modal-content", wide && "modal-wide", className)}
        >
          <div className="modal-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close dialog">
              <X size={20} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <SearchX size={27} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Badge({
  children,
  tone = "teal",
}: {
  children: ReactNode;
  tone?: "teal" | "amber" | "red" | "blue" | "muted";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, {
        id,
        "aria-describedby": hint ? `${id}-hint` : undefined,
      })}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
export function Pagination({
  page,
  size,
  total,
  onChange,
}: {
  page: number;
  size: number;
  total: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {total
          ? `${page * size + 1}–${Math.min((page + 1) * size, total)} of ${total}`
          : "0 results"}
      </span>
      <div>
        <button
          aria-label="Previous page"
          className="icon-button"
          disabled={page === 0}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          Page {page + 1} of {Math.max(1, Math.ceil(total / size))}
        </span>
        <button
          aria-label="Next page"
          className="icon-button"
          disabled={(page + 1) * size >= total}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
export function Skeleton() {
  return (
    <div
      className="loading-layout"
      aria-label="Loading workspace"
      role="status"
    >
      <div className="skeleton skeleton-hero" />
      <div className="skeleton-row">
        {Array.from({ length: 6 }, (_, i) => (
          <div className="skeleton" key={i} />
        ))}
      </div>
      <div className="skeleton skeleton-chart" />
      <span className="sr-only">Loading your pharmacy workspace…</span>
    </div>
  );
}

"use client";
import { AppSelect } from "./select";

import { useEffect, useState, type FormEvent } from "react";
import { api, date } from "@/lib/api";
import type { Session } from "@/lib/types";
import { Brand, Button, Field, Badge } from "./ui";

export function MFAGate({
  session,
  onSession,
}: {
  session: Session;
  onSession: (s: Session) => void;
}) {
  const [setup, setSetup] = useState<{ secret: string; qr_svg: string } | null>(
    null,
  );
  const [codes, setCodes] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (session.mfa?.enabled)
        onSession(
          await api<Session>("auth/mfa/verify/", {
            method: "POST",
            body: JSON.stringify(values),
          }),
        );
      else if (!setup)
        setSetup(
          await api("auth/mfa/", {
            method: "POST",
            body: JSON.stringify(values),
          }),
        );
      else {
        const result = await api<{
          session: Session;
          recovery_codes: string[];
        }>("auth/mfa/confirm/", {
          method: "POST",
          body: JSON.stringify(values),
        });
        setCodes(result.recovery_codes);
        setConfirmed(result.session);
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="security-gate">
      <section className="panel security-card">
        <Brand />
        <h1>
          {codes.length
            ? "Save your recovery codes"
            : session.mfa?.enabled
              ? "Verify your sign-in"
              : "Protect your pharmacy"}
        </h1>
        {codes.length ? (
          <>
            <p>
              Store these codes somewhere private. Each works once if you lose
              access to your authenticator. They will not be shown again.
            </p>
            <div className="recovery-codes">
              {codes.map((code) => (
                <code key={code}>{code}</code>
              ))}
            </div>
            <Button onClick={() => confirmed && onSession(confirmed)}>
              I have saved my codes
            </Button>
          </>
        ) : (
          <>
            <p>
              {session.mfa?.enabled
                ? "Enter a code from your authenticator, or an unused recovery code."
                : "An authenticator is required for privileged accounts. Use an authenticator app on your phone."}
            </p>
            <form onSubmit={submit}>
              {setup && (
                <>
                  <img
                    className="mfa-qr"
                    src={`data:image/svg+xml;base64,${btoa(setup.qr_svg)}`}
                    alt="Scan this QR code with your authenticator"
                  />
                  <Field
                    label="Setup key"
                    hint="If you cannot scan the QR code, enter this key in your authenticator."
                  >
                    <input readOnly value={setup.secret} />
                  </Field>
                </>
              )}
              {session.mfa?.enabled || setup ? (
                <Field label="Authenticator or recovery code">
                  <input
                    name="code"
                    required
                    autoComplete="one-time-code"
                    maxLength={64}
                  />
                </Field>
              ) : (
                <Field label="Confirm your password">
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </Field>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <Button busy={busy} type="submit">
                {session.mfa?.enabled
                  ? "Verify sign-in"
                  : setup
                    ? "Enable authenticator"
                    : "Set up authenticator"}
              </Button>
            </form>
          </>
        )}
        <Button
          variant="ghost"
          onClick={async () => {
            try {
              await api("auth/logout/", { method: "POST" });
              onSession(await api<Session>("auth/session/"));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Sign out
        </Button>
      </section>
    </main>
  );
}

interface StaffData {
  members: {
    id: string;
    name: string;
    email: string;
    role: string;
    branch: string;
    active: boolean;
  }[];
  invitations: {
    id: string;
    email: string;
    role: string;
    expires_at: string;
    status: string;
  }[];
}
export function Team({
  session,
  branch,
}: {
  session: Session;
  branch: string;
}) {
  const [data, setData] = useState<StaffData | null>(null),
    [link, setLink] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setData(await api<StaffData>("staff/", {}, branch));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [branch]);
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api<{ token: string }>(
        "staff/",
        {
          method: "POST",
          body: JSON.stringify({
            ...values,
            branch_id: values.branch_id || null,
          }),
        },
        branch,
      );
      setLink(
        `${window.location.origin}/?invite=${encodeURIComponent(result.token)}`,
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(path: string) {
    setError("");
    try {
      await api(path, { method: "POST" }, branch);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="operation-grid">
      <section className="panel operation-panel">
        <h2>Invite a team member</h2>
        <p>
          The invitation expires in seven days. Share the private link with its
          intended recipient.
        </p>
        <form onSubmit={invite}>
          <Field label="Staff email">
            <input name="email" type="email" required />
          </Field>
          <Field label="Staff role">
            <AppSelect
              name="role"
              options={[
                "cashier",
                "manager",
                "pharmacist",
                "inventory",
                "accountant",
                "auditor",
              ].map((value) => ({ value, label: value }))}
            />
          </Field>
          <Field label="Branch access">
            <AppSelect
              name="branch_id"
              options={[
                { value: "", label: "All branches" },
                ...(session.branches || []).map((b) => ({
                  value: b.id,
                  label: b.name,
                })),
              ]}
            />
          </Field>
          <Button type="submit" busy={busy}>
            Create invitation
          </Button>
        </form>
        {link && (
          <Field label="Private invitation link">
            <input value={link} readOnly onFocus={(e) => e.target.select()} />
          </Field>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </section>
      <section className="panel operation-panel">
        <h2>Staff access</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Team member</th>
                <th>Role</th>
                <th>Branch</th>
                <th>Access</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.name}</strong>
                    <small>{m.email}</small>
                  </td>
                  <td>{m.role}</td>
                  <td>{m.branch}</td>
                  <td>
                    <Badge tone={m.active ? "teal" : "muted"}>
                      {m.active ? "Active" : "Revoked"}
                    </Badge>
                  </td>
                  <td>
                    {m.active && m.role !== "owner" && (
                      <Button
                        variant="danger"
                        onClick={() => revoke(`staff/${m.id}/revoke/`)}
                      >
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Invitations</h3>
        {data?.invitations.map((i) => (
          <div className="record-row" key={i.id}>
            <span>
              {i.email}
              <small>
                {i.role} · Expires {date(i.expires_at)}
              </small>
            </span>
            <Badge>{i.status}</Badge>
            {i.status === "pending" && (
              <Button
                variant="ghost"
                onClick={() => revoke(`staff/invitations/${i.id}/revoke/`)}
              >
                Revoke invite
              </Button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

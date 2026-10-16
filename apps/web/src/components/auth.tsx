"use client";

import { ArrowRight, Check, ShieldCheck, Stethoscope } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { Session } from "@/lib/types";
import { Brand, Button, Field } from "./ui";

export function Auth({
  session,
  onLogin,
}: {
  session: Session;
  onLogin: (value: Session) => void;
}) {
  const [register, setRegister] = useState(false);
  const invite = useSearchParams().get("invite");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      onLogin(
        await api<Session>(
          `auth/${invite ? "invitation" : register ? "register" : "login"}/`,
          {
            method: "POST",
            body: JSON.stringify(invite ? { ...data, token: invite } : data),
          },
        ),
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function demo() {
    setBusy(true);
    setError("");
    try {
      onLogin(await api<Session>("auth/demo/", { method: "POST" }));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Brand light />
        <div className="auth-story-content">
          <span className="eyebrow light">THE BUSINESS BEHIND BETTER CARE</span>
          <h1>
            A healthier way
            <br />
            to run your
            <br />
            <em>pharmacy.</em>
          </h1>
          <p>
            From the first delivery to the last receipt.
            <br />
            Keep your stock, sales, and team in sync.
          </p>
          <div className="auth-promises">
            {[
              "Every batch, accounted for",
              "A faster, clearer checkout",
              "One connected workspace",
            ].map((text) => (
              <div key={text}>
                <Check size={16} />
                {text}
              </div>
            ))}
          </div>
        </div>
        <div className="auth-story-bottom">
          <Stethoscope size={19} />
          <span>Built for the way pharmacies work.</span>
          <span>BD</span>
        </div>
        <div className="auth-rings" aria-hidden="true" />
      </section>
      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <div className="auth-overline">
            <ShieldCheck size={18} /> YOUR PHARMACY WORKSPACE
          </div>
          <h2>
            {invite
              ? "Join your pharmacy team."
              : register
                ? "Let’s set up your pharmacy."
                : "Welcome back."}
          </h2>
          <p>
            {register
              ? "Create your organization and its first branch."
              : "Sign in to keep good care moving."}
          </p>
          <form onSubmit={submit}>
            {invite && (
              <>
                <Field label="Your name">
                  <input name="name" required maxLength={100} />
                </Field>
                <p>
                  Use your existing account password, or choose a unique
                  password with at least 12 characters for a new account.
                </p>
              </>
            )}
            {register && (
              <>
                <Field label="Your name">
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={100}
                    placeholder="Your full name"
                  />
                </Field>
                <Field label="Pharmacy name">
                  <input
                    name="organization"
                    required
                    maxLength={150}
                    placeholder="e.g. Dhanmondi Pharmacy"
                  />
                </Field>
                <div className="form-grid">
                  <Field label="First branch">
                    <input
                      name="branch"
                      required
                      maxLength={120}
                      placeholder="Main branch"
                    />
                  </Field>
                  <Field label="Address">
                    <input
                      name="address"
                      maxLength={250}
                      placeholder="Dhaka, Bangladesh"
                    />
                  </Field>
                </div>
              </>
            )}
            {!invite && (
              <Field label="Email address">
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  placeholder="you@pharmacy.com"
                />
              </Field>
            )}
            <Field
              label="Password"
              hint={
                register
                  ? "At least 12 characters. Use a unique password."
                  : undefined
              }
            >
              <input
                type="password"
                name="password"
                autoComplete={register ? "new-password" : "current-password"}
                minLength={register ? 12 : undefined}
                maxLength={128}
                required
                placeholder="Enter your password"
              />
            </Field>
            {invite && (
              <Field label="Authenticator code (existing accounts only)">
                <input
                  name="code"
                  autoComplete="one-time-code"
                  maxLength={64}
                />
              </Field>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button busy={busy} type="submit" className="full-width">
              {invite
                ? "Accept invitation"
                : register
                  ? "Create workspace"
                  : "Sign in"}
              <ArrowRight size={17} />
            </Button>
          </form>
          <p className="auth-switch">
            {register ? "Already have a workspace?" : "New to PharmaCore?"}{" "}
            <button
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register ? "Sign in" : "Create workspace"}
            </button>
          </p>
          {session.demo_available && (
            <div className="demo-entry">
              <div className="divider">
                <span>TAKE A LOOK AROUND</span>
              </div>
              <Button
                variant="secondary"
                className="full-width"
                onClick={demo}
                busy={busy}
              >
                Explore demo workspace
                <ArrowRight size={16} />
              </Button>
              <small>A local workspace with fictional sample data.</small>
            </div>
          )}
          <footer>
            PharmaCore ERP <span>•</span> Connected pharmacy operations
          </footer>
        </div>
      </section>
    </main>
  );
}

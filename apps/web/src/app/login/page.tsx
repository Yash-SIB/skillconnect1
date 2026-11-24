import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/icon";
import styles from "./login.module.css";

export const metadata: Metadata = {
  title: "Sign in | SkillConnect",
  description: "Sign-in preview for the Skillinabox team workspace.",
};

export default function LoginPage() {
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="login-title">
        <header className={styles.intro}>
          <div className={styles.logo}>
            <Image src="/skillinabox-logo.png" alt="Skillinabox" width={140} height={40} />
          </div>
          <h1 id="login-title">Welcome to <span>SkillConnect</span></h1>
          <p>Sign in with your Skillinabox Google account to access your team workspace.</p>
        </header>
        <button type="button" className={styles.provider} disabled aria-describedby="login-status">
          Continue with Google
        </button>
        <p className={styles.status} id="login-status">
          <span aria-hidden="true" /> Google sign-in is pending setup.
        </p>
        <footer className={styles.footer}>
          <p className={styles.restriction}><Icon name="lock" /> For approved Skillinabox employees only.</p>
          {process.env.NODE_ENV === "development" && (
            <Link href="/" className={styles.preview}>Open Workspace Preview <Icon name="arrow" /></Link>
          )}
        </footer>
      </section>
    </main>
  );
}

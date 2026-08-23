"use server";

import { redirect } from "next/navigation";

import { closeDecisionGate } from "@/lib/auth/decision-gate";
import { readViewer } from "@/lib/auth/viewer";

/**
 * Choosing is what closes the chooser.
 *
 * These are Server Actions rather than links for one reason: a link would let
 * Next.js prefetch the destination, and a prefetch that closed the gate would
 * dismiss the page before the person had read it. A POST happens only when
 * somebody presses the button.
 *
 * Neither action grants access to anything. Both destinations enforce their
 * own authorization — `/job-seeker` has a layout gate, every console page and
 * API re-checks the session and RLS — so all that is happening here is that
 * one screen stops being shown.
 */

async function choose(destination: "/solutions" | "/job-seeker") {
  const viewer = await readViewer();
  if (!viewer.signedIn) {
    redirect(`/auth/sign-in?next=${encodeURIComponent(destination)}`);
  }

  await closeDecisionGate();
  redirect(destination);
}

export async function chooseSoftwareFactory() {
  await choose("/solutions");
}

export async function chooseJobSeeker() {
  await choose("/job-seeker");
}

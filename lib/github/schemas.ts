import { z } from "zod";

const GITHUB_WEB_ORIGIN = "https://github.com";

function isSafeGitHubWebUrl(value: string) {
  try {
    const url = new URL(value);
    return url.origin === GITHUB_WEB_ORIGIN
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export const githubWebUrlSchema = z.string().url().refine(isSafeGitHubWebUrl, {
  message: "Expected a GitHub web URL.",
});
